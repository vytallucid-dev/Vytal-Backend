// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockFundamentals — the latest annual + latest quarter headline financials.
//
// FIVE FAMILIES, ONE RENDERER. buildFundamentalsView dispatches on industryType (non-financial / banking /
// nbfc / life insurance / general insurance) and populates exactly one payload; a bank's headline numbers
// (NIM, GNPA, capital adequacy) are not a manufacturer's (margins, ROCE, debt/equity). Rather than five
// renderers, the family's headline fields are declared as [label, key] tables below and read off the
// payload — so an unmapped field is honestly "not available" instead of silently missing.
//
// SHARES ITS READ. buildFundamentalsView also backs getStockQuarterlyResults; both go through
// ctx.once(...) so a conversation asking for fundamentals AND quarterly results pays for ONE read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildFundamentalsView } from "../../scoring/read/fundamentals-view.service.js";
import type {
  AnnualSnapshot,
  BankingAnnual,
  BankingQuarter,
  FundamentalsView,
  GeneralInsuranceAnnual,
  GeneralInsuranceQuarter,
  IndustryFamily,
  LifeInsuranceAnnual,
  LifeInsuranceQuarter,
  NbfcAnnual,
  NbfcQuarter,
  QuarterPoint,
} from "../../scoring/read/fundamentals-view.types.js";
import { notInUniverse } from "./boundary.js";
import { kvLine, croreStr, pctPoint, numStr, signedPct, isNum, BARE_TICKER_DIRECT, NA } from "./shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  basis?: unknown;
}

// ═══ ★★★ THIS DESCRIPTION WAS REWRITTEN AGAINST A MEASURED ZERO. ★★★ ═══════════════════════════════
//
// getStockFundamentals was called EXACTLY NEVER — 0 times across 17 live sessions and 54 tool rounds —
// while getStockQuarterlyResults, which runs the SAME read through the same ctx.once key, was called 4
// times. Identical data, identical cost, one gets reached and the other does not. That isolates the
// cause to this string.
//
// TWO FAILURES IT PRODUCED, both from the live transcript:
//   · "Tell me the annual report for Reliance" → ZERO tool calls, and the model then told the reader
//     "Vytal doesn't hold or display full annual reports" — while 342 tokens of Reliance's actual
//     annual figures sat one call away. A capability rationalised into a product limitation, the exact
//     failure §THE PAGES exists to prevent.
//   · "What's the dividend history of TCS" → getCorporateEvents only. The payout ratio and the dividend
//     yield were never fetched. ⚠ THE WORD "DIVIDEND" APPEARED ZERO TIMES IN THE OLD DESCRIPTION while
//     this tool renders BOTH. That is the whole failure in one line.
//
// ── THE SHAPE IS LOAD-BEARING: TRIGGERS FIRST, MECHANICS SECOND, BOUNDARY LAST. ────────────────────
// The old opening was an abstract capability statement ("Get a covered stock's headline FINANCIALS"),
// which describes what the tool IS rather than what a reader SAYS. Flash-Lite keys hard on how a
// description OPENS — recorded three times now in this codebase: searchStocks firing on bare tickers
// (shared.ts §BARE_TICKER_DIRECT), screenStocks inventing thresholds until the rule moved into the
// PARAMETER descriptions, and this. So the reader's own phrasings lead, and the abstraction follows.
//
// ⚠ THE TRIGGERS ARE DELIBERATELY SPECIFIC FINANCIAL LINES, NOT BROAD ONES. "How is TCS doing?" must
// still route to getStockFacts — a description broad enough to catch that would cost a tool round on
// every casual question, and every round resends the whole prompt (~16,000 tokens measured). The
// boundary sentence naming getStockFacts and getStockQuarterlyResults is what holds that line, and it
// stays last so it is the most recent thing read before the model chooses.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const DESCRIPTION =
  "Get a company's ANNUAL REPORT FIGURES and its latest reported quarter. Call this for \"the annual " +
  "report\", \"yearly results\", \"how much does it earn\", \"how profitable is it\" — and for any single " +
  "financial line: REVENUE, PROFIT, MARGINS, RETURN ON EQUITY or CAPITAL, DEBT, CASH FLOW, CAPEX, " +
  "EARNINGS PER SHARE, BOOK VALUE, DIVIDEND PAYOUT, DIVIDEND YIELD. For a BANK those become deposits, " +
  "advances, credit-deposit ratio and bad-loan ratios; for an NBFC its loan book and spread; for an " +
  "INSURER premium income and solvency. " +
  "★ DIVIDENDS SPLIT ACROSS TWO TOOLS: getCorporateEvents has the individual PAYMENTS and their dates; " +
  "the payout RATIO and the YIELD are HERE, and a dividend question usually wants both. " +
  "★ VYTAL HOLDS THE ANNUAL REPORT'S FIGURES, NOT ITS PROSE — no management commentary, no segment " +
  "breakdown, no auditor's note, but the financial statements ARE here. Answer a request for an annual " +
  "report with the numbers, never by saying Vytal has none. " +
  "For the quarter-by-quarter TREND use getStockQuarterlyResults; for the health SCORE, the pillars, or " +
  "how a company is doing overall, use getStockFacts. An uncovered symbol returns an honest 'not " +
  "covered'; an undisclosed figure reads 'not available'." +
  BARE_TICKER_DIRECT;

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker, e.g. "HDFCBANK".' },
    basis: { type: "string", enum: ["consolidated", "standalone"], description: "Optional reporting basis; defaults to whichever the company primarily reports." },
  },
  required: ["symbol"],
  additionalProperties: false,
} as const;

type Row = Record<string, unknown>;
type Kind = "pct" | "money_cr" | "num" | "ratio" | "signed_pct" | "rupee";

// ═══ ★ COLUMN 2 IS TYPE-CHECKED AGAINST THE FAMILY'S OWN VIEW TYPE. ═══════════════════════════════
//
// The tables below used to be `Record<string, [label, key, kind][]>` — column 2 a bare `string`, read
// off a `Record<string, unknown>` payload at runtime. Nothing could tell a key that does not exist from
// a key whose value is null, so a typo rendered "not available" and looked exactly like an undisclosed
// figure. Three of five families shipped that way; GICRE's entire annual block read unavailable while
// premium and profit sat in the loaded view.
//
// TWO FIELD FORMS, and both go through the family's type `T`, which is what makes this work:
//
//   ["Net profit", "netProfit", "money_cr"]              ← KEY form. `Extract<keyof T, string>`, so a
//                                                          key T does not carry does not compile.
//   ["13-month persistency", (a) => a.persistency.m13, "pct"]
//                                                       ← ACCESSOR form. For anything the key form
//                                                          cannot address — a NESTED object, a derived
//                                                          value. The body is checked against T, so a
//                                                          wrong path is the same compile error.
//
// The accessor form is what lets the life-insurance persistency ladder (`persistency.m13…m61`, the most
// distinctive quality metric that family has, across four insurers) render at all. It does NOT weaken
// the key form: a plain string in column 2 is still checked as `keyof T`. Nothing here can be `any` —
// `table<T>()` pins T at the declaration, and `satisfies` below pins the family set.
//
// ⇒ THE FAMILY'S INTERFACE IS NOW THE AUTHORITY, not a comment asking you to go and check it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One rendered line. Column 2 is either a key of `T` or a reader over `T` — never a loose string. */
type Field<T> =
  | readonly [label: string, key: Extract<keyof T, string>, kind: Kind]
  | readonly [label: string, read: (row: T) => unknown, kind: Kind];

/** Pins `T` at the declaration site so every row in the table is checked against that family's type. */
const table = <T,>(...rows: Field<T>[]): readonly Field<T>[] => rows;

/** Read a field off the runtime payload. The payload is `Record<string, unknown>` here because the
 *  renderer is family-agnostic; the TYPE safety was bought at the table, which is where it belongs. */
const readField = <T,>(row: Row, ref: Field<T>[1]): unknown =>
  typeof ref === "function" ? (ref as (r: T) => unknown)(row as T) : row[ref as string];

const fmt = (v: unknown, kind: Kind): string =>
  kind === "pct" ? pctPoint(v)
    : kind === "signed_pct" ? signedPct(v)
    : kind === "money_cr" ? croreStr(v)
    : kind === "rupee" ? (isNum(v) ? `₹${numStr(v, 2)}` : NA)
    : numStr(v, 2);

// ═══ THE HISTORY THIS TYPE-CHECK EXISTS TO END ════════════════════════════════════════════════════
//
// ★ NOT A HYPOTHETICAL — IT SHIPPED. These entries named keys that DO NOT EXIST on the object they
// were read from, so a figure sitting in the payload reached the reader as "not available":
//     life_insurance      "profitAfterTax"     → the payload calls it `netProfit`   (₹1,910 cr, hidden)
//     general_insurance   "profitAfterTax"     → `netProfit`                        (₹8,392 cr, hidden)
//     general_insurance   "netPremiumIncome"   → `netPremium`                       (₹40,571 cr, hidden)
// GICRE's ENTIRE annual block was combined ratio + solvency, with premium and profit both reading
// "not available" while both sat in the loaded view. That is worse than an omission: an honest-empty is
// a CLAIM ("Vytal does not have this"), and a false one teaches the reader we hold less than we do.
// Every one of those is now a compile error at the row that would cause it.
//
// ⚠ A SECOND, QUIETER FORM THE COMPILER CANNOT CATCH: naming a key the family genuinely does not have
// AND the type does not declare — that is caught — versus naming an INAPPLICABLE concept the type
// happens to carry. The nbfc quarter table asked for `gnpaPct`/`nnpaPct`, which NbfcQuarter does not
// declare at all (fundamentals-view.types.ts §NBFC: NBFCs here have no NPA regime), so that one is now
// a compile error too. But "Gross NPA: not available" on an NBFC would have been a TRUE sentence that
// misinforms — it reads as a missing measurement rather than an inapplicable concept. Judgement about
// what BELONGS in a family's table is still a human call; the type only guarantees that what you name
// exists.

/** Headline ANNUAL fields per family. Each table is checked against that family's annual type.
 *  Exported for verify-fundamentals-fields.ts, which walks every row against a LIVE payload. */
export const ANNUAL_FIELDS = {
  // ★ THE SIX ADDED LINES (revenue · capex · total assets · total debt · EPS · book value) were ALREADY
  //   IN THE LOADED PAYLOAD and were simply never printed — buildFundamentalsView returns ~4,400 tokens
  //   for TCS and this renderer was emitting 13 of its 48 annual keys. They cost no read and no prompt
  //   tokens; they are paid for only on a turn that actually calls the tool. Revenue in particular was
  //   the conspicuous hole: the annual block carried net profit and margins but not the top line.
  non_financial: table<AnnualSnapshot>(
    ["Return on equity", "roe", "pct"], ["Return on capital employed", "roce", "pct"],
    ["Operating margin", "operatingMargin", "pct"], ["Net margin", "netMargin", "pct"],
    ["Revenue growth YoY", "revenueGrowthYoy", "signed_pct"], ["Profit growth YoY", "profitGrowthYoy", "signed_pct"],
    ["Debt to equity", "debtToEquity", "ratio"], ["Interest coverage", "interestCoverage", "ratio"],
    ["Current ratio", "currentRatio", "ratio"],
    ["Revenue", "revenue", "money_cr"], ["Net profit", "netProfit", "money_cr"],
    ["Free cash flow", "fcf", "money_cr"], ["Cash from operations", "cashFromOperating", "money_cr"],
    ["Capital expenditure", "capex", "money_cr"],
    ["Total assets", "totalAssets", "money_cr"], ["Total debt", "totalDebt", "money_cr"],
    ["Earnings per share", "basicEps", "rupee"], ["Book value per share", "bookValuePerShare", "rupee"],
    ["Dividend payout", "dividendPayout", "pct"],
  ),
  // ★ THE FRANCHISE LINES ARE THE POINT (deposits · advances · credit-deposit ratio). A bank's annual
  //   block previously ran P&L-only and — like non_financial's missing top line — carried NO NET PROFIT
  //   at all, only the pre-provision figure above it. 21 of 59 loaded keys printed against
  //   non_financial's 27 of 50 was a visible inconsistency across 26 banks in two peer groups.
  //
  // ⚠ ANNUAL ASSET QUALITY AND CAPITAL ARE DELIBERATELY *NOT* ADDED. gnpaPct / nnpaPct / pcr / cet1 /
  //   tier1 are already printed by QUARTER_FIELDS.banking below, at the LATEST quarter — a more current
  //   reading of the same thing. Adding the year-end copies would spend ~35 tokens per call to say a
  //   near-identical sentence twice. Lending, funding and per-share are what the quarter block does NOT
  //   carry, so that is what goes here.
  banking: table<BankingAnnual>(
    ["Return on equity", "roe", "pct"], ["Return on assets (disclosed)", "roaDisclosed", "pct"],
    ["Net interest margin", "nim", "pct"], ["Cost to income", "costToIncome", "pct"],
    ["Credit cost", "creditCostPct", "pct"], ["Net interest income", "nii", "money_cr"],
    ["Other income", "otherIncome", "money_cr"], ["Total income", "totalIncome", "money_cr"],
    ["Pre-provision operating profit", "ppop", "money_cr"], ["Provisions", "provisions", "money_cr"],
    ["Net profit", "netProfit", "money_cr"], ["Profit growth YoY", "patGrowthYoy", "signed_pct"],
    ["Deposits", "deposits", "money_cr"], ["Advances", "advances", "money_cr"],
    ["Credit-deposit ratio", "creditDepositRatio", "pct"],
    ["Deposit growth YoY", "depositGrowthYoy", "signed_pct"], ["Advances growth YoY", "advanceGrowthYoy", "signed_pct"],
    ["Total assets", "totalAssets", "money_cr"],
    ["Earnings per share", "basicEps", "rupee"], ["Book value per share", "bookValuePerShare", "rupee"],
  ),
  // ⚠ `roa` and `nii` were named here and exist on NEITHER NbfcAnnual field — an NBFC's annual object
  //   carries roe / nim / spread / creditCostPct and no net-interest-income line at all. Both printed a
  //   permanent "not available" for every NBFC in the universe. Replaced with keys the family HAS.
  nbfc: table<NbfcAnnual>(
    ["Return on equity", "roe", "pct"], ["Net interest margin", "nim", "pct"],
    ["Lending spread", "spread", "pct"], ["Credit cost", "creditCostPct", "pct"],
    ["Total income", "totalIncome", "money_cr"], ["Net profit", "netProfit", "money_cr"],
    ["Loan book (AUM)", "loans", "money_cr"],
    ["Borrowings to equity (times)", "borrowingsToEquity", "ratio"],
    ["Provisions", "provisions", "money_cr"],
  ),
  // ★ THE PERSISTENCY LADDER. `persistency` is a NESTED object on LifeInsuranceAnnual, which the old
  //   flat [label, key] table could not address at all — so the single most distinctive quality metric
  //   this family has never reached the model, across four life insurers. The ACCESSOR form reaches it
  //   and is type-checked doing so: rename a leg on PersistencyLadder and these five rows stop
  //   compiling.
  //
  //   WHY ALL FIVE LEGS AND NOT JUST 13-MONTH. The ladder IS the metric — 13-month says how many
  //   policies survived the first renewal, 61-month says how many are still paying five years on, and
  //   the SHAPE between them is what distinguishes a book sold well from a book sold hard. One leg is a
  //   number; five are a reading. Each is individually null-guarded at the source (a suspect filing
  //   nulls that leg only), so a partial ladder renders honestly rather than being suppressed whole.
  //   Cost: ~40 tokens, and only on a turn that actually calls this tool for a life insurer.
  life_insurance: table<LifeInsuranceAnnual>(
    ["Return on equity", "roe", "pct"], ["Solvency ratio", "solvencyRatio", "ratio"],
    ["Net premium income", "netPremiumIncome", "money_cr"], ["Profit after tax", "netProfit", "money_cr"],
    ["New business premium share", "newBusinessPremiumPct", "pct"],
    ["Persistency — 13 month", (a) => a.persistency?.m13, "pct"],
    ["Persistency — 25 month", (a) => a.persistency?.m25, "pct"],
    ["Persistency — 37 month", (a) => a.persistency?.m37, "pct"],
    ["Persistency — 49 month", (a) => a.persistency?.m49, "pct"],
    ["Persistency — 61 month", (a) => a.persistency?.m61, "pct"],
  ),
  // ⚠ BOTH money keys were wrong here: the payload calls them `netPremium` and `netProfit`. GICRE's whole
  //   annual block therefore read combined-ratio + solvency with premium and profit "not available".
  general_insurance: table<GeneralInsuranceAnnual>(
    ["Return on equity", "roe", "pct"], ["Combined ratio", "combinedRatio", "pct"],
    ["Solvency ratio", "solvencyRatio", "ratio"], ["Net premium", "netPremium", "money_cr"],
    ["Profit after tax", "netProfit", "money_cr"],
  ),
} satisfies Record<IndustryFamily, readonly Field<never>[]>;

/** Headline LATEST-QUARTER fields per family. Each table is checked against that family's quarter type.
 *  Exported for verify-fundamentals-fields.ts (same reason as ANNUAL_FIELDS). */
export const QUARTER_FIELDS = {
  non_financial: table<QuarterPoint>(
    ["Revenue", "revenue", "money_cr"], ["Operating profit", "operatingProfit", "money_cr"],
    ["Net profit", "netProfit", "money_cr"], ["Operating margin", "operatingMargin", "pct"],
    ["Net margin", "netMargin", "pct"], ["Revenue YoY", "revenueYoy", "signed_pct"], ["Profit YoY", "profitYoy", "signed_pct"],
  ),
  banking: table<BankingQuarter>(
    ["Net interest income", "nii", "money_cr"], ["Total income", "totalIncome", "money_cr"],
    ["Pre-provision operating profit", "ppop", "money_cr"], ["Provisions", "provisions", "money_cr"],
    ["Net profit", "netProfit", "money_cr"], ["Gross NPA", "gnpaPct", "pct"], ["Net NPA", "nnpaPct", "pct"],
    ["Provision coverage ratio", "pcr", "pct"], ["CET1 capital", "cet1", "pct"], ["Tier-1 capital", "tier1", "pct"],
  ),
  // ⚠ `gnpaPct`/`nnpaPct` are not on NbfcQuarter and never will be — NBFCs here have no NPA regime at
  //   all (fundamentals-view.types.ts §NBFC). Printing "Gross NPA: not available" for one is a TRUE
  //   sentence that misinforms: it reads as a missing measurement rather than an inapplicable concept.
  //   Replaced with the lending P&L the family actually reports.
  nbfc: table<NbfcQuarter>(
    ["Total income", "totalIncome", "money_cr"], ["Net interest income", "nii", "money_cr"],
    ["Finance costs", "financeCosts", "money_cr"],
    ["Impairment on financial instruments", "impairmentOnFinancialInstruments", "money_cr"],
    ["Net profit", "netProfit", "money_cr"], ["Net margin", "netMargin", "pct"],
    ["Revenue YoY", "revenueYoy", "signed_pct"], ["Profit YoY", "patYoy", "signed_pct"],
  ),
  // The quarterly 13-month leg is the ONE persistency figure filed quarterly (the full ladder is annual
  // — see ANNUAL_FIELDS above). Solvency rides beside it because both are read against a regulatory
  // floor, and the intra-year reading is the point: a quarter is where a solvency slip shows first.
  life_insurance: table<LifeInsuranceQuarter>(
    ["Net premium income", "netPremiumIncome", "money_cr"], ["Profit after tax", "netProfit", "money_cr"],
    ["Solvency ratio", "solvencyRatio", "ratio"], ["Persistency — 13 month", "persistency13M", "pct"],
  ),
  general_insurance: table<GeneralInsuranceQuarter>(
    ["Net premium", "netPremium", "money_cr"], ["Profit after tax", "netProfit", "money_cr"],
    ["Combined ratio", "combinedRatio", "pct"],
  ),
} satisfies Record<IndustryFamily, readonly Field<never>[]>;

/** The one populated family payload (they are mutually exclusive by construction). */
export function familyPayload(v: FundamentalsView): { quarters: Row[]; annual: Row | null; yields: Row | null } | null {
  const p = (v.nonFinancial ?? v.banking ?? v.nbfc ?? v.lifeInsurance ?? v.generalInsurance) as Row | null;
  if (!p) return null;
  return {
    quarters: (p.quarters as Row[] | undefined) ?? [],
    annual: (p.annual as Row | null | undefined) ?? null,
    yields: (p.yields as Row | null | undefined) ?? null,
  };
}

/** Shared, memoised read — getStockQuarterlyResults uses the SAME entry so one turn pays once. */
export function readFundamentals(ctx: ToolContext, symbol: string, basis?: "consolidated" | "standalone") {
  return ctx.once(`fundamentals:${symbol}:${basis ?? "default"}`, () => buildFundamentalsView(symbol, basis ? { basis } : {}));
}

/** The rendered block. Exported as `renderFundamentals` so the field gate can diff it per family. */
export function renderFundamentals(v: FundamentalsView): string {
  const L: string[] = [`=== VYTAL FUNDAMENTALS: ${v.symbol} (${v.name}) ===`];
  L.push(kvLine("Industry family", v.family));
  L.push(kvLine("Reporting basis", v.basis));
  L.push(kvLine("Bases available", v.basisAvailable.length ? v.basisAvailable.join(", ") : null));
  L.push(kvLine("History depth", `${v.historyDepth.quarters} quarters, ${v.historyDepth.years} years`));
  if (v.notes.length) L.push(`Data notes: ${v.notes.join(" · ")}`);

  if (!v.built) {
    L.push(`Detailed financials for the ${v.family} family are not yet built in Vytal — the figures are ${NA}. Say so plainly rather than estimating.`);
    return L.join("\n");
  }
  const p = familyPayload(v);
  if (!p) {
    L.push(`No financial payload is on file — figures are ${NA}.`);
    return L.join("\n");
  }

  const aFields: readonly Field<never>[] = ANNUAL_FIELDS[v.family] ?? [];
  L.push("");
  if (p.annual) {
    L.push(`[LATEST FULL YEAR — ${String(p.annual.fiscalYear ?? NA)}]`);
    for (const [label, ref, kind] of aFields) L.push(kvLine(label, fmt(readField(p.annual, ref), kind)));
  } else {
    L.push(`[LATEST FULL YEAR] ${NA} — no annual statement on file.`);
  }

  const latestQ = p.quarters.length ? p.quarters[p.quarters.length - 1] : null;
  const qFields: readonly Field<never>[] = QUARTER_FIELDS[v.family] ?? [];
  L.push("");
  if (latestQ) {
    L.push(`[LATEST QUARTER — ${String(latestQ.periodKey ?? NA)} (reported ${String(latestQ.reportDate ?? NA)})]`);
    for (const [label, ref, kind] of qFields) L.push(kvLine(label, fmt(readField(latestQ, ref), kind)));
  } else {
    L.push(`[LATEST QUARTER] ${NA} — no quarterly results on file.`);
  }

  if (p.yields) {
    L.push("");
    L.push("[YIELDS vs CURRENT MARKET CAP]");
    L.push(kvLine("Market capitalisation", croreStr(p.yields.marketCap)));
    L.push(kvLine("Free-cash-flow yield", pctPoint(p.yields.fcfYield)));
    L.push(kvLine("Dividend yield", pctPoint(p.yields.dividendYield)));
    L.push(kvLine("Basis", p.yields.asOfBasis));
  }
  L.push("");
  L.push("(Headline figures only — call getStockQuarterlyResults for the quarter-by-quarter trend.)");
  return L.join("\n");
}

export const getStockFundamentalsTool: ChatTool<Args> = {
  name: "getStockFundamentals",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getStockFundamentals requires a non-empty 'symbol' string (an NSE ticker)." };
    const basis = args.basis === "consolidated" || args.basis === "standalone" ? args.basis : undefined;
    try {
      const view = await readFundamentals(ctx, symbol, basis);
      if (!view) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: renderFundamentals(view) };
    } catch (e) {
      return { ok: false, error: `Could not read fundamentals for ${symbol}: ${(e as Error).message}` };
    }
  },
};
