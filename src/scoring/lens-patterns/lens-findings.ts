// File: src/scoring/lens-patterns/lens-findings.ts
//
// THE LENS → FINDINGS-STREAM ESCALATION ADAPTER (Stage 3).
//
// Turns the LOUD lens-patterns into FiredFinding members of the EXISTING findings
// stream, so they ride the same FiredFinding → runFindings → dampen → persist path
// the R/P findings use (computePgScores → persistMember/persistFindings). Lens-patterns
// are MEMBERS of the fired set, never a parallel stream.
//
// WHAT ESCALATES (databank §5.2 + briefing §4) — only the LOUD field-weak /
// broad-deterioration cases are eligible to become top-level finding cards:
//   • LM3 (below·above·any — "below bar, leads a weak field", PG_WEAK)  → lens_lm3_<metricKey>
//   • LM7 (below·below·declining — "weak on every lens")                → lens_lm7_<metricKey>
//   • LP2 (pillar L1 weak/mixed · L2 strong — "field-lifted", PG_WEAK)  → lens_lp2_<pillar>
//   • LP5 (pillar L3 declining ≥70% — "eroding breadth")                → lens_lp5_<pillar>
// The QUIET ones (LM1/LM2/LM4/LM5/LM6/LM8, LP1/LP3/LP4/LP6 — incl. the LM4 elite-field
// CONTEXT verdict) are computed-and-surfaced in the pillar breakdown / payload (the
// read layer recomputes them from the atom, health-view.service.ts) but DO NOT escalate
// to a finding row. LM3 field-weak IS loud; LM4 elite IS quiet (context, not a finding).
//
// ANTI-DOUBLE-COUNT (§5.3, applied via the primitive against the SAME-snapshot fired
// findings): LP5/LP6 defer to Family-B (trajectory_B_deterioration); LM5 defers to
// Family-D (trajectory_D_recovery). A loud pattern only escalates when it is TOP-LEVEL
// after deferral — a deferred LP5 becomes supporting-detail BENEATH B (surfaced in the
// pillar breakdown with role=supporting_detail), never a competing top-level card.
// (LM3/LM7/LP2 have no existing-finding overlap — §5.3 — so they always surface freely.)
//
// PEER-STATS RESOLUTION — ROBUST, FK-FIRST, NATURAL-KEY FALLBACK (PERMANENT, baked in):
// each metric's peer μ/σ/N is resolved FK-FIRST (the peerStats already attached to the
// in-memory ScoredMetric by the cross-section scorer — the live analogue of the
// MetricScore.peerStatsSnapshotId relation), then NATURAL-KEY FALLBACK (the PG-level
// PeerStatsCapture for this run, keyed by pillar+metricKey — the live analogue of the
// score_peer_stats @@index([peerGroupId, asOfDate]) read). This is the SAME resolution
// S1/S2 proved at 100%, NOT a temporary harness shim.
//   KNOWN-ACCEPTED CONDITION (operator decision): the FK (MetricScore.peerStatsSnapshotId)
//   is NULL on ~85% of already-committed rows even though L2 was computed. That is an
//   accepted backfill state — the natural-key fallback resolves it to 100%. FK-backfill
//   is DEFERRED. Resolution is FK-FIRST, so it self-corrects automatically once the FK
//   populates. A null FK must NEVER silently degrade L2 to not_evaluable here.
//
// PURE. No DB, no I/O. Recomputes no lens — reads the atom the score already produced.

import type { ScoredMetric, PeerStats } from "../metric-scoring/types.js";
import type { FiredFinding } from "../findings/types.js";
import {
  deriveLensTriplet,
  lensPattern,
  lensPillarPattern,
  applyAntiDoubleCount,
  applyAntiDoubleCountPillar,
  STEADY_EQUIVALENT_MIN,
  type MetricLensAtom,
  type LensTriplet,
  type LensPattern,
  type LensPillarPattern,
  type FiredHeadline,
  type PillarShares,
} from "./index.js";

type LensPillar = "foundation" | "momentum";

/** The PG-level peer μ/σ/N capture, keyed for the natural-key fallback. Mirrors the
 *  PeerStatsCapture shape produced by score-pass (subset this adapter consumes). */
export interface LensPeerCapture {
  pillar: LensPillar;
  metricKey: string;
  mean: number;
  stdDev: number;
  sampleN: number;
}

/** One pillar's in-memory scored metrics + its assembled subtotal/state (for the LM8
 *  anti-mask gate + the LP roll-up). */
export interface LensPillarInput {
  pillar: LensPillar;
  metrics: ScoredMetric[];
  subtotal: number | null;
  state: string; // "scored" | "unavailable_redistributed"
}

export interface LensFindingsArgs {
  foundation: LensPillarInput;
  momentum: LensPillarInput;
  /** PG-level peer μ/σ/N — the natural-key fallback source (always resolves). */
  peerStatsCaps: LensPeerCapture[];
  /** The SAME-snapshot already-fired R/P findings (for anti-double-count). */
  headlines: FiredHeadline[];
}

/** Per-fired-loud-pattern audit row (for the Stage-3 proof report). */
export interface LensAuditRow {
  key: string;
  lens: string; // LM3 | LM7 | LP2 | LP5
  scope: "metric" | "pillar";
  pillar: LensPillar;
  metricKey: string | null;
  role: "top_level" | "supporting_detail";
  escalated: boolean; // false ⇒ demoted to supporting-detail (not written as a card)
  defersTo: string | null;
}

export interface LensFindingsResult {
  /** The loud, top-level lens-patterns as findings-stream members (push into m.findings). */
  escalated: FiredFinding[];
  /** Every loud pattern that FIRED (escalated or demoted) — the transparency record. */
  audit: LensAuditRow[];
}

// ── The loud escalation set (databank §5.2). LM4/LP3 elite-field verdicts are QUIET. ──
const LOUD_METRIC = new Set(["LM3", "LM7"]);
const LOUD_PILLAR = new Set(["LP2", "LP5"]);

/** Tone → severity token (read layer sorts critical>high>medium>low). LM7/LP5 carry the
 *  Concern weight; LM3/LP2 the field-caution weight. Descriptive — changes no score. */
function severityFor(id: string): string {
  return id === "LM7" || id === "LP5" ? "high" : "medium";
}

/** FK-FIRST, NATURAL-KEY FALLBACK peer resolution (see file header). FK = the peerStats
 *  the cross-section scorer already attached to this ScoredMetric; fallback = the PG-level
 *  capture by (pillar, metricKey). Never returns null when a capture exists → no null-FK
 *  degradation to not_evaluable. */
function resolvePeer(
  s: ScoredMetric,
  capsByKey: Map<string, LensPeerCapture>,
): PeerStats | { mean: number; stdDev: number; sampleN: number } | null {
  if (s.peerStats) return s.peerStats; // FK-first (self-corrects when the FK populates)
  return capsByKey.get(`${s.pillar}:${s.metricKey}`) ?? null; // natural-key fallback (100%)
}

/** Build the MetricLensAtom from an in-memory ScoredMetric + resolved peer. */
function toAtom(
  s: ScoredMetric,
  pillar: LensPillar,
  peer: { mean: number; stdDev: number; sampleN: number } | null,
): MetricLensAtom {
  return {
    metricKey: s.metricKey,
    pillar,
    scored: s.scoreState === "scored",
    rawValue: s.rawValue ?? 0, // only scored atoms (rawValue non-null) ever fire a pattern
    l1Available: s.l1Available,
    l1Band: s.l1Band ?? null,
    l2Available: s.l2Available,
    l2Score: s.l2Score,
    l2AnchorApplied: s.l2AnchorApplied,
    peerMean: peer ? peer.mean : null,
    peerStdDev: peer ? peer.stdDev : null,
    peerSampleN: peer ? peer.sampleN : null,
    l3Available: s.l3Available,
    l3Score: s.l3Score,
    l3AnchorApplied: s.l3AnchorApplied,
    l3Mean: s.l3Mean,
    l3StdDev: s.l3StdDev,
    l3WindowN: s.l3WindowN,
  };
}

/** A descriptive (NO-FORWARD) verdict sentence for the card. Reads the atom only. */
function metricVerdict(p: LensPattern, atom: MetricLensAtom, t: LensTriplet): string {
  const peer = atom.peerMean !== null ? ` (peer μ ${atom.peerMean.toFixed(2)}, N=${atom.peerSampleN})` : "";
  if (p.id === "LM3")
    return `${atom.metricKey}: below its absolute bar but above the peer field${peer} — the peer group is weak on this metric.`;
  // LM7
  return `${atom.metricKey}: below its bar, below the peer field${peer}, and declining against its own history — weak on all three lenses.`;
}

function pillarVerdict(p: LensPillarPattern, pillar: LensPillar, shares: PillarShares): string {
  const l2 = shares.l2Pass !== null ? `${Math.round(shares.l2Pass * 100)}%` : "—";
  const l3d = shares.l3Declining !== null ? `${Math.round(shares.l3Declining * 100)}%` : "—";
  if (p.id === "LP2")
    return `${pillar}: most metrics trail their bars but beat the field (L2 pass ${l2}) — relative strength is a weak-field artifact.`;
  // LP5
  return `${pillar}: a majority of metrics are declining against their own history (L3 declining ${l3d}) — broad self-deterioration.`;
}

/**
 * Fire the LOUD lens-patterns as findings-stream members for ONE scored member.
 * Returns the escalated FiredFinding[] (push into m.findings BEFORE dampening) plus the
 * full audit of fired-loud patterns (including those demoted to supporting-detail).
 */
export function computeLensFindings(args: LensFindingsArgs): LensFindingsResult {
  const capsByKey = new Map<string, LensPeerCapture>();
  for (const c of args.peerStatsCaps) capsByKey.set(`${c.pillar}:${c.metricKey}`, c);

  const escalated: FiredFinding[] = [];
  const audit: LensAuditRow[] = [];

  for (const pin of [args.foundation, args.momentum]) {
    const pillar = pin.pillar;
    const pillarScored = pin.state === "scored";
    const pillarSubtotal = pin.subtotal;
    const pillarReadsAcceptable =
      pillarScored && pillarSubtotal !== null && pillarSubtotal >= STEADY_EQUIVALENT_MIN;

    // Build atoms for ALL of the pillar's metrics (the LP roll-up filters to scored
    // internally; the per-metric LM fire is gated to scored below).
    const atoms = pin.metrics.map((s) => toAtom(s, pillar, resolvePeer(s, capsByKey)));

    // ── Metric-level LM (LM3 / LM7) ──────────────────────────────────────────────
    for (const atom of atoms) {
      if (!atom.scored) continue;
      const t = deriveLensTriplet(atom);
      const fired = lensPattern(t.l1, t.l2, t.l3, { pillarReadsAcceptable });
      if (!fired || !LOUD_METRIC.has(fired.id)) continue;
      const adc = applyAntiDoubleCount(fired, pillar, args.headlines);
      const key = `lens_${fired.id.toLowerCase()}_${atom.metricKey}`;
      const escalate = adc.role === "top_level";
      audit.push({
        key, lens: fired.id, scope: "metric", pillar, metricKey: atom.metricKey,
        role: adc.role, escalated: escalate, defersTo: adc.defersTo,
      });
      if (!escalate) continue;
      escalated.push({
        kind: "pattern",
        key,
        severity: severityFor(fired.id),
        direction: "negative",
        magnitude: null, // lens-patterns change NO score (databank §6) → no §5E magnitude to halve
        displayState: "active",
        evidence: {
          family: "lens",
          lens: fired.id,
          scope: "metric",
          pillar,
          metricKey: atom.metricKey,
          label: fired.label,
          tone: fired.tone,
          fieldVerdict: fired.fieldVerdict,
          role: adc.role,
          triplet: { l1: t.l1, l2: t.l2, l3: t.l3 },
          peer: atom.peerMean !== null ? { mean: atom.peerMean, stdDev: atom.peerStdDev, sampleN: atom.peerSampleN } : null,
          rawValue: atom.rawValue,
          leg: pillar, // integrates with the leg-keyed read layer (harmless for lens cards)
          verdict: metricVerdict(fired, atom, t),
        },
        metricRefs: [atom.metricKey],
      });
    }

    // ── Pillar-level LP (LP2 / LP5) ──────────────────────────────────────────────
    const { shares, patterns } = lensPillarPattern(atoms);
    for (const lp of patterns) {
      if (!LOUD_PILLAR.has(lp.id)) continue;
      const adc = applyAntiDoubleCountPillar(lp, pillar, args.headlines);
      const key = `lens_${lp.id.toLowerCase()}_${pillar}`;
      const escalate = adc.role === "top_level";
      audit.push({
        key, lens: lp.id, scope: "pillar", pillar, metricKey: null,
        role: adc.role, escalated: escalate, defersTo: adc.defersTo,
      });
      if (!escalate) continue;
      escalated.push({
        kind: "pattern",
        key,
        severity: severityFor(lp.id),
        direction: "negative",
        magnitude: null,
        displayState: "active",
        evidence: {
          family: "lens",
          lens: lp.id,
          scope: "pillar",
          pillar,
          label: lp.label,
          tone: lp.tone,
          fieldVerdict: lp.fieldVerdict,
          role: adc.role,
          shares: {
            l1Pass: shares.l1Pass, l2Pass: shares.l2Pass,
            l3Improving: shares.l3Improving, l3Declining: shares.l3Declining,
            nL1: shares.nL1, nL2: shares.nL2, nL3: shares.nL3,
          },
          leg: pillar,
          verdict: pillarVerdict(lp, pillar, shares),
        },
        metricRefs: [pillar],
      });
    }
  }

  return { escalated, audit };
}
