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
    columns: [
      "fundamentals.book_value_per_share", "banking_fundamentals.book_value_per_share",
      "nbfc_fundamentals.book_value_per_share", "life_insurance_fundamentals.book_value_per_share",
      "general_insurance_fundamentals.book_value_per_share", "*_fundamentals.face_value_share",
    ],
    origin:
      "derive/derive-indas-annual.ts (the shared home for plausibleFaceValue/boundDerived/" +
      "meaningfulBookValue), derive/derive-banking-annual.ts, derive/derive-nbfc-annual.ts, " +
      "derive/derive-li-annual.ts and derive/derive-gi-annual.ts — bookValuePerShare = netWorth / " +
      "(paidUpCapital / faceValue) on every one of the five *_fundamentals tables (LI/GI: faceValue " +
      "defaults to the ₹10 IRDAI norm when absent/invalidated — see fix).",
    fault:
      "★ CLOSED, 2026-08-11 — resolved, kept as the historical record annual-manifest.ts's " +
      "book_value_per_share exclusion note still points to. 'The parser wrote the paid-up capital into " +
      "the face-value slot' was WRONG as an explanation: verified against the raw filed XBRL for " +
      "KOTAKBANK FY25 standalone, `PaidUpValueOfEquityShareCapital`=9,941,100,000 (unitRef=INR → " +
      "₹994.11cr) and `FaceValueOfEquityShareCapital`=994.11 (unitRef=INRPerShare) are TWO DISTINCT " +
      "facts in the same filing that happen to share a numeral — extractCommonPerShare " +
      "(parser-common.ts) reads two different tag names correctly; nothing in the parser conflates " +
      "them. This is a SOURCE FILING error. Confirmed on SEVEN real rows across three tables, in two " +
      "shapes: (a) FACE-VALUE SIDE — faceValueShare corrupted to byte-equal paidUpEquityCapital — " +
      "KOTAKBANK (994.11, BankingFundamental), LTF (2494.87, NbfcFundamental), MOTILALOFS (6018.6 — not " +
      "byte-equal, a distinct ~×100 corruption, NbfcFundamental), ITCHOTELS (208.12), JKTYRE (57.66) and " +
      "EXIDEIND (85, all three Fundamental/non-financial — EXIDEIND found by the closing sweep, not " +
      "named going in); (b) PAIDUP SIDE (the mirror shape) — an ORDINARY, correctly-formed face value " +
      "with paidUpEquityCapital itself the corrupt figure — CANFINHOME (NbfcFundamental) confirmed live; " +
      "ICICIBANK FY23 consolidated (BankingFundamental) confirmed corrupt but currently INERT (net_worth " +
      "null that row, so bookValuePerShare never computes — contained by accident, not by design; will " +
      "surface the day net_worth backfills unless re-derived first, see fix). ★ THE KEY LESSON, PROVEN " +
      "TWICE: neither bound alone is complete. plausibleFaceValue's magnitude check (v>1000) missed " +
      "KOTAKBANK/ITCHOTELS/JKTYRE/EXIDEIND — all four sit UNDER the cutoff. meaningfulBookValue's " +
      "₹1,00,000 OUTPUT ceiling missed ITCHOTELS (₹10,692) and JKTYRE (₹5,283–6,061) even after being " +
      "applied — their paid-up capital (₹208cr, ₹54–58cr) is far smaller than KOTAKBANK's ₹994cr, so the " +
      "SAME relative corruption (shares collapsed to ~1cr) produces a bvps that is proportionally just " +
      "as wrong but not absolutely extreme enough to clear a flat magnitude bound. What actually closes " +
      "the face-value-side shape is plausibleFaceValue's NEW optional 2nd parameter (paidUpEquityCapital) " +
      "— a RELATIONAL check, not a magnitude one: reject a face value that exactly equals the row's own " +
      "paidUpEquityCapital, regardless of how small both numbers are.",
    scope:
      "ALL FIVE *_fundamentals tables now scoped and gated. Confirmed-corrupt rows, all now corrected " +
      "(re-derived + re-ingested): BankingFundamental 1/~51 FY25+FY26 standalone rows (KOTAKBANK); " +
      "NbfcFundamental 4/245 rows (MOTILALOFS, LTF, CANFINHOME — all face-value-side except CANFINHOME " +
      "which is paidUp-side); Fundamental (non-financial) 4/2161 rows across 3 stocks (ITCHOTELS FY25 " +
      "consolidated, JKTYRE FY26 both bases, EXIDEIND FY26 standalone — all face-value-side). Full sweep " +
      "of Fundamental (2161 rows / 408 stocks) post-fix: 0 relational outliers, 0 output outliers, 3 " +
      "pre-existing magnitude outliers (DRREDDY/HCLTECH/NATIONALUM, all faceValueShare=0, already " +
      "harmlessly null since before this fix existed). life_insurance_fundamentals / " +
      "general_insurance_fundamentals: face_value_share is 0% populated on both (0/15, 0/16) — gated, " +
      "zero live outliers, but that was true before the gate too since nothing had arrived; the gate is " +
      "what makes the FIRST real disclosed value safe rather than a coincidence of timing. ICICIBANK " +
      "FY23 consolidated (BankingFundamental) is the one KNOWN-corrupt row not yet re-derived — inert " +
      "today, tracked in fix.",
    containedBy:
      "★ FINAL STATE, 2026-08-11 — all five *_fundamentals tables import the SAME three helpers from one " +
      "shared module (derive-indas-annual.ts), zero duplicated copies: plausibleFaceValue(v, " +
      "paidUpEquityCapital?) rejects a faceValueShare that is out of the 0–1000 magnitude range OR " +
      "(optional 2nd arg) byte-equal to the row's own paidUpEquityCapital, before either value reaches " +
      "the stored column or the derivation. boundDerived() nulls a display ratio that would overflow its " +
      "own column rather than reject the whole row (unrelated to this fault, pre-existing). " +
      "meaningfulBookValue() bounds the bookValuePerShare OUTPUT at ₹1,00,000/share — the single highest " +
      "LEGITIMATE value anywhere across all five tables is MRF (non-financial) at ~₹49,468; nothing else " +
      "clears ₹7,500 — catching the paidUp-side mirror shape (CANFINHOME) that no input-side check can " +
      "reach, regardless of magnitude. annual-manifest.ts's absence of book_value_per_share from all " +
      "five manifests STAYS (a display column, not a score input, and a separate exposure decision from " +
      "correctness) — but its note claiming 'no single-metric bound catches it' is now FACTUALLY " +
      "SUPERSEDED and has been corrected in place to point here. ON LI/GI SPECIFICALLY the ₹10 IRDAI-norm " +
      "default is KEPT, deliberately: `faceValueShareSane ?? 10` runs on the sanitised value, so 'never " +
      "disclosed' and 'disclosed but implausible' get the SAME treatment instead of the implausible case " +
      "going to null while the undisclosed case still defaults — removing the default would silently " +
      "delete every currently-correct bvps on both tables (0% of either table's face_value_share is " +
      "populated, so every served value comes from this fallback).",
    fix:
      "★ SHIPPED — there was never a parser fix available; the extraction is already correct, the " +
      "erroneous fact is what the filer submitted, and containment at the derive layer IS the permanent " +
      "fix (not a stopgap until a re-filing that will not come). ONE piece of remaining work, tracked " +
      "for whoever next touches BankingFundamental: re-derive ICICIBANK so its corrupt FY23 " +
      "paidUpEquityCapital is caught by meaningfulBookValue the moment net_worth backfills, rather than " +
      "relying on the accident of a coincidentally-absent denominator. Everything else in this entry's " +
      "scope is closed.",
  },
];

/** ⚠ THE PHRASE verify-annual-metrics.ts LOOKS FOR IN A MANIFEST NOTE. A note that claims a fault
 *  belongs upstream must have an entry here, or the claim is a comment with nowhere to go. */
export const BACKLOG_MARKER = "belongs in the XBRL parser";

export const backlogIds = (): string[] => PARSER_BACKLOG.map((e) => e.id);
