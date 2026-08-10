// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · STEP 2 — CORRECTNESS PROOF (read-only, NO writes).
//
//   §1  R1 PARITY — the rule vs the pillar, on identical shareholding rows, for every stock and every
//       quarter. Same fired-ness, same severity, same evidence. Then the same comparison against the
//       score_red_flags rows ACTUALLY PERSISTED, because agreeing with the in-memory pillar is worth
//       less than agreeing with what shipped.
//
//   §2  N7's ANTI-DOUBLE-COUNT — verified on REAL cases, not fixtures: stocks whose pledge ratio fell
//       enough to trigger N7 while R1 was standing in the prior quarter. N7 must stay silent. Both
//       rules now answer "was R1 standing?" through the same `r1StandingAt` predicate.
//
//   §3  NO PEER GROUP, NO SNAPSHOT, ROWS ANYWAY — the pass runs on a stock with neither and writes a
//       full row set. This is the whole point of the split, so it is asserted rather than assumed.
//
//   §4  IDEMPOTENCE — computing twice produces identical rows, and standing state does not drift from
//       newly_standing to continuing on a re-run.
//
//   npx tsx src/scripts/verify-filing-pass.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { computePrimaryOwnership } from "../scoring/ownership/primary.js";
import { computePledging, r1StandingAt, R1_SEVERITY } from "../scoring/ownership/pledging.js";
import { ruleR1 } from "../scoring/findings/rules/r1-pledging.js";
import { ruleN7 } from "../scoring/findings/rules/n7-pledge-release.js";
import { isNotEvaluable, type FilingContext } from "../scoring/findings/types.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";
import { computeFilingPass, filingSubject, filingUniverse } from "../filing/pass.js";
import { loadFilingContext } from "../filing/context.js";
import { FILING_REGISTRY } from "../filing/registry.js";

let failures = 0;
const ok = (pass: boolean, msg: string) => { if (!pass) failures++; console.log(`  ${pass ? "OK  " : "FAIL"} ${msg}`); };
const num = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

/** Key-order-independent JSON. Postgres jsonb does NOT preserve insertion order, so a byte compare
 *  against a persisted row fails on ordering alone and says nothing about the values. */
function canon(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (x === null || x === undefined) return null;
    if (Array.isArray(x)) return x.map(walk);
    if (typeof x === "object") {
      const src = x as Record<string, unknown>;
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) o[k] = walk(src[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(walk(v));
}

async function shareholdingFor(stockId: string): Promise<OwnershipQuarter[]> {
  const rows = await prisma.shareholdingPattern.findMany({
    where: { stockId }, orderBy: { asOnDate: "asc" },
    select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true },
  });
  return rows.map((r) => ({
    asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear,
    promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares,
    promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct),
  }));
}

/** A context carrying only shareholding — enough for R1 and N7, which read nothing else. */
const shCtx = (stockId: string, symbol: string, rows: OwnershipQuarter[]): FilingContext => ({
  stockId, symbol, asOfDate: new Date(), industry: "non_financial",
  shareholding: rows, annualFundamentals: [], quarterlyOpm: null, quarterlyResults: [],
  feeds: { insiderTxns: null, blockTxns: null, marketCapInrCr: null },
});

async function main() {
  const universe = await filingUniverse();
  console.log(`════ FILING-PASS CORRECTNESS · ${universe.length} active stocks ════`);

  // ═══════════════════ §1 · R1 — RULE vs PILLAR ═══════════════════
  console.log("\n──────── §1 · R1 PARITY ────────");

  // ── §1a · EXHAUSTIVE: every stock, EVERY quarter, not just the latest ─────────────────────────
  // Comparing only the latest quarter would test one point per stock. Walking every index tests
  // every (stock, quarter) R1 has ever had an opinion about — including quarters where it fired and
  // has since cleared, which is exactly where a divergence between two implementations would hide.
  let compared = 0, agree = 0, bothFired = 0;
  const mismatches: string[] = [];
  const firedNow: string[] = [];
  const shByStock = new Map<string, OwnershipQuarter[]>();

  for (const s of universe) {
    const all = await shareholdingFor(s.stockId);
    shByStock.set(s.stockId, all);
    for (let i = 0; i < all.length; i++) {
      const rows = all.slice(0, i + 1);
      compared++;
      const primary = computePrimaryOwnership(s.symbol, rows);
      const pillarFlag = primary?.redFlags.find((f) => f.flagKey === "ownership_R1_pledge") ?? null;
      // What score_red_flags actually stores: buildOwnershipScoreData merges `reasons` in as
      // `breaches` at the write, so that merge is reproduced here.
      const pillarEvidence = pillarFlag ? canon({ ...pillarFlag.triggeringValues, breaches: pillarFlag.reasons }) : null;

      const r = ruleR1(shCtx(s.stockId, s.symbol, rows));
      const f = r !== null && !isNotEvaluable(r) ? r : null;
      const ruleEvidence = f ? canon(f.evidence) : null;

      const same = !!pillarFlag === !!f && (pillarFlag?.severity ?? null) === (f?.severity ?? null) && pillarEvidence === ruleEvidence;
      if (same) { agree++; if (pillarFlag) bothFired++; }
      else mismatches.push(`${s.symbol} @${rows[i].fiscalYear}${rows[i].quarter}: fired ${!!pillarFlag}/${!!f} | pillar=${pillarEvidence} | rule=${ruleEvidence}`);
      if (i === all.length - 1 && f) firedNow.push(s.symbol);
    }
  }
  ok(mismatches.length === 0, `${agree}/${compared} (stock, quarter) pairs agree EXACTLY — fired-ness + severity + full evidence`);
  mismatches.slice(0, 6).forEach((m) => console.log(`       ${m}`));
  ok(bothFired > 0, `R1 fired in ${bothFired} of those pairs (a comparison with zero fires would prove nothing)`);
  ok(R1_SEVERITY === "critical", `severity is "${R1_SEVERITY}" and comes from the single shared constant`);

  // ── ★ WHAT THE MOVE ACTUALLY BUYS ────────────────────────────────────────────────────────────
  const scoredIds = new Set((await prisma.scoreSnapshot.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((x) => x.stockId));
  const idOf = (sym: string) => universe.find((u) => u.symbol === sym)!.stockId;
  const firedScored = firedNow.filter((sym) => scoredIds.has(idOf(sym)));
  const firedUnscored = firedNow.filter((sym) => !scoredIds.has(idOf(sym)));
  console.log(`\n  R1 standing RIGHT NOW on ${firedNow.length} stock(s):`);
  console.log(`     scored   (${firedScored.length}): ${firedScored.join(", ") || "none"}`);
  console.log(`     UNSCORED (${firedUnscored.length}): ${firedUnscored.join(", ") || "none"}`);
  console.log(`     -> the unscored ones could not hold an R1 row at all before this change:`);
  console.log(`        score_red_flags.snapshot_id is NOT NULL, and they have no snapshot.`);

  // ── §1b · AGAINST WHAT SHIPPED — RETIRED 2026-08-11 ──────────────────────────────────────────
  // This section replayed each PERSISTED score_red_flags R1 row against the shareholding prefix the
  // pillar actually saw, so the rule was checked against what shipped and not only against the
  // in-memory pillar. `score_red_flags` was dropped on 2026-08-11 (every red-flag rule is a filing
  // rule writing to stock_findings), so there is no shipped row left to replay against and the check
  // has no subject. §1a above — the rule vs the pillar on identical rows — is untouched and still the
  // load-bearing parity proof.

  // ═══════════════════ §2 · N7 ANTI-DOUBLE-COUNT ON REAL CASES ═══════════════════
  console.log("\n──────── §2 · N7's ANTI-DOUBLE-COUNT (real data, not fixtures) ────────");
  // Scan every stock, every quarter, for the case the guard exists to catch: N7's trigger is met AND
  // R1 was standing in the prior quarter. N7 must stay silent — that fall CLEARS a standing flag and
  // belongs to Family J (which does not exist yet: a deliberate honest-empty, see the rule header).
  const suppressed: string[] = [];
  const n7Fires: string[] = [];
  for (const s of universe) {
    const all = shByStock.get(s.stockId) ?? [];
    for (let i = 1; i < all.length; i++) {
      const rows = all.slice(0, i + 1);
      const cur = rows[rows.length - 1], prior = rows[rows.length - 2];
      if (cur.pledgedShares === null || prior.pledgedShares === null) continue;
      const cp = computePledging(cur, prior);
      if (cp.pledgeRatioQ === null || cp.pledgeRatioQ1 === null) continue;
      const fallPp = cp.pledgeRatioQ1 - cp.pledgeRatioQ;
      const triggered = fallPp >= 10 || (cp.pledgeRatioQ1 > 50 && cp.pledgeRatioQ < 50);
      if (!triggered) continue;
      const n7 = ruleN7(shCtx(s.stockId, s.symbol, rows));
      const fired = n7 !== null && !isNotEvaluable(n7);
      const label = `${s.symbol} ${prior.fiscalYear}${prior.quarter}->${cur.fiscalYear}${cur.quarter} (${cp.pledgeRatioQ1.toFixed(1)}% -> ${cp.pledgeRatioQ.toFixed(1)}%, fall ${fallPp.toFixed(1)}pp)`;
      if (r1StandingAt(rows, rows.length - 2)) {
        suppressed.push(label);
        ok(!fired, `SUPPRESSED — ${label}: R1 stood in the prior quarter, so N7 stays silent`);
      } else if (fired) {
        n7Fires.push(label);
      }
    }
  }
  ok(suppressed.length > 0, `found ${suppressed.length} REAL case(s) where the guard had to act (a passing test with 0 cases proves nothing)`);
  console.log(`  N7 fired on ${n7Fires.length} real transition(s) where R1 was NOT standing:`);
  n7Fires.slice(0, 8).forEach((l) => console.log(`     ${l}`));

  // ═══════════════════ §3 · NO PEER GROUP, NO SNAPSHOT ═══════════════════
  console.log("\n──────── §3 · THE PASS ON A STOCK WITH NO PEER GROUP AND NO SNAPSHOT ────────");
  const orphan = await prisma.stock.findFirst({
    where: {
      isActive: true,
      peerGroups: { none: {} },
      scoreSnapshots: { none: {} },
      shareholdingPatterns: { some: {} },
      fundamentals: { some: {} },
    },
    orderBy: { symbol: "asc" },
    select: { id: true, symbol: true, industryType: true },
  });
  if (!orphan) {
    ok(false, "no stock found with neither a peer group nor a snapshot — cannot run this check");
  } else {
    const pgCount = await prisma.stockPeerGroup.count({ where: { stockId: orphan.id } });
    const snapCount = await prisma.scoreSnapshot.count({ where: { stockId: orphan.id } });
    ok(pgCount === 0 && snapCount === 0, `${orphan.symbol}: ${pgCount} peer groups, ${snapCount} snapshots — genuinely unscored`);
    const res = await computeFilingPass({ stockId: orphan.id, symbol: orphan.symbol, industry: orphan.industryType }, new Date());
    ok(res.rows.length > 0, `${orphan.symbol}: filing pass produced ${res.rows.length} row(s) with no score anywhere`);
    const states = new Set(res.rows.map((r) => r.evaluationState));
    console.log(`     periods: A=${res.periods.A?.periodKey ?? "—"}  Q=${res.periods.Q?.periodKey ?? "—"}  S=${res.periods.S?.periodKey ?? "—"}`);
    console.log(`     states present: ${[...states].join(", ")}   skipped (no filing at that grain): ${res.skippedNoPeriod.length}`);
  }

  // ═══════════════════ §4 · IDEMPOTENCE ═══════════════════
  console.log("\n──────── §4 · IDEMPOTENCE ────────");
  const probe = await filingSubject("RELIANCE");
  if (probe) {
    const asOf = new Date("2026-08-09");
    const a = await computeFilingPass(probe, asOf);
    const b = await computeFilingPass(probe, asOf);
    const fp = (r: typeof a) => JSON.stringify(r.rows.map((x) => [x.ruleKey, x.periodKey, x.evaluationState, x.standingState, x.notEvaluableReason, x.severity, x.magnitude, canon(x.evidence)]));
    ok(fp(a) === fp(b), `RELIANCE: two consecutive computes produce byte-identical rows (${a.rows.length} rows)`);
    ok(FILING_REGISTRY.length === 22, `the filing registry holds 22 rules (${FILING_REGISTRY.length})`);
    const loaded = await loadFilingContext(probe, asOf);
    ok(!("current" in (loaded.ctx as object)) && !("priorSnapshots" in (loaded.ctx as object)),
      "the filing context carries NO score fields at all (no `current`, no `priorSnapshots`)");
  }

  console.log(`\n════ ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
