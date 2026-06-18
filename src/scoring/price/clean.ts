// File: src/scoring/price/clean.ts
//
// SPLIT/BONUS PRE-CLEAN — the §7.2 GATING guard for the Universal Market Pillar.
// PURE (no DB/IO). Caller supplies a raw ascending daily-CLOSE series; this returns
// a CLEANED (split/bonus back-adjusted) series + a decomposable clean report.
//
// WHY THIS EXISTS (spec §7.2): an unadjusted 1:2 split looks like a −50% one-day
// crash — it spikes volatility (D1, B3) and craters range position (A1, A2), and ONE
// mis-adjusted stock poisons the PG's D1 median for the WHOLE peer group. So the
// price feed MUST be split/bonus-adjusted before ANY Market computation runs, and a
// single-day move > 25% MUST be flagged for split-check. This module is that pass,
// and it is GATING: Market sub-components consume getCleanedCloses(), never raw rows.
//
// CLASSIFICATION of a flagged (>FLAG_THRESHOLD) single-day move:
//   • DOWN gap whose ratio matches a standard split/bonus ratio AND is SUSTAINED
//     (doesn't revert next day)  → CORRECT (back-adjust all prior closes by the ratio).
//   • DOWN gap, sustained, ratio NOT a standard action (e.g. a demerger, ~0.35)
//     → QUARANTINE (a real structural break — never mis-corrected as a split).
//   • UP gap, or a gap that reverts next day → real market move → KEPT.
//
// Yahoo's adjusted-close feed is usually already split-adjusted; on clean data this
// pass is a no-op that PROVES cleanliness (zero corrections, the validation gate).

export interface RawDay { date: Date; close: number }
export interface CleanedDay { date: Date; close: number }

export type CleanClass =
  | "split_corrected"
  | "bonus_corrected"
  | "structural_break_quarantined"
  | "real_move_kept";

export interface CleanEvent {
  date: string;          // YYYY-MM-DD of the gap day
  rawMovePct: number;    // (close_t − close_{t−1}) / close_{t−1} × 100
  from: number;          // close_{t−1}
  to: number;            // close_t
  classification: CleanClass;
  matchedAction: string | null; // e.g. "split 2:1" / "bonus 1:1"
  ratioApplied: number | null;  // factor applied to PRIOR closes (e.g. 0.5 for 1:2)
  flagged25: boolean;    // |move| > 25% (the §7.2 split-check flag)
  sustained: boolean;    // the new level held (didn't revert next day)
  note: string;
}

export interface CleanResult {
  symbol: string;
  cleaned: CleanedDay[];     // split/bonus back-adjusted closes (ascending)
  events: CleanEvent[];      // every flagged single-day move + its disposition
  corrections: number;       // count of split/bonus back-adjustments applied
  quarantined: boolean;      // a structural break makes lookbacks crossing it unreliable
  quarantineFrom: string | null; // earliest break date; windows spanning it are excluded
  clean: boolean;            // true ⇒ no quarantine (safe to score)
}

// §7.2: flag ANY single-day move > 25% for split-check.
export const FLAG_THRESHOLD = 0.25;
// Match tolerance: |observed − standard| / standard. TIGHT on purpose — a real
// unadjusted split-day gap sits within ~2% of its exact factor (the factor × that
// day's small real move). Anything further is NOT auto-corrected — it quarantines.
// (This is the conservative default that avoids the highest silent-corruption risk:
// mis-reading a demerger/value-event as a split. VEDL's 2026 demerger, ratio 0.351,
// is 5.3% off the nearest split ratio 1/3 → correctly NOT matched → quarantined.)
const RATIO_TOL = 0.025;
// "Sustained" = next close stays within this fraction of the post-gap level
// (a real crash-and-bounce reverts; a split/demerger holds the new level).
const REVERT_TOL = 0.15;

/** Standard corporate-action DOWN ratios (post/pre close). Splits and bonuses can
 *  share a ratio (1:2 split == 1:1 bonus == 0.5) — the label is best-effort; the
 *  CORRECTION (back-adjust by the ratio) is identical either way. */
const STANDARD_DOWN: Array<{ ratio: number; label: string; klass: CleanClass }> = [
  { ratio: 1 / 2, label: "split 2:1 / bonus 1:1", klass: "split_corrected" },
  { ratio: 2 / 3, label: "bonus 1:2", klass: "bonus_corrected" },
  { ratio: 1 / 3, label: "split 3:1 / bonus 2:1", klass: "split_corrected" },
  { ratio: 1 / 4, label: "split 4:1 / bonus 3:1", klass: "split_corrected" },
  { ratio: 1 / 5, label: "split 5:1 / bonus 4:1", klass: "split_corrected" },
  { ratio: 1 / 10, label: "split 10:1", klass: "split_corrected" },
  { ratio: 5 / 6, label: "bonus 1:5", klass: "bonus_corrected" },
  { ratio: 3 / 4, label: "bonus 1:3", klass: "bonus_corrected" },
  { ratio: 2 / 5, label: "bonus 3:2", klass: "bonus_corrected" },
];

function matchStandard(ratio: number): { ratio: number; label: string; klass: CleanClass } | null {
  let best: { ratio: number; label: string; klass: CleanClass } | null = null;
  let bestErr = Infinity;
  for (const s of STANDARD_DOWN) {
    const err = Math.abs(ratio - s.ratio) / s.ratio;
    if (err < RATIO_TOL && err < bestErr) { best = s; bestErr = err; }
  }
  return best;
}

/**
 * Detect + correct/quarantine split/bonus discontinuities in a raw close series.
 * Single forward pass to classify each flagged gap, then back-adjust (oldest→newest)
 * by the cumulative product of correction ratios so the series is continuous on
 * today's share basis. Quarantine breaks are NOT corrected.
 */
export function cleanPriceSeries(symbol: string, raw: RawDay[]): CleanResult {
  const series = [...raw].sort((a, b) => a.date.getTime() - b.date.getTime());
  const events: CleanEvent[] = [];
  // factor[i] = cumulative back-adjust to apply to close[i] (prices BEFORE a
  // correction get multiplied by the action ratio). We accumulate from the NEWEST
  // correction backward, so build correction list first, then apply.
  const corrections: { index: number; ratio: number }[] = [];
  let quarantineFrom: string | null = null;

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  for (let i = 1; i < series.length; i++) {
    const from = series[i - 1].close;
    const to = series[i].close;
    if (from <= 0) continue;
    const move = (to - from) / from; // signed fraction
    if (Math.abs(move) <= FLAG_THRESHOLD) continue; // not flagged

    const flagged25 = true;
    const ratio = to / from; // <1 for a down gap
    // sustained? compare the NEXT close to the post-gap level vs the pre-gap level.
    const next = series[i + 1]?.close ?? to;
    const reverted = Math.abs(next - to) / to > REVERT_TOL && Math.abs(next - from) / from < REVERT_TOL;
    const sustained = !reverted;

    if (move < 0 && sustained) {
      const m = matchStandard(ratio);
      if (m) {
        corrections.push({ index: i, ratio: m.ratio });
        events.push({ date: iso(series[i].date), rawMovePct: move * 100, from, to, classification: m.klass, matchedAction: m.label, ratioApplied: m.ratio, flagged25, sustained, note: `gap ratio ${ratio.toFixed(4)} ≈ ${m.label} → back-adjusting prior closes ×${m.ratio.toFixed(4)}` });
        continue;
      }
      // sustained down gap that is NOT a standard split/bonus ratio → structural break.
      if (quarantineFrom === null) quarantineFrom = iso(series[i].date);
      events.push({ date: iso(series[i].date), rawMovePct: move * 100, from, to, classification: "structural_break_quarantined", matchedAction: null, ratioApplied: null, flagged25, sustained, note: `gap ratio ${ratio.toFixed(4)} matches no standard split/bonus → structural break (demerger/data) → QUARANTINE; windows crossing ${iso(series[i].date)} excluded` });
      continue;
    }
    // up gap, or a reverting round-trip → real market move, kept as-is.
    events.push({ date: iso(series[i].date), rawMovePct: move * 100, from, to, classification: "real_move_kept", matchedAction: null, ratioApplied: null, flagged25, sustained, note: move > 0 ? "up gap — never a split/bonus (those dilute downward); real move kept" : "down gap reverted next day — real crash/bounce, not a level shift; kept" });
  }

  // Apply back-adjustment: each close[j] is multiplied by the product of the ratios
  // of every correction with index > j (corrections after day j shrink prior history).
  const cleaned: CleanedDay[] = series.map((d) => ({ date: d.date, close: d.close }));
  for (const c of corrections) {
    for (let j = 0; j < c.index; j++) cleaned[j].close = cleaned[j].close * c.ratio;
  }

  return {
    symbol,
    cleaned,
    events,
    corrections: corrections.length,
    quarantined: quarantineFrom !== null,
    quarantineFrom,
    clean: quarantineFrom === null,
  };
}
