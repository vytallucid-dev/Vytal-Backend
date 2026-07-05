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
// Freshness is the MUTATION path's job, not the read's: computeAndPersistPhs fires on
// a transaction write (the book changed) and on the nightly rescore (scores changed) —
// the only two things that move portfolio health. So by the time this GET runs, the
// latest snapshot already reflects the current book. A book whose scores changed
// overnight is covered by the nightly trigger, not by recomputing on read.
//
// No snapshot yet (empty book, or a book whose first mutation/rescore hasn't landed) →
// the honest construction state (snapshot:null); hasHoldings tells the UI which.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import type { PfFinding } from "../../portfolio/phs/patterns.js";

/** Decimal | null → number | null (Prisma.Decimal serializes to string otherwise). */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

type SnapshotRow = NonNullable<
  Awaited<ReturnType<typeof prisma.portfolioHealthSnapshot.findFirst>>
>;

function serialize(s: SnapshotRow) {
  return {
    id: s.id,
    // ── headline ──
    phs: s.phs, // Int? — already a number | null
    phsRaw: num(s.phsRaw),
    band: s.band, // "Strong" | "Steady" | "Mixed" | "Fragile" | "Weak" | null (PHS band scale)
    provisional: s.provisional,
    evaluable: s.evaluable,
    ceilingApplied: s.ceilingApplied,
    ceilingValue: s.ceilingValue, // Int? — null when coverage ≥ 0.80 (no ceiling)
    // ── pillars (Quality anchor · Structure + Signals penalty-only) ──
    quality: num(s.quality),
    structure: num(s.structure) as number,
    signals: num(s.signals) as number,
    // ── coverage + bucket value splits (the capital-across-health safeguard) ──
    coverage: num(s.coverage) as number, // 0..1
    totalValue: num(s.totalValue) as number,
    scoredValue: num(s.scoredValue) as number,
    recognizedUnscoredValue: num(s.recognizedUnscoredValue) as number,
    smallUnscoredValue: num(s.smallUnscoredValue) as number,
    // ── fired portfolio findings (Part B) — copy + tone, rendered as-is ──
    firedFindings: (s.firedFindings ?? []) as unknown as PfFinding[],
    // ── deduction ledgers (Health tab consumes; harmless for Overview) ──
    structureLedger: s.structureLedger,
    signalsLedger: s.signalsLedger,
    // ── provenance ──
    constantVersion: s.constantVersion,
    asOf: s.createdAt.toISOString(),
  };
}

export const getPortfolioSnapshot = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    // Two READS, zero writes: the latest persisted snapshot + whether the user still
    // holds anything (drives the empty-vs-construction states when there's no snapshot).
    const [snap, openPositions] = await Promise.all([
      prisma.portfolioHealthSnapshot.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.holding.count({ where: { userId, quantity: { gt: 0 } } }),
    ]);

    if (!snap) {
      return res.json({ success: true, data: { snapshot: null, hasHoldings: openPositions > 0 } });
    }
    return res.json({
      success: true,
      data: { snapshot: serialize(snap), hasHoldings: openPositions > 0 },
    });
  } catch (e) {
    console.error("[GET /me/portfolio]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to load portfolio health" });
  }
};
