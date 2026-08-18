// ═══════════════════════════════════════════════════════════════
// R5-E — MIS-ORDERED LABELS: THE CORRECTION. READ-ONLY. ⚠ REPORTS, FIXES NOTHING.
//   npx tsx src/scripts/_r5e-labels.ts [--fetch]
//
// E1 per mislabelled row: current (fiscalYear, quarter) vs the CORRECT one
//    derived from report_date and the filer's own fiscal-year end.
// E2 is the wrong label OURS or THE DOCUMENT'S? deriveFiscalPeriod reads
//    DateOfStartOfFinancialYear / DateOfEndOfFinancialYear OUT OF THE FILING.
//    With --fetch this reads those two tags back and shows what the document
//    actually declared — which decides whether this is our bug or the filer's
//    labelling faithfully carried through.
// E3 ENRIN — v3-only, live today, reads the WRONG quarter as latest. The real
//    Momentum functions are imported and run BOTH ways, so the numbers are the
//    engine's own, not a reconstruction.
// E4 relabel risk: the unique key is (stockId, fiscalYear, quarter, resultType),
//    so a relabel is a DELETE + INSERT, not an UPDATE. Collisions are found here.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { consecutiveTail, m1TtmOpm, m2TtmNpm, m3RevenueYoyTtm, m4NetProfitYoyTtm, m5TtmInterestCoverage } from "../scoring/metrics/momentum.js";
import type { MomentumQuarter } from "../scoring/metrics/types.js";

const DIR = process.env.R1_DIR ?? ".";
const DO_FETCH = process.argv.includes("--fetch");
const STOCKS = ["SIEMENS", "CEMPRO", "CANBK", "POWERINDIA", "DELHIVERY", "ENRIN"];
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const qOrd = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 4 + (Number(q.slice(1)) - 1);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** correct (fiscalYear, quarter) for a period-end, given the filer's FYE month */
function correctLabel(rd: string, fyeMonth: number) {
  const y = +rd.slice(0, 4), mo = +rd.slice(5, 7);
  const fyEndYear = mo <= fyeMonth ? y : y + 1;
  const startMonth = (fyeMonth % 12) + 1;
  const startYear = fyeMonth === 12 ? fyEndYear : fyEndYear - 1;
  const monthsFromStart = (y - startYear) * 12 + (mo - startMonth);
  const quarter = Math.floor(monthsFromStart / 3) + 1;
  return { fy: `FY${String(fyEndYear).slice(-2)}`, q: `Q${quarter}`, monthsFromStart };
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5-E — MIS-ORDERED LABELS · THE CORRECTION (report only)                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const out: any = { stocks: {} };
  for (const sym of STOCKS) {
    const [st] = await raw<any>(`SELECT "id","fiscalYearEnd"::text fye,"industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    if (!st) { console.log(`\n  ${sym}: not in universe`); continue; }
    const isBank = st.it === "banking";
    const qTbl = isBank ? "banking_quarterly_results" : "quarterly_results";
    const aTbl = isBank ? "banking_fundamentals" : "fundamentals";

    // the filer's REAL fiscal-year end, from the month its ANNUAL rows land on
    const ann = await raw<any>(
      `SELECT date_part('month',"report_date")::int m, count(*)::int c FROM "${aTbl}"
        WHERE "stock_id"=$1 GROUP BY 1 ORDER BY 2 DESC`, st.id);
    const fyeMonth = ann.length ? ann[0].m : (st.fye === "december" ? 12 : 3);

    // E1 needs only identity + labels; the financial columns differ per taxonomy
    // (banking_quarterly_results has interest_earned, not revenue) and are pulled
    // separately for ENRIN's E3 below.
    const rows = await raw<any>(
      `SELECT "fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"source" src
         FROM "${qTbl}" WHERE "stock_id"=$1 AND "result_type"='standalone' ORDER BY "report_date"`, st.id);
    void isBank;

    console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ ${pad(sym + `  ·  fiscal-year end = month ${fyeMonth}  ·  stocks.fiscalYearEnd = ${st.fye}`, 73)}║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
    console.log(`  ${pad("report_date", 13)}${pad("current", 9)}${pad("correct", 9)}${pad("source", 27)}verdict`);

    const fixes: any[] = [];
    for (const r of rows) {
      const rd = String(r.rd).slice(0, 10);
      const c = correctLabel(rd, fyeMonth);
      const same = c.fy === r.fy && c.q === r.q;
      if (!same) fixes.push({ rd, current: `${r.fy}${r.q}`, correct: `${c.fy}${c.q}`, basis: r.rt, src: r.src });
      console.log(`  ${pad(rd, 13)}${pad(r.fy + r.q, 9)}${pad(c.fy + c.q, 9)}${pad(r.src, 27)}${same ? "✓" : "⚠ MISLABELLED"}`);
    }
    console.log(`\n  ⇒ ${fixes.length} of ${rows.length} standalone rows carry the wrong label`);
    const bySrc = new Map<string, number>();
    for (const f of fixes) bySrc.set(f.src, (bySrc.get(f.src) ?? 0) + 1);
    console.log(`     by source: ${[...bySrc.entries()].map(([k, v]) => `${k}×${v}`).join(" · ") || "—"}`);

    // ── E4 — would the correction collide? ──
    const heldKeys = new Set(rows.map((r: any) => `${r.fy}${r.q}|${r.rt}`));
    const collide = fixes.filter((f) => heldKeys.has(`${f.correct}|${f.basis}`));
    console.log(`  ── E4 relabel risk: the unique key is (stockId, fiscalYear, quarter, resultType)`);
    console.log(`     corrected labels that COLLIDE with a row already held: ${collide.length === 0 ? "✓ none" : "⚠ " + collide.length}`);
    for (const c2 of collide) console.log(`       ⚠ ${c2.rd} ${c2.current} → ${c2.correct} — but ${c2.correct} ${c2.basis} already exists`);
    out.stocks[sym] = { fyeMonth, rows: rows.length, fixes, collisions: collide.length };
  }

  // ── E3 — ENRIN, the live defect, with the engine's own functions ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ E3 — ENRIN: what Momentum returns NOW vs with correct ordering             ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [en] = await raw<any>(`SELECT "id" FROM stocks WHERE "symbol"='ENRIN'`);
  if (en) {
    const rows = await raw<any>(
      `SELECT "fiscal_year" fy,"quarter" q,"report_date"::text rd,"revenue"::float8 rev,"other_income"::float8 oi,
              "interest"::float8 intr,"depreciation"::float8 dep,"profit_before_tax"::float8 pbt,
              "net_profit"::float8 np,"operating_profit"::float8 op,"source" src
         FROM quarterly_results WHERE "stock_id"=$1 AND "result_type"='standalone' ORDER BY "report_date"`, en.id);
    const [ast] = await raw<any>(`SELECT date_part('month',max("report_date"))::int m FROM fundamentals WHERE "stock_id"=$1`, en.id);
    const fyeMonth = ast?.m ?? 3;
    const mk = (r: any, fy: string, q: string): MomentumQuarter => ({
      fiscalYear: fy, quarter: q, qOrdinal: qOrd(fy, q),
      revenue: n(r.rev), otherIncome: n(r.oi), interest: n(r.intr), depreciation: n(r.dep),
      profitBeforeTax: n(r.pbt), netProfit: n(r.np), operatingProfitStored: n(r.op),
    });
    const asStored = rows.map((r: any) => mk(r, r.fy, r.q));
    const corrected = rows.map((r: any) => { const c = correctLabel(String(r.rd).slice(0, 10), fyeMonth); return mk(r, c.fy, c.q); });

    console.log(`  ENRIN holds ${rows.length} standalone quarters (fiscal-year end month ${fyeMonth}):`);
    console.log(`  ${pad("report_date", 13)}${pad("stored", 9)}${pad("correct", 9)}${lp("revenue", 12)}${lp("netProfit", 12)}`);
    for (const r of rows) {
      const c = correctLabel(String(r.rd).slice(0, 10), fyeMonth);
      console.log(`  ${pad(String(r.rd).slice(0, 10), 13)}${pad(r.fy + r.q, 9)}${pad(c.fy + c.q, 9)}${lp(r.rev ?? "null", 12)}${lp(r.np ?? "null", 12)}`);
    }

    const run = (qs: MomentumQuarter[], label: string) => {
      const tail = consecutiveTail(qs);
      const newest = tail.at(-1);
      console.log(`\n  ── ${label} ──`);
      console.log(`     consecutiveTail length : ${tail.length} quarter(s)`);
      console.log(`     snapshot quarter       : ${newest ? `${newest.fiscalYear}${newest.quarter}` : "—"}`);
      const ms = [["M1 TTM OPM", m1TtmOpm(tail)], ["M2 TTM NPM", m2TtmNpm(tail)],
                  ["M3 Rev YoY TTM", m3RevenueYoyTtm(tail)], ["M4 NP YoY TTM", m4NetProfitYoyTtm(tail)],
                  ["M5 TTM IntCov", m5TtmInterestCoverage(tail)]] as [string, any][];
      for (const [nm, v] of ms) {
        console.log(`     ${pad(nm, 18)} ${v?.value === null || v?.value === undefined ? "null" : Number(v.value).toFixed(2)}${v?.reason ? `   (${v.reason})` : ""}`);
      }
      return { tail: tail.length, snapshot: newest ? `${newest.fiscalYear}${newest.quarter}` : null, metrics: ms.map(([nm, v]) => ({ metric: nm, value: v?.value ?? null, reason: v?.reason ?? null })) };
    };
    const a = run(asStored, "AS STORED — what the engine reads TODAY");
    const b = run(corrected, "WITH CORRECT LABELS — what it should read");
    out.enrin = { asStored: a, corrected: b };
    console.log(`\n  ⇒ the engine's snapshot quarter is ${a.snapshot}; the chronologically newest quarter is ${b.snapshot}.`);
    console.log(`    ⚠ This is a LIVE scoring defect on v3-only data, independent of the backfill.`);
  }

  // ── E2 — whose label is wrong: ours or the document's? ──
  if (DO_FETCH) {
    console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ E2 — WHOSE LABEL IS IT? the fiscal window the DOCUMENT declares            ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
    const { fetchFilingsList, fetchXbrlFile } = await import("../ingestions/quaterly-results/legacy/discovery-legacy.js");
    const grab = (xml: string, tag: string) =>
      new RegExp(`<in-bse-fin:${tag}\\b[^>]*>([^<]*)</in-bse-fin:${tag}>`, "i").exec(xml)?.[1]?.trim() ?? null;
    for (const sym of STOCKS) {
      const fixes = out.stocks[sym]?.fixes ?? [];
      if (!fixes.length) continue;
      console.log(`\n  ── ${sym} — reading DateOfStartOfFinancialYear / DateOfEndOfFinancialYear from source`);
      let list: any[]; try { list = await fetchFilingsList(sym, "Quarterly"); await sleep(400); }
      catch (e) { console.log(`     listing failed: ${(e as Error).message.slice(0, 60)}`); continue; }
      for (const f of fixes.slice(0, 4)) {
        const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const hit = list.find((x: any) => {
          const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(x.toDate); if (!m) return false;
          const iso = `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
          return iso === f.rd && (x.consolidated === "Consolidated" ? "consolidated" : "standalone") === f.basis;
        });
        if (!hit) { console.log(`     ${f.rd}: listing entry not found`); continue; }
        try {
          const xml = await fetchXbrlFile(hit.xbrl);
          const s = grab(xml, "DateOfStartOfFinancialYear"), e2 = grab(xml, "DateOfEndOfFinancialYear");
          const pe = grab(xml, "DateOfEndOfReportingPeriod");
          console.log(`     ${pad(f.rd, 12)} stored ${pad(f.current, 8)} correct ${pad(f.correct, 8)}`);
          console.log(`         document declares: FY ${s} .. ${e2}   period-end ${pe}`);
          console.log(`         ⇒ ${s && e2 ? `deriveFiscalPeriod(${pe}, ${s}, ${e2}) → our label. The FILING's own window produces it.` : "tags missing"}`);
          await sleep(400);
        } catch (err) { console.log(`     ${f.rd}: ${(err as Error).message.slice(0, 60)}`); }
      }
    }
  } else {
    console.log(`\n  (E2 needs the source documents — re-run with --fetch AFTER the backfill)`);
  }

  writeFileSync(`${DIR}/_r5e-labels.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_r5e-labels.json`);
  console.log(`  ⚠ REPORT ONLY — nothing was relabelled.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
