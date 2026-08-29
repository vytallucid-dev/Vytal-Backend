// ═══════════════════════════════════════════════════════════════
// STAGE 7b — RUN DISCOVERY over the statically-crawlable insurers.
//
//   npx tsx src/scripts/stage7b-discover.ts [SYMBOL,...]
//
// Read-only: fetches four listing pages, writes an INDEX to disk, touches no DB.
// Goes through the IRDAI transport, so 5.2s per-host spacing and the robots
// refusal apply.
//
// The index is the deliverable. Fetching and parsing the PDFs themselves is the
// next step and reuses machinery that already exists (irdai-parse / irdai-forms /
// irdai-units / irdai-ratio-gate / irdai-writer) — so this stops at the point
// where the missing piece ends, and its output is reviewable before anything is
// downloaded in bulk.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { discoverAll } from "../ingestions/quaterly-results/irdai/irdai-discovery.js";

const OUT = "_s7b-index.json";
/** Nothing before this is worth indexing — the plan's target is FY2019 onward. */
const TARGET = "2019-01-01";

async function main(): Promise<void> {
  const only = process.argv[2]?.split(",").map((s) => s.trim().toUpperCase());
  console.log(`\n=== STAGE 7b — DISCOVERY RUN ===\n`);
  const results = await discoverAll(only);

  // What each insurer still needs, so the index can be judged against real demand.
  const need = new Map<string, number>();
  for (const r of await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol,
            (SELECT count(*) FROM life_insurance_quarterly_results q WHERE q.stock_id=s.id) +
            (SELECT count(*) FROM general_insurance_quarterly_results g WHERE g.stock_id=s.id) held
     FROM stocks s WHERE s."industryType"::text IN ('life_insurance','general_insurance')`,
  )) need.set(String(r.symbol), Number(r.held));

  let totalDocs = 0, totalInTarget = 0;
  for (const r of results) {
    const inTarget = r.docs.filter((d) => d.periodEnd >= TARGET);
    totalDocs += r.docs.length;
    totalInTarget += inTarget.length;
    const periods = [...new Set(inTarget.map((d) => d.periodEnd))].sort();
    console.log(`  ${r.symbol.padEnd(12)} HTTP ${String(r.status).padStart(3)}  pdfs=${String(r.totalPdfs).padStart(5)}` +
      `  kept=${String(r.kept).padStart(5)}  classified=${String(r.classified).padStart(5)}` +
      `  in-target=${String(inTarget.length).padStart(5)}`);
    if (r.error) { console.log(`     ERROR: ${r.error}`); continue; }
    console.log(`     distinct periods >= ${TARGET}: ${periods.length}` +
      (periods.length ? `  (${periods[0]} .. ${periods[periods.length - 1]})` : ""));
    const q = inTarget.filter((d) => d.grain === "quarterly").length;
    console.log(`     grain: quarterly ${q} · annual ${inTarget.length - q}` +
      `   basis: standalone ${inTarget.filter((d) => d.basis === "standalone").length} · consolidated ${inTarget.filter((d) => d.basis === "consolidated").length}`);
    console.log(`     quarterly rows already held in DB: ${need.get(r.symbol) ?? "?"}`);
    if (r.unclassified.length) {
      console.log(`     ⚠ kept but unclassified: ${r.unclassified.length} (surfaced, not dropped)`);
      for (const u of r.unclassified.slice(0, 3)) console.log(`        ${u.url.slice(-88)}`);
    }
    for (const d of inTarget.slice(0, 3))
      console.log(`     e.g. ${d.periodEnd} ${d.grain.padEnd(9)} ${d.basis.padEnd(12)} ${d.url.slice(-72)}`);
    console.log("");
  }

  console.log(`  -- TOTALS --`);
  console.log(`  documents indexed        ${totalDocs}`);
  console.log(`  within target (>= ${TARGET})  ${totalInTarget}`);
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), target: TARGET, results }, null, 2));
  console.log(`\n  index -> ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
