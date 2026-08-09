// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE SINGLE RENDERING OF EVERY FIGURE.
//
// ★ THIS FILE IS THE ONE PLACE A NUMBER BECOMES A STRING for Quarter in Brief. Nothing in the feature
//   formats money, a percentage or a ratio anywhere else. One figure, one rendering.
//
// ── WHY THIS IS NOT `relational/copy.ts`'s formatINR ────────────────────────────────────────────────
// The backend already has a formatINR. It takes RUPEES and renders lakh/crore for portfolio-scale
// amounts (₹2.4 lakh · ₹18,000) — a different input unit and a different call site. Pointed at a
// ₹ crore figure it renders 15547.66 as "₹15547.7 crore": ungrouped, one decimal. The Results card
// six pixels away renders the same figure "₹15,548 Cr". A reader who cannot read a statement has no
// way to tell which of those is the real number, so the card wins and this module matches it.
//
// ── ⚠ THE CROSS-REPO OBLIGATION ─────────────────────────────────────────────────────────────────────
// The card's rule lives in the FRONTEND (Vytal-Frontend/components/stock-detail/overview/shared.tsx,
// `fmtMarketCap`). Two repos cannot share a function without a shared package, and adding one is a new
// dependency. So this is one RULE with two implementations, and the second is held to the first by
// src/scripts/cross-repo/verify-quarter-brief-money.ts, which fails if the frontend rule moves.
// That gate is the only thing standing between "one rendering" and "a third rendering" — if you change
// the function below, change it there too, and let the gate prove it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** THE money rendering. Mirrors the frontend's `fmtMarketCap` exactly in magnitude and grouping —
 *  Indian digit groups, whole crore, lakh-crore above 1,00,000 Cr — and differs ONLY in spelling
 *  "crore" out, because "Cr" reads in a stat tile and not in a sentence.
 *
 *  Input is ₹ CRORE (the unit every quarterly/annual table stores). Sign is carried by the caller's
 *  phrasing, never by the glyph: "a loss of ₹12 crore" reads; "₹-12 crore" does not. */
export function money(cr: number): string {
  const v = Math.abs(cr);
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} lakh crore`;
  // Below a crore, whole-crore rounding would print "₹0 crore" for a real figure.
  if (v > 0 && v < 1) return `₹${Math.round(v * 100)} lakh`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} crore`;
}

/** THE frontend rule this module mirrors, as data — read by the cross-repo gate so the two cannot
 *  drift silently. Kept beside the function it describes, not in the gate, so an edit here is
 *  impossible to make without seeing it. */
export const MONEY_RULE = {
  lakhCroreThresholdCr: 100_000,
  locale: "en-IN",
  maximumFractionDigits: 0,
} as const;

/**
 * ★★ A NEGATIVE P&L AMOUNT — AS A NOUN PHRASE, NOT AS A PREDICATE. 3d-E, and the structural half of it.
 *
 * ⚠ THE DEFECT, FOUND BY RENDERING TTML, AND IT SURVIVED THE FIRST FIX. The quarter's money lines used
 * to render a negative as `a loss of ₹72 crore`, which is a PREDICATE: it needs a verb in front of it.
 * The card carried "a net profit of a loss of ₹72 crore" because the model put a noun there instead —
 * the ordinary way any writer joins a line name to its value. Rewriting the fact block to hand over
 * finished sentences did not stop it, because the model recombines facts into its own sentences and
 * the phrase has to survive whatever frame it lands in.
 *
 * A NOUN PHRASE survives every frame:
 *   "Net profit stood at a ₹72 crore loss."          ✅
 *   "…reported a net profit of a ₹72 crore loss."    ✅ — clumsy, but English, and not a doubled noun
 *   "Net profit: a ₹72 crore loss"                   ✅
 * Nothing about the figure, the unit or the rounding changes; only the shape of the words around it,
 * which is the only part that was ever wrong.
 *
 * ⚠ IT DOES NOT APPLY TO THE ANNUAL SECTION. There a negative amount means one of three different
 * things (a level, a flow, a reserve move) and `moneyIn` says which; a fourth vocabulary here would be
 * the eighteenth degenerate case again. This is the QUARTER's P&L wording, where a negative genuinely
 * is a loss, and it has exactly the three callers named in the note above.
 */
export const moneyLoss = (cr: number): string => `a ${money(cr)} loss`;

/** A margin or ratio ALREADY IN PERCENT, to one decimal — the precision these are stored at. */
export const marginPct = (p: number): string => `${p.toFixed(1)}%`;

/** A MULTIPLE — solvency, and nothing else so far.
 *
 *  ⚠ THE GLYPH IS THE WHOLE POINT. An insurer's solvency of 2.12 means it holds 2.12 TIMES the capital
 *  the regulator demands. Rendered as "2.12%" it reads as a company holding one fiftieth of what it
 *  must — the combined-ratio failure again, in a different unit and in the same flattering-to-alarming
 *  direction. Both insurance families store solvency this way (life 1.75–2.42, general 1.79–4.21) and
 *  nothing else in the manifest is a multiple, so this function has exactly one job. */
export const times = (x: number): string => `${x.toFixed(2)}x`;

/** A movement in PERCENTAGE POINTS, for ratios. Deliberately NOT a percentage: a net margin going
 *  from 10% to 12% rose two POINTS, not twenty percent, and saying the latter is a different claim. */
export const pointMove = (pp: number): string => `${Math.abs(pp).toFixed(1)} percentage points`;

// ── THE TWO ANNUAL-ONLY UNITS ──────────────────────────────────────────────────────────────────────
// Both exist because the annual tables carry figures that are neither ₹ crore nor a ratio, and passing
// either through `money` is a two-orders-of-magnitude error in the same family as the combined ratio.

/** RUPEES PER SHARE — earnings per share, and nothing else.
 *
 *  ⚠ THE UNIT IS THE WHOLE POINT. Every other rupee figure in this feature is ₹ CRORE; this one is
 *  rupees. Rendered through `money`, MRF's ₹5,720.29 a share becomes "₹5,720 crore" — a per-share
 *  figure presented as a company-scale total. Two decimals because that is how a company files it and
 *  how a reader would check it against the statement. */
export const perShare = (rupees: number): string =>
  `₹${Math.abs(rupees).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a share`;

/** A COUNT OF DAYS. Whole days: the underlying figure is an average over a year and its second decimal
 *  is not information a reader can act on. */
export const dayCount = (d: number): string => {
  const v = Math.round(Math.abs(d));
  return `${v.toLocaleString("en-IN")} ${v === 1 ? "day" : "days"}`;
};

// ── ★ WHAT A NEGATIVE RUPEE FIGURE IS CALLED, AND WHY THERE ARE THREE ANSWERS ──────────────────────
//
// ⚠⚠ FOUND BY RENDERING — THE EIGHTEENTH DEGENERATE CASE, ON THE FIRST ANNUAL CARD BUILT. The quarter's
// renderer says `a loss of ₹X crore` for any negative money line, which is correct for every line it
// has: those are all P&L lines, and a negative one IS a loss. The annual section is not a P&L, and on
// its lines that phrasing is wrong three different ways at once:
//
//   NMDC  "Cash spent on investments and equipment: a loss of ₹3,839 crore" — printed directly above
//         that metric's own gloss, which reads "Money going out here is NOT a loss." The card
//         contradicted itself in two consecutive lines.
//   BAJFINANCE "Cash generated by the business: a loss of ₹65,790 crore" — a lender's operating cash
//         flow is negative because it LENT the money out. Calling that a loss inverts the fact.
//   IDEA  "Shareholders' money in the business: a loss of ₹35,758 crore" — negative equity is not a
//         loss, it is a shortfall, and it is the single most important number on that card.
//
// So the sense of a money line is declared per metric and the vocabulary follows it. There are exactly
// three because there are exactly three things a negative rupee figure means on these tables.

/** How to read a negative amount on this line. Declared per metric in the annual manifest. */
export type MoneySense = "level" | "flow" | "reserveMove";

/** The full phrase for one amount, in its own sense's vocabulary. Zero is `nil` everywhere — a line
 *  reported as nothing is nothing, which is change.ts's `nil` ruling applied to a single figure. */
export function moneyIn(sense: MoneySense, cr: number): string {
  if (cr === 0) return "nil";
  const amount = money(cr);
  if (sense === "flow") return cr > 0 ? `${amount} came in` : `${amount} went out`;
  if (sense === "reserveMove") return cr > 0 ? `${amount} added` : `${amount} released`;
  return cr > 0 ? amount : `negative ${amount}`;
}

/**
 * The two-period comparison for a money line, in its sense's vocabulary.
 *
 * ⚠ THE SHAPE CHANGES WITH THE SIGNS, AND THAT IS NOT DECORATION. The first attempt appended a short
 * directional form to a fixed "…in the year before" and rendered "₹9,291 crore in in the year before".
 * Three forms, each earning its place:
 *
 *   level, any signs   both sides keep the full wording, because dropping "negative" from the second
 *                      half of "negative ₹35,758 crore, against ₹70,320 crore" reverses it.
 *   flow, same way     the direction is established by the first half, so the second is a bare amount.
 *   flow, opposite     the direction REVERSED, which is the whole point of the sentence, so both halves
 *                      say it — and the period leads the second clause so the two never collide.
 */
export function moneyAgainst(sense: MoneySense, current: number, prior: number, priorPeriod: string): string {
  const here = moneyIn(sense, current);
  if (sense === "level") return `${here}, against ${moneyIn(sense, prior)} ${priorPeriod}`;
  const sameWay = current === 0 || prior === 0 || current > 0 === prior > 0;
  return sameWay
    ? `${here}, against ${prior === 0 ? "nil" : money(prior)} ${priorPeriod}`
    : `${here}; ${priorPeriod}, ${moneyIn(sense, prior)}`;
}

/** INTEREST COVER IN PLAIN WORDS. "−4.20x" is not a sentence any reader can use, and the negative case
 *  is the one that matters most: it means the year's trading profit did not cover the interest bill at
 *  all. Same treatment, and the same reason, as `combinedRatioPlain` — a bare multiple that means
 *  nothing on its own gets a sentence beside it. */
export function interestCoveragePlain(x: number): string {
  if (x < 0) return "The year's trading profit did not cover the interest bill at all — the company made a trading loss.";
  if (x < 1) return "The year's trading profit did not cover the interest bill in full.";
  return `The year's trading profit would have covered the interest bill ${x.toFixed(2)} times over.`;
}

// ── ⚠ UNIT SEAM ─────────────────────────────────────────────────────────────────────────────────────
// On the general-insurance quarterly table, `net_margin` is ALREADY PERCENT (-2.2853 → −2.29%) while
// `combined_ratio` is a FRACTION (1.2144 → 121.44%). Same table, same row, two conventions — the same
// seam fundamentals-view.service.ts documents for banking. Passing a combined ratio through marginPct
// renders 1.2144 as "1.2%", which is not a rounding error but a different number by two orders of
// magnitude, in the direction that makes a loss-making insurer look immaculate. Always convert first.
export const fractionToPct = (fraction: number): number => fraction * 100;

/** A combined ratio in PLAIN WORDS. "Combined ratio 121.4%" means nothing to a reader who has never
 *  seen one; what it means is that the insurer paid out more than it took in. Above 100 the
 *  underwriting book lost money — state that arithmetically, without calling it good or bad. */
export function combinedRatioPlain(pctValue: number): string {
  const perHundred = (pctValue).toFixed(2);
  if (pctValue > 100) {
    const short = (pctValue - 100).toFixed(2);
    return `For every ₹100 of premium, ₹${perHundred} went out in claims and costs — ₹${short} more than came in.`;
  }
  const left = (100 - pctValue).toFixed(2);
  return `For every ₹100 of premium, ₹${perHundred} went out in claims and costs, leaving ₹${left}.`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ A DATE, IN PROSE. "2025-06-30" → "30 June 2025".
//
// ── THE DEFECT THIS FIXES, AND WHERE IT ENTERED ────────────────────────────────────────────────────
// MMTC's card carried "MMTC reported revenue of ₹1 crore in the quarter ended 2025-06-30." An ISO
// date inside a sentence, in a product whose whole register is plain English for a reader who has
// never read a financial statement.
//
// ⚠ THE MODEL DID NOTHING WRONG, AND THAT IS WHY THE FIX IS HERE AND NOT IN THE PROMPT. The fact text
// handed it `PERIOD: Q1 of FY26, the three months ended 2025-06-30`, and the prompt orders every
// figure reproduced EXACTLY as written. It copied what it was given, obediently. A prompt rule saying
// "format dates nicely" would be asking the model to REWRITE a string it is elsewhere forbidden to
// touch — the exact shape of instruction that produced the echo_mismatch run recorded in prompt.ts.
// So the fact text is changed to hand over the form we want read back.
//
// ⚠ ISO SURVIVES WHERE IT IS CHROME, NOT PROSE. The card's own `as scored on 2026-08-07` and
// `as of 2025-03-31` are metadata in a mono column, where an unambiguous sortable date is right and
// a reader is not reading them as a sentence. This function is for dates that enter SENTENCES.
//
// ⚠ AND IT IS GUARD-SAFE, WHICH IS NOT AUTOMATIC. The verbatim-figure scan requires every figure in
// the answer to appear character-for-character in the fact text. "30 June 2025" puts "30" and "2025"
// in the fact text — 2025 is skipped as year-ish, and 30 matches verbatim because the fact text now
// carries this exact string. The month is a WORD and is not a figure at all, which removes a token
// from the scan rather than adding one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "2025-06-30" → "30 June 2025". Returns the input unchanged if it is not an ISO date — a date this
 * cannot parse is printed as it arrived, which is the status quo, never a throw and never an
 * invented date.
 */
export function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
