// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NAMED CONTRAST RULES — the "hidden insight" bullet, as computed facts.
//
// ── ★ WHY THIS IS A RULE LIST AND NOT AN `insight` FIELD ─────────────────────────────────────────
// "Core operating performance remained stable" is an INTERPRETIVE claim, and it is exactly what a model
// produces most fluently when nothing in the data supports it. A free-form field asks for that. A rule
// list does not: a named rule either fired or it did not, and no rule means no bullet.
//
// Three of these already shipped and are the shape every new one copies:
//   · disagreements            — QoQ and YoY pointing opposite ways     (fact-block.ts)
//   · headlineHealthDivergence — profit up while the health score fell  (fact-block.ts)
//   · margins.suppressed       — a ratio withheld, with its reason      (margins.ts / quarter-section.ts)
// Each is a threshold, a computation, and a pre-rendered sentence. Nothing here is different.
//
// ── ⚠ THE FLOORS ARE WHAT KEEP THESE FROM BECOMING BOILERPLATE ───────────────────────────────────
// The margin round-trip note fired on 437 of 477 stocks and was cut for it. A contrast on nine cards in
// ten trains the reader to skip the one that matters, so every rule below carries a materiality floor
// on BOTH sides — a contradiction between two things that barely moved is not a contradiction.
//
// ── WHAT THE OLD THREE-METRIC BLOCK COULD NOT SEE ────────────────────────────────────────────────
// The rules below exist because the manifest made their inputs available for the first time. A block
// carrying only revenue, profit and margin could not have asked whether provisions moved against the
// bad-loan book, or whether an insurer's underwriting worsened while its investment income covered it.
//
// ── ★ THE SECOND SET (Q-A · Q-B · Q-E · Q-F · Q-G) AND WHAT BOUGHT THEM ─────────────────────────
// MEASURED FIRST, WRITTEN SECOND. The takeaway named a mean of 4.74 distinct metrics across 493 cards
// and four of them accounted for almost all of it — net profit 100.0%, net margin 98.8%, the top line
// 93.1%, operating margin 84.0%, and NOTHING ELSE ABOVE 13.0%. That is not the model choosing; the
// chain's unconditional content was the top line, net profit and the margin series, and everything else
// was gated behind a rule that did not exist yet.
//
// Every candidate was measured over every year-on-year pair on file BEFORE it was written, and four
// were dropped on the measurement rather than on taste:
//   · cover thinned while the book worsened     0 of 51.  DEAD.
//   · insurers' solvency fell                   0 of 8.   DEAD.
//   · core capital fell                         80.4% at 0.33pp and still 47.1% at a full point.
//                                               Boilerplate at every cut — and the metric's LEVEL is
//                                               already anchored on the card, which is the half a
//                                               reader can use. DROPPED.
//   · general insurers' combined ratio above     n = 4 issuers. Not calibratable, and a floor fitted on
//     100 and rising                             four rows is a guess wearing a threshold. NOT WRITTEN.
//
// ── ⚠ AND WHAT THIS FILE MAY NOT REACH: THE FULL YEAR ───────────────────────────────────────────
// The seven ANNUAL rules live in annual-contrasts.ts and are deliberately not here. That file's header
// carries the reason in full; the half that binds THIS file is that it imports nothing from
// annual-manifest.ts, so no rule below can join a twelve-month figure to a three-month one. The
// separation is asserted from the source by verify-quarter-brief-anchors.ts §7, in both directions.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { specFor, toDisplayValue, valueOf, TOP_LINE_KEY, type AnyFamilyQuarter } from "./manifest.js";
import { marginPct, money, moneyLoss } from "./format.js";
import { UNEXPLAINED_BRIDGES, unexplainedAmount } from "./driver.js";
import { metricGloss, type MetricKey } from "../../catalogue/quarter-metrics.js";

/** One contrast that fired. `display` is the whole sentence — the model reproduces, never recomputes. */
export interface ContrastFact {
  /** Stable rule id, so a fired contrast is greppable in the corpus. */
  rule: string;
  /**
   * ★ STAGE 3 — WHICH LINK OF THE CHAIN THIS IS, DECLARED AT THE RULE (3b).
   *
   * story.ts orders the fact block into "what moved → why → what that did to the reading → what it did
   * not change", and a contrast belongs to exactly one of those. The classification lives HERE, beside
   * the rule that fires, rather than as a list of rule ids in story.ts: a list would silently drop
   * every rule added after it was written into whichever bucket the default happened to be, and a
   * mis-grouped contrast is a fact narrated as a cause.
   *
   *   why      — it says WHY the profit moved. A mechanism.
   *   reading  — it says the figures do not agree, so the quarter reads two ways. A tension.
   */
  group: "why" | "reading";
  display: string;
  /** ★ A POINT THE BRIEF IS NOT ALLOWED TO LEAVE OUT. Flows through story.ts to the MUST SAY line the
   *  prompt already understands — the same mechanism the disagreements and the divergence use. */
  mustSay?: boolean;
  /**
   * ★★ THE ONE FIGURE THAT MUST SURVIVE INTO THE BULLETS, as the exact rendered string.
   *
   * ⚠⚠ FOUND ON THE FIRST RE-RENDER OF IDEA, AND IT IS THE WHOLE FEATURE FAILING QUIETLY. Handed five
   * sentences and three reconciling figures, the model wrote:
   *
   *     "A large part of the reported profit came from something outside the regular income and cost
   *      lines, and the quarterly figures do not say what it was."
   *
   * Every word true, every number gone. "A large part" is the vague quantifier this rule exists to
   * replace: a reader still cannot see that ₹57,491 crore of a ₹51,970 crore profit is the answer to
   * the question the card put in front of them. MUST SAY alone does not stop it, because the model is
   * obeying MUST SAY — it made the point.
   *
   * So the requirement is DATA, checked after generation (generate.ts, beside the echo check) and
   * retried like any other guard failure. Optional by design: most contrasts survive fine as prose,
   * and demanding a figure from all of them would refuse cards over a rounding.
   */
  requiredFigure?: string;
}

// ── Floors ─────────────────────────────────────────────────────────────────────────────────────────
/** A money line must move this much, on both sides of a contrast, to be worth contrasting.
 *  Same 3% the verdict uses for materiality — one idea of "moved", one number. */
const MONEY_FLOOR_PCT = 3;
/** A ratio must move this many points. Deliberately double the widest steady band in the manifest
 *  (operating margin, 1.4pp) so a contrast is never built out of two "steady" readings. */
const RATIO_FLOOR_PP = 3;
/** Q-E · how far costs must outgrow the top line. MEASURED across every year-on-year pair on file:
 *  5pp fires on 33.6%, 8pp on 20.7%, 10pp on 15.7%. Costs drifting a few points ahead of sales is
 *  ordinary; ten points is the cut where the sentence stops being true of a card in three. */
const COST_GAP_FLOOR_PP = 10;
/** Q-F · how far the effective tax rate must move. MEASURED: 3pp fires on 45.1%, 5pp on 32.0%, 7pp on
 *  24.3%, 10pp on 17.6%. The rate wanders every quarter, so only a wide move is a fact. */
const TAX_RATE_FLOOR_PP = 10;

// ── Q-K's two floors ───────────────────────────────────────────────────────────────────────────────
/** How much of the reported profit must be unaccounted for before the sentence means anything. A tenth
 *  of a profit arriving from outside the trading lines is a footnote; a quarter of it is the quarter. */
const UNEXPLAINED_PROFIT_FLOOR_PCT = 25;
/** And how large it must be in the COMPANY'S OWN SCALE, against the family's top line. Both sides, the
 *  same discipline every rule above carries: a share of a tiny profit is not a fact.
 *
 *  ★ MEASURED over 5,342 quarterly rows with every bridge term reported (brief-unexplained-profit-probe):
 *
 *      profit ≥ 10%  top line ≥  5%    6.6% of rows    4.3% of the 485 newest cards
 *      profit ≥ 25%  top line ≥  5%    5.8%            3.5%
 *      profit ≥ 25%  top line ≥ 10%    3.1%            2.1%   ← here
 *      profit ≥ 25%  top line ≥ 25%    1.5%            1.2%
 *      profit ≥ 50%  top line ≥ 25%    1.5%            1.2%
 *
 *  The distribution is the argument for the cut rather than the rate: non-financial's residual is 0.2%
 *  of the top line at the median and 5.2% at p90, so ten percent is already past the ninetieth
 *  percentile of ordinary rows. Below it the rule would be describing rounding and reclassification. */
const UNEXPLAINED_BASE_FLOOR_PCT = 10;

const pctMove = (cur: number | null, pri: number | null): number | null =>
  cur === null || pri === null || pri <= 0 || cur <= 0 ? null : ((cur - pri) / pri) * 100;

/** Display-unit point movement of a ratio, or null when either side is missing. */
function ppMove(q: AnyFamilyQuarter, p: AnyFamilyQuarter, key: MetricKey): number | null {
  const spec = specFor(q.family, key);
  const c = valueOf(q, key);
  const pr = valueOf(p, key);
  if (!spec || c === null || pr === null) return null;
  return toDisplayValue(spec, c) - toDisplayValue(spec, pr);
}

const opposed = (a: number, b: number) => Math.sign(a) !== Math.sign(b);

/**
 * `reference` AS A NOUN — "the same quarter last year", not "against the same quarter last year".
 *
 * ⚠⚠ DERIVED, NEVER A SECOND LITERAL, AND TWO RULES HERE WERE ALREADY BROKEN FOR WANT OF IT. C-3
 * printed "a wider loss than against the same quarter last year" and Q-F printed "against 68.3%
 * against the same quarter last year" — both on every card they fired on, 51 and 4 cards. The
 * preposition is baked into QOQ_REF and YOY_REF because most call sites want it; a call site that
 * needs the noun must strip it rather than write it out again. annual-section.ts's PRIOR_PERIOD
 * records the identical lesson from change.ts, which is where this pattern comes from.
 */
const refNoun = (reference: string): string => reference.replace(/^against /, "");

// ═══ THE RULES ═════════════════════════════════════════════════════════════════════════════════════

/**
 * Every contrast that fired for this quarter, in priority order.
 *
 * `reference` is the comparison phrase already chosen by the caller, so a contrast can never describe a
 * different period than the figures beside it.
 */
export function computeContrasts(
  current: AnyFamilyQuarter,
  comparison: AnyFamilyQuarter | null,
  reference: string,
): ContrastFact[] {
  const out: ContrastFact[] = [];

  // ── Q-K · PROFIT THAT DID NOT COME FROM TRADING ──────────────────────────────────────────────
  // ★ FIRST, AND IT NEEDS NO COMPARISON — WHICH IS WHY IT SITS ABOVE THE EARLY RETURN. Every other
  // rule in this file contrasts two periods. This one contrasts two figures INSIDE one period: what
  // the company reported as profit, and what its own filed lines add up to.
  //
  // ⚠⚠ THE DIAGNOSIS. IDEA FY26Q4 files ₹11,332 crore of revenue and ₹51,970 crore of net profit. A
  // reader meets those and asks HOW, and the card's answer was: a margin silently withheld, a gaps
  // line saying no line could be named, and a full-year sentence about net worth — a different subject
  // entirely. The amount was computed on every single render (driver.ts's `bridgeResidual`) and used
  // only to REFUSE. Suppression is silent, and silence here reads as "nothing to see".
  //
  // ⚠ IT CLAIMS NO CAUSE, AND IT STRUCTURALLY CANNOT. A one-off gain, a legal settlement, a merger, a
  // share of an associate's profit, a below-the-line tax credit and a filing error all leave the same
  // residual, and `quarterly_results` has no column that tells them apart. So the sentence states the
  // SIZE and the ABSENCE, and says in as many words that the figures do not say what it was.
  //
  // ⚠ AND IT IS MUTUALLY EXCLUSIVE WITH THE DRIVER BULLET BY CONSTRUCTION, not by an ordering rule.
  // `computeDriver` refuses whenever the identity misses by more than BRIDGE_TOLERANCE (1% of the top
  // line); this fires only above UNEXPLAINED_BASE_FLOOR_PCT (10%). No card can carry both, so group 2
  // never has to choose between an attribution and the statement that no attribution is possible.
  const unexplained = computeUnexplainedProfit(current);
  if (unexplained) out.push(unexplained);

  if (!comparison) return out;
  const v = (k: MetricKey) => valueOf(current, k);
  const p = (k: MetricKey) => valueOf(comparison, k);

  // ── C-1 · TOP LINE GREW BUT THE MARGIN THINNED (all families with a margin) ────────────────────
  // The most common way a quarter that looks good is not. Available before only for the one margin the
  // old block carried; now it reads whichever margin the family actually files.
  //
  // ⚠⚠ 3d-C — "SALES" WAS HARDCODED HERE, AND IT WAS THE SAME DEFECT peers.ts FIXED LAST STAGE.
  // The bullet read "Sales grew 8%…" on an INSURER whose own top-line label two inches above says
  // "Premiums sold", and on a BANK whose top line is net interest income. The growth figure was
  // computed from the family's real top line all along; only the word was wrong, and it contradicted
  // the label the very same card prints above it. manifest.ts's TOP_LINE_KEY note already states the
  // rule — the name here must match what the results feed prints beside it — and the local key list
  // below was a second, silent copy of TOP_LINE_KEY that had drifted into a hardcoded noun. It is
  // gone; both the KEY and the WORD now come from the one map and the one gloss catalogue.
  const topLineKey: MetricKey = TOP_LINE_KEY[current.family];
  const topLineLabel = metricGloss(topLineKey).label;
  const marginKey: MetricKey = current.family === "non_financial" ? "operatingMargin" : "netMargin";
  const topMove = pctMove(v(topLineKey), p(topLineKey));
  const marginMove = ppMove(current, comparison, marginKey);
  if (topMove !== null && marginMove !== null && Math.abs(topMove) >= MONEY_FLOOR_PCT && Math.abs(marginMove) >= RATIO_FLOOR_PP && opposed(topMove, marginMove)) {
    const grew = topMove > 0;
    out.push({
      rule: "topline_vs_margin",
      group: "reading",
      // ── 2a. WAS: "…grew 8% against the same quarter last year, but the share kept as profit
      // narrowed 3.2 percentage points over the same period. The two do not point the same way, so
      // how the quarter reads depends on which one is followed." Two facts behind a "but", then a
      // verdict and its consequence behind a "so". Four ideas, two sentences.
      display:
        `${topLineLabel} ${grew ? "grew" : "fell"} ${Math.round(Math.abs(topMove))}% ${reference}. ` +
        `The share kept as profit ${marginMove > 0 ? "widened" : "narrowed"} ` +
        `${Math.abs(marginMove).toFixed(1)} percentage points over the same period. ` +
        `Those two do not point the same way. How the quarter reads depends on which one is followed.`,
    });
  }

  // ── C-2 · BANKING: PROVISIONS MOVED AGAINST THE BAD-LOAN BOOK ─────────────────────────────────
  // ⚠ THE RULE THE THREE-METRIC BLOCK COULD NOT ASK FOR. Provisions are this quarter's charge; the bad-loan
  // ratio is the state of the book. Setting aside less while the book gets worse — or more while it
  // improves — is the single most informative thing a bank's quarter can say, and neither figure was
  // in the fact block before. GNPA is fraction-scale, so ppMove converts it; a raw comparison here
  // would silently compare 0.0183 against a 3-point floor and never fire.
  if (current.family === "banking") {
    const provMove = pctMove(v("provisions"), p("provisions"));
    const gnpaMove = ppMove(current, comparison, "grossNpaRatio");
    if (provMove !== null && gnpaMove !== null && Math.abs(provMove) >= 10 && Math.abs(gnpaMove) >= 0.1 && opposed(provMove, gnpaMove)) {
      out.push({
        rule: "provisions_vs_gnpa",
        group: "reading",
        // ── 2a. WAS one sentence carrying a parenthesis INSIDE a "while" clause: "The bank set aside
        // more for bad loans this quarter (₹643 crore, up 12% against …), while the share of its
        // lending that had stopped being repaid fell 0.15 percentage points." The figure the reader
        // came for sits in brackets, behind the word that qualifies it, behind the subordinator.
        display:
          `The bank set aside ${money(v("provisions") ?? 0)} for bad loans this quarter. ` +
          `That is ${Math.round(Math.abs(provMove))}% ${provMove > 0 ? "more" : "less"} than it set aside ` +
          `in ${refNoun(reference)}. ` +
          `The share of its lending that had stopped being repaid ${gnpaMove > 0 ? "rose" : "fell"} ` +
          `${Math.abs(gnpaMove).toFixed(2)} percentage points over the same period. ` +
          `The charge and the loan book moved in opposite directions.`,
      });
    }
  }

  // ── C-3 · GENERAL INSURANCE: UNDERWRITING WORSENED, INVESTMENTS CARRIED THE PROFIT ────────────
  // ⚠ 31 of 31 quarters in the universe are underwriting losses, so "made an underwriting loss" alone
  // is not news and must never be a bullet. The contrast worth naming is the DIVERGENCE: the insurance
  // business got worse while the reported profit did not, because investment income covered it.
  if (current.family === "general_insurance") {
    const uwMove = pctMove(Math.abs(v("underwritingProfitOrLoss") ?? 0), Math.abs(p("underwritingProfitOrLoss") ?? 0));
    const profitMove = pctMove(v("netProfit"), p("netProfit"));
    const uwLoss = (v("underwritingProfitOrLoss") ?? 0) < 0;
    if (uwLoss && uwMove !== null && profitMove !== null && uwMove >= MONEY_FLOOR_PCT && profitMove >= MONEY_FLOOR_PCT) {
      out.push({
        rule: "underwriting_vs_investment",
        group: "why",
        // ⚠⚠ 2a — AND IT WAS BROKEN, ON ALL 51 CARDS IT FIRED ON. `reference` already carries its
        // preposition, so "a wider loss than ${reference}" rendered "a wider loss than AGAINST the
        // same quarter last year". The noun form is derived by `refNoun`; see its note.
        display:
          `The insurance business itself lost ${money(v("underwritingProfitOrLoss") ?? 0)} this quarter. ` +
          `That is a wider loss than it made in ${refNoun(reference)}. ` +
          `Net profit was still up ${Math.round(profitMove)}%. ` +
          `Investment income, not insurance, carried the result.`,
      });
    }
  }

  // ── C-4 · LIFE INSURANCE: PREMIUMS GREW BUT CUSTOMERS ARE LEAVING SOONER ──────────────────────
  // ⚠ Only fires when persistency survived its bounds check — SBILIFE's is mis-scaled and withheld, and
  // a contrast built on a withheld figure would print a number the card does not show. Reads
  // 13-month persistency because it is the one a reader can act on: are last year's customers still here.
  if (current.family === "life_insurance") {
    const premMove = pctMove(v("netPremiumIncome"), p("netPremiumIncome"));
    const persSpec = specFor(current.family, "persistencyRatio13Month");
    const curPers = v("persistencyRatio13Month");
    const priPers = p("persistencyRatio13Month");
    const bothInBounds =
      persSpec !== undefined && curPers !== null && priPers !== null &&
      toDisplayValue(persSpec, curPers) >= (persSpec.bounds?.min ?? -Infinity) &&
      toDisplayValue(persSpec, priPers) >= (persSpec.bounds?.min ?? -Infinity);
    const persMove = bothInBounds ? ppMove(current, comparison, "persistencyRatio13Month") : null;
    if (premMove !== null && persMove !== null && premMove >= MONEY_FLOOR_PCT && persMove <= -1) {
      out.push({
        rule: "premium_vs_persistency",
        group: "reading",
        // ⚠ FOUND WHILE FIXING 3d-C, IN THE SAME PROSE. This read "Premiums kept grew 8%…" — the
        // metric LABEL ("Premiums kept") jammed against a verb, which parses as "premiums kept
        // growing" and says the opposite of the sentence it opens. Every other rule here gives its
        // subject an article; this one had the label pasted in raw.
        // ── 2a. The closing line was TWO PASSIVES in one semicolon-joined sentence — "More was sold;
        // less of what was sold before is being kept" — and on these cards the actor is always the
        // company, which is the one thing the reader is trying to learn. It is now two active
        // sentences with the company as the subject of both.
        display:
          `The premiums it kept grew ${Math.round(premMove)}% ${reference}. ` +
          `The share of policies sold a year ago that customers are still paying on fell ` +
          `${Math.abs(persMove).toFixed(1)} percentage points over the same period. ` +
          `The company sold more this quarter. It held on to less of what it had sold before.`,
      });
    }
  }

  // ── C-5 · PROFIT MOVED ON TAX, NOT ON TRADING ────────────────────────────────────────────────
  // Fires where pre-tax profit barely moved and net profit did. A reader told only "profit up 22%"
  // has been handed a tax effect dressed as a business result.
  const pbtMove = pctMove(v("profitBeforeTax"), p("profitBeforeTax"));
  const npMove = pctMove(v("netProfit"), p("netProfit"));
  if (pbtMove !== null && npMove !== null && Math.abs(npMove) >= MONEY_FLOOR_PCT * 2 && Math.abs(pbtMove) < MONEY_FLOOR_PCT) {
    out.push({
      rule: "profit_moved_on_tax",
      group: "why",
      display:
        `Profit before tax was little changed ${reference}. ` +
        `Net profit was ${npMove > 0 ? "up" : "down"} ${Math.round(Math.abs(npMove))}% over the same period. ` +
        `The move came from the tax charge, not from trading.`,
    });
  }

  // ── Q-A · BANKING: THE LENDING ENGINE AND THE BOTTOM LINE DISAGREED ──────────────────────────
  // Fires on 19.4% of banking pairs. Pre-provision operating profit is what the bank earned before it
  // set anything aside for bad loans; net profit is what survived that charge and tax. When the two
  // point opposite ways the quarter reads two different ways depending on which is followed, and a
  // reader told only "profit fell 9%" has not been told the lending business grew.
  //
  // ⚠ NEITHER FIGURE CARRIES A SHARE OF THE OTHER'S MOVE. `preProvisionOperatingProfit` is a SUBTOTAL
  // and manifest.ts marks it driver-ineligible for exactly that reason. This states two directions;
  // it does not attribute one to the other, which is driver.ts's job and only where a bridge closes.
  if (current.family === "banking") {
    const ppopMove = pctMove(v("preProvisionOperatingProfit"), p("preProvisionOperatingProfit"));
    const profitMove = pctMove(v("netProfit"), p("netProfit"));
    if (
      ppopMove !== null && profitMove !== null &&
      Math.abs(ppopMove) >= MONEY_FLOOR_PCT && Math.abs(profitMove) >= MONEY_FLOOR_PCT &&
      opposed(ppopMove, profitMove)
    ) {
      out.push({
        rule: "ppop_vs_net_profit",
        group: "reading",
        // ── ★ 2a, AND THIS ONE WAS THE WORST SUBJECT IN THE FILE. "What the bank earned from lending
        // before setting anything aside for bad loans was up 12% …" makes the reader carry a
        // THIRTEEN-WORD noun clause before the verb arrives. The figure is on the card as its own
        // line, so the level can lead and the definition can follow in its own sentence.
        display:
          `The bank earned ${money(v("preProvisionOperatingProfit") ?? 0)} from lending this quarter, ` +
          `before it set anything aside for bad loans. ` +
          `That is ${ppopMove > 0 ? "up" : "down"} ${Math.round(Math.abs(ppopMove))}% ${reference}. ` +
          `Net profit was ${profitMove > 0 ? "up" : "down"} ${Math.round(Math.abs(profitMove))}% over the same period. ` +
          `The lending business and the reported profit moved in opposite directions.`,
      });
    }
  }

  // ── Q-B · BANKING: BAD LOANS MOVED ONE WAY IN RUPEES AND THE OTHER AS A SHARE ────────────────
  // Fires on 11.5% of banking pairs. The rupee amount is how much has stopped being repaid; the share
  // is that amount against a loan book that is itself growing. A bank whose bad loans grew in rupees
  // while the share fell has simply lent faster than the book went bad — which is a real and different
  // fact from either figure alone, and the card prints both without saying they disagree.
  //
  // ⚠ GNPA RATIO IS FRACTION-SCALE (stored 0.0183 = 1.83%), so it goes through ppMove. A raw comparison
  // would test 0.0183 against a point floor and never fire — the same trap C-2 documents.
  if (current.family === "banking") {
    const amountMove = pctMove(v("grossNpaAmount"), p("grossNpaAmount"));
    const shareMove = ppMove(current, comparison, "grossNpaRatio");
    if (
      amountMove !== null && shareMove !== null &&
      Math.abs(amountMove) >= MONEY_FLOOR_PCT && Math.abs(shareMove) >= 0.1 &&
      opposed(amountMove, shareMove)
    ) {
      out.push({
        rule: "npa_amount_vs_share",
        group: "reading",
        // ── 2a. The level was buried mid-sentence between two movements ("were up 14% in rupees …,
        // at ₹28,150 crore, while their share …"). It leads now, and the reason the two disagree
        // gets its own sentence instead of hanging off a "because".
        display:
          `Loans that had stopped being repaid came to ${money(v("grossNpaAmount") ?? 0)} this quarter. ` +
          `In rupees that is ${amountMove > 0 ? "up" : "down"} ${Math.round(Math.abs(amountMove))}% ${reference}. ` +
          `Their share of the bank's lending ${shareMove > 0 ? "rose" : "fell"} ` +
          `${Math.abs(shareMove).toFixed(2)} percentage points over the same period. ` +
          `The amount and the share moved in opposite directions. The loan book itself changed size.`,
      });
    }
  }

  // ── Q-G · OPERATING PROFIT AND NET PROFIT DISAGREED (non-financial) ──────────────────────────
  // Fires on 9.4% of non-financial pairs — the rarest of the five, and the one a reader is least able
  // to see for themselves, because the two figures sit eight lines apart in the metric table.
  //
  // ⚠⚠ THIS IS NOT A C15 VIOLATION AND THE DISTINCTION IS EXACT. manifest.ts bars `operatingProfit`
  // from every BRIDGE, because it closes no identity against the lines beside it — no share of any
  // move may be computed from it. This rule computes no share: it states the DIRECTION of one filed
  // figure beside the direction of another. Direction needs no identity to close, and operating profit
  // is a figure the reader can check against the statement, which is the reason the manifest keeps it.
  if (current.family === "non_financial") {
    const opMove = pctMove(v("operatingProfit"), p("operatingProfit"));
    const npAllMove = pctMove(v("netProfit"), p("netProfit"));
    if (
      opMove !== null && npAllMove !== null &&
      Math.abs(opMove) >= MONEY_FLOOR_PCT && Math.abs(npAllMove) >= MONEY_FLOOR_PCT &&
      opposed(opMove, npAllMove)
    ) {
      out.push({
        rule: "operating_vs_net_profit",
        group: "reading",
        display:
          `Profit from the trading business was ${opMove > 0 ? "up" : "down"} ` +
          `${Math.round(Math.abs(opMove))}% ${reference}. ` +
          `The profit left at the end was ${npAllMove > 0 ? "up" : "down"} ` +
          `${Math.round(Math.abs(npAllMove))}% over the same period. ` +
          `What the company earned from trading and what it kept did not move the same way.`,
      });
    }
  }

  // ── Q-E · COSTS OUTGREW THE TOP LINE ─────────────────────────────────────────────────────────
  // Fires on 15.7% of pairs at a ten-point gap. The cut is measured: five points fires on 33.6% and
  // eight on 20.7%, and at five points this is a card in three — a cost line growing a little faster
  // than sales is ordinary, and the sentence only earns its place when the gap is wide.
  //
  // ⚠ THE AGGREGATE COST LINE IS THE POINT, NOT AN OVERSIGHT. `expenses` and `totalExpenses` are both
  // driver `context` — always reported, never NAMED as the driver, because "costs moved" is not an
  // explanation. That leaves the reader without the aggregate at all: the driver bullet names a
  // component (depreciation, other income) or says nothing. This states the aggregate as a comparison,
  // which is the one thing the driver deliberately never says.
  const COST_KEY: Partial<Record<AnyFamilyQuarter["family"], MetricKey>> = {
    non_financial: "expenses",
    nbfc: "totalExpenses",
  };
  const costKey = COST_KEY[current.family];
  if (costKey) {
    const costMove = pctMove(v(costKey), p(costKey));
    const lineMove = pctMove(v(topLineKey), p(topLineKey));
    if (costMove !== null && lineMove !== null && costMove - lineMove >= COST_GAP_FLOOR_PP) {
      out.push({
        rule: "costs_outgrew_top_line",
        group: "why",
        display:
          `${metricGloss(costKey).label} ${costMove > 0 ? "grew" : "fell"} ` +
          `${Math.round(Math.abs(costMove))}% ${reference}. ` +
          `${topLineLabel} ${lineMove > 0 ? "grew" : "fell"} ${Math.round(Math.abs(lineMove))}% over the same period. ` +
          `Costs moved ${Math.round(costMove - lineMove)} percentage points further than what came in.`,
      });
    }
  }

  // ── Q-F · THE SHARE OF PROFIT TAKEN BY TAX MOVED ─────────────────────────────────────────────
  // Fires on 17.6% of pairs at ten points. Measured at 45.1% at three points and 32.0% at five — the
  // effective rate wanders every quarter, and only a wide move is a fact rather than noise.
  //
  // ⚠⚠ GATED ON C-5 NOT HAVING FIRED, AND WITHOUT THAT GATE THE SAME CARD STATES THE TAX EFFECT TWICE.
  // C-5 is the case where pre-tax profit barely moved and net profit did, which is a tax effect BY
  // CONSTRUCTION — every card C-5 fires on has a moved effective rate, and it says so in better words
  // because it can name what did not move beside it. Order is the enforcement: C-5 is pushed above,
  // this reads what is already in `out`.
  //
  // ⚠ LIFE INSURANCE IS EXCLUDED, STRUCTURALLY. manifest.ts's life_insurance.tax note: `net profit =
  // profit before tax − tax` closes on 6% of rows, because policyholder tax is booked inside the
  // revenue account and this line is not the deduction that produces net profit. An effective rate
  // computed from those two columns would be a real division of two unrelated figures.
  const taxAlreadySaid = out.some((c) => c.rule === "profit_moved_on_tax");
  if (!taxAlreadySaid && current.family !== "life_insurance") {
    const rate = effectiveTaxRate(v("tax"), v("profitBeforeTax"));
    const ratePrior = effectiveTaxRate(p("tax"), p("profitBeforeTax"));
    if (rate !== null && ratePrior !== null && Math.abs(rate - ratePrior) >= TAX_RATE_FLOOR_PP) {
      out.push({
        rule: "effective_tax_rate_moved",
        group: "why",
        // ⚠⚠ 2a — AND IT WAS BROKEN ON ALL 51 CARDS IT FIRED ON, the same defect as C-3: `reference`
        // carries its own preposition, so this printed "against 68.3% AGAINST the same quarter last
        // year". The repeat also ended in a passive tail ("what it earned before tax was taken"),
        // which is now an active clause with the company as the subject.
        display:
          `Tax took ${marginPct(rate)} of the company's pre-tax profit this quarter. ` +
          `It took ${marginPct(ratePrior)} in ${refNoun(reference)}. ` +
          `That is ${rate > ratePrior ? "a larger" : "a smaller"} share of what the company earned before tax.`,
      });
    }
  }

  return out;
}

/**
 * Q-K's fact, or null.
 *
 * ── ⚠ THE FOUR REFUSALS, AND WHY EACH ONE IS LOAD-BEARING ───────────────────────────────────────
 * 1 · NO NET-PROFIT BRIDGE. Life insurance has none at all, and general insurance's targets the
 *     UNDERWRITING RESULT — its residual is not a statement about profit. Firing on either would be a
 *     confident sentence about an artifact of that family's accounting. The set is derived from
 *     BRIDGES in driver.ts, so a retargeted bridge cannot keep its membership by accident.
 * 2 · A TERM IS UNREPORTED. `unexplainedAmount` returns null, and it must: a missing column and a
 *     one-off gain leave the identity open in exactly the same way, and only one of them is a fact
 *     about the company. This is the same refusal `bridgeResidual` makes, for the same reason.
 * 3 · THE AMOUNT IS SMALL AGAINST THE PROFIT. Then the sentence is true and pointless.
 * 4 · THE AMOUNT IS SMALL AGAINST THE TOP LINE. Then it is a share of a figure too small to divide by
 *     — the same both-sides-material discipline every other rule in this file carries.
 */
function computeUnexplainedProfit(current: AnyFamilyQuarter): ContrastFact | null {
  const bridge = UNEXPLAINED_BRIDGES.get(current.family);
  if (!bridge) return null; // ← 1
  const amount = unexplainedAmount(current);
  if (amount === null) return null; // ← 2

  const netProfit = valueOf(current, bridge.target);
  const base = valueOf(current, bridge.scaleBase);
  if (netProfit === null || base === null || netProfit === 0 || base === 0) return null;

  if (Math.abs(amount) < (Math.abs(netProfit) * UNEXPLAINED_PROFIT_FLOOR_PCT) / 100) return null; // ← 3
  if (Math.abs(amount) < (Math.abs(base) * UNEXPLAINED_BASE_FLOOR_PCT) / 100) return null; // ← 4

  // ★ ROUNDED FIRST, THEN SUBTRACTED — SO THE THREE PRINTED FIGURES ADD UP ON THE PAGE.
  //
  // ⚠ CAUGHT BY THE CENSUS, ON 2 OF THE FIRST 10 CARDS. Rounding each of the three independently gave
  // BAJAJHLDNG "₹1,748 crore … ₹88 crore … ₹1,661 crore", and 88 + 1,661 is 1,749; JPPOWER printed
  // 662 and 194 against a reported 469. Every figure was correctly rounded and the sentence still
  // failed the ONLY check a reader can perform on it — which is the entire reason this rule states
  // three numbers instead of one percentage. Same defect, same fix and the same half-crore cost as
  // driver.ts's `decompose`, whose note carries the full argument and the ₹1 lakh crore exception.
  //
  // The DERIVED figure is the sum of the lines, because it is the one nothing else on the card shows:
  // net profit is printed in the metric section and the gap is this sentence's own headline.
  const profitShown = Math.round(netProfit);
  const gapShown = Math.round(amount);
  const fromLines = profitShown - gapShown;
  const asMoney = (cr: number) => (cr < 0 ? moneyLoss(cr) : money(cr));

  return {
    rule: "profit_not_from_trading",
    // ⚠ GROUP 2, AND NOT GROUP 1 OR 3. This is the answer to "how is the profit that figure" — a
    // mechanism, which is what group 2 is. Group 1 states what moved; group 3 states where the
    // quarter's figures disagree with each other, and these two do not disagree — one is simply not
    // made of the other.
    group: "why",
    mustSay: true,
    // The GAP, and not the other two. The reader can reach net profit from the metric row and the sum
    // from the arithmetic; the gap is the only figure that exists nowhere else on the card, and it is
    // the answer to the question the card raised.
    requiredFigure: money(gapShown),
    display:
      `Net profit was ${asMoney(profitShown)} this quarter. ` +
      `${bridge.plainSum}, comes to ${asMoney(fromLines)}. ` +
      `The gap between the two is ${money(gapShown)}. ` +
      (amount > 0
        ? `That much of the reported profit came from something outside those lines. `
        : `That much was taken off the reported profit by something outside those lines. `) +
      `The quarterly figures do not say what it was.`,
  };
}

/** Tax as a share of pre-tax profit, in percentage points, or null where the division would not
 *  describe anything.
 *
 *  ⚠ TWO GUARDS, AND BOTH ARE LOAD-BEARING. Pre-tax profit at or below zero makes the ratio meaningless
 *  in the same way every other zero-or-negative base in this feature does (change.ts rule 3). And a
 *  rate outside ±100% is a tiny pre-tax profit acting as a denominator, not a tax regime: the figure
 *  divides correctly and describes nothing, which is the manifest's own bounds test applied to a
 *  derived ratio. */
function effectiveTaxRate(tax: number | null, profitBeforeTax: number | null): number | null {
  if (tax === null || profitBeforeTax === null || profitBeforeTax <= 0) return null;
  const rate = (tax / profitBeforeTax) * 100;
  return Math.abs(rate) > 100 ? null : rate;
}
