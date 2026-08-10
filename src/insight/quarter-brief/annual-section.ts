// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANNUAL SECTION — Q4 only. Debt, equity, assets, cash flow, per-share figures, and a lender's
// margin and credit cost: everything a quarterly P&L structurally cannot say.
//
// ── ★ THREE GATES, AND ALL THREE ARE PRESENCE, NOT ASSUMPTION (4h) ──────────────────────────────
//   1 · QUARTER GATE   — `quarter === "Q4"`. Nothing else, ever. See annual-manifest.ts's header for
//                        why this is the one quarter where the original annual ban does not apply.
//   2 · PRESENCE GATE  — an annual row for THIS fiscal year on THIS basis, or no section at all.
//                        Absent annual means absent section, never an assumed one.
//   3 · BASIS GATE     — inherited from the quarter, never re-resolved. annual-rows.ts's header says
//                        why substituting the other basis would change what the card describes.
//   4 · ★ BALANCE-SHEET GATE — at least one line the reader can point at and say the company OWNS or
//                        OWES it. See below; this one was found by rendering, not by reasoning.
//
// ── ⚠⚠ THE FOURTH GATE, AND WHY A PRESENT ROW IS NOT ENOUGH ─────────────────────────────────────
// LICHSGFIN's FY22 annual row EXISTS and passes gates 1 to 3. It carries 4 of this family's 14 metrics:
// three cash-flow lines and an earnings-per-share figure. Nothing it owns, nothing it owes. The card
// rendered a section headed "the full year" that contained no balance sheet, above a gaps list naming
// ten missing figures in one three-line sentence — which is a worse outcome than the section being
// absent, because absence is honest and a stub invites the reader to believe they have seen the
// balance sheet.
//
// MEASURED across every annual row paired to a Q4 on the preferred basis: 193 of 1,404 — 13.7% — carry
// NO balance-sheet metric at all. Non-financial 171/1,225, NBFC 19/109, banking 3/55, both insurance
// families 0. Overwhelmingly FY22 and earlier, where the legacy parser stored the P&L and cash flow
// and not the balance sheet. That is one card in seven, not one bad row.
//
// So the gate is not a completeness threshold with a number in it — it is the section's own stated
// purpose made executable. This section exists to be the only route to a balance-sheet fact. A row
// with no balance-sheet fact in it is not a thin version of that; it is a different thing under the
// same heading, and it renders as absent with the reason said out loud.
//
// ── ⚠ THE SECOND CLOCK (4d) ─────────────────────────────────────────────────────────────────────
// The annual row carries its OWN as-of date, and it is not always the quarter's. NESTLEIND's FY26
// annual is dated 31 December 2025 against a Q4 dated 31 March 2026; SIEMENS filed four consecutive
// September year-ends against March quarters. It matches on 99.8% of paired rows — which is exactly
// what makes the 0.2% dangerous, because a reader who has learned that the dates agree will not check.
//
// So `datesAgree` is COMPUTED, and the caller renders the annual date whenever it is false. This is the
// portfolio-chart confusion in a new place: two clocks on one card with only one of them labelled.
//
// ⚠ A DECEMBER YEAR-END IS NOT BY ITSELF THE CASE. ABB and VBL both close in December AND file
// December-dated Q4 rows, so their two clocks agree and no second date is shown. The trigger is the
// MISMATCH, not the month — which is why this is a comparison and not a calendar rule.
//
// ── WHAT THIS MODULE DOES NOT DECIDE ────────────────────────────────────────────────────────────
// No verdict, no driver, no takeaway. There is no annual bridge and no annual attribution — see
// annual-manifest.ts's point 3. It answers one question, "what did the full year's balance sheet and
// cash flow say", and stops.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { annualMetricGloss, type AnnualMetricKey } from "../../catalogue/annual-metrics.js";
import { changeFact } from "./change.js";
import {
  dayCount,
  interestCoveragePlain,
  marginPct,
  money,
  moneyAgainst,
  moneyIn,
  perShare,
  pointMove,
  times,
} from "./format.js";
import {
  annualManifestFor,
  annualValueOf,
  toAnnualDisplayValue,
  withinAnnualBounds,
  ANNUAL_REF,
  type AnnualMetricSpec,
  type AnyFamilyAnnual,
} from "./annual-manifest.js";

/** ONE annual metric, as the reader meets it. Mirrors MetricLine — deliberately a separate type, so a
 *  renderer cannot mix an annual line into the quarter's list and lose the second clock. */
export interface AnnualLine {
  key: AnnualMetricKey;
  label: string;
  meaning: string;
  doesntMean: string;
  /** The canonical rendering. The ONLY string the model may reproduce for this figure. */
  display: string;
  /** The DISPLAY-unit number behind it (fractions already multiplied). Feeds the grounding allowlist. */
  value: number;
  /** How it moved against the previous full year, or the statement that it held. Null when there is
   *  no prior year on file, or when the prior year's own figure was itself withheld. */
  movement: string | null;
  /** True ⇔ inside this metric's steady band. Null when there is nothing to compare. */
  steady: boolean | null;
  /** The same figure said in words, where the bare number means nothing on its own. */
  plain?: string;
  /** A fall is the favourable direction — carried so a renderer cannot supply its own reading. */
  lowerIsBetter: boolean;
}

/** An annual metric withheld, with the reader's words for why. `cause` separates the two mechanisms:
 *  a `bounds` suppression is about THIS figure, a `guard` suppression is about another figure on the
 *  same row making this one meaningless. Both are surfaced into gaps; the distinction is kept because
 *  a future reader debugging a missing return-on-equity needs to know which one fired. */
export interface SuppressedAnnualMetric {
  key: AnnualMetricKey;
  label: string;
  reason: string;
  cause: "bounds" | "guard";
}

export interface AnnualSection {
  fiscalYear: string;
  /** ★ THE SECTION'S OWN AS-OF DATE, always carried. YYYY-MM-DD. */
  asOfDate: string;
  /** The date the annual filing was published. Distinct from the quarter's filing date. */
  filingDate: string;
  /** ⚠ FALSE ⇒ THE CARD MUST RENDER `asOfDate`. See the header. */
  datesAgree: boolean;
  /** The previous full year, when one is on file. Null ⇒ every `movement` below is null. */
  priorFiscalYear: string | null;
  lines: AnnualLine[];
  suppressed: SuppressedAnnualMetric[];
  /** Metrics the family declares but did not file this year. Distinct from suppressed: absent is
   *  "the company did not report it", suppressed is "it reported something that cannot be read". */
  notReported: AnnualMetricKey[];
  /** ★ SHOWN WITHOUT A COMPARISON, WITH THE READER'S WORDS FOR WHY. A THIRD state, distinct from both
   *  of the above: the figure IS shown and IS checkable, and only the year-on-year movement was
   *  withheld. Surfaced into gaps — a card that quietly compares some lines and not others, with no
   *  explanation, teaches the reader that the silence means "it did not move". */
  notCompared: { label: string; reason: string }[];
}

/** THE canonical rendering for one annual value, by scale. One figure, one string.
 *
 *  ⚠ MONEY GOES THROUGH `moneyIn`, NOT THROUGH THE QUARTER'S "a loss of" FORM. That form is correct on
 *  a P&L line and wrong on two thirds of these — see format.ts's MoneySense header for the three cards
 *  that proved it. `moneySense` is required on every money spec, so the fallback below is unreachable
 *  and exists only to keep this function total. */
function renderAnnualValue(spec: AnnualMetricSpec, displayValue: number): string {
  switch (spec.scale) {
    case "money":
      return moneyIn(spec.moneySense ?? "level", displayValue);
    case "multiple":
      return times(displayValue);
    case "perShare":
      return displayValue < 0 ? `a loss of ${perShare(displayValue)}` : perShare(displayValue);
    case "days":
      return dayCount(displayValue);
    // `fraction` has already been multiplied into percent by toAnnualDisplayValue.
    case "percent":
    case "fraction":
      return marginPct(displayValue);
  }
}

/** ★ NEVER CLAIM A MOVE YOU CANNOT SHOW — inherited verbatim from quarter-section.ts, where it was the
 *  fourteenth degenerate case: a 0.04pp move that cleared its 0.03pp band and printed "up 0.0
 *  percentage points". The floor is the DISPLAY's precision, not the metric's, and it is applied AFTER
 *  the band: the band answers "is this material", this answers "can we render it".
 *
 *  `days` renders to a whole number, so its floor is half a day — the coarsest in either manifest and
 *  the one most likely to fire. */
function displayFloor(spec: AnnualMetricSpec): number {
  switch (spec.scale) {
    case "multiple":
      return 0.005;
    case "days":
      return 0.5;
    case "perShare":
      return 0.005;
    default:
      return 0.05;
  }
}

/** The size of a non-money move, in that metric's own unit. Percentage points are a category error on
 *  a multiple, on a per-share amount and on a day count alike. */
function moveSize(spec: AnnualMetricSpec, delta: number): string {
  switch (spec.scale) {
    case "multiple":
      return times(Math.abs(delta));
    case "perShare":
      return perShare(Math.abs(delta));
    case "days":
      return dayCount(Math.abs(delta));
    default:
      return pointMove(delta);
  }
}

/** Movement for a non-money annual metric. Money lines go through `changeFact` instead, because only
 *  they have the zero/negative-base problem rule 3 exists for. */
function annualRatioMovement(spec: AnnualMetricSpec, current: number, prior: number): string {
  const priorDisplay = toAnnualDisplayValue(spec, prior);
  const delta = toAnnualDisplayValue(spec, current) - priorDisplay;
  const band = spec.steadyBand ?? 0;
  if (Math.abs(delta) < band || Math.abs(delta) < displayFloor(spec)) {
    return `steady at ${renderAnnualValue(spec, toAnnualDisplayValue(spec, current))} ${ANNUAL_REF}`;
  }
  // ⚠⚠ A MULTIPLE'S MOVE IS NAMED BY ITS ENDPOINT, NEVER BY ITS DIFFERENCE — FOUND ON THIS SAMPLE.
  // TCS printed "Times profit covers the interest bill: 54.37x — down 28.70x against the year
  // before", and IDEA "2.61x — up 2.72x". Both differences are correct and both READ as multipliers:
  // "up 2.72x" is ordinary English for "2.72 times higher", which is not what it says. The glyph that
  // makes a multiple legible as a level (format.ts's `times`) is precisely what makes it illegible as
  // a delta. Percentage points have no such problem, so only this scale changes form.
  if (spec.scale === "multiple") {
    // ⚠ AND A NEGATIVE MULTIPLE NEVER CARRIES ITS SIGN IN THE GLYPH. "up from -0.12x" is format.ts's
    // own rejected form ("₹-12 crore does not read") in a second unit — found on IDEA the moment the
    // endpoint started being named. Below zero, interest cover means the year's trading profit did not
    // cover the interest bill at all, which is a STATE and not a quantity; the words say so and the
    // `plain` line under the figure says the rest.
    if (priorDisplay < 0) return `up from below zero ${ANNUAL_REF}`;
    return `${delta > 0 ? "up" : "down"} from ${times(priorDisplay)} ${ANNUAL_REF}`;
  }
  return `${delta > 0 ? "up" : "down"} ${moveSize(spec, delta)} ${ANNUAL_REF}`;
}

/** Drop a movement's opening repeat of the value printed beside it. Exact prefix only — a movement
 *  that does NOT open with the value is returned untouched, so a reworded `moneyAgainst` cannot be
 *  silently mangled here. Mirrors quarter-section.ts's function of the same name and same rule. */
function stripLeadingValue(movement: string | null, value: string): string | null {
  if (!movement || !movement.startsWith(value)) return movement;
  const rest = movement.slice(value.length);
  // ⚠ BOTH SEPARATORS. `moneyAgainst` uses ", against …" when the two periods point the same way and
  // "; the year before, …" when they REVERSED — and the reversal is the case the sentence exists for,
  // so a strip that only knew the comma would leave the stutter on exactly the interesting rows.
  const m = /^(?:, |; )/.exec(rest);
  return m ? rest.slice(m[0].length) : movement;
}

/**
 * A MONEY movement, in the vocabulary of that line's own sense.
 *
 * ── ★ WHY A FLOW NEVER GETS A PERCENTAGE ────────────────────────────────────────────────────────
 * `changeFact` is the one implementation of "did a rupee line move", and its whole vocabulary — a
 * loss, a turnaround, a move to loss — is P&L vocabulary. On a cash flow that is not merely the wrong
 * wording but the wrong QUESTION: "cash spent on investments up 28%" cannot be read, because more
 * money going out and less money coming in are the same arithmetic and opposite facts. So a flow is
 * always stated as two absolutes, in its own words, and the direction is carried by "in" and "out"
 * rather than by a sign the reader has to interpret.
 *
 * A `level` line with BOTH sides positive goes through `changeFact` unchanged — that is the ordinary
 * case and it earns the percentage. When either side is at or below zero it falls back to two
 * absolutes too, because "a loss of ₹35,758 crore, against a loss of ₹70,320 crore" is what
 * `changeFact` says about negative EQUITY, and equity is not a loss.
 */
function annualMoneyMovement(
  spec: AnnualMetricSpec,
  current: number,
  prior: number,
  label: string,
): string | null {
  const sense = spec.moneySense ?? "level";
  if (sense === "level" && current > 0 && prior > 0) {
    return changeFact(`${spec.key}.annualChange`, current, prior, ANNUAL_REF, label)?.display ?? null;
  }
  // change.ts's own ruling: a line that was nothing in both years is nothing, not a loss of nothing.
  if (current === 0 && prior === 0) return `nil, as in ${PRIOR_PERIOD}`;
  return moneyAgainst(sense, current, prior, PRIOR_PERIOD);
}

/** The plain-words companion, for the figures whose bare number means nothing on its own. Takes the
 *  whole row because two of the three are CROSS-FIELD: what a figure means can depend on the one
 *  beside it, which is the same insight the manifest's `guard` is built on. */
function plainFor(
  spec: AnnualMetricSpec,
  displayValue: number,
  row: AnyFamilyAnnual,
): string | undefined {
  if (spec.key === "interestCoverage") return interestCoveragePlain(displayValue);

  // ⚠ NEGATIVE EQUITY NEEDS A SENTENCE, NOT A MINUS SIGN. "negative ₹35,758 crore" is accurate and
  // means nothing to a reader who has never read a statement. This is the most serious fact any of
  // these cards can carry and it gets said in words.
  if (spec.key === "netWorth" && displayValue < 0) {
    return `The company owes ${money(displayValue)} more than everything it owns is worth in its books.`;
  }

  // ⚠ FOUND BY RENDERING — NMDC printed "Total borrowings ₹5,874 crore" and "Borrowings due within a
  // year ₹5,874 crore", two identical figures under two labels with nothing to explain why. The
  // repetition is not an error: every rupee NMDC owes falls due inside twelve months, which is a real
  // and useful fact the reader would otherwise have to notice for themselves and might read as a bug.
  if (spec.key === "debtDueWithinAYear") {
    const total = annualValueOf(row, "totalDebt");
    if (total !== null && total > 0 && Math.abs(total - displayValue) < 0.005) {
      return "All of the company's borrowing falls due within the year.";
    }
  }
  return undefined;
}

/** "the year before" — ANNUAL_REF as a NOUN. Derived, never a second literal: change.ts learned that
 *  the hard way when a phrase built from the preposition rendered "against … against the year before". */
const PRIOR_PERIOD = ANNUAL_REF.replace(/^against /, "");

type LineOutcome =
  | { line: AnnualLine }
  | { suppressed: SuppressedAnnualMetric }
  | { notReported: true };

function buildAnnualLine(
  spec: AnnualMetricSpec,
  current: AnyFamilyAnnual,
  prior: AnyFamilyAnnual | null,
): LineOutcome {
  const raw = annualValueOf(current, spec.key);
  if (raw === null) return { notReported: true };

  const label = annualMetricGloss(spec.key).label;

  // ── ★ THE CROSS-FIELD GUARD RUNS FIRST, AND THAT ORDER IS LOAD-BEARING ───────────────────────────
  // IDEA's FY26 return on equity is a perfectly plausible POSITIVE percentage, computed by dividing a
  // loss by a negative net worth. It is inside every bound a percentage could be given. If the bounds
  // check ran first it would pass, and the guard would then be suppressing a figure the card had
  // already accepted. The guard asks the question bounds cannot: does the number beside this one make
  // this one mean anything at all?
  if (spec.guard?.suppress((k) => annualValueOf(current, k))) {
    return { suppressed: { key: spec.key, label, reason: spec.guard.reason, cause: "guard" } };
  }

  // ⚠ THE MEANING CHECK, not an arithmetic one. Everything it rejects divided correctly.
  if (!withinAnnualBounds(spec, raw)) {
    return {
      suppressed: {
        key: spec.key,
        label,
        reason: spec.outOfRangeReason ?? "the reported figure is outside the range this measure can take",
        cause: "bounds",
      },
    };
  }

  const gloss = annualMetricGloss(spec.key);
  const displayValue = toAnnualDisplayValue(spec, raw);

  // The prior year is only usable when its own figure would also have been printed — same bounds AND
  // the same guard. Comparing against a value we refused to show produces a movement the reader cannot
  // check against anything, and for the guard it would reintroduce exactly the nonsense it removed:
  // a company whose equity turned negative would otherwise read "return on shareholders' money down
  // 40 percentage points", measured from a figure that never meant anything.
  const priorRaw = prior ? annualValueOf(prior, spec.key) : null;
  const priorGuarded = Boolean(prior && spec.guard?.suppress((k) => annualValueOf(prior, k)));
  // ★ `comparable: false` STOPS HERE, NOT AT THE SUPPRESSION. The per-share LEVEL is filed and the
  // reader can check it against the statement; only the comparison is unsafe. Withholding the whole
  // metric would delete a good figure to avoid a bad sentence.
  const priorUsable =
    spec.comparable !== false && priorRaw !== null && !priorGuarded && withinAnnualBounds(spec, priorRaw);

  let movement: string | null = null;
  let steady: boolean | null = null;

  if (priorUsable) {
    if (spec.scale === "money") {
      // ⚠⚠ THE VALUE IS PRINTED IN ITS OWN COLUMN, SO A MOVEMENT THAT OPENS WITH IT STUTTERS. The
      // quarter side learned this on TTML; the annual side has it on EVERY Q4 CARD IN THE UNIVERSE,
      // because every `flow` line states two absolutes by design:
      //
      //   "Cash generated by the business: ₹52,094 crore came in — ₹52,094 crore came in, against
      //    ₹48,908 crore the year before"
      //
      // Three cash-flow lines on every card, plus every `level` line whose sides are not both
      // positive. The two-absolutes form is RIGHT and stays — `moneyAgainst` is the only honest way
      // to state a flow — and the repeat is stripped here, in the caller that has a value column,
      // rather than by weakening a string story.ts and the fact text read as a whole sentence.
      movement = stripLeadingValue(
        annualMoneyMovement(spec, raw, priorRaw, gloss.label.toLowerCase()),
        renderAnnualValue(spec, displayValue),
      );
      steady = priorRaw > 0 && raw > 0 ? Math.abs(((raw - priorRaw) / priorRaw) * 100) < 3 : null;
    } else {
      movement = annualRatioMovement(spec, raw, priorRaw);
      // The same two floors, in the same order, so the flag and the sentence can never disagree.
      const d = Math.abs(displayValue - toAnnualDisplayValue(spec, priorRaw));
      steady = d < (spec.steadyBand ?? 0) || d < displayFloor(spec);
    }
  }

  const plain = plainFor(spec, displayValue, current);
  return {
    line: {
      key: spec.key,
      label: gloss.label,
      meaning: gloss.meaning,
      doesntMean: gloss.doesntMean,
      display: renderAnnualValue(spec, displayValue),
      value: displayValue,
      movement,
      steady,
      lowerIsBetter: spec.lowerIsBetter ?? false,
      ...(plain ? { plain } : {}),
    },
  };
}

/** YYYY-MM-DD. Matches fact-block.ts's `ymd` exactly — one date rendering across the feature. */
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Build the annual section for one Q4 (stock, year).
 *
 * `quarterReportDate` is the QUARTER's own as-of date and is used for one thing only: deciding whether
 * the card has to show a second clock. `prior` is the previous full year, or null.
 */
export function buildAnnualSection(
  current: AnyFamilyAnnual,
  prior: AnyFamilyAnnual | null,
  quarterReportDate: Date,
): AnnualSection | null {
  const lines: AnnualLine[] = [];
  const suppressed: SuppressedAnnualMetric[] = [];
  const notReported: AnnualMetricKey[] = [];
  const notCompared: { label: string; reason: string }[] = [];
  let balanceSheetLines = 0;

  for (const spec of annualManifestFor(current.family)) {
    const out = buildAnnualLine(spec, current, prior);
    if ("line" in out) {
      lines.push(out.line);
      if (spec.balanceSheet) balanceSheetLines++;
      // Only worth saying when there WAS a prior year to compare against. With no prior year the card
      // already says so once, for every line at once, and repeating it per metric is noise.
      if (spec.comparable === false && prior && spec.comparabilityReason) {
        notCompared.push({ label: out.line.label, reason: spec.comparabilityReason });
      }
    } else if ("suppressed" in out) suppressed.push(out.suppressed);
    else notReported.push(spec.key);
  }

  // ← GATE 4. A section with nothing the company owns or owes is not this section. See the header.
  if (balanceSheetLines === 0) return null;

  return {
    fiscalYear: current.fiscalYear,
    asOfDate: ymd(current.asOfDate),
    filingDate: ymd(current.filingDate),
    // ⚠ COMPARED AS RENDERED DATES, not as timestamps. Both columns are stored as DateTime and a
    // difference of hours between two 31-March rows is a storage artifact, not a second clock.
    datesAgree: ymd(current.asOfDate) === ymd(quarterReportDate),
    priorFiscalYear: prior?.fiscalYear ?? null,
    lines,
    suppressed,
    notReported,
    notCompared,
  };
}

/** "FY26" → "FY25". Returns null on an unexpected shape rather than guessing — a wrong prior year
 *  would produce movements measured against the wrong twelve months. */
export function priorFiscalYear(fy: string): string | null {
  const m = /^FY(\d{2,4})$/.exec(fy);
  if (!m) return null;
  return `FY${String(parseInt(m[1], 10) - 1).padStart(m[1].length, "0")}`;
}
