// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERSISTED FENCE — capture / verify / prove.  ⚠ NOT A BUILD GATE (it queries the live database).
//
//   npx tsx src/scripts/bse-fence-baseline.ts --capture   # snapshot the four tables to disk
//   npx tsx src/scripts/bse-fence-baseline.ts --verify    # diff live against the snapshot, NAMING rows
//   npx tsx src/scripts/bse-fence-baseline.ts --prove     # negative + positive control, rolled back
//
// --prove is the part that matters. It deletes a REAL NSE row inside a transaction, asserts the fence
// NAMES it in words ("ACC 2018-09-30 standalone"), asserts an untouched row is NOT flagged, and then
// rolls back. A guard nobody has watched fire is a guard nobody knows works.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import {
  loadBaseline,
  persistBaseline,
  verifyAgainstPersisted,
  type NamedMovement,
} from "../ingestions/quaterly-results/bse/bse-fence-persist.js";

const SCRATCH =
  "C:/Users/Punctuations/AppData/Local/Temp/claude/c--Users-Punctuations-Desktop-Vytal/5f2365f2-6a2f-42f6-a2ed-4feee93f9306/scratchpad";
const BASELINE = path.join(SCRATCH, "bse-fence-baseline.jsonl");

const mode = process.argv.includes("--capture")
  ? "capture"
  : process.argv.includes("--verify")
    ? "verify"
    : process.argv.includes("--prove")
      ? "prove"
      : null;

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? "  — " + detail : ""}`);
}

function printMovements(ms: NamedMovement[], limit = 40): void {
  for (const m of ms.slice(0, limit)) {
    const tag = m.severity === "violation" ? "‼ VIOLATION" : "· notice   ";
    console.log(`   ${tag} ${m.table} ${m.kind.padEnd(12)} ${m.name}`);
    console.log(`               ${m.detail}  [id ${m.rowId}]`);
  }
  if (ms.length > limit) console.log(`   … and ${ms.length - limit} more`);
}

async function main() {
  if (!mode) {
    console.error("pass one of --capture | --verify | --prove");
    process.exit(2);
  }

  // ── CAPTURE ─────────────────────────────────────────────────────────────────
  if (mode === "capture") {
    console.log(`\nCAPTURING baseline → ${BASELINE}`);
    const h = await persistBaseline(prisma, BASELINE);
    const size = statSync(BASELINE).size;
    const totalRows = Object.values(h.totals).reduce((a, b) => a + b, 0);
    const totalNse = Object.values(h.nseTotals).reduce((a, b) => a + b, 0);
    console.log(`  capturedAt ${h.capturedAt}`);
    for (const t of Object.keys(h.totals)) {
      console.log(`    ${t.padEnd(28)} rows ${String(h.totals[t]).padStart(6)}   NSE ${String(h.nseTotals[t]).padStart(6)}`);
    }
    console.log(`    ${"TOTAL".padEnd(28)} rows ${String(totalRows).padStart(6)}   NSE ${String(totalNse).padStart(6)}`);
    console.log(`  file ${(size / 1048576).toFixed(2)} MB, fsync'd`);

    // Re-read it immediately: a baseline that cannot be loaded is not a baseline.
    const back = loadBaseline(BASELINE);
    const loaded = Object.values(back.byTable).reduce((a, m) => a + m.size, 0);
    check(loaded === totalRows, `round-trip: ${loaded} rows read back = ${totalRows} written`);
    check(back.header.capturedAt === h.capturedAt, "round-trip: header preserved");

    // Byte hygiene — the escape-mangling lesson. The SQL predicate needs a literal
    // backslash-underscore; a stray control byte anywhere in the module is the failure
    // mode that typechecks clean and silently matches nothing.
    const src = readFileSync("src/ingestions/quaterly-results/bse/bse-fence-persist.ts");
    const bad: string[] = [];
    for (let i = 0; i < src.length; i++) {
      const b = src[i];
      if (b < 0x09 || (b > 0x0d && b < 0x20)) bad.push(`0x${b.toString(16)} at byte ${i}`);
    }
    check(bad.length === 0, "source carries no raw control bytes", bad.slice(0, 5).join(", "));
    check(src.includes("nse\\\\_%"), "the NSE LIKE predicate survived as backslash-underscore");
  }

  // ── VERIFY ──────────────────────────────────────────────────────────────────
  if (mode === "verify") {
    const base = loadBaseline(BASELINE);
    console.log(`\nVERIFY against baseline captured ${base.header.capturedAt}`);
    const rep = await verifyAgainstPersisted(prisma, base, null);
    for (const t of Object.keys(rep.beforeTotals)) {
      const dTot = rep.afterTotals[t] - rep.beforeTotals[t];
      const dNse = rep.afterNse[t] - rep.beforeNse[t];
      console.log(
        `    ${t.padEnd(28)} rows ${String(rep.beforeTotals[t]).padStart(6)} → ${String(rep.afterTotals[t]).padStart(6)} (${dTot >= 0 ? "+" : ""}${dTot})   NSE ${String(rep.beforeNse[t]).padStart(6)} → ${String(rep.afterNse[t]).padStart(6)} (${dNse >= 0 ? "+" : ""}${dNse})`,
      );
    }
    console.log(`\n  violations: ${rep.violations}   notices: ${rep.notices}`);
    printMovements(rep.movements);
    check(rep.violations === 0, "no NSE row disappeared or moved");
  }

  // ── PROVE ───────────────────────────────────────────────────────────────────
  if (mode === "prove") {
    const base = loadBaseline(BASELINE);
    console.log(`\nPROVE — negative + positive control against the REAL table, rolled back.`);
    console.log(`  baseline captured ${base.header.capturedAt}`);

    // Pick the shape the incident actually took: the OLDEST NSE standalone quarterly row
    // of a stock the cohort will touch. That is precisely what a depth_per_key prune evicts.
    const victimRows = await prisma.$queryRawUnsafe<Array<{ id: string; symbol: string; rd: string; src: string }>>(
      `SELECT q.id, s.symbol, q.report_date::text AS rd, q.source AS src
         FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
        WHERE s.symbol = 'ACC' AND q.result_type = 'standalone' AND q.source LIKE 'nse\\_%'
        ORDER BY q.report_date ASC LIMIT 1`,
    );
    const victim = victimRows[0];
    if (!victim) throw new Error("no ACC standalone NSE quarterly row to use as the negative control");
    const control = await prisma.$queryRawUnsafe<Array<{ id: string; symbol: string; rd: string }>>(
      `SELECT q.id, s.symbol, q.report_date::text AS rd
         FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
        WHERE s.symbol = 'ACC' AND q.result_type = 'standalone' AND q.source LIKE 'nse\\_%'
        ORDER BY q.report_date DESC LIMIT 1`,
    );
    console.log(`  negative control (to be deleted): ${victim.symbol} ${victim.rd.slice(0, 10)} standalone  [${victim.src}]`);
    console.log(`  positive control (untouched):     ${control[0].symbol} ${control[0].rd.slice(0, 10)} standalone`);

    const ROLLBACK = "INTENTIONAL_ROLLBACK";
    let inTx: Awaited<ReturnType<typeof verifyAgainstPersisted>> | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DELETE FROM quarterly_results WHERE id = $1`, victim.id);
        // Verify from INSIDE the transaction — the deletion is only visible here.
        inTx = await verifyAgainstPersisted(tx as unknown as { $queryRawUnsafe: typeof prisma.$queryRawUnsafe }, base, null);
        throw new Error(ROLLBACK);
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
    }

    const rep = inTx as unknown as Awaited<ReturnType<typeof verifyAgainstPersisted>>;
    const named = rep.movements.filter((m) => m.kind === "disappeared" && m.rowId === victim.id);
    console.log(`\n  ── what the fence said ──`);
    printMovements(named);

    check(named.length === 1, "the deleted row was detected exactly once");
    check(named[0]?.severity === "violation", "it was classified a VIOLATION (NSE row)");
    check(
      named[0]?.name.includes(victim.symbol) && named[0]?.name.includes(victim.rd.slice(0, 10)) && named[0]?.name.includes("standalone"),
      "it was NAMED in words, not just by uuid",
      named[0]?.name,
    );
    check(!rep.ok, "the report as a whole is not ok");
    check(
      !rep.movements.some((m) => m.rowId === control[0].id),
      "positive control: the untouched row was NOT flagged",
    );

    // …and the rollback actually rolled back.
    const still = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM quarterly_results WHERE id = $1`,
      victim.id,
    );
    check(Number(still[0].n) === 1, "ROLLED BACK — the row is still there");

    // And a clean verify outside the transaction sees nothing.
    const clean = await verifyAgainstPersisted(prisma, base, null);
    check(clean.violations === 0, "outside the transaction: 0 violations", `${clean.notices} notices`);

    // ── THE TARGETED INVARIANT — an UPDATE on an NSE row, with and without the licence ──
    console.log(`\n  ── the column-fill invariant: targeted vs untargeted ──`);
    const boxT: { untargeted?: Awaited<ReturnType<typeof verifyAgainstPersisted>>; targeted?: Awaited<ReturnType<typeof verifyAgainstPersisted>>; gone?: Awaited<ReturnType<typeof verifyAgainstPersisted>> } = {};
    const runStart = new Date(Date.now() - 60_000);
    try {
      await prisma.$transaction(async (tx) => {
        const c = tx as unknown as { $queryRawUnsafe: typeof prisma.$queryRawUnsafe };
        // Touch a real NSE row the way the column fill does.
        await tx.$executeRawUnsafe(`UPDATE quarterly_results SET updated_at = now() WHERE id = $1`, control[0].id);
        boxT.untargeted = await verifyAgainstPersisted(c, base, runStart);
        boxT.targeted = await verifyAgainstPersisted(c, base, runStart, new Set([control[0].id]));
        // …and a DELETE of that same targeted row must still be a violation.
        await tx.$executeRawUnsafe(`DELETE FROM quarterly_results WHERE id = $1`, victim.id);
        boxT.gone = await verifyAgainstPersisted(c, base, runStart, new Set([control[0].id, victim.id]));
        throw new Error(ROLLBACK);
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
    }
    const u = boxT.untargeted!, g = boxT.targeted!, d = boxT.gone!;
    const uHit = u.movements.find((m) => m.rowId === control[0].id && m.kind === "updated");
    const gHit = g.movements.find((m) => m.rowId === control[0].id && m.kind === "updated");
    check(uHit?.severity === "violation", "an UNTARGETED NSE row that moves is a VIOLATION");
    check(!u.ok && u.touchedSinceStart.quarterly_results === 1, "…and layer (3) counts it", `touched=${u.touchedSinceStart.quarterly_results}`);
    check(gHit?.severity === "notice", "the SAME row, declared targeted, is a notice");
    check(g.ok && g.touchedSinceStart.quarterly_results === 0, "…and layer (3) excludes it, so the run is ok", `touched=${g.touchedSinceStart.quarterly_results}`);
    const dHit = d.movements.find((m) => m.rowId === victim.id && m.kind === "disappeared");
    check(dHit?.severity === "violation", "a DELETE is a violation even when the row is targeted", dHit?.name);
    check(!d.ok, "…so the report is not ok");

    const post = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM quarterly_results WHERE id IN ($1, $2)`, victim.id, control[0].id);
    check(Number(post[0].n) === 2, "ROLLED BACK — both rows still present");
  }

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
