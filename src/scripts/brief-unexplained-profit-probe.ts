// THE UNEXPLAINED-PROFIT PROBE — how large is each family's bridge residual, and where would a floor cut?
// Read-only: no AI call, no write.
//
//   npx tsx src/scripts/brief-unexplained-profit-probe.ts
//   npx tsx src/scripts/brief-unexplained-profit-probe.ts IDEA
//
// ★ WHY: driver.ts computes the residual ALREADY and uses it only as a gate — over tolerance, no driver
// bullet, nothing said. This asks the question the gate never does: how big is the leftover, and on how
// many rows is it large enough to be the most important sentence on the card. The floors in
// contrasts.ts's Q-K are chosen from this output and from nothing else.

import { prisma } from "../db/prisma.js";
import { fetchFamilyQuarters, resolveFamilyBasis } from "../insight/quarter-brief/family-rows.js";
import { UNEXPLAINED_BRIDGES, unexplainedAmount } from "../insight/quarter-brief/driver.js";
import { valueOf, type AnyFamilyQuarter, type Family } from "../insight/quarter-brief/manifest.js";

const FAMILIES: Family[] = ["non_financial", "banking", "nbfc", "life_insurance", "general_insurance"];
const pct = (n: number, d: number) => (d === 0 ? "  —  " : `${((n / d) * 100).toFixed(1)}%`.padStart(6));

interface Sample {
  symbol: string;
  family: Family;
  periodKey: string;
  amount: number;
  netProfit: number;
  base: number;
  newest: boolean;
}

function quantiles(xs: number[]): string {
  if (xs.length === 0) return "n=0";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return `p50 ${q(0.5).toFixed(1)}%  p75 ${q(0.75).toFixed(1)}%  p90 ${q(0.9).toFixed(1)}%  p99 ${q(0.99).toFixed(1)}%  max ${s[s.length - 1].toFixed(1)}%`;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const stocks = await prisma.stock.findMany({
    select: { symbol: true, id: true, industryType: true },
    orderBy: { symbol: "asc" },
  });

  const samples: Sample[] = [];
  const rowsSeen = new Map<Family, number>();
  const bridgeable = new Map<Family, number>();

  for (const s of stocks) {
    if (only.length > 0 && !only.includes(s.symbol)) continue;
    const family = s.industryType as Family;
    if (!UNEXPLAINED_BRIDGES.has(family)) continue;
    const basis = await resolveFamilyBasis(family, s.id);
    if (!basis) continue;
    let rows: AnyFamilyQuarter[];
    try {
      rows = await fetchFamilyQuarters(family, s.id, basis);
    } catch {
      continue;
    }
    rows.forEach((row, i) => {
      rowsSeen.set(family, (rowsSeen.get(family) ?? 0) + 1);
      const u = unexplainedAmount(row);
      if (u === null) return; // a term is unreported — an identity with a hole has not closed
      bridgeable.set(family, (bridgeable.get(family) ?? 0) + 1);
      const np = valueOf(row, "netProfit");
      const base = valueOf(row, UNEXPLAINED_BRIDGES.get(family)!.scaleBase);
      if (np === null || base === null) return;
      samples.push({
        symbol: s.symbol, family, periodKey: row.periodKey,
        amount: u, netProfit: np, base, newest: i === rows.length - 1,
      });
    });
  }

  const line = (t = "") => console.log(t);
  line("═".repeat(104));
  line("UNEXPLAINED PROFIT — the family bridge's own leftover, over every quarterly row on file");
  line("═".repeat(104));

  for (const f of FAMILIES) {
    const seen = rowsSeen.get(f) ?? 0;
    if (seen === 0) continue;
    const xs = samples.filter((s) => s.family === f);
    line(`\n${f}  —  ${seen} rows, ${bridgeable.get(f) ?? 0} with every bridge term reported`);
    line(`  |residual| as a share of NET PROFIT   ${quantiles(xs.filter((s) => s.netProfit !== 0).map((s) => (Math.abs(s.amount) / Math.abs(s.netProfit)) * 100))}`);
    line(`  |residual| as a share of the TOP LINE ${quantiles(xs.filter((s) => s.base !== 0).map((s) => (Math.abs(s.amount) / Math.abs(s.base)) * 100))}`);
  }

  // ── WHERE A TWO-SIDED FLOOR CUTS ────────────────────────────────────────────────────────────────
  line("\n" + "═".repeat(104));
  line("FIRE RATE AT A TWO-SIDED FLOOR — |residual| ≥ P% of |net profit| AND ≥ B% of the top line");
  line("═".repeat(104));
  const newest = samples.filter((s) => s.newest);
  for (const P of [10, 25, 50, 100]) {
    for (const B of [5, 10, 25, 50]) {
      const hit = (s: Sample) =>
        s.netProfit !== 0 && s.base !== 0 &&
        Math.abs(s.amount) >= (Math.abs(s.netProfit) * P) / 100 &&
        Math.abs(s.amount) >= (Math.abs(s.base) * B) / 100;
      const all = samples.filter(hit);
      const now = newest.filter(hit);
      line(
        `  profit ≥${String(P).padStart(3)}%  top line ≥${String(B).padStart(3)}%   ` +
          `all rows ${String(all.length).padStart(4)}/${samples.length} ${pct(all.length, samples.length)}   ` +
          `newest card ${String(now.length).padStart(3)}/${newest.length} ${pct(now.length, newest.length)}`,
      );
    }
  }

  // ── THE LARGEST, BY SHARE OF THE TOP LINE ──────────────────────────────────────────────────────
  line("\nLARGEST RESIDUALS ON A NEWEST CARD (by share of the top line)");
  const ranked = newest
    .filter((s) => s.base !== 0 && s.netProfit !== 0)
    .sort((a, b) => Math.abs(b.amount / b.base) - Math.abs(a.amount / a.base))
    .slice(0, 20);
  for (const s of ranked) {
    line(
      `  ${s.symbol.padEnd(12)} ${s.periodKey}  ${s.family.padEnd(14)} residual ₹${s.amount.toFixed(0).padStart(9)} cr  ` +
        `net profit ₹${s.netProfit.toFixed(0).padStart(9)} cr  top line ₹${s.base.toFixed(0).padStart(9)} cr  ` +
        `${((Math.abs(s.amount) / Math.abs(s.base)) * 100).toFixed(0)}% of top line, ${((Math.abs(s.amount) / Math.abs(s.netProfit)) * 100).toFixed(0)}% of profit`,
    );
  }

  if (only.length > 0) {
    line("\nEVERY ROW FOR THE NAMED SYMBOLS");
    for (const s of samples) {
      line(
        `  ${s.symbol.padEnd(12)} ${s.periodKey}  residual ₹${s.amount.toFixed(1).padStart(10)} cr  ` +
          `net profit ₹${s.netProfit.toFixed(1).padStart(10)} cr  top line ₹${s.base.toFixed(1).padStart(10)} cr`,
      );
    }
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
