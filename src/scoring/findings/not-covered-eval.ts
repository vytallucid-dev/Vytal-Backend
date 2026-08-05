// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOT-COVERED MATCH ENGINE — pure evaluation of NOT_COVERED_RECORDS against one stock's current
// and prior readings. NEUTRAL: shared by the READ layer (not-covered.service.ts, building the
// display note) and the WRITE layer (score-pass.ts, building the persisted row), so the two can never
// disagree about which configurations matched. Lives under scoring/findings/ — the write-side realm —
// rather than scoring/read/, because score-pass.ts (compute/persist) must not depend on the read
// layer.
//
// PURE. No DB. Two readings in, the full match set out — richer than the wire shape
// (not-covered.service.ts's `NotCoveredFor`), because the write path needs the RAW triggering numbers
// (persisted for future re-analysis) that the reader-facing note deliberately never carries.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import {
  NOT_COVERED_RECORDS,
  type NotCoveredId,
  type NotCoveredReason,
  type NotCoveredRecord,
} from "../../catalogue/not-covered.js";
import type { PatternSubject } from "../../catalogue/pattern-facts.js";

/** One reading of every subject a trigger can name. Null ⇒ not scored / not available. */
export interface SubjectReadings {
  composite: number | null;
  foundation: number | null;
  momentum: number | null;
  market: number | null;
  ownership: number | null;
}

const at = (r: SubjectReadings, s: PatternSubject): number | null => r[s];

/** The RAW numbers a trigger matched on — different shape per trigger kind. Persisted for future
 *  re-analysis of the exclusion; never read back into reader-facing copy (see not-covered.ts header). */
export type NotCoveredTriggerDetail =
  | { kind: "levels"; legs: { subject: PatternSubject; value: number }[] }
  | { kind: "level_and_move"; level: { subject: PatternSubject; value: number }; move: { subject: PatternSubject; now: number; prior: number; delta: number } }
  | { kind: "crossing"; subject: PatternSubject; direction: "down" | "up"; mark: number; prior: number; now: number };

export interface NotCoveredFiring {
  id: NotCoveredId;
  reason: NotCoveredReason;
  /** subject → current value, for every subject the record names. */
  values: Partial<Record<PatternSubject, number>>;
  triggerDetail: NotCoveredTriggerDetail;
}

/**
 * Evaluate the registry against one stock. All matching records are returned, in registry order —
 * NOTHING RANKS THEM (see not-covered.ts header).
 *
 * @param now    the current readings, inert-0 guarded by the caller (null ⇒ not scored)
 * @param prior  the previous head's readings, or null when there is no prior. A crossing and a Δ both
 *               NEED a prior; with none they simply do not match — a stock with one reading has not
 *               crossed anything.
 */
export function notCoveredFirings(now: SubjectReadings, prior: SubjectReadings | null): NotCoveredFiring[] {
  const out: NotCoveredFiring[] = [];
  for (const r of NOT_COVERED_RECORDS) {
    const detail = matchDetail(r, now, prior);
    if (!detail) continue;
    const values: Partial<Record<PatternSubject, number>> = {};
    for (const s of r.subjects) {
      const v = at(now, s);
      // A subject the note names must have a value to report; if it does not, the trigger could not
      // have matched, so this is unreachable — asserted rather than assumed.
      if (v === null) continue;
      values[s] = v;
    }
    out.push({ id: r.id, reason: r.reason, values, triggerDetail: detail });
  }
  return out;
}

/** Does the record's trigger match, and if so, what were the raw numbers? Returns null on no match —
 *  a single function so "matched" and "the detail" can never disagree with each other. */
function matchDetail(r: NotCoveredRecord, now: SubjectReadings, prior: SubjectReadings | null): NotCoveredTriggerDetail | null {
  const t = r.trigger;

  if (t.kind === "levels") {
    const legs: { subject: PatternSubject; value: number }[] = [];
    for (const l of t.legs) {
      const v = at(now, l.subject);
      if (v === null) return null;
      if (l.op === ">=" ? v < l.value : v > l.value) return null;
      legs.push({ subject: l.subject, value: v });
    }
    return { kind: "levels", legs };
  }

  if (t.kind === "level_and_move") {
    const lv = at(now, t.level.subject);
    if (lv === null || lv < t.level.value) return null;
    if (!prior) return null;
    const nowMove = at(now, t.move.subject);
    const priorMove = at(prior, t.move.subject);
    if (nowMove === null || priorMove === null) return null;
    const delta = nowMove - priorMove;
    if (delta > t.move.value) return null;
    return { kind: "level_and_move", level: { subject: t.level.subject, value: lv }, move: { subject: t.move.subject, now: nowMove, prior: priorMove, delta } };
  }

  // crossing — the mark must be strictly crossed BETWEEN the two readings.
  if (!prior) return null;
  const a = at(prior, t.subject);
  const b = at(now, t.subject);
  if (a === null || b === null) return null;
  // ⚠ The direction convention matches the specs' own: "crosses down through M" is prior ≥ M and now
  //   < M; "crosses up through M" is prior < M and now ≥ M. A reading that merely SITS past the mark
  //   has not crossed it, and reporting it as a crossing would fire this on most of the universe.
  const crossed = t.direction === "down" ? a >= t.mark && b < t.mark : a < t.mark && b >= t.mark;
  if (!crossed) return null;
  return { kind: "crossing", subject: t.subject, direction: t.direction, mark: t.mark, prior: a, now: b };
}
