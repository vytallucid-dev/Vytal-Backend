import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
for (const [sym,fy] of [["ULTRACEMCO","FY19"],["ULTRACEMCO","FY21"],["ULTRACEMCO","FY23"]] as const) {
  const [p] = await raw<any>(`SELECT f."xbrl_url" FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
    WHERE st."symbol"=$1 AND f."fiscal_year"=$2 AND f."result_type"='standalone'`, sym, fy);
  if(!p){console.log(`${sym} ${fy}: no row`);continue;}
  const xml = await fetchXbrlFile(p.xbrl_url);
  console.log(`\n═══ ${sym} ${fy} ═══`);
  const ids = [...xml.matchAll(/<xbrli:context\b[^>]*id="([^"]+)"/g)].map(m=>m[1]);
  const refs = [...new Set([...xml.matchAll(/contextRef="([^"]+)"/g)].map(m=>m[1]))];
  console.log(`  context IDs defined (${ids.length}): ${ids.slice(0,14).join(", ")}${ids.length>14?" …":""}`);
  console.log(`  contextRef values USED (${refs.length}): ${refs.slice(0,14).join(", ")}${refs.length>14?" …":""}`);
  const missing = refs.filter(r=>!ids.includes(r));
  console.log(`  refs with NO matching context definition: ${missing.length ? missing.join(", ") : "(none)"}`);
  // period for each ref actually used by our parser
  for (const want of ["OneD","FourD"]) {
    const re = new RegExp(`<xbrli:context\b[^>]*id="${want}"[^>]*>([\s\S]*?)</xbrli:context>`,"i");
    const m = re.exec(xml);
    if(!m){ console.log(`  ${want}: NOT DEFINED in this document`); continue; }
    const s=/<xbrli:startDate>([^<]+)</i.exec(m[1])?.[1], e=/<xbrli:endDate>([^<]+)</i.exec(m[1])?.[1];
    const d = s&&e ? Math.round((Date.parse(e)-Date.parse(s))/86400000)+1 : undefined;
    console.log(`  ${want}: ${s} → ${e}  (${d} days)`);
  }
  await new Promise(r=>setTimeout(r,400));
}
await prisma.$disconnect();
