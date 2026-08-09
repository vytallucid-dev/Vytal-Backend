// FAMILY-N PROOF — pure fixture tests (NO DB). Runs the seven Family-N rules against
// hand-built FiringContexts to verify the Amendment §7 fixture list end-to-end:
//   • every N entry returns not_evaluable{reason} (never a bare null) on short history
//   • each not_evaluable reason token (negative_equity / no_debt / class_not_disclosed /
//     share_count_unavailable / pledging_not_disclosed / insufficient_*)
//   • N6 does NOT fire on a buyback (% rose, count flat) — the firewall
//   • N7 does NOT fire where a standing R1 cleared (Family-J known gap)
//   • N4 does NOT fire on a 40×→45× coverage drift (low-base gate)
//   • N3 returns not_evaluable{negative_equity} on negative net worth (never a pass)
//   • N5 defers to P1 when P1 leads the institutional read
//   • every N rule writes the EXACT §3 evidence keys, resolving {n} from its own evidence
//     with standing_since ABSENT from the FiringContext
//   • all seven registered in ALL_RULES; all carry magnitude:null + polarity:positive +
//     temporalClass:CONDITION explicitly
//   • rule-run-layer no-perturbation: N is purely additive (existing findings byte-identical)
//
//   npx tsx src/scripts/familyN-findings-proof.ts

import { ruleN1 } from "../scoring/findings/rules/n1-cash-backed-earnings.js";
import { ruleN2 } from "../scoring/findings/rules/n2-working-capital.js";
import { ruleN3 } from "../scoring/findings/rules/n3-deleveraging.js";
import { ruleN4 } from "../scoring/findings/rules/n4-coverage-strengthening.js";
import { ruleN5 } from "../scoring/findings/rules/n5-dual-institutional-build.js";
import { ruleN6 } from "../scoring/findings/rules/n6-promoter-accumulation.js";
import { ruleN7 } from "../scoring/findings/rules/n7-pledge-release.js";
import { ruleP1 } from "../scoring/findings/rules/p1-clean-rotation.js";
// Family N moved to the FILING pass with the other 20 filed-data rules (step 2). Registration is
// still MANDATORY — an unregistered rule never fires (the P2/P3 lesson) — the registry it must be
// in is simply the filing one now.
import { FILING_RULES, runFilingRules, type FilingRuleOutcome } from "../scoring/findings/engine.js";
import type { FilingRule } from "../scoring/findings/types.js";
import { isNotEvaluable, type FiringContext, type RuleResult, type FiredFinding } from "../scoring/findings/types.js";
import type { FoundationAnnual, MomentumQuarter } from "../scoring/metrics/types.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";

// ── tiny assert harness ──────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => { if (cond) { pass++; console.log(`  ✅ ${label}`); } else { fail++; console.log(`  ❌ ${label}`); } };
const describe = (r: RuleResult): string =>
  r === null ? "null(not_fired)" : isNotEvaluable(r) ? `not_evaluable{${r.reason}}` : `FIRED(${r.key})`;
const isNE = (r: RuleResult, reason: string, label: string) =>
  ok(isNotEvaluable(r) && r.reason === reason, `${label} → not_evaluable{${reason}}  [got ${describe(r)}]`);
const firedAs = (r: RuleResult): FiredFinding | null => (r && !isNotEvaluable(r) ? r : null);

// ── fixture builders ──────────────────────────────────────────────────────────────
function baseCtx(over: Partial<FiringContext>): FiringContext {
  return {
    stockId: "S", symbol: "TEST", periodKey: "FY26Q4", asOfDate: new Date(Date.UTC(2026, 2, 31)),
    industry: "non_financial", cutoff: null,
    current: {
      composite: 70, labelBand: "steady" as FiringContext["current"]["labelBand"],
      pillars: {
        foundation: { subtotal: 60, state: "scored" }, momentum: { subtotal: 60, state: "scored" },
        market: { subtotal: 60, state: "scored" }, ownership: { subtotal: 60, state: "scored" },
      },
    },
    priorSnapshots: [], shareholding: [], annualFundamentals: [], quarterlyOpm: null,
    quarterlyResults: [], daily: [], feeds: { insiderTxns: null, blockTxns: null, marketCapInrCr: null },
    sectorClass: null,
    ...over,
  };
}

function fa(fy: number, o: Partial<FoundationAnnual>): FoundationAnnual {
  return {
    fiscalYear: `FY${fy}`, fyOrdinal: fy,
    revenue: 1000, otherIncome: 5, financeCosts: 20, depreciation: 30,
    profitBeforeTax: 133, netProfit: 100,
    equityShareCapital: null, otherEquity: null, totalEquity: 1000,
    borrowingsCurrent: 0, borrowingsNoncurrent: 0, totalDebtStored: null,
    totalAssets: 2000, currentLiabilities: 100,
    tradeReceivablesCurrent: 100, tradeReceivablesNoncurrent: 0,
    propertyPlantAndEquipment: 500, capitalWorkInProgress: 0,
    cashFromOperating: 110, capex: null, cashFromFinancing: null, faceValueShare: 10,
    stored: { roce: null, roe: null, debtToEquity: null, interestCoverage: null, receivablesDays: null, assetTurnover: null, netWorth: null, operatingMargin: 15, ebitda: null },
    ...o,
  };
}

function mq(ord: number, o: Partial<MomentumQuarter>): MomentumQuarter {
  const fy = Math.floor(ord / 4), q = (ord % 4) + 1;
  return { fiscalYear: `FY${fy}`, quarter: `Q${q}`, qOrdinal: ord, revenue: 500, otherIncome: 5, interest: 10, depreciation: 20, profitBeforeTax: 50, netProfit: 35, operatingProfitStored: 55, ...o };
}

/** Consecutive quarterly filings ~3 months apart (isPriorQuarterGap = false). */
function oq(idx: number, o: Partial<OwnershipQuarter>): OwnershipQuarter {
  const fy = 24 + Math.floor(idx / 4), q = (idx % 4) + 1;
  return {
    asOnDate: new Date(Date.UTC(2015, idx * 3, 15)), quarter: `Q${q}`, fiscalYear: `FY${fy}`,
    promoterShares: 1000n, totalShares: 10000n, pledgedShares: 0n,
    promoterPct: 50, fiiPct: 10, diiPct: 10, retailPct: 30, ...o,
  };
}

console.log("════════ FAMILY-N PROOF (pure fixtures, no DB) ════════\n");

// ═══════════════════ 1 · REGISTRATION + CONTRACT ═══════════════════
console.log("── 1 · registration + rule-property contract ──");
const N_RULES: FilingRule[] = [ruleN1, ruleN2, ruleN3, ruleN4, ruleN5, ruleN6, ruleN7];
ok(N_RULES.length === 7, `Family N has 7 rules (${N_RULES.length})`);
for (const [name, r] of Object.entries({ ruleN1, ruleN2, ruleN3, ruleN4, ruleN5, ruleN6, ruleN7 })) {
  ok(FILING_RULES.includes(r), `${name} present in FILING_RULES`);
}

// ═══════════════════ 2 · POSITIVE FIRES + §3 EVIDENCE KEYS + PROPERTIES ═══════════════════
console.log("\n── 2 · positive fires: exact §3 evidence keys, magnitude:null, polarity:positive, CONDITION ──");

const N1_OK = baseCtx({ annualFundamentals: [
  fa(23, { netProfit: 100, cashFromOperating: 110, profitBeforeTax: 133, revenue: 1000 }),
  fa(24, { netProfit: 115, cashFromOperating: 130, profitBeforeTax: 153, revenue: 1100 }),
  fa(25, { netProfit: 132, cashFromOperating: 150, profitBeforeTax: 176, revenue: 1200 }),
  fa(26, { netProfit: 150, cashFromOperating: 165, profitBeforeTax: 200, revenue: 1300 }),
] });
const N2_OK = baseCtx({ annualFundamentals: [
  fa(24, { revenue: 1000, tradeReceivablesCurrent: 100 }),
  fa(25, { revenue: 1200, tradeReceivablesCurrent: 105 }),
  fa(26, { revenue: 1450, tradeReceivablesCurrent: 108 }),
] });
const N3_OK = baseCtx({ annualFundamentals: [
  fa(23, { totalEquity: 1000, borrowingsCurrent: 1000, borrowingsNoncurrent: 0 }),
  fa(24, { totalEquity: 1000, borrowingsCurrent: 800 }),
  fa(25, { totalEquity: 1000, borrowingsCurrent: 600 }),
  fa(26, { totalEquity: 1000, borrowingsCurrent: 400 }),
] });
const N4_OK = baseCtx({ quarterlyResults: [
  mq(0, { interest: 10, profitBeforeTax: 5 }), mq(1, { interest: 10, profitBeforeTax: 5 }),
  mq(2, { interest: 10, profitBeforeTax: 5 }), mq(3, { interest: 10, profitBeforeTax: 5 }),
  mq(4, { interest: 10, profitBeforeTax: 25 }), mq(5, { interest: 10, profitBeforeTax: 45 }),
] });
const N5_OK = baseCtx({ shareholding: [
  oq(0, { fiiPct: 10, diiPct: 10, promoterPct: 50 }),
  oq(1, { fiiPct: 10.6, diiPct: 10.7, promoterPct: 50 }),
] });
const N6_OK = baseCtx({ shareholding: [
  oq(0, { promoterShares: 1000n, totalShares: 10000n, promoterPct: 10.0 }),
  oq(1, { promoterShares: 1100n, totalShares: 10000n, promoterPct: 11.0 }),
  oq(2, { promoterShares: 1250n, totalShares: 10000n, promoterPct: 12.5 }),
] });
const N7_OK = baseCtx({ shareholding: [
  oq(0, { pledgedShares: 400n, promoterShares: 1000n }), // 40% (prior-prior)
  oq(1, { pledgedShares: 380n, promoterShares: 1000n }), // 38% (prior — R1 NOT standing)
  oq(2, { pledgedShares: 210n, promoterShares: 1000n }), // 21% (current)
] });

const fires: { rule: string; r: RuleResult; keys: string[]; nKey: string }[] = [
  { rule: "N1", r: ruleN1(N1_OK), keys: ["years"], nKey: "foundation_N1_cash_backed_earnings" },
  { rule: "N2", r: ruleN2(N2_OK), keys: ["years"], nKey: "foundation_N2_working_capital" },
  { rule: "N3", r: ruleN3(N3_OK), keys: ["years", "deFrom", "deTo"], nKey: "foundation_N3_deleveraging" },
  { rule: "N4", r: ruleN4(N4_OK), keys: ["quarters", "troughCoverage"], nKey: "foundation_N4_coverage_strengthening" },
  { rule: "N5", r: ruleN5(N5_OK), keys: ["fiiDeltaPp", "diiDeltaPp"], nKey: "ownership_N5_dual_institutional_build" },
  { rule: "N6", r: ruleN6(N6_OK), keys: ["quarters", "cumulativePp"], nKey: "ownership_N6_promoter_accumulation" },
  { rule: "N7", r: ruleN7(N7_OK), keys: ["pledgeFromPct", "pledgeToPct"], nKey: "ownership_N7_pledge_release" },
];
for (const t of fires) {
  const f = firedAs(t.r);
  ok(!!f, `${t.rule} fires on its valid fixture  [${describe(t.r)}]`);
  if (!f) continue;
  ok(f.key === t.nKey, `${t.rule} key = ${t.nKey}`);
  ok(f.kind === "pattern" && f.severity === "green", `${t.rule} kind=pattern severity=green`);
  ok(Object.prototype.hasOwnProperty.call(f, "magnitude") && f.magnitude === null, `${t.rule} magnitude === null (EXPLICIT)`);
  ok(f.polarity === "positive" && f.direction === "positive", `${t.rule} polarity=positive direction=positive`);
  ok(f.temporalClass === "CONDITION", `${t.rule} temporalClass = CONDITION`);
  const ev = f.evidence as Record<string, unknown>;
  ok(t.keys.every((k) => k in ev && ev[k] !== undefined), `${t.rule} evidence has §3 keys [${t.keys.join(", ")}] = ${t.keys.map((k) => `${k}:${ev[k]}`).join(", ")}`);
}
// {n} resolves from own evidence (standing_since is absent from FiringContext entirely)
{
  const n1 = firedAs(ruleN1(N1_OK))!, n3 = firedAs(ruleN3(N3_OK))!, n4 = firedAs(ruleN4(N4_OK))!, n6 = firedAs(ruleN6(N6_OK))!;
  ok((n1.evidence as any).years === 4, `N1 {n}=4 resolves from evidence.years (no standing_since)`);
  ok((n3.evidence as any).years === 3 && (n3.evidence as any).deFrom === 1 && (n3.evidence as any).deTo === 0.4, `N3 years=3 deFrom=1 deTo=0.4 from evidence`);
  ok((n4.evidence as any).quarters === 2 && (n4.evidence as any).troughCoverage === 1.5, `N4 quarters=2 troughCoverage=1.5 from evidence`);
  ok((n6.evidence as any).quarters === 2 && (n6.evidence as any).cumulativePp === 2.5, `N6 quarters=2 cumulativePp=2.5 from evidence`);
  ok(!("standing_since" in (N1_OK as object)), `FiringContext carries NO standing_since (duration is rule-internal, §4)`);
}

// ═══════════════════ 3 · SHORT HISTORY → not_evaluable (never a bare null) ═══════════════════
console.log("\n── 3 · short-history fixtures: not_evaluable{reason}, NEVER a bare null ──");
isNE(ruleN1(baseCtx({ annualFundamentals: [fa(25, {}), fa(26, {})] })), "insufficient_annual_history", "N1 (2 annual rows)");
isNE(ruleN2(baseCtx({ annualFundamentals: [fa(25, {}), fa(26, {})] })), "insufficient_annual_history", "N2 (2 annual rows)");
isNE(ruleN3(baseCtx({ annualFundamentals: [fa(24, {}), fa(25, {}), fa(26, {})] })), "insufficient_annual_history", "N3 (3 annual rows)");
isNE(ruleN4(baseCtx({ quarterlyResults: [mq(0, {}), mq(1, {}), mq(2, {}), mq(3, {}), mq(4, {})] })), "insufficient_quarters", "N4 (5 quarters)");
isNE(ruleN5(baseCtx({ shareholding: [oq(0, {})] })), "insufficient_shareholding_history", "N5 (1 shareholding row)");
isNE(ruleN6(baseCtx({ shareholding: [oq(0, {}), oq(1, {})] })), "insufficient_shareholding_history", "N6 (2 shareholding rows)");
isNE(ruleN7(baseCtx({ shareholding: [oq(0, {})] })), "insufficient_shareholding_history", "N7 (1 shareholding row)");

// ═══════════════════ 4 · THE OTHER not_evaluable REASONS (never a pass) ═══════════════════
console.log("\n── 4 · the disclosure/definition not_evaluable reasons (never a pass) ──");
// N3 negative equity (a period with net worth ≤ 0 in the assessed window)
isNE(ruleN3(baseCtx({ annualFundamentals: [
  fa(23, { totalEquity: 1000, borrowingsCurrent: 1000 }),
  fa(24, { totalEquity: -50, borrowingsCurrent: 800 }),
  fa(25, { totalEquity: 1000, borrowingsCurrent: 600 }),
  fa(26, { totalEquity: 1000, borrowingsCurrent: 400 }),
] })), "negative_equity", "N3 negative net worth");
// N4 debt-free (Σinterest ≤ 0)
isNE(ruleN4(baseCtx({ quarterlyResults: [0, 1, 2, 3, 4, 5].map((i) => mq(i, { interest: 0, profitBeforeTax: 100 })) })), "no_debt", "N4 debt-free");
// N5 class not disclosed (FII null)
isNE(ruleN5(baseCtx({ shareholding: [oq(0, { fiiPct: null }), oq(1, { fiiPct: null })] })), "class_not_disclosed", "N5 FII bucket null");
// N6 share count unavailable (firewall — must NOT fall back to %)
isNE(ruleN6(baseCtx({ shareholding: [oq(0, {}), oq(1, { promoterShares: null }), oq(2, {})] })), "share_count_unavailable", "N6 promoter count null");
// N7 pledging not disclosed
isNE(ruleN7(baseCtx({ shareholding: [oq(0, { pledgedShares: null }), oq(1, { pledgedShares: null })] })), "pledging_not_disclosed", "N7 pledge column absent");

// ═══════════════════ 5 · THE FALSE-FINDING GUARDS (must NOT fire) ═══════════════════
console.log("\n── 5 · the guards that prevent a FALSE finding (must return not_fired) ──");
// N6 buyback: promoter % rose because total shares shrank; absolute count FLAT → must not fire (not_fired, not not_evaluable)
{
  const r = ruleN6(baseCtx({ shareholding: [
    oq(0, { promoterShares: 1000n, totalShares: 10000n, promoterPct: 10.0 }),
    oq(1, { promoterShares: 1000n, totalShares: 9500n, promoterPct: 10.53 }),
    oq(2, { promoterShares: 1000n, totalShares: 9000n, promoterPct: 11.11 }),
  ] }));
  ok(r === null, `N6 buyback (% rose, count flat) → not_fired  [${describe(r)}]  (firewall: not read from %)`);
}
// N7 clearing a standing R1 (60→45): Family-J territory → must NOT fire (known gap until J ships)
{
  const r = ruleN7(baseCtx({ shareholding: [
    oq(0, { pledgedShares: 620n, promoterShares: 1000n }), // 62%
    oq(1, { pledgedShares: 600n, promoterShares: 1000n }), // 60% (R1 STANDING)
    oq(2, { pledgedShares: 450n, promoterShares: 1000n }), // 45%
  ] }));
  ok(r === null, `N7 fall clearing a standing R1 (60%→45%) → not_fired  [${describe(r)}]  (Family-J known gap)`);
}
// N7 crossing below 50 from above (51→49): also clears a standing R1 → must NOT fire
{
  const r = ruleN7(baseCtx({ shareholding: [
    oq(0, { pledgedShares: 520n, promoterShares: 1000n }), // 52%
    oq(1, { pledgedShares: 510n, promoterShares: 1000n }), // 51% (R1 STANDING)
    oq(2, { pledgedShares: 490n, promoterShares: 1000n }), // 49%
  ] }));
  ok(r === null, `N7 crossing below 50% from above (51%→49%) → not_fired  [${describe(r)}]  (Family-J known gap)`);
}
// N4 40×→45× drift: rising but trough already comfortable (≥3.0×) → must NOT fire
{
  const r = ruleN4(baseCtx({ quarterlyResults: [
    mq(0, { interest: 10, profitBeforeTax: 200 }), mq(1, { interest: 10, profitBeforeTax: 200 }),
    mq(2, { interest: 10, profitBeforeTax: 200 }), mq(3, { interest: 10, profitBeforeTax: 200 }),
    mq(4, { interest: 10, profitBeforeTax: 300 }), mq(5, { interest: 10, profitBeforeTax: 400 }),
  ] }));
  ok(r === null, `N4 comfortable coverage rising (trough ≥ 3.0×) → not_fired  [${describe(r)}]  (low-base gate)`);
}

// ═══════════════════ 6 · N5 PRECEDENCE OVER P1 ═══════════════════
console.log("\n── 6 · N5 defers to P1 when P1 leads the institutional read ──");
{
  // A clean-rotation quarter: DII ↑1.5, FII ↓0.2, promoter flat → P1 (B1) fires.
  const rot = baseCtx({ shareholding: [
    oq(0, { fiiPct: 10.0, diiPct: 10.0, promoterPct: 50 }),
    oq(1, { fiiPct: 9.8, diiPct: 11.5, promoterPct: 50 }),
  ] });
  const p1 = firedAs(ruleP1(rot));
  const n5 = ruleN5(rot);
  ok(!!p1 && p1.key === "ownership_P1_clean_rotation", `P1 fires on the rotation quarter`);
  ok(n5 === null, `N5 stays silent on the same quarter → P1 leads  [${describe(n5)}]`);
  // (Under current thresholds N5's own trigger (FII↑≥0.5) and P1's B1 (FII↓) are mutually
  //  exclusive, so this is the reachable form of the precedence; the explicit B1 guard in N5
  //  is defensive for any future threshold change.)
}

// ═══════════════════ 7 · NO PERTURBATION (rule-run layer) ═══════════════════
console.log("\n── 7 · N is purely additive: existing findings byte-identical with/without Family N ──");
{
  // A ctx that fires an EXISTING rule (P1) and an N rule (N1) together.
  const combined = baseCtx({
    shareholding: [oq(0, { fiiPct: 10.0, diiPct: 10.0, promoterPct: 50 }), oq(1, { fiiPct: 9.8, diiPct: 11.5, promoterPct: 50 })],
    annualFundamentals: N1_OK.annualFundamentals,
  });
  // Both runs go through the FILING runner now, and its outcome list carries not_fired/
  // not_evaluable too — the A/B still compares only the FIRED sets, which is what "purely
  // additive" was ever a claim about.
  const firedOf = (os: FilingRuleOutcome[]) => os.filter((o) => o.state === "fired").map((o) => o.finding!);
  const nonNRules = FILING_RULES.filter((r) => !N_RULES.includes(r));
  const withN = firedOf(runFilingRules(combined, FILING_RULES));
  const withoutN = firedOf(runFilingRules(combined, nonNRules));
  const isN = (f: FiredFinding) => /_N[1-7]_/.test(f.key);
  const nonNfromFull = withN.filter((f) => !isN(f));
  ok(withN.some(isN), `Family-N findings ARE produced (additive)  [${withN.filter(isN).map((f) => f.key).join(", ")}]`);
  ok(JSON.stringify(nonNfromFull) === JSON.stringify(withoutN), `every non-N finding byte-identical with/without Family N  [${withoutN.map((f) => f.key).join(", ") || "—"}]`);
  ok(withN.filter(isN).every((f) => f.magnitude === null), `all fired N findings carry magnitude:null (no score to move)`);
}

// ── summary ──
console.log(`\n════════ RESULT: ${pass} passed, ${fail} failed ════════`);
process.exit(fail === 0 ? 0 : 1);
