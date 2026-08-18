// S4G — emit the markdown summary that ships beside the CSVs. READ-ONLY.
import "dotenv/config";
import { writeFileSync, readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const OUT = process.env.S4G_OUT ?? "c:/Vytal/Vytal/outputs";
interface Cell { symbol: string; industry: string; table: string; basis: string; fiscalYear: string; quarter: string; reportDate: string; type: "A" | "B" | "C"; field: string; why: string; sourceHint: string; xbrlUrl: string; momentumCritical: boolean }

async function main() {
  const { cells, exclBoundary, exclPreFirst } = JSON.parse(readFileSync(`${OUT}/_s4g-cells.json`, "utf8")) as any;
  const p3 = JSON.parse(readFileSync(`${OUT}/_s4g-p3.json`, "utf8"));
  const C: Cell[] = cells;
  const n = (t: string, tb?: string) => C.filter((c) => c.type === t && (!tb || c.table === tb)).length;
  const stocks = (t: string) => new Set(C.filter((c) => c.type === t).map((c) => c.symbol)).size;

  const byStock = readFileSync(`${OUT}/vytal-manual-entry-by-stock.csv`, "utf8").split("\n").slice(1).filter(Boolean).map((l) => {
    const p: string[] = []; let cur = "", q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { p.push(cur); cur = ""; } else cur += ch; }
    p.push(cur); return p;
  });
  const wins = byStock.filter((r) => r[8] === "no" && r[9] === "yes" && +r[2] > 0).sort((a, b) => +a[2] - +b[2]);
  const momWins = byStock.filter((r) => r[10] === "no" && r[11] === "yes").sort((a, b) => +a[2] - +b[2]);

  const Q13 = ["2018-12-31","2019-03-31","2019-06-30","2019-09-30","2019-12-31","2020-03-31","2020-06-30","2020-09-30","2020-12-31","2021-03-31","2021-06-30","2021-09-30","2021-12-31"];
  const strictQ = C.filter((c) => c.table === "banking_quarterly_results" && ["interest_expended", "gnpa_pct"].includes(c.field) && Q13.includes(c.reportDate)).length;

  const md = `# Vytal — Manual-Entry Manifest

**Generated** 2026-08-17 · cohort **439** active stocks (413 non-financial · 26 banking) · basis **standalone only**

## Files

| file | rows | what it is |
|---|---:|---|
| \`vytal-manual-entry-manifest.csv\` | ${C.length} | one row per (stock, period, basis, field) needing a human value |
| \`vytal-manual-entry-by-stock.csv\` | 439 | per-stock roll-up: cells, and whether keying makes it complete / scoreable |

Sort the manifest by \`type\`, then \`symbol\`. Filter \`type=B\` **out** before keying — those are a re-ingest.
\`momentum_critical=yes\` marks cells inside the 2022-01-31 momentum run.

## The three types

| type | meaning | count | stocks | who fixes it |
|---|---|---:|---:|---|
| **A** | row held, specific columns null | ${n("A")} | ${stocks("A")} | keyer — \`xbrl_url\` is in the row |
| **B** | standalone period missing, consolidated held | ${n("B")} | ${stocks("B")} | **RE-INGEST, not keying** |
| **C** | period missing on both bases | ${n("C")} | ${stocks("C")} | keyer — company AR / quarterly PDF |
| | **total** | **${C.length}** | | |

### By table

| table | A | B | C | total |
|---|---:|---:|---:|---:|
| quarterly_results | ${n("A","quarterly_results")} | ${n("B","quarterly_results")} | ${n("C","quarterly_results")} | ${n("A","quarterly_results")+n("B","quarterly_results")+n("C","quarterly_results")} |
| fundamentals | ${n("A","fundamentals")} | ${n("B","fundamentals")} | ${n("C","fundamentals")} | ${n("A","fundamentals")+n("B","fundamentals")+n("C","fundamentals")} |
| banking_quarterly_results | ${n("A","banking_quarterly_results")} | ${n("B","banking_quarterly_results")} | ${n("C","banking_quarterly_results")} | ${n("A","banking_quarterly_results")+n("B","banking_quarterly_results")+n("C","banking_quarterly_results")} |
| banking_fundamentals | ${n("A","banking_fundamentals")} | ${n("B","banking_fundamentals")} | ${n("C","banking_fundamentals")} | ${n("A","banking_fundamentals")+n("B","banking_fundamentals")+n("C","banking_fundamentals")} |

## What keying buys

| | non-financial | banking | all |
|---|---:|---:|---:|
| complete now | | | 194 |
| **complete after ALL keying** | | | **417** of 439 |
| momentum-scoreable at 2022-01-31 now | ${p3.p3d.nfNow} | ${p3.p3d.bkNow} | ${p3.p3d.nfNow + p3.p3d.bkNow} |
| **momentum-scoreable after keying** | **${p3.p3d.nfAfter}** | **${p3.p3d.bkAfter}** | **${p3.p3d.nfAfter + p3.p3d.bkAfter}** |
| gained | +${p3.p3d.nfAfter - p3.p3d.nfNow} | +${p3.p3d.bkAfter - p3.p3d.bkNow} | **+${(p3.p3d.nfAfter + p3.p3d.bkAfter) - (p3.p3d.nfNow + p3.p3d.bkNow)}** |

### The ceiling — what stays impossible

${p3.p3d.blockers.map(([k, v]: [string, number]) => `- **${v}** — ${k}`).join("\n")}

**22 stocks can never be complete in the 2018-03-31..2024-12-31 window**: they have no quarterly row inside it
because they listed after it closed (${p3.p3c.blocked.slice(0, 6).join(", ")}, …). There is no filing to key, at any price.

**53 stocks are blocked on the value side**, not the coverage side. \`non_positive_base\` means the prior-year TTM
net-profit base is ≤ 0, so M4 cannot form a YoY ratio. \`m4NetProfitYoyTtm\` reads the **last 8 quarters**; filling
earlier gaps lengthens the tail but never moves that window, so the blocker survives every cell you key.

## The banking set Aman ruled

| set | cells |
|---|---:|
| quarterly \`interest_expended\` + \`gnpa_pct\`, **strict 13 quarters** (2018-12-31 → 2021-12-31) | **${strictQ}** |
| quarterly, from first filing (16 quarters) | 786 |
| annual \`advances\`/\`investments\`/\`cash_and_balances_with_rbi\`/\`balances_with_banks\`, ≤ FY21 | 296 |
| **ruled set, momentum run** | **${strictQ + 296}** |
| ruled set, full 2018..2024 window | 1910 |

Strict quarterly = 26 banks × 13 quarters × 2 fields = ${strictQ}, exactly. Periods: ${Q13.join(", ")}.

> ### ⚠ The banking gap is an ERA gap, not a pre-2022 gap
> \`interest_expended\`, \`operating_expenses\`, \`gnpa_absolute\`, \`nnpa_absolute\`, \`gnpa_pct\`, \`nnpa_pct\`,
> \`cet1_ratio\`, \`additional_tier1_ratio\`, \`roa_quarterly\` are **null in 590 of 590 legacy rows (≤2024-12-31)
> and 0 of 156 v3 rows (≥2025-03-31)**. The legacy banking ingest never carried them; the v3 ingest always does.
>
> Keying 13 quarters back from 2022-01-31 buys the momentum score **at that one date**. The same columns stay
> null for **2022-03-31 → 2024-12-31** — 12 more quarters — so banking momentum breaks again immediately after
> the cutoff and does not recover until the v3 era. Keying the ruled set and stopping is a **local** fix.

## Effort

| | cells | documents |
|---|---:|---:|
| A — XBRL URL in hand | ${p3.effort.docsA ? n("A") : 0} | ${p3.effort.docsA} |
| C — find the AR/PDF first | ${n("C")} | ${p3.effort.docsC} |
| **keyable (A + C)** | **${p3.effort.keyCells}** | **${p3.effort.keyDocs}** |
| B — re-ingest, not keying | ${n("B")} | ${p3.effort.docsB} |

One document yields every field on that (stock, period, basis) — the unit of work is the **document**, not the cell.
At 4–8 min/document for A and 8–15 min for C: **118–228 hours ≈ 17–33 working days** at 7 h/day.

## What was excluded, and why

- **${exclBoundary} boundary-explained annual nulls** — balance sheet in filings ≤ 2022-11-25, cash flow ≤ 2021-11-24.
  NSE's XBRL did not carry those statements before those dates. Not defects, and ruled out of scope.
- **${exclPreFirst} quarterly periods before a stock's first filing** — nothing exists to key.
- **The 3 deactivated stocks** — ABBOTINDIA, BAYERCROP, MCX (cohort is 439, not 442).
- **Derived / display columns.** Score-relevant per \`score-input-columns.ts\`, but computed by the derive layer
  from the raw cells, so keying them is work the machine already does:
  \`operating_profit\` (= pbt + interest + depreciation), \`total_debt\`, \`roce\`, \`roe\`, \`debt_to_equity\`,
  \`interest_coverage\`, \`receivables_days\`, \`asset_turnover\`, \`net_worth\`, \`operating_margin\`, \`ebitda\`,
  and banking \`nii\`, \`net_interest_margin\`, \`cost_to_income_ratio\`, \`pcr\`. Key the inputs; run \`src/fill/re-derive.ts\`.
- **Keys** (\`stock_id\`, \`result_type\`, \`report_date\`, \`fiscal_year\`, \`quarter\`) — row identity, not values.
- **Consolidated basis entirely.** Every scoring loader filters \`resultType:"standalone"\`
  (\`metrics/load.ts:30,76\`; \`banking-load.ts:18,56\`). A consolidated cell is never read by any metric.

## Cheapest wins first

${wins.length} stocks become complete purely by keying. The ${Math.min(20, wins.length)} cheapest:

| symbol | industry | cells | A | B | C | → momentum? |
|---|---|---:|---:|---:|---:|---|
${wins.slice(0, 20).map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} | ${r[11] === "yes" ? "yes" : "no — " + r[14]} |`).join("\n")}

${momWins.length} stocks gain a **momentum score** they do not have today. The ${Math.min(15, momWins.length)} cheapest:

| symbol | industry | cells | tail now → after |
|---|---|---:|---|
${momWins.slice(0, 15).map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[12]} → ${r[13]} |`).join("\n")}

Full ranking in \`vytal-manual-entry-by-stock.csv\`.
`;
  writeFileSync(`${OUT}/vytal-manual-entry-summary.md`, md, "utf8");
  console.log(`→ ${OUT}/vytal-manual-entry-summary.md`);
  console.log(`  wins(complete): ${wins.length}   wins(momentum): ${momWins.length}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
