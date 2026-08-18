// ═══════════════════════════════════════════════════════════════
// T2d — DRY-RUN PROOF. NO DATA WRITE.
// Runs the FIXED path end to end — discovery → group → pickFilingsPerBasisV2 →
// fetch XBRL → parse → adapt — and then STOPS. dispatchAnnualIngest /
// dispatchQuarterlyIngest are NEVER called, so nothing is written.
// For each basis it would write, it reports the exact upsert key and whether a
// row already exists on that key (so an overwrite/duplicate is visible).
//
//   npx tsx src/scripts/_t2-dryrun.ts [--quarters-from 2024-04-01]
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  fetchFilingsList,
  fetchXbrlFile,
  groupFilingsByQuarter,
  pickFilingsPerBasisV2,
  pickBestFilingForQuarter,
} from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import {
  parseQuarterlyResultXbrl,
  parseAnnualResultXbrl,
} from "../ingestions/quaterly-results/legacy/parser-legacy-common.js";

const SAMPLE = [
  { symbol: "SIEMENS", why: "both bases every year → expect 2 rows/period" },
  { symbol: "COLPAL", why: "standalone only → expect 1 row/period, behaviour UNCHANGED" },
  { symbol: "SUNPHARMA", why: "mixed → 2 rows most years, 1 for the FY21 period" },
];
// Quarterly leg is restricted to keep the XBRL budget sane; the point is to prove
// the SAME loop serves both legs, not to re-fetch four years of quarters.
const Q_FROM = process.argv.includes("--quarters-from")
  ? process.argv[process.argv.indexOf("--quarters-from") + 1]
  : "2024-04-01";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const parseDdMmmYyyy = (s: string): number => {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return NaN;
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const mi = months.indexOf(m[2].toUpperCase());
  return mi < 0 ? NaN : Date.UTC(parseInt(m[3], 10), mi, parseInt(m[1], 10));
};

let fetches = 0;
const tally = { wouldInsert: 0, wouldUpdateSameBasis: 0, crossBasisCollisions: 0, periods: 0, picks: 0 };

async function leg(symbol: string, stockId: string, period: "Quarterly" | "Annual", fromDate?: string) {
  const all = await fetchFilingsList(symbol, period);
  let filings = all;
  if (fromDate) {
    const fromMs = new Date(fromDate).getTime();
    filings = filings.filter((f) => {
      const ms = parseDdMmmYyyy(f.toDate);
      return Number.isFinite(ms) && ms >= fromMs;
    });
  }
  const byPeriod = groupFilingsByQuarter(filings);
  console.log(`\n  ── ${symbol} · ${period}${fromDate ? ` (period-end >= ${fromDate})` : ""} — ${filings.length} filings, ${byPeriod.size} periods`);
  console.log(`     ${pad("period", 26)}${pad("OLD picker", 14)}${pad("NEW picks", 26)}  would write`);

  for (const [, group] of byPeriod) {
    const from = group[0].fromDate, to = group[0].toDate;
    const old = pickBestFilingForQuarter(group, from, to);
    const picks = pickFilingsPerBasisV2(group, from, to);
    tally.periods++;
    const oldBasis = old ? (old.consolidated === "Consolidated" ? "consolidated" : "standalone") : "-";
    console.log(`     ${pad(`${from}..${to}`, 26)}${pad(oldBasis, 14)}${pad(picks.map((p) => p.basis).join(" + "), 26)}`);

    for (const { filing, basis } of picks) {
      tally.picks++;
      let xml: string;
      try {
        xml = await fetchXbrlFile(filing.xbrl);
        fetches++;
      } catch (e) {
        console.log(`        ✗ ${basis}: XBRL fetch failed — ${(e as Error).message}`);
        continue;
      }
      const meta = { symbol: filing.symbol, xbrl: filing.xbrl, consolidated: filing.consolidated };
      try {
        if (period === "Annual") {
          const v2 = parseAnnualResultXbrl(xml, meta);
          const existing = await prisma.fundamental.findUnique({
            where: { stockId_fiscalYear_resultType: { stockId, fiscalYear: v2.fiscalYear, resultType: v2.resultType } },
            select: { id: true, resultType: true, source: true, revenue: true },
          });
          report("fundamentals", `stockId+${v2.fiscalYear}+${v2.resultType}`, basis, v2.resultType, existing);
        } else {
          const v2 = parseQuarterlyResultXbrl(xml, meta);
          const existing = await prisma.quarterlyResult.findUnique({
            where: { stockId_quarter_fiscalYear_resultType: { stockId, quarter: v2.quarter, fiscalYear: v2.fiscalYear, resultType: v2.resultType } },
            select: { id: true, resultType: true, source: true, revenue: true },
          });
          report("quarterly_results", `stockId+${v2.quarter}+${v2.fiscalYear}+${v2.resultType}`, basis, v2.resultType, existing);
        }
      } catch (e) {
        console.log(`        ✗ ${basis}: parse failed — ${(e as Error).message}`);
      }
      await sleep(400);
    }
  }
}

function report(
  table: string, key: string, pickedBasis: string, parsedBasis: string,
  existing: { id: string; resultType: string; source: string } | null,
) {
  // The basis the picker chose MUST equal the basis the parser derived, or the
  // row would land on the wrong key.
  const basisMatch = pickedBasis === parsedBasis;
  if (!basisMatch) console.log(`        ⚠ BASIS MISMATCH picker=${pickedBasis} parser=${parsedBasis}`);
  if (existing) {
    tally.wouldUpdateSameBasis++;
    if (existing.resultType !== parsedBasis) tally.crossBasisCollisions++;
    console.log(`        ${pad(pickedBasis, 13)} → ${table}[${key}]  EXISTS (id ${existing.id.slice(0, 8)}, result_type=${existing.resultType}, source=${existing.source}) → UPDATE SAME BASIS${existing.resultType !== parsedBasis ? "  ✗ CROSS-BASIS COLLISION" : "  ✓ same basis"}`);
  } else {
    tally.wouldInsert++;
    console.log(`        ${pad(pickedBasis, 13)} → ${table}[${key}]  no row → INSERT NEW  ✓ nothing overwritten`);
  }
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T2d — DRY-RUN. Parses everything, DISPATCHES NOTHING.                     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  dispatchAnnualIngest / dispatchQuarterlyIngest are not imported by this script.`);

  for (const s of SAMPLE) {
    const stock = await prisma.stock.findUnique({ where: { symbol: s.symbol }, select: { id: true, industryType: true } });
    if (!stock) { console.log(`  ${s.symbol}: not in universe`); continue; }
    console.log(`\n═══ ${s.symbol} (${stock.industryType}) — ${s.why}`);
    await leg(s.symbol, stock.id, "Annual");
    await sleep(1500);
    await leg(s.symbol, stock.id, "Quarterly", Q_FROM);
    await sleep(1500);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ TOTALS                                                                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  periods examined:          ${tally.periods}`);
  console.log(`  basis-picks (rows to write): ${tally.picks}   → ratio ${(tally.picks / tally.periods).toFixed(2)} rows/period`);
  console.log(`  would INSERT (no row on that key):        ${tally.wouldInsert}`);
  console.log(`  would UPDATE an existing SAME-BASIS row:  ${tally.wouldUpdateSameBasis}`);
  console.log(`  CROSS-BASIS COLLISIONS (must be 0):       ${tally.crossBasisCollisions} ${tally.crossBasisCollisions === 0 ? "✓" : "✗"}`);
  console.log(`  XBRL documents fetched (read-only):       ${fetches}`);
  console.log(`\n  NO DATA WRITE: no dispatch call was made.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
