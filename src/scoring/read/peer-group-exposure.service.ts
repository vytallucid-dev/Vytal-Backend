// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER'S EXPOSURE TO A POND — one map, keyed by SYMBOL, for every table on the peer-group page.
//
// ── ★ WHY THIS IS ITS OWN READ AND NOT A FIELD ON THE HEALTH PAYLOAD ───────────────────────────────
// `GET /api/peer-groups/:id/health` is PUBLIC and shared: the frontend caches it under
// `["peer-group", id, "health"]`, one entry for every reader. Folding a per-reader field into it would
// put one reader's holdings into a cache entry the next reader reads — the exact failure the
// results-season hook's header warns about, which is why that surface is keyed on the reader's id and
// answers `private, no-store`. So the pond's facts and the reader's facts stay two reads, and the
// tables annotate one with the other.
//
// ── ★ SYMBOL-KEYED, DELIBERATELY ───────────────────────────────────────────────────────────────────
// Every table on this page is keyed by SYMBOL — StandingsTable's rows, the raw floor's member columns,
// the lens detail's rows. The stockId is an internal identifier none of them carries, so returning
// stockIds would force each table to resolve a join the payload can do once, correctly, here.
//
// ── ★ THE WHOLE ROSTER, NOT THE SCORED CROSS-SECTION ───────────────────────────────────────────────
// A reader holds a company whether or not we score it this period, and the Fundamentals / Valuation /
// Shareholding tabs list members the health cross-section can exclude. Reading the roster off
// `getPeerGroupMembers` — the existing named read — keeps the marker available to every table rather
// than to the ones that happen to share the health tab's member set.
//
// The resolution itself is `resolveReaderExposure`: the SAME function the results-season banner uses,
// so the disc beside a ticker in a table is the same fact, from the same rule, as the disc beside the
// same ticker in the banner above it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { resolveReaderExposure, type ReaderExposure } from "../../relational/reader-exposure.js";
import { getPeerGroupMembers } from "./peer-group-lookup.js";

export interface PeerGroupExposureView {
  /** Roster size — every member, scored or not. Lets a caller tell "no exposure" from "no pond". */
  memberCount: number;
  /**
   * symbol → the reader's relationship. ★ ONLY EXPOSED MEMBERS APPEAR. A symbol absent from the map is
   * "none", and shipping a wall of `"none"` entries would make an anonymous reader's response the
   * largest one this endpoint returns while carrying no information at all.
   */
  exposure: Record<string, ReaderExposure>;
  /** How many members carry each mark. The LEGEND'S CONDITION — and it counts MARKS, not members, so
   *  a member the reader both holds and watchlists is counted in both, exactly as the banner's
   *  `exposureCounts` does. The two numbers can therefore sum to more than the members involved. */
  counts: { held: number; watching: number };
}

const EMPTY: PeerGroupExposureView = { memberCount: 0, exposure: {}, counts: { held: 0, watching: 0 } };

/**
 * Resolve one reader's exposure to one pond.
 *
 * Anonymous resolves to an empty map with the roster size preserved — "nobody is exposed" is a
 * legitimate answer, not an error, and it is exactly the answer that makes the tables render no marks
 * and the page render no legend. A failure inside the resolver degrades to the same, all-or-nothing:
 * a page with half the marks would be worse than a page with none, because the reader would read the
 * absence of a mark as "I do not hold this".
 */
export async function buildPeerGroupExposure(
  userId: string | null,
  peerGroupId: string,
): Promise<PeerGroupExposureView> {
  let members: Awaited<ReturnType<typeof getPeerGroupMembers>>;
  try {
    members = await getPeerGroupMembers(peerGroupId);
  } catch {
    return EMPTY;
  }
  if (members.length === 0) return EMPTY;
  if (!userId) return { ...EMPTY, memberCount: members.length };

  const byStockId = await resolveReaderExposure(userId, members.map((m) => m.stockId));

  const exposure: Record<string, ReaderExposure> = {};
  let held = 0;
  let watching = 0;
  for (const m of members) {
    const e = byStockId.get(m.stockId) ?? "none";
    if (e === "none") continue;
    exposure[m.symbol] = e;
    if (e === "held" || e === "both") held += 1;
    if (e === "watching" || e === "both") watching += 1;
  }
  return { memberCount: members.length, exposure, counts: { held, watching } };
}
