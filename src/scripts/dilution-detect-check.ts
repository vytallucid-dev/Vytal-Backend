// Read-only verification harness for the C-3 Half-A dilution detector.
// Runs classifyDilution() across real ShareholdingPattern data. NO writes, no
// data modification, no scoring. Run:  npx tsx src/scripts/dilution-detect-check.ts

import { prisma } from "../db/prisma.js";
import {
  classifyDilution,
  type DilutionResult,
  type DilutionVerdict,
  type ShareholdingRow,
} from "../scoring/ownership/dilution.js";

const SAMPLE_TARGET = 20;

async function pickSampleSymbols(): Promise<
  { symbol: string; industryType: string; reason: string }[]
> {
  const ranked = await prisma.$queryRaw<
    { symbol: string; industryType: string; cnt: bigint }[]
  >`
    SELECT sp.symbol, s."industryType", COUNT(*) AS cnt
    FROM shareholding_patterns sp
    JOIN stocks s ON s.id = sp."stock_id"
    GROUP BY sp.symbol, s."industryType"
    HAVING COUNT(*) >= 2
    ORDER BY cnt DESC
  `;
  const typeOf = new Map(ranked.map((r) => [r.symbol, r.industryType]));

  // Stocks that have at least one ZERO-promoter row.
  const zeroProm = await prisma.$queryRaw<{ symbol: string }[]>`
    SELECT DISTINCT symbol FROM shareholding_patterns
    WHERE promoter_shares = 0
    LIMIT 5
  `;
  // Stocks with a BSE-type totalShares = 0 / NULL row.
  const zeroTotal = await prisma.$queryRaw<{ symbol: string }[]>`
    SELECT DISTINCT symbol FROM shareholding_patterns
    WHERE total_shares = 0 OR total_shares IS NULL
    LIMIT 5
  `;

  const chosen = new Map<string, { industryType: string; reason: string }>();
  const add = (symbol: string, reason: string) => {
    if (!symbol || chosen.has(symbol)) return;
    chosen.set(symbol, { industryType: typeOf.get(symbol) ?? "?", reason });
  };

  zeroProm.forEach((r) => add(r.symbol, "zero-promoter"));
  zeroTotal.forEach((r) => add(r.symbol, "totalShares=0/null"));
  ranked.filter((r) => r.industryType === "banking").slice(0, 3)
    .forEach((r) => add(r.symbol, "banking"));
  ranked.slice(0, SAMPLE_TARGET).forEach((r) => add(r.symbol, `history(${Number(r.cnt)})`));

  for (const r of ranked) {
    if (chosen.size >= SAMPLE_TARGET) break;
    add(r.symbol, "filler");
  }

  return [...chosen.entries()].map(([symbol, v]) => ({ symbol, ...v }));
}

interface PairResult extends DilutionResult {
  symbol: string;
  industryType: string;
  periodQ: string; // "FY26 Q3 (2025-12-31)"
  periodQ1: string;
  promoterSharesQ: bigint | null;
  totalSharesQ: bigint | null;
}

function periodLabel(r: ShareholdingRow): string {
  const d = r.asOnDate.toISOString().slice(0, 10);
  return `${r.fiscalYear ?? "?"} ${r.quarter ?? "?"} (${d})`;
}

const fmt = (n: number | null, dp = 2) => (n === null ? "—" : n.toFixed(dp));
const fmtInt = (n: number | null) => (n === null ? "—" : String(n));

async function main() {
  console.log("=".repeat(100));
  console.log("C-3 Half-A DILUTION DETECTOR — read-only verification (no writes, no scoring)");
  console.log("=".repeat(100));

  const sample = await pickSampleSymbols();
  if (sample.length === 0) {
    console.log("No shareholding_patterns rows available — nothing to verify.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nSAMPLE (${sample.length} stocks):`);
  for (const s of sample) {
    console.log(`  ${s.symbol.padEnd(14)} ${s.industryType.padEnd(14)} reason=${s.reason}`);
  }

  const all: PairResult[] = [];
  let threw = 0;

  for (const s of sample) {
    const rows = await prisma.shareholdingPattern.findMany({
      where: { symbol: s.symbol },
      orderBy: { asOnDate: "asc" },
      select: {
        asOnDate: true,
        quarter: true,
        fiscalYear: true,
        promoterShares: true,
        totalShares: true,
      },
    });

    for (let i = 1; i < rows.length; i++) {
      const current = rows[i] as ShareholdingRow;
      const prior = rows[i - 1] as ShareholdingRow;
      try {
        const res = classifyDilution(current, prior);
        all.push({
          ...res,
          symbol: s.symbol,
          industryType: s.industryType,
          periodQ: periodLabel(current),
          periodQ1: periodLabel(prior),
          promoterSharesQ: current.promoterShares,
          totalSharesQ: current.totalShares,
        });
      } catch (err) {
        threw++;
        console.log(`  !! THREW on ${s.symbol} ${periodLabel(current)}: ${(err as Error).message}`);
      }
    }
  }

  // ── Full per-pair table ──
  console.log("\n" + "─".repeat(100));
  console.log("PER-QUARTER VERDICTS");
  console.log("─".repeat(100));
  const hdr = [
    "symbol".padEnd(13),
    "period (Q)".padEnd(22),
    "verdict".padEnd(18),
    "pctDrop".padStart(8),
    "promΔshares".padStart(13),
    "totalΔshares".padStart(14),
    "gap".padStart(4),
  ].join(" ");
  console.log(hdr);
  console.log("─".repeat(hdr.length));
  for (const r of all) {
    console.log(
      [
        r.symbol.padEnd(13),
        r.periodQ.padEnd(22),
        r.verdict.padEnd(18),
        fmt(r.pctDrop).padStart(8),
        fmtInt(r.promoterShareChange).padStart(13),
        fmtInt(r.totalShareChange).padStart(14),
        (r.priorQuarterGap ? "Y" : "").padStart(4),
      ].join(" "),
    );
  }

  // ── (i) GENUINE_REDUCTION with pctDrop > 5 — rows R2 WILL penalize ──
  const genuineGt5 = all.filter((r) => r.verdict === "genuine_reduction" && (r.pctDrop ?? 0) > 5);
  console.log("\n" + "═".repeat(100));
  console.log(`(i) GENUINE_REDUCTION with pctDrop > 5pp — R2 SHOULD penalize these (${genuineGt5.length}):`);
  console.log("═".repeat(100));
  for (const r of genuineGt5) {
    console.log(`  ${r.symbol} ${r.periodQ}: pctDrop=${fmt(r.pctDrop)}pp\n     ${r.reason}`);
  }
  if (genuineGt5.length === 0) console.log("  (none in this sample)");

  // ── (ii) DILUTION with pctDrop > 5 — rows R2 would WRONGLY penalize w/o Half-A ──
  const dilutionGt5 = all.filter((r) => r.verdict === "dilution" && (r.pctDrop ?? 0) > 5);
  console.log("\n" + "═".repeat(100));
  console.log(`(ii) DILUTION with pctDrop > 5pp — Half-A SAVES these from a wrong R2 penalty (${dilutionGt5.length}):`);
  console.log("═".repeat(100));
  for (const r of dilutionGt5) {
    console.log(`  ${r.symbol} ${r.periodQ}: pctDrop=${fmt(r.pctDrop)}pp\n     ${r.reason}`);
  }
  if (dilutionGt5.length === 0)
    console.log("  (none in this sample — the wrong-penalty case is rare; absence is not a failure)");

  // ── Verdict distribution ──
  const dist: Record<DilutionVerdict, number> = {
    no_drop: 0,
    dilution: 0,
    genuine_reduction: 0,
    indeterminate: 0,
  };
  for (const r of all) dist[r.verdict]++;
  console.log("\n" + "─".repeat(100));
  console.log(`VERDICT DISTRIBUTION (${all.length} quarter-pairs):`);
  for (const v of Object.keys(dist) as DilutionVerdict[]) {
    const n = dist[v];
    const pctStr = all.length ? ((n / all.length) * 100).toFixed(1) : "0.0";
    console.log(`  ${v.padEnd(18)} ${String(n).padStart(4)}  (${pctStr}%)`);
  }

  // ── Sanity flags ──
  console.log("\n" + "─".repeat(100));
  console.log("SANITY CHECKS:");
  console.log(`  • exceptions thrown: ${threw} (expect 0)`);
  const nonZeroVerdicts = (Object.values(dist) as number[]).filter((n) => n > 0).length;
  if (all.length > 0 && nonZeroVerdicts === 1) {
    console.log("  • ⚠️  ALL pairs share ONE verdict — logic may be inverted/stuck. INVESTIGATE.");
  } else {
    console.log(`  • verdict variety: ${nonZeroVerdicts}/4 verdicts present (no_drop should dominate)`);
  }

  // zero-promoter rows → must be no_drop or indeterminate, never dilution/genuine
  const zeroPromRows = all.filter(
    (r) => r.promoterSharesQ === 0n && r.promoterShareChange === 0,
  );
  const zeroPromBad = zeroPromRows.filter(
    (r) => r.verdict === "dilution" || r.verdict === "genuine_reduction",
  );
  console.log(
    `  • zero-promoter (0 both quarters) rows: ${zeroPromRows.length}; misclassified as dilution/genuine: ${zeroPromBad.length} (expect 0)`,
  );

  // totalShares=0/null rows → must be indeterminate
  const zeroTotalRows = all.filter(
    (r) => r.totalSharesQ === null || r.totalSharesQ === 0n,
  );
  const zeroTotalBad = zeroTotalRows.filter((r) => r.verdict !== "indeterminate");
  console.log(
    `  • totalShares=0/null rows: ${zeroTotalRows.length}; not returned indeterminate: ${zeroTotalBad.length} (expect 0)`,
  );

  console.log("=".repeat(100));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
