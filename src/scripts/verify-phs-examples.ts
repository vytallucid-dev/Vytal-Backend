// ─────────────────────────────────────────────────────────────────────────────
// PHS ENGINE VERIFICATION — reproduce the spec's four worked examples (§A.10) to
// their stated pillar + PHS numbers. Pure engine (inputs supplied directly).
//   npx tsx src/scripts/verify-phs-examples.ts
// ─────────────────────────────────────────────────────────────────────────────
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import * as K from "../portfolio/phs/constants.js";

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
const H = (symbol: string, marketValue: number, tier: PhsHolding["tier"], sector: string | null, health: number | null, findings: PhsHolding["findings"] = []): PhsHolding =>
  ({ symbol, marketValue, tier, sector, health, findings });

// ── Example 1 — typical retail book ──
console.log("\n═══ Example 1 — typical retail book (spec: Q72.3 · Str92.5 · Sig93.0 · PHS 69 Steady · c0.62) ═══");
const e1 = computePhs([
  H("HDFCBANK", 20, "large", "Financials", 74), H("TCS", 13, "large", "IT", 71),
  H("BEL", 11, "large", "Defense", 78), H("SBIN", 10, "large", "Financials", 66, ["medium"]),
  H("RELIANCE", 8, "large", "Energy", 70, ["lp5"]),
  H("TATAMOTORS", 12, "large", "Auto", null), H("ZOMATO", 8, "large", "Consumer", null),
  H("SMALLIT", 10, "small", "IT", null), H("SMALLY", 5, "small", null, null), H("MICROZ", 3, "small", null, null),
]);
near("Quality", e1.quality, 72.27, 0.02); near("Structure", e1.structure, 92.5); near("Signals", e1.signals, 93.0);
near("coverage", e1.coverage, 0.62); near("phsRaw", e1.phsRaw, 68.62, 0.02); eq("PHS", e1.phs, 69); eq("band", e1.band, "Steady");

// ── Example 2 — concentration + blindness (ENGINE-CORRECT: Σw²=0.28 → PHS 57) ──
console.log("\n═══ Example 2 — multibagger believer (engine-correct: Q72.4 · Str47.3 · Sig100 · PHS 57 Mixed · c0.40) ═══");
const e2 = computePhs([
  H("SMALLX", 45, "small", null, null), H("OTHER", 15, "small", null, null),
  H("RIL", 15, "large", "Energy", 70), H("TCS", 15, "large", "IT", 71), H("BEL", 10, "large", "Defense", 78),
]);
near("Quality", e2.quality, 72.375, 0.01); near("Neff", e2.neff, 3.571, 0.005); near("Structure", e2.structure, 47.286, 0.02);
near("Signals", e2.signals, 100); eq("S2 evaluable (unknown 60% > 50%)", e2.s2Evaluable, false);
near("coverage", e2.coverage, 0.4); near("phsRaw", e2.phsRaw, 56.561, 0.02); eq("PHS (correct arithmetic)", e2.phs, 57); eq("band", e2.band, "Mixed");

// Ex2 DUAL-TRACE — prove the engine gives 57 on correct Σw²=0.28, and 56 ONLY on the spec's typo Σw²=0.29.
console.log("  ── Ex2 dual-trace (formula + constants held fixed; only Σw² varies) ──");
function ex2Trace(sumW2: number) {
  const neff = 1 / sumW2;
  const s3 = Math.min(K.S3_RATE * (K.S3_TARGET - neff), K.S3_CAP);
  const structure = 100 - K.S1_CAP /*S1 45%→cap25*/ - s3 - K.S5_PER /*S5 45%→10*/;
  const quality = 2895 / 40; // 72.375
  const phsRaw = quality - K.W_STRUCT * (100 - structure);
  return { neff, s3, structure, phsRaw, phs: Math.round(phsRaw) };
}
const correct = ex2Trace(0.28), typo = ex2Trace(0.29);
console.log(`    correct Σw²=0.28 → Neff ${correct.neff.toFixed(3)} · S3 −${correct.s3.toFixed(2)} · Str ${correct.structure.toFixed(2)} · phsRaw ${correct.phsRaw.toFixed(3)} → PHS ${correct.phs}`);
console.log(`    spec's  Σw²=0.29 → Neff ${typo.neff.toFixed(3)} · S3 −${typo.s3.toFixed(2)} · Str ${typo.structure.toFixed(2)} · phsRaw ${typo.phsRaw.toFixed(3)} → PHS ${typo.phs}`);
eq("dual-trace: correct→57", correct.phs, 57); eq("dual-trace: spec-typo→56 (reproduces spec's stated 56)", typo.phs, 56);

// ── Example 3 — clean fully-covered book ──
console.log("\n═══ Example 3 — clean, fully-covered (spec: Q72 · Str100 · Sig93.6 · PHS 71 Steady · c1.0) ═══");
const e3: PhsHolding[] = [H("FLAG", 8, "large", "Sec0", 72, ["high", "lp5"])]; // High headline suppresses LP5 → −80×0.08
for (let i = 1; i <= 11; i++) e3.push(H(`H${i}`, 92 / 11, "large", `Sec${i}`, 72));
const r3 = computePhs(e3);
near("Quality", r3.quality, 72.0, 0.001); near("Structure", r3.structure, 100); near("Signals", r3.signals, 93.6, 0.001);
near("coverage", r3.coverage, 1.0); near("phsRaw", r3.phsRaw, 70.72, 0.01); eq("PHS", r3.phs, 71); eq("band", r3.band, "Steady"); eq("ceiling applied", r3.ceilingApplied, false);

// ── Example 4 — stress: 1 of 10 scored → coverage ceiling binds ──
console.log("\n═══ Example 4 — 1 of 10 scored (spec: Q80 · ceiling 44 binds · PHS 44 Provisional · c0.10) ═══");
const e4: PhsHolding[] = [H("SCORED", 10, "large", "SecA", 80)];
for (let i = 1; i <= 9; i++) e4.push(H(`U${i}`, 10, "large", `SecU${i}`, null)); // recognized-unscored, clean
const r4 = computePhs(e4);
near("Quality", r4.quality, 80); near("Structure", r4.structure, 100); near("Signals", r4.signals, 100);
near("coverage", r4.coverage, 0.1); near("phsRaw", r4.phsRaw, 80, 0.001);
eq("ceiling value", r4.ceilingValue, 44); eq("ceiling applied", r4.ceilingApplied, true); eq("PHS (capped)", r4.phs, 44);
eq("band", r4.band, "Fragile"); eq("provisional (c<0.40)", r4.provisional, true);

// ── Sanity invariants (§A.10) ──
console.log("\n═══ Sanity invariants (§A.10) ═══");
// Core invariant: a portfolio is never safer than its lone holding (< its own health).
// Spec's "~56 (S3 thin-breadth drag)" isolates S1+S3 and implicitly assumes NO S2 — i.e.
// an unknown-sector holding (S2 not evaluable). A KNOWN-sector single-stock book is 100%
// in one sector > 40%, so S2 ALSO fires (−25) → 49. Both are < 70; the engine is correct
// on both. (This is a third small spec hand-calc imprecision, alongside Ex1/Ex2.)
const singleUnknownSector = computePhs([H("ONE", 100, "large", null, 70)]); // S2 n/a → S1+S3 only
const singleKnownSector = computePhs([H("ONE", 100, "large", "Fin", 70)]); // S2 also fires
console.log(`    single health-70, UNKNOWN sector (S1+S3, spec's ~56) → phsRaw ${singleUnknownSector.phsRaw?.toFixed(2)}`);
console.log(`    single health-70, KNOWN sector   (S1+S2+S3, full rules) → phsRaw ${singleKnownSector.phsRaw?.toFixed(2)}`);
eq("single-stock (unknown-sector) below its 70", singleUnknownSector.phsRaw != null && singleUnknownSector.phsRaw < 70, true);
near("single-stock (unknown-sector) ≈ spec's ~56", singleUnknownSector.phsRaw, 56.5, 0.6);
eq("single-stock (known-sector) below its 70", singleKnownSector.phsRaw != null && singleKnownSector.phsRaw < 70, true);
const perfect = computePhs(Array.from({ length: 12 }, (_, i) => H(`P${i}`, 100 / 12, "large", `PS${i}`, 72)));
near("perfectly-built health-72 book ≈ 72 (not inflated)", perfect.phsRaw, 72, 0.5);
eq("PHS ≤ Quality (penalty-only guarantee)", perfect.phs! <= (perfect.quality as number) + 1e-9, true);

console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
process.exit(failures === 0 ? 0 : 1);
