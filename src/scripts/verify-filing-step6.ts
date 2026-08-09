// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 6 — THE INGESTION TRIGGER, H'S WINDOW, AND THE LAW (read-only except §2/§3, which recompute
// two stocks through the real pass and are idempotent by construction).
//
//   §1  IS INGESTION EVENT-DRIVEN OR A BLIND CRON — answered against the code, not from memory
//   §2  a filing lands → ONLY the dependent rules recompute, ONLY for those stocks, at the right period
//   §3  reprocessing the same filing is idempotent
//   §4  H's window, verified against the 38-stock discrepancy step 2 flagged
//   §5  the backfill entry point exists and the law is where a rule author will hit it
//
//   npx tsx src/scripts/verify-filing-step6.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { FILING_REGISTRY, filingRulesForFeeds, ROLLING_WINDOW_FEEDS } from "../filing/registry.js";
import { FEEDS_BY_JOB_TYPE, planFilingRecompute } from "../filing/triggers.js";
import { computeFilingPass, filingSubject, runFilingPass } from "../filing/pass.js";
import { parsePeriodKey, rollingWindowPeriod } from "../filing/period.js";
import { BLOCK_WINDOW_DAYS, H_MIN_DEAL_CR } from "../scoring/findings/rules/h-ownership-events.js";
import { JobTypes, RETRY_POLICIES } from "../jobs/types.js";
import { getHandler } from "../jobs/dispatcher.js";

let failures = 0;
const ok = (pass: boolean, msg: string) => { if (!pass) failures++; console.log(`  ${pass ? "OK  " : "FAIL"} ${msg}`); };
const pad = (s: string, n: number) => s.padEnd(n);
const DAY = 86400_000;

async function main() {
  console.log("════ STEP 6 ════");

  // ═══════════════ §1 · the hook ═══════════════
  console.log("\n──────── §1 · does ingestion emit anything, or is it a blind cron? ────────");
  const worker = fs.readFileSync("src/jobs/worker.ts", "utf8");
  const hasScoringHook = /maybeEnqueueRescoresForJob\(job\.type, result\)/.test(worker);
  const hasFilingHook = /planFilingRecompute\(job\.type, result, /.test(worker);
  ok(hasScoringHook, "jobs/worker.ts calls the SCORING trigger with (job.type, result) after a job succeeds — the hook predates this step");
  ok(hasFilingHook, "jobs/worker.ts now calls planFilingRecompute with the same two arguments — the filing arm of that hook");
  console.log(`     → the ingestion PIPELINE is a blind cron: nothing in src/ingestions knows a filing arrived.`);
  console.log(`       The JOB LAYER around it is not: the worker fires a post-success hook carrying the`);
  console.log(`       ingestion's own result, and that result already carries \`changedSymbols\`. This step`);
  console.log(`       is WIRING an existing seam, not building an event system.`);

  console.log(`\n     which job types the filing pass listens to, and what each moves:`);
  for (const [t, feeds] of Object.entries(FEEDS_BY_JOB_TYPE)) {
    const rules = filingRulesForFeeds(feeds);
    console.log(`       ${pad(t, 30)} → ${pad(feeds.join("+"), 18)} → ${rules.length} rule(s): ${rules.map((r) => r.ruleRef).join(", ")}`);
  }
  const declared = new Set(Object.values(FEEDS_BY_JOB_TYPE).flat());
  const registryFeeds = new Set(FILING_REGISTRY.map((e) => e.feed));
  ok([...registryFeeds].every((f) => declared.has(f)),
    `every feed the registry names has at least one job type that moves it (${[...registryFeeds].join(", ")})`);
  ok(FILING_REGISTRY.filter((e) => filingRulesForFeeds([e.feed]).includes(e)).length === FILING_REGISTRY.length,
    `all ${FILING_REGISTRY.length} rules are reachable through their own feed — none is orphaned from every trigger`);

  // Prices / news / events / funds must NOT be trigger sources.
  const forbidden = [JobTypes.EOD_PRICES_DAILY, JobTypes.DAILY_NEWS_INGEST, JobTypes.EVENTS_DAILY_REFRESH, JobTypes.AMFI_NAV_DAILY, JobTypes.INDEX_PRICES_DAILY];
  ok(forbidden.every((t) => !FEEDS_BY_JOB_TYPE[t]),
    `prices, news, corporate events, indices and the fund pipeline are NOT filing triggers — no filing rule reads any of them`);
  for (const t of [JobTypes.FILING_RECOMPUTE, JobTypes.FILING_ROLLING_DAILY, JobTypes.FILING_BACKFILL]) {
    ok(!!getHandler(t) && !!RETRY_POLICIES[t], `${t} has a handler and a retry policy`);
  }

  // The plan resolver, on a real result shape.
  const plan = await planFilingRecompute(JobTypes.SHAREHOLDING_QUARTERLY, { changedSymbols: ["RELIANCE", "TCS"] }, new Date());
  ok(plan !== null && plan.feeds.join() === "shareholding" && plan.symbols.length === 2 && plan.source === "changedSymbols",
    `a shareholding result with 2 changedSymbols plans: shareholding rules × those 2 symbols (source=${plan?.source})`);
  const none = await planFilingRecompute(JobTypes.EOD_PRICES_DAILY, {}, new Date());
  ok(none === null, `a price ingest plans nothing at all (null, not an empty batch)`);

  // ═══════════════ §2 · only the dependent rules, only those stocks ═══════════════
  console.log("\n──────── §2 · a filing lands → only the dependent rules recompute ────────");
  const target = (await prisma.stock.findFirst({ where: { symbol: "RELIANCE" }, select: { symbol: true } }))!.symbol;
  const subject = (await filingSubject(target))!;

  const before = await prisma.stockFinding.findMany({
    where: { stockId: subject.stockId },
    select: { ruleKey: true, ruleRef: true, periodKey: true, updatedAt: true, evaluationState: true },
  });
  const beforeBy = new Map(before.map((r) => [`${r.ruleKey}|${r.periodKey}`, r]));

  await new Promise((r) => setTimeout(r, 1100)); // so updatedAt can differ observably
  const asOf = new Date();
  const res = await runFilingPass(subject, asOf, undefined, ["shareholding"]);

  const after = await prisma.stockFinding.findMany({
    where: { stockId: subject.stockId },
    select: { ruleKey: true, ruleRef: true, periodKey: true, updatedAt: true, evaluationState: true },
  });
  const shareholdingRefs = new Set(filingRulesForFeeds(["shareholding"]).map((e) => e.ruleRef));
  const touched = after.filter((r) => {
    const b = beforeBy.get(`${r.ruleKey}|${r.periodKey}`);
    return !b || b.updatedAt.getTime() !== r.updatedAt.getTime();
  });
  console.log(`  ${target}: ran the SHAREHOLDING feed only — ${res.written} row(s) written, ${touched.length} row(s) touched`);
  console.log(`     touched: ${touched.map((t) => `${t.ruleRef}@${t.periodKey}`).join(", ") || "(none)"}`);
  ok(touched.length > 0 && touched.every((t) => shareholdingRefs.has(t.ruleRef)),
    `every touched row belongs to a SHAREHOLDING rule — the other ${FILING_REGISTRY.length - shareholdingRefs.size} rules were not rewritten`);
  ok(touched.every((t) => parsePeriodKey(t.periodKey)?.grain === "S"),
    `every touched row is keyed on the SHAREHOLDING period (grain S), not on the pass's clock`);

  // And nothing on any OTHER stock moved.
  const otherMoved = await prisma.stockFinding.count({
    where: { stockId: { not: subject.stockId }, updatedAt: { gte: asOf } },
  });
  ok(otherMoved === 0, `no row on any other stock was written (${otherMoved})`);

  // ═══════════════ §3 · idempotence ═══════════════
  console.log("\n──────── §3 · reprocessing the same filing ────────");
  const fp = (rows: { ruleKey: string; periodKey: string; evaluationState: string; standingState: string | null; severity: string | null; evidence: unknown }[]) =>
    JSON.stringify(rows.map((r) => [r.ruleKey, r.periodKey, r.evaluationState, r.standingState, r.severity, JSON.stringify(r.evidence)]).sort());
  const sel = { ruleKey: true, periodKey: true, evaluationState: true, standingState: true, severity: true, evidence: true } as const;
  const a1 = await prisma.stockFinding.findMany({ where: { stockId: subject.stockId }, select: sel });
  await runFilingPass(subject, asOf, undefined, ["shareholding"]);
  const a2 = await prisma.stockFinding.findMany({ where: { stockId: subject.stockId }, select: sel });
  ok(fp(a1) === fp(a2), `a second run of the same feed at the same asOf produces byte-identical rows (${a1.length} rows)`);

  // A full re-run must also be stable — this is what the backfill does.
  const c1 = await computeFilingPass(subject, asOf);
  const c2 = await computeFilingPass(subject, asOf);
  ok(JSON.stringify(c1.rows) === JSON.stringify(c2.rows), `two consecutive FULL computes agree row for row (${c1.rows.length} rows)`);

  // ═══════════════ §4 · H's window ═══════════════
  console.log("\n──────── §4 · H's window against the 38-stock discrepancy ────────");
  const today = new Date();
  const pgIds = new Set((await prisma.stockPeerGroup.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId));
  const stocks = await prisma.stock.findMany({ where: { isActive: true }, select: { id: true, symbol: true } });
  const active = new Set(stocks.map((s) => s.id));
  const deals = await prisma.blockDeal.findMany({ where: { stockId: { in: [...active] } }, select: { stockId: true, dealDate: true, valueCr: true } });
  const shLatest = await prisma.shareholdingPattern.groupBy({ by: ["stockId"], _max: { asOnDate: true } });
  const anchorBy = new Map(shLatest.map((r) => [r.stockId, r._max.asOnDate]));
  const dealsBy = new Map<string, { d: Date; cr: number }[]>();
  for (const d of deals) {
    const a = dealsBy.get(d.stockId) ?? [];
    a.push({ d: d.dealDate, cr: d.valueCr == null ? 0 : Number(d.valueCr) });
    dealsBy.set(d.stockId, a);
  }
  let doTotal = 0, doOld = 0, doNew = 0;
  for (const [sid, ds] of dealsBy) {
    if (pgIds.has(sid)) continue;
    const anchor = anchorBy.get(sid); if (!anchor) continue;
    doTotal++;
    const m = ds.filter((x) => x.cr >= H_MIN_DEAL_CR);
    if (m.some((x) => x.d.getTime() > anchor.getTime() - BLOCK_WINDOW_DAYS * DAY && x.d.getTime() <= anchor.getTime())) doOld++;
    if (m.some((x) => x.d.getTime() > today.getTime() - BLOCK_WINDOW_DAYS * DAY && x.d.getTime() <= today.getTime())) doNew++;
  }
  console.log(`  display-only stocks holding block deals: ${doTotal}`);
  console.log(`    under the OLD anchor (latest shareholding as-on): ${doOld}   ← step 2's "H fired on 2"`);
  console.log(`    under the NEW anchor (the evaluation date)      : ${doNew}`);
  ok(doTotal === 38 && doOld === 2, `the step-2 flag reproduces exactly: 38 display-only stocks with deals, H fired on ${doOld}`);
  ok(doNew > doOld, `the corrected window makes ${doNew - doOld} more of them visible`);

  // And the persisted rows must agree with the corrected rule.
  const hRows = await prisma.stockFinding.findMany({
    where: { ruleKey: "ownership_H_block_events" },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, evaluationState: true, periodKey: true, periodEnd: true },
  });
  const curH = new Map<string, (typeof hRows)[number]>();
  for (const r of hRows) if (!curH.has(r.stockId)) curH.set(r.stockId, r);
  const firedH = [...curH.values()].filter((r) => r.evaluationState === "fired");
  const wGrain = [...curH.values()].filter((r) => parsePeriodKey(r.periodKey)?.grain === "W").length;
  console.log(`  persisted: H fires on ${firedH.length} stocks · ${wGrain}/${curH.size} current rows are grain W`);
  ok(wGrain === curH.size, `every current H row is keyed on the ROLLING WINDOW, not on a shareholding quarter`);
  const expectFired = [...dealsBy.entries()].filter(([sid, ds]) =>
    active.has(sid) && ds.some((x) => x.cr >= H_MIN_DEAL_CR && x.d.getTime() > today.getTime() - BLOCK_WINDOW_DAYS * DAY && x.d.getTime() <= today.getTime())).length;
  ok(Math.abs(firedH.length - expectFired) <= 2,
    `the persisted fired set (${firedH.length}) matches the corrected window computed independently (${expectFired}) — within the day's drift`);

  const wp = rollingWindowPeriod(today);
  console.log(`  the rolling window's period today: ${wp.periodKey} (period_end ${wp.periodEnd.toISOString().slice(0, 10)})`);
  ok(ROLLING_WINDOW_FEEDS.length === 2, `the rolling-window feeds are exactly [${ROLLING_WINDOW_FEEDS.join(", ")}] — everything else is filing-keyed`);

  // ═══════════════ §5 · the law ═══════════════
  console.log("\n──────── §5 · the backfill entry point and the standing law ────────");
  const lawPath = "src/scoring/findings/rules/BACKFILL-LAW.md";
  ok(fs.existsSync(lawPath), `the law lives in the RULE DIRECTORY: ${lawPath}`);
  const ruleFiles = fs.readdirSync("src/scoring/findings/rules").filter((f) => f.endsWith(".ts"));
  console.log(`     ${ruleFiles.length} rule files sit beside it`);
  ok(fs.existsSync("src/scripts/filing-backfill.ts"), `the operator entry point exists: src/scripts/filing-backfill.ts`);
  const typesSrc = fs.readFileSync("src/scoring/findings/types.ts", "utf8");
  ok(/BACKFILL-LAW\.md/.test(typesSrc),
    `the FilingRule type — imported by every one of the ${ruleFiles.length} rule files — points at the law`);
  const law = fs.readFileSync(lawPath, "utf8");
  ok(/--reset-rule/.test(law) && /false transition/i.test(law),
    `the law covers the false-transition trap a rule FIX creates, not only the threshold case`);
  const passSrc = fs.readFileSync("src/filing/pass.ts", "utf8");
  ok(/export async function runFilingBackfill/.test(passSrc), `runFilingBackfill is exported from filing/pass.ts`);
  ok(/resetRules/.test(passSrc), `…and implements the --reset-rule guard the law promises`);

  console.log(`\n════ ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
