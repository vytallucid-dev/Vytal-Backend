// ─────────────────────────────────────────────────────────────────────────────
// PHS PERSISTENCE (A.12) — compute-once, append-only, skip-identical.
// Assembles the book → runs the engine → fingerprints the inputs → writes ONE
// snapshot per compute-event, UNLESS the fingerprint matches the user's latest
// (then skip). The snapshot is the single source every surface reads.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { computePhs, type PhsHolding } from "./engine.js";
import { CONSTANT_VERSION } from "./constants.js";
import { assemblePortfolio } from "./assemble.js";
import { firePortfolioFindings } from "./patterns.js";

/** Provenance IDs that (with the weights vector) make the fingerprint (A.12). */
export interface PhsProvenance {
  healthSnapshotIds: string[]; // constituent ScoreSnapshot ids (the scores PHS READ)
  findingIds: string[]; // fired finding ids per holding
  tierAsOfDate: string; // market-cap tier symbol-master version
  sectorVersion: string; // sector symbol-master version
}

/** Deterministic fingerprint over { weights vector, health-snapshot IDs, finding IDs,
 *  tier/sector versions, constant_version } — A.12. Unchanged ⇒ skip the write. */
export function fingerprintOf(holdings: PhsHolding[], prov: PhsProvenance): string {
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  const weights = holdings
    .map((h) => [h.symbol, total > 0 ? Math.round((h.marketValue / total) * 1e6) / 1e6 : 0] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const canonical = JSON.stringify({
    weights,
    health: [...prov.healthSnapshotIds].sort(),
    findings: [...prov.findingIds].sort(),
    tier: prov.tierAsOfDate,
    sector: prov.sectorVersion,
    cv: CONSTANT_VERSION,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export interface PersistOutcome {
  skipped: boolean; // true ⇔ fingerprint unchanged from the latest snapshot
  snapshotId: string;
  phs: number | null;
  band: string | null;
  fingerprint: string;
}

/** Compute + persist the PHS snapshot for a user's book. Idempotent per input
 *  fingerprint (append-only; identical inputs → no new row). */
export async function computeAndPersistPhs(userId: string): Promise<PersistOutcome> {
  const { holdings, prov, fieldWeakSymbols } = await assemblePortfolio(userId);
  const r = computePhs(holdings);
  // Part B: fire portfolio findings from the SAME computed values + holdings (compute-once,
  // spec §0). firePortfolioFindings READS r; it never mutates a number.
  const findings = firePortfolioFindings(holdings, r, { fieldWeakSymbols });
  const fingerprint = fingerprintOf(holdings, prov);

  const latest = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, fingerprint: true, phs: true, band: true },
  });
  if (latest && latest.fingerprint === fingerprint) {
    return { skipped: true, snapshotId: latest.id, phs: latest.phs, band: latest.band, fingerprint };
  }

  const dec = (v: number | null) => (v == null ? null : new Prisma.Decimal(v));
  const snap = await prisma.portfolioHealthSnapshot.create({
    data: {
      userId,
      phs: r.phs,
      phsRaw: dec(r.phsRaw),
      band: r.band,
      provisional: r.provisional,
      evaluable: r.evaluable,
      ceilingApplied: r.ceilingApplied,
      ceilingValue: r.ceilingValue,
      quality: dec(r.quality),
      structure: new Prisma.Decimal(r.structure),
      signals: new Prisma.Decimal(r.signals),
      coverage: new Prisma.Decimal(r.coverage),
      totalValue: new Prisma.Decimal(r.totalValue),
      scoredValue: new Prisma.Decimal(r.scoredValue),
      recognizedUnscoredValue: new Prisma.Decimal(r.recognizedUnscoredValue),
      smallUnscoredValue: new Prisma.Decimal(r.smallUnscoredValue),
      structureLedger: r.structureLedger as unknown as Prisma.InputJsonValue,
      signalsLedger: r.signalsLedger as unknown as Prisma.InputJsonValue,
      firedFindings: findings as unknown as Prisma.InputJsonValue, // Part B — fired PF findings
      constantVersion: CONSTANT_VERSION,
      fingerprint,
    },
    select: { id: true },
  });
  return { skipped: false, snapshotId: snap.id, phs: r.phs, band: r.band, fingerprint };
}
