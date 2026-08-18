import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const SYMS = ["ABLBL","AEGISVOPAK","ANTHEM","ATHERENERG","BELRISE","CPPLUS","EMMVEE","ENRIN","GROWW","ITCHOTELS","JAINREC","JSWCEMENT","LENSKART","LGEINDIA","MEESHO","PINELABS","PWL","TENNIND","THELEELA","TMCV","TRAVELFOOD","URBANCO"];

async function main() {
  console.log("── the 22 with zero rows in the 2018-03-31..2024-12-31 window ──");
  const r = await raw(`
    SELECT s."symbol" sym, min(t.rd)::text first_any, max(t.rd)::text last_any, count(*)::int n FROM (
      SELECT "stock_id" sid,"report_date" rd FROM quarterly_results
      UNION ALL SELECT "stock_id","report_date" FROM banking_quarterly_results) t
    JOIN stocks s ON s."id"=t.sid WHERE s."symbol"=ANY($1::text[]) GROUP BY s."symbol" ORDER BY 2`, SYMS);
  console.log(`  ${"symbol".padEnd(13)}${"first filing (any date)".padEnd(26)}${"last".padEnd(13)}rows`);
  for (const x of r) console.log(`  ${String(x.sym).padEnd(13)}${String(x.first_any).slice(0,10).padEnd(26)}${String(x.last_any).slice(0,10).padEnd(13)}${x.n}`);
  const got = new Set(r.map((x: any) => x.sym));
  const none = SYMS.filter((s) => !got.has(s));
  console.log(`  with rows somewhere: ${r.length}   with NO quarterly rows at all: ${none.length} ${none.join(",")}`);

  // ── banking quarterly null profile, pre vs post 2022-01-31 ──
  console.log("\n── banking_quarterly_results · standalone · NULL counts by field, pre/post 2022-01-31 ──");
  const cols = ["interest_earned","interest_expended","other_income","operating_expenses","ppop","net_profit",
    "gnpa_absolute","nnpa_absolute","gnpa_pct","nnpa_pct","cet1_ratio","additional_tier1_ratio","roa_quarterly"];
  const sel = cols.map((c) => `count(*) FILTER (WHERE t."${c}" IS NULL AND t."report_date" <= DATE '2021-12-31')::int "${c}_pre",
     count(*) FILTER (WHERE t."${c}" IS NULL AND t."report_date" > DATE '2021-12-31')::int "${c}_post"`).join(",");
  const [b] = await raw(`
    SELECT count(*) FILTER (WHERE t."report_date" <= DATE '2021-12-31')::int n_pre,
           count(*) FILTER (WHERE t."report_date" > DATE '2021-12-31')::int n_post, ${sel}
      FROM banking_quarterly_results t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."result_type"='standalone' AND s."is_active"=true
       AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'`);
  console.log(`  rows: pre ${b.n_pre} · post ${b.n_post}`);
  console.log(`  ${"field".padEnd(26)}${"null pre".padStart(10)}${"null post".padStart(11)}`);
  for (const c of cols) console.log(`  ${c.padEnd(26)}${String(b[`${c}_pre`]).padStart(10)}${String(b[`${c}_post`]).padStart(11)}`);

  // ── banking_fundamentals null profile ──
  console.log("\n── banking_fundamentals · standalone · NULL counts by field, pre/post FY22 ──");
  const acols = ["interest_earned","interest_expended","other_income","operating_expenses","ppop","profit_before_tax","net_profit",
    "advances","investments","cash_and_balances_with_rbi","balances_with_banks","total_assets","deposits",
    "gnpa_absolute","nnpa_absolute","gnpa_pct","nnpa_pct","cet1_ratio","additional_tier1_ratio","tier1_ratio","roa_disclosed"];
  const asel = acols.map((c) => `count(*) FILTER (WHERE t."${c}" IS NULL AND t."report_date" <= DATE '2021-12-31')::int "${c}_pre",
     count(*) FILTER (WHERE t."${c}" IS NULL AND t."report_date" > DATE '2021-12-31')::int "${c}_post"`).join(",");
  const [a] = await raw(`
    SELECT count(*) FILTER (WHERE t."report_date" <= DATE '2021-12-31')::int n_pre,
           count(*) FILTER (WHERE t."report_date" > DATE '2021-12-31')::int n_post, ${asel}
      FROM banking_fundamentals t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."result_type"='standalone' AND s."is_active"=true
       AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'`);
  console.log(`  rows: pre ${a.n_pre} · post ${a.n_post}`);
  console.log(`  ${"field".padEnd(30)}${"null pre".padStart(10)}${"null post".padStart(11)}`);
  for (const c of acols) console.log(`  ${c.padEnd(30)}${String(a[`${c}_pre`]).padStart(10)}${String(a[`${c}_post`]).padStart(11)}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
