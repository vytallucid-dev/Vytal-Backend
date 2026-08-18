import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const [now] = await raw(`SELECT now()::text n`);
console.log("db now (UTC):", now.n);
for (const t of ["quarterly_results","banking_quarterly_results","fundamentals","banking_fundamentals","nbfc_quarterly_results"]) {
  const r = await raw(`SELECT date_trunc('hour',"updated_at")::text h, count(*)::int n FROM "${t}"
     WHERE "updated_at" > now() - interval '30 hours' GROUP BY 1 ORDER BY 1`);
  console.log(`\n${t}:`);
  for (const x of r) console.log(`   ${x.h}  ${x.n}`);
}
const rf = await raw(`SELECT date_trunc('hour',"fetched_at")::text h, count(*)::int n, string_agg(DISTINCT "source",',') src
   FROM result_fetch_logs WHERE "fetched_at" > now() - interval '30 hours' GROUP BY 1 ORDER BY 1`);
console.log(`\nresult_fetch_logs:`); for (const x of rf) console.log(`   ${x.h}  ${x.n}   ${x.src}`);
const ie = await raw(`SELECT date_trunc('hour',"last_seen_at")::text h, count(*)::int n, string_agg(DISTINCT "cron",',') c
   FROM ingestion_errors WHERE "last_seen_at" > now() - interval '30 hours' GROUP BY 1 ORDER BY 1`);
console.log(`\ningestion_errors (last_seen_at):`); for (const x of ie) console.log(`   ${x.h}  ${x.n}   ${x.c}`);
const jobs = await raw(`SELECT "type", "status", count(*)::int n, max("created_at")::text last
   FROM background_jobs WHERE "created_at" > now() - interval '30 hours' GROUP BY 1,2 ORDER BY 4 DESC LIMIT 20`);
console.log(`\nbackground_jobs created in the last 30h:`);
for (const j of jobs) console.log(`   ${String(j.type).padEnd(34)}${String(j.status).padEnd(12)}${String(j.n).padStart(5)}   last ${String(j.last).slice(0,19)}`);
await prisma.$disconnect();
