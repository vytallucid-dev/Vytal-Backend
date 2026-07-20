// ─────────────────────────────────────────────────────────────
// AMFI CATEGORY NORMALISATION + the ranking bucket (RULING ②).
//
// THE PROBLEM recon found: AMFI ships TWO generations of section header for the SAME
// economic category, and both are live in today's file:
//
//     "Open Ended Schemes(Debt Scheme - Overnight Fund)"                  → 250 schemes
//     "Open Ended Schemes(Income/Debt Oriented Schemes - Overnight Fund)" →   4 schemes
//
// Ranking on the RAW string strands those 4 funds in a category of their own and ranks them
// against nobody. 58 raw strings collapse to 49 real leaves.
//
// THE BUCKET (ruling ②): (normalised leaf category, plan_type), OPEN-ENDED + ACTIVE only.
//
//   · leaf, not raw    — or the legacy/modern split fragments the pool (above).
//   · × plan_type      — a Direct plan out-returns its own Regular twin by the expense gap
//                        (~0.5–1.5 %/yr). Ranking them together makes the percentile encode
//                        PLAN CHOICE rather than fund quality: every Direct plan would
//                        mechanically outrank its own mirror image.
//   · open-ended only  — 4,720 close-ended/FMP codes (only 198 active) are not purchasable.
//                        They still GET analytics; they just get no percentile.
//   · active only      — a dormant fund's stale return would distort a live pool.
//
// AUDITABILITY: the normalisation is a pure function over a visible prefix list, not a hand
// -maintained 58-row lookup that silently rots when AMFI adds a category. `describeCategories`
// dumps the full raw→leaf mapping so a human can check it (see verify-step10b-categories.ts).
// ─────────────────────────────────────────────────────────────

/**
 * The scheme-class prefixes AMFI puts in front of the leaf, across BOTH naming generations.
 * Order matters only in that longer, more specific prefixes must precede shorter ones.
 */
const CLASS_PREFIXES = [
  // ── modern (current) naming ──
  "Debt Scheme",
  "Equity Scheme",
  "Hybrid Scheme",
  "Other Scheme",
  "Solution Oriented Scheme",
  // ── legacy naming AMFI STILL SHIPS (the fragmentation source) ──
  "Income/Debt Oriented Schemes",
  "Growth/Equity Oriented Schemes",
  "Hybrid Schemes",
  "Solution Oriented Schemes",
  "Money Market",
];

/** True when the category's WRAPPER says the scheme is open-ended (the only rankable kind). */
export function isOpenEnded(category: string | null): boolean {
  if (!category) return false;
  return /^\s*Open\s+Ended/i.test(category);
}

/** Close-ended + interval schemes: analytics yes, percentile no. */
export function isCloseEndedOrInterval(category: string | null): boolean {
  if (!category) return false;
  return /^\s*(Close\s+Ended|Interval)/i.test(category);
}

/**
 * "Open Ended Schemes(Income/Debt Oriented Schemes - Overnight Fund)" → "Overnight Fund"
 * "Open Ended Schemes(Debt Scheme - Overnight Fund)"                  → "Overnight Fund"
 * "Close Ended Schemes(Income)"                                       → "Income"
 *
 * Strips the "…Schemes( … )" wrapper, then the scheme-class prefix, leaving the leaf that
 * actually names the economic category. Returns null when there is nothing to normalise.
 */
export function normaliseCategory(category: string | null): string | null {
  if (!category) return null;
  const m = /\(([^)]*)\)/.exec(category);
  let leaf = (m ? m[1]! : category).trim();

  for (const p of CLASS_PREFIXES) {
    // "Debt Scheme - Overnight Fund" → "Overnight Fund"
    const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-\\s*`, "i");
    if (re.test(leaf)) {
      leaf = leaf.replace(re, "").trim();
      break;
    }
  }
  return leaf || null;
}

/** Ranking is only meaningful against a real pool. Below this, the percentile is noise. */
export const MIN_BUCKET_SIZE = 5;

/** Why a fund has no rank. Lands verbatim in mf_analytics.omissions — never a fabricated 50th percentile. */
export type UnrankedReason =
  | "close_ended_or_interval"
  | "dormant"
  | "plan_type_unknown"
  | "bucket_too_small"
  | "no_category";

export interface BucketInput {
  category: string | null;
  planType: string | null;
  isActive: boolean;
}

export type BucketResult =
  | { bucket: string; leaf: string }
  | { bucket: null; reason: UnrankedReason };

/**
 * The ranking bucket for one scheme, or an HONEST REASON it has none.
 *
 * Note the plan_type rule: Step 9 deliberately refused to GUESS a plan type from the scheme
 * name (24.8% of names simply don't say). We honour that here — 880 rankable funds have a
 * NULL plan, and rather than guess which pool they belong to, they get NO percentile and a
 * reason. Guessing a bucket is exactly as dishonest as guessing the plan was.
 */
export function rankBucketFor(i: BucketInput): BucketResult {
  if (isCloseEndedOrInterval(i.category)) return { bucket: null, reason: "close_ended_or_interval" };
  if (!i.isActive) return { bucket: null, reason: "dormant" };

  const leaf = normaliseCategory(i.category);
  if (!leaf) return { bucket: null, reason: "no_category" };
  if (!i.planType) return { bucket: null, reason: "plan_type_unknown" };

  return { bucket: `${leaf}|${i.planType}`, leaf };
}

/** Split a stored bucket key back into its parts (for display / audit). */
export function parseBucket(bucket: string): { leaf: string; planType: string } {
  const ix = bucket.lastIndexOf("|");
  return { leaf: bucket.slice(0, ix), planType: bucket.slice(ix + 1) };
}
