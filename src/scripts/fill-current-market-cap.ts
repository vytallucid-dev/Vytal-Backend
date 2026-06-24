// ─────────────────────────────────────────────────────────────
// ONE-TIME CURRENT FILL — populate StockPrice.marketCap NOW.
//
// Current-only: computes marketCap from each stock's LATEST StockPrice row
// (close) × latest total_shares, applying the split gate. Does NOT touch
// historical DailyPrice rows. Idempotent — re-running yields the same values.
//
// Run: npx tsx src/scripts/fill-current-market-cap.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  computeMarketCap,
  SPLIT_DISCONTINUITY_THRESHOLD,
  type MarketCapReason,
} from "../ingestions/prices/market-cap.js";

async function main() {
  const rows = await prisma.stockPrice.findMany({
    where: { priceDate: { not: null } },
    select: {
      stockId: true,
      price: true,
      priceDate: true,
      stock: { select: { symbol: true } },
    },
  });

  console.log(
    `[fill-mcap] ${rows.length} stocks with a latest price row · split-gate threshold ${(SPLIT_DISCONTINUITY_THRESHOLD * 100).toFixed(0)}%`,
  );

  const census: Record<MarketCapReason, number> = {
    stamped: 0,
    gated_split: 0,
    no_total_shares: 0,
    no_price: 0,
  };
  const gated: string[] = [];
  const noShares: string[] = [];
  const tripwireOutliers: string[] = [];
  const ratios: number[] = [];

  for (const r of rows) {
    const close = r.price != null ? Number(r.price) : null;
    const mc = await computeMarketCap(r.stockId, close, r.priceDate!);
    census[mc.reason]++;

    await prisma.stockPrice.update({
      where: { stockId: r.stockId },
      data: {
        marketCap:
          mc.marketCapCr != null ? new Prisma.Decimal(mc.marketCapCr) : null,
        sharesAsOfDate: mc.sharesAsOfDate,
      },
    });

    if (mc.reason === "gated_split") gated.push(`${r.stock.symbol} — ${mc.detail}`);
    if (mc.reason === "no_total_shares")
      noShares.push(`${r.stock.symbol} — ${mc.detail}`);

    // ── OPTIONAL tripwire (informational, non-blocking): the accounting identity
    //    paidUpEquityCapital[₹Cr] × 1e7 / faceValueShare[₹] ≈ total_shares.
    //    A clean cross-check (vs noisy EPS-implied); a large gap = split/staleness
    //    alarm OR a face-value change. Validation flag only — never the source.
    if (mc.reason === "stamped") {
      const [sh, fund] = await Promise.all([
        prisma.shareholdingPattern.findFirst({
          where: { stockId: r.stockId },
          orderBy: { asOnDate: "desc" },
          select: { totalShares: true },
        }),
        prisma.fundamental.findFirst({
          where: {
            stockId: r.stockId,
            paidUpEquityCapital: { not: null },
            faceValueShare: { not: null },
          },
          orderBy: { fiscalYear: "desc" },
          select: { paidUpEquityCapital: true, faceValueShare: true, fiscalYear: true },
        }),
      ]);
      if (
        sh?.totalShares &&
        fund?.paidUpEquityCapital != null &&
        fund.faceValueShare != null
      ) {
        const fv = Number(fund.faceValueShare);
        const paidUpCr = Number(fund.paidUpEquityCapital);
        if (fv > 0 && paidUpCr > 0) {
          const impliedRaw = (paidUpCr * 1e7) / fv;
          const ratio = impliedRaw / Number(sh.totalShares);
          ratios.push(ratio);
          if (ratio < 0.5 || ratio > 2.0) {
            tripwireOutliers.push(
              `${r.stock.symbol}: implied ${impliedRaw.toExponential(2)} sh vs total_shares ${sh.totalShares.toString()} (ratio ${ratio.toFixed(2)}, FY ${fund.fiscalYear})`,
            );
          }
        }
      }
    }
  }

  // ── Census ──
  console.log("\n=== CENSUS ===");
  console.log(
    `stamped=${census.stamped}  gated_split=${census.gated_split}  no_total_shares=${census.no_total_shares}  no_price=${census.no_price}`,
  );
  if (gated.length) {
    console.log("\n-- GATED (probable split, value null until next filing) --");
    gated.forEach((g) => console.log("  " + g));
  }
  if (noShares.length) {
    console.log("\n-- NO TOTAL_SHARES (filing missing/null count) --");
    noShares.forEach((g) => console.log("  " + g));
  }

  // ── Tripwire summary ──
  if (ratios.length) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log("\n=== TRIPWIRE (paidUp÷faceValue vs total_shares) ===");
    console.log(
      `median ratio ${median.toFixed(3)} (≈1.0 ⇒ units consistent) · n=${ratios.length}`,
    );
    if (tripwireOutliers.length) {
      console.log("-- outliers (ratio <0.5 or >2.0) --");
      tripwireOutliers.forEach((t) => console.log("  " + t));
    } else {
      console.log("no outliers");
    }
  }

  // ── Sanity: top caps (expect lakh-Cr magnitudes) ──
  const top = await prisma.stockPrice.findMany({
    where: { marketCap: { not: null } },
    orderBy: { marketCap: "desc" },
    take: 8,
    select: {
      marketCap: true,
      sharesAsOfDate: true,
      stock: { select: { symbol: true } },
    },
  });
  console.log("\n=== TOP MARKET CAPS (sanity) ===");
  for (const t of top) {
    const cr = Number(t.marketCap);
    console.log(
      `  ${t.stock.symbol.padEnd(12)} ₹${Math.round(cr).toLocaleString("en-IN")} Cr  (≈₹${(cr / 1e5).toFixed(2)} L Cr)  shares as-of ${t.sharesAsOfDate?.toISOString().slice(0, 10) ?? "—"}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
