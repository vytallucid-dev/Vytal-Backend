// File: src/scoring/ownership/persist.ts
//
// OWNERSHIP PRIMARY — the WRITE PATH. The first real score write; exercises the
// schema for the Ownership leg end-to-end:
//
//   ScoringRun → PillarScore(ownership) → OwnershipScore
//
// SCOPE (per the build decision — "stay inside the fence"):
//   • We DO write ScoringRun + PillarScore(ownership) + OwnershipScore.
//   • We do NOT write a ScoreSnapshot. The composite row requires all four pillar
//     FKs NOT NULL (foundation/momentum/market/ownership) + composite + band-
//     mapping; three of those pillars are out of scope ("do NOT touch any other
//     pillar"). So the snapshot leg is DEFERRED to the composite build.
//   • Because a RedFlag row needs snapshot_id (NOT NULL → a ScoreSnapshot), the R1
//     red-flag ROW is likewise DEFERRED. R1 is still COMPUTED and surfaced (here as
//     `deferredRedFlags`) — only its persistence waits. See FLAGS in the writeup.
//
// APPEND-ONLY + SKIP-IDENTICAL (ruling 1 / ruling 2): a PillarScore is inserted
// only when (stockId, pillar=ownership, inputsFingerprint) does not already exist.
// Identical inputs → same fingerprint → @@unique blocks a duplicate (a no-op skip).
// A genuine input change → new fingerprint → a new version row. Nothing is updated.
//
// Leaves hang off the PILLAR (OwnershipScore.pillarScoreId), reused with it — NOT
// off the snapshot — so Pillar + OwnershipScore are fully writable without a snapshot.

import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import type { PrimaryOwnershipResult } from "./primary.js";
import type { OwnershipResult } from "./ownership.js";
import type { FlowCategoryResult } from "./flow.js";
import { FLOW_BAND_VERSION, type TrendState } from "./flow-bands.js";

/** The §-numbered methodology version this engine implements. First write →
 * get-or-created. Folded (as a STRING, not the row uuid) into the fingerprint so
 * a methodology bump yields new PillarScore versions while the fingerprint stays
 * reproducible across runs. */
export const OWNERSHIP_SPEC_VERSION = "2026.1";
const OWNERSHIP_SPEC_NOTES =
  "Ownership PRIMARY layer (baseline + pledging ladder + R2/R6/prolonged-FII disturbances). " +
  "Flow Adjustment [-12,+12] and the final 40–100 clamp are a later build.";

export interface OwnershipWriteOptions {
  asOfDate: Date;
  /** true = compute + return the plan, mutate NOTHING (reads allowed). */
  dryRun: boolean;
  /** Attach to an existing run; otherwise one is get-or-created (real mode). */
  runId?: string;
  triggerType?: "scheduled" | "post_ingest" | "manual_api";
  runType?: "quarterly" | "live";
}

export interface OwnershipWritePlan {
  symbol: string;
  stockId: string;
  periodKey: string;
  specVersion: string;
  specVersionId: string | null; // null in dry-run when it would be created
  runId: string | null;
  inputsFingerprint: string;
  action: "created" | "skipped_identical" | "would_create" | "would_skip_identical";
  pillarScore: {
    pillar: "ownership";
    subtotal: number;
    pillarState: "scored";
    sourcePeriod: string;
    asOfDate: string;
  };
  ownershipScore: {
    baseline: number;
    baselineReason: PrimaryOwnershipResult["baseline"]["reason"];
    pledgingAdjustment: number;
    penaltyR2: number;
    penaltyR6: number;
    penaltyProlongedFii: number;
    primarySubtotal: number;
    flowAdjustmentRaw: number; // 0 — Flow not yet computed
    flowAdjustmentClamped: number; // 0
    finalOwnership: number; // = primarySubtotal (pre-clamp; Flow + clamp pending)
  };
  deferredRedFlags: { flagKey: string; severity: string; reasons: string[] }[];
  notes: string[];
}

/** Fold the spec version STRING into the engine's data fingerprint → the
 * PillarScore identity used by @@unique (ruling-2 skip-identical). */
function makeInputsFingerprint(dataFingerprint: string): string {
  return createHash("sha256")
    .update(`${dataFingerprint}:${OWNERSHIP_SPEC_VERSION}`)
    .digest("hex");
}

/**
 * Persist (or, in dry-run, PLAN) the Primary Ownership write for one stock.
 *
 * @param stock  { id, symbol } — id is the FK; symbol is denormalised onto rows
 * @param result the pure-engine decomposition
 * @param opts   write options (incl. dryRun)
 */
export async function writeOwnershipPrimary(
  stock: { id: string; symbol: string },
  result: PrimaryOwnershipResult,
  opts: OwnershipWriteOptions,
): Promise<OwnershipWritePlan> {
  const notes: string[] = [];
  const inputsFingerprint = makeInputsFingerprint(result.dataFingerprint);
  const asOfStr = opts.asOfDate.toISOString().slice(0, 10);

  // finalOwnership currently holds the PRE-CLAMP, Primary-only value (Flow = 0,
  // no 40–100 clamp). The ABSENCE of any OwnershipFlowCategory rows is itself the
  // "flow not computed" marker (dormant ≠ zero: we write no flow rows at all).
  const ownershipScore = {
    baseline: result.baseline.baseline,
    baselineReason: result.baseline.reason,
    pledgingAdjustment: result.pledging.ladderAdjustment,
    penaltyR2: result.r2.penalty,
    penaltyR6: result.r6.penalty,
    penaltyProlongedFii: result.prolongedFii.penalty,
    primarySubtotal: result.primarySubtotal,
    flowAdjustmentRaw: 0,
    flowAdjustmentClamped: 0,
    finalOwnership: result.primarySubtotal,
  };
  const pillarScore = {
    pillar: "ownership" as const,
    subtotal: result.primarySubtotal,
    pillarState: "scored" as const,
    sourcePeriod: result.snapshot.periodKey,
    asOfDate: asOfStr,
  };
  const deferredRedFlags = result.redFlags.map((f) => ({
    flagKey: f.flagKey,
    severity: f.severity,
    reasons: f.reasons,
  }));
  if (deferredRedFlags.length > 0) {
    notes.push(
      `${deferredRedFlags.length} red flag(s) DETECTED but row write DEFERRED ` +
        `(needs a ScoreSnapshot → out-of-scope pillars): ${deferredRedFlags.map((f) => f.flagKey).join(", ")}`,
    );
  }

  // ── Resolve spec version (read; create only in real mode) ──────────────────
  const existingSpec = await prisma.scoringSpecVersion.findFirst({
    where: { version: OWNERSHIP_SPEC_VERSION },
    select: { id: true },
  });

  // ── Skip-identical check (read — safe in dry-run) ──────────────────────────
  const existingPillar = await prisma.pillarScore.findUnique({
    where: {
      score_pillar_input_identity: {
        stockId: stock.id,
        pillar: "ownership",
        inputsFingerprint,
      },
    },
    select: { id: true },
  });

  const base: Omit<OwnershipWritePlan, "action" | "specVersionId" | "runId"> = {
    symbol: stock.symbol,
    stockId: stock.id,
    periodKey: result.snapshot.periodKey,
    specVersion: OWNERSHIP_SPEC_VERSION,
    inputsFingerprint,
    pillarScore,
    ownershipScore,
    deferredRedFlags,
    notes,
  };

  // ── DRY-RUN: plan only, mutate nothing ─────────────────────────────────────
  if (opts.dryRun) {
    if (!existingSpec) notes.push(`would get-or-create ScoringSpecVersion '${OWNERSHIP_SPEC_VERSION}'`);
    notes.push(opts.runId ? `would attach to run ${opts.runId}` : "would get-or-create a ScoringRun");
    return {
      ...base,
      specVersionId: existingSpec?.id ?? null,
      runId: opts.runId ?? null,
      action: existingPillar ? "would_skip_identical" : "would_create",
    };
  }

  // ── REAL WRITE ─────────────────────────────────────────────────────────────
  if (existingPillar) {
    return {
      ...base,
      specVersionId: existingSpec?.id ?? null,
      runId: opts.runId ?? null,
      action: "skipped_identical",
    };
  }

  const written = await prisma.$transaction(async (tx) => {
    // get-or-create spec version (first write)
    const spec =
      existingSpec ??
      (await tx.scoringSpecVersion.create({
        data: {
          version: OWNERSHIP_SPEC_VERSION,
          effectiveFrom: opts.asOfDate,
          notes: OWNERSHIP_SPEC_NOTES,
        },
        select: { id: true },
      }));

    // get-or-create the run
    let runId = opts.runId;
    if (!runId) {
      const run = await tx.scoringRun.create({
        data: {
          runType: opts.runType ?? "quarterly",
          triggerType: opts.triggerType ?? "manual_api",
          specVersionId: spec.id,
          asOfDate: opts.asOfDate,
          status: "running",
          startedAt: opts.asOfDate,
        },
        select: { id: true },
      });
      runId = run.id;
    }

    // PillarScore + nested OwnershipScore (1:1). Append-only insert.
    const pillar = await tx.pillarScore.create({
      data: {
        stockId: stock.id,
        symbol: stock.symbol,
        pillar: "ownership",
        subtotal: pillarScore.subtotal,
        pillarState: "scored",
        sourcePeriod: pillarScore.sourcePeriod,
        asOfDate: opts.asOfDate,
        runId,
        specVersionId: spec.id,
        inputsFingerprint,
        ownershipScore: { create: ownershipScore },
      },
      select: { id: true },
    });

    return { specVersionId: spec.id, runId, pillarId: pillar.id };
  });

  notes.push(`wrote PillarScore ${written.pillarId} + OwnershipScore (run ${written.runId})`);
  return {
    ...base,
    specVersionId: written.specVersionId,
    runId: written.runId,
    action: "created",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FULL OWNERSHIP PILLAR WRITE PATH (Primary + Flow + clamp).
//   ScoringRun → PillarScore(subtotal = FINAL clamped Ownership) → OwnershipScore
//   (Primary terms + R1 firing record + Flow rollup) → 4 OwnershipFlowCategory rows
//   → universal OwnershipFlowBandSet rows (C3 / D / trend) get-or-created.
//
// Still DRY-RUN per the standing gate (the first COMMITTED write waits for a
// complete four-pillar snapshot). The score_red_flags ROW for R1 stays deferred
// (needs a snapshot); R1's FIRING is recorded on OwnershipScore (r1Fired +
// r1TriggeringValues) so that row is reconstructable from stored facts.
// ════════════════════════════════════════════════════════════════════════════

const OWNERSHIP_FULL_SPEC_NOTES =
  "Ownership pillar COMPLETE: Primary subtotal + Flow A/B/C/D + clamp(40,100). " +
  "A,B live; C,D dormant_no_feed. Universal flow band sets (NOT per-PG).";

export interface FlowCategoryPlan {
  category: FlowCategoryResult["category"];
  state: FlowCategoryResult["state"];
  firedRule: string | null;
  rawSubScore: number;
  capApplied: number; // cappedSubScore − rawSubScore (the cap adjustment, signed)
  cappedSubScore: number;
  bandLanded: string | null;
  netFlowValue: number | null;
  trendState: TrendState | null; // stored directly as FlowTrendState schema enum
}

export interface OwnershipFullWritePlan {
  symbol: string;
  stockId: string;
  periodKey: string;
  specVersion: string;
  specVersionId: string | null;
  runId: string | null;
  inputsFingerprint: string;
  action: "created" | "skipped_identical" | "would_create" | "would_skip_identical";
  pillarSubtotal: number; // = finalOwnership (the real clamped pillar value)
  ownershipScore: {
    baseline: number;
    baselineReason: PrimaryOwnershipResult["baseline"]["reason"];
    pledgingAdjustment: number;
    penaltyR2: number;
    penaltyR6: number;
    penaltyProlongedFii: number;
    primarySubtotal: number;
    flowAdjustmentRaw: number;
    flowAdjustmentClamped: number;
    finalOwnership: number;
    r1Fired: boolean;
    r1TriggeringValues: Record<string, unknown> | null;
  };
  flowCategories: FlowCategoryPlan[];
  bandSetsNeeded: string[];
  notes: string[];
}

/** Fingerprint over shareholding-data hash + spec version + a deterministic flow
 * summary, so any flow-affecting input change → new PillarScore version. */
export function fullInputsFingerprint(result: OwnershipResult): string {
  const flow = (["A", "B", "C", "D"] as const).map((k) => {
    const c = result.flow[k];
    return { k, s: c.state, v: c.cappedSubScore, r: c.firedRule, b: c.bandLanded, n: c.netFlowValue, t: c.trendState };
  });
  const payload = JSON.stringify({
    data: result.primary.dataFingerprint,
    spec: OWNERSHIP_SPEC_VERSION,
    flow,
    fac: result.flowAdjustmentClamped,
    fin: result.finalOwnership,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function toFlowPlan(c: FlowCategoryResult): FlowCategoryPlan {
  return {
    category: c.category,
    state: c.state,
    firedRule: c.firedRule,
    rawSubScore: c.rawSubScore,
    capApplied: c.cappedSubScore - c.rawSubScore,
    cappedSubScore: c.cappedSubScore,
    bandLanded: c.bandLanded,
    netFlowValue: c.netFlowValue,
    trendState: c.trendState,
  };
}

/** Which universal flow band set a category references (A/B use explicit rule
 * points → none; C/D use the universal banded cuts). */
export function bandTypeFor(cat: FlowCategoryResult["category"]): "c_net_insider" | "d_net_block" | null {
  if (cat === "C_insider") return "c_net_insider";
  if (cat === "D_block") return "d_net_block";
  return null;
}

/** The universal (NOT per-PG) flow band-set cuts, by band type. Single-sourced so
 *  the standalone writer and the scoring-pass orchestrator get-or-create identically. */
export const FLOW_BAND_CUTS: Record<"c_net_insider" | "d_net_block" | "trend_bonus", unknown> = {
  c_net_insider: { unit: "inr_cr_net_30d", pairs: [{ gt: 3, points: 3 }, { gt: 1, points: 2 }, { gte: -1, points: 0 }, { gte: -3, points: -2 }, { else: true, points: -4 }] },
  d_net_block: { unit: "pct_of_mcap_net_30d", pairs: [{ gt: 0.5, points: 6 }, { gt: 0.1, points: 3 }, { gte: -0.1, points: 0 }, { gte: -0.5, points: -3 }, { else: true, points: -6 }] },
  trend_bonus: { unit: "trend_90d", pairs: [{ state: "three_up", points: 2 }, { state: "three_down", points: -2 }, { state: "mixed_or_neutral", points: 0 }] },
};

/** Pure builder: the OwnershipScore data (Primary terms + Flow rollup + R1 firing
 *  record) from an OwnershipResult. Single-sourced by writeOwnershipFull and the
 *  scoring-pass orchestrator so the row shape cannot drift. */
export function buildOwnershipScoreData(result: OwnershipResult) {
  const p = result.primary;
  const r1 = p.redFlags.find((f) => f.flagKey === "ownership_R1_pledge");
  const r1Fired = !!r1;
  const r1TriggeringValues = r1 ? { ...r1.triggeringValues, breaches: r1.reasons } : null;
  return {
    r1Fired,
    r1TriggeringValues,
    ownershipScore: {
      baseline: p.baseline.baseline,
      baselineReason: p.baseline.reason,
      pledgingAdjustment: p.pledging.ladderAdjustment,
      penaltyR2: p.r2.penalty,
      penaltyR6: p.r6.penalty,
      penaltyProlongedFii: p.prolongedFii.penalty,
      primarySubtotal: p.primarySubtotal,
      flowAdjustmentRaw: result.flowAdjustmentRaw,
      flowAdjustmentClamped: result.flowAdjustmentClamped,
      finalOwnership: result.finalOwnership,
      r1Fired,
      r1TriggeringValues,
    },
  };
}

/** Pure builder: the 4 OwnershipFlowCategory create rows (flowBandSetId resolved by
 *  the caller from the get-or-created band sets). */
export function buildFlowCategoryRows(result: OwnershipResult) {
  return [result.flow.A, result.flow.B, result.flow.C, result.flow.D].map((c) => ({
    category: c.category,
    rawSubScore: c.rawSubScore,
    capApplied: c.cappedSubScore - c.rawSubScore,
    cappedSubScore: c.cappedSubScore,
    categoryState: c.state,
    bandLanded: c.bandLanded,
    netFlowValue: c.netFlowValue,
    trendState: c.trendState,
    bandType: bandTypeFor(c.category),
  }));
}

export async function writeOwnershipFull(
  stock: { id: string; symbol: string },
  result: OwnershipResult,
  opts: OwnershipWriteOptions,
): Promise<OwnershipFullWritePlan> {
  const notes: string[] = [];
  const p = result.primary;
  const inputsFingerprint = fullInputsFingerprint(result);

  // R1 firing record (red-flag ROW deferred; firing recorded here for reconstructability).
  const r1 = p.redFlags.find((f) => f.flagKey === "ownership_R1_pledge");
  const r1Fired = !!r1;
  const r1TriggeringValues = r1 ? { ...r1.triggeringValues, breaches: r1.reasons } : null;

  const ownershipScore = {
    baseline: p.baseline.baseline,
    baselineReason: p.baseline.reason,
    pledgingAdjustment: p.pledging.ladderAdjustment,
    penaltyR2: p.r2.penalty,
    penaltyR6: p.r6.penalty,
    penaltyProlongedFii: p.prolongedFii.penalty,
    primarySubtotal: p.primarySubtotal,
    flowAdjustmentRaw: result.flowAdjustmentRaw,
    flowAdjustmentClamped: result.flowAdjustmentClamped,
    finalOwnership: result.finalOwnership,
    r1Fired,
    r1TriggeringValues,
  };

  const flowCategories = [result.flow.A, result.flow.B, result.flow.C, result.flow.D].map(toFlowPlan);
  const bandSetsNeeded = [
    `c_net_insider v${FLOW_BAND_VERSION}`,
    `d_net_block v${FLOW_BAND_VERSION}`,
    `trend_bonus v${FLOW_BAND_VERSION}`,
  ];

  if (r1Fired) {
    notes.push(
      "R1 firing RECORDED on OwnershipScore (r1Fired + r1TriggeringValues); score_red_flags ROW still deferred (needs a ScoreSnapshot)",
    );
  }
  const dormant = flowCategories.filter((c) => c.state !== "scored").map((c) => `${c.category}:${c.state}`);
  if (dormant.length) notes.push(`dormant flow categories (0 contribution, state recorded): ${dormant.join(", ")}`);

  const existingSpec = await prisma.scoringSpecVersion.findFirst({
    where: { version: OWNERSHIP_SPEC_VERSION },
    select: { id: true },
  });
  const existingPillar = await prisma.pillarScore.findUnique({
    where: { score_pillar_input_identity: { stockId: stock.id, pillar: "ownership", inputsFingerprint } },
    select: { id: true },
  });

  const base: Omit<OwnershipFullWritePlan, "action" | "specVersionId" | "runId"> = {
    symbol: stock.symbol,
    stockId: stock.id,
    periodKey: p.snapshot.periodKey,
    specVersion: OWNERSHIP_SPEC_VERSION,
    inputsFingerprint,
    pillarSubtotal: result.finalOwnership,
    ownershipScore,
    flowCategories,
    bandSetsNeeded,
    notes,
  };

  // ── DRY-RUN: plan only, mutate nothing ─────────────────────────────────────
  if (opts.dryRun) {
    if (!existingSpec) notes.push(`would get-or-create ScoringSpecVersion '${OWNERSHIP_SPEC_VERSION}'`);
    notes.push(opts.runId ? `would attach to run ${opts.runId}` : "would get-or-create a ScoringRun");
    notes.push(`would get-or-create universal flow band sets: ${bandSetsNeeded.join(", ")}`);
    return {
      ...base,
      specVersionId: existingSpec?.id ?? null,
      runId: opts.runId ?? null,
      action: existingPillar ? "would_skip_identical" : "would_create",
    };
  }

  // ── REAL WRITE ─────────────────────────────────────────────────────────────
  if (existingPillar) {
    return { ...base, specVersionId: existingSpec?.id ?? null, runId: opts.runId ?? null, action: "skipped_identical" };
  }

  const written = await prisma.$transaction(async (tx) => {
    const spec =
      existingSpec ??
      (await tx.scoringSpecVersion.create({
        data: { version: OWNERSHIP_SPEC_VERSION, effectiveFrom: opts.asOfDate, notes: OWNERSHIP_FULL_SPEC_NOTES },
        select: { id: true },
      }));

    let runId = opts.runId;
    if (!runId) {
      const run = await tx.scoringRun.create({
        data: {
          runType: opts.runType ?? "quarterly",
          triggerType: opts.triggerType ?? "manual_api",
          specVersionId: spec.id,
          asOfDate: opts.asOfDate,
          status: "running",
          startedAt: opts.asOfDate,
        },
        select: { id: true },
      });
      runId = run.id;
    }

    // get-or-create the universal (NOT per-PG) flow band sets.
    const bandSetIds: Record<string, string> = {};
    const cutsByType: Record<string, unknown> = {
      c_net_insider: { unit: "inr_cr_net_30d", pairs: [{ gt: 3, points: 3 }, { gt: 1, points: 2 }, { gte: -1, points: 0 }, { gte: -3, points: -2 }, { else: true, points: -4 }] },
      d_net_block: { unit: "pct_of_mcap_net_30d", pairs: [{ gt: 0.5, points: 6 }, { gt: 0.1, points: 3 }, { gte: -0.1, points: 0 }, { gte: -0.5, points: -3 }, { else: true, points: -6 }] },
      trend_bonus: { unit: "trend_90d", pairs: [{ state: "three_up", points: 2 }, { state: "three_down", points: -2 }, { state: "mixed_or_neutral", points: 0 }] },
    };
    for (const bt of ["c_net_insider", "d_net_block", "trend_bonus"] as const) {
      const existing = await tx.ownershipFlowBandSet.findUnique({
        where: { bandType_version: { bandType: bt, version: FLOW_BAND_VERSION } },
        select: { id: true },
      });
      const row =
        existing ??
        (await tx.ownershipFlowBandSet.create({
          data: { bandType: bt, version: FLOW_BAND_VERSION, cuts: cutsByType[bt] as object, inForceFrom: opts.asOfDate, specVersionId: spec.id },
          select: { id: true },
        }));
      bandSetIds[bt] = row.id;
    }

    const pillar = await tx.pillarScore.create({
      data: {
        stockId: stock.id,
        symbol: stock.symbol,
        pillar: "ownership",
        subtotal: result.finalOwnership, // FINAL clamped value (flow applied)
        pillarState: "scored",
        sourcePeriod: p.snapshot.periodKey,
        asOfDate: opts.asOfDate,
        runId,
        specVersionId: spec.id,
        inputsFingerprint,
        ownershipScore: {
          create: {
            ...ownershipScore,
            r1TriggeringValues: (r1TriggeringValues ?? undefined) as object | undefined,
            flowCategories: {
              create: flowCategories.map((c) => {
                const bt = bandTypeFor(c.category);
                return {
                  category: c.category,
                  rawSubScore: c.rawSubScore,
                  capApplied: c.capApplied,
                  cappedSubScore: c.cappedSubScore,
                  categoryState: c.state,
                  bandLanded: c.bandLanded,
                  netFlowValue: c.netFlowValue,
                  trendState: c.trendState,
                  flowBandSetId: bt ? bandSetIds[bt] : null,
                };
              }),
            },
          },
        },
      },
      select: { id: true },
    });

    return { specVersionId: spec.id, runId, pillarId: pillar.id };
  });

  notes.push(`wrote PillarScore ${written.pillarId} + OwnershipScore + 4 flow categories (run ${written.runId})`);
  return { ...base, specVersionId: written.specVersionId, runId: written.runId, action: "created" };
}
