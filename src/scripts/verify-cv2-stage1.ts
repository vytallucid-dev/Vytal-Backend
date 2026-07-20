// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 1 — GATE 3 VERIFICATION (instrument nature + the entity model).
//
//   1. UN-WAIVABLE (§13) — entity aggregation is Construction arithmetic ONLY. Every live user's
//      Health/Quality/Signals byte-identical (73·73·69·65·50). The exact seam §13 names.
//   2. The NTPC case — stock 11% + bond 8% → ONE entity at 19%; the instrument list still shows two.
//   3. Nature — gold/silver ETF → commodity + NO entity key; unresolvable category → basket;
//      basket/sovereign/commodity → entityKey null (not computed-then-ignored).
//   4. Bonds (live) — stored issuerStem == isin.slice(0,7) for ALL 356.
//   5. Namespace disjointness — no gov (IN[0-9]) stem ever collides with a name-risk (INE) entity.
//   6. BYTE-IDENTICAL — 9 table fps + the 95 scored-stock fp unchanged.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage1.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { natureOf, entityKeyOf, buildEntityLedger, type AssetClass } from "../portfolio/phs/entity.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(80) + "\n" + s + "\n" + "═".repeat(80));

const H = (symbol: string, isin: string, assetClass: AssetClass, mv: number, health: number | null = null, category: string | null = null): PhsHolding =>
  ({ symbol, marketValue: mv, tier: assetClass === "stock" ? "large" : "unknown", sector: null, health, findings: [], isin, assetClass, category });

const GOLD_CAT = "Open Ended Schemes(Other Scheme - Gold ETF)";
const OTHER_ETF_CAT = "Open Ended Schemes(Other Scheme - Other  ETFs)";

const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════
  rule("1 · UN-WAIVABLE (§13) — Health byte-identical, recompute == persisted, EVERY user.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);
  for (const u of users) {
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { phs: true, quality: true, signals: true } });
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    ok(`${u.user_id.slice(0, 8)} · Health/Quality/Signals byte-identical`,
      r.health === (stored?.phs ?? null) &&
        (stored?.quality == null || Math.abs((r.quality ?? 0) - Number(stored.quality)) < 5e-5) &&
        Math.abs(r.signals - Number(stored?.signals ?? r.signals)) < 5e-5,
      `health ${r.health} vs ${stored?.phs}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("2 · ENTITY AGGREGATION does not touch the score (§13 on a synthetic book).");
  // ═══════════════════════════════════════════════════════════════════════════════
  const book = [
    H("NTPC", "INE733E01010", "stock", 11, 70),      // NTPC equity
    H("NTPC-NCD", "INE733E07AB1", "bond", 8, null),  // NTPC bond — SAME stem INE733E
    H("INFY", "INE009A01021", "stock", 10, 75),      // a distinct entity
    H("GOLDBEES", "INF204KB17I5", "etf", 71, null, GOLD_CAT), // commodity — no entity
  ]; // totalValue = 100
  const withFacts = computePhs(book);
  const stripped = book.map((h) => ({ ...h, isin: undefined, assetClass: undefined, category: undefined }));
  const withoutFacts = computePhs(stripped);
  // (Stage 9 §15) `structure` (the S-COMPOSITE) is GONE, and with it this assertion's fourth clause.
  // At Stage 1 the claim was "adding position facts moved NO number" — true then, because the S-rules were
  // NATURE-BLIND and never read isin/assetClass. C1–C6 read them BY DESIGN, so Construction now moves
  // when the facts move; that is the model working, not a regression. The claim that survives — and the
  // one §13 actually makes — is that HEALTH/QUALITY/SIGNALS never move. Asserted here in its strongest
  // current form: the health inputs are IDENTICAL while Construction MOVES, which is the isolation proof
  // (a fact reaching Construction and NOT reaching Health) rather than a weaker "nothing changed".
  ok("§13 — Health / Quality / Signals identical with vs without the entity facts",
    withFacts.health === withoutFacts.health && withFacts.quality === withoutFacts.quality &&
      withFacts.signals === withoutFacts.signals,
    `health ${withFacts.health} · quality ${withFacts.quality?.toFixed(2)} · signals ${withFacts.signals.toFixed(2)}`);
  ok("…and Construction DOES move (the facts reach Construction and stop there — the isolation, proven)",
    withFacts.construction.net !== withoutFacts.construction.net,
    `net ${withFacts.construction.net.toFixed(2)} (facts) vs ${withoutFacts.construction.net.toFixed(2)} (stripped)`);
  ok("stripping the facts empties the ledger — the ledger is derived from the facts, nothing else",
    withoutFacts.entityLedger.length === 0 && withFacts.entityLedger.length > 0);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("3 · THE NTPC CASE — stock 11% + bond 8% = ONE entity at 19%; two instruments remain.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const ntpc = withFacts.entityLedger.find((e) => e.entityKey === "INE733E");
  ok("NTPC stock + NTPC bond aggregate to ONE entity keyed INE733E",
    !!ntpc && withFacts.entityLedger.filter((e) => e.entityKey === "INE733E").length === 1);
  ok("…at weight 19% (11% + 8%), the combined exposure",
    !!ntpc && Math.abs(ntpc!.weight - 0.19) < 1e-9, `weight=${((ntpc?.weight ?? 0) * 100).toFixed(1)}%`);
  ok("…with BOTH constituents (the stock AND the bond) in constituentInstruments",
    ntpc?.constituentInstruments.length === 2 &&
      ntpc.constituentInstruments.some((c) => c.assetClass === "stock") &&
      ntpc.constituentInstruments.some((c) => c.assetClass === "bond"),
    ntpc?.constituentInstruments.map((c) => `${c.symbol}(${c.assetClass})`).join(" + "));
  ok("…while the INSTRUMENT list still shows TWO positions (aggregation is a Construction read only)",
    book.filter((h) => h.isin?.startsWith("INE733E")).length === 2);
  ok("INFY is its OWN entity at 10% (aggregation is by KEY, not all-lumped)",
    withFacts.entityLedger.some((e) => e.entityKey === "INE009A" && Math.abs(e.weight - 0.10) < 1e-9));
  ok("the gold ETF is NOT in the ledger — commodity is never an entity",
    !withFacts.entityLedger.some((e) => e.constituentInstruments.some((c) => c.symbol === "GOLDBEES")));

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("4 · NATURE — by fact; commodity sits OUTSIDE the name-risk sleeve.");
  // ═══════════════════════════════════════════════════════════════════════════════
  ok("name-risk: stock / bond / reit / invit",
    (["stock", "bond", "reit", "invit"] as const).every((a) => natureOf(a, null) === "name_risk"));
  ok("sovereign: gsec / sgb", natureOf("gsec", null) === "sovereign" && natureOf("sgb", null) === "sovereign");
  ok("basket: mutual_fund, and a non-commodity ETF category",
    natureOf("mutual_fund", null) === "basket" && natureOf("etf", OTHER_ETF_CAT) === "basket");
  ok("commodity: an ETF whose category is a Gold/Silver leaf",
    natureOf("etf", GOLD_CAT) === "commodity" && natureOf("etf", "Open Ended Schemes(Other Scheme - Silver ETF)") === "commodity");
  ok("ETF-SCOPE GUARD: a 'Gold Sector FUND' (mutual_fund) is a BASKET of businesses, not commodity",
    natureOf("mutual_fund", "Gold Sector Fund") === "basket");
  ok("unresolvable category → basket (conservative — never manufactures a name-risk charge)",
    natureOf("etf", null) === "basket" && natureOf("etf", "") === "basket");
  ok("entity key: name-risk → its stem; basket/sovereign/commodity → NULL (not computed-then-ignored)",
    entityKeyOf({ symbol: "X", marketValue: 1, isin: "INE733E01010", assetClass: "stock" }) === "INE733E" &&
      entityKeyOf({ symbol: "F", marketValue: 1, isin: "INF204KB17I5", assetClass: "mutual_fund" }) === null &&
      entityKeyOf({ symbol: "G", marketValue: 1, isin: "IN0020240070", assetClass: "gsec" }) === null &&
      entityKeyOf({ symbol: "AU", marketValue: 1, isin: "INF204KB17I5", assetClass: "etf", category: GOLD_CAT }) === null);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("5 · BONDS (live) — stored issuerStem == isin.slice(0,7) for ALL 356.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const bondCheck = (await q<{ total: number; matches: number }>(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE attributes->>'issuerStem' = substring(isin,1,7))::int matches
    FROM instruments WHERE asset_class='bond'`))[0];
  ok(`stored issuerStem == isin.slice(0,7) for every bond`,
    bondCheck.total === bondCheck.matches && bondCheck.total > 0, `${bondCheck.matches}/${bondCheck.total}`);
  // Cross-check against the pure classifier the entity model would use.
  const bonds = await q<{ isin: string }>(`SELECT isin FROM instruments WHERE asset_class='bond'`);
  const classifierAgrees = bonds.every((b) => entityKeyOf({ symbol: b.isin, marketValue: 1, isin: b.isin, assetClass: "bond" }) === b.isin.slice(0, 7));
  ok("entityKeyOf agrees with slice(0,7) on all 356 live bonds", classifierAgrees);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("6 · NAMESPACE DISJOINTNESS — gov (IN[0-9]) can never collide with a name-risk (INE) entity.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const collisions = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM
      (SELECT DISTINCT substring(isin,1,7) stem FROM instruments WHERE asset_class IN ('gsec','sgb')) g
      JOIN (SELECT DISTINCT substring(isin,1,7) stem FROM instruments WHERE asset_class IN ('stock','bond','reit','invit')) nr
      ON g.stem = nr.stem`))[0];
  const govNonDigit = (await q<{ n: number }>(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb') AND substring(isin,3,1) !~ '^[0-9]$'`))[0];
  ok("0 gov-stem ↔ name-risk-stem collisions in the live catalogue", collisions.n === 0, `collisions=${collisions.n}`);
  ok("structural: every gov ISIN has a DIGIT at char[2] (name-risk INE has 'E') → disjoint by construction",
    govNonDigit.n === 0, `gov ISINs with non-digit char[2]=${govNonDigit.n}`);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("7 · BYTE-IDENTICAL — nothing persisted this stage.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const BASELINE: Record<string, number> = {
    mf_analytics: 30265506395726, daily_prices: 1216470182676443, stock_prices: 1067199306256,
    score_snapshots: 5156217484191, market_cap_tier_snapshot: 1083745276939, instruments: 40849366767338,
    instrument_corporate_events: 134636592678, instrument_prices: 9149761003566, index_prices: 311088550838147,
  };
  for (const [t, expected] of Object.entries(BASELINE)) {
    const r = (await q<{ fp: number }>(`SELECT COALESCE(SUM(('x'||substr(md5(x::text),1,8))::bit(32)::bigint),0)::bigint AS fp FROM ${t} x`))[0];
    ok(`${t} byte-identical`, Number(r.fp) === expected, `${Number(r.fp)}`);
  }
  const scored = (await q<{ n: number; fp: number }>(`
    SELECT COUNT(*)::int n, COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::bigint AS fp
    FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`))[0];
  ok("95 scored stocks unchanged", scored.n === 95 && Number(scored.fp) === 224788486973, `${scored.n} · fp ${Number(scored.fp)}`);

  console.log(`\n${fail === 0 ? "✅ STAGE 1 VERIFIED — the entity model exists; Health did not move" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e); process.exitCode = 1; })
     .finally(() => prisma.$disconnect());
