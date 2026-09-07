// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCREEN GRAMMAR — the shape the model emits, and the only shape code will execute.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE MODEL READS THE QUESTION INTO A STRUCTURE; CODE VALIDATES AND EXECUTES IT.
//
// ⚠ THIS DOES NOT WEAKEN N-1, AND THE DISTINCTION IS THE WHOLE DESIGN. The model emits NO NUMBER AND
//   NO RESULT. It emits which fields, which operators, how they nest — a SHAPE. Every threshold in the
//   tree below is a number the READER typed, copied across; code converts it into the column's unit,
//   code runs the comparison, code counts the rows and code writes the sentence describing them.
//   Same spine as the plan-and-execute layer: the model chooses the form, code does the work.
//
// ★ WHY THE CHANGE WAS NEEDED AT ALL. `extractConditions` reads a sentence with regexes, and a regex
//   cannot see SCOPE. "(pharma OR banking) AND pledge > 50" and "pharma OR (banking AND pledge > 50)"
//   are the same words in the same order to a matcher and different companies to a reader. That is why
//   OR and NOT were absent, and no amount of widening the extractor would have added them.
//
// ── ⚠ A WELL-FORMED TREE CAN STILL BE THE WRONG READING ──────────────────────────────────────────
// Both bracketings above validate. Legality is not correctness, so validation is NOT the guard — the
// English restatement is (see `screen-restate.ts`). A reader cannot check a nested condition tree;
// they can check a sentence, and the sentence is generated FROM the validated tree so it cannot
// describe something other than what ran.
//
// ── ★ THE GRAMMAR IS DELIBERATELY SMALL ──────────────────────────────────────────────────────────
// Five leaf kinds and three connectives. Everything a reader can filter on today is one of the five,
// and a model that cannot express anything else cannot invent a filter we do not have. Batch 2's
// computed metrics, price conditions and trends are new LEAF kinds, which is why the tree is a union
// rather than a fixed record — they slot in without reshaping what is here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** How a bound compares. `eq` is admitted and is rare; a reader who says "exactly 50" means it. */
export type Comparator = "gte" | "lte" | "gt" | "lt" | "eq";

/**
 * ★ WHAT THE MODEL IS ALLOWED TO SAY ABOUT A NUMBER'S MAGNITUDE — and nothing else.
 *
 * ⚠ THE MODEL DOES NOT CONVERT. It reports the token it saw beside the number ("cr", "%", none) and
 *   CODE turns that into the column's own unit, because the column's unit is derived from the schema
 *   and the model has never seen it. A model doing the arithmetic is a model producing a number that
 *   then selects rows — exactly what N-1 forbids.
 */
export type MagnitudeToken = "none" | "percent" | "cr" | "lakh" | "lakhCr" | "billion" | "times";

/** A numeric bound on a field — a derived filed line item, or one of the scored metric fields. */
export interface CmpNode {
  readonly op: "cmp";
  /** A key in the derived vocabulary or in `SCREEN_FIELDS_IDS`. Validated; never trusted. */
  readonly field: string;
  readonly comparator: Comparator;
  /** ★ THE READER'S OWN NUMBER, uncconverted. Code scales it by the field's derived unit. */
  readonly value: number;
  readonly magnitude: MagnitudeToken;
  /** "quarterly" | "annual", where the reader said. Absent lets the field's availability decide. */
  readonly grain?: "quarterly" | "annual";
}

/** One of the five published health bands. */
export interface BandNode { readonly op: "band"; readonly band: string }

/** A named finding rule, or a whole kind ("red flags"). */
export interface FindingNode {
  readonly op: "finding";
  /** A catalogue rule key, or null when the reader named only a kind. */
  readonly rule: string | null;
  readonly kind: "red_flag" | "pattern" | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A PLEDGE THRESHOLD — distinct from the R1 finding, and only now safe to expose.
 *
 * ⚠ "Pledging above 50%" RESOLVED TO THE R1 CHECK, so a reader wanting 30% could not ask. R1 fires at
 *   more than half the promoter stake OR a ten-point jump in a quarter; it is a verdict with its own
 *   bars, not a threshold anyone can move.
 *
 * ⚠ AND IT WOULD NOT HAVE BEEN SAFE A WEEK AGO. The pledge counts were wrong until the re-parse —
 *   sub-entity contexts and NDUs were being counted as pledges — and are correct as of it. Exposing a
 *   filter over a column that was silently wrong would have produced a confident list of the wrong
 *   companies.
 *
 * ★ THE RATIO IS COMPUTED FROM COUNTS, NEVER FROM THE PERCENTAGE COLUMNS. `promoter_pledged_pct` and
 *   `promoter_pledged_shares_pct` are filer-reported and are the columns the pledge ruling refuses to
 *   quote. The denominator is the filing's own basis — promoter TOTAL holding, depository receipts
 *   included — which is `promoter_total_shares`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface PledgeNode {
  readonly op: "pledge";
  readonly comparator: Comparator;
  /** The reader's percent, uncconverted. Code divides by 100 — the stored ratio is a fraction. */
  readonly value: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ PRICE-SHAPED CONDITIONS — the reader's most common filter, and the one we could not run.
 *
 * ⚠ "Large caps under 20 P/E" IS TWO CONDITIONS WE HELD SEPARATELY AND COULD NOT COMBINE. Both sides
 *   exist: a live market cap on `stock_prices`, an annual EPS on the five fundamentals tables. What
 *   was missing is that neither is a FILED COLUMN, so the derived vocabulary — which is generated from
 *   the schema — cannot contain them. They are computed, and code has to own the computation.
 *
 * ★ THE MODEL NEVER LEARNS THEY ARE SPECIAL. It emits `{"op":"cmp","field":"marketCap",…}` exactly as
 *   it would for revenue, and VALIDATION rewrites that into a `price` node because it knows market cap
 *   is not a column anybody filed. So the grammar the model writes does not grow, ordering by market
 *   cap works through the clause that already exists, and the knowledge of what is computed lives in
 *   code — which is the whole batch-1 ruling applied one layer down.
 *
 * ⚠ AND THE TWO ARE NOT EQUALLY FRESH, which is why they are separate metrics rather than one "price"
 *   leaf with a field name. Market cap is yesterday's close against the latest shareholding. A P/E's
 *   numerator is that same close and its DENOMINATOR IS A FULL FINANCIAL YEAR OLD — measured: no
 *   quarterly table in the book carries `basic_eps`, so there is no trailing-twelve-month reading to
 *   be had. The card states the year the earnings come from rather than implying they are current.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export const PRICE_METRICS = {
  marketCap: {
    label: "market cap", unit: "currency" as const,
    aliases: ["market cap", "market capitalisation", "market capitalization", "mcap", "market value",
      "marketcap", "market cap size", "company size"],
  },
  // ★★ THE P/E IS TRAILING TWELVE MONTHS, and it is computed as MARKET CAP ÷ TTM NET PROFIT.
  //
  // ⚠ IT USED TO BE PRICE ÷ LAST ANNUAL EPS, because no quarterly table carries `basic_eps` — so the
  //   denominator was up to a full financial year old on a numerator from yesterday's close. That is
  //   not what "P/E" means to anyone.
  //
  // ★ GOING THROUGH THE CAP RATHER THAN PER-SHARE REMOVES THE SHARE COUNT ENTIRELY — no split
  //   adjustment, no stale `total_shares`, and both sides already in ₹ crore. MEASURED: 2,282 stocks
  //   have four quarters of net profit on file, so the reach is comparable and the reading is current.
  peRatio: {
    label: "P/E", unit: "times" as const,
    aliases: ["pe", "p e", "pe ratio", "p e ratio", "price to earnings", "price earnings",
      "price earnings ratio", "earnings multiple", "price to earnings ratio"],
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE PRICE HISTORY WE ALREADY HELD AND NOBODY COULD ASK FOR.
  //
  // ⚠ RETURNS ARE STORED AS FRACTIONS, NOT PERCENTS, and this is the trap the whole block turns on.
  //   MEASURED on `return_1y`: median −0.087, quartiles −0.266 / +0.181, max 23.04. So 0.255 means
  //   +25.5%. Read as a percent, "up more than 20% in a year" becomes "up more than 2,000%" and
  //   returns two companies out of 1,930 — an empty-looking answer that is not empty for the reason
  //   it appears to be. `unit: "fraction"` is what makes code divide the reader's 20 by 100.
  //
  // ★ THE 52-WEEK BAND IS FULLY POPULATED AND INTERNALLY CONSISTENT — 2,291 of 2,291, with ZERO rows
  //   where the price sits outside its own band, zero inverted highs and zero non-positive lows. That
  //   consistency is also what makes it split-safe to use: a stale pre-split high would put the price
  //   outside the band, and none is.
  //
  // ⚠ THE DISTANCE IS COMPUTED, NOT STORED, and it is one metric serving both readings a reader has:
  //   "within 10% of its 52-week high" is `lte 10`, "fallen more than 30% off its high" is `gt 30`.
  //   Same axis, opposite comparators — which is why this is a distance and not two fields.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  return1m: {
    label: "1-month return", unit: "fraction" as const,
    aliases: ["1 month return", "one month return", "monthly return", "return over a month",
      "return in the last month", "1m return"],
  },
  return3m: {
    label: "3-month return", unit: "fraction" as const,
    aliases: ["3 month return", "three month return", "quarterly return", "return over three months",
      "return in the last three months", "3m return"],
  },
  return6m: {
    label: "6-month return", unit: "fraction" as const,
    aliases: ["6 month return", "six month return", "half yearly return", "return over six months",
      "return in the last six months", "6m return"],
  },
  return1y: {
    label: "1-year return", unit: "fraction" as const,
    aliases: ["1 year return", "one year return", "yearly return", "annual return", "return over a year",
      "return in the last year", "1y return", "12 month return"],
  },
  offFrom52WeekHigh: {
    // ⚠ THE COLUMN NAME IS SEPARATE because the heading rule trims a label at " below ", which turned
    //   this one into the single word "distance". A heading has to name the quantity on its own.
    label: "distance below the 52-week high", column: "off 52w high", unit: "fraction" as const,
    aliases: ["52 week high", "52w high", "one year high", "yearly high", "below its 52 week high",
      "off its 52 week high", "off its high", "below the 52 week high", "from the 52 week high",
      "near its 52 week high", "close to its 52 week high", "down from its high"],
  },
  offFrom52WeekLow: {
    label: "distance above the 52-week low", column: "above 52w low", unit: "fraction" as const,
    aliases: ["52 week low", "52w low", "one year low", "yearly low", "above its 52 week low",
      "off its 52 week low", "above the 52 week low", "from the 52 week low",
      "near its 52 week low", "close to its 52 week low", "up from its low"],
  },
} as const;

export type PriceMetric = keyof typeof PRICE_METRICS;

export interface PriceNode {
  readonly op: "price";
  readonly metric: PriceMetric;
  readonly comparator: Comparator;
  /** The reader's own number. Code scales it into ₹ crore, or leaves a multiple alone. */
  readonly value: number;
  readonly magnitude: MagnitudeToken;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A TREND — the first condition that spans PERIODS rather than reading one.
 *
 * ⚠ EVERY OTHER LEAF ASKS "what is this figure now". A trend asks "what has it done", which means the
 *   archive's DEPTH stops being a background fact and becomes the answer's limit. MEASURED on
 *   `quarterly_results`, deepest basis per stock: 1,386 of 2,178 hold EXACTLY EIGHT quarters, 399 hold
 *   fewer, and only 393 hold more. So "four straight quarters of growth" is answerable for most of the
 *   book and "twelve" is answerable for 18% of it — the same question, one number apart, and the
 *   second one would return a confident list drawn from a fifth of the market.
 *
 * ★ SO THE FLOOR IS ENFORCED IN TWO PLACES, DIFFERENTLY. Past `MAX_TREND_PERIODS` the screen is
 *   REFUSED with the archive's depth as the reason, because no wording rescues a denominator that
 *   small. Within it the screen RUNS and the companies without the quarters are excluded — and the
 *   answer's population sentence says how many quarters it needed, so the denominator explains itself.
 *
 * ⚠ A STOCK EXCLUDED FOR DEPTH HAS NOT FAILED THE TEST. It is in neither the matched set nor the
 *   population, exactly as a company with no promoter is neither pledged nor unpledged. Counting it as
 *   a failure would report "1,999 companies are not growing" about companies we never looked at.
 *
 * ⚠ AND TRENDS ARE QUARTERLY ONLY. `fundamentals` holds TWO YEARS for 1,621 of 2,178 stocks — an
 *   annual trend is one move for most of the book, and a three-year version would search 390
 *   companies. That is not a floor to state; it is a screen that should not exist yet.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface TrendNode {
  readonly op: "trend";
  /** A field with a QUARTERLY source. Validated — an annual-only field is refused with its reason. */
  readonly field: string;
  readonly direction: "up" | "down";
  /** MOVES in the named direction. With `of` absent they must be CONSECUTIVE. */
  readonly periods: number;
  /**
   * ★ "UP IN 3 OF THE LAST 4 QUARTERS" — the loose reading, and the one most readers mean.
   *
   * ⚠ A STRICT RUN IS A NARROW TEST. One flat quarter in an otherwise rising series fails it, and a
   *   reader asking for a company that is "generally growing" would never see that company. With `of`
   *   set, `periods` becomes a COUNT of qualifying moves out of `of` — so 3-of-4 admits one stumble.
   *
   * ⚠ AND `of` IS THE WINDOW, `periods` THE THRESHOLD, so `periods <= of` is validated. Reversed they
   *   would describe a test nothing can pass, over a window nobody asked for.
   */
  readonly of?: number;
}

/**
 * ⚠ SEVEN MOVES = EIGHT QUARTERS, which is exactly where the archive floors for 1,386 of 2,178
 *   stocks. One more would drop the searchable set to 393 companies.
 */
export const MAX_TREND_PERIODS = 7;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A GROWTH MAGNITUDE — how MUCH a figure moved, which the trend leaf deliberately cannot say.
 *
 * ⚠ A TREND IS DIRECTION-ONLY. "Revenue up in each of the last four quarters" says nothing about
 *   whether it rose 1% or 100%, so "revenue up more than 20% year on year" had no leaf at all.
 *
 * ⚠ AND THE BASE IS THE WHOLE DANGER. Growth off a NEGATIVE or ZERO base is not a percentage — a
 *   company going from −10 Cr to −5 Cr has not "grown 50%", and one going from −10 to +5 has not
 *   grown 150%. MEASURED on the latest year-on-year pairs: 451 of 3,406 net-profit pairs have a base
 *   at or below zero, against 37 of 3,408 for revenue. So on the very field readers most want this
 *   for, one company in eight would carry a fabricated percentage. Those companies are in NEITHER
 *   set — the same three-state discipline the P/E holds over a loss.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface GrowthNode {
  readonly op: "growth";
  /** A field with a QUARTERLY source — validated, like a trend. */
  readonly field: string;
  readonly comparator: Comparator;
  /** The reader's percent. Code divides by 100. */
  readonly value: number;
  /** `yoy` compares with the same quarter a year back; `qoq` with the quarter before. */
  readonly window: "yoy" | "qoq";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ A BOUND THAT IS NOT A NUMBER — "cheaper than its sector median".
 *
 * ★ EVERY OTHER LEAF COMPARES AGAINST A CONSTANT the reader typed. This one compares each company
 *   against a figure computed FROM ITS OWN GROUP, so the bound is different for every row. That is
 *   why it is a leaf kind and not a comparator: nothing in the tree could carry a per-row threshold.
 *
 * ⚠ THE MEDIAN, NOT THE MEAN. One company at a 300× P/E drags a sector mean past every member of it;
 *   a median is what "typical for its sector" actually means.
 *
 * ⚠ AND THE TWO BENCHMARKS HAVE VERY DIFFERENT REACH. Sectors cover 2,290 of 2,291 stocks with 24
 *   groups, the smallest holding 12 — a median means something in all of them. PEER GROUPS COVER 148
 *   STOCKS ACROSS 23 GROUPS, so a peer-relative screen speaks about 6% of the book. That is a fact
 *   about our data, not a bug to code around, and the answer states which population it searched.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface RelativeNode {
  readonly op: "relative";
  /** Any field with a value per company — filed, scored or computed from price. */
  readonly field: string;
  readonly comparator: Comparator;
  readonly benchmark: "sector" | "peerGroup";
}

/** A sector, by the reader's words — resolved against the live sector list, never guessed. */
export interface SectorNode { readonly op: "sector"; readonly sector: string }

/** A peer group, by name — resolved through `matchPondName`, which refuses rather than guesses. */
export interface PeerGroupNode { readonly op: "peerGroup"; readonly name: string }

/**
 * ★ NO FILTER AT ALL — "the 10 largest by revenue" selects nothing and orders everything.
 *
 * ⚠ WITHOUT THIS THE MODEL HAD NOWHERE TO PUT "no conditions" and returned a null tree, which
 *   validation refused as "a node that is not an object" — so a pure ranking was answered with a
 *   refusal about a bound nobody had typed. An explicit leaf is better than a nullable tree because
 *   every consumer already handles leaves, and none of them has to learn a second empty case.
 *
 * ⚠ ITS POPULATION IS NOT "the whole book". It matches everything it is given, and it is always
 *   ANDed with the ordering field's own probe — so the searched population ends up as "companies that
 *   have the figure being ranked on", which is the only honest denominator for a leaderboard.
 */
export interface AllNode { readonly op: "all" }

export type LeafNode = CmpNode | BandNode | FindingNode | SectorNode | PeerGroupNode | AllNode
  | PledgeNode | PriceNode | TrendNode | GrowthNode | RelativeNode;

export interface AndNode { readonly op: "and"; readonly nodes: readonly ScreenNode[] }
export interface OrNode { readonly op: "or"; readonly nodes: readonly ScreenNode[] }
export interface NotNode { readonly op: "not"; readonly node: ScreenNode }

export type ScreenNode = LeafNode | AndNode | OrNode | NotNode;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ ORDERING AND LIMIT ARE CLAUSES ON THE SCREEN, NOT LEAVES ON THE TREE.
 *
 * ⚠ "Top 10 by revenue" PARSED THE FILTER AND IGNORED THE RANKING — a silent drop, the exact defect
 *   batch 1 fixed for sector, and worse here: the reader asked for ten and received 1,556 in an order
 *   nobody chose.
 *
 * ★ THEY ARE NOT LEAVES BECAUSE THEY DO NOT SELECT ANYTHING. A leaf answers "is this company in the
 *   set"; an ordering answers "in what order do I read the set I already have". Modelling a ranking
 *   as a filter is how a leaderboard quietly becomes a threshold nobody typed.
 *
 * ⚠ AND A LEADERBOARD IS NOT A RECOMMENDATION (SC-12). We rank on a basis the READER named. `field`
 *   is required — there is no "best" ordering here to fall back to, because "best" is a conclusion
 *   and we publish readings. A limit with no ordering is refused at validation for the same reason:
 *   "any 10 of 1,556" is a random sample presented as a selection.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface OrderClause {
  /** A field in the derived vocabulary or the scored set. Validated; never a direction alone. */
  readonly field: string;
  readonly direction: "desc" | "asc";
}

/** What the model returns for one question. */
export interface ParsedScreen {
  /** "How many" is a count; anything else is a list. */
  readonly shape: "list" | "count";
  /** Named by the reader only — otherwise `chooseBasis` decides, per the standing ruling. */
  readonly basis: "standalone" | "consolidated" | null;
  readonly tree: ScreenNode;
  /** ★ The reader's ranking. `null` when they named none — never a default we chose. */
  readonly order: OrderClause | null;
  /** ★ "top 10" → 10. `null` when they named none. Refused without an ordering. */
  readonly limit: number | null;
}

/** The most rows a reader may ask for. Above this the answer is a table, not a shortlist. */
export const MAX_LIMIT = 200;

// ── bounds on the shape itself ────────────────────────────────────────────────────────────────────
/**
 * ⚠ A TREE IS BOUNDED IN DEPTH AND SIZE, and both are validated rather than hoped for. A model that
 *   returns a thousand-node tree is a model that has gone wrong, and executing it would issue a query
 *   per leaf. Six levels and twenty leaves is far past anything a reader types in one sentence.
 */
export const MAX_TREE_DEPTH = 6;
export const MAX_LEAVES = 20;

/** Walk every leaf, in order — the one traversal both the validator and the restatement use (N-5). */
export function leavesOf(node: ScreenNode): LeafNode[] {
  switch (node.op) {
    case "and": case "or": return node.nodes.flatMap(leavesOf);
    case "not": return leavesOf(node.node);
    default: return [node];
  }
}

export function depthOf(node: ScreenNode): number {
  switch (node.op) {
    case "and": case "or": return 1 + Math.max(0, ...node.nodes.map(depthOf));
    case "not": return 1 + depthOf(node.node);
    default: return 1;
  }
}

/** Does the tree use anything the AND-only extractor could not have produced? Drives the report. */
export function usesScope(node: ScreenNode): boolean {
  switch (node.op) {
    case "or": return true;
    case "not": return true;
    case "and": return node.nodes.some(usesScope);
    default: return false;
  }
}
