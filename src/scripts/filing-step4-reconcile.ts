// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 4 · PART A — THE RECONCILIATION GATE (read-only, NO writes).
//
// The gate is NOT "the count went down". It is: every finding the score channel stops serving is
// present in the FILING channel, same rule, same fired state — net zero information loss, one card
// where there were two. A finding that exists in neither channel after the filter fails the run.
//
// ── HOW BEFORE AND AFTER ARE BOTH REAL ───────────────────────────────────────────────────────────
// Not derived arithmetic. `scripts/lib/health-view-baseline.ts` reads the LIVE service, reverts
// step 4's four edits (import, comment block, two wrapped calls), renames the entry point, and writes
// the result beside the original. Both versions then run over the same 95 stocks against the same
// database in the same process, and the copy is deleted on exit. Any difference is attributable to
// the filter and to nothing else.
//
//   §A  every scored stock: what the score channel stopped serving, reconciled row by row
//   §B  the card count per affected stock, before and after, from the two live renders
//   §C  no section OTHER than findings.redFlags / findings.patterns may move, on any of the 95
//   §D  the filter reads the REGISTRY — asserted against filing/registry.ts, not a literal list
//
//   npx tsx src/scripts/filing-step4-reconcile.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { generateStep4Baseline, STEP4_BASELINE_PATH } from "./lib/health-view-baseline.js";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import { readFilingFindings } from "../filing/read.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { isFilingChannelKey, filingChannelKeys } from "../filing/channel.js";
import type { HealthSnapshotView } from "../scoring/read/health-view.types.js";

function stable(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === "object") {
    const src = v as Record<string, unknown>;
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) o[k] = stable(src[k]);
    return o;
  }
  return v;
}
const s = (v: unknown) => JSON.stringify(stable(v));
const pad = (x: string, n: number) => x.padEnd(n);

type Findings = { redFlags: { flagKey: string }[]; patterns: { patternKey: string }[] } | null;
const keysOf = (f: Findings): string[] => [
  ...(f?.redFlags ?? []).map((r) => r.flagKey),
  ...(f?.patterns ?? []).map((p) => p.patternKey),
];

async function main() {
  fs.writeFileSync(STEP4_BASELINE_PATH, generateStep4Baseline());
  const url = "file://" + path.resolve(STEP4_BASELINE_PATH).split(path.sep).join("/");
  const mod = (await import(url)) as {
    buildHealthSnapshotViewBASELINE: (s: string, w: number) => Promise<HealthSnapshotView | null>;
  };
  const before = mod.buildHealthSnapshotViewBASELINE;

  // ── §D · the predicate's source ──
  console.log("── §D · the filter's source of truth ──");
  const regKeys = FILING_REGISTRY.map((e) => e.ruleKey).sort();
  const chanKeys = filingChannelKeys();
  const identical = s(regKeys) === s(chanKeys);
  console.log(`  filing/channel.ts keys === FILING_REGISTRY keys : ${identical ? "YES" : "NO"} (${chanKeys.length} keys)`);
  console.log(`  a literal list would drift the first time a rule moves passes; this one cannot.`);

  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const idBySym = new Map(stocks.map((st) => [st.symbol, st.id]));
  const scored = await prisma.scoreSnapshot.findMany({ select: { symbol: true }, distinct: ["symbol"], orderBy: { symbol: "asc" } });
  const symbols = scored.map((r) => r.symbol);

  const scoredIds = symbols.map((sym) => idBySym.get(sym)!).filter(Boolean);
  const filingBy = await readFilingFindings(scoredIds);

  // The CURRENT stock_findings row per (stock, rule) — the fired STATE, not just the fired set, so a
  // removed row whose filing-channel twin says not_fired / not_evaluable can be reported as a
  // disagreement rather than silently counted as an orphan.
  const rawRows = await prisma.stockFinding.findMany({
    where: { stockId: { in: scoredIds } },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, evaluationState: true, periodKey: true, notEvaluableReason: true },
  });
  const currentRow = new Map<string, (typeof rawRows)[number]>();
  for (const r of rawRows) { const k = `${r.stockId}|${r.ruleKey}`; if (!currentRow.has(k)) currentRow.set(k, r); }

  console.log(`\n── §A/§B · ${symbols.length} scored stocks, before vs after ──`);
  const problems: string[] = [];
  const orphans: string[] = [];
  /** Stocks where the filing channel firing correctly withdrew the score channel's quiet line. */
  const quietWithdrawn: string[] = [];
  const disagreements: string[] = [];
  let affected = 0, removedTotal = 0, sectionMoves = 0, unchanged = 0;
  const removedByKey = new Map<string, number>();
  const perStock: string[] = [];

  for (const sym of symbols) {
    const [now, was] = await Promise.all([buildHealthSnapshotView(sym, 12), before(sym, 12)]);
    if (!now || !was) { problems.push(`${sym}: view did not resolve`); continue; }

    const afterKeys = keysOf(now.findings as Findings);
    const beforeKeys = keysOf(was.findings as Findings);
    const removed = beforeKeys.filter((k) => !afterKeys.includes(k) || afterKeys.filter((a) => a === k).length < beforeKeys.filter((b) => b === k).length);
    const gained = afterKeys.filter((k) => !beforeKeys.includes(k));

    // ── §C · nothing but the findings arrays may move ──
    const nowRec = now as unknown as Record<string, unknown>;
    const wasRec = was as unknown as Record<string, unknown>;
    for (const k of Object.keys(wasRec)) {
      if (k === "findings") continue;
      if (s(nowRec[k]) !== s(wasRec[k])) { problems.push(`${sym}: section "${k}" MOVED`); sectionMoves++; }
    }
    // Inside `findings`, only redFlags/patterns may differ — and `quietNote`, under ONE condition.
    //
    // ⚠ THE QUIET CLAUSE IS PART OF THIS STEP, SO THE BASELINE DOES NOT HAVE IT. Step 4 added a third
    //   condition to `findings.quietNote`: the page is not quiet if the FILING channel is firing. The
    //   baseline reverts that along with everything else, so on any stock where the score channel is
    //   silent and the filing channel is not, the two versions legitimately disagree — the baseline
    //   renders "quiet means nothing tested reliable here" beside a fired filing card, and the live
    //   one withdraws it. That is the clause working, and forbidding it here would fail the gate for
    //   doing what it was built to do.
    //
    //   It is checked rather than waved through: the difference is allowed ONLY in that exact shape
    //   (live null, baseline non-null, score channel empty, filing channel firing). Any other
    //   quietNote movement is still a failure.
    //
    //   Step 6 is what made this fire. H's window was ending at the shareholding as-on date instead
    //   of the evaluation date; correcting it turned H on for 39 more stocks, and BAJAJ-AUTO is one
    //   whose score channel is completely silent — so it became the first stock where the two
    //   versions of the quiet line differ.
    const nf = (now.findings ?? {}) as Record<string, unknown>;
    const wf = (was.findings ?? {}) as Record<string, unknown>;
    const filingFires = (now.filingFindings?.fired.length ?? 0) > 0;
    const scoreSilent = (now.findings?.patterns.length ?? 0) === 0 && (now.findings?.notCovered.length ?? 0) === 0;
    for (const k of Object.keys(wf)) {
      if (k === "redFlags" || k === "patterns") continue;
      if (s(nf[k]) === s(wf[k])) continue;
      const legalQuiet = k === "quietNote" && nf[k] === null && wf[k] !== null && filingFires && scoreSilent;
      if (legalQuiet) { quietWithdrawn.push(sym); continue; }
      problems.push(`${sym}: findings.${k} MOVED`); sectionMoves++;
    }

    if (gained.length) problems.push(`${sym}: the filter ADDED [${gained}] — it may only remove`);
    if (!removed.length) { unchanged++; continue; }
    affected++;
    removedTotal += removed.length;

    // ── §A · every removed key must be live in the FILING channel, FIRED ──
    const filing = filingBy.get(idBySym.get(sym)!) ?? null;
    const firedKeys = new Set((filing?.fired ?? []).map((f) => f.ruleKey));
    const declined = new Set((filing?.declined ?? []).map((d) => d.capability));
    for (const k of removed) {
      if (!isFilingChannelKey(k)) {
        problems.push(`${sym}: removed [${k}] which is NOT a filing key — the filter took something it does not own`);
        continue;
      }
      removedByKey.set(k, (removedByKey.get(k) ?? 0) + 1);
      if (firedKeys.has(k)) continue;
      // Not fired in the filing channel. Two different failures, and they are not the same report.
      const row = currentRow.get(`${idBySym.get(sym)}|${k}`);
      if (!row) {
        // No row at all ⇒ present in NEITHER channel after the filter. The gate's stop condition.
        orphans.push(`${sym}: [${k}] removed from the score channel and has NO row in stock_findings`);
      } else {
        // A row exists and says something else ⇒ the rule's output CHANGED when it moved passes,
        // which steps 2 and 3 should have caught. Reported separately; it needs explaining, not filtering.
        disagreements.push(
          `${pad(sym, 12)} ${pad(k, 44)} score=fired  filing=${row.evaluationState}` +
          `${row.notEvaluableReason ? ` (${row.notEvaluableReason})` : ""}  @${row.periodKey}`,
        );
        orphans.push(`${sym}: [${k}] removed from the score channel; filing channel says ${row.evaluationState}`);
      }
    }

    perStock.push(
      `  ${pad(sym, 12)} cards ${String(beforeKeys.length).padStart(2)} → ${String(afterKeys.length).padStart(2)}  (−${removed.length})` +
      `   filing channel fired ${String(filing?.fired.length ?? 0).padStart(2)}   removed: ${removed.join(", ")}` +
      (declined.size ? "" : ""),
    );
  }

  perStock.forEach((l) => console.log(l));
  if (quietWithdrawn.length) {
    console.log(`
  ★ quiet line WITHDRAWN on ${quietWithdrawn.length} stock(s) — score channel silent, filing channel firing:`);
    console.log(`    ${quietWithdrawn.join(", ")}`);
  }
  console.log(`\n  stocks whose score channel lost rows: ${affected}   rows removed: ${removedTotal}`);
  console.log(`  stocks unchanged: ${unchanged}`);
  [...removedByKey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, c]) => console.log(`    ${pad(k, 44)} x${c}`));

  // ── the two reports the prompt asks for by name ──
  console.log(`\n── findings that would exist in NEITHER channel ──`);
  if (orphans.length === 0) console.log(`  none — every removed finding is FIRED in the filing channel. Net zero information loss.`);
  else orphans.forEach((o) => console.log(`  ❌ ${o}`));

  console.log(`\n── fired-state disagreements between the channels ──`);
  if (disagreements.length === 0) console.log(`  none — no removed row's fired state differs between the two channels.`);
  else disagreements.forEach((d) => console.log(`  ⚠ ${d}`));

  if (problems.length) {
    console.log(`\n── PROBLEMS (${problems.length}) ──`);
    problems.slice(0, 40).forEach((p) => console.log(`  ❌ ${p}`));
  }

  const clean = problems.length === 0 && orphans.length === 0 && sectionMoves === 0 && identical;
  console.log(`\n════ VERDICT: ${clean
    ? "✅ RECONCILED — every removed finding is live and fired in the filing channel; no other section moved on any of the 95"
    : "❌ FAILED — see above"} ════`);
  await prisma.$disconnect();
  process.exit(clean ? 0 : 1);
}

const cleanup = () => { try { fs.unlinkSync(STEP4_BASELINE_PATH); } catch { /* never written / already gone */ } };
process.on("exit", cleanup);
main().catch((e) => { cleanup(); console.error(e); process.exit(1); });
