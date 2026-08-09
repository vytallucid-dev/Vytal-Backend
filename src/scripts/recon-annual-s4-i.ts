// Stage 4 recon I — how often does the SHARE COUNT move between two annual rows?
// Implied shares = net_profit (Rs crore -> Rs) / basic_eps. A change means a split, bonus or issue,
// none of which these tables record — and a per-share YoY comparison across one is meaningless.
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);

const SETS: [string, string, string][] = [
  ["non_financial", "fundamentals", "consolidated"],
  ["banking", "banking_fundamentals", "standalone"],
  ["nbfc", "nbfc_fundamentals", "consolidated"],
  ["life_insurance", "life_insurance_fundamentals", "standalone"],
  ["general_insurance", "general_insurance_fundamentals", "standalone"],
];

async function main() {
  let totalPairs = 0;
  let totalMoved = 0;
  for (const [family, table, basis] of SETS) {
    const rows = await q(`select s.symbol, c.fiscal_year fy,
        (c.net_profit::float * 1e7 / nullif(c.basic_eps::float,0)) cur,
        (p.net_profit::float * 1e7 / nullif(p.basic_eps::float,0)) pri,
        c.basic_eps::float ceps, p.basic_eps::float peps
      from ${table} c
      join ${table} p on p.stock_id=c.stock_id and p.result_type=c.result_type
        and p.fiscal_year = 'FY' || lpad((substr(c.fiscal_year,3)::int - 1)::text, 2, '0')
      join stocks s on s.id=c.stock_id
      where c.result_type=$1 and c.basic_eps is not null and p.basic_eps is not null
        and c.net_profit is not null and p.net_profit is not null
        and c.basic_eps <> 0 and p.basic_eps <> 0`, basis);
    const usable = rows.filter((r) => Number.isFinite(r.cur) && Number.isFinite(r.pri) && r.cur > 0 && r.pri > 0);
    const moved = usable.filter((r) => Math.abs(r.cur / r.pri - 1) > 0.02);
    totalPairs += usable.length;
    totalMoved += moved.length;
    console.log(`${family}: ${moved.length}/${usable.length} pairs (${usable.length ? ((moved.length / usable.length) * 100).toFixed(1) : "0"}%) changed share count by >2%`);
    for (const m of moved.slice(0, 6)) {
      console.log(`   ${m.symbol} ${m.fy}: shares x${(m.cur / m.pri).toFixed(2)}  eps ${m.peps} -> ${m.ceps}`);
    }
  }
  console.log(`\nALL: ${totalMoved}/${totalPairs} (${((totalMoved / totalPairs) * 100).toFixed(1)}%) of annual pairs sit across a share-count change.`);
}
main().then(() => prisma.$disconnect());
