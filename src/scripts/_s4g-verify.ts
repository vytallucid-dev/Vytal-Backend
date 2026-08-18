import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main() {
  // 1. quarterly_results — is the momentum field set really 100% populated on rows we hold?
  const cols = ["revenue", "other_income", "interest", "depreciation", "profit_before_tax", "net_profit", "operating_profit"];
  const sel = cols.map((c) => `count(*) FILTER (WHERE t."${c}" IS NULL)::int "${c}"`).join(",");
  const [r] = await raw(`SELECT count(*)::int n, ${sel} FROM quarterly_results t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."result_type"='standalone' AND s."is_active"=true AND s."industryType"::text='non_financial'
       AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'`);
  console.log(`── quarterly_results · standalone · non-financial · in-window: ${r.n} rows ──`);
  for (const c of cols) console.log(`  null ${c.padEnd(20)} ${String(r[c]).padStart(6)}`);
  console.log(`  ⇒ type-A cells on this table = ${cols.slice(0, 6).reduce((a, c) => a + r[c], 0)} (operating_profit is derived, excluded)`);

  // 2. fundamentals — the 245 type-A: which fields, and are they genuinely post-boundary?
  console.log(`\n── fundamentals · standalone · post-boundary nulls (the 245 type-A) ──`);
  const f = await raw(`
    SELECT 'trade_receivables_noncurrent' col, count(*)::int n FROM fundamentals t JOIN stocks s ON s."id"=t."stock_id"
      WHERE t."result_type"='standalone' AND s."is_active"=true AND t."trade_receivables_noncurrent" IS NULL
        AND t."filing_date" > DATE '2022-11-25' AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'
    UNION ALL SELECT 'capital_work_in_progress', count(*)::int FROM fundamentals t JOIN stocks s ON s."id"=t."stock_id"
      WHERE t."result_type"='standalone' AND s."is_active"=true AND t."capital_work_in_progress" IS NULL
        AND t."filing_date" > DATE '2022-11-25' AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'
    UNION ALL SELECT 'cash_from_operating', count(*)::int FROM fundamentals t JOIN stocks s ON s."id"=t."stock_id"
      WHERE t."result_type"='standalone' AND s."is_active"=true AND t."cash_from_operating" IS NULL
        AND t."filing_date" > DATE '2021-11-24' AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'`);
  for (const x of f) console.log(`  ${String(x.col).padEnd(30)} ${String(x.n).padStart(5)}`);

  // 3. FENCE — confirm P1a held and nothing else moved.
  console.log(`\n── FENCE RE-CHECK ──`);
  const [pg] = await raw(`SELECT pg."stock_count"::int stored,
      (SELECT count(*)::int FROM stock_peer_groups g WHERE g."peer_group_id"=pg."id") roster,
      (SELECT count(*)::int FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id"
        WHERE g."peer_group_id"=pg."id" AND s."is_active"=true) active
     FROM peer_groups pg WHERE pg."name"='Large-Cap AMCs & Exchanges'`);
  console.log(`  Large-Cap AMCs & Exchanges: stored=${pg.stored} roster=${pg.roster} active=${pg.active}`);
  const [sw] = await raw(`SELECT count(*)::int n FROM stock_peer_groups g JOIN stocks s ON s."id"=g."stock_id" WHERE s."is_active"=false`);
  console.log(`  inactive stocks holding a roster row: ${sw.n}`);
  const [tot] = await raw(`SELECT count(*)::int n FROM stock_peer_groups`);
  const [act] = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true`);
  const [coh] = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true AND "industryType"::text IN ('non_financial','banking')`);
  console.log(`  stock_peer_groups total: ${tot.n}   active stocks: ${act.n}   cohort: ${coh.n}`);
  const [sn] = await raw(`SELECT count(*)::int n FROM score_snapshots`);
  console.log(`  score_snapshots: ${sn.n}  (unchanged — no scoring was run)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
