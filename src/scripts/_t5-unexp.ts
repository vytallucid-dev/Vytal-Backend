import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { COHORT } from "./_t4-cohort-def.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const syms = COHORT.map(c=>c.symbol); const pad=(s:unknown,n:number)=>String(s).padEnd(n);
console.log("── WHICH rows carry the unexplained nulls ──");
const r = await raw<any>(`SELECT st."symbol" s, f."fiscal_year" fy, f."result_type" rt, f."source" src,
   f."filing_date"::text fd, f."xbrl_url" u,
   (f."total_assets" IS NULL) no_ta, (f."face_value_share" IS NULL) no_fv,
   (f."trade_receivables_noncurrent" IS NULL) no_trnc
  FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE st."symbol"=ANY($1::text[]) AND f."filing_date" > TIMESTAMP '2022-11-25'
    AND (f."total_assets" IS NULL OR f."face_value_share" IS NULL)
  ORDER BY f."fiscal_year", st."symbol"`, syms);
for (const x of r) console.log(`  ${pad(x.s,12)} ${pad(x.fy,6)} ${pad(x.rt,13)} src=${pad(x.src,24)} bcast=${x.fd.slice(0,10)}  missing:${x.no_ta?" total_assets(+all BS)":""}${x.no_fv?" face_value_share":""}`);
console.log("\n── trade_receivables_noncurrent: is the tag in the document? (5 samples) ──");
const t = await raw<any>(`SELECT st."symbol" s, f."fiscal_year" fy, f."xbrl_url" u FROM fundamentals f
  JOIN stocks st ON st."id"=f."stock_id" WHERE st."symbol"=ANY($1::text[])
   AND f."filing_date" > TIMESTAMP '2022-11-25' AND f."trade_receivables_noncurrent" IS NULL
   AND f."total_assets" IS NOT NULL ORDER BY random() LIMIT 5`, syms);
for (const x of t) {
  let xml:string; try{xml=await fetchXbrlFile(x.u);}catch{console.log(`  ${x.s} ${x.fy}: unreachable`);continue;}
  const hits=[...xml.matchAll(/<in-bse-fin:TradeReceivablesNoncurrent\b([^>]*)>/g)].map(m=>/contextRef="([^"]+)"/.exec(m[1])?.[1]);
  console.log(`  ${pad(x.s,12)} ${pad(x.fy,6)} TradeReceivablesNoncurrent ${hits.length?`PRESENT in {${hits.join(",")}} ⚠`:"ABSENT → genuine (no non-current receivables disclosed)"}`);
  await new Promise(z=>setTimeout(z,350));
}
await prisma.$disconnect();
