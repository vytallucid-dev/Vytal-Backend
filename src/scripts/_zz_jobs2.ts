import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const t = await raw(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%job%' OR table_name ILIKE '%score%') ORDER BY 1`);
console.log("candidate tables:", t.map((x:any)=>x.table_name).join(", "));
for (const x of t) {
  const tn = x.table_name;
  const [c]:any = await raw(`SELECT string_agg(column_name,',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name='${tn}'`);
  const has = String(c.c).split(",");
  const tsCol = has.find(k=>/^created_at$|^createdAt$|^enqueued_at$/.test(k));
  const typeCol = has.find(k=>/^type$|^job_type$|^name$/.test(k));
  if (!tsCol) { console.log(`\n${tn}: (no timestamp col) cols=${c.c}`.slice(0,200)); continue; }
  const rows = await raw(`SELECT ${typeCol?`"${typeCol}"::text t`:`'-'::text t`}, count(*)::int n, max("${tsCol}")::text last
    FROM "${tn}" WHERE "${tsCol}" > now() - interval '7 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  console.log(`\n${tn} (last 7h, by ${typeCol??"-"}):`);
  if (!rows.length) console.log(`   (none)`);
  for (const r of rows) console.log(`   ${String(r.t).padEnd(34)} ${String(r.n).padStart(4)}   last ${String(r.last).slice(0,19)}`);
}
await prisma.$disconnect();
