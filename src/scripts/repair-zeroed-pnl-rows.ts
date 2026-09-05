// ─────────────────────────────────────────────────────────────────────────────────────────────
// ONE-OFF REPAIR — the rows that landed as a ₹0 profit-and-loss.
//
// WHAT THEY ARE. A filer who reports only the full year still ships the quarterly column, and a
// filer who reports only the quarter still ships the annual one. The unreported column is not
// omitted — it is filled with 0.00 on every line. Read literally that is ₹0 of revenue, ₹0 of
// expenses and ₹0 of profit for a period the company demonstrably traded. MEASURED:
//     HEROMOTOCO Q4 FY19 consolidated  — OneD all 0.00, FourD ₹33,972.23 Cr of revenue
//     VEDPOWER   Q4 FY26 standalone    — OneD all 0.00, FourD ₹5,453.18 Cr
//     ADANIENSOL FY19 standalone       — FourD all 0.00, OneD ₹260.27 Cr  (the annual mirror)
//     MRF / NTPC FY18 consolidated     — BOTH columns 0.00, and nothing in the instance but a
//                                        paid-up equity capital of ₹4.24 Cr / ₹8,245.46 Cr
// This is the failure class zero-block-guard.ts exists for: a wrong number wearing the clothes of
// a measurement. GUARD 1 could not catch it, because it tests for NULL and a zero is not a null.
//
// THE SOURCE-CODE FIX has shipped — zero-block-guard.ts RULE 4, wired into both Ind-AS parsers, so
// no new row can land this way. It cannot repair what is already stored: the shape guard REJECTS
// the upsert precisely to preserve the existing row, which here is the bad one.
//
// SO THIS SCRIPT REPAIRS THEM, AND IT PROVES EACH ONE FIRST. It re-fetches every candidate row's
// OWN filing and re-runs RULE 4 against it. Only a row the guard actually refuses is touched — a
// row that merely LOOKS all-zero in the database because a genuine ₹35,000 P&L rounded to 0.00 in
// Decimal(18,2) (LCCINFOTEC Q3 FY26, VISL Q4 FY26) is left exactly as it is.
//
// WHAT IT WRITES: NULL on the P&L columns and the ratios derived from them. NEVER a delete, and
// NEVER a guess. "Unavailable" is recoverable by a hand-key with a citation; a false zero scores
// silently. The BALANCE SHEET is deliberately untouched — ADANIENSOL, DEEPAKNTR and NSLNISP carry
// real, correct balance sheets in the same rows, and the refusal is a statement about the P&L.
//
//   npx tsx src/scripts/repair-zeroed-pnl-rows.ts [--apply]
// ─────────────────────────────────────────────────────────────────────────────────────────────
import https from "node:https";
import { prisma } from "../db/prisma.js";
import { extractNumber } from "../ingestions/quaterly-results/xbrl/extract.js";
import { pnlBlockRefused } from "../ingestions/quaterly-results/xbrl/zero-block-guard.js";
import {
  QUARTERLY_PNL_CONTEXT,
  ANNUAL_PNL_CONTEXT,
  BALANCE_SHEET_CONTEXT,
} from "../ingestions/quaterly-results/xbrl/contexts.js";

const APPLY = process.argv.includes("--apply");

/** The prefix a document uses. Legacy filings are `in-bse-fin`; integrated filings `in-capmkt`. */
function prefixFor(xml: string): string {
  return xml.includes("<in-capmkt:") ? "in-capmkt" : "in-bse-fin";
}

function fetchXml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
}

type Candidate = {
  id: string;
  symbol: string;
  period: string;
  resultType: string;
  xbrlUrl: string | null;
};

// ── The candidates: every stored row whose P&L is entirely zero. ──
const quarterly = await prisma.$queryRaw<Candidate[]>`
  SELECT q.id, s.symbol, (q.quarter || '-' || q.fiscal_year) AS period,
         q.result_type AS "resultType", q.xbrl_url AS "xbrlUrl"
  FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
  WHERE coalesce(q.revenue,0)=0 AND coalesce(q.other_income,0)=0 AND coalesce(q.expenses,0)=0
    AND coalesce(q.profit_before_tax,0)=0 AND coalesce(q.net_profit,0)=0
    AND (q.revenue IS NOT NULL OR q.net_profit IS NOT NULL)
  ORDER BY s.symbol`;

const annual = await prisma.$queryRaw<Candidate[]>`
  SELECT f.id, s.symbol, f.fiscal_year AS period,
         f.result_type AS "resultType", f.xbrl_url AS "xbrlUrl"
  FROM fundamentals f JOIN stocks s ON s.id = f.stock_id
  WHERE coalesce(f.revenue,0)=0 AND coalesce(f.other_income,0)=0 AND coalesce(f.expenses,0)=0
    AND coalesce(f.profit_before_tax,0)=0 AND coalesce(f.net_profit,0)=0
    AND (
      -- the untouched case: a P&L stored as zeros
      (f.revenue IS NOT NULL OR f.net_profit IS NOT NULL)
      -- …and the TAIL of an earlier pass: the P&L is already NULL, but an EPS of exactly 0 is
      -- still sitting there. It came out of the same refused block and is the same non-disclosure.
      OR (f.revenue IS NULL AND f.net_profit IS NULL AND (f.basic_eps = 0 OR f.diluted_eps = 0))
    )
  ORDER BY s.symbol`;

console.log(`candidates — quarterly ${quarterly.length}, annual ${annual.length}\n`);

let refused = 0, kept = 0, unverifiable = 0, applied = 0;

async function judge(c: Candidate, isAnnual: boolean): Promise<boolean | null> {
  if (!c.xbrlUrl) return null;
  let xml: string;
  try {
    xml = await fetchXml(c.xbrlUrl);
  } catch (e) {
    console.log(`  ? ${c.symbol} ${c.period} ${c.resultType} — could not re-fetch (${(e as Error).message})`);
    return null;
  }
  const prefix = prefixFor(xml);
  const read = (tag: string, ctx: string) => extractNumber(xml, tag, ctx, prefix);
  const v = pnlBlockRefused(
    read,
    isAnnual ? ANNUAL_PNL_CONTEXT : QUARTERLY_PNL_CONTEXT,
    isAnnual ? QUARTERLY_PNL_CONTEXT : ANNUAL_PNL_CONTEXT,
    BALANCE_SHEET_CONTEXT,
  );
  console.log(
    `  ${v.refused ? "✗ ZEROED" : "· real   "} ${c.symbol} ${c.period} ${c.resultType}` +
      (v.refused ? `\n        ${v.note?.slice(0, 150)}` : "  (a genuine tiny/dormant P&L — left alone)"),
  );
  return v.refused;
}

console.log("── QUARTERLY ──");
for (const c of quarterly) {
  const r = await judge(c, false);
  if (r === null) { unverifiable++; continue; }
  if (!r) { kept++; continue; }
  refused++;
  if (APPLY) {
    await prisma.quarterlyResult.update({
      where: { id: c.id },
      data: {
        revenue: null, otherIncome: null, expenses: null, operatingProfit: null,
        depreciation: null, interest: null, profitBeforeTax: null, tax: null, netProfit: null,
        // ratios derived from the P&L — they cannot outlive their inputs
        operatingMargin: null, netMargin: null,
        revenueQoq: null, revenueYoy: null, profitQoq: null, profitYoy: null,
      },
    });
    applied++;
  }
}

console.log("\n── ANNUAL ──");
for (const c of annual) {
  const r = await judge(c, true);
  if (r === null) { unverifiable++; continue; }
  if (!r) { kept++; continue; }
  refused++;
  const held = await prisma.fundamental.findUnique({
    where: { id: c.id },
    select: { basicEps: true, dilutedEps: true },
  });
  const zeroEps =
    (held?.basicEps?.toNumber() ?? null) === 0 || (held?.dilutedEps?.toNumber() ?? null) === 0;
  if (APPLY) {
    await prisma.fundamental.update({
      where: { id: c.id },
      data: {
        // P&L only. The balance sheet in the same row is untouched — see the header.
        revenue: null, otherIncome: null, expenses: null, employeeBenefitExpense: null,
        financeCosts: null, depreciation: null, profitBeforeTax: null, tax: null, netProfit: null,
        // ratios derived from the P&L
        ebitda: null, netMargin: null, operatingMargin: null,
        revenueGrowthYoy: null, profitGrowthYoy: null, epsGrowthYoy: null,
        roe: null, roce: null, interestCoverage: null,
        // EPS out of a refused block, nulled ONLY when it reads exactly 0 — the identity in
        // parser-indas.ts `perShare`: a zero-filled P&L cannot produce a non-zero EPS, so a
        // non-zero one is real (POLYMED FY18 carries 1.83) and survives.
        ...(zeroEps ? { basicEps: null, dilutedEps: null } : {}),
      },
    });
    applied++;
  }
}

console.log(`\nREFUSED (zeroed block, repaired to NULL) : ${refused}`);
console.log(`KEPT    (a real, tiny P&L)               : ${kept}`);
console.log(`UNVERIFIABLE (no URL / fetch failed)     : ${unverifiable}`);
console.log(APPLY ? `\n✅ nulled the P&L on ${applied} row(s).` : `\n(dry run — pass --apply to write)`);
await prisma.$disconnect();
