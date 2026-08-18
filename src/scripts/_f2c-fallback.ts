// F2c — WHAT THE stocks.fiscalYearEnd FALLBACK ACTUALLY GIVES YOU. READ-ONLY.
import "dotenv/config"; import { readFileSync } from "node:fs"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n); const lp=(s:any,n:number)=>String(s).padStart(n);
const MN=["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const all = readFileSync("_f2-corpus.jsonl","utf-8").split("\n").filter(l=>l.trim()).map(l=>JSON.parse(l));
// declared fyEnd month per stock, from the documents themselves
const per = new Map<string, Map<number, number>>();
for (const c of all) { if (!c.fye) continue; const m = +c.fye.slice(5,7);
  if (!per.has(c.sym)) per.set(c.sym, new Map()); const e = per.get(c.sym)!; e.set(m,(e.get(m)??0)+1); }

const cols = await raw(`SELECT s."symbol" sym, s."fiscalYearEnd"::text fye, s."industryType"::text ind, s."is_active" act FROM stocks s`);
const col = new Map(cols.map((r:any)=>[r.sym, r]));

console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
console.log(`║ F2c — the fallback column vs what the FILINGS declare                      ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
console.log(`  stocks.fiscalYearEnd is an ENUM with exactly two values: march | december.`);
const dist = await raw(`SELECT "fiscalYearEnd"::text fye, count(*)::int n FROM stocks GROUP BY 1 ORDER BY 2 DESC`);
console.log(`  column distribution: ${dist.map((d:any)=>`${d.fye}=${d.n}`).join("  ")}`);

let agree=0, disagree=0, multi=0; const bad:any[]=[];
for (const [sym, months] of per) {
  const c:any = col.get(sym); if (!c) continue;
  const declared = [...months.entries()].sort((a,b)=>b[1]-a[1]);
  if (declared.length>1) multi++;
  const dominant = declared[0][0];
  const expected = c.fye === "december" ? 12 : 3;
  if (dominant === expected) agree++; else { disagree++; bad.push({sym, col:c.fye, ind:c.ind, declared: declared.map(([m,n])=>`${MN[m]}×${n}`).join(" ")}); }
}
console.log(`\n  stocks with filings                                  : ${per.size}`);
console.log(`  dominant declared fyEnd month AGREES with the column : ${agree}`);
console.log(`  DISAGREES                                            : ${disagree}`);
console.log(`  stocks declaring MORE THAN ONE fyEnd month over time : ${multi}   ← the column is single-valued and cannot express this`);
console.log(`\n  ── every stock whose declared year-end the column cannot express ──`);
console.log(`  ${pad("symbol",13)}${pad("column",11)}${pad("industry",15)}declared fyEnd months`);
for (const b of bad) console.log(`  ${pad(b.sym,13)}${pad(b.col,11)}${pad(b.ind,15)}${b.declared}`);

console.log(`\n  ── the stocks with irregular windows: what would the fallback say? ──`);
for (const sym of ["DELHIVERY","SIEMENS","GILLETTE","CEMPRO","POWERINDIA","CANBK","IOB","ACC","AMBUJACEM","NESTLEIND","IGIL"]) {
  const c:any = col.get(sym); const months = per.get(sym);
  const declared = months ? [...months.entries()].sort((a,b)=>b[1]-a[1]).map(([m,n])=>`${MN[m]}×${n}`).join(" ") : "-";
  console.log(`  ${pad(sym,13)}column=${pad(c?.fye ?? "-",10)}active=${pad(c?.act,7)}declared over time: ${declared}`);
}

console.log(`\n  ── IOB: is it in the 442 cohort, and does it carry the CANBK defect? ──`);
const iob = await raw(`SELECT s."symbol" sym, s."industryType"::text ind, s."is_active" act,
   (SELECT count(*)::int FROM banking_quarterly_results q WHERE q."stock_id"=s."id") bq,
   (SELECT count(*)::int FROM quarterly_results q WHERE q."stock_id"=s."id") nq
   FROM stocks s WHERE s."symbol" IN ('IOB','CANBK')`);
for (const r of iob) console.log(`  ${pad(r.sym,10)}${pad(r.ind,12)}active=${pad(r.act,7)}banking_q=${lp(r.bq,5)} nonfin_q=${lp(r.nq,5)}`);
const rows = await raw(`SELECT s."symbol" sym, q."fiscal_year" fy, q."quarter" q, q."result_type" rt, q."report_date"::text rd, q."source" src
  FROM banking_quarterly_results q JOIN stocks s ON s."id"=q."stock_id"
  WHERE s."symbol" IN ('IOB','CANBK') AND q."report_date" BETWEEN DATE '2022-04-01' AND DATE '2022-12-31' ORDER BY s."symbol", q."report_date", q."result_type"`);
console.log(`\n  ${pad("symbol",10)}${pad("report_date",13)}${pad("stored",9)}${pad("basis",13)}source`);
for (const r of rows) console.log(`  ${pad(r.sym,10)}${pad(String(r.rd).slice(0,10),13)}${pad(r.fy+r.q,9)}${pad(r.rt,13)}${r.src}`);
await prisma.$disconnect();
