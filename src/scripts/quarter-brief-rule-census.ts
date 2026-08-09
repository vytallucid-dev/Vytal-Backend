// Census of THE CHAIN over every stored card: which named rules fire, how many distinct metrics the
// takeaway can name, and how many groups a card carries. Read-only — rebuilds each fact block, calls
// no model, writes nothing.
//
//   npx tsx src/scripts/quarter-brief-rule-census.ts
//
// ★ THIS IS THE MEASUREMENT THAT DECIDES WHETHER A RULE SHIPS. A contrast that fires on eight cards in
// ten trains the reader to skip the one that matters; a contrast that fires on none is dead code
// wearing a threshold. Both are invisible in a rendering and obvious here.

import { prisma } from "../db/prisma.js";
import { metricGloss } from "../catalogue/quarter-metrics.js";
import { annualMetricGloss } from "../catalogue/annual-metrics.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { annualManifestFor } from "../insight/quarter-brief/annual-manifest.js";
import { manifestFor } from "../insight/quarter-brief/manifest.js";
import { buildStory } from "../insight/quarter-brief/story.js";

const pct = (n: number, d: number) => (d === 0 ? "  —  " : `${((n / d) * 100).toFixed(1)}%`.padStart(6));

function histogram(counts: number[]): string {
  const by = new Map<number, number>();
  for (const c of counts) by.set(c, (by.get(c) ?? 0) + 1);
  return [...by.keys()].sort((a, b) => a - b).map((k) => `${k}:${by.get(k)}`).join("  ");
}
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Which metric each new rule NAMES. Kept here rather than on the rule, because it is a property of
 *  the census's question ("how many distinct figures can the takeaway name") and not of the rule. */
const RULE_NAMES: Record<string, string[]> = {
  profit_not_from_trading: ["netProfit"],
  ppop_vs_net_profit: ["preProvisionOperatingProfit"],
  npa_amount_vs_share: ["grossNpaAmount", "grossNpaRatio"],
  operating_vs_net_profit: ["operatingProfit"],
  effective_tax_rate_moved: ["tax", "profitBeforeTax"],
  annual_negative_net_worth: ["annual:netWorth"],
  annual_borrowed_more_cash_fell: ["annual:totalDebt", "annual:cashAndCashEquivalents"],
  annual_free_cash_flow_negative: ["annual:freeCashFlow", "annual:cashFromOperating", "annual:capitalExpenditure"],
  annual_receivables_lengthened: ["annual:receivablesDays"],
  annual_interest_cover_thin: ["annual:interestCoverage"],
  annual_return_on_equity_moved: ["annual:returnOnEquity"],
  annual_credit_cost_rose: ["annual:creditCost"],
};

/** ★ WHICH CARDS EACH RULE COULD EVER FIRE ON. Without this, every family-scoped rule reads as rare:
 *  Q-B fires on 3 of 493 cards and on 3 of the 26 BANKS, and only the second number is the rule's
 *  actual rate. The projections these are checked against were measured per family, so the census has
 *  to report per family or the comparison is between two different questions. */
const ELIGIBLE: Record<string, (family: string) => boolean> = {
  // Q-K reads a bridge that TARGETS NET PROFIT. General insurance's targets the underwriting result and
  // life insurance has none — see driver.ts's UNEXPLAINED_BRIDGES.
  profit_not_from_trading: (f) => f === "non_financial" || f === "banking" || f === "nbfc",
  topline_vs_margin: () => true,
  profit_moved_on_tax: () => true,
  provisions_vs_gnpa: (f) => f === "banking",
  ppop_vs_net_profit: (f) => f === "banking",
  npa_amount_vs_share: (f) => f === "banking",
  underwriting_vs_investment: (f) => f === "general_insurance",
  premium_vs_persistency: (f) => f === "life_insurance",
  operating_vs_net_profit: (f) => f === "non_financial",
  costs_outgrew_top_line: (f) => f === "non_financial" || f === "nbfc",
  effective_tax_rate_moved: (f) => f !== "life_insurance",
  annual_negative_net_worth: () => true,
  annual_return_on_equity_moved: () => true,
  annual_borrowed_more_cash_fell: (f) => f === "non_financial",
  annual_free_cash_flow_negative: (f) => f === "non_financial",
  annual_receivables_lengthened: (f) => f === "non_financial",
  annual_interest_cover_thin: (f) => f === "non_financial",
  annual_credit_cost_rose: (f) => f === "banking" || f === "nbfc",
};

async function main(): Promise<void> {
  // ★ THE 493-CARD SET: ONE CARD PER STOCK, AT THE NEWEST QUARTER ON FILE. That is the card a reader
  // actually meets — the results feed opens on the latest filing — and it is the same enumeration the
  // diagnosis measured, so the before/after numbers are comparable. Enumerating stored QuarterBrief
  // rows instead would measure a different, mostly-historical population: 907 rows of which only 8
  // carry an annual section, because the generated corpus is overwhelmingly not Q4.
  const stocks = await prisma.stock.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } });
  const rows = stocks.map((s) => ({ stock: s, fiscalYear: "", quarter: "" }));
  console.log(`${rows.length} stocks in the universe — building the newest card for each\n`);

  const quarterRules = new Map<string, number>();
  const annualRules = new Map<string, number>();
  const metricShare = new Map<string, number>();
  const annualShare = new Map<string, number>();
  const distinctPerCard: number[] = [];
  const labelOnlyPerCard: number[] = [];
  const groupsPerCard: number[] = [];
  const factsPerCard: number[] = [];
  const groupFacts = new Map<string, number[]>();
  const familyCards = new Map<string, number>();
  const familyAnnual = new Map<string, number>();
  let cards = 0;
  let q4 = 0;
  let withAnnualSection = 0;
  let withAnnualFact = 0;
  const cappedRisk: string[] = [];
  const richAnnual: string[] = [];
  /** Q-K is rare by design, so the census names every card it landed on rather than only counting. */
  const notFromTrading: string[] = [];

  for (const r of rows) {
    let block;
    try {
      block = await buildQuarterBriefFactBlock(r.stock.symbol);
    } catch {
      continue;
    }
    if (!block) continue;
    cards++;
    const period = block.identity.periodKey;

    for (const c of block.contrasts) {
      quarterRules.set(c.rule, (quarterRules.get(c.rule) ?? 0) + 1);
      if (c.rule === "profit_not_from_trading") {
        notFromTrading.push(`${r.stock.symbol.padEnd(12)} ${period}  ${block.identity.family.padEnd(14)} ${c.display}`);
      }
    }
    for (const c of block.annualContrasts) annualRules.set(c.rule, (annualRules.get(c.rule) ?? 0) + 1);
    const fam = block.identity.family;
    familyCards.set(fam, (familyCards.get(fam) ?? 0) + 1);
    if (block.annual) familyAnnual.set(fam, (familyAnnual.get(fam) ?? 0) + 1);
    if (block.identity.quarter === "Q4") q4++;
    if (block.annual) withAnnualSection++;
    if (block.annualContrasts.length > 0) withAnnualFact++;

    const story = buildStory(block);
    groupsPerCard.push(story.length);
    const facts = story.reduce((n, g) => n + g.facts.length, 0);
    factsPerCard.push(facts);
    for (const g of story) {
      (groupFacts.get(g.key) ?? groupFacts.set(g.key, []).get(g.key)!).push(g.facts.length);
    }
    if (story.length >= 5) cappedRisk.push(`${r.stock.symbol} ${period} (${story.length} groups, ${facts} facts)`);
    if (block.annualContrasts.length >= 2) {
      richAnnual.push(`${r.stock.symbol} ${period} — ${block.annualContrasts.map((c) => c.rule.replace("annual_", "")).join(", ")}`);
    }

    // Distinct metrics the CHAIN names — by label match over the grouped fact text, which is exactly
    // what a reader would count off the takeaway.
    const text = story.flatMap((g) => g.facts.map((f) => f.display)).join(" ").toLowerCase();
    const named = new Set<string>();
    for (const spec of manifestFor(block.identity.family)) {
      if (text.includes(metricGloss(spec.key).label.toLowerCase())) named.add(spec.key);
    }
    for (const k of named) metricShare.set(k, (metricShare.get(k) ?? 0) + 1);
    const namedAnnual = new Set<string>();
    for (const spec of annualManifestFor(block.identity.family)) {
      if (text.includes(annualMetricGloss(spec.key).label.toLowerCase())) namedAnnual.add(spec.key);
    }
    for (const k of namedAnnual) annualShare.set(k, (annualShare.get(k) ?? 0) + 1);
    // ★ THE LABEL-ONLY COUNT IS THE ONE COMPARABLE TO THE 4.74 BASELINE — same measure, same set.
    labelOnlyPerCard.push(named.size + namedAnnual.size);

    // ⚠ AND A LABEL MATCH ALONE UNDERCOUNTS THE NEW RULES, BY DESIGN OF THE RULES. A-8 deliberately
    // never prints "Times profit covers the interest bill" (a clause-shaped label that will not sit in
    // a sentence) and A-7 says "the company owed …" rather than naming the net-worth line. Both DO put
    // a figure in front of the reader, so the second count folds in each rule's own declaration of
    // what it names. Reported beside the first, never instead of it.
    for (const c of [...block.contrasts, ...block.annualContrasts]) {
      for (const k of RULE_NAMES[c.rule] ?? []) (k.startsWith("annual:") ? namedAnnual : named).add(k.replace(/^annual:/, ""));
    }
    distinctPerCard.push(named.size + namedAnnual.size);
  }

  const line = (s = "") => console.log(s);
  line("═".repeat(100));
  line(`CHAIN CENSUS over ${cards} cards (${q4} Q4 · ${withAnnualSection} carry an annual section)`);
  line("═".repeat(100));

  const eligibleCount = (ruleId: string, annual: boolean): number => {
    const f = ELIGIBLE[ruleId];
    const src = annual ? familyAnnual : familyCards;
    if (!f) return annual ? withAnnualSection : cards;
    let n = 0;
    for (const [fam, c] of src) if (f(fam)) n += c;
    return n;
  };
  line(`\n  cards by family: ${[...familyCards.entries()].map(([f, c]) => `${f} ${c}`).join(" · ")}`);
  line(`  annual cards by family: ${[...familyAnnual.entries()].map(([f, c]) => `${f} ${c}`).join(" · ")}`);

  line("\nQUARTER CONTRAST RULES");
  for (const [k, v] of [...quarterRules.entries()].sort((a, b) => b[1] - a[1])) {
    const el = eligibleCount(k, false);
    line(`  ${k.padEnd(30)} ${String(v).padStart(4)}  ${pct(v, cards)} of all 493  ·  ${pct(v, el)} of the ${el} eligible`);
  }

  line(`\nANNUAL CONTRAST RULES  (${withAnnualSection} cards carry an annual section)`);
  for (const [k, v] of [...annualRules.entries()].sort((a, b) => b[1] - a[1])) {
    const el = eligibleCount(k, true);
    line(`  ${k.padEnd(30)} ${String(v).padStart(4)}  ${pct(v, withAnnualSection)} of annual  ·  ${pct(v, el)} of the ${el} eligible`);
  }
  line(`  ${"(any annual rule fired)".padEnd(30)} ${String(withAnnualFact).padStart(4)}  ${pct(withAnnualFact, withAnnualSection)} of annual cards`);

  line("\nDISTINCT METRICS THE CHAIN NAMES");
  line(`  by LABEL MATCH (the measure the 4.74 baseline used)`);
  line(`    mean ${mean(labelOnlyPerCard).toFixed(2)}   histogram ${histogram(labelOnlyPerCard)}`);
  line(`  plus each rule's declared figures`);
  line(`    mean ${mean(distinctPerCard).toFixed(2)}   histogram ${histogram(distinctPerCard)}`);
  line("  by share of cards:");
  for (const [k, v] of [...metricShare.entries()].sort((a, b) => b[1] - a[1])) {
    line(`    ${k.padEnd(30)} ${pct(v, cards)}`);
  }
  if (annualShare.size > 0) {
    line("  annual metrics named (share of all cards):");
    for (const [k, v] of [...annualShare.entries()].sort((a, b) => b[1] - a[1])) {
      line(`    ${k.padEnd(30)} ${pct(v, cards)}   ${pct(v, withAnnualSection)} of annual cards`);
    }
  }

  line("\nGROUPS AND FACTS");
  line(`  non-empty groups per card  mean ${mean(groupsPerCard).toFixed(2)}   histogram ${histogram(groupsPerCard)}`);
  line(`  facts per card             mean ${mean(factsPerCard).toFixed(2)}   histogram ${histogram(factsPerCard)}`);
  for (const key of ["moved", "why", "reading", "score", "fullYear", "held"]) {
    const xs = groupFacts.get(key) ?? [];
    line(`    ${key.padEnd(10)} present on ${String(xs.length).padStart(4)} cards (${pct(xs.length, cards)})  mean ${mean(xs).toFixed(2)} facts  ${histogram(xs)}`);
  }
  line(`\n  cards reaching 5 or 6 groups: ${cappedRisk.length} (${pct(cappedRisk.length, cards)})`);
  for (const c of cappedRisk.slice(0, 25)) line(`    ${c}`);
  if (cappedRisk.length > 25) line(`    … and ${cappedRisk.length - 25} more`);

  line(`\nQ-K · EVERY CARD WHERE PROFIT DID NOT COME FROM TRADING (${notFromTrading.length})`);
  for (const c of notFromTrading) line(`  ${c}`);

  line(`\n  cards where TWO OR MORE annual rules fired: ${richAnnual.length}`);
  for (const c of richAnnual) line(`    ${c}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
