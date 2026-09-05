// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — COVERAGE, DERIVED (§Phase 3).
//
// ⚠ WHY THIS EXISTS INSTEAD OF `resolveCoverage`. That resolver read `StockScoringState`, a table with
// ZERO rows and NO writer anywhere in the codebase (grep-verified: no .create / .update / .upsert, no
// job, no seed, no migration populated it). It therefore returned `null` IDENTICALLY for a fully-scored
// stock and a never-scored one — the one distinction a coverage state exists to make. The relational
// card consumed that null and rendered a single orientation line for an unscored stock with no
// statement of what we do or do not know about it.
//
// This module derives coverage from inputs that DO work:
//   · the in-force snapshot ref (`getLatestSnapshotRef`) — real for scored stocks, null otherwise
//   · the declined-check set persisted in Phase 2 — what we could not check, and why
//   · the presence of a peer group — the display-only firewall (no PG ⇒ never scored)
//
// ── 2026-08-09 UPDATE ─────────────────────────────────────────────────────────────────────────────
// The dead table is now GONE. `score_stock_states` was dropped and `resolveCoverage` / `CoverageInfo`
// removed with it (filing-pass step 1); health-view.service.ts, its only other caller, writes the two
// identity fields as literal nulls — the same values that resolver had always produced.
//
// NOTHING BELOW CHANGED. This derivation was already the correct implementation and is untouched: it
// reads the in-force snapshot ref, the Phase-2 declined set, and peer-group membership, none of which
// the drop affects. The note above is kept because it is still the reason this module exists.
//
// HONEST-EMPTY (§0.9): every state below is derived from something we actually observed. Where we know
// nothing — a snapshot predating the evaluability column — the state says so rather than guessing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** What we can say about our own coverage of this object. */
export type RelationalCoverageState =
  /** An in-force snapshot exists and every registered rule was evaluable on it. */
  | "scored_full"
  /** An in-force snapshot exists, but one or more checks could not run (usually history depth). */
  | "scored_partial"
  /** An in-force snapshot exists; we do not know what declined (pre-Phase-2 snapshot, null column). */
  | "scored_unknown_depth"
  /** In the catalog and in a peer group, but never scored — a coverage gap, not a judgement. */
  | "covered_unscored"
  /** In the catalog with no peer group: the display-only firewall — it is never scored by design. */
  | "display_only";

export interface RelationalCoverage {
  state: RelationalCoverageState;
  /** How many registered checks could not run. null ⇔ unknown (never conflate with 0). */
  declinedCount: number | null;
  /** The distinct decline reasons present, for the gap copy. Empty when none/unknown. */
  declinedReasons: string[];
  /** True when the reader can be told a full-strength "nothing flagged" (every check ran). */
  fullyEvaluated: boolean;
}

export interface DeriveCoverageInput {
  isScored: boolean;
  hasPeerGroup: boolean;
  /** The Phase 2 declined set: null ⇒ unknown, [] ⇒ everything evaluable, [..] ⇒ these declined. */
  notEvaluable: { ruleRef: string; reason: string }[] | null;
}

/**
 * Derive the coverage state. Pure — no I/O, so the fixture matrix can walk every branch offline.
 *
 * The scored branches turn on the null/[] distinction Phase 2 preserved: `null` is "we do not know
 * what ran", which is NOT "everything ran". Only an explicitly empty declined set earns
 * `scored_full`, and only `scored_full` sets `fullyEvaluated`.
 */
export function deriveCoverage(input: DeriveCoverageInput): RelationalCoverage {
  const { isScored, hasPeerGroup, notEvaluable } = input;

  if (!isScored) {
    // No peer group ⇒ the display-only firewall: we catalogue it but never score it, by design.
    // With a peer group ⇒ it is in scope for scoring and simply has not been scored yet.
    return {
      state: hasPeerGroup ? "covered_unscored" : "display_only",
      declinedCount: null,
      declinedReasons: [],
      fullyEvaluated: false,
    };
  }

  if (notEvaluable === null) {
    return { state: "scored_unknown_depth", declinedCount: null, declinedReasons: [], fullyEvaluated: false };
  }
  if (notEvaluable.length === 0) {
    return { state: "scored_full", declinedCount: 0, declinedReasons: [], fullyEvaluated: true };
  }
  return {
    state: "scored_partial",
    declinedCount: notEvaluable.length,
    declinedReasons: [...new Set(notEvaluable.map((d) => d.reason))],
    fullyEvaluated: false,
  };
}

/** Plain-language reason phrases for the gap copy (UG1/UG9, Phase 5). One home, authored once.
 *  A reason with no entry here degrades to a generic depth phrase rather than rendering its token. */
const REASON_PHRASES: Record<string, string> = {
  insufficient_annual_history: "more years of annual accounts than this company has filed with us",
  insufficient_quarters: "more quarters of results than we hold yet",
  insufficient_shareholding_history: "more shareholding filings than we hold yet",
  no_prior_snapshots: "a longer scoring history than this stock has with us",
  // ⚠ THE ONLY PHRASE HERE THAT IS ABOUT US RATHER THAN ABOUT THE COMPANY — F-3. Every other entry
  // completes "this needs …" with something the filings lack; a read failure must not borrow that
  // sentence, because it tells the reader the record is thin when the record is fine.
  read_failed: "a read on our side that did not complete — this is our error, not a gap in what the company filed",
  // ⚠ THE BOOK-SHAPED TWIN. `read_failed` reassures about FILINGS, which a reader's own holdings do
  // not have. The clause a reader actually needs here is that we could not read it — and, said
  // explicitly, that this is not the same as holding nothing.
  reader_read_failed:
    "a read of your own records that did not complete — this is our error, and it does not mean you hold nothing",
  // ⚠ NOT "could not compute" — see `peers_unassigned`. The comparison is not pending; there is no
  // group to compare against, which is the ordinary state for 93.5% of the universe.
  peers_unassigned: "a peer group, which this company has not been assigned to",
  opm_unavailable: "an operating-margin series we do not have for this company",
  pillar_unavailable: "pillars we could not score for this company",
  band_typical_unavailable: "a band comparison we could not compute for this period",
  feed_not_wired: "a data feed we have not connected for this company",
  missing_line_item: "figures this company did not report",
  negative_equity: "a positive net worth, which this company does not have",
  no_debt: "borrowings to measure against, which this company does not carry",
  class_not_disclosed: "an ownership breakdown this company did not disclose",
  share_count_unavailable: "an absolute promoter share count this company did not disclose",
  pledging_not_disclosed: "pledging figures this company did not disclose",
  // ⚠ NOT a data gap — a scope statement. The check itself does not apply to a bank, an NBFC or an
  // insurer (see isFinancialIndustry), so the phrase must not imply we are waiting for a filing.
  industry_not_applicable: "a measure that does not apply to how this kind of company is financed",
  // ── THE SUBJECT ITSELF, not a rule on it. The generic fallback below ("more history than this stock
  //    has with us yet") is WRONG for both: it implies we hold some history and are waiting for more.
  //    For a newly-listed company we hold none, and for a company outside coverage there is no "this
  //    stock" to have history.
  not_ingested: "a first set of quarterly results, which this company has not filed with us yet",
  not_in_universe: "a company we cover — this one is not in Vytal's universe",
};

export const reasonPhrase = (reason: string): string =>
  REASON_PHRASES[reason] ?? "more history than this stock has with us yet";

// ── UG9: what CAPABILITY a declined rule represents, in the reader's words ───────────────────────────
//
// ⚠ PROPERTY-DRIVEN, NOT AN ID LIST (§0.7). This maps a rule's stable ref to the CAPABILITY a reader
// would recognise — "earnings quality", not "R3". It is a display vocabulary, the same class of thing
// as `bandLabel`, and the entry degrades to silence rather than rendering a raw ref when a rule is
// missing from it: a rule ref on a card would violate the never-render-a-key rule outright.
//
// Several rules map to ONE capability on purpose. A reader does not need to know that three separate
// checks are involved in "earnings quality"; they need to know earnings quality could not be checked.
// The de-duplication in `describeDeclined` below relies on that collapsing.
const CAPABILITY_BY_RULE: Record<string, string> = {
  R3: "earnings quality",
  R5: "interest coverage",
  R4: "debt levels",
  P7: "earnings quality",
  P8: "working capital",
  P11: "margin trend",
  P12: "margin trend",
  P13: "revenue trend",
  // ── Family T · trajectory. B / D / I are RETIRED and their refs are gone with them. Several T
  //    patterns share one capability on purpose: a reader needs to know "the health trajectory could
  //    not be checked", not which of five rules was involved — describeDeclined de-duplicates. ──
  T1: "the health trajectory",
  T2: "the health trajectory",
  T3: "band changes",
  T4: "band changes",
  T5: "the balance-sheet trend",
  T6: "the operating trajectory",
  T7: "the operating trajectory",
  T8: "the balance-sheet trend",
  T9: "the balance-sheet trend",
  F1: "the shape of the score",
  F2: "the shape of the score",
  // ── Family C · divergence. C1/C2/C3/C_over_time and G are RETIRED and their refs are gone with
  //    them; a declined check can no longer be recorded against a rule that is not registered. ──
  D1: "price against quality",
  D2: "price against trajectory",
  D3: "ownership against fundamentals",
  D4: "ownership against fundamentals",
  D5: "pillar convergence",
  D6: "quality against trajectory",
  D7: "quality against trajectory",
  S2: "a sustained pillar gap",
  P1: "institutional rotation",
  P4: "institutional flows",
  P5: "insider activity",
  P6: "insider activity",
  P10: "promoter activity",
  H: "block and bulk deals",
  // R1 became a rule in the filing-pass build (rules/r1-pledging.ts) and can now DECLINE — pledging
  // not disclosed, promoter share count absent, one filing only. Before that it was computed inside
  // the Ownership pillar and had no declined arm at all, which is why it was missing here.
  R1: "promoter pledging",
  R2: "promoter exit",
  R6: "shareholding distribution",
  N1: "cash-backed earnings",
  N2: "working capital",
  N3: "deleveraging",
  N4: "interest coverage",
  N5: "institutional accumulation",
  N6: "promoter accumulation",
  N7: "pledge release",
};

/** One declined capability, collapsed across the rules that share it. */
export interface DeclinedCapability {
  capability: string;
  reason: string;
}

/**
 * Collapse a raw declined set into the DISTINCT capabilities a reader would recognise, each with the
 * reason it could not be checked. Rules with no capability entry are DROPPED, never rendered by ref.
 *
 * Ordering is by frequency then alphabetical — deterministic, so the card is stable across resolves
 * (§2.3). Where one capability declined for several reasons, the most common reason wins; the others
 * are not listed, because a reader needs the gap, not the audit trail.
 */
export function describeDeclined(declined: { ruleRef: string; reason: string }[]): DeclinedCapability[] {
  const byCapability = new Map<string, Map<string, number>>();
  for (const d of declined) {
    const cap = CAPABILITY_BY_RULE[d.ruleRef];
    if (!cap) continue; // unknown rule ⇒ silence, never a raw ref on a card
    const reasons = byCapability.get(cap) ?? new Map<string, number>();
    reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    byCapability.set(cap, reasons);
  }
  return [...byCapability.entries()]
    .map(([capability, reasons]) => {
      const top = [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { capability, reason: top[0], count: reasons.size };
    })
    .sort((a, b) => a.capability.localeCompare(b.capability))
    .map(({ capability, reason }) => ({ capability, reason }));
}
