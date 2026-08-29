// ═══════════════════════════════════════════════════════════════
// STAGE 2 RECON (1/3) — what does NSE shareholding ACTUALLY cover after Stage 1?
// Read-only. No BSE calls. Answers: where is the series genuinely thin, and how
// many stocks would a BSE lane still help?
//
//   npx tsx src/scripts/stage2-recon-coverage.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const OUT = "_s2-recon-coverage.json";

/** Quarter index for a quarter-end date: 2022-06-30 -> 2022*4 + 1. */
const qIndex = (iso: string): number => {
  const [y, m] = iso.split("-").map(Number);
  return y * 4 + Math.floor((m - 1) / 3);
};
const qLabel = (i: number): string =>
  `${Math.floor(i / 4)}-${["Mar", "Jun", "Sep", "Dec"][i % 4]}`;

async function main(): Promise<void> {
  // Quarter-end rows only — the table also holds interim/event filings on
  // arbitrary dates, which are not part of the quarterly series.
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, p.as_on_date::text q, p.fii_pct IS NOT NULL AS has_fii
     FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id
     WHERE (extract(month from p.as_on_date), extract(day from p.as_on_date))
           IN ((3,31),(6,30),(9,30),(12,31))
     ORDER BY s.symbol, p.as_on_date`,
  );

  const bySym = new Map<string, { idx: number[]; withFii: number }>();
  for (const r of rows) {
    const s = String(r.symbol);
    const e = bySym.get(s) ?? { idx: [], withFii: 0 };
    e.idx.push(qIndex(String(r.q)));
    if (r.has_fii) e.withFii++;
    bySym.set(s, e);
  }

  // Listing dates bound what is even askable — a 2021 IPO cannot have a 2019 row.
  // `stocks` has no listing column; `stock_overviews.listed_since` is the only one
  // in the schema, so use it and treat a missing value as unknown (never as
  // "recently listed", which would silently excuse a real gap).
  const listing = new Map<string, string | null>();
  for (const r of await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, o.listed_since::text ld
     FROM stocks s LEFT JOIN stock_overviews o ON o.stock_id = s.id`,
  )) {
    listing.set(String(r.symbol), r.ld === null ? null : String(r.ld));
  }

  const NOW = qIndex("2026-06-30"); // newest complete quarter
  const FY19 = qIndex("2019-03-31");
  const JAN23 = qIndex("2023-03-31");

  interface Prof {
    symbol: string; n: number; earliest: string; latest: string;
    longestRun: number; internalGaps: number[]; gapCount: number;
    reachesFy19: boolean; listedBefore2019: boolean; listing: string | null;
  }
  const profs: Prof[] = [];

  for (const [symbol, e] of bySym) {
    const idx = [...new Set(e.idx)].sort((a, b) => a - b);
    let best = 1, cur = 1;
    for (let i = 1; i < idx.length; i++) {
      cur = idx[i] === idx[i - 1] + 1 ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    // Holes strictly INSIDE the covered span — a short history is not a gap.
    const gaps: number[] = [];
    for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (!idx.includes(i)) gaps.push(i);
    const ld = listing.get(symbol) ?? null;
    profs.push({
      symbol, n: idx.length,
      earliest: qLabel(idx[0]), latest: qLabel(idx[idx.length - 1]),
      longestRun: best, internalGaps: gaps.slice(0, 12), gapCount: gaps.length,
      reachesFy19: idx[0] <= FY19,
      // Unknown listing date counts as "listed before 2019" so the stock stays in
      // the real-gap bucket rather than being quietly exempted.
      listedBefore2019: ld === null || ld < "2019-01-01",
      listing: ld,
    });
  }

  const total = profs.length;
  const withGaps = profs.filter((p) => p.gapCount > 0);
  const shortOfFy19 = profs.filter((p) => !p.reachesFy19 && p.listedBefore2019);
  const shortButRecent = profs.filter((p) => !p.reachesFy19 && !p.listedBefore2019);
  const beforeJan23 = profs.filter((p) => qIndex("2000-03-31") + 0 <= 0 || true);

  console.log(`\n=== STAGE 2 RECON 1/3 — NSE shareholding coverage AFTER Stage 1 ===\n`);
  console.log(`  stocks with any quarter-end row      ${total}`);
  console.log(`  reach FY2019 (Mar-2019 or earlier)   ${profs.filter((p) => p.reachesFy19).length}`);
  console.log(`  short of FY2019 but LISTED after     ${shortButRecent.length}  (exempt - complete from listing)`);
  console.log(`  short of FY2019 AND listed before    ${shortOfFy19.length}  <- the only real FY2019 gap`);
  console.log(`  stocks with INTERNAL gaps            ${withGaps.length}  (holes inside their own span)`);
  console.log(`  total internal missing quarters      ${withGaps.reduce((s, p) => s + p.gapCount, 0)}`);

  console.log(`\n  -- longest-consecutive-run histogram --`);
  for (const [lo, hi] of [[1, 3], [4, 7], [8, 11], [12, 19], [20, 27], [28, 99]] as [number, number][]) {
    const c = profs.filter((p) => p.longestRun >= lo && p.longestRun <= hi).length;
    console.log(`     ${String(lo).padStart(2)}-${String(hi).padEnd(2)} quarters : ${"#".repeat(Math.ceil(c / 8)).padEnd(45)} ${c}`);
  }

  if (shortOfFy19.length) {
    console.log(`\n  -- listed pre-2019 but series starts later (${shortOfFy19.length}) --`);
    for (const p of shortOfFy19.sort((a, b) => a.earliest.localeCompare(b.earliest)).slice(0, 30))
      console.log(`     ${p.symbol.padEnd(12)} starts ${p.earliest.padEnd(9)} listed ${p.listing}  n=${p.n} run=${p.longestRun}`);
    if (shortOfFy19.length > 30) console.log(`     ... and ${shortOfFy19.length - 30} more`);
  }

  if (withGaps.length) {
    console.log(`\n  -- stocks with internal gaps (top 25 by gap count) --`);
    for (const p of withGaps.sort((a, b) => b.gapCount - a.gapCount).slice(0, 25))
      console.log(`     ${p.symbol.padEnd(12)} gaps=${String(p.gapCount).padStart(3)}  ${p.internalGaps.map(qLabel).join(" ")}`);
  }

  // The NESTLEIND case: a row STRICTLY BEFORE 2023-01-31 is what Ownership needs.
  console.log(`\n  -- rows before 2023-01-31 (the snapshot case) --`);
  const preJan23 = profs.filter((p) => bySym.get(p.symbol)!.idx.some((i) => i < JAN23));
  console.log(`     stocks with >=1 quarter-end row before Mar-2023: ${preJan23.length} of ${total}`);
  const noneBefore = profs.filter((p) => !bySym.get(p.symbol)!.idx.some((i) => i < JAN23));
  if (noneBefore.length)
    console.log(`     stocks with NONE: ${noneBefore.map((p) => `${p.symbol}(${p.earliest})`).join(", ")}`);

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total, profs }, null, 2));
  console.log(`\n  full profile -> ${OUT}  (${beforeJan23.length} rows)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
