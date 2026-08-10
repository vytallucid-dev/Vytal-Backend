// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER METRICS — the plain-language gloss for every metric a Quarter in Brief can report.
//
// ── ★ THE GLOSS IS THE FEATURE, NOT DECORATION ────────────────────────────────────────────────────
// The reader this card is written for has never read a financial statement and does not know what a
// margin, a provision or a persistency ratio is. Printing "Persistency (13-month): 80.0%" tells them
// nothing at all. Printing "Of the policies sold about a year ago, 80.0% are still being paid on"
// tells them everything. The manifest decides WHICH metrics are shown; this file is the only reason
// showing them is worth anything.
//
// ── ⚠⚠ AUTHORED, NEVER GENERATED. ─────────────────────────────────────────────────────────────────
// Every sentence here is written by a person and reviewed. A model asked to define NIM or persistency
// invents a fresh definition on every run — we have already had that failure once, with the model
// inventing a new description of the Vytal health score each generation, and it was fixed by supplying
// one line (quarter-brief/prompt.ts). Do not reintroduce it here at sixty-seven times the scale.
//
// ── SHAPE FOLLOWS guardrail-signatures.ts, WITH ONE DELIBERATE DIFFERENCE ─────────────────────────
// Same three required fields (label / meaning / doesntMean), same house rule that a `doesntMean` is
// REQUIRED and an entry without one does not ship.
//
//   ⚠ BUT DIGITS ARE ALLOWED HERE, AND THAT IS NOT AN OVERSIGHT. The guardrail registry is enforced
//   digit-free because its numbers ARE the detector for gamed reporting — publish the bar and you hand
//   a company the shape to structure under. Nothing in this file is a detector. These are definitions
//   of publicly filed lines, and "the regulator's floor in India is 1.5 times" is precisely the sentence
//   the reader needs. Same split the stock-finding registry already makes, for the same reason.
//
// ── PROSE, NOT "≠" ───────────────────────────────────────────────────────────────────────────────
// The PHS library's "≠ trim it" form is shipped behaviour there and not ours to change, but it is not
// a form to copy: a screen reader announces "≠" as "not equal to", and this copy renders inside a card
// with no italics or left border to carry the glyph. Every doesntMean below is a sentence.
//
// ── ★ WHY THE KEYS ARE SHARED ACROSS FAMILIES ────────────────────────────────────────────────────
// `profitBeforeTax` means the same thing to a bank and to a cement company, so it is ONE entry used by
// both manifests. 96 manifest slots across five families reduce to the 67 entries below. Where two
// families' columns are genuinely different concepts under a similar name — banking's `operatingExpenses`
// excludes deposit interest, an insurer's `insuranceRunningCosts` has no such notion — they are
// SEPARATE entries, because a shared gloss that is subtly wrong for one family is worse than two.
//
// ── ENFORCEMENT ──────────────────────────────────────────────────────────────────────────────────
// `MetricKey` is `keyof typeof QUARTER_METRIC_GLOSSES`, and the manifest types its `key` field as
// MetricKey. A manifest metric with no gloss is therefore a COMPILE ERROR, not a bare label at
// runtime. The reverse (a gloss no manifest uses) and the content rules are checked by
// scripts/verify-quarter-metrics.ts, which runs in the build gate chain.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One metric's reader-facing copy. Every field required — a half-written entry does not typecheck. */
export interface MetricGloss {
  /** The heading this metric appears under. Plain words; never the filed line's name. */
  label: string;
  /** ONE sentence saying what the figure is, for someone who has never read a statement. */
  meaning: string;
  /** The limit of what it says. Prose, not "≠". Required — see the header. */
  doesntMean: string;
}

export const QUARTER_METRIC_GLOSSES = {
  // ── Shared / non-financial ──────────────────────────────────────────────────────────────────────
  revenue: {
    label: "Revenue",
    meaning:
      "The money the company brought in from selling its products or services during the quarter, before any costs are taken out.",
    doesntMean:
      "Revenue is not profit. A company can sell a great deal and still lose money once its costs are counted.",
  },
  otherIncome: {
    label: "Other income",
    meaning:
      "Money that came in from outside the main business — interest on cash in the bank, rent, or a one-off gain from selling something.",
    doesntMean:
      "This is not money earned from what the company does for a living, so a rise here says nothing about whether trading improved.",
  },
  expenses: {
    label: "Total costs",
    meaning:
      "Everything it cost to run the company this quarter, added together — wages, materials, rent, depreciation and interest all included.",
    doesntMean:
      "Rising costs are not automatically bad. A company that is growing usually spends more; what matters is whether costs grew faster than sales.",
  },
  otherOperatingCosts: {
    label: "Day-to-day running costs",
    meaning:
      "Total costs with depreciation and interest taken back out — the wages, materials and overheads of actually running the business this quarter.",
    doesntMean:
      "This is a leftover figure, worked out by subtraction rather than reported as its own line, so it groups together things the company reports separately.",
  },
  depreciation: {
    label: "Depreciation",
    meaning:
      "The share of the cost of buildings, machines and equipment charged against this quarter, spreading their price across the years they will be used.",
    doesntMean:
      "No money left the company this quarter for this. It is an accounting charge for equipment bought and paid for in earlier years.",
  },
  financeCosts: {
    label: "Interest cost",
    meaning: "What the company paid its lenders for the money it has borrowed.",
    doesntMean:
      "This is the cost of the debt, not the debt itself. How much the company owes is only reported once a year.",
  },
  operatingProfit: {
    label: "Operating profit",
    meaning:
      "What the company reported as profit from trading, before interest, tax and one-off items are counted.",
    doesntMean:
      "This figure is reported as filed and does not reconcile against the other lines on this card, so read it on its own rather than checking it against them.",
  },
  profitBeforeTax: {
    label: "Profit before tax",
    meaning: "What was left over this quarter once every cost had been paid, but before tax.",
    doesntMean: "This is not what shareholders end up with. Tax still comes out of it.",
  },
  tax: {
    label: "Tax",
    meaning: "The tax charged against this quarter's profit.",
    doesntMean:
      "This is the charge booked in the accounts, not necessarily the cash handed to the tax office in the same three months.",
  },
  netProfit: {
    label: "Net profit",
    meaning:
      "The profit left after every cost and after tax — the figure most people mean by what a company made.",
    doesntMean:
      "Profit is not cash. A company can report a profit and still have less money in the bank than when the quarter started.",
  },
  operatingMargin: {
    label: "Operating margin",
    meaning:
      "Out of every 100 rupees of sales, how much was left as trading profit before interest and tax.",
    doesntMean:
      "A margin says nothing about size. A very small company and a very large one can have exactly the same margin.",
  },
  netMargin: {
    label: "Net margin",
    meaning:
      "Out of every 100 rupees of sales, how much the company kept as profit once everything, including tax, had been paid.",
    doesntMean:
      "A high margin is not the same as a lot of money. How much was actually earned depends on how much was sold.",
  },

  // ── Banking ─────────────────────────────────────────────────────────────────────────────────────
  interestEarned: {
    label: "Interest earned",
    meaning:
      "What the bank charged borrowers in interest on their loans, plus the interest it earned on money it has invested.",
    doesntMean:
      "This is not the bank's profit on lending. What it pays its own depositors has not been taken out yet.",
  },
  interestExpended: {
    label: "Interest paid out",
    meaning: "What the bank paid its depositors and its own lenders for the money it holds.",
    doesntMean:
      "This is a cost of doing business, not a loss. A bank paying more interest is usually holding more deposits.",
  },
  netInterestIncome: {
    label: "Net interest income",
    meaning:
      "The gap between what the bank earned on its loans and what it paid on deposits — a lender's main source of income.",
    doesntMean:
      "This is income, not profit. Staff, branches and bad loans still have to be paid for out of it.",
  },
  totalIncome: {
    label: "Total income",
    meaning:
      "Everything the business took in this quarter — interest, fees, commissions and every other source added together.",
    doesntMean: "This is money coming in, not money kept. Every cost still has to come out of it.",
  },
  staffCost: {
    label: "Staff cost",
    meaning: "Wages, bonuses and benefits paid to the people who work there.",
    doesntMean:
      "This is one part of running costs and is already counted inside them, so it should not be added to them again.",
  },
  operatingExpenses: {
    label: "Running costs",
    meaning:
      "What it cost to run the bank this quarter — staff, branches, technology and administration.",
    doesntMean:
      "Interest paid to depositors is not in here. That is counted separately, as the cost of the money the bank lends out.",
  },
  provisions: {
    label: "Bad-loan charge",
    meaning:
      "Money set aside this quarter to cover loans the bank now expects will not be repaid in full.",
    doesntMean:
      "This is not a loss that has already happened. It is a cushion set aside in advance, and it can be released again if the borrowers pay.",
  },
  exceptionalItems: {
    label: "One-off items",
    meaning: "Gains or costs the bank has flagged as unusual and not part of ordinary trading.",
    doesntMean:
      "Calling something one-off does not make it unimportant. It means the bank does not expect it to happen again.",
  },
  preProvisionOperatingProfit: {
    label: "Profit before bad-loan charges",
    meaning:
      "What the bank made from its business this quarter, before setting anything aside for loans that may go bad.",
    doesntMean:
      "This is not profit the bank keeps. Bad-loan charges and tax still come out of it.",
  },
  grossNpaAmount: {
    label: "Bad loans",
    meaning: "The total value of loans where the borrower has stopped keeping up repayments.",
    doesntMean:
      "A bad loan is not money lost. Banks recover part of it, and some borrowers start paying again.",
  },
  netNpaAmount: {
    label: "Bad loans not yet covered",
    meaning: "The part of the bad-loan pile the bank has not already set money aside against.",
    doesntMean:
      "This is not the bank's expected loss. Most of these loans have property or other security standing behind them.",
  },
  grossNpaRatio: {
    label: "Bad-loan share",
    meaning:
      "Out of every 100 rupees the bank has lent out, how much is owed by a borrower who has stopped keeping up repayments.",
    doesntMean:
      "This describes the loan book as it stands today. On its own it does not say whether the problem is growing or shrinking.",
  },
  netNpaRatio: {
    label: "Uncovered bad-loan share",
    meaning:
      "Out of every 100 rupees lent, how much sits in bad loans the bank has not yet set money aside against.",
    doesntMean:
      "A low figure means the bank has provided for the problem, not that the problem is small.",
  },
  provisionCoverageRatio: {
    label: "Bad-loan cover",
    meaning: "Of the money tied up in bad loans, what share the bank has already set aside to absorb.",
    doesntMean:
      "High cover is not a verdict on the bank. It says how cautiously it has provided, not how good its lending was.",
  },
  cet1Ratio: {
    label: "Core capital",
    meaning:
      "The bank's own money, measured on the strictest definition regulators use, as a share of the lending it has to support.",
    doesntMean:
      "This is not cash sitting in a vault. It measures how much of the bank's lending is funded by its owners rather than borrowed.",
  },
  returnOnAssetsQuarterly: {
    label: "Return on assets",
    meaning:
      "Out of every 100 rupees the bank has lent or invested, how much it earned as profit in this quarter.",
    doesntMean:
      "This is one quarter's figure, not a yearly rate, so it cannot be compared with an annual return without adjusting for that.",
  },
  costToIncomeRatio: {
    label: "Cost-to-income",
    meaning: "Out of every 100 rupees the bank took in, how much went on running the place.",
    doesntMean:
      "Above 100 rupees means costs exceeded income for the quarter. That happens, and it is not by itself a sign of failure.",
  },

  // ── NBFC ────────────────────────────────────────────────────────────────────────────────────────
  interestIncome: {
    label: "Interest income",
    meaning: "What the lender charged its borrowers in interest this quarter.",
    doesntMean:
      "This is income, not profit. What the lender pays on its own borrowings has not been taken out yet.",
  },
  feeAndCommissionIncome: {
    label: "Fees and commissions",
    meaning: "Money earned from charges and services rather than from lending itself.",
    doesntMean:
      "Fee income is not guaranteed to repeat. It depends on how much new business was written in the quarter.",
  },
  netGainOnFairValueChanges: {
    label: "Investment value changes",
    meaning:
      "Gains or losses from the lender's investments being revalued, whether or not anything was actually bought or sold.",
    doesntMean:
      "Nothing has necessarily changed hands. A revaluation can reverse in the next quarter just as easily.",
  },
  impairmentOnFinancialInstruments: {
    label: "Expected loan losses",
    meaning:
      "Money set aside this quarter for loans the lender expects will not be repaid in full.",
    doesntMean:
      "This is a forward-looking estimate, not a loss already suffered, and it can be written back if borrowers pay.",
  },
  otherExpenses: {
    label: "Other running costs",
    meaning:
      "Administration, rent, technology and the other everyday costs of keeping the business running.",
    doesntMean:
      "This groups several different things together, so a change in it does not point to any one cause.",
  },
  totalExpenses: {
    label: "Total costs",
    meaning:
      "Everything it cost to run the lender this quarter — borrowing costs, expected loan losses, staff and overheads added together.",
    doesntMean:
      "Rising costs are not automatically bad. A lender with a bigger loan book pays more to fund it.",
  },

  // ── Life insurance ──────────────────────────────────────────────────────────────────────────────
  grossPremiumIncome: {
    label: "Premiums collected",
    meaning:
      "The total premium policyholders paid this quarter, before any share was passed on to reinsurers.",
    doesntMean:
      "Premium collected is not profit, or even income the insurer keeps. Most of it is set aside to pay claims in future years.",
  },
  netPremiumIncome: {
    label: "Premiums kept",
    meaning:
      "Premiums collected, less the share handed to reinsurers — the part this insurer carries the risk on itself.",
    doesntMean:
      "Passing premium to a reinsurer is not money lost. It is the price of handing on part of the risk.",
  },
  incomeFirstYearPremium: {
    label: "New-policy premiums",
    meaning: "Premium from policies sold within the last year, paying their first instalment.",
    doesntMean:
      "New business is not automatically better business. A policy only becomes worth writing if the customer keeps paying.",
  },
  incomeRenewalPremium: {
    label: "Renewal premiums",
    meaning:
      "Premium from customers who are continuing to pay on policies they bought in earlier years.",
    doesntMean:
      "A large renewal book reflects selling done in the past, not how well the insurer is selling now.",
  },
  incomeSinglePremium: {
    label: "One-payment premiums",
    meaning:
      "Premium from policies paid for in full in a single instalment rather than year after year.",
    doesntMean:
      "These do not repeat. A quarter lifted by single premiums has not built any income for future quarters.",
  },
  reinsuranceCeded: {
    label: "Premium passed to reinsurers",
    meaning:
      "The share of premium handed to other insurers in exchange for them carrying part of the risk.",
    doesntMean:
      "This is not a cost of failure. Passing on risk is ordinary practice and is what protects an insurer against one very large claim.",
  },
  incomeFromInvestments: {
    label: "Investment income",
    meaning:
      "What the insurer earned on the money it holds — interest, dividends and gains on its investments.",
    doesntMean:
      "Much of this belongs to policyholders rather than to shareholders, so it does not all reach profit.",
  },
  totalRevenuePolicyholders: {
    label: "Total policyholder income",
    meaning:
      "Everything that came into the fund that pays claims this quarter — premiums kept plus investment income.",
    doesntMean:
      "This is money arriving in the fund that pays policyholders, not money the insurer has earned for itself.",
  },
  totalCommission: {
    label: "Commission paid",
    meaning: "What the insurer paid agents, banks and brokers for selling its policies.",
    doesntMean:
      "Commission is heaviest on newly sold policies, so a rise usually reflects more selling rather than worse terms.",
  },
  insuranceRunningCosts: {
    label: "Running costs",
    meaning:
      "What it cost to run the insurance business this quarter — staff, offices and administration.",
    doesntMean:
      "Claims are not in here. This is the cost of running the company, not the cost of what it insures.",
  },
  benefitsPaidNet: {
    label: "Claims and benefits paid",
    meaning:
      "What the insurer paid out this quarter on death claims, maturing policies, surrenders and other benefits.",
    doesntMean:
      "A rise is not a sign of trouble. Payouts grow naturally as an insurer's book of policies gets older and larger.",
  },
  changeInValuationOfLiabilities: {
    label: "Change in money set aside for future claims",
    meaning:
      "How much was added to, or released from, the reserve the insurer holds to pay claims falling due in later years.",
    doesntMean:
      "This is not money paid out. It is a reserve moving, and it can be released again in a later quarter.",
  },
  solvencyRatio: {
    label: "Solvency",
    meaning:
      "How many times over the insurer holds the capital the regulator requires it to keep.",
    doesntMean:
      "This is a multiple, not a percentage. The regulator's floor in India is 1.5 times, so a figure close to that is a requirement being met, not a failure.",
  },
  persistencyRatio13Month: {
    label: "Policies still being paid after 1 year",
    meaning:
      "Of the policies sold about a year ago, the share on which customers are still paying premiums.",
    doesntMean:
      "This measures customers staying, not how profitable those policies are for the insurer.",
  },
  persistencyRatio25Month: {
    label: "Policies still being paid after 2 years",
    meaning:
      "Of the policies sold about two years ago, the share on which customers are still paying premiums.",
    doesntMean:
      "A fall between the one-year and two-year figures is normal. Some customers stop paying at every stage.",
  },
  persistencyRatio37Month: {
    label: "Policies still being paid after 3 years",
    meaning:
      "Of the policies sold about three years ago, the share on which customers are still paying premiums.",
    doesntMean:
      "This reflects policies sold three years ago and says nothing about how well the insurer is selling today.",
  },
  persistencyRatio49Month: {
    label: "Policies still being paid after 4 years",
    meaning:
      "Of the policies sold about four years ago, the share on which customers are still paying premiums.",
    doesntMean:
      "This reflects policies sold four years ago and says nothing about how well the insurer is selling today.",
  },
  persistencyRatio61Month: {
    label: "Policies still being paid after 5 years",
    meaning:
      "Of the policies sold about five years ago, the share on which customers are still paying premiums.",
    doesntMean:
      "Long-run persistency is shaped by decisions taken years ago and moves very slowly in response to anything happening now.",
  },
  newBusinessPremiumPct: {
    label: "Share from new policies",
    meaning:
      "Of all the premium collected, how much came from policies sold in the last year rather than from renewals.",
    doesntMean:
      "A high share is not automatically growth. It can also mean older policies are lapsing faster than new ones are sold.",
  },
  expenseRatioPolicyholders: {
    label: "Cost of running the book",
    meaning:
      "Out of every 100 rupees of premium, how much went on commission and running costs rather than towards claims.",
    doesntMean:
      "A low figure is not a promise of profit. Claims are the far larger cost and are not counted here.",
  },

  // ── General insurance ───────────────────────────────────────────────────────────────────────────
  grossPremiumsWritten: {
    label: "Premiums sold",
    meaning:
      "The total value of policies sold this quarter, before any share was passed on to reinsurers.",
    doesntMean:
      "This is business written, not money earned. A one-year policy sold in March earns its premium across the following twelve months.",
  },
  netPremiumWritten: {
    label: "Premiums sold and kept",
    meaning: "Policies sold this quarter, less the share of them passed to reinsurers.",
    doesntMean:
      "This is still business written rather than earned, so it does not line up with the claims charged in the same quarter.",
  },
  premiumEarned: {
    label: "Premiums earned this quarter",
    meaning:
      "The share of premium that actually relates to the cover the insurer provided during these three months.",
    doesntMean:
      "This is the figure claims are measured against, and it can differ a great deal from what was sold in the same quarter.",
  },
  claimsPaid: {
    label: "Claims paid",
    meaning: "Money actually paid out to policyholders on claims during the quarter.",
    doesntMean:
      "This is cash out of the door. It does not include claims that have already happened but have not been settled yet.",
  },
  incurredClaims: {
    label: "Claims charged",
    meaning:
      "The cost of claims belonging to this quarter, including those reported but not yet paid.",
    doesntMean:
      "Part of this has not been paid and is an estimate, which can be revised up or down in later quarters.",
  },
  netCommission: {
    label: "Commission",
    meaning:
      "What the insurer paid intermediaries for selling its policies, less the commission it received back from reinsurers.",
    doesntMean:
      "Commission tracks how much was sold and through which channel, not how good the business sold was.",
  },
  underwritingProfitOrLoss: {
    label: "Underwriting result",
    meaning:
      "Whether the insurance business itself made or lost money this quarter — premiums earned, less claims, commission and running costs, before any investment income.",
    doesntMean:
      "An underwriting loss does not mean the insurer lost money overall. Indian general insurers routinely underwrite at a loss and make their profit on investments instead.",
  },
  combinedRatio: {
    label: "Combined ratio",
    meaning:
      "Out of every 100 rupees of premium earned, how much went out in claims, commission and running costs.",
    doesntMean:
      "Above 100 rupees means the insurance business paid out more than it took in. That is common in this industry and is usually offset by investment income.",
  },
  incurredClaimRatio: {
    label: "Claims share",
    meaning: "Out of every 100 rupees of premium earned, how much went out in claims.",
    doesntMean:
      "A low claims share in one quarter can simply mean claims have happened but have not been reported yet.",
  },
  expensesOfManagementRatio: {
    label: "Cost share",
    meaning:
      "Out of every 100 rupees of premium, how much went on commission and on running the business.",
    doesntMean:
      "Claims are not counted here, so this figure on its own does not say whether the insurance was priced well.",
  },
  netRetentionRatio: {
    label: "Risk kept",
    meaning:
      "Of the policies it sold, what share of the risk the insurer kept rather than passing on to reinsurers.",
    doesntMean:
      "Keeping more risk is not confidence and passing more on is not weakness. It is a choice about how much a single very large claim should be able to hurt.",
  },
} as const satisfies Record<string, MetricGloss>;

/** Every metric the product can gloss. The manifest types its `key` as this, so a manifest metric
 *  with no gloss is a COMPILE ERROR rather than a bare label at runtime. */
export type MetricKey = keyof typeof QUARTER_METRIC_GLOSSES;

export const METRIC_KEYS = Object.keys(QUARTER_METRIC_GLOSSES) as MetricKey[];

/** The gloss for `key`. Total by construction — `MetricKey` cannot name a missing entry. */
export const metricGloss = (key: MetricKey): MetricGloss => QUARTER_METRIC_GLOSSES[key];
