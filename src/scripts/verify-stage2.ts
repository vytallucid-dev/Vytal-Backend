// STAGE 2 VERIFY — the IDCW/split chart. Drives the REAL getFundChart handler. Run AFTER the fold.
import { prisma } from "../db/prisma.js";
import { getFundChart } from "../controllers/ingestion/mf-controllers.js";

const PRE_FOLD_METRIC_FP = 29941187145438; // captured before the Stage-2 fold (split refactor must not move it)
let fails = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { console.log("  ❌ " + m); fails++; };
const q = <T = any>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

/** Drive the real Express handler with a mock req/res; resolve on the first json(). */
function drive(schemeCode: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    let status = 200;
    const res: any = { status(c: number) { status = c; return this; }, json(body: any) { resolve({ status, body }); return this; } };
    Promise.resolve(getFundChart({ params: { schemeCode }, query: {} } as any, res)).catch(reject);
  });
}

async function main() {
  // ── 1. BYTE-IDENTICAL: the split-adjust refactor must not move any existing metric column. ──
  console.log("\n[1] BYTE-IDENTICAL metrics (split refactor)");
  const fp = (await q(`SELECT COALESCE(SUM(('x'||substr(md5((to_jsonb(t) - 'computed_at' - 'series_scheme_code')::text),1,8))::bit(32)::bigint),0)::bigint AS fp FROM mf_analytics t`))[0].fp;
  Number(fp) === PRE_FOLD_METRIC_FP ? ok(`metric fingerprint unchanged (${fp})`) : bad(`metric fp MOVED: ${fp} ≠ ${PRE_FOLD_METRIC_FP}`);

  // ── 2. INVARIANT: non-null returns ⇒ non-null series; declined ⇒ NULL series. ──
  console.log("\n[2] series_scheme_code invariants");
  const inv = (await q(`
    SELECT
      count(*) FILTER (WHERE ret_1y IS NOT NULL AND series_scheme_code IS NULL)::int AS ret_but_no_series,
      count(*) FILTER (WHERE omissions->>'ret_1y' = 'idcw_nav_not_total_return' AND series_scheme_code IS NOT NULL)::int AS declined_but_series,
      count(series_scheme_code)::int AS series_filled,
      count(*) FILTER (WHERE series_scheme_code IS NULL)::int AS series_null,
      count(*) FILTER (WHERE series_scheme_code <> scheme_code)::int AS twin_inherited
    FROM mf_analytics`))[0];
  inv.ret_but_no_series === 0 ? ok(`every row with a return has a series (${inv.series_filled} filled)`) : bad(`${inv.ret_but_no_series} rows have returns but NULL series`);
  inv.declined_but_series === 0 ? ok(`every declined row has NULL series (${inv.series_null} null → declines)`) : bad(`${inv.declined_but_series} declined rows still carry a series`);
  ok(`inherited-from-twin rows: ${inv.twin_inherited}`);

  // ── 3. 109446 (IDCW) → draws 109445 (its Growth twin). ──
  console.log("\n[3] scheme 109446 (IDCW) draws its Growth twin");
  const r = await drive("109446");
  const d = r.body?.data;
  d?.via === "growth_twin" && d?.seriesSchemeCode === "109445"
    ? ok(`via=growth_twin, seriesSchemeCode=109445; drew ${d.points?.length} pts, first ${d.points?.[0]?.date}=${d.points?.[0]?.nav}, last ${d.points?.at(-1)?.date}=${d.points?.at(-1)?.nav}`)
    : bad(`109446 wrong: ${JSON.stringify({ status: r.status, via: d?.via, series: d?.seriesSchemeCode })}`);

  // ── 4. A split ETF → cliff removed. ──
  console.log("\n[4] a split ETF loses its cliff");
  const splitEtf = await q(`
    SELECT i.amfi_scheme_code AS code, i.name FROM instrument_corporate_events e
    JOIN instruments i ON i.id=e.instrument_id
    WHERE e.event_type='split' AND i.amfi_scheme_code IS NOT NULL LIMIT 1`);
  if (splitEtf.length === 0) bad("no split ETF found");
  else {
    const code = splitEtf[0].code;
    const r4 = await drive(code);
    const d4 = r4.body?.data;
    // raw ratio across the whole series vs adjusted ratio — a 1:10 raw shows a ~10x max/min step.
    const navs = (d4?.points ?? []).map((p: any) => Number(p.nav)).filter((n: number) => n > 0);
    const ratio = navs.length ? Math.max(...navs) / Math.min(...navs) : 0;
    d4?.splitAdjusted === true && d4?.via === "self"
      ? ok(`${splitEtf[0].name} (${code}): splitAdjusted=true, via=self, adjusted max/min=${ratio.toFixed(2)}x (a raw 1:10 would be ~10x)`)
      : bad(`split ETF ${code} not adjusted: ${JSON.stringify({ via: d4?.via, splitAdjusted: d4?.splitAdjusted })}`);
  }

  // ── 5. A twinless IDCW → 200 decline, idcw_nav_not_total_return, NOT 503. ──
  console.log("\n[5] a twinless IDCW declines (200, reason) — not 503");
  const twinless = await q(`SELECT scheme_code FROM mf_analytics WHERE series_scheme_code IS NULL AND omissions->>'ret_1y'='idcw_nav_not_total_return' LIMIT 1`);
  if (twinless.length === 0) bad("no twinless-IDCW scheme found");
  else {
    const r5 = await drive(twinless[0].scheme_code);
    r5.status === 200 && r5.body?.data?.declined === true && r5.body?.data?.reason === "idcw_nav_not_total_return"
      ? ok(`${twinless[0].scheme_code}: 200 declined, reason=idcw_nav_not_total_return (not 503)`)
      : bad(`twinless decline wrong: ${JSON.stringify({ status: r5.status, body: r5.body?.data })}`);
  }

  // ── 6. A Growth mutual fund → via=self, no split adjustment (byte-identical shape). ──
  console.log("\n[6] a Growth mutual fund: via=self, splitAdjusted=false");
  const growth = await q(`
    SELECT a.scheme_code FROM mf_analytics a
    JOIN mf_family_members mm ON mm.scheme_code=a.scheme_code
    JOIN mf_families f ON f.id=mm.family_id
    WHERE f.asset_class='mutual_fund' AND a.ret_1y IS NOT NULL AND a.series_scheme_code=a.scheme_code
      AND lower(coalesce(mm.plan_option,mm.scheme_name)) ~ 'growth' LIMIT 1`);
  if (growth.length === 0) bad("no growth MF found");
  else {
    const r6 = await drive(growth[0].scheme_code);
    const d6 = r6.body?.data;
    d6?.via === "self" && d6?.splitAdjusted === false && d6?.seriesSchemeCode === growth[0].scheme_code
      ? ok(`${growth[0].scheme_code}: via=self, splitAdjusted=false, ${d6.points?.length} pts (raw pass-through)`)
      : bad(`growth MF wrong: ${JSON.stringify({ via: d6?.via, splitAdjusted: d6?.splitAdjusted })}`);
  }

  // ── 7. Unknown scheme → 404. ──
  console.log("\n[7] unknown scheme → 404");
  const r7 = await drive("999999999");
  r7.status === 404 ? ok("unknown scheme → 404 (distinct from decline and 503)") : bad(`unknown scheme status ${r7.status}`);

  console.log(fails === 0 ? "\n✅ STAGE 2 PASS" : `\n❌ ${fails} FAILED`);
  process.exitCode = fails === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
