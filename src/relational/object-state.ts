// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — OBJECT STATE RESOLVER (§1.3).
//
// The stock, resolved to what the UO/UH entries read — CONSUMED AS DATA, never re-derived (§0.7). Every
// fact comes from an existing engine: identity + sector + peer group from the catalog, coverage from
// `resolveCoverage`, the in-force snapshot from `getLatestSnapshotRef` (the SAME supersede-aware resolver
// the health view uses), and the fired set from the persisted `score_patterns` / `score_red_flags` rows
// hanging off that snapshot. It NEVER recomputes a score, a band, or a finding.
//
// ★ MAGNITUDE IS NOT SELECTED (§0.7.1). `ScorePattern.magnitude` exists on the row and is deliberately
// NOT read into `ObjectFinding` — it answers a question about the MODEL, never about the reader, and a
// display-only finding can be the most important thing on the card. Grep-verified in the build.
//
// ★ POLARITY IS DERIVED FROM THE KEY NAMESPACE (§3), never a column: `_N\d+_` ⇒ positive (Family N, the
// constructive twins). The locked invariant — P/R may affect the score, everything else is display-only —
// means no migration is needed to know a finding's polarity for selection.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { getLatestSnapshotRef, resolveCoverage } from "../scoring/read/scoring-read.service.js";
import type { ObjectState, ObjectFinding } from "./types.js";

/** `_N\d+_` ⇒ Family N (positive). A red flag is negative. Otherwise fall back to the fired instance's
 *  own `direction` (positive/negative), and `neutral` when it carries none. This is the ONLY polarity
 *  derivation in the layer, and it reads the KEY, not a hardcoded id list (§0.7). */
const N_NAMESPACE = /_N\d+_/;
function derivePolarity(key: string, kind: "pattern" | "red_flag", direction: string | null): ObjectFinding["polarity"] {
  if (N_NAMESPACE.test(key)) return "positive";
  if (kind === "red_flag") return "negative";
  if (direction === "positive") return "positive";
  if (direction === "negative") return "negative";
  return "neutral";
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Resolve the ObjectState for one stock. Returns null only when the stockId is not a real stock (the
 * caller 404s). A scored stock carries a snapshot + fired set; an unscored one resolves identity +
 * coverage with `snapshot: null` and an empty fired set — honest-empty, never fabricated.
 */
export async function resolveObjectState(stockId: string): Promise<ObjectState | null> {
  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    select: {
      id: true,
      symbol: true,
      name: true,
      sector: { select: { name: true, displayName: true, sectorClass: true } },
    },
  });
  if (!stock) return null;

  // Coverage + peer group + the in-force snapshot ref, in parallel (three indexed lookups).
  const [coverage, spg, snapRef] = await Promise.all([
    resolveCoverage(stock.id),
    prisma.stockPeerGroup.findFirst({
      where: { stockId: stock.id },
      select: { peerGroup: { select: { id: true, displayName: true, stockCount: true } } },
    }),
    getLatestSnapshotRef(stock.id),
  ]);
  const pg = spg?.peerGroup ?? null;

  const sector = stock.sector
    ? { key: stock.sector.name, displayName: stock.sector.displayName, sectorClass: stock.sector.sectorClass ?? null }
    : null;
  const peerGroup = pg ? { id: pg.id, label: pg.displayName, memberCount: pg.stockCount } : null;

  // ── Not scored: identity + coverage only, no snapshot, empty fired set (UG1/UH10 handle the reason). ──
  if (!snapRef) {
    return {
      kind: "stock",
      stockId: stock.id,
      symbol: stock.symbol,
      displayLabel: stock.name,
      isScored: false,
      coverage: { state: coverage?.coverageState ?? null, reason: coverage?.coverageReason ?? null },
      snapshot: null,
      sector,
      peerGroup,
      findings: [],
      pondMask: null,
    };
  }

  // ── Scored: the in-force snapshot + its persisted fired set. Targeted select — NOT the full health
  //    graph (metrics / peer distributions), so this stays lean against the §5.7 budget. `magnitude` is
  //    deliberately NOT selected. ──
  const snap = await prisma.scoreSnapshot.findUnique({
    where: { id: snapRef.id },
    select: {
      id: true,
      periodKey: true,
      composite: true,
      labelBand: true,
      maskHeat: true,
      patterns: { select: { patternKey: true, severity: true, direction: true, evidence: true } },
      redFlags: { select: { flagKey: true, severity: true, triggeringValues: true } },
    },
  });
  if (!snap) {
    // The ref resolved but the row vanished between calls (a concurrent prune) — treat as unscored.
    return {
      kind: "stock",
      stockId: stock.id,
      symbol: stock.symbol,
      displayLabel: stock.name,
      isScored: false,
      coverage: { state: coverage?.coverageState ?? null, reason: coverage?.coverageReason ?? null },
      snapshot: null,
      sector,
      peerGroup,
      findings: [],
      pondMask: null,
    };
  }

  const findings: ObjectFinding[] = [
    ...snap.patterns.map((p): ObjectFinding => ({
      kind: "pattern",
      key: p.patternKey,
      severity: p.severity,
      polarity: derivePolarity(p.patternKey, "pattern", p.direction),
      temporalClass: "CONDITION", // a fired finding is a standing condition (§0.5); TRANSITION/CLOCK are UD's
      evidence: asRecord(p.evidence),
    })),
    ...snap.redFlags.map((r): ObjectFinding => ({
      kind: "red_flag",
      key: r.flagKey,
      severity: r.severity ?? "critical",
      polarity: derivePolarity(r.flagKey, "red_flag", null),
      temporalClass: "CONDITION",
      evidence: asRecord(r.triggeringValues),
    })),
  ];

  return {
    kind: "stock",
    stockId: stock.id,
    symbol: stock.symbol,
    displayLabel: stock.name,
    isScored: true,
    coverage: { state: coverage?.coverageState ?? null, reason: coverage?.coverageReason ?? null },
    snapshot: {
      generation: snap.id,
      periodKey: snap.periodKey,
      composite: Number(snap.composite),
      band: snap.labelBand,
    },
    sector,
    peerGroup,
    findings,
    pondMask: snap.maskHeat
      ? { heat: snap.maskHeat as "hot" | "warm" | "calm", isHot: snap.maskHeat === "hot" }
      : null,
  };
}
