// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SCREEN PARSE — the model reads the question into a structure; this validates it into one code runs.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE SPINE IS THE PLANNER'S, DELIBERATELY. Cache → mock guard → quota gate → `generateStructured`
//    at temperature 0 → record tokens whatever happened → ADMIT or fall back. That sequence is not
//    style: each step is there because its absence cost something once (the planner's own note records
//    ~43 calls landing against an 18/day model with nothing counting them), and a second AI consumer
//    inventing its own sequence would re-learn each one.
//
// ── ★ WHAT THE MODEL PRODUCES, AND WHAT IT DOES NOT ──────────────────────────────────────────────
// It produces a SHAPE: which fields, which operators, how they nest, and the reader's own number
// copied across with the magnitude token it was written with ("cr", "%", none). It produces no
// converted number, no threshold of its own, no row, no count and no sentence. Code scales the number
// into the column's unit — which is derived from the schema and which the model has never seen — code
// runs the comparison, and code writes the restatement.
//
// ── ⚠ VALIDATION IS NOT ONLY LEGALITY, AND THAT IS WHY IT IS NOT THE GUARD ───────────────────────
// `(pharma OR banking) AND pledge>50` and `pharma OR (banking AND pledge>50)` both validate and return
// different companies. Nothing here can tell them apart, because both are things a reader might have
// meant. The guard is the English restatement built FROM the accepted tree (`screen-restate.ts`) — a
// reader cannot check a nested tree and can check a sentence.
//
// ── ★ A VALIDATION FAILURE FALLS BACK AND SAYS SO ────────────────────────────────────────────────
// To the AND-only extractor that shipped last batch, with `fellBack` set so the answer can say which
// reading it used. A narrower reading honestly labelled beats a refusal — the reader still gets the
// companies, and knows the OR they typed was not honoured.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createAiProvider } from "../ai/core/registry.js";
import { checkAndConsumeAiCall, recordAiTokens, type Actor } from "../ai/core/quota.js";

/** ★ THE SAME ACCESSOR THE PLANNER USES, and the same default. Two AI consumers reading two model
 *  names is how a spend log comes to describe a model nobody called. */
const MODEL = (): string => process.env.AI_MODEL ?? "gemini-3.5-flash";
import { DERIVED_SCREEN_FIELDS } from "../scoring/read/screen-fields.generated.js";
import { SCREEN_FIELDS, SCREEN_FIELDS_IDS } from "../scoring/read/screen.types.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { STOCK_FINDINGS } from "../catalogue/stock-findings.js";
import { parseBand } from "../scoring/read/universe-projection.service.js";
import {
  MAX_TREND_PERIODS,
  PRICE_METRICS, type PriceMetric,
  MAX_LEAVES, MAX_LIMIT, MAX_TREE_DEPTH, depthOf, leavesOf,
  type Comparator, type MagnitudeToken, type OrderClause, type ParsedScreen, type ScreenNode,
} from "./screen-grammar.js";

// ── the vocabulary validation runs against ────────────────────────────────────────────────────────
/**
 * ★ EVERYTHING RESOLVABLE, PASSED IN. Sectors and peer groups live in the database, so the caller
 *   loads them once and validation stays PURE — testable with no connection, and unable to widen its
 *   own vocabulary mid-check.
 */
export interface ScreenVocabulary {
  /** Sector display names, exactly as stored. 24 of them, over 2,290 of 2,291 stocks. */
  readonly sectors: readonly string[];
  /** Peer group display names. 23 groups, but only 148 stocks are in one — see the evaluator. */
  readonly peerGroups: readonly string[];
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const DERIVED_BY_KEY = new Map(DERIVED_SCREEN_FIELDS.map((f) => [f.key, f]));
const SCORED = new Set<string>(SCREEN_FIELDS_IDS);

/** Every name a field answers to, for mapping the model's `field` onto a real one. */
const FIELD_ALIASES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const id of SCREEN_FIELDS_IDS) {
    m.set(norm(id), id);
    m.set(norm(SCREEN_FIELDS[id].label), id);
  }
  // ★ THE COMPUTED PRICE FIELDS ARE ALIASES TOO, so `order:{field:"marketCap"}` resolves through the
  //   clause that already exists and the ranking needed no second path.
  for (const [key, meta] of Object.entries(PRICE_METRICS)) {
    m.set(norm(key), key);
    m.set(norm(meta.label), key);
    for (const a of meta.aliases) m.set(norm(a), key);
  }
  for (const f of DERIVED_SCREEN_FIELDS) {
    // ⚠ SCORED WINS A COLLISION, as it does in the extractor — `operatingMargin` is both, and
    //   silently widening a live answer from 95 companies to 2,178 is a change nobody asked for.
    if (!m.has(norm(f.key))) m.set(norm(f.key), f.key);
    if (!m.has(norm(f.label))) m.set(norm(f.label), f.key);
    for (const a of f.aliases) if (!m.has(norm(a))) m.set(norm(a), f.key);
  }
  return m;
})();

const RULE_KEYS = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey as string));
const RULE_BY_NAME: ReadonlyMap<string, string> = new Map(
  FILING_REGISTRY.map((e) => [
    norm((STOCK_FINDINGS as Record<string, { name?: string }>)[e.ruleKey as string]?.name ?? e.ruleKey),
    e.ruleKey as string,
  ]),
);

const COMPARATORS: ReadonlySet<string> = new Set<Comparator>(["gte", "lte", "gt", "lt", "eq"]);
const MAGNITUDES: ReadonlySet<string> = new Set<MagnitudeToken>(
  ["none", "percent", "cr", "lakh", "lakhCr", "billion", "times"]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE MAGNITUDE REFUSAL — the one validation that rejects a NUMBER rather than a name.
//
// ⚠ "Revenue above 1000000000" IS THE DANGEROUS CASE BECAUSE IT SILENTLY SUCCEEDS. Every money column
//   is in ₹ crore, so that reads as a thousand-crore-million bound, matches nothing, and returns an
//   empty set that is indistinguishable from an honest "no company clears this". `cr` and `lakh` are
//   already refused when they are ambiguous; a BARE number is worse, because nothing looks wrong.
//
// ★ THE BAR IS THE LARGEST FIGURE THE COLUMN COULD PLAUSIBLY HOLD. Reliance's quarterly revenue is
//   about 312,000 crore — the largest in the book — so a bare bound above ten million crore is not a
//   number anybody means in the column's own unit. It is refused with a reason rather than run.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const BARE_CURRENCY_CEILING = 10_000_000;

export interface Rejected { readonly ok: false; readonly why: string }
export interface Accepted { readonly ok: true; readonly parsed: ParsedScreen }
export type Admission = Accepted | Rejected;

/** Recursively validate and NORMALISE one node — names resolved to keys, nothing else changed. */
function admitNode(raw: unknown, vocab: ScreenVocabulary, depth: number): ScreenNode | string {
  if (depth > MAX_TREE_DEPTH) return `nesting deeper than ${MAX_TREE_DEPTH}`;
  if (!raw || typeof raw !== "object") return "a node that is not an object";
  const n = raw as Record<string, unknown>;
  const op = String(n.op ?? "");

  if (op === "and" || op === "or") {
    if (!Array.isArray(n.nodes) || n.nodes.length === 0) return `${op} with no operands`;
    const kids: ScreenNode[] = [];
    for (const k of n.nodes) {
      const r = admitNode(k, vocab, depth + 1);
      if (typeof r === "string") return r;
      kids.push(r);
    }
    return op === "and" ? { op: "and", nodes: kids } : { op: "or", nodes: kids };
  }

  if (op === "not") {
    const r = admitNode(n.node, vocab, depth + 1);
    if (typeof r === "string") return r;
    return { op: "not", node: r };
  }

  if (op === "cmp") {
    const key = FIELD_ALIASES.get(norm(String(n.field ?? "")));
    if (!key) return `"${String(n.field)}" is not a field we hold`;
    const comparator = String(n.comparator ?? "");
    if (!COMPARATORS.has(comparator)) return `"${comparator}" is not a comparator`;
    const value = Number(n.value);
    if (!Number.isFinite(value)) return `"${String(n.value)}" is not a number`;
    const magnitude = String(n.magnitude ?? "none");
    if (!MAGNITUDES.has(magnitude)) return `"${magnitude}" is not a magnitude we read`;

    // ⚠ THE UNIT IS THE COLUMN'S, NOT THE MODEL'S. A `fraction` column takes the reader's percent
    //   divided by 100 — see the header of `line-item-conditions.ts` for what happens when it does not.
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // ★★ A COMPUTED FIELD LEAVES HERE AS A `price` NODE. The model wrote a `cmp`; it has no way to
    //    know market cap is not a column, and it should not have to.
    //
    // ⚠ WITHOUT THIS THE LEAF WOULD REACH THE EVALUATOR AS A FILED CONDITION, where `DERIVED.get(key)!`
    //   is undefined — a crash on the most ordinary screen a reader can type.
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    if (key in PRICE_METRICS) {
      const metric = key as PriceMetric;
      const pm = PRICE_METRICS[metric];
      if (pm.unit === "currency") {
        if (magnitude === "none" && Math.abs(value) > BARE_CURRENCY_CEILING) {
          return `${value} with no unit against a figure held in ₹ crore — if that is rupees it is a `
            + `thousand-fold out, and a screen that guessed would return an empty set that looks like an answer`;
        }
        if (magnitude === "lakh" || magnitude === "billion") {
          return `"${magnitude}" against a figure held in ₹ crore is ambiguous — say crore`;
        }
      } else if (pm.unit === "fraction") {
        // ⚠ A RETURN OR A DISTANCE IS A PERCENTAGE. A crore magnitude against one is a misread, and
        //   `scaled` below would leave the number alone and select on 50,000%.
        if (magnitude !== "none" && magnitude !== "percent") {
          return `a ${pm.label} is a percentage, not a figure in "${magnitude}"`;
        }
        // ⚠ AND A DISTANCE FROM A 52-WEEK EXTREME CANNOT BE NEGATIVE — the price is inside the band by
        //   construction (measured: zero rows outside it), so a negative bound selects nothing and a
        //   reader who typed one meant the other extreme.
        if (metric.startsWith("offFrom") && value < 0) {
          return `${pm.label} is never negative — the price sits inside its own 52-week band`;
        }
      } else {
        // ⚠ A P/E CARRIES NO UNIT. "P/E above 20%" is a reader who meant something else, and running it
        //   as 0.2 would return almost the whole book as "cheap".
        if (magnitude !== "none" && magnitude !== "times") {
          return `a ${pm.label} is a multiple, not a figure in "${magnitude}"`;
        }
        // ⚠ AND IT IS ONLY DEFINED OVER A PROFIT. Companies at a loss are excluded from the leaf
        //   entirely, so a bound at or below zero selects from an empty set — refused, not run.
        if (value <= 0) {
          return `a ${pm.label} at or below zero has nothing to select — the ratio only exists where `
            + `a company earned a profit`;
        }
      }
      return { op: "price", metric, comparator: comparator as Comparator, value, magnitude: magnitude as MagnitudeToken };
    }

    const derived = DERIVED_BY_KEY.get(key);
    const unit = derived?.unit ?? (SCORED.has(key) ? "points" : null);
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // ★★ A SCORE IS OUT OF A HUNDRED, AND A BOUND ABOVE THAT IS A MISREAD — REFUSED, NOT RUN.
    //
    // ⚠ OBSERVED LIVE: "how many companies have market cap above 50000 cr" came back as a screen on
    //   the MARKET HEALTH PILLAR — «Companies with market above 50000», searched over the 95 we score,
    //   nothing matched. The model had emitted the bare field `market` for the reader's "market cap",
    //   and `market` IS a real field: the Market pillar. Every layer downstream was correct, and the
    //   reader was told nothing clears a bound they never set on a quantity they never named.
    //
    // ★ THE SLIP CANNOT BE VALIDATED AWAY BY NAME — both readings are real fields. What CANNOT be real
    //   is the NUMBER: the score and its four pillars are 0–100 by construction, so a bound outside
    //   that is not a filter anybody meant. Same shape as the bare-currency ceiling: the value, not
    //   the name, is what gives the misreading away.
    //
    // ⚠ AND IT IS SCOPED TO THE SCORE TIER ONLY. `returnOnEquity` is scored too and is a percent that
    //   can legitimately exceed 100, so this reads the field's own tier rather than assuming.
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    const scored = SCORED.has(key) ? SCREEN_FIELDS[key as keyof typeof SCREEN_FIELDS] : null;
    if (scored?.tier === "score" && (value < 0 || value > 100)) {
      return `${scored.label} is scored out of 100, so ${value} is not a bound on it`;
    }

    if (unit === "currency" && magnitude === "none" && Math.abs(value) > BARE_CURRENCY_CEILING) {
      return `${value} with no unit against a figure held in ₹ crore — if that is rupees it is a `
        + `thousand-fold out, and a screen that guessed would return an empty set that looks like an answer`;
    }
    if (magnitude === "lakh" || magnitude === "billion") {
      return `"${magnitude}" against a figure held in ₹ crore is ambiguous — say crore`;
    }
    const grain = n.grain === "annual" || n.grain === "quarterly" ? n.grain : undefined;
    return { op: "cmp", field: key, comparator: comparator as Comparator, value, magnitude: magnitude as MagnitudeToken, ...(grain ? { grain } : {}) };
  }

  if (op === "growth") {
    const key = FIELD_ALIASES.get(norm(String(n.field ?? "")));
    if (!key) return `"${String(n.field)}" is not a field we hold`;
    const derived = DERIVED_BY_KEY.get(key);
    if (!derived?.sources.some((x) => x.grain === "quarterly")) {
      return `we hold ${derived?.label.toLowerCase() ?? String(n.field)} once a year, so there is no `
        + `quarter-on-quarter or year-on-year reading of it`;
    }
    const comparator = String(n.comparator ?? "");
    if (!COMPARATORS.has(comparator)) return `"${comparator}" is not a comparator`;
    const value = Number(n.value);
    if (!Number.isFinite(value)) return `"${String(n.value)}" is not a number`;
    const window = n.window === "qoq" ? "qoq" : "yoy";
    return { op: "growth", field: key, comparator: comparator as Comparator, value, window };
  }

  if (op === "relative") {
    const key = FIELD_ALIASES.get(norm(String(n.field ?? "")));
    if (!key) return `"${String(n.field)}" is not a field we hold`;
    const comparator = String(n.comparator ?? "");
    if (!COMPARATORS.has(comparator)) return `"${comparator}" is not a comparator`;
    // ⚠ A MEDIAN IS NOT A POINT TO BE EQUAL TO. `eq` against a computed median is a test almost
    //   nothing passes and no reader means — it would return the one company that happens to sit on it.
    if (comparator === "eq") return `"exactly its median" is not a comparison a median supports`;
    const benchmark = n.benchmark === "peerGroup" ? "peerGroup" : "sector";
    return { op: "relative", field: key, comparator: comparator as Comparator, benchmark };
  }

  if (op === "trend") {
    const key = FIELD_ALIASES.get(norm(String(n.field ?? "")));
    if (!key) return `"${String(n.field)}" is not a field we hold`;
    const derived = DERIVED_BY_KEY.get(key);
    // ⚠ A TREND NEEDS A QUARTERLY SERIES. A scored metric has one value and a price field is a single
    //   day; neither has a history here, and an annual field has two years for most of the book.
    if (!derived?.sources.some((x) => x.grain === "quarterly")) {
      return `we hold ${derived?.label.toLowerCase() ?? String(n.field)} once a year, and two years is not a trend`;
    }
    const direction = String(n.direction ?? "");
    if (direction !== "up" && direction !== "down") return `"${direction}" is not a direction`;
    const periods = Number(n.periods);
    if (!Number.isInteger(periods) || periods < 1) return `"${String(n.periods)}" is not a number of quarters`;
    // ★★ THE DEPTH FLOOR, ENFORCED. Eight quarters is where the archive floors for 1,386 of 2,178
    //    stocks; asking for more searches 393 companies and says nothing about the other 1,785.
    if (periods > MAX_TREND_PERIODS) {
      return `${periods} straight quarters needs ${periods + 1} quarters on file, and we hold eight for `
        + `most companies — a screen that deep would search a fifth of the market`;
    }
    // ★ THE LOOSE READING: "up in 3 of the last 4 quarters". `of` is the WINDOW and `periods` the
    //   THRESHOLD, so the threshold cannot exceed the window — reversed, it describes a test nothing
    //   can pass over a window nobody asked for.
    if (n.of !== undefined && n.of !== null) {
      const of = Number(n.of);
      if (!Number.isInteger(of) || of < 2) return `"${String(n.of)}" is not a number of quarters`;
      if (of > MAX_TREND_PERIODS) {
        return `${of} quarters needs ${of + 1} on file, and we hold eight for most companies — a `
          + `screen that deep would search a fifth of the market`;
      }
      if (periods > of) return `${periods} of ${of} quarters is more quarters than the window holds`;
      return { op: "trend", field: key, direction, periods, of };
    }
    return { op: "trend", field: key, direction, periods };
  }

  if (op === "all") return { op: "all" };

  if (op === "pledge") {
    const comparator = String(n.comparator ?? "");
    if (!COMPARATORS.has(comparator)) return `"${comparator}" is not a comparator`;
    const value = Number(n.value);
    if (!Number.isFinite(value)) return `"${String(n.value)}" is not a number`;
    // ⚠ A PLEDGE SHARE IS A PERCENTAGE OF THE PROMOTER STAKE, so it cannot exceed 100. A bound above
    //   that is a reader who meant something else, and running it would return an empty set silently.
    if (value < 0 || value > 100) return `${value}% is not a share of the promoter holding`;
    return { op: "pledge", comparator: comparator as Comparator, value };
  }

  if (op === "band") {
    const b = parseBand(String(n.band ?? ""));
    if (!b) return `"${String(n.band)}" is not one of the five published labels`;
    return { op: "band", band: b };
  }

  if (op === "finding") {
    const kind = n.kind === "red_flag" || n.kind === "pattern" ? n.kind : null;
    const named = n.rule == null ? null : String(n.rule);
    if (named) {
      const key = RULE_KEYS.has(named) ? named : RULE_BY_NAME.get(norm(named));
      if (!key) return `"${named}" is not a check we run`;
      return { op: "finding", rule: key, kind: null };
    }
    if (!kind) return "a finding with neither a rule nor a kind";
    return { op: "finding", rule: null, kind };
  }

  if (op === "sector") {
    const want = norm(String(n.sector ?? ""));
    const hit = vocab.sectors.find((s) => norm(s) === want)
      // A reader says "pharma"; the sector is "Pharma & Healthcare". A prefix match on the FIRST word
      // is enough and still cannot invent a sector — it must resolve to one we hold.
      ?? vocab.sectors.find((s) => norm(s).startsWith(want) && want.length >= 4);
    if (!hit) return `"${String(n.sector)}" is not one of the ${vocab.sectors.length} sectors we hold`;
    return { op: "sector", sector: hit };
  }

  if (op === "peerGroup") {
    const want = norm(String(n.name ?? ""));
    const hit = vocab.peerGroups.find((p) => norm(p) === want)
      ?? vocab.peerGroups.find((p) => norm(p).includes(want) && want.length >= 5);
    if (!hit) return `"${String(n.name)}" is not one of the ${vocab.peerGroups.length} peer groups we hold`;
    return { op: "peerGroup", name: hit };
  }

  return `"${op}" is not an operator`;
}

/** Validate the whole envelope. Returns the normalised tree, or the reason it was refused. */
export function admitScreen(raw: unknown, vocab: ScreenVocabulary): Admission {
  if (!raw || typeof raw !== "object") return { ok: false, why: "the model returned no object" };
  const r = raw as Record<string, unknown>;
  // ★ A RANKING MAY CARRY NO FILTER. Where the model returns no tree but DID name something to rank
  //   by, "everything, in this order" is the reading — not a refusal about a missing condition.
  const hasOrder = !!r.order && typeof r.order === "object";
  const rawTree = r.tree ?? (hasOrder ? { op: "all" } : null);
  const node = admitNode(rawTree, vocab, 1);
  if (typeof node === "string") return { ok: false, why: node };

  const leaves = leavesOf(node);
  if (leaves.length === 0) return { ok: false, why: "a tree with no conditions in it" };
  if (leaves.length > MAX_LEAVES) return { ok: false, why: `${leaves.length} conditions, past the ${MAX_LEAVES} ceiling` };
  if (depthOf(node) > MAX_TREE_DEPTH) return { ok: false, why: `nesting deeper than ${MAX_TREE_DEPTH}` };

  const basis = r.basis === "standalone" || r.basis === "consolidated" ? r.basis : null;
  const shape = r.shape === "count" ? "count" : "list";

  // ── ORDERING ────────────────────────────────────────────────────────────────────────────────────
  let order: OrderClause | null = null;
  const rawOrder = r.order as Record<string, unknown> | null | undefined;
  if (rawOrder && typeof rawOrder === "object") {
    const key = FIELD_ALIASES.get(norm(String(rawOrder.field ?? "")));
    // ⚠ AN ORDERING ON A FIELD WE DO NOT HOLD IS REFUSED, not silently dropped — dropping it is the
    //   defect this clause exists to fix, arriving one layer later.
    if (!key) return { ok: false, why: `"${String(rawOrder.field)}" is not a field we can rank on` };
    order = { field: key, direction: rawOrder.direction === "asc" ? "asc" : "desc" };
  }

  // ── LIMIT ───────────────────────────────────────────────────────────────────────────────────────
  let limit: number | null = null;
  if (r.limit !== undefined && r.limit !== null) {
    const nLimit = Number(r.limit);
    if (!Number.isFinite(nLimit) || nLimit < 1) return { ok: false, why: `"${String(r.limit)}" is not a number of rows` };
    if (nLimit > MAX_LIMIT) return { ok: false, why: `${nLimit} rows is past the ${MAX_LIMIT} a single answer carries` };
    // ★★ SC-12. "Top 10" WITH NO ORDERING IS "any 10", and presenting an arbitrary ten as a selection
    //    is a leaderboard we invented. The reader names the basis or there is no leaderboard.
    if (!order) {
      return { ok: false, why: `a top-${nLimit} needs something to rank by — "top ${nLimit} by revenue", say — `
        + `because we do not pick what "best" means` };
    }
    limit = Math.floor(nLimit);
  }

  return { ok: true, parsed: { shape, basis, tree: node, order, limit } };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROMPT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ THE FIELD LIST IS THE DERIVED ONE, TRUNCATED TO WHAT FITS — and truncation is safe because
 *   validation resolves ALIASES, so a field the prompt did not name still lands if the model uses the
 *   reader's own words. The prompt teaches the SHAPE; the validator owns the vocabulary.
 */
function screenPrompt(question: string, vocab: ScreenVocabulary): string {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ THE WHOLE FIELD LIST, AND THE CHECK NAMES — measured, because the short list produced measured
  //    failures. With 60 of the 85 fields listed and no check names at all:
  //
  //      "revenue above 100cr"                    → field "netSales"   — invented, refused
  //      "revenue above 100cr but not in banking" → field "netMargin"  — a REAL field, wrong one
  //      "pledging above 50%"                     → cmp on "pledging"  — pledging is a CHECK, not a
  //                                                                       column, so it was refused
  //
  //    The second is the dangerous one: it validates, it runs, and only the restatement catches it.
  //    So the model is given every name it may use and told to copy one exactly.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const fields = [
    ...SCREEN_FIELDS_IDS.map((id) => `${id}=${SCREEN_FIELDS[id].label}`),
    ...DERIVED_SCREEN_FIELDS.map((f) => `${f.key}=${f.label}`),
  ].join(" | ");
  const checks = FILING_REGISTRY
    .map((e) => (STOCK_FINDINGS as Record<string, { name?: string }>)[e.ruleKey as string]?.name)
    .filter(Boolean).join(" | ");
  return [
    "Read this stock-screening question into JSON. Output JSON only.",
    "",
    "SHAPE:",
    '{"shape":"list"|"count","basis":"standalone"|"consolidated"|null,"tree":<node>,',
    ' "order":{"field":"<field>","direction":"desc"|"asc"}|null,"limit":<number>|null}',
    "",
    "A node is one of:",
    '  {"op":"and","nodes":[...]}   {"op":"or","nodes":[...]}   {"op":"not","node":<node>}',
    '  {"op":"cmp","field":"<field>","comparator":"gte"|"lte"|"gt"|"lt"|"eq","value":<number>,"magnitude":"none"|"percent"|"cr"|"lakhCr"|"times","grain":"quarterly"|"annual"}',
    '  {"op":"band","band":"Pristine"|"Healthy"|"Steady"|"Below Par"|"Fragile"}',
    '  {"op":"finding","rule":"<check name or null>","kind":"red_flag"|"pattern"|null}',
    '  {"op":"sector","sector":"<sector>"}',
    '  {"op":"all"}   ← use this when the reader named NO filter, only a ranking',
    '  {"op":"pledge","comparator":"gt","value":<percent>}',
    '  {"op":"trend","field":"<field>","direction":"up"|"down","periods":<quarters>,"of":<window>|null}',
    '  {"op":"growth","field":"<field>","comparator":"gt","value":<percent>,"window":"yoy"|"qoq"}',
    '  {"op":"relative","field":"<field>","comparator":"lt","benchmark":"sector"|"peerGroup"}',
    '  {"op":"peerGroup","name":"<peer group>"}',
    "",
    "RULES:",
    "- `field` MUST be copied EXACTLY from the FIELDS list below. Never invent a name. If the reader's",
    "  words are not in the list, pick the listed field whose meaning matches; if none does, omit that",
    "  condition rather than substituting a different field.",
    "- Copy the reader's number EXACTLY into `value`. Do NOT convert it. Put the unit they wrote in",
    "  `magnitude`: '100cr' is value 100 magnitude 'cr'; '15%' is value 15 magnitude 'percent';",
    "  a bare number is magnitude 'none'.",
    "- MARKET CAP and P/E are ordinary fields here: write {\"op\":\"cmp\",\"field\":\"marketCap\",...} or",
    '  "field":"peRatio". Say `cr` for a market cap in crore. A P/E takes no magnitude.',
    "- PRICE HISTORY too: `return1m` `return3m` `return6m` `return1y` are returns, and",
    "  `offFrom52WeekHigh` / `offFrom52WeekLow` are DISTANCES from those levels, always positive.",
    "- ★ IF THE READER GAVE A NUMBER, IT IS A FILTER. Always. Examples:",
    '    "up more than 50% in the last year"       → cmp return1y gt 50 magnitude percent',
    '    "within 10% of its 52-week high"          → cmp offFrom52WeekHigh lte 10 magnitude percent',
    '    "fallen more than 30% from its high"      → cmp offFrom52WeekHigh gt 30 magnitude percent',
    '    "down over 20% in 3 months"               → cmp return3m lt -20 magnitude percent',
    "  Turning a bound the reader typed into an ordering DROPS IT, and the answer then covers the",
    "  whole book. Never do that.",
    "- ⚠ ONLY WHEN THERE IS NO NUMBER AT ALL is it an ordering. 'Stocks near their 52-week high' names",
    '  no distance: {"op":"all"} with order {"field":"offFrom52WeekHigh","direction":"asc"}. Choosing',
    "  5% or 10% ourselves would be a cut-off the reader never set.",
    "- HOW MUCH something moved is a `growth` node, not a trend: 'revenue up more than 20% year on",
    '  year\' is {"op":"growth","field":"revenue","comparator":"gt","value":20,"window":"yoy"}. A TREND',
    "  says only the direction; a GROWTH carries the size. If the reader gave a percentage, it is growth.",
    "- COMPARED WITH ITS OWN GROUP is a `relative` node: 'stocks cheaper than their sector median' is",
    '  {"op":"relative","field":"peRatio","comparator":"lt","benchmark":"sector"}. Use it whenever the',
    "  comparison is against a sector or peer-group median rather than a number the reader typed.",
    "- 'UP IN 3 OF THE LAST 4 QUARTERS' is a trend with a window: periods 3, of 4. Without `of` the",
    "  moves must be consecutive.",
    "- GROWING / RISING / FALLING over time is a `trend` node, never a `cmp`. 'revenue growing for",
    "  four straight quarters' is",
    '  {"op":"trend","field":"revenue","direction":"up","periods":4}. `periods` is',
    "  the number of CONSECUTIVE MOVES; use 2 when the reader says 'growing' with no number.",
    "- Promoter exit, earnings quality and the other CHECKS are `finding` nodes, not fields.",
    "  Never write a `cmp` on a check.",
    "- PLEDGING WITH A NUMBER is a `pledge` node: 'pledging above 30%' is",
    '  {"op":"pledge","comparator":"gt","value":30}. Pledging with NO number — "stocks with a pledging',
    '  red flag" — is {"op":"finding","rule":"Pledging Crisis"}. The number is what tells them apart.',
    '- "how many" / "count" means shape "count". Otherwise "list".',
    '- "top 10 by revenue" / "largest" / "highest" → order {field, direction} AND limit. "cheapest",',
    '  "lowest", "smallest" → direction "asc". If the reader names a count but nothing to rank by,',
    '  still emit the limit — code will refuse it and say why. Never invent a ranking they did not ask for.',
    "- Use `or` and `not` where the reader did. Nest to match what they meant.",
    "- Only use `basis` if the reader said standalone or consolidated.",
    "",
    `FIELDS: ${fields}`,
    `CHECKS: ${checks}`,
    `SECTORS: ${vocab.sectors.join(", ")}`,
    "",
    `QUESTION: ${question}`,
  ].join("\n");
}

// ── the cache ─────────────────────────────────────────────────────────────────────────────────────
/**
 * ★ KEYED ON THE NORMALISED QUESTION, FOR THE REASON §6.5 GIVES: the roll of the dice happens once per
 *   question, so a reader asking the same thing twice gets the same companies. In-process, like the
 *   classification cache, with the same honest limit — it re-rolls on restart.
 */
const CACHE = new Map<string, ParsedScreen>();
const CACHE_MAX = 500;
const cacheKey = (q: string): string => q.toLowerCase().replace(/\s+/g, " ").trim();

export interface ParseResult {
  readonly parsed: ParsedScreen | null;
  /** "model" · "cache" · null when nothing was parsed. */
  readonly source: "model" | "cache" | null;
  /**
   * ⚠ READER-FACING, ALWAYS — and the first draft was not. A 429 fell through as
   *   `provider error: Gemini generateStructured failed: {"error":{"code":429,"mess`, truncated
   *   mid-JSON, printed under a perfectly good answer. A reader cannot act on a provider's status
   *   code and should not be shown one; what they can act on is knowing the question was read a
   *   simpler way.
   */
  readonly rejected: string | null;
  /**
   * ★ WHY IT WAS NOT USED, as a CLASS — because the two need different sentences.
   *   `unavailable` the parser could not run (quota, provider, no model). Nothing is wrong with the
   *                 question, and the reader is told the reading was simpler, not that they erred.
   *   `refused`     the parse ran and code would not accept it. That reason IS useful to a reader —
   *                 a bare magnitude against a crore column is the case it was built for.
   */
  readonly kind: "unavailable" | "refused" | null;
  /** Tokens this turn actually spent. 0 on a cache hit. */
  readonly tokens: number;
}

/** Provider and quota failures collapse to one sentence; a reader cannot act on a status code. */
const UNAVAILABLE = "the fuller reading was not available just now";

export async function parseScreen(
  question: string,
  vocab: ScreenVocabulary,
  actor: Actor = { kind: "system", job: "screen-parse" },
): Promise<ParseResult> {
  const key = cacheKey(question);
  const hit = CACHE.get(key);
  if (hit) return { parsed: hit, source: "cache", rejected: null, kind: null, tokens: 0 };

  if ((process.env.AI_PROVIDER ?? "mock") === "mock") {
    return { parsed: null, source: null, rejected: "no model configured", kind: "unavailable", tokens: 0 };
  }

  const model = MODEL();
  const decision = await checkAndConsumeAiCall(model, actor);
  if (!decision.allowed) {
    return { parsed: null, source: null, tokens: 0, kind: "unavailable", rejected: UNAVAILABLE };
  }

  try {
    const provider = createAiProvider();
    const res = await provider.generateStructured<unknown>({
      system: "You output JSON only. No prose outside the JSON.",
      messages: [{ role: "user", content: screenPrompt(question, vocab) }],
      // ★ SAME REASON AS THE ROUTER AND THE PLANNER. The same question should read the same way.
      temperature: 0,
    } as never);

    const tokens = (res.usage?.promptTokens ?? 0) + (res.usage?.outputTokens ?? 0);
    if (tokens > 0) await recordAiTokens(model, tokens);

    if (!res.ok) return { parsed: null, source: null, rejected: UNAVAILABLE, kind: "unavailable", tokens };
    const admitted = admitScreen(res.data, vocab);
    if (!admitted.ok) return { parsed: null, source: null, rejected: admitted.why, kind: "refused", tokens };

    if (CACHE.size >= CACHE_MAX) CACHE.clear();
    CACHE.set(key, admitted.parsed);
    return { parsed: admitted.parsed, source: "model", rejected: null, kind: null, tokens };
  } catch (e) {
    // ⚠ THE PROVIDER'S MESSAGE IS LOGGED, NOT SHOWN. It is an operational fact, not an answer.
    console.warn(`[screen-parse] provider error: ${(e as Error).message.slice(0, 160)}`);
    return { parsed: null, source: null, tokens: 0, kind: "unavailable", rejected: UNAVAILABLE };
  }
}

/** ★ FOR THE AGREEMENT MEASUREMENT ONLY — a cached parse would measure the cache, not the model. */
export function clearScreenParseCache(): void { CACHE.clear(); }
