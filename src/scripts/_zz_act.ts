import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const r = await raw(`SELECT "symbol","is_active","isin","exchange","created_at"::text ca FROM stocks WHERE "symbol" IN ('ABBOTINDIA','BAYERCROP','MCX','RELIANCE','TCS') ORDER BY "symbol"`);
for (const x of r) console.log(` ${String(x.symbol).padEnd(13)} is_active=${String(x.is_active).padEnd(6)} isin=${String(x.isin??"(null)").padEnd(14)} exch=${String(x.exchange??"(null)").padEnd(6)} created ${String(x.ca).slice(0,10)}`);
const [c]:any = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=false`);
console.log(`\nstocks with is_active=false: ${c.n}`);
const [l]:any = await raw(`SELECT count(*)::int n, count(DISTINCT "stock_id")::int s FROM result_fetch_logs`);
console.log(`result_fetch_logs: ${l.n} rows across ${l.s} distinct stocks`);
await prisma.$disconnect();
