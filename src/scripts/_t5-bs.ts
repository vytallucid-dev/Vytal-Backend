// T5.1c — is the balance-sheet (OneI) context subject to the same hazard?
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:unknown,n:number)=>String(s).padEnd(n);
const BS_TAGS=["Assets","Equity","EquityShareCapital","PropertyPlantAndEquipment","BorrowingsCurrent","TradeReceivablesCurrent"];
const rows = await raw<any>(`SELECT st."symbol", f."fiscal_year" fy, f."xbrl_url" u
  FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE f."updated_at" > TIMESTAMP '2026-08-16 09:30:03' AND f."total_assets" IS NULL
  ORDER BY random() LIMIT 6`);
let absent=0, elsewhere=0;
for (const r of rows) {
  let xml:string; try{xml=await fetchXbrlFile(r.u);}catch{continue;}
  const found:string[]=[];
  for (const t of BS_TAGS) {
    const re=new RegExp(`<in-bse-fin:${t}\b([^>]*)>`,"g");
    for (const m of xml.matchAll(re)) found.push(`${t}@${/contextRef="([^"]+)"/.exec(m[1])?.[1]??"-"}`);
  }
  if (!found.length) { absent++; console.log(`  ${pad(r.symbol,12)} ${pad(r.fy,6)} no BS tag under ANY context → genuine`); }
  else { elsewhere++; console.log(`  ${pad(r.symbol,12)} ${pad(r.fy,6)} ⚠ BS tags present: ${[...new Set(found)].join(", ")}`); }
  await new Promise(x=>setTimeout(x,350));
}
console.log(`\n  genuine BS absences: ${absent} · BS present under another context: ${elsewhere}`);
// Also: any instant context other than OneI ever used?
const [p]=await raw<any>(`SELECT f."xbrl_url" u FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE st."symbol"='ULTRACEMCO' AND f."fiscal_year"='FY23' AND f."result_type"='standalone'`);
const x=await fetchXbrlFile(p.u);
const instants=[...x.matchAll(/<xbrli:context\b[^>]*id="([^"]+)"[^>]*>[\s\S]*?<xbrli:instant>([^<]+)</g)].map(m=>`${m[1]}=${m[2]}`);
console.log(`  instant contexts defined in a post-boundary doc: ${instants.join(", ")||"(none matched)"}`);
await prisma.$disconnect();
