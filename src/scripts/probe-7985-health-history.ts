// READ-ONLY probe: does 7985d813's Health (phs 65 vs 64) correlate with the CONSTRUCTION cutover (cv),
// which would be a §13 contamination — or with TIME/scores, which is legitimate history on an
// append-only table? The distinguishing question, and the only one that matters.
import { prisma } from "../db/prisma.js";

async function main() {
  const rows = await prisma.portfolioHealthSnapshot.findMany({
    where: { userId: { startsWith: "7985d813" } }, orderBy: { createdAt: "asc" },
    select: { createdAt: true, constantVersion: true, phs: true, quality: true, signals: true, structure: true, coverage: true, fingerprint: true },
  });
  for (const r of rows) {
    console.log(`${r.createdAt.toISOString()} · cv=${r.constantVersion.padEnd(18)} · phs=${r.phs} · quality=${Number(r.quality).toFixed(4)} · signals=${Number(r.signals).toFixed(4)} · struct=${Number(r.structure).toFixed(2)} · cov=${Number(r.coverage).toFixed(4)} · fp=${r.fingerprint.slice(0, 10)}`);
  }
  // The test: group phs by cv. If phs is a function of cv → contamination. If both cvs carry both phs
  // values (or phs tracks quality/coverage instead) → legitimate drift over time.
  const byCv = new Map<string, Set<number | null>>();
  for (const r of rows) {
    if (!byCv.has(r.constantVersion)) byCv.set(r.constantVersion, new Set());
    byCv.get(r.constantVersion)!.add(r.phs);
  }
  console.log("\nphs values observed PER constant_version:");
  for (const [cv, set] of byCv) console.log(`  cv=${cv} → phs {${[...set].join(", ")}}`);
  const overlap = [...byCv.values()].every((s) => s.has(65)) && [...byCv.values()].some((s) => s.size > 1);
  console.log(`\n  Does phs partition BY cv (⇒ Construction reached Health)? ${overlap ? "NO — both cvs carry the same phs values" : "inspect above"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
