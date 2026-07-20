// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 14 â€” GATE 3 VERIFICATION. REIT/InvIT identity (thin tier, priced).
//
// Read-only. Every check is a measurement against the live DB / live source, not a re-assertion
// of what the ingest believed it did.
//
//   npx tsx src/scripts/verify-step14-reit.ts
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
import { prisma } from "../db/prisma.js";
import { foldTtm, parseDeclaredTotal } from "../ingestions/reits/reit-distributions.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "âœ…" : "âŒ"} ${name}${detail ? `  â€” ${detail}` : ""}`);
};
const rule = (s: string) => console.log("\n" + "â•".repeat(78) + "\n" + s + "\n" + "â•".repeat(78));

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("1 Â· BYTE-IDENTICAL â€” the un-waivable baseline (Gate-0 fingerprints)");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Measured at Gate 0, BEFORE any Step-14 write. If any of these moved, Step 14 touched something
// it had no business touching, and nothing else in this report matters.
const BASELINE = {
  stocks: { n: 504, fp: "3add5d41096ac195f51cb15a2a383ab9" },
  mf: { n: 17567, fp: "651f6ba0132b4dc0657e611bb9559969" },
  etf: { n: 337, fp: "dae247ae2c8a1cb7617c783e30085d01" },
  mfAnalytics: { n: 14041, fp: "11b49ebb65962a96f4cc3eaa218971d9" },
};

const fpStocks = (
  await q(`SELECT count(*)::int n, md5(string_agg(id || '|' || symbol || '|' || isin || '|' || name, ',' ORDER BY id)) AS fp FROM stocks`)
)[0];
check(
  `FINGERPRINT A Â· 504 stocks unchanged`,
  fpStocks.n === BASELINE.stocks.n && fpStocks.fp === BASELINE.stocks.fp,
  `${fpStocks.n} rows, ${fpStocks.fp}`,
);

const fundFp = (cls: string) => `
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = '${cls}'`;

const fpMf = (await q(fundFp("mutual_fund")))[0];
check(
  `FINGERPRINT B Â· 17,567 MF rows unchanged`,
  fpMf.n === BASELINE.mf.n && fpMf.fp === BASELINE.mf.fp,
  `${fpMf.n} rows, ${fpMf.fp}`,
);

const fpEtf = (await q(fundFp("etf")))[0];
check(
  `FINGERPRINT B2 Â· 337 ETF rows unchanged`,
  fpEtf.n === BASELINE.etf.n && fpEtf.fp === BASELINE.etf.fp,
  `${fpEtf.n} rows, ${fpEtf.fp}`,
);

const fpAn = (
  await q(`
  SELECT count(*)::int n, md5(string_agg(
    scheme_code || '|' || as_of_date::text || '|' || nav_points::text || '|' ||
    coalesce(window_from::text,'~') || coalesce(window_to::text,'~') || '|' ||
    coalesce(ret_1m::text,'~') || coalesce(ret_3m::text,'~') || coalesce(ret_6m::text,'~') ||
    coalesce(ret_1y::text,'~') || coalesce(ret_3y_cagr::text,'~') || coalesce(ret_5y_cagr::text,'~') ||
    coalesce(vol_1y::text,'~') || coalesce(vol_3y::text,'~') || '|' ||
    coalesce(sharpe_1y::text,'~') || coalesce(sharpe_3y::text,'~') || coalesce(sharpe_5y::text,'~') ||
    coalesce(sortino_1y::text,'~') || coalesce(sortino_3y::text,'~') || '|' ||
    coalesce(max_drawdown_1y::text,'~') || coalesce(max_drawdown_3y::text,'~') || coalesce(max_drawdown_5y::text,'~') || '|' ||
    coalesce(roll_1y_n::text,'~') || coalesce(roll_1y_min::text,'~') || coalesce(roll_1y_max::text,'~') ||
    coalesce(roll_1y_avg::text,'~') || coalesce(roll_1y_pct_positive::text,'~') || '|' ||
    coalesce(rank_bucket,'~') || coalesce(rank_bucket_size::text,'~') || '|' ||
    coalesce(rank_1y::text,'~') || coalesce(rank_3y::text,'~') || coalesce(rank_5y::text,'~') ||
    coalesce(pct_1y::text,'~') || coalesce(pct_3y::text,'~') || coalesce(pct_5y::text,'~') || '|' ||
    coalesce(omissions::text,'~'),
    ',' ORDER BY scheme_code)) AS fp
  FROM mf_analytics`)
)[0];
check(
  `FINGERPRINT C Â· 14,041 mf_analytics rows unchanged`,
  fpAn.n === BASELINE.mfAnalytics.n && fpAn.fp === BASELINE.mfAnalytics.fp,
  `${fpAn.n} rows, ${fpAn.fp}`,
);

check(
  "daily_prices / stock_prices NOT touched by Step 14 (no instrument_id column added)",
  (await q(`SELECT count(*)::int n FROM information_schema.columns
             WHERE table_name IN ('daily_prices','stock_prices') AND column_name = 'instrument_id'`))[0].n === 0,
  "the equity price spine is untouched",
);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("2 Â· LOADED â€” the trust universe, its classes, and its uniqueness");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const byClass = await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments
                          WHERE asset_class IN ('reit','invit') GROUP BY 1 ORDER BY 1`);
console.log(`   classes: ${J(byClass)}`);
const nReit = byClass.find((r) => r.ac === "reit")?.n ?? 0;
const nInvit = byClass.find((r) => r.ac === "invit")?.n ?? 0;
check("REITs loaded (series RR)", nReit > 0, `${nReit}`);
check("InvITs loaded (series IV)", nInvit > 0, `${nInvit}`);

check(
  "every trust has stock_id NULL (held-not-scored BY CONSTRUCTION)",
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit') AND stock_id IS NOT NULL`))[0].n === 0,
);
check(
  "every trust has a symbol (a trust trades â€” unlike an MF, it HAS a ticker)",
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit') AND symbol IS NULL`))[0].n === 0,
);
check(
  "every trust ISIN is INE-prefixed (â†’ cannot trip the AMFI INF% trespass guard)",
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit') AND isin NOT LIKE 'INE%'`))[0].n === 0,
);
check(
  "ISIN unique across the WHOLE catalogue (the spine holds)",
  (await q(`SELECT count(*)::int n FROM (SELECT isin FROM instruments GROUP BY isin HAVING count(*) > 1) x`))[0].n === 0,
);

// The class each trust carries must match the SERIES the source stamped in attributes.
check(
  "asset_class agrees with the source's series (RRâ†’reit, IVâ†’invit) for every row",
  (await q(`SELECT count(*)::int n FROM instruments
             WHERE asset_class IN ('reit','invit')
               AND attributes->>'series' IS NOT NULL
               AND ((attributes->>'series' = 'RR' AND asset_class <> 'reit')
                 OR (attributes->>'series' = 'IV' AND asset_class <> 'invit'))`))[0].n === 0,
);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("3 Â· PRICED â€” the thin tier's key check. A REIT with no price is useless.");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const priced = (
  await q(`SELECT count(*)::int total,
                  count(last_price)::int with_price,
                  count(*) FILTER (WHERE last_price IS NULL)::int no_price
             FROM instruments WHERE asset_class IN ('reit','invit')`)
)[0];
check("EVERY trust carries a last_price", priced.no_price === 0, J(priced));
check(
  "no trust carries a price without the date it belongs to (a stale price shown as live is a lie)",
  (await q(`SELECT count(*)::int n FROM instruments
             WHERE asset_class IN ('reit','invit')
               AND ((last_price IS NULL) <> (last_price_date IS NULL))`))[0].n === 0,
);

const known = await q(
  `SELECT symbol, asset_class::text ac, last_price, last_price_date,
          (SELECT count(*)::int FROM instrument_prices ip WHERE ip.instrument_id = i.id) AS price_rows
     FROM instruments i
    WHERE symbol IN ('EMBASSY','MINDSPACE','INDIGRID','PGINVIT','NHIT')
    ORDER BY symbol`,
);
for (const k of known) {
  console.log(
    `   ${String(k.symbol).padEnd(10)} ${k.ac.padEnd(5)} â‚¹${String(k.last_price).padStart(8)} @ ${k.last_price_date?.toISOString().slice(0, 10)}  (${k.price_rows} price rows)`,
  );
}
check(
  "EMBASSY (a known REIT) is priced from the pipeline",
  known.some((k) => k.symbol === "EMBASSY" && Number(k.last_price) > 0 && k.price_rows > 0),
);
check(
  "MINDSPACE (a known REIT) is priced from the pipeline",
  known.some((k) => k.symbol === "MINDSPACE" && Number(k.last_price) > 0 && k.price_rows > 0),
);

check(
  "instrument_prices has real history (the chart has something to draw)",
  (await q(`SELECT count(*)::int n FROM instrument_prices`))[0].n > 0,
  `${(await q(`SELECT count(*)::int n, count(DISTINCT date)::int days FROM instrument_prices`))[0].n} rows over ${(await q(`SELECT count(DISTINCT date)::int days FROM instrument_prices`))[0].days} sessions`,
);
// This assertion has now been rewritten TWICE by later steps, which is the tell that it was
// asserting the wrong thing. Step 14 wrote "â€¦points at a real TRUST" (true then: the table was
// trust-only). Step 14.5 added ETF prices, so it became "reit/invit/etf". Step 15 added government
// paper, and it broke again.
//
// The INVARIANT was never "which classes are in the table" â€” that list grows every time a new
// asset class learns to trade. It is: **a price row points at a real instrument, and never at a
// STOCK**. Stocks have their own spine (daily_prices / stock_prices) and are never written here.
// Stated that way it cannot rot, and the next class to join needs no edit at all.
check(
  "no price row is orphaned, and no STOCK was ever written to the non-stock price spine",
  (await q(`SELECT count(*)::int n FROM instrument_prices ip
             LEFT JOIN instruments i ON i.id = ip.instrument_id
            WHERE i.id IS NULL OR i.asset_class = 'stock'`))[0].n === 0,
);
check(
  "â€¦and the TRUST rows in it are all still there (14.5 added ETFs, it removed nothing)",
  (await q(`SELECT count(DISTINCT ip.instrument_id)::int n FROM instrument_prices ip
             JOIN instruments i ON i.id = ip.instrument_id
            WHERE i.asset_class IN ('reit','invit')`))[0].n ===
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit')`))[0].n,
);
check(
  "the snapshot equals the newest history row for that trust (no drift between the two stores)",
  (await q(`SELECT count(*)::int n FROM instruments i
             JOIN LATERAL (SELECT close, date FROM instrument_prices ip
                            WHERE ip.instrument_id = i.id ORDER BY date DESC LIMIT 1) p ON true
            WHERE i.asset_class IN ('reit','invit')
              AND (i.last_price <> p.close OR i.last_price_date <> p.date)`))[0].n === 0,
);

// A trust that did not trade today keeps its LAST TRADED session's date â€” honestly stale.
const staleness = await q(
  `SELECT max(last_price_date)::text newest, min(last_price_date)::text oldest,
          count(*) FILTER (WHERE last_price_date < (SELECT max(last_price_date) FROM instruments WHERE asset_class IN ('reit','invit')))::int stale
     FROM instruments WHERE asset_class IN ('reit','invit')`,
);
console.log(`   staleness: ${J(staleness[0])}  â† thinly-traded trusts honestly carry an older date`);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("4 Â· DISTRIBUTION YIELD â€” populated where sourceable, honest-null where not. NEVER fabricated.");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const y = await q(
  `SELECT symbol,
          (attributes->>'distributionYield')::numeric AS yld,
          (attributes->>'distributionPerUnitTtm')::numeric AS ttm,
          (attributes->>'distributionRecords')::int AS recs,
          attributes->>'distributionYieldNullReason' AS null_reason
     FROM instruments WHERE asset_class IN ('reit','invit')
    ORDER BY yld DESC NULLS LAST`,
);
for (const r of y) {
  const pct = r.yld != null ? `${(Number(r.yld) * 100).toFixed(2)}%` : "â€”";
  console.log(
    `   ${String(r.symbol).padEnd(12)} yield=${pct.padStart(7)}  ttm=â‚¹${String(r.ttm ?? "â€”").padStart(6)}  n=${r.recs ?? 0}${r.null_reason ? `   NULL: ${r.null_reason}` : ""}`,
  );
}
check(
  "every yield written is inside the plausible band (0, 30%] â€” no absurd number was stored",
  y.every((r) => r.yld == null || (Number(r.yld) > 0 && Number(r.yld) <= 0.3)),
);
check(
  "every NULL yield carries a REASON (honest-empty, not an ambiguous blank)",
  y.filter((r) => r.yld == null).every((r) => !!r.null_reason),
  `${y.filter((r) => r.yld == null).length} null yields, all with a reason`,
);
check(
  "no yield was fabricated where there is no distribution history",
  y.every((r) => r.yld == null || Number(r.recs) > 0),
);

// THE POISONED-SUM GUARD, proven on the real record that tripped it in production.
const REAL_COMPONENTS_ONLY =
  "Interst Amount - Re 0.69 Per Unit/Dividend - Rs 2.38 Per Unit/ Repayment Of Spv Level Debt - Rs 2.30 Per Unit/ Other Income - Re 0.01 Per Unit";
const REAL_TOTAL_LED =
  "Distribution - Rs 6.50 Per Unit Consisting Of Re 0.14 Per Unit As Interest/ Rs 1.39 Per Unit As Dividend/ Rs 4.97 Per Unit As Repayment Of Spv Level Debt";
// A REAL record (SEITINVIT, 30-Jul-2025) that declares its total with NO currency token. An
// earlier, stricter parser refused this one â€” a FALSE refusal that cost a real trust its yield.
const REAL_NO_CURRENCY_TOTAL =
  "Distribution - 3.04316 Consisting Of Interest Rs 3.04013 Per Unit / Other Income - Rs 0.00303";
// The shape the component-checksum exists to catch: total-led IN SHAPE, but the first number is
// the INTEREST component, not the total. A shape-only parser publishes 2.5 and lies.
const TOTAL_LED_BUT_IS_A_COMPONENT =
  "Distribution - Interest Rs 2.5 Per Unit / Dividend Rs 1.0 Per Unit";

check(
  "parser reads the DECLARED TOTAL from a total-led subject",
  parseDeclaredTotal(REAL_TOTAL_LED).ok &&
    (parseDeclaredTotal(REAL_TOTAL_LED) as any).perUnit === 6.5,
);
check(
  "parser REFUSES a components-only subject (it would otherwise read â‚¹0.69 instead of â‚¹5.38)",
  !parseDeclaredTotal(REAL_COMPONENTS_ONLY).ok,
);
check(
  "parser ACCEPTS a real total declared without a currency token (â‚¹3.04316, checksummed by its components)",
  parseDeclaredTotal(REAL_NO_CURRENCY_TOTAL).ok &&
    (parseDeclaredTotal(REAL_NO_CURRENCY_TOTAL) as any).perUnit === 3.04316,
);
check(
  "COMPONENT CHECKSUM: parser refuses a 'total' that contradicts its own components (2.5 vs 1.0)",
  !parseDeclaredTotal(TOTAL_LED_BUT_IS_A_COMPONENT).ok &&
    (parseDeclaredTotal(TOTAL_LED_BUT_IS_A_COMPONENT) as any).reason === "total_disagrees_with_components",
);
check(
  "a date in the subject is never mistaken for a component (currency-anchored sum)",
  parseDeclaredTotal("Distribution - Rs 5 Per Unit For The Quarter Ended 30 June 2025").ok &&
    (parseDeclaredTotal("Distribution - Rs 5 Per Unit For The Quarter Ended 30 June 2025") as any).perUnit === 5,
);
const poisoned = foldTtm(
  [
    { symbol: "X", series: "RR", subject: REAL_TOTAL_LED, exDate: "30-Apr-2026" },
    { symbol: "X", series: "RR", subject: REAL_COMPONENTS_ONLY, exDate: "11-Feb-2026" },
  ],
  new Date("2026-07-13T00:00:00Z"),
);
check(
  "ONE unparseable in-window record poisons the whole TTM sum â†’ yield NULL, not a low lie",
  !poisoned.ok && (poisoned as any).reason === "unparseable_record",
  poisoned.ok ? "LEAKED A SUM" : `reason=${(poisoned as any).reason}`,
);
const clean = foldTtm(
  [
    { symbol: "X", series: "RR", subject: REAL_TOTAL_LED, exDate: "30-Apr-2026" },
    { symbol: "X", series: "RR", subject: "Distribution - Rs 6.47 Per Unit Consisting Of Interest", exDate: "11-Feb-2026" },
    { symbol: "X", series: "RR", subject: "Annual General Meeting", exDate: "01-Mar-2026" },
    { symbol: "X", series: "RR", subject: REAL_TOTAL_LED, exDate: "05-Aug-2019" }, // out of window
  ],
  new Date("2026-07-13T00:00:00Z"),
);
check(
  "a clean TTM sums ONLY in-window distributions (6.50 + 6.47 = 12.97; AGM and 2019 excluded)",
  clean.ok && (clean as any).perUnitTtm === 12.97,
  clean.ok ? `â‚¹${(clean as any).perUnitTtm}` : "failed",
);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("5 Â· OVERLAP â€” no ISIN double-loaded, no trust sitting as a bare stock");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
check(
  "no trust ISIN exists in `stocks` (a trust in stocks would be SCORED)",
  (await q(`SELECT count(*)::int n FROM stocks s
             JOIN instruments i ON i.isin = s.isin
            WHERE i.asset_class IN ('reit','invit')`))[0].n === 0,
);
check(
  "no trust ISIN is also an MF/ETF/stock instrument row",
  (await q(`SELECT count(*)::int n FROM instruments a JOIN instruments b ON a.isin = b.isin AND a.id <> b.id
            WHERE a.asset_class IN ('reit','invit')`))[0].n === 0,
);
check(
  "the AMFI trespass guard's own query still returns 0 (its predicate is INF%; trusts are INE%)",
  (await q(`SELECT count(*)::int n FROM instruments
             WHERE asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass") AND isin LIKE 'INF%'`))[0].n === 0,
);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("6 Â· HELD-NOT-SCORED â€” a trust flows through as held, never scored");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
check(
  "no trust has a score / peer-group membership (scoring reads `stocks`, which they are not in)",
  (await q(`SELECT count(*)::int n FROM stock_peer_groups spg
             JOIN stocks s ON s.id = spg.stock_id
             JOIN instruments i ON i.isin = s.isin
            WHERE i.asset_class IN ('reit','invit')`))[0].n === 0,
);
check(
  "broker universe-admit routes a trust to held-not-scored (it branches on stock_id IS NULL)",
  (await q(`SELECT count(*)::int n FROM instruments
             WHERE asset_class IN ('reit','invit') AND stock_id IS NULL`))[0].n ===
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit')`))[0].n,
  "every trust qualifies for the stock_id-NULL held-not-scored branch",
);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("7 Â· ERROR FLOW â€” faults recorded, honestly");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const errs = await q(
  `SELECT guard_type::text gt, severity::text sev, target_entity, status::text st, occurrences, observed
     FROM ingestion_errors WHERE cron = 'reit_daily' ORDER BY last_seen_at DESC`,
);
console.log(`   ${errs.length} IngestionError row(s) from cron=reit_daily`);
for (const e of errs) {
  console.log(`   Â· [${e.sev}/${e.gt}] ${e.target_entity ?? "â€”"} Ã—${e.occurrences} â€” ${String(e.observed).slice(0, 110)}`);
}
check(
  "no CRITICAL fault is open (a critical here would mean a rejected/collided load)",
  errs.filter((e) => e.sev === "critical" && e.st === "open").length === 0,
);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("SUMMARY");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
console.log(`\n   ${pass} passed Â· ${fail} failed\n`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
