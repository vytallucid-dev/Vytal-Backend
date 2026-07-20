// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 1 — GATE 0 RECON (READ-ONLY. Writes NOTHING.)
//
// Verifies the two facts Stage 1 computes are RESOLVABLE from live data, before building:
//   1. NATURE — asset_class populated (all 19k), the ACTUAL commodity-ETF category strings + count,
//      and that an unresolvable category can fall back to basket (conservative).
//   2. ENTITY KEY = isin.slice(0,7) — per population: stocks (attributes NULL, stem at read), bonds
//      (stored issuerStem == slice(0,7) for ALL 356), REIT/InvIT (INE), G-Sec/SGB (IN0-2, disjoint),
//      the issuer-match count, and the unresolved-issuer bonds (own standalone entity, no penalty).
//   + the Stage-0 baselines (5 users' Health/Quality/Signals, 9 table fps, 95 scored-stock fp).
//
//   node_modules/.bin/tsx src/scripts/recon-cv2-stage1-gate0.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { classifyIsin } from "../ingestions/shared/isin-class.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";

const q = <T = any>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

async function fp(table: string) {
  const r = await q(`SELECT COUNT(*)::bigint AS rows,
    COALESCE(SUM(('x'||substr(md5(t::text),1,8))::bit(32)::bigint),0)::bigint AS fingerprint FROM ${table} t`);
  return { table, rows: Number(r[0].rows), fingerprint: Number(r[0].fingerprint) };
}

async function main() {
  // ═══ 1 · NATURE — asset_class populated + the commodity question ═══
  console.log("═══ 1 · NATURE CLASSIFICATION ═══");
  const acDist = await q<{ ac: string; n: number }>(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`);
  const acNulls = (await q<{ n: number; total: number }>(`SELECT count(*) FILTER (WHERE asset_class IS NULL)::int n, count(*)::int total FROM instruments`))[0];
  console.log("asset_class distribution:\n" + j(acDist));
  console.log(`asset_class NULLs: ${acNulls.n} of ${acNulls.total} rows`);

  // The commodity question — READ the live category strings, do not guess the matcher.
  const etfCats = await q<{ category: string | null; n: number }>(
    `SELECT category, count(*)::int n FROM instruments WHERE asset_class='etf' GROUP BY category ORDER BY n DESC`);
  console.log("\nETF category strings (verbatim, all of them):\n" + j(etfCats));
  const commodityMatch = await q<{ category: string | null; n: number }>(
    `SELECT category, count(*)::int n FROM instruments WHERE asset_class='etf'
       AND (category ILIKE '%gold%' OR category ILIKE '%silver%' OR category ILIKE '%commodit%' OR category ILIKE '%precious%')
     GROUP BY category ORDER BY n DESC`);
  const commodityTotal = commodityMatch.reduce((s, r) => s + r.n, 0);
  console.log(`\nCOMMODITY-matching ETFs (gold|silver|commodit|precious): ${commodityTotal} ETFs across categories:\n` + j(commodityMatch));
  const unresolvableEtf = (await q<{ n: number }>(
    `SELECT count(*)::int n FROM instruments WHERE asset_class='etf' AND (category IS NULL OR btrim(category)='')`))[0];
  console.log(`ETFs whose category is NULL/blank (→ must fall back to BASKET, conservative): ${unresolvableEtf.n}`);

  // ═══ 2 · ENTITY KEY = isin.slice(0,7) ═══
  console.log("\n═══ 2 · ENTITY KEY ═══");

  // Stocks — attributes NULL, isin present, instruments.isin == stocks.isin (stem computed at read).
  const stockShape = (await q<any>(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE attributes IS NOT NULL)::int with_attr,
           count(*) FILTER (WHERE isin IS NULL)::int no_isin,
           count(*) FILTER (WHERE isin NOT LIKE 'INE%')::int non_ine
    FROM instruments WHERE asset_class='stock'`))[0];
  const stockIsinMismatch = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM instruments i JOIN stocks s ON s.id=i.stock_id
    WHERE i.asset_class='stock' AND i.isin <> s.isin`))[0];
  console.log("STOCKS: " + j(stockShape) + `  · instruments.isin<>stocks.isin mismatches: ${stockIsinMismatch.n}`);

  // Bonds — issuerStem stored; ASSERT issuerStem == isin.slice(0,7) for EVERY bond.
  const bonds = await q<{ isin: string; stem: string | null; nullreason: string | null; issuer: string | null }>(`
    SELECT isin, attributes->>'issuerStem' stem, attributes->>'issuerNullReason' nullreason, attributes->>'issuer' issuer
    FROM instruments WHERE asset_class='bond'`);
  let stemMismatch = 0, stemNull = 0, classifyDisagree = 0;
  const mismatchExamples: string[] = [];
  for (const b of bonds) {
    const expected = b.isin.slice(0, 7);
    if (b.stem == null) stemNull++;
    else if (b.stem !== expected) { stemMismatch++; if (mismatchExamples.length < 5) mismatchExamples.push(`${b.isin}: stored '${b.stem}' vs slice '${expected}'`); }
    if (classifyIsin(b.isin).issuerStem !== expected) classifyDisagree++;
  }
  console.log(`\nBONDS: ${bonds.length} total`);
  console.log(`  stored issuerStem == isin.slice(0,7): ${bonds.length - stemMismatch - stemNull}/${bonds.length} match · ${stemMismatch} mismatch · ${stemNull} null-stem`);
  console.log(`  classifyIsin(isin).issuerStem disagrees with slice(0,7): ${classifyDisagree}`);
  if (mismatchExamples.length) console.log("  MISMATCH EXAMPLES:\n    " + mismatchExamples.join("\n    "));

  // The issuer matches — bonds whose stem matches a stock we hold in the catalogue.
  const issuerMatch = (await q<{ bonds_matching: number; distinct_issuers: number }>(`
    SELECT count(*)::int bonds_matching, count(DISTINCT substring(b.isin,1,7))::int distinct_issuers
    FROM instruments b
    WHERE b.asset_class='bond'
      AND EXISTS (SELECT 1 FROM stocks s WHERE substring(s.isin,1,7)=substring(b.isin,1,7))`))[0];
  const resolvedByAttr = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND attributes->>'issuer' IS NOT NULL`))[0];
  const issuerExamples = await q<{ isin: string; stem: string; issuer: string; equity_isin: string }>(`
    SELECT b.isin, substring(b.isin,1,7) stem, b.attributes->>'issuer' issuer, s.isin equity_isin
    FROM instruments b JOIN stocks s ON substring(s.isin,1,7)=substring(b.isin,1,7)
    WHERE b.asset_class='bond' AND b.attributes->>'issuer' IS NOT NULL
    ORDER BY b.attributes->>'issuer' LIMIT 8`);
  console.log(`\nISSUER MATCHES (bond stem ↔ a catalogued stock): ${issuerMatch.bonds_matching} bonds across ${issuerMatch.distinct_issuers} issuers`);
  console.log(`  bonds with attributes.issuer resolved (by join): ${resolvedByAttr.n}`);
  console.log("  examples (bond ↔ equity):\n" + j(issuerExamples));

  // Unresolved-issuer bonds — still name-risk, own standalone entity, no penalty.
  const unresolved = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND attributes->>'issuerNullReason'='not_in_our_universe'`))[0];
  const unresolvedStems = (await q<{ n: number }>(`
    SELECT count(DISTINCT substring(isin,1,7))::int n FROM instruments
    WHERE asset_class='bond' AND attributes->>'issuerNullReason'='not_in_our_universe'`))[0];
  console.log(`\nUNRESOLVED-ISSUER BONDS: ${unresolved.n} (each its own standalone entity — ${unresolvedStems.n} distinct stems, aggregate with nothing)`);

  // REIT / InvIT — INE-prefixed, each its own entity.
  const trusts = await q<{ ac: string; n: number; ine: number }>(`
    SELECT asset_class::text ac, count(*)::int n, count(*) FILTER (WHERE isin LIKE 'INE%')::int ine
    FROM instruments WHERE asset_class IN ('reit','invit') GROUP BY 1 ORDER BY 1`);
  console.log("\nREIT/InvIT (name-risk, own stem):\n" + j(trusts));

  // ═══ 3 · NAMESPACE DISJOINTNESS — IN0/IN1/IN2 (gov) can never collide with INE ═══
  console.log("\n═══ 3 · NAMESPACE DISJOINTNESS ═══");
  const govNs = await q<{ ac: string; ns: string; n: number }>(`
    SELECT asset_class::text ac, substring(isin,1,3) ns, count(*)::int n
    FROM instruments WHERE asset_class IN ('gsec','sgb') GROUP BY 1,2 ORDER BY 1,2`);
  console.log("G-Sec/SGB namespaces:\n" + j(govNs));
  // Structural: a government ISIN has a DIGIT at char[2]; an INE has 'E'. So no gov stem can equal an INE stem.
  const govNonDigit = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb') AND substring(isin,3,1) !~ '^[0-9]$'`))[0];
  const stemCollision = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM
      (SELECT DISTINCT substring(isin,1,7) stem FROM instruments WHERE asset_class IN ('gsec','sgb')) g
      JOIN (SELECT DISTINCT substring(isin,1,7) stem FROM instruments WHERE asset_class IN ('stock','bond','reit','invit')) nr
      ON g.stem = nr.stem`))[0];
  console.log(`gov ISINs with a NON-digit at char[2] (must be 0 → all IN0-9): ${govNonDigit.n}`);
  console.log(`gov-stem ↔ name-risk-stem COLLISIONS in the live catalogue (must be 0): ${stemCollision.n}`);

  // ═══ 4 · BASELINES (same guard as Stage 0) ═══
  console.log("\n═══ 4 · BASELINES ═══");
  const fps = [];
  for (const t of ["mf_analytics", "daily_prices", "stock_prices", "score_snapshots",
                   "market_cap_tier_snapshot", "instruments", "instrument_corporate_events",
                   "instrument_prices", "index_prices"]) fps.push(await fp(t));
  console.log("9 table fingerprints:\n" + j(fps));
  const scored = (await q<{ n: number; fp: number }>(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::bigint AS fp
    FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`))[0];
  console.log(`scored stocks: ${scored.n} · fp ${Number(scored.fp)}`);

  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);
  const perUser = [];
  for (const u of users) {
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    perUser.push({ prefix: u.user_id.slice(0, 8), health: r.health, quality: r.quality, signals: r.signals, coverage: Number(r.coverage.toFixed(6)) });
  }
  console.log("per-user Health/Quality/Signals:\n" + j(perUser));
}

main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e); process.exitCode = 1; })
     .finally(() => prisma.$disconnect());
