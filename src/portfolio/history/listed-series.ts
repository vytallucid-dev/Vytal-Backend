// ─────────────────────────────────────────────────────────────────────────────
// LISTED NON-STOCK SERIES SOURCE (Step 21) — bonds / G-secs / SGBs / REITs / InvITs / listed ETFs.
//
// SOURCE: the NSE udiff BhavCopy archive (the ONE NSE file carrying ISIN + series + close). Exchange
// closes are already clean — no rescale (contrast the fund path). One bhavcopy holds EVERY
// instrument for a day, so the week-fetcher pulls each file ONCE and fans out to all wanted ISINs
// (the weekly refresh backfills the whole held book for the cost of one instrument's history).
//
// ⚠️ DEPTH IS ~2.5 YEARS, NOT 4 (Gate-0 Ruling A). The udiff (ISIN) format floors at ~Jan 2024;
// pre-2024 exists only in the legacy format with no ISIN. So a listed instrument's line HONESTLY
// starts at ~Jan 2024 and grows forward to 4y — it never pads. Funds reach 4y (fund-series.ts).
//
// HOLIDAYS ARE HONEST GAPS: a week whose last weekdays all 404 (holiday cluster) simply yields no
// point for that week — forward-filled by the chart engine, never invented.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchUdiff, parseUdiff } from "../../ingestions/shared/udiff-bhavcopy.js";
import type { SeriesPoint } from "./weekly-sample.js";

/** The udiff ISIN-format floor (Gate-0 probe: first 2024 trading day; all 2022–2023 → 404). */
export const UDIFF_FLOOR_ISO = "2024-01-01";

const MS_PER_DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The Friday of every ISO week from `floor` (or today−4y, whichever is later) up to `today`. */
export function weeklySampleDates(todayIso: string, floorIso = UDIFF_FLOOR_ISO): string[] {
  const today = new Date(todayIso + "T00:00:00Z");
  const fourYearsAgo = new Date(today);
  fourYearsAgo.setUTCFullYear(fourYearsAgo.getUTCFullYear() - 4);
  const floor = new Date(Math.max(Date.parse(floorIso + "T00:00:00Z"), fourYearsAgo.getTime()));

  // Most recent Friday on/before today.
  const d = new Date(today);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() - ((dow - 5 + 7) % 7)); // step back to Friday
  const out: string[] = [];
  while (d.getTime() >= floor.getTime()) {
    out.push(iso(d));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out.reverse(); // ascending
}

export interface WeekFetchProgress {
  index: number;
  total: number;
  date: string;
  status: "hit" | "holiday" | "miss";
}

/**
 * For each target week (a Friday), find the bhavcopy on that day or the nearest earlier weekday
 * (holiday fallback, up to 4 days back), parse it once, and record the close for every wanted ISIN.
 * Returns one ascending series per ISIN. `onWeek` fires per week for progress/heartbeat.
 */
export async function fetchUdiffWeekCloses(
  wantedIsins: Set<string>,
  weekDates: string[],
  opts: { signal?: AbortSignal; onWeek?: (p: WeekFetchProgress) => void } = {},
): Promise<Map<string, SeriesPoint[]>> {
  const out = new Map<string, SeriesPoint[]>();
  for (const isin of wantedIsins) out.set(isin, []);

  for (let i = 0; i < weekDates.length; i++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const week = weekDates[i];
    let recorded: "hit" | "holiday" | "miss" = "miss";

    // Friday, then Thu/Wed/Tue/Mon (holiday fallback). Weekends are never trading days.
    for (let back = 0; back < 5; back++) {
      const d = new Date(Date.parse(week + "T00:00:00Z") - back * MS_PER_DAY);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      let res;
      try {
        res = await fetchUdiff(d);
      } catch {
        recorded = "miss";
        continue; // transient — try the prior day (a hard gap becomes a holiday gap, still honest)
      }
      if (res.status === 404) {
        recorded = "holiday";
        continue; // not a trading day — step back
      }
      if (res.status !== 200) { recorded = "miss"; continue; }
      const parsed = parseUdiff(res.buffer);
      if (!parsed.ok) { recorded = "miss"; continue; }
      const sampleDate = iso(d);
      for (const row of parsed.rows) {
        if (!row.usable) continue;
        if (!wantedIsins.has(row.isin)) continue;
        out.get(row.isin)!.push({ date: sampleDate, value: row.close });
      }
      recorded = "hit";
      break; // this week is done
    }
    opts.onWeek?.({ index: i + 1, total: weekDates.length, date: week, status: recorded });
  }

  // Each ISIN's points arrive ascending (weekDates ascending). Ensure sort defensively.
  for (const arr of out.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
