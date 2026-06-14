// Verification harness for the MARKET PILLAR (the fourth pillar). Pulls REAL daily
// prices for ONE peer group (Large-Cap Pharma), computes the four sub-components at
// a recent snapshot, band-scores against a CLEARLY-MARKED ILLUSTRATIVE per-PG
// band-set, and assembles the Market pillar. DRY-RUN: computes everything, commits
// nothing.
//
//   npx tsx src/scripts/market-pillar-check.ts
//
// ⚠ The per-PG band cuts are THROWAWAY illustrative (illustrative-band-set.ts), the
// SAME discipline as the Lens-1 illustrative bars — the MECHANICS are under test,
// not the cut-points. The 52-week range is the CN-1 SHARED kernel (rangePositionAsOf),
// identical to Ownership A1.

import { prisma } from "../db/prisma.js";
import { rangePositionAsOf, type DailyClose } from "../scoring/price/range.js";
import { assembleMarketForPG, assembleMarketPillar, computeMarketSubScores, type MarketMemberInput } from "../scoring/market/market.js";
import { illustrativeMarketBandSet } from "../scoring/market/illustrative-band-set.js";
import { scoreBanded } from "../scoring/market/bands.js";
import type { MarketBandCuts, MarketPillarResult, MarketSubScoreResult } from "../scoring/market/types.js";

const PG_NAME = "Large-Cap Pharma";
const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));

async function loadDailySeries(stockId: string): Promise<DailyClose[]> {
  const daily = await prisma.dailyPrice.findMany({ where: { stockId }, orderBy: { date: "asc" }, select: { date: true, close: true } });
  return daily.map((d) => ({ date: d.date, close: Number(d.close) }));
}

/** Build a synthetic ascending daily-close series of `days` calendar days ending
 *  at `asOf`, with close = closeFn(i) (i=0 oldest … days−1 newest). Anchored to a
 *  REAL asOf so no wall-clock is needed. CLEARLY synthetic — for forced edge cases. */
function synthSeries(asOf: Date, days: number, closeFn: (i: number) => number): DailyClose[] {
  const out: DailyClose[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(asOf);
    date.setUTCDate(date.getUTCDate() - (days - 1 - i));
    out.push({ date, close: closeFn(i) });
  }
  return out;
}

function printSub(s: MarketSubScoreResult): string {
  if (!s.available) return `${s.subComponent.padEnd(20)} UNAVAILABLE (${s.unavailableReason})`;
  const trend = s.trendState ? ` ${s.trendState}` : "";
  const sat = s.saturated ? " ⤴sat" : "";
  return `${s.subComponent.padEnd(20)} raw=${f2(s.rawValue, 3).padStart(9)}  band=${(s.bandLanded ?? "").padEnd(8)} score=${f2(s.bandScore).padStart(7)}${sat}${trend}`;
}

function printPillar(r: MarketPillarResult): void {
  console.log(`\n  ■ ${r.symbol}  Market = ${r.subtotal === null ? "EXCLUDED" : r.subtotal.toFixed(4)}  [${r.pillarState}]  present ${r.presentCount}/${r.totalSubs}`);
  for (const s of r.subScores) {
    const w = r.effectiveWeights[s.subComponent];
    const c = r.contributions[s.subComponent];
    const wc = w !== undefined ? `  effW=${w.toFixed(2)}% contrib=${c!.toFixed(3)}` : "";
    console.log(`      ${printSub(s)}${wc}`);
  }
  if (r.unavailableReason) console.log(`      → ${r.unavailableReason}`);
}

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }

  console.log(`${"═".repeat(118)}\nMARKET PILLAR — PG: ${PG_NAME} (${pg.stocks.length} members)`);
  const bandSet = illustrativeMarketBandSet(pg.id);
  console.log(`⚠ BAND CUTS ILLUSTRATIVE/THROWAWAY — ${bandSet.note}`);
  console.log(`  cuts: range_52w ${JSON.stringify(bandSet.cuts.range_52w)}  vs_200dma ${JSON.stringify(bandSet.cuts.vs_200dma)}  vol×median ${JSON.stringify(bandSet.cuts.volatility_vs_sector)}`);

  // load series + pick the snapshot = latest price date across the PG
  const members: MarketMemberInput[] = [];
  let asOf = new Date(0);
  for (const sp of pg.stocks) {
    const series = await loadDailySeries(sp.stock.id);
    members.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, series });
    const last = series.at(-1)?.date;
    if (last && last > asOf) asOf = last;
  }
  console.log(`  snapshot asOf = ${asOf.toISOString().slice(0, 10)} (latest price date across PG)`);

  const { pgMedianVol, results } = assembleMarketForPG(members, asOf, bandSet, asOf.toISOString().slice(0, 10));
  console.log(`  PG median 90d σ = ${pgMedianVol === null ? "—" : (pgMedianVol * 100).toFixed(3) + "%"} (the volatility-ratio denominator)`);

  // ── per-stock table ──
  console.log(`\n${"─".repeat(118)}\nPER-STOCK SUB-COMPONENTS + MARKET PILLAR`);
  for (const r of [...results].sort((a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1))) printPillar(r);

  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nTARGETED VERIFICATIONS\n`);
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // (a) CN-1: Market S1 uses the SAME shared function as Ownership A1.
  {
    const subject = members.find((m) => m.series.length >= 200) ?? members[0];
    const subs = computeMarketSubScores(subject, asOf, bandSet, pgMedianVol);
    const s1 = subs.find((s) => s.subComponent === "range_52w")!;
    const kernel = rangePositionAsOf(subject.series, asOf); // the EXACT fn A1's probe calls
    const marketFrac = s1.rawValue === null ? null : s1.rawValue / 100;
    const match = s1.available && kernel.available && marketFrac !== null && kernel.position !== null && Math.abs(marketFrac - kernel.position) < 1e-12;
    checks.push({
      name: "(a) CN-1: Market 52w-range == shared kernel rangePositionAsOf (the fn Ownership A1 calls)",
      ok: match,
      detail: `${subject.symbol}: Market S1 pos=${f2(marketFrac, 6)} == kernel pos=${f2(kernel.position, 6)} (range [${f2(kernel.low)},${f2(kernel.high)}], ${kernel.trailingDays}d). A1's makePriceProbe now calls the same rangePositionAsOf → cannot disagree.`,
    });
  }

  // (b) saturation: a synthetic stock at its 52w high scores >90 toward 100 on S1;
  //     trend_4q caps at 90 even when trending_up.
  {
    // monotonic rise over ~400 calendar days → latest close == 52w high → pos≈1.0
    const rising = synthSeries(asOf, 400, (i) => 100 + i * 0.25);
    const subs = computeMarketSubScores({ stockId: "synthHi", symbol: "SYNTH_HIGH", series: rising }, asOf, bandSet, pgMedianVol);
    const s1 = subs.find((s) => s.subComponent === "range_52w")!;
    const trend = subs.find((s) => s.subComponent === "trend_4q")!;
    const s1Sat = s1.available && (s1.bandScore as number) > 90 && s1.saturated;
    const trendCap = trend.available && trend.trendState === "trending_up" && trend.bandScore === 90 && !trend.saturated;
    checks.push({
      name: "(b) v5.5.1 saturation: near-52w-high S1 > 90 (→100); trend_4q stays capped at 90",
      ok: s1Sat && trendCap,
      detail: `SYNTH_HIGH S1 raw=${f2(s1.rawValue)}% → score ${f2(s1.bandScore)} (sat=${s1.saturated}); trend=${trend.trendState} score=${f2(trend.bandScore)} (capped 90, sat=${trend.saturated})`,
    });
  }

  // (c) lower-is-better volatility: low ratio → high score, high ratio → low score.
  {
    const volCuts = bandSet.cuts.volatility_vs_sector as MarketBandCuts;
    const low = scoreBanded(0.70, volCuts, "lower_better", { mode: "band_width_below" }); // below p15 → excellent + sat
    const mid = scoreBanded(1.0, volCuts, "lower_better", { mode: "band_width_below" }); // ~median
    const high = scoreBanded(1.4, volCuts, "lower_better", { mode: "band_width_below" }); // above p85 → distress
    const monotonic = low.bandScore > mid.bandScore && mid.bandScore > high.bandScore && low.bandScore >= 90 && high.bandScore <= 20;
    checks.push({
      name: "(c) volatility lower-is-better: 0.70× → high, 1.0× → mid, 1.40× → low",
      ok: monotonic,
      detail: `ratio 0.70→${f2(low.bandScore)} (${low.bandLanded}), 1.00→${f2(mid.bandScore)} (${mid.bandLanded}), 1.40→${f2(high.bandScore)} (${high.bandLanded})`,
    });
  }

  // (d) <180 trading days → S1 unavailable, handled (here: cascades to whole-Market
  //     unavailable since 200DMA also needs ≥200 and trend needs 4 quarters).
  {
    const shortSeries = synthSeries(asOf, 150, (i) => 100 + Math.sin(i / 7) * 5); // 150 days
    const r = assembleMarketPillar({ stockId: "synthShort", symbol: "SYNTH_SHORT", series: shortSeries }, asOf, bandSet, pgMedianVol, asOf.toISOString().slice(0, 10));
    const s1 = r.subScores.find((s) => s.subComponent === "range_52w")!;
    const s1Unavail = !s1.available && (s1.unavailableReason ?? "").includes("180");
    checks.push({
      name: "(d) <180 trading days → S1 unavailable (recorded); too few present → Market unavailable_redistributed",
      ok: s1Unavail && r.pillarState === "unavailable_redistributed" && r.subtotal === null,
      detail: `SYNTH_SHORT(150d): S1 ${s1.unavailableReason}; present ${r.presentCount}/4 → ${r.pillarState}, subtotal=${r.subtotal}`,
    });
    console.log(`  [synthetic <180d member]:`);
    printPillar(r);

    // partial-availability renorm: ~210 days → S1+200DMA+vol present, trend short → renorm to present
    const midSeries = synthSeries(asOf, 230, (i) => 100 + i * 0.1 + Math.sin(i / 5) * 3);
    const rp = assembleMarketPillar({ stockId: "synthMid", symbol: "SYNTH_MID", series: midSeries }, asOf, bandSet, pgMedianVol, asOf.toISOString().slice(0, 10));
    if (rp.pillarState === "scored" && rp.droppedCount > 0) {
      const effW = 100 / rp.presentCount;
      const sumW = Object.values(rp.effectiveWeights).reduce((a, b) => a + b, 0);
      checks.push({ name: "(d2) partial availability → present sub-components renormalize to 100%", ok: Math.abs(sumW - 100) < 1e-9 && Math.abs(effW - (rp.effectiveWeights.range_52w ?? effW)) < 1e-9, detail: `SYNTH_MID(230d): present ${rp.presentCount}/4 @ ${effW.toFixed(2)}% each, Σ effW=${sumW.toFixed(4)}%` });
      console.log(`  [synthetic partial-availability member]:`);
      printPillar(rp);
    }
  }

  // ── HAND-VERIFIED PILLAR: a fully-present real stock ──
  console.log(`\n${"═".repeat(118)}\nHAND-VERIFIED PILLAR — first fully-present stock\n`);
  {
    const r = results.find((x) => x.presentCount === 4) ?? results.find((x) => x.pillarState === "scored");
    if (r) {
      const present = r.subScores.filter((s) => s.available);
      const scores = present.map((s) => s.bandScore as number);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      console.log(`  ${r.symbol}: present sub-scores = [${scores.map((s) => s.toFixed(2)).join(", ")}]`);
      console.log(`  equal-weight (${present.length} present @ ${(100 / present.length).toFixed(2)}% each):  Σ/${present.length} = ${avg.toFixed(4)}`);
      console.log(`  assembled subtotal = ${r.subtotal?.toFixed(4)}  →  ${Math.abs(avg - (r.subtotal ?? NaN)) < 1e-9 ? "✓ MATCH" : "✗ MISMATCH"}`);
      checks.push({ name: "(hand) Market = mean of present sub-scores", ok: Math.abs(avg - (r.subtotal ?? NaN)) < 1e-9, detail: `${r.symbol}: mean ${avg.toFixed(4)} == subtotal ${r.subtotal?.toFixed(4)}` });
    } else {
      console.log("  (no fully-present stock found)");
    }
  }

  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL TARGETED CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  // ── FLAGS ──
  console.log(`${"═".repeat(118)}\nFLAGS\n`);
  for (const fl of [
    "CN-1 SHARED 52w-RANGE: the inline A1 range math (was in ownership-full-check.ts:makePriceProbe) was EXTRACTED to src/scoring/price/range.ts (rangePositionAsOf, ≥180 trailing days, close-based, (close−lo)/(hi−lo)). makePriceProbe was refactored to call it per inter-filing-window day (behaviour preserved exactly, incl. the ≥180-but-degenerate 'assessed' case); Market S1 calls it at the snapshot day. ONE definition — A1 and Market cannot disagree on 'bottom 25% / range position' for the same stock/day. Verification (a) proves Market S1 == a direct kernel call.",
    "4Q-TREND DERIVATION (fuzziest sub-component): trailing 12 months bucketed into four 3-month quarters (≥20 closes each, all 4 required); per quarter HIGH/LOW = max/min close; over the 3 transitions count higher-highs/lower-highs/higher-lows/lower-lows; trending_up = ≥2 HH AND ≥2 HL, trending_down = ≥2 LH AND ≥2 LL, else consolidating_up/down by which structure outweighs, else range. Thresholds (≥2 of 3) are STRUCTURAL (CN-8), not fitted. trend_4q is CAPPED at 90 (documented v5.5.1 exception — no continuous metric to saturate).",
    "WHOLE-MARKET-UNAVAILABLE THRESHOLD: ≥2 of 4 sub-components present (≥50%) → score (present renormalize to 100%); <2 present (0 or 1) → Market unavailable_redistributed (recorded state + reason, never silent 0). This is the FY21/FY22 no-price-history case → composite redistributes pillar weight. Same ≥50% boundary as the Foundation/Momentum §14.4 pillar floor (consistency across pillars).",
    "SATURATION (v5.5.1, positive-only, lifts the Excellent band 90→100): S1 range — p85 → 100% of range (natural max). S2 vs-200DMA — one band-width (p85−p65) above p85. S3 volatility — one band-width (p35−p15) BELOW p15 (lower-is-better). S4 trend — NONE (capped 90). 3 of 4 can reach 100 → pillar max ~97.5 when all maxed (100+100+100+90)/4. Anchor scores reuse the Lens-1 BAR_SCORE ladder {90,75,60,40,20} (structural).",
    "BAND SEMANTICS: for S1/S2/S3 bandLanded is the DISTRIBUTIONAL percentile bucket (by raw value vs the PG cuts) — so a LOW-volatility stock lands in p0_p15 yet earns the TOP score (lower-is-better flips the SCORE, not the band name). For trend_4q (no distribution) bandLanded reuses the band enum as a QUALITY tier (trending_up→p85_p100, …, trending_down→p0_p15). Flagged because reading bandLanded=p0_p15 with score 90 for volatility is otherwise surprising.",
    "MARKET CUTS ARE PER-PG (§10.4, score_market_band_sets), the OPPOSITE of Ownership's UNIVERSAL flow bands — NOT interchangeable. Real per-PG cuts do not exist yet (Phase 6, same as Lens-1 bars); this run uses a LOUDLY illustrative throwaway band-set (version 0). Production path reads score_market_band_sets and returns null today.",
    "PERSISTENCE: only PRESENT sub-components get score_market_subs rows (the schema requires non-null rawValue/bandLanded/bandScore); an unavailable sub-component is row-ABSENCE (no schema column for its reason — it lives on the in-memory result). DRY-RUN: nothing committed.",
  ]) console.log("  • " + fl + "\n");

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
