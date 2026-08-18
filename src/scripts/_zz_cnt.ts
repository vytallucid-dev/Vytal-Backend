import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const Q=["quarterly_results","banking_quarterly_results","nbfc_quarterly_results","life_insurance_quarterly_results","general_insurance_quarterly_results"];
const F=["fundamentals","banking_fundamentals","nbfc_fundamentals","life_insurance_fundamentals","general_insurance_fundamentals"];
for (const t of [...Q,...F]) {
  const [c] = await raw(`SELECT count(*)::int n, count(DISTINCT "xbrl_url")::int u FROM "${t}"`);
  console.log(`${t.padEnd(38)} rows=${String(c.n).padStart(6)}  distinct xbrl_url=${String(c.u).padStart(6)}`);
}
const u = Q.map(t=>`SELECT "xbrl_url" u FROM "${t}"`).join(" UNION ");
const [a] = await raw(`SELECT count(*)::int n FROM (${u}) x`);
console.log(`\nDISTINCT xbrl_url across all 5 QUARTERLY tables: ${a.n}`);
const u2 = [...Q,...F].map(t=>`SELECT "xbrl_url" u FROM "${t}"`).join(" UNION ");
const [b] = await raw(`SELECT count(*)::int n FROM (${u2}) x`);
console.log(`DISTINCT xbrl_url across ALL 10 tables            : ${b.n}`);
const [src] = await raw(`SELECT count(*) FILTER (WHERE "source" LIKE '%legacy%')::int lg, count(*) FILTER (WHERE "source" NOT LIKE '%legacy%')::int v3 FROM quarterly_results`);
console.log(`quarterly_results: legacy=${src.lg} v3=${src.v3}`);
await prisma.$disconnect();
