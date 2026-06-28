// ─────────────────────────────────────────────────────────────
// E2E — general non-banking back-dated PIT cascade (NET-ZERO).
//
//   [1] PLAN (pure, fast): a back-dated annual maps to its start quarter; the
//       plan is [PIT historical… + LIVE current], range ⊆ [edited..current],
//       NOTHING beyond current (no future leak), last step mode=live.
//   [2] BASELINE dry cascade (unedited): rescore is ~all skip-identical — the
//       fixpoint property (committed scores already match a fresh rescore).
//   [3] EDITED dry cascade: COMMIT a back-dated revenue edit + reDerive → dry
//       cascade → a historical PIT period supersedes PEER-WIDE (≥2 distinct
//       members, not just the edited stock — the L2 ripple) and the live step
//       ran in LIVE mode. Scores persist in ROLLED-BACK txns (nothing written).
//       The raw edit is reverted in `finally` → baseline restored.
//   [4] Banking still routes to runBankingCascade (no regression).
//
// Run:  npx tsx src/scripts/verify-general-cascade-e2e.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reDeriveFundamentalAnnual } from "../fill/re-derive.js";
import { runGeneralCascade, resolveEditedPeriod } from "../scoring/rescore/general-cascade.js";
import { buildCascadePlan, pkOrdinal, quarterEnd, bankingPgForSymbol } from "../scoring/rescore/banking-cascade.js";
import { SCORED_PGS, pgRefsForSymbols } from "../scoring/composite/pg-registry.js";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

async function pgMemberIds(pgName: string): Promise<string[]> {
  const pg = await prisma.peerGroup.findFirst({ where: { name: pgName }, include: { stocks: { select: { stockId: true } } } });
  return (pg?.stocks ?? []).map((s) => s.stockId);
}
async function scoredPeriods(memberIds: string[]): Promise<string[]> {
  const rows = await prisma.scoreSnapshot.findMany({ where: { stockId: { in: memberIds }, snapshotType: "quarterly" }, select: { periodKey: true }, distinct: ["periodKey"] });
  return rows.map((r) => r.periodKey).filter((pk) => /^FY\d{2}Q[1-4]$/.test(pk)).sort((a, b) => pkOrdinal(a) - pkOrdinal(b));
}

async function main() {
  // ── Find a non-banking PG (most scored periods) + a member with a back-datable annual ──
  const nonBank = SCORED_PGS.filter((r) => r.pgId !== "PG5" && r.pgId !== "PG6");
  let chosen: { ref: typeof nonBank[number]; periods: string[]; symbol: string; rowId: string; reportDate: Date; editedPeriod: string } | null = null;

  for (const ref of nonBank) {
    const memberIds = await pgMemberIds(ref.pgName);
    const periods = await scoredPeriods(memberIds);
    if (periods.length < 2) continue;
    // Edit the STANDALONE annual ACTUALLY READ by the earliest scored period
    // (Foundation reads standalone; the latest annual with reportDate ≤ that
    // period's quarter-end). Editing it moves the PIT periods that read it →
    // peer-wide ripple; later periods reading a newer annual skip-identical.
    const q0 = quarterEnd(periods[0]);
    const anns = await prisma.fundamental.findMany({
      where: { stockId: { in: memberIds }, resultType: "standalone", revenue: { gt: 0 }, reportDate: { lte: q0 } },
      select: { id: true, fiscalYear: true, reportDate: true, resultType: true, revenue: true, stock: { select: { symbol: true } } },
      orderBy: { reportDate: "desc" }, // latest-as-of-q0 first = what periods[0] reads
    });
    for (const an of anns) {
      const editedPeriod = resolveEditedPeriod({ kind: "annual", reportDate: an.reportDate }, periods);
      if (!editedPeriod) continue;
      const plan = buildCascadePlan(ref, an.stock.symbol, editedPeriod, periods);
      if (plan.kind === "cascade" && plan.steps.length >= 2 && plan.steps.length <= 12) {
        chosen = { ref, periods, symbol: an.stock.symbol, rowId: an.id, reportDate: an.reportDate, editedPeriod };
        break;
      }
    }
    if (chosen) break;
  }

  if (!chosen) { console.log("INCONCLUSIVE — no non-banking PG with a back-datable annual + ≥2 PIT/live steps found."); await prisma.$disconnect(); return; }
  const { ref, periods, symbol, rowId, editedPeriod } = chosen;
  const current = periods[periods.length - 1];
  console.log(`\nTarget: ${symbol} in ${ref.pgId} | scored periods ${periods[0]}..${current} | edited annual → start ${editedPeriod}`);

  // ── [1] PLAN assertions (pure) ──
  console.log("\n[1] Plan (PIT historical + live current, no future leak)");
  const plan = buildCascadePlan(ref, symbol, editedPeriod, periods);
  const modes = plan.steps.map((s) => `${s.periodKey}:${s.mode}`);
  console.log(`   steps: ${modes.join("  ")}`);
  check("last step is the current period in LIVE mode", plan.steps[plan.steps.length - 1].mode === "live" && plan.steps[plan.steps.length - 1].periodKey === current);
  check("all non-last steps are PIT", plan.steps.slice(0, -1).every((s) => s.mode === "pit"));
  check("range ⊆ [edited..current] — no future-period leak", plan.steps.every((s) => pkOrdinal(s.periodKey) >= pkOrdinal(editedPeriod) && pkOrdinal(s.periodKey) <= pkOrdinal(current)));
  check("≥1 historical PIT step exists", plan.steps.some((s) => s.mode === "pit"));

  // ── [2] BASELINE dry cascade — fixpoint (mostly skip-identical) ──
  console.log("\n[2] Baseline dry cascade (unedited) — expect ~all skip-identical (fixpoint)");
  const base = await runGeneralCascade(symbol, { kind: "annual", reportDate: chosen.reportDate }, { dryRun: true, onProgress: (p, n) => console.log(`   ${p}% ${n}`) });
  console.log(`   baseline: superseded=${base?.superseded} created=${base?.created} skipped=${base?.skippedIdentical} noSnap=${base?.noSnapshot}`);
  check("baseline cascade supersedes few/none (committed scores ≈ fresh rescore)", (base?.superseded ?? 0) <= (base?.skippedIdentical ?? 0));

  // ── [3] EDITED dry cascade — commit a back-dated revenue edit, prove peer-wide ripple, revert ──
  console.log("\n[3] Edited dry cascade — back-dated revenue ×1.4 → re-derive → peer-wide supersede");
  const before = await prisma.fundamental.findUniqueOrThrow({ where: { id: rowId }, select: { revenue: true } });
  let edited: Awaited<ReturnType<typeof runGeneralCascade>> = null;
  try {
    // COMMIT the edit + re-derive (so computePgScores reads it).
    await prisma.$transaction(async (tx) => {
      await tx.fundamental.update({ where: { id: rowId }, data: { revenue: before.revenue!.times(1.4) } });
      await reDeriveFundamentalAnnual(tx, rowId);
    });
    edited = await runGeneralCascade(symbol, { kind: "annual", reportDate: chosen.reportDate }, { dryRun: true, onProgress: (p, n) => console.log(`   ${p}% ${n}`) });
  } finally {
    // REVERT raw + re-derive → baseline restored (scores were never committed — dry).
    await prisma.$transaction(async (tx) => {
      await tx.fundamental.update({ where: { id: rowId }, data: { revenue: before.revenue } });
      await reDeriveFundamentalAnnual(tx, rowId);
    });
  }
  console.log(`   edited: superseded=${edited?.superseded} created=${edited?.created} skipped=${edited?.skippedIdentical} noSnap=${edited?.noSnapshot}`);

  // Peer-wide: ≥1 historical PIT step supersedes ≥2 DISTINCT members (not just the edited stock).
  const pg = edited?.perPg[0];
  let peerWidePit = false, liveRan = false;
  for (const s of pg?.steps ?? []) {
    const supersededMembers = s.results.filter((r) => r.action === "created" && r.superseded).map((r) => r.symbol);
    if (s.mode === "pit" && new Set(supersededMembers).size >= 2) { peerWidePit = true; console.log(`   peer-wide @ ${s.periodKey} (pit): ${supersededMembers.length} members superseded incl. ${supersededMembers.slice(0,4).join(",")}`); }
    if (s.mode === "live") liveRan = true;
  }
  check("edited cascade supersedes more than baseline (the edit moved scores)", (edited?.superseded ?? 0) > (base?.superseded ?? 0));
  check("a historical PIT period superseded PEER-WIDE (≥2 distinct members — L2 ripple)", peerWidePit);
  check("the live/current period step ran (live mode)", liveRan);

  // ── [3b] revert confirmed ──
  const restored = await prisma.fundamental.findUniqueOrThrow({ where: { id: rowId }, select: { revenue: true } });
  check("raw revenue restored to baseline (net-zero)", restored.revenue!.equals(before.revenue!));

  // ── [4] banking still routes to runBankingCascade (no regression) ──
  console.log("\n[4] Banking routing unchanged");
  const bankSym = (await pgRefsForSymbols([])) && (await prisma.peerGroup.findFirst({ where: { name: SCORED_PGS.find((r) => r.pgId === "PG5")!.pgName }, include: { stocks: { select: { stock: { select: { symbol: true } } } } } }));
  const aBank = bankSym?.stocks?.[0]?.stock?.symbol;
  if (aBank) {
    const banking = await bankingPgForSymbol(aBank);
    check(`banking symbol ${aBank} resolves to a banking PG (→ runBankingCascade path)`, banking != null && (banking.ref.pgId === "PG5" || banking.ref.pgId === "PG6"));
  } else { console.log("   (no PG5 member found — skipping banking-routing check)"); }

  console.log(`\n=== general-cascade e2e ${pass}/${pass + fail} (scores never committed; raw restored) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
