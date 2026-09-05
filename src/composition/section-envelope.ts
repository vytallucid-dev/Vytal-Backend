// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERSISTED SECTION ENVELOPE — how a rendered answer survives a renderer change. Stage 8b.
//
// ── ★ THE PROBLEM THIS EXISTS FOR ─────────────────────────────────────────────────────────────────
// A section stored today is read back in six months by a renderer that has changed. Three things can
// happen, and only one of them is acceptable:
//
//   crash        the transcript fails to load because a payload lost a field.        unacceptable
//   render wrong the new renderer reads an old payload under new assumptions and     WORSE — it is
//                draws something plausible and false.                                 undetectable
//   degrade      we notice the version is not ours and fall back to the prose.        correct
//
// The second is the one to design against. A renderer that silently misreads an old payload produces
// exactly the confident-wrong artifact §6 names, with the added cruelty that the reader already saw
// the right answer once.
//
// ── ★ SO THE VERSION IS CHECKED BEFORE THE PAYLOAD IS TOUCHED ─────────────────────────────────────
// `readEnvelope` refuses anything it does not recognise and says why. It never "tries its best" with
// an unknown shape. `content` — the digest-derived prose — is always there as the fallback, which is
// why persisting sections could be additive rather than a replacement.
//
// ── ★ WHAT IS STORED, AND WHAT IS NOT ─────────────────────────────────────────────────────────────
// The BROWSER half only: kind, renderer, payload, coverage, interactions. **The digest is not
// stored** — it is the model-facing half (N-2), and the model-facing form of this answer is already
// persisted as `content`. Storing both would put two differently-worded copies of every figure in one
// row, and the first reader of the wrong one would be quoting a number the reader never saw.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { AnySection } from "./contract.js";
import type { TurnContext } from "../router/contract.js";

/**
 * ★ BUMP THIS WHEN A STORED PAYLOAD'S MEANING CHANGES, NOT WHEN A RENDERER'S LOOK DOES.
 *
 * Adding an OPTIONAL field to a payload is not a version change — an old row simply lacks it and the
 * renderer's own absent handling covers that, which it must have anyway. Renaming a field, changing a
 * unit, or changing what a number means IS a version change, because an old row read under the new
 * meaning is a wrong answer rather than a missing one.
 */
export const SECTIONS_VERSION = 1;

/** One section as persisted. The digest is absent by construction — see the header. */
export interface StoredSection {
  readonly kind: string;
  readonly renderer: string;
  readonly payload: unknown;
  readonly coverage: unknown;
  readonly interactions: unknown;
}

export interface SectionEnvelope {
  readonly v: number;
  readonly sections: readonly StoredSection[];
  /** The prose that accompanied these sections, so a replay reads the same as the live answer did. */
  readonly prose: { readonly opening: readonly string[]; readonly leads: Record<string, string>; readonly close: string };
  /** Which composition produced it. Diagnostic — a bad replay can be traced to its author. */
  readonly compositionId: string;
  /**
   * ★ THE SLOTS THIS TURN SETTLED, SO THE NEXT ONE CAN REFER BACK TO IT — stage 9.
   *
   * ⚠ OPTIONAL, AND THEREFORE NOT A VERSION BUMP — see this file's own rule above. A row written
   * before stage 9 simply lacks it, and `lastTurnContext` reads that as "no context", which is
   * exactly how every turn behaved before this field existed. Nothing is read under a new meaning.
   *
   * It is the natural home for it: the context describes the ANSWER that was given, so it lives with
   * the answer and is deleted with it. Kept in memory instead, it would not survive a restart; kept
   * in its own column, it could drift out of step with the reply it describes.
   */
  readonly context?: TurnContext;
}

export function wrapSections(
  sections: readonly AnySection[],
  prose: { opening: readonly string[]; leads: Record<string, string>; close: string },
  compositionId: string,
  context?: TurnContext,
): SectionEnvelope {
  return {
    v: SECTIONS_VERSION,
    compositionId,
    prose,
    ...(context ? { context } : {}),
    sections: sections.map((s) => ({
      kind: s.kind,
      renderer: s.renderer,
      payload: s.payload,
      coverage: s.coverage,
      interactions: s.interactions,
    })),
  };
}

export type EnvelopeRead =
  | { readonly ok: true; readonly envelope: SectionEnvelope }
  /** `reason` is operator-facing. The reader sees `content`, which is a complete answer on its own. */
  | { readonly ok: false; readonly reason: string };

/**
 * Read a stored envelope, or refuse.
 *
 * ⚠ EVERY REFUSAL PATH RETURNS `ok: false` RATHER THAN AN EMPTY ENVELOPE. An empty section list is a
 * claim that the answer had no structure; a refusal is a statement that we could not read the one it
 * had. The caller renders `content` either way, but only the second is true.
 */
export function readEnvelope(raw: unknown): EnvelopeRead {
  if (raw === null || raw === undefined) return { ok: false, reason: "no sections stored on this row" };
  if (typeof raw !== "object") return { ok: false, reason: `sections column is ${typeof raw}, not an object` };

  const e = raw as Partial<SectionEnvelope>;
  if (typeof e.v !== "number") return { ok: false, reason: "envelope carries no version" };

  // ★ FORWARD-INCOMPATIBLE IS A REFUSAL, NOT A BEST EFFORT. A row written by a newer deploy than the
  //   one reading it (a rollback, a mixed fleet) describes a shape this code has never seen.
  if (e.v > SECTIONS_VERSION) {
    return { ok: false, reason: `stored at v${e.v}, this build reads up to v${SECTIONS_VERSION}` };
  }
  // ★ AND SO IS BACKWARD-INCOMPATIBLE. When v2 arrives, this is where an upgrade path goes — an
  //   explicit `if (e.v === 1) return upgradeV1(e)`. Until one is written, an older row degrades to
  //   its prose rather than being read under today's assumptions.
  if (e.v < SECTIONS_VERSION) {
    return { ok: false, reason: `stored at v${e.v}, no upgrade path to v${SECTIONS_VERSION} is written` };
  }

  if (!Array.isArray(e.sections)) return { ok: false, reason: "envelope has no sections array" };
  for (const s of e.sections) {
    if (!s || typeof (s as StoredSection).kind !== "string" || typeof (s as StoredSection).renderer !== "string") {
      return { ok: false, reason: "a stored section is missing its kind or renderer" };
    }
  }

  return {
    ok: true,
    envelope: {
      v: e.v,
      compositionId: typeof e.compositionId === "string" ? e.compositionId : "unknown",
      prose: e.prose ?? { opening: [], leads: {}, close: "" },
      sections: e.sections as StoredSection[],
      ...(e.context ? { context: e.context } : {}),
    },
  };
}
