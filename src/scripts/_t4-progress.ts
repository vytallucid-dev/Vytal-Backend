import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { COHORT } from "./_t4-cohort-def.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const CUT = "2026-08-16 09:30:03";
const pad=(s:unknown,n:number)=>String(s).padEnd(n); const lp=(s:unknown,n:number)=>String(s).padStart(n);
const r = await raw(`
  SELECT st."symbol",
    (SELECT count(*)::int FROM fundamentals f WHERE f."stock_id"=st."id" AND f."updated_at" > TIMESTAMP '${CUT}') fu,
    (SELECT count(*)::int FROM quarterly_results q WHERE q."stock_id"=st."id" AND q."updated_at" > TIMESTAMP '${CUT}') qu,
    (SELECT count(*)::int FROM banking_fundamentals b WHERE b."stock_id"=st."id" AND b."updated_at" > TIMESTAMP '${CUT}') bu,
    (SELECT count(*)::int FROM banking_quarterly_results bq WHERE bq."stock_id"=st."id" AND bq."updated_at" > TIMESTAMP '${CUT}') bqu
  FROM stocks st WHERE st."symbol" = ANY($1::text[]) ORDER BY 1`, COHORT.map(c=>c.symbol));
let touched=0, untouched: string[]=[];
console.log(`rows written since ${CUT}Z:`);
for (const x of r) {
  const n = Number(x.fu)+Number(x.qu)+Number(x.bu)+Number(x.bqu);
  if (n>0) { touched++; console.log(`  ${pad(x.symbol,13)} fund=${lp(x.fu,3)} qtr=${lp(x.qu,3)} bfund=${lp(x.bu,3)} bqtr=${lp(x.bqu,3)}  ← PROCESSED`); }
  else untouched.push(String(x.symbol));
}
console.log(`\nprocessed: ${touched}/${r.length}`);
console.log(`NOT yet processed (${untouched.length}): ${untouched.join(" ")}`);
await prisma.$disconnect();
