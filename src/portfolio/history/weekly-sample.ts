// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY SAMPLER (Step 21) — PURE. No DB, no I/O, no clock.
//
// The one place "keep every ~5th point" is actually defined, so the mfapi backfill and the tests
// sample IDENTICALLY. Given a dense (daily-ish) series it returns AT MOST ONE point per ISO week —
// the LAST trading day of that week — over the last N years. The rolling window in the DB trims the
// tail; this bounds the head. Together the store holds ~208 points.
//
// The split-rescale used to live here; it now lives in ONE place — ingestions/amfi/mf-split-adjust.ts
// (dayOf, SplitEvent, rescaleForSplits) — shared by the fold, this store and /chart. Re-exported
// below so existing callers keep their import; there is no second copy.
// ─────────────────────────────────────────────────────────────────────────────
import { dayOf } from "../../ingestions/amfi/mf-split-adjust.js";
export { dayOf, rescaleForSplits, type SplitEvent } from "../../ingestions/amfi/mf-split-adjust.js";

/** One raw or corrected observation. `date` is "YYYY-MM-DD" (ISO, lexicographically sortable). */
export interface SeriesPoint {
  date: string;
  value: number;
}

/**
 * ISO-week bucket index (Monday-start). Epoch day 0 = Thu 1970-01-01, so +3 shifts Monday to a
 * bucket boundary: every Mon–Sun maps to one integer. Keeping the max-date point per bucket is
 * exactly "the last trading day of the ISO week".
 */
export function isoWeekOf(iso: string): number {
  return Math.floor((dayOf(iso) + 3) / 7);
}

/**
 * Keep AT MOST ONE point per ISO week (the latest date in the week) over the last `years` years,
 * measured back from `asOf` ("YYYY-MM-DD" — the newest point, or today). Input need not be sorted.
 *
 * `years` defaults to 4 (Ruling R1). The result is ascending by date and holds ≤ ⌈years·52.18⌉+1
 * points — the DB rolling-window trigger enforces the same bound on the write side.
 */
export function sampleWeekly(points: SeriesPoint[], asOf: string, years = 4): SeriesPoint[] {
  if (points.length === 0) return [];
  // Calendar cutoff: keep date >= asOf − years. Parsed in UTC to match dayOf.
  const cut = new Date(asOf + "T00:00:00Z");
  cut.setUTCFullYear(cut.getUTCFullYear() - years);
  const cutIso = cut.toISOString().slice(0, 10);

  // Last (max-date) point per ISO week, within the window.
  const byWeek = new Map<number, SeriesPoint>();
  for (const p of points) {
    if (p.date < cutIso || p.date > asOf) continue; // outside the 4y window / future
    const wk = isoWeekOf(p.date);
    const cur = byWeek.get(wk);
    if (!cur || p.date > cur.date) byWeek.set(wk, p);
  }
  return [...byWeek.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
