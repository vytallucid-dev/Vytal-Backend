// File: src/scoring/findings/composition/band-typical.ts
//
// BAND-TYPICAL 4-pillar profiles — the reference F1 (atypical-for-band) compares against.
// Per composite band, the MEDIAN of each pillar subtotal across the universe's head
// snapshots (only over snapshots where that pillar was genuinely scored — w>0). Computed
// once per pass and injected into the FiringContext (rules stay pure / DB-free).
//
// PIT: restricted to snapshots ≤ cutoff (a backfill at period P sees only ≤P band-typicals).
// CURRENT-CALIBRATION: bands are under today's bars (same caveat as the trajectory series).

import { prisma } from "../../../db/prisma.js";
import type { LabelBand, Pillar } from "../../composite/types.js";

export type PillarProfile = Record<Pillar, number | null>; // median per pillar (null if none scored)
export type BandTypicalProfiles = Partial<Record<LabelBand, PillarProfile>>;

const num = (d: any): number => (d == null ? 0 : typeof d.toNumber === "function" ? d.toNumber() : Number(d));
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median 4-pillar profile per band, over head-of-chain snapshots ≤ cutoff. */
export async function loadBandTypicalProfiles(cutoff: Date | null): Promise<BandTypicalProfiles> {
  const rows = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly", ...(cutoff ? { asOfDate: { lte: cutoff } } : {}), supersededBy: { is: null } },
    select: {
      labelBand: true,
      foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true,
      wFoundation: true, wMomentum: true, wMarket: true, wOwnership: true,
    },
  });
  const buckets = new Map<LabelBand, Record<Pillar, number[]>>();
  for (const r of rows) {
    const b = r.labelBand as LabelBand;
    if (!buckets.has(b)) buckets.set(b, { foundation: [], momentum: [], market: [], ownership: [] });
    const k = buckets.get(b)!;
    if (num(r.wFoundation) > 0) k.foundation.push(num(r.foundationSubtotal));
    if (num(r.wMomentum) > 0) k.momentum.push(num(r.momentumSubtotal));
    if (num(r.wMarket) > 0) k.market.push(num(r.marketSubtotal));
    if (num(r.wOwnership) > 0) k.ownership.push(num(r.ownershipSubtotal));
  }
  const out: BandTypicalProfiles = {};
  for (const [b, k] of buckets) {
    out[b] = { foundation: median(k.foundation), momentum: median(k.momentum), market: median(k.market), ownership: median(k.ownership) };
  }
  return out;
}
