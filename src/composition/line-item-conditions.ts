// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LINE-ITEM CONDITIONS — "revenue in its latest quarter greater than 100cr", read off the sentence.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE SIBLING OF `screen-conditions.ts`, AND THE DIFFERENCE IS WHICH VOCABULARY IT READS.
//
//   screen-conditions.ts   THIRTEEN scored fields, hand-listed, over the 95 companies we SCORE.
//   this                   EIGHTY-FIVE filed line items, DERIVED from the data model, over the 2,284
//                          companies that have filed a statement.
//
// ⚠ THE OBSERVED FAILURE IS THE PLAINEST SCREEN ANYBODY WILL ASK FOR. "Give me a list of stocks whose
//   revenue in its latest quarter is greater than 100cr" was answered with a DEFINITION CARD, because
//   revenue is not a scored metric and the hand-kept list did not have it. There is no shortage of
//   data behind that question — 2,178 companies have filed a revenue figure — only a shortage of
//   vocabulary.
//
// ── ★ THE SAME THREE RULES `extractConditions` HOLDS, FOR THE SAME REASONS ────────────────────────
//   · CODE-EXTRACTED (§6.5). A threshold the model produced would move between two identical asks and
//     return a different list, with nothing on screen saying the question had changed.
//   · A FIELD, A COMPARATOR **AND** A NUMBER. "Companies with big revenue" states no bound; choosing
//     one for the reader answers a different question.
//   · LONGEST PHRASE FIRST, so "return on capital employed" cannot be eaten by "return on capital".
//
// ── ★★ AND ONE RULE THAT IS THIS FILE'S OWN: THE UNIT IS PART OF THE CONDITION ────────────────────
// `cet1Ratio` is stored as a FRACTION — 0.8907 means 89.07%. A reader typing "core capital above 15%"
// means 0.15 in that column and 15 in a PERCENT one. The unit is on the generated field (derived from
// the schema's own `// UNIT:` annotations), so the reader's number is scaled onto the stored one here
// rather than in the SQL, where it would be invisible.
//
// ⚠ CURRENCY IS ₹ CRORE BECAUSE THE COLUMN IS. Every money column in the schema is Decimal(18,2) in
//   crore, so "100cr", "100 crore" and a bare "100" are all 100. "1 lakh crore" is 100000. A reader
//   who writes rupees ("above 1000000000") gets a screen over a crore column and an empty result — an
//   honest miss we cannot currently tell from a real one, and it is named in the report as a gap.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { DERIVED_SCREEN_FIELDS, type DerivedScreenField } from "../scoring/read/screen-fields.generated.js";
import { SCREEN_FIELDS } from "../scoring/read/screen.types.js";

/** One filed-line-item bound, already in the STORED unit. */
export interface LineItemCondition {
  readonly field: DerivedScreenField;
  /** Which grain this condition reads — the reader's words, or the field's only option. */
  readonly grain: "quarterly" | "annual";
  /** Inclusive, and in the column's own unit. */
  readonly min?: number;
  readonly max?: number;
  /** What the reader typed, for echoing the bound back without re-deriving it. */
  readonly saidValue: string;
}

const ABOVE = /(above|over|greater than|more than|at least|>=?|higher than|exceeds?|beyond)/i;
const BELOW = /(under|below|less than|lower than|at most|<=?|no more than|beneath)/i;

/**
 * ★ THE SCORED THIRTEEN WIN A COLLISION, AND THAT IS A DELIBERATE CHOICE RATHER THAN AN ACCIDENT.
 *
 * `operatingMargin` and `netMargin` are BOTH a scored metric (95 companies, peer-relative context,
 * `score_metrics.raw_value`) and a filed column (2,178 companies). A reader asking for "operating
 * margin above 20" could mean either.
 *
 * ⚠ THE SCORED PATH KEEPS THEM because it is the EXISTING behaviour and silently widening a live
 *   answer from 95 companies to 2,178 is a change no reader asked for and none would see. It costs
 *   reach on two fields and it is named in the report as the one place the vocabulary is not simply
 *   "everything we hold".
 */
const SCORED_LABELS = new Set(Object.values(SCREEN_FIELDS).map((f) => f.label.toLowerCase()));

/** camelCase → "camel case", so the key itself is a phrase a reader may have typed. */
const spaced = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

interface Phrase { phrase: string; field: DerivedScreenField }

/**
 * Every way a reader can name a filed field: the gloss LABEL, the authored ALIASES, and the key
 * itself spaced out. Longest first — the whole point of the ordering.
 *
 * ⚠ A PHRASE TWO FIELDS CLAIM IS DROPPED, NOT PICKED BETWEEN. `verify-metric-aliases.ts` already
 *   fails the build on an alias claimed twice, so this can only fire on a LABEL collision — and the
 *   schema has two ("Total costs" is both `expenses` and `totalExpenses"). Answering one of them
 *   would be a coin flip the reader cannot see; refusing sends the sentence to the next reading.
 */
const PHRASES: readonly Phrase[] = (() => {
  const claimed = new Map<string, DerivedScreenField[]>();
  for (const f of DERIVED_SCREEN_FIELDS) {
    for (const p of [f.label, ...f.aliases, spaced(f.key)]) {
      const k = p.toLowerCase().trim();
      if (k.length < 3) continue;
      if (SCORED_LABELS.has(k)) continue;
      const cur = claimed.get(k);
      if (cur) { if (!cur.includes(f)) cur.push(f); } else claimed.set(k, [f]);
    }
  }
  return [...claimed]
    .filter(([, fs]) => fs.length === 1)
    .map(([phrase, fs]) => ({ phrase, field: fs[0]! }))
    .sort((a, b) => b.phrase.length - a.phrase.length);
})();

/** Reader words that pin the grain. Absent, the field's own availability decides. */
const ANNUAL_WORDS = /\b(annual|annually|yearly|full[- ]year|fiscal year|financial year|fy\d{2}|per year|a year)\b/i;
const QUARTER_WORDS = /\b(quarter|quarterly|q[1-4]\b|latest quarter|this quarter)\b/i;

/**
 * ★ THE READER'S NUMBER, ONTO THE STORED ONE.
 *
 * Returns `null` where the sentence carries a magnitude word we do not model, rather than reading it
 * as a bare number — "revenue above 5 lakh" against a crore column is a thousand-fold error and it
 * would look like a working screen.
 */
function scale(raw: number, suffix: string, unit: DerivedScreenField["unit"]): number | null {
  const s = suffix.toLowerCase();
  if (unit === "currency") {
    if (/\b(lakh\s*cr|lakh\s*crore)/.test(s)) return raw * 100_000;
    if (/\bcr\b|crore/.test(s)) return raw;
    if (/\b(lakh|lac)\b/.test(s)) return null;   // lakh RUPEES against a crore column — refuse
    if (/\bbn\b|billion/.test(s)) return null;   // ambiguous currency — refuse
    return raw;                                   // bare number: the column's own unit, crore
  }
  // ⚠ A FRACTION COLUMN TAKES THE READER'S PERCENT DIVIDED BY 100. This is the one that silently
  //   returns nothing when it is wrong, because 15 is above every value in a 0–1 column.
  if (unit === "fraction") return raw / 100;
  return raw; // percent, times, perShare — the reader's number is the stored one
}

export function extractLineItemConditions(text: string): LineItemCondition[] {
  const lower = text.toLowerCase();
  const out: LineItemCondition[] = [];
  const claimed: [number, number][] = [];
  const overlaps = (a: number, b: number) => claimed.some(([x, y]) => a < y && b > x);

  const wantsAnnual = ANNUAL_WORDS.test(lower);
  const wantsQuarter = QUARTER_WORDS.test(lower);

  for (const { phrase, field } of PHRASES) {
    const at = lower.indexOf(phrase);
    if (at < 0 || overlaps(at, at + phrase.length)) continue;

    // The comparator and the number must FOLLOW the field within a short span — "revenue above 100"
    // is one condition; "revenue" here and "above 100" about something else two clauses later is not.
    const tail = lower.slice(at + phrase.length, at + phrase.length + 48);
    const num = /(-?\d+(?:\.\d+)?)\s*(%|cr\b|crore[s]?|lakh\s*crore|lakh|lac|bn\b|billion|x\b)?/.exec(tail);
    if (!num) continue;
    const v = Number(num[1]);
    if (!Number.isFinite(v)) continue;

    const below = BELOW.test(tail);
    const above = ABOVE.test(tail);
    // ⚠ NEITHER COMPARATOR MEANS NO CONDITION — `extractConditions`' own rule. "Revenue 100" states a
    //   value, not a bound, and choosing one would answer a different question.
    if (!below && !above) continue;

    const scaled = scale(v, num[2] ?? "", field.unit);
    if (scaled === null) continue;

    // Which grain. The reader's words first; otherwise whichever the field actually has, preferring
    // the quarterly one because "latest" means the most recent thing filed.
    const hasQ = field.sources.some((s) => s.grain === "quarterly");
    const hasA = field.sources.some((s) => s.grain === "annual");
    const grain: "quarterly" | "annual" =
      wantsAnnual && hasA ? "annual"
      : wantsQuarter && hasQ ? "quarterly"
      : hasQ ? "quarterly" : "annual";

    claimed.push([at, at + phrase.length]);
    out.push({
      field, grain,
      ...(below ? { max: scaled } : { min: scaled }),
      saidValue: `${num[1]}${num[2] ? ` ${num[2]}` : ""}`,
    });
  }
  return out;
}

/** How many distinct fields a reader could filter on here — for the report and for the gate. */
export const LINE_ITEM_FIELD_COUNT = DERIVED_SCREEN_FIELDS.length;
