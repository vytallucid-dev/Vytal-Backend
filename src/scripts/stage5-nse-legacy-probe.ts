// ═══════════════════════════════════════════════════════════════
// STAGE 5 PROBE — can NSE legacy serve the periods BSE could not?
//
//   npx tsx src/scripts/stage5-nse-legacy-probe.ts
//
// READ-ONLY. Lists NSE's legacy filings for the NBFC stocks still short, and
// reports whether each MISSING period has a filing there AND whether that filing
// carries an XBRL URL.
//
// ⚠️ WHY THIS IS A PROBE AND NOT A BACKFILL. The plan says "try NSE legacy first".
//    The only entry point is backfillLegacySymbol(), and it is the function the
//    plan itself warns about: it upserts the WHOLE annual row and nulls
//    BSE-filled balance-sheet columns while reporting refreshed=0 — 133 cells
//    destroyed in an earlier session. Its options are only fromDate/toDate, so
//    there is NO way to run its quarterly leg alone; the Annual leg always runs.
//
//    Stage 4 has since written BSE-sourced rows for these very stocks. So running
//    it now is exactly the destructive case. This probe establishes whether NSE
//    legacy has anything to offer BEFORE anyone takes that risk — and if it does
//    not, the risk is never worth taking.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { fetchFilingsList } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const OUT = "_s5-nse-legacy-probe.json";

/** The NBFC stocks still short after Stage 4, and what each is missing. */
const TARGETS: Record<string, { annual: string[]; quarterly: string[] }> = {
  SUNDARMFIN: { annual: ["2019-03-31", "2021-03-31"], quarterly: ["2019-03-31", "2019-06-30", "2019-09-30", "2021-03-31"] },
  "360ONE": { annual: ["2021-03-31"], quarterly: [] },
  AIIL: { annual: ["2025-03-31"], quarterly: ["2025-03-31"] },
  ANGELONE: { annual: ["2025-03-31"], quarterly: ["2025-03-31"] },
  IIFL: { annual: [], quarterly: ["2019-06-30", "2019-09-30"] },
  MFSL: { annual: [], quarterly: ["2019-06-30", "2019-09-30"] },
  JMFINANCIL: { annual: [], quarterly: ["2019-06-30"] },
  PFC: { annual: [], quarterly: ["2019-06-30"] },
  SHRIRAMFIN: { annual: [], quarterly: ["2019-06-30"] },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** NSE returns the period end under several names across vintages. */
function periodOf(f: Record<string, unknown>): string | null {
  for (const k of ["toDate", "to_date", "period_ended", "periodEnded", "reportingPeriod"]) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
function xbrlOf(f: Record<string, unknown>): string | null {
  for (const k of ["xbrl", "xbrlUrl", "xbrl_attachment", "xbrlAttachment"]) {
    const v = f[k];
    if (typeof v === "string" && v.trim() && v.trim() !== "-") return v.trim();
  }
  return null;
}
/** "31-Mar-2019" / "2019-03-31" / "31-03-2019" -> ISO. */
function toIso(s: string): string | null {
  const M: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})/.exec(s);
  if (m) return `${m[3]}-${M[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

async function main(): Promise<void> {
  console.log(`\n=== STAGE 5 PROBE — NSE legacy availability (READ-ONLY) ===\n`);
  const report: Record<string, unknown>[] = [];
  let servable = 0, listedNoXbrl = 0, absent = 0;

  for (const [symbol, want] of Object.entries(TARGETS)) {
    for (const period of ["Annual", "Quarterly"] as const) {
      const wanted = period === "Annual" ? want.annual : want.quarterly;
      if (!wanted.length) continue;
      let filings: Record<string, unknown>[] = [];
      let err: string | null = null;
      try {
        filings = (await fetchFilingsList(symbol, period)) as Record<string, unknown>[];
      } catch (e) {
        err = (e as Error).message;
      }
      const index = new Map<string, string | null>(); // iso period -> xbrl url or null
      for (const f of filings) {
        const p = periodOf(f);
        const iso = p ? toIso(p) : null;
        if (iso) index.set(iso, xbrlOf(f));
      }
      for (const w of wanted) {
        const has = index.has(w);
        const xbrl = index.get(w) ?? null;
        const verdict = err ? `ERROR: ${err.slice(0, 50)}` : !has ? "not listed at NSE" : xbrl ? "HAS XBRL — servable" : "listed, NO XBRL";
        if (!err) { if (!has) absent++; else if (xbrl) servable++; else listedNoXbrl++; }
        console.log(`  ${symbol.padEnd(12)} ${period.padEnd(10)} ${w}  ${verdict}`);
        report.push({ symbol, period, wanted: w, listedAtNse: has, xbrlUrl: xbrl, verdict });
      }
      console.log(`     (${symbol} ${period}: NSE lists ${filings.length} filings, ${[...index.values()].filter(Boolean).length} with XBRL)`);
      await sleep(800);
    }
  }

  console.log(`\n-- SUMMARY --`);
  console.log(`  servable from NSE legacy (has XBRL) : ${servable}`);
  console.log(`  listed at NSE but NO XBRL           : ${listedNoXbrl}`);
  console.log(`  not listed at NSE at all            : ${absent}`);
  if (servable === 0) {
    console.log(`\n  => NSE legacy offers NOTHING these periods need.`);
    console.log(`     Running backfillLegacySymbol would risk the BSE cells Stage 4 wrote`);
    console.log(`     for ZERO gain. Route these to the manual workbook instead.`);
  }
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), servable, listedNoXbrl, absent, report }, null, 2));
  console.log(`\n  detail -> ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
