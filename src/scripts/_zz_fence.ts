import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const T=["quarterly_results","banking_quarterly_results","nbfc_quarterly_results","life_insurance_quarterly_results","general_insurance_quarterly_results","fundamentals","banking_fundamentals","nbfc_fundamentals","life_insurance_fundamentals","general_insurance_fundamentals","result_fetch_logs","ingestion_errors","score_snapshots"];
console.log("FENCE — anything written or updated in the last 12 hours?");
for (const t of T) {
  const cc = await raw(`SELECT column_name c FROM information_schema.columns WHERE table_name='${t}' AND column_name IN ('created_at','updated_at','fetched_at','last_seen_at')`);
  const names = cc.map((x:any)=>x.c);
  const cre = names.includes("created_at")?"created_at":names.includes("fetched_at")?"fetched_at":null;
  const upd = names.includes("updated_at")?"updated_at":names.includes("last_seen_at")?"last_seen_at":null;
  const sel = [`count(*)::int n`];
  if (cre) sel.push(`count(*) FILTER (WHERE "${cre}" > now() - interval '12 hours')::int fresh`);
  if (upd) sel.push(`count(*) FILTER (WHERE "${upd}" > now() - interval '12 hours')::int touched`);
  const [r] = await raw(`SELECT ${sel.join(", ")} FROM "${t}"`);
  const bad = (r.fresh??0)+(r.touched??0);
  console.log(`  ${t.padEnd(38)} rows=${String(r.n).padStart(7)}  created<12h=${String(r.fresh??"-").padStart(4)}  updated<12h=${String(r.touched??"-").padStart(4)}  ${bad===0?"✓ clean":"⚠ TOUCHED"}`);
}
await prisma.$disconnect();
