// ═══════════════════════════════════════════════════════════════
// S4.3b PROOF — the generalised deriveFiscalPeriod must not change ANY label the
// old two-branch version produced. READ-ONLY, pure, no DB, no NSE.
//   npx tsx src/scripts/_s43-proof.ts
//
// The regression direction matters more than the fix direction, so the March and
// December calendars are checked EXHAUSTIVELY (every fiscal-year-end year in a
// wide range × every quarter-end month), not sampled.
// ═══════════════════════════════════════════════════════════════
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

/** the OLD implementation, verbatim, as the oracle */
function oldDerive(reportPeriodEnd: Date, _fyStart: Date, fyEnd: Date, filingType: "quarterly" | "annual") {
  const fyEndMonth = fyEnd.getUTCMonth() + 1;
  const isCalendarYear = fyEndMonth === 12;
  const fiscalYear = `FY${String(fyEnd.getUTCFullYear()).slice(-2)}`;
  if (filingType === "annual") return { quarter: "Y", fiscalYear };
  const reportMonth = reportPeriodEnd.getUTCMonth() + 1;
  let quarter: string;
  if (isCalendarYear) {
    if (reportMonth === 3) quarter = "Q1";
    else if (reportMonth === 6) quarter = "Q2";
    else if (reportMonth === 9) quarter = "Q3";
    else if (reportMonth === 12) quarter = "Q4";
    else throw new Error("old: bad month");
  } else {
    if (reportMonth === 6) quarter = "Q1";
    else if (reportMonth === 9) quarter = "Q2";
    else if (reportMonth === 12) quarter = "Q3";
    else if (reportMonth === 3) quarter = "Q4";
    else throw new Error("old: bad month");
  }
  return { quarter, fiscalYear };
}

const eom = (y: number, m: number) => new Date(Date.UTC(y, m, 0));
const pad = (s: unknown, n: number) => String(s).padEnd(n);

console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ S4.3b PROOF — regression first: does the generalisation change anything?   ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

// ── 1. EXHAUSTIVE equivalence on the two calendars that already worked ──
let checked = 0, mismatches: string[] = [];
for (const fyEndMonth of [3, 12]) {
  for (let fyEndYear = 2015; fyEndYear <= 2030; fyEndYear++) {
    const fyEnd = eom(fyEndYear, fyEndMonth);
    const fyStartMonth = (fyEndMonth % 12) + 1;
    const fyStartYear = fyEndMonth === 12 ? fyEndYear : fyEndYear - 1;
    const fyStart = new Date(Date.UTC(fyStartYear, fyStartMonth - 1, 1));
    for (const off of [2, 5, 8, 11]) {
      const pm = ((fyStartMonth - 1 + off) % 12) + 1;
      const py = fyStartYear + Math.floor((fyStartMonth - 1 + off) / 12);
      const pe = eom(py, pm);
      const o = oldDerive(pe, fyStart, fyEnd, "quarterly");
      const n = deriveFiscalPeriod(pe, fyStart, fyEnd, "quarterly");
      checked++;
      if (o.quarter !== n.quarter || o.fiscalYear !== n.fiscalYear) {
        mismatches.push(`fyEnd ${fyEndMonth}/${fyEndYear} periodEnd ${pm}/${py}: old ${o.fiscalYear}${o.quarter} → new ${n.fiscalYear}${n.quarter}`);
      }
    }
    // annual arm must be untouched too
    const oa = oldDerive(fyEnd, fyStart, fyEnd, "annual");
    const na = deriveFiscalPeriod(fyEnd, fyStart, fyEnd, "annual");
    checked++;
    if (oa.quarter !== na.quarter || oa.fiscalYear !== na.fiscalYear) mismatches.push(`ANNUAL fyEnd ${fyEndMonth}/${fyEndYear}`);
  }
}
console.log(`\n  ── 1. MARCH + DECEMBER, exhaustive (2015-2030 × all four quarter-ends + annual) ──`);
console.log(`     cases checked : ${checked}`);
console.log(`     mismatches    : ${mismatches.length === 0 ? "✓ 0 — every existing label is byte-identical" : "⚠ " + mismatches.length}`);
for (const m of mismatches.slice(0, 10)) console.log(`       ⚠ ${m}`);

// ── 2. SEPTEMBER — the case that was broken (SIEMENS) ──
console.log(`\n  ── 2. SEPTEMBER year-end (SIEMENS files Oct–Sep) ──`);
console.log(`     ${pad("period end", 14)}${pad("OLD label", 12)}${pad("NEW label", 12)}verdict`);
const sepFyEnd2018 = eom(2018, 9), sepStart2018 = new Date(Date.UTC(2017, 9, 1));
const sepFyEnd2019 = eom(2019, 9), sepStart2019 = new Date(Date.UTC(2018, 9, 1));
const sepCases: Array<[Date, Date, Date, string]> = [
  [eom(2017, 12), sepStart2018, sepFyEnd2018, "Oct–Dec 2017 = Q1 of FY18"],
  [eom(2018, 3), sepStart2018, sepFyEnd2018, "Jan–Mar 2018 = Q2 of FY18"],
  [eom(2018, 6), sepStart2018, sepFyEnd2018, "Apr–Jun 2018 = Q3 of FY18"],
  [eom(2018, 9), sepStart2018, sepFyEnd2018, "Jul–Sep 2018 = Q4 of FY18"],
  [eom(2018, 12), sepStart2019, sepFyEnd2019, "Oct–Dec 2018 = Q1 of FY19"],
];
for (const [pe, fs, fe, why] of sepCases) {
  let o: string; try { const x = oldDerive(pe, fs, fe, "quarterly"); o = x.fiscalYear + x.quarter; } catch { o = "THROW"; }
  const n = deriveFiscalPeriod(pe, fs, fe, "quarterly");
  const nl = n.fiscalYear + n.quarter;
  console.log(`     ${pad(pe.toISOString().slice(0, 10), 14)}${pad(o, 12)}${pad(nl, 12)}${why}`);
}
console.log(`     ⇒ the OLD column is exactly what is stored today for SIEMENS; the NEW column`);
console.log(`       advances with time, so consecutiveTail can walk the whole series.`);

// ── 3. monotonicity: does the new labelling advance with time for each calendar? ──
console.log(`\n  ── 3. does the new label ADVANCE WITH TIME? (the property that was broken) ──`);
for (const [name, fyEndMonth] of [["March", 3], ["December", 12], ["September", 9], ["June", 6]] as [string, number][]) {
  const seq: number[] = [];
  for (let i = 0; i < 12; i++) {
    const fyEndYear = 2019 + Math.floor(i / 4);
    const fyEnd = eom(fyEndYear, fyEndMonth);
    const fyStartMonth = (fyEndMonth % 12) + 1;
    const fyStartYear = fyEndMonth === 12 ? fyEndYear : fyEndYear - 1;
    const fyStart = new Date(Date.UTC(fyStartYear, fyStartMonth - 1, 1));
    const off = [2, 5, 8, 11][i % 4];
    const pm = ((fyStartMonth - 1 + off) % 12) + 1;
    const py = fyStartYear + Math.floor((fyStartMonth - 1 + off) / 12);
    const r = deriveFiscalPeriod(eom(py, pm), fyStart, fyEnd, "quarterly");
    seq.push(parseInt(r.fiscalYear.slice(2), 10) * 4 + Number(r.quarter.slice(1)) - 1);
  }
  const mono = seq.every((v, i) => i === 0 || v === seq[i - 1] + 1);
  console.log(`     ${pad(name + " year-end", 20)} ordinals ${seq.slice(0, 8).join(",")}…  ${mono ? "✓ strictly +1 each quarter" : "⚠ NOT monotone"}`);
}

// ── 4. the rejection path still rejects ──
console.log(`\n  ── 4. a non-quarter-boundary period is still REJECTED ──`);
for (const [pm, py, label] of [[5, 2020, "May (not a quarter end)"], [1, 2020, "January (not a quarter end of a March year)"]] as [number, number, string][]) {
  let msg = "ACCEPTED ⚠";
  try { deriveFiscalPeriod(eom(py, pm), new Date(Date.UTC(2019, 3, 1)), eom(2020, 3), "quarterly"); }
  catch (e) { msg = "✓ rejected — " + (e as Error).message.slice(0, 72); }
  console.log(`     ${pad(label, 44)}${msg}`);
}

console.log(`\n  ══ ${mismatches.length === 0 ? "✓ REGRESSION-CLEAN: no existing label changes; September now correct" : "✗ REGRESSION DETECTED"} ══\n`);
