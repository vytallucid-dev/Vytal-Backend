// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOT-COVERED REGISTRY — configurations that were TESTED AND DELIBERATELY NOT SHIPPED.
//
// Source: Vytal_Divergence_Tool_Spec Part 4 and Vytal_Trajectory_Tool_Spec Part 5, both titled
// "Explicitly excluded". The triggers below are theirs, verbatim.
//
// ── ★ WHY THIS EXISTS: SILENCE READS AS AN OVERSIGHT ─────────────────────────────────────────────
// Both specs record configurations that were measured and then withheld. The tool said nothing about
// any of them, so a reader looking at HDFCBANK — a 41-point Foundation↔Market spread — saw a blank
// page and had no way to tell whether we had looked and declined or simply never looked. Those are
// opposite statements about our own diligence, and the blank page made the worse one the default.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THIS IS A SECOND REGISTRY, AND THE SEPARATION IS THE WHOLE DESIGN ★★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// These records are NOT in STOCK_FINDINGS and NOT in PATTERN_KEYS, and carry NO `PatternFacts`. A
// not-covered note must never:
//
//   · enter the FIRED-FINDINGS pipeline  — it is not a finding and no rule may emit one (its keys are
//                                           NEVER unioned into FiredFindingKey / StockFindingKey)
//   · carry a SEVERITY                   — severity ranks tension; there is no claim to rank. No
//                                           record here has a severity field, ever — not even null.
//   · RANK against anything               — the read layer returns these in registry order, always
//
// ── ★ REVISION (this turn) — PERSISTENCE AND LIFECYCLE ARE NOW DELIBERATE, NOT FORBIDDEN ──────────
// An earlier version of this header additionally forbade persisting a not-covered row and forbade
// giving one a lifecycle, on the reasoning that either would "make it a claim". That blanket ban is
// LIFTED, precisely: these configurations were measured ONCE, on 95 stocks, in a mostly-bull window —
// discarding the fire event discards the only data that could ever overturn the exclusion. So a
// not-covered firing IS now persisted (score_patterns, key prefix `notcovered_`, see below) and IS
// now lifecycle-resolved (finding-lifecycle.service.ts, unchanged — see `not-covered-eval.ts`), so
// the chart and readout have the same continuity data a real finding gets.
//
// What did NOT change, and never will: no severity field, no ranking, no size or crossing figure in
// the reader-facing COPY, and — the operative word — no membership in the fired-findings pipeline. A
// persisted `notcovered_*` row is data for us to reopen the exclusion with later, not a claim for a
// reader today. Every read path that touches score_patterns has an explicit guard dropping these rows
// before they reach a finding-facing surface (§ the 9 boundaries — grep `isNotCoveredKey` /
// `dropNotCoveredPatterns` / `notCoveredKeysSqlPredicate`). If one of those nine guards is ever
// removed, a not-covered row degrades into a plausible-looking Family-E finding (see
// `retired-findings.ts`'s identical warning for the retired-key case) — silently, not by crashing.
//
// ── ⚠ NO SIZE OR ORDERING IN COPY, EVER. THE 41-POINT TRAP. ──────────────────────────────────────
// A not-covered note's TEXT never states a gap size or which way the tension resolves. The moment a
// 41-point version reads LOUDER IN PROSE than a 15-point one, we have re-created "generic widening
// spread" — which the Divergence spec excluded precisely because it FATALLY does not say which way the
// tension resolves: Foundation strengthening while Momentum rolls over, and Momentum recovering while
// Foundation erodes, produce the identical number. Opposite situations, one output; they cancel.
// (The chart-parity fields added this turn — `pair`/`gap`/`lifecycle` — are DATA, read by a chart the
// same way a real finding's are; nothing in the registry's PROSE ever names them. See not-covered.ts's
// `verify-not-covered.ts` companion, which asserts this at the copy layer, not the data layer.)
//
// ── ⚠ NEVER QUOTE THE EXCLUDED MEASUREMENT. THIS IS THE ABSOLUTE RULE. ───────────────────────────
// Every one of these has a measured figure attached to it in the spec, and every one of those figures
// is dangerous in a reader's hands. "Foundation crossing down through 72" measured **+16.9%** — hand
// that to a user beside a bearish-looking event and you have told them the exact opposite of what the
// exclusion exists to prevent. The whole reason these are excluded is that the number reads backwards.
//
// So: NO n, NO hit-rate, NO effect size, in any copy on this page. And — this turn's addition — no
// DIRECTION WORD either (bullish/bearish/positive/negative/rose/fell/…): the number ban alone left the
// sign expressible in words, which is the same leak with no digit in it. `scripts/verify-not-covered.ts`
// asserts both rather than trusting review to catch them.
//
// ⚠ GENERIC WIDENING AND NARROWING SPREAD GET NO RECORDS. They are catch-alls that would fire across
// most of the universe, and they cancel by construction (see the note above). They stay handled by
// the flat headline state — `no_pattern` — which says the same thing without pretending to name a
// configuration. The remaining silent case — a SCORED stock with no finding AND no not-covered
// configuration matched — gets its own registry-level line (`NOT_COVERED_SILENT_LINE`, below): quiet
// there means nothing tested reliably, not that nothing was looked at.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { PatternSubject } from "./pattern-facts.js";

export const NOT_COVERED_IDS = [
  "NC1", "NC2", "NC3", "NC4", "NC5", "NC6", "NC7", "NC8", "NC9", "NC10",
] as const;
export type NotCoveredId = (typeof NOT_COVERED_IDS)[number];

/**
 * WHY it was not shipped. A category, never a number.
 *
 *   evidence_conflicted   two runs disagreed; we cannot reproduce a read
 *   superseded_by_D6/T7   a tighter version of the same idea measured stronger and IS shipped
 *   bull_masked           it tested positive on a bearish-looking event, because the tape was rising
 *   regime_driven         the result belongs to the sector's phase, not to the stock
 *   indistinguishable     it tested flat; it says nothing on its own
 *   outlier_driven        a single extreme case carried the average
 */
export type NotCoveredReason =
  | "evidence_conflicted"
  | "superseded_by_D6"
  | "superseded_by_T7"
  | "bull_masked"
  | "regime_driven"
  | "indistinguishable"
  | "outlier_driven";

/** How the trigger is shaped — the evaluator switches on this, never on the id. */
export type NotCoveredTrigger =
  /** Current-value levels on one or two pillars (NC1). */
  | { readonly kind: "levels"; readonly legs: readonly { subject: PatternSubject; op: ">=" | "<="; value: number }[] }
  /** A current level plus a Δ on another subject (NC2). */
  | { readonly kind: "level_and_move"; readonly level: { subject: PatternSubject; op: ">="; value: number }; readonly move: { subject: PatternSubject; op: "<="; value: number } }
  /** A boundary crossed between two adjacent readings (NC3–NC10). */
  | { readonly kind: "crossing"; readonly subject: PatternSubject; readonly direction: "down" | "up"; readonly mark: number };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ `closeVariant` AND BOTH CLOSING LINES ARE DELETED. THE NOTE DESCRIBES THE STOCK, NOT US.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The two closings were "Tested and not shipped. We'd rather tell you we have nothing than tell you
// something we can't stand behind." and "Tested, and replaced by a sharper version. We report the one
// that reads more clearly." Both are statements about OUR PROCESS, and every record's copy opened with
// more of the same — "we tested this twice and the two runs disagreed", "this tested muted".
//
// A reader looking at HDFCBANK wants to know what is true of HDFCBANK. Narrating our own testing puts
// the model in the frame of a note that exists to describe a company, and it does it in the one place
// where we have the least to say. So every record now states the MECHANISM — why this configuration
// is structurally hard to read — and stops. The section heading already says these were tested and not
// shipped; the sentences underneath do not need to say it ten more times.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface NotCoveredRecord {
  readonly id: NotCoveredId;
  /** The pillars (or composite) involved — what the note reports values for. */
  readonly subjects: readonly PatternSubject[];
  readonly trigger: NotCoveredTrigger;
  readonly reason: NotCoveredReason;
  /**
   * The reader-facing copy, VERBATIM as ruled. ⚠ Contains no measured figure, no direction word, no
   * advisory phrasing and no account of our own testing — see the header, and
   * `scripts/verify-not-covered.ts` / `verify-copy-register.ts`, which fail the build if any appears.
   */
  readonly copy: string;
  /** ★ Always `tested_not_shipped`. This registry is the only holder of that basis. */
  readonly evidenceBasis: "tested_not_shipped";
}

/**
 * ★ THE REGISTRY-LEVEL LINE FOR THE REMAINING SILENCE. Generic widening/narrowing spread explain
 * their own silence (they were never given records — see the header). This is for the OTHER silent
 * case: a scored stock, nothing firing, and no NOT_COVERED_RECORDS trigger matched either. Rendered
 * there so quiet reads as "nothing tested reliably here", never as "nothing was looked at".
 */
export const NOT_COVERED_SILENT_LINE =
  "Quiet means nothing tested reliable here, not that nothing was looked at.";

const rec = (
  id: NotCoveredId,
  subjects: readonly PatternSubject[],
  trigger: NotCoveredTrigger,
  reason: NotCoveredReason,
  copy: string,
): NotCoveredRecord => ({ id, subjects, trigger, reason, copy, evidenceBasis: "tested_not_shipped" });

const cross = (subject: PatternSubject, direction: "down" | "up", mark: number): NotCoveredTrigger => ({
  kind: "crossing", subject, direction, mark,
});

/**
 * ★ THE AUTHORITATIVE TRIGGER↔REASON TABLE, restated in data so `verify-not-covered.ts` can assert
 * the registry against it mechanically rather than by eyeball. Source: the spec's Part 4 / Part 5
 * exclusion tables, transcribed once here — this is the ONE place a future trigger or reason edit is
 * checked against, so the registry below and this table cannot silently drift apart.
 */
export const NOT_COVERED_AUTHORITATIVE_TABLE: readonly {
  readonly id: NotCoveredId;
  readonly reason: NotCoveredReason;
  readonly summary: string;
}[] = [
  { id: "NC1", reason: "evidence_conflicted", summary: "Foundation ≥ 72 AND Market ≤ 50" },
  { id: "NC2", reason: "superseded_by_D6", summary: "Foundation ≥ 68 AND ΔMomentum ≤ −5" },
  { id: "NC3", reason: "bull_masked", summary: "Composite crosses down through 68" },
  { id: "NC4", reason: "bull_masked", summary: "Composite crosses down through 62" },
  { id: "NC5", reason: "bull_masked", summary: "Foundation crosses down through 60" },
  { id: "NC6", reason: "bull_masked", summary: "Foundation crosses down through 72" },
  { id: "NC7", reason: "regime_driven", summary: "Composite crosses up through 74" },
  { id: "NC8", reason: "superseded_by_T7", summary: "Momentum crosses up through 54" },
  { id: "NC9", reason: "indistinguishable", summary: "Momentum falls below 75 from ≥ 75" },
  { id: "NC10", reason: "outlier_driven", summary: "Foundation crosses up through 72" },
] as const;

/** ⚠ COPY IS VERBATIM AS RULED. Do not rewrite, re-punctuate or "tighten" any of it. */
export const NOT_COVERED: Readonly<Record<NotCoveredId, NotCoveredRecord>> = Object.freeze({
  // ── Divergence spec, Part 4 ────────────────────────────────────────────────────────────────────
  NC1: rec("NC1", ["foundation", "market"],
    { kind: "levels", legs: [{ subject: "foundation", op: ">=", value: 72 }, { subject: "market", op: "<=", value: 50 }] },
    "evidence_conflicted",
    "The balance sheet reads as strong while the market is paying as though it does not. Something is being priced that the accounts do not show — a sector-wide de-rating, a concern outside what these four pillars measure, or a price simply behind the business. The model cannot tell which."),

  NC2: rec("NC2", ["foundation", "momentum"],
    { kind: "level_and_move", level: { subject: "foundation", op: ">=", value: 68 }, move: { subject: "momentum", op: "<=", value: -5 } },
    "superseded_by_D6",
    "The balance sheet is intact and the trajectory has softened. Movement of this size within the ordinary range is closer to quarter-to-quarter variation than to a change in the business's direction."),

  // ── Trajectory spec, Part 5 ────────────────────────────────────────────────────────────────────
  // ⚠ NC3/NC4 AND NC5/NC6 SHARE A BODY BY DESIGN — each pair is the same mechanism at two different
  //   marks, and the mechanism is what the note is about. Two near-identical rewrites of one sentence
  //   would be two things to keep in step for no reader-visible gain.
  NC3: rec("NC3", ["composite"], cross("composite", "down", 68), "bull_masked",
    "The overall reading has moved down a band. This reading is built from results already published, so it registers a change the business has already been through — it records that something happened, not that something is coming."),

  NC4: rec("NC4", ["composite"], cross("composite", "down", 62), "bull_masked",
    "The overall reading has moved down a band. This reading is built from results already published, so it registers a change the business has already been through — it records that something happened, not that something is coming."),

  NC5: rec("NC5", ["foundation"], cross("foundation", "down", 60), "bull_masked",
    "The balance-sheet reading has fallen below its weak mark. Foundation is drawn from annual and quarterly statements, so it moves slowly — the crossing marks when the accounts confirmed the change, not when the change began."),

  NC6: rec("NC6", ["foundation"], cross("foundation", "down", 72), "bull_masked",
    "The balance-sheet reading has fallen below its strong mark. Foundation is drawn from annual and quarterly statements, so it moves slowly — the crossing marks when the accounts confirmed the change, not when the change began."),

  NC7: rec("NC7", ["composite"], cross("composite", "up", 74), "regime_driven",
    "The overall reading has reached the top band. That band describes a business in excellent health whose strength the market has generally already recognised — it confirms a condition rather than marking an opening."),

  NC8: rec("NC8", ["momentum"], cross("momentum", "up", 54), "superseded_by_T7",
    "The trajectory has climbed out of weak territory into the ordinary range. The crossing marks the exit from weakness; it says nothing about how far the recovery extends."),

  NC9: rec("NC9", ["momentum"], cross("momentum", "down", 75), "indistinguishable",
    "An unusually strong trajectory has come back toward normal. Momentum is the widest-ranging of the four pillars and spends little time above this level, so a fall from it usually reflects normalisation rather than deterioration."),

  NC10: rec("NC10", ["foundation"], cross("foundation", "up", 72), "outlier_driven",
    "The balance-sheet reading has reached its strong zone. The accounts have caught up with a business that was most likely already improving before this registered."),
});

export const NOT_COVERED_RECORDS: readonly NotCoveredRecord[] = NOT_COVERED_IDS.map((id) => NOT_COVERED[id]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ PERSISTED-KEY NAMESPACE — the notcovered_ prefix, and the exclusion helpers every read boundary
// that touches score_patterns must use. Mirrors retired-findings.ts's isRetiredFinding /
// dropRetiredPatterns / retiredKeysSqlPredicate exactly, so the two suppression mechanisms read as
// one family rather than two independently-invented ones.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The literal prefix a persisted not-covered row's patternKey carries. Never used bare — go through
 *  `notCoveredPatternKey` / `isNotCoveredKey` so a typo of the prefix itself is impossible. */
export const NOT_COVERED_KEY_PREFIX = "notcovered_";

/** The patternKey a not-covered firing is persisted under. `notcovered_NC1`, … `notcovered_NC10`. */
export const notCoveredPatternKey = (id: NotCoveredId): `notcovered_${NotCoveredId}` =>
  `${NOT_COVERED_KEY_PREFIX}${id}`;

/** Is this patternKey a persisted not-covered row (as opposed to a real finding)? */
export const isNotCoveredKey = (key: string): boolean => key.startsWith(NOT_COVERED_KEY_PREFIX);

/**
 * Drop not-covered rows from a fired/persisted set. Generic over the caller's row type — see
 * retired-findings.ts's `dropRetired` for why (a per-stock finding, a census row, an alert-key set all
 * use the same predicate without adopting a shared shape).
 */
export function dropNotCovered<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  return rows.filter((r) => !isNotCoveredKey(keyOf(r)));
}

/** Convenience for the many sites holding `{ patternKey }` rows. */
export const dropNotCoveredPatterns = <T extends { patternKey: string }>(rows: readonly T[]): T[] =>
  dropNotCovered(rows, (r) => r.patternKey);

/** A SQL fragment for the raw-SQL readers (relational/base-rates.ts, relational/reader-context.ts),
 *  so they enforce the same rule rather than a copy of it. */
export function notCoveredKeysSqlPredicate(column: string): string {
  return `${column} NOT LIKE '${NOT_COVERED_KEY_PREFIX}%'`;
}
