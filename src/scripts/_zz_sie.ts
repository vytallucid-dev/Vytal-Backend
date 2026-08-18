import "dotenv/config"; import { readFileSync } from "node:fs"; import { prisma } from "../db/prisma.js";
const DIR = process.env.R1_DIR ?? ".";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const base = JSON.parse(readFileSync(`${DIR}/_r1d-v3-before.json`,"utf8"));
const sie = (base.rows as any[]).filter(r=>r.sym==="SIEMENS");
console.log(`baseline v3 SIEMENS rows: ${sie.length}`);
for (const b of sie) {
  const [cur] = await raw(`SELECT "fiscal_year"||"quarter" lbl,"result_type" rt,"report_date"::text rd,"source" src FROM quarterly_results WHERE "id"=$1`, b.id);
  console.log(` id=${b.id.slice(0,8)} baseline ${b.period} ${b.basis} ${String(b.rd).slice(0,10)} ${b.src}`);
  console.log(`    now → ${cur ? `${cur.lbl} ${cur.rt} ${String(cur.rd).slice(0,10)} ${cur.src}` : "⚠ ROW ABSENT"}`);
}
const all = await raw(`SELECT q."fiscal_year"||q."quarter" lbl,q."result_type" rt,q."report_date"::text rd,q."source" src
  FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"='SIEMENS' AND q."report_date">=DATE '2025-01-01' ORDER BY q."report_date",q."result_type"`);
console.log(`\nSIEMENS rows at/after 2025-01-01: ${all.length}`);
for (const r of all) console.log(` ${String(r.rd).slice(0,10)} ${String(r.lbl).padEnd(8)} ${String(r.rt).padEnd(13)} ${r.src}`);
const [tot]:any = await raw(`SELECT count(*)::int n, count(*) FILTER (WHERE q."result_type"='standalone')::int sa, count(*) FILTER (WHERE q."result_type"='consolidated')::int co FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"='SIEMENS'`);
console.log(`\ntotal now: ${tot.n} (SA ${tot.sa} · CO ${tot.co})`);
await prisma.$disconnect();
