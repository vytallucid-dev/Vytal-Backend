// Verification harness for the COMPLETE Ownership pillar (Primary + Flow + clamp).
// DRY-RUN: computes the full decomposition + the would-be write plan and PRINTS —
// commits NOTHING (reads only).
//
//   npx tsx src/scripts/ownership-full-check.ts
//
// Passes:
//   PASS 1 — full pillar at the LATEST snapshot for a curated sample (the real
//            current Ownership), with per-stock A1 price probe.
//   PASS 2 — pattern scan across the universe for A1/A2 (price-conditioned) and
//            B1/B2/B4 and the B4+prolonged-FII −12 case, scored at the quarter
//            each fires (patterns rarely sit at the latest snapshot).
//   FIREWALL / SANITY — C&D dormant on every stock, A3⊥R2, final clamp 40–100.

import { prisma } from "../db/prisma.js";
import { computeOwnership, type OwnershipContext } from "../scoring/ownership/ownership.js";
import { writeOwnershipFull } from "../scoring/ownership/persist.js";
import type { A1PriceEval, FlowFeeds, PriceProbe } from "../scoring/ownership/flow.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";
// CN-1: the 52-week range is the SHARED kernel — A1 and Market call the same fn.
import { rangePositionAsOf, MIN_TRAILING_DAYS, type DailyClose } from "../scoring/price/range.js";

const CURATED = [
  "TCS", "RELIANCE", "HINDUNILVR", "INFY", "ITC", "HDFCBANK", "ASHOKLEY",
  "OBEROIRLTY", "BAJAJ-AUTO", "IDFCFIRSTB", "INDIGO", "WHIRLPOOL", "IDEA", "BIOCON", "MPHASIS",
];

// C & D feeds are NOT wired in this build → both dormant_no_feed.
const DORMANT_FEEDS: FlowFeeds = { insiderTxns: null, blockTxns: null, marketCapInrCr: null };
const NO_PRICE_CTX: OwnershipContext = { priceProbe: null, feeds: DORMANT_FEEDS };

const num = (d: unknown): number | null =>
  d === null || d === undefined
    ? null
    : typeof d === "number"
      ? d
      : typeof (d as { toNumber?: () => number }).toNumber === "function"
        ? (d as { toNumber: () => number }).toNumber()
        : Number(d);
const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

function rowToQuarter(r: any): OwnershipQuarter {
  return {
    asOnDate: r.asOnDate,
    quarter: r.quarter,
    fiscalYear: r.fiscalYear,
    promoterShares: r.promoterShares,
    totalShares: r.totalShares,
    pledgedShares: r.pledgedShares,
    promoterPct: num(r.promoterPct),
    fiiPct: num(r.fiiPct),
    diiPct: num(r.diiPct),
    retailPct: num(r.retailPct),
  };
}

/** Build an A1 price probe from a stock's daily CLOSE series: did close touch the
 * bottom-25% of its trailing-52-week range on ANY day in the inter-filing window?
 * The 52w range per day is the SHARED kernel (rangePositionAsOf) — identical to
 * Market sub-component 1. Behaviour preserved exactly: a ≥180-day day counts as
 * "assessed" even if its range is degenerate (high==low). */
function makePriceProbe(series: DailyClose[]): PriceProbe {
  return (priorExcl: Date, currentIncl: Date): A1PriceEval => {
    const windowDays = series.filter((s) => s.date > priorExcl && s.date <= currentIncl);
    let assessedAny = false;
    for (const d of windowDays) {
      const rp = rangePositionAsOf(series, d.date); // last close ≤ d.date == d (one row/date)
      if (rp.trailingDays < MIN_TRAILING_DAYS) continue; // <180 → not assessable
      assessedAny = true;
      if (rp.position === null) continue; // degenerate range (high==low) — assessed, no touch
      if (rp.position <= 0.25) {
        return {
          available: true, dipTouched: true,
          touchedOn: d.date.toISOString().slice(0, 10), positionAtTouch: rp.position,
          windowStartExclusive: priorExcl.toISOString().slice(0, 10),
          windowEndInclusive: currentIncl.toISOString().slice(0, 10),
        };
      }
    }
    return {
      available: assessedAny, dipTouched: false, touchedOn: null, positionAtTouch: null,
      windowStartExclusive: priorExcl.toISOString().slice(0, 10),
      windowEndInclusive: currentIncl.toISOString().slice(0, 10),
    };
  };
}

async function loadDailySeries(stockId: string) {
  const daily = await prisma.dailyPrice.findMany({
    where: { stockId }, orderBy: { date: "asc" }, select: { date: true, close: true },
  });
  return daily.map((d) => ({ date: d.date, close: Number(d.close) }));
}

function printDecomp(label: string, industryType: string, result: NonNullable<ReturnType<typeof computeOwnership>>) {
  const { primary: p, flow } = result;
  console.log(`\n■ ${label}  [${industryType}]`);
  console.log(`    snapshot          : ${p.snapshot.label}`);
  console.log(`    Primary Subtotal  : ${p.primarySubtotal}  (baseline=${p.baseline.baseline} ladder=${sgn(p.pledging.ladderAdjustment)} R2=${sgn(p.r2.penalty)} R6=${sgn(p.r6.penalty)} PF=${sgn(p.prolongedFii.penalty)})`);
  const cat = (c: typeof flow.A) =>
    `${c.cappedSubScore >= 0 ? "+" : ""}${c.cappedSubScore}  [${c.state}${c.firedRule ? "/" + c.firedRule : ""}]${c.bandLanded ? " band=" + c.bandLanded : ""}${c.trendState ? " trend=" + c.trendState : ""}`;
  console.log(`    A promoter        : ${cat(flow.A)}`);
  console.log(`         ${flow.A.reason}`);
  console.log(`    B institutional   : ${cat(flow.B)}`);
  console.log(`         ${flow.B.reason}`);
  console.log(`    C insider         : ${cat(flow.C)}`);
  console.log(`    D block           : ${cat(flow.D)}`);
  console.log(`    Flow Adjustment   : raw ${sgn(flow.flowAdjustmentRaw)} → clamped ${sgn(result.flowAdjustmentClamped)} [−12,+12]`);
  console.log(`    ══ FINAL OWNERSHIP : ${result.finalOwnership}  = clamp(${p.primarySubtotal} ${sgn(result.flowAdjustmentClamped)}, 40, 100)   flowApplied=true`);
  if (p.redFlags.length) {
    for (const rf of p.redFlags) console.log(`    ⚑ R1 (firing recorded on OwnershipScore; red_flags ROW deferred): ${rf.reasons.join("; ")}`);
  }
}

async function main() {
  console.log("=".repeat(112));
  console.log("OWNERSHIP PILLAR — FULL (Primary + Flow + clamp) — DRY-RUN (computes + plans, writes NOTHING)");
  console.log("=".repeat(112));

  // Load all shareholding rows once, grouped by symbol; capture stockId per symbol.
  const allRows = await prisma.shareholdingPattern.findMany({
    orderBy: [{ symbol: "asc" }, { asOnDate: "asc" }],
    select: {
      stockId: true, symbol: true, asOnDate: true, quarter: true, fiscalYear: true,
      promoterShares: true, totalShares: true, pledgedShares: true,
      promoterPct: true, fiiPct: true, diiPct: true, retailPct: true,
    },
  });
  const bySymbol = new Map<string, OwnershipQuarter[]>();
  const stockIdOf = new Map<string, string>();
  for (const r of allRows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol)!.push(rowToQuarter(r));
    stockIdOf.set(r.symbol, r.stockId);
  }
  const industryOf = new Map(
    (await prisma.stock.findMany({ select: { symbol: true, industryType: true } })).map((s) => [s.symbol, s.industryType]),
  );

  // ── PASS 1 — full pillar at latest snapshot (curated), with price probe ──────
  console.log("\n" + "█".repeat(112));
  console.log("PASS 1 — FULL PILLAR @ LATEST SNAPSHOT (curated sample) — the current Ownership");
  console.log("█".repeat(112));

  let clampViolations = 0;
  let cdNotDormant = 0;
  for (const sym of CURATED) {
    const rows = bySymbol.get(sym);
    const stockId = stockIdOf.get(sym);
    if (!rows || !stockId) { console.log(`\n■ ${sym} — NOT FOUND`); continue; }
    const probe = makePriceProbe(await loadDailySeries(stockId));
    const ctx: OwnershipContext = { priceProbe: probe, feeds: DORMANT_FEEDS };
    const result = computeOwnership(sym, rows, ctx);
    if (!result) continue;
    printDecomp(sym, industryOf.get(sym) ?? "?", result);

    const plan = await writeOwnershipFull({ id: stockId, symbol: sym }, result, { asOfDate: new Date(), dryRun: true });
    console.log(`    write plan        : action=${plan.action}  pillarSubtotal=${plan.pillarSubtotal}  r1Fired=${plan.ownershipScore.r1Fired}  fp=${plan.inputsFingerprint.slice(0, 10)}…`);

    if (result.finalOwnership < 40 || result.finalOwnership > 100) clampViolations++;
    if (result.flow.C.state !== "dormant_no_feed" || result.flow.D.state !== "dormant_no_feed") cdNotDormant++;
  }

  // ── PASS 2 — pattern scan across the universe ───────────────────────────────
  console.log("\n\n" + "█".repeat(112));
  console.log("PASS 2 — PATTERN SCAN (scored at the quarter each pattern fires)");
  console.log("█".repeat(112));

  // (a) B-patterns + firewall checks — no price needed, scan everything.
  const examples: Record<string, string[]> = { B1: [], B2: [], B4: [], "B4+PF": [] };
  let a3WithR2 = 0; // firewall: A3 must never co-fire with R2
  let scannedQuarters = 0;
  for (const [sym, rows] of bySymbol) {
    for (let i = 1; i < rows.length; i++) {
      const r = computeOwnership(sym, rows, NO_PRICE_CTX, i);
      if (!r) continue;
      scannedQuarters++;
      if (r.primary.r2.fired && r.flow.A.firedRule === "A3") a3WithR2++;
      const b = r.flow.B;
      const tag = (arr: string[], extra = "") =>
        arr.length < 3 && arr.push(`${sym} ${r.snapshot.periodKey}: B=${sgn(b.cappedSubScore)} [${b.firedRule}] ${extra}`);
      if (b.firedRule?.includes("B1")) tag(examples.B1, b.reason.slice(0, 70));
      if (b.firedRule?.includes("B2")) tag(examples.B2);
      if (b.firedRule === "B4") {
        tag(examples.B4);
        if (r.primary.prolongedFii.fired) {
          examples["B4+PF"].length < 3 &&
            examples["B4+PF"].push(
              `${sym} ${r.snapshot.periodKey}: B4 raw ${sgn(b.rawSubScore)}→cap ${sgn(b.cappedSubScore)} (Flow) + prolonged-FII ${sgn(r.primary.prolongedFii.penalty)} (Primary) ` +
                `→ combined institutional hit ${sgn(b.cappedSubScore + r.primary.prolongedFii.penalty)} to final (raw signal ${sgn(b.rawSubScore + r.primary.prolongedFii.penalty)})`,
            );
        }
      }
    }
  }
  for (const k of ["B1", "B2", "B4", "B4+PF"] as const) {
    console.log(`\n  ${k} examples:`);
    if (!examples[k].length) console.log("    (none found in data)");
    for (const e of examples[k]) console.log(`    ${e}`);
  }

  // (b) A1 / A2 — need price. Scan promoter-accumulation candidates until found.
  console.log("\n  A1 / A2 (promoter accumulation; A1 = into a 52w-bottom-25% dip):");
  const candRows = await prisma.$queryRaw<{ symbol: string }[]>`
    WITH seq AS (
      SELECT symbol, as_on_date, promoter_shares,
             LAG(promoter_shares) OVER (PARTITION BY symbol ORDER BY as_on_date) AS prev
      FROM shareholding_patterns)
    SELECT symbol, MAX(promoter_shares - prev) AS maxinc
    FROM seq WHERE prev IS NOT NULL AND promoter_shares IS NOT NULL
    GROUP BY symbol HAVING MAX(promoter_shares - prev) > 0
    ORDER BY maxinc DESC LIMIT 40`;
  let a1Found: string | null = null;
  let a2Found: string | null = null;
  for (const { symbol: sym } of candRows) {
    if (a1Found && a2Found) break;
    const rows = bySymbol.get(sym);
    const stockId = stockIdOf.get(sym);
    if (!rows || !stockId) continue;
    const probe = makePriceProbe(await loadDailySeries(stockId));
    const ctx: OwnershipContext = { priceProbe: probe, feeds: DORMANT_FEEDS };
    for (let i = 1; i < rows.length; i++) {
      const r = computeOwnership(sym, rows, ctx, i);
      if (!r) continue;
      if (r.flow.A.firedRule === "A1" && !a1Found) {
        a1Found = `${sym} ${r.snapshot.periodKey}: A=${sgn(r.flow.A.cappedSubScore)} — ${r.flow.A.reason}`;
      }
      if (r.flow.A.firedRule === "A2" && !a2Found) {
        a2Found = `${sym} ${r.snapshot.periodKey}: A=${sgn(r.flow.A.cappedSubScore)} — ${r.flow.A.reason}`;
      }
    }
  }
  console.log(`    A1: ${a1Found ?? "(none found in the top-40 promoter-accumulation candidates)"}`);
  console.log(`    A2: ${a2Found ?? "(none found)"}`);

  // ── FIREWALL / SANITY ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(112));
  console.log("FIREWALL / SANITY CHECKS");
  console.log("═".repeat(112));
  console.log(`  • quarters scanned (Pass 2a)         : ${scannedQuarters}`);
  console.log(`  • C & D dormant_no_feed on all curated: ${cdNotDormant === 0 ? "YES" : "NO (" + cdNotDormant + " not dormant)"} (expect YES)`);
  console.log(`  • final Ownership within [40,100]     : ${clampViolations === 0 ? "YES" : "NO (" + clampViolations + " violations)"} (expect YES)`);
  console.log(`  • A3 ⊥ R2 (never co-fire)             : violations=${a3WithR2} (expect 0 — >5pp exit scored once, by R2)`);
  console.log(`  • B has NO distribution rule          : structural — R6 (Primary) owns distribution; B = {B1,B2,B3,B4} only`);
  console.log(`  • flow bands universal (not per-PG)   : OwnershipFlowBandSet by bandType only (c_net_insider/d_net_block/trend_bonus)`);
  const ok = cdNotDormant === 0 && clampViolations === 0 && a3WithR2 === 0;
  console.log("\n" + (ok ? "✅ ALL FIREWALL / CLAMP / DORMANCY INVARIANTS HELD" : "❌ INVARIANT VIOLATION — INVESTIGATE"));
  console.log("=".repeat(112));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
