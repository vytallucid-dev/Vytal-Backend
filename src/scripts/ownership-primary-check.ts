// Verification harness for the Ownership PRIMARY layer (baseline + pledging +
// disturbances). DRY-RUN: computes the full decomposition + the would-be write
// plan and PRINTS — commits NOTHING to the DB (reads only).
//
//   npx tsx src/scripts/ownership-primary-check.ts
//
// Two passes:
//   PASS A — current snapshot (latest quarter) for ~15 stocks spanning every
//            required case → the real Primary Ownership score now.
//   PASS B — R2 / firewall probe: across the sample, find each historical
//            quarter with a >5pp promoter-% drop and score THAT quarter, showing
//            R2 fires (genuine_reduction / indeterminate) or is SUPPRESSED
//            (dilution) — promoter exits rarely sit at the latest quarter.

import { prisma } from "../db/prisma.js";
import { computePrimaryOwnership } from "../scoring/ownership/primary.js";
import { writeOwnershipPrimary } from "../scoring/ownership/persist.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";

// Curated sample (verified present in the DB) spanning every required case:
//   clean stable promoter | zero-promoter (ITC-type) | genuinely pledged (R1) |
//   near-zero pledge | Half-A genuine_reduction >5pp | Half-A dilution >5pp.
const SAMPLE: { symbol: string; why: string }[] = [
  { symbol: "TCS", why: "clean stable promoter (pledge 0)" },
  { symbol: "RELIANCE", why: "clean stable promoter (pledge 0)" },
  { symbol: "HINDUNILVR", why: "clean stable promoter" },
  { symbol: "INFY", why: "low-but-stable promoter" },
  { symbol: "ITC", why: "zero-promoter (ITC-type)" },
  { symbol: "HDFCBANK", why: "zero-promoter (banking)" },
  { symbol: "ASHOKLEY", why: "genuinely pledged ~51% → R1 + ladder" },
  { symbol: "OBEROIRLTY", why: "highest pledge ~75% → R1" },
  { symbol: "BAJAJ-AUTO", why: "near-zero pledge ~0.01% → ladder ~0" },
  { symbol: "IDFCFIRSTB", why: "Half-A genuine_reduction 35pp (promoter exit) → R2" },
  { symbol: "INDIGO", why: "Half-A genuine_reduction ~6pp → R2" },
  { symbol: "WHIRLPOOL", why: "Half-A genuine_reduction 24pp → R2" },
  { symbol: "MPHASIS", why: "Half-A genuine_reduction ~15pp → R2" },
  { symbol: "IDEA", why: "Half-A dilution 13pp → R2 SUPPRESSED (firewall)" },
  { symbol: "BIOCON", why: "Half-A dilution ~6pp → R2 SUPPRESSED (firewall)" },
];

const AS_OF = new Date(); // snapshot wall-clock for the (dry-run) run row

// ── helpers ───────────────────────────────────────────────────────────────────
const num = (d: unknown): number | null =>
  d === null || d === undefined
    ? null
    : typeof d === "number"
      ? d
      : typeof (d as { toNumber?: () => number }).toNumber === "function"
        ? (d as { toNumber: () => number }).toNumber()
        : Number(d);

const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const f2 = (n: number | null) => (n === null ? "—" : n.toFixed(2));

/** Load a symbol's full quarterly series (asc) mapped to the pure-engine shape. */
async function loadRows(symbol: string): Promise<OwnershipQuarter[]> {
  const raw = await prisma.shareholdingPattern.findMany({
    where: { symbol },
    orderBy: { asOnDate: "asc" },
    select: {
      asOnDate: true,
      quarter: true,
      fiscalYear: true,
      promoterShares: true,
      totalShares: true,
      pledgedShares: true,
      promoterPct: true,
      fiiPct: true,
      diiPct: true,
      retailPct: true,
    },
  });
  return raw.map((r) => ({
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
  }));
}

async function getStock(symbol: string) {
  return prisma.stock.findFirst({
    where: { symbol },
    select: { id: true, symbol: true, industryType: true },
  });
}

async function main() {
  console.log("=".repeat(108));
  console.log("OWNERSHIP PRIMARY — verification harness (DRY-RUN: computes + plans, writes NOTHING)");
  console.log("=".repeat(108));

  // counters for sanity checks
  let nearBaseline = 0;
  let withPenalty = 0;
  let zeroPromoterClean = 0;
  let zeroPromoterCleanBad = 0;
  let r1Rows = 0;
  let scored = 0;

  // ── PASS A — current snapshot (latest quarter) ──────────────────────────────
  console.log("\n" + "█".repeat(108));
  console.log("PASS A — CURRENT SNAPSHOT (latest quarter) — the Primary Ownership score now");
  console.log("█".repeat(108));

  for (const { symbol, why } of SAMPLE) {
    const stock = await getStock(symbol);
    if (!stock) {
      console.log(`\n■ ${symbol} — NOT FOUND, skipped`);
      continue;
    }
    const rows = await loadRows(symbol);
    const result = computePrimaryOwnership(symbol, rows);
    if (!result) {
      console.log(`\n■ ${symbol} — no shareholding rows, skipped`);
      continue;
    }
    scored++;

    const plan = await writeOwnershipPrimary(stock, result, { asOfDate: AS_OF, dryRun: true });

    const { baseline, pledging, r2, r6, prolongedFii, primarySubtotal } = result;
    const isZeroPromoter = rows[result.snapshot.index].promoterShares === 0n;

    console.log(`\n■ ${symbol}  [${stock.industryType}]  — ${why}`);
    console.log(`    snapshot         : ${result.snapshot.label}  (${baseline.consecutiveTrailingQuarters} consecutive trailing Q)`);
    console.log(`    baseline         : ${baseline.baseline}  (${baseline.reason})`);
    console.log(`    pledging ladder  : ${sgn(pledging.ladderAdjustment)}  [${pledging.ladderState}]  ratio Q-1→Q: ${f2(pledging.pledgeRatioQ1)}% → ${f2(pledging.pledgeRatioQ)}%`);
    console.log(`                       ${pledging.reason}`);
    console.log(`    R2 promoter exit : ${sgn(r2.penalty)}  (Half-A gate=${r2.gatingVerdict}, drop=${f2(r2.pctDrop)}pp)${r2.spansGap ? " [spans gap]" : ""}`);
    console.log(`                       ${r2.reason}`);
    console.log(`    R6 distribution  : ${sgn(r6.penalty)}  (promΔ=${f2(r6.promoterDelta)} fiiΔ=${f2(r6.fiiDelta)} retailΔ=${f2(r6.retailDelta)})`);
    console.log(`    prolonged FII    : ${sgn(prolongedFii.penalty)}  ${prolongedFii.reason}`);
    console.log(`    ───────────────────────────────────────────────────────────────`);
    console.log(`    PRIMARY SUBTOTAL : ${primarySubtotal}   = ${baseline.baseline} ${sgn(pledging.ladderAdjustment)} ${sgn(r2.penalty)} ${sgn(r6.penalty)} ${sgn(prolongedFii.penalty)}   (UNCLAMPED; Flow not applied)`);
    console.log(`    write plan       : action=${plan.action}  fp=${plan.inputsFingerprint.slice(0, 12)}…  → PillarScore(ownership) + OwnershipScore`);
    if (result.redFlags.length) {
      r1Rows++;
      for (const rf of result.redFlags) {
        console.log(`    ⚑ RED FLAG (DEFERRED): ${rf.flagKey} [${rf.tier}/${rf.severity}] — ${rf.reasons.join("; ")}`);
        console.log(`                       (row write deferred: needs a ScoreSnapshot → out-of-scope pillars)`);
      }
    }

    // sanity bookkeeping
    const anyPenalty = r2.penalty + r6.penalty + prolongedFii.penalty < 0 || pledging.ladderAdjustment < 0;
    if (anyPenalty) withPenalty++;
    if (Math.abs(primarySubtotal - baseline.baseline) <= 1) nearBaseline++;
    if (isZeroPromoter) {
      // zero-promoter must not produce promoter-exit / pledge penalties
      const spurious = r2.fired || pledging.ladderAdjustment !== 0 || pledging.r1Breach;
      if (spurious) zeroPromoterCleanBad++;
      else zeroPromoterClean++;
    }
  }

  // ── PASS B — R2 / firewall probe (historical drop quarters) ─────────────────
  console.log("\n\n" + "█".repeat(108));
  console.log("PASS B — R2 / FIREWALL PROBE — every >5pp promoter-% drop in the sample, scored at THAT quarter");
  console.log("█".repeat(108));
  console.log("(Confirms R2 consumes Half-A: fires on genuine_reduction/indeterminate, SUPPRESSED on dilution)\n");

  const hdr = [
    "symbol".padEnd(12),
    "quarter".padEnd(9),
    "drop".padStart(7),
    "Half-A verdict".padEnd(18),
    "R2".padEnd(14),
    "subtotal".padStart(8),
  ].join(" ");
  console.log(hdr);
  console.log("─".repeat(hdr.length));

  let r2Fired = 0;
  let r2Suppressed = 0;
  let firewallBad = 0;

  for (const { symbol } of SAMPLE) {
    const stock = await getStock(symbol);
    if (!stock) continue;
    const rows = await loadRows(symbol);

    for (let i = 1; i < rows.length; i++) {
      // quick count-derived promoter-% drop pre-filter
      const r = computePrimaryOwnership(symbol, rows, i);
      if (!r) continue;
      const drop = r.r2.pctDrop;
      if (drop === null || drop <= 5) continue;

      const v = r.r2.gatingVerdict;
      const r2cell = r.r2.fired ? "FIRED −6" : "suppressed 0";
      console.log(
        [
          symbol.padEnd(12),
          r.snapshot.periodKey.padEnd(9),
          (drop.toFixed(2) + "pp").padStart(7),
          v.padEnd(18),
          r2cell.padEnd(14),
          String(r.primarySubtotal).padStart(8),
        ].join(" "),
      );

      if (r.r2.fired) r2Fired++;
      else r2Suppressed++;
      // firewall correctness: dilution must NOT fire; genuine/indeterminate (>5) MUST fire
      if (v === "dilution" && r.r2.fired) firewallBad++;
      if ((v === "genuine_reduction" || v === "indeterminate") && !r.r2.fired) firewallBad++;
    }
  }

  // ── SANITY CHECKS ───────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(108));
  console.log("SANITY CHECKS");
  console.log("═".repeat(108));
  console.log(`  • stocks scored (Pass A)            : ${scored}/${SAMPLE.length}`);
  console.log(`  • at/near baseline (|Δ| ≤ 1)        : ${nearBaseline}  (most stable names SHOULD sit here)`);
  console.log(`  • carrying a penalty/negative nudge : ${withPenalty}  (penalties should be the EXCEPTION)`);
  console.log(`  • zero-promoter clean (no spurious) : ${zeroPromoterClean}  | spurious triggers: ${zeroPromoterCleanBad} (expect 0)`);
  console.log(`  • R1 red flags detected (Pass A)    : ${r1Rows}  (ASHOKLEY/OBEROIRLTY-type; rows DEFERRED)`);
  console.log(`  • Pass B: R2 fired                  : ${r2Fired}  | R2 suppressed by firewall: ${r2Suppressed}`);
  console.log(`  • Pass B: FIREWALL VIOLATIONS       : ${firewallBad}  (expect 0 — dilution must suppress, genuine/indeterminate must fire)`);

  const ok = zeroPromoterCleanBad === 0 && firewallBad === 0;
  console.log("\n" + (ok ? "✅ ALL FIREWALL / ZERO-PROMOTER INVARIANTS HELD" : "❌ INVARIANT VIOLATION — INVESTIGATE"));
  console.log("=".repeat(108));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
