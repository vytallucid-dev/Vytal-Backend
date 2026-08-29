// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 8 — THE MANUAL WORKBOOK. Generated from the LIVE remaining gaps, after the final BSE sweep.
//
//   npx tsx src/scripts/stage8-workbook.ts
//
// The promise this workbook makes is: fill every cell and the universe is complete from the sweet
// spot (or listing date) to the current period. That promise is only honest if
//   (a) every row is a gap no automated lane can reach — hence it runs AFTER the sweep, and
//   (b) every column asked for is one a human can actually source and the system actually uses.
//
// ── WHY NOT SIMPLY LIST EVERY COLUMN ─────────────────────────────────────────────────────────────
// `fundamentals` has 83 numeric columns. Asking for all of them, times 87 annual rows, is not a
// workbook anyone finishes. Three rules cut it down, and each was MEASURED rather than guessed:
//   1. DERIVED columns are never asked for — margins, YoY growth, ratios, ROE, book value. The
//      system computes them, and a hand-typed value that disagrees with its own inputs is worse
//      than a null.
//   2. Columns the pipeline itself rarely fills are marked optional, not required — if the
//      automated path leaves them null 70% of the time, they are not what "complete" means here.
//   3. REQUIRED is the P&L spine plus what the scoring layer actually reads (measured by usage:
//      netProfit in 28 scoring files, profitBeforeTax 20, totalAssets 19, tax 15, revenue 30).
//
// One CSV per table, wide — one row per period, columns across — because that is what a person can
// fill in a spreadsheet. A tall cell-per-row format is easier to load and miserable to complete.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { analyse, type StockGap } from "./stage8-completeness.js";
import { fyq as fyqShared, fyLabel } from "./fy-label.js";

const DIR = "_WORKBOOK";
const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

/** ★ REQUIRED — the row is not useful without these. Everything else on the sheet is a bonus. */
const REQUIRED: Record<string, string[]> = {
  quarterly_results: ["revenue", "expenses", "operating_profit", "profit_before_tax", "tax", "net_profit"],
  fundamentals: ["revenue", "expenses", "profit_before_tax", "tax", "net_profit", "total_assets", "total_equity"],
  banking_quarterly_results: ["interest_earned", "interest_expended", "other_income", "total_income", "profit_before_tax", "tax", "net_profit"],
  banking_fundamentals: ["interest_earned", "interest_expended", "other_income", "total_income", "profit_before_tax", "tax", "net_profit", "total_assets", "deposits", "advances"],
  nbfc_quarterly_results: ["revenue", "total_income", "finance_costs", "total_expenses", "profit_before_tax", "tax", "net_profit"],
  nbfc_fundamentals: ["revenue", "total_income", "total_expenses", "profit_before_tax", "tax", "net_profit", "total_assets", "total_equity"],
  life_insurance_quarterly_results: ["gross_premium_income", "reinsurance_ceded", "total_commission", "total_operating_expenses", "profit_before_tax", "net_profit"],
  life_insurance_fundamentals: ["gross_premium_income", "total_revenue_policyholders", "total_commission", "total_operating_expenses", "profit_before_tax", "tax", "net_profit", "total_assets"],
  general_insurance_quarterly_results: ["gross_premiums_written", "premium_earned", "incurred_claims", "net_commission", "total_operating_expenses_related_to_insurance", "profit_before_tax", "tax", "net_profit"],
  general_insurance_fundamentals: ["gross_premiums_written", "premium_earned", "incurred_claims", "net_commission", "profit_before_tax", "tax", "net_profit", "total_assets"],
  // ⚠ ON THIS TABLE THE PERCENTAGES ARE THE SOURCE, NOT A DERIVATION. promoter_pct and public_pct
  //   are declared NOT NULL — a shareholding row cannot exist without them — and fii/dii are what
  //   the pattern is actually read for. The general "never ask for a _pct" rule is right everywhere
  //   else and wrong here.
  shareholding_patterns: ["promoter_pct", "public_pct", "fii_pct", "dii_pct", "total_shares", "promoter_shares", "pledged_shares"],
};
/** How many of the measured-core extras to offer beyond the required spine. Keeps sheets finishable. */
const MAX_RECOMMENDED = 10;

const fyq = fyqShared;
const csvCell = (s: unknown): string => {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

async function main(): Promise<void> {
  // ⚠ Overwrite in place; do NOT remove the directory. On Windows an open handle (an Explorer
  //   window, a sync client, an antivirus scan) makes rmSync throw EPERM and the whole regeneration
  //   fails — leaving STALE CSVs on disk that look freshly generated. Individually unlinking the
  //   .csv files we are about to rewrite is both sufficient and survivable.
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".csv")) continue;
    try { fs.unlinkSync(path.join(DIR, f)); } catch { /* rewritten below anyway */ }
  }
  const cols = JSON.parse(fs.readFileSync("_s8-columns.json", "utf8")) as Record<string, { core: string[]; optional: string[] }>;
  const { horizonQ, horizonA, horizonS, stocks } = await analyse();
  const isins = new Map((await raw<{ symbol: string; isin: string; name: string }>(
    `SELECT symbol, isin, COALESCE(name,'') name FROM stocks`)).map((r) => [r.symbol, r]));

  // ── collect every missing cell, grouped by the table that must receive it ────────────────────
  interface Row { symbol: string; ind: string; period: string; floor: string; kind: "quarterly" | "annual" | "shareholding" }
  const byTable = new Map<string, Row[]>();
  const push = (t: string, r: Row): void => {
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t)!.push(r);
  };
  for (const s of stocks) {
    for (const p of s.missQ) push(s.qTable, { symbol: s.symbol, ind: s.ind, period: p, floor: s.floor, kind: "quarterly" });
    for (const p of s.missA) push(s.aTable, { symbol: s.symbol, ind: s.ind, period: p, floor: s.floor, kind: "annual" });
    for (const p of s.missS) push("shareholding_patterns", { symbol: s.symbol, ind: s.ind, period: p, floor: s.floor, kind: "shareholding" });
  }

  const index: string[][] = [["file", "table", "grain", "rows", "stocks", "required_columns", "recommended_columns"]];
  let totalRows = 0;
  const summary: { table: string; rows: number; stocks: number; req: number; rec: number }[] = [];

  for (const [table, rows] of [...byTable].sort((a, b) => b[1].length - a[1].length)) {
    const req = REQUIRED[table] ?? [];
    const rec = (cols[table]?.core ?? []).filter((c) => !req.includes(c)).slice(0, MAX_RECOMMENDED);
    const isSh = table === "shareholding_patterns";
    const head = isSh
      ? ["symbol", "isin", "company", "as_on_date", "fiscal_year", "quarter", ...req.map((c) => `★${c}`), ...rec]
      : ["symbol", "isin", "company", "industry", "report_date", "fiscal_year", "quarter", "result_type",
         ...req.map((c) => `★${c}`), ...rec, "unit", "source_url", "notes"];
    const lines = [head.map(csvCell).join(",")];
    for (const r of rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.period.localeCompare(b.period))) {
      const f = fyq(r.period);
      const meta = isins.get(r.symbol);
      const isAnnual = r.kind === "annual";
      const base = isSh
        ? [r.symbol, meta?.isin ?? "", meta?.name ?? "", r.period, f.fy, f.q]
        : [r.symbol, meta?.isin ?? "", meta?.name ?? "", r.ind, r.period, f.fy, isAnnual ? "" : f.q, "standalone"];
      const blanks = new Array(req.length + rec.length).fill("");
      const tail = isSh ? [] : ["crore", "", ""];
      lines.push([...base, ...blanks, ...tail].map(csvCell).join(","));
    }
    const file = `${table}.csv`;
    fs.writeFileSync(path.join(DIR, file), lines.join("\n") + "\n");
    const nStocks = new Set(rows.map((r) => r.symbol)).size;
    index.push([file, table, rows[0].kind, String(rows.length), String(nStocks), req.join(" "), rec.join(" ")]);
    summary.push({ table, rows: rows.length, stocks: nStocks, req: req.length, rec: rec.length });
    totalRows += rows.length;
  }
  fs.writeFileSync(path.join(DIR, "_INDEX.csv"), index.map((r) => r.map(csvCell).join(",")).join("\n") + "\n");

  // ── the README ───────────────────────────────────────────────────────────────────────────────
  const R: string[] = [];
  R.push(`# Manual entry workbook — Vytal universe`);
  R.push(``);
  R.push(`Generated ${new Date().toISOString().slice(0, 10)} from the live database, **after** the final`);
  R.push(`automated sweep. Every row here is a gap no lane could reach.`);
  R.push(``);
  R.push(`**Fill every cell marked ★ and the universe is complete** from the sweet spot (2019-03-31) or`);
  R.push(`each stock's listing date, whichever is later, through ${horizonQ}.`);
  R.push(``);
  R.push(`| | |`);
  R.push(`|---|---|`);
  R.push(`| rows to fill | **${totalRows}** |`);
  R.push(`| files | ${summary.length} (one per destination table) |`);
  R.push(`| quarterly horizon | ${horizonQ} |`);
  R.push(`| annual horizon | ${horizonA} |`);
  R.push(`| shareholding horizon | ${horizonS} |`);
  R.push(``);
  R.push(`## Files`);
  R.push(``);
  R.push(`| file | rows | stocks | ★required | recommended |`);
  R.push(`|---|---:|---:|---:|---:|`);
  for (const s of summary) R.push(`| \`${s.table}.csv\` | ${s.rows} | ${s.stocks} | ${s.req} | ${s.rec} |`);
  R.push(``);
  R.push(`## How to fill it`);
  R.push(``);
  R.push(`1. Open each CSV in Excel or Sheets. **One row = one period for one company.**`);
  R.push(`2. The identity columns (\`symbol\`, \`isin\`, \`report_date\`, \`fiscal_year\`, \`quarter\`) are`);
  R.push(`   pre-filled — **do not edit them.** They are how the loader finds the row's home.`);
  R.push(`3. Fill the **★ columns**. Anything else is welcome but optional.`);
  R.push(`4. Put the figure in **₹ crore** (the \`unit\` column says so). If your source is in lakh,`);
  R.push(`   divide by 100; if in thousands, divide by 10,000.`);
  R.push(`5. Paste the document URL into \`source_url\` where you can — it is the audit trail.`);
  R.push(``);
  R.push(`### Rules that matter`);
  R.push(``);
  R.push(`- **Leave a row blank rather than guess.** A partially-wrong row is worse than a missing one:`);
  R.push(`  it reads as complete to every consumer downstream while quietly carrying a bad number.`);
  R.push(`  Blank rows are skipped by the loader and stay in the gap report, which is the honest outcome.`);
  R.push(`- **Never type a derived figure** — margins, growth rates, ROE, book value per share are all`);
  R.push(`  computed from the columns you fill. They are deliberately absent from these sheets.`);
  R.push(`- **Negative numbers**: use a leading minus (\`-1234.5\`), not brackets.`);
  R.push(`- **result_type** is \`standalone\` unless you are deliberately entering consolidated figures.`);
  R.push(`  Standalone and consolidated are separate rows; either can exist without the other.`);
  R.push(``);
  R.push(`## Loading it back`);
  R.push(``);
  R.push(`\`\`\`bash`);
  R.push(`npx tsx src/scripts/stage8-workbook-load.ts            # validate only — writes nothing`);
  R.push(`npx tsx src/scripts/stage8-workbook-load.ts --apply    # write`);
  R.push(`\`\`\``);
  R.push(``);
  R.push(`The loader validates before it writes: unknown symbol, unparseable number, a period outside`);
  R.push(`the stock's demand window, or a row that already exists are each reported and skipped rather`);
  R.push(`than forced. It never overwrites an existing value — it only fills nulls — so running it`);
  R.push(`twice is safe and a partially-filled workbook can be loaded as many times as you like.`);
  R.push(``);
  R.push(`## What is in each file`);
  R.push(``);
  for (const s of summary) {
    const req = REQUIRED[s.table] ?? [];
    const rec = (cols[s.table]?.core ?? []).filter((c) => !req.includes(c)).slice(0, MAX_RECOMMENDED);
    const rows = byTable.get(s.table)!;
    const bySym = new Map<string, number>();
    for (const r of rows) bySym.set(r.symbol, (bySym.get(r.symbol) ?? 0) + 1);
    const top = [...bySym].sort((a, b) => b[1] - a[1]).slice(0, 8);
    R.push(`### \`${s.table}.csv\` — ${s.rows} rows, ${s.stocks} stocks`);
    R.push(``);
    R.push(`**★ required:** ${req.map((c) => `\`${c}\``).join(", ")}`);
    R.push(``);
    if (rec.length) { R.push(`**recommended:** ${rec.map((c) => `\`${c}\``).join(", ")}`); R.push(``); }
    R.push(`Biggest contributors: ${top.map(([k, v]) => `${k} (${v})`).join(", ")}`);
    R.push(``);
  }
  fs.writeFileSync(path.join(DIR, "README.md"), R.join("\n"));

  console.log(`\n  WORKBOOK -> ${DIR}/`);
  console.log(`  ${totalRows} rows across ${summary.length} files\n`);
  for (const s of summary) console.log(`     ${s.table.padEnd(38)} ${String(s.rows).padStart(4)} rows  ${String(s.stocks).padStart(3)} stocks  ★${s.req}+${s.rec}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
