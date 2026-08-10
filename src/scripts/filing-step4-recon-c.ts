// STEP 4 · RECON C (read-only) — the two numbers that decide PS1's design and the alert semantics.
//   §10  scored stocks: score-channel red flags (on head) vs filing-channel fired red flags
//   §11  does ANY (stock, rule) have more than one filing period yet? (the "prior period exists" test)
//   npx tsx src/scripts/filing-step4-recon-c.ts
import { prisma } from "../db/prisma.js";
import { resolveHeadSnapshots } from "../scoring/read/head-snapshot.js";
import { dropRetiredFlags } from "../catalogue/retired-findings.js";

const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const symById = new Map(stocks.map((s) => [s.id, s.symbol]));
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly" },
    select: { id: true, stockId: true, periodKey: true, version: true, asOfDate: true },
  });
  const head = resolveHeadSnapshots(snaps);
  const headIds = [...head.values()].map((h) => h.id);
  const stockByHead = new Map([...head.entries()].map(([sid, h]) => [h.id, sid]));

  const flags = dropRetiredFlags(
    await prisma.redFlag.findMany({ where: { snapshotId: { in: headIds } }, select: { snapshotId: true, flagKey: true, severity: true } }),
  );
  const scoreBy = new Map<string, Set<string>>();
  for (const f of flags) {
    const sid = stockByHead.get(f.snapshotId)!;
    const s = scoreBy.get(sid) ?? new Set<string>();
    s.add(`${f.flagKey}/${(f.severity ?? "").toLowerCase()}`);
    scoreBy.set(sid, s);
  }

  const rows = await prisma.stockFinding.findMany({
    where: { kind: "red_flag" },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, evaluationState: true, severity: true },
  });
  const cur = new Map<string, (typeof rows)[number]>();
  for (const r of rows) { const k = `${r.stockId}|${r.ruleKey}`; if (!cur.has(k)) cur.set(k, r); }
  const filingBy = new Map<string, Set<string>>();
  for (const r of cur.values()) {
    if (r.evaluationState !== "fired") continue;
    const s = filingBy.get(r.stockId) ?? new Set<string>();
    s.add(`${r.ruleKey}/${(r.severity ?? "").toLowerCase()}`);
    filingBy.set(r.stockId, s);
  }

  console.log("── §10 · PS1's input, per SCORED stock: score channel vs filing channel ──");
  let same = 0, added = 0, removed = 0;
  const lines: string[] = [];
  for (const sid of head.keys()) {
    const a = scoreBy.get(sid) ?? new Set<string>();
    const b = filingBy.get(sid) ?? new Set<string>();
    const plus = [...b].filter((k) => !a.has(k));
    const minus = [...a].filter((k) => !b.has(k));
    if (!plus.length && !minus.length) { same++; continue; }
    added += plus.length; removed += minus.length;
    lines.push(`  ${pad(symById.get(sid) ?? "?", 12)} +[${plus.join(", ")}]  -[${minus.join(", ")}]`);
  }
  console.log(`  identical on ${same}/${head.size} scored stocks · gained ${added} · lost ${removed}`);
  lines.forEach((l) => console.log(l));

  console.log("\n── §11 · filing periods per (stock, rule) ──");
  const all = await prisma.stockFinding.groupBy({ by: ["stockId", "ruleKey"], _count: { _all: true } });
  const multi = all.filter((r) => r._count._all > 1);
  console.log(`  (stock, rule) pairs: ${all.length}   with MORE THAN ONE period: ${multi.length}`);
  console.log(`  ⇒ "a prior period row exists" is currently true for ${multi.length} pairs — the conservative`);
  console.log(`     newly-appeared test (the score channel's own rule for a missing prior) yields that many.`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
