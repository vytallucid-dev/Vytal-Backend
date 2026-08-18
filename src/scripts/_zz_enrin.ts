import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const rows = await raw(`SELECT q."fiscal_year"||q."quarter" lbl, q."result_type" rt, q."report_date"::text rd, q."source" src
  FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"='ENRIN' ORDER BY q."report_date"`);
console.log("ENRIN rows:", rows.length);
for (const r of rows) console.log(` ${r.rd}  ${String(r.lbl).padEnd(8)} ${String(r.rt).padEnd(12)} ${r.src}`);
const bad = rows.filter((r:any)=>r.rd>="2025-03-31" && String(r.src).includes("_legacy"));
console.log(bad.length===0 ? "\n✓ ENRIN: no legacy source at/after the v3 floor" : `\n⚠ ${bad.length} breached`);
await prisma.$disconnect();
