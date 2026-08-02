// File: src/scoring/read/tool-scan.service.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TOOL SCAN — ONE SOURCE. The divergence and trajectory landings read the PERSISTED FINDINGS.
//
// ── ★ WHAT THIS REPLACES, AND WHY IT WAS WRONG ────────────────────────────────────────────────────
// The tools used to RECOMPUTE their own patterns — twice each (server-side for the landing,
// client-side for the single view) — over a vocabulary that matched no finding key:
//     wide | notable | none          vs  the D-family keys
//     value | price_ahead | ownership | mixed
// Nothing reconciled the two. A stock could read "wide · price_ahead" on the tool, carry
// divergence_D1 on its stock page, and appear under a third label on the Hub — three surfaces
// disagreeing about one company in one session.
//
// Worse, the recomputation had its own thresholds (15 / 25). Phase 2 moved the material cut to 12, so
// the tools were silently stating a number the engine no longer used, and the tool copy said
// "Two pillars ≥ 25 pts apart" on screen while the engine fired at 12.
//
// ── ★ THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────────────────────────
// A tool renders findings. A tool never decides whether a pattern is true. The only arithmetic
// permitted here is RANKING (which fired finding leads) and S1 (a tool STATE, not a pattern — and
// computed in exactly one place, findings/divergence/aligned.ts).
//
// ── SEPARATION IS BY FAMILY, NOT BY LIST ──────────────────────────────────────────────────────────
// catalogue/tool-families.ts owns the mapping (divergence → C · trajectory → B/D). A new pattern
// reaches its tool by being named correctly, and cannot reach the wrong one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { getUniverseRows, type LeanSnap } from "./universe-rows.cache.js";
import { renderVerdict } from "../findings/verdicts.js";
import { alignedState, S1_NAME, S1_VERDICT, S1_DESCRIPTION, type AlignedState } from "../findings/divergence/aligned.js";
import { dropRetiredPatterns } from "../../catalogue/retired-findings.js";
import { forTool, type ToolId } from "../../catalogue/tool-families.js";
import { findingName, findingDescription, doesntMean } from "../../catalogue/index.js";
import type { SectorRef } from "./stocks-list.types.js";
import type { LabelBand } from "./health-view.types.js";

/** One fired finding, resolved for display. Every string comes from the catalogue or the verdict
 *  layer — the tool authors none of it, which is what stops the copy going stale again. */
export interface ToolFinding {
  key: string;
  name: string;
  description: string;
  doesntMean: string;
  /** The evidence-bound sentence. Already regime-resolved by the verdict layer. */
  verdict: string;
  severity: string | null;
  direction: string | null;
  /** The finding's own evidence — carries gapPp, the regime stamp, tier flags, caveats. Surfaces
   *  read NUMBERS from here rather than from prose. */
  evidence: unknown;
}

export interface ToolScanItem {
  symbol: string;
  name: string;
  sector: SectorRef | null;
  composite: number;
  band: LabelBand;
  periodKey: string;
  /** The fired findings for THIS tool, ranked per the tool's own rule (see below). */
  findings: ToolFinding[];
  /** ★ DIVERGENCE ONLY. The calm-state reading — present when the stock is aligned. Never a finding.
   *  Null on the trajectory tool, and null on divergence when the stock has a live divergence. */
  aligned: AlignedState | null;
  /** Spec copy for the aligned state, carried so no surface re-types it. Null unless `aligned`. */
  alignedCopy: { name: string; description: string; verdict: string } | null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const sectorRef = (s: { name: string; displayName: string } | null): SectorRef | null =>
  s ? { key: s.name, displayName: s.displayName } : null;

/** Newest in-force snapshot per stock. */
function headOf(rows: LeanSnap[]): LeanSnap | null {
  if (!rows.length) return null;
  const inForce = new Map<string, LeanSnap>();
  for (const r of rows) {
    const cur = inForce.get(r.periodKey);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.asOfDate > cur.asOfDate)) {
      inForce.set(r.periodKey, r);
    }
  }
  let head: LeanSnap | null = null;
  for (const r of inForce.values()) {
    if (!head || r.asOfDate > head.asOfDate || (r.asOfDate.getTime() === head.asOfDate.getTime() && r.periodKey > head.periodKey)) {
      head = r;
    }
  }
  return head;
}

/** A pillar's subtotal ONLY when it was genuinely scored (applied weight > 0). An
 *  `unavailable_redistributed` pillar carries an inert 0 that is not a score. */
const scored = (v: number, w: number): number | null => (w > 0 ? v : null);

// ── RANKING · THE TWO TOOLS ARE DELIBERATELY OPPOSITE ─────────────────────────────────────────────
//
// ★ DIVERGENCE RANKS BY GAP SIZE. Spec §1.2: "Severity is the size of the gap, not a separate
//   calculation" — 12–15 material · 16–24 stretched · 25+ extreme. A wider divergence genuinely IS a
//   stronger reading, so the widest tension leads.
//
// ★ TRAJECTORY MUST NOT RANK BY MOVE SIZE. Spec §1.3 measured the OPPOSITE: a 1–3pt Foundation gain
//   drifted +1.9% (64% positive); a 15+ point gain did nothing; a 15+ point Momentum gain reacted
//   NEGATIVELY (−1.1%, 31% positive). "Never scale a trajectory badge by the size of the move, and
//   never imply a 20-point jump is a bigger signal than a 3-point one."
//   ⚠ NOR IS IT INVERTED. The evidence supports NOT ranking by size — it does not support
//   "smaller is stronger". So trajectory ranks by SEVERITY (a per-pattern constant, set from each
//   pattern's own measured strength) and then alphabetically. No delta enters the comparator.
//
// ⚠ THE ASYMMETRY IS INTENTIONAL AND IS DOCUMENTED ON BOTH SIDES. Anyone who notices that one tool
//   sorts by magnitude and the other does not, and "harmonises" them, will invert one of the two
//   measured findings. Phase 3 enforced this backend-side via trajectorySeverity()'s arity; this is
//   the same law at the ranking layer.

const SEVERITY_RANK: Readonly<Record<string, number>> = {
  critical: 0, red: 1, high: 2, amber: 3, recovery: 4, green: 5, medium: 6, low: 7,
};
const sevRank = (s: string | null): number => SEVERITY_RANK[(s ?? "").toLowerCase()] ?? 9;

/** The largest |gapPp| a stock's divergence findings carry — the tension the landing ranks on. */
function maxGap(findings: ToolFinding[]): number {
  let g = 0;
  for (const f of findings) {
    const ev = f.evidence as { gapPp?: unknown } | null;
    const v = ev && typeof ev.gapPp === "number" ? Math.abs(ev.gapPp) : 0;
    if (v > g) g = v;
  }
  return g;
}

/**
 * The scan for one tool. Reads persisted findings on each stock's head snapshot, filters to the
 * tool's families, resolves copy from the catalogue, and ranks per the tool's own rule.
 */
export async function buildToolScan(tool: ToolId): Promise<ToolScanItem[]> {
  const { stocks, byStock } = await getUniverseRows();

  const heads = new Map<string, LeanSnap>();
  for (const st of stocks) {
    const h = headOf(byStock.get(st.id) ?? []);
    if (h) heads.set(st.id, h);
  }
  const headIds = [...heads.values()].map((h) => h.id);
  const patterns = headIds.length
    ? await prisma.scorePattern.findMany({
        where: { snapshotId: { in: headIds } },
        select: { snapshotId: true, patternKey: true, severity: true, direction: true, evidence: true },
      })
    : [];

  // ★ Retirement suppression, then tool separation. Both by predicate, neither by list.
  const bySnap = new Map<string, typeof patterns>();
  for (const p of dropRetiredPatterns(patterns)) {
    const arr = bySnap.get(p.snapshotId) ?? [];
    arr.push(p);
    bySnap.set(p.snapshotId, arr);
  }

  const items: ToolScanItem[] = [];
  for (const st of stocks) {
    const head = heads.get(st.id);
    if (!head) continue;

    const mine = forTool(bySnap.get(head.id) ?? [], tool, (p) => p.patternKey);
    const findings: ToolFinding[] = mine
      .map((p) => ({
        key: p.patternKey,
        name: findingName(p.patternKey),
        description: findingDescription(p.patternKey) ?? "",
        doesntMean: doesntMean(p.patternKey),
        verdict: renderVerdict(p.patternKey, p.evidence ?? null),
        severity: p.severity,
        direction: p.direction,
        evidence: p.evidence ?? null,
      }))
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.key.localeCompare(b.key));

    // ── S1 · the divergence tool's calm state. Computed in ONE place (aligned.ts) and only when
    //    no divergence fired — a stock cannot be both aligned and diverged (see aligned.ts).
    let aligned: AlignedState | null = null;
    if (tool === "divergence" && findings.length === 0) {
      const st1 = alignedState({
        foundation: scored(head.foundation, head.wFoundation),
        momentum: scored(head.momentum, head.wMomentum),
        market: scored(head.market, head.wMarket),
        ownership: scored(head.ownership, head.wOwnership),
      });
      if (st1.aligned) aligned = st1;
    }

    items.push({
      symbol: st.symbol,
      name: st.name,
      sector: sectorRef(st.sector),
      composite: round2(head.composite),
      band: head.labelBand,
      periodKey: head.periodKey,
      findings,
      aligned,
      alignedCopy: aligned ? { name: S1_NAME, description: S1_DESCRIPTION, verdict: S1_VERDICT } : null,
    });
  }

  if (tool === "divergence") {
    // Widest tension first (§1.2 — severity IS the gap).
    items.sort(
      (a, b) =>
        (b.findings.length ? 1 : 0) - (a.findings.length ? 1 : 0) ||
        maxGap(b.findings) - maxGap(a.findings) ||
        a.symbol.localeCompare(b.symbol),
    );
  } else {
    // ⚠ NO |delta| TERM. See the ranking note above — R1 forbids it, and inverting it is equally
    //   unsupported. Severity is a per-pattern constant; it cannot encode move size.
    items.sort(
      (a, b) =>
        (b.findings.length ? 1 : 0) - (a.findings.length ? 1 : 0) ||
        sevRank(a.findings[0]?.severity ?? null) - sevRank(b.findings[0]?.severity ?? null) ||
        a.symbol.localeCompare(b.symbol),
    );
  }

  return items;
}
