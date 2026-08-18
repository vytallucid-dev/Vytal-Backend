// ═══════════════════════════════════════════════════════════════
// F2a — THE DECLARED-WINDOW HISTOGRAM. READ-ONLY, OFFLINE.
//   npx tsx src/scripts/_f2a-hist.ts     (reads _f2-corpus.jsonl)
//
// ⚠ MEASURE FIRST, DESIGN SECOND. The rule is not written until this prints.
//
// For every filing we hold, the document's OWN declared fiscal year
// (DateOfStartOfFinancialYear .. DateOfEndOfFinancialYear) and the period it
// reports (DateOfStartOfReportingPeriod .. DateOfEndOfReportingPeriod).
//
// Reported here:
//   H1  the distribution of declared-window LENGTHS in months
//   H2  windows where fyEnd is BEFORE fyStart (negative length)
//   H3  filings whose reported PERIOD falls outside its own declared window
//   H4  the two tests crossed — which filings each candidate rule would reject
//   H5  every non-12-month window, named, so nothing is designed against an
//       aggregate that hides its own counter-examples
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const DIR = process.env.R1_DIR ?? ".";
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

interface C {
  u: string; sym: string; ind: string; src: string;
  rows: Array<{ tbl: string; fy: string; q: string; rt: string; rd: string | null }>;
  ns?: string | null; fys?: string | null; fye?: string | null;
  rs1?: string | null; re1?: string | null; rs4?: string | null; re4?: string | null;
  err?: string;
}

const D = (s: string) => new Date(`${s}T00:00:00Z`);
/** Whole months from a→b, by calendar month index. A window 2024-04-01..2025-03-31
 *  is 11 month-steps + the part-month, i.e. a 12-month year. So the honest length is
 *  monthsBetween(start,end)+1 when the end is a month-end. Kept as BOTH so nothing
 *  hides in a rounding convention. */
const monthDiff = (a: Date, b: Date) =>
  (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

function main() {
  const lines = readFileSync(`${DIR}/_f2-corpus.jsonl`, "utf-8").split("\n").filter((l) => l.trim());
  const all: C[] = lines.map((l) => JSON.parse(l));

  const fetchErr = all.filter((c) => c.err);
  const got = all.filter((c) => !c.err);
  const noWindow = got.filter((c) => !c.fys || !c.fye);
  const win = got.filter((c) => c.fys && c.fye);

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F2a — THE DECLARED-WINDOW DISTRIBUTION, over EVERY filing we hold          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  documents in the corpus            : ${all.length}`);
  console.log(`  fetch failed                       : ${fetchErr.length}`);
  console.log(`  fetched but no declared window     : ${noWindow.length}`);
  console.log(`  fetched WITH a declared window     : ${win.length}`);
  console.log(`  (a document can back >1 stored row: annual + its derived Q4)`);

  // ── H1 · window length histogram ────────────────────────────────────────
  const hist = new Map<number, C[]>();
  for (const c of win) {
    const m = monthDiff(D(c.fys!), D(c.fye!)) + 1;
    if (!hist.has(m)) hist.set(m, []);
    hist.get(m)!.push(c);
  }
  console.log(`\n  ── H1 · DECLARED-WINDOW LENGTH (months, inclusive of both end months) ──`);
  console.log(`  ${lp("months", 8)}${lp("filings", 10)}${lp("share", 9)}${lp("stocks", 9)}   note`);
  for (const [m, cs] of [...hist].sort((a, b) => a[0] - b[0])) {
    const stocks = new Set(cs.map((c) => c.sym));
    const note = m === 12 ? "the normal year" : m < 0 ? "⚠ END BEFORE START" : m <= 11 ? "⚠ SHORTER THAN A YEAR" : m <= 15 ? "legal transition (Companies Act 2013 permits ≤15m)" : "⚠ LONGER THAN THE STATUTE ALLOWS";
    console.log(`  ${lp(m, 8)}${lp(cs.length, 10)}${lp(`${((cs.length / win.length) * 100).toFixed(2)}%`, 9)}${lp(stocks.size, 9)}   ${note}`);
  }

  // day-length too — a "12 month" window can still be 2 days long if the dates are junk
  const dayHist = new Map<string, number>();
  for (const c of win) {
    const d = dayDiff(D(c.fys!), D(c.fye!));
    const b = d < 0 ? "negative" : d < 150 ? "<150d" : d < 300 ? "150-299d" : d < 400 ? "300-399d (a year)" : d < 500 ? "400-499d" : "≥500d";
    dayHist.set(b, (dayHist.get(b) ?? 0) + 1);
  }
  console.log(`\n  ── H1b · the same windows measured in DAYS (a month count can hide a junk date) ──`);
  for (const [b, n] of [...dayHist].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(b, 22)}${lp(n, 8)}`);

  // ── H2 · fyEnd before fyStart ───────────────────────────────────────────
  const inverted = win.filter((c) => D(c.fye!) < D(c.fys!));
  console.log(`\n  ── H2 · fyEnd BEFORE fyStart (an impossible window at any length) ──`);
  console.log(`  ${inverted.length} filing(s) across ${new Set(inverted.map((c) => c.sym)).size} stock(s)`);
  for (const c of inverted.slice(0, 20))
    console.log(`  ${pad(c.sym, 13)}${pad(`${c.fys}..${c.fye}`, 26)}${pad(c.rows.map((r) => `${r.fy}${r.q}/${r.rt.slice(0, 4)}`).join(","), 30)}${c.src}`);
  if (inverted.length > 20) console.log(`  … ${inverted.length - 20} more`);

  // ── H3 · the reported period vs its own declared window ─────────────────
  // Use the period the PARSER would have used for the row this document backed.
  interface Out { c: C; kind: string; pStart: string; pEnd: string; months: number }
  const outside: Out[] = [];
  for (const c of win) {
    const fs = D(c.fys!), fe = D(c.fye!);
    const months = monthDiff(fs, fe) + 1;
    for (const kind of ["quarterly", "annual"] as const) {
      const ps = kind === "quarterly" ? c.rs1 : c.rs4;
      const pe = kind === "quarterly" ? c.re1 : c.re4;
      if (!ps || !pe) continue;
      const backs = c.rows.some((r) => (kind === "quarterly" ? r.q !== "Y" : r.q === "Y"));
      if (!backs) continue;
      if (D(pe) > fe || D(ps) < fs) outside.push({ c, kind, pStart: ps, pEnd: pe, months });
    }
  }
  console.log(`\n  ── H3 · the REPORTED PERIOD falls outside its own DECLARED WINDOW ──`);
  console.log(`  ${outside.length} case(s) across ${new Set(outside.map((o) => o.c.sym)).size} stock(s)`);
  console.log(`  ${pad("symbol", 13)}${pad("declared window", 26)}${lp("m", 4)}  ${pad("kind", 10)}${pad("reported period", 26)}stored label(s)`);
  for (const o of outside.slice(0, 40))
    console.log(`  ${pad(o.c.sym, 13)}${pad(`${o.c.fys}..${o.c.fye}`, 26)}${lp(o.months, 4)}  ${pad(o.kind, 10)}${pad(`${o.pStart}..${o.pEnd}`, 26)}${o.c.rows.map((r) => `${r.fy}${r.q}`).join(",")}`);
  if (outside.length > 40) console.log(`  … ${outside.length - 40} more`);

  // ── H4 · what each candidate rule would reject ──────────────────────────
  const shorter = win.filter((c) => { const m = monthDiff(D(c.fys!), D(c.fye!)) + 1; return m < 11; });
  const longer = win.filter((c) => { const m = monthDiff(D(c.fys!), D(c.fye!)) + 1; return m > 15; });
  const band1113 = win.filter((c) => { const m = monthDiff(D(c.fys!), D(c.fye!)) + 1; return m < 11 || m > 13; });
  const outsideSet = new Set(outside.map((o) => o.c.u));
  console.log(`\n  ── H4 · what each candidate rule REJECTS, over ${win.length} windowed filings ──`);
  const line = (label: string, n: number, extra = "") =>
    console.log(`  ${pad(label, 52)}${lp(n, 7)}${lp(`${((n / win.length) * 100).toFixed(3)}%`, 10)}  ${extra}`);
  line(`A · period outside its own declared window`, outside.length, "length-independent");
  line(`B · window shorter than 11 months`, shorter.length);
  line(`C · window longer than 15 months`, longer.length);
  line(`D · A ∪ B ∪ C  (the proposed rule)`, new Set([...outsideSet, ...shorter.map((c) => c.u), ...longer.map((c) => c.u)]).size);
  line(`E · the naive "outside 11–13 months" band`, band1113.length, "⚠ would reject legal transitions");
  const legalTransition = win.filter((c) => { const m = monthDiff(D(c.fys!), D(c.fye!)) + 1; return m >= 14 && m <= 15 && !outsideSet.has(c.u); });
  line(`   of which E rejects but D accepts (14–15m, period inside)`, legalTransition.length, "← the CEMPRO class");

  // ── H5 · every non-12-month window, named ───────────────────────────────
  const odd = win.filter((c) => monthDiff(D(c.fys!), D(c.fye!)) + 1 !== 12);
  console.log(`\n  ── H5 · EVERY non-12-month declared window (${odd.length}) ──`);
  console.log(`  ${pad("symbol", 13)}${lp("m", 4)}${lp("days", 7)}  ${pad("declared window", 26)}${pad("period (OneD)", 26)}${pad("labels", 18)}src`);
  for (const c of odd.sort((a, b) => a.sym.localeCompare(b.sym))) {
    const m = monthDiff(D(c.fys!), D(c.fye!)) + 1;
    console.log(
      `  ${pad(c.sym, 13)}${lp(m, 4)}${lp(dayDiff(D(c.fys!), D(c.fye!)), 7)}  ${pad(`${c.fys}..${c.fye}`, 26)}` +
        `${pad(c.rs1 && c.re1 ? `${c.rs1}..${c.re1}` : "-", 26)}${pad(c.rows.map((r) => `${r.fy}${r.q}/${r.rt.slice(0, 4)}`).join(","), 18)}${c.src.replace("nse_xbrl_", "")}`,
    );
  }

  // ── H6 · the named cases from the brief, checked one by one ─────────────
  const NAMED = ["DELHIVERY", "EXIDEIND", "GESHIP", "HSCL", "UNIONBANK", "CEMPRO", "SIEMENS", "CANBK", "POWERINDIA"];
  console.log(`\n  ── H6 · the named cases, as measured ──`);
  for (const sym of NAMED) {
    const cs = win.filter((c) => c.sym === sym);
    const bad = cs.filter((c) => { const m = monthDiff(D(c.fys!), D(c.fye!)) + 1; return m !== 12 || outsideSet.has(c.u); });
    console.log(`  ${pad(sym, 13)}${lp(cs.length, 5)} windowed filing(s), ${bad.length} irregular`);
    for (const c of bad) {
      const m = monthDiff(D(c.fys!), D(c.fye!)) + 1;
      console.log(`      ${pad(`${c.fys}..${c.fye}`, 26)}${lp(`${m}m`, 5)}  period ${pad(c.rs1 && c.re1 ? `${c.rs1}..${c.re1}` : "-", 24)}` +
        `${outsideSet.has(c.u) ? "PERIOD OUTSIDE  " : ""}→ stored ${c.rows.map((r) => `${r.fy}${r.q}/${r.rt.slice(0, 4)}`).join(",")}`);
    }
  }

  writeFileSync(`${DIR}/_f2a-hist.json`, JSON.stringify({
    counts: { all: all.length, fetchErr: fetchErr.length, noWindow: noWindow.length, win: win.length },
    hist: [...hist].map(([m, cs]) => ({ months: m, n: cs.length, stocks: [...new Set(cs.map((c) => c.sym))] })),
    inverted: inverted.map((c) => ({ sym: c.sym, fys: c.fys, fye: c.fye, u: c.u, rows: c.rows })),
    outside: outside.map((o) => ({ sym: o.c.sym, kind: o.kind, fys: o.c.fys, fye: o.c.fye, pStart: o.pStart, pEnd: o.pEnd, u: o.c.u, rows: o.c.rows })),
    odd: odd.map((c) => ({ sym: c.sym, fys: c.fys, fye: c.fye, rs1: c.rs1, re1: c.re1, u: c.u, rows: c.rows, src: c.src })),
    noWindowSample: noWindow.slice(0, 30).map((c) => ({ sym: c.sym, u: c.u, ns: c.ns, src: c.src, rows: c.rows })),
    fetchErrSample: fetchErr.slice(0, 30).map((c) => ({ sym: c.sym, u: c.u, err: c.err })),
  }, null, 1));
  console.log(`\n  → ${DIR}/_f2a-hist.json\n`);
}
main();
