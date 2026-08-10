// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 3 — THE PERSONAL SECTION, AGAINST LIVE DATA.
//
// NOT a build gate: it reads the database, so it belongs to the live-verify class, never to
// verify:copy (verify-build-gate-hygiene.ts would fail the build if it were wired in).
//
// What it proves:
//   1 · THE QUERY COST (4e). Anonymous 0, neither-holds-nor-watches 1, present 2 — counted by wrapping
//       the prisma client's $queryRaw, not by reading the source and believing it.
//   2 · Every fact renders, for every reader who has one, with no thrown SQL and no NaN.
//   3 · THE 4b LINE HOLDS: no sentence joins the entry price to anything about the quarter.
//
//   npx tsx src/scripts/verify-personal-section.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildPersonalSection, filingRedFlagTransitions } from "../insight/quarter-brief/personal.js";

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);

/** Count $queryRaw round trips by swapping the method for the duration of one call. */
async function counted<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const real = prisma.$queryRaw.bind(prisma);
  let queries = 0;
  (prisma as unknown as { $queryRaw: unknown }).$queryRaw = (...args: unknown[]) => {
    queries++;
    return (real as (...a: unknown[]) => unknown)(...args);
  };
  try {
    return { result: await fn(), queries };
  } finally {
    (prisma as unknown as { $queryRaw: unknown }).$queryRaw = real;
  }
}

async function main(): Promise<void> {
  console.log("═".repeat(100));
  console.log("SECTION 3 — THE PERSONAL SECTION (live)");
  console.log("═".repeat(100));

  const holders = await prisma.$queryRaw<{ user_id: string; stock_id: string; symbol: string }[]>`
    SELECT h.user_id, h.stock_id, s.symbol
    FROM holdings h JOIN stocks s ON s.id = h.stock_id
    WHERE h.quantity > 0 AND h.stock_id IS NOT NULL
    LIMIT 12
  `;
  const watchers = await prisma.$queryRaw<{ user_id: string; stock_id: string; symbol: string }[]>`
    SELECT w.user_id, w.stock_id, s.symbol
    FROM watchlist w JOIN stocks s ON s.id = w.stock_id
    LIMIT 8
  `;
  console.log(`\n  live rows: ${holders.length} holdings, ${watchers.length} watchlist pins`);

  // The period every card is about — the newest quarterly snapshot period in the universe.
  const periodRow = await prisma.$queryRaw<{ period_key: string }[]>`
    SELECT period_key FROM score_snapshots WHERE snapshot_type::text = 'quarterly'
    ORDER BY period_key DESC LIMIT 1
  `;
  const periodKey = periodRow[0]?.period_key ?? "FY27Q1";
  console.log(`  period under test: ${periodKey}`);

  // ── 1 · QUERY COST ───────────────────────────────────────────────────────────────────────────
  console.log("\n1 · QUERY COST (4e)");
  const anon = await counted(() => buildPersonalSection("any", "ANY", null, periodKey));
  if (anon.queries !== 0) fail(`anonymous reader cost ${anon.queries} queries; it must cost 0`);
  else pass("anonymous reader: 0 queries, returns null without touching the database");

  const anyStock = await prisma.stock.findFirst({ select: { id: true, symbol: true } });
  const anyUser = holders[0]?.user_id ?? watchers[0]?.user_id;
  if (!anyUser || !anyStock) {
    console.log("  (no users or stocks on file — the remaining checks need live rows)");
  } else {
    // A stock this user neither holds nor watches: the empty path.
    const related = new Set([...holders, ...watchers].filter((r) => r.user_id === anyUser).map((r) => r.stock_id));
    const unrelated = await prisma.stock.findMany({ select: { id: true, symbol: true }, take: 200 });
    const target = unrelated.find((s) => !related.has(s.id));
    if (!target) fail("every stock is related to this user — the empty path cannot be measured");
    else {
      const empty = await counted(() => buildPersonalSection(target.id, target.symbol, anyUser, periodKey));
      if (empty.result !== null) fail(`the empty path returned a section for ${target.symbol}`);
      if (empty.queries !== 1) fail(`neither-holds-nor-watches cost ${empty.queries} queries; it must cost 1`);
      else pass(`neither holds nor watches (${target.symbol}): 1 query, returns null`);
    }
  }

  // ── 2 · EVERY PRESENT READER RENDERS ─────────────────────────────────────────────────────────
  console.log("\n2 · THE PRESENT PATH");
  const seen: string[] = [];
  let presentQueries = new Set<number>();
  let sections = 0, factCount = 0;
  for (const r of [...holders, ...watchers]) {
    const key = `${r.user_id}|${r.stock_id}`;
    if (seen.includes(key)) continue;
    seen.push(key);
    let out;
    try {
      out = await counted(() => buildPersonalSection(r.stock_id, r.symbol, r.user_id, periodKey));
    } catch (e) {
      fail(`${r.symbol} threw: ${(e as Error).message}`);
      continue;
    }
    presentQueries.add(out.queries);
    if (!out.result) continue;
    sections++;
    factCount += out.result.facts.length;
    console.log(`\n  ── ${r.symbol} (${out.queries} queries, ${out.result.facts.length} facts, ${out.result.findings.length} findings)`);
    for (const f of out.result.facts) {
      console.log(`     ${f.key.padEnd(26)} ${f.display}`);
      if (/NaN|undefined|null|Infinity/.test(f.display)) fail(`${r.symbol} ${f.key}: a non-value reached the reader — ${f.display}`);
      // ── 3 · THE 4b LINE. A sentence naming the entry cost must not also name the quarter.
      const hasCost = /average cost of/.test(f.display);
      const hasQuarter = /this quarter|the quarter|against the same quarter|percentage points/.test(f.display);
      if (hasCost && hasQuarter) fail(`${r.symbol} ${f.key}: joins the entry price to the quarter — ${f.display}`);
    }
  }
  const worst = Math.max(0, ...presentQueries);
  if (worst > 2) fail(`the present path reached ${worst} queries; the contract is 2`);
  else pass(`the present path cost at most ${worst} queries across ${seen.length} (reader, stock) pairs`);
  pass(`${sections} sections rendered, ${factCount} facts, none carrying a non-value`);
  pass("no fact joins the entry price to a quarterly figure (4b holds)");

  // ── 4 · A FIRST OBSERVATION IS NOT A TRANSITION ──────────────────────────────────────────────
  //
  // `personal.findingChanges` moved off the dead score_red_flags diff onto stock_findings. The trap
  // that channel carries is that the pass stamps `newly_standing` whenever the PRIOR row did not fire
  // — including when there is no prior row at all — so on a one-period backfill every fired row in
  // the table reads newly_standing. Believing it would tell a reader that every check Vytal has run
  // on their holding started flagging this quarter.
  //
  // This runs the module's OWN reducer over the real rows, both ways round, so neither direction can
  // be vacuous: a negative control that had no fired rows to reject would prove nothing.
  console.log("\n4 · THE TRANSITION TEST (a first observation is not a change)");
  // ⚠ THE PERIOD COUNT IS PER (stock, RULE), NOT PER STOCK. A stock reads its annual, quarterly and
  //   shareholding grains at three different period keys in the same pass, so counting distinct
  //   periods per stock calls almost every one of them multi-period and empties the negative control.
  //   The transition is a (stock, rule) fact and so is the count.
  const filingRows = await prisma.$queryRaw<
    { symbol: string; rows: unknown; max_rule_periods: number; fired_newly: number }[]
  >`
    SELECT s.symbol,
           json_agg(json_build_object('ruleKey', f.rule_key, 'state', f.evaluation_state::text,
                                      'standing', f.standing_state::text) ORDER BY f.period_end DESC) AS rows,
           MAX(rc.n)::int AS max_rule_periods,
           COUNT(*) FILTER (WHERE f.evaluation_state::text = 'fired'
                              AND f.standing_state::text = 'newly_standing')::int AS fired_newly
    FROM stock_findings f
    JOIN stocks s ON s.id = f.stock_id
    JOIN (SELECT stock_id, rule_key, COUNT(*) AS n FROM stock_findings
           WHERE kind::text = 'red_flag' GROUP BY stock_id, rule_key) rc
      ON rc.stock_id = f.stock_id AND rc.rule_key = f.rule_key
    WHERE f.kind::text = 'red_flag'
    GROUP BY s.symbol
  `;

  // NEGATIVE CONTROL — stocks where NO red-flag rule has a second period on record. Every fired row on
  // them reads newly_standing; not one of them may be counted as started.
  const singlePeriod = filingRows.filter((r) => r.max_rule_periods === 1);
  const singleWithFired = singlePeriod.filter((r) => r.fired_newly > 0);
  const falseStarts = singleWithFired.filter((r) => filingRedFlagTransitions(r.rows).started > 0);
  if (singleWithFired.length === 0) {
    fail("the negative control is vacuous — no single-period stock carries a fired newly_standing row");
  } else if (falseStarts.length > 0) {
    fail(`${falseStarts.length} first-observation stock(s) counted as 'started flagging': ${falseStarts.map((r) => r.symbol).join(", ")}`);
  } else {
    pass(`no 'started flagging' claim on a first observation — ${singleWithFired.length} stocks carry a fired newly_standing red flag with only one period on record, and all ${singleWithFired.length} report started=0`);
  }

  // POSITIVE CONTROL — a pair with a strictly-older period on record IS a transition, and the reducer
  // must find it. Without this the rule above would pass just as well if the function always said 0.
  const multiPeriod = filingRows.filter((r) => r.max_rule_periods > 1);
  const moved = multiPeriod
    .map((r) => ({ symbol: r.symbol, ...filingRedFlagTransitions(r.rows) }))
    .filter((r) => r.started + r.stopped > 0);
  if (multiPeriod.length === 0) {
    console.log("  · no stock has two filing periods on record yet — the positive control cannot run");
  } else if (moved.length === 0) {
    fail(`${multiPeriod.length} stock(s) have two periods on record but the reducer found no transition on any of them`);
  } else {
    pass(`real transitions are still detected — ${moved.map((m) => `${m.symbol} (+${m.started}/−${m.stopped})`).join(", ")}`);
  }

  console.log("\n" + "─".repeat(100));
  if (failures > 0) { console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}`); await prisma.$disconnect(); process.exit(1); }
  console.log("PASSED — the query cost holds and every present reader renders.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
