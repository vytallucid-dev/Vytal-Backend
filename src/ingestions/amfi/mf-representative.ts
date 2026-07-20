// ═══════════════════════════════════════════════════════════════════════════
// THE REPRESENTATIVE-PLAN RULE — ONE HOME.
//
// A family's members have DIFFERENT returns: Direct and Regular differ by the expense ratio, and
// an IDCW/Bonus plan's own metrics are either inherited from its tier-matched Growth twin or
// declined outright (Step 19). So "the fund's return" is meaningless until something picks WHICH
// member's numbers that means — and whatever picks it must be the SAME choice everywhere the fund
// is shown, or a family reads +18.4% in a list and +17.1% when opened: a contradiction a user will
// find and never trust us again after.
//
// THE RULE (ratified for the detail page, now the only place it may live):
//   1. Direct + Growth,  if it exists AND has a real series to show (never a declined default when
//      a working one exists in the family).
//   2. else Regular + Growth, same condition.
//   3. else ANY measurable member.
//   4. else the family's first member — reported honestly as declined; a family we cannot measure
//      still exists and must still be findable, not silently dropped.
//
// "measurable" mirrors /chart and /analytics exactly: `seriesSchemeCode !== null`. A Growth plan is
// measurable unless it is genuinely dead (zero NAV points) — the distribution fold (mf-distributions.ts)
// never declines a true Growth plan, so step 1/2 failing straight to a declined pick is the rare,
// honest exception, not the common case.
//
// CALLERS: GET /mf/:schemeCode/family (mf-controllers.ts) and GET /api/v1/funds (fund-discovery.ts)
// both call `resolveRepresentative` — neither re-derives the fallback chain itself. The frontend's
// `pickDefaultMember` (Vytal-Frontend components/fund-detail/identity-section.tsx) is this rule's
// CLIENT-SIDE twin, ported here verbatim; it should eventually be deleted in favour of reading the
// server-stated `representativeSchemeCode` this module now produces — that is a Vytal-Frontend change,
// out of scope for this backend task, and is called out in the build report rather than made silently.
// ═══════════════════════════════════════════════════════════════════════════
import type { PlanTier } from "./mf-distributions.js";

export interface RepresentativeCandidate {
  schemeCode: string;
  tier: PlanTier;
  optionLabel: "growth" | "bonus" | "idcw";
  /** seriesSchemeCode !== null — the same test /chart and /analytics already decide on. */
  measurable: boolean;
}

/**
 * The representative member of a family, by the one rule above. `null` only when the family has
 * no members at all (should not occur — every family has ≥1 by construction).
 */
export function resolveRepresentative<T extends RepresentativeCandidate>(
  members: readonly T[],
): T | null {
  if (members.length === 0) return null;

  const byTierGrowth = (tier: PlanTier) =>
    members.find((m) => m.tier === tier && m.optionLabel === "growth" && m.measurable);

  return (
    byTierGrowth("direct") ??
    byTierGrowth("regular") ??
    members.find((m) => m.measurable) ??
    members[0]
  );
}
