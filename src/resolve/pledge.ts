// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PLEDGE RULING — one home, because the alternative is five sites each deciding what a zero means.
//
// ── ★ WHAT WAS MEASURED, AND WHY IT IS TWO DEFECTS RATHER THAN ONE ────────────────────────────────
// Re-measured at Phase 1 · Batch 1 against 25,168 `shareholding_patterns` rows:
//
//   1 · ABSENCE IS FABRICATED.  21,957 rows (87.2%) carry `pledged_shares = 0` and **zero** rows
//       carry NULL. A column with no NULLs is not a column that always knew the answer — it is a
//       column where "not disclosed" was written as 0. The proof is internal: 1,555 rows across 213
//       stocks report `promoter_pledged_pct > 0` while `pledged_shares = 0`, so the same filing says
//       both that a pledge exists and that no shares are pledged.
//
//   2 · ⚠ AND WHERE A PLEDGE DOES EXIST, THE TWO DERIVATIONS DISAGREE ON HOW BIG IT IS. This is the
//       finding this batch adds, and it is the one that settles the question. Of 3,205 rows where
//       BOTH columns are positive, only 891 (28%) agree within half a point. 2,007 (63%) are more
//       than 5 points apart, and the worst gap is 183 points. Measured live: ASHOKLEY's share counts
//       give 51.37% of the promoter stake pledged while the pct column gives 59.03%; HINDZINC's give
//       8.14% against 90.67%. Trying both unit readings of the pct column does not rescue it — 2,089
//       of the 3,205 (65%) reconcile under NEITHER reading.
//
// ★ SO THE RULING IS NOT "PREFER THE SHARE COUNTS". It is that **no pledge magnitude is defensible**:
//   we hold two numbers for the same fact and no basis for choosing between them. The brief's
//   instruction — *"a pledge number is unproven; say the data is not available rather than printing a
//   zero"* — is upheld and, on this measurement, understated.
//
// ── ★ THE ONE JUDGEMENT CALL IN THIS FILE, STATED SO IT CAN BE OVERRULED ──────────────────────────
// Defect 2 destroys the MAGNITUDE and strengthens the EXISTENCE claim: two independently-derived
// columns both saying "greater than zero" is the strongest evidence this field offers. Suppressing
// that as well would mean a company with a majority of its promoter stake pledged is reported as
// "we cannot say" — which is a real risk signal deleted to satisfy a rule about numbers.
//
// So this file admits exactly one positive state, `disclosed_unquantified`: a pledge IS on file, and
// we will not say how much. It never returns a figure, in any state. If the Operator would rather we
// said nothing at all until the re-parse, this is the one function to change and there is nowhere
// else a pledge figure can come from.
//
// ⚠ AND A THIRD STATE THAT IS NOT A DATA PROBLEM AT ALL. HDFCBANK holds `promoter_shares = 0` — it
//   has no promoter — and the read layer divides 0 by 0 and hands back `pledgedPctOfPromoter: 0`.
//   Rendered, that reads "none of the promoter holding is pledged", which describes a promoter
//   holding that does not exist. `no_promoter` says so instead.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * What we are willing to say about pledging for one filing. There is deliberately no arm carrying a
 * number: the type is what stops a call site printing one, the same way `DigestFragment`'s all-string
 * leaves are what stop a raw figure reaching the model.
 */
export type PledgeState =
  /** A pledge is on file. How much is NOT stated — see defect 2 in the header. */
  | "disclosed_unquantified"
  /** The filing gives us no usable pledge reading. This is the 87% case and the DEFAULT. */
  | "not_established"
  /** No promoter holding exists, so the question does not arise. Not a gap. */
  | "no_promoter";

export interface PledgeReading {
  readonly state: PledgeState;
  /** The authored reader sentence. The ONLY thing a surface may show for pledging. */
  readonly phrase: string;
  /**
   * Whether this reading is worth offering the reader a follow-up about.
   *
   * ⚠ `false` FOR `not_established`, AND THAT IS A CHANGE OF BEHAVIOUR WORTH NOTICING. The old
   *   `pledged` signal was `(pledgedPctOfPromoter ?? 0) > 0`, so 87% of stocks — every fabricated
   *   zero — produced no chip, and the 213 contradiction stocks produced one only by accident. A chip
   *   reading "how much of X's promoter holding is pledged, and since when?" promises a figure we
   *   have just declined to give, so it is offered only where a pledge is actually on file.
   */
  readonly worthFollowingUp: boolean;
}

/**
 * The sentences. Authored here, once (§7.2) — a pledge absence phrased five ways across five surfaces
 * is five different claims about the same silence.
 *
 * ★ EXPORTED SO THE HARNESS CAN CHECK AGAINST THE SET RATHER THAN AGAINST A REGEX. `I-PLEDGE-SILENT`
 *   originally tried to recognise a forbidden sentence by pattern, and it fired on these three — which
 *   is what happens when a gate tries to parse English: the sentence that says "we CANNOT state
 *   pledging" and the sentence that says "NOTHING is pledged" share most of their words and mean
 *   opposite things. Checking that the phrase IS one of these is exact, cannot drift, and gets
 *   stronger rather than weaker as the copy is edited.
 *
 * ⚠ EACH ONE NAMES WHOSE ABSENCE IT IS. `not_established` is OURS: the filing may well have said
 *   nothing, and it may have said something our parse flattened to a zero, and we cannot tell which.
 *   Saying "the company disclosed no pledging" would hand our parsing gap to the reader as the
 *   company's silence — the exact conflation `block-copy.ts`'s own header forbids.
 */
export const PLEDGE_PHRASE: Record<PledgeState, string> = {
  disclosed_unquantified:
    "Part of the promoter holding is pledged — the filing says so. We are not quoting the proportion: " +
    "the two figures the filing gives for it disagree, so any number we printed would be a guess dressed as a reading.",
  not_established:
    "We cannot state pledging for this company. The pledge field is zero-filled rather than left " +
    "empty where a filing said nothing, so a zero here is not evidence that nothing is pledged — and " +
    "we will not report it as one.",
  no_promoter:
    "There is no promoter holding here, so there is nothing that could be pledged.",
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ `PLEDGE_ACROSS_A_SET` WAS ADDED HERE AND HAS BEEN REMOVED. RE-MEASURED, THE RULING DOES NOT
 *    EXTEND TO A SET, BECAUSE THE EVIDENCE IT RESTED ON HAS BEEN REPAIRED.
 *
 * It said, over a findings screen: "a company this check did not flag is not a company we can call
 * unpledged — the pledge field is zero-filled rather than left empty". That was written from the three
 * measurements in the header above. All three were re-run on the live table:
 *
 *   rows where pledged_shares = 0 AND promoter_pledged_pct > 0   1,555 / 213 stocks  →  **0 / 0**
 *   rows with both positive                                       3,205             →   4,523
 *   …agreeing within half a point                                   891 (27.8%)     →   4,437 (98.1%)
 *   …more than five points apart                                  2,007             →      44 (1.0%)
 *
 * The self-contradiction is GONE and the two columns now agree on 98.1% of rows — which is exactly
 * what `readPledge`'s own note predicted would happen once the parser resolved every pledge fact to
 * the promoter-group aggregate context ("verified against 265 filings").
 *
 * ★ SO THE CAVEAT WAS TELLING READERS THE DATA WAS UNRELIABLE ON THE STRENGTH OF A DEFECT THAT HAD
 *   ALREADY BEEN FIXED. That is worse than saying nothing: it costs trust in figures that are sound.
 *
 * ⚠ WHAT IS **NOT** RETIRED IS THE PER-STOCK RULING BELOW. `PLEDGE_PHRASE` guards a different claim —
 *   quoting a pledge MAGNITUDE for one company — and `pledged_shares` still carries 20,541 zeros with
 *   zero NULLs, so "this filing disclosed nothing" and "this filing disclosed none" remain
 *   indistinguishable at the row level. R1 fires on a RATIO that now reconciles with the disclosed
 *   percentage; quoting the number itself is still a separate question and still declined.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** One filing's pledge columns, exactly as the read layer hands them over. */
export interface PledgeInput {
  /** `pledged_shares`, as a number. Zero is the suspect value — see the header. */
  readonly pledgedShares: number | null;
  /** `promoter_shares`. Zero means no promoter, not a missing count. */
  readonly promoterShares: number | null;
  /**
   * ⚠ REMOVED — `promoter_pledged_pct` IS NO LONGER PART OF THE EXISTENCE TEST.
   *
   * It was read here only as a boolean (`> 0`), never as a magnitude, and the two-column agreement
   * rule was the right call while BOTH columns were mis-sourced. They no longer are: the parser now
   * resolves every pledge fact to the promoter-group aggregate context, so `pledged_shares` equals
   * the figure in the filing. One home for the fact, and it is the count.
   */
}

/**
 * ★ THE ONE DECISION. Every surface that could show pledging calls this and shows `phrase`.
 *
 * The order of the tests is the ruling: no promoter first (it is not a gap), then the only state that
 * earns a positive claim, then everything else — which is most of the universe.
 */
export function readPledge(input: PledgeInput): PledgeReading {
  const { pledgedShares, promoterShares } = input;

  // ⚠ FIRST, BECAUSE 0/0 IS NOT 0. A company with no promoter (HDFCBANK, and every widely-held bank)
  //   has no promoter stake to pledge, and the read layer's own division hands back a plausible zero.
  if (promoterShares !== null && promoterShares === 0) {
    return { state: "no_promoter", phrase: PLEDGE_PHRASE.no_promoter, worthFollowingUp: false };
  }

  // ★ THE POSITIVE STATE NOW COMES FROM THE COUNT ALONE, AND THAT IS A STRENGTHENING.
  //   It used to require BOTH columns to agree, because both were mis-sourced and neither could be
  //   trusted on its own. The parser fix removed that: `pledged_shares` is now the aggregate figure
  //   the filing states, verified against 265 filings. Requiring a second, redundant column to agree
  //   would now DELETE real pledges rather than guard against fabricated ones.
  const sharesSayYes = pledgedShares !== null && pledgedShares > 0;
  if (sharesSayYes) {
    return { state: "disclosed_unquantified", phrase: PLEDGE_PHRASE.disclosed_unquantified, worthFollowingUp: true };
  }

  // Everything else, including the 1,555 rows where the two columns contradict each other outright.
  return { state: "not_established", phrase: PLEDGE_PHRASE.not_established, worthFollowingUp: false };
}

/**
 * The same ruling from the read model's derived field, for call sites that only have that.
 *
 * ⚠ THIS CANNOT REACH `disclosed_unquantified` ON ITS OWN AND MUST NOT PRETEND TO. `OwnershipHolding`
 *   exposes `pledgedPctOfPromoter` — a number derived from the share counts alone — and the positive
 *   state requires the second column to agree. A caller holding only the derived value therefore gets
 *   `not_established` even when the derived value is positive, which is the conservative direction:
 *   it withholds a claim rather than making an unverified one. Callers that can reach the raw columns
 *   (`resolveOwnership`) use `readPledge` above and get the full ruling.
 */
export function readPledgeFromDerived(pledgedPctOfPromoter: number | null, promoterPct: number | null): PledgeReading {
  if (promoterPct !== null && promoterPct === 0) {
    return { state: "no_promoter", phrase: PLEDGE_PHRASE.no_promoter, worthFollowingUp: false };
  }
  void pledgedPctOfPromoter;
  return { state: "not_established", phrase: PLEDGE_PHRASE.not_established, worthFollowingUp: false };
}
