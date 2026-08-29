// ═══════════════════════════════════════════════════════════════
// STAGE 4 AUDIT — which stocks lack ANNUAL fundamentals back to FY2019, and
// which lack quarterly results? Read-only.
//
//   npx tsx src/scripts/stage4-fundamentals-audit.ts
//
// The plan says "~80 gap stocks" and "~11 of 43 missing 2019 annuals servable".
// Both numbers predate this session, so measure before fetching. Four tables hold
// the answer, split by industry: non-financials in fundamentals / quarterly_results,
// banks in banking_fundamentals / banking_quarterly_results.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const OUT = "_s4-fundamentals-audit.json";
/** FY2019 = year ending 31-Mar-2019 in this codebase's "FY19" convention. */
const TARGET_FY = 19;

const fyNum = (fy: string): number => Number(fy.replace(/^FY/i, ""));

async function main(): Promise<void> {
  const stocks = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, symbol, "industryType" it FROM stocks WHERE is_active = true ORDER BY symbol`,
  );
  const byId = new Map(stocks.map((s) => [String(s.id), { symbol: String(s.symbol), it: String(s.it ?? "non_financial") }]));

  // ── annual coverage across ALL FIVE annual tables ──
  // Looking at only fundamentals + banking_fundamentals reports 62 stocks as
  // having "no annual rows", but most of those are NBFCs and insurers whose data
  // lives in nbfc_/life_insurance_/general_insurance_fundamentals. Those belong to
  // Stages 5 and 7; counting them here would invent a Stage 4 gap that is not one.
  const annual = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT stock_id, fiscal_year, 'fundamentals' AS src FROM fundamentals
     UNION ALL SELECT stock_id, fiscal_year, 'banking_fundamentals' FROM banking_fundamentals
     UNION ALL SELECT stock_id, fiscal_year, 'nbfc_fundamentals' FROM nbfc_fundamentals
     UNION ALL SELECT stock_id, fiscal_year, 'life_insurance_fundamentals' FROM life_insurance_fundamentals
     UNION ALL SELECT stock_id, fiscal_year, 'general_insurance_fundamentals' FROM general_insurance_fundamentals`,
  );
  const annualBy = new Map<string, Set<number>>();
  const annualSrc = new Map<string, string>();
  for (const r of annual) {
    const id = String(r.stock_id);
    if (!annualBy.has(id)) annualBy.set(id, new Set());
    annualBy.get(id)!.add(fyNum(String(r.fiscal_year)));
    annualSrc.set(id, String(r.src));
  }

  // ── quarterly coverage, both tables ──
  const q = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    // ::date::text, NOT ::text — report_date is a timestamp, so a bare cast yields
    // "2026-06-30 00:00:00" and never matches a "2026-06-30" expected set.
    // count(DISTINCT qe) too: quarterly_results is DUAL-BASIS (standalone +
    // consolidated), so count(*) double-counts every quarter.
    `SELECT stock_id, min(qe)::date::text mn, max(qe)::date::text mx,
            count(DISTINCT qe)::int n,
            array_agg(DISTINCT qe::date::text ORDER BY qe::date::text) qs
     FROM (SELECT stock_id, report_date qe FROM quarterly_results
           UNION ALL SELECT stock_id, report_date qe FROM banking_quarterly_results
           UNION ALL SELECT stock_id, report_date qe FROM nbfc_quarterly_results
           UNION ALL SELECT stock_id, report_date qe FROM life_insurance_quarterly_results
           UNION ALL SELECT stock_id, report_date qe FROM general_insurance_quarterly_results) u
     GROUP BY stock_id`,
  );
  const qBy = new Map(q.map((r) => [String(r.stock_id), r]));

  // ── LISTING EVIDENCE ──
  // "Earliest FY held is FY24" means nothing on its own: the stock may have LISTED
  // in FY24. Stage 3 put daily prices back to 2019-01-01 for every stock that has
  // them, so the first PRICE bar is a real listing proxy. A stock trading well
  // before its first filing has a genuine data gap; one whose prices start at the
  // same time does not. Without this the audit reports recent IPOs as Stage 4 work.
  const firstBar = new Map<string, string>();
  for (const r of await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT stock_id, min(date)::text mn FROM daily_prices GROUP BY stock_id`,
  )) firstBar.set(String(r.stock_id), String(r.mn));
  /** FY label for a calendar date: Indian FY ends 31-Mar, so Apr-2023 is FY24. */
  const fyOf = (iso: string): number => {
    const [y, m] = iso.split("-").map(Number);
    return (m >= 4 ? y + 1 : y) % 100;
  };

  interface Row {
    symbol: string; industry: string; table: string;
    annualYears: number[]; earliestFy: number | null; reachesTarget: boolean;
    missingFys: number[];
    quarters: number; qEarliest: string | null; qLatest: string | null;
    firstPriceBar: string | null; listedFy: number | null; tradedBeforeFirstFiling: boolean;
    qList: string[]; qGenuineGap: boolean; qMissing: string[];
  }
  const rows: Row[] = [];
  for (const s of stocks) {
    const id = String(s.id);
    const info = byId.get(id)!;
    const years = [...(annualBy.get(id) ?? new Set<number>())].sort((a, b) => a - b);
    const earliest = years.length ? years[0] : null;
    // Which FYs between the target and the newest held are absent?
    const newest = years.length ? years[years.length - 1] : null;
    // Holes are only counted INSIDE the stock's own span. Years before its first
    // filing are pre-listing, not gaps — treating them as gaps is what made the
    // first pass report ~1,000 units instead of the real number.
    const missing: number[] = [];
    if (earliest !== null && newest !== null)
      for (let fy = earliest; fy <= newest; fy++) if (!years.includes(fy)) missing.push(fy);
    const qq = qBy.get(id);
    const fb = firstBar.get(id) ?? null;
    // Prices floor at 2019-01-01 (Stage 3), so a first bar AT the floor tells us
    // only "listed on or before 2019" — which is exactly what we need to know.
    const listedFy = fb ? fyOf(fb) : null;
    const tradedBeforeFirstFiling = listedFy !== null && earliest !== null && listedFy < earliest;
    rows.push({
      symbol: info.symbol, industry: info.it, table: annualSrc.get(id) ?? "-",
      firstPriceBar: fb, listedFy, tradedBeforeFirstFiling,
      annualYears: years, earliestFy: earliest,
      reachesTarget: earliest !== null && earliest <= TARGET_FY,
      missingFys: missing,
      quarters: qq ? Number(qq.n) : 0,
      qEarliest: qq ? String(qq.mn) : null,
      qLatest: qq ? String(qq.mx) : null,
      qList: qq ? (qq.qs as string[]) : [],
      qGenuineGap: false, qMissing: [],
    });
  }

  const noAnnual = rows.filter((r) => r.earliestFy === null);
  const reach = rows.filter((r) => r.reachesTarget);
  const short = rows.filter((r) => r.earliestFy !== null && !r.reachesTarget);
  const holed = rows.filter((r) => r.missingFys.length > 0);

  console.log(`\n=== STAGE 4 AUDIT — annual fundamentals vs FY${TARGET_FY} ===\n`);
  console.log(`  active stocks                 ${rows.length}`);
  console.log(`  no annual rows at all         ${noAnnual.length}`);
  console.log(`  reach FY${TARGET_FY} or earlier         ${reach.length}`);
  console.log(`  short of FY${TARGET_FY}                 ${short.length}   <- the Stage 4 target`);
  console.log(`  have INTERNAL FY holes        ${holed.length}   (missing a year inside their own span)`);

  const byIndustry = new Map<string, number>();
  for (const r of short) byIndustry.set(r.industry, (byIndustry.get(r.industry) ?? 0) + 1);
  console.log(`\n  short, by industryType: ${[...byIndustry].map(([k, v]) => `${k}:${v}`).join("  ")}`);

  // ── STAGE 4 SCOPE — THE WHOLE UNIVERSE, ANNUAL *AND* QUARTERLY ──
  // Every industryType is in scope: non_financial, banking, nbfc, life_insurance,
  // general_insurance. The goal is a stock that is genuinely complete on BOTH
  // grains back to the target.
  //
  // "Genuine" is decided by EVIDENCE, not by the calendar: a stock that was
  // TRADING before its first filing has a real gap; one whose prices begin
  // alongside its filings is simply younger than the target. Stage 3 put daily
  // prices back to 2019-01-01, which is what makes that test possible.
  const unitsFor = (r: Row): number => r.earliestFy! - Math.max(TARGET_FY, r.listedFy ?? TARGET_FY);

  // ── quarterly gap analysis ──
  // Expected quarter-ends from max(target, listing) to the newest the stock holds.
  const Q_TARGET = "2019-03-31";
  const qEnds = (fromIso: string, toIso: string): string[] => {
    const out: string[] = [];
    let [y, m] = fromIso.split("-").map(Number);
    // advance to the first quarter-end on/after `from`
    let qi = Math.ceil(m / 3) - 1;
    for (;;) {
      const d = `${y}-${["03-31", "06-30", "09-30", "12-31"][qi]}`;
      if (d > toIso) break;
      if (d >= fromIso) out.push(d);
      qi += 1;
      if (qi > 3) { qi = 0; y += 1; }
    }
    return out;
  };
  for (const r of rows) {
    if (!r.qList.length) { r.qGenuineGap = true; r.qMissing = []; continue; }
    // A stock cannot be missing quarters before it listed.
    const from = r.firstPriceBar && r.firstPriceBar > Q_TARGET ? r.firstPriceBar : Q_TARGET;
    const held = new Set(r.qList);
    const expect = qEnds(from, r.qLatest!);
    r.qMissing = expect.filter((d) => !held.has(d));
    r.qGenuineGap = r.qMissing.length > 0;
  }

  const genuineAnnual = rows.filter((r) => r.tradedBeforeFirstFiling || r.missingFys.length > 0);
  const genuineQuarterly = rows.filter((r) => r.qGenuineGap);
  const needWork = new Set([...genuineAnnual.map((r) => r.symbol), ...genuineQuarterly.map((r) => r.symbol)]);
  const cleanBoth = rows.filter((r) => !needWork.has(r.symbol));

  const annualUnits =
    rows.filter((r) => r.tradedBeforeFirstFiling).reduce((a, r) => a + unitsFor(r), 0) +
    rows.reduce((a, r) => a + r.missingFys.length, 0);
  const quarterlyUnits = genuineQuarterly.reduce((a, r) => a + r.qMissing.length, 0);

  console.log(`
  == STAGE 4 SCOPE — WHOLE UNIVERSE, BOTH GRAINS ==`);
  console.log(`     stocks GENUINELY COMPLETE on both grains   ${cleanBoth.length} / ${rows.length}   <- the sweet spot`);
  console.log(`     stocks needing work                        ${needWork.size}`);
  console.log(`       with an ANNUAL gap                       ${genuineAnnual.length}`);
  console.log(`       with a QUARTERLY gap                     ${genuineQuarterly.length}`);
  console.log(`     ANNUAL units to attempt                    ${annualUnits}`);
  console.log(`     QUARTERLY units to attempt                 ${quarterlyUnits}`);
  console.log(`     TOTAL units                                ${annualUnits + quarterlyUnits}`);

  const byInd = new Map<string, number>();
  for (const r of rows) if (needWork.has(r.symbol)) byInd.set(r.industry, (byInd.get(r.industry) ?? 0) + 1);
  console.log(`
     needing work by industryType: ${[...byInd].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);

  console.log(`
     -- worst 30 by total units --`);
  const scored = rows
    .filter((r) => needWork.has(r.symbol))
    .map((r) => ({ r, u: (r.tradedBeforeFirstFiling ? unitsFor(r) : 0) + r.missingFys.length + r.qMissing.length }))
    .sort((a, b) => b.u - a.u);
  for (const { r, u } of scored.slice(0, 30))
    console.log(
      `        ${r.symbol.padEnd(13)} ${r.industry.padEnd(18)} units=${String(u).padStart(3)}` +
        `  annual: from FY${r.earliestFy}${r.missingFys.length ? ` holes FY${r.missingFys.join(",FY")}` : ""}` +
        `  quarterly: ${r.quarters} held${r.qMissing.length ? `, missing ${r.qMissing.length}` : ""}`,
    );

  writeFileSync("_s4-targets.json", JSON.stringify({
    generatedAt: new Date().toISOString(), targetFy: TARGET_FY, qTarget: Q_TARGET,
    targets: scored.map(({ r, u }) => ({
      symbol: r.symbol, industry: r.industry, units: u,
      annualFrom: r.earliestFy, annualHoles: r.missingFys,
      annualExtendTo: r.tradedBeforeFirstFiling ? Math.max(TARGET_FY, r.listedFy ?? TARGET_FY) : null,
      quarterlyMissing: r.qMissing, listedFy: r.listedFy, firstPriceBar: r.firstPriceBar,
    })),
  }, null, 2));
  console.log(`
     targets -> _s4-targets.json`);

  // ── quarterly side ──
  const noQ = rows.filter((r) => r.quarters === 0);
  console.log(`\n  -- QUARTERLY --`);
  console.log(`     stocks with no quarterly rows: ${noQ.length}${noQ.length ? ` (${noQ.map((r) => r.symbol).slice(0, 20).join(", ")})` : ""}`);
  const qEarly = rows.filter((r) => r.qEarliest && r.qEarliest > "2019-03-31");
  console.log(`     stocks whose quarterly series starts after 2019-03-31: ${qEarly.length}`);

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), targetFy: TARGET_FY, rows }, null, 2));
  console.log(`\n  detail -> ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
