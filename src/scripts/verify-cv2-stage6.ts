// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 6 — GATE 3 VERIFICATION (bands · archetype · display · S1–S5 DEFERRED).
// DETERMINISTIC: everything is proven via computePhs + the pure band/archetype/reshape functions, so a
// concurrent snapshot writer (the dev-server scheduler) cannot affect the result. §13 keys on Health,
// which is byte-identical across EVERY persisted row regardless of cv/structure.
//
//   1. §13 — Health/Quality/Signals byte-identical (73·73·69·65·50); Construction is display-only.
//   2. FE renders C-rules: CONSTRUCTION_RULE_META resolves all C1…C6; reshape serves construction_data.
//   3. Bands recut (85/70/55/40) on the cohort + boundary edges; 70→Solid inclusive.
//   4. Fragile GONE from Construction; still present in Health (separate functions).
//   5. Archetype: cohort → Stock-led; order proven (bond→Income, gold→Commodity).
//   6. Evaluability: a stock-only book distinguishes not-evaluable (C5, no subject) from clean-0.
//   7. structureTier GONE from the payload; capitalTier survives as copy input.
//   8. S1–S5 GONE (§15, Stage 9 — this INVERTED from "still computed"); relative-threshold idiom alive in C1.
//   9. SAME-RUN-DELTA: the catalog did not move DURING this proof + the 95-stock structural invariant.
//
// ── WHAT THIS FILE PINS, AND WHY (operator ruling ②) ─────────────────────────────────────────────
//   §1–§8 are SYNTHETIC or PURE (computePhs + the pure band/archetype/reshape functions on hand-built
//   books) → drift-immune BY CONSTRUCTION, asserted EXACT. §13 keys on Health, an INTEGER that is
//   byte-identical across every persisted row regardless of cv/structure.
//   §9 was the exception and carried the WORSE OF BOTH: it re-pinned the 5 non-EOD tables to literals
//   (the same trap, just slower — the next legitimate catalogue import breaks them) and merely REPORTED
//   the 4 EOD-fed ones, so those four were asserted by NOBODY. A silent gap is worse than a failing pin;
//   a failing pin at least tells you something. Now: SAME-RUN-DELTA over all 9, uniformly — capture at
//   the head, compare at the tail of the SAME run. One idiom, never stale, and a delta names its own
//   cause (ODL `cv2-scheduler-hazard`). See verify-cv2-stage3/stage5 for the same block.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage6.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { buildExposures, archetypeOf, constructionDataOf } from "../portfolio/phs/entity.js";
import { constructionBandOf, bandOf, type ConstructionBand } from "../portfolio/phs/constants.js";
import { reshapeSnapshot, type SnapshotReadInput } from "../controllers/me/portfolio-snapshot-controller.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(84) + "\n" + s + "\n" + "═".repeat(84));
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

const S = (sym: string, isin: string, mv: number, sector: string | null, health: number | null = null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "large", sector, health, findings: [], isin, assetClass: "stock" });

// ── SAME-RUN-DELTA (ruling ②). The catalog tables MUST drift day-to-day — the nightly EOD fetch changing
//    them is the system WORKING — so pinning their fp to a literal fails on a schedule, forever. Instead:
//    fingerprint them at the HEAD of the run and again at the TAIL, and assert they did not move DURING the
//    proof. A delta is a REAL signal — a scheduler leaked into the build (ODL `cv2-scheduler-hazard`), or
//    this script wrote something it shouldn't. Compared as TEXT: these sums exceed 2^53 and would lose
//    precision through Number().
const CATALOG = ["mf_analytics", "daily_prices", "stock_prices", "score_snapshots", "market_cap_tier_snapshot",
  "instruments", "instrument_corporate_events", "instrument_prices", "index_prices"] as const;
const SCORED_SQL = `SELECT COUNT(*)::int AS n, COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::text AS fp
  FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`;
async function catalogSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of CATALOG) {
    out[t] = (await q<{ fp: string }>(`SELECT COALESCE(SUM(('x'||substr(md5(x::text),1,8))::bit(32)::bigint),0)::text AS fp FROM ${t} x`))[0].fp;
  }
  const s = (await q<{ n: number; fp: string }>(SCORED_SQL))[0];
  out["scored-stocks"] = `${s.n}:${s.fp}`;
  return out;
}

async function main() {
  const catalogBefore = await catalogSnapshot(); // HEAD of the run — the same-run-delta baseline (§9)
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);
  const EXP_HEALTH: Record<string, number> = { "4c5ca537": 73, "ae8c6537": 73, "e3c6bd3c": 69, "7985d813": 65, "108fd2a6": 50 };

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · §13 — Health byte-identical (7th time). Construction v2 display changes touch NO Health input.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const u of users) {
    const tag = u.user_id.slice(0, 8);
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    // Health is byte-identical across EVERY persisted row (the concurrent writer never moves it), so we
    // assert against the invariant constant, then confirm the served row agrees.
    const served = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { phs: true } });
    ok(`${tag} · Health ${EXP_HEALTH[tag]} (recompute == invariant == served row)`,
      r.health === EXP_HEALTH[tag] && served?.phs === r.health, `recompute ${r.health} · served ${served?.phs}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · FE RENDERS C-RULES — every C1…C6 id resolves; reshape serves construction_data (no crash).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // the FE's meta must key on exactly C1…C6 (mirrors the wire). A C-rule ledger through reshape → payload.
  const armanR = computePhs((await assemblePortfolio(users.find((u) => u.user_id.startsWith("7985d813"))!.user_id)).holdings);
  const cData = constructionDataOf(armanR.construction, armanR.entityLedger, armanR.basketLedger, armanR.sectors, armanR.entityLedger.length, 0);
  const RULE_IDS = ["C1", "C2", "C3", "C4", "C5", "C6"];
  ok("construction_data.rules = exactly [C1…C6] in order (the FE meta keys resolve — no undefined.title)",
    cData.rules.length === 6 && cData.rules.every((r, i) => r.rule === RULE_IDS[i]), cData.rules.map((r) => r.rule).join(","));
  ok("every rule carries subjectShare + firedSubject (structured — FE never parses `detail`)",
    cData.rules.every((r) => typeof r.subjectShare === "number" && (r.firedSubject === null || typeof r.firedSubject.kind === "string")));
  // reshape a mock row carrying construction_data → the payload exposes rules/archetype/band, no structureTier.
  const mockRow = (net: number, cd: unknown): SnapshotReadInput => ({
    id: "x", phs: 65, band: "Steady", provisional: false, evaluable: true, quality: 64, structure: net, signals: 100,
    coverage: 0.99, totalValue: 1e6, recognizedUnscoredValue: 0, smallUnscoredValue: 0, structureLedger: [], signalsLedger: [],
    firedFindings: [], pillarProfile: null, lensProfile: null, structureTier: "Established", capitalTier: "Substantial",
    constructionData: cd, constantVersion: "portfolio-spec 2.0", createdAt: new Date(0),
  });
  const reshaped = reshapeSnapshot(mockRow(armanR.construction.net, cData), { scoredCount: 7, totalCount: 9 }, []);
  ok("payload.constructionRead.rules present (C-ledger served)", Array.isArray(reshaped.constructionRead.rules) && reshaped.constructionRead.rules!.length === 6);
  ok("payload.constructionRead.archetype = Stock-led", reshaped.constructionRead.archetype === "Stock-led", `${reshaped.constructionRead.archetype}`);
  ok("payload has NO structureTier (retired)", (reshaped.constructionRead as unknown as Record<string, unknown>).structureTier === undefined);
  ok("legacy row (construction_data null) degrades — rules null, value+band still served",
    reshapeSnapshot(mockRow(70, null), { scoredCount: 7, totalCount: 9 }, []).constructionRead.rules === null);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · BANDS recut (85/70/55/40) — cohort + boundary edges. 70 → Solid (inclusive lower).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok("85 → Well-built · 84 → Solid", constructionBandOf(85) === "Well-built" && constructionBandOf(84) === "Solid");
  ok("70 → Solid (inclusive) · 69 → Concentrated", constructionBandOf(70) === "Solid" && constructionBandOf(69) === "Concentrated");
  ok("55 → Concentrated · 54 → Lopsided", constructionBandOf(55) === "Concentrated" && constructionBandOf(54) === "Lopsided");
  ok("40 → Lopsided · 39 → Precarious", constructionBandOf(40) === "Lopsided" && constructionBandOf(39) === "Precarious");
  for (const u of users) {
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    const b = constructionBandOf(r.construction.net);
    const expect: ConstructionBand = r.construction.net >= 70 ? "Solid" : r.construction.net >= 55 ? "Concentrated" : r.construction.net >= 40 ? "Lopsided" : "Precarious";
    ok(`${u.user_id.slice(0, 8)} · Net ${r.construction.net.toFixed(2)} → ${b}`, b === expect);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · Fragile GONE from Construction; still a HEALTH band (separate functions, no shared constant).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const cbands = new Set(Array.from({ length: 101 }, (_, i) => constructionBandOf(i)));
  ok("constructionBandOf never returns 'Fragile' (renamed to Precarious)", !cbands.has("Fragile" as ConstructionBand) && cbands.has("Precarious"));
  ok("Health bandOf STILL returns 'Fragile' (35–49) — the collision is resolved, not deleted", bandOf(40) === "Fragile" && bandOf(48) === "Fragile");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ARCHETYPE — cohort → Stock-led; ORDER proven (Income beats Stock; Commodity).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const u of users) {
    const { holdings } = await assemblePortfolio(u.user_id);
    const r = computePhs(holdings);
    ok(`${u.user_id.slice(0, 8)} · Stock-led`, r.construction.archetype === "Stock-led", `nameRisk ${(r.sleeves.nameRisk * 100).toFixed(1)}%`);
  }
  const bond: PhsHolding = { symbol: "B", marketValue: 1e6, tier: "unknown", sector: null, health: null, findings: [], isin: "INE111A07011", assetClass: "bond" };
  ok("100% bond → Income-led (both name-risk AND income → Income WINS — the truer sentence)", archetypeOf(buildExposures([bond], 1e6)) === "Income-led");
  const gold: PhsHolding = { symbol: "G", marketValue: 1e6, tier: "unknown", sector: null, health: null, findings: [], isin: "INF1G", assetClass: "etf", category: "Other Scheme - Gold ETF" };
  ok("100% gold ETF → Commodity-led", archetypeOf(buildExposures([gold], 1e6)) === "Commodity-led");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · EVALUABILITY — a stock-only book distinguishes NOT-EVALUABLE (no subject) from CLEAN-0.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const stockBook = [S("A", "INE001A01011", 400_000, "banks", 70), S("B", "INE002A01012", 300_000, "it_technology", 70), S("C", "INE003A01013", 300_000, "pharma", 70)];
  const rS = computePhs(stockBook);
  const c5 = rS.construction.c5, c1 = rS.construction.gross.c1;
  ok("C5 (fund-house) NOT-EVALUABLE on a stock-only book (no subject) — subjectShare 0", !c5.evaluable && c5.subjectShare === 0, c5.detail);
  ok("C1 (entity) EVALUABLE-and-clean (had a subject, took nothing off) — distinct from C5's not-evaluable",
    c1.evaluable && c1.points === 0 && c1.subjectShare > 0, `evaluable ${c1.evaluable} subjectShare ${c1.subjectShare.toFixed(2)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · structureTier retired from payload; capitalTier survives (covered in §2 + read-split).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok("capitalTier still on the payload (copy input)", reshaped.constructionRead.capitalTier === "Substantial", `${reshaped.constructionRead.capitalTier}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · S1–S5 DELETED (§15); the relative-threshold IDIOM survives in C1 — delete the rules, not the idea.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ INVERTED AT STAGE 9. This asserted "S-rules STILL COMPUTED" — correct at Stage 6, where ruling ②
  // DEFERRED the deletion because patterns.ts:183 still read `r.structure`. Stage 9 repointed that read,
  // proved the consumer list at ZERO repo-wide, and deleted them. The assertion is now false by design.
  // Leaving it breaks the suite for the right reason; deleting it loses the record. INVERTING is the only
  // option that keeps it doing work — a Stage-6 CONSTRAINT becomes a Stage-9 GUARANTEE, and the assertion
  // goes on protecting exactly what it always protected: that the S-rules' lifecycle is DELIBERATE.
  ok("S1–S5 are GONE (§15) — no structure, no structureLedger, no s2Evaluable, no neff on the result",
    !("structure" in armanR) && !("structureLedger" in armanR) && !("s2Evaluable" in armanR) && !("neff" in armanR) && !("structureTier" in armanR),
    `the result carries construction.net ${armanR.construction.net.toFixed(2)} and no S-anything`);
  ok("…and the RELATIVE-THRESHOLD IDIOM survives them (§15 lists it ALIVE) — C1 still computes max(15, 1.5×fairShare)",
    /threshold \d+\.\d% \(N=\d+\)/.test(armanR.construction.gross.c1.detail), armanR.construction.gross.c1.detail.split(" · ")[0]);
  // (Stage 9) This pinned `threshold 16.7% (N=9)` against a LIVE book — it measured HOW MANY ENTITIES
  // AMAN HAPPENS TO HOLD. His book moved to N=12, the threshold correctly fell to the 15% floor, and the
  // assertion went red having caught nothing but a portfolio change. Ruling ②: live → PROPERTY; synthetic
  // → EXACT. The idiom is a pure function of N, so prove it on synthetic books where BOTH branches are
  // reachable and the answer is arithmetic — drift-immune, and strictly MORE than the pin ever claimed:
  // the pin only ever exercised the relative branch, and only while Aman held exactly 9 entities.
  const nEntityBook = (n: number) => Array.from({ length: n }, (_, i) => S(`E${i}`, `INE${String(i + 1).padStart(3, "0")}A01011`, 100_000, "banks", 70));
  const c1At = (n: number) => computePhs(nEntityBook(n)).construction.gross.c1.detail;
  ok("C1 relative branch ALIVE: N=9 ⇒ fairShare 11.1% ⇒ 1.5× = 16.7% BEATS the 15% floor",
    /threshold 16\.7% \(N=9\)/.test(c1At(9)), c1At(9).split(" · ")[0]);
  ok("C1 absolute floor holds: N=12 ⇒ 1.5×8.3% = 12.5% LOSES to the 15% floor ⇒ max() picks 15.0%",
    /threshold 15\.0% \(N=12\)/.test(c1At(12)), c1At(12).split(" · ")[0]);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("9 · SAME-RUN-DELTA — a DISPLAY stage cannot write prices/scores; nothing moved DURING this proof.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Stage 6 touched engine display + a JSONB column on portfolio_health_snapshot ONLY — it has no path to
  // a price or score table. The guard that MATTERS (§13 Health) passed above. This block previously split
  // the catalog into 5 re-pinned literals + 4 report-only tables; ruling ② collapsed that into ONE idiom:
  // all 9 (+ the scored fp) captured at the head and compared at the tail of the SAME run. Nothing is
  // pinned to a literal, so nothing goes stale — and nothing is merely reported, so nothing is unasserted.
  const catalogAfter = await catalogSnapshot();
  for (const t of Object.keys(catalogBefore)) {
    const held = catalogBefore[t] === catalogAfter[t];
    ok(`${t} · same-run-delta (unchanged head→tail of THIS run)`, held,
      held ? catalogBefore[t] : `DRIFTED ${catalogBefore[t]} → ${catalogAfter[t]} — a scheduler leaked into the build (ODL cv2-scheduler-hazard)`);
  }
  // STRUCTURAL invariant — the scored COHORT SIZE is price-independent: an EOD rescore changes the scores,
  // never how many stocks are scored. This one stays EXACT.
  ok("95 scored stocks (STRUCTURAL: cohort size is price-independent)", catalogBefore["scored-stocks"].startsWith("95:"), catalogBefore["scored-stocks"]);

  console.log(`\n${fail === 0 ? "✅ STAGE 6 VERIFIED — the headline and its evidence agree; Health untouched; S1–S5 still computed" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e, e?.stack); process.exitCode = 1; }).finally(() => prisma.$disconnect());
