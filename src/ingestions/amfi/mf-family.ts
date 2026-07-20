// ═══════════════════════════════════════════════════════════════
// MF FAMILY NORMALIZER (Step 16) — derive "same fund" from a scheme NAME.
//
// There is no clean key for "same fund". The scheme CODE does not group a fund's plans (Step 9
// proved it: Direct and Regular are separate codes), so the grouping has to be parsed out of
// `scheme_name` — 13,704 hand-typed strings. Everything here is built around that one fact.
//
// ── THE MECHANISM: TAIL-STRIP, STOP-AT-FIRST-UNKNOWN ────────────────────────────────────────
// A fund's identity is the HEAD of its name; the plan/option annotation is the TAIL. So: strip
// KNOWN plan/option phrases off the END, and HALT the instant the tail is a word we do not know.
//
// The over-merge guard is therefore STRUCTURAL, not a blocklist: unrecognised trailing text is
// IDENTITY BY DEFAULT. FMP series numbers survive not because a rule protects them, but because
// "264" is not in the vocabulary and the walk simply stops there:
//     "DSP FMP Series - 264 - 60M - 17D - Direct - Growth"  →  "dsp fmp series 264 60m 17d"
//     "DSP FMP Series - 267 - 1172 Days - Direct - Growth"  →  "dsp fmp series 267 1172 days"
// Two families, automatically. Nothing in this file knows what an FMP is.
//
// ── THE TWO TEMPTATIONS, BOTH MEASURED, BOTH FATAL ──────────────────────────────────────────
// 1. "Fuzzy-match near-identical keys."  NEVER. 8,705 key pairs sit within edit-distance 2 inside
//    a single fund house. At d=1, "govenment"/"government" (the SAME fund — AMFI misspells it on
//    2 of 4 codes) is textually INDISTINGUISHABLE from "the 30s"/"the 40s" (different retirement
//    funds) and "sdl sep 2025"/"sep 2027" (different maturities). At d=2, "low duration"/"long
//    duration" — different funds. No threshold separates them. The key is EXACT, always. The typo
//    splitting one fund into two families is the price, and it is the cheap one: an honest split
//    is an ungrouped singleton, while a wrong merge shows one fund's plans under another's name.
//
// 2. "Strip the plan word wherever it appears."  NEVER — and this one is subtle. "Regular" is BOTH
//    a plan marker AND a fund-name word:
//        ICICI Prudential SAVINGS Fund [14 codes] ≠ ICICI Prudential REGULAR SAVINGS Fund [10]
//        DSP SAVINGS Fund              [ 9 codes] ≠ DSP REGULAR SAVINGS Fund              [ 6]
//    (money-market funds vs conservative hybrids — genuinely different funds, one word apart.)
//    A positional strip MERGES them. Plan words are stripped ONLY from the tail, where they are
//    structurally an annotation — never from the middle, where they are a name.
//
// ── THE VOCABULARY WAS MEASURED, NOT IMAGINED ───────────────────────────────────────────────
// An exhaustive census of every distinct name-tail in the catalogue produced tokens no one would
// have guessed: "div" (abbrev), "cumulative" (a Growth synonym), "flexi"/"maturity"/"periodic"
// (UTI's IDCW cadences), "idcws" (a typo), "payout & reinvestment". Designing this list from
// memory instead of from the data would have shattered UTI's entire fixed-term book.
// ═══════════════════════════════════════════════════════════════

/** "(formerly known as X)" embeds ANOTHER fund's name mid-string — leaving it in splits a family.
 *  A blind paren-strip is NOT the answer: it would also delete real identity like "(93 Days)" and
 *  "(Segregated - 13092019)". So we remove ONLY the parentheticals that announce themselves. */
const NOISE_PAREN = /\((?:\s*(?:formerly|erstwhile|earlier)\b[^)]*)\)?/gi;

/** The plan/option tail vocabulary, authored LONGEST-FIRST so "growth option" is consumed before
 *  bare "growth", and the IDCW legalese before the bare "option" that trails it. */
const TAIL_PHRASES: readonly string[] = [
  // the IDCW legalese, in every partial form AMFI actually publishes
  "reinvestment of income distribution cum capital withdrawal option",
  "payout of income distribution cum capital withdrawal option",
  "income distribution cum capital withdrawal option",
  "reinvestment of income distribution cum capital withdrawal",
  "payout of income distribution cum capital withdrawal",
  "income distribution cum capital withdrawal",
  // the payout/reinvest PREFIX. Without these, "Payout of IDCW" strips only "idcw" and halts on
  // the orphaned "of" — STRANDING the plan word in the key and splitting the fund by plan.
  "payout and reinvestment", "payout of", "reinvestment of", "re investment of",
  // IDCW + synonyms + abbreviations + typos
  "idcw payout option", "idcw reinvestment option", "idcw payout", "idcw reinvestment",
  "idcw option", "idcw plan", "idcws option", "idcws", "idcw",
  "dividend payout option", "dividend reinvestment option", "dividend payout",
  "dividend reinvestment", "dividend option", "dividend plan", "dividend",
  "div payout option", "div reinvestment option", "div option", "div plan", "div",
  // growth + synonyms ("cumulative" is ICICI's word for Growth; "bonus" is a real third option —
  // all 189 Bonus schemes are the option, NOT ONE fund is named "… Bonus Fund")
  "growth option", "growth plan", "growth",
  "cumulative option", "cumulative plan", "cumulative",
  "bonus option", "bonus plan", "bonus",
  "payout option", "reinvestment option", "reinvest option",
  "payout", "reinvestment", "re investment", "reinvest",
  // plan
  "direct plan", "regular plan", "direct", "regular",
  // cadence — an IDCW frequency is NEVER an identity
  "daily", "weekly", "fortnightly", "monthly", "quarterly", "half yearly", "halfyearly",
  "annual", "annually", "yearly", "flexi", "maturity", "periodic",
  // bare structural leftovers
  "option", "plan",
];

/** Tail words that CHANGE WHICH FUND THIS IS — the walk stops dead at one, never strips past it.
 *
 *  Stripping a plan-CLASS token (institutional/retail/eco) would not merely rename a family: it
 *  would collide two schemes onto ONE plan+option slot, because ABSL publishes BOTH
 *  "…Global Excellence… - Retail Plan - Direct Plan - Growth" AND a plain Direct Growth. Retaining
 *  them is what keeps every slot in a family unique. "segregated"/"portfolio" guard side-pocketed
 *  portfolios, which are a genuinely separate NAV series from the parent fund. */
const IDENTITY_TAIL: ReadonlySet<string> = new Set([
  "segregated", "portfolio", "institutional", "retail", "eco", "series", "unclaimed",
]);

/** Grammatical glue. A fund's name never ENDS in one, so popping it off the tail cannot destroy
 *  identity — the same argument that licenses collapsing punctuation. Without this, Kotak's
 *  "IDCW - Payout & Re-investment of Income Distribution cum capital withdrawal option" halts on a
 *  dangling "and" and strands the plan word, splitting the fund. */
const CONNECTORS: ReadonlySet<string> = new Set(["and", "of", "the", "cum", "with", "a", "an"]);

type Tok = { w: string; end: number };

/** Tokenize to normalized words while remembering each word's END OFFSET IN THE ORIGINAL STRING —
 *  so the caller can recover the fund's name in the AMC's OWN CASING ("HDFC Large Cap Fund"),
 *  rather than title-casing it back out of a lowercased key.
 *
 *  PUNCTUATION IS NEVER IDENTITY; WORDS ALWAYS ARE. Every separator collapses to nothing, which is
 *  what lets "UTI - Flexi Cap Fund" and "UTI Flexi Cap Fund" (the same fund) reach one key. "&" is
 *  the sole exception: it becomes the WORD "and", never a gap, so "Large & Mid Cap" cannot collapse
 *  onto a real "Large Mid Cap".
 *
 *  The noise parenthetical is blanked with SPACES OF EQUAL LENGTH rather than deleted, so every
 *  surviving offset still points into the untouched original. */
function tokenize(raw: string): Tok[] {
  const masked = raw.replace(NOISE_PAREN, (m) => " ".repeat(m.length));
  const toks: Tok[] = [];
  const re = /[A-Za-z0-9]+|&/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    toks.push({ w: m[0] === "&" ? "and" : m[0].toLowerCase(), end: m.index + m[0].length });
  }
  return toks;
}

export type Family = {
  /** The exact grouping key: lowercased, punctuation-collapsed, plan/option tail removed. */
  key: string;
  /** The fund's name as the AMC WROTE IT — the head of the raw string, casing intact. */
  canonicalName: string;
  /** The plan/option tokens that were stripped ("direct plan + growth"). "" = nothing stripped.
   *  This is the variant label the fund page renders AND the over-merge detector: a real fund has
   *  exactly one "Direct + Growth", so two members claiming one slot is a duplicate or a bad merge. */
  planOption: string;
  /** HONEST-EMPTY. Set ⇒ we REFUSE to group this scheme; it becomes a singleton stating why.
   *  Never fabricate a group to leave this undefined. */
  reason?: string;
};

export function deriveFamily(schemeName: string): Family {
  // An "Unclaimed Redemption and Dividend Plan" is a SEPARATE scheme, not a plan variant of the
  // parent fund — and its name carries option words as IDENTITY, which the stripper would eat
  // ("JM Liquid Fund Unclaimed Dividend" → "jm liquid fund unclaimed", losing the "Dividend" that
  // distinguishes it from the Unclaimed *Redemption* scheme). Refuse it outright.
  if (/\bunclaimed\b/i.test(schemeName))
    return { key: "", canonicalName: schemeName.trim(), planOption: "",
             reason: "unclaimed-amount scheme — not a plan variant of the parent fund" };

  const toks = tokenize(schemeName);
  let n = toks.length;                 // how many leading tokens survive
  const stripped: string[] = [];

  for (let guard = 0; guard < 40 && n > 0; guard++) {
    const last = toks[n - 1].w;
    if (CONNECTORS.has(last)) { n--; continue; }        // glue is never the end of a fund's name
    if (IDENTITY_TAIL.has(last)) break;                 // an identity word — stop, never strip past it

    let hit = "";
    for (const p of TAIL_PHRASES) {                     // longest-first, by authoring order
      const pw = p.split(" ");
      if (pw.length > n) continue;
      let ok = true;
      for (let i = 0; i < pw.length; i++) if (toks[n - pw.length + i].w !== pw[i]) { ok = false; break; }
      if (ok) { hit = p; break; }
    }
    if (!hit) break;                                    // ── STOP-AT-FIRST-UNKNOWN ──
    n -= hit.split(" ").length;
    stripped.unshift(hit);
  }

  const words = toks.slice(0, n).map((t) => t.w);
  const key = words.join(" ");
  const planOption = stripped.join(" + ");

  // THE CONFIDENCE FLOOR — if the strip ate the name down to nothing, we do not have a fund, we
  // have a fragment. Refuse rather than group a hundred schemes under "fund".
  if (words.filter((w) => w.length > 1).length < 2)
    return { key, canonicalName: schemeName.trim(), planOption, reason: "name reduced to <2 words after stripping plan/option tokens" };
  if (key.length < 6)
    return { key, canonicalName: schemeName.trim(), planOption, reason: "name reduced to <6 chars after stripping plan/option tokens" };

  // The head of the ORIGINAL string, casing intact, trimmed of the separator the tail hung off.
  const canonicalName = schemeName.slice(0, toks[n - 1].end).replace(/[\s\-–—,:;(/&|]+$/, "").trim();
  return { key, canonicalName, planOption };
}

/** The display name for a family, chosen from its members' heads. AMFI spells the same fund
 *  several ways ("SBI Large Cap FUND" / "SBI Large Cap Fund"), so: most common wins; ties go to
 *  the least SHOUTED spelling; then alphabetical, so a re-derive is deterministic. */
export function canonicalFor(heads: readonly string[]): string {
  const count = new Map<string, number>();
  for (const h of heads) count.set(h, (count.get(h) ?? 0) + 1);
  const lower = (s: string) => (s.match(/[a-z]/g)?.length ?? 0) / Math.max(s.length, 1);
  return [...count.entries()].sort(
    (a, b) => b[1] - a[1] || lower(b[0]) - lower(a[0]) || a[0].localeCompare(b[0]),
  )[0][0];
}
