import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const CUT="2026-08-16 09:30:03"; const pad=(s:unknown,n:number)=>String(s).padEnd(n);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// PRE-CF-boundary annual rows with a NULL cash_from_operating — is the tag really absent?
const rows = await raw<any>(`SELECT st."symbol", st."fiscalYearEnd" fye, f."fiscal_year", f."result_type",
    f."xbrl_url", f."filing_date"::text fd
  FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE f."updated_at" > TIMESTAMP '${CUT}' AND f."cash_from_operating" IS NULL
    AND f."filing_date" <= TIMESTAMP '2021-11-24'
  ORDER BY random() LIMIT 10`);
console.log(`sampling ${rows.length} PRE-boundary annual rows with null cash_from_operating\n`);
let absent=0, wrongCtx=0;
for (const r of rows) {
  let xml:string; try { xml = await fetchXbrlFile(r.xbrl_url); } catch(e){ console.log(`  ${r.symbol} ${r.fiscal_year} — unreachable`); continue; }
  const occ:{ctx:string}[]=[]; const re=/<in-bse-fin:CashFlowsFromUsedInOperatingActivities\b([^>]*)>/g; let m;
  while((m=re.exec(xml))!==null) occ.push({ctx:/contextRef="([^"]+)"/.exec(m[1])?.[1] ?? "-"});
  if (occ.length===0) { absent++; console.log(`  ${pad(r.symbol,12)} ${pad(r.fiscal_year,6)} ${pad(r.fye,9)} bcast ${r.fd.slice(0,10)}  tag ABSENT → genuine`); }
  else { wrongCtx++; console.log(`  ${pad(r.symbol,12)} ${pad(r.fiscal_year,6)} ${pad(r.fye,9)} bcast ${r.fd.slice(0,10)}  ✗ tag PRESENT in {${[...new Set(occ.map(o=>o.ctx))].join(",")}} → FALSE NULL`); }
  await sleep(350);
}
console.log(`\n  genuine absences: ${absent} · FALSE NULLS: ${wrongCtx} of ${absent+wrongCtx} checked`);
await prisma.$disconnect();
