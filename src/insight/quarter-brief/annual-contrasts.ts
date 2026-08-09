// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NAMED ANNUAL CONTRAST RULES — the full year's contribution to the takeaway, as computed facts.
// PURE: no database, no I/O, no prisma.
//
// ── ★ WHY THIS IS A SECOND FILE AND NOT SEVEN MORE RULES IN contrasts.ts ─────────────────────────
// THE RULE THIS FILE EXISTS TO ENFORCE:
//
//     ⚠⚠ NO ARITHMETIC MAY JOIN AN ANNUAL FIGURE TO A QUARTERLY ONE.
//
// "Free cash flow was 3.5 times the quarter's profit" is the exact shape someone reaches for when one
// card carries both, and it is a fabricated ratio: the numerator covers twelve months and the
// denominator three. Nothing about it looks wrong on the page. It divides correctly, both figures are
// filed, and the sentence reads perfectly — which is precisely why an instruction not to write it is
// not enough.
//
// So the rule is STRUCTURAL, not advisory. This module cannot see a quarterly figure:
//   · `computeAnnualContrasts` takes `AnyFamilyAnnual` and nothing else. There is no parameter through
//     which a quarter could arrive.
//   · It does not import `manifest.ts`, `quarter-section.ts`, `driver.ts` or `contrasts.ts` — so
//     `valueOf`, the one function that reads a quarterly metric, is not in scope in this file.
//   · verify-quarter-brief-anchors.ts §7 asserts BOTH halves against the source: this file's import
//     list stays free of the quarterly modules, and contrasts.ts's stays free of the annual ones.
//     Neither file can reach the other's numbers, so no rule in either can span the two periods.
//
// The same separation answers a second question the same way. A rule here cannot declare itself into
// group 2 or group 3 — `AnnualContrastFact` carries no `group` field at all, because every fact this
// module produces belongs to the full-year group by construction. story.ts's groups 1–4 are a causal
// chain about a three-month period, and an annual fact is as-of a different question; it cannot join
// them, and now it cannot be made to.
//
// ── ⚠ AND NO SHARE-OF-MOVE, EVER ────────────────────────────────────────────────────────────────
// annual-manifest.ts's point 3 measured it: `PBT = revenue + other income − expenses` closes within 1%
// on 56.1% of non-financial annual rows and `net profit = PBT − tax` on 65.3%. The quarter's driver
// bullet exists because the QUARTERLY lines do close; these do not, so there is no annual driver and no
// annual attribution. Every rule below states LEVELS and YEAR-ON-YEAR MOVES and nothing else.
//
// ── THE FLOORS ARE WHAT KEEP THESE FROM BECOMING BOILERPLATE ────────────────────────────────────
// Measured over 1,140 (year, prior-year) pairs on file, and three candidates were dropped on the
// measurement rather than on taste:
//   · "borrowings moved"        66.2% at ±15%, and still 22.0% at ±60%. Boilerplate at every cut. A
//                               debt figure that moved is what a debt figure does. DROPPED.
//   · "dividends exceeded free  35.0%. Too common to be news at the cut that makes it computable, and
//     cash flow"                the second sweep that would settle it has not been run. HELD.
//   · lenders' net interest     50.9% at 0.3pp, 15.8% at 1.2pp — but n=57, and the cut that clears the
//     margin moved              floor is the one the sample is thinnest at. HELD.
// A rule that fires on eight cards in ten trains the reader to skip the one that matters.
//
// ── ★ AND ONE RULE DELIBERATELY BREAKS THE FLOOR ────────────────────────────────────────────────
// A-7 fires on 0.6% of rows — three cards. The floor is a BOILERPLATE test, and negative net worth is
// not a boilerplate risk: it is the most important sentence on every card it fires on. Same reasoning
// as the guardrail signatures, which ship on four events in the entire universe.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { AnnualMetricKey } from "../../catalogue/annual-metrics.js";
import { marginPct, money, pointMove } from "./format.js";
import {
  annualManifestFor,
  annualValueOf,
  toAnnualDisplayValue,
  withinAnnualBounds,
  type AnyFamilyAnnual,
} from "./annual-manifest.js";

/**
 * One annual contrast that fired. `display` is the whole sentence — the model reproduces, never
 * recomputes.
 *
 * ⚠ NO `group` FIELD, DELIBERATELY. See the header: a fact computed from twelve-month figures belongs
 * to the full-year group by construction, and a field would be a way to put it somewhere else.
 */
export interface AnnualContrastFact {
  /** Stable rule id, so a fired annual contrast is greppable in the corpus. */
  rule: string;
  display: string;
}

// ── Floors, each measured. See the header for the three candidates these numbers rejected. ─────────
/** A ₹ line must move this much for "rose" or "fell" to be worth a sentence. The shared money floor. */
const MONEY_FLOOR_PCT = 10;
/** Return on shareholders' money. 48.8% of pairs clear 3pp and 31.0% clear 5pp; 8pp fires on 18.9%. */
const ROE_FLOOR_PP = 8;
/** Days customers take to pay. 19.7% of pairs lengthen by ten days or more. */
const RECEIVABLE_DAYS_FLOOR = 10;
/** Times profit covers the interest bill. Below three, on 18.6% of rows. */
const INTEREST_COVER_FLOOR = 3;
/** A lender's cost of loans going bad. 21.1% of pairs rise by a quarter point or more. */
const CREDIT_COST_FLOOR_PP = 0.25;

/**
 * ★ THE ONE READ, AND IT MIRRORS annual-section.ts's `buildAnnualLine` EXACTLY — GUARD FIRST, THEN
 * BOUNDS, THEN THE SCALE CONVERSION.
 *
 * ⚠ THE ORDER IS THE SAME BECAUSE THE ANSWER MUST BE. A contrast built on a figure the section
 * WITHHELD would print a number the card does not show, and the reader would have nothing to check it
 * against. IDEA's return on shareholders' money is the case: it is a plausible positive percentage
 * computed by dividing a loss by a negative net worth, the section suppresses it on the cross-field
 * guard, and a rule here that read the raw value would resurrect it in the takeaway.
 *
 * Returns the DISPLAY-unit value (fractions already multiplied), or null when the figure is absent,
 * guarded or out of bounds — the same three ways a line fails to render.
 */
function readable(row: AnyFamilyAnnual, key: AnnualMetricKey): number | null {
  const spec = annualManifestFor(row.family).find((s) => s.key === key);
  if (!spec) return null; // ← this family does not report it
  const raw = annualValueOf(row, key);
  if (raw === null) return null;
  if (spec.guard?.suppress((k) => annualValueOf(row, k))) return null;
  if (!withinAnnualBounds(spec, raw)) return null;
  return toAnnualDisplayValue(spec, raw);
}

/** Percentage move between two ₹ figures, or null when a percentage would not describe it. Same rule
 *  as change.ts's: never off a zero or negative base. */
function pctMove(current: number | null, prior: number | null): number | null {
  if (current === null || prior === null || prior <= 0 || current <= 0) return null;
  return ((current - prior) / prior) * 100;
}

// ═══ THE RULES ═════════════════════════════════════════════════════════════════════════════════════

/**
 * Every annual contrast that fired for this full year, in priority order.
 *
 * ⚠ THE PARAMETER LIST IS THE ENFORCEMENT. Two annual rows and nothing else — see the header.
 */
export function computeAnnualContrasts(
  current: AnyFamilyAnnual,
  prior: AnyFamilyAnnual | null,
): AnnualContrastFact[] {
  const out: AnnualContrastFact[] = [];
  const v = (k: AnnualMetricKey) => readable(current, k);
  const p = (k: AnnualMetricKey) => (prior ? readable(prior, k) : null);
  const push = (rule: string, display: string) => out.push({ rule, display });

  // ── A-7 · THE COMPANY OWES MORE THAN IT OWNS ─────────────────────────────────────────────────
  // ★ FIRST, AND IT FIRES ON 0.6% OF ROWS. When shareholders' money is below zero, nothing else on the
  // card is the most important thing on it. Deliberately reads `annualValueOf` rather than `readable`:
  // net worth is unbounded and unguarded on purpose (annual-manifest.ts's note — "a lower bound of zero
  // would look like tidiness and would suppress the single most important fact on those cards"), and it
  // is the figure the guard on every OTHER metric is reading.
  const netWorth = annualValueOf(current, "netWorth");
  if (netWorth !== null && netWorth < 0) {
    const priorNetWorth = prior ? annualValueOf(prior, "netWorth") : null;
    const thenClause =
      priorNetWorth === null
        ? ""
        : priorNetWorth < 0
          ? ` The shortfall a year earlier was ${money(priorNetWorth)}.`
          : ` A year earlier there was ${money(priorNetWorth)} of shareholders' money in it.`;
    // ── ★★ 2a · THE SENTENCE THIS WHOLE ITEM WAS RAISED ON ──────────────────────────────────────
    //
    //   WAS: "At the full year-end the company owed ₹35,758 crore more than everything it owns is
    //         worth in its books, so there is no shareholders' money left in the business."
    //
    // It passes every count the register check had: 26 words, active, subject in the first four,
    // clause load 2. And it is the most important sentence any of these cards can carry, handed to a
    // reader who has never read a statement as a fronted adverbial, a comparison compressed into a
    // noun phrase ("owed X more than everything it owns is worth"), and a consequence behind a "so".
    // BREVITY WAS OPTIMISED FOR AND COMPREHENSION WAS WHAT IT COST.
    //
    // Four sentences now, one idea each, and the CONSEQUENCE LEADS — because that is the fact, and
    // the arithmetic behind it is the explanation, not the headline. ⚠ The figure still appears here
    // and also on the net-worth row's own plain line in annual-section.ts. That repetition is the
    // card's design (the metric section states, the takeaway narrates — revenue does the same), not
    // the within-the-takeaway duplication story.ts's margin dedupe exists to stop.
    // ⚠⚠ 2b · AND EVERY SENTENCE THAT LEADS AN ANNUAL RULE MUST CARRY ITS OWN CLOCK. This was the ONE
    // rule of the seven whose first sentence named no period — A-3 to A-9 all say "over the full
    // year" or "for the full year" in their opening line. A bullet is free prose: the model may lift
    // the leading sentence and set it beside a three-month figure, and "there is no shareholders'
    // money left in this business" beside "net profit was ₹51,970 crore this quarter" is a subject
    // change with nothing marking it. The group heading cannot help — the reader never sees it.
    push(
      "annual_negative_net_worth",
      `The company had no shareholders' money left at the end of the full year. ` +
        `Everything it owns is worth less, in its own books, than everything it owes. ` +
        `The gap was ${money(netWorth)}.${thenClause}`,
    );
  }

  // ── A-4 · IT BORROWED MORE WHILE ITS CASH FELL ───────────────────────────────────────────────
  // ⚠ NON-FINANCIAL ONLY, AND NOT FOR TIDINESS. A lender's liabilities growing while its cash falls is
  // what lending IS — it borrowed and lent the money out — so the same arithmetic means the opposite
  // thing on a bank or an NBFC. `readable` would return nulls on those families anyway (neither
  // declares `totalDebt`), and the family check states the reason rather than relying on that.
  if (current.family === "non_financial") {
    const debt = v("totalDebt");
    const cash = v("cashAndCashEquivalents");
    const debtMove = pctMove(debt, p("totalDebt"));
    const cashMove = pctMove(cash, p("cashAndCashEquivalents"));
    if (
      debt !== null && cash !== null && debtMove !== null && cashMove !== null &&
      debtMove >= MONEY_FLOOR_PCT && cashMove <= -MONEY_FLOOR_PCT
    ) {
      // ⚠ WAS FRONT-LOADED, AND THE REGISTER CHECK FOUND IT — not in the model's prose, in OURS.
      // "Over the full year total borrowings rose 12% … while the cash in the bank fell 33% …" opens
      // on an adverbial and carries two facts in one 24-word sentence. It was the ONLY front-loaded
      // sentence in 66 across the stored corpus, and it is a backend string the model reproduced
      // faithfully. Subject first, one fact each.
      push(
        "annual_borrowed_more_cash_fell",
        `Total borrowings rose ${Math.round(debtMove)}% over the full year, to ${money(debt)}. ` +
          `The cash in the bank fell ${Math.round(Math.abs(cashMove))}%, to ${money(cash)}. ` +
          `The company owed more at the year-end and held less.`,
      );
    }
  }

  // ── A-6 · THE BUSINESS GENERATED CASH AND STILL HAD NONE LEFT ────────────────────────────────
  // ⚠ THE THREE FIGURES ARE FILED, AND THE IDENTITY BETWEEN THEM IS MEASURED, NOT ASSUMED:
  // annual-manifest.ts records `fcf = cash_from_operating − capex` EXACTLY on 734/734 rows. That is why
  // all three may be stated in one sentence — it is a filed identity the reader can check on the
  // statement, not a decomposition this file performed. No share is given, and none could be.
  if (current.family === "non_financial") {
    const operating = v("cashFromOperating");
    const fcf = v("freeCashFlow");
    if (operating !== null && fcf !== null && operating > 0 && fcf < 0) {
      const capex = v("capitalExpenditure");
      // ── 2a · THE MOST STACKED ANNUAL SENTENCE — 20 of 180, and up to SIX clause breaks in one:
      // "The business itself generated ₹240 crore of cash over the full year, but after ₹1,295 crore
      // spent on equipment and buildings, it ended the year ₹1,055 crore short — free cash flow was
      // below zero." Three filed figures and a definition, welded with a "but", a fronted "after"
      // clause and an em dash. It is a sequence of events and it now reads as one.
      const spent =
        capex !== null && capex > 0 ? ` It then spent ${money(capex)} on equipment and buildings.` : "";
      push(
        "annual_free_cash_flow_negative",
        `The business itself generated ${money(operating)} of cash over the full year.${spent} ` +
          `That left it ${money(fcf)} short for the year. Free cash flow was below zero.`,
      );
    }
  }

  // ── A-5 · CUSTOMERS TOOK LONGER TO PAY ───────────────────────────────────────────────────────
  // Non-financial only by construction: `receivablesDays` is the one metric in either manifest on a
  // days scale and no other family declares it.
  const days = v("receivablesDays");
  const daysPrior = p("receivablesDays");
  if (days !== null && daysPrior !== null && days - daysPrior >= RECEIVABLE_DAYS_FLOOR) {
    const delta = Math.round(days - daysPrior);
    // 2a · the closing sentence was a passive with the company as the object of its own sentence
    // ("money the company has earned and not yet been paid"). Same fact, company as the subject.
    push(
      "annual_receivables_lengthened",
      `Customers took ${Math.round(days)} days on average to pay over the full year. ` +
        `That is ${delta} ${delta === 1 ? "day" : "days"} longer than the year before. ` +
        `The company has earned that money and does not yet have it.`,
    );
  }

  // ── A-8 · THE INTEREST BILL IS A LARGE SHARE OF THE PROFIT ───────────────────────────────────
  // ⚠ THE SENTENCE IS format.ts's `interestCoveragePlain` REBUILT, NOT REUSED. That function renders
  // the line's own companion text, three inches above this on the same card; emitting it verbatim would
  // print one sentence twice. The three branches are the same three, in the takeaway's voice, and the
  // negative case is the one that matters most — below zero the year's trading profit did not cover the
  // bill at all, which is a STATE and not a quantity.
  const cover = v("interestCoverage");
  if (cover !== null && cover < INTEREST_COVER_FLOOR) {
    const coverPrior = p("interestCoverage");
    // ⚠ 2b · THE PRIOR-YEAR CLAUSE CARRIED TWO "IT"s WITH DIFFERENT REFERENTS — "A year earlier it
    // would have covered it 2.61 times over": the first is the profit, the second is the bill. Both
    // nouns are named now, and the sentence leads with its subject rather than with the year.
    const thenClause =
      coverPrior === null || Math.abs(coverPrior - cover) < 0.005
        ? ""
        : coverPrior < 0
          ? " The trading profit did not cover the bill at all in the year before."
          : ` The trading profit would have covered the bill ${coverPrior.toFixed(2)} times over in the year before.`;
    push(
      "annual_interest_cover_thin",
      cover < 0
        ? `The company made a trading loss over the full year. Its profit did not cover its interest ` +
          `bill at all.${thenClause}`
        : cover < 1
          ? `The full year's trading profit did not cover the company's interest bill in full. ` +
            `It came to ${cover.toFixed(2)} times the bill.${thenClause}`
          : `The full year's trading profit would have covered the company's interest bill ` +
            `${cover.toFixed(2)} times over.${thenClause}`,
    );
  }

  // ── A-3 · WHAT THE OWNERS' MONEY EARNED, AND HOW FAR THAT MOVED ──────────────────────────────
  // ⚠ THE SCALE SEAM IS LIVE ON THIS METRIC AND `readable` IS WHERE IT IS CLOSED. `fundamentals.roe` is
  // a PERCENT and all four financial tables store `roe` as a FRACTION — the one declared divergence in
  // ANNUAL_MANIFEST's SCALE_SEAMS. Comparing the two raw numbers would put a bank's 13.24 against a
  // non-financial's 14.83 as if they were the same unit; both sides go through `toAnnualDisplayValue`
  // first, so the floor below is in percentage points on every family.
  const roe = v("returnOnEquity");
  const roePrior = p("returnOnEquity");
  if (roe !== null && roePrior !== null && Math.abs(roe - roePrior) >= ROE_FLOOR_PP) {
    const delta = roe - roePrior;
    // ⚠ WAS 32 WORDS WITH AN EM-DASH TAIL. The plain-words half is a second idea and gets its own
    // sentence — which also stops the dash from swallowing it.
    push(
      "annual_return_on_equity_moved",
      `Return on shareholders' money was ${marginPct(roe)} for the full year. ` +
        `That is ${delta > 0 ? "up" : "down"} ${pointMove(delta)} on the year before. ` +
        `The company earned ₹${roe.toFixed(2)} over the year for every ₹100 the owners have in the business.`,
    );
  }

  // ── A-9 · A LENDER'S COST OF LOANS GOING BAD ROSE ────────────────────────────────────────────
  // ⚠ A RISE ONLY, AND THE DIRECTION IS DECLARED DATA RATHER THAN THIS FILE'S OPINION. The annual
  // manifest marks `creditCost` `lowerIsBetter: true` on both lending families; a fall is the ordinary
  // direction and is already on the card's own line. The same asymmetry as C-3 and C-4 on the quarterly
  // side, resting on the same kind of declaration.
  if (current.family === "banking" || current.family === "nbfc") {
    const credit = v("creditCost");
    const creditPrior = p("creditCost");
    if (credit !== null && creditPrior !== null && credit - creditPrior >= CREDIT_COST_FLOOR_PP) {
      push(
        "annual_credit_cost_rose",
        `The cost of loans going bad was ${marginPct(credit)} of the lending book for the full year. ` +
          `That is up ${pointMove(credit - creditPrior)} on the year before. ` +
          `The company wrote down that share of what it had lent over the year.`,
      );
    }
  }

  return out;
}
