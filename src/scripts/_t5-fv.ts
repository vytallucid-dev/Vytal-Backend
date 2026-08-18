import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const [x] = await raw<any>(`SELECT f."xbrl_url" u FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE st."symbol"='ADANIGREEN' AND f."fiscal_year"='FY23' AND f."result_type"='standalone'`);
const xml = await fetchXbrlFile(x.u);
for (const tag of ["FaceValueOfEquityShareCapital","PaidUpValueOfEquityShareCapital","EquityShareCapital"]) {
  const hits=[...xml.matchAll(new RegExp(`<in-bse-fin:${tag}\b([^>]*)>([^<]*)<`,"g"))];
  console.log(`  ${tag.padEnd(34)} ${hits.length? hits.map(h=>`ctx=${/contextRef="([^"]+)"/.exec(h[1])?.[1]} val=${h[2]}`).join(" | ") : "ABSENT → genuine"}`);
}
await prisma.$disconnect();
