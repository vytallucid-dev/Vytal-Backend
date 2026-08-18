import "dotenv/config"; import { readFileSync } from "node:fs"; import { prisma } from "../db/prisma.js";
const DIR = process.env.R1_DIR ?? ".";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const base = JSON.parse(readFileSync(`${DIR}/_r1d-v3-before.json`,"utf8"));
const mine = (base.rows as any[]).filter(r=>r.sym==="SIEMENS");
console.log(`baseline SIEMENS v3 rows: ${mine.length}`);
for (const b of mine) {
  let found:string|null=null;
  for (const t of ["quarterly_results","fundamentals","banking_quarterly_results","banking_fundamentals"]) {
    const [c]:any = await raw(`SELECT "report_date"::text rd,"source" src FROM "${t}" WHERE "id"=$1`, b.id);
    if (c) { found=`${t}: ${String(c.rd).slice(0,10)} ${c.src}`; break; }
  }
  const ok = found && found.includes(String(b.rd).slice(0,10)) && found.includes(b.src);
  console.log(` ${ok?"✓":"⚠"} ${String(b.period).padEnd(7)} ${String(b.basis).padEnd(12)} ${String(b.t).padEnd(18)} base ${String(b.rd).slice(0,10)} ${String(b.src).padEnd(20)} → ${found ?? "ABSENT EVERYWHERE"}`);
}
await prisma.$disconnect();
