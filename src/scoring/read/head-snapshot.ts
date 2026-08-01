// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE HEAD SNAPSHOT — "which score row is this stock's CURRENT one?", in one place.
//
// ── WHY THIS IS EXTRACTED RATHER THAN WRITTEN AGAIN ───────────────────────────────────────────────
// The question has one right answer and the codebase had two implementations of it:
//
//   universe-view.service.ts   the FULL three-step: MAX version per (stock, period) → latest period
//                              per stock → hold out names that stopped being rescored.
//   alerts/eval-pass.ts        `orderBy [asOfDate desc, version desc]`, take the first row. No period
//   watchlist-enrich.ts        grouping, no staleness. Correct for the common case; not the same rule.
//
// A third variant for getFindingsForSymbols would have made it four, and "which snapshot is current"
// is exactly the kind of question that must not have four answers — two surfaces disagreeing about a
// stock's CURRENT score is a defect a reader can see. So the real implementation moves here, PURE
// (rows in, map out, no DB), and universe-view.service.ts consumes it.
//
// ── ⚠ WHAT alerts/eval-pass.ts WOULD CHANGE IF IT ADOPTED THIS, AND WHY IT HAS NOT ────────────────
// Two things, and the second is the blocker:
//   1. TIE-BREAKING. Where a stock carries two periods at the SAME asOfDate, the orderBy picks the
//      higher VERSION and this picks the newer PERIOD. Different rows, same date.
//   2. alerts needs the PRIOR snapshot too (rows[1]) to detect a band crossing, and a head resolver
//      by definition returns one row per stock. Adopting this would mean rewriting the crossing
//      detection, not swapping a helper.
// Neither is a bug in alerts today; both are reasons the swap is its own decision. Left alone
// deliberately — see the build note. This module is consumed by the universe view and by
// getFindingsForSymbols; alerts and watchlist-enrich keep their own reads until someone chooses to
// move them, at which point the behaviour delta above is the thing to test.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The minimum a row needs to be resolvable. Callers select whatever else they want alongside. */
export interface HeadCandidate {
  stockId: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
}

/**
 * A stock is "live" if its head snapshot's asOfDate is within this window of the freshest asOfDate
 * anywhere in the batch. Active names are EOD-rescored ~daily, so they share a recent asOf even when a
 * fiscal quarter behind on fundamentals; only names that have gone dark (delisted / no longer
 * rescored) fall outside it. Comfortably wider than any holiday gap, tighter than a quarter — so a
 * quarter rollover keeps every live name instead of collapsing the cross-section.
 *
 * ★ MOVED VERBATIM from universe-view.service.ts, including this value. Changing it changes the
 * universe's membership, which is why it lives beside the rule rather than at each call site.
 */
export const STALE_ASOF_DAYS = 45;

/**
 * Resolve each stock's HEAD snapshot from a batch of candidate rows.
 *
 * THE THREE STEPS, in order, exactly as the universe cross-section had them:
 *   1. supersede within a period — per (stockId, periodKey) keep MAX(version); ties → later asOfDate.
 *   2. latest period per stock   — keep the row with the newest asOfDate; ties → the HIGHER periodKey,
 *      because at the same date the newer quarter is the newer statement.
 *   3. (caller's choice) staleness — `splitByStaleness` below.
 *
 * Generic over the caller's row type so a lean projection and a fat one both work without adopting a
 * shared shape; the returned rows are the caller's own objects, untouched.
 */
export function resolveHeadSnapshots<T extends HeadCandidate>(rows: readonly T[]): Map<string, T> {
  // 1 · in-force per (stock, period)
  const inForce = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.stockId}|${r.periodKey}`;
    const cur = inForce.get(k);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.asOfDate > cur.asOfDate)) {
      inForce.set(k, r);
    }
  }
  // 2 · latest period per stock
  const head = new Map<string, T>();
  for (const r of inForce.values()) {
    const cur = head.get(r.stockId);
    if (
      !cur ||
      r.asOfDate > cur.asOfDate ||
      (r.asOfDate.getTime() === cur.asOfDate.getTime() && r.periodKey > cur.periodKey)
    ) {
      head.set(r.stockId, r);
    }
  }
  return head;
}

/**
 * Split resolved heads into names still being rescored and names that have gone dark.
 *
 * ⚠ THE CUTOFF IS RELATIVE TO THE BATCH, not to the clock. That is deliberate: it asks "is this name
 * keeping up with the others?", which survives a weekend, a holiday and a stalled ingestion without
 * declaring the whole universe stale. It also means the answer depends on WHAT ELSE was passed in —
 * a caller resolving ONE symbol gets no staleness signal at all, because there is nothing to be
 * behind. `getFindingsForSymbols` therefore passes the freshest date from the universe, not from its
 * own handful of symbols.
 */
export function splitByStaleness<T extends HeadCandidate>(
  heads: Iterable<T>,
  opts: { staleDays?: number; freshestAsOf?: Date } = {},
): { current: T[]; stale: T[]; freshestAsOf: Date | null } {
  const all = [...heads];
  if (all.length === 0) return { current: [], stale: [], freshestAsOf: opts.freshestAsOf ?? null };
  const staleDays = opts.staleDays ?? STALE_ASOF_DAYS;
  const freshestAsOf = opts.freshestAsOf ?? all.reduce((a, b) => (b.asOfDate > a.asOfDate ? b : a)).asOfDate;
  const cutoff = new Date(freshestAsOf.getTime() - staleDays * 24 * 60 * 60 * 1000);
  return {
    current: all.filter((r) => r.asOfDate >= cutoff),
    stale: all.filter((r) => r.asOfDate < cutoff),
    freshestAsOf,
  };
}

/**
 * The plurality period LABEL across a set of heads, ties → the newer period.
 *
 * ⚠ DISPLAY ONLY, AND NEVER A SCOPE CLAIM. Members span periods by construction, so this label
 * describes the largest group and nothing more. universe-projection.types.ts's PeriodContract exists
 * precisely so this value cannot travel to a reader as "as of <period>, N companies are …".
 */
export function pluralityPeriod<T extends HeadCandidate>(heads: readonly T[]): string | null {
  if (heads.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of heads) counts.set(r.periodKey, (counts.get(r.periodKey) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
}
