// ═══════════════════════════════════════════════════════════════
// R4c-TRACE — EVERY UNEXPLAINED NULL TRACED TO THE DOCUMENT. READ-ONLY.
//   npx tsx src/scripts/_r4c-trace.ts [--per-group 4]
//
// Reads _r4c-unexplained.json (written by _r4b-fill.ts) and, for EACH
// (table, column) group, opens real source documents and DUMPS the element
// inventory — every in-bse-fin tag the document contains and the contexts it
// appears under. It does NOT grep for the tag we expect: a field whose tag we
// never look for cannot be found by looking for it, so the dump is the evidence
// and the expected tag is checked against the dump afterwards.
//
// The output is A CAUSE PER GROUP, evidenced by documents, not a count.
// Groups are sampled across DIFFERENT stocks and DIFFERENT fiscal years.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const DIR = process.env.R1_DIR ?? ".";
const IN = `${DIR}/_r4c-unexplained.json`;
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const PER_GROUP = Number(arg("--per-group") ?? 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

// the tag we BELIEVE produces each column — checked against the dump, never grepped for first
const EXPECT: Record<string, string> = {
  tradeReceivablesNoncurrent: "TradeReceivablesNoncurrent",
  tradeReceivablesCurrent: "TradeReceivablesCurrent",
  faceValueShare: "FaceValueOfEquityShareCapital",
  capitalWorkInProgress: "CapitalWorkInProgress",
  propertyPlantAndEquipment: "PropertyPlantAndEquipment",
  equityShareCapital: "EquityShareCapital", otherEquity: "OtherEquity", totalEquity: "Equity",
  borrowingsCurrent: "BorrowingsCurrent", borrowingsNoncurrent: "BorrowingsNoncurrent",
  totalAssets: "Assets", currentLiabilities: "CurrentLiabilities",
  cashFromOperating: "CashFlowsFromUsedInOperatingActivities",
  capex: "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
  cashFromFinancing: "CashFlowsFromUsedInFinancingActivities",
  revenue: "RevenueFromOperations", otherIncome: "OtherIncome", financeCosts: "FinanceCosts",
  depreciation: "DepreciationDepletionAndAmortisationExpense",
  profitBeforeTax: "ProfitBeforeTax", netProfit: "ProfitLossForPeriod",
  advances: "Advances", investments: "Investments", deposits: "Deposits",
  interestEarned: "InterestEarned", interestExpended: "InterestExpended",
  operatingExpenses: "OperatingExpenses", ppop: "OperatingProfitBeforeProvisionAndContingencies",
  cashAndBalancesWithRbi: "CashAndBalancesWithReserveBankOfIndia",
  balancesWithBanks: "BalancesWithBanksAndMoneyAtCallAndShortNotice",
  gnpaAbsolute: "GrossNonPerformingAssets", nnpaAbsolute: "NonPerformingAssets",
  roaDisclosed: "ReturnOnAssets", tier1Ratio: "(no legacy producer)",
};
const BS_CTX = "OneI";

function inventory(xml: string): Map<string, Set<string>> {
  const inv = new Map<string, Set<string>>();
  const re = /<in-bse-fin:([A-Za-z0-9_.]+)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    const ctx = /contextRef="([^"]+)"/.exec(m[2])?.[1] ?? "(no-context)";
    if (!inv.has(tag)) inv.set(tag, new Set());
    inv.get(tag)!.add(ctx);
  }
  return inv;
}

async function main() {
  if (!existsSync(IN)) { console.error(`FATAL: ${IN} missing — run _r4b-fill.ts first`); process.exit(1); }
  const recs: any[] = JSON.parse(readFileSync(IN, "utf8"));
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4c-TRACE — CAUSE PER GROUP, FROM DUMPED ELEMENT INVENTORIES               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${recs.length} unexplained null record(s) to account for\n`);

  const groups = new Map<string, any[]>();
  for (const r of recs) { const k = `${r.table}.${r.col}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  console.log(`  ${groups.size} (table, column) group(s):`);
  for (const [k, v] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`    ${pad(k, 52)}${lp(v.length, 6)}`);

  const conclusions: any[] = [];
  for (const [k, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const col = k.split(".")[1];
    console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ ${pad(k + `  (${list.length} unexplained)`, 73)}║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

    // sample across DIFFERENT stocks and DIFFERENT fiscal years
    const seenSym = new Set<string>(), seenFy = new Set<string>();
    const picks: any[] = [];
    for (const r of list) {
      if (picks.length >= PER_GROUP) break;
      if (seenSym.has(r.sym) && seenFy.has(r.fy)) continue;
      if (!r.url) continue;
      picks.push(r); seenSym.add(r.sym); seenFy.add(r.fy);
    }
    for (const r of list) { if (picks.length >= PER_GROUP) break; if (r.url && !picks.includes(r)) picks.push(r); }

    let tagAbsent = 0, tagWrongCtx = 0, tagRightCtx = 0, unreachable = 0;
    for (const p of picks) {
      let xml: string;
      try { xml = await fetchXbrlFile(p.url); }
      catch (e) { unreachable++; console.log(`  ${p.sym} ${p.fy}${p.q ?? ""} ${p.rt} — document unreachable (${(e as Error).message.slice(0, 50)})`); continue; }
      const inv = inventory(xml);
      console.log(`\n  ── ${pad(`${p.sym} ${p.fy}${p.q ?? ""} ${p.rt}`, 34)} bcast ${String(p.fd).slice(0, 10)} · ${inv.size} distinct elements`);

      // DUMP: what the document actually contains in the relevant context
      const inCtx = [...inv.entries()].filter(([, cs]) => cs.has(BS_CTX)).map(([t]) => t).sort();
      if (inCtx.length) {
        console.log(`     elements present under contextRef="${BS_CTX}" (${inCtx.length}):`);
        for (let i = 0; i < Math.min(inCtx.length, 40); i += 4) console.log(`       ${inCtx.slice(i, i + 4).map((t) => pad(t, 40)).join("")}`);
        if (inCtx.length > 40) console.log(`       … ${inCtx.length - 40} more`);
      } else {
        console.log(`     ⚠ NO elements at all under contextRef="${BS_CTX}" — the document carries no balance sheet`);
      }
      // NOW check the expected tag against the dump
      const want = EXPECT[col];
      const where = inv.get(want);
      if (!where) { tagAbsent++; console.log(`     → <${want}> : ABSENT from the whole document`); }
      else if (!where.has(BS_CTX) && !where.has("FourD") && !where.has("OneD")) { tagWrongCtx++; console.log(`     → <${want}> : present ONLY under {${[...where].join(",")}} ⚠`); }
      else { tagRightCtx++; console.log(`     → <${want}> : PRESENT under {${[...where].join(",")}} ⚠⚠ we read null anyway`); }
      await sleep(300);
    }

    const cause = tagRightCtx > 0
      ? `⚠ FALSE NULL — the tag is in the document under a context we read; this is a PARSER DEFECT`
      : tagWrongCtx > 0
      ? `⚠ FALSE NULL — the tag exists but only under contexts the parser does not read`
      : tagAbsent > 0
      ? `GENUINE — the issuer did not tag this fact. The field is not disclosed, so there is nothing to read.`
      : `INCONCLUSIVE — every sampled document was unreachable`;
    console.log(`\n  CAUSE for ${k}: ${cause}`);
    console.log(`  (evidence: ${picks.length} document(s) opened · tag absent ${tagAbsent} · wrong-context ${tagWrongCtx} · right-context ${tagRightCtx} · unreachable ${unreachable})`);
    conclusions.push({ group: k, count: list.length, sampled: picks.length, tagAbsent, tagWrongCtx, tagRightCtx, unreachable, cause });
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4c — CAUSES, ALL GROUPS                                                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const c of conclusions.sort((a, b) => b.count - a.count)) {
    console.log(`  ${pad(c.group, 46)}${lp(c.count, 6)}  ${c.cause}`);
  }
  const defects = conclusions.filter((c) => c.cause.startsWith("⚠"));
  console.log(`\n  groups whose cause is a DEFECT (false null): ${defects.length === 0 ? "✓ none" : "⚠ " + defects.length}`);
  for (const d of defects) console.log(`    ⚠ ${d.group} — ${d.count} cell(s)`);
  writeFileSync(`${DIR}/_r4c-causes.json`, JSON.stringify(conclusions, null, 1));
  console.log(`\n  → ${DIR}/_r4c-causes.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
