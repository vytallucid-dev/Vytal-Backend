import "dotenv/config"; import { readFileSync } from "node:fs"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const d=JSON.parse(readFileSync("_f5-momentum.json","utf-8"));
const zero=d.rows.filter((r:any)=>r.ind==="non_financial"&&r.tail===0).map((r:any)=>r.sym);
const short=d.rows.filter((r:any)=>r.ind==="non_financial"&&r.tail>0&&r.tail<8).map((r:any)=>r.sym);
const f=await raw(`SELECT s."symbol" sym, min(q."report_date")::text first, count(*)::int n
  FROM stocks s LEFT JOIN quarterly_results q ON q."stock_id"=s."id" AND q."result_type"='standalone'
  WHERE s."symbol"=ANY($1::text[]) GROUP BY 1 ORDER BY 2 NULLS FIRST`, zero);
const never=f.filter((x:any)=>x.n===0), late=f.filter((x:any)=>x.n>0);
console.log(`\nNON-FINANCIAL stocks with a ZERO consecutive run at 2022-01-31: ${zero.length}`);
console.log(`  · hold NO standalone quarterly row at all, ever      : ${never.length}   [${never.map((x:any)=>x.sym).join(", ")}]`);
console.log(`  · hold rows, but their FIRST is after the cutoff     : ${late.length}   ← genuine late listings, not a defect`);
console.log(`    earliest first-filing among them: ${late[0]?.first?.slice(0,10)}   latest: ${late[late.length-1]?.first?.slice(0,10)}`);
const before=late.filter((x:any)=>x.first && x.first.slice(0,10) < "2022-01-31");
console.log(`  · ⚠ hold rows whose first PREDATES the cutoff yet run=0 : ${before.length}   ${before.map((x:any)=>`${x.sym}(${x.first.slice(0,10)})`).join(", ")}`);
const sf=await raw(`SELECT s."symbol" sym, min(q."report_date")::text first FROM stocks s
  JOIN quarterly_results q ON q."stock_id"=s."id" AND q."result_type"='standalone' AND q."report_date"<=DATE '2022-01-31'
  WHERE s."symbol"=ANY($1::text[]) GROUP BY 1`, short);
console.log(`\nNON-FINANCIAL with a run of 1..7 at the cutoff: ${short.length}`);
console.log(`  of those whose first standalone row at-or-before the cutoff is: `);
const byY=new Map<string,number>(); for(const x of sf){const y=String(x.first).slice(0,4); byY.set(y,(byY.get(y)??0)+1);}
for (const [y,n] of [...byY].sort()) console.log(`     ${y}: ${n}`);
console.log(`  ⇒ ${short.length-sf.length} hold nothing at all before the cutoff; ${sf.length} hold something but the run is broken or short.`);
await prisma.$disconnect();
