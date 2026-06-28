// ─────────────────────────────────────────────────────────────
// DEGRADED-SNAPSHOT GUARD — Stage 4 (final) of scoring-error detection.
//
// Catches a snapshot that COMMITTED but is degraded in an UNEXPECTED way: a pillar
// dropped (unavailable_redistributed) even though its own inputs would have let the
// engine score it. The composite is then mis-weighted — a real, live distortion (not
// merely old, like a stale snapshot; the score is structurally wrong right now).
//
// ── THE CRUX: unexpected vs the engine's HONEST by-design unavailability ──
// A pillar legitimately drops when its inputs are genuinely insufficient — that must
// NEVER be flagged. The discriminator must encode the engine's OWN drop rule and flag
// ONLY a contradiction of it.
//
// ── SCOPE = MARKET ONLY (the cleanly-computable pillar) ──
// Market is the one pillar whose per-sub-component availability is ALWAYS persisted
// even when the pillar is dropped: CN-6 writes all 7 MarketSubScore rows (available +
// category) on every snapshot. Foundation/Momentum/Ownership write NO leaves when they
// drop (verified: a redistributed Momentum pillar persists 0 MetricScore rows), so
// "some inputs present but pillar dropped" is NOT computable for them from the snapshot
// → DEFERRED (see FLAG). The §14.4 Foundation floor produces NO snapshot at all (anchor
// pillar) → floored stocks are structurally invisible to this snapshot-sweep.
//
// ── THE RULE-AWARE DISCRIMINATOR (Market §14.4c) ──
// assembleMarketUniversal (market-universal.ts:101-146) drops the Market pillar to
// unavailable_redistributed IFF fewer than 2 of the 4 categories (A/B/C/D) survive — a
// category "survives" when ≥1 of its sub-components is available. Therefore:
//   • 0 available subs (VEDL-style) → 0 surviving categories → HONEST. NEVER flag.
//   • subs available in only 1 category → 1 surviving category (<2) → HONEST §14.4c. NEVER flag.
//   • subs available in ≥2 categories, YET pillarState=unavailable_redistributed → the
//     engine's OWN rule says it should have scored → UNEXPECTED (an engine/persistence
//     inconsistency, where the written sub-availability disagrees with the written
//     pillar state) → FLAG. This is a pure internal-consistency check on one snapshot.
// (Note: the naive "≥1 sub available" test is WRONG — it would false-flag the honest
// 1-category §14.4c drop. We count surviving CATEGORIES, matching the engine's rule.)
//
// ── RESOLUTION BRANCH ──
//   • ENGINE MISS (inputs present per the rule, pillar dropped anyway) → resolutionPath
//     = source_code. Market inputs are prices (not admin-fillable), and a sub/state
//     disagreement is a code/persistence concern → surfaced for investigation, the
//     honest label. A later (organic or manual) rescore that produces a consistent
//     snapshot is closed by the self-heal below.
//   • DATA GAP (a fillable raw input missing → pillar dropped) → resolutionPath =
//     admin_fill (fill-then-rescore via the fill bridge). NOT reachable for Market
//     (prices aren't fillable); wired for the DEFERRED Foundation/Momentum case.
//
// PERIODIC sweep (degradation is a state, not an event), self-healing. CN-8 clean.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { reportScoringError } from "../../ingestions/shared/ingestion-error.js";

/** A degraded (unexpectedly dropped) pillar actively distorts the live composite →
 *  HIGH (worse than stale, which is merely old). */
const DEGRADED_SEVERITY = "high" as const;
const DEGRADED_CRON = "scoring:degraded";

export type DegradationCause = "engine_miss" | "data_gap";

export interface MarketDegradationVerdict {
  /** true ⇒ UNEXPECTED degradation (flag); false ⇒ honest or scored (do not flag). */
  flag: boolean;
  survivingCategories: number;
  survivingCategoryKeys: string[];
  availableSubs: string[];
  cause: DegradationCause;
}

interface MarketSub { subComponent: string; category: string; available: boolean }

/**
 * PURE discriminator for the Market pillar. Exported for direct testing.
 * Flags ONLY the rule-contradiction: pillar dropped while ≥2 categories survive.
 */
export function marketDegradationVerdict(pillarState: string, subs: MarketSub[]): MarketDegradationVerdict {
  const availableSubs = subs.filter((s) => s.available);
  const survivingCats = new Set(availableSubs.map((s) => s.category));
  const flag = pillarState === "unavailable_redistributed" && survivingCats.size >= 2;
  return {
    flag,
    survivingCategories: survivingCats.size,
    survivingCategoryKeys: [...survivingCats].sort(),
    availableSubs: availableSubs.map((s) => s.subComponent).sort(),
    // Market inputs are prices (not admin-fillable) + a sub/state disagreement is a
    // code/persistence concern → an engine miss. (data_gap is the deferred-pillar branch.)
    cause: "engine_miss",
  };
}

/** Map a degradation cause → the resolution path that gates the UI. */
function resolutionFor(cause: DegradationCause): { resolutionPath: "source_code" | "admin_fill"; recomputeAction: string } {
  return cause === "data_gap"
    ? { resolutionPath: "admin_fill", recomputeAction: "fill_then_rescore" }
    : { resolutionPath: "source_code", recomputeAction: "source_code" };
}

export interface DegradedSweepResult {
  scanned: number;
  degraded: number;
  healed: number;
  honestSkipped: number; // redistributed Market pillars correctly NOT flagged (VEDL-style / <2 cats)
}

interface SnapMin {
  id: string; stockId: string; symbol: string; createdAt: Date;
  marketPillar: { pillarState: string; marketSubScores: MarketSub[] };
}

/**
 * Periodic degraded-snapshot sweep (Market sub-case). Best-effort — never throws.
 * Opens a scoring_degraded row for an unexpectedly-dropped Market pillar; self-heals
 * (auto:degraded-heal) an open row whose in-force snapshot is no longer degraded.
 */
export async function sweepDegradedSnapshots(): Promise<DegradedSweepResult> {
  const result: DegradedSweepResult = { scanned: 0, degraded: 0, healed: 0, honestSkipped: 0 };
  try {
    const snaps = await prisma.scoreSnapshot.findMany({
      orderBy: [{ stockId: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, stockId: true, symbol: true, createdAt: true,
        marketPillar: { select: { pillarState: true, marketSubScores: { select: { subComponent: true, category: true, available: true } } } },
      },
    });
    const inForce = new Map<string, SnapMin>();
    for (const s of snaps) if (!inForce.has(s.stockId)) inForce.set(s.stockId, s as SnapMin);
    result.scanned = inForce.size;
    if (inForce.size === 0) return result;

    // Open scoring_degraded rows keyed by (symbol|pillar) — to self-heal.
    const openRows = await prisma.ingestionError.findMany({
      where: { source: "scoring", guardType: "scoring_degraded", status: "open" },
      select: { id: true, targetEntity: true, targetField: true },
    });
    const openByKey = new Map(openRows.map((r) => [`${r.targetEntity ?? ""}|${r.targetField ?? ""}`, r.id]));

    for (const s of inForce.values()) {
      const verdict = marketDegradationVerdict(s.marketPillar.pillarState, s.marketPillar.marketSubScores);
      const key = `${s.symbol}|market`;

      if (verdict.flag) {
        result.degraded++;
        const { resolutionPath, recomputeAction } = resolutionFor(verdict.cause);
        const id = await reportScoringError({
          failureType: "degraded",
          cron: DEGRADED_CRON,
          symbol: s.symbol,
          targetField: "market", // dedup per (stock, pillar)
          periodKey: null,
          severity: DEGRADED_SEVERITY,
          recomputeAction,
          resolutionPath,
          snapshotId: s.id,
          expected: `${s.symbol} Market pillar scores (≥2 of 4 categories have inputs)`,
          observed: `Market pillar unavailable_redistributed despite ${verdict.survivingCategories} categories present (${verdict.survivingCategoryKeys.join("/")}; subs ${verdict.availableSubs.join(",")})`,
          detail: `UNEXPECTED degradation: the engine's §14.4c rule scores Market when ≥2 categories survive, yet this snapshot dropped the pillar with ${verdict.survivingCategories} surviving. The persisted sub-availability disagrees with the persisted pillar state → an engine/persistence anomaly (cause=${verdict.cause}). A rescore may resolve a transient inconsistency; if it recurs it is a code-level bug.`,
          degradationDetail: {
            pillar: "market",
            cause: verdict.cause,
            survivingCategories: verdict.survivingCategories,
            survivingCategoryKeys: verdict.survivingCategoryKeys,
            availableSubs: verdict.availableSubs,
          },
        });
        if (id) {
          // de-dupe self-heal bookkeeping: this key is now (re)opened, not a heal target.
          openByKey.delete(key);
        }
      } else if (openByKey.has(key)) {
        // No longer degraded (Market now scored, or honestly dropped) → self-heal.
        await prisma.ingestionError.update({
          where: { id: openByKey.get(key)! },
          data: { status: "resolved", resolvedBy: "auto:degraded-heal", resolvedAt: new Date(), resolutionNote: `Market pillar no longer unexpectedly dropped (snapshot ${s.id.slice(0, 8)})` },
        });
        openByKey.delete(key);
        result.healed++;
      } else if (s.marketPillar.pillarState === "unavailable_redistributed") {
        // Redistributed but HONEST (<2 categories survive) — explicitly NOT flagged.
        result.honestSkipped++;
      }
    }
    return result;
  } catch (err) {
    console.error("[degraded-snapshot-guard] sweepDegradedSnapshots error:", err);
    return result;
  }
}
