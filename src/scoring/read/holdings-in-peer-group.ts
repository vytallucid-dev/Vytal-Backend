// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// HOLDINGS IN A PEER GROUP — the reader's own names inside one pond (§Phase 4).
//
// ⚠ WHY THIS IS A NEW MODULE AND NOT AN EDIT TO relationship.ts. `groundStockRelationship`
// (src/ai/insight/relationship.ts:163-171) already computes this intersection, but only as a COUNT
// (`peersHeld` / `peerGroupSize`) — nothing in the codebase returns WHICH holdings they are, and the UN
// family needs the names to say "3 companies: HDFC Bank, ICICI Bank, Axis Bank."
//
// `src/ai/**` is read-only to this build, so relationship.ts is NOT modified and does NOT delegate here.
// That leaves the count logic in two places, which is a real cost, stated plainly rather than hidden:
// the two must agree, and this module reproduces relationship.ts's union rule EXACTLY — manual FIFO
// holdings ∪ broker mirror, distinct by stockId, direct equity only (a fund is not a peer holding
// because look-through does not exist). Any change to one must be mirrored in the other.
//
// It also does NOT add a fourth peer-group read: membership comes from `getPeerGroupMembers` in
// peer-group-lookup.ts, the existing named read (whose own header explains why three call sites remain
// un-consolidated). This module joins that roster to the reader's book; it never re-queries the pond.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { getPeerGroupMembers } from "./peer-group-lookup.js";

/** One of the reader's holdings that sits inside the peer group. */
export interface HeldPeer {
  stockId: string;
  symbol: string;
  /** The company's catalogue name — the display label. Never a symbol-only rendering, never an ISIN. */
  name: string;
  /** True when this is the object the card is about (it is a member of its own peer group). */
  isThisObject: boolean;
}

export interface HoldingsInPeerGroup {
  /** Roster size of the pond (every member, held or not). */
  peerGroupSize: number;
  /** The reader's holdings inside it, INCLUDING this object when held. Empty when none. */
  held: HeldPeer[];
  /** Convenience: `held.length`. Matches `peersHeld` in relationship.ts by construction. */
  heldCount: number;
  /** The reader's holdings inside it, EXCLUDING this object — "the others", which is what UN copy
   *  usually names ("2 other companies in this peer group"). */
  others: HeldPeer[];
}

/**
 * Distinct stockIds the reader currently holds a POSITIVE QUANTITY of (manual FIFO ∪ broker mirror).
 *
 * ⚠ DELIBERATELY STRICTER THAN `heldStockIds` in src/ai/insight/relationship.ts, which tests only for
 * the existence of a row. That looser rule is what made a fully-exited position (quantity 0, legacy
 * row retained) read as a holding. Live consequence before this gate: a reader who had SOLD Reliance
 * was told "You hold 1 company in Large-Cap Oil & Gas: Reliance Industries Ltd." on the same card that
 * said "Nothing in your portfolio connects to this name" — two of our own sentences contradicting.
 *
 * Quantity, never value: an unpriceable holding still has a quantity and is still a real position.
 * The AI-side helper is not modified (src/ai/** is read-only to this build); the divergence is
 * intentional and is the correction, not a drift.
 */
async function heldStockIds(userId: string): Promise<Set<string>> {
  const [manual, broker] = await Promise.all([
    prisma.holding.findMany({ where: { userId, stockId: { not: null }, quantity: { gt: 0 } }, select: { stockId: true }, distinct: ["stockId"] }),
    prisma.brokerHolding.findMany({ where: { userId, stockId: { not: null }, quantity: { gt: 0 } }, select: { stockId: true }, distinct: ["stockId"] }),
  ]);
  const ids = new Set<string>();
  for (const r of [...manual, ...broker]) if (r.stockId) ids.add(r.stockId);
  return ids;
}

/**
 * Which of this reader's holdings sit in `peerGroupId`, with their display names.
 *
 * Returns an empty intersection (never null) when the reader holds nothing in the pond — "none" is a
 * legitimate, statable fact (UN8), not an error. Fail-soft: a throw on either side degrades to an empty
 * intersection with the roster size preserved where known, so the card never loses a slot to an
 * infrastructure error.
 */
export async function holdingsInPeerGroup(
  userId: string,
  peerGroupId: string,
  thisStockId: string,
): Promise<HoldingsInPeerGroup> {
  let members: Awaited<ReturnType<typeof getPeerGroupMembers>> = [];
  let heldIds = new Set<string>();
  try {
    [members, heldIds] = await Promise.all([getPeerGroupMembers(peerGroupId), heldStockIds(userId)]);
  } catch {
    return { peerGroupSize: 0, held: [], heldCount: 0, others: [] };
  }

  const held: HeldPeer[] = members
    .filter((m) => heldIds.has(m.stockId))
    .map((m) => ({ stockId: m.stockId, symbol: m.symbol, name: m.name, isThisObject: m.stockId === thisStockId }));

  return {
    peerGroupSize: members.length,
    held,
    heldCount: held.length,
    others: held.filter((h) => !h.isThisObject),
  };
}
