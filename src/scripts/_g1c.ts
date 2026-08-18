import "dotenv/config";
import { prisma } from "../db/prisma.js";
const r = await prisma.$queryRawUnsafe(`SELECT st."symbol" s, q."result_type" rt, q."source", q."filing_date"::text fd,
   q."updated_at"::text ua, q."report_date"::text rd
  FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
  WHERE st."symbol" IN ('ASIANPAINT','BEL','ICICIBANK','SUNPHARMA','HAVELLS','NESTLEIND','SBIN','ULTRACEMCO')
    AND q."fiscal_year"='FY23' AND q."quarter"='Q1' ORDER BY 1`) as any[];
if(!r.length) console.log("  (none in quarterly_results)");
for (const x of r) console.log(`  ${String(x.s).padEnd(12)} ${String(x.rt).padEnd(13)} src=${String(x.source).padEnd(26)} bcast=${String(x.fd).slice(0,10)} updated=${String(x.ua).slice(0,19)}`);
const b = await prisma.$queryRawUnsafe(`SELECT st."symbol" s, q."result_type" rt, q."source", q."updated_at"::text ua
  FROM banking_quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
  WHERE st."symbol" IN ('ICICIBANK','SBIN') AND q."fiscal_year"='FY23' AND q."quarter"='Q1'`) as any[];
for (const x of b) console.log(`  ${String(x.s).padEnd(12)} ${String(x.rt).padEnd(13)} src=${String(x.source).padEnd(26)} (banking table) updated=${String(x.ua).slice(0,19)}`);
await prisma.$disconnect();
