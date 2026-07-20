// STEP 15 — GATE 0c (READ-ONLY). THE REAL UNIVERSE SIZE + the name-parse feasibility.
//
// Step 14 learned the hard way that the udiff BhavCopy lists what TRADED, not what is LISTED — the
// trust universe looked like 16 on one day and turned out to be 21 across five sessions. Government
// paper is thinly traded too, so ONE session is a sample, not the universe. Measure the union.
//
// Also: prove (or disprove) that coupon + maturity can be read out of the NAME without guessing,
// against EVERY name in the union — not the six I happened to eyeball.
import { fetchUdiff, parseUdiff, weekdaysBack, type UdiffRow } from "../ingestions/shared/udiff-bhavcopy.js";

const GOVT = ["GS", "TB", "GB", "SG"] as const;
const SESSIONS = 8;

const latest = new Map<string, { row: UdiffRow; date: string }>();
const perDay: { date: string; counts: Record<string, number> }[] = [];

let got = 0;
for (const d of weekdaysBack(new Date(), 16)) {
  if (got >= SESSIONS) break;
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const p = parseUdiff(f.buffer);
  if (!p.ok) continue;
  got++;
  const day = d.toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  for (const r of p.rows) {
    if (!(GOVT as readonly string[]).includes(r.series)) continue;
    counts[r.series] = (counts[r.series] ?? 0) + 1;
    if (r.usable && r.isin) latest.set(r.isin, { row: r, date: day });
  }
  perDay.push({ date: day, counts });
}

console.log("── PER-SESSION COUNTS (what traded that day) ──");
for (const d of perDay) {
  const tot = Object.values(d.counts).reduce((a, b) => a + b, 0);
  console.log(`   ${d.date}:  total ${String(tot).padStart(3)}   ${JSON.stringify(d.counts)}`);
}

const byS: Record<string, number> = {};
for (const { row } of latest.values()) byS[row.series] = (byS[row.series] ?? 0) + 1;
console.log(`\n── THE UNION across ${got} sessions — THE UNIVERSE ──`);
console.log(`   ${latest.size} distinct instruments: ${JSON.stringify(byS)}`);
console.log(`   (a single session showed ${Object.values(perDay[0]!.counts).reduce((a, b) => a + b, 0)} — the union is the honest universe)`);

// ── NAME-PARSE FEASIBILITY, over EVERY name in the union ───────────────────
console.log("\n── CAN COUPON + MATURITY BE READ FROM THE NAME? (tested on every row, not a sample) ──");

const COUPON = /(\d+(?:\.\d+)?)\s*%/;
const YEAR = /\b(20\d{2})\b/;
const TBILL_DATE = /(\d{2})\/(\d{2})\/(\d{2})/; // "364D-08/07/27"
const TBILL_TENOR = /\b(\d{2,3})D\b/;

const miss: string[] = [];
let coupon = 0, year = 0, tbDate = 0, tbTenor = 0;
const tb = [...latest.values()].filter((v) => v.row.series === "TB");
const nonTb = [...latest.values()].filter((v) => v.row.series !== "TB");

for (const { row } of nonTb) {
  const c = COUPON.test(row.name);
  const y = YEAR.test(row.name);
  if (c) coupon++;
  if (y) year++;
  if (!c || !y) miss.push(`[${row.series}] "${row.name}"  (coupon=${c} year=${y})`);
}
for (const { row } of tb) {
  if (TBILL_DATE.test(row.name)) tbDate++;
  if (TBILL_TENOR.test(row.name)) tbTenor++;
}

console.log(`   GS/SG/GB (${nonTb.length}):  coupon% parsed ${coupon}/${nonTb.length} · maturity YEAR parsed ${year}/${nonTb.length}`);
console.log(`   TB       (${tb.length}):  full maturity DATE parsed ${tbDate}/${tb.length} · tenor parsed ${tbTenor}/${tb.length}`);
console.log(`                    (a T-bill has NO coupon — it is a discount instrument. That null is CORRECT, not missing.)`);
if (miss.length) {
  console.log(`\n   ⚠ ${miss.length} name(s) a parser could NOT fully read → those attributes go honest-null:`);
  for (const m of miss.slice(0, 10)) console.log(`      ${m}`);
}

console.log("\n── Is the maturity DAY/MONTH anywhere for GS/SG/GB? (it is NOT in the name) ──");
for (const s of ["GS", "SG", "GB"] as const) {
  const sample = [...latest.values()].filter((v) => v.row.series === s).slice(0, 3);
  for (const { row } of sample) console.log(`   [${s}] name="${row.name}"  symbol="${row.symbol}"`);
}
console.log(`   → GS/SG carry a YEAR only. SGB symbols LOOK like they carry a month (SGBJUN28) but are
     truncated and ambiguous (SGBJU29III — JUN or JUL? SGBN28VIII — NOV?). Parsing a month out of
     those is a COIN FLIP on a government bond's redemption date. Honest-null the exact date; store
     the year, which IS explicit. A wrong maturity is a lie about when the user gets their money.`);

// ── The out-of-scope fence, stated in numbers ──────────────────────────────
console.log("\n── THE CORPORATE-DEBT FENCE ──");
console.log(`   The GS/TB/GB/SG allow-list is an EXACT set. Every other debt series (N*, Y*, Z*, P1, …)
     is corporate paper and is excluded BY CONSTRUCTION, not by a heuristic. Step 15 cannot swallow
     the bond step even by accident.`);
