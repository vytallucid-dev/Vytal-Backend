import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const [n] = await raw(`SELECT now()::text now, (now() - interval '6 hours')::text since`);
console.log(`db now (UTC) = ${n.now}`);
console.log(`FENCE WINDOW = anything written since ${n.since} (my session began after the 05:00 broker_poll_sync)\n`);
const T=[["quarterly_results","updated_at"],["banking_quarterly_results","updated_at"],["nbfc_quarterly_results","updated_at"],
 ["life_insurance_quarterly_results","updated_at"],["general_insurance_quarterly_results","updated_at"],
 ["fundamentals","updated_at"],["banking_fundamentals","updated_at"],["nbfc_fundamentals","updated_at"],
 ["life_insurance_fundamentals","updated_at"],["general_insurance_fundamentals","updated_at"],
 ["result_fetch_logs","fetched_at"],["ingestion_errors","last_seen_at"],["score_snapshots","created_at"],["stocks","updated_at"]];
let dirty=0;
for (const [t,col] of T) {
  const [r] = await raw(`SELECT count(*)::int n, max("${col}")::text mx FROM "${t}" WHERE "${col}" > now() - interval '6 hours'`);
  if (r.n>0) dirty++;
  console.log(`  ${t.padEnd(38)}${String(r.n).padStart(5)} row(s) since  ${r.n>0?`(newest ${String(r.mx).slice(0,19)})  ⚠`:"✓ CLEAN"}`);
}
const [mx] = await raw(`SELECT max(x)::text mx FROM (SELECT max("updated_at") x FROM quarterly_results
  UNION ALL SELECT max("updated_at") FROM banking_quarterly_results UNION ALL SELECT max("updated_at") FROM fundamentals
  UNION ALL SELECT max("updated_at") FROM banking_fundamentals UNION ALL SELECT max("updated_at") FROM nbfc_quarterly_results) y`);
console.log(`\n  NEWEST WRITE ANYWHERE IN THE RESULT TABLES: ${String(mx.mx).slice(0,19)} UTC`);
console.log(`  ⇒ ${dirty===0?"FENCE CLEAN — this session wrote nothing.":"⚠ SOMETHING WROTE DURING THE WINDOW"}`);
await prisma.$disconnect();
