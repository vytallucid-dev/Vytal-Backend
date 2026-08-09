// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE PARSER BACKLOG — FAULTS THAT BELONG AGAINST THE FILED XBRL, NOT BEHIND A GUARD.
//
// ── WHY THIS FILE EXISTS, AND WHY IT IS CODE RATHER THAN A DOC ──────────────────────────────────
// Three columns are WRONG IN THE DATABASE. Each was found downstream — by a manifest bound, by a
// rendered card — and each was contained downstream, because containment was what the stage in front
// of it could afford. Containment is not a fix:
//
//   · the bad value is still stored, and every future consumer meets it fresh;
//   · the containment lives in a manifest, which is the wrong place to look for a parser fault;
//   · a reader of the ingestion code has no way to learn that the column they are about to trust is
//     known-broken.
//
// Three separate notes in three manifests told nobody who works on the parser anything. This is the
// register, it sits beside the parser, and verify-annual-metrics.ts asserts that every manifest note
// claiming a fault "belongs in the XBRL parser" has an entry here. A comment is not a mechanism; a
// register a gate reads is.
//
// ── ⚠ NOTHING IMPORTS THIS TO CHANGE BEHAVIOUR, AND THAT IS CORRECT ─────────────────────────────
// These are not runtime switches. The downstream containments stay exactly as they are until the
// parse is fixed AND the stored rows are re-ingested — turning a containment off because the parser
// was fixed, without re-reading the affected filings, would surface the old bad values immediately.
// Each entry names its own containment so that ordering is not something anyone has to reconstruct.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface ParserBacklogEntry {
  /** Stable id, greppable. */
  id: string;
  /** The stored column(s), as filed in the database. */
  columns: readonly string[];
  /** Which parse/derivation produced the wrong value. */
  origin: string;
  /** What is wrong, with the evidence that found it. */
  fault: string;
  /** How many rows, measured. */
  scope: string;
  /** What holds the line downstream TODAY, and which must not be removed before a re-ingest. */
  containedBy: string;
  /** What fixing it actually requires. */
  fix: string;
}

export const PARSER_BACKLOG: readonly ParserBacklogEntry[] = [
  {
    id: "PB-1",
    columns: [
      "life_insurance_quarterly_results.persistency_ratio_{13,25,37,49,61}_month",
      "life_insurance_fundamentals.persistency_ratio_{13,25,37,49,61}_month",
    ],
    origin: "xbrl/parser-li.ts — parseLifeInsuranceQuarterly / parseLifeInsuranceAnnual",
    fault:
      "SBILIFE's five persistency ratios are stored at roughly one hundredth of their true value — " +
      "0.0084–0.0088 where the filed figure is about 85%. The distribution is bimodal with an EMPTY " +
      "GAP: 5 rows below 0.10, ZERO rows between 0.10 and 0.40, 36 rows above 0.40. That gap is what " +
      "makes it a parse fault rather than a plausible small number.",
    scope: "Every quarter on file for SBILIFE, plus 2 of 14 rows on the annual table.",
    containedBy:
      "manifest.ts — a { min: 20, max: 100 } display bound on all five ratios, chosen inside the " +
      "empty gap. The metric is WITHHELD for that issuer and the withholding is stated in the card's " +
      "gaps, so a reader is told rather than shown a wrong number.",
    fix:
      "Read the unit/scale context on the persistency facts in the filed XBRL rather than assuming a " +
      "fraction, then re-ingest SBILIFE's filings. The bound stays until the re-ingest lands.",
  },
  {
    id: "PB-2",
    columns: ["banking_quarterly_results.tier1_ratio", "banking_fundamentals.tier1_ratio"],
    origin: "derive/derive-banking-annual.ts and derive-financial-quarterly.ts — tier1 = cet1 + at1",
    fault:
      "A DERIVED column built on a mis-parsed input. AXISBANK FY27Q1 stores cet1 14.64%, at1 15.35% " +
      "and therefore tier1 29.99% — a real additional-tier-1 sliver is one to two points, not fifteen. " +
      "Measured on FY26+ banking rows the MEDIAN tier1-minus-cet1 gap is 0.00pp, so on most rows the " +
      "column carries no information cet1 does not, while 18 of 229 rows show a gap above 3pp and 21 " +
      "exceed a 25% tier-1 ratio, topping out at CUB's 42.7%. Either redundant or wrong.",
    scope: "18 of 229 FY26+ banking rows carry an implausible gap; the at1 parse is the root.",
    containedBy:
      "manifest.ts and annual-manifest.ts — tier1_ratio and additional_tier1_ratio are absent from " +
      "both manifests entirely. Core capital (cet1) is the figure a reader needs and it is sound.",
    fix:
      "Fix the additional-tier-1 extraction against the filed source, then re-derive. ⚠ NO BOUND CAN " +
      "SUBSTITUTE: 29.99% is a perfectly plausible capital ratio and is only implausible BESIDE its " +
      "own cet1, which is why this was never containable by a single-metric rule.",
  },
  {
    id: "PB-3",
    columns: ["banking_fundamentals.book_value_per_share", "*_fundamentals.face_value_share"],
    origin: "derive/derive-banking-annual.ts — bookValuePerShare = netWorth / (paidUpCapital / faceValue)",
    fault:
      "KOTAKBANK FY25 stores a book value per share of ₹117,239.89, which is its ENTIRE NET WORTH IN " +
      "₹ CRORE. `face_value_share` on that row is 994.11 — the same number as `paid_up_equity_capital`. " +
      "The parser wrote the paid-up capital into the face-value slot, so the derived share count came " +
      "out as one and the ratio became its own numerator. ITCHOTELS (face value 208.12) and JKTYRE " +
      "(57.66) are the same fault in the non-financial parse.",
    scope:
      "1 of 51 FY25+FY26 banking standalone rows; 1 of 734 non-financial. face_value_share is also " +
      "0% populated on the life-insurance table, where the derivation cannot run at all.",
    containedBy:
      "annual-manifest.ts — book_value_per_share is absent from ALL FIVE annual manifests, recorded " +
      "on banking.basicEps. Net worth in rupees says the same thing with no share count in the " +
      "denominator. ⚠ No bound works: MRF's real book value is ₹49,468 a share, so any bound loose " +
      "enough to keep MRF admits Kotak at twice the magnitude.",
    fix:
      "Fix the face-value extraction (it is a filed fact, not a derivation), then re-derive every " +
      "per-share figure that divides by a share count. Only then is the per-share form worth re-adding.",
  },
];

/** ⚠ THE PHRASE verify-annual-metrics.ts LOOKS FOR IN A MANIFEST NOTE. A note that claims a fault
 *  belongs upstream must have an entry here, or the claim is a comment with nowhere to go. */
export const BACKLOG_MARKER = "belongs in the XBRL parser";

export const backlogIds = (): string[] => PARSER_BACKLOG.map((e) => e.id);
