// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 3 — GATE 3 VERIFICATION (C1 + C2 → Gross). The first rules that deduct.
//
//   1. §13 — Health/Quality/Signals byte-identical (73·73·69·65·50) + the with/without micro-proof.
//   2. §10 worked examples C / D / stress-E to the decimal; B's formula behaviour (see the note).
//   3. Invariants: C1=0 for any equal book (N=1..50); monotonic C1; adding a name never raises C2; Gross∈[0,100].
//   4. not_evaluable ≠ zero: a 100%-fund book → C1/C2 not_evaluable, Gross 100 for the RIGHT reason.
//   5. no-cliff (ruling b): C2 continuous on Example B; C1's N-threshold STEP asserted as intended.
//   6. SAME-RUN-DELTA: the catalog did not move DURING this proof + the 95-stock structural invariant.
//
// ── WHAT THIS FILE PINS, AND WHY (operator ruling ②) ─────────────────────────────────────────────
//   A test that pins a value a scheduled job LEGITIMATELY changes fails on a schedule, FOREVER — and
//   re-baselining only resets the clock until the next EOD. So we pin the right KIND of thing:
//     · SYNTHETIC (hand-built books, fixed weights) → EXACT. This file is almost ENTIRELY synthetic —
//       §10's B/C/D, stress-E, every invariant, the not-evaluable and no-cliff blocks are computed from
//       hand-built holdings with fixed weights. They are drift-immune BY CONSTRUCTION and stay to the
//       decimal. This is why §2–§5 survived the EOD that broke the pinned fps below.
//     · LIVE → PROPERTY or SAME-RUN-DELTA, never a literal:
//         - §1 Health byte-identical vs the served row — an INTEGER, price-insensitive. The un-waivable
//           §13 guarantee, and the only live assertion this stage needs. KEPT.
//         - Catalog fps (were 9 hard-coded literals) — these MUST drift; a nightly fetch changing them is
//           the system WORKING. Now captured at the head of the run and compared at the tail of the SAME
//           run (see ODL `cv2-scheduler-hazard`). Stage 3 persists NOTHING, so the honest claim is simply
//           that nothing moved while we measured.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage3.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { c1Of, c2Of, buildSleeves, buildEntityLedger, type AssetClass } from "../portfolio/phs/entity.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(84) + "\n" + s + "\n" + "═".repeat(84));
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;

const S = (sym: string, isin: string, mv: number, health: number | null = null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "large", sector: null, health, findings: [], isin, assetClass: "stock" });
const B = (sym: string, isin: string, mv: number): PhsHolding => // a bond — name-risk, unscored
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "bond" });
const F = (sym: string, isin: string, mv: number): PhsHolding => // a fund — basket
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund" });
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

// ── SAME-RUN-DELTA (ruling ②). The catalog tables MUST drift day-to-day — the nightly EOD fetch changing
//    them is the system WORKING — so pinning their fp to a literal fails on a schedule, forever. Instead:
//    fingerprint them at the HEAD of the run and again at the TAIL, and assert they did not move DURING the
//    proof. Stage 3 persists nothing, so that is exactly the claim: nothing moved while we measured. A delta
//    is a REAL signal — a scheduler leaked into the build (ODL `cv2-scheduler-hazard`). Compared as TEXT:
//    these sums exceed 2^53 and would lose precision through Number().
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
  const catalogBefore = await catalogSnapshot(); // HEAD of the run — the same-run-delta baseline (§6)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · §13 UN-WAIVABLE — Construction arithmetic must not reach Health (recompute == persisted).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);
  for (const u of users) {
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { phs: true } });
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    ok(`${u.user_id.slice(0, 8)} · Health byte-identical (Gross exists, but Health did not move)`, r.health === (stored?.phs ?? null), `health ${r.health} vs ${stored?.phs} · gross ${r.gross.value.toFixed(2)}`);
  }
  const micro = [S("A", "INE001A01011", 100_000, 60), F("FND", "INF001A01011", 900_000)];
  const wF = computePhs(micro);
  const woF = computePhs(micro.map((h) => ({ ...h, isin: undefined, assetClass: undefined })));
  ok("micro-proof: Health/Quality/Signals identical with vs without the facts C1/C2 read",
    wF.health === woF.health && wF.quality === woF.quality && wF.signals === woF.signals && wF.gross.value !== woF.gross.value,
    `health ${wF.health} · gross ${wF.gross.value.toFixed(1)} (facts) vs ${woF.gross.value.toFixed(1)} (stripped)`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · §10 WORKED EXAMPLES");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Example C — the flagship: C1 fires on NTPC ONLY because Stage 1 aggregated stock(11%)+bond(8%)=19%.
  const exC = [
    S("NTPC", "INE733E01010", 110_000, 70), B("NTPC-NCD", "INE733E07AB1", 80_000), // entity NTPC = 19%
    S("E2", "INE111A01011", 80_000, 65), S("E3", "INE222A01012", 60_000, 65), S("E4", "INE333A01013", 40_000, 65),
    F("F1", "INF001A01011", 126_000), F("F2", "INF002A01012", 126_000), F("F3", "INF003A01013", 126_000),
    F("F4", "INF004A01014", 126_000), F("F5", "INF005A01015", 126_000),
  ]; // total 1,000,000 · N=10 · nameRiskShare 0.37
  const rC = computePhs(exC);
  ok("Example C · nameRiskShare = 0.37, N=10, threshold 15", near(rC.sleeves.nameRisk, 0.37) && exC.length === 10);
  ok("Example C · C1 = −6.0 (NTPC entity 19% > 15 — fires ONLY because stock+bond aggregated)", rC.gross.c1.points === 6 && rC.gross.c1.evaluable, rC.gross.c1.detail);
  ok("Example C · C2 = −13.29 (Neff 2.87)", near(rC.gross.c2.points, 13.29), rC.gross.c2.detail);
  ok("Example C · Gross = 80.71", near(rC.gross.value, 80.71), `${rC.gross.value.toFixed(2)}`);

  // Example D — threshold 25, no entity above → C1 = 0.
  const exD = [
    S("D1", "INE111A01011", 120_000, 65), S("D2", "INE222A01012", 100_000, 65), S("D3", "INE333A01013", 80_000, 65),
    F("F1", "INF001A01011", 233_400), F("F2", "INF002A01012", 233_300), F("F3", "INF003A01013", 233_300),
  ]; // total 1,000,000 · N=6 · nameRiskShare 0.30
  const rD = computePhs(exD);
  ok("Example D · C1 = 0 (threshold 25, top entity 12% — clean, evaluable)", rD.gross.c1.points === 0 && rD.gross.c1.evaluable, rD.gross.c1.detail);
  ok("Example D · C2 = −10.66 (Neff 2.92), Gross = 89.34", near(rD.gross.c2.points, 10.66) && near(rD.gross.value, 89.34), `c2 ${rD.gross.c2.points.toFixed(2)} · gross ${rD.gross.value.toFixed(2)}`);

  // Example B — the knife-edge: Cummins AT the N=5 threshold (30% == 30%) → C1 = 0 (strictly-greater test).
  // NOTE: the spec's 76.1 treats weights summing to 0.987 as fractions of 1; a NORMALISED book gives 75.68.
  const exB = [
    S("CUMMINS", "INE298A01020", 300_000, 70), S("TCS", "INE467B01029", 230_000, 70),
    S("RELIANCE", "INE002A01018", 191_000, 70), S("MM", "INE101A01026", 176_000, 70), S("HDFC", "INE001A01036", 103_000, 70),
  ]; // total 1,000,000 · Cummins 30.0% == threshold 30 (N=5)
  const rB = computePhs(exB);
  ok("Example B · Cummins at exactly the threshold (30% == 30%) → C1 = 0 (the strictly-greater knife-edge)", rB.gross.c1.points === 0 && rB.gross.c1.evaluable, rB.gross.c1.detail);
  ok("Example B · C2 = −24.32 (Neff 4.53), Gross = 75.68 [spec's 76.1 uses un-normalised weights ΣΣ0.987]", near(rB.gross.c2.points, 24.32) && near(rB.gross.value, 75.68), `c2 ${rB.gross.c2.points.toFixed(2)} · gross ${rB.gross.value.toFixed(2)}`);

  // Stress table E — clean equal-weight books.
  const equal = (n: number, health = 70) => Array.from({ length: n }, (_, i) => S(`S${i}`, `INE${String(i).padStart(3, "0")}A01011`, 1_000_000 / n, health));
  const grossOf = (n: number) => computePhs(equal(n)).gross.value;
  ok("Stress E · 1 stock → Gross 51 (C2 −49)", grossOf(1) === 51, `${grossOf(1)}`);
  ok("Stress E · 2 stocks 50/50 → Gross 58 (C2 −42)", grossOf(2) === 58, `${grossOf(2)}`);
  ok("Stress E · 3 stocks → Gross 65 (C2 −35)", grossOf(3) === 65, `${grossOf(3)}`);
  ok("Stress E · 8 stocks → Gross 100 (Neff 8, C2 0)", grossOf(8) === 100, `${grossOf(8)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · INVARIANTS (asserted as properties, not examples)");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  let allZero = true;
  for (let n = 1; n <= 50; n++) if (computePhs(equal(n)).gross.c1.points !== 0) { allZero = false; break; }
  ok("C1 = 0 for ANY equal-weighted book, N = 1..50 (even weight < max(15, 1.5×fairShare) always)", allZero);

  // Monotonic: concentrating an exposure never costs LESS C1 than splitting it (the v1 total-cap fix).
  const rest = Array.from({ length: 8 }, (_, i) => F(`R${i}`, `INF9${i}0A01011`, 60_000 / 8));
  const oneBig = computePhs([S("BIG", "INE900A01011", 400_000, 70), ...rest, F("pad", "INF800A01011", 540_000)]);      // one 40% entity, N=10
  const twoMid = computePhs([S("M1", "INE901A01011", 200_000, 70), S("M2", "INE902A01012", 200_000, 70), ...rest, F("pad", "INF800A01011", 540_000)]); // two 20% entities, N=11
  ok("monotonic: one 40% entity costs ≥ two 20% entities (concentration penalised more; v1 bug absent)", oneBig.gross.c1.points >= twoMid.gross.c1.points, `${oneBig.gross.c1.points.toFixed(2)} ≥ ${twoMid.gross.c1.points.toFixed(2)}`);

  // C1 is capped on the TOTAL at 30 (never per-entity ×N).
  const heavy = computePhs([S("H1", "INE901A01011", 300_000, 70), S("H2", "INE902A01012", 300_000, 70), S("H3", "INE903A01013", 300_000, 70), ...Array.from({ length: 7 }, (_, i) => F(`f${i}`, `INF7${i}0A01011`, 100_000 / 7))]);
  ok("C1 total-capped at 30 (three 30% entities would sum to 67.5 uncapped)", heavy.gross.c1.points === 30, `${heavy.gross.c1.points}`);

  // Adding a name to the sleeve never INCREASES C2 (Neff rises → penalty falls).
  const c2_3 = computePhs(equal(3)).gross.c2.points;
  const c2_4 = computePhs(equal(4)).gross.c2.points;
  ok("adding a holding to the sleeve never increases the C2 penalty (Neff↑ ⇒ C2↓)", c2_4 <= c2_3, `${c2_4.toFixed(2)} ≤ ${c2_3.toFixed(2)}`);

  // Gross ∈ [0,100] for every book seen.
  ok("Gross ∈ [0,100] across all example books", [rB, rC, rD, oneBig, twoMid, heavy].every((r) => r.gross.value >= 0 && r.gross.value <= 100));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · NOT-EVALUABLE ≠ ZERO");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const fundBook = computePhs([F("FA", "INF001A01011", 500_000), F("FB", "INF002A01012", 500_000)]);
  ok("100%-fund book → C1 not_evaluable AND C2 not_evaluable (NOT fired-with-0)",
    fundBook.gross.c1.evaluable === false && fundBook.gross.c2.evaluable === false, `C1 ${fundBook.gross.c1.detail} · C2 ${fundBook.gross.c2.detail}`);
  ok("…Gross = 100, but for the RIGHT reason — the ledger says not_evaluable, not 'checked, clean'", fundBook.gross.value === 100 && fundBook.gross.c1.points === 0);
  const bondBook = computePhs([B("GILT-ISH", "INE500A07011", 600_000), B("BOND2", "INE600A07012", 400_000)]);
  ok("100%-BOND book (name-risk, unscored) → Health null but C1/C2 EVALUATE on the entities", bondBook.health === null && bondBook.gross.c2.evaluable === true, `gross ${bondBook.gross.value.toFixed(1)} · c2 ${bondBook.gross.c2.detail}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · NO-CLIFF (ruling b) — C2 continuous; C1's N-threshold step is intended (ODL cv2-s3-c1-discrete).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const withFund = computePhs([...exB, F("TINY", "INF999A01011", 100)]); // ₹100 fund on the ₹1,000,000 Example B
  ok("C2 CONTINUITY: nameRiskShare 1.0000 → 0.9999 (a nudge, not a step)", near(rB.sleeves.nameRisk, 1.0, 1e-9) && near(withFund.sleeves.nameRisk, 0.9999, 1e-4), `${rB.sleeves.nameRisk.toFixed(4)} → ${withFund.sleeves.nameRisk.toFixed(4)}`);
  ok("C2 CONTINUITY: C2 moves by < 0.05 (the property §9.5 actually rests on)", Math.abs(withFund.gross.c2.points - rB.gross.c2.points) < 0.05, `Δc2 = ${(withFund.gross.c2.points - rB.gross.c2.points).toFixed(4)}`);
  ok("C1 STEPS (intended): Cummins crosses the dropped threshold 30→25 → C1 0 → fires", rB.gross.c1.points === 0 && withFund.gross.c1.points > 0, `C1 0 → ${withFund.gross.c1.points.toFixed(2)} (threshold ${withFund.gross.c1.detail.match(/threshold ([\d.]+)/)?.[1]})`);
  ok("…so Gross STEPS via C1 (a real structural change), NOT an archetype cliff to ~97", withFund.gross.value < rB.gross.value && withFund.gross.value > 60, `${rB.gross.value.toFixed(2)} → ${withFund.gross.value.toFixed(2)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · SAME-RUN-DELTA — nothing persisted this stage; the catalog did not move DURING this proof.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The old form pinned 9 fps to literals captured days ago. Those tables are fed by a NIGHTLY EOD job —
  // they MUST drift, and re-pinning only resets the clock until the next fetch. Stage 3 writes NOTHING, so
  // the honest, permanent claim is: nothing moved between the head and the tail of this run.
  const catalogAfter = await catalogSnapshot();
  for (const t of Object.keys(catalogBefore)) {
    const held = catalogBefore[t] === catalogAfter[t];
    ok(`${t} · same-run-delta (unchanged head→tail of THIS run)`, held,
      held ? catalogBefore[t] : `DRIFTED ${catalogBefore[t]} → ${catalogAfter[t]} — a scheduler leaked into the build (ODL cv2-scheduler-hazard)`);
  }
  // STRUCTURAL invariant — the scored COHORT SIZE is price-independent: an EOD rescore changes the scores,
  // never how many stocks are scored. This one stays EXACT.
  ok("95 scored stocks (STRUCTURAL: cohort size is price-independent)", catalogBefore["scored-stocks"].startsWith("95:"), catalogBefore["scored-stocks"]);

  console.log(`\n${fail === 0 ? "✅ STAGE 3 VERIFIED — Gross exists; Health did not move" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e); process.exitCode = 1; })
     .finally(() => prisma.$disconnect());
