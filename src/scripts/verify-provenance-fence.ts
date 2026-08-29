// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE FENCE HOLDS AGAINST A REAL PIPELINE WRITE — driven live, then ROLLED BACK.
//
//   npx tsx src/scripts/verify-provenance-fence.ts
//
// The source-scan gate (verify-ingester-write-semantics.ts) proves every ingester routes through
// guardedWrite and that the fence sits below the mode switch. It cannot prove the fence actually
// stops a write, because that is a runtime property. This does.
//
// ⚠ EVERYTHING HAPPENS INSIDE ONE INTERACTIVE TRANSACTION THAT ALWAYS THROWS AT THE END. Nothing
//   reaches the database. The row counts and values are re-read after the rollback and compared to
//   what they were before, so the "it rolled back" claim is itself measured rather than asserted.
//
// The scenario is the dangerous one, not a friendly one: a `full_upsert` — the strongest mode there
// is, the one decideIngest's `refresh` path uses — aimed squarely at a hand-entered row, carrying
// values that differ in every column. That is exactly what the next nightly scan would do to the
// 202 manual rows, whose filing_date is set to their report_date and therefore always looks stale.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  guardedWrite, fullUpsert, FILL_NULL_ONLY, INSERT_IF_ABSENT,
  ProvenanceViolation, type WritableDelegate, type RawCapable,
} from "../ingestions/quaterly-results/ingesters/guarded-write.js";

class Rollback extends Error {}
let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) { console.log(`  ok    ${label}${detail ? `  — ${detail}` : ""}`); return; }
  failures++;
  console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
}

const POISON = -99999.99;   // unmistakable, and nothing like a real financial figure

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`VERIFY — provenance fence, live then rolled back`);
  console.log("=".repeat(100));

  // ── pick real targets ───────────────────────────────────────────────────────────────────────
  const manual = (await prisma.$queryRawUnsafe<Array<{ id: string; symbol: string; fy: string; q: string; rt: string }>>(`
    SELECT q.id, s.symbol, q.fiscal_year fy, q.quarter q, q.result_type::text rt
      FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
     WHERE q.source = 'manual_workbook' AND q.revenue IS NOT NULL LIMIT 1`))[0];
  // ⚠ The row must have SOME marked columns and SOME unmarked ones among the columns this test
  //   poisons. A row where everything is marked passes the "cells held" check vacuously and proves
  //   nothing about the other half of the contract — that a fence blocks marked cells and ONLY
  //   marked cells. A fence that blocks everything is a freeze, and would be its own bug.
  const edited = (await prisma.$queryRawUnsafe<Array<{ id: string; symbol: string; field: string; marked: number }>>(`
    SELECT q.id, s.symbol, min(e.field) field, count(DISTINCT e.field)::int marked
      FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
      JOIN raw_field_edits e ON e.target_table = 'QuarterlyResult' AND e.target_row_id = q.id
     WHERE q.source <> 'manual_workbook'
       AND q.revenue IS NOT NULL AND q.expenses IS NOT NULL AND q.net_profit IS NOT NULL
     GROUP BY q.id, s.symbol
    HAVING count(DISTINCT e.field) BETWEEN 1 AND 5
     LIMIT 1`))[0];
  if (!manual) { console.log("  no manual_workbook quarterly row to test against"); process.exit(1); }
  console.log(`\n  manual target : ${manual.symbol} ${manual.fy}${manual.q} ${manual.rt}`);
  console.log(`  edited target : ${edited ? `${edited.symbol} (field ${edited.field})` : "(none — per-cell fence untested)"}\n`);

  const snap = async (id: string): Promise<Record<string, unknown>> =>
    (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM quarterly_results WHERE id=$1`, id))[0];
  const beforeManual = await snap(manual.id);
  const beforeEdited = edited ? await snap(edited.id) : null;
  const countBefore = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM quarterly_results`))[0].n;

  try {
    await prisma.$transaction(async (tx) => {
      const db = tx as unknown as RawCapable;
      const delegate = (tx as unknown as { quarterlyResult: WritableDelegate }).quarterlyResult;
      const where = { stockId_quarter_fiscalYear_resultType: {
        stockId: String(beforeManual.stock_id), quarter: manual.q, fiscalYear: manual.fy, resultType: manual.rt } };

      // ── 1. full_upsert at a manual row: every held cell must be refused ──────────────────
      const poisoned = { revenue: POISON, expenses: POISON, netProfit: POISON, profitBeforeTax: POISON,
        tax: POISON, operatingProfit: POISON, otherIncome: POISON, depreciation: POISON, interest: POISON };
      const r1 = await guardedWrite({
        delegate, db, modelName: "QuarterlyResult", where, data: poisoned,
        directive: fullUpsert("SIMULATION — verify-provenance-fence.ts"),
        label: `${manual.symbol} ${manual.fy}${manual.q}`,
      });
      const heldCols = Object.keys(poisoned).filter((c) => {
        const snakeKey = c.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        return beforeManual[snakeKey] !== null && beforeManual[snakeKey] !== undefined;
      });
      check(r1.columnsBlockedByFence.length === heldCols.length,
        `full_upsert on a manual row: all ${heldCols.length} held cell(s) refused by the fence`,
        `blocked=[${r1.columnsBlockedByFence.join(",")}] held=[${heldCols.join(",")}]`);
      check(r1.columnsWritten.every((c) => !heldCols.includes(c)),
        "nothing the fence refused was written", `written=[${r1.columnsWritten.join(",")}]`);

      const afterManual = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM quarterly_results WHERE id=$1`, manual.id))[0];
      const moved = Object.keys(beforeManual).filter((k) =>
        k !== "updated_at" && String(beforeManual[k]) !== String(afterManual[k]));
      check(moved.length === 0, "in-transaction: not one manual cell moved", `moved=[${moved.join(",")}]`);

      // ── 2. per-cell fence on a NON-manual row carrying a raw_field_edits marker ──────────
      if (edited && beforeEdited) {
        const w2 = { stockId_quarter_fiscalYear_resultType: {
          stockId: String(beforeEdited.stock_id), quarter: String(beforeEdited.quarter),
          fiscalYear: String(beforeEdited.fiscal_year), resultType: String(beforeEdited.result_type) } };
        const r2 = await guardedWrite({
          delegate, db, modelName: "QuarterlyResult", where: w2, data: poisoned,
          directive: fullUpsert("SIMULATION"), label: `${edited.symbol} edited-row`,
        });
        const after2 = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT * FROM quarterly_results WHERE id=$1`, edited.id))[0];
        const marked = (await tx.$queryRawUnsafe<Array<{ field: string }>>(
          `SELECT DISTINCT field FROM raw_field_edits WHERE target_table='QuarterlyResult' AND target_row_id=$1`, edited.id))
          .map((x) => x.field.replace(/_/g, "").toLowerCase());
        const markedMoved = Object.keys(beforeEdited).filter((k) =>
          marked.includes(k.replace(/_/g, "").toLowerCase()) && String(beforeEdited[k]) !== String(after2[k]));
        check(markedMoved.length === 0,
          `per-cell fence: ${marked.length} marked cell(s) held on a non-manual row`, `moved=[${markedMoved.join(",")}]`);
        check(r2.columnsWritten.length > 0 || r2.action === "unchanged",
          "the same write still reached unmarked columns (the fence is a fence, not a freeze)",
          `written=[${r2.columnsWritten.join(",")}] action=${r2.action}`);
      }

      // ── 3. fill_null_only leaves a held cell alone, with no directive at all ────────────
      const r3 = await guardedWrite({
        delegate, db, modelName: "QuarterlyResult", where, data: poisoned,
        label: `${manual.symbol} default-mode`,   // ← no directive: the default must be the safe one
      });
      check(r3.columnsWritten.every((c) => !heldCols.includes(c)),
        "omitting the directive gives fill_null_only, not the old full rewrite",
        `written=[${r3.columnsWritten.join(",")}]`);

      // ── 4. insert_if_absent never touches an existing row ────────────────────────────────
      const r4 = await guardedWrite({
        delegate, db, modelName: "QuarterlyResult", where, data: poisoned,
        directive: INSERT_IF_ABSENT, label: `${manual.symbol} insert-if-absent`,
      });
      check(r4.action === "skipped_present" && r4.columnsWritten.length === 0,
        "insert_if_absent on an existing row writes nothing", `action=${r4.action}`);

      // ── 5. a full_upsert directive built by hand (no reason) is refused ──────────────────
      let refused = false;
      try {
        await guardedWrite({ delegate, db, modelName: "QuarterlyResult", where, data: poisoned,
          directive: { mode: "full_upsert" }, label: "no-reason" });
      } catch (e) { refused = e instanceof ProvenanceViolation; }
      check(refused, "a full_upsert without a reason is refused at the writer");
      check(FILL_NULL_ONLY.mode === "fill_null_only", "FILL_NULL_ONLY is what it says");

      throw new Rollback("done");
    }, { timeout: 120_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(`\n  UNEXPECTED: ${String(e).slice(0, 900)}`); failures++; }
  }

  // ── the rollback itself, measured ───────────────────────────────────────────────────────────
  const afterManual = await snap(manual.id);
  const countAfter = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM quarterly_results`))[0].n;
  const diff = Object.keys(beforeManual).filter((k) => String(beforeManual[k]) !== String(afterManual[k]));
  console.log("");
  check(diff.length === 0, "after rollback: the manual row is byte-identical", `diff=[${diff.join(",")}]`);
  check(countBefore === countAfter, "after rollback: row count unchanged", `${countBefore} -> ${countAfter}`);

  console.log(`\n${"=".repeat(100)}`);
  console.log(failures === 0 ? "  ALL CHECKS PASS — nothing was written" : `  ${failures} CHECK(S) FAILED`);
  console.log("=".repeat(100) + "\n");
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
