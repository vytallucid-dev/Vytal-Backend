// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RATIO GATE — the only genuinely new logic in this lane.
//
// ★ WHY: BSE's ratio fields are corrupt, and the corruption is INTRA-FILER. MEASURED, AU Small
//   Finance Bank — one bank, one taxonomy, two of its own filings:
//                              Q1FY19 quarterly        FY19 annual
//     CET1Ratio                0.207  (= 20.7% ✓)      0.0019   (~100× low)
//     PercentageOfGrossNpa     0.022  (=  2.2% ✓)      0.0002   ( 103× low)
//     ReturnOnAssets           0.004  (≈  0.4% ✓)      0        (EXACTLY ZERO)
//   RELIANCE carries the same family: DebtEquityRatio 0.0041 against a true ~0.41.
//
//   ⚠ THERE IS NO UNIT RULE THAT REPAIRS THIS. It is not a scale convention — the same filer is
//     right in one document and wrong in the next. Any global multiplier would corrupt the correct
//     values in order to "fix" the wrong ones.
//
// ★ THE HOUSE PRECEDENT IS ALREADY SETTLED. fundamentals-view.service.ts:1417, on SBILIFE storing
//   persistency ~100× too small: "treated as a source discrepancy → null. NEVER a corrective
//   multiplier; the truth is 'unavailable' until a re-ingest fixes the filing."
//   This file applies that ruling at ingestion. REFUSE AND NULL. Never scale, never guess.
//
// ★ THE CHECK: recompute the ratio from ABSOLUTE siblings in the SAME instance, then compare.
//   Proven case — AU Bank FY19: GrossNonPerformingAssets 4,701,389,000 / Advances 228,187,308,000
//   = 0.020603 (2.06%) against a reported 0.0002. Caught at 103×.
//
// ⚠⚠ THE DANGEROUS ONES — RATIOS WITH NO ABSOLUTE SIBLING ANYWHERE IN THE TAXONOMY:
//        cet1_ratio · additional_tier1_ratio · tier1_ratio
//     Regulatory capital and risk-weighted assets are NOT tagged in in-bse-fin, so there is nothing
//     to recompute them from. They are UNCHECKABLE BY CONSTRUCTION and are therefore ALWAYS refused
//     by this lane. That is not a limitation to be routed around later: the only CET1 value we have
//     measured from BSE (0.0019) is wrong, so "unverifiable" and "wrong" coincide in our whole
//     sample. Tier1Ratio additionally has no tag at all — see ABSENT_TAGS.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Grain } from "./bse-discovery.js";

const NS = "in-bse-fin";

/** Relative tolerance on the recomputed ratio, before the reported value's own rounding is allowed for. */
const REL_TOL = 0.15;

export type RatioRefusalReason =
  | "failed_cross_check"
  | "no_checkable_sibling"
  | "sibling_absent_in_document"
  | "tag_absent_from_document";

export interface RatioVerdict {
  field: string;
  tag: string;
  accepted: boolean;
  /** The value as the document states it. Recorded even when refused — this is the audit trail. */
  documentValue: number | null;
  /** What the instance's own absolute figures say the ratio is. */
  derivedValue: number | null;
  /** derivedValue / documentValue. The 103x that caught AU Bank. */
  factor: number | null;
  reason: RatioRefusalReason | null;
  /** One line, for the refusal log. */
  note: string;
}

interface RatioSpec {
  field: string;
  tag: string;
  /** null => structurally uncheckable IN THIS DOCUMENT. May still be checkable cross-document. */
  numerator: string | null;
  denominator: string | null;
  /** Where the absolute siblings live. Balance-sheet siblings sit in the instant context. */
  siblingContext: "OneI" | "SAME";
  /**
   * ★ S6.3a CARVE-OUT. The denominator is missing from the QUARTERLY instance but exists in the same
   * bank's ANNUAL filing, so the ratio can be checked ACROSS documents. Set to the numerator tag to
   * enable; the caller supplies the reference via `crossDoc`.
   */
  crossDocNumerator?: string;
}

/**
 * ★ THE CROSS-DOCUMENT REFERENCE — a bank's Advances, taken from its nearest ANNUAL filing.
 *
 * ⚠ WIDE BY DESIGN, AND THE WIDTH IS EVIDENCED, NOT FITTED.
 *   The loan book moves between the quarter end and the annual reference date, so this is an
 *   ORDER-OF-MAGNITUDE check, never a precision one.
 *
 *   MEASURED, AU Small Finance Bank FY19, three consecutive quarters against the SAME FY19 annual
 *   Advances (228,187,308,000):
 *       Jun-18  reported 0.022    recomputed 0.014615   factor  0.66   ← correct
 *       Sep-18  reported 0.02     recomputed 0.016260   factor  0.81   ← correct
 *       Dec-18  reported 0.0002   recomputed 0.018438   factor 92.19   ← CORRUPT, the 100x class
 *
 *   The correct quarters sit at 0.66–0.81; the corrupt one at 92. That is roughly two orders of
 *   magnitude of separation, so the band below has ~4x headroom over the widest legitimate drift
 *   observed and still leaves ~30x margin to the corruption class.
 *
 * ⚠ THE BAND WAS NOT WIDENED TO MAKE ANYTHING PASS. Both correct quarters clear even a [1/2, 2]
 *   band. If a future case sits between 3 and 30, it is REFUSED — that is the safe direction, and
 *   widening the band to admit it would be fitting the gate to the data.
 */
export interface CrossDocReference {
  advances: number;
  asOf: string;
  sourceUrl: string;
}
const CROSS_DOC_BAND = { min: 1 / 3, max: 3 };

/**
 * ⚠ `NetSegmentAssets` stands in as the total-assets denominator in the QUARTERLY banking instance
 *   because `Assets` is not tagged there. That substitution is not an assumption — it is MEASURED:
 *   in the AU Bank FY19 ANNUAL instance, where BOTH tags exist, they are equal to the rupee
 *   (Assets = NetSegmentAssets = 326,227,965,000).
 */
const SPECS: Record<string, RatioSpec[]> = {
  "banking:quarterly": [
    // Advances is NOT tagged in a quarterly banking instance (MEASURED, AU Bank Q1FY19) — but it IS
    // in the same bank's ANNUAL filing, so these two are checked ACROSS documents. See CrossDocReference.
    { field: "gnpa_pct", tag: "PercentageOfGrossNpa", numerator: null, denominator: null, siblingContext: "SAME", crossDocNumerator: "GrossNonPerformingAssets" },
    { field: "nnpa_pct", tag: "PercentageOfNpa", numerator: null, denominator: null, siblingContext: "SAME", crossDocNumerator: "NonPerformingAssets" },
    { field: "roa_quarterly", tag: "ReturnOnAssets", numerator: "ProfitLossForThePeriod", denominator: "NetSegmentAssets", siblingContext: "OneI" },
    { field: "cet1_ratio", tag: "CET1Ratio", numerator: null, denominator: null, siblingContext: "SAME" },
    { field: "additional_tier1_ratio", tag: "AdditionalTier1Ratio", numerator: null, denominator: null, siblingContext: "SAME" },
  ],
  "banking:annual": [
    { field: "gnpa_pct", tag: "PercentageOfGrossNpa", numerator: "GrossNonPerformingAssets", denominator: "Advances", siblingContext: "OneI" },
    { field: "nnpa_pct", tag: "PercentageOfNpa", numerator: "NonPerformingAssets", denominator: "Advances", siblingContext: "OneI" },
    { field: "roa_disclosed", tag: "ReturnOnAssets", numerator: "ProfitLossForThePeriod", denominator: "Assets", siblingContext: "OneI" },
    { field: "cet1_ratio", tag: "CET1Ratio", numerator: null, denominator: null, siblingContext: "SAME" },
    { field: "additional_tier1_ratio", tag: "AdditionalTier1Ratio", numerator: null, denominator: null, siblingContext: "SAME" },
    { field: "tier1_ratio", tag: "Tier1Ratio", numerator: null, denominator: null, siblingContext: "SAME" },
  ],
};

/** Ratios whose TAG does not exist in in-bse-fin at all. Reported ABSENT — never derived from
 *  CET1 + AT1, never defaulted to 0. A missing tag is a reported absence, not a value. */
export const ABSENT_TAGS = new Set(["Tier1Ratio"]);

function readNumber(xml: string, tag: string, ctx: string): { value: number; raw: string } | null {
  const re = new RegExp(
    `<${NS}:${tag}\\b[^>]*?contextRef="${ctx}"[^>]*?>\\s*([\\-\\d.eE+]+)\\s*</${NS}:${tag}>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? { value: v, raw: m[1].trim() } : null;
}

/** One ulp of the reported decimal string, so a value rounded to 3 dp is not failed for its own
 *  rounding. Without this, 0.022 against a recomputed 0.020603 would look like a 6.8% miss. */
function quantisationTolerance(raw: string): number {
  const dot = raw.indexOf(".");
  const decimals = dot === -1 ? 0 : raw.length - dot - 1;
  return Math.pow(10, -decimals);
}

/**
 * Evaluate every ratio the given taxonomy/grain declares.
 *
 * ⚠ Returns a verdict for EVERY ratio, accepted ones included — the caller logs all of them.
 *   A silent refusal is as bad as a silent write.
 */
export function evaluateRatios(
  xml: string,
  taxonomy: "banking",
  grain: Grain,
  pnlContext: string,
  crossDoc?: CrossDocReference,
): RatioVerdict[] {
  const specs = SPECS[`${taxonomy}:${grain}`] ?? [];
  const out: RatioVerdict[] = [];

  for (const spec of specs) {
    const doc = readNumber(xml, spec.tag, pnlContext);

    if (!doc) {
      out.push({
        field: spec.field,
        tag: spec.tag,
        accepted: false,
        documentValue: null,
        derivedValue: null,
        factor: null,
        reason: "tag_absent_from_document",
        note: ABSENT_TAGS.has(spec.tag)
          ? `${spec.tag} is not present in this instance — reported ABSENT, not derived and not defaulted`
          : `${spec.tag} not found in context ${pnlContext} — reported ABSENT, never defaulted to zero`,
      });
      continue;
    }

    // ── ★ CROSS-DOCUMENT CHECK (S6.3a carve-out) ────────────────────────────
    if (!spec.numerator && spec.crossDocNumerator) {
      const num = readNumber(xml, spec.crossDocNumerator, pnlContext);
      if (!crossDoc || !num) {
        out.push({
          field: spec.field, tag: spec.tag, accepted: false, documentValue: doc.value,
          derivedValue: null, factor: null, reason: "sibling_absent_in_document",
          note:
            `${spec.tag}=${doc.raw} REFUSED — cross-document check unavailable: ` +
            `${crossDoc ? `${spec.crossDocNumerator}=ABSENT` : "no annual Advances reference for this bank"}`,
        });
        continue;
      }
      const derived = num.value / crossDoc.advances;
      const factor = doc.value === 0 ? null : derived / doc.value;
      const ok = factor !== null && factor >= CROSS_DOC_BAND.min && factor <= CROSS_DOC_BAND.max;
      out.push({
        field: spec.field, tag: spec.tag, accepted: ok, documentValue: doc.value,
        derivedValue: derived, factor, reason: ok ? null : "failed_cross_check",
        note: ok
          ? `${spec.tag}=${doc.raw} accepted (cross-doc: ${spec.crossDocNumerator}/${crossDoc.advances} ` +
            `= ${derived.toFixed(6)} using Advances as of ${crossDoc.asOf}, factor ${factor!.toFixed(2)}x within [1/3,3])`
          : `${spec.tag}=${doc.raw} REFUSED — cross-doc recomputed ${derived.toFixed(6)} from ` +
            `${spec.crossDocNumerator}/Advances(${crossDoc.asOf})` +
            (factor === null ? " (document states exactly 0)" : ` — off by ${factor.toFixed(1)}x, outside [1/3,3]`),
      });
      continue;
    }

    if (!spec.numerator || !spec.denominator) {
      out.push({
        field: spec.field,
        tag: spec.tag,
        accepted: false,
        documentValue: doc.value,
        derivedValue: null,
        factor: null,
        reason: "no_checkable_sibling",
        note: `${spec.tag}=${doc.raw} REFUSED — no absolute sibling exists in in-bse-fin to recompute it from`,
      });
      continue;
    }

    const siblingCtx = spec.siblingContext === "OneI" ? "OneI" : pnlContext;
    const num = readNumber(xml, spec.numerator, pnlContext) ?? readNumber(xml, spec.numerator, siblingCtx);
    const den = readNumber(xml, spec.denominator, siblingCtx);

    if (!num || !den || den.value === 0) {
      out.push({
        field: spec.field,
        tag: spec.tag,
        accepted: false,
        documentValue: doc.value,
        derivedValue: null,
        factor: null,
        reason: "sibling_absent_in_document",
        note:
          `${spec.tag}=${doc.raw} REFUSED — cannot recompute: ` +
          `${spec.numerator}=${num ? num.raw : "ABSENT"} ${spec.denominator}=${den ? den.raw : "ABSENT"}`,
      });
      continue;
    }

    const derived = num.value / den.value;
    const tol = Math.max(REL_TOL * Math.abs(derived), quantisationTolerance(doc.raw));
    const ok = Math.abs(derived - doc.value) <= tol;
    const factor = doc.value === 0 ? null : derived / doc.value;

    out.push({
      field: spec.field,
      tag: spec.tag,
      accepted: ok,
      documentValue: doc.value,
      derivedValue: derived,
      factor,
      reason: ok ? null : "failed_cross_check",
      note: ok
        ? `${spec.tag}=${doc.raw} accepted (recomputed ${derived.toFixed(6)} from ${spec.numerator}/${spec.denominator})`
        : `${spec.tag}=${doc.raw} REFUSED — recomputed ${derived.toFixed(6)} from ` +
          `${spec.numerator}/${spec.denominator}` +
          (factor === null ? " (document states exactly 0)" : ` — off by ${factor.toFixed(1)}x`),
    });
  }
  return out;
}

/** The fields this gate refuses, as a set the writer nulls out. */
export function refusedFields(verdicts: RatioVerdict[]): Set<string> {
  return new Set(verdicts.filter((v) => !v.accepted).map((v) => v.field));
}
