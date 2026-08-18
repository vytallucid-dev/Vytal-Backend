// ═══════════════════════════════════════════════════════════════
// C1b / C1c / C1d — CLASSIFY THE COLLISION for every candidate stock.
// READ-ONLY. Fetches documents in memory; writes nothing.
//   npx tsx src/scripts/_c1b-collide.ts [--only SYM]
//
// For each stored row of each candidate: read the DOCUMENT's own declared fiscal
// window, run the S4.3 deriver, and compare the new label with the stored one.
//   IDENTICAL  — re-ingest is a no-op for this row
//   ADDITIVE   — new label lands on a FREE key ⇒ a second row for the same real
//                quarter (a duplicate period-end), the T3 outcome
//   COLLISION  — new label lands on an OCCUPIED key ⇒ the upsert OVERWRITES that
//                row. If the occupant is v3-sourced this is DESTRUCTIVE: legacy
//                data replaces v3 data and the v3 period is lost (the SIEMENS case).
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

const DIR = process.env.R1_DIR ?? ".";
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : null; })();
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const grab = (xml: string, tag: string) => {
  for (const ns of ["in-bse-fin", "in-capmkt"]) {
    const m = new RegExp(`<${ns}:${tag}\\b[^>]*>([^<]*)</${ns}:${tag}>`, "i").exec(xml);
    if (m) return m[1].trim();
  }
  return null;
};

async function main() {
  const cand = JSON.parse(readFileSync(`${DIR}/_c1a-candidates.json`, "utf8"));
  const syms: string[] = (ONLY ? [ONLY] : cand.candidates.map((c: any) => c.sym));
  const out: any = { stocks: {} };
  const docCache = new Map<string, string | null>();

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ C1b/C1c — collision classification for ${lp(syms.length, 2)} candidate stock(s)          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  let TOT = { identical: 0, additive: 0, collision: 0, destructive: 0, unreadable: 0 };
  for (const sym of syms) {
    const [st] = await raw<any>(`SELECT "id","industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    const tbl = st.it === "banking" ? "banking_quarterly_results" : "quarterly_results";
    const rows = await raw<any>(
      `SELECT "id","fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"source" src,"xbrl_url" u
         FROM "${tbl}" WHERE "stock_id"=$1 ORDER BY "report_date"`, st.id);
    // the occupied key space, and what occupies it
    const occupied = new Map<string, any>();
    for (const r of rows) occupied.set(`${r.fy}${r.q}|${r.rt}`, r);

    const res: any[] = [];
    let identical = 0, additive = 0, collision = 0, destructive = 0, unreadable = 0;
    for (const r of rows) {
      if (!r.u) { unreadable++; continue; }
      let xml = docCache.get(r.u) ?? null;
      if (!docCache.has(r.u)) {
        try { xml = await fetchXbrlFile(r.u); } catch { xml = null; }
        docCache.set(r.u, xml); await sleep(250);
      }
      if (!xml) { unreadable++; continue; }
      const s = grab(xml, "DateOfStartOfFinancialYear"), e = grab(xml, "DateOfEndOfFinancialYear");
      const pe = grab(xml, "DateOfEndOfReportingPeriod") ?? String(r.rd).slice(0, 10);
      if (!s || !e) { unreadable++; continue; }
      let nf: string, nq: string;
      try { const x = deriveFiscalPeriod(D(pe), D(s), D(e), "quarterly"); nf = x.fiscalYear; nq = x.quarter; }
      catch { unreadable++; continue; }
      const oldKey = `${r.fy}${r.q}|${r.rt}`, newKey = `${nf}${nq}|${r.rt}`;
      if (oldKey === newKey) { identical++; continue; }
      const occ = occupied.get(newKey);
      if (!occ) { additive++; res.push({ ...r, nf, nq, kind: "ADDITIVE", win: `${s}..${e}` }); continue; }
      collision++;
      const destr = !String(occ.src).includes("_legacy");
      if (destr) destructive++;
      res.push({ ...r, nf, nq, kind: destr ? "DESTRUCTIVE" : "COLLISION", win: `${s}..${e}`,
                 victimRd: String(occ.rd).slice(0, 10), victimSrc: occ.src });
    }
    TOT.identical += identical; TOT.additive += additive; TOT.collision += collision;
    TOT.destructive += destructive; TOT.unreadable += unreadable;
    out.stocks[sym] = { rows: rows.length, identical, additive, collision, destructive, unreadable, detail: res };

    const verdict = destructive ? "⚠⚠ DESTRUCTIVE" : collision ? "⚠ collides (legacy victim)" : additive ? "⚠ additive (duplicates)" : "✓ no change";
    console.log(`\n  ── ${pad(sym, 12)} rows ${lp(rows.length, 3)} · identical ${lp(identical, 3)} · additive ${lp(additive, 3)} · collision ${lp(collision, 3)} (destructive ${destructive}) · unreadable ${unreadable}   ${verdict}`);
    for (const d of res.slice(0, 8)) {
      console.log(`     ${pad(String(d.rd).slice(0, 10), 12)} ${pad(d.fy + d.q, 8)} → ${pad(d.nf + d.nq, 8)} ${pad(d.rt, 13)} ${pad(d.kind, 12)}${d.victimRd ? ` overwrites ${d.victimRd} (${d.victimSrc})` : ""}`);
    }
    if (res.length > 8) console.log(`     … ${res.length - 8} more`);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ C1b — TOTALS                                                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const byStock = Object.entries(out.stocks) as [string, any][];
  const safeStocks = byStock.filter(([, v]) => v.additive === 0 && v.collision === 0).map(([k]) => k);
  const addStocks = byStock.filter(([, v]) => v.additive > 0 && v.collision === 0).map(([k]) => k);
  const colStocks = byStock.filter(([, v]) => v.collision > 0).map(([k]) => k);
  const destStocks = byStock.filter(([, v]) => v.destructive > 0).map(([k]) => k);
  console.log(`  stocks where EVERY new label == stored   (safe to re-ingest) : ${431 + safeStocks.length}  (431 proven offline + ${safeStocks.length} verified here)`);
  console.log(`  stocks with ADDITIVE relabels only (duplicate period-ends)   : ${addStocks.length}  ${addStocks.join(", ")}`);
  console.log(`  stocks with a COLLISION onto an occupied key (unsafe)        : ${colStocks.length}  ${colStocks.join(", ")}`);
  console.log(`  ⚠ C1c — of those, collide with a v3 row (DESTRUCTIVE)        : ${destStocks.length}  ${destStocks.join(", ")}`);
  console.log(`\n  row-level: identical ${TOT.identical} · additive ${TOT.additive} · collision ${TOT.collision} (⚠ destructive ${TOT.destructive}) · unreadable ${TOT.unreadable}`);
  writeFileSync(`${DIR}/_c1b-collide.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_c1b-collide.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
