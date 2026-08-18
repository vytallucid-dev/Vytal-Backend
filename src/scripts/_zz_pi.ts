import "dotenv/config"; import { readFileSync } from "node:fs"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n);
// declared windows straight from the corpus
const corpus = readFileSync("_f2-corpus.jsonl","utf-8").split("\n").filter(l=>l.trim()).map(l=>JSON.parse(l));
const win = new Map<string,any>(); for (const c of corpus) if (!c.err) win.set(c.u, c);
for (const sym of ["POWERINDIA","DELHIVERY"]) {
  const rows = await raw(`SELECT q."fiscal_year"||q."quarter" lbl, q."result_type" rt, q."report_date"::text rd, q."source" src, q."xbrl_url" u
    FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"=$1 ORDER BY q."report_date", q."result_type"`, sym);
  console.log(`\n══ ${sym} — ${rows.length} rows ══`);
  console.log(`  ${pad("report_date",13)}${pad("basis",14)}${pad("stored",8)}${pad("declared window",26)}${pad("len",5)}src`);
  for (const r of rows) {
    const c = win.get(r.u);
    const w = c?.fys && c?.fye ? `${c.fys}..${c.fye}` : "(none)";
    let len = "";
    if (c?.fys && c?.fye) { const a=new Date(c.fys+"T00:00:00Z"), b=new Date(c.fye+"T00:00:00Z");
      len = String((b.getUTCFullYear()-a.getUTCFullYear())*12+(b.getUTCMonth()-a.getUTCMonth())+1)+"m"; }
    console.log(`  ${pad(String(r.rd).slice(0,10),13)}${pad(r.rt,14)}${pad(r.lbl,8)}${pad(w,26)}${pad(len,5)}${String(r.src).replace("nse_xbrl_","")}`);
  }
}
await prisma.$disconnect();
