// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 13 â€” GATE 0 RECON (READ-ONLY). Baseline fingerprints + the overlap/trespass probes.
//
// Writes NOTHING. Establishes the byte-identical baseline Gate 3 will re-measure:
//   504 stocks Â· 2 users Â· 17,567 MF instrument rows Â· every mf_analytics row.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const show = (label: string, rows: any[]) =>
  console.log(label, JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));

console.log("â•â•â• STEP 13 Â· GATE 0 Â· BASELINE (read-only) â•â•â•\n");

show("stocks:              ", await q(`SELECT count(*)::int n FROM stocks`));
show("users:               ", await q(`SELECT count(*)::int n FROM users`));
show("instruments by class:", await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`));
show("mf_analytics rows:   ", await q(`SELECT count(*)::int n, count(rank_bucket)::int ranked FROM mf_analytics`));

console.log("\nâ”€â”€ OVERLAP PROBE 1: the Step-9 trespass guard's own query â”€â”€");
console.log("   (SELECT ... WHERE asset_class <> 'mutual_fund' AND isin LIKE 'INF%')");
console.log("   Today: expect 0. AFTER Step 13 lands 337 etf rows: this returns 337 â†’ a CRITICAL");
console.log("   IngestionError EVERY NIGHT unless the guard is widened to allow 'etf'.");
show("   trespass:", await q(`SELECT isin, symbol, asset_class::text ac, stock_id FROM instruments WHERE asset_class <> 'mutual_fund' AND isin LIKE 'INF%'`));

console.log("\nâ”€â”€ OVERLAP PROBE 2: any fund ISIN already admitted as a bare STOCK? â”€â”€");
show("   stocks with INF isin:", await q(`SELECT id, symbol, isin, name FROM stocks WHERE isin LIKE 'INF%'`));

console.log("\nâ”€â”€ OVERLAP PROBE 3: any ETF ISIN already in the catalogue? (Step 9 excluded them) â”€â”€");
show("   etf-class instruments:", await q(`SELECT count(*)::int n FROM instruments WHERE asset_class = 'etf'`));

console.log("\nâ”€â”€ broker_holdings: what is currently unresolved / how â”€â”€");
show("   holdings:", await q(`SELECT symbol, stock_id, instrument_id FROM broker_holdings ORDER BY symbol`));

console.log("\nâ”€â”€ FINGERPRINT A Â· the 504 stocks â”€â”€");
show("   ", await q(`SELECT count(*)::int n, md5(string_agg(id || '|' || symbol || '|' || isin || '|' || name, ',' ORDER BY id)) AS fp FROM stocks`));

console.log("\nâ”€â”€ FINGERPRINT B Â· the 17,567 MF instrument rows (full AMFI payload) â”€â”€");
show("   ", await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`));

console.log("\nâ”€â”€ FINGERPRINT C Â· every mf_analytics row (every stored metric; computed_at excluded) â”€â”€");
console.log("   THE UN-WAIVABLE ONE. The fold change ADDS ETF scheme codes; this hash must not move.");
show("   ", await q(`
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
  FROM mf_analytics`));

console.log("\nâ”€â”€ The rank buckets in use (ETF leaves must not collide with any of these) â”€â”€");
show("   ", await q(`SELECT count(DISTINCT rank_bucket)::int distinct_buckets FROM mf_analytics WHERE rank_bucket IS NOT NULL`));

await prisma.$disconnect();
