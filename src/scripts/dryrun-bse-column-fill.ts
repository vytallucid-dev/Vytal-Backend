// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NULL-ONLY COLUMN FILL — NEGATIVE AND POSITIVE CONTROLS.  ⚠ NOT A BUILD GATE (it queries the
// live database and writes inside a transaction it then rolls back).
//
//   npx tsx src/scripts/dryrun-bse-column-fill.ts
//
// Everything runs against the REAL table with its REAL constraints, on a REAL row, inside ONE
// transaction that is thrown out at the end. Nothing persists — proven afterwards by re-reading the
// row from a fresh connection and by counting raw_field_edits.
//
// The negative control is the one that matters: offer a value for a column that ALREADY HAS ONE and
// prove the stored value does not move. A writer nobody has watched refuse is a writer nobody knows
// refuses.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  ColumnFillRefused,
  FILLABLE,
  fillNullColumns,
  verifyNoOverwrites,
  type TxClient,
} from "../ingestions/quaterly-results/bse/bse-column-fill.js";

const EDITOR = "dryrun-bse-column-fill";
let pass = 0, fail = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? "  — " + detail : ""}`);
}

const ROLLBACK = "INTENTIONAL_ROLLBACK";

async function main() {
  // ── pick a REAL row: a bank-year with the four balance-sheet lines null and interest_earned set ──
  const target = await prisma.$queryRawUnsafe<
    Array<{ id: string; symbol: string; fy: string; source: string; interest_earned: string | null; advances: string | null; updated_at: Date }>
  >(
    `SELECT x.id, s.symbol, x.fiscal_year AS fy, x.source, x.interest_earned, x.advances, x.updated_at
       FROM banking_fundamentals x JOIN stocks s ON s.id = x.stock_id
      WHERE x.result_type = 'standalone'
        AND x.advances IS NULL AND x.deposits IS NULL
        AND x.interest_earned IS NOT NULL
      ORDER BY s.symbol, x.fiscal_year LIMIT 1`,
  );
  if (!target.length) throw new Error("no suitable row — the population this path exists for is empty");
  const row = target[0];
  const beforeIE = Number(row.interest_earned);
  console.log(`\nTARGET ROW (real, live): ${row.symbol} ${row.fy} banking_fundamentals [${row.source}]`);
  console.log(`  id                 ${row.id}`);
  console.log(`  advances           ${row.advances ?? "NULL"}          ← the positive control (null, must fill)`);
  console.log(`  interest_earned    ${beforeIE}   ← the NEGATIVE control (set, must NOT move)`);
  console.log(`  updated_at         ${new Date(row.updated_at).toISOString()}`);

  const auditBefore = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM raw_field_edits WHERE edited_by = $1`, EDITOR);
  const since = new Date();

  interface Snapshot {
    r1: Awaited<ReturnType<typeof fillNullColumns>>;
    afterIE: number;
    afterAdv: number | null;
    afterUpdatedAt: Date;
    audit: Array<{ field: string; old_value: string | null; new_value: string; citation: string }>;
    guardMatched: number;
    layer3: Awaited<ReturnType<typeof verifyNoOverwrites>>;
    r2: Awaited<ReturnType<typeof fillNullColumns>>;
  }
  const box: { snap?: Snapshot } = {};

  try {
    await prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxClient;

      // ── THE CALL: one null column offered, one non-null column offered, one bogus column ──
      const r1 = await fillNullColumns(
        tx,
        "banking_fundamentals",
        row.id,
        {
          advances: 12345.67,          // NULL today  → must land
          deposits: 23456.78,          // NULL today  → must land
          interest_earned: 999999.99,  // SET today   → must be refused, value must not move
          net_profit_margin: 42,       // not in FILLABLE → refused outright
          balances_with_banks: null,   // extractor found nothing → noValue
        },
        "https://www.bseindia.com/xml-data/corpfiling/…/dryrun.xml",
        EDITOR,
        "negative/positive control run",
      );

      const after = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT advances, deposits, interest_earned, updated_at FROM banking_fundamentals WHERE id = $1`, row.id);
      const audit = await tx.$queryRawUnsafe<Array<{ field: string; old_value: string | null; new_value: string; citation: string }>>(
        `SELECT field, old_value, new_value, citation FROM raw_field_edits
          WHERE target_row_id = $1 AND edited_by = $2 ORDER BY field`, row.id, EDITOR);

      // ── the IS NULL guard itself, exercised directly against the real constraint ──
      // interest_earned is non-null; the guarded UPDATE must match ZERO rows.
      const guardMatched = await tx.$executeRawUnsafe(
        `UPDATE "banking_fundamentals" SET "interest_earned" = $1 WHERE "id" = $2 AND "interest_earned" IS NULL`,
        1.0, row.id);

      const layer3 = await verifyNoOverwrites(tx, EDITOR, since);

      // ── idempotence: calling again must land nothing, because nothing is null any more ──
      const r2 = await fillNullColumns(
        tx, "banking_fundamentals", row.id,
        { advances: 111.11, deposits: 222.22 },
        "https://www.bseindia.com/xml-data/corpfiling/…/dryrun.xml", EDITOR, "second call",
      );

      box.snap = {
        r1,
        afterIE: Number(after[0].interest_earned),
        afterAdv: after[0].advances === null ? null : Number(after[0].advances),
        afterUpdatedAt: after[0].updated_at as Date,
        audit, guardMatched, layer3, r2,
      };
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }

  const t = box.snap as Snapshot;

  console.log(`\n── POSITIVE CONTROL — a null column takes the value ──────────────`);
  check(t.r1.landed.includes("advances") && t.r1.landed.includes("deposits"), "advances + deposits landed", t.r1.landed.join(", "));
  check(t.afterAdv === 12345.67, "advances reads back as the offered value", String(t.afterAdv));

  console.log(`\n── NEGATIVE CONTROL — a non-null column is refused, value unmoved ─`);
  check(t.r1.heldNotNull.includes("interest_earned"), "interest_earned reported as heldNotNull");
  check(!t.r1.landed.includes("interest_earned"), "interest_earned NOT in landed");
  check(t.afterIE === beforeIE, `interest_earned unchanged (${beforeIE})`, `now ${t.afterIE}`);
  check(t.guardMatched === 0, "the IS NULL guard alone matches 0 rows on a non-null column", `matched ${t.guardMatched}`);

  console.log(`\n── THE DECLARED SET ─────────────────────────────────────────────`);
  check(t.r1.notFillable.includes("net_profit_margin"), "a column outside FILLABLE is refused outright");
  check(!FILLABLE.banking_fundamentals.includes("net_profit_margin"), "…and it is genuinely not in the declared set");
  check(t.r1.noValue.includes("balances_with_banks"), "a null offered value is recorded, not written");

  console.log(`\n── AUDIT (layer 3) ──────────────────────────────────────────────`);
  check(t.audit.length === 2, `one audit row per landed cell — ${t.audit.length}`, t.audit.map((a) => a.field).join(", "));
  check(t.audit.every((a) => a.old_value === null), "EVERY audit row carries old_value = NULL");
  check(t.audit.every((a) => a.citation.includes("bseindia.com")), "CN-4 citation present on every row");
  check(!t.audit.some((a) => a.field === "interest_earned"), "no audit row for the refused column");
  check(t.layer3.ok && t.layer3.total === 2, "verifyNoOverwrites: 0 rows with a non-null old_value", `total ${t.layer3.total}`);

  console.log(`\n── IDEMPOTENCE ──────────────────────────────────────────────────`);
  check(t.r2.landed.length === 0, "second call lands nothing");
  check(t.r2.heldNotNull.length === 2, "…and reports both columns as already set");

  console.log(`\n── ROLLED BACK — nothing persisted ──────────────────────────────`);
  const post = await prisma.$queryRawUnsafe<Array<{ advances: string | null; deposits: string | null; interest_earned: string; updated_at: Date }>>(
    `SELECT advances, deposits, interest_earned, updated_at FROM banking_fundamentals WHERE id = $1`, row.id);
  check(post[0].advances === null, "advances is NULL again");
  check(post[0].deposits === null, "deposits is NULL again");
  check(Number(post[0].interest_earned) === beforeIE, "interest_earned still its original value");
  check(
    new Date(post[0].updated_at).getTime() === new Date(row.updated_at).getTime(),
    "updated_at did not move",
  );
  const auditAfter = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM raw_field_edits WHERE edited_by = $1`, EDITOR);
  check(
    Number(auditAfter[0].n) === Number(auditBefore[0].n),
    `raw_field_edits unchanged (${auditBefore[0].n} → ${auditAfter[0].n})`,
  );

  console.log(`\n── REFUSALS THAT MUST THROW ─────────────────────────────────────`);
  for (const [label, fn] of [
    ["empty citation", () => prisma.$transaction(async (tx) =>
      fillNullColumns(tx as unknown as TxClient, "banking_fundamentals", row.id, { advances: 1 }, "", EDITOR))],
    ["row that does not exist", () => prisma.$transaction(async (tx) =>
      fillNullColumns(tx as unknown as TxClient, "banking_fundamentals", "no-such-row-id", { advances: 1 },
        "https://www.bseindia.com/x.xml", EDITOR))],
    ["unsafe column identifier", () => prisma.$transaction(async (tx) =>
      fillNullColumns(tx as unknown as TxClient, "banking_fundamentals", row.id, { 'advances"; DROP TABLE x; --': 1 },
        "https://www.bseindia.com/x.xml", EDITOR))],
  ] as Array<[string, () => Promise<unknown>]>) {
    let threw: unknown = null;
    try { await fn(); } catch (e) { threw = e; }
    check(threw instanceof ColumnFillRefused, `${label} → ColumnFillRefused`,
      threw instanceof Error ? threw.message.slice(0, 90) : String(threw));
  }

  console.log(`\n${fail === 0 ? `✅ ALL ${pass} CHECKS PASSED` : `❌ ${fail} FAILED of ${pass + fail}`}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
