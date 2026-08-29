// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROBE — DO THE BSE DOCUMENTS ACTUALLY CONTAIN THE FACTS THE LANE IS NOT WRITING? Read-only.
//
//   npx tsx src/scripts/probe-bse-instance-facts.ts [--per 2]
//
// The column audit says 140 columns are structurally unfillable — the BSE writer never names them.
// That number is meaningless on its own, because it mixes two opposite verdicts:
//
//   • the fact IS in the filing and the lane throws it away   → a real defect, fixable
//   • the fact is NOT in the filing                           → nothing to fix; a results filing is
//                                                                not a balance sheet
//
// Only the document can settle that, so this fetches the REAL instance each row was built from —
// `xbrl_url` is stored per row — and lists the element local-names it actually contains. No guessing
// at tag names: the document's own vocabulary is dumped and matched against what is missing.
//
// ⚠ READ-ONLY and politely paced. It reuses the lane's own BsePacer, so it cannot hammer BSE, and it
//   fetches a couple of documents per family — enough to answer a yes/no about the vocabulary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchInstance } from "../ingestions/quaterly-results/bse/bse-discovery.js";

const argv = process.argv;
const PER = argv.includes("--per") ? Number(argv[argv.indexOf("--per") + 1]) : 2;
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** Table → the facts the audit says are missing, and the tag fragments that would carry them. */
const LOOK_FOR: Record<string, Array<[string, RegExp]>> = {
  fundamentals: [
    ["basic_eps", /BasicEarningsPerShare|BasicEPS/i],
    ["diluted_eps", /DilutedEarningsPerShare|DilutedEPS/i],
    ["paid_up_equity_capital", /PaidUpValueOfEquityShareCapital|PaidUpEquity/i],
    ["inventories", /^Inventories$/i],
    ["current_assets", /TotalCurrentAssets/i],
    ["cash_from_investing", /CashFlow(s)?FromUsedInInvesting/i],
    ["trade_payables_current", /TradePayables(Current)?/i],
    ["goodwill", /^Goodwill$/i],
  ],
  banking_quarterly_results: [
    ["total_income", /^(Total)?Income$|TotalIncome/i],
    ["nii", /NetInterestIncome/i],
    ["profit_after_tax", /ProfitLossForPeriod|ProfitAfterTax/i],
    ["expenditure_excl_provisions", /TotalExpenditure|OperatingExpenses/i],
    ["interest_earned", /InterestEarned/i],
  ],
  nbfc_quarterly_results: [
    ["interest_income", /InterestIncome/i],
    ["fee_and_commission_income", /FeeAndCommissionIncome/i],
    ["other_expenses", /OtherExpenses/i],
    ["nii", /NetInterestIncome/i],
  ],
};

const localNames = (xml: string): Set<string> =>
  new Set([...xml.matchAll(/<(?:[A-Za-z0-9_.-]+:)?([A-Za-z][A-Za-z0-9_.-]*)[\s/>]/g)].map((m) => m[1]));

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`PROBE — is the fact in the BSE document, or does the lane simply not read it?`);
  console.log("=".repeat(104));
  const pacer = new BsePacer({ minSpacingMs: 1200 });

  for (const [table, wanted] of Object.entries(LOOK_FOR)) {
    const rows = await raw<{ symbol: string; fy: string; q: string | null; url: string }>(`
      SELECT s.symbol, t.fiscal_year fy, ${table === "fundamentals" ? "NULL::text q" : "t.quarter q"}, t.xbrl_url url
        FROM "${table}" t JOIN stocks s ON s.id = t.stock_id
       WHERE t.source = 'bse_xbrl' AND t.xbrl_url IS NOT NULL
       ORDER BY t.fiscal_year DESC LIMIT ${Math.max(1, PER)}`);
    console.log(`\n  ── ${table} ──`);
    if (!rows.length) { console.log(`     no BSE row with a stored xbrl_url`); continue; }

    for (const r of rows) {
      let xml: string;
      try { xml = await fetchInstance(pacer, r.url); }
      catch (e) { console.log(`     ${r.symbol} ${r.fy}${r.q ? " " + r.q : ""} — fetch failed: ${String(e).slice(0, 90)}`); continue; }
      const names = localNames(xml);
      console.log(`     ${r.symbol} ${r.fy}${r.q ? " " + r.q : ""} — ${names.size} distinct element names, ${xml.length} bytes`);
      for (const [col, re] of wanted) {
        const hits = [...names].filter((n) => re.test(n));
        console.log(`        ${hits.length ? "✅ IN THE DOCUMENT" : "—  absent        "}  ${col.padEnd(24)} ${hits.slice(0, 3).join(", ")}`);
      }
    }
  }
  console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
