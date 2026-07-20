// ═══════════════════════════════════════════════════════════════════════════
// HOLDING DISCLOSURES — what we do NOT track, said out loud, on the holding itself.
//
// Step 20 lets a user hold ANY instrument manually. For unit-priced things — ETFs, funds, REITs,
// InvITs — that is complete: quantity × price is the whole economic truth, FIFO replays it exactly,
// and the read path prices it from the exchange close or the AMFI NAV.
//
// A BOND IS NOT COMPLETE, AND PRETENDING OTHERWISE WOULD BE THE LIE.
//
// A bond pays COUPONS and accrues interest between them, so its total return is not just
// (price now − price paid). Tracking that honestly needs the coupon schedule and the day-count
// convention, and WE DO NOT HAVE EITHER — no source in this system publishes them. Two roads from
// there, and only one is honest:
//
//   ✗  Compute a "clean price" cost basis from an assumed coupon and day-count. That is a fabricated
//      number wearing the costume of a precise one. It would be wrong in a way the user cannot see.
//
//   ✓  Take the number the USER ACTUALLY PAID (they enter it; it includes whatever accrued interest
//      was in the settlement) — which makes the cost basis exactly right — and then SAY that the
//      coupon income is not tracked. The gap becomes visible instead of invisible.
//
// So the cost basis is honest by construction, and this file exists to make the remaining gap
// legible. The disclosure is DERIVED from the instrument's asset class at read time, never stored:
// `instruments.asset_class` already holds the fact, and a second copy of a fact is a second thing to
// keep in step. (Same reasoning as the omissions ledger in mf-omissions.ts: store the code, compose
// the sentence at read time.)
//
// NO ACCRUED-INTEREST MATH LIVES ANYWHERE IN THIS CODEBASE. If it ever does, it will be because a
// real source for coupon schedules was ingested first — not because this file guessed.
// ═══════════════════════════════════════════════════════════════════════════
import type { UnpricedReason } from "./price-resolver.js";
import type { NullReasonClass } from "./null-reasons.js";

/** The instrument's asset class, as `instruments.asset_class` publishes it. */
export type HeldAssetClass =
  | "stock" | "etf" | "bond" | "gsec" | "sgb" | "mutual_fund" | "reit" | "invit";

export const HoldingDisclosure = {
  /**
   * This holding pays COUPONS, and we do not track them. Its cost basis is exactly what the user
   * paid (they entered it, accrued interest included), and its market value is the exchange close.
   * What is MISSING is the income leg: coupons received are not recorded, so the P&L shown is a
   * PRICE return, not a TOTAL return, and it understates the bond by whatever it has paid out.
   *
   * The identical failure that Step 19 found in AMFI's IDCW plans — a NAV that falls on every payout
   * — and named rather than papered over. We have no coupon schedule to reconstruct from, so we say
   * so instead of inventing one.
   */
  COUPON_INCOME_NOT_TRACKED: "coupon_income_not_tracked",
  /**
   * ★ (T-1) A DISCOUNT INSTRUMENT — a Treasury bill and its kin. It pays NO coupon: issued below par,
   * redeemed at par, and that difference IS its entire return. This is NOT a gap in our data — there is
   * no coupon to track — so it must be said as what the instrument DOES, never as an absence. Rendering
   * it as "coupon income is not tracked (there is none)" invents a gap to apologise for: a sentence
   * arguing with a gap has already planted one (`cv2-s10a-not-a-gap-vocabulary`). 54 of 170 G-Secs are
   * these. The findings layer (PD3) already excludes them by reading `couponNullReason`; this makes
   * `/me/holdings` read the SAME signal, so the two surfaces can never again disagree about a T-bill.
   */
  DISCOUNT_INSTRUMENT_PAYS_AT_PAR: "discount_instrument_pays_at_par",
} as const;

export type HoldingDisclosureCode =
  (typeof HoldingDisclosure)[keyof typeof HoldingDisclosure];

/** Debt instruments — the ones that MAY pay a coupon we cannot see. SGBs pay 2.5% semi-annual interest,
 *  so they belong here too: the metal price is only half their return. ⚠ NOT ALL of these pay a coupon —
 *  a discount G-Sec (T-bill) pays none, which `disclosuresFor` now distinguishes via `attributes`. */
const COUPON_BEARING: ReadonlySet<string> = new Set(["bond", "gsec", "sgb"]);

/**
 * The disclosures this holding must carry. DERIVED from the asset class AND the stamped `attributes` —
 * nothing new is stored. An empty array is the honest answer for a stock, an ETF, a fund, a REIT or an
 * InvIT: quantity × price IS the whole story for them.
 *
 * ★ (T-1) `attributes` is REQUIRED, and that is the fix. `disclosuresFor` derived from `assetClass`
 * ALONE — the right call when written ("a second copy of a fact is a second thing to keep in step"), but
 * blind to the one thing that separates a coupon-paying G-Sec from a T-bill: `couponNullReason ==
 * 'discount_instrument'`, which lives in `attributes`. So 54 T-bills were stamped
 * `coupon_income_not_tracked` — apologising for income that does not exist — while PD3, which reads
 * `attributes`, correctly excluded them. Making the parameter required means no caller can silently keep
 * the blind spot: the compiler flags any that does not pass it.
 */
export function disclosuresFor(
  assetClass: string | null | undefined,
  attributes: Record<string, unknown> | null | undefined,
): HoldingDisclosureCode[] {
  if (!assetClass || !COUPON_BEARING.has(assetClass)) return [];
  // A discount instrument pays no coupon — there is nothing to disclose as UNTRACKED. It carries the
  // "what it does" disclosure instead, keyed on the same reason PD3 reads.
  const attrs = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {};
  if (attrs["couponNullReason"] === "discount_instrument") {
    return [HoldingDisclosure.DISCOUNT_INSTRUMENT_PAYS_AT_PAR];
  }
  return [HoldingDisclosure.COUPON_INCOME_NOT_TRACKED];
}

/** Render a code into the sentence a human should read. Called at READ time, never at write time. */
export function explainDisclosure(code: string): string {
  switch (code) {
    case HoldingDisclosure.COUPON_INCOME_NOT_TRACKED:
      return (
        "Coupon income is not tracked for this holding. What you paid is recorded exactly as you " +
        "entered it, and the current value is the market price — but the interest this pays out is " +
        "not counted, so the gain shown is price-only and understates the true return. We do not " +
        "hold a coupon schedule for Indian debt, and we would rather tell you that than estimate it."
      );
    case HoldingDisclosure.DISCOUNT_INSTRUMENT_PAYS_AT_PAR:
      // ★ NOT the vocabulary of absence — no "not tracked", no "missing", no "we don't have". There is
      // nothing to have. The sentence says what the instrument DOES; the whole return is already in the
      // price. (Same shape as null-reasons.ts's `discount_instrument` fact — `cv2-s10a-not-a-gap-vocabulary`.)
      return (
        "This is a discount instrument — it pays no coupon at all. It is issued below its face value " +
        "and redeems at par, and that difference is how it pays. Its whole return is already in the " +
        "price you see, so there is nothing separate to add."
      );
    default:
      return code;
  }
}

/**
 * Does the ENTRY FORM need to ask for a dirty price? True for coupon-bearing debt.
 *
 * The backend does not render anything — it carries the truth and the frontend shows it. This flag is
 * what lets the form say "enter the total you paid, including any accrued interest", which is the one
 * instruction that makes the user's number correct WITHOUT us doing any accrued-interest math. The
 * user already knows what left their bank account; we just have to not throw that away.
 */
export function entryIncludesAccruedInterest(assetClass: string | null | undefined): boolean {
  return !!assetClass && COUPON_BEARING.has(assetClass);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SHARED HOME for per-holding disclosure PROSE + TONE. Read side of the same discipline as above.
//
// ★ WHY `REASON_CLAUSE` LIVES HERE NOW. It was private to read-time-findings.ts, where PE6/PD4 first
// needed it — the exact "the ledger was only ever its first reader" pattern that moved asset-class.ts out
// of the transactions module. `/me/holdings` must render the SAME unpriced-reason prose per holding, and a
// second copy is a second thing to drift. The live proof was already in the tree: a comment that read
// "3 values" while the enum had grown to 4 (`not_exchange_traded`). So the clause map lives HERE; this
// module imports nothing from the findings engine, and read-time-findings.ts imports the map back — one
// home, and the PE6/PD4 finding text stays byte-identical.
//
// ★ THE TONE IS THE SAME FOUR-CLASS TAXONOMY the findings channel ships as PfFinding.notEvaluable.cls —
// `NullReasonClass` is IMPORTED, never re-declared. What is assigned below is which class each per-holding
// code carries; the vocabulary is not re-invented (the rule null-reasons.ts states for itself).
// ═══════════════════════════════════════════════════════════════════════════

/** The `unpricedReason` → user-facing CLAUSE. Moved here from read-time-findings.ts so /me/holdings and
 *  the PE6/PD4 findings render from ONE map. Each names WHICH KIND of "no" this is — "no price has landed
 *  yet" carries a promise the others do not (price-resolver.ts's own reasoning, carried through). */
export const REASON_CLAUSE: Record<UnpricedReason, string> = {
  no_instrument: "outside the universe we catalogue",
  no_price_yet: "no price has landed for it yet",
  not_exchange_traded: "not exchange-traded on a market we read",
  dormant: "no longer priced by AMFI",
};

/** The four-class tone each unpriced reason carries — REUSING the findings channel's NullReasonClass, not
 *  a parallel taxonomy. Three are `our_gap`: a valuation gap that is ours (no_instrument / no_price_yet /
 *  not_exchange_traded — the last trades OTC/RFQ, not on a market WE read, so the gap is our source
 *  scope). `dormant` is `refused`, and it is textbook: price-resolver.ts holds a last-known NAV and
 *  REFUSES to present it as current — "we could have published something and chose not to", the exact
 *  definition null-reasons.ts gives the class. */
export const UNPRICED_CLASS: Record<UnpricedReason, NullReasonClass> = {
  no_instrument: "our_gap",
  no_price_yet: "our_gap",
  not_exchange_traded: "our_gap",
  dormant: "refused",
};

/** The four-class tone for each Step-20 disclosure code. `discount_instrument_pays_at_par` is `not_a_gap`
 *  — the SAME class null-reasons.ts gives its `discount_instrument` twin: nothing is missing, a T-bill
 *  pays no coupon by design. `coupon_income_not_tracked` is `our_gap`: we hold no coupon schedule for
 *  Indian debt, and that gap is ours. */
export const DISCLOSURE_CLASS: Record<HoldingDisclosureCode, NullReasonClass> = {
  [HoldingDisclosure.COUPON_INCOME_NOT_TRACKED]: "our_gap",
  [HoldingDisclosure.DISCOUNT_INSTRUMENT_PAYS_AT_PAR]: "not_a_gap",
};

/** The synthetic code for "held, valued, deliberately not scored" — a boolean on the wire, given a code
 *  here so it travels as a DisclosureNote like every other disclosure. */
export const HELD_NOT_SCORED_CODE = "held_not_scored";

/** One rendered disclosure: the machine code, its four-class tone, and the composed sentence. `cls` (not
 *  `class`) mirrors `describeNull`/`PfFinding.notEvaluable.cls` — one name for the tone across the repo,
 *  and not a reserved word. The FE keys placement off `code`, tone off `cls`, and renders `sentence`. */
export interface DisclosureNote {
  code: string;
  cls: NullReasonClass;
  sentence: string;
}

/** The per-holding disclosure for a position we could not price. Composes the SAME clause PE6/PD4 use
 *  into a full sentence — no new vocabulary, only the sentence shell PE6 already puts around it
 *  ("…no price — {clause}."). Returns null for a missing/unknown reason (a priced holding never calls
 *  this; an unknown future reason is OMITTED, never mislabelled — null-reasons.ts's law). */
export function describeUnpriced(reason: UnpricedReason | null | undefined): DisclosureNote | null {
  if (!reason) return null;
  const clause = REASON_CLAUSE[reason];
  if (!clause) return null; // unknown future reason → omit, never a "We can't price this — undefined."
  return { code: reason, cls: UNPRICED_CLASS[reason], sentence: `We can't price this holding — ${clause}.` };
}

/** The per-holding disclosure for a position we value but never score. NOT a gap — a by-design absence:
 *  the Health Score is an equity judgement built on company fundamentals a non-equity does not have
 *  (assemble.ts / holdings-controller's own words). Class `not_a_gap`, tone neutral — never a warning. */
export function describeHeldNotScored(): DisclosureNote {
  return {
    code: HELD_NOT_SCORED_CODE,
    cls: "not_a_gap",
    sentence:
      "We don't score this holding. The Health Score is an equity judgement built on company " +
      "fundamentals — margins, returns, leverage — and this isn't an equity. That's by design, not a gap.",
  };
}

/** A Step-20 disclosure code → its rendered note. Sentence from `explainDisclosure` (unchanged), tone
 *  from DISCLOSURE_CLASS. The `not_a_gap` discipline is already baked into WHICH code was chosen upstream
 *  (`disclosuresFor`), so this only names it — it never re-decides which code a holding carries. */
export function describeDisclosure(code: HoldingDisclosureCode): DisclosureNote {
  return { code, cls: DISCLOSURE_CLASS[code], sentence: explainDisclosure(code) };
}

/** ALL disclosures a holding carries, as rendered notes — the ONE place /me/holdings builds its per-row
 *  `disclosureNotes`. Order: unscored (what it IS) → unpriced (can we value it) → instrument disclosures
 *  (coupon / discount). Every entry is a true fact about the holding; the FE curates which to surface.
 *  Empty for a scored, priced, non-coupon holding — the honest "nothing to disclose". */
export function holdingDisclosureNotes(input: {
  heldNotScored: boolean;
  heldNotValued: boolean;
  unpricedReason: UnpricedReason | null | undefined;
  disclosures: HoldingDisclosureCode[];
}): DisclosureNote[] {
  const notes: DisclosureNote[] = [];
  if (input.heldNotScored) notes.push(describeHeldNotScored());
  if (input.heldNotValued) {
    const n = describeUnpriced(input.unpricedReason);
    if (n) notes.push(n);
  }
  for (const c of input.disclosures) notes.push(describeDisclosure(c));
  return notes;
}
