// EVERY WITHHELD FIGURE ON EVERY CARD, GROUPED BY ITS REASON — and whether that reason is a statement
// about the FILING or about the COMPANY. Read-only: no AI call, no write.
//
//   npx tsx src/scripts/brief-suppression-census.ts
//
// ── ★★ WHY THIS EXISTS (1d) ─────────────────────────────────────────────────────────────────────
// Q-K was written because a suppression was silent: a margin was withheld because profit dwarfed
// revenue, and NOTHING on the card said out loud that the profit had not come from selling anything.
// The suppression stated the reason; the reason was the most interesting fact on the card; and it was
// filed at the bottom under "what this reading does not cover".
//
// ⚠ THAT IS A CLASS, NOT ONE INSTANCE, AND THE CLASS HAS TO BE ENUMERATED RATHER THAN GUESSED AT. The
// test is a single question asked of each reason:
//
//     Does this sentence describe the FILING, or the COMPANY?
//
//   FILING   "the reported persistency figure is not a plausible share of policies" — SBILIFE's five
//            persistency ratios are stored a hundredfold too small. That is a fact about our data. A
//            reader is owed the disclosure and nothing more; there is no rule to write.
//   COMPANY  "profit this quarter was far larger than revenue" · "the company owes more than it owns".
//            These are facts about the business, and a fact about the business that appears ONLY as
//            the reason a figure is missing has been buried. Each one needs a named rule that states
//            it out loud, with the arithmetic, in the takeaway.
//
// ⚠ THE POPULATION IS ONE CARD PER STOCK, AT THE NEWEST QUARTER — the card a reader actually meets,
// and the same set the rule census uses. A reason can therefore appear under "declared but never
// fired" and still be live on an older card: SBILIFE withholds its five persistency ratios on FY26Q4
// and not on its newest quarter. "Never fired" here means "not on any current card", never "dead".
//
// The classification below is DECLARED, not inferred — a reason cannot be sorted by reading it — and
// the script's job is to prove the declaration is TOTAL: every reason the universe actually produces
// must appear in one of the two lists, or this exits non-zero. A new suppression reason added to a
// manifest without a decision about which kind it is will fail here rather than ship silently.

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { PROFIT_EXCEEDS_REVENUE_REASON, MARGIN_NOT_A_SHARE_REASON } from "../insight/quarter-brief/manifest.js";

/** Reasons that describe THE FILING. Disclosure is the whole obligation; no rule is owed. */
const ABOUT_THE_FILING = [
  "the reported bad-loan share is outside the range a loan book can take",
  "the reported uncovered bad-loan share is outside the range a loan book can take",
  "the reported cover is outside the range this ratio can meaningfully take",
  "the reported core-capital share is outside the range a capital ratio can take",
  "the reported return is outside the range this ratio can meaningfully take",
  "the reported return is outside the range this measure can meaningfully take",
  "the reported cost share is outside the range this ratio can meaningfully take",
  "the reported cost share is outside the range this ratio can take",
  "the reported solvency figure is outside the range this measure takes for a licensed insurer",
  "the reported persistency figure is not a plausible share of policies and has been withheld",
  "the reported share is outside the range this ratio can take",
  "the reported combined ratio is outside the range this measure can meaningfully take",
  "the reported claims share is outside the range this measure can meaningfully take",
  "the reported cost share is outside the range this measure can meaningfully take",
  "the reported retention share is outside the range this measure can take",
  "the borrowing is so large against the shareholders' money that the comparison stops describing anything",
  "the figure implies customers take more than a year to pay. That usually means the sales and the amounts owed are not describing the same business",
  "the number of shares changes when a company issues bonus shares or splits them. The accounts do not record when that happened. This year's per-share figure cannot be set against last year's",
];

/**
 * Reasons that describe THE COMPANY — the class Q-K was written for. Each must name the rule that
 * states the same fact out loud, and that rule must exist.
 */
const ABOUT_THE_COMPANY: { reason: string; statedBy: string }[] = [
  { reason: PROFIT_EXCEEDS_REVENUE_REASON, statedBy: "Q-K · profit_not_from_trading (contrasts.ts)" },
  // The deferring form. It only ever appears BECAUSE Q-K fired, so it is already spoken for.
  { reason: MARGIN_NOT_A_SHARE_REASON, statedBy: "Q-K · profit_not_from_trading (contrasts.ts)" },
  {
    reason: "the company owes more than it owns, so there is no shareholders' money left to measure a return against",
    statedBy: "A-7 · annual_negative_net_worth (annual-contrasts.ts)",
  },
  {
    reason: "the company owes more than it owns, so there is no shareholders' money left to measure borrowings against",
    statedBy: "A-7 · annual_negative_net_worth (annual-contrasts.ts)",
  },
  // ★ THE THIRD MEMBER, AND THE CENSUS FOUND IT — I HAD NOT. "The company's interest bill is too
  // small for the number of times profit covers it to describe anything" is unmistakably about the
  // COMPANY: it means this business has essentially no borrowings, which is the good half of A-8 and
  // is worth knowing. It needs no rule because the fact is ALREADY on the card in the plainest words
  // available — the annual section's own "Total borrowings" line reads `nil` on all six. That claim
  // is asserted below rather than trusted, because it is the whole reason no rule was written.
  {
    reason: "the company's interest bill is too small for the number of times profit covers it to describe anything",
    statedBy: "the annual section's own Total borrowings line — asserted below, not assumed",
  },
];

/** The reason whose no-rule justification rests on another line being present and readable. */
const RESTS_ON_TOTAL_DEBT =
  "the company's interest bill is too small for the number of times profit covers it to describe anything";

async function main(): Promise<void> {
  const stocks = await prisma.stock.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } });

  interface Row { count: number; labels: Set<string>; cards: string[] }
  const byReason = new Map<string, Row>();
  const add = (reason: string, label: string, card: string) => {
    const r = byReason.get(reason) ?? byReason.set(reason, { count: 0, labels: new Set(), cards: [] }).get(reason)!;
    r.count++;
    r.labels.add(label);
    // One entry per CARD, not per withheld figure — ABREL withholds four and is one card.
    if (r.cards.length < 6 && !r.cards.includes(card)) r.cards.push(card);
  };

  let cards = 0;
  /** Evidence for RESTS_ON_TOTAL_DEBT: the borrowings line as the reader meets it, per card. */
  const debtEvidence: string[] = [];
  let debtLineMissing = 0;

  for (const s of stocks) {
    let block;
    try { block = await buildQuarterBriefFactBlock(s.symbol); } catch { continue; }
    if (!block) continue;
    cards++;
    const card = `${s.symbol} ${block.identity.periodKey}`;
    for (const sup of block.quarter.suppressed) add(sup.reason, sup.label, card);
    for (const sup of block.margins?.suppressed ?? []) add(sup.reason, sup.label, card);
    for (const sup of block.annual?.suppressed ?? []) add(sup.reason, sup.label, card);
    for (const nc of block.annual?.notCompared ?? []) add(nc.reason, nc.label, card);

    if ((block.annual?.suppressed ?? []).some((sup) => sup.reason === RESTS_ON_TOTAL_DEBT)) {
      const debt = block.annual?.lines.find((l) => l.label === "Total borrowings");
      if (!debt) debtLineMissing++;
      else debtEvidence.push(`${card.padEnd(20)} Total borrowings: ${debt.display}`);
    }
  }

  const filing = new Set(ABOUT_THE_FILING);
  const company = new Map(ABOUT_THE_COMPANY.map((c) => [c.reason, c.statedBy]));
  let unclassified = 0;

  const line = (t = "") => console.log(t);
  line("═".repeat(120));
  line(`SUPPRESSION CENSUS over ${cards} rebuilt fact blocks — ${byReason.size} distinct reasons`);
  line("═".repeat(120));

  const sorted = [...byReason.entries()].sort((a, b) => b[1].count - a[1].count);

  line("\n── ABOUT THE COMPANY · the reason IS the fact, and a named rule must say it out loud ──");
  for (const [reason, r] of sorted) {
    if (!company.has(reason)) continue;
    line(`\n  ${r.count} withheld figures on ${r.cards.length >= 6 ? "6+" : r.cards.length} cards — ${[...r.labels].join(", ")}`);
    line(`    "${reason}"`);
    line(`    ✅ stated out loud by ${company.get(reason)}`);
    line(`    cards: ${r.cards.join(" · ")}`);
  }

  // ── THE ONE no-rule JUSTIFICATION THAT RESTS ON ANOTHER LINE, ASSERTED ────────────────────────
  if (byReason.has(RESTS_ON_TOTAL_DEBT)) {
    line("\n  ── evidence for the interest-cover reason: the fact is already on the card ──");
    for (const e of debtEvidence) line(`     ${e}`);
    if (debtLineMissing > 0) {
      unclassified++;
      line(`     ❌ ${debtLineMissing} card(s) withheld the interest-cover figure AND carry no borrowings line.`);
      line(`        The reason is then the ONLY place the fact appears, which is the Q-K class. Write the rule.`);
    } else {
      line(`     ✅ every card that withholds it states its borrowings outright — no rule owed`);
    }
  }

  line("\n── ABOUT THE FILING · disclosure is the whole obligation ──");
  for (const [reason, r] of sorted) {
    if (!filing.has(reason)) continue;
    line(`  ${String(r.count).padStart(4)}  ${[...r.labels].join(", ").slice(0, 58).padEnd(58)}  "${reason.slice(0, 70)}…"`);
  }

  line("\n── UNCLASSIFIED ──");
  for (const [reason, r] of sorted) {
    if (filing.has(reason) || company.has(reason)) continue;
    unclassified++;
    line(`  ❌ ${r.count} withheld — "${reason}"`);
    line(`     labels: ${[...r.labels].join(", ")}`);
    line(`     cards:  ${r.cards.join(" · ")}`);
    line(`     Decide: does this describe the FILING (disclose and stop) or the COMPANY (write the rule)?`);
  }
  if (unclassified === 0) line("  ✅ none — every reason the universe produces has been classified");

  // ── AND THE OTHER DIRECTION: a declared reason the universe never produces is a dead entry ──
  const declared = [...filing, ...company.keys()];
  const dead = declared.filter((d) => !byReason.has(d));
  line(`\n── DECLARED BUT NEVER FIRED (${dead.length}) ──`);
  line("  ⚠ NOT A FAILURE. A bounds reason that never fires is a bound nothing has broken yet, which is");
  line("  the outcome those bounds exist for. Listed so the classification stays honest about coverage.");
  for (const d of dead) line(`     · "${d.slice(0, 100)}"`);

  await prisma.$disconnect();
  if (unclassified > 0) process.exit(1);
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
