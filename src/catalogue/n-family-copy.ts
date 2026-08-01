/**
 * Family N (Notable) — copy, lifted from Vytal Family N Amendment v1.0 §3, §4.
 *
 * ⚠️ EVERY STRING HERE IS SPEC COPY. Do not reword, shorten, "improve", or regenerate.
 *    If something reads wrong, report it — do not edit it.
 *
 * ── ★ RELOCATION NOTE (Stage 1 · completed Stage 3) ───────────────────────────────
 * This is a MOVE from Vytal-Frontend/lib/n-family-copy.ts, character for character. The
 * frontend original is deleted at Stage 6; until then it is the bundled fallback and the
 * two are proved byte-identical by scripts/verify-catalogue.ts.
 *
 * ★ ALL FOUR FIELDS ARE HERE, AND THE AMENDMENT IS WHY. §4.0 defines name · description ·
 * verdict · doesn't-mean as ONE copy object for ONE rule; splitting `verdict` off into a
 * different module would leave the spec's four fields with two homes and no reason a future
 * editor could see. Stage 1 moved three (the JSON-servable ones); Stage 3 brings `verdict`
 * back beside them.
 *
 * ⚠ THAT DOES NOT MEAN THE CATALOGUE ENDPOINT SERVES IT. `verdict` is an (evidence) => string
 * FUNCTION and cannot be JSON. It is consumed by scoring/findings/verdicts.ts and rendered
 * into finding ROWS on the per-stock responses, which is where the evidence exists. One home
 * for the copy; two different transports, because the two fields are different kinds of thing.
 *
 * THE FOUR FIELDS (amendment §4.0) — each has a different scope and different surfaces:
 *
 *   name        rule-level, static,  no evidence  → everywhere a key appears
 *   description rule-level, static,  no evidence  → any surface WITHOUT evidence:
 *                                                   the Hub census board, screeners,
 *                                                   universe rollups, peer-group aggregates
 *   verdict     INSTANCE-level,      reads evidence → per-stock surfaces ONLY
 *
 * Family N's claims all carry a run length from the fired instance, so they are VERDICTS
 * and can only render where evidence exists. The Hub census payload carries none — which is
 * why `description` exists and why omitting it would render every N pattern title-only on the
 * Flags & Patterns board. That was the defect this whole thread fixed for other families; it
 * must not be reproduced for the new one.
 *
 * DESCRIPTION RULE (§4.0): describe the SHAPE of what the rule looks for — never a threshold
 * constant, never an instance number. Thresholds tune; a description that hardcodes one drifts
 * out of sync silently. Where a gate carries real meaning for a reader (N4's thin starting
 * level, N6's absolute-count basis) it is encoded qualitatively.
 *
 * REGISTER DISCIPLINE (§4.2) — prohibited in every field: excellent · strong (as a verdict;
 * "strengthened" as a described change is fine) · quality · impressive · healthy · well-positioned
 * · attractive · solid · robust · compelling · reassuring.
 * The test: if the sentence would read as a reason to buy when lifted out of context, rewrite it.
 *
 * EVIDENCE KEYS: the verdict templates below read exactly the keys the engine build writes.
 * If a key is missing at runtime, render the description instead of a broken sentence — never
 * interpolate "undefined". The guard lives in scoring/findings/verdicts.ts (N_REQUIRED_KEYS),
 * which is where it can see the engine's evidence; the templates stay pure spec copy here.
 */

/** Family-level boundary line — amendment §4.1. MANDATORY fallback; makes empty impossible. */
export const N_FAMILY_DOESNT_MEAN =
  "Already-sound is already priced. A constructive finding describes what has held, not what will continue, and never that the stock is worth buying.";

/** The amendment's §4.0 copy object — all four fields, one home. */
export interface NFamilyStaticCopy {
  name: string;
  /** Rule-level, static. Renders on evidence-free surfaces (Hub census board). */
  description: string;
  /** INSTANCE-level. Reads engine evidence. Per-stock surfaces only — never JSON. */
  verdict: (ev: Record<string, unknown>) => string;
  doesntMean: string;
}

/** The seven Notable keys, closed. Declared so N_FAMILY_COPY is TOTAL over them — an eighth twin
 *  added to the union without its copy is a compile error, exactly like every other registry here. */
export type NFamilyKey =
  | "foundation_N1_cash_backed_earnings"
  | "foundation_N2_working_capital"
  | "foundation_N3_deleveraging"
  | "foundation_N4_coverage_strengthening"
  | "ownership_N5_dual_institutional_build"
  | "ownership_N6_promoter_accumulation"
  | "ownership_N7_pledge_release";

export const N_FAMILY_COPY: Readonly<Record<NFamilyKey, NFamilyStaticCopy>> = {
  foundation_N1_cash_backed_earnings: {
    name: "Cash-backed earnings",
    description:
      "Operating cash flow has covered reported profit across consecutive years — earnings converting to cash rather than accumulating as accruals.",
    verdict: (ev) => `Reported profit has converted to cash for ${ev.years} straight years.`,
    doesntMean:
      "cash conversion describes accounting quality, not growth, not valuation, and not a floor under the price.",
  },

  foundation_N2_working_capital: {
    name: "Working-capital discipline",
    description:
      "Revenue has grown faster than receivables across consecutive years — sales converting to collections rather than to outstanding balances.",
    verdict: (ev) => `Receivables have grown slower than revenue for ${ev.years} years.`,
    doesntMean:
      "collection discipline is a working-capital fact. It says nothing about demand, margins, or whether growth continues.",
  },

  foundation_N3_deleveraging: {
    name: "Sustained deleveraging",
    description:
      "Borrowings relative to net worth have fallen across consecutive years — a decline wide enough to reflect repayment or equity accumulation rather than measurement drift.",
    verdict: (ev) =>
      `Debt relative to equity has fallen for ${ev.years} straight years, from ${ev.deFrom}× to ${ev.deTo}×.`,
    doesntMean:
      "a falling ratio can come from repayment or from equity growth, and the two are different. Lower leverage is less fragility, not more return.",
  },

  foundation_N4_coverage_strengthening: {
    name: "Coverage strengthening",
    description:
      "Trailing interest coverage has improved across consecutive quarters from a thin starting level — debt-service capacity rebuilding, not a comfortable ratio drifting higher.",
    verdict: (ev) =>
      `Interest coverage has strengthened for ${ev.quarters} straight quarters, from a thin ${ev.troughCoverage}×.`,
    doesntMean:
      "improving coverage describes debt-service capacity recovering. It is not a statement about earnings quality or about the level being comfortable now.",
  },

  ownership_N5_dual_institutional_build: {
    name: "Dual institutional build",
    description:
      "Foreign and domestic institutional holdings both increased in the same quarter — two owner classes adding at once, rather than one rotating into the other.",
    verdict: (ev) =>
      `Both foreign and domestic institutions added in the same quarter — FII ${ev.fiiDeltaPp}pp, DII ${ev.diiDeltaPp}pp.`,
    doesntMean:
      "institutional flow is what owners did last quarter, not what the stock will do. It is not agreement, not conviction, and not a signal to follow.",
  },

  ownership_N6_promoter_accumulation: {
    name: "Promoter accumulation",
    description:
      "Promoters' absolute shareholding has risen across consecutive quarters — shares actually acquired, not a percentage lifted by a shrinking share count.",
    verdict: (ev) =>
      `Promoters have increased their holding for ${ev.quarters} straight quarters — up ${ev.cumulativePp}pp.`,
    doesntMean:
      "promoters buying is a disclosure fact. Insiders are not always right, and their reasons are not visible.",
  },

  ownership_N7_pledge_release: {
    name: "Pledge release",
    description:
      "Pledged promoter shares have fallen as a proportion of promoter holding — financing encumbrance being unwound at the promoter level, which is separate from the operating business.",
    verdict: (ev) =>
      `Pledged promoter shares have fallen from ${ev.pledgeFromPct}% to ${ev.pledgeToPct}% of their holding.`,
    doesntMean:
      "a falling pledge is reduced financing stress at the promoter level. It says nothing about the operating business.",
  },
};
