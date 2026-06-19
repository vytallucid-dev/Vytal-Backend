// STAGE 3 — score PG5 + PG6 end-to-end DRY (no commit) through the universal machinery
// against the committed banking bars. Reports the 4 pillar subtotals, composite, band,
// and unavailables per bank. Confirms PG6 inherits PG5 bars.
//   npx tsx src/scripts/bank-stage3-dry-score.ts

import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { resolveBarPath } from "../scoring/metric-scoring/bars.js";
import { prisma } from "../db/prisma.js";

const PG5: PgRef = { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" };
const PG6: PgRef = { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" };

// The bar-derivation cohort for PG5 (the 12-bank set's 6 private banks, incl FEDERALBNK).
const PG5_COHORT = ["HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK", "FEDERALBNK"];

const f1 = (v: number | null | undefined) => v === null || v === undefined ? "  —  " : v.toFixed(1).padStart(5);

function reportPg(title: string, pg: Awaited<ReturnType<typeof computePgScores>>) {
  console.log(`\n══ ${title}  (industry=${pg.industry}, period=${pg.periodKey}, ${pg.members.length} banks) ══`);
  console.log(`  ${"BANK".padEnd(12)} ${"Found".padStart(6)} ${"Mom".padStart(6)} ${"Mkt".padStart(6)} ${"Own".padStart(6)} ${"COMP".padStart(6)}  ${"BAND".padEnd(11)} notes`);
  for (const m of [...pg.members].sort((a, b) => (b.composite.composite ?? -1) - (a.composite.composite ?? -1))) {
    const f = m.fPillar, mo = m.mPillar;
    const notes: string[] = [];
    if (f.droppedCount) notes.push(`F:${f.droppedCount}drop`);
    if (f.neutralHeldCount) notes.push(`F:${f.neutralHeldCount}neu60`);
    if (mo.droppedCount) notes.push(`M:${mo.droppedCount}drop`);
    if (m.market?.state !== "scored") notes.push(`Mkt:${m.market?.state ?? "none"}`);
    if (m.composite.state !== "scored") notes.push(`COMP:${m.composite.state}`);
    const mktSub = m.market?.state === "scored" ? m.market.subtotal : null;
    console.log(`  ${m.symbol.padEnd(12)} ${f1(f.subtotal)} ${f1(mo.subtotal)} ${f1(mktSub)} ${f1(m.own?.finalOwnership)} ${f1(m.composite.composite)}  ${(m.composite.labelBand ?? "—").padEnd(11)} ${notes.join(" ")}`);
  }
  // §5.8 / dropped-metric detail
  console.log("  ── metric dispositions (dropped / neutral-60) ──");
  for (const m of pg.members) {
    const drops = [...m.fMetrics, ...m.mMetrics].filter((x) => x.scoreState === "missing_renorm" || x.scoreState === "neutral_hold");
    if (drops.length) console.log(`    ${m.symbol.padEnd(12)} ${drops.map((d) => `${d.metricKey}:${d.scoreState}`).join(", ")}`);
  }
}

console.log("\n═══ STAGE 3 — DRY PG5/PG6 SCORES (no commit) ═══");

// PG6 bar inheritance proof
console.log(`\nBar resolution: PG6 → ${resolveBarPath("PG6")} (inheritance ${resolveBarPath("PG6") === "PG5" ? "CONFIRMED" : "BROKEN"}); PG5 → ${resolveBarPath("PG5")}`);

// PG5 as-is (DB roster: incl IDFCFIRSTB + YESBANK, no FEDERALBNK)
const pg5AsIs = await computePgScores(PG5);
reportPg("PG5 — DB ROSTER AS-IS (incl IDFCFIRSTB+YESBANK; FEDERAL absent)", pg5AsIs);

// PG5 reconciled cohort (the bar-derivation 6 private banks incl FEDERALBNK)
const pg5Cohort = await computePgScores(PG5, { rosterOverride: PG5_COHORT });
reportPg("PG5 — BAR-COHORT (override: 6 private banks incl FEDERALBNK)", pg5Cohort);

// PG6 (DB roster matches the 6 PSU banks)
const pg6 = await computePgScores(PG6);
reportPg("PG6 — PSU BANKS (DB roster = bar cohort)", pg6);

await prisma.$disconnect();
