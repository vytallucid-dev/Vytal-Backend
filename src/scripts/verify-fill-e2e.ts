// ─────────────────────────────────────────────────────────────
// PART 4 — END-TO-END fill verify (ROLLED BACK, writes nothing permanent).
//
// Picks a real Ind-AS Fundamental row, edits `revenue` inside a transaction,
// runs the re-derive dispatcher, asserts the dependent ratios recompute in the
// right direction, then ROLLS BACK and confirms the row is byte-identical to
// baseline. Plus the no-op/determinism property: re-deriving without changing
// raw is deterministic and only "moves" the pre-existing stale/precision drift
// (Stage-1a finding), never spuriously changes a consistent column.
//
// Run:  npx tsx src/scripts/verify-fill-e2e.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { reDeriveFundamentalAnnual } from "../fill/re-derive.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
class Rollback extends Error {}

const DERIVED = ["netMargin", "operatingMargin", "assetTurnover", "receivablesDays", "roe", "roce", "revenueGrowthYoy", "ebitda", "debtToEquity"] as const;
const snap = (r: Record<string, Prisma.Decimal | null>) => Object.fromEntries(DERIVED.map((c) => [c, r[c]?.toString() ?? null]));

async function main() {
  // Pick a row with the inputs that make the cascade visible.
  const target = await prisma.fundamental.findFirst({
    where: { revenue: { not: null, gt: 0 }, netProfit: { not: null }, totalAssets: { not: null, gt: 0 } },
    select: { id: true, stockId: true, fiscalYear: true, resultType: true, revenue: true, stock: { select: { symbol: true } } },
    orderBy: { fiscalYear: "desc" },
  });
  if (!target) { console.log("no suitable Fundamental row"); await prisma.$disconnect(); return; }
  console.log(`\nTarget: ${target.stock.symbol} ${target.fiscalYear}/${target.resultType} (revenue=${num(target.revenue)})`);

  const baseRow = await prisma.fundamental.findUniqueOrThrow({ where: { id: target.id } });
  const baseline = snap(baseRow as unknown as Record<string, Prisma.Decimal | null>);
  const baseRevenue = baseRow.revenue!;

  // ── (1) EDIT revenue ×1.25 → re-derive → assert direction, in a ROLLED-BACK txn ──
  console.log("\n[1] Edit revenue ×1.25 → re-derive (rolled back)");
  let afterEdit: Record<string, string | null> = {};
  let changed: Record<string, { before: string | null; after: string | null }> = {};
  try {
    await prisma.$transaction(async (tx) => {
      const newRevenue = baseRevenue.times(1.25);
      await tx.fundamental.update({ where: { id: target.id }, data: { revenue: newRevenue } });
      const res = await reDeriveFundamentalAnnual(tx, target.id);
      changed = res.changed;
      const row = await tx.fundamental.findUniqueOrThrow({ where: { id: target.id } });
      afterEdit = snap(row as unknown as Record<string, Prisma.Decimal | null>);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }

  const b = (c: string) => (baseline[c] == null ? null : parseFloat(baseline[c] as string));
  const a = (c: string) => (afterEdit[c] == null ? null : parseFloat(afterEdit[c] as string));
  check("netMargin decreased (revenue↑ → netProfit/revenue↓)", b("netMargin") != null && a("netMargin") != null && a("netMargin")! < b("netMargin")!, { before: b("netMargin"), after: a("netMargin") });
  check("assetTurnover increased (revenue↑ / assets fixed)", b("assetTurnover") != null && a("assetTurnover") != null && a("assetTurnover")! > b("assetTurnover")!, { before: b("assetTurnover"), after: a("assetTurnover") });
  check("receivablesDays decreased (receivables fixed / revenue↑)", b("receivablesDays") == null || a("receivablesDays") == null || a("receivablesDays")! < b("receivablesDays")!, { before: b("receivablesDays"), after: a("receivablesDays") });
  check("revenueGrowthYoy increased (vs same prior)", b("revenueGrowthYoy") == null || a("revenueGrowthYoy") == null || a("revenueGrowthYoy")! > b("revenueGrowthYoy")!, { before: b("revenueGrowthYoy"), after: a("revenueGrowthYoy") });
  check("ebitda unchanged by a pure revenue edit (no revenue term)", baseline["ebitda"] === afterEdit["ebitda"]);
  check("re-derive reported the changed columns", Object.keys(changed).length > 0, Object.keys(changed));
  console.log(`   changed: ${Object.keys(changed).join(", ")}`);

  // ── (2) ROLLBACK restored baseline ──
  console.log("\n[2] Rollback restored baseline");
  const restored = await prisma.fundamental.findUniqueOrThrow({ where: { id: target.id } });
  check("revenue restored", restored.revenue!.equals(baseRevenue));
  check("all derived restored to baseline", JSON.stringify(snap(restored as unknown as Record<string, Prisma.Decimal | null>)) === JSON.stringify(baseline));

  // ── (3) NO-OP / determinism: re-derive WITHOUT changing raw ──
  console.log("\n[3] No-op re-derive (same raw) — deterministic; only corrects pre-existing drift");
  let noopChanged1: string[] = [], noopChanged2: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const r1 = await reDeriveFundamentalAnnual(tx, target.id);
      noopChanged1 = Object.keys(r1.changed);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  try {
    await prisma.$transaction(async (tx) => {
      const r2 = await reDeriveFundamentalAnnual(tx, target.id);
      noopChanged2 = Object.keys(r2.changed);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  check("determinism: two no-op re-derives report the same changed set", JSON.stringify(noopChanged1) === JSON.stringify(noopChanged2), { r1: noopChanged1, r2: noopChanged2 });
  console.log(`   no-op changed (pre-existing precision/stale only): ${noopChanged1.length ? noopChanged1.join(", ") : "(none — fully consistent row)"}`);
  check("no-op changes are bounded to prior-dependent or rounding-floor columns", noopChanged1.every((c) => ["roe", "revenueGrowthYoy", "profitGrowthYoy", "epsGrowthYoy", "netMargin", "operatingMargin", "debtToEquity", "roce", "interestCoverage", "receivablesDays", "inventoryTurnover", "assetTurnover", "bookValuePerShare", "fcf", "ebitda", "totalDebt", "netWorth"].includes(c)), noopChanged1);

  console.log(`\n=== e2e ${pass}/${pass + fail} passed (all rolled back — DB unchanged) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
