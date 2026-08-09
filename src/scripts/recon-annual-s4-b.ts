// Stage 4 recon B — per-column coverage on the PREFERRED basis, FY25+FY26.
import { prisma } from "../db/prisma.js";

const SPECS = [
  ["non_financial", "fundamentals", "consolidated"],
  ["banking", "banking_fundamentals", "standalone"],
  ["nbfc", "nbfc_fundamentals", "consolidated"],
  ["life_insurance", "life_insurance_fundamentals", "standalone"],
  ["general_insurance", "general_insurance_fundamentals", "standalone"],
] as const;

const SKIP = new Set(["id", "stock_id", "fiscal_year", "report_date", "filing_date", "xbrl_url", "result_type", "source", "xbrl_taxonomy", "created_at", "updated_at", "extra_metrics"]);

async function main() {
  for (const [family, table, basis] of SPECS) {
    const cols = await prisma.$queryRawUnsafe<any[]>(
      `select column_name from information_schema.columns where table_name = $1 order by ordinal_position`, table,
    );
    const names = cols.map((c) => c.column_name as string).filter((c) => !SKIP.has(c));
    const sel = names.map((c) => `count("${c}")::int as "${c}"`).join(", ");
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select count(*)::int as _n, ${sel} from ${table} where result_type = $1 and fiscal_year in ('FY25','FY26')`, basis,
    );
    const r = rows[0];
    const n = r._n as number;
    console.log(`\n=== ${family} · ${table} · ${basis} · FY25+FY26 · n=${n} ===`);
    const out = names
      .map((c) => ({ c, pct: n ? ((r[c] as number) / n) * 100 : 0, k: r[c] as number }))
      .sort((a, b) => b.pct - a.pct);
    for (const o of out) console.log(`  ${o.pct.toFixed(1).padStart(5)}%  ${o.k.toString().padStart(4)}/${n}  ${o.c}`);
  }
}
main().then(() => prisma.$disconnect());
