// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 4 · RECON B (read-only). The two questions recon A did not answer:
//
//   §8  WHAT FILTERING WOULD DO TO THE SCORE-POPULATION AGGREGATES. Those surfaces serve the score
//       channel and NOT the filing channel, so a filing key removed there does not reappear anywhere —
//       it disappears from both, which is the case the step-4 prompt says to stop on. Measured, not
//       asserted: universe pathology census, the pond list's fires-a-flag boolean, the screener's
//       redFlags=any/none filter.
//   §9  THE ALERT-WIDENING NUMBER. `reading.scored` blocks finding alerts on unscored stocks. What
//       would open if it did not: how many of the 504 carry a NEWLY-STANDING filing finding today,
//       which is the filing channel's exact analogue of "on the latest snapshot, not on the prior one".
//
//   npx tsx src/scripts/filing-step4-recon-b.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { buildUniverseHealthView } from "../scoring/read/universe-view.service.js";

const FILING_KEYS = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey));
const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  console.log("════════ STEP 4 · RECON B ════════\n");

  // ── §8 · the score-population aggregates ──
  console.log("── §8 · what filtering would cost the score-population aggregates ──");
  const u = await buildUniverseHealthView();
  const census = u.pathology;
  console.log(`  universe: ${u.scoredUniverseSize} scored members`);
  console.log(`  pathology census: ${census.length} rows (${census.filter((r) => r.kind === "red_flag").length} red-flag, ${census.filter((r) => r.kind === "pattern").length} pattern)`);
  const drop = census.filter((r) => FILING_KEYS.has(r.key));
  console.log(`    rows that are FILING keys — these VANISH, replaced by nothing: ${drop.length} of ${census.length}`);
  for (const r of census) console.log(`      ${r.kind === "red_flag" ? "RF" : "PT"} ${pad(r.key, 44)} N=${r.memberCount}/${r.outOf} ${pad(r.reach, 11)} filingKey=${FILING_KEYS.has(r.key)}`);
  const firesAny = u.members.filter((m) => m.firedFlags.length > 0);
  console.log(`  members firing ANY red flag (the screener's redFlags=any set): ${firesAny.length} of ${u.members.length}`);
  console.log(`    after filtering filing keys: ${u.members.filter((m) => m.firedFlags.some((f) => !FILING_KEYS.has(f.flagKey))).length}`);
  const sinceNew = u.sinceLastWeek?.newFlags ?? [];
  console.log(`  sinceLastWeek.newFlags: ${sinceNew.length}  (filing keys: ${sinceNew.filter((f) => FILING_KEYS.has(f.flagKey)).length})`);

  // ── §9 · the alert-widening number ──
  console.log("\n── §9 · what changing the `reading.scored` gate would open ──");
  const rows = await prisma.stockFinding.findMany({
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, evaluationState: true, standingState: true, kind: true },
  });
  const cur = new Map<string, (typeof rows)[number]>();
  for (const r of rows) { const k = `${r.stockId}|${r.ruleKey}`; if (!cur.has(k)) cur.set(k, r); }
  const current = [...cur.values()];
  const newly = current.filter((r) => r.standingState === "newly_standing");
  const continuing = current.filter((r) => r.standingState === "continuing");
  const resolved = current.filter((r) => r.standingState === "resolved");
  console.log(`  current filing rows: ${current.length} across ${new Set(current.map((r) => r.stockId)).size} stocks`);
  console.log(`    newly_standing: ${newly.length} on ${new Set(newly.map((r) => r.stockId)).size} stocks`);
  console.log(`    continuing    : ${continuing.length} on ${new Set(continuing.map((r) => r.stockId)).size} stocks`);
  console.log(`    resolved      : ${resolved.length} on ${new Set(resolved.map((r) => r.stockId)).size} stocks`);

  const scoredIds = new Set((await prisma.scoreSnapshot.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId));
  const newlyUnscored = newly.filter((r) => !scoredIds.has(r.stockId));
  console.log(`    newly_standing on UNSCORED stocks (what the gate blocks today): ${newlyUnscored.length} on ${new Set(newlyUnscored.map((r) => r.stockId)).size} stocks`);
  const byKey = new Map<string, number>();
  for (const r of newlyUnscored) byKey.set(r.ruleKey, (byKey.get(r.ruleKey) ?? 0) + 1);
  [...byKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`      ${pad(k, 44)} x${c}`));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
