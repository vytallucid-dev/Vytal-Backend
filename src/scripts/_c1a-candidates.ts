// ═══════════════════════════════════════════════════════════════
// C1a — WHICH STOCKS COULD RELABEL UNDER THE S4.3 DERIVER? Offline, exact.
// READ-ONLY. No NSE, no writes.
//   npx tsx src/scripts/_c1a-candidates.ts
//
// S4.3b proved EXHAUSTIVELY (160/160 cases) that the new deriver reproduces the
// old one byte-for-byte whenever the declared fiscal-year END month is MARCH or
// DECEMBER. So a stock can only relabel if some filing declared a year-end in
// neither — and that is detectable from what is already stored.
//
// THE DISCRIMINATOR. The old deriver had exactly two output maps:
//     December branch (fyEndMonth === 12): Mar→Q1 Jun→Q2 Sep→Q3 Dec→Q4
//     "March" branch  (everything else)  : Jun→Q1 Sep→Q2 Dec→Q3 Mar→Q4
// and fiscalYear = the year the declared fiscal year ENDS. So for each stored row
// the branch is readable from (report_date month → quarter), and the declared
// fyEnd YEAR is readable from the FY label. Cross-checking the two pins whether
// the declared year-end really was March/December:
//
//   March-branch row: under a TRUE March year-end, a period ending in Apr..Dec
//   belongs to the fiscal year ending the NEXT calendar year; one ending Jan..Mar
//   to the fiscal year ending the SAME year. If the stored FY is EARLIER than that,
//   the declared year-end must fall earlier in the calendar year (Jun, Sep, …) —
//   i.e. NOT March, and the row WILL relabel.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

const DEC_MAP: Record<number, string> = { 3: "Q1", 6: "Q2", 9: "Q3", 12: "Q4" };
const MAR_MAP: Record<number, string> = { 6: "Q1", 9: "Q2", 12: "Q3", 3: "Q4" };

async function main() {
  const rows = await raw<any>(
    `SELECT st."symbol" sym, st."industryType"::text ind, t.fy, t.q, t.rt, t.rd, t.src, t.tbl FROM (
        SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"source" src,'quarterly_results' tbl FROM quarterly_results
        UNION ALL
        SELECT "stock_id","fiscal_year","quarter","result_type","report_date"::text,"source",'banking_quarterly_results' FROM banking_quarterly_results) t
      JOIN stocks st ON st."id"=t.sid`);

  const per = new Map<string, any[]>();
  for (const r of rows) { if (!per.has(r.sym)) per.set(r.sym, []); per.get(r.sym)!.push(r); }

  interface Flag { sym: string; ind: string; rows: number; oddRows: number; samples: string[]; branches: string }
  const candidates: Flag[] = [];
  const safe: string[] = [];

  for (const [sym, rs] of per) {
    let odd = 0; const samples: string[] = []; const branchSeen = new Set<string>();
    for (const r of rs) {
      const rd = String(r.rd).slice(0, 10);
      const m = +rd.slice(5, 7), y = +rd.slice(0, 4);
      const storedFy = parseInt(String(r.fy).slice(2), 10) + 2000;
      const isDec = DEC_MAP[m] === r.q, isMar = MAR_MAP[m] === r.q;
      if (isDec) branchSeen.add("dec");
      if (isMar) branchSeen.add("mar");
      if (!isDec && !isMar) { odd++; if (samples.length < 3) samples.push(`${rd}→${r.fy}${r.q} (matches NEITHER map)`); continue; }
      // expected fyEnd year under a TRUE calendar of that branch
      let expected: number;
      if (isDec && !isMar) expected = y;                    // Dec year-end: FY = calendar year
      else if (isMar && !isDec) expected = m >= 4 ? y + 1 : y; // Mar year-end
      else continue;                                        // ambiguous (both maps agree) — no signal
      if (storedFy !== expected) {
        odd++;
        if (samples.length < 3) samples.push(`${rd}→${r.fy}${r.q} (a true ${isDec ? "Dec" : "Mar"} year-end would label it FY${String(expected).slice(-2)})`);
      }
    }
    if (odd > 0) candidates.push({ sym, ind: rs[0].ind, rows: rs.length, oddRows: odd, samples, branches: [...branchSeen].join("+") || "none" });
    else safe.push(sym);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ C1a — which stocks could RELABEL under the S4.3 deriver?                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  stocks holding quarterly rows                     : ${per.size}`);
  console.log(`  ✓ every row consistent with a TRUE March/December year-end`);
  console.log(`    ⇒ PROVABLY SAFE (S4.3b: 160/160 identical)      : ${safe.length}`);
  console.log(`  ⚠ at least one row implies a year-end that is NEITHER`);
  console.log(`    ⇒ CANDIDATE for relabel                          : ${candidates.length}`);

  console.log(`\n  ── the candidates ──`);
  console.log(`  ${pad("symbol", 13)}${pad("ind", 14)}${lp("rows", 6)}${lp("odd", 5)}  evidence`);
  for (const c of candidates.sort((a, b) => b.oddRows - a.oddRows)) {
    console.log(`  ${pad(c.sym, 13)}${pad(c.ind, 14)}${lp(c.rows, 6)}${lp(c.oddRows, 5)}  ${c.samples[0] ?? ""}`);
    for (const s of c.samples.slice(1)) console.log(`  ${pad("", 38)}${s}`);
  }

  writeFileSync(`${DIR}/_c1a-candidates.json`, JSON.stringify({ safe, candidates }, null, 1));
  console.log(`\n  → ${DIR}/_c1a-candidates.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
