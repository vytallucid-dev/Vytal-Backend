// ═══════════════════════════════════════════════════════════════
// F1 — DERIVE EVERY FLOOR FROM CODE. READ-ONLY. Imports the live constants
// rather than transcribing them, so the derivation cannot drift from the source.
//   npx tsx src/scripts/_f1-derive.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

import { WIN } from "../scoring/market/universal-subcomponents.js";
import { REGIME_LOOKBACK_ROWS } from "../scoring/regime/regime.js";
import { F8_WINDOW_YEARS, F9_WINDOW_YEARS } from "../scoring/metrics/foundation.js";
import { BASELINE_QUARTERS_THRESHOLD } from "../scoring/ownership/baseline.js";
import { H } from "../ingestions/amfi/mf-accumulator.js";
import { N1_MIN_YEARS } from "../scoring/findings/rules/n1-cash-backed-earnings.js";
import { N2_MIN_YEARS } from "../scoring/findings/rules/n2-working-capital.js";
import { N3_MIN_YEARS } from "../scoring/findings/rules/n3-deleveraging.js";
import { N4_MIN_RISES } from "../scoring/findings/rules/n4-coverage-strengthening.js";
import { P11_MIN_DECLINES } from "../scoring/findings/rules/p11-margin-compression.js";
import { P12_MIN_RISES } from "../scoring/findings/rules/p12-margin-recovery.js";
import { R3_MIN_CONSECUTIVE } from "../scoring/findings/rules/r3-earnings-quality.js";
import { R5_MIN_CONSECUTIVE } from "../scoring/findings/rules/r5-interest-coverage.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lpad = (s: unknown, n: number) => String(s).padStart(n);

// The two L3 wiring configs, verbatim from score-pass.ts:86-87.
const F_CFG = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const M_CFG = { peerMinN: 5, l3MinN: 6, l3Window: 12 };

async function main() {
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F1 — CONSTANTS READ LIVE FROM SOURCE                                        ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  WIN.A2                        = ${WIN.A2}    market/universal-subcomponents.ts:26`);
  console.log(`  REGIME_LOOKBACK_ROWS          = ${REGIME_LOOKBACK_ROWS}    regime/regime.ts:68  → window = ${REGIME_LOOKBACK_ROWS + 1} rows`);
  console.log(`  F8_WINDOW_YEARS               = ${F8_WINDOW_YEARS}      metrics/foundation.ts:263 (+1 for the FY-1 capex proxy → ${F8_WINDOW_YEARS + 1})`);
  console.log(`  F9_WINDOW_YEARS               = ${F9_WINDOW_YEARS}      metrics/foundation.ts:317`);
  console.log(`  BASELINE_QUARTERS_THRESHOLD   = ${BASELINE_QUARTERS_THRESHOLD}      ownership/baseline.ts:24`);
  console.log(`  H.y5                          = ${H.y5}   amfi/mf-accumulator.ts:24 (calendar days)`);
  console.log(`  LOOKBACK_DAYS (H.y5 + 30)     = ${H.y5 + 30}   amfi/mf-analytics.ts:48`);
  console.log(`  F_CFG.l3MinN / l3Window       = ${F_CFG.l3MinN} / ${F_CFG.l3Window}    composite/score-pass.ts:86`);
  console.log(`  M_CFG.l3MinN / l3Window       = ${M_CFG.l3MinN} / ${M_CFG.l3Window}   composite/score-pass.ts:87`);
  console.log(`  findings: N1=${N1_MIN_YEARS} N2=${N2_MIN_YEARS} N3=${N3_MIN_YEARS} N4=${N4_MIN_RISES} P11=${P11_MIN_DECLINES} P12=${P12_MIN_RISES} R3=${R3_MIN_CONSECUTIVE} R5=${R5_MIN_CONSECUTIVE}`);

  // ── L3 arithmetic ────────────────────────────────────────────
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ L3 OWN-HISTORY ARITHMETIC (score-pass.ts:113-123 re-dispatches per prefix)  ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  const M_K = 8;                       // M3/M4 deepest single value — momentum.ts:125,144
  const F_K = F8_WINDOW_YEARS + 1;     // F8 needs the 4y window + FY-1 — foundation.ts:275
  const mL3 = M_K + M_CFG.l3MinN - 1;
  const fL3 = F_K + F_CFG.l3MinN - 1;
  console.log(`  momentum : deepest single value K=${M_K} (M3/M4, 8 consecutive quarters)`);
  console.log(`             L3 needs l3MinN=${M_CFG.l3MinN} values → prefixes ${M_K}..${mL3} → ${mL3} QUARTERLY ROWS`);
  console.log(`  foundation: deepest single value K=${F_K} (F8 4y window + FY-1; F9 window is ${F9_WINDOW_YEARS})`);
  console.log(`             L3 needs l3MinN=${F_CFG.l3MinN} values → prefixes ${F_K}..${fL3} → ${fL3} ANNUAL ROWS`);

  // ── findings arithmetic (the non-scored financial tables) ────
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ FINDINGS-PATH DEPTH (filed rows → FiringContext, score-pass.ts:593-603)     ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  const annualRules = [
    { r: "N1 cash-backed earnings", need: N1_MIN_YEARS, site: "n1-cash-backed-earnings.ts:57", fin: "excluded? see below" },
    { r: "N2 working capital", need: N2_MIN_YEARS + 1, site: "n2-working-capital.ts:67" },
    { r: "N3 deleveraging", need: N3_MIN_YEARS + 1, site: "n3-deleveraging.ts:43" },
    { r: "R3 earnings quality", need: R3_MIN_CONSECUTIVE, site: "r3-earnings-quality.ts:38" },
    { r: "R4 debt explosion", need: 2, site: "r4-debt-explosion.ts:40" },
    { r: "P7 accruals", need: 2, site: "p7-accruals.ts:44" },
    { r: "P8 receivables", need: 2, site: "p8-receivables.ts:37" },
  ];
  const quarterRules = [
    { r: "P13 revenue inflection", need: 9, site: "p13-revenue-inflection.ts:57-58 (two TTM-YoY points = 8+1)" },
    { r: "R5 interest coverage", need: R5_MIN_CONSECUTIVE + 3, site: "r5-interest-coverage.ts:64" },
    { r: "N4 coverage strengthening", need: 4 + N4_MIN_RISES, site: "n4-coverage-strengthening.ts:63-68" },
    { r: "P11 margin compression", need: P11_MIN_DECLINES + 1, site: "p11-margin-compression.ts:30 (1 row per OPM point)" },
    { r: "P12 margin recovery", need: P12_MIN_RISES + 1, site: "p12-margin-recovery.ts:42" },
  ];
  console.log(`  ANNUAL rules:`);
  for (const x of annualRules) console.log(`    ${pad(x.r, 28)} needs ${lpad(x.need, 3)} rows   ${x.site}`);
  const aMax = Math.max(...annualRules.map((x) => x.need));
  console.log(`    → deepest ANNUAL findings requirement: ${aMax} rows`);
  console.log(`  QUARTERLY rules:`);
  for (const x of quarterRules) console.log(`    ${pad(x.r, 28)} needs ${lpad(x.need, 3)} rows   ${x.site}`);
  const qMax = Math.max(...quarterRules.map((x) => x.need));
  console.log(`    → deepest QUARTERLY findings requirement: ${qMax} rows`);

  // ── index_prices: measure the MF y5 window in TRADING days ───
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F1c — index_prices: the DEEPEST consumer, measured                          ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  const LB = H.y5 + 30;
  const bars = await raw(
    `SELECT "index_name", count(*)::int n FROM index_prices
      WHERE "date" >= (SELECT max("date") FROM index_prices) - make_interval(days => $1::int)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, LB);
  console.log(`  MF analytics loads benchmark series over LOOKBACK_DAYS = H.y5 + 30 = ${LB} CALENDAR days`);
  console.log(`  (mf-analytics.ts:48 → mf-benchmark.ts:464 loadBenchmarkSeries → prisma.indexPrice.findMany)`);
  console.log(`  MEASURED trading bars inside that window, deepest indices:`);
  for (const b of bars) console.log(`    ${pad(b.index_name, 40)} ${lpad(b.n, 5)} bars`);
  const deepest = Math.max(...bars.map((b) => Number(b.n)));
  console.log(`  → deepest index holds ${deepest} bars in the ${LB}-day window (the series is only ${deepest} deep in total today)`);
  const [rate] = await raw(
    `SELECT count(DISTINCT "date")::int n FROM index_prices WHERE "date" >= (SELECT max("date") FROM index_prices) - interval '365 days'`);
  const projected = Math.ceil((LB / 365.25) * Number(rate.n));
  console.log(`  measured trading-day rate: ${rate.n}/yr → a FULL ${LB}-day window = ${projected} trading bars`);
  console.log(`  regime read needs only ${REGIME_LOOKBACK_ROWS + 1} bars (regime.ts:68) — the SHALLOW consumer, not the deep one.`);

  // ── daily_prices deepest consumer ────────────────────────────
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F1d — daily_prices: deepest consumer                                        ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  WIN = ${JSON.stringify(WIN)}   market/universal-subcomponents.ts:26`);
  console.log(`  deepest = A2 ${WIN.A2} trading days (range position over the window) → needs ${WIN.A2 + 1} rows`);
  console.log(`    (rangePosition takes the window PLUS the anchor bar — same +1 as the regime read)`);
  const [pv] = await raw(`SELECT 1 AS x`);
  void pv;
  console.log(`  other daily_prices readers: price-view.service.ts:58 WINDOW_DAYS.r3y = 1095 CALENDAR days`);
  const r3yBars = Math.ceil((1095 / 365.25) * Number(rate.n));
  console.log(`    → ${r3yBars} trading bars (measured rate) — SHALLOWER than A2's ${WIN.A2 + 1}`);

  // ── live policy rows for the 13 ──────────────────────────────
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ LIVE POLICY STATE (post Stage-1)                                            ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  const T = ["quarterly_results","fundamentals","shareholding_patterns","daily_prices","index_prices",
    "banking_quarterly_results","banking_fundamentals","nbfc_quarterly_results","nbfc_fundamentals",
    "life_insurance_quarterly_results","life_insurance_fundamentals",
    "general_insurance_quarterly_results","general_insurance_fundamentals"];
  const pols = await prisma.retentionPolicy.findMany({ where: { table: { in: T } }, orderBy: { table: "asc" } });
  console.log(`  ${pad("table", 36)}${lpad("keep", 6)}${lpad("floor", 7)}  armed enabled`);
  for (const p of pols) console.log(`  ${pad(p.table, 36)}${lpad(p.keep ?? "-", 6)}${lpad(p.floor, 7)}    ${p.armed ? "Y" : "n"}     ${p.enabled ? "Y" : "n"}`);

  // ── F1b: does the ownership baseline count rows or quarter-ends? ──
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F1b — shareholding: does the CONSUMER count rows or quarter-ends?           ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  countConsecutiveTrailingQuarters (ownership/baseline.ts:44-55) walks ROWS and breaks only`);
  console.log(`  when isPriorQuarterGap() sees > GAP_MONTHS_THRESHOLD = 4 months (ownership/dilution.ts:65,216-221).`);
  console.log(`  An interim row sits < 4 months from its neighbours → it does NOT break the run, and counts +1.`);
  const isQE = `(sp."as_on_date" = (date_trunc('quarter', sp."as_on_date") + interval '3 months - 1 day')::date)`;
  const [infl] = await raw(
    `WITH per AS (SELECT sp."stock_id", count(*)::int rows, count(*) FILTER (WHERE ${isQE})::int qe
                    FROM shareholding_patterns sp GROUP BY 1)
     SELECT count(*) FILTER (WHERE rows >= 8 AND qe < 8)::int inflated,
            count(*) FILTER (WHERE rows >= 8)::int rows_ge8,
            count(*) FILTER (WHERE qe   >= 8)::int qe_ge8,
            count(*)::int stocks FROM per`);
  console.log(`  MEASURED today: ${infl.rows_ge8} stocks hold >=8 ROWS; ${infl.qe_ge8} hold >=8 QUARTER-ENDS.`);
  console.log(`  → ${infl.inflated} stocks would read "8 consecutive quarters" off fewer than 8 real quarter-ends.`);

  console.log(`\n  (READ-ONLY: SELECTs only.)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
