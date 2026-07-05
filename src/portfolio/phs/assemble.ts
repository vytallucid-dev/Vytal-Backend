// ─────────────────────────────────────────────────────────────────────────────
// PHS ASSEMBLE — resolve a user's book into the engine's input (A.3 Stage 0).
// Per holding, attach: market_value (qty × current price), mcap tier (frozen
// snapshot), sector, health (latest ScoreSnapshot.composite IF scored), and the
// fired findings Signals consumes. PHS READS these — it never recomputes a score
// or re-fires a finding.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import type { PhsHolding, McapTier, FindingKind } from "./engine.js";
import type { PhsProvenance } from "./persist.js";

/** RedFlag.severity (free text) → the Signals headline class it maps to. */
function severityToFinding(sev: string | null): FindingKind | null {
  switch ((sev ?? "").toLowerCase()) {
    case "critical": return "critical";
    case "high": return "high";
    case "medium": return "medium";
    default: return null; // low / null → not a Signals deduction
  }
}

export async function assemblePortfolio(userId: string): Promise<{ holdings: PhsHolding[]; prov: PhsProvenance; fieldWeakSymbols: Set<string> }> {
  const rows = await prisma.holding.findMany({
    where: { userId, quantity: { gt: 0 } },
    include: { stock: { select: { id: true, symbol: true, sector: { select: { name: true } } } } },
  });

  const holdings: PhsHolding[] = [];
  const healthSnapshotIds: string[] = [];
  const findingIds: string[] = [];
  const fieldWeakSymbols = new Set<string>(); // LM3/LP2 — for PX5 ONLY, NEVER a deduction
  let tierAsOfDate = "none";

  for (const h of rows) {
    const stockId = h.stock.id;
    const [price, tierRow, score] = await Promise.all([
      prisma.stockPrice.findUnique({ where: { stockId }, select: { price: true } }),
      prisma.marketCapTierSnapshot.findFirst({ where: { stockId }, orderBy: { asOfDate: "desc" }, select: { tier: true, asOfDate: true } }),
      prisma.scoreSnapshot.findFirst({ where: { stockId }, orderBy: [{ asOfDate: "desc" }, { version: "desc" }], select: { id: true, composite: true, labelBand: true } }),
    ]);

    const marketValue = price ? Number(h.quantity) * Number(price.price) : 0;
    const tier: McapTier = (tierRow?.tier as McapTier | undefined) ?? "unknown";
    if (tierRow) {
      const d = tierRow.asOfDate.toISOString().slice(0, 10);
      if (d > tierAsOfDate) tierAsOfDate = d;
    }

    // Scored ⇔ a health snapshot exists. health = composite.
    const health = score ? Number(score.composite) : null;
    const findings: FindingKind[] = [];
    if (score) {
      healthSnapshotIds.push(score.id);
      const flags = await prisma.redFlag.findMany({ where: { snapshotId: score.id }, select: { id: true, severity: true } });
      for (const f of flags) {
        findingIds.push(f.id);
        const k = severityToFinding(f.severity);
        if (k) findings.push(k);
      }
      // Distress band → distress headline. The stock engine's lowest band ("fragile")
      // is the distress-equivalent. Headline-wins in the engine dedupes it against any
      // Critical flag on the same name (single-largest), so no double-count.
      if (score.labelBand === "fragile") findings.push("distress");
      // LP5/LP6 (breadth patterns) + LM3/LP2 (field-weak verdicts) from the LIVE
      // lens-pattern store (score_patterns.pattern_key). Only genuinely-fired patterns
      // (not pending_data_integration). LP5/LP6 → Signals deductions; LM3/LP2 → PX5
      // context ONLY (field-verdict lock: they NEVER deduct, never a negative finding).
      const patterns = await prisma.scorePattern.findMany({
        where: { snapshotId: score.id, displayState: { not: "pending_data_integration" } },
        select: { id: true, patternKey: true },
      });
      for (const p of patterns) {
        if (p.patternKey === "LP5") { findings.push("lp5"); findingIds.push(p.id); }
        else if (p.patternKey === "LP6") { findings.push("lp6"); findingIds.push(p.id); }
        else if (p.patternKey === "LM3" || p.patternKey === "LP2") { fieldWeakSymbols.add(h.stock.symbol); findingIds.push(p.id); }
      }
    }

    holdings.push({ symbol: h.stock.symbol, marketValue, tier, sector: h.stock.sector?.name ?? null, health, findings });
  }

  return { holdings, prov: { healthSnapshotIds, findingIds, tierAsOfDate, sectorVersion: "nse-sector-v1" }, fieldWeakSymbols };
}
