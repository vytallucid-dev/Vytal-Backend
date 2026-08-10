// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 4 · RECON (read-only, NO writes). Every premise in the step-4 prompt, measured before anything
// is built. Nothing here changes state; it exists so the implementation is aimed at the real numbers.
//
//   §1  the stale filing-rule rows on each head snapshot — per stock, per key
//   §2  the reconciliation: does the filing channel carry the same (stock, rule), same fired state?
//   §3  what PS1 reads today (red-flag severities on head snapshots) and what survives the move
//   §4  what stock_findings would give PS1 instead — all stocks, and HELD stocks specifically
//   §5  the alert population: finding alerts by key, on scored vs unscored stocks
//   §6  R1 standing on the 409 — held / watchlisted / neither
//   §7  score_red_flags: total, R1's share, and what still writes to it
//
//   npx tsx src/scripts/filing-step4-recon.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { resolveHeadSnapshots } from "../scoring/read/head-snapshot.js";
import { dropRetiredFlags, dropRetiredPatterns } from "../catalogue/retired-findings.js";
import { dropNotCoveredPatterns } from "../catalogue/not-covered.js";

const FILING_KEYS = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey));
const pad = (s: string, n: number) => s.padEnd(n);

async function main() {
  console.log("════════ STEP 4 · RECON ════════\n");

  // ── head snapshots, resolved the canonical way (read/head-snapshot.ts) ──
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly" },
    select: { id: true, stockId: true, periodKey: true, version: true, asOfDate: true, labelBand: true },
  });
  const head = resolveHeadSnapshots(snaps);
  const headIds = [...head.values()].map((h) => h.id);
  const stockByHeadId = new Map([...head.entries()].map(([stockId, h]) => [h.id, stockId]));

  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const symById = new Map(stocks.map((s) => [s.id, s.symbol]));

  const [flags, patterns] = await Promise.all([
    prisma.redFlag.findMany({ where: { snapshotId: { in: headIds } }, select: { snapshotId: true, flagKey: true, severity: true } }),
    prisma.scorePattern.findMany({ where: { snapshotId: { in: headIds } }, select: { snapshotId: true, patternKey: true, severity: true } }),
  ]);

  // The rows a reader would actually be served today: retirement + not-covered + lens_ suppression.
  const servedFlags = dropRetiredFlags(flags);
  const servedPats = dropNotCoveredPatterns(dropRetiredPatterns(patterns)).filter((p) => !p.patternKey.startsWith("lens_"));

  type Served = { stockId: string; key: string; kind: "red_flag" | "pattern"; severity: string | null };
  const served: Served[] = [
    ...servedFlags.map((f) => ({ stockId: stockByHeadId.get(f.snapshotId)!, key: f.flagKey, kind: "red_flag" as const, severity: f.severity })),
    ...servedPats.map((p) => ({ stockId: stockByHeadId.get(p.snapshotId)!, key: p.patternKey, kind: "pattern" as const, severity: p.severity })),
  ].filter((r) => r.stockId);

  const staleRows = served.filter((r) => FILING_KEYS.has(r.key));
  const staleStocks = new Set(staleRows.map((r) => r.stockId));

  console.log(`── §1 · the score channel's filing-rule rows, on head snapshots ──`);
  console.log(`  scored stocks (head resolved): ${head.size}`);
  console.log(`  served score-channel rows total: ${served.length}   of which FILING keys: ${staleRows.length}`);
  console.log(`  stocks affected: ${staleStocks.size}`);
  const byKey = new Map<string, number>();
  for (const r of staleRows) byKey.set(r.key, (byKey.get(r.key) ?? 0) + 1);
  [...byKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`    ${pad(k, 44)} x${c}`));

  // ── §2 · the reconciliation ──
  const findingRows = await prisma.stockFinding.findMany({
    where: { stockId: { in: [...staleStocks] } },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, evaluationState: true, standingState: true, periodKey: true, severity: true },
  });
  const currentBy = new Map<string, (typeof findingRows)[number]>();
  for (const r of findingRows) {
    const k = `${r.stockId}|${r.ruleKey}`;
    if (!currentBy.has(k)) currentBy.set(k, r);
  }

  console.log(`\n── §2 · every stale row, reconciled against the filing channel ──`);
  const tally = { fired: 0, not_fired: 0, not_evaluable: 0, absent: 0 };
  const disagreements: string[] = [];
  const gone: string[] = [];
  for (const r of staleRows) {
    const cur = currentBy.get(`${r.stockId}|${r.key}`);
    if (!cur) { tally.absent++; gone.push(`${symById.get(r.stockId)} ${r.key} — NO ROW in stock_findings`); continue; }
    tally[cur.evaluationState as keyof typeof tally]++;
    if (cur.evaluationState !== "fired") {
      disagreements.push(`${pad(symById.get(r.stockId) ?? "?", 12)} ${pad(r.key, 44)} score=fired  filing=${cur.evaluationState}${cur.evaluationState === "not_evaluable" ? "" : ""} (${cur.periodKey})`);
    }
  }
  console.log(`  filing channel says FIRED         : ${tally.fired}`);
  console.log(`  filing channel says NOT_FIRED     : ${tally.not_fired}`);
  console.log(`  filing channel says NOT_EVALUABLE : ${tally.not_evaluable}`);
  console.log(`  filing channel has NO ROW at all  : ${tally.absent}`);
  if (disagreements.length) {
    console.log(`\n  ⚠ FIRED-STATE DISAGREEMENTS (${disagreements.length}):`);
    disagreements.forEach((d) => console.log(`    ${d}`));
  }
  if (gone.length) {
    console.log(`\n  ❌ WOULD DISAPPEAR FROM BOTH CHANNELS (${gone.length}):`);
    gone.forEach((g) => console.log(`    ${g}`));
  }

  // ── §3 · what PS1 reads today ──
  console.log(`\n── §3 · PS1's input today: red flags on head snapshots ──`);
  const sevOf = (s: string | null) => (s ?? "").toLowerCase();
  const psGrade = (s: string | null) => ["critical", "high"].includes(sevOf(s));
  const flagRows = served.filter((r) => r.kind === "red_flag");
  console.log(`  red-flag rows served on heads: ${flagRows.length}   PS1-grade (critical/high): ${flagRows.filter((r) => psGrade(r.severity)).length}`);
  const flagByKey = new Map<string, number>();
  for (const r of flagRows) flagByKey.set(`${r.key} [${sevOf(r.severity) || "null"}]`, (flagByKey.get(`${r.key} [${sevOf(r.severity) || "null"}]`) ?? 0) + 1);
  [...flagByKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`    ${pad(k, 56)} x${c}`));
  const nonFilingFlags = flagRows.filter((r) => !FILING_KEYS.has(r.key));
  console.log(`  red-flag rows whose key is NOT a filing key: ${nonFilingFlags.length}`);

  // ── §4 · what stock_findings offers instead ──
  console.log(`\n── §4 · stock_findings red flags (fired, current row per stock+rule) ──`);
  const allFindings = await prisma.stockFinding.findMany({
    where: { kind: "red_flag" },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, evaluationState: true, severity: true, standingState: true },
  });
  const curFlag = new Map<string, (typeof allFindings)[number]>();
  for (const r of allFindings) { const k = `${r.stockId}|${r.ruleKey}`; if (!curFlag.has(k)) curFlag.set(k, r); }
  const firedFlags = [...curFlag.values()].filter((r) => r.evaluationState === "fired");
  console.log(`  fired red-flag rows across all stocks: ${firedFlags.length} on ${new Set(firedFlags.map((r) => r.stockId)).size} stocks`);
  const ff = new Map<string, number>();
  for (const r of firedFlags) { const k = `${r.ruleKey} [${sevOf(r.severity) || "null"}]`; ff.set(k, (ff.get(k) ?? 0) + 1); }
  [...ff.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`    ${pad(k, 56)} x${c}`));
  console.log(`  PS1-grade (critical/high) among them: ${firedFlags.filter((r) => psGrade(r.severity)).length}`);

  // held stocks
  const held = await prisma.holding.findMany({ where: { stockId: { not: null }, quantity: { gt: 0 } }, select: { stockId: true, userId: true } });
  const heldIds = new Set(held.map((h) => h.stockId!).filter(Boolean));
  console.log(`\n  HELD stocks across all books: ${heldIds.size}`);
  const heldScored = [...heldIds].filter((id) => head.has(id));
  console.log(`    scored: ${heldScored.length}   unscored: ${heldIds.size - heldScored.length}`);
  const heldFired = firedFlags.filter((r) => heldIds.has(r.stockId));
  console.log(`    fired filing red flags on held stocks: ${heldFired.length}  (PS1-grade ${heldFired.filter((r) => psGrade(r.severity)).length})`);
  for (const r of heldFired) console.log(`      ${pad(symById.get(r.stockId) ?? "?", 12)} ${pad(r.ruleKey, 40)} ${sevOf(r.severity)}  scored=${head.has(r.stockId)}`);
  const heldServedFlags = flagRows.filter((r) => heldIds.has(r.stockId));
  console.log(`    score-channel red flags on held stocks TODAY: ${heldServedFlags.length}  (PS1-grade ${heldServedFlags.filter((r) => psGrade(r.severity)).length})`);
  for (const r of heldServedFlags) console.log(`      ${pad(symById.get(r.stockId) ?? "?", 12)} ${pad(r.key, 40)} ${sevOf(r.severity)}  filingKey=${FILING_KEYS.has(r.key)}`);

  // ── §5 · the alert population ──
  console.log(`\n── §5 · alerts ──`);
  const alerts = await prisma.alert.findMany({ select: { id: true, type: true, active: true, findingKey: true, stockId: true } });
  const findingAlerts = alerts.filter((a) => a.type === "finding");
  console.log(`  alerts total: ${alerts.length}   finding alerts: ${findingAlerts.length}   active finding alerts: ${findingAlerts.filter((a) => a.active).length}`);
  for (const a of findingAlerts) {
    console.log(`    ${pad(symById.get(a.stockId) ?? "?", 12)} key=${pad(a.findingKey ?? "(any)", 44)} active=${a.active} scored=${head.has(a.stockId)} filingKey=${a.findingKey ? FILING_KEYS.has(a.findingKey) : "n/a"}`);
  }
  const alertStocks = new Set(alerts.map((a) => a.stockId));
  console.log(`  distinct stocks under ANY alert: ${alertStocks.size}   of which unscored: ${[...alertStocks].filter((id) => !head.has(id)).length}`);

  // ── §6 · R1 on the 409 ──
  console.log(`\n── §6 · R1 standing, and who can see it ──`);
  const r1 = await prisma.stockFinding.findMany({
    where: { ruleKey: "ownership_R1_pledge" },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, evaluationState: true, severity: true, standingState: true, periodKey: true, evidence: true },
  });
  const curR1 = new Map<string, (typeof r1)[number]>();
  for (const r of r1) if (!curR1.has(r.stockId)) curR1.set(r.stockId, r);
  const r1Fired = [...curR1.values()].filter((r) => r.evaluationState === "fired");
  const watch = await prisma.watchlist.findMany({ select: { stockId: true } });
  const watchIds = new Set(watch.map((w) => w.stockId));
  console.log(`  R1 standing on ${r1Fired.length} stocks:`);
  for (const r of r1Fired) {
    const ev = r.evidence as { pledgePct?: number; verdict?: string } | null;
    console.log(`    ${pad(symById.get(r.stockId) ?? "?", 12)} ${pad(sevOf(r.severity), 9)} ${pad(r.periodKey, 10)} scored=${pad(String(head.has(r.stockId)), 5)} held=${pad(String(heldIds.has(r.stockId)), 5)} watched=${watchIds.has(r.stockId)}  ${ev?.pledgePct != null ? ev.pledgePct + "%" : ""}`);
  }

  // ── §7 · score_red_flags overall ──
  console.log(`\n── §7 · score_red_flags, all rows (not only heads) ──`);
  const allRf = await prisma.redFlag.groupBy({ by: ["flagKey"], _count: { _all: true } });
  allRf.sort((a, b) => b._count._all - a._count._all).forEach((r) => console.log(`    ${pad(r.flagKey, 44)} x${r._count._all}  filingKey=${FILING_KEYS.has(r.flagKey)}`));
  const total = allRf.reduce((s, r) => s + r._count._all, 0);
  console.log(`  total rows: ${total}   non-filing keys: ${allRf.filter((r) => !FILING_KEYS.has(r.flagKey)).reduce((s, r) => s + r._count._all, 0)}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
