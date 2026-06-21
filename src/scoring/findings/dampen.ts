// File: src/scoring/findings/dampen.ts
//
// PG-WIDE DAMPENING — the one cross-stock mechanism (File 1 §5E). A PATTERN firing on >80% of
// its peer group simultaneously is a SECTOR-WIDE condition, not a stock-specific finding → its
// magnitude is HALVED and it is marked "dampened" (displayState) + annotated. Runs POST-FIRE,
// PRE-PERSIST (computePgScores fires the whole PG together, so the PG-wide rate is known before
// any persist).
//
// RULES (File 1 + the stage constraints):
//   • PATTERNS ONLY. Red flags (kind "red_flag") are stock-specific critical signals — they
//     NEVER dampen.
//   • Denominator = the PG's SCORED members (those that produced a finding set), not the full
//     roster (an unscored member is not evidence for/against a sector-wide condition).
//   • Orthogonal to fire/suppress: dampening changes magnitude + displayState only — it does
//     NOT change WHETHER a rule fired.
//   • Magnitude halved where present (P-patterns ±5/−3/−8); structural cards (B/C/D/F/G/I/H —
//     magnitude null) still get the "sector-wide" mark (no magnitude to halve).

import type { FiredFinding } from "./types.js";

export const DAMPEN_THRESHOLD = 0.80; // > 80% of the PG's scored members
// MIN scored members for ">80%" to mean anything. With N=1–2 (shallow early-backfill periods)
// every fired pattern is trivially "100% of the PG" — a spurious sector-wide conclusion. A real
// peer-group inference needs a quorum. At N=5 the threshold requires 5/5 (>80%); below 5 we do
// NOT dampen. (Validation caught FY24-era 1/1 & 2/2 false-dampening — this guards the rescore.)
export const MIN_MEMBERS_FOR_DAMPENING = 5;

export interface DampenReport {
  scoredMembers: number;
  dampened: { key: string; firedOn: number; pctOfScored: number }[];
}

/** Mutate the fired findings IN PLACE: any pattern firing on > 80% of the scored members is
 *  dampened (halved magnitude + displayState "dampened" + evidence annotation). The arrays are
 *  the same FiredFinding objects held on MemberComputed.findings, so the mutation persists. */
export function applyPgDampening(scoredFindingSets: FiredFinding[][]): DampenReport {
  const N = scoredFindingSets.length;
  if (N < MIN_MEMBERS_FOR_DAMPENING) return { scoredMembers: N, dampened: [] }; // too small a quorum

  // Count distinct members firing each pattern key (a member firing a key twice counts once).
  const firedBy = new Map<string, number>();
  for (const set of scoredFindingSets) {
    const seen = new Set<string>();
    for (const f of set) {
      if (f.kind !== "pattern" || seen.has(f.key)) continue;
      seen.add(f.key);
      firedBy.set(f.key, (firedBy.get(f.key) ?? 0) + 1);
    }
  }

  const dampened: DampenReport["dampened"] = [];
  for (const [key, c] of firedBy) {
    if (c / N <= DAMPEN_THRESHOLD) continue;
    dampened.push({ key, firedOn: c, pctOfScored: Math.round((c / N) * 1000) / 10 });
    const note = `sector-wide condition — fired on ${c}/${N} (${Math.round((c / N) * 100)}%) of the peer group; magnitude halved`;
    for (const set of scoredFindingSets) {
      for (const f of set) {
        if (f.kind !== "pattern" || f.key !== key) continue;
        f.displayState = "dampened";
        if (f.magnitude != null) f.magnitude = Math.round((f.magnitude / 2) * 100) / 100;
        (f.evidence as Record<string, unknown>).sectorWide = note;
      }
    }
  }
  return { scoredMembers: N, dampened };
}
