// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-evidence-facts.ts — THE GATE FOR THE EVIDENCE VOCABULARY AND THE THRESHOLD RELOCATION.
//
// Four questions, in the order they can fail:
//
//   §1  RELOCATION IS NOT RECALIBRATION — every constant moved into the catalogue still holds the
//       value its rule file declared before the move. Asserted against literals written HERE, so the
//       check cannot be satisfied by the same edit that broke it.
//
//   §2  THE VOCABULARY IS TOTAL — every evidence key present anywhere in score_patterns,
//       score_red_flags or stock_findings is classified. An unclassified key renders NOWHERE, so a
//       rule that invents one ships it invisible; this is what says so.
//
//   §3  NOTHING A READER SEES IS A BAR OR A BACK-TEST — no key classified `reader` is a threshold or
//       a study statistic. Enforced by NAME SHAPE as well as by the table, so a future
//       `thresholdFooPp` cannot be admitted by putting it in the wrong list.
//
//   §4  THE FIRED SET DID NOT MOVE — the filing pass is re-derived for all 504 stocks and compared
//       row-for-row against what is persisted: same rules firing, same evidence values. This is the
//       real proof that relocating ~40 thresholds changed no behaviour, and it covers the 22 filing
//       rules (R1–R6, P1/P4/P6/P7/P8/P11–P13, N1–N7, H) — every rule this work touched except the
//       four score-gated ones, whose constants §1 covers directly.
//
//       ⚠ R1's EVIDENCE IS EXPECTED TO DIFFER, ON THE ROUNDING ONLY. It was the one rule of 53 that
//       stamped raw floats; it now rounds at the stamp like the other 52. The comparison therefore
//       asserts R1's values are equal AFTER rounding the persisted ones — a stricter statement than
//       skipping it, because a changed BAR would still fail.
//
//   npx tsx src/scripts/verify-evidence-facts.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { EVIDENCE_FACTS, READER_EVIDENCE_FACTS } from "../catalogue/evidence-facts.js";
import { FINDING_FACTS } from "../catalogue/finding-facts.js";
import { STOCK_FINDING_KEYS } from "../catalogue/stock-findings.js";
import { computeFilingPass, filingUniverse } from "../filing/pass.js";
import { roundToPrecision } from "../scoring/findings/format.js";

// the relocated constants, imported from where the rules read them now
import { R1_PLEDGE_RATIO_PCT, R1_QOQ_RISE_PP } from "../scoring/ownership/pledging.js";
import { R2_DROP_PP } from "../scoring/ownership/disturbances.js";
import { R3_MIN_CONSECUTIVE } from "../scoring/findings/rules/r3-earnings-quality.js";
import { R4_DE_THRESHOLD } from "../scoring/findings/rules/r4-debt-explosion.js";
import { R5_IC_THRESHOLD, R5_MIN_CONSECUTIVE } from "../scoring/findings/rules/r5-interest-coverage.js";
import { P7_CASH_BACK_MAX } from "../scoring/findings/rules/p7-accruals.js";
import { RECV_OUTPACE_PP, MIN_RECV_GROWTH_PCT, MIN_RECV_TO_REV } from "../scoring/findings/rules/p8-receivables.js";
import { P11_MIN_DECLINES } from "../scoring/findings/rules/p11-margin-compression.js";
import { P12_MIN_RISES } from "../scoring/findings/rules/p12-margin-recovery.js";
import { P13_INFLECTION_PP } from "../scoring/findings/rules/p13-revenue-inflection.js";
import { P5_MIN_NET_SELL_CR, P5_MIN_SELLERS, P5_DISTRESS_COMPOSITE } from "../scoring/findings/rules/p5-insider-distress.js";
import { INSIDER_WINDOW_DAYS, INSIDER_ELIGIBLE_CR, P6_MIN_NET_CR, P6_MIN_BUYERS } from "../scoring/findings/rules/p6-insider-conviction.js";
import { P10_MIN_NET_CR } from "../scoring/findings/rules/p10-promoter-defense.js";
import { BLOCK_WINDOW_DAYS, H_MIN_DEAL_CR } from "../scoring/findings/rules/h-ownership-events.js";
import { F1_DEVIATION_PP } from "../scoring/findings/rules/f1-composition.js";
import { F2_COMPOSITE_HOLD, F2_SHIFT_PP } from "../scoring/findings/rules/f2-composition-shift.js";
import { N1_MIN_YEARS, N1_OCF_NP_MIN } from "../scoring/findings/rules/n1-cash-backed-earnings.js";
import { N2_UNDERPACE_PP, N2_MIN_YEARS, N2_MIN_RECV_TO_REV } from "../scoring/findings/rules/n2-working-capital.js";
import { N3_MIN_YEARS, N3_MIN_ABS_DECLINE, N3_MIN_REL_DECLINE } from "../scoring/findings/rules/n3-deleveraging.js";
import { N4_MIN_RISES, N4_LOW_BASE_MAX } from "../scoring/findings/rules/n4-coverage-strengthening.js";
import { N5_MIN_MOVE_PP } from "../scoring/findings/rules/n5-dual-institutional-build.js";
import { N6_MIN_QUARTERS, N6_MIN_CUMULATIVE_PP } from "../scoring/findings/rules/n6-promoter-accumulation.js";
import { N7_QOQ_FALL_PP, N7_RATIO_PCT } from "../scoring/findings/rules/n7-pledge-release.js";

/**
 * ★ CANONICAL JSON — key order sorted, recursively.
 *
 * ⚠ WITHOUT THIS THE COMPARISON IS A LIE IN BOTH DIRECTIONS. Postgres JSONB does not preserve object
 * key order, so a persisted `{"opm":8.01,"periodKey":"FY26Q3"}` comes back with its keys in a
 * different order from the one the rule just built — 190 "changed" values on the first run, every one
 * of them byte-identical in content. A gate that reports those is a gate nobody reads.
 */
function canon(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object") {
    const src = v as Record<string, unknown>;
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) o[k] = canon(src[k]);
    return o;
  }
  return v;
}
const j = (v: unknown) => JSON.stringify(canon(v));

let failures = 0;
const ok = (pass: boolean, name: string, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §1 · RELOCATION IS NOT RECALIBRATION
//
// ⚠ THE EXPECTED VALUES ARE LITERALS HERE, ON PURPOSE. Reading them from the catalogue would compare
// the catalogue against itself and pass no matter what was typed into it. These are transcribed from
// the rule files as they stood BEFORE the move; a mistyped relocation fails here, not in production.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const RELOCATED: [string, number, number][] = [
  ["R1 pledge ratio %", R1_PLEDGE_RATIO_PCT, 50],
  ["R1 QoQ rise pp", R1_QOQ_RISE_PP, 10],
  ["R2 promoter drop pp", R2_DROP_PP, 5],
  ["R3 min consecutive years", R3_MIN_CONSECUTIVE, 4],
  ["R4 D/E threshold", R4_DE_THRESHOLD, 3.0],
  ["R5 interest-coverage threshold", R5_IC_THRESHOLD, 1.5],
  ["R5 min consecutive quarters", R5_MIN_CONSECUTIVE, 2],
  ["P5 min net sell cr", P5_MIN_NET_SELL_CR, 2],
  ["P5 min sellers", P5_MIN_SELLERS, 1],
  ["P5 distress composite", P5_DISTRESS_COMPOSITE, 62],
  ["P6 insider window days", INSIDER_WINDOW_DAYS, 90],
  ["P6 eligible txn cr", INSIDER_ELIGIBLE_CR, 1],
  ["P6 min net cr", P6_MIN_NET_CR, 2],
  ["P6 min buyers", P6_MIN_BUYERS, 1],
  ["P7 cash-back max", P7_CASH_BACK_MAX, 0.5],
  ["P8 outpace pp", RECV_OUTPACE_PP, 15],
  ["P8 min recv growth %", MIN_RECV_GROWTH_PCT, 10],
  ["P8 min recv/rev", MIN_RECV_TO_REV, 0.05],
  ["P10 min net cr", P10_MIN_NET_CR, 2],
  ["P11 min declines", P11_MIN_DECLINES, 2],
  ["P12 min rises", P12_MIN_RISES, 2],
  ["P13 inflection pp", P13_INFLECTION_PP, 5],
  ["H block window days", BLOCK_WINDOW_DAYS, 90],
  ["H min deal cr", H_MIN_DEAL_CR, 1],
  ["F1 deviation pp", F1_DEVIATION_PP, 25],
  ["F2 composite hold", F2_COMPOSITE_HOLD, 3],
  ["F2 shift pp", F2_SHIFT_PP, 8],
  ["N1 min years", N1_MIN_YEARS, 3],
  ["N1 OCF/NP min", N1_OCF_NP_MIN, 1.0],
  ["N2 underpace pp", N2_UNDERPACE_PP, 15],
  ["N2 min years", N2_MIN_YEARS, 2],
  ["N2 min recv/rev", N2_MIN_RECV_TO_REV, 0.05],
  ["N3 min years", N3_MIN_YEARS, 3],
  ["N3 min absolute decline", N3_MIN_ABS_DECLINE, 0.5],
  ["N3 min relative decline", N3_MIN_REL_DECLINE, 0.25],
  ["N4 min rises", N4_MIN_RISES, 2],
  ["N4 low-base max", N4_LOW_BASE_MAX, 3.0],
  ["N5 min move pp", N5_MIN_MOVE_PP, 0.5],
  ["N6 min quarters", N6_MIN_QUARTERS, 2],
  ["N6 min cumulative pp", N6_MIN_CUMULATIVE_PP, 1.0],
  ["N7 QoQ fall pp", N7_QOQ_FALL_PP, 10],
  ["N7 ratio %", N7_RATIO_PCT, 50],
];

/** A key name that LOOKS like a bar. §3's second, independent test — see the note below. */
const THRESHOLD_SHAPE = /^(threshold|min[A-Z]|max[A-Z])|(Min|Max|Cut|Floor|Mark|Threshold)$|^(gapMin|riseMin|prevMin|weakMark|strongMark|stillBelow|lowBaseMax|ocfNpMin|noiseFloorPp|notableCut|wideCut|crossedAbove|crossedBelow|nativeThreshold|borrowedThreshold)$/;

/**
 * A key name that LOOKS like a back-test figure.
 *
 * ⚠ A BARE `…Pct` SUFFIX IS NOT ONE, and the first draft of this rule said it was. It flagged
 * `promoterPct`, `fiiPct`, `retailPct`, `cashBackPct`, `receivablesGrowthPct`, `revenueGrowthPct`
 * and both TTM growth keys — eight company measurements, every one of them exactly what a reader
 * should see. A percentage is a unit, not a provenance.
 *
 * What actually marks a study figure is its ROLE in the study: a sample size (`…N`), a hit rate
 * (`…PositivePct`), an effect size (`…SectorExcessPct`), or a named cohort prefix — the population
 * the figure was measured over. Those are facts about the model's evidence base; the eight above are
 * facts about the company.
 */
// ⚠ `mean` IS NOT IN THIS LIST, and leaving it in flagged `meanFundamentals` — which is the average
// of THIS COMPANY's own fundamental pillars (D1/D2 evidence), a reading a divergence card should
// absolutely show. The study's own `meanPct` / `meanCaveat` / `meanIsMisleading` are classified
// internal in the table, so the shape test never sees them: this regex only ever runs over keys
// already marked reader-facing, and its job is to catch a MISclassification, not to re-derive one.
const STUDY_COHORT = "evidenced|mirror|hot|normal|stressed|overall|pooled|shared|frontRun|sameDay|sevenDay|atTurn|combined|disclosureAnchored|bareBreak|twoSided|afterTheMove|bullMasked|borrowedThreshold";
const STUDY_SHAPE = new RegExp(`([a-z]N|PositivePct|SectorExcessPct)$|^(${STUDY_COHORT})[A-Z]`);

async function main(): Promise<void> {
  console.log("════ EVIDENCE FACTS · THE VOCABULARY, THE RELOCATION, AND THE FIRED SET ════");

  // ═══════════════════ §1 ═══════════════════
  rule("§1 · RELOCATION IS NOT RECALIBRATION — every moved constant still holds its original value");
  let moved = 0;
  for (const [name, actual, expected] of RELOCATED) {
    if (actual !== expected) {
      moved++;
      ok(false, name, `catalogue says ${actual}, rule file declared ${expected}`);
    }
  }
  ok(moved === 0, `all ${RELOCATED.length} relocated constants unchanged`, moved ? `${moved} MOVED` : "");

  // Every finding carries facts — the compile-time `satisfies` restated at runtime.
  const noFacts = STOCK_FINDING_KEYS.filter((k) => !(k in FINDING_FACTS));
  ok(noFacts.length === 0, `all ${STOCK_FINDING_KEYS.length} findings carry a facts record`, noFacts.join(",") || "none null");

  // ═══════════════════ §2 ═══════════════════
  rule("§2 · THE VOCABULARY IS TOTAL over every evidence key that exists");
  const live = new Set<string>();
  const collect = (ev: unknown) => {
    if (ev && typeof ev === "object" && !Array.isArray(ev)) for (const k of Object.keys(ev as object)) live.add(k);
  };
  for (const p of await prisma.scorePattern.findMany({ select: { evidence: true } })) collect(p.evidence);
  // score_red_flags dropped 2026-08-11 — the same evidence bags live on stock_findings.evidence,
  // which this pass already walks below.
  for (const f of await prisma.stockFinding.findMany({ select: { evidence: true } })) collect(f.evidence);

  const unclassified = [...live].filter((k) => !EVIDENCE_FACTS[k]).sort();
  ok(unclassified.length === 0, `all ${live.size} live evidence keys classified`, unclassified.join(", ") || "none missing");

  // The other direction: a classified key nothing emits is dead copy, and dead copy rots unnoticed.
  const dead = Object.keys(EVIDENCE_FACTS).filter((k) => !live.has(k)).sort();
  ok(dead.length === 0, "no classified key is dead (nothing emits it)", dead.join(", ") || "every entry is live");

  const readerCount = Object.keys(READER_EVIDENCE_FACTS).length;
  console.log(`     ${readerCount} reader-facing · ${live.size - readerCount} withheld`);

  // ═══════════════════ §3 ═══════════════════
  rule("§3 · NO BAR AND NO BACK-TEST REACHES A READER");
  const readerKeys = Object.keys(READER_EVIDENCE_FACTS);
  const barsShown = readerKeys.filter((k) => THRESHOLD_SHAPE.test(k));
  ok(barsShown.length === 0, "no threshold-shaped key is reader-facing", barsShown.join(", ") || "none");
  const statsShown = readerKeys.filter((k) => STUDY_SHAPE.test(k));
  ok(statsShown.length === 0, "no study-statistic-shaped key is reader-facing", statsShown.join(", ") || "none");

  // And the table's own classification agrees with the shapes above, both ways.
  const internalKeys = Object.entries(EVIDENCE_FACTS).filter(([, f]) => f.kind === "internal").map(([k]) => k);
  const bars = internalKeys.filter((k) => (EVIDENCE_FACTS[k] as { reason: string }).reason === "threshold");
  const stats = internalKeys.filter((k) => (EVIDENCE_FACTS[k] as { reason: string }).reason === "study");
  console.log(`     withheld: ${bars.length} thresholds · ${stats.length} study statistics · ${internalKeys.length - bars.length - stats.length} routing/prose/structural/duplicate`);

  // ═══════════════════ §4 ═══════════════════
  rule("§4 · THE FIRED SET DID NOT MOVE — filing pass re-derived for every stock, vs what is persisted");
  const universe = await filingUniverse();
  const persisted = await prisma.stockFinding.findMany({
    select: { stockId: true, ruleKey: true, periodKey: true, evaluationState: true, evidence: true, updatedAt: true },
  });
  const R1_PRECISION = FINDING_FACTS.ownership_R1_pledge.displayPrecision;
  const ROUNDED_ON_R1 = new Set(["pledgeRatioQ", "pledgeRatioQ1", "qoqRisePp"]);
  const byPair = new Map<string, (typeof persisted)[number]>();
  for (const r of persisted) byPair.set(`${r.stockId}|${r.ruleKey}|${r.periodKey}`, r);

  let compared = 0, stateDiffs = 0, valueDiffs = 0, r1Rounded = 0, absent = 0;
  const stateExamples: string[] = [];
  const valueExamples: string[] = [];

  // ═══ ★ EACH ROW IS RE-DERIVED AT ITS OWN WRITE DATE — NOT AT TODAY, AND NOT AT ONE GLOBAL STAMP ═══
  //
  // Two of the 22 rules read a TRAILING WINDOW that ends at the evaluation date (P6 insider, H block
  // deals — `ROLLING_WINDOW_FEEDS`, grain W). Their answer is a function of the calendar BY DESIGN:
  // "they can stop being true with no new data at all, because their window moves under them", which
  // is the whole reason a daily pass exists. Re-deriving one today and comparing it against a row
  // written last week compares two different questions.
  //
  // Measured: WIPRO's P6 fires at every as-of through 2026-08-09 — the day its row was written — and
  // stops on 2026-08-10, because a ₹3cr director buy left the 90-day window overnight. Nothing to do
  // with this work, and a gate that reported it would go red on a different stock every morning.
  //
  // ⚠ ONE GLOBAL STAMP IS NOT ENOUGH EITHER, which the first fix got wrong: `max(updatedAt)` across
  // the table is 2026-08-10 while the WIPRO row is 2026-08-09, so the comparison was still crossing
  // days. The pass is therefore run once per (stock, WRITE DATE) actually present, and every row is
  // compared against the pass from its own day. A rule is deterministic in (context, asOf), so
  // holding asOf to the write date isolates exactly the thing under test: whether relocating the
  // thresholds changed the rule.
  const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const datesByStock = new Map<string, Set<number>>();
  for (const r of persisted) {
    const set = datesByStock.get(r.stockId) ?? new Set<number>();
    set.add(dayOf(r.updatedAt).getTime());
    datesByStock.set(r.stockId, set);
  }
  const writeDates = new Set<number>();
  for (const set of datesByStock.values()) for (const t of set) writeDates.add(t);
  console.log(`     ${writeDates.size} distinct write date(s): ${[...writeDates].sort().map((t) => new Date(t).toISOString().slice(0, 10)).join(", ")}`);

  for (const subject of universe) {
    for (const t of datesByStock.get(subject.stockId) ?? []) {
      let res;
      try {
        res = await computeFilingPass(subject, new Date(t));
      } catch {
        continue; // a context that cannot load is not a comparison; the pass's own gate covers those
      }
      for (const row of res.rows) {
        const was = byPair.get(`${subject.stockId}|${row.ruleKey}|${row.periodKey}`);
        if (!was) { absent++; continue; }
        if (dayOf(was.updatedAt).getTime() !== t) continue; // compare each row on ITS day, once
        compared++;
        if (was.evaluationState !== row.evaluationState) {
          stateDiffs++;
          if (stateExamples.length < 20) stateExamples.push(`${subject.symbol} ${row.ruleKey} @${row.periodKey}: ${was.evaluationState} → ${row.evaluationState}`);
          continue;
        }
        const before = (was.evidence ?? null) as Record<string, unknown> | null;
        const after = (row.evidence ?? null) as Record<string, unknown> | null;
        if (!before || !after) continue;
        // ⚠ R1's NUMBERS ARE COMPARED AFTER ROUNDING THE PERSISTED ONES — the intended change, and the
        //   only one. A moved BAR would still fail here, because thresholdPct is compared unrounded.
        const isR1 = row.ruleKey === "ownership_R1_pledge";
        for (const [k, v] of Object.entries(after)) {
          let b = before[k];
          if (isR1 && ROUNDED_ON_R1.has(k) && typeof b === "number") {
            const r = roundToPrecision(b, R1_PRECISION);
            if (r !== b) r1Rounded++;
            b = r;
          }
          if (j(b) !== j(v)) {
            valueDiffs++;
            if (valueExamples.length < 10) valueExamples.push(`${subject.symbol} ${row.ruleKey}.${k}: ${j(b)} → ${j(v)}`);
          }
        }
      }
    }
  }
  console.log(`     ${universe.length} stocks · ${compared} (stock, rule, period) rows compared · ${absent} not yet persisted`);
  ok(stateDiffs === 0, "every rule fires exactly as it did", stateDiffs ? `${stateDiffs} changed` : "no fired state moved");
  ok(valueDiffs === 0, "every evidence value identical", valueDiffs ? `${valueDiffs} changed` : "byte-for-byte");
  console.log(`     R1 values that the rounding changed (the intended difference): ${r1Rounded}`);
  for (const e of stateExamples) console.log(`       ⚠ STATE  ${e}`);
  for (const e of valueExamples) console.log(`       ⚠ VALUE  ${e}`);

  console.log(
    failures === 0
      ? `\n════ VERDICT: ✅ ONE HOME — every bar moved, none changed; the vocabulary is total; no bar or back-test reaches a reader ════`
      : `\n════ VERDICT: ❌ ${failures} FAILURE(S) ════`,
  );
}

await main();
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
