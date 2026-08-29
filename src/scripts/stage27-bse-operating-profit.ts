// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 27 — BACKFILL operating_profit ON THE BSE ROWS, THEN RE-DERIVE THEIR MARGIN. ⚠ --commit.
//
//   npx tsx src/scripts/stage27-bse-operating-profit.ts            # dry
//   npx tsx src/scripts/stage27-bse-operating-profit.ts --commit
//
// ── WHY THESE ROWS ARE BLANK ─────────────────────────────────────────────────────────────────────
// `operating_profit` is a RAW cell — the NSE parsers read it off the filing, and nothing in the
// derive layer computes it (deriveIndAsQuarterly takes operatingProfit as an INPUT and returns
// operatingMargin). The BSE writer's INSERT never named the column, and its header comment listed it
// among the "derived" fields, so nobody looked. MEASURED: 5,180 of 5,222 BSE quarterly rows have no
// operating profit; the 42 that do are the ones a hand-keyed workbook happened to fill.
//
// The visible symptom: a stock whose history is BSE-sourced shows a blank OPM% column, and its
// Margin Trend chart draws the net-margin line across the full history while the operating-margin
// line only begins at the first quarter someone filled by hand.
//
// ── SAME DEFINITION AND SAME GUARD AS THE WRITER ─────────────────────────────────────────────────
// This calls `bseOperatingProfit` — the exact function the writer now uses — so a backfilled row and
// a freshly-written one are computed identically. It is revenue − expenses, and ONLY where the row
// proves expenses is the all-in figure (`pbt = revenue + other_income − expenses`). Rows that fail
// the identity get NULL, not a number derived on a definition their filing does not support.
//
// ⚠ NULL-ONLY. The 42 rows that already carry an operating profit are left exactly as they are.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { bseOperatingProfit } from "../ingestions/quaterly-results/bse/bse-writer.js";
import { reDeriveRow } from "../fill/re-derive.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const n = (v: unknown): number | null => (v == null ? null : Number(v));

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 27 — BSE operating_profit backfill  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const rows = await raw<{ id: string; revenue: string | null; expenses: string | null; other_income: string | null; profit_before_tax: string | null }>(`
    SELECT id, revenue, expenses, other_income, profit_before_tax
      FROM quarterly_results
     WHERE source = 'bse_xbrl' AND operating_profit IS NULL
       AND revenue IS NOT NULL AND expenses IS NOT NULL AND profit_before_tax IS NOT NULL`);

  const plan = rows.map((r) => ({
    id: r.id,
    op: bseOperatingProfit({
      revenue: n(r.revenue), expenses: n(r.expenses), otherIncome: n(r.other_income),
      profitBeforeTax: n(r.profit_before_tax),
      depreciation: null, interest: null, tax: null, netProfit: null,
    }),
  }));
  const ok = plan.filter((p) => p.op !== null);
  const refused = plan.length - ok.length;

  console.log(`\n  BSE rows with no operating_profit and the inputs to compute one: ${rows.length}`);
  console.log(`     computable (the pbt identity holds)      ${ok.length}`);
  console.log(`     REFUSED (expenses is not the all-in one) ${refused}   — these stay NULL, correctly`);

  if (!COMMIT) { console.log(`\n  dry — re-run with --commit.\n`); await prisma.$disconnect(); return; }

  let wrote = 0;
  for (let i = 0; i < ok.length; i += 300) {
    for (const p of ok.slice(i, i + 300))
      wrote += await prisma.$executeRawUnsafe(
        `UPDATE quarterly_results SET operating_profit = $2, updated_at = now()
          WHERE id = $1 AND operating_profit IS NULL`, p.id, p.op);
    process.stdout.write(`\r  writing operating_profit… ${Math.min(i + 300, ok.length)}/${ok.length}`);
  }
  console.log(`\n  wrote ${wrote} operating_profit value(s)`);

  // Now the margin, which is what the chart actually reads. Same re-derive path as everywhere else.
  console.log(`\n  re-deriving operating_margin for those rows…`);
  let derived = 0, failed = 0;
  for (let i = 0; i < ok.length; i++) {
    try { await reDeriveRow(prisma, "QuarterlyResult", ok[i].id); derived++; }
    catch { failed++; }
    if ((i + 1) % 300 === 0 || i === ok.length - 1)
      process.stdout.write(`\r  re-derived ${i + 1}/${ok.length}  ok ${derived} · failed ${failed}      `);
  }

  const after = await raw<{ with_op: number; with_om: number; total: number }>(
    `SELECT count(*)::int total, count(operating_profit)::int with_op, count(operating_margin)::int with_om
       FROM quarterly_results WHERE source = 'bse_xbrl'`);
  console.log(`\n\n  bse_xbrl quarterly rows: ${after[0].total} · with operating_profit ${after[0].with_op} · with operating_margin ${after[0].with_om}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
