// File: src/scoring/read/peer-comparison.types.ts
//
// Read-model for the Technical tab's "vs index" / "vs peer average" price cards →
// GET /api/stocks/:symbol/peer-comparison. A companion to price-view.types.ts, not a
// replacement — this view answers a DIFFERENT question: not "how has this stock and
// its sector moved" but "how has this stock moved relative to the index that tracks it,
// and against the SPECIFIC peer group it was assigned to (if any), over one month".
//
// ★ WHY THIS DOESN'T REUSE StockPriceView.sector: that field resolves the index through
// the STOCK's own sectorId unconditionally. This view resolves it through the PEER
// GROUP's sectorId WHEREVER ONE IS ASSIGNED — verified NOT always the same as the stock's
// own sectorId (2 of 149 peer-group stocks disagree). Only when there's no peer group to
// defer to does this fall back to the stock's own Stock.sectorId (verified sound: all 355
// ungrouped stocks carry a sectorId, and every sector in this universe maps to an index
// with enough history for a 1-month return — 2026-08-09 census, 504/504 "ok").
//
// ★ THE INDEX CARD IS NOT PEER-GROUP-SHAPED. `index`/`indexUnavailableReason` are
// populated independently of `hasPeerGroup` — a stock with no peer group can still have a
// working index (ABFRL: no peer group, but Stock.sectorId → Nifty Consumer Durables,
// live). Only `peers` requires actual peer-group membership; there is no sound fallback
// for a peer AVERAGE the way there is for an index.
//
// CONVENTIONS (mirror price-view.types.ts): plain JS numbers, PERCENT returns, a field
// with no backing data is `null` with the key present. Never fabricated, never a pooled
// substitute presented as an index (or vice versa) — each is its own field, honestly null
// when unavailable.

/** One month, trading-calendar-consistent with price-view's r1m (30 calendar days,
 *  measured from the close on-or-before latest−30d). */
export const PEER_COMPARISON_WINDOW_DAYS = 30;

export interface PeerComparisonIndex {
  indexName: string; // IndexPrice.indexName, e.g. "Nifty Pharma"
  label: string; // friendly display label — same string today, kept distinct for future divergence
  /** null when the index's own series doesn't reach back 30 days — honest "can't measure",
   *  never extrapolated. The index object itself is still present so the UI can distinguish
   *  "no index at all" (this whole field is null, see indexUnavailableReason) from "index
   *  exists, window unreachable" (this object present, return1mPct null). */
  return1mPct: number | null;
}

/** WHY `index` is null. Three states are possible overall; only the first two land here —
 *  the third is representable WITHOUT this field, by `index` being present but its
 *  return1mPct null:
 *  - "no_sector": no sector could be resolved for this stock at all (no peer group to defer
 *    to, and its own Stock.sectorId is unset). Currently unreached — 0/504 — but not
 *    provable to stay that way, so it's a real, distinct state, not folded into the next one.
 *  - "sector_has_no_index": a sector WAS resolved, but it has no entry in SECTOR_INDEX_MAP,
 *    or the mapped index has zero rows in IndexPrice. Also currently unreached — 0/504.
 *  - (not this field) "index has too little history": a sector AND its index both resolved,
 *    but the index's own series doesn't reach back 30 days — `index` is present with
 *    `return1mPct: null`, so the UI can name the index it couldn't measure against.
 *  null ⇔ `index` is non-null (nothing to explain) OR peers naturally don't apply. */
export type IndexUnavailableReason = "no_sector" | "sector_has_no_index" | null;

export interface PeerComparisonPeers {
  /** Mean of return1mPct across peer-group members EXCLUDING the stock itself, counting
   *  only members that have a value. Never a value silently substituted for a missing index. */
  averageReturn1mPct: number | null;
  /** How many peers were actually averaged (excl. self, excl. members with no return data).
   *  Stated so "average of 6" and "average of 40" read as different claims. */
  peerCount: number;
}

export interface PeerComparisonView {
  symbol: string;
  hasPeerGroup: boolean;
  peerGroup: {
    name: string;
    displayName: string;
    /** Actual joined-row member count (incl. the stock itself), not the possibly-stale
     *  PeerGroup.stockCount snapshot field. */
    memberCount: number;
  } | null;
  windowDays: number; // PEER_COMPARISON_WINDOW_DAYS, carried on the payload for the UI label
  /** The stock's own trailing return over the SAME window, computed the same way
   *  (pctReturn over its own daily closes) — shared by both the "vs index" and "vs peer
   *  average" cards so the two never disagree about "the stock's move". */
  stockReturn1mPct: number | null;
  /** Resolved via the peer group's sector wherever one is assigned, else via the stock's
   *  own Stock.sectorId — INDEPENDENT of hasPeerGroup, so an ungrouped stock can still have
   *  a working index. null ⇔ no benchmark index could be resolved at all (see
   *  indexUnavailableReason for why); present-with-null-return1mPct ⇔ an index resolved but
   *  doesn't reach back this window. */
  index: PeerComparisonIndex | null;
  /** Populated only when `index` is null — see IndexUnavailableReason. */
  indexUnavailableReason: IndexUnavailableReason;
  /** null ⇔ hasPeerGroup is false — there is no peer set to average, and unlike the index
   *  there is no sound fallback for a peer AVERAGE when there's no peer group. */
  peers: PeerComparisonPeers | null;
}
