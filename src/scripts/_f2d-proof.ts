// ═══════════════════════════════════════════════════════════════
// F2b/F2d — CANDIDATE GUARDS, MEASURED. EXHAUSTIVE. READ-ONLY, OFFLINE.
//   npx tsx src/scripts/_f2d-proof.ts     (reads _f2-corpus.jsonl)
//
// Every filing we hold (23,640 documents backing 24,063 stored rows), run through
// FOUR derivers and compared against what is STORED:
//
//   OLD   the pre-S4.3 two-branch switch (December, else "March"), recovered
//         verbatim from git 737777f. This is what WROTE most of the stored labels.
//   CUR   the shipped S4.3 deriver — parser-common.ts as it stands today.
//   G1..  candidate guards layered on CUR.
//
// ⚠ THE STANDARD IS S4.3's: a candidate ships only if EVERY currently-correct label
//   is unchanged. So the harness reports, per candidate, the exact set of rows whose
//   outcome MOVES — and for each, whether the move is
//       RESCUE   (stored is wrong, the candidate refuses to write it)
//       BREAK    (stored is right, the candidate refuses or changes it)   ← disqualifying
//       NEUTRAL  (both wrong, or both refuse)
//
// "Right" is decided by an INDEPENDENT truth function, not by the deriver: the Indian
// Apr–Mar convention applied to the period's own end date, which is what every
// downstream consumer (loadMomentumStandalone's (fiscalYear, quarter) ordering) means
// by a quarter. That is deliberately NOT the deriver's own arithmetic — grading a
// deriver with itself proves nothing.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const DIR = process.env.R1_DIR ?? ".";
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const monthDiff = (a: Date, b: Date) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());

interface C {
  u: string; sym: string; ind: string; src: string;
  rows: Array<{ tbl: string; fy: string; q: string; rt: string; rd: string | null }>;
  fys?: string | null; fye?: string | null; re1?: string | null; re4?: string | null; err?: string;
}
type Derived = { quarter: string; fiscalYear: string } | { throw: string };

// ── OLD · the pre-S4.3 deriver, verbatim from git 737777f ────────────────
function OLD(reportPeriodEnd: Date, _fyStart: Date, fyEnd: Date, filingType: "quarterly" | "annual"): Derived {
  const fyEndMonth = fyEnd.getUTCMonth() + 1;
  const isCalendarYear = fyEndMonth === 12;
  const fiscalYear = `FY${String(fyEnd.getUTCFullYear()).slice(-2)}`;
  if (filingType === "annual") return { quarter: "Y", fiscalYear };
  const m = reportPeriodEnd.getUTCMonth() + 1;
  const DEC: Record<number, string> = { 3: "Q1", 6: "Q2", 9: "Q3", 12: "Q4" };
  const MAR: Record<number, string> = { 6: "Q1", 9: "Q2", 12: "Q3", 3: "Q4" };
  const q = (isCalendarYear ? DEC : MAR)[m];
  if (!q) return { throw: `month ${m} not a quarter end` };
  return { quarter: q, fiscalYear };
}

// ── CUR · parser-common.ts as shipped (S4.3) ─────────────────────────────
function CUR(reportPeriodEnd: Date, _fyStart: Date, fyEnd: Date, filingType: "quarterly" | "annual"): Derived {
  const fyEndMonth = fyEnd.getUTCMonth() + 1;
  const fyEndYear = fyEnd.getUTCFullYear();
  const fiscalYear = `FY${String(fyEndYear).slice(-2)}`;
  if (filingType === "annual") return { quarter: "Y", fiscalYear };
  const reportMonth = reportPeriodEnd.getUTCMonth() + 1;
  const fyStartMonth = (fyEndMonth % 12) + 1;
  const fyStartYear = fyEndMonth === 12 ? fyEndYear : fyEndYear - 1;
  const monthsFromStart = (reportPeriodEnd.getUTCFullYear() - fyStartYear) * 12 + (reportMonth - fyStartMonth);
  if (monthsFromStart < 0 || monthsFromStart > 11 || (monthsFromStart + 1) % 3 !== 0)
    return { throw: `${monthsFromStart} months into the year ending ${fyEndMonth}/${fyEndYear}` };
  return { quarter: `Q${Math.floor(monthsFromStart / 3) + 1}`, fiscalYear };
}

// ── THE CANDIDATE GUARDS (all layered IN FRONT of CUR) ───────────────────
type Guard = { name: string; note: string; reject: (fyStart: Date, fyEnd: Date, periodEnd: Date, filingType: string) => string | null };

const isMar31 = (d: Date) => d.getUTCMonth() === 2 && d.getUTCDate() === 31;
const len = (a: Date, b: Date) => monthDiff(a, b) + 1;

const GUARDS: Guard[] = [
  {
    name: "G1 11–13 band",
    note: "the naive band the brief warns against",
    reject: (fs, fe) => { const m = len(fs, fe); return m < 11 || m > 13 ? `window ${m}m outside 11–13` : null; },
  },
  {
    name: "G2 brief's rule",
    note: "period outside window · OR shorter than a year · OR longer than 15m",
    reject: (fs, fe, pe, ft) => {
      const m = len(fs, fe);
      if (ft === "quarterly" && (pe > fe || pe < fs)) return `period ${pe.toISOString().slice(0, 10)} outside window`;
      if (m < 11) return `window ${m}m shorter than a year`;
      if (m > 15) return `window ${m}m longer than 15`;
      return null;
    },
  },
  {
    name: "G3 end-only + length",
    note: "G2, but the period test uses the END only (the sole date the deriver consumes)",
    reject: (fs, fe, pe, ft) => {
      const m = len(fs, fe);
      if (ft === "quarterly" && (pe > fe || pe < fs)) return `period end outside window`;
      if (m < 11) return `window ${m}m shorter than a year`;
      if (m > 15) return `window ${m}m longer than 15`;
      return null;
    },
  },
  {
    name: "G4 statutory",
    note: "forward window; 12m always; any other length only if it lands on 31 March",
    reject: (fs, fe) => {
      if (fe <= fs) return `fyEnd ${fe.toISOString().slice(0, 10)} not after fyStart ${fs.toISOString().slice(0, 10)}`;
      const m = len(fs, fe);
      if (m === 12) return null;
      if (isMar31(fe)) return null;
      return `window ${m}m is not a year and does not land on 31 March`;
    },
  },
  {
    name: "G5 statutory ≤18",
    note: "G4 plus an 18-month ceiling (the measured maximum, and the 1956 Act's outer limit)",
    reject: (fs, fe) => {
      if (fe <= fs) return `fyEnd not after fyStart`;
      const m = len(fs, fe);
      if (m === 12) return null;
      if (isMar31(fe) && m <= 18) return null;
      return `window ${m}m not a year, or not a ≤18m alignment to 31 March`;
    },
  },
];

// ── TRUTH · independent of every deriver ─────────────────────────────────
// The Apr–Mar convention applied to the period's own end date. This is what
// (fiscalYear, quarter) MEANS to every consumer: the ordering key that
// loadMomentumStandalone sorts on, and that consecutiveTail walks.
function truthQuarterly(periodEnd: Date): { quarter: string; fiscalYear: string } {
  const m = periodEnd.getUTCMonth() + 1, y = periodEnd.getUTCFullYear();
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  const fyEndYear = m <= 3 ? y : y + 1;
  return { quarter: `Q${q}`, fiscalYear: `FY${String(fyEndYear).slice(-2)}` };
}

const show = (d: Derived) => ("throw" in d ? "REFUSE" : `${d.fiscalYear}${d.quarter}`);

function main() {
  const all: C[] = readFileSync(`${DIR}/_f2-corpus.jsonl`, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const win = all.filter((c) => !c.err && c.fys && c.fye);

  // ── flatten to STORED ROWS (a document can back a quarterly and an annual row) ──
  interface Case {
    sym: string; src: string; u: string; tbl: string; rt: string;
    ft: "quarterly" | "annual"; stored: string;
    fs: Date; fe: Date; pe: Date | null; windowM: number;
    old: Derived; cur: Derived; truth: string | null;
  }
  const cases: Case[] = [];
  let noPeriod = 0;
  for (const c of win) {
    const fs = D(c.fys!), fe = D(c.fye!);
    for (const r of c.rows) {
      const ft: "quarterly" | "annual" = r.q === "Y" ? "annual" : "quarterly";
      // The parser's own input: OneD end for a quarterly row; for an annual row the
      // reported end (FourD for v3, OneD for the legacy path) — but the deriver ignores
      // it entirely when filingType==="annual", so the fallback is harmless.
      const peStr = ft === "quarterly" ? c.re1 : (c.re4 ?? c.re1);
      if (!peStr) { noPeriod++; continue; }
      const pe = D(peStr);
      cases.push({
        sym: c.sym, src: c.src, u: c.u, tbl: r.tbl, rt: r.rt, ft,
        stored: `${r.fy}${r.q}`, fs, fe, pe, windowM: monthDiff(fs, fe) + 1,
        old: OLD(pe, fs, fe, ft), cur: CUR(pe, fs, fe, ft),
        truth: ft === "quarterly" ? (() => { const t = truthQuarterly(pe); return `${t.fiscalYear}${t.quarter}`; })() : null,
      });
    }
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F2d — EXHAUSTIVE REGRESSION over EVERY stored row we can re-derive         ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  documents with a declared window : ${win.length}`);
  console.log(`  stored rows re-derivable         : ${cases.length}   (quarterly ${cases.filter((c) => c.ft === "quarterly").length} · annual ${cases.filter((c) => c.ft === "annual").length})`);
  console.log(`  rows skipped (no reported period): ${noPeriod}`);

  // ── BASELINE ────────────────────────────────────────────────────────────
  const oldMatch = cases.filter((c) => show(c.old) === c.stored).length;
  const curMatch = cases.filter((c) => show(c.cur) === c.stored).length;
  const curRefuse = cases.filter((c) => "throw" in c.cur);
  console.log(`\n  ── BASELINE ──`);
  console.log(`  OLD reproduces the stored label  : ${oldMatch}/${cases.length}  (${((oldMatch / cases.length) * 100).toFixed(3)}%)`);
  console.log(`  CUR reproduces the stored label  : ${curMatch}/${cases.length}  (${((curMatch / cases.length) * 100).toFixed(3)}%)`);
  console.log(`  CUR already REFUSES              : ${curRefuse.length}`);

  // where CUR and stored disagree — the pre-existing S4.3 delta
  const curDelta = cases.filter((c) => show(c.cur) !== c.stored);
  console.log(`\n  ── every row where the SHIPPED deriver disagrees with what is stored (${curDelta.length}) ──`);
  console.log(`  ${pad("symbol", 13)}${pad("stored", 9)}${pad("CUR", 9)}${pad("truth", 9)}${lp("win", 5)}  ${pad("window", 25)}${pad("period end", 12)}verdict`);
  for (const c of curDelta.sort((a, b) => a.sym.localeCompare(b.sym))) {
    const v = c.truth === null ? "annual" : c.stored === c.truth ? "⚠ STORED IS RIGHT" : show(c.cur) === c.truth ? "CUR IS RIGHT" : "both wrong";
    console.log(`  ${pad(c.sym, 13)}${pad(c.stored, 9)}${pad(show(c.cur), 9)}${pad(c.truth ?? "-", 9)}${lp(c.windowM, 5)}  ${pad(`${c.fs.toISOString().slice(0, 10)}..${c.fe.toISOString().slice(0, 10)}`, 25)}${pad(c.pe!.toISOString().slice(0, 10), 12)}${v}`);
  }

  // ── CANDIDATE GUARDS ────────────────────────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F2b — WHAT EACH CANDIDATE GUARD ACTUALLY DOES                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const results: any = {};
  for (const g of GUARDS) {
    const moved: Case[] = [];
    let rescue = 0, brk = 0, neutral = 0;
    const breaks: Array<{ c: Case; why: string }> = [];
    for (const c of cases) {
      const why = g.reject(c.fs, c.fe, c.pe!, c.ft);
      if (!why) continue;                       // guard silent → outcome unchanged
      if ("throw" in c.cur) { neutral++; continue; } // CUR already refused → no change
      moved.push(c);
      // The guard turns a WRITE into a REFUSAL. Was the write right?
      const curLabel = show(c.cur);
      const wasRight = c.ft === "annual" ? curLabel === c.stored : curLabel === c.truth;
      if (wasRight) { brk++; breaks.push({ c, why }); } else rescue++;
    }
    console.log(`\n  ── ${g.name} — ${g.note}`);
    console.log(`     rows whose outcome MOVES : ${moved.length}`);
    console.log(`     RESCUE  (refuses a label that would have been wrong) : ${rescue}`);
    console.log(`     BREAK   (refuses a label that was RIGHT)             : ${brk}${brk ? "   ← DISQUALIFYING" : "   ✓"}`);
    console.log(`     neutral (CUR already refused)                        : ${neutral}`);
    if (breaks.length) {
      console.log(`     the breaks:`);
      for (const b of breaks.slice(0, 12))
        console.log(`       ${pad(b.c.sym, 12)}${pad(show(b.c.cur), 8)}(right) ${pad(`${b.c.fs.toISOString().slice(0, 10)}..${b.c.fe.toISOString().slice(0, 10)}`, 25)}${b.why}`);
      if (breaks.length > 12) console.log(`       … ${breaks.length - 12} more`);
    }
    if (moved.length && !breaks.length) {
      console.log(`     the rescues:`);
      for (const m of moved)
        console.log(`       ${pad(m.sym, 12)}stored ${pad(m.stored, 8)}CUR would write ${pad(show(m.cur), 8)}truth ${pad(m.truth ?? "-", 8)}${g.reject(m.fs, m.fe, m.pe!, m.ft)}`);
    }
    results[g.name] = { moved: moved.length, rescue, brk, neutral, breaks: breaks.map((b) => ({ sym: b.c.sym, stored: b.c.stored, cur: show(b.c.cur), why: b.why })), rescues: moved.map((m) => ({ sym: m.sym, stored: m.stored, cur: show(m.cur), truth: m.truth, u: m.u })) };
  }

  // ── THE REGRESSION PROOF, at the standard S4.3 set ───────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F2d — THE REGRESSION PROOF: does the winner change ANY correct label?      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const WINNER = GUARDS.find((g) => g.name === "G5 statutory ≤18")!;
  const byMonth = new Map<number, { n: number; unchanged: number }>();
  const byFyEndMonth = new Map<number, { n: number; unchanged: number }>();
  const byYear = new Map<number, { n: number; unchanged: number }>();
  let unchangedAll = 0;
  for (const c of cases) {
    const rejected = !!WINNER.reject(c.fs, c.fe, c.pe!, c.ft);
    const after: Derived = rejected ? { throw: "guard" } : c.cur;
    const same = show(after) === show(c.cur);
    if (same) unchangedAll++;
    const fem = c.fe.getUTCMonth() + 1;
    const yr = c.pe!.getUTCFullYear();
    for (const [map, key] of [[byMonth, c.windowM], [byFyEndMonth, fem], [byYear, yr]] as const) {
      const e = (map as Map<number, { n: number; unchanged: number }>).get(key as number) ?? { n: 0, unchanged: 0 };
      e.n++; if (same) e.unchanged++;
      (map as Map<number, { n: number; unchanged: number }>).set(key as number, e);
    }
  }
  console.log(`  chosen candidate: ${WINNER.name} — ${WINNER.note}`);
  console.log(`  rows whose DERIVED OUTPUT is byte-identical to the shipped deriver: ${unchangedAll}/${cases.length}`);
  console.log(`  rows that change: ${cases.length - unchangedAll}`);

  console.log(`\n  ── by DECLARED FISCAL-YEAR-END MONTH (the S4.3 axis: March · December · Sept · June) ──`);
  console.log(`  ${lp("fyEnd month", 13)}${lp("rows", 9)}${lp("unchanged", 12)}   verdict`);
  const MN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const [m, e] of [...byFyEndMonth].sort((a, b) => a[0] - b[0]))
    console.log(`  ${lp(`${MN[m]} (${m})`, 13)}${lp(e.n, 9)}${lp(e.unchanged, 12)}   ${e.n === e.unchanged ? "✓ ZERO MISMATCHES" : `⚠ ${e.n - e.unchanged} CHANGE`}`);

  console.log(`\n  ── by REPORTING YEAR (the full range) ──`);
  console.log(`  ${lp("year", 8)}${lp("rows", 9)}${lp("unchanged", 12)}   verdict`);
  for (const [y, e] of [...byYear].sort((a, b) => a[0] - b[0]))
    console.log(`  ${lp(y, 8)}${lp(e.n, 9)}${lp(e.unchanged, 12)}   ${e.n === e.unchanged ? "✓" : `⚠ ${e.n - e.unchanged} CHANGE`}`);

  console.log(`\n  ── by DECLARED-WINDOW LENGTH ──`);
  console.log(`  ${lp("months", 9)}${lp("rows", 9)}${lp("unchanged", 12)}   verdict`);
  for (const [m, e] of [...byMonth].sort((a, b) => a[0] - b[0]))
    console.log(`  ${lp(m, 9)}${lp(e.n, 9)}${lp(e.unchanged, 12)}   ${e.n === e.unchanged ? "✓" : `⚠ ${e.n - e.unchanged} CHANGE`}`);

  writeFileSync(`${DIR}/_f2d-proof.json`, JSON.stringify({
    counts: { docs: win.length, cases: cases.length, noPeriod, oldMatch, curMatch, curRefuse: curRefuse.length },
    curDelta: curDelta.map((c) => ({ sym: c.sym, stored: c.stored, cur: show(c.cur), truth: c.truth, windowM: c.windowM, fs: c.fs.toISOString().slice(0, 10), fe: c.fe.toISOString().slice(0, 10), pe: c.pe!.toISOString().slice(0, 10), src: c.src, u: c.u, tbl: c.tbl, rt: c.rt })),
    guards: results,
    regression: { unchanged: unchangedAll, total: cases.length, byFyEndMonth: [...byFyEndMonth], byYear: [...byYear], byMonth: [...byMonth] },
  }, null, 1));
  console.log(`\n  → ${DIR}/_f2d-proof.json\n`);
}
main();
