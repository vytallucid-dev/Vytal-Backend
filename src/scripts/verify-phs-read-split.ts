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
  ({ id, family, label: `${id} label`, tone: "Caution", loud: true, bind: { k: id }, read: `${id} read`, doesntMean: `${id} doesnt-mean` });

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
    constructionData: {
      gross: 76, net: 62, archetype: "Stock-led",
      exposures: { nameRisk: 0.8, basket: 0.2, debt: 0, commodity: 0 },
      rules: [
        { rule: "C1", evaluable: true, points: 0, subjectShare: 0.8, firedSubject: null, detail: "clean" },
        { rule: "C5", evaluable: false, points: 0, subjectShare: 0, firedSubject: null, detail: "no fund products — not evaluable" },
      ],
    },
    constantVersion: "portfolio-spec 2.0", createdAt: new Date(0),
    ...over,
  };
}

// ═══ 1 · PARTIAL book (both reads present) — byte-identical + partition ═══
console.log("\n═══ Partial book (scored 55%) — both reads, headline = health ═══");
const partialFindings = [F("PC1", "PC"), F("PC3", "PC"), F("PB1", "PB"), F("PQ4", "PQ"), F("PS1", "PS"), F("PX1", "PX"), F("PV2", "PV"), F("PV4", "PV")];
const partial = reshapeSnapshot(row({ firedFindings: partialFindings }), { scoredCount: 3, totalCount: 6 }, []);

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
// (Stage 6) archetype published; structureTier RETIRED from the payload; capitalTier survives as copy input only.
eq("archetype on construction_read (Stock-led)", partial.constructionRead.archetype, "Stock-led");
eq("capitalTier survives as copy input (Modest)", partial.constructionRead.capitalTier, "Modest");
eq("structureTier RETIRED from payload", (partial.constructionRead as unknown as Record<string, unknown>).structureTier, undefined);
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
// (Stage 6) the C1–C6 ledger replaces the S-rule ledger on the wire; evaluability (not-evaluable ≠ clean) survives.
eq("C-ledger (rules) on construction_read", Array.isArray(partial.constructionRead.rules) && partial.constructionRead.rules!.length === 2, true);
eq("evaluability preserved: C5 not-evaluable (≠ clean-0)", partial.constructionRead.rules!.find((r) => r.rule === "C5")?.evaluable, false);
eq("structureLedger RETIRED from payload", (partial.constructionRead as unknown as Record<string, unknown>).structureLedger, undefined);
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
}), { scoredCount: 0, totalCount: 4 }, []);

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
const full = reshapeSnapshot(row({ coverage: 1, recognizedUnscoredValue: 0, smallUnscoredValue: 0, firedFindings: [F("PV1", "PV")] }), { scoredCount: 6, totalCount: 6 }, []);
near("scoredWeight = 1.0", full.coverageState.scoredWeight, 1);
near("recognizedUnscoredWeight = 0", full.coverageState.recognizedUnscoredWeight, 0);
eq("unlockTrigger false (no recognized-unscored)", full.coverageState.unlockTrigger, false);
eq("headline = health", full.headlineSlot, "health");

// ═══ 4 · Construction band boundaries (Stage 6 recut: 85/70/55/40 · Fragile → Precarious) ═══
console.log("\n═══ Construction band boundaries (recut) ═══");
eq("85 → Well-built", constructionBandOf(85), "Well-built"); eq("84 → Solid", constructionBandOf(84), "Solid");
eq("70 → Solid (inclusive lower edge)", constructionBandOf(70), "Solid"); eq("69 → Concentrated", constructionBandOf(69), "Concentrated");
eq("55 → Concentrated", constructionBandOf(55), "Concentrated"); eq("54 → Lopsided", constructionBandOf(54), "Lopsided");
eq("40 → Lopsided", constructionBandOf(40), "Lopsided"); eq("39 → Precarious (renamed from Fragile)", constructionBandOf(39), "Precarious");

// ═══ 5 · legacy row (no construction_data) degrades to value + band ═══
console.log("\n═══ Legacy / no-holding row — degrades to value + band ═══");
const legacy = reshapeSnapshot(row({ constructionData: null }), { scoredCount: 3, totalCount: 6 }, []);
eq("legacy: archetype null (degraded)", legacy.constructionRead.archetype, null);
eq("legacy: rules null (degraded)", legacy.constructionRead.rules, null);
eq("legacy: value + band still served", `${legacy.constructionRead.value}/${legacy.constructionRead.band}`, "62/Concentrated");

console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
process.exit(failures === 0 ? 0 : 1);
