// File: src/scoring/read/peer-group-map.ts
//
// stock → its peer group, for the landing scans' peer-group FILTER. ONE list-shaped read of the
// stock_peer_groups join, shared by every scan that offers the filter (trajectory / divergence
// via tool-scan.service, ownership via stocks-list.service).
//
// ── WHY IT IS ITS OWN MODULE ──────────────────────────────────────────────────────────────────
// Two scan builders in two files need the identical map. Either one importing it from the other
// would point an import the wrong way (stocks-list.service already imports tool-scan.service), and
// copying the query into both is how the two scans' filter buckets drift apart. So it lives here,
// owned by neither.
//
// ── ⚠ THE ORDER IS LOad-BEARING ────────────────────────────────────────────────────────────────
// The join table permits a stock in several ponds (@@unique is on the PAIR). An unordered read
// would let a stock's filter bucket flip between rebuilds — the card would leave and re-enter a
// filtered landing for no reason a reader could see. Ordered, first-row-wins, it is stable.
//
// It is NOT separately cached: its only callers run inside buildToolScan / buildOwnershipScan,
// which are themselves behind the 5-minute tool-scan slot.

import { prisma } from "../../db/prisma.js";
import type { ScanPeerGroupRef } from "./stocks-list.types.js";

/** stockId → the pond it filters under. Absent for a stock in no peer group. */
export async function loadPeerGroupByStock(): Promise<Map<string, ScanPeerGroupRef>> {
  const rows = await prisma.stockPeerGroup.findMany({
    orderBy: [{ stockId: "asc" }, { peerGroupId: "asc" }],
    select: { stockId: true, peerGroup: { select: { id: true, name: true, displayName: true } } },
  });

  const out = new Map<string, ScanPeerGroupRef>();
  for (const r of rows) {
    if (r.peerGroup && !out.has(r.stockId)) out.set(r.stockId, r.peerGroup);
  }
  return out;
}
