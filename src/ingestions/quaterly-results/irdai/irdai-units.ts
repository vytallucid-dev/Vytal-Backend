// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIT RULE — B1a. Scan the WHOLE form. RAISE if nothing is found. NEVER default.
//
// ⚠ FOUR DEFECTS IN THIS PROGRAMME HAVE COME FROM AN ASSUMED UNIT: ROA divided by 1e7, persistency
//   100x, AUM x100, and a fourth found by looking for it. Every one of them was a parser that
//   "knew" the scale. This file exists so that this lane cannot know it.
//
// ★ THE COST OF DEFAULTING, MEASURED. LIC L-1-A-RA, quarter ended 30-Jun-2026:
//       declared unit  Rs CRORE   -> grand-total premium 1,27,420.12 -> stored 127420.12  ✓
//       assumed  lakh             -> 1,27,420.12 / 100 = 1,274.20    -> 100x LOW
//   India's largest insurer, off by two orders of magnitude, cross-footing perfectly the whole way.
//
// ⚠⚠ WHY LIC IS THE HARD CASE, and it is harder than "below the footnotes":
//   1. In pdf text order the page header block emits AFTER the footnotes, so a scanner that reads
//      the first N lines of a form finds nothing.
//   2. THE DECLARATION IS IN DEVANAGARI ONLY. The literal token is:
//         ( U+0928-less )  र U+0930 · ा U+093E · ि U+093F · श U+0936   [raashi = amount]
//                          Ŝ U+015C · प U+092A · य U+092F · े U+0947   [rupaye = rupees, with the
//                                                                       "ru" glyph mangled to U+015C]
//                          क U+0915 · र U+0930 · ो U+094B · ड़ U+095C   [karod = crore]
//                          म U+092E · Ő U+0150                          [mein = in]
//      There is NO English unit statement anywhere in the form header. The only ASCII "Crore"
//      strings in the whole document are inside a footnote about the surplus breakup.
//   3. ⚠ THE NUKTA. The final letter of "crore" is U+095C, the PRECOMPOSED nukta form, not the
//      U+0921 + U+093C decomposition and not a bare U+0921. A matcher written against the obvious
//      spelling silently misses it. MEASURED: searching for U+0915 U+0930 U+094B U+0921 returns
//      ZERO hits on the live document.
//   The defence is a SKELETON match: drop every combining mark and fold the precomposed nukta
//   letters back to their base, then compare consonant skeletons. करोड़ -> "करड", लाख -> "लख".
//   That survives matra mangling, nukta composition, and the plural "करोड़ों".
//
// ⚠ AND A CORRECTION TO THE STAGE-9 ASSESSMENT, which this file is written to prevent recurring:
//   Stage 9 reported GODIGIT NL-1-B-RA as declaring NO unit. That was the SCANNER's fault, not the
//   document's. Digit declares "₹ in Lakhs" — bare, unparenthesised, and emitted near the very end
//   of the text layer. The Stage-9 pattern required a parenthesis or an "Amount in" prefix.
//   MEASURED after widening: 8 of 8 documents declare a unit. The lesson is that the pattern must
//   be generous and the SCAN must cover the whole form; a narrow pattern produces a false
//   "undeclared", and a false "undeclared" is one bad decision away from a false default.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export type MoneyUnit = "crore" | "lakh" | "million" | "thousand" | "rupee";

/** Multiplier from the declared unit into RUPEES CRORE, which is what the four insurance tables store.
 *  ⚠ The DB convention is crore: xbrl/extract.ts:58 divides INR facts by 1e7. Verified against
 *  ICICIGI FY26 — form says 2,226,357 (Rs lakh) and the column holds 22263.57. */
export const TO_CRORE: Record<MoneyUnit, number> = {
  crore: 1,
  lakh: 1 / 100,
  million: 1 / 10,
  thousand: 1 / 10_000,
  rupee: 1 / 10_000_000,
};

// ── Devanagari skeleton ────────────────────────────────────────────────────────────────────────────
// Precomposed nukta letters (U+0958..U+095F) folded back to base consonant.
const NUKTA_FOLD: Record<string, string> = {
  "क़": "क", // qa  -> ka
  "ख़": "ख", // khha-> kha
  "ग़": "ग", // ghha-> ga
  "ज़": "ज", // za  -> ja
  "ड़": "ड", // dddha -> da   ⚠ THIS ONE. The last letter of करोड़.
  "ढ़": "ढ", // rha -> dha
  "फ़": "फ", // fa  -> pha
  "य़": "य", // yya -> ya
};

/**
 * Fold the nukta ONLY: drop the combining nukta U+093C and map the precomposed nukta letters back
 * to their base. Vowel matras are KEPT.
 *
 * ⚠ AN EARLIER VERSION OF THIS FUNCTION DROPPED ALL COMBINING MARKS ("consonant skeleton") AND WAS
 *   WRONG. Measured on the live LIC form:
 *      लाख   (laakh, the money word)   -> skeleton "लख"
 *      अपलेखन (apalekhan, "write-off")  -> skeleton "पलखन"  which CONTAINS "लख"
 *   so every LIC form false-matched "lakh" and the resolver reported a lakh/crore conflict on a
 *   document that declares only crore. लेखा ("account") collides the same way and appears in every
 *   Hindi revenue-account form. Dropping matras destroys exactly the vowel that separates the money
 *   word from the accounting word. Fold the nukta, keep the matras, match the literal.
 */
export function foldNukta(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "़") continue; // combining nukta
    out += NUKTA_FOLD[ch] ?? ch;
  }
  return out;
}

/** The two money words, nukta-folded, matched as LITERALS.
 *  करोड़ folds to करोड — this is the U+095C case that a naive spelling misses. */
const DEV_CRORE = foldNukta("करोड़"); // -> करोड
const DEV_LAKH = foldNukta("लाख"); //   -> लाख

// ── Latin patterns ─────────────────────────────────────────────────────────────────────────────────
// ⚠ Deliberately wide. Eight distinct spellings were MEASURED across the eight documents:
//   "(₹ Lakh)" · "(₹ lakhs)" · "(Rs. in Lakhs)" · "(₹ in lakh)" · "(₹lakh)" · "(Rs Lakhs)" ·
//   "Amount in Rs. Lakhs" · "₹ in Lakhs" (bare, no parentheses — the one Stage 9 missed).
const LATIN_UNIT = /\b(lakhs?|lacs?|crores?|millions?|thousands?)\b/gi;

/**
 * ⚠ NUMERIC UNIT NOTATION — "(Rs.'000)", "₹ ('000)", "(Rs.<mangled-quote>000)".
 *
 * MEASURED on NIACL, and it is the reason a per-insurer unit default is not merely inelegant but
 * WRONG for the same insurer:
 *     Mar-2016 NL-1-B-RA   (Rs.<U+201F>000)   -> THOUSAND
 *     Sep-2020 NL-1-B-RA   ₹ ('000)           -> THOUSAND
 *     Jun-2023 NL-1-B-RA   (Amount in Rs. Lakhs) -> LAKH
 * One insurer, one form number, three vintages, two different units. A profile saying
 * "NIACL = lakh" reads its own 2016 and 2020 filings 100x HIGH, and every one of them cross-foots.
 *
 * The apostrophe is whatever the producer emitted: ASCII ' , U+2018/U+2019 curly, U+201F reversed
 * double, or U+02BC. Match any of them, or none at all.
 */
/**
 * ⚠ THE CURRENCY MARK IS OFTEN NOT "₹". Both ICICI producers emit the rupee sign as a BACKTICK,
 *   and then a separate apostrophe for the thousands elision:
 *      ICICIPRULI FY2019 L-1   "(` '000)"      backtick + ASCII apostrophe
 *      ICICIGI    FY2019 NL-1  "(` ’000)"      backtick + U+2019
 *   MEASURED: an earlier pattern allowed ONE optional quote character and a fixed currency set of
 *   rs/inr/₹. It matched neither, reported "undeclared", and the lane refused 19 of 84 units in the
 *   first production run — every ICICIPRULI unit (13) and every ICICIGI unit (6), which are the two
 *   DEEPEST archives in the corpus. The prefix is therefore a repeated class of currency marks,
 *   quote glyphs, dots and spaces, in any order and any number.
 */
// ⚠ AND THE WORD "IN" CAN SIT BETWEEN THE MARK AND THE ZEROS. GICRE's HTML disclosures write
//   "( ` IN 000)" — backtick, then the literal word IN, then the zeros. Without it in the prefix
//   class the whole GICRE archive reads as "undeclared". It is a word, not a glyph, so it is
//   anchored with \b; it can only ever match inside the bracketed prefix that precedes the zeros,
//   which is why admitting so common a word here is safe.
const CURRENCY_OR_QUOTE = "rs\\.?|inr|in\\b|₹|[`´'‘’‛\"“”‟ʼ.\\s]";
const NUMERIC_UNIT = new RegExp(
  `[(\\[]\\s*(?:${CURRENCY_OR_QUOTE})*\\s*(000|00,000|0{2},0{2},0{3})\\s*[)\\]]`,
  "gi",
);

/** "000" -> thousand · "00,000" -> lakh · "00,00,000" -> crore. The count of zeros IS the unit. */
function numericNotationToUnit(digits: string): MoneyUnit | null {
  const zeros = digits.replace(/,/g, "").length;
  if (zeros === 3) return "thousand";
  if (zeros === 5) return "lakh";
  if (zeros === 7) return "crore";
  return null;
}

const LATIN_TO_UNIT: Record<string, MoneyUnit> = {
  lakh: "lakh",
  lakhs: "lakh",
  lac: "lakh",
  lacs: "lakh",
  crore: "crore",
  crores: "crore",
  million: "million",
  millions: "million",
  thousand: "thousand",
  thousands: "thousand",
};

export interface UnitEvidence {
  unit: MoneyUnit;
  /** Where it was found, verbatim, for the audit trail. */
  token: string;
  script: "latin" | "devanagari";
  /** Character offset in the scanned text. LIC's lands near the END — that is the point. */
  offset: number;
  /**
   * ⚠ Is this a DECLARATION or is it PROSE?
   *   declaration : "(₹ Lakh)", "Amount in Rs. Lakhs", "₹ in Lakhs", "(रााशश Ŝपये करोड़ मŐ)"
   *   prose       : "Rs. 928.42 Crore" in a footnote, "in excess of Rs. 5 lakhs" in a threshold note
   * Only declarations decide the unit. Prose is recorded but never votes — a threshold note saying
   * "Rs 5 lakhs" inside a crore-denominated form must not turn the form into lakh.
   */
  shape: "declaration" | "prose";
}

/** Text immediately before a unit word that makes it a DECLARATION rather than prose. */
const DECL_PREFIX = /(?:\(|amount\s+in|figures\s+in|rs\.?|inr|₹|in)\s*\.?\s*$/i;
/** A digit right before the unit word makes it prose: "928.42 Crore", "5 lakhs". */
const PROSE_PREFIX = /[\d,][\s.]*$/;

export type UnitResolution =
  | { ok: true; unit: MoneyUnit; toCrore: number; evidence: UnitEvidence[] }
  | { ok: false; reason: "undeclared" | "conflicting"; detail: string; evidence: UnitEvidence[] };

/**
 * ⚠ THE RULE. Pass the ENTIRE text of ONE FORM — header, body, footnotes, in whatever order the
 *   text layer emits them. Never a slice, never "the first page", never "the last 500 chars".
 *
 * ⚠⚠ SCOPE IS ONE FORM, NOT ONE FILE. A combined bundle (HDFCLIFE, CANHLIFE, NIVABUPA, NIACL,
 *   ICICIPRULI) is 45-plus separate forms in one PDF, and the unit is a property of the FORM.
 *   MEASURED on the HDFCLIFE FY2026 bundle: exactly one "(₹ Lakh)" per page, 94 in the file, plus
 *   70 unrelated "crore" words in prose across the notes. Handing the whole bundle to this function
 *   reports a lakh/crore CONFLICT on a document where every form is unambiguously lakh.
 *   Use splitFormPages() and resolve per page. That is what the caller does.
 *
 * Returns ok:false for BOTH failure shapes, and the caller must treat both as fatal for that form:
 *   - "undeclared"  : no unit DECLARATION. Never fall back to a profile default.
 *   - "conflicting" : two different declared units in one form. Also fatal — silently picking one
 *                     is the same class of mistake as defaulting.
 */
export function resolveUnit(formText: string): UnitResolution {
  const evidence: UnitEvidence[] = [];

  for (const m of formText.matchAll(LATIN_UNIT)) {
    const unit = LATIN_TO_UNIT[m[1].toLowerCase()];
    if (!unit) continue;
    const before = formText.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
    const shape: UnitEvidence["shape"] = PROSE_PREFIX.test(before)
      ? "prose"
      : DECL_PREFIX.test(before)
        ? "declaration"
        : "prose";
    evidence.push({ unit, token: m[0], script: "latin", offset: m.index ?? 0, shape });
  }

  // Numeric notation: "(Rs.'000)" and friends. Always a DECLARATION — a bare zero-run in
  // parentheses next to a currency marker is never prose.
  for (const m of formText.matchAll(NUMERIC_UNIT)) {
    const unit = numericNotationToUnit(m[1]);
    if (unit) {
      evidence.push({ unit, token: m[0], script: "latin", offset: m.index ?? 0, shape: "declaration" });
    }
  }

  // Devanagari: walk word runs, fold the nukta, match the money word as a LITERAL.
  // ⚠ Latin Extended-A is included in the run class because this producer substitutes mangled
  //   lookalikes (LIC's "ru" renders as U+015C, "en" as U+0150) mid-word; excluding them would
  //   split a word across the money token.
  for (const m of formText.matchAll(/[ऀ-ॿĀ-ſ]+/g)) {
    const folded = foldNukta(m[0]);
    const unit: MoneyUnit | null = folded.includes(DEV_CRORE)
      ? "crore"
      : folded.includes(DEV_LAKH)
        ? "lakh"
        : null;
    if (!unit) continue;
    const before = formText.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
    // ⚠ LIC's declaration is "( राशि रुपये करोड़ में )" — the money word sits AFTER "रुपये"/rupees and
    //   inside parentheses, with no digit before it. A digit before it means prose, as in Latin.
    const shape: UnitEvidence["shape"] = PROSE_PREFIX.test(before) ? "prose" : "declaration";
    evidence.push({ unit, token: m[0], script: "devanagari", offset: m.index ?? 0, shape });
  }

  // ★ ONLY DECLARATIONS VOTE. Prose is kept in the evidence for the audit trail and ignored here.
  //   Without this, NL-1's standard footnote ("items ... in excess of ... Rs.5,00,000") and LIC's
  //   surplus note ("Rs. 928.42 Crore") would each get a ballot.
  const declarations = evidence.filter((e) => e.shape === "declaration");

  if (declarations.length === 0) {
    const proseNote = evidence.length
      ? ` (${evidence.length} unit word(s) found, but all in prose: ${evidence
          .slice(0, 3)
          .map((e) => JSON.stringify(e.token))
          .join(", ")})`
      : "";
    return {
      ok: false,
      reason: "undeclared",
      detail:
        "no money-unit DECLARATION in this form — latin lakh/lac/crore/million/thousand or " +
        `devanagari करोड/लाख, preceded by a currency marker or an opening paren${proseNote}. ` +
        "REFUSING: this lane never defaults a unit.",
      evidence,
    };
  }

  const distinct = [...new Set(declarations.map((e) => e.unit))];
  if (distinct.length > 1) {
    // ⚠ Genuine disagreement between two DECLARATIONS is never resolved by majority vote — that is
    //   a guess wearing a statistic.
    return {
      ok: false,
      reason: "conflicting",
      detail: `form carries ${distinct.length} different unit declarations: ${distinct
        .map((u) => `${u} (${declarations.filter((e) => e.unit === u).length}x)`)
        .join(", ")} — REFUSING rather than choosing one.`,
      evidence,
    };
  }

  const unit = distinct[0];
  return { ok: true, unit, toCrore: TO_CRORE[unit], evidence };
}

/**
 * Split a bundle's page texts into per-form scopes for the unit rule.
 * A form may span several consecutive pages (HDFCLIFE's L-1-A-RA spans 4); each page of a
 * multi-page form carries its own declaration, so per-page is the safe granularity and never
 * merges two forms' units.
 */
export function splitFormPages(pageTexts: string[]): Array<{ pageNo: number; text: string }> {
  return pageTexts.map((text, i) => ({ pageNo: i + 1, text }));
}

/** Thrown by callers that cannot proceed. Distinct type so the ledger can classify it. */
export class UnitUndeclaredError extends Error {
  constructor(
    readonly formId: string,
    readonly resolution: Extract<UnitResolution, { ok: false }>,
  ) {
    super(`UNIT RULE: ${formId} — ${resolution.reason}: ${resolution.detail}`);
    this.name = "UnitUndeclaredError";
  }
}

/** Convenience: resolve or throw. The lane calls this, so a missing unit cannot become a null. */
export function requireUnit(formId: string, formText: string): { unit: MoneyUnit; toCrore: number; evidence: UnitEvidence[] } {
  const r = resolveUnit(formText);
  if (!r.ok) throw new UnitUndeclaredError(formId, r);
  return { unit: r.unit, toCrore: r.toCrore, evidence: r.evidence };
}
