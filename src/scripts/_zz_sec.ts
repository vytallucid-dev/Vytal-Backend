import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const r = await raw(`SELECT s."symbol", s."sector_id", sec."name" secname,
  (SELECT count(*)::int FROM result_fetch_logs l WHERE l."stock_id"=s."id") logs
  FROM stocks s LEFT JOIN sectors sec ON sec."id"=s."sector_id"
  WHERE s."symbol" IN ('ABBOTINDIA','BAYERCROP','MCX','RELIANCE','TCS') ORDER BY s."symbol"`);
for (const x of r) console.log(` ${String(x.symbol).padEnd(13)} sector_id=${String(x.sector_id??"(NULL)").padEnd(38)} ${String(x.secname??"(none)").padEnd(20)} logs=${x.logs}`);
console.log(`\n-- stocks with NULL sector_id --`);
const n = await raw(`SELECT "symbol" FROM stocks WHERE "sector_id" IS NULL ORDER BY "symbol"`);
console.log(` count=${n.length}: ${n.map((x:any)=>x.symbol).join(", ")}`);
console.log(`\n-- stocks in 'stocks' with ZERO result_fetch_logs --`);
const z = await raw(`SELECT s."symbol" FROM stocks s WHERE NOT EXISTS (SELECT 1 FROM result_fetch_logs l WHERE l."stock_id"=s."id") ORDER BY s."symbol"`);
console.log(` count=${z.length}: ${z.map((x:any)=>x.symbol).join(", ")}`);
const [t]:any = await raw(`SELECT count(*)::int n FROM stocks`);
console.log(`\ntotal stocks: ${t.n}`);
await prisma.$disconnect();
