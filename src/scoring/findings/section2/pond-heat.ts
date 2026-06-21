// File: src/scoring/findings/section2/pond-heat.ts
//
// POND HEAT — the PG-level "is the pond hot" signal behind the §5 mask modifier (File 1 §5 /
// File 2 §3.3 / §7). PURE (no DB/IO). The caller supplies each member's CLEANED closes (via
// getCleanedCloses — the single price chokepoint, split/bonus-adjusted, never raw rows) and
// this returns the PG-level mask_heat ∈ {hot, warm, calm} + the signed trailing move behind it.
//
// DEFINITION (confirmed against File 1 §5 + File 2 §3.3/§7/§8, with the locked rulings):
//   • mask_heat is a PG-LEVEL property (a PGState property "inherited by every member") — NOT
//     a per-stock read. It is the "pure-price arithmetic" of the pond's recent move.
//   • trailing move = each member's pure-price return over a ~21 trading-day (~1 month) window;
//     the pond's move = the MEDIAN of those member returns (robust to one outlier).
//   • heat is a MAGNITUDE axis: |pond median return| → calm / warm / hot. A sharp run-up ("hot")
//     OR a sharp sell-off ("stressed") both mask price-linked reads — the caveat ("look for the
//     catalyst") applies to a crash as much as a melt-up. Sign is retained on trailingMovePct
//     for display; the heat category is on |.|.
//   • DISPLAY-ONLY modifier: heat never changes whether a card fires; only annotates B/C1/D.
//
// GATING (same discipline as §2 risk-shape / the Market pillar): a member with a structural
// break in view (clean report `quarantined`) or < window+1 clean closes does NOT contribute —
// one quarantined stock (e.g. VEDL demerger) must never poison the pond's heat. A PG without a
// quorum of clean members reports heat = null ("not established"), never a spurious "calm".
//
// THRESHOLDS ARE PROVISIONAL (File 1/2 describe heat qualitatively, no locked cut) — calibrated
// from the live 13-PG distribution and flagged for tuning, exactly like the K2 / P-pattern cuts.

export const POND_HEAT_WINDOW_DAYS = 21;   // ~1 trading month — the "right now" window (ruling)
export const POND_HEAT_MIN_MEMBERS = 3;    // quorum: <3 clean members ⇒ heat not established. FLAG: provisional
// |pond median 21d return| cut points (%). Provisional — see pond-heat-validate.ts calibration.
export const POND_HEAT_WARM_PCT = 6;       // FLAG: provisional
export const POND_HEAT_HOT_PCT = 12;       // FLAG: provisional

export type MaskHeat = "hot" | "warm" | "calm";

export interface PondHeat {
  /** PG-level heat category, or null when not establishable (no member quorum). */
  heat: MaskHeat | null;
  /** SIGNED pond median trailing return (%), e.g. +14.2 (run-up) or −18.7 (sell-off). null when n/a. */
  trailingMovePct: number | null;
  /** Members that contributed a clean trailing return (the heat denominator). */
  memberCount: number;
  note: string;
}

/** Categorize the |pond move| into the provisional calm/warm/hot bands. */
export function heatOf(absMovePct: number): MaskHeat {
  if (absMovePct >= POND_HEAT_HOT_PCT) return "hot";
  if (absMovePct >= POND_HEAT_WARM_PCT) return "warm";
  return "calm";
}

/**
 * One member's pure-price trailing return (%) over the window, from CLEANED closes (ascending).
 * Returns null when there are fewer than window+1 positive closes (insufficient history) — the
 * caller must ALSO drop members whose clean report is quarantined (structural break in view).
 */
export function memberTrailingReturnPct(
  cleanedCloses: number[],
  windowDays = POND_HEAT_WINDOW_DAYS,
): number | null {
  const c = cleanedCloses.filter((x) => x > 0);
  if (c.length < windowDays + 1) return null;
  const last = c[c.length - 1];
  const base = c[c.length - 1 - windowDays];
  if (base <= 0) return null;
  return (last / base - 1) * 100;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * PG-level pond heat from the members' trailing returns. `memberReturns` must already exclude
 * quarantined / insufficient-history members (the caller drops them to null). Heat = magnitude
 * of the pond's MEDIAN trailing move; trailingMovePct keeps the sign for display.
 */
export function computePondHeat(memberReturns: (number | null)[]): PondHeat {
  const rs = memberReturns.filter((r): r is number => r !== null && Number.isFinite(r));
  if (rs.length < POND_HEAT_MIN_MEMBERS) {
    return {
      heat: null,
      trailingMovePct: null,
      memberCount: rs.length,
      note: `pond heat not established — only ${rs.length} member(s) with clean ${POND_HEAT_WINDOW_DAYS}d history (need ${POND_HEAT_MIN_MEMBERS})`,
    };
  }
  const med = median(rs);
  return {
    heat: heatOf(Math.abs(med)),
    trailingMovePct: Math.round(med * 100) / 100,
    memberCount: rs.length,
    note: "computed",
  };
}
