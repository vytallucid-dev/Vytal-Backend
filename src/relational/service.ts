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
import { buildEntries, attachEchoAnnotations } from "./entries.js";
import { assemble } from "./arbitration.js";
import { scanAssembled, scanStrength } from "./copy.js";
import { getBaseRates, type BaseRateSnapshot } from "./base-rates.js";
import type { RelationalState, ReaderContext, ObjectState } from "./types.js";

/**
 * The PURE composition — mode → entries → arbitration → guard → RelationalState. No DB, no I/O: a pure
 * function of (ReaderContext, ObjectState) so the synthetic fixture matrix (§8) can verify the whole
 * logic offline. `resolveRelationalState` below wraps it with the DB-touching resolvers. `now` is
 * injectable so a fixture can freeze it for stable duration/attention math.
 */
export function composeRelationalState(
  ctx: ReaderContext,
  obj: ObjectState,
  now: Date = new Date(),
  /** §Phase 6 — universe base rates for the UE family. Passed in (not fetched) so this stays PURE and
   *  the fixture matrix can control it. `null` ⇒ UE dropped whole + degradation. */
  rates: BaseRateSnapshot | null = null,
): RelationalState {
  const mode = resolveMode(ctx, now);
  const built = buildEntries(ctx, obj, mode, rates);
  const assembled = assemble(built.floorIds, built.candidates, built.cap);
  // ⚠ §4.5 extended — ECHO IS AN ANNOTATION, NOT A SLOT. Must run AFTER assembly, because the host
  // entry is not known until slots are decided. Merges each key-tied echo into its ELEVATED host.
  const { slots, overflow } = attachEchoAnnotations(assembled.slots, assembled.overflow);

  // ── Guaranteed-resolve backstop (§0.4 / Part X): the floor is reserved, so this is unreachable — if it
  //    is ever reached it is a BUG, not an empty state. Log loud (the card still carries its header). ──
  if (slots.length === 0) {
    console.error(`[relational] EMPTY CARD for stock ${obj.stockId} mode ${mode.mode} — floor failed to resolve`);
  }

  // ── The register guard over the ASSEMBLED output (§4.2 step 7 / §0.11) — header + every rendered claim,
  //    never the fragments alone. Our copy is deterministic and clean; a violation is a build error the
  //    verification asserts against. At runtime we log rather than blank the card. ──
  const allEntries = [...slots, ...overflow];
  // UO1 carries the editorial business-lead sentence (operational description, e.g. "selling
  // electricity") — scanned separately against the narrower BUSINESS_LEAD_DENY_LIST (§4.2 step 7 note).
  const businessLeadStrings = allEntries.filter((e) => e.entryId === "UO1").map((e) => e.claim);
  const assembledStrings = [built.header.claim, ...allEntries.filter((e) => e.entryId !== "UO1").map((s) => s.claim)];
  const violations = scanAssembled(assembledStrings, ctx.identity.aiLevel, businessLeadStrings);
  // Celebration is scoped to strength claims (UO6) — never band labels / finding verdicts (§3.1).
  const strengthViolations = allEntries.filter((e) => e.entryId === "UO6").flatMap((e) => scanStrength(e.claim));
  const all = [...violations, ...strengthViolations];
  if (all.length > 0) {
    console.warn(`[relational] register-guard violations on stock ${obj.stockId}:`, all.map((v) => `${v.term} in "${v.text}"`));
  }

  // ── THE BOUNDARY PICK (§3) — the ONE inline doesntMean the card shows. UO6 (strength) is the
  // highest-misread-risk claim ("sound for six years" reads as a buy unless its already-priced
  // boundary is visible), then UO2 (health), then UO3 (flags), else the first slot. The backend picks
  // so the frontend never re-derives this priority (§4). ──
  const boundaryEntryId = slots.find((s) => s.entryId === "UO6")?.entryId
    ?? slots.find((s) => s.entryId === "UO2")?.entryId
    ?? slots.find((s) => s.entryId === "UO3")?.entryId
    ?? slots[0]?.entryId
    ?? null;

  return {
    mode: mode.mode,
    header: built.header,
    slots,
    overflow,
    negatives: built.negatives,
    boundaryEntryId,
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
  // ⚠ SEQUENCED SINCE PHASE 4, not parallel. The reader context is no longer fully object-independent:
  // the UN family needs the reader's exposure to THIS object's peer group and sector, so the context
  // resolver takes the object's PG id + sector key. The object read is the cheaper of the two and is
  // the one honest 404, so it leads. The book/tone/attention reads inside resolveReaderContext still
  // run in parallel with each other — only the outer pair is ordered.
  const obj = await resolveObjectState(stockId);
  if (!obj) return null;

  // §Phase 6 — the base-rate snapshot resolves alongside the reader context. Served from an in-memory
  // cache (nightly warm, cold-start compute), so this is normally free; on failure it returns null and
  // the UE family is dropped whole with a degradation recorded, never rendered partially (§5.7).
  const [ctx, rates] = await Promise.all([
    userId
      ? resolveReaderContext(userId, stockId, {
          peerGroupId: obj.peerGroup?.id ?? null,
          sectorKey: obj.sector?.key ?? null,
          // §Phase 7 — the delta compares the current fired set against the snapshot the reader saw.
          snapshotGeneration: obj.snapshot?.generation ?? null,
          firedKeys: obj.findings.map((f) => f.key),
        })
      : Promise.resolve(anonymousContext()),
    // Anonymous readers have no book, so echo can never fire — skip the aggregate entirely for them.
    userId ? getBaseRates() : Promise.resolve(null),
  ]);

  return composeRelationalState(ctx, obj, new Date(), rates);
}
