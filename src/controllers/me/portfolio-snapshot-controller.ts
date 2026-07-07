// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO HEALTH SNAPSHOT — the authenticated user's pre-computed PHS read.
//
//   GET /api/v1/me/portfolio     the latest Portfolio Health Score snapshot
//
// PURE READ over the persisted snapshot (A.12). A GET NEVER computes or persists —
// it only serves the latest persisted row. The frontend never recomputes a score,
// penalty or weight either; it renders exactly what this serves. The snapshot is the
// single source of truth (engine → persist.computeAndPersistPhs).
//
// PRESENTATION SPLIT (portfolio-spec 1.1 presentation addendum) — the read is REGROUPED
// into two NAMED reads over the SAME computed values (no math, no recompute, byte-identical):
//   • construction_read — ALWAYS present (needs zero scored holdings): the Structure pillar,
//     its display band, PC/PB findings, and the tier/coverage context.
//   • health_read — NULLABLE, present ONLY when scored_weight > 0: the uncapped Health Score
//     + band, Quality/Signals, a Provisional tag, pillarProfile + lensProfile (1.2), and
//     PQ/PS/PX/PV findings. null when no scored holdings. (1.2: coverage ceiling retired.)
//   • headline_slot — "health" if health_read exists, else "construction".
//   • coverage_state — the coverage story both reads reference (weights + counts + unlock flag).
// Nothing here changes a number: pillars/PHS/findings/ledgers are read verbatim off the row.
//
// Freshness is the MUTATION path's job, not the read's: computeAndPersistPhs fires on
// a transaction write (the book changed) and on the nightly rescore (scores changed) —
// the only two things that move portfolio health. So by the time this GET runs, the
// latest snapshot already reflects the current book.
//
// No snapshot yet (empty book, or a book whose first mutation/rescore hasn't landed) →
// the honest construction state (snapshot:null); hasHoldings tells the UI which.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import type { PfFinding } from "../../portfolio/phs/patterns.js";
import type { PillarProfile, LensProfile } from "../../portfolio/phs/engine.js";

/** Decimal | null → number | null (Prisma.Decimal serializes to string otherwise). */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** A value `num()` accepts — number, Prisma.Decimal (has toString), string, or null. */
type NumLike = number | string | { toString(): string } | null;

/** The snapshot fields the reshape reads — structural so the Prisma row AND test mocks
 *  both satisfy it (no dependency on the exact generated row type). (1.2) ceiling columns
 *  (phsRaw/ceilingApplied/ceilingValue) are retired and no longer read. */
export interface SnapshotReadInput {
  id: string;
  phs: number | null; // (1.2) the `phs` column now holds the uncapped Health Score
  band: string | null;
  provisional: boolean; // coverage < 40% → the "Provisional" tag
  evaluable: boolean;
  quality: NumLike;
  structure: NumLike;
  signals: NumLike;
  coverage: NumLike; // = scored value share (c)
  totalValue: NumLike;
  recognizedUnscoredValue: NumLike;
  smallUnscoredValue: NumLike;
  structureLedger: unknown; // StructureDeduction[]
  signalsLedger: unknown; // SignalsDeduction[]
  firedFindings: unknown; // PfFinding[] | null
  pillarProfile: unknown; // (1.2 Change 4) PillarProfile | null
  lensProfile: unknown; // (1.2 Change 5) LensProfile
  structureTier: string | null;
  capitalTier: string | null;
  constantVersion: string;
  createdAt: Date;
}

// ── the two-read contract (wire) ────────────────────────────────────────────────────
export type HeadlineSlot = "health" | "construction";
export type ConstructionBand = "Well-built" | "Solid" | "Concentrated" | "Lopsided" | "Fragile";

/** Construction band from the ALREADY-COMPUTED Structure pillar — a presentation mapping,
 *  never a recompute. ≥90 Well-built · 75–89 Solid · 60–74 Concentrated · 40–59 Lopsided · <40 Fragile. */
export function constructionBandOf(structure: number): ConstructionBand {
  if (structure >= 90) return "Well-built";
  if (structure >= 75) return "Solid";
  if (structure >= 60) return "Concentrated";
  if (structure >= 40) return "Lopsided";
  return "Fragile";
}

export interface CoverageState {
  scoredWeight: number; // 0..1 (= the snapshot's coverage, c)
  recognizedUnscoredWeight: number; // 0..1
  smallUnscoredWeight: number; // 0..1
  scoredCount: number; // holdings with a score (live count over the current book)
  totalCount: number; // open holdings (live count)
  totalValue: number; // ₹ book value at compute time (denominator; prevents ₹ loss)
  unlockTrigger: boolean; // recognized-unscored capital exists → scoring it lifts the read (c_eff)
}

export interface ConstructionRead {
  value: number; // Structure pillar 0..100 (verbatim)
  band: ConstructionBand;
  structureTier: string | null; // Starter | Building | Established | null (pre-1.1 rows)
  capitalTier: string | null; // Modest | Moderate | Substantial | null
  findings: PfFinding[]; // PC + PB (— OR every fired finding when there is no health read)
  structureLedger: unknown; // the S-rule evidence (StructureDeduction[])
}

export interface HealthRead {
  value: number | null; // (1.2) the Health Score — TRUE / UNCAPPED (was "PHS"); present ⇒ integer
  band: string | null; // Strong | Steady | Mixed | Fragile | Weak
  quality: number | null; // the anchor
  signals: number; // penalty-only (the only term in Health besides Quality)
  evaluable: boolean; // always true when this read is present
  provisional: boolean; // (1.2 Change 3) coverage < 40% → "Provisional" tag (ceiling retired)
  findings: PfFinding[]; // PQ + PS + PX + PV
  signalsLedger: unknown; // the red-flag evidence (SignalsDeduction[])
  pillarProfile: PillarProfile | null; // (1.2 Change 4) where the quality comes from
  lensProfile: LensProfile; // (1.2 Change 5) findings-character shares; null ⇔ no lens patterns
}

export interface PortfolioReads {
  id: string;
  headlineSlot: HeadlineSlot;
  coverageState: CoverageState;
  constructionRead: ConstructionRead; // ALWAYS present
  healthRead: HealthRead | null; // null ⇔ scored_weight = 0
  constantVersion: string;
  asOf: string; // ISO
}

/** Live holding counts the snapshot does NOT persist (it stores value splits, not counts).
 *  "N of M scored" for the coverage fact — read from the current book, matching the
 *  display contract's existing FE-side count. */
export interface ReshapeCounts {
  scoredCount: number;
  totalCount: number;
}

/** PART B family → read. construction = PC/PB; health = PQ/PS/PX/PV. */
const CONSTRUCTION_FAMILIES = new Set(["PC", "PB"]);

/**
 * REGROUP the flat snapshot into the two named reads. Pure — no DB, no recompute; every
 * value is read verbatim off the row (byte-identical to the pre-split flat shape).
 *
 * Finding partition (byte-identical guarantee): PC/PB → construction_read, PQ/PS/PX/PV →
 * health_read. When there is NO health read (scored_weight = 0), construction_read is the
 * ONLY read, so it carries EVERY fired finding — nothing is ever dropped. (At c=0 the health
 * families that can still fire are the constructive PS5 "no red flags" and the PV coverage
 * findings; they ride along under construction rather than vanishing with the null health read.)
 */
export function reshapeSnapshot(s: SnapshotReadInput, counts: ReshapeCounts): PortfolioReads {
  const total = num(s.totalValue) as number;
  const scoredWeight = num(s.coverage) as number; // c — the scored value share
  const recognizedUnscoredWeight = total > 0 ? (num(s.recognizedUnscoredValue) as number) / total : 0;
  const smallUnscoredWeight = total > 0 ? (num(s.smallUnscoredValue) as number) / total : 0;

  const findings = (s.firedFindings ?? []) as PfFinding[];
  const structure = num(s.structure) as number;
  const healthReadPresent = scoredWeight > 0; // ⇔ evaluable ⇔ scored holdings exist

  const constructionFindings = healthReadPresent
    ? findings.filter((f) => CONSTRUCTION_FAMILIES.has(f.family))
    : findings; // no health read → construction owns the whole set (nothing dropped)
  const healthFindings = healthReadPresent ? findings.filter((f) => !CONSTRUCTION_FAMILIES.has(f.family)) : [];

  const coverageState: CoverageState = {
    scoredWeight,
    recognizedUnscoredWeight,
    smallUnscoredWeight,
    scoredCount: counts.scoredCount,
    totalCount: counts.totalCount,
    totalValue: total,
    // Unlock phrasing: recognized-unscored (large/mid) capital exists → scoring it raises
    // coverage (the Health number is already TRUE/uncapped in 1.2; more coverage just lifts
    // the confidence tag, never the number). Small-unscored names don't drive the prompt.
    unlockTrigger: recognizedUnscoredWeight > 0,
  };

  const constructionRead: ConstructionRead = {
    value: structure,
    band: constructionBandOf(structure),
    structureTier: s.structureTier,
    capitalTier: s.capitalTier,
    findings: constructionFindings,
    structureLedger: s.structureLedger,
  };

  const healthRead: HealthRead | null = healthReadPresent
    ? {
        value: s.phs, // present ⇒ number (evaluable) — the Health Score, uncapped
        band: s.band,
        quality: num(s.quality),
        signals: num(s.signals) as number,
        evaluable: s.evaluable,
        provisional: s.provisional, // (1.2 Change 3) the tag replaces the retired ceiling
        findings: healthFindings,
        signalsLedger: s.signalsLedger,
        pillarProfile: (s.pillarProfile ?? null) as PillarProfile | null,
        lensProfile: (s.lensProfile ?? null) as LensProfile,
      }
    : null;

  return {
    id: s.id,
    headlineSlot: healthRead ? "health" : "construction",
    coverageState,
    constructionRead,
    healthRead,
    constantVersion: s.constantVersion,
    asOf: s.createdAt.toISOString(),
  };
}

export const getPortfolioSnapshot = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    // Reads only (zero writes): the latest persisted snapshot + the live "N of M scored"
    // counts the snapshot doesn't persist (it stores value splits, not holding counts) +
    // whether the user still holds anything (empty-vs-construction states when no snapshot).
    const [snap, totalCount, scoredCount] = await Promise.all([
      prisma.portfolioHealthSnapshot.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.holding.count({ where: { userId, quantity: { gt: 0 } } }),
      prisma.holding.count({ where: { userId, quantity: { gt: 0 }, stock: { scoreSnapshots: { some: {} } } } }),
    ]);

    if (!snap) {
      return res.json({ success: true, data: { snapshot: null, hasHoldings: totalCount > 0 } });
    }
    return res.json({
      success: true,
      data: {
        snapshot: reshapeSnapshot(snap, { scoredCount, totalCount }),
        hasHoldings: totalCount > 0,
      },
    });
  } catch (e) {
    console.error("[GET /me/portfolio]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to load portfolio health" });
  }
};
