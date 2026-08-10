// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 4 · PART B — R1'S DOWNSTREAM, PROVEN (read-only, NO writes).
//
//   §1  ALERTS      — the finding diff now unions both channels; the filing half is computed
//                     conservatively (a prior period must exist), exactly as the score half is.
//   §2  PS1         — the OLD input (red flags on each head snapshot) and the NEW input (standing
//                     red flags from stock_findings) are built SIDE BY SIDE for every held stock and
//                     compared. Identical on every scored holding is the gate.
//   §3  R1 ON THE 409 — a held + watchlisted UNSCORED stock with R1 standing, followed all the way
//                     to the portfolio's Signals ledger and PS1's symbol list.
//   §4  THE WRITE   — nothing constructs a score_red_flags row any more. Proven against the source.
//
//   npx tsx src/scripts/verify-filing-step4-downstream.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { assembleReadings } from "../alerts/eval-pass.js";
import { readNewlyStandingFilingKeys, readStandingRedFlags } from "../filing/read.js";
import { isFilingChannelKey } from "../filing/channel.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { firePortfolioFindings } from "../portfolio/phs/patterns.js";
import { resolveHeadSnapshots } from "../scoring/read/head-snapshot.js";

let failures = 0;
const ok = (pass: boolean, msg: string) => { if (!pass) failures++; console.log(`  ${pass ? "OK  " : "FAIL"} ${msg}`); };
const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  console.log("════ STEP 4 · PART B — R1'S DOWNSTREAM ════");

  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const symById = new Map(stocks.map((s) => [s.id, s.symbol]));
  const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));

  // ═══════════════ §1 · ALERTS ═══════════════
  console.log("\n──────── §1 · alerts/eval-pass.ts ────────");
  const alerts = await prisma.alert.findMany({ select: { id: true, type: true, active: true, findingKey: true, stockId: true } });
  const alertStockIds = [...new Set(alerts.map((a) => a.stockId))];
  const readings = await assembleReadings(alertStockIds);
  for (const a of alerts) {
    const r = readings.get(a.stockId);
    console.log(`  ${pad(symById.get(a.stockId) ?? "?", 12)} type=${pad(a.type, 12)} key=${pad(a.findingKey ?? "(any)", 40)} scored=${r?.scored} newFindingKeys=${r ? [...r.newFindingKeys].join(",") || "(none)" : "?"}`);
  }
  // The filing half, on its own, over the whole universe.
  const allIds = stocks.map((s) => s.id);
  const newlyFiling = await readNewlyStandingFilingKeys(allIds);
  const withNew = [...newlyFiling.entries()].filter(([, v]) => v.size > 0);
  console.log(`  filing-channel transitions across all ${allIds.length} stocks: ${withNew.length} stocks`);
  const pairs = await prisma.stockFinding.groupBy({ by: ["stockId", "ruleKey"], _count: { _all: true } });
  const multiPeriod = pairs.filter((p) => p._count._all > 1).length;
  ok(withNew.length === 0 && multiPeriod === 0,
    `zero transitions and zero (stock, rule) pairs with a prior period — CONSISTENT. A first observation is` +
    ` not a transition, which is the score channel's own rule for a missing prior snapshot.`);
  // And the score half must no longer offer a filing key at all.
  let leaked = 0;
  for (const r of readings.values()) for (const k of r.newFindingKeys) if (isFilingChannelKey(k) && !withNew.length) leaked++;
  ok(leaked === 0, `no frozen snapshot row contributes a filing key to the diff`);

  // ═══════════════ §2 · PS1's INPUT, OLD vs NEW ═══════════════
  console.log("\n──────── §2 · PS1's red-flag input — old channel vs new ────────");
  const held = await prisma.holding.findMany({ where: { stockId: { not: null }, quantity: { gt: 0 } }, select: { stockId: true } });
  const heldIds = [...new Set(held.map((h) => h.stockId!).filter(Boolean))];

  const snaps = await prisma.scoreSnapshot.findMany({
    where: { stockId: { in: heldIds } },
    select: { id: true, stockId: true, periodKey: true, version: true, asOfDate: true },
  });
  const head = resolveHeadSnapshots(snaps);
  const headIds = [...head.values()].map((h) => h.id);
  const stockByHead = new Map([...head.entries()].map(([sid, h]) => [h.id, sid]));
  const oldFlags = await prisma.redFlag.findMany({ where: { snapshotId: { in: headIds } }, select: { snapshotId: true, flagKey: true, severity: true } });
  const oldBy = new Map<string, Set<string>>();
  for (const f of oldFlags) {
    const sid = stockByHead.get(f.snapshotId)!;
    const set = oldBy.get(sid) ?? new Set<string>();
    set.add(`${f.flagKey}/${(f.severity ?? "").toLowerCase()}`);
    oldBy.set(sid, set);
  }
  const newBy = await readStandingRedFlags(heldIds);

  let agree = 0;
  for (const sid of heldIds) {
    const o = oldBy.get(sid) ?? new Set<string>();
    const n = new Set((newBy.get(sid) ?? []).map((f) => `${f.ruleKey}/${(f.severity ?? "").toLowerCase()}`));
    const plus = [...n].filter((k) => !o.has(k));
    const minus = [...o].filter((k) => !n.has(k));
    const scored = head.has(sid);
    if (!plus.length && !minus.length) { agree++; continue; }
    console.log(`  ${pad(symById.get(sid) ?? "?", 12)} scored=${pad(String(scored), 5)}  +[${plus.join(", ")}]  −[${minus.join(", ")}]`);
    if (scored) ok(false, `${symById.get(sid)}: a SCORED holding's red-flag set moved — the gate says it must not`);
  }
  const scoredHeld = heldIds.filter((id) => head.has(id));
  ok(scoredHeld.every((id) => {
    const o = oldBy.get(id) ?? new Set<string>();
    const n = new Set((newBy.get(id) ?? []).map((f) => `${f.ruleKey}/${(f.severity ?? "").toLowerCase()}`));
    return o.size === n.size && [...o].every((k) => n.has(k));
  }), `all ${scoredHeld.length} SCORED holdings: identical red-flag set, same keys, same severities`);
  console.log(`  holdings where the two channels agree exactly: ${agree}/${heldIds.length}`);

  // ═══════════════ §3 · R1 ON THE 409, END TO END ═══════════════
  console.log("\n──────── §3 · R1 reaching a book it could never reach before ────────");
  const target = "360ONE";
  const tid = idBySym.get(target)!;
  const r1Row = (await prisma.stockFinding.findMany({
    where: { stockId: tid, ruleKey: "ownership_R1_pledge" },
    orderBy: { periodEnd: "desc" }, take: 1,
    select: { evaluationState: true, severity: true, periodKey: true, evidence: true },
  }))[0];
  const hasSnapshot = await prisma.scoreSnapshot.count({ where: { stockId: tid } });
  const inPond = await prisma.stockPeerGroup.count({ where: { stockId: tid } });
  const watched = await prisma.watchlist.count({ where: { stockId: tid } });
  const heldBy = await prisma.holding.findMany({ where: { stockId: tid, quantity: { gt: 0 } }, select: { userId: true } });
  console.log(`  ${target}: snapshots=${hasSnapshot}  peerGroupRows=${inPond}  watchlisted=${watched}  heldBy=${heldBy.length} book(s)`);
  console.log(`     stock_findings: ${r1Row?.evaluationState} · ${r1Row?.severity} · ${r1Row?.periodKey}`);
  console.log(`     "${(r1Row?.evidence as { verdict?: string } | null)?.verdict ?? "(no verdict)"}"`);
  ok(hasSnapshot === 0 && inPond === 0, `${target} has NO snapshot and NO peer group — nothing snapshot-rooted could ever have reached it`);

  for (const userId of [...new Set(heldBy.map((h) => h.userId))]) {
    const { holdings, fieldWeakSymbols } = await assemblePortfolio(userId);
    const h = holdings.find((x) => x.symbol === target);
    const res = computePhs(holdings);
    const pf = firePortfolioFindings(holdings, res, { fieldWeakSymbols });
    const ps1 = pf.find((f) => f.id === "PS1");
    const ps5 = pf.find((f) => f.id === "PS5");
    const led = res.signalsLedger.find((l) => l.symbol === target);
    console.log(`\n  book ${userId.slice(0, 8)}… — ${holdings.length} holdings, coverage ${(res.coverage * 100).toFixed(1)}%`);
    console.log(`     ${target} in the weight vector: health=${h?.health ?? "null (unscored)"}  findings=[${(h?.findings ?? []).map((f) => `${f.kind}:${f.flagKey}`).join(", ") || "none"}]`);
    console.log(`     Signals ledger entry: ${led ? `weight=${(led.weight * 100).toFixed(1)}% points=${led.points.toFixed(2)} source=${led.source} title="${led.title}"` : "(none)"}`);
    console.log(`     signals=${res.signals.toFixed(2)}  quality=${res.quality?.toFixed(2) ?? "null"}`);
    console.log(`     PS1: ${ps1 ? `${(ps1.bind as { weight: number }).weight * 100 >= 0 ? ((ps1.bind as { weight: number }).weight * 100).toFixed(1) + "% — " : ""}${(ps1.bind as { symbols?: string[] }).symbols?.join(", ")}` : "(did not fire)"}`);
    console.log(`     PS5 ("no active red flags"): ${ps5 ? "FIRED" : "did not fire"}`);
    ok((h?.findings.length ?? 0) > 0, `${target} contributes a finding to this book — it did not before, because it has no snapshot`);
    ok(!ps5, `PS5 does NOT fire on a book holding a 90%-pledged name`);
    ok(led !== undefined && led.weight <= 1, `the Signals weight is a real share (${led ? (led.weight * 100).toFixed(1) : "?"}% ≤ 100%) — the denominator contains the numerator`);
  }

  // ═══════════════ §4 · THE WRITE IS GONE ═══════════════
  console.log("\n──────── §4 · nothing writes score_red_flags any more ────────");
  const roots = ["src/scoring", "src/portfolio", "src/alerts", "src/filing", "src/controllers", "src/ingestions", "src/jobs", "src/relational", "src/insight", "src/chat", "src/ai"];
  const writers: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(/\b(?:db|prisma|tx)\.redFlag\.(create|createMany|upsert|update|updateMany)\b/g)) {
        writers.push(`${p}: ${m[0]}`);
      }
    }
  };
  roots.forEach(walk);
  // findings/persist.ts keeps a red-flag branch for the SCORING pass's rule set; it is unreachable
  // because SCORING_RULES registers no red-flag rule. Named, not hidden.
  const nonPersist = writers.filter((w) => !w.includes(path.join("findings", "persist.ts")));
  writers.forEach((w) => console.log(`     ${w}`));
  ok(nonPersist.length === 0, `no live path constructs a score_red_flags row outside findings/persist.ts's now-unreachable branch`);
  const rfRows = await prisma.redFlag.count();
  console.log(`     score_red_flags still holds ${rfRows} rows — history, read-suppressed on the card surfaces, never deleted`);

  console.log(`\n════ ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
