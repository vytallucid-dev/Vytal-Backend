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
import { Prisma } from "../../generated/prisma/client.js"; // DbNull sentinel for the nullable Json column
import { BAND_MAPPING_VERSION } from "./label.js";
import type { CompositeResult, Pillar } from "./types.js";

/** The spec every composite is stamped with. Re-exported from scoring/v2/spec.ts rather than
 *  declared, so there is exactly one place the version can be changed and no way for the
 *  fallback in assembleComposite to disagree with what a pass actually computed. */
export { SCORING_SPEC_VERSION as COMPOSITE_SPEC_VERSION } from "../v2/spec.js";
import { SCORING_SPEC_VERSION } from "../v2/spec.js";
const COMPOSITE_SPEC_VERSION = SCORING_SPEC_VERSION;
const d4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The three witness columns, as the row mapper needs them. score-pass.ts's `FindingsEvaluation`
 *  extends this with the fields only the ASSERTION reads (which version was evaluated), keeping the
 *  row mapper free of any dependency on the findings engine. */
export interface SnapshotFindingsEval {
  evaluatedAt: Date;
  firedCount: number;
  notCoveredCount: number;
}

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
    // ★ from the RESULT, not the module constant. Moving the spec version is what makes a
    //   v2 rebuild supersede an existing v1 head instead of skip-identical against it.
    spec: r.specVersion,
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
  ctx: {
    runId: string; specVersionId: string; bandMappingVersionId: string; peerGroupId: string;
    barPath: string; industryPath: string; pillarScoreIds: Record<Pillar, string>;
    maskHeat?: string | null; pgTrailingMovePct?: number | null;
    /** §Phase 2 — the declined checks for this member. `undefined` ⇒ the collector did not run, and the
     *  column is written NULL ("we don't know what declined"). An empty array ⇒ everything was
     *  evaluable, written as []. The two are NOT interchangeable and are never normalised together. */
    notEvaluable?: { ruleRef: string; reason: string }[];
    /** Did Layer-1 (the guardrail gate) RUN for this snapshot? `undefined` ⇒ the caller
     *  did not record the fact and the column is written NULL ("we don't know"), which
     *  is NOT the same as false ("deliberately not screened"). true with zero guardrail
     *  events means "screened, nothing fired" — the distinction presence-of-events
     *  cannot express. Never normalise the three states together. */
    guardrailScreened?: boolean;
    /** ★ THE FINDINGS-EVALUATION WITNESS. The stamp score-pass.ts's findings hook attached to the
     *  member being persisted, proving the §2/§5 rule set + not-covered engine ran against THIS
     *  composite. REQUIRED for a durable write — score_snapshots_findings_evaluated_ck rejects the
     *  INSERT without it — and deliberately typed optional here ONLY so the dry-run planner below
     *  (which writes nothing and has no member to evaluate) can still shape a row for display. */
    findingsEval?: SnapshotFindingsEval;
  },
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
    // §Phase 2. Deliberately NOT `?? []` — undefined must persist as SQL NULL (unknown), never as an
    // empty array (a positive all-clear the collector never asserted). Prisma requires its DbNull
    // sentinel for a nullable Json column; a bare JS `null` would be rejected by the client types.
    notEvaluable: ctx.notEvaluable === undefined ? Prisma.DbNull : (ctx.notEvaluable as Prisma.InputJsonValue),
    // Layer-1 provenance. Same honest-null discipline as notEvaluable above: undefined
    // persists as SQL NULL ("we don't know whether this was screened"), never as false
    // ("we know it wasn't"). A nullable Boolean takes a bare null, unlike Json.
    guardrailScreened: ctx.guardrailScreened === undefined ? null : ctx.guardrailScreened,
    // ── ★ THE FINDINGS-EVALUATION WITNESS ────────────────────────────────────────────────────────
    // A snapshot version and the evaluation of its findings are ONE fact, so they are ONE INSERT.
    // Counting score_patterns afterwards cannot substitute: zero rows is ambiguous between "the
    // rules ran and nothing fired" and "the rules never ran against this version", and it is the
    // second that renders as a blank card claiming the model found nothing.
    //
    // Absent ⇒ NULL, and the NOT VALID check constraint refuses the row. That is the intended
    // outcome: an un-evaluated snapshot must fail loudly, never commit quietly. Only the dry-run
    // planner reaches here without a stamp, and it writes nothing.
    findingsEvaluatedAt: ctx.findingsEval?.evaluatedAt ?? null,
    findingsFiredCount: ctx.findingsEval?.firedCount ?? null,
    notCoveredCount: ctx.findingsEval?.notCoveredCount ?? null,
  };
}

// ★ `toR1RedFlagRow` IS GONE (step 4). It built the deferred Ownership R1 row for score_red_flags,
// which score-pass.ts wrote immediately after creating a snapshot — and which was the entire reason a
// pledging fact could only exist for a stock that had been scored. R1 is a registered filing rule now
// and writes to stock_findings for all 504 stocks; its three downstream consumers (alerts, the alert
// vocabulary, and the portfolio's PS1) read that table. Nothing writes score_red_flags any more.
//
// Deleted rather than left unused on purpose: a function that constructs a red-flag row, kept beside
// a persist path that no longer has one, is the shape of thing that gets called again by accident.

export interface CompositeWritePlan {
  symbol: string;
  stockId: string;
  periodKey: string;
  state: "scored" | "unavailable";
  action: "would_create" | "would_skip_identical" | "no_snapshot_composite_unavailable";
  inputsFingerprint: string | null;
  snapshotRow: ReturnType<typeof toScoreSnapshotRow> | null;
  /** The Ownership pillar OBSERVED an R1 breach on this member. No row is written from here — the
   *  finding is the filing pass's (stock_findings). */
  r1: { observed: boolean; flagKey: string } | null;
  notes: string[];
}

/**
 * PLAN the snapshot write for one composite. READ-ONLY — this function writes nothing.
 *
 * ★ IT USED TO HAVE A REAL-WRITE BRANCH, AND THAT BRANCH IS GONE ON PURPOSE.
 *
 * It was the SECOND `scoreSnapshot.create` in the codebase, and it could not satisfy the
 * snapshot-has-findings invariant: it takes a bare CompositeResult, which carries no evaluated
 * findings and no member context from which to evaluate them, so every row it committed was an
 * un-evaluated head by construction. It was also never supersede-aware (it looked up version:1 and
 * created a version-1 row without chaining version/supersedesId), so committing a CHANGED composite
 * through it would collide on @@unique([…,version]) anyway.
 *
 * Its only caller has always passed dryRun:true (scripts/composite-check.ts), so deleting the branch
 * removes a live-write capability nothing used, and leaves persistMember() in score-pass.ts as the
 * SINGLE place a ScoreSnapshot row is created. That singularity is what makes the invariant
 * enforceable: one statement to guard, not a set that grows.
 *
 * `ctx.dryRun` is retained and asserted rather than dropped, so an existing caller that passes
 * dryRun:false gets a clear error instead of silently believing it committed.
 */
export async function writeComposite(r: CompositeResult, ctx: CompositeWriteContext): Promise<CompositeWritePlan> {
  if (!ctx.dryRun) {
    throw new Error(
      "writeComposite: PLAN-ONLY. Its real-write branch was removed — it could not evaluate findings " +
      "for the row it created, so it could only ever produce un-evaluated heads. The single snapshot " +
      "write path is persistMember() in score-pass.ts; route commits through a scoring pass.",
    );
  }
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

  // ── PLAN (the only mode) ──
  {
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
    // ★ R1 NO LONGER PRODUCES A ROW HERE (step 4). The pillar still OBSERVES the breach and records
    // it on OwnershipScore; the finding itself belongs to stock_findings, written by the filing pass
    // for all 504 stocks. The planner reports the observation without promising a write it will not do.
    if (r1Fired) notes.push("Ownership R1 breach OBSERVED on this member — recorded on OwnershipScore; the FINDING is written by the filing pass to stock_findings, not here");
    return {
      symbol: r.symbol, stockId: r.stockId, periodKey: r.periodKey, state: "scored",
      action: existingSnap ? (identical ? "would_skip_identical" : "would_create") : "would_create",
      inputsFingerprint: fingerprint, snapshotRow,
      r1: r1Fired ? { observed: true, flagKey: "ownership_R1_pledge" } : null,
      notes,
    };
  }
}
