// ─────────────────────────────────────────────────────────────────────────────
// PHS ENGINE VERIFICATION — portfolio-spec 1.2 (DECOUPLING). Pure engine (inputs direct).
//   • Change 1 — Health = Quality − 0.20×(100 − Signals); NO structure term.
//   • Change 2 — Construction = standalone Structure (full strength).
//   • Change 3 — the coverage ceiling is RETIRED; Health shows TRUE (only a Provisional tag).
//   • Change 4 — pillarProfile renormalizes over scored weight.
//   • Change 5 — lensProfile is findings-character; null when no lens patterns fired.
//   npx tsx src/scripts/verify-phs-examples.ts
// ─────────────────────────────────────────────────────────────────────────────
import { computePhs, type PhsHolding, type PillarSubtotals } from "../portfolio/phs/engine.js";
import type { LensNature } from "../portfolio/phs/constants.js";

let failures = 0;
function near(name: string, actual: number | null, expected: number, tol = 0.05) {
  const ok = actual != null && Math.abs(actual - expected) <= tol;
  console.log(`    ${ok ? "✅" : "❌"} ${name}: ${actual == null ? "null" : actual.toFixed(3)} (exp ${expected})`);
  if (!ok) failures++;
}
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`    ${ok ? "✅" : "❌"} ${name}: ${String(actual)} (exp ${String(expected)})`);
  if (!ok) failures++;
}
const H = (
  symbol: string, marketValue: number, tier: PhsHolding["tier"], sector: string | null, health: number | null,
  findings: PhsHolding["findings"] = [], pillars: PillarSubtotals | null = null, lensNatures: LensNature[] = [],
): PhsHolding => ({ symbol, marketValue, tier, sector, health, findings, pillars, lensNatures });

// ═══════════════════════════════════════════════════════════════════════════════
// ACCEPTANCE 1 — the decoupled pair. A single health-80 stock: Health passes straight
// through (= Quality 80, no positional penalty), while Construction stands ALONE at full
// strength. Under v1.1 this was blended into ONE dampened number; 1.2 shows the honest pair.
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ ACCEPTANCE 1 — single health-80 stock: the decoupled pair ═══");
const oneKnown = computePhs([H("ONE", 100, "large", "Financials", 80)]); // known sector → S2 fires
console.log(`  known-sector single stock → Health ${oneKnown.health} (${oneKnown.band}) · Construction ${oneKnown.structure.toFixed(0)} · quality ${oneKnown.quality} · signals ${oneKnown.signals}`);
eq("Health = 80 (pure Quality, NO structure term)", oneKnown.health, 80);
eq("band Strong", oneKnown.band, "Strong");
eq("Construction = standalone Structure = 55 (S1 0 · S2 −25 · S3 −20)", Math.round(oneKnown.structure), 55);
eq("no coverage cap — Health shows TRUE (evaluable)", oneKnown.evaluable, true);
// the unknown-sector variant: S2 not evaluable → Construction = 80 (S3 only), pair collapses.
const oneUnknown = computePhs([H("ONE", 100, "large", null, 80)]);
console.log(`  unknown-sector single stock → Health ${oneUnknown.health} · Construction ${oneUnknown.structure.toFixed(0)} (S3-only)`);
eq("unknown-sector Construction = 80 (S3 only, no S2)", Math.round(oneUnknown.structure), 80);
console.log("  NOTE: the amendment's illustrative '80·35 / hidden as 56' does not match the S-rule caps —");
console.log("  a single position floors Structure at 55 (S1=0 via the 1.1 relative threshold, S2 caps −25,");
console.log("  S3 caps −20). The v1.1 BLENDED value was 67 (80 − 0.30×45), not 56 (56 was the health-70 case).");
console.log("  The DECOUPLING itself is exact: Health 80 (pure Quality) now stands beside Construction 55.");

// ═══════════════════════════════════════════════════════════════════════════════
// ACCEPTANCE 2 — the v1.1 acceptance book, recomputed. Health loses the −0.30×structure
// drag → rises to Quality (71); Construction now carries the structure standalone at full
// strength (86, was dampened into the old blended 67).
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ ACCEPTANCE 2 — v1.1 book decoupled (Health 71 · Construction 86; was blended 67) ═══");
const book = computePhs([
  H("CUMMINS", 30, "large", "CapGoods", 84), H("TCS", 23, "large", "IT", 71),
  H("RELIANCE", 19, "large", "Energy", 55), H("MM", 18, "large", "Auto", 69),
  H("HDFCBANK", 10, "large", "Financials", 68),
]);
console.log(`  Health ${book.health} (${book.band}) · Construction ${book.structure.toFixed(2)} · quality ${book.quality?.toFixed(2)} · signals ${book.signals}`);
near("Quality 71.2 (unchanged)", book.quality, 71.2, 0.05);
eq("Health = 71 (= Quality, Signals clean; structure term GONE)", book.health, 71);
eq("band Steady", book.band, "Steady");
near("Construction ≈ 86.1 (standalone Structure, full strength)", book.structure, 86.07, 0.05);
eq("no ceiling in the result shape (retired)", (book as unknown as Record<string, unknown>).ceilingApplied, undefined);

// ═══════════════════════════════════════════════════════════════════════════════
// ACCEPTANCE 3 — value-invariance. Portfolio VALUE never enters any number. Same book at
// ₹1L vs ₹50L → identical Health / Construction / pillarProfile; only capital_tier differs.
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ ACCEPTANCE 3 — value-invariance (₹1L vs ₹50L) ═══");
const PL: PillarSubtotals = { foundation: 72, momentum: 60, market: 55, ownership: 68 };
const bookAt = (u: number) => computePhs([
  H("A", 40 * u, "large", "IT", 78, [], PL), H("B", 35 * u, "large", "Energy", 66, [], PL), H("C", 25 * u, "large", "Auto", 70, [], PL),
]);
const cheap = bookAt(1_000), rich = bookAt(50_000); // ₹100,000 vs ₹5,000,000
eq("Health identical", cheap.health === rich.health, true);
eq("Construction identical", cheap.structure === rich.structure, true);
eq("pillarProfile identical", JSON.stringify(cheap.pillarProfile) === JSON.stringify(rich.pillarProfile), true);
eq("capital_tier DIFFERS: ₹1L Modest", cheap.capitalTier, "Modest");
eq("capital_tier DIFFERS: ₹50L Substantial", rich.capitalTier, "Substantial");

// ═══════════════════════════════════════════════════════════════════════════════
// ACCEPTANCE 4 — pillarProfile renormalizes over SCORED weight (Quality's denominator), not
// total. Book: A 60% + B 20% scored, U 20% unscored → the scored denominator is 0.80.
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ ACCEPTANCE 4 — pillarProfile renormalizes over scored weight ═══");
const pA: PillarSubtotals = { foundation: 80, momentum: 70, market: 60, ownership: 90 };
const pB: PillarSubtotals = { foundation: 40, momentum: 50, market: 30, ownership: 20 };
const pbook = computePhs([
  H("A", 60, "large", "IT", 75, [], pA),
  H("B", 20, "large", "Energy", 60, [], pB),
  H("U", 20, "large", "Auto", null), // recognized-unscored — excluded from Quality AND pillarProfile
]);
const pp = pbook.pillarProfile!;
console.log(`  pillarProfile = ${JSON.stringify(pp)}  (scored weight 0.80; renorm ÷0.80, NOT ÷1.0)`);
// foundation = (0.6×80 + 0.2×40) / 0.80 = 70  (÷total would give 56 — the wrong answer)
near("foundation renormalized over scored (70, not 56)", pp.foundation, 70, 1e-6);
near("momentum (65)", pp.momentum, 65, 1e-6);
near("market (52.5)", pp.market, 52.5, 1e-6);
near("ownership (72.5)", pp.ownership, 72.5, 1e-6);
eq("unscored book → pillarProfile null (no scored pillar data)", computePhs([H("X", 100, "large", "IT", null)]).pillarProfile, null);

// ═══════════════════════════════════════════════════════════════════════════════
// ACCEPTANCE 5 — lensProfile is findings-CHARACTER (position-weighted share by nature),
// null when no lens patterns fired. NEVER an attribution.
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ ACCEPTANCE 5 — lensProfile (findings-character; null when none) ═══");
const lbook = computePhs([
  H("A", 60, "large", "IT", 75, [], pA, ["peer", "peer"]),
  H("B", 40, "large", "Energy", 60, [], pB, ["trend"]),
]);
const lp = lbook.lensProfile!;
console.log(`  lensProfile = ${JSON.stringify(lp)}  (peer 0.6×2 + trend 0.4×1; total 1.6)`);
near("peer share = 0.75 (1.2 / 1.6)", lp.peer, 0.75, 1e-6);
near("trend share = 0.25 (0.4 / 1.6)", lp.trend, 0.25, 1e-6);
near("absolute share = 0", lp.absolute, 0, 1e-6);
near("shares sum to 1", lp.absolute + lp.peer + lp.trend, 1, 1e-9);
eq("no lens patterns fired → lensProfile null (never a fabricated split)",
  computePhs([H("A", 100, "large", "IT", 75, [], pA)]).lensProfile, null);

// ═══════════════════════════════════════════════════════════════════════════════
// SANITY — Health ≤ Quality (Signals penalty-only); a Signals hit pulls Health below Quality.
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n═══ Sanity (1.2) ═══");
const flagged = computePhs([H("A", 100, "large", "IT", 80, ["high"])]); // High red flag → Signals −80×1.0 = 20 → 80
console.log(`  single health-80 with a High flag → Signals ${flagged.signals} · Health ${flagged.health}`);
eq("Signals hit → Health < Quality (80 − 0.20×(100−20) = 64)", flagged.health, 64);
eq("Health ≤ Quality always", (flagged.health as number) <= (flagged.quality as number), true);
eq("clean book Health == Quality (no structure drag)", book.health, Math.round(book.quality as number));

console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
process.exit(failures === 0 ? 0 : 1);
