import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const SYM = process.argv[2] ?? "DELHIVERY";
const DATES = (process.argv[3] ?? "2022-03-31,2022-09-30").split(",");

const rows = await raw(
  `SELECT q."fiscal_year" fy, q."quarter" q, q."result_type" rt, q."report_date"::text rd, q."xbrl_url" u
     FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id"
    WHERE s."symbol"=$1 AND q."result_type"='standalone' AND q."report_date"::text = ANY($2::text[])
    ORDER BY q."report_date"`,
  SYM,
  DATES.map((d) => `${d} 00:00:00`),
);
console.log(`${SYM}: probing ${rows.length} document(s)\n`);

for (const r of rows) {
  console.log(`── ${String(r.rd).slice(0, 10)} ${r.rt} · stored ${r.fy}${r.q}`);
  console.log(`   url: ${r.u ?? "(none)"}`);
  if (!r.u) { console.log(); continue; }
  let xml: string | null = null;
  try { xml = await fetchXbrlFile(r.u); } catch (e) { console.log(`   fetch failed: ${(e as Error).message}\n`); continue; }
  if (!xml) { console.log(`   fetch returned empty\n`); continue; }
  console.log(`   bytes: ${xml.length}`);
  const seen = new Map<string, string>();
  const re = /<([A-Za-z0-9_.-]+):((?:DateOf|Period)[A-Za-z]*)\b[^>]*>([^<]*)<\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const k = `${m[1]}:${m[2]}`;
    if (!seen.has(k)) seen.set(k, m[3].trim());
  }
  if (seen.size === 0) console.log(`   ⚠ no DateOf*/Period* tags found at all`);
  for (const [k, v] of seen) console.log(`     ${k.padEnd(48)} = ${v}`);
  const g = (t: string) => { for (const [k, v] of seen) if (k.endsWith(`:${t}`)) return v; return null; };
  const s = g("DateOfStartOfFinancialYear"), e = g("DateOfEndOfFinancialYear");
  const pe = g("DateOfEndOfReportingPeriod") ?? String(r.rd).slice(0, 10);
  if (s && e) {
    try {
      const x = deriveFiscalPeriod(D(pe), D(s), D(e), "quarterly");
      console.log(`   ⇒ deriveFiscalPeriod(pe=${pe}, fy=${s}..${e}) = ${x.fiscalYear}${x.quarter}`);
    } catch (err) { console.log(`   ⇒ deriveFiscalPeriod THREW: ${(err as Error).message}`); }
  } else console.log(`   ⇒ declared FY window incomplete (start=${s} end=${e})`);
  console.log();
  await new Promise((x) => setTimeout(x, 400));
}
await prisma.$disconnect();
