// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE KEY DRIVER — a computed attribution, so the model does no causal reasoning.
//
// ── ★ THE PROBLEM THIS SOLVES ────────────────────────────────────────────────────────────────────
// "Depreciation nearly doubled, significantly affecting earnings" is a CAUSAL claim, and it is what a
// model invents most confidently when the data does not support it. The fix is not a better
// instruction. It is to hand the model the attribution ALREADY COMPUTED:
//
//     "Depreciation rose ₹412 crore — 63% of the ₹654 crore fall in net profit."
//
// An arithmetic identity did the causal work. The model phrases a fact it was given.
//
// ── ⚠⚠ THE BRIDGE IS FAMILY-SPECIFIC AND TWO FAMILIES CANNOT HAVE ONE (Stage 0) ──────────────────
//   non_financial   net profit = revenue + other income − total costs − tax          69.4% of pairs
//   banking         net profit = interest earned + other income − running costs
//                                − provisions − one-offs − tax                       86.7% of pairs
//   nbfc            net profit = total income − TOTAL costs − tax                    87.6% of pairs
//                   ⚠ the aggregate ONLY — the expense decomposition beneath it closes on 70%
//   general_ins     underwriting result = premiums earned − claims − commission
//                                − running costs                                     100% of pairs
//                   ⚠ NEVER net profit: `PBT = underwriting + investment income` closes on ZERO rows
//                   with a consistently negative residual (a shareholders' outgo line that is annual-only)
//   life_insurance  NONE. `net profit = PBT − tax` closes on 6% of rows. LICI FY26Q4: PBT ₹23,403.28 cr,
//                   tax ₹−9,088.86 cr, net profit ₹23,420.43 cr — the residual EQUALS |tax|, because
//                   policyholder tax is booked inside the revenue account. Broken by design.
//
// ── ★ PAIRWISE CLOSURE IS THE GATE (C16) ─────────────────────────────────────────────────────────
// A share-of-move figure is only honest when the identity closes on BOTH sides of the comparison —
// one leaky row and the "63%" is measuring the leak. So the residual is computed per row, at fact-block
// time, and the bullet is emitted only when both clear 1%. That turns a data-quality question into the
// presence gate this codebase already uses everywhere: no closure, no bullet, nothing said.
//
// The rows that fail are not noise. Non-financial's leak is EXCEPTIONAL ITEMS, and `quarterly_results`
// has no column for them: IDEA FY26Q4 files ₹11,332 crore of revenue against ₹51,976 crore of pre-tax
// profit — a ₹57,491 crore one-off. Those quarters cannot be bridged and must fail loudly rather than
// be attributed to whatever line happens to be largest.
//
// ── ★ AND THE RANKING RULE, WHICH IS NOT THE OBVIOUS ONE (C18) ───────────────────────────────────
// Ranking non-revenue lines does NOT fix the boilerplate problem — it relocates it. Measured over 1,625
// quarters where profit actually moved, the largest non-revenue mover is the RESIDUAL BUCKET on 84.4%
// of them. So the rank is over NAMEABLE lines only, and the residual bucket and the top line are both
// excluded by their manifest `driver` role rather than by a list here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { metricGloss, type MetricKey } from "../../catalogue/quarter-metrics.js";
import { money } from "./format.js";
import { driverEligible, valueOf, type AnyFamilyQuarter, type Family } from "./manifest.js";

/** The identity must close within this share of the family's scale base on BOTH rows. */
export const BRIDGE_TOLERANCE = 0.01;

/** A nameable line must account for at least this share of the profit move to be called the driver.
 *
 *  ★ MEASURED, NOT CHOSEN. Over 1,625 non-financial quarters where profit moved: a nameable line clears
 *  30% on 77.3% of them (too often — boilerplate again), 50% on 45.8%, and 75% on 29.9%. At 50% the
 *  winner distributes other income 40% / tax 31% / depreciation 17% / interest 11% — a genuine
 *  four-way split with no dominant term — and is near-unique by construction, since two lines cannot
 *  both exceed half the move without offsetting. */
export const DRIVER_SHARE_MIN = 0.5;

/** Profit moves smaller than this share of the scale base are noise; attributing them is false precision. */
const MOVE_FLOOR_RATIO = 0.005;

/** What each family's bridge targets, and what it is measured against.
 *  ⚠ `target` is what the driver explains. For general insurance it is the UNDERWRITING RESULT, never
 *  net profit — the path from one to the other leaks an annual-only line. */
export interface BridgeSpec {
  /** The metric the bridge explains the movement of. */
  target: MetricKey;
  /** Signed terms. `+1` adds to the target, `−1` subtracts from it. Must sum to the target exactly. */
  terms: { key: MetricKey; sign: 1 | -1 }[];
  /** The metric whose magnitude sets "is this move worth attributing at all". */
  scaleBase: MetricKey;
  /** Reader-facing noun for the target, used in the bullet. */
  targetNoun: string;
  /**
   * ★ THE SAME TERMS, IN THE READER'S WORDS — the subject of Q-K's second sentence.
   *
   * ⚠ IT LIVES ON THE SPEC, BESIDE `terms`, AND IT IS REQUIRED. A term added to the list without a
   * matching change here would produce a sentence naming four lines beside a figure computed from
   * five, which is the class of defect no guard can catch: every number is right and the words are
   * wrong about which numbers they are. Kept adjacent so the omission is visible at the edit.
   */
  plainSum: string;
}

const BRIDGES: Partial<Record<Family, BridgeSpec>> = {
  non_financial: {
    target: "netProfit",
    terms: [
      { key: "revenue", sign: 1 },
      { key: "otherIncome", sign: 1 },
      { key: "expenses", sign: -1 },
      { key: "tax", sign: -1 },
    ],
    scaleBase: "revenue",
    targetNoun: "net profit",
    plainSum: "What the company sold, plus its other income, less its costs and its tax",
  },
  banking: {
    target: "netProfit",
    terms: [
      { key: "interestEarned", sign: 1 },
      { key: "otherIncome", sign: 1 },
      { key: "interestExpended", sign: -1 },
      { key: "operatingExpenses", sign: -1 },
      { key: "provisions", sign: -1 },
      // ⚠⚠ ADDED, NOT SUBTRACTED — A SIGN BUG FOUND BY THE UNEXPLAINED-PROFIT PROBE, AND MEASURED.
      // `banking_quarterly_results.exceptional_items` is stored SIGNED: negative is a charge, positive
      // is a gain. Subtracting it therefore moved the row by TWICE the line. Over the 155 banking rows
      // with every term reported, the bridge closes within 1% on 153 (98.7%) with the term subtracted
      // and on 155 (100.0%) with it added; both of the two rows that carry a non-zero exceptional line
      // (BANKBARODA FY27Q1 at −₹5,680.23 crore, SBIN FY26Q2 at +₹4,593.22 crore) miss by 34.21% and
      // 7.68% subtracted and close to 0.00% added.
      //
      // ⚠ IT WAS INVISIBLE BECAUSE THE GATE ONLY EVER REFUSED. A bad sign made the identity miss, the
      // C16 pairwise gate saw a leak and declined to attribute, and the card said nothing — which looks
      // exactly like a quarter with no nameable driver. It surfaced the moment the residual stopped
      // being only a gate and became a sentence: Q-K would have printed "₹11,360 crore of this
      // quarter's profit did not come from the bank's lending" on a row whose ₹11,360 crore is this
      // file's own arithmetic, doubled.
      { key: "exceptionalItems", sign: 1 },
      { key: "tax", sign: -1 },
    ],
    scaleBase: "interestEarned",
    targetNoun: "net profit",
    plainSum:
      "What the bank earned in interest and fees, less its own interest bill, what it spent running " +
      "itself, what it set aside for bad loans, its one-off items and its tax",
  },
  nbfc: {
    target: "netProfit",
    terms: [
      { key: "totalIncome", sign: 1 },
      { key: "totalExpenses", sign: -1 },
      { key: "tax", sign: -1 },
    ],
    scaleBase: "revenue",
    targetNoun: "net profit",
    plainSum: "Everything the company took in, less all of its costs and its tax",
  },
  general_insurance: {
    target: "underwritingProfitOrLoss",
    terms: [
      { key: "premiumEarned", sign: 1 },
      { key: "incurredClaims", sign: -1 },
      { key: "netCommission", sign: -1 },
      { key: "insuranceRunningCosts", sign: -1 },
    ],
    scaleBase: "grossPremiumsWritten",
    targetNoun: "the underwriting result",
    // ⚠ DOCUMENTATION HERE, NOT COPY. This bridge targets the UNDERWRITING RESULT, so it is excluded
    // from UNEXPLAINED_BRIDGES and Q-K never renders this string. It is still required, and still
    // correct, because the next person to read `terms` needs the same sentence the other three have.
    plainSum: "The premiums earned, less claims, commission and the cost of running the insurance book",
  },
  // life_insurance: deliberately absent. See the header and the manifest note on life_insurance.tax.
};

/** How far the family's identity misses on ONE row, as a share of its scale base.
 *  Returns null when any term is unreported — an identity with a hole in it has not closed. */
export function bridgeResidual(q: AnyFamilyQuarter): number | null {
  const bridge = BRIDGES[q.family];
  if (!bridge) return null;
  const target = valueOf(q, bridge.target);
  const base = valueOf(q, bridge.scaleBase);
  if (target === null || base === null || base === 0) return null;

  let sum = 0;
  for (const t of bridge.terms) {
    const v = valueOf(q, t.key);
    if (v === null) return null;
    sum += t.sign * v;
  }
  return Math.abs(sum - target) / Math.abs(base);
}

// ═══ ★★ THE LEFTOVER AS A FACT, NOT ONLY AS A GATE ═══════════════════════════════════════════════
//
// Everything above uses the residual to REFUSE: over tolerance, no driver bullet, nothing said. That is
// correct for an attribution — a share computed off a leaky identity measures the leak. It is wrong as
// the end of the matter, because on the rows where the leak is enormous the leak IS the quarter:
//
//     IDEA FY26Q4 — revenue ₹11,332 crore, net profit ₹51,970 crore.
//
// A reader meets those two figures and asks HOW. The card's answer was a suppressed margin (silent) and
// a gaps line saying no line could be named (true, and about a different question). The amount that
// arrived from outside the trading lines was computed on every render and never rendered.
//
// ── ⚠ WHAT THIS MAY AND MAY NOT SAY ─────────────────────────────────────────────────────────────
// MAY   "₹57,491 crore of this quarter's profit did not come from what the company sold or spent."
//       That is `netProfit − (revenue + other income − costs − tax)`, four filed lines and a subtraction.
// MAY NOT  name a cause. A one-off gain, a settlement, a spectrum charge, a merger, an accounting
//       reclassification and a filing error all produce the same residual, and `quarterly_results` has
//       no column that separates them. The sentence states the SIZE and the ABSENCE; a reader who wants
//       the cause has the filing.
//
// ── ⚠ AND IT IS RESTRICTED TO THE BRIDGES THAT TARGET NET PROFIT ────────────────────────────────
// General insurance's bridge targets the UNDERWRITING RESULT (see BRIDGES): its residual is the gap
// between premiums-minus-claims and the underwriting line, which is not a statement about profit at all.
// Life insurance has no bridge, and its apparent residual EQUALS the tax line by design — policyholder
// tax is booked inside the revenue account. Firing on either would produce a confident sentence about an
// artifact of the family's own accounting. The set below is derived from BRIDGES rather than listed, so
// a bridge that is retargeted cannot silently keep its membership.
export const UNEXPLAINED_BRIDGES: ReadonlyMap<Family, BridgeSpec> = new Map(
  (Object.entries(BRIDGES) as [Family, BridgeSpec][]).filter(([, b]) => b.target === "netProfit"),
);

/**
 * The SIGNED ₹ crore of net profit this family's own identity does not account for, or null.
 *
 * Positive ⇒ more profit was reported than the trading lines produce; something outside them added it.
 * Negative ⇒ less; something outside them took it away.
 *
 * Null on every family without a net-profit bridge, and — the load-bearing case — whenever ANY term is
 * unreported. A missing column and a one-off gain both leave the identity open, and only one of them is
 * a fact about the company. `bridgeResidual` refuses on the same condition for the same reason.
 */
export function unexplainedAmount(q: AnyFamilyQuarter): number | null {
  const bridge = UNEXPLAINED_BRIDGES.get(q.family);
  if (!bridge) return null;
  const target = valueOf(q, bridge.target);
  if (target === null) return null;
  let sum = 0;
  for (const t of bridge.terms) {
    const v = valueOf(q, t.key);
    if (v === null) return null;
    sum += t.sign * v;
  }
  return target - sum;
}

/** One line's contribution to the target's movement. */
export interface DriverFact {
  key: MetricKey;
  label: string;
  /** Signed rupee-crore movement of the line itself. */
  delta: number;
  /** |line move| ÷ |target move|. At or above DRIVER_SHARE_MIN by construction. */
  share: number;
  /** ★ WHICH FORM THE SENTENCE TOOK — see SHARE ABOVE 100% below.
   *  · `dominant`  share ≤ 1. The line is a genuine share of the move and is named as its cause.
   *  · `offset`    share > 1. The line moved by MORE than the move it is being compared against, so
   *                it is not a share of anything; the sentence decomposes instead of attributing. */
  form: "dominant" | "offset";
  /** The pre-rendered sentence. The model reproduces it; it never recomputes it. */
  display: string;
}

// ═══ ★★ SHARE ABOVE 100% — MEASURED, AND IT IS NOT AN EDGE CASE ══════════════════════════════════
//
// The stage-5 review set showed four share-of-move figures above 100% (474%, 236%, 142%, 113%) out of
// twelve cards. MEASURED across the whole universe — every (row, comparison) pair where a nameable
// line clears DRIVER_SHARE_MIN, n = 1,333:
//
//     share > 100%   699 pairs   52.4%      p50  = 1.05
//     share > 200%   330 pairs   24.8%      p90  = 4.33
//     share > 500%   117 pairs    8.8%      p99  = 21.90      max = 93.18  (MFSL FY22Q1)
//
// The form is broken on the MAJORITY of driver bullets, not on a tail. And the failure is exactly what
// the arithmetic says it is: `share = |Δline| ÷ |Δtarget|` explodes whenever the target barely moved
// while its components moved a lot in opposite directions. MFSL FY22Q1: total costs fell ₹3,834 crore
// against a ₹41 crore fall in net profit. "Total costs were 9318% of the fall in net profit" is not a
// sentence that can be repaired by rounding it.
//
// ── ★ THE FIX IS A DIFFERENT SENTENCE, NOT A BOUND ──────────────────────────────────────────────
// A bound (suppress above 200%) would have thrown away a quarter of all driver bullets and told the
// reader nothing in their place. The decomposition below tells them MORE than the share ever did, and
// it is the same arithmetic the share was a lossy summary of:
//
//     "Total costs fell ₹3,834 crore against the same quarter last year. They are a cost, so that
//      added ₹3,834 crore to net profit, while everything else together took ₹3,875 crore off —
//      leaving net profit ₹41 crore lower."
//
// Three properties the share did not have: it cannot exceed 100% because it is not a percentage; it
// ADDS UP on the page, so a reader can check it; and it states the offsetting move, which is the fact
// the reader actually needed and which the share was hiding.
//
// ── ⚠ AND `everything else` IS DERIVED FROM THE REPORTED TARGET, NOT SUMMED FROM THE OTHER TERMS ──
// The bridge closes to within BRIDGE_TOLERANCE of the scale base on EACH row, so summing the other
// terms' movements would produce a total that misses the REPORTED move by up to two tolerances — and
// the target's own move can legitimately be smaller than that (MOVE_FLOOR_RATIO is half of one
// percent). The card would then print three figures that do not add up, beside a fourth that does.
// So `others = Δtarget(reported) − sign × Δline`, which absorbs the residual into the bucket that is
// already residual by nature and guarantees the printed arithmetic is exact. The residual it absorbs
// is bounded by the C16 gate, which is the only reason this is honest rather than convenient.

/**
 * The line that explains this family's profit move, or null.
 *
 * Null is the common and correct outcome — no bridge for the family, the identity did not close on
 * both rows, the move was too small to attribute, or no NAMEABLE line reached half of it.
 */
export function computeDriver(
  current: AnyFamilyQuarter,
  comparison: AnyFamilyQuarter | null,
  reference: string,
): DriverFact | null {
  const bridge = BRIDGES[current.family];
  if (!bridge || !comparison) return null;

  // ★ C16 — BOTH rows, or nothing.
  const rc = bridgeResidual(current);
  const rp = bridgeResidual(comparison);
  if (rc === null || rp === null || rc > BRIDGE_TOLERANCE || rp > BRIDGE_TOLERANCE) return null;

  const curTarget = valueOf(current, bridge.target);
  const priTarget = valueOf(comparison, bridge.target);
  const base = valueOf(current, bridge.scaleBase);
  if (curTarget === null || priTarget === null || base === null) return null;

  const move = curTarget - priTarget;
  if (Math.abs(move) < Math.abs(base) * MOVE_FLOOR_RATIO) return null;

  // ⚠ NAMEABLE ONLY. The manifest's `driver` role is what excludes the top line and the residual
  // bucket — never a list here, so adding a metric cannot accidentally make it nameable.
  let best: DriverFact | null = null;
  for (const spec of driverEligible(current.family)) {
    const c = valueOf(current, spec.key);
    const p = valueOf(comparison, spec.key);
    if (c === null || p === null) continue;

    const lineDelta = c - p;
    const share = Math.abs(lineDelta) / Math.abs(move);
    if (share < DRIVER_SHARE_MIN) continue;
    if (best && share <= best.share) continue;

    const gloss = metricGloss(spec.key);
    // The term's SIGN in the bridge decides whether a rise helped or hurt: a rise in revenue lifts
    // profit, a rise in tax reduces it. Read from the bridge, never inferred from the word.
    const sign = bridge.terms.find((t) => t.key === spec.key)?.sign ?? 1;
    const roseOrFell = lineDelta > 0 ? "rose" : "fell";
    const targetDir = move > 0 ? "rise" : "fall";

    best =
      share <= 1
        ? {
            key: spec.key,
            label: gloss.label,
            delta: lineDelta,
            share,
            form: "dominant",
            // ── ★ THREE SENTENCES, NOT ONE WITH A RELATIVE CLAUSE (2a) ─────────────────────────
            // WAS: "Depreciation rose ₹412 crore against the same quarter last year, which is 63% of
            // the ₹654 crore fall in net profit. It is a cost, so a rise there reduces profit."
            // The "which is" hangs the share off the move, so the reader is holding two figures and a
            // period reference before the point arrives. It is the point.
            //
            // ⚠ "THAT LINE IS A COST", NOT "<LABEL> IS A COST" — the same number-agnostic problem
            // story.ts's `stood at` note records. Several labels are plural ("Total costs") and
            // several are clauses, so no frame that repeats the label reads on all of them.
            display:
              `${gloss.label} ${roseOrFell} ${money(lineDelta)} ${reference}. ` +
              `That is ${Math.round(share * 100)}% of the ${money(move)} ${targetDir} in ${bridge.targetNoun}.` +
              // ⚠ A COST LINE MOVES PROFIT THE OTHER WAY, AND THE READER NEEDS THAT SAID. Without it,
              // "tax rose ₹80 crore, 60% of the ₹133 crore fall in net profit" reads as if tax rising
              // caused profit to rise. The clause comes from the bridge's own sign, not from the label.
              (sign === -1 ? ` That line is a cost, so a rise there reduces profit.` : ""),
          }
        : {
            key: spec.key,
            label: gloss.label,
            delta: lineDelta,
            share,
            form: "offset",
            display: decompose(gloss.label, roseOrFell, lineDelta, sign, move, reference, bridge.targetNoun),
          };
  }

  return best;
}

/**
 * The decomposition sentence — used whenever the line moved by more than the target did.
 *
 * `contribution` is what this line did to the target, in the target's own direction convention:
 * `sign × Δline`. `others` is everything else, taken from the REPORTED move so the three figures on
 * the page add up exactly (see the note above).
 */
function decompose(
  label: string,
  roseOrFell: string,
  lineDeltaIn: number,
  sign: 1 | -1,
  moveIn: number,
  reference: string,
  targetNoun: string,
): string {
  let lineDelta = lineDeltaIn;
  let move = moveIn;
  // ★ ROUNDED FIRST, THEN SUBTRACTED — SO THE THREE PRINTED FIGURES ADD UP ON THE PAGE.
  //
  // ⚠ FOUND BY RENDERING ICICIGI. Rounding each figure independently gave "₹794 crore … ₹458 crore …
  // ₹337 crore", and 794 − 458 is 336. Every one of the three was correctly rounded and the sentence
  // still failed the only check a reader can actually perform on it, which is the whole reason this
  // form was chosen over a share-of-move. Subtracting AFTER rounding costs at most half a crore of
  // precision on the residual bucket — which is already the bucket that absorbs the bridge residual —
  // and buys arithmetic that reconciles exactly.
  //
  // ⚠ THE EXCEPTION IS ₹1 LAKH CRORE AND ABOVE, where `money` switches to two decimals of lakh-crore.
  // A sentence mixing one figure above the threshold with two below can still be a hair out. Reliance
  // is the only company in the universe whose quarterly moves reach it, and the alternative — carrying
  // the display precision into this arithmetic — would put format.ts's rules in a second place.
  const contribution = Math.round(sign * lineDelta);
  const others = Math.round(move) - contribution;
  move = Math.round(move);
  lineDelta = Math.round(lineDelta);

  // ── ★★ FIVE SENTENCES, ONE STEP EACH (2a) ──────────────────────────────────────────────────────
  //
  // ⚠ THE SECOND-WORST STACKED SENTENCE IN THE FEATURE — 104 of 315 driver sentences, 33.0%. It read:
  //
  //     "Total costs fell ₹3,834 crore against the same quarter last year — more than the change in
  //      net profit itself. It is a cost line, so that added ₹3,834 crore to net profit, while
  //      everything else together took ₹3,875 crore off — leaving net profit ₹41 crore lower."
  //
  // The second sentence alone carries five clause breaks and four facts, and it is a DECOMPOSITION —
  // the one form on this card whose whole value is that the reader can follow the arithmetic step by
  // step. Handing them the steps welded together is handing back the share-of-move this form exists
  // to replace. Each step is now its own sentence, in the order the arithmetic happens.
  //
  // ⚠ "THAT LINE IS A COST", NOT "IT IS A COST LINE". `It` two sentences after the label has `net
  // profit` sitting between it and its antecedent — the dangling-pronoun defect personal.ts's
  // `since` and `watchlist` strings were rewritten for. `That line` points back unambiguously and is
  // number-agnostic, which the label itself is not ("Total costs is a cost line").
  const nature =
    sign === -1
      ? ` That line is a cost, so a ${roseOrFell === "rose" ? "rise" : "fall"} there moves ${targetNoun} the other way.`
      : "";
  const did = contribution >= 0 ? `added ${money(contribution)} to` : `took ${money(contribution)} off`;
  const elseDid =
    Math.abs(others) < 0.5
      ? `Everything else together barely moved.`
      : others >= 0
        ? `Everything else together added ${money(others)}.`
        : `Everything else together took ${money(others)} off.`;

  // ⚠ NO SUPERLATIVE. `best` is the largest mover among the lines the manifest marks NAMEABLE — the
  // top line and the residual bucket are excluded by their `driver` role and either could be bigger.
  // "The largest single line movement" would therefore be a claim about lines this sentence never
  // looked at, which is the C18 ranking rule broken in prose instead of in code.
  return (
    `${label} ${roseOrFell} ${money(lineDelta)} ${reference}.${nature} ` +
    `The move ${did} ${targetNoun}. ${elseDid} ` +
    `${targetNoun.charAt(0).toUpperCase()}${targetNoun.slice(1)} ended ${money(move)} ` +
    `${move >= 0 ? "higher" : "lower"}, a smaller change than that one line made on its own.`
  );
}

/** Does this family have a bridge at all? Used by the gaps copy, so a reader is told the check was
 *  not run rather than left to assume nothing was found. */
export const hasBridge = (family: Family): boolean => BRIDGES[family] !== undefined;

/**
 * ★ WHY `computeDriver` RETURNED NULL — so the gaps line can state the reason it actually was.
 *
 * ⚠ FOUND WHILE WIRING Q-K, AND IT IS AN ACCURACY DEFECT IN A SHIPPED STRING. The gap read "No single
 * line accounted for enough of the profit move to be called its main cause" on EVERY null, and the
 * driver returns null four different ways. On IDEA — where the identity misses by ₹57,491 crore — that
 * sentence told the reader the lines were all too small, which is not what happened and is not even
 * close. A gap is the one place on the card whose whole job is to be honest about what is missing;
 * asserting the wrong reason there is worse than saying nothing.
 *
 * The branches mirror `computeDriver`'s own guards IN ORDER, so the two cannot disagree about which
 * gate stopped it.
 */
export type DriverAbsence = "no_bridge" | "no_comparison" | "identity_open" | "move_too_small" | "no_dominant_line";

export function driverAbsence(
  current: AnyFamilyQuarter,
  comparison: AnyFamilyQuarter | null,
): DriverAbsence | null {
  const bridge = BRIDGES[current.family];
  if (!bridge) return "no_bridge";
  if (!comparison) return "no_comparison";

  const rc = bridgeResidual(current);
  const rp = bridgeResidual(comparison);
  if (rc === null || rp === null || rc > BRIDGE_TOLERANCE || rp > BRIDGE_TOLERANCE) return "identity_open";

  const curTarget = valueOf(current, bridge.target);
  const priTarget = valueOf(comparison, bridge.target);
  const base = valueOf(current, bridge.scaleBase);
  if (curTarget === null || priTarget === null || base === null) return "identity_open";
  if (Math.abs(curTarget - priTarget) < Math.abs(base) * MOVE_FLOOR_RATIO) return "move_too_small";

  return "no_dominant_line";
}
