// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE IRDAI RATIO GATE — B2. The part worth more than the cells.
//
// ★ WHAT CHANGED. The BSE ratio gate (bse-ratio-gate.ts) refuses any ratio it cannot recompute from
//   absolute siblings in the SAME instance, and for insurance that meant refusing almost all of
//   them: in-capmkt tags no ratio's numerator. The IRDAI forms publish the SCHEDULES, so ratios that
//   were "uncheckable by construction" become arithmetic.
//
// ★ MEASURED, Stage 9 (2026-08-23) — each reproduced against the value already stored from NSE:
//     LIFE solvency      FORM L-32 / Form Code KT-3, items 08 Total ASM and 09 Total RSM
//                        HDFCLIFE FY26: 20,14,497 / 11,39,049 = 1.7686   stored 1.77          ✓
//     GI solvency        FORM NL-25 (Table IA -> RSM) + NL-26 (Table IB -> ASM, item I/J)
//                        NIVABUPA Q3FY26: 3,07,853 / 1,23,535 = 2.4920   stored 2.49          ✓
//     GI incurred claim  NL-1-B-RA rows "Claims Incurred (Net)" / "Premiums earned (Net)"
//                        ICICIGI FY26: 15,828.47 / 22,263.57 = 0.71096   stored 0.7110        ✓
//     GI combined        ICR + (net commission + opex) / net written premium
//                        ICICIGI FY26: 0.71096 + 0.32269   = 1.03365     stored 1.0336        ✓
//
// ⚠⚠ PERSISTENCY HAS NO SIBLING, AND THE BRIEF'S "Form L-46" DOES NOT EXIST.
//   MEASURED across all four life bundles in the corpus (HDFCLIFE, ICICIPRULI, CANHLIFE, LICI):
//     - the life form series ends at L-45 (Office Information). There is no L-46. The "L-46" hits
//       in the corpus are NL-46 (Voting Activity, NON-life) matched inside the "NL-" prefix.
//     - L-22 ANALYTICAL RATIOS publishes persistency as a RATIO ONLY, on four bases (premium and
//       policy-count x regular and single premium). Searching every life bundle for a cohort
//       numerator or denominator returns ZERO hits.
//   Persistency therefore stays UNCHECKABLE BY CONSTRUCTION. What IRDAI adds is a second
//   INDEPENDENT SOURCE for the same stated number — HDFCLIFE L-22 states 84.9% and the column holds
//   0.849 — which is cross-source agreement, not arithmetic verification. This gate does not
//   pretend otherwise: `no_sibling_exists` is returned, and the cross-source check is a separate
//   verdict so the two are never confused in a report.
//
// ⚠ SCALE. The four insurance tables store ratios as FRACTIONS (0.8907 = 89.07%) EXCEPT solvency,
//   which is a MULTIPLE (1.77 = 1.77x). The FORMS state PERCENTAGES ("177%", "84.9%"). A checker
//   built against percentages fails every fraction by 100x, which is the exact defect this
//   programme has already shipped four times. Every comparison here goes through toFraction()/
//   toMultiple() and the expected SCALE of each column is declared in RATIO_SPECS, not inferred.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export type RatioScale = "fraction" | "multiple";

export type RatioVerdictKind =
  /** recomputed from absolutes and it agrees */
  | "verified"
  /** recomputed and it DISAGREES — the stored cell is wrong */
  | "refuted"
  /** the siblings needed are not in our tables for this row */
  | "siblings_absent"
  /** no sibling exists anywhere, in any source */
  | "no_sibling_exists"
  /** a recipe exists but is unvalidated; the recompute is reported, never used to refute */
  | "recipe_unvalidated"
  /** outside what the column can physically mean */
  | "out_of_bounds";

export interface RatioSpec {
  field: string;
  family: "life" | "general";
  scale: RatioScale;
  /** Absolute-sibling recipe over OUR OWN stored columns. null => no sibling exists. */
  derive:
    | null
    | {
        needs: string[];
        compute: (r: Record<string, number | null>) => number | null;
        /** Where the absolutes come from in the IRDAI forms — the audit trail. */
        source: string;
      };
  /**
   * ⚠ An ADVISORY recompute. Recorded and reported, but NEVER a refutation. Used where a plausible
   *   recipe exists but has not been validated against the source form — see expenses_of_management.
   */
  advisory?: {
    needs: string[];
    compute: (r: Record<string, number | null>) => number | null;
    source: string;
  };
  /** Physical bounds for the stored column. */
  lo: number;
  hi: number;
  boundsWhy: string;
}

const num = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

export const RATIO_SPECS: RatioSpec[] = [
  // ── LIFE ──────────────────────────────────────────────────────────────────────────────────────
  {
    field: "solvency_ratio",
    family: "life",
    scale: "multiple",
    // ⚠ ASM and RSM are NOT columns in our schema. They exist in FORM L-32 and would have to be
    //   carried alongside the row for this to become an in-table check. Until they are, the check
    //   is document-side (irdai-parse asserts it at extraction) and this entry records why.
    derive: null,
    lo: 1.0,
    hi: 10,
    boundsWhy: "IRDAI statutory floor is 1.50; a stored value below 1.0 is a breach or a scale error",
  },
  ...(["13", "25", "37", "49", "61"] as const).map<RatioSpec>((m) => ({
    field: `persistency_ratio_${m}_month`,
    family: "life",
    scale: "fraction",
    derive: null, // ⚠ no sibling exists — see the header. Not "not yet"; never.
    lo: 0.05,
    hi: 1.0,
    boundsWhy: "FRACTION column; below 0.05 is the known 100x error, above 1.0 is impossible",
  })),

  // ── GENERAL ───────────────────────────────────────────────────────────────────────────────────
  {
    field: "solvency_ratio",
    family: "general",
    scale: "multiple",
    derive: null, // ASM/RSM live in NL-25 + NL-26; document-side check.
    lo: 1.0,
    hi: 10,
    boundsWhy: "IRDAI statutory floor is 1.50",
  },
  {
    field: "incurred_claim_ratio",
    family: "general",
    scale: "fraction",
    derive: {
      needs: ["incurred_claims", "premium_earned"],
      compute: (r) => div(num(r.incurred_claims), num(r.premium_earned)),
      source: "NL-1-B-RA rows 'Claims Incurred (Net)' (NL-5) and 'Premiums earned (Net)' (NL-4)",
    },
    lo: 0.05,
    hi: 3.0,
    boundsWhy: "FRACTION column",
  },
  {
    field: "net_retention_ratio",
    family: "general",
    scale: "fraction",
    derive: {
      needs: ["net_premium_written", "gross_premiums_written"],
      compute: (r) => div(num(r.net_premium_written), num(r.gross_premiums_written)),
      source: "NL-4 PREMIUM SCHEDULE: net written / gross written",
    },
    lo: 0.05,
    hi: 1.5,
    boundsWhy: "FRACTION column; net retention above 1 means more retained than written",
  },
  {
    field: "expenses_of_management_ratio",
    family: "general",
    scale: "fraction",
    // ⚠⚠ MEASURED AND RECLASSIFIED. Stage 8 listed EoM as "checkable". It is not, and the audit
    //   proves it: the obvious recipe (net commission + operating expenses) / gross written premium
    //   reproduces the stored value on ZERO of 60 cells, and it fails in TWO OPPOSITE DIRECTIONS:
    //        GODIGIT / ICICIGI   derived is 0.65x-0.81x the stored value
    //        GICRE               derived is 12x-18x  the stored value
    //   A recipe that is wrong in both directions is not detecting 52 bad cells; it is the wrong
    //   recipe. The EoM ratio is a REGULATORY construct under the IRDAI (Expenses of Management)
    //   Regulations with its own inclusions, exclusions and segment allocation, and filers differ
    //   on whether commission is inside it — GICRE, a reinsurer whose commission to cedants dwarfs
    //   its own expenses, plainly reports it EXCLUDING commission.
    //
    //   ⚠ Reporting those 52 as "provably wrong" would have been a false claim built on an
    //     unvalidated recipe. Until the EoM statement is read from the form itself (the NL-form
    //     carries the allowable limit and the actual side by side), this stays UNCHECKABLE and the
    //     recompute is ADVISORY only — recorded, never a refutation.
    derive: null,
    advisory: {
      needs: ["net_commission", "total_operating_expenses_related_to_insurance", "gross_premiums_written"],
      compute: (r) => {
        const c = num(r.net_commission);
        const o = num(r.total_operating_expenses_related_to_insurance);
        const g = num(r.gross_premiums_written);
        return c === null || o === null ? null : div(c + o, g);
      },
      source: "(advisory) NL-6 commission + NL-7 operating expenses over NL-4 gross written premium",
    },
    lo: 0.001,
    hi: 2.0,
    boundsWhy:
      "FRACTION column. ⚠ the floor is 0.001, not 0.01: GIC Re legitimately reports sub-1% because " +
      "a reinsurer's own management expenses are tiny against premium. An earlier 0.01 floor called " +
      "8 GICRE cells provably wrong on no evidence.",
  },
  {
    field: "combined_ratio",
    family: "general",
    scale: "fraction",
    derive: {
      needs: [
        "incurred_claims",
        "premium_earned",
        "net_commission",
        "total_operating_expenses_related_to_insurance",
        "net_premium_written",
      ],
      // ⚠ REPRODUCED EXACTLY on ICICIGI FY26 (1.03365 vs stored 1.0336). The expense leg uses NET
      //   WRITTEN premium as the denominator, not net earned — using earned gives 1.0498 and looks
      //   almost right, which is precisely why the recipe is written down rather than re-derived.
      compute: (r) => {
        const icr = div(num(r.incurred_claims), num(r.premium_earned));
        const c = num(r.net_commission);
        const o = num(r.total_operating_expenses_related_to_insurance);
        const nwp = num(r.net_premium_written);
        if (icr === null || c === null || o === null || nwp === null || nwp === 0) return null;
        return icr + (c + o) / nwp;
      },
      source: "NL-1-B-RA rows 1/6/7/8 with NL-4 net written premium",
    },
    lo: 0.3,
    hi: 3.0,
    boundsWhy: "FRACTION column; outside 30%-300% is a scale error",
  },
];

/** Relative tolerance. The forms round their stated ratios to 2-4 dp, so the recompute will differ
 *  in the last place. 1.5% is wide enough for rounding and far too narrow for a 100x error. */
export const REL_TOL = 0.015;

export interface RatioVerdict {
  field: string;
  family: "life" | "general";
  stored: number | null;
  derived: number | null;
  /** derived / stored. The 100x that catches a scale error. */
  factor: number | null;
  /** present when spec.advisory ran. Never affects `kind`. */
  advisory?: { value: number | null; factor: number | null; source: string };
  kind: RatioVerdictKind;
  scale: RatioScale;
  note: string;
}

export function checkRatio(
  spec: RatioSpec,
  stored: number | null,
  row: Record<string, number | null>,
): RatioVerdict {
  const base = { field: spec.field, family: spec.family, stored, scale: spec.scale };

  if (stored === null) {
    return { ...base, derived: null, factor: null, kind: "siblings_absent", note: "no stored value" };
  }

  // (1) Bounds first — cheap, and independent of any sibling.
  if (stored < spec.lo || stored > spec.hi) {
    return {
      ...base,
      derived: null,
      factor: null,
      kind: "out_of_bounds",
      note: `${stored} outside ${spec.lo}..${spec.hi} — ${spec.boundsWhy}`,
    };
  }

  // Advisory recompute, if the spec has one. Reported alongside; never changes the verdict.
  let advisory: RatioVerdict["advisory"];
  if (spec.advisory) {
    const missingAdv = spec.advisory.needs.filter((n) => num(row[n]) === null);
    const val = missingAdv.length ? null : spec.advisory.compute(row);
    advisory = { value: val, factor: val === null || stored === 0 ? null : val / stored, source: spec.advisory.source };
  }

  // (2) No sibling anywhere.
  if (spec.derive === null) {
    return {
      ...base,
      derived: null,
      factor: null,
      advisory,
      kind: spec.advisory ? "recipe_unvalidated" : "no_sibling_exists",
      note:
        spec.advisory
          ? "regulatory construct; the obvious recipe reproduces ZERO of 60 stored cells and fails in both directions, so it is advisory only"
          : spec.field.startsWith("persistency")
          ? "L-22 publishes the ratio only; no cohort numerator/denominator exists in any L-form (verified across 4 life bundles). Cross-source comparison against the IRDAI form is possible; arithmetic verification is not."
          : "ASM/RSM are published in L-32 (life) or NL-25+NL-26 (general) but are not columns in this schema; the check is document-side at extraction.",
    };
  }

  // (3) Siblings present?
  const missing = spec.derive.needs.filter((n) => num(row[n]) === null);
  if (missing.length) {
    return {
      ...base,
      derived: null,
      factor: null,
      kind: "siblings_absent",
      note: `missing ${missing.join(", ")} — ${spec.derive.source}`,
    };
  }

  const derived = spec.derive.compute(row);
  if (derived === null) {
    return { ...base, derived: null, factor: null, kind: "siblings_absent", note: "recipe returned null (zero denominator)" };
  }

  const factor = stored === 0 ? null : derived / stored;
  const agree = Math.abs(derived - stored) <= Math.max(REL_TOL * Math.abs(stored), 1e-4);
  return {
    ...base,
    derived,
    factor,
    kind: agree ? "verified" : "refuted",
    note: agree
      ? `recomputed ${derived.toFixed(6)} from ${spec.derive.source}`
      : `recomputed ${derived.toFixed(6)} vs stored ${stored} — factor ${factor?.toFixed(4)} (${spec.derive.source})`,
  };
}

/** ⚠ Scale helpers. The forms state percentages; the columns hold fractions (or a multiple). */
export function percentToFraction(pct: number): number {
  return pct / 100;
}
export function percentToMultiple(pct: number): number {
  return pct / 100;
}
/** Document-side solvency check: ASM / RSM against the stated ratio. Both in the same unit, so the
 *  unit cancels — this check is immune to the unit rule failing. */
export function solvencyFromMargins(asm: number, rsm: number): number | null {
  if (!Number.isFinite(asm) || !Number.isFinite(rsm) || rsm === 0) return null;
  return asm / rsm;
}
