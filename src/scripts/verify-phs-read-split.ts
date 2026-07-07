// ─────────────────────────────────────────────────────────────────────────────
// PHS TWO-READ SPLIT VERIFICATION — the serializer reshape (portfolio-spec 1.2). Proves
// the flat snapshot regroups into two named reads with ZERO math change: Health/Structure/
// every finding byte-identical, findings partitioned PC/PB (construction) vs PQ/PS/PX/PV
// (health), health_read null iff scored_weight = 0, nothing dropped on a 0-scored book.
// 1.2: the ceiling is RETIRED (no ceiling object; a `provisional` tag instead), and
// health_read carries pillarProfile + lensProfile. Pure — feeds mock rows to reshapeSnapshot.
//   npx tsx src/scripts/verify-phs-read-split.ts
// ─────────────────────────────────────────────────────────────────────────────
import { reshapeSnapshot, constructionBandOf, type SnapshotReadInput } from "../controllers/me/portfolio-snapshot-controller.js";
import type { PfFinding } from "../portfolio/phs/patterns.js";

let failures = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`    ${ok ? "✅" : "❌"} ${name}: ${String(actual)} (exp ${String(expected)})`);
  if (!ok) failures++;
};
const near = (name: string, a: number, e: number, tol = 1e-9) => {
  const ok = Math.abs(a - e) <= tol;
  console.log(`    ${ok ? "✅" : "❌"} ${name}: ${a} (exp ${e})`);
  if (!ok) failures++;
};
const ids = (fs: PfFinding[]) => fs.map((f) => f.id).sort().join(",");

// A finding stub — only id/family/read matter for partition + byte-identity here.
const F = (id: string, family: string): PfFinding =>
  ({ id, family, label: `${id} label`, tone: "Caution", loud: true, bind: { k: id }, read: `${id} read` });

// A mock snapshot row (numbers, not Decimals — num() accepts both). 1.2: `phs` column holds
// the Health Score; ceiling columns are gone from the read shape; profiles added.
function row(over: Partial<SnapshotReadInput>): SnapshotReadInput {
  return {
    id: "snap-1", phs: 59, band: "Mixed", provisional: false, evaluable: true,
    quality: 66, structure: 62, signals: 88,
    coverage: 0.55, totalValue: 100000, recognizedUnscoredValue: 25000, smallUnscoredValue: 20000,
    structureLedger: [{ rule: "S1", points: 5, detail: "..." }],
    signalsLedger: [{ symbol: "X", weight: 0.1, source: "high", points: 8 }],
    firedFindings: [],
    pillarProfile: { foundation: 70, momentum: 60, market: 55, ownership: 65 },
    lensProfile: { absolute: 0.5, peer: 0.3, trend: 0.2 },
    structureTier: "Building", capitalTier: "Modest",
    constantVersion: "portfolio-spec 1.2", createdAt: new Date(0),
    ...over,
  };
}

// ═══ 1 · PARTIAL book (both reads present) — byte-identical + partition ═══
console.log("\n═══ Partial book (scored 55%) — both reads, headline = health ═══");
const partialFindings = [F("PC1", "PC"), F("PC3", "PC"), F("PB1", "PB"), F("PQ4", "PQ"), F("PS1", "PS"), F("PX1", "PX"), F("PV2", "PV"), F("PV4", "PV")];
const partial = reshapeSnapshot(row({ firedFindings: partialFindings }), { scoredCount: 3, totalCount: 6 });

eq("headline_slot = health", partial.headlineSlot, "health");
eq("health_read present", partial.healthRead != null, true);
eq("construction_read present", partial.constructionRead != null, true);
// byte-identical scalars (read verbatim off the row)
eq("construction_read.value === Structure (62)", partial.constructionRead.value, 62);
eq("construction band (62 → Concentrated)", partial.constructionRead.band, "Concentrated");
eq("health_read.value === Health Score (59)", partial.healthRead!.value, 59);
eq("health_read.band === band", partial.healthRead!.band, "Mixed");
eq("health_read.quality (66)", partial.healthRead!.quality, 66);
eq("health_read.signals (88)", partial.healthRead!.signals, 88);
// (1.2) ceiling RETIRED → no ceiling object; a Provisional tag + the profiles instead
eq("no ceiling object on health_read (retired in 1.2)", (partial.healthRead as unknown as Record<string, unknown>).ceiling, undefined);
eq("health_read.provisional (false)", partial.healthRead!.provisional, false);
eq("pillarProfile.foundation (70)", partial.healthRead!.pillarProfile?.foundation, 70);
eq("lensProfile.peer (0.3, character share)", partial.healthRead!.lensProfile?.peer, 0.3);
eq("tiers on construction_read", `${partial.constructionRead.structureTier}/${partial.constructionRead.capitalTier}`, "Building/Modest");
// coverage_state
near("coverage_state.scoredWeight = 0.55", partial.coverageState.scoredWeight, 0.55);
near("coverage_state.recognizedUnscoredWeight = 0.25", partial.coverageState.recognizedUnscoredWeight, 0.25);
near("coverage_state.smallUnscoredWeight = 0.20", partial.coverageState.smallUnscoredWeight, 0.20);
eq("coverage_state.scoredCount/totalCount = 3 of 6", `${partial.coverageState.scoredCount} of ${partial.coverageState.totalCount}`, "3 of 6");
eq("unlockTrigger true (recognized-unscored 25% > 0)", partial.coverageState.unlockTrigger, true);
// partition
eq("construction findings = PC/PB", ids(partial.constructionRead.findings), "PB1,PC1,PC3");
eq("health findings = PQ/PS/PX/PV", ids(partial.healthRead!.findings), "PQ4,PS1,PV2,PV4,PX1");
eq("construction families ⊆ {PC,PB}", partial.constructionRead.findings.every((f) => f.family === "PC" || f.family === "PB"), true);
eq("health families ⊆ {PQ,PS,PX,PV}", partial.healthRead!.findings.every((f) => ["PQ", "PS", "PX", "PV"].includes(f.family)), true);
// byte-identical: union of the two reads == original firedFindings, unchanged
const union = [...partial.constructionRead.findings, ...partial.healthRead!.findings];
eq("no finding dropped or duplicated (count)", union.length, partialFindings.length);
eq("byte-identical finding set (sorted JSON equal)",
  JSON.stringify([...union].sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify([...partialFindings].sort((a, b) => a.id.localeCompare(b.id))),
  true);
// ledger placement
eq("structureLedger on construction_read", Array.isArray(partial.constructionRead.structureLedger) && (partial.constructionRead.structureLedger as unknown[]).length === 1, true);
eq("signalsLedger on health_read", Array.isArray(partial.healthRead!.signalsLedger) && (partial.healthRead!.signalsLedger as unknown[]).length === 1, true);
// no legacy flat fields leaked onto the top level
eq("NO flat phs on top level", (partial as unknown as Record<string, unknown>).phs, undefined);
eq("NO flat structure on top level", (partial as unknown as Record<string, unknown>).structure, undefined);
eq("NO flat firedFindings on top level", (partial as unknown as Record<string, unknown>).firedFindings, undefined);

// ═══ 2 · ZERO-scored book — construction only, health null, nothing dropped ═══
console.log("\n═══ 0-scored book — construction read only, health null ═══");
const zeroFindings = [F("PC1", "PC"), F("PB1", "PB"), F("PS5", "PS"), F("PV2", "PV")];
const zero = reshapeSnapshot(row({
  phs: null, band: null, quality: null, evaluable: false, provisional: false,
  coverage: 0, structure: 80, totalValue: 50000, recognizedUnscoredValue: 30000, smallUnscoredValue: 20000,
  firedFindings: zeroFindings, signalsLedger: [], pillarProfile: null, lensProfile: null,
}), { scoredCount: 0, totalCount: 4 });

eq("headline_slot = construction", zero.headlineSlot, "construction");
eq("health_read null", zero.healthRead, null);
eq("construction_read present", zero.constructionRead != null, true);
eq("construction band (80 → Solid)", zero.constructionRead.band, "Solid");
near("coverage_state.scoredWeight = 0", zero.coverageState.scoredWeight, 0);
eq("scoredCount/totalCount = 0 of 4", `${zero.coverageState.scoredCount} of ${zero.coverageState.totalCount}`, "0 of 4");
// nothing dropped: construction owns EVERY fired finding (incl. the health-group PS5/PV2)
eq("construction owns ALL findings (no drop with null health)", ids(zero.constructionRead.findings), "PB1,PC1,PS5,PV2");
eq("byte-identical count preserved", zero.constructionRead.findings.length, zeroFindings.length);

// ═══ 3 · FULLY-covered book — no recognized-unscored → unlock false ═══
console.log("\n═══ Fully-covered book (c=1) — unlock trigger off ═══");
const full = reshapeSnapshot(row({ coverage: 1, recognizedUnscoredValue: 0, smallUnscoredValue: 0, firedFindings: [F("PV1", "PV")] }), { scoredCount: 6, totalCount: 6 });
near("scoredWeight = 1.0", full.coverageState.scoredWeight, 1);
near("recognizedUnscoredWeight = 0", full.coverageState.recognizedUnscoredWeight, 0);
eq("unlockTrigger false (no recognized-unscored)", full.coverageState.unlockTrigger, false);
eq("headline = health", full.headlineSlot, "health");

// ═══ 4 · Construction band boundaries ═══
console.log("\n═══ Construction band boundaries ═══");
eq("90 → Well-built", constructionBandOf(90), "Well-built"); eq("89 → Solid", constructionBandOf(89), "Solid");
eq("75 → Solid", constructionBandOf(75), "Solid"); eq("74 → Concentrated", constructionBandOf(74), "Concentrated");
eq("60 → Concentrated", constructionBandOf(60), "Concentrated"); eq("59 → Lopsided", constructionBandOf(59), "Lopsided");
eq("40 → Lopsided", constructionBandOf(40), "Lopsided"); eq("39 → Fragile", constructionBandOf(39), "Fragile");

console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
process.exit(failures === 0 ? 0 : 1);
