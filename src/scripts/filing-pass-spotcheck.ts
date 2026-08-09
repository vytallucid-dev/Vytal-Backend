// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · SPOT CHECK — every persisted row for one stock from each coverage cohort.
//
// One SCORED stock, one COVERED-UNSCORED (in a peer group, never scored) and one DISPLAY-ONLY (no
// peer group, never scored by design). All three states must appear across the three, because the
// point of writing not_fired and not_evaluable rows is that a reader can tell "checked, clean" from
// "could not check" from "not run" — and none of that is visible if the table only holds fires.
//
//   npx tsx src/scripts/filing-pass-spotcheck.ts [SYM1 SYM2 SYM3]
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { parsePeriodKey } from "../filing/period.js";

const GRAIN_NAME = { A: "annual", Q: "results quarter", S: "shareholding quarter" } as const;

async function pick(): Promise<{ cohort: string; symbol: string }[]> {
  const args = process.argv.slice(2);
  if (args.length === 3) return [
    { cohort: "(given)", symbol: args[0] }, { cohort: "(given)", symbol: args[1] }, { cohort: "(given)", symbol: args[2] },
  ];
  // A stock with rows in stock_findings from each cohort, preferring one that has a fire so all three
  // states are actually represented somewhere in the sample.
  const scored = await prisma.stock.findFirst({
    where: { isActive: true, scoreSnapshots: { some: {} }, stockFindings: { some: { evaluationState: "fired" } } },
    orderBy: { symbol: "asc" }, select: { symbol: true },
  });
  const covered = await prisma.stock.findFirst({
    where: { isActive: true, scoreSnapshots: { none: {} }, peerGroups: { some: {} }, stockFindings: { some: {} } },
    orderBy: { symbol: "asc" }, select: { symbol: true },
  });
  const display = await prisma.stock.findFirst({
    where: { isActive: true, peerGroups: { none: {} }, stockFindings: { some: { evaluationState: "fired" } } },
    orderBy: { symbol: "asc" }, select: { symbol: true },
  });
  return [
    { cohort: "SCORED", symbol: scored?.symbol ?? "—" },
    { cohort: "COVERED-UNSCORED", symbol: covered?.symbol ?? "—" },
    { cohort: "DISPLAY-ONLY", symbol: display?.symbol ?? "—" },
  ];
}

async function main() {
  const picks = await pick();
  const seenStates = new Set<string>();

  for (const p of picks) {
    if (p.symbol === "—") { console.log(`\n════ ${p.cohort}: no candidate found ════`); continue; }
    const stock = await prisma.stock.findFirst({
      where: { symbol: p.symbol },
      select: { id: true, symbol: true, name: true, industryType: true },
    });
    if (!stock) { console.log(`\n════ ${p.symbol}: not found ════`); continue; }

    const pgs = await prisma.stockPeerGroup.count({ where: { stockId: stock.id } });
    const snaps = await prisma.scoreSnapshot.count({ where: { stockId: stock.id } });
    const rows = await prisma.stockFinding.findMany({
      where: { stockId: stock.id },
      orderBy: [{ periodEnd: "desc" }, { ruleRef: "asc" }],
    });

    console.log(`\n════════════════════════════════════════════════════════════════════════════════════════`);
    console.log(`  ${p.cohort} — ${stock.symbol} (${stock.name})`);
    console.log(`  industry ${stock.industryType} · peer groups ${pgs} · score snapshots ${snaps} · rows ${rows.length}`);
    console.log(`════════════════════════════════════════════════════════════════════════════════════════`);
    console.log(`  ${"RULE".padEnd(5)} ${"KEY".padEnd(38)} ${"PERIOD".padEnd(12)} ${"END".padEnd(11)} ${"STATE".padEnd(14)} ${"STANDING".padEnd(15)} ${"SEV".padEnd(9)} REASON / VERDICT`);
    for (const r of rows) {
      seenStates.add(r.evaluationState);
      const g = parsePeriodKey(r.periodKey);
      const ev = (r.evidence ?? {}) as Record<string, unknown>;
      const detail = r.evaluationState === "not_evaluable"
        ? (r.notEvaluableReason ?? "")
        : r.evaluationState === "fired"
          ? String(ev.verdict ?? "").slice(0, 96)
          : "";
      console.log(
        `  ${r.ruleRef.padEnd(5)} ${r.ruleKey.padEnd(38)} ${r.periodKey.padEnd(12)} ` +
        `${r.periodEnd.toISOString().slice(0, 10).padEnd(11)} ${r.evaluationState.padEnd(14)} ` +
        `${(r.standingState ?? "—").padEnd(15)} ${(r.severity ?? "—").padEnd(9)} ${detail}`,
      );
    }
    const grains = new Set(rows.map((r) => parsePeriodKey(r.periodKey)?.grain).filter(Boolean));
    console.log(`  grains present: ${[...grains].map((g) => `${g} (${GRAIN_NAME[g as "A" | "Q" | "S"]})`).join(" · ")}`);
    const states = new Map<string, number>();
    for (const r of rows) states.set(r.evaluationState, (states.get(r.evaluationState) ?? 0) + 1);
    console.log(`  states: ${[...states.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }

  console.log(`\n──────── ALL THREE STATES REPRESENTED ────────`);
  for (const s of ["fired", "not_fired", "not_evaluable"]) {
    console.log(`  ${seenStates.has(s) ? "OK  " : "FAIL"} ${s}`);
  }
  await prisma.$disconnect();
  process.exit([...["fired", "not_fired", "not_evaluable"]].every((s) => seenStates.has(s)) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
