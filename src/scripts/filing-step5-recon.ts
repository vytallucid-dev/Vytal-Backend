// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 5 · RECON (read-only). The denominator question, measured before anything is built.
//
//   §1  the grain-level populations — how many stocks have an annual / quarterly / shareholding filing
//   §2  the PER-RULE evaluated population — fired + not_fired, which is the only set in which a stock
//       is a CLEAN OBSERVATION. not_evaluable and absent rows are excluded and counted separately.
//   §3  the same 22 rules under the SCORED denominator (95) — the size of the error being fixed
//   §4  the reader side: what the echo census currently counts for filing keys, from frozen rows
//   §5  the 54 unscored pond members, by pond
//
//   npx tsx src/scripts/filing-step5-recon.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { parsePeriodKey } from "../filing/period.js";

const pad = (s: string, n: number) => s.padEnd(n);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  console.log("════════ STEP 5 · RECON ════════\n");

  const active = await prisma.stock.count({ where: { isActive: true } });
  const scoredIds = new Set((await prisma.scoreSnapshot.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId));

  // Current row per (stock, rule).
  const rows = await prisma.stockFinding.findMany({
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, ruleRef: true, evaluationState: true, notEvaluableReason: true, periodKey: true },
  });
  const cur = new Map<string, (typeof rows)[number]>();
  for (const r of rows) { const k = `${r.stockId}|${r.ruleKey}`; if (!cur.has(k)) cur.set(k, r); }
  const current = [...cur.values()];

  // ── §1 · grain populations ──
  console.log("── §1 · which stocks have a filing at each grain ──");
  const byGrainStocks = new Map<string, Set<string>>([["A", new Set()], ["Q", new Set()], ["S", new Set()]]);
  for (const r of current) {
    const g = parsePeriodKey(r.periodKey)?.grain;
    if (g) byGrainStocks.get(g)!.add(r.stockId);
  }
  for (const [g, label] of [["A", "annual accounts"], ["Q", "quarterly results"], ["S", "shareholding filing"]] as const) {
    const n = byGrainStocks.get(g)!.size;
    console.log(`  ${pad(label, 22)} ${String(n).padStart(3)} of ${active} stocks have one   (${active - n} do not)`);
  }

  // ── §2 · per-rule evaluated population ──
  console.log("\n── §2 · the PER-RULE evaluated population (fired + not_fired) ──");
  console.log(`  ${pad("rule", 6)}${pad("key", 44)}${pad("grain", 7)}${"fired".padStart(6)}${"clean".padStart(7)}${"EVAL".padStart(6)}${"decl".padStart(6)}${"norow".padStart(7)}   rate`);
  const totals: { key: string; ref: string; grain: string; fired: number; clean: number; declined: number; noRow: number }[] = [];
  for (const e of FILING_REGISTRY) {
    let fired = 0, clean = 0, declined = 0;
    for (const r of current) {
      if (r.ruleKey !== e.ruleKey) continue;
      if (r.evaluationState === "fired") fired++;
      else if (r.evaluationState === "not_fired") clean++;
      else declined++;
    }
    const noRow = active - (fired + clean + declined);
    const evaluated = fired + clean;
    totals.push({ key: e.ruleKey, ref: e.ruleRef, grain: e.grain, fired, clean, declined, noRow });
    console.log(
      `  ${pad(e.ruleRef, 6)}${pad(e.ruleKey, 44)}${pad(e.grain, 7)}${String(fired).padStart(6)}${String(clean).padStart(7)}` +
      `${String(evaluated).padStart(6)}${String(declined).padStart(6)}${String(noRow).padStart(7)}   ${evaluated > 0 ? pct(fired / evaluated) : "n/a"}`,
    );
  }

  // How many stocks are declined by the industry guards, on any rule?
  const industryDeclined = new Set(current.filter((r) => r.notEvaluableReason === "industry_not_applicable").map((r) => r.stockId));
  console.log(`\n  stocks declined by an INDUSTRY guard on at least one rule: ${industryDeclined.size}`);
  const reasons = new Map<string, number>();
  for (const r of current) if (r.evaluationState === "not_evaluable") reasons.set(r.notEvaluableReason ?? "?", (reasons.get(r.notEvaluableReason ?? "?") ?? 0) + 1);
  [...reasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`    ${pad(k, 40)} x${c}`));

  // ── §3 · the error being fixed ──
  console.log("\n── §3 · the same rules under the SCORED denominator ──");
  console.log(`  scored universe: ${scoredIds.size}`);
  console.log(`  ${pad("rule", 6)}${"scoredNum".padStart(10)}${"scoredRate".padStart(11)}   ${"filingNum".padStart(10)}${"filingDen".padStart(10)}${"filingRate".padStart(11)}   shift`);
  const ENV = 0.30;
  for (const t of totals) {
    const scoredFired = current.filter((r) => r.ruleKey === t.key && r.evaluationState === "fired" && scoredIds.has(r.stockId)).length;
    const scoredRate = scoredIds.size > 0 ? scoredFired / scoredIds.size : 0;
    const den = t.fired + t.clean;
    const rate = den > 0 ? t.fired / den : 0;
    const wasEnv = scoredRate >= ENV, isEnv = rate >= ENV;
    console.log(
      `  ${pad(t.ref, 6)}${String(scoredFired).padStart(10)}${pct(scoredRate).padStart(11)}   ${String(t.fired).padStart(10)}${String(den).padStart(10)}${pct(rate).padStart(11)}   ` +
      `${wasEnv === isEnv ? "" : wasEnv ? "UE6 -> UE1" : "UE1 -> UE6"}`,
    );
  }

  // ── §4 · the reader side ──
  console.log("\n── §4 · what the echo census counts for filing keys today (frozen score_patterns rows) ──");
  const users = await prisma.holding.findMany({ where: { stockId: { not: null }, quantity: { gt: 0 } }, select: { userId: true }, distinct: ["userId"] });
  for (const u of users) {
    const rows2 = await prisma.$queryRaw<{ patternKey: string; n: bigint }[]>`
      WITH held AS (SELECT DISTINCT stock_id FROM holdings WHERE user_id = ${u.userId} AND stock_id IS NOT NULL AND quantity > 0),
      head AS (SELECT DISTINCT ON (s.stock_id) s.id, s.stock_id FROM score_snapshots s JOIN held h ON h.stock_id = s.stock_id ORDER BY s.stock_id, s.period_key DESC, s.version DESC)
      SELECT p.pattern_key AS "patternKey", count(DISTINCT head.stock_id)::bigint AS n
      FROM head JOIN score_patterns p ON p.snapshot_id = head.id GROUP BY p.pattern_key`;
    const filingKeys = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey));
    const mine = rows2.filter((r) => filingKeys.has(r.patternKey));
    console.log(`  book ${u.userId.slice(0, 8)}… — filing keys seen via frozen snapshots: ${mine.map((m) => `${m.patternKey}×${Number(m.n)}`).join(", ") || "(none)"}`);
  }

  // ── §5 · unscored pond members ──
  console.log("\n── §5 · pond members with no score ──");
  const pgRows = await prisma.stockPeerGroup.findMany({
    select: { peerGroupId: true, stockId: true, peerGroup: { select: { displayName: true } }, stock: { select: { symbol: true } } },
  });
  const byPg = new Map<string, { name: string; total: number; unscored: string[] }>();
  for (const r of pgRows) {
    const e = byPg.get(r.peerGroupId) ?? { name: r.peerGroup.displayName, total: 0, unscored: [] };
    e.total++;
    if (!scoredIds.has(r.stockId)) e.unscored.push(r.stock.symbol);
    byPg.set(r.peerGroupId, e);
  }
  let totalUnscored = 0, pondsAffected = 0;
  [...byPg.values()].sort((a, b) => b.unscored.length - a.unscored.length).forEach((p) => {
    if (!p.unscored.length) return;
    pondsAffected++; totalUnscored += p.unscored.length;
    console.log(`  ${pad(p.name, 34)} ${String(p.unscored.length).padStart(2)}/${p.total} unscored: ${p.unscored.join(", ")}`);
  });
  console.log(`  ponds with at least one unscored member: ${pondsAffected} of ${byPg.size}   unscored members total: ${totalUnscored}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
