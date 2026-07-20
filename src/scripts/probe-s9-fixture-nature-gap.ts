// (Stage 9) READ-ONLY PROBE — is the `verify-phs-patterns` red a REGRESSION, or a FIXTURE GAP the
// repoint exposed? No DB, no writes, no edits to the verify or the engine: rebuild the four §10 worked
// examples TWICE — once exactly as the fixtures build them today (no isin/assetClass), once carrying
// the position facts the REAL path always sets — and print what fires under each.
//
// THE HYPOTHESIS UNDER TEST: the fixtures omit isin/assetClass, so every synthetic holding routes
//   natureOf("unknown") → "basket"     (entity.ts:448 `h.assetClass ?? "unknown"` → :77)
//   sectorStateOf(undefined, "IT") → "not_applicable"   (entity.ts:289 — the DECLARED SECTOR IS DISCARDED)
// ⇒ nameRisk 0 ⇒ C2 not evaluable ⇒ PC5 drops · sectorable 0 ⇒ C3 not evaluable ⇒ PB1 drops.
// The OLD gates (`r.neff` = S3's position-level Neff over the raw vector, engine.ts:208; `s2Evaluable`)
// were NATURE-BLIND, so the fixtures never exercised nature. The repoint is the first code that needed it.
//
// If the WITH-FACTS column matches each example's DOCUMENTED expectation, the fixture is the defect and
// the §10 examples are correct as written — and re-baselining the expectations would bake a fixture bug
// into the spec's own worked examples, permanently.
//   npx tsx src/scripts/probe-s9-fixture-nature-gap.ts
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { firePortfolioFindings } from "../portfolio/phs/patterns.js";

// Distinct 12-char ISIN per symbol, allocated by first-seen order. Deterministic, and collision-free
// BY CONSTRUCTION — mnemonic stems are not: `INE${symbol}`.slice(0,7) maps SMALLIT and SMALLY BOTH to
// "INESMAL", silently merging two holdings into one entity and corrupting the very Neff under test.
// (entityKeyOf also returns null below 7 chars, which would drop TCS from the ledger while its weight
// stayed in nameRisk — a wrong Neff that still looks plausible. Both traps avoided, not survived.)
// ⚠ THE STEM IS THE FIRST 7 CHARS — so the varying part MUST live in chars 4-7, not further right.
// v1 of this probe used `INE${seq.padStart(9,"0")}` → stem "INE0000" for EVERY symbol → all 10 holdings
// merged into ONE entity (Neff 1.00, Net 21.00 on all four books). Caught by the printed diagnostics,
// not by review: a collision does not throw, it just quietly makes every book look like a single stock.
const seq = new Map<string, string>();
const isinFor = (symbol: string) => {
  let v = seq.get(symbol);
  if (!v) { v = `INE${(seq.size + 1).toString(36).toUpperCase().padStart(4, "0")}00000`; seq.set(symbol, v); } // 12 chars; stem = INE+4 distinct
  return v;
};

// TODAY's fixture — verbatim from verify-phs-patterns.ts:21.
const H = (symbol: string, mv: number, tier: PhsHolding["tier"], sector: string | null, health: number | null, findings: PhsHolding["findings"] = []): PhsHolding =>
  ({ symbol, marketValue: mv, tier, sector, health, findings });
// WITH the position facts the real path always sets (assemble.ts:448 — a stock, its own ISIN).
const HS = (symbol: string, mv: number, tier: PhsHolding["tier"], sector: string | null, health: number | null, findings: PhsHolding["findings"] = []): PhsHolding =>
  ({ symbol, marketValue: mv, tier, sector, health, findings, isin: isinFor(symbol), assetClass: "stock", category: null });

type Mk = typeof H;
const ex1 = (h: Mk) => [
  h("HDFCBANK", 20, "large", "Financials", 74), h("TCS", 13, "large", "IT", 71), h("BEL", 11, "large", "Defense", 78),
  h("SBIN", 10, "large", "Financials", 66, ["medium"]), h("RELIANCE", 8, "large", "Energy", 70, ["lp5"]),
  h("TATAMOTORS", 12, "large", "Auto", null), h("ZOMATO", 8, "large", "Consumer", null),
  h("SMALLIT", 10, "small", "IT", null), h("SMALLY", 5, "small", null, null), h("MICROZ", 3, "small", null, null),
];
const ex2 = (h: Mk) => [
  h("SMALLX", 45, "small", null, null), h("OTHER", 15, "small", null, null),
  h("RIL", 15, "large", "Energy", 70), h("TCS", 15, "large", "IT", 71), h("BEL", 10, "large", "Defense", 78),
];
const ex3 = (h: Mk) => {
  const b = [h("FLAG", 8, "large", "Sec0", 72, ["high", "lp5"])];
  for (let i = 1; i <= 11; i++) b.push(h(`H${i}`, 92 / 11, "large", `Sec${i}`, 72));
  return b;
};
const ex4 = (h: Mk) => {
  const b = [h("SCORED", 10, "large", "SecA", 80)];
  for (let i = 1; i <= 9; i++) b.push(h(`U${i}`, 10, "large", `SecU${i}`, null));
  return b;
};

const EXPECTED: Record<string, string[]> = {
  Ex1: ["PB1", "PV4"],
  Ex2: ["PC1", "PC2", "PC5", "PS5", "PV2", "PV5", "PX1"],
  Ex3: ["PB1", "PV1", "PX4"],
  Ex4: ["PB1", "PQ1", "PS5", "PV2", "PV4"],
};

const fire = (holdings: PhsHolding[]) => {
  const r = computePhs(holdings);
  const ids = firePortfolioFindings(holdings, r, { fieldWeakSymbols: new Set() }).map((f) => f.id).sort();
  const c2 = r.construction.gross.c2, c3 = r.construction.c3;
  return { ids, r, c2, c3 };
};
const setEq = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

const BOOKS: [string, (h: Mk) => PhsHolding[]][] = [["Ex1", ex1], ["Ex2", ex2], ["Ex3", ex3], ["Ex4", ex4]];

console.log("═══ THE FIXTURE GAP — same book, with and without the facts the real path always sets ═══\n");
for (const [name, mk] of BOOKS) {
  const bare = fire(mk(H)), full = fire(mk(HS));
  const want = EXPECTED[name];
  console.log(`  ${name}  documented expectation: {${want.join(", ")}}`);
  console.log(`    TODAY (no isin/assetClass) : [${bare.ids.join(", ")}]  ${setEq(bare.ids, want) ? "✅" : "❌ MISMATCH"}`);
  console.log(`    WITH position facts        : [${full.ids.join(", ")}]  ${setEq(full.ids, want) ? "✅" : "❌ MISMATCH"}`);
  console.log(`      nature/gates → nameRisk ${(bare.r.construction.exposures.nameRisk * 100).toFixed(0)}% → ${(full.r.construction.exposures.nameRisk * 100).toFixed(0)}%`
    + ` · C2.evaluable ${bare.c2.evaluable} → ${full.c2.evaluable}`
    + ` · C3.evaluable ${bare.c3.evaluable} → ${full.c3.evaluable}`);
  // `entities` lives on the PERSISTED ConstructionData (constructionDataOf), NOT on the engine result —
  // v1 read `r.construction.entities?.length ?? 0` and the `?? 0` printed a confident, meaningless zero
  // next to a correct Neff. The ledger is `r.entityLedger`. (A `??` on a field that does not exist is
  // indistinguishable from a real zero: the same disease as a dead guard reading as coverage.)
  console.log(`      archetype "${bare.r.construction.archetype}" → "${full.r.construction.archetype}"`
    + ` · entityLedger ${bare.r.entityLedger.length} → ${full.r.entityLedger.length}`
    + ` · Neff.entity ${bare.c2.metrics?.neff?.toFixed(2) ?? "n/e"} → ${full.c2.metrics?.neff?.toFixed(2) ?? "n/e"}`);
  console.log(`      Health ${bare.r.health} → ${full.r.health} · Net ${bare.r.construction.net.toFixed(2)} → ${full.r.construction.net.toFixed(2)}\n`);
}

// The fixtures' OWN internal contradiction, stated as a measurement rather than an argument:
// assemble.ts:509 gives EVERY non-stock `tier: "unknown"` and `health: null`. A holding carrying
// `tier: "large"` AND `health: 74` is a STOCK by construction — no such basket can exist on the real
// path. So the bare fixture asserts stock-facts while its nature says fund.
const contradictory = ex1(H).filter((h) => h.tier !== "unknown" || h.health != null).length;
console.log(`  ⚠ Ex1 holdings carrying stock-only facts (tier ≠ "unknown" or health ≠ null) while nature reads "basket": ${contradictory}/10`);
console.log(`    assemble.ts:509 sets tier "unknown" + health null for EVERY non-stock — a "large-cap basket with health 74"`);
console.log(`    cannot exist on the real path. The fixture is internally contradictory, not merely sparse.`);
