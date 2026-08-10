// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANNUAL METRICS — the plain-language gloss for every metric the Q4-only ANNUAL SECTION can report.
//
// ── ★ WHY THIS IS A SECOND CATALOGUE AND NOT MORE ENTRIES IN quarter-metrics.ts ──────────────────
// Every meaning in that file is written in the present tense of a QUARTER: "during the quarter",
// "this quarter", "in these three months". Those are not decorations — they are the sentence's
// subject. Reusing `revenue` or `netProfit` for an annual figure would print "the money the company
// brought in ... during the quarter" beside a full-year number, which is not a rounding of the truth
// but a different claim about a different period.
//
// So the annual section has its OWN key space, its OWN glosses, and its own compile gate. Two
// catalogues cost 43 more authored sentences; one catalogue would cost the reader the ability to
// trust a tense. The keys deliberately do NOT collide with `MetricKey` — a metric that exists in both
// (net worth does not; earnings per share does not) would be a sign the split was drawn wrong.
//
// ── ⚠⚠ AUTHORED, NEVER GENERATED. Same rule, restated because scale makes it tempting ────────────
// Every sentence below is written by a person and reviewed. A model asked to define free cash flow or
// net interest margin invents a fresh definition on every run; we have had that failure once already
// (the health score, fixed by supplying one line in quarter-brief/prompt.ts) and this file is where it
// would return at forty-three times the scale.
//
// ── ⚠ DIGITS ARE ALLOWED HERE — C22, inherited from quarter-metrics.ts ───────────────────────────
// The guardrail registry is enforced digit-free because ITS numbers are the detector: publish the bar
// and a company knows the shape to structure under. Nothing here is a detector. These are definitions
// of publicly filed lines, and "for every 100 rupees of shareholders' money" is precisely the sentence
// this reader needs. Same split the stock-finding and quarter-metric registries already make.
//
// ── PROSE, NOT "≠" ───────────────────────────────────────────────────────────────────────────────
// Inherited unchanged from quarter-metrics.ts. Every `doesntMean` below is a sentence. The frontend's
// BoundaryLine does convert the glyph into a real list at the render (components/ui/boundary-line.tsx),
// but that transform exists for copy already written in the notation — it is not a licence to write
// more of it, and this card's reader has never seen a financial statement.
//
// ── ★ WHY SOME KEYS ARE SHARED ACROSS FAMILIES AND SOME ARE NOT ──────────────────────────────────
// `netWorth` means the same thing to a bank and to a cement company, so it is ONE entry used by all
// five manifests. But a bank's `investmentBook` is a portfolio it is largely REQUIRED to hold, while
// an insurer's `insurerInvestments` is the float it collected in premiums — genuinely different
// concepts under a similar name, and a shared gloss that is subtly wrong for one family is worse than
// two honest ones. 67 manifest slots across five families reduce to the 43 entries below.
//
// ── ENFORCEMENT ──────────────────────────────────────────────────────────────────────────────────
// `AnnualMetricKey` is `keyof typeof ANNUAL_METRIC_GLOSSES`, and annual-manifest.ts types its `key`
// field as that. An annual manifest metric with no gloss is therefore a COMPILE ERROR. The reverse
// (a gloss no manifest uses) and the content rules are checked by scripts/verify-annual-metrics.ts,
// which runs in the build gate chain.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { MetricGloss } from "./quarter-metrics.js";

export const ANNUAL_METRIC_GLOSSES = {
  // ── Shared across families ──────────────────────────────────────────────────────────────────────
  netWorth: {
    label: "Shareholders' money in the business",
    meaning:
      "What would be left over for the owners if the company sold everything it owns at the value in its books and paid off everything it owes.",
    doesntMean:
      "This is built from what things originally cost, not what they would fetch today, and it can be a negative number when a company has lost more over the years than its owners ever put in.",
  },
  totalAssets: {
    label: "Everything the company owns",
    meaning:
      "The book value of everything the business held on the last day of the year — buildings, machines, stock, cash and money owed to it.",
    doesntMean:
      "Owning more is not the same as being worth more. A large part of this may have been bought with borrowed money, and what is owed is counted separately.",
  },
  basicEps: {
    label: "Profit per share",
    meaning:
      "The year's profit divided by the number of shares in issue, so it is the profit belonging to one single share.",
    doesntMean:
      "This is not money handed to shareholders. Most of it usually stays inside the company; what is actually paid out is the dividend, which is a separate and normally much smaller figure.",
  },
  returnOnEquity: {
    label: "Return on shareholders' money",
    meaning:
      "Out of every 100 rupees of shareholders' money in the business, how much the company earned as profit over the year.",
    doesntMean:
      "A high figure can come from borrowing heavily rather than from trading well, because borrowed money is not counted in the amount this is measured against.",
  },
  cashFromOperating: {
    label: "Cash generated by the business",
    meaning:
      "The cash that actually moved through the bank from running the business over the year, after paying suppliers, staff and tax.",
    doesntMean:
      "This is not profit. Profit counts a sale when it is made, while this counts money only when it actually arrives, so the two can point different ways for a year at a time.",
  },
  cashFromInvesting: {
    label: "Cash spent on investments and equipment",
    meaning:
      "What the company spent over the year buying equipment, businesses and investments, less anything it raised by selling them.",
    doesntMean:
      "Money going out here is not a loss. A company building a new factory spends heavily under this heading, and that spending is what next year's production comes from.",
  },
  cashFromFinancing: {
    label: "Cash from lenders and shareholders",
    meaning:
      "Money raised over the year by borrowing or issuing shares, less what was repaid to lenders and paid out to shareholders.",
    doesntMean:
      "Money going out here is often a company repaying debt, which is not the same as a company running short of it. The direction alone does not say which.",
  },
  cashAndCashEquivalents: {
    label: "Cash in the bank",
    meaning:
      "What the company had in its bank accounts and in deposits it can draw on at short notice, on the last day of the year.",
    doesntMean:
      "This is a photograph of a single day. A company's cash can look very different a week either side of its year-end, and this figure does not show how steady it was.",
  },

  // ── Non-financial companies ─────────────────────────────────────────────────────────────────────
  totalDebt: {
    label: "Total borrowings",
    meaning:
      "Everything the company owed to banks and to bondholders on the last day of the year, due soon and due later added together.",
    doesntMean:
      "Borrowing is not a problem in itself, and most companies do it to grow. What matters is whether the profits comfortably cover the interest and whether the repayments fall due at a manageable pace.",
  },
  debtDueWithinAYear: {
    label: "Borrowings due within a year",
    meaning:
      "The part of the borrowings that has to be repaid or renewed within twelve months of the year-end date.",
    doesntMean:
      "This does not have to be found out of nowhere. Companies routinely renew short-term borrowing, and the cash already in the bank stands against it as well.",
  },
  inventories: {
    label: "Stock sitting in warehouses",
    meaning:
      "What the goods held at the year-end cost the company — raw materials, half-finished goods, and finished goods not yet sold.",
    doesntMean:
      "Stock is not sales waiting to happen. Some of it may be slow-moving or out of date, and a company writes such stock down when it judges it will not sell at the price it was valued at.",
  },
  tradeReceivables: {
    label: "Money customers owe",
    meaning:
      "Sales the company has already made and counted as revenue but had not yet been paid for by the last day of the year.",
    doesntMean:
      "This is not certain money. Some customers pay late and a few never pay, and what is shown here is already after the company's own estimate of what it will not collect.",
  },
  propertyPlantAndEquipment: {
    label: "Land, buildings and machines",
    meaning:
      "What the company's factories, offices, machines and vehicles are worth in its books at the year-end, after the depreciation charged so far has been taken off.",
    doesntMean:
      "This is not what they would sell for. It is the original price less the depreciation charged since, which for older assets can be a long way from any market value.",
  },
  capitalExpenditure: {
    label: "Money spent on equipment and buildings",
    meaning:
      "What the company paid out during the year for new machines, factories, vehicles and other things it expects to use for many years.",
    doesntMean:
      "This spending does not come off profit in the year it happens. Its cost is spread across the years the asset is used, and that spreading is what depreciation is.",
  },
  freeCashFlow: {
    label: "Free cash flow",
    meaning:
      "What was left of the cash the business generated after it had paid for the equipment and buildings it needs to keep running.",
    doesntMean:
      "A negative figure is not automatically a warning. A company halfway through building a new plant will spend more than it generated, on purpose, and expects the plant to pay for itself later.",
  },
  dividendsPaid: {
    label: "Dividends paid to shareholders",
    meaning: "Cash actually handed to shareholders during the year.",
    doesntMean:
      "A company that paid nothing is not necessarily keeping its shareholders short. Profit kept inside the business still belongs to them; it has simply not been sent out.",
  },
  debtToEquity: {
    label: "Borrowings against shareholders' money",
    meaning:
      "For every 100 rupees of shareholders' money in the business, how many rupees the company has borrowed.",
    doesntMean:
      "There is no single right level. A steady utility with predictable bills can carry far more borrowing safely than a company whose sales swing about from year to year.",
  },
  interestCoverage: {
    label: "Times profit covers the interest bill",
    meaning:
      "How many times over the year's trading profit would have covered the interest the company owed its lenders.",
    doesntMean:
      "This says the interest is affordable out of profit. It says nothing about whether the company can repay the borrowing itself when it eventually falls due.",
  },
  receivablesDays: {
    label: "Days customers take to pay",
    meaning:
      "On average across the year, how many days passed between the company making a sale and the money arriving.",
    doesntMean:
      "A longer wait is not automatically weakness. Whole industries sell on ninety-day terms as a matter of course, so the figure only means something set against companies that sell the same way.",
  },

  // ── Banking ─────────────────────────────────────────────────────────────────────────────────────
  deposits: {
    label: "Customer deposits",
    meaning:
      "The total that the bank's customers held in current, savings and fixed-deposit accounts on the last day of the year.",
    doesntMean:
      "This is money the bank owes its customers, not money it owns. It is the raw material a bank lends out, and it sits on the side of the balance sheet that lists what is owed.",
  },
  advances: {
    label: "Loans given out",
    meaning:
      "The total the bank had lent to its customers at the year-end, after taking off the loans it has already written off entirely.",
    doesntMean:
      "This is not income. What the bank earns is the interest on it, and a small part of any loan book will not come back at all.",
  },
  bankBorrowings: {
    label: "The bank's own borrowings",
    meaning:
      "Money the bank has itself borrowed from other banks, from the central bank and from bond investors, as distinct from the deposits its customers place with it.",
    doesntMean:
      "Borrowing is ordinary for a bank. It is usually a dearer source of money than deposits, so the mix between the two matters more than the size of this figure alone.",
  },
  investmentBook: {
    label: "Bonds and securities held",
    meaning:
      "The government bonds and other securities the bank holds, a large part of which the regulator requires it to keep.",
    doesntMean:
      "This is not spare money the bank could lend instead. Much of it must be held by law, and what it is worth moves up and down with interest rates.",
  },
  netInterestMargin: {
    label: "Net interest margin",
    meaning:
      "Out of every 100 rupees the lender has lent or invested, how much it kept over the year as the gap between what it earned and what it paid for that money.",
    doesntMean:
      "A wider margin is not automatically better lending. It can also mean the lender is lending to riskier borrowers, who pay more precisely because they are riskier.",
  },
  creditCost: {
    label: "Cost of loans going bad",
    meaning:
      "Out of every 100 rupees lent, how much the lender had to set aside during the year against loans it expects will not be repaid in full.",
    doesntMean:
      "A very low figure is not proof the loan book is sound. Trouble in lending usually surfaces a year or two after the loans were written, so this describes the past rather than what is coming.",
  },
  creditDepositRatio: {
    label: "Share of deposits lent out",
    meaning:
      "Out of every 100 rupees of customer deposits, how many rupees the bank has lent out to borrowers.",
    doesntMean:
      "A higher figure is not simply a bank working harder. It also means less of the deposit base is held back in easily sold assets, which is a choice about caution rather than a measure of skill.",
  },
  returnOnAssetsAnnual: {
    label: "Return on assets, full year",
    meaning:
      "Out of every 100 rupees the bank has lent or invested, how much it earned as profit across the whole year.",
    doesntMean:
      "This is a full year's figure and cannot be set beside a single quarter's return without allowing for the difference in length between them.",
  },

  // ── NBFC (lenders that are not banks) ───────────────────────────────────────────────────────────
  loanBook: {
    label: "Loans outstanding",
    meaning: "The total the lender had lent to its borrowers on the last day of the year.",
    doesntMean:
      "A bigger loan book is not automatically a better one. It says how much has been lent, not how much of it will come back.",
  },
  totalLiabilities: {
    label: "Everything it owes",
    meaning:
      "Everything the lender owed at the year-end — bonds it has issued, money borrowed from banks, and every other obligation added together.",
    doesntMean:
      "For a lender this figure is meant to be large. Borrowing is the raw material of the business, in the same way deposits are for a bank.",
  },
  costToIncomeAnnual: {
    label: "Cost-to-income, full year",
    meaning:
      "Out of every 100 rupees the lender took in across the year, how much went on running the business.",
    doesntMean:
      "A low figure is not the same as a well-run lender. Money set aside for loans that go bad is not counted here, and for a lender that is usually the larger cost.",
  },
  borrowingsToEquity: {
    label: "Times borrowed against its own money",
    meaning:
      "How many rupees the lender has borrowed for every rupee of its own money in the business.",
    doesntMean:
      "Lenders borrow in order to lend, so a figure of several times over is the ordinary shape of the business rather than a warning. What it does say is that a small fall in the value of the loans takes a much larger share of the owners' money with it.",
  },

  // ── Life insurance ──────────────────────────────────────────────────────────────────────────────
  policyholdersFunds: {
    label: "Money held for policyholders",
    meaning:
      "The fund the insurer holds to pay claims and maturities on the policies it has already sold.",
    doesntMean:
      "This is not the insurer's money and it is not available to shareholders. It belongs to policyholders, and it is normally many times larger than what the shareholders own.",
  },
  investmentsPolicyholders: {
    label: "Investments held for policyholders",
    meaning:
      "The bonds, deposits and shares the insurer holds inside the policyholder fund, waiting to pay claims that fall due in later years.",
    doesntMean:
      "Gains on these do not become the insurer's profit. Most of what they earn belongs to policyholders, and only a defined share ever reaches shareholders.",
  },
  investmentsShareholders: {
    label: "Investments held for shareholders",
    meaning:
      "The bonds, deposits and shares the insurer holds on its own account rather than inside the policyholder fund.",
    doesntMean:
      "This is much smaller than the policyholder fund at every Indian life insurer, so its size says little about how big the company is.",
  },
  assetsHeldToCoverLinkedLiabilities: {
    label: "Money held for unit-linked policies",
    meaning:
      "Investments held against policies where the customer, and not the insurer, carries the ups and downs of the market.",
    doesntMean:
      "A fall here is not usually a loss to the insurer. On these policies the customer's savings rise and fall with the market, and the insurer's earnings come from the charges rather than the returns.",
  },
  surplusFromRevenueAccount: {
    label: "Surplus left in the policyholder fund",
    meaning:
      "What was left in the fund that pays claims after a year of premiums and investment income, once claims and the money set aside for future claims had been counted.",
    doesntMean:
      "This is not the insurer's profit. Only the part transferred across to shareholders reaches the profit figure, and the rest stays in the fund.",
  },
  transferFromPolicyholders: {
    label: "Moved across to shareholders",
    meaning:
      "The share of the policyholder fund's surplus moved across to the shareholders during the year, which is where most of a life insurer's profit comes from.",
    doesntMean:
      "This is not money taken from policyholders. It is the share of the surplus the rules allow the shareholders to have, after policyholders' own entitlements have been set aside.",
  },
  incomeFromInvestmentsShareholders: {
    label: "Investment income on shareholders' money",
    meaning:
      "What the insurer earned during the year on the money held for shareholders rather than on the policyholder fund.",
    doesntMean:
      "This is income from investing, not from selling insurance, so a rise here says nothing about whether the insurance business improved.",
  },
  shareholdersExpenses: {
    label: "Costs charged to shareholders",
    meaning:
      "The costs of the year charged against the shareholders' side of the accounts rather than against the policyholder fund.",
    doesntMean:
      "This is not the cost of running the insurance business. The far larger part of that sits inside the policyholder fund and is not counted here.",
  },

  // ── General insurance ───────────────────────────────────────────────────────────────────────────
  insurerInvestments: {
    label: "Investments held",
    meaning:
      "The bonds, deposits and shares the insurer holds — premiums it has collected and not yet paid out in claims, put to work until they are needed.",
    doesntMean:
      "This is not spare money. Almost all of it is held against claims that have already happened or are expected on cover still running, and it will be paid out.",
  },
  fairValueChangeAccount: {
    label: "Gains on investments not yet sold",
    meaning:
      "How much of the insurer's own money is gains on investments it still holds and has not sold.",
    doesntMean:
      "These gains have not been banked and can reverse. Until the investments are sold the amount moves with the market, in both directions.",
  },
  changeInOutstandingClaims: {
    label: "Change in claims still to be settled",
    meaning:
      "How much was added to, or released from, the insurer's estimate of claims that have already happened but have not yet been paid.",
    doesntMean:
      "This is an estimate moving, not cash leaving. Insurers revise it as they learn what claims actually cost, so it can go either way in a later year.",
  },
  premiumDeficiency: {
    label: "Extra reserve for cover still to run",
    meaning:
      "How much was added to, or released from, the extra reserve the insurer holds when the premiums already taken look too small to cover the claims expected on policies still running.",
    doesntMean:
      "A figure of nothing here is the normal case and is not a sign of strength. It means only that the premiums already taken were judged sufficient for the cover still outstanding.",
  },
} as const satisfies Record<string, MetricGloss>;

/** Every metric the ANNUAL section can gloss. annual-manifest.ts types its `key` as this, so an
 *  annual manifest metric with no gloss is a COMPILE ERROR rather than a bare label at runtime. */
export type AnnualMetricKey = keyof typeof ANNUAL_METRIC_GLOSSES;

export const ANNUAL_METRIC_KEYS = Object.keys(ANNUAL_METRIC_GLOSSES) as AnnualMetricKey[];

/** The gloss for `key`. Total by construction — `AnnualMetricKey` cannot name a missing entry. */
export const annualMetricGloss = (key: AnnualMetricKey): MetricGloss => ANNUAL_METRIC_GLOSSES[key];
