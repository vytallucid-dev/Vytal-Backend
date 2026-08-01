// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNGROUNDED-NUMBER DETECTOR (log-only) — the structural backstop behind CLOSED_WORLD_HEADER.
//
// grounding.ts INSTRUCTS: "every number you state must appear verbatim below … do not compute, estimate,
// convert, infer, or introduce any number not present here." This CATCHES it when the model does anyway.
// Same relationship guardrail.ts has to the non-advisory spine: an instruction is a request, this is a
// measurement.
//
// ★★★ IT LOGS. IT NEVER BLOCKS. ★★★
// Deliberate, and it is the SOFT-tier doctrine already in guardrail.ts ("logged so the corpus can inform
// promotions … rather than the vocabulary growing on hunches"). Measured false-positive rate is 0/188 on
// the live corpus — but that corpus is 80 turns from one reader, whose 95% upper bound is ~1.9%. Blocking
// on a signal that thin would replace true answers with nothing. The log is the evidence for deciding
// later whether it should ever gate; nothing here decides that now.
//
// ── ⚠⚠ THE BLIND SPOT. READ THIS BEFORE TRUSTING A CLEAN LOG. ⚠⚠ ───────────────────────────────────
// ★ INTEGERS ≤ 12 AND YEARS (1990–2100) ARE NOT CHECKED AT ALL.
// They are excluded to kill date and small-count noise, and the cost is precisely this: AN INVENTED
// COUNT IS INVISIBLE TO THIS FILE. If the model says "4 block deals" when the tool result listed 2, or
// "three findings fired" when one did, this scan returns clean. Counts are exactly what a model gets
// wrong when it summarises a list, so the most likely numeric error in a chat answer is the one error
// this cannot see. A CLEAN LOG IS NOT PROOF THE ANSWER'S NUMBERS ARE RIGHT. It is proof only that no
// LARGE unexplained figure appeared.
// Four further limits, stated because a detector nobody can calibrate is worse than none:
//   · The 2% relative tolerance means it catches FABRICATION, not DRIFT: "83%" against a stored 82 passes.
//   · The unit-conversion factor list is finite (×100, ×1e5, ×1e7, ×1000 and inverses). A conversion
//     outside it reads as ungrounded.
//   · It cannot tell a legitimate derivation from an invention — correctly, since the closed-world header
//     forbids both. This is aligned with the stated rule, not stricter than it.
//   · The haystack must include the SYSTEM PROMPT and the TOOL DECLARATIONS, not just tool results.
//     ⚠ THIS IS NOT OPTIONAL AND IT WAS MEASURED: with tool results alone the scan fired 5 times on the
//     live corpus and 4 were product vocabulary the model was handed ("0 to 100 health score",
//     "52-week range", "a score of 80 means roughly the same thing across industries"). Precision went
//     from 20% to 100% purely by widening the haystack. A caller that passes only tool results has
//     rebuilt the blind version.
//
// PURE + DETERMINISTIC + FREE. No AI call, no DB, no network — so it can run on every delivered reply.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface UngroundedNumber {
  /** The figure as the reply wrote it ("267,021"). */
  raw: string;
  /** ± a window around it, for the log. */
  context: string;
}

export interface NumberGroundingVerdict {
  /** true ⇔ every checked figure was found in the haystack at some tolerance. */
  clean: boolean;
  /** How many figures were actually checked (after the year/small-integer exclusions). */
  checked: number;
  /** How many were skipped by those exclusions — the size of the blind spot on THIS reply. */
  skipped: number;
  hits: UngroundedNumber[];
}

/** Numbers asserted in a body of text. Rejects figures glued to word characters ("FY26Q1", "7(2)"). */
function numbersIn(text: string): { raw: string; v: number; start: number; end: number }[] {
  const out: { raw: string; v: number; start: number; end: number }[] = [];
  const re = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push({ raw: m[1], v, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ═══ ★★★ INDIAN NUMBERING IS ONE FIGURE, NOT TWO — AND A LIVE RUN PROVED IT. ★★★ ═══════════════════
//
// ⚠ THE FALSE POSITIVE THIS EXISTS TO KILL, caught on the first real conversation this detector ever
// saw. Asked for Reliance's annual report, the model wrote:
//
//     "About 95 thousand 750 crore rupees"        (the tool said 95754)
//     "roughly 1 lakh 92 thousand crore rupees"   (the tool said 192113)
//
// Both are CORRECT, and both are the model OBEYING CONVERSATIONAL_PRECISION — "state numbers the way a
// person would say them aloud", which in India means lakh/thousand composites. The scanner tokenised
// "95" and "92" as standalone figures, found no bare 95 or 92 in the haystack, and reported an invented
// number. That is the precise failure mode the brief forbade: a check that fires on legitimate output
// trains everyone to ignore its log.
//
// So composites are reconstructed BEFORE anything is checked, and the fragments that built them are
// consumed. Measured on that run: 10 lakh 75 thousand → 1,075,000 vs 1,075,675 (0.06% out); 95 thousand
// 750 → 95,750 vs 95,754 (0.004%); 1 lakh 23 thousand → 123,000 vs 122,916 (0.07%) — every one lands
// inside the existing tolerance once it is read as a single number.
//
// ⚠ `crore` is deliberately NOT a multiplier here. The tool results are already denominated in ₹ crore,
// so "95 thousand 750 crore" against a stored 95754 needs no scaling — it is the trailing UNIT, not a
// magnitude in the composite. Multiplying by 1e7 here would break every match it is meant to fix.
const MAGNITUDE: Record<string, number> = { thousand: 1e3, lakh: 1e5 };
const COMPOSITE_RE = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakh)((?:\s+\d[\d,]*(?:\.\d+)?\s*(?:thousand|lakh)?)*)/gi;

/** Spoken Indian-numbering composites, as single figures, with the span they consume. */
function compositesIn(text: string): { raw: string; v: number; start: number; end: number }[] {
  const out: { raw: string; v: number; start: number; end: number }[] = [];
  for (const m of text.matchAll(COMPOSITE_RE)) {
    const head = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(head)) continue;
    let total = head * MAGNITUDE[m[2].toLowerCase()];
    // The tail is the remaining "<n> <magnitude?>" groups — a bare trailing number is the units place
    // ("95 thousand 750"), a magnitude-carrying one is another term ("10 lakh 75 thousand").
    for (const t of (m[3] ?? "").matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakh)?/gi)) {
      const n = Number(String(t[1]).replace(/,/g, ""));
      if (!Number.isFinite(n)) continue;
      total += t[2] ? n * MAGNITUDE[t[2].toLowerCase()] : n;
    }
    out.push({ raw: m[0].trim(), v: total, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** A plausible calendar year — excluded (dates are not claims about a company's figures). */
const isYearish = (v: number): boolean => Number.isInteger(v) && v >= 1990 && v <= 2100;
/** A small integer — excluded. ⚠ This is the blind spot documented in the header. */
const isSmallCount = (v: number): boolean => Number.isInteger(v) && v <= 12;

/** Unit shifts a faithful answer legitimately performs (₹ Cr → ₹, fraction → %, and their inverses). */
const UNIT_FACTORS = [100, 1 / 100, 1000, 1 / 1000, 1e5, 1 / 1e5, 1e7, 1 / 1e7];

/** Absolute rounding slack. Covers every spoken rounding of a small figure: "about 80" ← 80.02,
 *  "roughly 5%" ← 4.62, "~49%" ← 48.97. */
const ABS_SLACK = 0.51;
/**
 * ★ THE RELATIVE RULE APPLIES ONLY ABOVE THIS MAGNITUDE, AND A NEGATIVE CONTROL FORCED THAT BOUND.
 *
 * A flat 2% tolerance reads as harmless until you apply it to a two-digit number: 2% of 73 is ±1.46, so
 * the band cut **74** — which ships in the system prompt on every single message — silently "grounded" a
 * fabricated 73. Measured, in verify-number-grounding.ts §4, which failed on exactly that case.
 *
 * The rule the failure taught: RELATIVE TOLERANCE IS FOR LARGE FIGURES, ABSOLUTE FOR SMALL ONES. 2% of
 * 49,454 is ±989, which is genuinely what "roughly 49,000 crore" needs; 2% of 73 is a licence to invent
 * any neighbouring integer. Below 100, `ABS_SLACK` alone decides — so 74 can round to 73.6 but can never
 * account for 73.
 * ⚠ Do not "simplify" this back to a single relative test. It is the difference between catching a
 * fabricated score and blessing it.
 */
const RELATIVE_FLOOR = 100;

const withinTolerance = (h: number, v: number): boolean =>
  Math.abs(h - v) < ABS_SLACK || (Math.abs(v) >= RELATIVE_FLOOR && v !== 0 && Math.abs((h - v) / v) < 0.02);

function isGrounded(v: number, _raw: string, haystackNums: readonly number[]): boolean {
  // ★ MATCHING IS TOKENISED, NEVER SUBSTRING — and a negative control forced this too.
  //
  // ⚠ The first cut asked `haystack.includes(raw)`. On an 83,000-character haystack that is not a test,
  // it is a rubber stamp: EVERY two-digit number appears inside some longer one ("73" sits inside
  // "1739775"), so the fabricated 73 was declared grounded by a market cap it had nothing to do with.
  // Both sides are therefore parsed into NUMBERS first and compared as values. Comma formatting still
  // matches for free, because "₹267,021.00" and "267,021" tokenise to the same 267021.
  //
  // L1/L2 — exact value, then spoken rounding. CONVERSATIONAL_PRECISION explicitly ORDERS the rounding
  // ("about 80", not "80.09"), so a tolerance here is not leniency; without it the detector would fire
  // on obedience to the instruction above it.
  for (const h of haystackNums) {
    if (h === v || withinTolerance(h, v)) return true;
  }
  // L3 — a unit conversion of a given figure ("₹2.67 lakh crore" from 267021).
  for (const h of haystackNums) {
    for (const f of UNIT_FACTORS) {
      if (withinTolerance(h * f, v)) return true;
    }
  }
  return false;
}

/** A readable window around a hit, for the log line. */
function contextOf(text: string, raw: string): string {
  const i = text.indexOf(raw);
  if (i < 0) return text.slice(0, 120);
  const from = Math.max(0, i - 60);
  const to = Math.min(text.length, i + raw.length + 60);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

/**
 * Scan one delivered reply for figures that appear nowhere the model could have read them.
 *
 * ⚠ `haystack` MUST be everything the model was given: the system prompt, the tool declarations, every
 * user/opening message, and every tool result of this turn. See the header — a narrower haystack makes
 * this fire on the product's own vocabulary.
 *
 * Empty input is trivially clean. Never throws.
 */
export function scanUngroundedNumbers(text: string, haystack: string): NumberGroundingVerdict {
  if (!text || !text.trim()) return { clean: true, checked: 0, skipped: 0, hits: [] };
  const haystackNums = numbersIn(haystack).map((n) => n.v);
  const hits: UngroundedNumber[] = [];
  let checked = 0;
  let skipped = 0;

  // ★ COMPOSITES FIRST, and the fragments they consume are then skipped — "95 thousand 750" is ONE
  //   assertion of 95,750, never a claim about 95 and a claim about 750. See compositesIn.
  const composites = compositesIn(text);
  for (const { raw, v } of composites) {
    checked++;
    if (!isGrounded(v, raw, haystackNums)) hits.push({ raw, context: contextOf(text, raw) });
  }
  const consumed = (start: number, end: number): boolean =>
    composites.some((c) => start >= c.start && end <= c.end);

  for (const { raw, v, start, end } of numbersIn(text)) {
    if (consumed(start, end)) continue; // already counted inside a composite
    if (isYearish(v) || isSmallCount(v)) { skipped++; continue; }
    checked++;
    if (!isGrounded(v, raw, haystackNums)) hits.push({ raw, context: contextOf(text, raw) });
  }
  return { clean: hits.length === 0, checked, skipped, hits };
}

/**
 * Build the haystack from a turn's own materials. One helper so no caller has to remember the rule that
 * the system prompt and tool declarations belong in it.
 */
export function buildNumberHaystack(input: {
  system: string;
  toolSpecsJson?: string;
  messages: readonly { content: string; toolResult?: { response?: { output?: string; error?: string } } }[];
}): string {
  const parts: string[] = [input.system];
  if (input.toolSpecsJson) parts.push(input.toolSpecsJson);
  for (const m of input.messages) {
    if (m.toolResult) parts.push(String(m.toolResult.response?.output ?? m.toolResult.response?.error ?? ""));
    else if (m.content) parts.push(m.content);
  }
  return parts.join("\n");
}
