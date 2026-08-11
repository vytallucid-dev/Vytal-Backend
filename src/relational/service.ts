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
import { assemble, URGENT_RUNG_CEILING } from "./arbitration.js";
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

  // ── Guaranteed-resolve backstop (§0.4 / Part X), AMENDED — an empty slot list is legal in exactly one
  //    case: header is UD7 ("Nothing new since {date}.") and the mode's floor was intentionally left
  //    UNRESERVED (mode-contract.ts's ud7AwareFloor — a RECURRING reader with a genuinely empty delta, on
  //    M2/M3/M4/M10/M11/M12). This is INTERNAL PLUMBING, not a claim that the rendered card is ever
  //    literally empty — under realistic inputs it never is: clearing the floor only removes the
  //    reservation, and the ladder still fills freed room from whatever else is genuinely eligible (on
  //    M3, led by UH1; on M11, by UO1/UG7-class content). `header.entryId === "UD7"` still matters as the
  //    discriminator between "floor intentionally unreserved" and "floor genuinely failed to resolve" —
  //    those are different events and only one is a defect — but the distinction is not user-visible. ──
  if (slots.length === 0 && built.header.entryId !== "UD7") {
    console.error(`[relational] EMPTY CARD for stock ${obj.stockId} mode ${mode.mode} — floor failed to resolve`);
  }

  // ── The register guard over the ASSEMBLED output (§4.2 step 7 / §0.11) — header + every rendered claim,
  //    never the fragments alone. Our copy is deterministic and clean; a violation is a build error the
  //    verification asserts against. At runtime we log rather than blank the card. ──
  const allEntries = [...slots, ...overflow];
  // UO1 carries the editorial business-lead sentence (operational description, e.g. "selling
  // electricity") — scanned separately against the narrower BUSINESS_LEAD_DENY_LIST (§4.2 step 7 note).
  const businessLeadStrings = allEntries.filter((e) => e.entryId === "UO1").map((e) => e.claim);
  // UO6 carries the finding's OWN authored verdict, third-person and past-tense about the company/its
  // owners ("FII trimmed", "promoters have increased their holding") — the SAME shape of description as
  // UO1's business lead, and scanned against the same narrower list for the same reason (copy.ts's note
  // on scanAssembled).
  const uo6Strings = allEntries.filter((e) => e.entryId === "UO6").map((e) => e.claim);
  const assembledStrings = [built.header.claim, ...allEntries.filter((e) => e.entryId !== "UO1" && e.entryId !== "UO6").map((s) => s.claim)];
  const violations = scanAssembled(assembledStrings, ctx.identity.aiLevel, businessLeadStrings, uo6Strings);
  // Celebration is scoped to strength claims (UO6) — never band labels / finding verdicts (§3.1).
  const strengthViolations = allEntries.filter((e) => e.entryId === "UO6").flatMap((e) => scanStrength(e.claim));
  const all = [...violations, ...strengthViolations];
  if (all.length > 0) {
    console.warn(`[relational] register-guard violations on stock ${obj.stockId}:`, all.map((v) => `${v.term} in "${v.text}"`));
  }

  // ── THE BOUNDARY PICK (§3) — the ONE inline doesntMean the card shows. UO6 (strength) is the
  // highest-misread-risk claim ("sound for six years" reads as a buy unless its already-priced
  // boundary is visible), else the first slot as arbitration ranked it. The backend picks so the
  // frontend never re-derives this priority (§4).
  //
  // ⚠ NO UO2/UO3 SPECIAL CASE (deleted with those entries). UO2/UO3 used to be the next-safest fallback
  // after UO6; dropping straight to `slots[0]` is deliberate, not a gap — UO1 was considered as a
  // replacement middle step but rejected: UO1 is ineligible on every returning-holder mode (M2/M3/M4)
  // under the mode contract, so a UO1-shaped fallback would silently collapse to `slots[0]` there anyway
  // — one path on some modes and a different one on others, for no gain. One rule everywhere. ──
  const boundaryEntryId = slots.find((s) => s.entryId === "UO6")?.entryId
    ?? slots[0]?.entryId
    ?? null;

  // ── THE LEAD PICK — the entry that OPENS the card. The first slot on the ladder's urgent floor
  // (rungs 1–4: critical severity and delta), else the first slot as arbitration ranked it.
  //
  // ⚠ THE SECOND CLAUSE IS NOT A FALLBACK, IT IS THE RULE. A mode's floor already ranks, for THIS
  // reader, what the card should open on — identity for a stranger, the position for a holder. Only
  // rungs 1–4 outrank that statement. Picking by rung alone would open a watched stock on its
  // watchlist date and an uncovered stock on its coverage gap; both are what the mode ranked LAST
  // among its floor, and both are true, and neither is what the card is for. Same reasoning as the
  // boundary pick above: the backend makes the relevance call, once, where the ladder lives. ──
  const leadEntryId = slots.find((s) => s.weight.ladderRung <= URGENT_RUNG_CEILING)?.entryId
    ?? slots[0]?.entryId
    ?? null;

  return {
    mode: mode.mode,
    header: built.header,
    slots,
    overflow,
    negatives: built.negatives,
    boundaryEntryId,
    leadEntryId,
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
