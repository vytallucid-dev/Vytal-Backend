import "dotenv/config"; import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const D=(s:string)=>new Date(`${s}T00:00:00Z`);
const grab=(x:string,t:string)=>{for(const ns of["in-bse-fin","in-capmkt"]){const m=new RegExp(`<${ns}:${t}\b[^>]*>([^<]*)</${ns}:${t}>`,"i").exec(x);if(m)return m[1].trim();}return null;};
const pad=(s:any,n:number)=>String(s).padEnd(n);
const rows = await raw(`SELECT q."fiscal_year" fy,q."quarter" q,q."result_type" rt,q."report_date"::text rd,q."source" src,q."xbrl_url" u
  FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"='DELHIVERY' ORDER BY q."report_date",q."result_type"`);
const [fy]:any = await raw(`SELECT "fiscalYearEnd"::text fye FROM stocks WHERE "symbol"='DELHIVERY'`);
console.log(`DELHIVERY fiscalYearEnd=${fy.fye}  rows=${rows.length}\n`);
console.log(`${pad("report_date",12)}${pad("basis",13)}${pad("stored",8)}${pad("derived",8)}${pad("declared FY window",26)}src`);
const cache=new Map<string,string|null>();
for (const r of rows) {
  let der="?",win="(no url)";
  if (r.u){ if(!cache.has(r.u)){try{cache.set(r.u,await fetchXbrlFile(r.u));}catch{cache.set(r.u,null);} await new Promise(x=>setTimeout(x,220));}
    const xml=cache.get(r.u);
    if(xml){const s=grab(xml,"DateOfStartOfFinancialYear"),e=grab(xml,"DateOfEndOfFinancialYear");
      const pe=grab(xml,"DateOfEndOfReportingPeriod")??String(r.rd).slice(0,10);
      win = s&&e ? `${s}..${e}` : "(window absent)";
      if(s&&e){try{const x=deriveFiscalPeriod(D(pe),D(s),D(e),"quarterly");der=x.fiscalYear+x.quarter;}catch(err){der="THROW";}}}
    else win="(fetch failed)"; }
  const stored=r.fy+r.q;
  console.log(`${pad(String(r.rd).slice(0,10),12)}${pad(r.rt,13)}${pad(stored,8)}${pad(der,8)}${pad(win,26)}${r.src}${der!==stored&&der!=="?"?"   ← CHANGES":""}`);
}
await prisma.$disconnect();
