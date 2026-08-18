import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const j = await raw(`SELECT "id","type","status","created_at"::text c,"started_at"::text s,"finished_at"::text f
  FROM background_jobs WHERE "type"='results_scan' ORDER BY "created_at" DESC LIMIT 4`);
console.log("results_scan jobs:"); for (const x of j) console.log(`  ${x.c} → ${x.f}  ${x.status}`);
const r = await raw(`SELECT s."symbol" sym, q."fiscal_year"||q."quarter" lbl, q."result_type" rt, q."updated_at"::text u, q."created_at"::text c, q."source" src
  FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE q."updated_at" > now() - interval '6 hours' ORDER BY q."updated_at" LIMIT 40`);
console.log(`\nquarterly_results touched in the window (${r.length}):`);
for (const x of r) console.log(`  ${String(x.sym).padEnd(13)}${String(x.lbl).padEnd(8)}${String(x.rt).padEnd(13)}upd ${String(x.u).slice(0,19)}  created ${String(x.c).slice(0,19)}  ${x.src}`);
await prisma.$disconnect();
