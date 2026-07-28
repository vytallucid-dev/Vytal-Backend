// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PEER-GROUP LOOKUP — the two thin, named reads over the `stock_peer_groups` join.
//
// ⚠ WHY THIS DOES NOT REFACTOR THE THREE EXISTING CALL SITES. The same findFirst appears in
// health-view.service.ts, relational/object-state.ts and result-detail.service.ts — but each selects a
// DIFFERENT shape (id+name+displayName+stockCount / id+displayName+stockCount / name + the nested member
// roster) and each sits inside its own Promise.all. Folding them into one helper would either over-select
// for two of them or need a parameterised select more complex than the three lines it replaced. So this
// is a NAMED READ FOR NEW CALLERS (the chat tools), not a migration of working code — the honest scope.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";

export interface PeerGroupRef {
  id: string;
  name: string;
  displayName: string;
  /** Roster size (PeerGroup.stockCount) — the whole group, scored or not. */
  stockCount: number;
  sectorId: string;
}

/** The peer group a stock belongs to. null ⇔ the stock has no membership row (the display-only
 *  firewall: a Nifty-500 expansion stock with no peer group is never scored). */
export async function getPeerGroupForStock(stockId: string): Promise<PeerGroupRef | null> {
  const row = await prisma.stockPeerGroup.findFirst({
    where: { stockId },
    select: { peerGroup: { select: { id: true, name: true, displayName: true, stockCount: true, sectorId: true } } },
  });
  return row?.peerGroup ?? null;
}

export interface PeerMemberRef {
  stockId: string;
  symbol: string;
  name: string;
}

/** The members of a peer group — the LEAN projection (identity only), the same shape
 *  ai/insight/relationship.ts reads for its intersection. Deliberately NOT the metrics-enriched
 *  variant (peer-metrics-controller), which pulls fundamentals + prices a member list never needs. */
export async function getPeerGroupMembers(peerGroupId: string): Promise<PeerMemberRef[]> {
  const rows = await prisma.stockPeerGroup.findMany({
    where: { peerGroupId },
    select: { stock: { select: { id: true, symbol: true, name: true } } },
  });
  return rows.map((r) => ({ stockId: r.stock.id, symbol: r.stock.symbol, name: r.stock.name }));
}
