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
  NOT_COVERED,
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
  | {
      kind: "crossing";
      subject: PatternSubject;
      direction: "down" | "up";
      mark: number;
      prior: number;
      now: number;
      /** ★ COALESCED FIRINGS ONLY — every mark this one move passed, ascending. Absent on an ordinary
       *  single-mark crossing, which is what "one mark" actually means. This is the anti-suppression
       *  guarantee in data form: the note can state how many boundaries were crossed and where the
       *  reading landed, so consolidating never makes a constituent invisible. */
      marksCrossed?: readonly number[];
    };

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
    // ★ NC11 IS NEVER MATCHED DIRECTLY. It is the COALESCED form of a multi-mark move and is emitted
    //   only by `coalesceCrossings` below, in place of the constituents it stands for. Matching it on
    //   its own declared trigger would double-report the far mark.
    if (r.id === COALESCED_ID) continue;
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
  return coalesceCrossings(out);
}

/** The registry id that stands for a single move passing several marks. */
const COALESCED_ID = "NC11" as NotCoveredId;

/**
 * ★ ONE MOVE, ONE ENTRY — the not-covered half of the coalescing ruling (§1).
 *
 * Two notes firing on the SAME subject, in the SAME direction, from the SAME prior reading to the SAME
 * current one are not two findings; they are one move that happened to pass two of our marks. BDL is
 * the live case: the composite fell 69.1 → 60.95, passing 68 and 62, and produced NC3 and NC4 carrying
 * word-for-word identical bodies distinguished only by which number they named.
 *
 * ⚠ MATCHED ON TRIGGER SHAPE, NOT ON IDS. The pair {NC3, NC4} is not hard-coded — any future pair of
 * same-subject crossings inherits this for free, which is what "applies to the composite and to any
 * pillar" requires. A hard-coded id list would have to be revisited every time a mark is added.
 *
 * ⚠ CONSOLIDATE, NEVER SUPPRESS. The constituent marks travel on the emitted firing's `triggerDetail`
 * (`marksCrossed`), so the note can name how many boundaries were passed and where the reading landed.
 * Nothing becomes invisible; what is removed is one event rendered as several notes.
 */
function coalesceCrossings(firings: readonly NotCoveredFiring[]): NotCoveredFiring[] {
  // Group the crossing firings by the move they describe: subject + direction + the two endpoints.
  const groups = new Map<string, NotCoveredFiring[]>();
  for (const f of firings) {
    if (f.triggerDetail.kind !== "crossing") continue;
    const d = f.triggerDetail;
    const key = `${d.subject}|${d.direction}|${d.prior}|${d.now}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const merged = new Set<NotCoveredId>();
  const replacements = new Map<NotCoveredId, NotCoveredFiring>();
  for (const group of groups.values()) {
    if (group.length < 2) continue; // one mark is one crossing — nothing to coalesce
    const first = group[0].triggerDetail as Extract<NotCoveredTriggerDetail, { kind: "crossing" }>;
    const marks = group
      .map((g) => (g.triggerDetail as Extract<NotCoveredTriggerDetail, { kind: "crossing" }>).mark)
      .sort((a, b) => a - b);
    for (const g of group) merged.add(g.id);
    // The coalesced firing reports the FAR side of the span — the mark that completes the move — and
    // carries every mark passed as a fact.
    replacements.set(group[0].id, {
      id: COALESCED_ID,
      reason: NOT_COVERED[COALESCED_ID].reason,
      values: group[0].values,
      triggerDetail: {
        ...first,
        mark: first.direction === "down" ? Math.min(...marks) : Math.max(...marks),
        marksCrossed: marks,
      },
    });
  }

  if (!merged.size) return [...firings];
  // Registry order is preserved: the coalesced entry takes the position of the first constituent.
  return firings.flatMap((f) => {
    const rep = replacements.get(f.id);
    if (rep) return [rep];
    return merged.has(f.id) ? [] : [f];
  });
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
