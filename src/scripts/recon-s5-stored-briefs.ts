// Stage 5 recon — the ~900 already-stored THIN briefs. Two questions, both empirical:
//   1. Does the fingerprint MOVE under the new manifest? (⇒ would they regenerate if asked?)
//   2. What ASKS them to? (⇒ would they actually regenerate, or sit stale?)
import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { fingerprintOf } from "../insight/quarter-brief/write.js";

async function main() {
  const all = await prisma.quarterBrief.findMany({
    select: { fiscalYear: true, quarter: true, status: true, factsFingerprint: true, content: true, generatedAt: true, stock: { select: { symbol: true, industryType: true } } },
    orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
  });
  console.log(`stored briefs: ${all.length}`);
  const byStatus = new Map<string, number>();
  for (const b of all) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
  console.log("by status: " + [...byStatus].map(([k, v]) => `${k}=${v}`).join(", "));

  const lens = all.map((b) => b.content.length).sort((a, b) => a - b);
  console.log(`content length: min=${lens[0]} p50=${lens[Math.floor(lens.length / 2)]} max=${lens[lens.length - 1]}`);
  console.log(`content that parses as JSON today: ${all.filter((b) => { try { JSON.parse(b.content); return true; } catch { return false; } }).length}`);

  // A stratified sample — one per family per fiscal year, capped, so this stays a probe not a batch.
  const seen = new Set<string>();
  const sample = all.filter((b) => {
    const k = `${b.stock.industryType}|${b.fiscalYear}${b.quarter}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 24);

  let moved = 0;
  let same = 0;
  let gone = 0;
  for (const b of sample) {
    const block = await buildQuarterBriefFactBlock(b.stock.symbol, `${b.fiscalYear}${b.quarter}`);
    if (!block) { gone++; console.log(`  ? ${b.stock.symbol} ${b.fiscalYear}${b.quarter} — fact block no longer builds`); continue; }
    const fp = fingerprintOf(renderFactText(block));
    if (fp === b.factsFingerprint) { same++; console.log(`  = ${b.stock.symbol} ${b.fiscalYear}${b.quarter} — UNCHANGED (${fp.slice(0, 12)})`); }
    else moved++;
  }
  console.log(`\nsampled ${sample.length}: fingerprint MOVED on ${moved}, unchanged on ${same}, no block on ${gone}`);
}
main().then(() => prisma.$disconnect());
