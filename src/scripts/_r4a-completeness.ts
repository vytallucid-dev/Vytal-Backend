// ═══════════════════════════════════════════════════════════════
// R4a / R4g / R4h — COMPLETENESS, CONTINUITY, DEPTH. READ-ONLY.
//   npx tsx src/scripts/_r4a-completeness.ts
//
// R4a  PER STOCK, as a list of EXCEPTIONS: name every stock that is NOT complete
//      from its fill floor to today, and say exactly what is missing and why.
// R4g  CONTINUITY — every gap that would break consecutiveTail or an L3 annual
//      window. ⚠ Separated into GENUINE GAPS vs MIS-ORDERED LABELS, and
//      cross-referenced against the known FY23Q1 source gap so it is not
//      re-reported as new.
// R4h  DEPTH — oldest annual FY and oldest quarter per stock.
//
// ⚠ THE MEASUREMENT SPACE IS report_date, NOT THE FISCAL LABEL. R1k found four
//   stocks whose (fiscalYear, quarter) labels do not advance with time. Counting
//   gaps in label space would report those as holes that are not there, and miss
//   holes that are. Every quarter-end in India lands on the same Mar/Jun/Sep/Dec
//   calendar grid regardless of the filer's fiscal year, so report_date gives one
//   unambiguous axis for all 442.
//
//   The scorer, however, orders by the LABEL (loadMomentumStandalone →
//   quarterOrdinal(fiscalYear, quarter)). So R4g reports BOTH: continuity as it
//   truly is, and continuity as the engine will see it. Where they disagree, the
//   engine is wrong and that is a live defect independent of this backfill.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

/** calendar-quarter index from a period-end date: Mar→0, Jun→1, Sep→2, Dec→3 */
const cq = (rd: string) => { const y = +rd.slice(0, 4), m = +rd.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };
const cqLabel = (i: number) => `${Math.floor(i / 4)}${["Mar", "Jun", "Sep", "Dec"][i % 4]}`;
/** the scorer's own ordinal — derived from the LABEL, exactly as quarterOrdinal does */
const qOrd = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 4 + (Number(q.slice(1)) - 1);

const FY23Q1_RD = "2022-06-30"; // the known source gap's period-end
const L3_ANNUAL_WINDOW = 3;     // an L3 annual window needs 3 consecutive FYs
const TTM_QUARTERS = 8;         // M3/M4 need 8 consecutive quarters (TTM + prior TTM)

interface Row { sym: string; tbl: string; fy: string; q: string | null; rt: string; rd: string; src: string }

async function main() {
  const cohort = await loadCohort();
  const byId = new Map(cohort.map((c) => [c.id, c]));
  const ids = cohort.map((c) => c.id);

  const rows = await raw<any>(
    `SELECT "stock_id" sid,'quarterly_results' tbl,"fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"source" src FROM quarterly_results WHERE "stock_id"=ANY($1::text[])
      UNION ALL SELECT "stock_id",'banking_quarterly_results',"fiscal_year","quarter","result_type","report_date"::text,"source" FROM banking_quarterly_results WHERE "stock_id"=ANY($1::text[])
      UNION ALL SELECT "stock_id",'fundamentals',"fiscal_year",NULL,"result_type","report_date"::text,"source" FROM fundamentals WHERE "stock_id"=ANY($1::text[])
      UNION ALL SELECT "stock_id",'banking_fundamentals',"fiscal_year",NULL,"result_type","report_date"::text,"source" FROM banking_fundamentals WHERE "stock_id"=ANY($1::text[])`, ids);

  const per = new Map<string, Row[]>();
  for (const r of rows) {
    const sym = byId.get(r.sid)!.symbol;
    if (!per.has(sym)) per.set(sym, []);
    per.get(sym)!.push({ sym, tbl: r.tbl, fy: r.fy, q: r.q, rt: r.rt, rd: String(r.rd).slice(0, 10), src: r.src });
  }

  // the universe's latest quarter-end — "today" for completeness purposes
  const globalLast = Math.max(...rows.filter((r: any) => r.q).map((r: any) => cq(String(r.rd).slice(0, 10))));
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4a — PER-STOCK COMPLETENESS · EXCEPTIONS ONLY                             ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  "complete" = a STANDALONE row for every calendar quarter from the stock's own`);
  console.log(`  first held quarter through ${cqLabel(globalLast)} (the universe's latest), and a standalone`);
  console.log(`  annual row for every fiscal year across its own span. Measured on report_date.`);

  interface Ex {
    sym: string; ind: string;
    qFirst: string; qLast: string; qHeld: number;
    missRecov: number[];   // standalone missing BUT consolidated present → the defect this run targets
    missSource: number[];  // no row of either basis → source gap
    missFy23q1: boolean;
    tailShort: boolean; qTailMissing: number[]; // missing quarters between last standalone and today
    aFirst: string; aLast: string; aHeld: number; aMissRecov: string[]; aMissSource: string[];
    zero: boolean;
  }
  const exceptions: Ex[] = [];
  const complete: string[] = [];
  const depth: Array<{ sym: string; ind: string; oldestA: string; oldestQ: string; oldestQcq: number; oldestAfy: string }> = [];

  for (const c of cohort) {
    const rs = per.get(c.symbol) ?? [];
    const qs = rs.filter((r) => r.q !== null);
    const as = rs.filter((r) => r.q === null);

    if (!rs.length) {
      exceptions.push({ sym: c.symbol, ind: c.industryType, qFirst: "—", qLast: "—", qHeld: 0, missRecov: [], missSource: [], missFy23q1: false, tailShort: true, qTailMissing: [], aFirst: "—", aLast: "—", aHeld: 0, aMissRecov: [], aMissSource: [], zero: true });
      depth.push({ sym: c.symbol, ind: c.industryType, oldestA: "—", oldestQ: "—", oldestQcq: Infinity, oldestAfy: "—" });
      continue;
    }

    // ── quarterly ──
    const qSA = new Set(qs.filter((r) => r.rt === "standalone").map((r) => cq(r.rd)));
    const qANY = new Set(qs.map((r) => cq(r.rd)));
    const qFirst = qANY.size ? Math.min(...qANY) : 0;
    const missRecov: number[] = [], missSource: number[] = [];
    for (let i = qFirst; i <= globalLast; i++) {
      if (qSA.has(i)) continue;
      (qANY.has(i) ? missRecov : missSource).push(i);
    }
    const lastSA = qSA.size ? Math.max(...qSA) : -1;
    const qTailMissing: number[] = [];
    for (let i = lastSA + 1; i <= globalLast; i++) qTailMissing.push(i);

    // ── annual ── (fiscal-year label is safe here: annual rows are one per FY)
    const aSA = new Set(as.filter((r) => r.rt === "standalone").map((r) => r.fy));
    const aANY = new Set(as.map((r) => r.fy));
    const fyNum = (f: string) => parseInt(f.slice(2), 10);
    const aFirstN = aANY.size ? Math.min(...[...aANY].map(fyNum)) : 0;
    const aLastN = aANY.size ? Math.max(...[...aANY].map(fyNum)) : 0;
    const aMissRecov: string[] = [], aMissSource: string[] = [];
    for (let n = aFirstN; n <= aLastN; n++) {
      const f = `FY${String(n).padStart(2, "0")}`;
      if (aSA.has(f)) continue;
      (aANY.has(f) ? aMissRecov : aMissSource).push(f);
    }

    const qFirstRd = qs.length ? qs.map((r) => r.rd).sort()[0] : "—";
    const aFirstRd = as.length ? as.map((r) => r.rd).sort()[0] : "—";
    depth.push({
      sym: c.symbol, ind: c.industryType,
      oldestA: aFirstRd, oldestQ: qFirstRd,
      oldestQcq: qs.length ? Math.min(...qANY) : Infinity,
      oldestAfy: aANY.size ? `FY${String(aFirstN).padStart(2, "0")}` : "—",
    });

    const isEx = missRecov.length || missSource.length || aMissRecov.length || aMissSource.length || qTailMissing.length;
    if (isEx) {
      exceptions.push({
        sym: c.symbol, ind: c.industryType,
        qFirst: cqLabel(qFirst), qLast: cqLabel(lastSA < 0 ? qFirst : lastSA), qHeld: qSA.size,
        missRecov, missSource, missFy23q1: missSource.includes(cq(FY23Q1_RD)) || missRecov.includes(cq(FY23Q1_RD)),
        tailShort: qTailMissing.length > 0, qTailMissing,
        aFirst: `FY${String(aFirstN).padStart(2, "0")}`, aLast: `FY${String(aLastN).padStart(2, "0")}`, aHeld: aSA.size,
        aMissRecov, aMissSource, zero: false,
      });
    } else complete.push(c.symbol);
  }

  console.log(`\n  ${complete.length}/442 stocks are COMPLETE · ${exceptions.length} are exceptions (named below)\n`);

  // ── the exception list, grouped by CAUSE so it reads as a diagnosis not a dump ──
  const zeroRow = exceptions.filter((e) => e.zero);
  const recovOnly = exceptions.filter((e) => !e.zero && (e.missRecov.length || e.aMissRecov.length) && !e.missSource.length && !e.aMissSource.length);
  const sourceOnly = exceptions.filter((e) => !e.zero && !e.missRecov.length && !e.aMissRecov.length && (e.missSource.length || e.aMissSource.length));
  const both = exceptions.filter((e) => !e.zero && (e.missRecov.length || e.aMissRecov.length) && (e.missSource.length || e.aMissSource.length));

  const show = (title: string, list: Ex[], note: string) => {
    console.log(`  ── ${title} — ${list.length} stock(s)`);
    console.log(`     ${note}`);
    for (const e of list) {
      const bits: string[] = [];
      if (e.missRecov.length) bits.push(`qtr STANDALONE missing but CONSOLIDATED held ×${e.missRecov.length} [${e.missRecov.slice(0, 6).map(cqLabel).join(",")}${e.missRecov.length > 6 ? ",…" : ""}]`);
      if (e.missSource.length) bits.push(`qtr NO ROW either basis ×${e.missSource.length} [${e.missSource.slice(0, 6).map(cqLabel).join(",")}${e.missSource.length > 6 ? ",…" : ""}]`);
      if (e.aMissRecov.length) bits.push(`ann STANDALONE missing but CONSOLIDATED held [${e.aMissRecov.join(",")}]`);
      if (e.aMissSource.length) bits.push(`ann NO ROW either basis [${e.aMissSource.join(",")}]`);
      if (e.qTailMissing.length) bits.push(`⚠ TAIL SHORT — no standalone after ${e.qLast} (${e.qTailMissing.length} qtr(s) to today)`);
      console.log(`     ${pad(e.sym, 14)}${pad(e.ind, 14)} ${bits.join(" · ")}`);
    }
    console.log();
  };

  if (zeroRow.length) {
    console.log(`  ── ZERO ROWS ON ALL FOUR TABLES — ${zeroRow.length} stock(s)`);
    console.log(`     nothing was recovered at all; NSE returned no usable filing in the window`);
    for (const e of zeroRow) console.log(`     ${pad(e.sym, 14)}${e.ind}`);
    console.log();
  }
  show("STANDALONE RECOVERY INCOMPLETE (consolidated present, standalone absent)", recovOnly,
    "this is the exact defect the run targets — a period we HOLD but cannot score");
  show("SOURCE GAP ONLY (no row of either basis)", sourceOnly,
    "NSE has no document for the period; not recoverable by any re-run");
  show("BOTH", both, "mixed causes");

  // ── R4g — CONTINUITY ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4g — CONTINUITY: what breaks consecutiveTail / an L3 annual window        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  consecutiveTail walks BACK from the newest quarter while qOrdinal decrements by`);
  console.log(`  exactly 1, so ONLY the gap nearest the tail matters — everything before it is`);
  console.log(`  unreachable to the engine. M3/M4 need ${TTM_QUARTERS} consecutive quarters.\n`);

  const tailRuns: Array<{ sym: string; trueRun: number; scorerRun: number; firstBreakTrue: string; firstBreakScorer: string; misordered: boolean }> = [];
  for (const c of cohort) {
    const qs = (per.get(c.symbol) ?? []).filter((r) => r.q !== null && r.rt === "standalone");
    if (!qs.length) { tailRuns.push({ sym: c.symbol, trueRun: 0, scorerRun: 0, firstBreakTrue: "—", firstBreakScorer: "—", misordered: false }); continue; }

    // TRUTH: consecutive calendar quarters back from the newest held
    const trueIdx = [...new Set(qs.map((r) => cq(r.rd)))].sort((a, b) => a - b);
    let tRun = 1, tBreak = "—";
    for (let i = trueIdx.length - 1; i > 0; i--) {
      if (trueIdx[i] - trueIdx[i - 1] === 1) tRun++;
      else { tBreak = `${cqLabel(trueIdx[i - 1])}→${cqLabel(trueIdx[i])}`; break; }
    }
    // AS THE SCORER SEES IT: order by the LABEL, walk back on qOrdinal
    const scorerIdx = [...new Set(qs.map((r) => qOrd(r.fy, r.q!)))].sort((a, b) => a - b);
    let sRun = 1, sBreak = "—";
    for (let i = scorerIdx.length - 1; i > 0; i--) {
      if (scorerIdx[i] - scorerIdx[i - 1] === 1) sRun++;
      else { sBreak = `ord ${scorerIdx[i - 1]}→${scorerIdx[i]}`; break; }
    }
    // do the two orderings even agree on WHICH row is newest?
    const newestByRd = qs.slice().sort((a, b) => a.rd.localeCompare(b.rd)).at(-1)!;
    const newestByLabel = qs.slice().sort((a, b) => qOrd(a.fy, a.q!) - qOrd(b.fy, b.q!)).at(-1)!;
    const misordered = newestByRd.rd !== newestByLabel.rd;
    tailRuns.push({ sym: c.symbol, trueRun: tRun, scorerRun: sRun, firstBreakTrue: tBreak, firstBreakScorer: sBreak, misordered });
  }

  const shortTrue = tailRuns.filter((t) => t.trueRun < TTM_QUARTERS);
  const shortScorer = tailRuns.filter((t) => t.scorerRun < TTM_QUARTERS);
  const disagree = tailRuns.filter((t) => t.trueRun !== t.scorerRun);
  console.log(`  stocks whose TRUE consecutive tail < ${TTM_QUARTERS} quarters  : ${shortTrue.length}`);
  console.log(`  stocks whose SCORER-VISIBLE tail  < ${TTM_QUARTERS} quarters  : ${shortScorer.length}`);
  console.log(`  stocks where the two DISAGREE                     : ${disagree.length}  ${disagree.length ? "⚠" : "✓"}`);
  if (disagree.length) {
    console.log(`\n  ⚠⚠ THE MIS-ORDERED-LABEL DEFECT — separate from any gap, and PRE-EXISTING.`);
    console.log(`     loadMomentumStandalone orders by (fiscalYear, quarter). Where the label does not`);
    console.log(`     advance with time, the engine reads a DIFFERENT and SHORTER series than exists.`);
    console.log(`     ${pad("symbol", 14)}${lp("true tail", 11)}${lp("scorer tail", 13)}  newest-row disagreement · first break (scorer)`);
    for (const d of disagree.sort((a, b) => (a.scorerRun - a.trueRun) - (b.scorerRun - b.trueRun))) {
      console.log(`     ${pad(d.sym, 14)}${lp(d.trueRun, 11)}${lp(d.scorerRun, 13)}  ${d.misordered ? "⚠ picks the WRONG newest row" : "same newest row"} · ${d.firstBreakScorer}`);
    }
  }
  console.log(`\n  ── stocks with a TRUE tail shorter than ${TTM_QUARTERS} (M3/M4 unavailable) ──`);
  for (const t of shortTrue.sort((a, b) => a.trueRun - b.trueRun)) {
    console.log(`     ${pad(t.sym, 14)} tail ${lp(t.trueRun, 3)} qtr(s) · first break ${t.firstBreakTrue}`);
  }

  // FY23Q1 cross-reference — do NOT re-report the known gap as new
  const fy23Idx = cq(FY23Q1_RD);
  const hitByFy23 = exceptions.filter((e) => e.missSource.includes(fy23Idx) || e.missRecov.includes(fy23Idx));
  console.log(`\n  ── cross-reference against the KNOWN FY23Q1 source gap (period-end ${FY23Q1_RD}) ──`);
  console.log(`     stocks missing a STANDALONE row at ${FY23Q1_RD}: ${hitByFy23.length}`);
  console.log(`     of those, missing BOTH bases (true source gap): ${exceptions.filter((e) => e.missSource.includes(fy23Idx)).length}`);
  console.log(`     ⇒ these are the KNOWN gap, not a new finding. R5c re-runs the severance query universe-wide.`);

  // ── L3 annual window ──
  console.log(`\n  ── L3 annual window: stocks without ${L3_ANNUAL_WINDOW} consecutive STANDALONE fiscal years ──`);
  let l3ok = 0; const l3bad: string[] = [];
  for (const c of cohort) {
    const as = (per.get(c.symbol) ?? []).filter((r) => r.q === null && r.rt === "standalone");
    const ns = [...new Set(as.map((r) => parseInt(r.fy.slice(2), 10)))].sort((a, b) => a - b);
    let best = ns.length ? 1 : 0, run = 1;
    for (let i = 1; i < ns.length; i++) { run = ns[i] - ns[i - 1] === 1 ? run + 1 : 1; best = Math.max(best, run); }
    if (best >= L3_ANNUAL_WINDOW) l3ok++; else l3bad.push(`${c.symbol}(${best})`);
  }
  console.log(`     ${l3ok}/442 have ${L3_ANNUAL_WINDOW}+ consecutive standalone FYs · ${l3bad.length} do not`);
  for (let i = 0; i < l3bad.length; i += 6) console.log(`       ${l3bad.slice(i, i + 6).map((x) => pad(x, 20)).join("")}`);

  // ── R4h — DEPTH ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4h — DEPTH ACHIEVED                                                      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const reachFY18 = depth.filter((d) => d.oldestAfy === "FY18").length;
  const reachFY19orEarlier = depth.filter((d) => d.oldestAfy !== "—" && parseInt(d.oldestAfy.slice(2), 10) <= 19).length;
  const dec2018 = cq("2018-12-31");
  const reachDec2018 = depth.filter((d) => d.oldestQcq <= dec2018).length;
  console.log(`  oldest ANNUAL fiscal year reached:`);
  const byFy = new Map<string, number>();
  for (const d of depth) byFy.set(d.oldestAfy, (byFy.get(d.oldestAfy) ?? 0) + 1);
  for (const [k, v] of [...byFy.entries()].sort()) console.log(`    ${pad(k, 8)}${lp(v, 5)} stock(s)`);
  console.log(`  ⇒ reach FY18: ${reachFY18} · reach FY19 or earlier: ${reachFY19orEarlier} of 442`);
  console.log(`\n  oldest QUARTER reached:`);
  const byQ = new Map<string, number>();
  for (const d of depth) byQ.set(d.oldestQ === "—" ? "—" : d.oldestQ.slice(0, 4), (byQ.get(d.oldestQ === "—" ? "—" : d.oldestQ.slice(0, 4)) ?? 0) + 1);
  for (const [k, v] of [...byQ.entries()].sort()) console.log(`    ${pad(k, 8)}${lp(v, 5)} stock(s) start here`);
  console.log(`  ⇒ reach Dec-2018 or earlier: ${reachDec2018} of 442`);
  console.log(`\n  stocks that stop LATER than FY20 (NSE's listing does not go back further):`);
  const shallow = depth.filter((d) => d.oldestAfy !== "—" && parseInt(d.oldestAfy.slice(2), 10) >= 21).sort((a, b) => b.oldestAfy.localeCompare(a.oldestAfy));
  console.log(`    ${shallow.length} stock(s)`);
  for (const s of shallow.slice(0, 60)) console.log(`      ${pad(s.sym, 14)}${pad(s.ind, 14)} oldest annual ${s.oldestAfy} · oldest quarter ${s.oldestQ}`);
  if (shallow.length > 60) console.log(`      … ${shallow.length - 60} more`);

  writeFileSync(`${DIR}/_r4a-exceptions.json`, JSON.stringify({ complete, exceptions, depth, tailRuns }, null, 1));
  console.log(`\n  → ${DIR}/_r4a-exceptions.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
