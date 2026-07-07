// ─────────────────────────────────────────────────────────────────────────────
// PHS PART B VERIFICATION — fire the portfolio pattern library on the four spec
// worked-example books + the real seeded book. Prove: fired PF-IDs match what each
// example should surface, NO field-verdict became a penalty, honest-empty holds for
// undeclared thresholds (PQ2/PQ3), and Part B changed NO number (byte-identical).
// v1.1: also proves the tier COPY wiring (Change 2) — structure_tier/capital_tier reframe
// PC/PB reads and stamp their binds, while touching NO number, tone, loud flag, or the
// finding set (copy-only, byte-identical score).
//   npx tsx src/scripts/verify-phs-patterns.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { firePortfolioFindings, NOT_EVALUABLE_UNDECLARED } from "../portfolio/phs/patterns.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";

let failures = 0;
const ok = (n: string, c: boolean, d: string) => { console.log(`    ${c ? "✅" : "❌"} ${n} — ${d}`); if (!c) failures++; };
const H = (symbol: string, mv: number, tier: PhsHolding["tier"], sector: string | null, health: number | null, findings: PhsHolding["findings"] = []): PhsHolding =>
  ({ symbol, marketValue: mv, tier, sector, health, findings });
const setEq = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

function fireOn(holdings: PhsHolding[], fieldWeak: string[] = []) {
  const r = computePhs(holdings);
  const before = JSON.stringify(r); // byte-identical guard
  const findings = firePortfolioFindings(holdings, r, { fieldWeakSymbols: new Set(fieldWeak) });
  const after = JSON.stringify(r);
  return { r, findings, mutated: before !== after };
}

async function main() {
  console.log("═══ PART B — fired PF-IDs on the four worked examples ═══");

  // Ex1 — typical retail
  const ex1 = fireOn([
    H("HDFCBANK", 20, "large", "Financials", 74), H("TCS", 13, "large", "IT", 71), H("BEL", 11, "large", "Defense", 78),
    H("SBIN", 10, "large", "Financials", 66, ["medium"]), H("RELIANCE", 8, "large", "Energy", 70, ["lp5"]),
    H("TATAMOTORS", 12, "large", "Auto", null), H("ZOMATO", 8, "large", "Consumer", null),
    H("SMALLIT", 10, "small", "IT", null), H("SMALLY", 5, "small", null, null), H("MICROZ", 3, "small", null, null),
  ]);
  const ex1Ids = ex1.findings.map((f) => f.id);
  console.log(`\n  Ex1 fired: [${ex1Ids.join(", ")}]  (PB1 well-spread, PV4 awaiting-coverage)`);
  ok("Ex1 = {PB1, PV4}", setEq(ex1Ids, ["PB1", "PV4"]), ex1Ids.join(","));
  ok("Ex1 byte-identical (no number mutated)", !ex1.mutated, "result unchanged");

  // Ex2 — multibagger
  const ex2 = fireOn([
    H("SMALLX", 45, "small", null, null), H("OTHER", 15, "small", null, null),
    H("RIL", 15, "large", "Energy", 70), H("TCS", 15, "large", "IT", 71), H("BEL", 10, "large", "Defense", 78),
  ]);
  const ex2Ids = ex2.findings.map((f) => f.id);
  console.log(`  Ex2 fired: [${ex2Ids.join(", ")}]  (PC1/PC2/PC5 concentration, PS5 clean, PV2/PV5 coverage, PX1 sound-companies-fragile-construction)`);
  ok("Ex2 = {PC1,PC2,PC5,PS5,PV2,PV5,PX1}", setEq(ex2Ids, ["PC1", "PC2", "PC5", "PS5", "PV2", "PV5", "PX1"]), ex2Ids.join(","));
  ok("Ex2 PX1 present (the classic tension)", ex2Ids.includes("PX1"), "PX1");
  ok("Ex2 byte-identical", !ex2.mutated, "result unchanged");

  // Ex3 — clean fully-covered
  const e3: PhsHolding[] = [H("FLAG", 8, "large", "Sec0", 72, ["high", "lp5"])];
  for (let i = 1; i <= 11; i++) e3.push(H(`H${i}`, 92 / 11, "large", `Sec${i}`, 72));
  const ex3 = fireOn(e3);
  const ex3Ids = ex3.findings.map((f) => f.id);
  console.log(`  Ex3 fired: [${ex3Ids.join(", ")}]  (PB1, PV1 fully-verified, PX4 broad-strength)`);
  ok("Ex3 = {PB1, PV1, PX4}", setEq(ex3Ids, ["PB1", "PV1", "PX4"]), ex3Ids.join(","));
  ok("Ex3 byte-identical", !ex3.mutated, "result unchanged");

  // Ex4 — 1 of 10 scored
  const e4: PhsHolding[] = [H("SCORED", 10, "large", "SecA", 80)];
  for (let i = 1; i <= 9; i++) e4.push(H(`U${i}`, 10, "large", `SecU${i}`, null));
  const ex4 = fireOn(e4);
  const ex4Ids = ex4.findings.map((f) => f.id);
  console.log(`  Ex4 fired: [${ex4Ids.join(", ")}]  (1.2: PV3 RETIRED with the ceiling; PV2/PV4 coverage, PQ1, PS5, PB1)`);
  ok("Ex4 = {PB1,PQ1,PS5,PV2,PV4} (PV3 retired in 1.2)", setEq(ex4Ids, ["PB1", "PQ1", "PS5", "PV2", "PV4"]), ex4Ids.join(","));
  ok("Ex4 PV3 GONE (ceiling retired → no confidence-limited read)", !ex4Ids.includes("PV3"), "no PV3");
  ok("Ex4 byte-identical", !ex4.mutated, "result unchanged");

  // ── Field-verdict lock (LM3/LP2 never penalize; surface ONLY as PX5 Neutral) ──
  console.log("\n═══ Field-verdict lock (LM3/LP2 never deduct) ═══");
  const fw = fireOn([H("LEADS_WEAK_FIELD", 50, "large", "IT", 70), H("CLEAN", 50, "large", "Energy", 70)], ["LEADS_WEAK_FIELD"]);
  ok("field-weak did NOT deduct (Signals = 100)", fw.r.signals === 100, `signals=${fw.r.signals}`);
  const px5 = fw.findings.find((f) => f.id === "PX5");
  ok("PX5 fired (field-weak ≥30%)", !!px5, px5 ? "fired" : "not fired");
  ok("PX5 tone is Neutral (never Caution/Concern)", px5?.tone === "Neutral", `tone=${px5?.tone}`);
  ok("no Caution/Concern finding derives from the field-weak verdict", !fw.findings.some((f) => f.id === "PX5" && (f.tone === "Caution" || f.tone === "Concern")), "clean");

  // ── Honest-empty: undeclared-threshold patterns never fire ──
  console.log("\n═══ Honest-empty (undeclared thresholds) ═══");
  const allFired = [...ex1Ids, ...ex2Ids, ...ex3Ids, ...ex4Ids, ...fw.findings.map((f) => f.id)];
  for (const id of NOT_EVALUABLE_UNDECLARED) ok(`${id} never fires (no declared threshold in spec 1.1)`, !allFired.includes(id), "honest-empty");

  // ── (1.1 Change 2) Tier copy-tone wiring — structure_tier/capital_tier reframe PC/PB
  //    reads and stamp their binds, changing NO number, tone, loud flag, or finding set. ──
  console.log("\n═══ Tier copy-tone wiring (PC/PB reframed; score untouched) ═══");
  // Same weights, different N → different structure_tier. Concentrated so PC1 fires.
  const starter = fireOn([H("A", 50, "large", "S1", 80), H("B", 30, "large", "S2", 72), H("C", 20, "large", "S3", 68)]); // N=3 Starter
  const estab = fireOn([H("A", 30, "large", "S1", 80), H("B", 10, "large", "S2", 72), H("C", 10, "large", "S3", 68),
    H("D", 10, "large", "S4", 70), H("E", 10, "large", "S5", 74), H("F", 10, "large", "S6", 66), H("G", 10, "large", "S7", 71), H("I", 10, "large", "S8", 69)]); // N=8 Established
  const pc1Starter = starter.findings.find((f) => f.id === "PC1")!;
  const pc1Estab = estab.findings.find((f) => f.id === "PC1")!;
  ok("PC1 fires on both books", !!pc1Starter && !!pc1Estab, "PC1×2");
  ok("PC1 bind carries structure_tier", (pc1Starter.bind as any).structureTier === "Starter" && (pc1Estab.bind as any).structureTier === "Established", `${(pc1Starter.bind as any).structureTier}/${(pc1Estab.bind as any).structureTier}`);
  ok("PC1 bind carries capital_tier", (pc1Starter.bind as any).capitalTier === "Modest", `${(pc1Starter.bind as any).capitalTier}`);
  ok("PC1 read REFRAMED by structure_tier (Starter read ≠ Established read)", pc1Starter.read !== pc1Estab.read, "reads differ");
  ok("Starter read leads with the early-stage clause", pc1Starter.read!.startsWith("This is an early-stage book"), pc1Starter.read!.slice(0, 42));
  ok("both reads preserve the verbatim fact tail", pc1Starter.read!.includes("Your largest holding is 50.0% of the book") && pc1Estab.read!.includes("Your largest holding is 30.0% of the book"), "fact intact");
  ok("copy-only: PC1 tone + loud identical across tiers", pc1Starter.tone === pc1Estab.tone && pc1Starter.loud === pc1Estab.loud, `${pc1Starter.tone}/${pc1Estab.loud}`);
  ok("copy-only: score byte-identical on both books", !starter.mutated && !estab.mutated, "unchanged");

  // capital_tier selector — SAME book (same N, same weights) at ₹1L vs ₹50L: PHS identical,
  // only the capital clause in the PC1 read changes (Modest vs Substantial).
  const capBook = (u: number) => fireOn([H("A", 50 * u, "large", "S1", 80), H("B", 30 * u, "large", "S2", 72), H("C", 20 * u, "large", "S3", 68)]);
  const modest = capBook(1_000), subst = capBook(50_000); // ₹100k vs ₹5,000,000
  const p1m = modest.findings.find((f) => f.id === "PC1")!, p1s = subst.findings.find((f) => f.id === "PC1")!;
  ok("capital_tier selects copy: Modest read ≠ Substantial read", p1m.read !== p1s.read, "reads differ");
  ok("capital_tier bind Modest vs Substantial", (p1m.bind as any).capitalTier === "Modest" && (p1s.bind as any).capitalTier === "Substantial", `${(p1m.bind as any).capitalTier}/${(p1s.bind as any).capitalTier}`);
  ok("value changed copy only: Health identical", modest.r.health === subst.r.health && modest.r.structure === subst.r.structure, `health ${modest.r.health}/${subst.r.health}`);

  // ── Real seeded book — byte-identical persisted proof + LP5/LP6 live wiring ──
  console.log("\n═══ Real seeded book (live prices/tiers/scores/patterns) ═══");
  const scored = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK"] }, scoreSnapshots: { some: {} } }, select: { id: true } });
  if (scored.length < 2) { console.log("  ⚠ skipping (need scored stocks)"); return finish(); }
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `phsb-${authId}@test.local`);
  const user = (await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } }))!;
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK", "LENSKART", "SWIGGY"] } }, select: { id: true, symbol: true } });
  try {
    for (const s of stocks) await prisma.holding.create({ data: { userId: user.id, stockId: s.id, quantity: new Prisma.Decimal(20), avgCost: new Prisma.Decimal(100), investedValue: new Prisma.Decimal(2000), realizedPnl: new Prisma.Decimal(0), lastComputedAt: new Date() } });

    const outcome = await computeAndPersistPhs(user.id);
    const snap = await prisma.portfolioHealthSnapshot.findUnique({ where: { id: outcome.snapshotId } });
    const fired = (snap!.firedFindings as unknown as { id: string }[]) ?? [];
    console.log(`  persisted: phs=${snap!.phs} ${snap!.band} · fired PF-IDs: [${fired.map((f) => f.id).join(", ")}]`);
    ok("Part B populated fired_findings (not [])", Array.isArray(fired) && fired.length > 0, `count=${fired.length}`);

    // byte-identical: the snapshot's numbers == an independent Part-A-only computePhs of the same book
    const { holdings } = await assemblePortfolio(user.id);
    const partA = computePhs(holdings);
    const same = snap!.phs === partA.health
      && Number(snap!.quality) === Number(partA.quality?.toFixed(4) ?? partA.quality)
      && Math.abs(Number(snap!.structure) - partA.structure) < 1e-4
      && Math.abs(Number(snap!.signals) - partA.signals) < 1e-4
      && Math.abs(Number(snap!.coverage) - partA.coverage) < 1e-4;
    ok("byte-identical score (snapshot numbers == Part A numbers; Part B added findings, changed no number)", same, `health ${snap!.phs}/${partA.health} · str ${snap!.structure}/${partA.structure.toFixed(4)} · sig ${snap!.signals}/${partA.signals.toFixed(4)}`);
    ok("no field-verdict became a penalty in the real book (PX5, if any, is Neutral)", fired.every((f: any) => f.id !== "PX5" || f.tone === "Neutral"), "clean");
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);
    console.log("  [cleanup] test user + snapshot deleted (cascade)");
  }
  finish();
}
function finish() {
  console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
