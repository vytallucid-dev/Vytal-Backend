import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const [c]:any = await raw(`SELECT string_agg(column_name,', ' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name='result_fetch_logs'`);
console.log(`result_fetch_logs columns:\n  ${c.c}\n`);
const r = await raw(`SELECT l.* FROM result_fetch_logs l JOIN stocks s ON s."id"=l."stock_id"
  WHERE s."symbol" IN ('ABBOTINDIA','BAYERCROP','MCX') ORDER BY s."symbol"`);
for (const x of r) console.log(JSON.stringify(x, null, 1));
await prisma.$disconnect();
