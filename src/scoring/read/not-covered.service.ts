// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOT-COVERED READ VIEW — builds the reader-facing note from the shared match engine
// (findings/not-covered-eval.ts). Adds the two things a READER needs that the persisted row does not:
// the joined copy (record's copy + its own closing line) and, when the shape has one, the pair the
// chart would draw.
//
// ── ★ STILL NOT A FireRule ────────────────────────────────────────────────────────────────────────
// The note built here carries NO severity field — not even null — and is never ranked. What changed
// this turn (see not-covered.ts's header) is that the SAME firings this function reports are now also
// PERSISTED (score-pass.ts, via findings/persist.ts's persistNotCovered) and LIFECYCLE-RESOLVED
// (finding-lifecycle.service.ts, unchanged). The caller (health-view.service.ts) attaches that
// lifecycle after calling this function — `notCoveredFor` itself stays a pure function of two
// readings, same as before, because it has no DB access and should not gain one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import {
  NOT_COVERED,
  type NotCoveredId,
  type NotCoveredReason,
} from "../../catalogue/not-covered.js";
import type { PatternSubject } from "../../catalogue/pattern-facts.js";
import { notCoveredFirings, type SubjectReadings } from "../findings/not-covered-eval.js";
import { roundToPrecision } from "../findings/format.js";
import type { FindingLifecycle } from "./finding-lifecycle.types.js";
import type { PillarKey } from "./health-view.types.js";

export type { SubjectReadings };

/** One subject's reading, for the note to report. */
export interface NotCoveredReading {
  subject: PatternSubject;
  value: number;
}

/** The two-pillar pair a chart would draw — same shape as DivergencePair minus `patternKey` (a
 *  not-covered configuration is not a PatternKey, so it has no record to name it by). Null for every
 *  single-subject record (NC3–NC10 each name one pillar or the composite; only NC1/NC2 name two real
 *  pillars). ⚠ DATA, for chart parity — never stated in `text`. See not-covered.ts's header. */
export interface NotCoveredPair {
  high: { pillar: PillarKey; subtotal: number };
  low: { pillar: PillarKey; subtotal: number };
  gap: number;
}

/**
 * ★ THE WIRE SHAPE. `pair` and `lifecycle` are chart-parity DATA (this turn's Part 3) — the copy in
 * `text` never states either. There is deliberately no `severity` field anywhere on this interface.
 */
export interface NotCoveredNote {
  id: NotCoveredId;
  /** Which spec this configuration came from, and therefore which tool may show it — NC1/NC2 are
   *  divergence, NC3–NC10 are trajectory. Served so a consumer filters on DATA, never on the id. */
  tool: "divergence" | "trajectory";
  reason: NotCoveredReason;
  /** The pillars involved and their values. NO gap, NO ordering, NO magnitude — see `pair` for the
   *  chart-facing form of the same numbers. */
  readings: NotCoveredReading[];
  /** The two-pillar spread a chart draws, when the record names two real pillars. Null otherwise. */
  pair: NotCoveredPair | null;
  /** Continuity, read off the SAME resolver a real finding uses (finding-lifecycle.service.ts) —
   *  filled in by the caller, which already resolves lifecycles for the stock's whole pattern set.
   *  Null until persisted rows exist for this stock (a not-covered firing observed only today). */
  lifecycle: FindingLifecycle | null;
  /** The record's copy, verbatim. ⚠ NOTHING IS APPENDED. The two shared closing lines are deleted —
   *  both were statements about our own testing, on a note whose job is to describe the stock. */
  text: string;
  /** Always `tested_not_shipped` — the state that says the model looked and declined. */
  evidenceBasis: "tested_not_shipped";
}

/**
 * Evaluate the registry against one stock and build the reader-facing notes.
 *
 * @param now    the head's readings, inert-0 guarded by the caller (null ⇒ not scored)
 * @param prior  the previous head's readings, or null when there is no prior.
 */
export function notCoveredFor(now: SubjectReadings, prior: SubjectReadings | null): NotCoveredNote[] {
  return notCoveredFirings(now, prior).map((f) => {
    const rec = NOT_COVERED[f.id];
    const readings: NotCoveredReading[] = rec.subjects.map((s) => ({
      subject: s,
      value: roundToPrecision(f.values[s]!, 1),
    }));
    return {
      id: f.id,
      tool: rec.tool,
      reason: f.reason,
      readings,
      pair: pairFor(rec.subjects, f.values),
      lifecycle: null, // attached by the caller — see the file header
      text: rec.copy,
      evidenceBasis: "tested_not_shipped",
    };
  });
}

/** The high/low pair for a two-real-pillar record. Null for composite or single-subject records —
 *  the honest answer, same convention divergence-headline.ts's `pairOf` uses for a real finding. */
function pairFor(subjects: readonly PatternSubject[], values: Partial<Record<PatternSubject, number>>): NotCoveredPair | null {
  if (subjects.length !== 2) return null;
  if (subjects.some((s) => s === "composite")) return null;
  const [nameA, nameB] = subjects;
  const a = values[nameA];
  const b = values[nameB];
  if (a === undefined || b === undefined) return null;
  const [hiName, hiVal, loName, loVal] = a >= b ? [nameA, a, nameB, b] : [nameB, b, nameA, a];
  return {
    high: { pillar: hiName as PillarKey, subtotal: roundToPrecision(hiVal, 1) },
    low: { pillar: loName as PillarKey, subtotal: roundToPrecision(loVal, 1) },
    gap: roundToPrecision(hiVal - loVal, 0),
  };
}
