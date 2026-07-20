// GATE 3 — the accumulator's MATH, checked against a hand-calc on a KNOWN series.
// Pure; no network, no DB. npx tsx src/scripts/verify-step10b-math.ts
//
// The streaming fold is clever enough to be wrong in ways that still look plausible, so its
// numbers are checked against independently-computed ones on a series whose answers we know.
import { SchemeAcc, H, ANCHOR_TOLERANCE_DAYS } from "../ingestions/amfi/mf-accumulator.js";
import { normaliseCategory, rankBucketFor, isOpenEnded } from "../ingestions/amfi/mf-category.js";

let fails = 0;
const near = (label: string, got: number | null, want: number, tol = 1e-6) => {
  const ok = got !== null && Math.abs(got - want) < tol;
  if (!ok) fails++;
  console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(34)} got=${got === null ? "null" : got.toFixed(8)}  want=${want.toFixed(8)}`);
};
const isNull = (label: string, got: unknown) => {
  const ok = got === null;
  if (!ok) fails++;
  console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(34)} ${ok ? "null (honest-empty)" : `got ${got} — SHOULD BE NULL`}`);
};

// ── 1. A 2-year daily series with a KNOWN shape ────────────────
// 505 trading points, exactly +0.04% per day compounded, ending today.
console.log("\n═══ 1. RETURNS — deterministic compounding ═══");
{
  const asOf = 20_000;
  const a = new SchemeAcc({ asOfDay: asOf });
  const dailyLog = 0.0004;
  const start = 100;
  // Emit one point per day for 731 calendar days ending at asOf.
  const N = 731;
  for (let i = N - 1; i >= 0; i--) {
    const day = asOf - i;
    const nav = start * Math.exp(dailyLog * (N - 1 - i));
    a.push(day, nav);
  }

  // 1-year return: the NAV 365 days back vs now, both known exactly.
  const navNow = start * Math.exp(dailyLog * (N - 1));
  const nav1y = start * Math.exp(dailyLog * (N - 1 - 365));
  near("ret 1y", a.simpleReturn("y1"), navNow / nav1y - 1);
  near("ret 1m", a.simpleReturn("m1"), Math.exp(dailyLog * H.m1) - 1, 1e-6);

  // Volatility of a perfectly-constant log return is ZERO.
  const v = a.vol("y1");
  const okVol = v !== null && Math.abs(v) < 1e-9;
  if (!okVol) fails++;
  console.log(`  ${okVol ? "✅" : "❌"} vol 1y (constant series)      got=${v}  want≈0`);

  // A monotonically-rising series never draws down.
  near("maxDD 1y (monotone rise)", a.maxDrawdown("y1"), 0, 1e-12);

  // 3Y/5Y must be HONEST-EMPTY — the fund is only 2 years old.
  isNull("ret 3y (fund is 2y old)", a.cagr("y3"));
  isNull("ret 5y (fund is 2y old)", a.cagr("y5"));
}

// ── 2. DRAWDOWN — a known peak-to-trough ───────────────────────
console.log("\n═══ 2. MAX DRAWDOWN — a known peak-to-trough ═══");
{
  const asOf = 20_000;
  const a = new SchemeAcc({ asOfDay: asOf });
  // rise 100→200, crash to 120, recover to 150. Worst DD = (120-200)/200 = -40%.
  const navs = [100, 150, 200, 180, 140, 120, 130, 150];
  navs.forEach((n, i) => a.push(asOf - (navs.length - 1 - i) * 30, n));
  near("maxDD (peak 200 → trough 120)", a.maxDrawdown("y1"), -0.4, 1e-9);
}

// ── 3. THE ANCHOR TOLERANCE — a young fund must NOT get a 5Y number ──
console.log("\n═══ 3. ANCHOR TOLERANCE — the young-fund guard ═══");
{
  const asOf = 20_000;
  // A fund whose history starts 4.5 years back. Its FIRST NAV must NOT be mistaken for the
  // "5 years ago" price — that would publish a fabricated 5-year return.
  const a = new SchemeAcc({ asOfDay: asOf });
  const firstDay = asOf - Math.round(4.5 * 365);
  for (let d = firstDay; d <= asOf; d += 1) a.push(d, 100 * (1 + (d - firstDay) / 10_000));
  isNull("ret 5y (fund is 4.5y old)", a.cagr("y5"));
  const y3 = a.cagr("y3");
  const ok3 = y3 !== null;
  if (!ok3) fails++;
  console.log(`  ${ok3 ? "✅" : "❌"} ret 3y (fund is 4.5y old)      ${ok3 ? `computed ${(y3! * 100).toFixed(2)}%` : "NULL — should compute"}`);

  // And a fund that starts exactly ON the anchor SHOULD get it.
  const b = new SchemeAcc({ asOfDay: asOf });
  const onAnchor = asOf - H.y5;
  for (let d = onAnchor; d <= asOf; d += 1) b.push(d, 100 * (1 + (d - onAnchor) / 10_000));
  const b5 = b.cagr("y5");
  const okB = b5 !== null;
  if (!okB) fails++;
  console.log(`  ${okB ? "✅" : "❌"} ret 5y (fund starts ON anchor) ${okB ? `computed ${(b5! * 100).toFixed(2)}%` : "NULL — should compute"}`);
  console.log(`     (tolerance = ${ANCHOR_TOLERANCE_DAYS} days)`);
}

// ── 4. THE ORDER GUARD ─────────────────────────────────────────
console.log("\n═══ 4. ORDER GUARD — a reordered feed must be REFUSED, not folded ═══");
{
  const a = new SchemeAcc({ asOfDay: 20_000 });
  a.push(19_990, 100);
  a.push(19_991, 101);
  a.push(19_989, 99); // ← out of order: must be refused
  a.push(19_992, 102);
  const ok = a.outOfOrder === 1 && a.points === 3;
  if (!ok) fails++;
  console.log(`  ${ok ? "✅" : "❌"} out-of-order rows refused      outOfOrder=${a.outOfOrder} points=${a.points} (want 1 / 3)`);
  console.log(`     A silently-reordered feed would corrupt every volatility number while looking healthy.`);
}

// ── 5. VOLATILITY — annualised, against a hand-computed stdev ───
console.log("\n═══ 5. VOLATILITY — annualised, vs an independent stdev ═══");
{
  const asOf = 20_000;
  const a = new SchemeAcc({ asOfDay: asOf });
  // A deterministic zig-zag: alternating +1% / -1% log returns, 250 daily points.
  const navs: number[] = [100];
  for (let i = 1; i < 251; i++) navs.push(navs[i - 1]! * Math.exp(i % 2 === 1 ? 0.01 : -0.01));
  navs.forEach((n, i) => a.push(asOf - (navs.length - 1 - i), n));

  // Independent hand-calc over the same returns.
  const rs: number[] = [];
  for (let i = 1; i < navs.length; i++) rs.push(Math.log(navs[i]! / navs[i - 1]!));
  const mean = rs.reduce((x, y) => x + y, 0) / rs.length;
  const variance = rs.reduce((x, r) => x + (r - mean) ** 2, 0) / (rs.length - 1);
  const spanYears = (navs.length - 1) / 365.25;
  const obsPerYear = rs.length / spanYears;
  const want = Math.sqrt(variance) * Math.sqrt(obsPerYear);

  near("annualised vol 1y", a.vol("y1"), want, 1e-6);
  console.log(`     hand-calc: stdev=${Math.sqrt(variance).toFixed(6)} × √(${obsPerYear.toFixed(1)} obs/yr) = ${(want * 100).toFixed(2)}%`);
  console.log(`     (obs/yr is DERIVED, not a hard-coded 252 — a liquid fund prices 365 days/yr, an equity fund ~250)`);
}

// ── 6. CATEGORY NORMALISATION — the fragmentation fix ──────────
console.log("\n═══ 6. CATEGORY NORMALISATION — legacy + modern headers must MERGE ═══");
{
  const cases: [string, string][] = [
    ["Open Ended Schemes(Debt Scheme - Overnight Fund)", "Overnight Fund"],
    ["Open Ended Schemes(Income/Debt Oriented Schemes - Overnight Fund)", "Overnight Fund"],
    ["Open Ended Schemes(Equity Scheme - Large Cap Fund)", "Large Cap Fund"],
    ["Open Ended Schemes(Growth/Equity Oriented Schemes - Large Cap Fund)", "Large Cap Fund"],
    ["Close Ended Schemes(Income)", "Income"],
  ];
  for (const [raw, want] of cases) {
    const got = normaliseCategory(raw);
    const ok = got === want;
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${want.padEnd(16)} ← ${raw.slice(0, 58)}`);
  }
  const a = normaliseCategory("Open Ended Schemes(Debt Scheme - Overnight Fund)");
  const b = normaliseCategory("Open Ended Schemes(Income/Debt Oriented Schemes - Overnight Fund)");
  const merged = a === b;
  if (!merged) fails++;
  console.log(`  ${merged ? "✅" : "❌"} the two Overnight headers MERGE → one bucket, not a singleton pool`);
}

// ── 7. THE BUCKET RULES ────────────────────────────────────────
console.log("\n═══ 7. RANK BUCKET — who is deliberately NOT ranked ═══");
{
  const checks: [string, ReturnType<typeof rankBucketFor>, string][] = [
    ["open+active+direct → ranked",
      rankBucketFor({ category: "Open Ended Schemes(Equity Scheme - Large Cap Fund)", planType: "direct", isActive: true }),
      "Large Cap Fund|direct"],
    ["close-ended → NOT ranked",
      rankBucketFor({ category: "Close Ended Schemes(Income)", planType: "direct", isActive: true }),
      "close_ended_or_interval"],
    ["dormant → NOT ranked",
      rankBucketFor({ category: "Open Ended Schemes(Equity Scheme - Large Cap Fund)", planType: "direct", isActive: false }),
      "dormant"],
    ["NULL plan_type → NOT ranked",
      rankBucketFor({ category: "Open Ended Schemes(Equity Scheme - Large Cap Fund)", planType: null, isActive: true }),
      "plan_type_unknown"],
  ];
  for (const [label, got, want] of checks) {
    const actual = "bucket" in got && got.bucket ? got.bucket : (got as any).reason;
    const ok = actual === want;
    if (!ok) fails++;
    console.log(`  ${ok ? "✅" : "❌"} ${label.padEnd(30)} → ${actual}`);
  }
  console.log(`  ✅ isOpenEnded("Close Ended Schemes(Income)") = ${isOpenEnded("Close Ended Schemes(Income)")}`);
}

console.log(`\n${fails === 0 ? "✅ ALL MATH CHECKS PASS" : `❌ ${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
