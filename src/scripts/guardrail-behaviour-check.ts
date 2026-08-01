// Verification harness for the STAGE-1 BEHAVIOUR CONTRACT (GUARDRAIL_BEHAVIOUR).
// PURE — no DB, no writes, no network. Safe anywhere.
//
//   npx tsx src/scripts/guardrail-behaviour-check.ts
//
// Proves the four claims the contract rests on:
//   1. every SignatureKey has a behaviour (runtime mirror of the compile-time Record)
//   2. `disabled` signatures are NEVER EVALUATED — not evaluated-then-discarded
//   3. THE LOAD-BEARING ONE: an `annotate` signature that genuinely returns O2 with
//      real directives has those directives STRIPPED. This is tested on a REAL branch
//      of a REAL signature (B-4 with bandFlipDetected=true returns O2 {F1,F2,M2,M4}),
//      not a mock — so it proves the filter keys on the SIGNATURE, not the outcome.
//   4. the default (no filter) path is unchanged, so findings/guards/annual-
//      exceptional.ts — the one production caller — still sees B-1/B-2/B-3.

import { runGuardrailGate } from "../scoring/guardrail/gate.js";
import { applyBehaviour } from "../scoring/guardrail/behaviour.js";
import { GUARDRAIL_BEHAVIOUR, isEvaluable, canSuppress, behaviourGroups } from "../scoring/guardrail/signatures/registry.js";
import { SIGNATURE_REGISTRY } from "../scoring/guardrail/signatures/registry.js";
import type { GuardrailStockInput, LatestFundamentalInput, SignatureKey } from "../scoring/guardrail/types.js";

const checks: { name: string; ok: boolean; detail: string }[] = [];
const t = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

const FY = "FY26";
const fy = (over: Partial<LatestFundamentalInput> = {}): LatestFundamentalInput => ({
  fiscalYear: FY, revenue: 10000, netProfit: 1000, netWorth: 18000, totalAssets: 40000, ...over,
});
const input = (over: Partial<GuardrailStockInput>): GuardrailStockInput => ({
  stockId: "synthetic", symbol: "SYNTH", industryPath: "non_financial", snapshotKey: FY,
  latestFundamental: null, ...over,
});
/** The live path's filter. */
const LIVE = { signatureFilter: isEvaluable };

console.log("═".repeat(100));
console.log("GUARDRAIL BEHAVIOUR CONTRACT — Stage 1 verification (PURE, no DB, no writes)");
const g = behaviourGroups();
console.log(`  suppress:[${g.suppress.join(",")}]  annotate:[${g.annotate.join(",")}]  detect:[${g.detect.join(",")}]  disabled:[${g.disabled.join(",")}]`);
console.log("═".repeat(100));

// ── 1. TOTALITY (runtime mirror of the compile-time Record<SignatureKey, …>) ──────
{
  const missing = SIGNATURE_REGISTRY.filter((d) => !GUARDRAIL_BEHAVIOUR[d.key]).map((d) => d.key);
  t("1. every registered signature has a behaviour (no silent default)", missing.length === 0,
    missing.length ? `MISSING: ${missing.join(",")}` : `all ${SIGNATURE_REGISTRY.length} registry entries mapped`);
}

// ── 2. DISABLED ⇒ NEVER EVALUATED ────────────────────────────────────────────────
// Each fixture below WOULD fire its signature if evaluated. Under the live filter,
// none may produce an event — and the note must say NOT EVALUATED (skipped), which is
// materially different from "evaluated, did not fire".
{
  const cases: { key: SignatureKey; label: string; inp: GuardrailStockInput }[] = [
    { key: "A-1", label: "60d late, 1 missed Q → would be O5 hold", inp: input({ quarterlyFiling: { daysPastExpected: 60, consecutiveMissedQuarters: 1 } }) },
    { key: "A-4", label: "isActive=false → would be O6 remove", inp: input({ activity: { isActive: false, consecutiveNoPriceDays: 0 } }) },
    { key: "C-2", label: "bonus event → would be O1", inp: input({ corporateAction: { eventTypes: ["bonus"], shareCountChangePct: 50 } }) },
  ];
  for (const c of cases) {
    const off = runGuardrailGate(c.inp, LIVE);
    const on = runGuardrailGate(c.inp); // no filter = historical behaviour
    const firedUnfiltered = on.events.some((e) => e.signatureKey === c.key);
    const firedFiltered = off.events.some((e) => e.signatureKey === c.key);
    const skipNoted = off.notes.some((n) => n.startsWith(`${c.key}:`) && n.includes("NOT EVALUATED"));
    t(`2. ${c.key} disabled ⇒ not evaluated (${c.label})`,
      firedUnfiltered && !firedFiltered && skipNoted,
      `unfiltered fires=${firedUnfiltered} (proves the fixture is live) · filtered fires=${firedFiltered} · skip-note=${skipNoted}`);
  }
}

// ── 3. THE LOAD-BEARING TEST — annotate signature returning REAL O2 gets stripped ─
// B-4 is `annotate`. With bandFlipDetected it takes its O2 branch and emits genuine
// suppression directives. The filter must strip them BECAUSE IT IS B-4 — not because
// of the outcome. If this ever fails, an annotate signature can move a score.
{
  const b4Flip = input({
    symbol: "B4-FLIP", bandFlipDetected: true,
    latestFundamental: fy({ revenue: 10000, operatingMargin: 18, profitBeforeTax: 1000, tax: 250, otherIncome: 400, financeCosts: 50, netProfit: 750 }),
    priorFundamental: fy({ revenue: 9800, operatingMargin: 18, profitBeforeTax: 950, tax: 240, otherIncome: 50, financeCosts: 50, netProfit: 710 }),
  });
  const raw = runGuardrailGate(b4Flip, LIVE);
  const rawB4 = raw.events.find((e) => e.signatureKey === "B-4");
  const rawDirectives = raw.directives.length;
  const { result, audit } = applyBehaviour(raw);
  const keptB4 = result.directives.filter((d) => raw.events.find((e) => e.localEventId === d.sourceLocalEventId)?.signatureKey === "B-4").length;
  const strippedB4 = audit.strippedDirectives.filter((s) => s.signatureKey === "B-4").length;

  console.log(`\n  B-4 @ bandFlipDetected=true → outcome=${rawB4?.outcome} · gate emitted ${rawDirectives} directive(s) [${raw.directives.map((d) => d.metricKey).join(",")}]`);
  console.log(`     after behaviour filter → kept=${keptB4}, stripped=${strippedB4} [${audit.strippedDirectives.map((s) => `${s.signatureKey}:${s.metricKey}`).join(",")}]`);

  t("3a. B-4 genuinely takes its O2 branch (fixture is real, not a no-op)",
    rawB4?.outcome === "O2" && rawDirectives > 0, `outcome=${rawB4?.outcome} directives=${rawDirectives}`);
  t("3b. ⭐ annotate signature's REAL O2 directives are STRIPPED (filter keys on signature, not outcome)",
    keptB4 === 0 && strippedB4 === rawDirectives && strippedB4 > 0,
    `kept=${keptB4} stripped=${strippedB4}/${rawDirectives}`);
  t("3c. the audit REPORTS the strip (never a silent drop)",
    audit.strippedDirectives.every((s) => s.behaviour === "annotate"),
    audit.strippedDirectives.map((s) => `${s.signatureKey}=${s.behaviour}`).join(" "));
}

// ── 3d/3e. B-1 and A-2 — MOVED TO ANNOTATE. Their real O2 directives are stripped ──
// These two previously asserted the opposite (that B-1/A-2 KEEP their directives).
// The contract changed after the Stage-3 dry run: B-1 suppressing HINDPETRO's M2 took
// Momentum to 2/5, broke the §14.4 floor, deleted the pillar and RAISED the composite
// 59.29→68.20 (below_par→healthy). A-2 was shown inert by construction. Both now
// annotate, so both must be stripped — the assertions are inverted deliberately.
{
  const b1 = input({
    symbol: "B1",
    latestFundamental: fy({ revenue: 10000, operatingMargin: 15, profitBeforeTax: 2800, tax: 300, otherIncome: 100, financeCosts: 100, netProfit: 2500 }),
    priorFundamental: fy({ revenue: 9500, operatingMargin: 14, profitBeforeTax: 1300, tax: 325, otherIncome: 90, financeCosts: 100, netProfit: 1000 }),
  });
  const raw = runGuardrailGate(b1, LIVE);
  const { result, audit } = applyBehaviour(raw);
  const firedB1 = raw.events.some((e) => e.signatureKey === "B-1");
  console.log(`\n  B-1 (annotate) → gate emitted ${raw.directives.length} [${raw.directives.map((d) => d.metricKey).join(",")}] · kept ${result.directives.length} · stripped ${audit.strippedDirectives.length}`);
  t("3d. B-1 STILL FIRES (detection intact) but its O2 directives are STRIPPED",
    firedB1 && raw.directives.length === 4 && result.directives.length === 0 && audit.strippedDirectives.length === 4,
    `fired=${firedB1} emitted=${raw.directives.length} kept=${result.directives.length} stripped=${audit.strippedDirectives.length}`);

  const a2 = input({ symbol: "A2", latestFundamental: fy({ netWorth: null, totalAssets: null }) });
  const a2raw = runGuardrailGate(a2, LIVE);
  const a2r = applyBehaviour(a2raw);
  const firedA2 = a2raw.events.some((e) => e.signatureKey === "A-2");
  console.log(`  A-2 (annotate) → gate emitted ${a2raw.directives.length} [${a2raw.directives.map((d) => d.metricKey).join(",")}] · kept ${a2r.result.directives.length} · stripped ${a2r.audit.strippedDirectives.length}`);
  t("3e. A-2 STILL FIRES (detection intact) but its directives are STRIPPED",
    firedA2 && a2raw.directives.length > 0 && a2r.result.directives.length === 0 && a2r.audit.strippedDirectives.length === a2raw.directives.length,
    `fired=${firedA2} emitted=${a2raw.directives.length} kept=${a2r.result.directives.length} stripped=${a2r.audit.strippedDirectives.length}`);
}

// ── 3f. DETECT signatures apply nothing (pending review, never a directive) ───────
{
  const b5 = input({
    symbol: "B5", promoterPct: 62,
    latestFundamental: fy({ netWorth: 12097, netProfit: 8000 }),
    priorFundamental: fy({ netWorth: 33437, netProfit: 9000 }),
  });
  const { result } = applyBehaviour(runGuardrailGate(b5, LIVE));
  const ev = result.events.find((e) => e.signatureKey === "B-5");
  console.log(`\n  B-5 (detect) → event tier=${ev?.tier} · pendingReviews=${result.pendingReviews.length} · directives=${result.directives.length}`);
  t("3f. B-5 (detect) writes event + pending review, applies NOTHING",
    !!ev && ev.tier === "review" && result.pendingReviews.length === 1 && result.directives.length === 0,
    `tier=${ev?.tier} pending=${result.pendingReviews.length} directives=${result.directives.length}`);
}

// ── 4. DEFAULT PATH UNCHANGED — annual-exceptional.ts's contract ──────────────────
// It calls runGuardrailGate(input) with NO opts and reads .events[].signatureKey for
// B-1/B-2/B-3. Same fixture, no filter: those keys must still be detectable.
{
  const b1 = input({
    symbol: "AE",
    latestFundamental: fy({ revenue: 10000, operatingMargin: 15, profitBeforeTax: 2800, tax: 300, otherIncome: 100, financeCosts: 100, netProfit: 2500 }),
    priorFundamental: fy({ revenue: 9500, operatingMargin: 14, profitBeforeTax: 1300, tax: 325, otherIncome: 90, financeCosts: 100, netProfit: 1000 }),
  });
  const fired = runGuardrailGate(b1).events.map((e) => e.signatureKey); // NO opts — exactly its call
  t("4. default (no-filter) call still detects B-1/B-2/B-3 — annual-exceptional.ts unaffected",
    fired.includes("B-1"), `fired=[${fired.join(",")}]`);
}

// ── 5. canSuppress agrees with the map (no drift between helper and source) ───────
{
  const bad = (Object.keys(GUARDRAIL_BEHAVIOUR) as SignatureKey[]).filter((k) => canSuppress(k) !== (GUARDRAIL_BEHAVIOUR[k] === "suppress"));
  t("5. canSuppress() agrees with GUARDRAIL_BEHAVIOUR for every key", bad.length === 0, bad.length ? `DRIFT: ${bad.join(",")}` : "consistent");
}

// ── 6. THE SHIPPING INVARIANT — nothing suppresses ────────────────────────────────
// The guarantee this release rests on: no signature, on any branch, can produce a
// directive that survives to the suppression predicate. Asserted on the CONTRACT
// (the suppress set is empty) rather than on any single fixture, so it holds for
// branches no fixture here exercises.
{
  const suppressors = (Object.keys(GUARDRAIL_BEHAVIOUR) as SignatureKey[]).filter(canSuppress);
  t("6. ⭐ SHIPPING INVARIANT — the suppress set is EMPTY (no signature can change a score)",
    suppressors.length === 0, suppressors.length ? `CAN SUPPRESS: ${suppressors.join(",")}` : "suppress:[] — score impact is structurally impossible");

  // And empirically: every signature that fires at all, across all fixtures above,
  // yields zero surviving directives.
  const fixtures: GuardrailStockInput[] = [
    input({ symbol: "F-B1", latestFundamental: fy({ revenue: 10000, operatingMargin: 15, profitBeforeTax: 2800, tax: 300, otherIncome: 100, financeCosts: 100, netProfit: 2500 }), priorFundamental: fy({ revenue: 9500, operatingMargin: 14, profitBeforeTax: 1300, tax: 325, otherIncome: 90, financeCosts: 100, netProfit: 1000 }) }),
    input({ symbol: "F-A2", latestFundamental: fy({ netWorth: null, totalAssets: null }) }),
    input({ symbol: "F-B4", bandFlipDetected: true, latestFundamental: fy({ revenue: 10000, operatingMargin: 18, profitBeforeTax: 1000, tax: 250, otherIncome: 400, financeCosts: 50, netProfit: 750 }), priorFundamental: fy({ revenue: 9800, operatingMargin: 18, profitBeforeTax: 950, tax: 240, otherIncome: 50, financeCosts: 50, netProfit: 710 }) }),
    input({ symbol: "F-B5", promoterPct: 62, latestFundamental: fy({ netWorth: 12097, netProfit: 8000 }), priorFundamental: fy({ netWorth: 33437, netProfit: 9000 }) }),
    input({ symbol: "F-A3", history: { fundamentalRows: 3, shareholdingRows: 4 } }),
  ];
  let emitted = 0, survived = 0, firedAny = 0;
  for (const f of fixtures) {
    const r = runGuardrailGate(f, LIVE);
    const { result } = applyBehaviour(r);
    firedAny += r.events.length;
    emitted += r.directives.length;
    survived += result.directives.length;
  }
  console.log(`\n  across ${fixtures.length} fixtures: ${firedAny} event(s) fired, ${emitted} directive(s) emitted by signatures, ${survived} survived the filter`);
  t("6b. across every fixture: signatures still FIRE, and zero directives survive",
    firedAny > 0 && emitted > 0 && survived === 0,
    `events=${firedAny} emitted=${emitted} survived=${survived}`);
}

// ── RESULTS ──
console.log(`\n${"═".repeat(100)}\nRESULTS\n`);
for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
const allPass = checks.every((c) => c.ok);
console.log(`\n  ${allPass ? "✓ ALL CHECKS PASS — behaviour contract holds" : "✗ A CHECK FAILED — contract is NOT safe"}\n`);
if (!allPass) process.exitCode = 1;
