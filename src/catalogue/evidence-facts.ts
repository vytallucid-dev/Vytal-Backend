// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 5 of 5 — EVIDENCE FACTS. What every key inside a fired finding's evidence bag MEANS, and
// whether a reader may see it at all.
//
// ── ★ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// The stock page rendered each evidence entry as `humanizeKey(k): String(v)`. `humanizeKey` splits on
// `_`/`-` and lowercases — a camelCase key has neither, so it survived as a re-cased copy of itself:
//
//     Pledgeratioq: 51.367518980187285      Qoqrisepp: 0        Thresholdpct: 50
//     Gapmin: 12                            Tierword: stretched Sharedn: 79
//
// Three separate defects in one line. The LABEL was authored by a string transform, so no display name
// for these keys existed anywhere in either repo. The PRECISION was `String(v)`, so a raw float
// rendered beside numbers the rules had already rounded. And the SELECTION was a 31-name deny-list
// (`PIP_SKIP`, frontend-side), so everything nobody had thought to deny was shown — including the
// model's own back-test population and its engineering notes to itself:
//
//     Sharedn: 79        Evidencedn: 22        Hotpct: 9.6        Normaln: 15
//     Caveat: "n=26, and the Ownership pillar is compressed (25th/40th/50th/60th percentiles all
//              exactly 60.0), which structurally limits sample size on every Ownership pattern."
//
// pattern-facts.ts states the rule those violate in so many words: the study figures "no longer reach
// a card". They reached a card. A deny-list cannot enforce that — it enumerates what is forbidden and
// admits everything else, so every new evidence key ships visible by default and silently.
//
// ── ★ THE INVERSION: AN ALLOW-LIST, TOTAL OVER THE LIVE VOCABULARY ────────────────────────────────
// Every evidence key is classified here, and a key that is classified nowhere RENDERS NOWHERE and is
// reported. `reader` keys carry the three facts a pip needs — label, unit, precision. `internal` keys
// carry the REASON they are internal, which is the fact worth keeping: "threshold" and "study
// statistic" are different kinds of not-for-readers, and a future reviewer needs to know which.
//
// ⚠ TOTALITY IS PROVED AGAINST LIVE DATA, NOT ASSERTED. scripts/verify-evidence-facts.ts walks every
// evidence bag in score_patterns and stock_findings and fails on any key this module
// does not classify. A rule that invents a key ships it invisible, and the gate says so.
//
// ── ★ WHAT IS A `reader` FACT ─────────────────────────────────────────────────────────────────────
// A measurement ABOUT THIS COMPANY that the finding's own sentence does not already state in words: a
// pillar reading, a gap, an ownership move, a cash figure, a count of periods. It is the receipt under
// the verdict.
//
// ── ★ WHAT IS NEVER ONE, AND WHY EACH IS SEPARATE ────────────────────────────────────────────────
//   threshold   the bar the rule fired at. A fact about the MODEL, not the company. "Thresholdpct: 50"
//               tells a reader nothing about their stock and everything about our calibration.
//   study       the pattern's back-test population — n, hit rate, effect size, per-regime splits.
//               Withheld from verdicts by explicit ruling (pattern-facts.ts `confidence`); the pips
//               were the hole in that ruling.
//   routing     a token the engine branches on — `state`, `regimeTier`, `role`, `isCrossing`. Not
//               language, not a measurement; it means nothing outside the code that reads it.
//   prose       a sentence. It belongs in the verdict or the boundary line, never chopped into a
//               key:value chip — `Driver: "Behind it: FII -0.20pp, DII +0.33pp."` is a caption
//               wearing a pip's clothes.
//   structural  an object or array the pips cannot render anyway (series, distributions, deltas).
//               Named rather than left to the type check, so "why is this not shown" has an answer.
//   duplicate   already on the card in its own slot — the verdict sentence, the finding's name, the
//               dampening note. Rendering it twice is the R1 defect (see `pledgeRatioQ`).
//
// ⚠ AN `internal` CLASSIFICATION IS NOT A JUDGEMENT THAT THE VALUE IS UNIMPORTANT. `evidencedN` is one
// of the most important facts about a pattern. It is withheld from the PIP surface because a bare
// "Evidencedn: 22" beside a company's own numbers reads as a fact about that company. Where the study
// is the subject — an explainer, the catalogue endpoint — it is served in full.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The unit a reader-facing value is printed in. `null` is a real answer: a period label ("FY26Q4"), a
 * band name ("pristine") and a pillar name ("market") are values with no unit, not values whose unit
 * we forgot.
 *
 * ⚠ `pp` AND `%` ARE NOT INTERCHANGEABLE and the distinction is load-bearing. A pledge ratio of 51.4
 * is a PERCENTAGE of the promoter holding; a quarter-on-quarter move of 0.4 is PERCENTAGE POINTS.
 * Printing the second as "%" would claim a 0.4% relative change where the fact is a 0.4pp absolute
 * one — the same conflation the ownership rules are careful about in their own sentences.
 */
export type EvidenceUnit = "%" | "pp" | "pts" | "x" | "cr" | "days" | null;

/** Why a key is withheld from the reader. See the header for what each means and why they are apart. */
export type InternalReason = "threshold" | "study" | "routing" | "prose" | "structural" | "duplicate";

/** A key a reader may see, with everything a pip needs to render it and nothing else. */
export interface ReaderEvidenceFact {
  readonly kind: "reader";
  /**
   * The display name. AUTHORED, never derived — that is the whole point of this module. Sentence case,
   * no trailing colon (the renderer adds it), and it must not be the key: a label that word-cases back
   * to its own key is the defect, and the gate rejects one.
   */
  readonly label: string;
  readonly unit: EvidenceUnit;
  /**
   * Decimals. `null` ⇒ inherit the FINDING's `displayPrecision` (catalogue/pattern-facts.ts), which is
   * the right default for a value whose precision is a property of the pattern rather than of the
   * measurement — a gap is printed at its pattern's precision, wherever it appears.
   *
   * A number here OVERRIDES that, and every override is a fact about the quantity itself: a count of
   * quarters is an integer no matter which pattern counts them, and a debt/equity ratio is 2dp because
   * that is how the ratio is read, not because of the rule that flagged it.
   *
   * ⚠ IGNORED FOR NON-NUMBERS. A string value prints verbatim; a boolean never reaches here (booleans
   * are routing tokens by construction and are classified `internal`).
   */
  readonly precision: number | null;
}

/** A key the reader never sees, carrying WHY. */
export interface InternalEvidenceFact {
  readonly kind: "internal";
  readonly reason: InternalReason;
}

export type EvidenceFact = ReaderEvidenceFact | InternalEvidenceFact;

/** Terse constructor — the table below is long enough that four-key object literals would bury it. */
const R = (label: string, unit: EvidenceUnit, precision: number | null = null): ReaderEvidenceFact => ({
  kind: "reader",
  label,
  unit,
  precision,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER VOCABULARY.
//
// ⚠ ONE LABEL PER KEY, ACROSS EVERY PATTERN THAT EMITS IT. Checked against the live corpus: no key
// name means two different things in two findings. `gapPp` is the gap in points whether D1, D5, D7 or
// S2 stamped it; `latestPeriod` is the period the reading is from in all five of its emitters. So the
// vocabulary is keyed by NAME, not by (pattern, name) — 253 pattern-key pairs collapse to one home per
// name, and a relabelling lands everywhere at once instead of in four of five places.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const READER: Record<string, ReaderEvidenceFact> = {
  // ── pillar and composite readings ────────────────────────────────────────────────────────────────
  // Points on the 0–100 scale. Not percentages: a Foundation of 64.7 is a score, and printing it "%"
  // would invite the reader to treat it as a proportion of something.
  foundation: R("Foundation", "pts"),
  momentum: R("Momentum", "pts"),
  market: R("Market", "pts"),
  ownership: R("Ownership", "pts"),
  composite: R("Health score", "pts"),
  marketPillar: R("Market", "pts"),
  meanFundamentals: R("Fundamental average", "pts"),
  foundationNow: R("Foundation now", "pts"),
  foundationPrior: R("Foundation before", "pts"),
  momentumNow: R("Momentum now", "pts"),
  momentumPrior: R("Momentum before", "pts"),
  compositeNow: R("Health score now", "pts"),
  compositePrior: R("Health score before", "pts"),
  crossFromComposite: R("Health score before", "pts"),
  ownershipFrom: R("Ownership before", "pts"),
  ownershipTo: R("Ownership now", "pts"),

  // ── gaps, spreads and moves between pillars ─────────────────────────────────────────────────────
  gap: R("Gap", "pts"),
  gapPp: R("Gap", "pts"),
  currentGap: R("Gap now", "pts"),
  recentLowGap: R("Narrowest recently", "pts"),
  peakSpread: R("Widest reached", "pts"),
  currentSpread: R("Spread now", "pts"),
  narrowedPp: R("Narrowed by", "pts"),
  widenedByPp: R("Widened by", "pts"),
  laggingDevPp: R("Lagging pillar, off typical", "pts"),
  maskingDevPp: R("Masking pillar, off typical", "pts"),
  ownershipDeltaPp: R("Ownership change", "pts"),
  movePp: R("Move", "pts"),
  risePp: R("Rise", "pts"),
  fallPp: R("Fall", "pts"),
  momentumRisePp: R("Momentum rise", "pts"),
  momentumFallPp: R("Momentum fall", "pts"),
  laggardRosePp: R("Laggard rose", "pts"),
  leaderFellPp: R("Leader fell", "pts"),

  // ── which pillar plays which part ───────────────────────────────────────────────────────────────
  // Values are engine pillar codes ("market"); the RENDERER title-cases them via the pillar label map
  // it already owns. Named here so the pip is admitted; the word itself is not authored twice.
  pillar: R("Pillar", null),
  leadPillar: R("Leading", null),
  leaderPillar: R("Leader", null),
  laggardPillar: R("Laggard", null),
  laggingPillar: R("Lagging", null),
  maskingPillar: R("Masking", null),
  convergingToward: R("Converging toward", null),
  leaderPrior: R("Led before", null),
  leaderCurrent: R("Leads now", null),

  // ── ownership: stakes, and their quarter-on-quarter moves ───────────────────────────────────────
  // ⚠ A STAKE IS A `%` OF THE COMPANY; ITS CHANGE IS `pp`. Kept apart deliberately — see EvidenceUnit.
  promoterPct: R("Promoter stake", "%", 2),
  promoterPctPrior: R("Promoter stake before", "%", 2),
  promoterPctFrom: R("Promoter stake before", "%", 2),
  promoterPctTo: R("Promoter stake now", "%", 2),
  promoterDeltaPp: R("Promoter change", "pp", 2),
  promoterPctDropPp: R("Promoter drop", "pp", 2),
  cumulativePp: R("Cumulative change", "pp", 2),
  fiiPct: R("FII stake", "%", 2),
  fiiPctPrior: R("FII stake before", "%", 2),
  fiiFrom: R("FII stake before", "%", 2),
  fiiTo: R("FII stake now", "%", 2),
  fiiDeltaPp: R("FII change", "pp", 2),
  diiFrom: R("DII stake before", "%", 2),
  diiTo: R("DII stake now", "%", 2),
  diiDeltaPp: R("DII change", "pp", 2),
  retailPct: R("Retail stake", "%", 2),
  retailPctPrior: R("Retail stake before", "%", 2),
  retailDeltaPp: R("Retail change", "pp", 2),

  // ── pledging ────────────────────────────────────────────────────────────────────────────────────
  // ⚠ `pledgeRatioQ` / `pledgeRatioQ1` are READER facts and are STILL NOT PIPS on the R1 card — the
  //   card's own movement chip already draws them as prior → current. That suppression is structural
  //   (the renderer drops whatever the evidence VISUAL consumed), not a special case here: the pair is
  //   genuinely reader-facing, and on a surface with no chip it should show.
  pledgeRatioQ: R("Promoter holding pledged", "%", 1),
  pledgeRatioQ1: R("Pledged a quarter ago", "%", 1),
  qoqRisePp: R("Change this quarter", "pp", 1),

  // ── insider and block-deal activity ─────────────────────────────────────────────────────────────
  deals: R("Deals", null, 0),
  buyCr: R("Bought", "cr", 0),
  sellCr: R("Sold", "cr", 0),
  netCr: R("Net", "cr", 0),
  grossCr: R("Gross value", "cr", 0),
  netBuyCr: R("Net bought", "cr", 0),
  netSellCr: R("Net sold", "cr", 0),
  promoterNetBuyCr: R("Promoter net buy", "cr", 0),
  buyTxns: R("Buy transactions", null, 0),
  sellTxns: R("Sell transactions", null, 0),
  distinctBuyers: R("Distinct buyers", null, 0),
  distinctSellers: R("Distinct sellers", null, 0),
  windowDays: R("Window", "days", 0),

  // ── the annual and quarterly accounts ───────────────────────────────────────────────────────────
  ocf: R("Operating cash flow", "cr", 0),
  netProfit: R("Net profit", "cr", 0),
  accrualsGap: R("Accruals gap", "cr", 0),
  cashBackPct: R("Profit backed by cash", "%", 0),
  deRatioLatest: R("Debt to equity", "x", 2),
  latestTtmIC: R("Interest coverage", "x", 2),
  latestCoverage: R("Interest coverage", "x", 2),
  troughCoverage: R("Coverage at its low", "x", 2),
  receivablesGrowthPct: R("Receivables growth", "%", 1),
  revenueGrowthPct: R("Revenue growth", "%", 1),
  outpacePp: R("Receivables outpaced revenue by", "pp", 1),
  receivablesToRevenue: R("Receivables as share of revenue", "%", 1),
  latestTtmGrowthPct: R("Revenue growth (TTM)", "%", 1),
  priorTtmGrowthPct: R("Revenue growth a year ago", "%", 1),
  deltaPp: R("Change", "pp", 1),

  // ── how long it has been true ───────────────────────────────────────────────────────────────────
  quarters: R("Quarters", null, 0),
  years: R("Years", null, 0),
  quartersOfDecline: R("Quarters declining", null, 0),
  quartersOfRecovery: R("Quarters recovering", null, 0),
  consecutiveQuarters: R("Consecutive quarters", null, 0),
  consecutiveYears: R("Consecutive years", null, 0),
  sustainedReadings: R("Readings it has held for", null, 0),
  sustainedSnapshots: R("Readings it has held for", null, 0),

  // ── which filing / quarter the reading is from ──────────────────────────────────────────────────
  period: R("Period", null),
  periodKey: R("Period", null),
  latestPeriod: R("Period", null),
  currentPeriod: R("Period", null),
  priorPeriod: R("Compared with", null),
  fromPeriod: R("From", null),
  toPeriod: R("To", null),
  sincePeriod: R("Standing since", null),
  peakPeriod: R("Widest at", null),

  // ── the words the finding lands on ──────────────────────────────────────────────────────────────
  band: R("Band", null),
  toBand: R("Moved into", null),
  direction: R("Direction", null),
  // ⚠ `tierWord` IS NOT HERE — it is classified `duplicate` below. It carries the SAME value as
  //   `tier` (verified: 570 co-occurrences, 0 disagreements, and it never appears without `tier`),
  //   so admitting both put "Severity tier: stretched" on the S2 card twice in a row.
  tier: R("Severity tier", null),
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE INTERNAL VOCABULARY — names only, grouped by the reason they are withheld.
//
// ★ A LIST OF NAMES, NOT 180 FOUR-FIELD OBJECTS. An internal key has exactly one fact worth recording
// (why), and the group IS that fact. Written as objects it would be 180 near-identical literals in
// which a wrong `reason` is invisible; written as groups, a key sitting in the wrong list is a
// one-line reading error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const INTERNAL: Readonly<Record<InternalReason, readonly string[]>> = {
  // ── THE BARS THE RULE FIRED AT. Facts about the model's calibration, never about the company. ───
  threshold: [
    "threshold", "thresholdPct", "thresholdPp", "thresholdQoqRisePp",
    "gapMin", "riseMin", "minFall", "minMovePp", "minCumulativePp", "minReadings", "minRises", "minYears",
    "ocfNpMin", "lowBaseMax", "noiseFloorPp",
    "prevMin", "weakMark", "strongMark", "stillBelow", "nativeThreshold",
    "crossedAbove", "crossedBelow",
    "marketMin", "marketFormedAt", "momentumMax", "foundationMax", "foundationMin",
    "largeMoveCutPp", "strongCutPp", "buildingFloorPp", "formedAtPp",
    "notableCut", "wideCut",
    // T6's record of the mark it USED to borrow (the composite's 60, against Momentum's own 54). A
    // withdrawn bar is still a bar — see `borrowedThresholdFalseReading` under `study`.
    "borrowedThreshold",
  ],
  // ── THE PATTERN'S OWN BACK-TEST. Withheld from verdicts by ruling; the pips were the hole in it. ─
  study: [
    "evidencedN", "evidencedPct", "evidencedPositivePct", "evidencedSectorExcessPct",
    "evidencedAbsolutePct", "evidencedAbsolutePositivePct", "evidencedFellPct", "evidencedForwardPct",
    "evidencedMeanPct", "evidencedMedianPct",
    "sharedN", "bareBreakN", "bareBreakPct", "bareBreakPositivePct",
    // ★ THE MEASURED FALSE READINGS — the numbers that PROVE a bar or a phase misleads (T2's +15% in
    //   the 2021–26 bank bull, T6's +3.2% off the borrowed composite mark). They are study output, and
    //   a card printing "Bullmaskedreading: 15" beside a deterioration finding stated the opposite of
    //   what the figure means.
    "bullMaskedReading", "borrowedThresholdFalseReading",
    "mirrorN", "mirrorPct", "mirrorPositivePct", "mirrorSectorExcessPct",
    "hotN", "hotPct", "hotPositivePct",
    "normalN", "normalPct", "normalPositivePct", "normalPhasePct", "normalPhasePositivePct",
    "stressedN", "stressedPct", "stressedPositivePct",
    "overallN", "overallPct", "overallPositivePct", "pooledPct", "readingPct", "meanPct",
    "sameDayPct", "sameDayPositivePct", "sevenDayPct", "sevenDayPositivePct",
    "frontRunN", "frontRunPositivePct", "frontRunSectorExcessPct",
    "atTurnPositivePct", "atTurnSectorExcessPct",
    "combinedPositivePct", "combinedSectorExcessPct",
    "disclosureAnchoredN", "disclosureAnchoredPct", "disclosureAnchoredPositivePct",
    "twoSidedWindowMeanPct", "twoSidedAllNegative", "medianLeadDays",
    "afterTheMovePct", "afterTheMovePositivePct",
  ],
  // ── TOKENS THE ENGINE BRANCHES ON. Not language; meaningless outside the code that reads them. ──
  routing: [
    "state", "strong", "cause", "special", "provisional", "subtype", "variant", "type", "leg",
    "family", "role", "scope", "lens", "metricKey", "fieldVerdict", "pattern", "rule", "card",
    "regimeTier", "regimeReadPhases", "regimeConditionalCopy", "mustDisplayPhase",
    "hotIsMasked", "normalHasDirectionalRead", "gapTierApplies", "tierSeverityIfApplied",
    "isCrossing", "isMovePattern", "isPillar", "leadsComposite", "floorLed", "leaderChanged",
    "headlineFigure", "meanIsMisleading", "worstOddsInStudy", "directionalOnly", "sampleSizePreserved",
    "evidenceInherited", "largeMovePriceAlreadyRan", "readerIsEarly", "mirrorIsT6",
    "crossDownThrough60IsExcluded", "crossIntoStrongIsExcluded", "baseDoesNotCushion",
    "spansQuarterGap", "suppressedByBD", "firstBreach", "firedRule", "dilutionVerdict",
    "basedOn", "reason", "returnClaim", "flow", "guardClean",
  ],
  // ── SENTENCES. They belong in the verdict or the boundary line, never chopped into a chip. ──────
  prose: [
    "caveat", "meanCaveat", "structuralNote", "driver", "inheritedFrom", "sectorWide", "calibration",
    "label", "tone",
  ],
  // ── OBJECTS AND ARRAYS. Named rather than left to a typeof check, so "why not shown" has an answer.
  structural: [
    "series", "opmSeries", "ttmSeries", "deHistory", "gapTrajectory", "trajectory", "profile",
    "pillarDeltas", "compositeHeld", "shareholding", "breaches", "legs", "trigger", "values",
    "triplet", "peer", "shares", "regimeAtEvent", "rawValue",
  ],
  // ── ALREADY ON THE CARD IN ITS OWN SLOT. Rendering twice is the defect, not the redundancy. ─────
  duplicate: [
    "name", "verdict", "verbatim",
    // The §1.2 tier word — byte-identical to `tier` on every row that carries both, and never
    // present without it. Two keys, one fact, and the pips rendered it twice.
    "tierWord",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESOLVED TABLE. One entry per key; the two halves are asserted DISJOINT at module load, because
// a key in both lists would resolve by whichever branch ran first — a silent, order-dependent answer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const EVIDENCE_FACTS: Readonly<Record<string, EvidenceFact>> = (() => {
  const out: Record<string, EvidenceFact> = { ...READER };
  const collisions: string[] = [];
  for (const [reason, keys] of Object.entries(INTERNAL) as [InternalReason, readonly string[]][]) {
    for (const k of keys) {
      if (out[k]) collisions.push(k);
      out[k] = { kind: "internal", reason };
    }
  }
  if (collisions.length) {
    throw new Error(
      `catalogue/evidence-facts.ts: ${collisions.length} key(s) classified BOTH reader and internal ` +
        `[${[...new Set(collisions)].join(", ")}] — one key, one classification.`,
    );
  }
  return out;
})();

/**
 * ★ THE LOOKUP, AND THE ONLY ONE. `null` means THIS MODULE DOES NOT CLASSIFY THE KEY — which is a gap
 * to report, never a licence to render it. Every caller treats null as "withhold and tell someone";
 * none of them falls back to humanising the key, because that fallback is the defect.
 */
export const evidenceFact = (key: string): EvidenceFact | null => EVIDENCE_FACTS[key] ?? null;

/** Is this key one a reader may see? False for internal AND for unclassified — see {@link evidenceFact}. */
export const isReaderEvidence = (key: string): boolean => EVIDENCE_FACTS[key]?.kind === "reader";

/** The reader half alone, for the surfaces that render pips and for the generated frontend bundle. */
export const READER_EVIDENCE_FACTS: Readonly<Record<string, ReaderEvidenceFact>> = READER;

/** Every classified key, for the totality gate. */
export const CLASSIFIED_EVIDENCE_KEYS: readonly string[] = Object.keys(EVIDENCE_FACTS).sort();

// ── ★ THE LABEL DISCIPLINE, ENFORCED AT MODULE LOAD ───────────────────────────────────────────────
//
// The defect being closed is a MASHED CAMELCASE KEY shipped as a display name — "Pledgeratioq",
// "Gappp", "Distinctbuyers". It is invisible in review, because it reads as a typo rather than as a
// missing authored name, so it is a boot failure instead.
//
// ⚠ THE TEST IS AGAINST `humanizeKey` ITSELF, NOT AGAINST THE KEY. A label that merely RESEMBLES its
// key is not the defect: `foundation` → "Foundation" and `band` → "Band" are the correct display names
// and there is nothing else they could be. The first draft of this gate compared casefolded letters
// and flagged all 21 of those — a gate that fires on correct copy is the failure phs/verify-phs-copy.ts
// warns about, because the only way to silence it is to make the copy worse.
//
// So it fires on exactly the keys that HAVE a mashed form to be lazy with: those carrying an interior
// capital. For a single-word key `humanizeKey` returns the right answer and agreeing with it is not a
// finding.
const humanizeKey = (key: string): string => {
  const s = key.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const isCamel = (key: string) => /[a-z][A-Z]/.test(key);
const mashed = Object.entries(READER).filter(([k, f]) => isCamel(k) && f.label === humanizeKey(k));
if (mashed.length) {
  throw new Error(
    `catalogue/evidence-facts.ts: ${mashed.length} label(s) are the camelCase key mashed into one word ` +
      `[${mashed.map(([k]) => k).join(", ")}] — author a display name or classify the key internal.`,
  );
}
const blank = Object.entries(READER).filter(([, f]) => f.label.trim().length === 0);
if (blank.length) {
  throw new Error(`catalogue/evidence-facts.ts: empty label(s) on [${blank.map(([k]) => k).join(", ")}].`);
}
