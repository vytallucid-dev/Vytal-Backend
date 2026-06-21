// File: src/scoring/composite/persist.ts
//
// COMPOSITE WRITE PATH — assembles the complete ScoreSnapshot now that all four
// pillars exist (the constraint that deferred R1 and the first write). Builds the
// full chain and, in real mode, commits it in ONE transaction:
//
//   ScoringRun → ScoreSnapshot(→ 4 PillarScore FKs) → R1 RedFlag (if fired)
//
// The four PillarScores + their children are OWNED and written by their own layers
// (ownership/persist.ts writes Ownership; the Foundation/Momentum/Market layers
// provide row mappers) — the orchestrator resolves the four pillarScoreIds and
// passes them here. The snapshot + the deferred Ownership R1 red flag are THIS
// layer's responsibility.
//
// DRY-RUN GATE: with dryRun=true (the standing gate until Phase-6 real bars), this
// PLANS everything and mutates NOTHING. Flip dryRun=false and the same path commits.

import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { bandMappingJson, BAND_MAPPING_VERSION } from "./label.js";
import type { CompositeResult, Pillar } from "./types.js";

export const COMPOSITE_SPEC_VERSION = "2026.1";
const d4 = (x: number) => Math.round(x * 1e4) / 1e4;

export interface CompositeWriteContext {
  peerGroupId: string;
  barPath: string;
  industryPath: string; // "non_financial" | "banking"
  asOfDate: Date;
  dryRun: boolean;
  /** Attach to an existing run; otherwise one is get-or-created (real mode). */
  runId?: string;
  /** Resolved PillarScore FKs (real mode). null entries ⇒ a dry-run plan. */
  pillarScoreIds: Record<Pillar, string | null>;
  /** Ownership R1 firing — the deferred red flag, now writable (a snapshot exists). */
  r1?: { fired: boolean; triggeringValues: Record<string, unknown> | null } | null;
}

/** Deterministic snapshot identity (skip-identical / ruling-3). Hash over the four
 *  pillar subtotals + states + applied weights + composite + periodKey + versions. */
export function snapshotInputsFingerprint(r: CompositeResult): string {
  const payload = {
    stockId: r.stockId,
    periodKey: r.periodKey,
    snapshotType: r.snapshotType,
    spec: COMPOSITE_SPEC_VERSION,
    bandMapping: BAND_MAPPING_VERSION,
    composite: r.composite === null ? null : Number(r.composite.toFixed(4)),
    reason: r.redistributionReason,
    pillars: [...r.pillars]
      .sort((a, b) => a.pillar.localeCompare(b.pillar))
      .map((p) => ({ k: p.pillar, s: p.state, v: p.subtotal === null ? null : Number(p.subtotal.toFixed(4)), w: Number(r.appliedWeights[p.pillar].toFixed(6)), sp: p.sourcePeriod })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** score_snapshots row. ONLY valid for a SCORED composite — an unavailable
 *  composite writes NO snapshot (never a fabricated number). Inert 0 subtotal /
 *  0 weight for an unavailable pillar; pillarState on each PillarScore carries the
 *  truth. Requires the four pillar FKs resolved (asserted in real mode). */
export function toScoreSnapshotRow(
  r: CompositeResult,
  ctx: { runId: string; specVersionId: string; bandMappingVersionId: string; peerGroupId: string; barPath: string; industryPath: string; pillarScoreIds: Record<Pillar, string>; maskHeat?: string | null; pgTrailingMovePct?: number | null },
) {
  if (r.state !== "scored" || r.composite === null || r.labelBand === null) throw new Error("toScoreSnapshotRow: composite is unavailable — no snapshot row is written");
  const sub = (p: Pillar) => {
    const pi = r.pillars.find((x) => x.pillar === p)!;
    return pi.subtotal === null ? 0 : d4(pi.subtotal);
  };
  return {
    stockId: r.stockId,
    symbol: r.symbol,
    snapshotType: r.snapshotType,
    periodKey: r.periodKey,
    asOfDate: r.asOfDate,
    runId: ctx.runId,
    specVersionId: ctx.specVersionId,
    version: 1,
    supersedesId: null as string | null,
    peerGroupId: ctx.peerGroupId,
    barPath: ctx.barPath,
    industryPath: ctx.industryPath,
    composite: d4(r.composite),
    labelBand: r.labelBand, // narrowed non-null by the guard above
    bandMappingVersionId: ctx.bandMappingVersionId,
    foundationPillarId: ctx.pillarScoreIds.foundation,
    momentumPillarId: ctx.pillarScoreIds.momentum,
    marketPillarId: ctx.pillarScoreIds.market,
    ownershipPillarId: ctx.pillarScoreIds.ownership,
    foundationSubtotal: sub("foundation"),
    momentumSubtotal: sub("momentum"),
    marketSubtotal: sub("market"),
    ownershipSubtotal: sub("ownership"),
    wFoundation: d4(r.appliedWeights.foundation),
    wMomentum: d4(r.appliedWeights.momentum),
    wMarket: d4(r.appliedWeights.market),
    wOwnership: d4(r.appliedWeights.ownership),
    weightRedistributionReason: r.redistributionReason,
    divergence: r.divergence === null ? 0 : d4(r.divergence),
    // Pond mask (File 1 §5) — PG-level heat inherited by this member; null when not established.
    maskHeat: ctx.maskHeat ?? null,
    pgTrailingMovePct: ctx.pgTrailingMovePct == null ? null : d4(ctx.pgTrailingMovePct),
    inputsFingerprint: snapshotInputsFingerprint(r),
  };
}

/** The deferred Ownership R1 red flag — writable once a snapshot exists. */
export function toR1RedFlagRow(
  snapshotId: string,
  r: CompositeResult,
  r1Triggering: Record<string, unknown> | null,
) {
  return {
    snapshotId,
    symbol: r.symbol,
    asOfDate: r.asOfDate,
    flagKey: "ownership_R1_pledge",
    // File 1 §5A: red flags are severity "Critical" (Watch With Care). The column is a
    // free String? (no enum) — was "high" (under-severe vs spec); corrected to "critical".
    severity: "critical",
    tier: "auto" as const,
    triggeringValues: (r1Triggering ?? undefined) as object | undefined,
    guardrailEventId: null as string | null,
  };
}

export interface CompositeWritePlan {
  symbol: string;
  stockId: string;
  periodKey: string;
  state: "scored" | "unavailable";
  action: "created" | "skipped_identical" | "would_create" | "would_skip_identical" | "no_snapshot_composite_unavailable";
  inputsFingerprint: string | null;
  snapshotRow: ReturnType<typeof toScoreSnapshotRow> | null;
  r1: { willWrite: boolean; deferred: boolean; flagKey: string } | null;
  notes: string[];
}

/**
 * Plan (dry-run) or commit (real) the snapshot write for one composite.
 *
 * ⚠ The LIVE commit path is persistMember() in score-pass.ts, NOT this. writeComposite
 * is used ONLY by the dry-run diagnostic scripts/composite-check.ts (dryRun:true). Its
 * real-write branch below is NOT supersede-aware (it looks up version:1 and creates a
 * version-1 row without chaining version/supersedesId), so committing a CHANGED
 * composite through here would collide on @@unique([…,version]). Do NOT wire this into
 * a live path without porting persistMember's live-version chaining first.
 */
export async function writeComposite(r: CompositeResult, ctx: CompositeWriteContext): Promise<CompositeWritePlan> {
  const notes: string[] = [];

  // Unavailable composite → NO snapshot. Recorded, never fabricated.
  if (r.state !== "scored" || r.composite === null) {
    notes.push(`composite UNAVAILABLE (${r.unavailableReason}) → no ScoreSnapshot written`);
    return { symbol: r.symbol, stockId: r.stockId, periodKey: r.periodKey, state: "unavailable", action: "no_snapshot_composite_unavailable", inputsFingerprint: null, snapshotRow: null, r1: null, notes };
  }

  const fingerprint = snapshotInputsFingerprint(r);
  const r1Fired = !!ctx.r1?.fired;

  // Resolve existing references (reads — safe in dry-run).
  const existingSpec = await prisma.scoringSpecVersion.findFirst({ where: { version: COMPOSITE_SPEC_VERSION }, select: { id: true } });
  const existingMapping = await prisma.bandMappingVersion.findFirst({ where: { version: BAND_MAPPING_VERSION }, select: { id: true } });
  const existingSnap = await prisma.scoreSnapshot.findUnique({
    where: { stockId_snapshotType_periodKey_version: { stockId: r.stockId, snapshotType: r.snapshotType, periodKey: r.periodKey, version: 1 } },
    select: { id: true, inputsFingerprint: true },
  });
  const identical = existingSnap?.inputsFingerprint === fingerprint;

  // ── DRY-RUN: plan only ──
  if (ctx.dryRun) {
    const snapshotRow = toScoreSnapshotRow(r, {
      runId: ctx.runId ?? "(dry-run run)",
      specVersionId: existingSpec?.id ?? "(would create spec)",
      bandMappingVersionId: existingMapping?.id ?? "(would create band-mapping)",
      peerGroupId: ctx.peerGroupId,
      barPath: ctx.barPath,
      industryPath: ctx.industryPath,
      pillarScoreIds: {
        foundation: ctx.pillarScoreIds.foundation ?? "(foundation pillar fk)",
        momentum: ctx.pillarScoreIds.momentum ?? "(momentum pillar fk)",
        market: ctx.pillarScoreIds.market ?? "(market pillar fk)",
        ownership: ctx.pillarScoreIds.ownership ?? "(ownership pillar fk)",
      },
    });
    if (!existingSpec) notes.push(`would get-or-create ScoringSpecVersion '${COMPOSITE_SPEC_VERSION}'`);
    if (!existingMapping) notes.push(`would get-or-create BandMappingVersion '${BAND_MAPPING_VERSION}'`);
    notes.push(ctx.runId ? `would attach to run ${ctx.runId}` : "would get-or-create a ScoringRun");
    notes.push("would reference 4 PillarScore FKs (written by their own layers): foundation, momentum, market, ownership");
    if (r1Fired) notes.push("Ownership R1 red flag DEFERRED-BUT-READY: would write score_red_flags row referencing the new snapshot");
    return {
      symbol: r.symbol, stockId: r.stockId, periodKey: r.periodKey, state: "scored",
      action: existingSnap ? (identical ? "would_skip_identical" : "would_create") : "would_create",
      inputsFingerprint: fingerprint, snapshotRow,
      r1: r1Fired ? { willWrite: true, deferred: true, flagKey: "ownership_R1_pledge" } : null,
      notes,
    };
  }

  // ── REAL WRITE ──
  if (existingSnap && identical) {
    notes.push("snapshot with identical fingerprint exists → skip");
    return { symbol: r.symbol, stockId: r.stockId, periodKey: r.periodKey, state: "scored", action: "skipped_identical", inputsFingerprint: fingerprint, snapshotRow: null, r1: null, notes };
  }

  // Real mode requires resolved pillar FKs.
  for (const p of ["foundation", "momentum", "market", "ownership"] as Pillar[]) {
    if (!ctx.pillarScoreIds[p]) throw new Error(`writeComposite: pillar FK '${p}' unresolved — pillar layers must write their PillarScore first`);
  }

  const written = await prisma.$transaction(async (tx) => {
    const spec = existingSpec ?? (await tx.scoringSpecVersion.create({ data: { version: COMPOSITE_SPEC_VERSION, effectiveFrom: ctx.asOfDate, notes: "Composite + 4-pillar snapshot assembly." }, select: { id: true } }));
    const mapping = existingMapping ?? (await tx.bandMappingVersion.create({ data: { version: BAND_MAPPING_VERSION, mapping: bandMappingJson(), effectiveFrom: ctx.asOfDate }, select: { id: true } }));
    let runId = ctx.runId;
    if (!runId) {
      const run = await tx.scoringRun.create({ data: { runType: r.snapshotType, triggerType: "manual_api", specVersionId: spec.id, asOfDate: ctx.asOfDate, status: "running", startedAt: ctx.asOfDate }, select: { id: true } });
      runId = run.id;
    }
    const row = toScoreSnapshotRow(r, {
      runId, specVersionId: spec.id, bandMappingVersionId: mapping.id,
      peerGroupId: ctx.peerGroupId, barPath: ctx.barPath, industryPath: ctx.industryPath,
      pillarScoreIds: ctx.pillarScoreIds as Record<Pillar, string>,
    });
    const snap = await tx.scoreSnapshot.create({ data: row, select: { id: true } });
    if (r1Fired) {
      await tx.redFlag.create({ data: toR1RedFlagRow(snap.id, r, ctx.r1?.triggeringValues ?? null) });
    }
    return { snapshotId: snap.id, runId };
  });

  notes.push(`wrote ScoreSnapshot ${written.snapshotId} (run ${written.runId})${r1Fired ? " + R1 red flag" : ""}`);
  return { symbol: r.symbol, stockId: r.stockId, periodKey: r.periodKey, state: "scored", action: "created", inputsFingerprint: fingerprint, snapshotRow: null, r1: r1Fired ? { willWrite: true, deferred: false, flagKey: "ownership_R1_pledge" } : null, notes };
}
