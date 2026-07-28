// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — THE STANDALONE SERVICE (§0 / §6.2).
//
// Resolves for (object, reader) and emits a FINISHED RelationalState — rendered claims, the negatives for
// the AI layer, and meta.degradations. Building this as a standalone service with the card as ONE consumer
// is not optional (§6.2): the card and the AI layer read the SAME finished object. This module is the
// single entry point both call.
//
// GUARANTEED-RESOLVE (§0.4): every reader gets a card. The mode floor is reserved and always resolves;
// the theoretically-impossible empty state is a bug, logged, never an empty card.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { resolveObjectState } from "./object-state.js";
import { resolveReaderContext, anonymousContext } from "./reader-context.js";
import { resolveMode } from "./mode.js";
import { buildEntries } from "./entries.js";
import { assemble } from "./arbitration.js";
import { scanAssembled, scanStrength } from "./copy.js";
import type { RelationalState, ReaderContext, ObjectState } from "./types.js";

/**
 * The PURE composition — mode → entries → arbitration → guard → RelationalState. No DB, no I/O: a pure
 * function of (ReaderContext, ObjectState) so the synthetic fixture matrix (§8) can verify the whole
 * logic offline. `resolveRelationalState` below wraps it with the DB-touching resolvers. `now` is
 * injectable so a fixture can freeze it for stable duration/attention math.
 */
export function composeRelationalState(ctx: ReaderContext, obj: ObjectState, now: Date = new Date()): RelationalState {
  const mode = resolveMode(ctx, now);
  const built = buildEntries(ctx, obj, mode);
  const { slots, overflow } = assemble(built.floorIds, built.candidates, built.cap);

  // ── Guaranteed-resolve backstop (§0.4 / Part X): the floor is reserved, so this is unreachable — if it
  //    is ever reached it is a BUG, not an empty state. Log loud (the card still carries its header). ──
  if (slots.length === 0) {
    console.error(`[relational] EMPTY CARD for stock ${obj.stockId} mode ${mode.mode} — floor failed to resolve`);
  }

  // ── The register guard over the ASSEMBLED output (§4.2 step 7 / §0.11) — header + every rendered claim,
  //    never the fragments alone. Our copy is deterministic and clean; a violation is a build error the
  //    verification asserts against. At runtime we log rather than blank the card. ──
  const allEntries = [...slots, ...overflow];
  const assembledStrings = [built.header.claim, ...allEntries.map((s) => s.claim)];
  const violations = scanAssembled(assembledStrings, ctx.identity.aiLevel);
  // Celebration is scoped to strength claims (UO6) — never band labels / finding verdicts (§3.1).
  const strengthViolations = allEntries.filter((e) => e.entryId === "UO6").flatMap((e) => scanStrength(e.claim));
  const all = [...violations, ...strengthViolations];
  if (all.length > 0) {
    console.warn(`[relational] register-guard violations on stock ${obj.stockId}:`, all.map((v) => `${v.term} in "${v.text}"`));
  }

  return {
    mode: mode.mode,
    header: built.header,
    slots,
    overflow,
    negatives: built.negatives,
    meta: {
      resolvedAt: now.toISOString(),
      snapshotGeneration: obj.snapshot?.generation ?? null,
      // Delta framing (lastLookLabel) lands with the UD slice; null here rather than quoting attention
      // as content (§0.6). Recorded in degradations.delta_family.
      lastLookLabel: null,
      degradations: built.degradations,
    },
  };
}

/**
 * Resolve the RelationalState for a reader (userId null ⇒ anonymous) and a stock. Returns null ONLY when
 * the stockId is not a real stock (the caller 404s) — every real stock, for every reader, resolves a card.
 */
export async function resolveRelationalState(userId: string | null, stockId: string): Promise<RelationalState | null> {
  // Object first: a non-stock id is the one honest 404. Reader context resolves in parallel for an
  // authenticated caller (object-independent, so it can run alongside).
  const [obj, ctx] = await Promise.all([
    resolveObjectState(stockId),
    userId ? resolveReaderContext(userId, stockId) : Promise.resolve(anonymousContext()),
  ]);
  if (!obj) return null;
  return composeRelationalState(ctx, obj);
}
