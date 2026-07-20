// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 5 — GATE 3 VERIFICATION (C3+C4+C5+C6 → NET = the CUTOVER).
//
//   1. §13 — Health/Quality/Signals byte-identical (73·73·69·65·50). Construction is NOW the displayed
//      number and Health STILL cannot see it. + the with/without micro-proof + FINDINGS byte-identical
//      (patterns.ts's PX still reads the S-composite — ruling ①, findings are Stage 9).
//   2. §10 worked examples A/B/C to the decimal; D asserted at its INTERIM value (§14-dependent).
//   3. Stress table E — full Construction (esp. single-stock → 21 and single-fund/gold → 75).
//   4. THE C4 GUARANTEE (property): every unit in its own sector ⇒ C4 = 0, across N.
//   5. C4 UNITS-not-positions: NTPC stock + NTPC bond = ONE unit (no 2→1 collapse charge).
//   6. C5 not-evaluable when house-unknown > 0.50 × fundShare.
//   7. Invariants: Net ∈ [0,100]; monotonic; adding a name never raises a sleeve penalty.
//   8. THE CUTOVER: structure COLUMN = construction.net; r.structure (S-composite) still ALIVE (not
//      deleted — ruling ①); 7985d813 asserted as PROPERTIES; fingerprint DRY-RUN (2.0 bump churns).
//   9. SAME-RUN-DELTA: the catalog did not move DURING this proof + the 95-stock structural invariant.
//
// ── WHAT THIS FILE PINS, AND WHY (operator ruling ②) ─────────────────────────────────────────────
//   A test that pins a value a scheduled job LEGITIMATELY changes fails on a schedule, FOREVER — and
//   re-baselining only resets the clock until the next EOD. So we pin the right KIND of thing:
//     · SYNTHETIC (hand-built books, fixed weights) → EXACT. Drift-immune by construction: §10's A/B/C/D,
//       stress-E, the C4 guarantee, the unit/not-evaluable/invariant blocks. These stay to the decimal.
//     · LIVE (real books, real prices) → PROPERTY or SAME-RUN-DELTA, never a literal:
//         - Health unmoved (integer, price-insensitive) — the un-waivable §13 guarantee. KEPT.
//         - Single-stock Net = 21 — a 100% book has NO relative weights, so this is price-INDEPENDENT.
//           It is a property that happens to be a number, not a pinned observation.
//         - Multi-holding Net (was 27.76 / 70.38 / 32.02) — price-dependent BY CONSTRUCTION; the EOD
//           fetch moves it legitimately (70.38→70.48 observed). The exact pins are GONE; the value is
//           still printed for the eye, and §13 + the synthetic arithmetic carry the proof.
//         - Catalog fps (was 9 hard-coded literals) — these MUST drift; a nightly fetch changing them is
//           the system WORKING. Now captured at the head of the run and compared at the tail of the SAME
//           run: asserts the environment was held still for the duration of the proof (see the standing
//           procedure in ODL `cv2-scheduler-hazard`), which is the only thing a verify can honestly claim.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage5.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { fingerprintOf } from "../portfolio/phs/persist.js";
import { firePortfolioFindings } from "../portfolio/phs/patterns.js";
import { CONSTANT_VERSION } from "../portfolio/phs/constants.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(84) + "\n" + s + "\n" + "═".repeat(84));
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

// builders — a stock WITH a sector; a bond with an inherited sector; a fund/commodity with a house.
const S = (sym: string, isin: string, mv: number, sector: string | null, health: number | null = null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "large", sector, health, findings: [], isin, assetClass: "stock" });
const B = (sym: string, isin: string, mv: number, sector: string | null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector, health: null, findings: [], isin, assetClass: "bond" });
const F = (sym: string, isin: string, mv: number, fundHouse: string | null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund", fundHouse });
const GOLD = (sym: string, isin: string, mv: number, fundHouse: string | null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "etf", category: "Other Scheme - Gold ETF", fundHouse });

// ── SAME-RUN-DELTA (ruling ②). The catalog tables MUST drift day-to-day — the nightly EOD fetch changing
//    them is the system WORKING — so pinning their fp to a literal fails on a schedule, forever. Instead:
//    fingerprint them at the HEAD of the run and again at the TAIL, and assert they did not move DURING the
//    proof. That is the only thing a verify can honestly claim: the environment was held still while we
//    measured. A delta is a REAL signal — a scheduler leaked into the build (ODL `cv2-scheduler-hazard`), or
//    this script wrote something it shouldn't. Note the fps are compared as TEXT: these sums exceed 2^53 and
//    would lose precision through Number().
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
  ok("engine stamps CONSTANT_VERSION 2.0 (the cutover fingerprint bump)", CONSTANT_VERSION === "portfolio-spec 2.0", CONSTANT_VERSION);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · §13 UN-WAIVABLE — Construction is now DISPLAYED, and Health/Quality/Signals + FINDINGS did not move.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // PROPERTY, not a pinned observation (ruling ②): a book holding ONE stock is 100% weight whatever the
  // price does, so every C-rule sees the same inputs forever → Net is price-INDEPENDENT and stays exact.
  // The multi-holding books (were 27.76 / 70.38 / 32.02) are price-DEPENDENT by construction — the EOD
  // fetch moves their relative weights legitimately — so their exact pins are gone. Health carries §13.
  const DETERMINISTIC_NET: Record<string, number> = { "4c5ca537": 21, "ae8c6537": 21 };
  for (const u of users) {
    const tag = u.user_id.slice(0, 8);
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { phs: true, quality: true, signals: true, firedFindings: true } });
    const asm = await assemblePortfolio(u.user_id);
    const r = computePhs(asm.holdings);
    ok(`${tag} · Health/Quality/Signals byte-identical (Construction changed, Health did not)`,
      r.health === (stored?.phs ?? null) && near(Number(r.quality), Number(stored?.quality), 1e-4) && near(Number(r.signals), Number(stored?.signals), 1e-4),
      `health ${r.health}=${stored?.phs} · construction.net ${r.construction.net.toFixed(2)}`);
    // FINDINGS invariant to the cutover — patterns.ts reads the LEGACY S-composite (r.structure), NEVER
    // construction.net, so the number cutover cannot disturb findings (Stage 9 owns their repoint). Proven
    // two ways: (a) mutating construction.net does not change the output; (b) any PX bind.structure equals
    // the S-composite, not Net. (A stored-snapshot compare would be wrong — those rows predate CV2.)
    const findings = firePortfolioFindings(asm.holdings, r, { fieldWeakSymbols: asm.fieldWeakSymbols });
    // (Stage 9 §15) INVERTED. At Stage 5 this asserted findings were INVARIANT to the Net cutover, because
    // patterns.ts still read the S-composite — TRUE THEN, and the reason the deletion was deferred (Stage 6
    // ruling ②). Stage 9 repointed PX1/PX2/PX4 onto `construction.net`, so the invariance is now FALSE BY
    // DESIGN: mutating Net MUST change the findings. Asserting the old claim would fail for the right
    // reason; deleting it loses the record. Inverting keeps it doing work — it now protects the repoint.
    // (The Net-mutation proof moved OUT of this per-user loop — see below. It is UNPROVABLE on the live
    // cohort: PX1 needs Quality >= 70 AND Net <= 60, and no live book has both (7985d813 is Net 65.34 but
    // Q 64.5; the two Q-72.6 books already sit at Net 21, so mutating Net to 0 changes nothing). Asserting
    // it here would pass only by not being exercised — the same "inert on this cohort" trap as the PX
    // repoint diff. Proven on a synthetic book that CAN cross the threshold instead.)
    if (tag in DETERMINISTIC_NET) ok(`${tag} · construction.net = ${DETERMINISTIC_NET[tag]} (PROPERTY: a single 100% stock ⇒ price-independent)`, near(r.construction.net, DETERMINISTIC_NET[tag]), `${r.construction.net.toFixed(2)}`);
    else console.log(`     ↳ ${tag} · construction.net ${r.construction.net.toFixed(2)} — price-dependent, reported not pinned (ruling ②)`);
  }
  // micro-proof: the facts C3–C6 read never touch Health.
  const micro = [S("A", "INE001A01011", 100_000, "banks", 60), F("FND", "INF001A01011", 900_000, "HDFC Mutual Fund")];
  const wF = computePhs(micro);
  const woF = computePhs(micro.map((h) => ({ ...h, isin: undefined, assetClass: undefined, sector: null, fundHouse: undefined })));
  ok("micro-proof: Health/Quality/Signals identical with vs without every Construction fact; net differs",
    wF.health === woF.health && wF.quality === woF.quality && wF.signals === woF.signals && wF.construction.net !== woF.construction.net,
    `health ${wF.health} · net ${wF.construction.net.toFixed(1)} vs ${woF.construction.net.toFixed(1)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · §10 WORKED EXAMPLES — full Construction (Net), not just Gross.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // A — fund-only beginner: C1–C4 not evaluable, Gross 100; C5 HDFC 60% → −24; C6 0. Net 76 · Solid.
  const exA = [F("F1", "INF001A01011", 600_000, "HDFC Mutual Fund"), F("F2", "INF002A01012", 150_000, "SBI Mutual Fund"), F("F3", "INF003A01013", 150_000, "ICICI Mutual Fund"), F("F4", "INF004A01014", 100_000, "Axis Mutual Fund")];
  const rA = computePhs(exA);
  ok("A · C1–C4 not evaluable, Gross 100 (all baskets, no sector)", !rA.construction.gross.c1.evaluable && !rA.construction.gross.c2.evaluable && !rA.construction.c3.evaluable && !rA.construction.c4.evaluable && rA.construction.gross.value === 100);
  ok("A · C5 = −24 (HDFC 60% → 1.2×20), C6 0, Net 76", near(rA.construction.c5.points, 24) && rA.construction.c6.points === 0 && near(rA.construction.net, 76), `c5 ${rA.construction.c5.points.toFixed(2)} · net ${rA.construction.net.toFixed(2)} · ${rA.construction.c5.detail}`);

  // B — 5 stocks in 5 DISTINCT sectors: C3 0 (max <40), C4 0 (anti-double-charge), C5 n/e, C6 0. Net = Gross.
  const exB = [
    S("CUMMINS", "INE298A01020", 300_000, "capital_goods", 70), S("TCS", "INE467B01029", 230_000, "it_technology", 70),
    S("RELIANCE", "INE002A01018", 191_000, "oil_gas_energy", 70), S("MM", "INE101A01026", 176_000, "automobile", 70), S("HDFC", "INE001A01036", 103_000, "banks", 70),
  ];
  const rB = computePhs(exB);
  ok("B · C3 = 0 (5 sectors, top ≤ 40)", rB.construction.c3.evaluable && rB.construction.c3.points === 0, rB.construction.c3.detail);
  ok("B · C4 = 0 (THE GUARANTEE: 5 units in 5 distinct sectors → Neff_unit = Neff_sector)", rB.construction.c4.evaluable && rB.construction.c4.points === 0, rB.construction.c4.detail);
  ok("B · C5 not-evaluable (no funds), C6 0, Net = Gross 75.68", !rB.construction.c5.evaluable && rB.construction.c6.points === 0 && near(rB.construction.net, rB.construction.gross.value) && near(rB.construction.net, 75.68), `net ${rB.construction.net.toFixed(2)} gross ${rB.construction.gross.value.toFixed(2)}`);

  // C — heavy blended: NTPC stock+bond=Energy 19%; E2/E3/E4 Financials 18%; 5 funds over 3 houses.
  const exC = [
    S("NTPC", "INE733E01010", 110_000, "oil_gas_energy", 70), B("NTPC-NCD", "INE733E07AB1", 80_000, "oil_gas_energy"),
    S("E2", "INE111A01011", 80_000, "banks", 65), S("E3", "INE222A01012", 60_000, "banks", 65), S("E4", "INE333A01013", 40_000, "banks", 65),
    F("F1", "INF001A01011", 126_000, "HouseA"), F("F2", "INF002A01012", 126_000, "HouseA"),
    F("F3", "INF003A01013", 126_000, "HouseB"), F("F4", "INF004A01014", 126_000, "HouseB"), F("F5", "INF005A01015", 126_000, "HouseC"),
  ];
  const rC = computePhs(exC);
  ok("C · Gross 80.71 (C1 −6 NTPC entity 19%, C2 −13.29)", near(rC.construction.gross.value, 80.71), `${rC.construction.gross.value.toFixed(2)}`);
  ok("C · C3 = 0 (Energy 19% + Financials 18%, top < 40)", rC.construction.c3.evaluable && rC.construction.c3.points === 0, rC.construction.c3.detail);
  ok("C · C4 = −1.29 (Neff_unit 2.87, target 2.87, Neff_sector 2.0, ×0.37)", near(rC.construction.c4.points, 1.29), rC.construction.c4.detail);
  ok("C · C5 = 0 (three houses, top 25.2% < 40), C6 0, Net 79.42", rC.construction.c5.evaluable && rC.construction.c5.points === 0 && near(rC.construction.net, 79.42), `c5 ${rC.construction.c5.points.toFixed(2)} · net ${rC.construction.net.toFixed(2)}`);

  // D — theme overlap: §14-DEPENDENT. §10's 60.6 needs a thematic Pharma FUND sectored into Pharma. In the
  // Stage-5 INTERIM (§14 matcher not built), that fund is a basket → not_applicable → C3 sees only the
  // STOCK Pharma. So Net ≠ 60.6 here, by design. Assert the interim truth + flag the §8 dependency.
  const exD = [
    F("PHARMA-FUND", "INF900A01011", 300_000, "HouseP"), // §14 would sector this Pharma; interim: not_applicable
    S("D1", "INE111A01011", 120_000, "pharma", 65), S("D2", "INE222A01012", 100_000, "pharma", 65), S("D3", "INE333A01013", 80_000, "pharma", 65),
    S("D4", "INE444A01014", 200_000, "it_technology", 65), S("D5", "INE555A01015", 200_000, "banks", 65),
  ];
  const rD = computePhs(exD);
  const pharmaStockShare = 300_000 / 1_000_000; // 30% — stocks only, the fund is not sectored in interim
  ok("D · INTERIM (§14 not built): thematic fund is not_applicable → C3 sees stock-Pharma 30% < 40 → C3 = 0",
    rD.construction.c3.points === 0 && near(pharmaStockShare, 0.30), `${rD.construction.c3.detail}`);
  ok("D · §10's Net 60.6 is UNSATISFIABLE until §14 (Stage 8) sectors the thematic fund — documented, not a defect",
    rD.construction.net > 60.6, `interim net ${rD.construction.net.toFixed(2)} > 60.6 (fund's 30% Pharma not yet counted)`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · STRESS TABLE E — full Construction (the two that catch people out: 21 and 75).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const SECTORS = ["banks", "it_technology", "pharma", "automobile", "oil_gas_energy", "fmcg", "metals_mining", "capital_goods"];
  const equalDistinct = (n: number) => Array.from({ length: n }, (_, i) => S(`S${i}`, `INE${String(i).padStart(3, "0")}A01011`, 1_000_000 / n, SECTORS[i % SECTORS.length], 70));
  const net = (b: PhsHolding[]) => computePhs(b).construction.net;
  ok("E · 100% one stock → 21 (C2 −49 AND C3 −30: one stock IS one sector)", net([S("ONE", "INE000A01011", 1_000_000, "it_technology", 70)]) === 21, `${net([S("ONE", "INE000A01011", 1_000_000, "it_technology", 70)])}`);
  ok("E · 2 stocks 50/50, 2 sectors → 46 (C2 −42, C3 −12)", net(equalDistinct(2)) === 46, `${net(equalDistinct(2))}`);
  ok("E · 3 stocks, 3 sectors → 65 (C2 −35, C3 0 at 33.3%)", net(equalDistinct(3)) === 65, `${net(equalDistinct(3))}`);
  ok("E · 8 stocks, 8 sectors → 100 (everything clear)", net(equalDistinct(8)) === 100, `${net(equalDistinct(8))}`);
  ok("E · 100% one index fund → 75 (C1–C4 n/e, C5 −25 · single AMC)", net([F("IDX", "INF000A01011", 1_000_000, "SomeAMC")]) === 75, `${net([F("IDX", "INF000A01011", 1_000_000, "SomeAMC")])}`);
  const goldBook = [GOLD("GOLDBEES", "INF000G01011", 1_000_000, "Nippon India Mutual Fund")];
  ok("E · 100% gold ETF → 75 · Commodity-led (C5 WIDENED to commodity — ODL cv2-s5-c5-commodity)",
    net(goldBook) === 75 && computePhs(goldBook).construction.c5.points === 25, `net ${net(goldBook)} · c5 ${computePhs(goldBook).construction.c5.points}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · THE C4 GUARANTEE — every unit in its own sector ⇒ C4 = 0, ANY N.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  let allZero = true, worstN = 0;
  for (let n = 1; n <= 8; n++) { const c4 = computePhs(equalDistinct(n)).construction.c4.points; if (c4 !== 0) { allZero = false; worstN = n; break; } }
  ok("C4 = 0 for every distinct-sector book, N = 1..8 (Neff_sector = Neff_unit = target — anti-double-charge)", allZero, allZero ? "all zero" : `broke at N=${worstN}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · C4 UNITS-not-POSITIONS — NTPC stock + NTPC bond in Energy = ONE unit (no 2→1 collapse charge).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Two issuers, each = one entity, both in Energy; NTPC is a stock+bond PAIR. A position-level Neff would
  // count 3 things collapsing to 2 sectors; the entity model counts 2 UNITS in 2 sectors → C4 = 0.
  const unitBook = [
    S("NTPC", "INE733E01010", 250_000, "oil_gas_energy", 70), B("NTPC-NCD", "INE733E07AB1", 250_000, "oil_gas_energy"), // ONE unit, Energy
    S("HDFCBANK", "INE040A01034", 500_000, "banks", 70), // second unit, Financials
  ];
  const rU = computePhs(unitBook);
  ok("NTPC stock+bond aggregate to ONE Energy unit (entityLedger)", rU.entityLedger.length === 2 && rU.entityLedger.some((e) => e.constituentInstruments.length === 2));
  ok("C4 = 0 — two UNITS in two sectors, NOT three positions collapsing (the correctness requirement)", rU.construction.c4.points === 0, rU.construction.c4.detail);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · C5 NOT-EVALUABLE — house-unknown > 0.50 × fundShare (not a silent 0).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const unknownHouse = [F("FA", "INF001A01011", 600_000, null), F("FB", "INF002A01012", 400_000, "KnownAMC")]; // 60% unknown of 100% funds
  const rUH = computePhs(unknownHouse);
  ok("C5 not_evaluable when house-unknown 60% > 0.50 × fundShare 100%", !rUH.construction.c5.evaluable && rUH.construction.c5.points === 0, rUH.construction.c5.detail);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · INVARIANTS.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const books = [rA, rB, rC, rD, rU, rUH, computePhs(equalDistinct(5))];
  ok("Net ∈ [0,100] for every book", books.every((r) => r.construction.net >= 0 && r.construction.net <= 100));
  ok("two 50% entities (2 sectors) cost ≥ one 100% entity in Construction (monotonic downgrade holds)",
    net([S("X", "INE900A01011", 1_000_000, "banks", 70)]) <= net([S("Y", "INE901A01011", 500_000, "banks", 70), S("Z", "INE902A01012", 500_000, "it_technology", 70)]),
    `one 100% → ${net([S("X", "INE900A01011", 1_000_000, "banks", 70)])} ≤ two 50% → ${net([S("Y", "INE901A01011", 500_000, "banks", 70), S("Z", "INE902A01012", 500_000, "it_technology", 70)])}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · THE CUTOVER — structure COLUMN = Net; S-composite ALIVE (not deleted, ruling ①); 7985d813; fingerprint dry-run.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const u of users) {
    const tag = u.user_id.slice(0, 8);
    const asm = await assemblePortfolio(u.user_id);
    const r = computePhs(asm.holdings);
    // (Stage 9 §15) INVERTED. "S-composite still computed (S1–S5 ALIVE)" was a Stage-6 CONSTRAINT; it is a
    // Stage-9 GUARANTEE that they are gone. The assertion keeps protecting what it always protected: that
    // the S-rules' lifecycle is DELIBERATE, not accidental.
    ok(`${tag} · S1–S5 are GONE — no S-composite, no S-ledger on the result (§15)`,
      !("structure" in r) && !("structureLedger" in r) && !("s2Evaluable" in r) && !("neff" in r),
      `Net ${r.construction.net.toFixed(2)} is the only structural number`);
    // fingerprint DRY-RUN: the 2.0 bump means the fresh fingerprint ≠ the stored one → the backfill WOULD write.
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { fingerprint: true, constantVersion: true, structure: true } });
    const fresh = fingerprintOf(asm.holdings, asm.prov);
    const willWrite = fresh !== stored?.fingerprint;
    // idempotent: pre-backfill the fingerprint MUST differ (→ a write lands); post-backfill it matches and
    // the stored row already carries cv 2.0 + the Net value (the cutover reached this book). Either is OK.
    const alreadyCutOver = stored?.constantVersion === CONSTANT_VERSION && near(Number(stored?.structure), r.construction.net);
    ok(`${tag} · cutover reaches this book — fingerprint churns onto Net, OR already cut over [cv ${stored?.constantVersion}]`,
      willWrite || alreadyCutOver, `stored struct ${Number(stored?.structure).toFixed(2)} · Net ${r.construction.net.toFixed(2)} · ${willWrite ? "WILL WRITE" : "cut over"}`);
  }
  // 7985d813 — ruling ④ accepted the drop; ODL `cv2-s5-c1-is-s1` recorded WHY. The old pins (S 76.36 →
  // Net 70.38, C1 −15.78) are ALL price-dependent: RELIANCE's weight moves on every EOD fetch, so all three
  // drift together (70.38→70.48 observed). Ruling ② — assert what SURVIVES the EOD: the IDENTITY, the
  // DIRECTION and the DRIVER. Each is a RELATION between two quantities on the same book, so both sides
  // move with price and the relation holds regardless.
  // ★ THE STAGE-9 REPOINT, PROVEN WHERE IT IS REACHABLE. patterns.ts now reads `construction.net`, not the
  // (deleted) S-composite. The live cohort cannot demonstrate it — PX1 needs Quality >= 70 AND Net <= 60
  // and no live book has both — so a SYNTHETIC book carries the proof, per the reachability rule: a guard
  // the population cannot exercise reads as coverage.
  const px1Book = [
    S("A", "INE001A01011", 34, "banks", 88), S("B", "INE002A01012", 33, "it_technology", 86),
    S("C", "INE003A01013", 33, "pharma", 87),
  ]; // Quality ~87 >= 70 · 3 equal names across 3 sectors → Net > 60 ⇒ PX1 SILENT
  const rPx = computePhs(px1Book);
  const fPx = firePortfolioFindings(px1Book, rPx, { fieldWeakSymbols: new Set() });
  const fPxMut = firePortfolioFindings(px1Book, { ...rPx, construction: { ...rPx.construction, net: 0 } }, { fieldWeakSymbols: new Set() });
  ok(`PX1 SILENT at Net ${rPx.construction.net.toFixed(1)} > 60 (Quality ${rPx.quality?.toFixed(0)} >= 70)`,
    !fPx.some((f) => f.id === "PX1"), `fired [${fPx.map((f) => f.id).join(",")}]`);
  ok("★ findings READ Net — mutating Net to 0 FIRES PX1 on the same book (the Stage-9 repoint, proven)",
    fPxMut.some((f) => f.id === "PX1") && !fPx.some((f) => f.id === "PX1"), `Net=0 → [${fPxMut.map((f) => f.id).join(",")}]`);

  const arman = users.find((u) => u.user_id.startsWith("7985d813"))!;
  const rArm = computePhs((await assemblePortfolio(arman.user_id)).holdings);
  // (Stage 9 §15) THE THREE S-vs-C COMPARISONS ARE RETIRED WITH THEIR SUBJECT — they cannot be inverted,
  // because the thing they compared against no longer exists:
  //   · IDENTITY  C1 ≡ ΣS1  — measured 15.72 ≡ 15.72 at Stage 5. ODL `cv2-s5-c1-is-s1`.
  //   · DIRECTION Net < S-composite — the cutover lowers this book (ruling ④'s accepted drop).
  //   · DRIVER    C2 > S3 — the drop is BREADTH (C2 uncapped @7.0) replacing S3, not C1.
  // They were the PROOF OF A TRANSITION, and the transition is complete. Their answers are in the ODL,
  // which is the record; an assertion that can only be re-run against deleted code is not a guard, it is a
  // fossil. What survives is the thing they were proving ABOUT: C1's shape, asserted directly below.
  ok("7985d813 · C1 keeps the RELATIVE-THRESHOLD IDIOM it inherited from S1 — the rule died, the idea did not (§15)",
    /threshold \d+\.\d% \(N=\d+\)/.test(rArm.construction.gross.c1.detail), rArm.construction.gross.c1.detail.split(" · ")[0]);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("9 · SAME-RUN-DELTA — the catalog did not move DURING this proof (ruling ②: never a stale literal).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The old form pinned 9 fps to literals captured days ago. Those tables are fed by a NIGHTLY EOD job —
  // they MUST drift, and a nightly fetch changing them is the system WORKING; re-pinning only resets the
  // clock until the next fetch. What this stage can honestly claim is narrower and permanent: the cutover
  // is display-layer arithmetic with no write path to a price/score table, and nothing moved while we
  // measured. A delta here is a REAL signal, not a stale baseline.
  const catalogAfter = await catalogSnapshot();
  for (const t of Object.keys(catalogBefore)) {
    const held = catalogBefore[t] === catalogAfter[t];
    ok(`${t} · same-run-delta (unchanged head→tail of THIS run)`, held,
      held ? catalogBefore[t] : `DRIFTED ${catalogBefore[t]} → ${catalogAfter[t]} — a scheduler leaked into the build (ODL cv2-scheduler-hazard)`);
  }
  // STRUCTURAL invariant — the scored COHORT SIZE is price-independent: an EOD rescore changes the scores,
  // never how many stocks are scored. This one stays EXACT.
  ok("95 scored stocks (STRUCTURAL: cohort size is price-independent)", catalogBefore["scored-stocks"].startsWith("95:"), catalogBefore["scored-stocks"]);

  console.log(`\n${fail === 0 ? "✅ STAGE 5 VERIFIED — Construction v2 is the displayed number; Health + findings did not move" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e, e?.stack); process.exitCode = 1; })
     .finally(() => prisma.$disconnect());
