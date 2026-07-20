// ═══════════════════════════════════════════════════════════════
// HARNESS-REFRESH FINGERPRINT — the no-data-touched proof.
//
// The Step-9 harness refresh is TEST-CODE ONLY. It must not move a single catalogue or analytics
// row. This prints a fingerprint of every table the refresh could conceivably perturb. Run it
// BEFORE the refresh and AFTER; the two outputs must be byte-identical.
//
// (Note: verify-step9-amfi.ts itself performs a WRITE — the fill-bridge test edits one MF's
// currentNav and rolls it back. So this is also the proof that its rollback is complete.)
//   npx tsx src/scripts/recon-harness-refresh-fingerprint.ts
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const line = (k: string, v: unknown) => console.log(`  ${k.padEnd(34)} ${v}`);

console.log("═══ CATALOGUE — per asset class ═══");
for (const r of await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`)) {
  line(r.ac, r.n);
}
line("TOTAL instruments", (await q(`SELECT count(*)::int n FROM instruments`))[0].n);

console.log("\n═══ SPINE FINGERPRINTS ═══");
// The stock fingerprint, exactly as verify-step9 computes it.
const st = (await q(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp, count(*)::int n
  FROM instruments WHERE asset_class='stock'`))[0];
line("stock (step9 expr)", `${st.n} rows  ${st.fp}`);

// The MF SUBSET fingerprint — the full-fidelity one, identical to verify-step13-etf's FP_MF_INSTRUMENTS.
const mf = (await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`))[0];
line("mutual_fund (full fidelity)", `${mf.n} rows  ${mf.fp}`);

const stocks = (await q(`SELECT count(*)::int n, md5(string_agg(id||'|'||symbol||'|'||isin||'|'||name, ',' ORDER BY id)) fp FROM stocks`))[0];
line("stocks table", `${stocks.n} rows  ${stocks.fp}`);

console.log("\n═══ ANALYTICS ═══");
const ana = (await q(`
  SELECT count(*)::int n, count(DISTINCT scheme_code)::int codes,
         md5(string_agg(scheme_code||'|'||COALESCE(ret_1y::text,''),'~' ORDER BY scheme_code)) fp,
         max(computed_at)::text last
  FROM mf_analytics`))[0];
line("mf_analytics", `${ana.n} rows / ${ana.codes} codes  ${ana.fp}`);
line("  last computed_at", ana.last);
const idx = (await q(`SELECT count(*)::int rows, count(DISTINCT index_name)::int names FROM index_prices`))[0];
line("index_prices", `${idx.rows} rows / ${idx.names} indices`);

console.log("\n═══ USER-FACING STATE ═══");
const snaps = (await q(`SELECT count(*)::int n, max(created_at)::text last FROM portfolio_health_snapshot`))[0];
line("portfolio_health_snapshot", `${snaps.n} rows, newest ${snaps.last}`);
const rfe = (await q(`SELECT count(*)::int n FROM raw_field_edits`))[0];
line("raw_field_edits", `${rfe.n} rows   (a harness fill that failed to roll back would show HERE)`);
const ie = (await q(`SELECT count(*)::int n, count(*) FILTER (WHERE status='open')::int open FROM ingestion_errors`))[0];
line("ingestion_errors", `${ie.n} rows (${ie.open} open)`);

await prisma.$disconnect();
