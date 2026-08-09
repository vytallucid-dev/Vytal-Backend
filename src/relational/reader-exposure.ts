// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER'S EXPOSURE TO A SET OF STOCKS — one resolution, every surface that draws a marker.
//
// ── ★ WHY THIS IS ONE FUNCTION AND NOT TWO ─────────────────────────────────────────────────────────
// The results-season banner established the marker vocabulary — a filled disc for held, a hollow ring
// for watchlisted, both for both — and resolved it inside `group-service.ts` for the season's members.
// The peer-group TABLES need the same fact for the WHOLE roster. Resolving it a second time is exactly
// how one page ends up with two vocabularies: a reader who holds a company would see a disc beside its
// capsule in the banner and nothing beside the same ticker in the table below, or worse, a disc in one
// and a ring in the other. So the body that was `resolvePerMemberExposure` lives here now and BOTH
// callers use it — the banner for its season members, the pond exposure read for the roster.
//
// ── ★ THE TWO HELPERS ARE THE STOCK STRIP'S, UNCHANGED ─────────────────────────────────────────────
//   · `probeStockRelationship` — the (held, watchlist-row) probe.
//   · `holdsPositiveQuantity`  — gates the holding on QUANTITY, so a fully-exited legacy row is not a
//                                position. Deliberately stricter than the AI-side `heldStockIds`; see
//                                holdings-in-peer-group.ts for the live contradiction that forced it.
// Nothing about the reader is re-derived here.
//
// ── ★ NO PRECEDENCE ────────────────────────────────────────────────────────────────────────────────
// The stock strip resolves held-beats-watching because it renders ONE chip for one stock and has to
// pick. A row of capsules — and a column of table rows — does not, and "both" is a state the reader
// created on purpose. All four values are returned; counting is the caller's business.
//
// ── ★ THE COST, MEASURED, AND WHY THE FAN-OUT IS KEPT ──────────────────────────────────────────────
// A probe per stock: 319–603 ms over the largest pond (10 members), against 65–115 ms for an
// equivalent grouped read. The fan-out is kept deliberately — semantic identity with the stock strip
// is worth 250 ms on a `no-store`, non-blocking, supplementary fetch, and a second implementation of
// "what is held" is exactly the divergence this module exists to remove. Ponds are ≤10 members.
//
// ── ★ FAIL-SOFT, ALL OR NOTHING ────────────────────────────────────────────────────────────────────
// Anonymous resolves to an EMPTY map — the caller reads that as "none" throughout, which is the third
// authored variant and not a degraded one. A read that throws resolves to the same empty map, so the
// marks, the counts and the legend all vanish together rather than one of the three surviving on a
// fact we could not confirm.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { probeStockRelationship } from "../ai/insight/relationship.js";
import { holdsPositiveQuantity } from "./reader-context.js";
import type { ReaderExposure } from "../results-season/types.js";

export type { ReaderExposure };

/**
 * The reader's relationship to each of `stockIds`, keyed by stockId.
 *
 * A stockId absent from the returned map means "none" — the caller supplies that default rather than
 * this filling the map with a value that carries no information.
 */
export async function resolveReaderExposure(
  userId: string | null,
  stockIds: readonly string[],
): Promise<Map<string, ReaderExposure>> {
  const out = new Map<string, ReaderExposure>();
  if (!userId || stockIds.length === 0) return out;
  try {
    const resolved = await Promise.all(
      stockIds.map(async (stockId): Promise<[string, ReaderExposure]> => {
        const probe = await probeStockRelationship(userId, stockId);
        const held = probe.held && (await holdsPositiveQuantity(userId, stockId));
        const watching = Boolean(probe.watchlist);
        if (held && watching) return [stockId, "both"];
        if (held) return [stockId, "held"];
        if (watching) return [stockId, "watching"];
        return [stockId, "none"];
      }),
    );
    for (const [id, e] of resolved) out.set(id, e);
    return out;
  } catch {
    return new Map();
  }
}
