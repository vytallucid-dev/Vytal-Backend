// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EVENT DESCRIPTION — turning an exchange announcement's prose into stated components.
//
// ★ MOVED HERE FROM `chat/tools/` AT STAGE 8b (§8.2). It was never a tool: it is a COPY CLASSIFIER
//   with a 7,741-row gate over it (`verify-number-grounding` §3), and it exists to stop a reader
//   being handed "Interim Dividend Rs 11 Per Share/ Special Dividend Rs 46 Per Share" as free text
//   and left to add up ₹57 themselves. That defect is the same whoever renders the event.
//
// ⚠ THE STAGE-8b EVENTS BLOCK REPRODUCED THE DEFECT BEFORE THIS MOVE. `resolveCorporateEvents`
//   concatenated `description` raw, so ₹11 was stated and ₹46 was buried in prose — exactly what the
//   ₹57 regression pins. The gate caught it. The block now routes every description through here.

/** One labelled money component found in a description. */
export interface EventAmountComponent {
  /** Normalised label — "interim", "final", "special", "dividend". */
  label: string;
  /** ₹ per share. */
  amount: number;
}

export type EventDescriptionVerdict =
  | { kind: "clean"; text: string }
  | { kind: "structured"; components: EventAmountComponent[]; total: number; revised: boolean }
  | { kind: "suppress"; reason: "unattributed_amount" | "revision" };

/**
 * ★ AMOUNT DETECTION IS DELIBERATELY WIDER THAN COMPONENT PARSING.
 *
 * This must find EVERY currency figure in the string, including ones we cannot attribute — an amount we
 * fail to SEE is an amount that survives into the prompt unnoticed, which is the failure itself. Hence
 * `Re` (the singular used in "To Re 1/-") is in the alternation even though no dividend is ever labelled
 * with it: WELSPUNLIV's "Interim Div - Rs 6/- + Face Value Split From Rs 10/- To Re 1/-" must come back
 * as three amounts so that the one attributable component cannot certify the row as clean.
 */
const AMOUNT_RE = /(?:rs|inr|re|₹)\.?\s*([0-9]+(?:\.[0-9]+)?)/gi;

/**
 * A labelled dividend component. Two-sided by construction — the label may sit before the amount
 * ("Special Dividend - Rs 46") and, in 3 measured rows, the special leads the ordinary one, so nothing
 * here assumes the interim/final component comes first.
 *
 * ⚠ `Spl` AND BARE `Special` ARE IN THE ALTERNATION ON PURPOSE. Two rows in the corpus write
 * "Special Rs 5 Per Share" and "Spl-Rs.18" with no "Dividend" word at all (TATAINVEST 2012, GLAXO 2009).
 * Without them those rows fall to `suppress` and lose a real figure for the sake of one alternation.
 */
const COMPONENT_RE =
  /(special|spl|interim|int|final|fin|dividend|div)\b[^0-9₹]{0,24}?(?:rs|inr|re|₹)\.?\s*([0-9]+(?:\.[0-9]+)?)/gi;

/** A row whose figures may REPLACE rather than ADD. Summing these would assert a total nobody declared. */
const REVISION_RE = /\b(revised|revision|amend(?:ed|ment)?|cancell?ed|withdrawn|rescheduled)\b/i;

/**
 * ★ RESTATEMENT IS JUDGED AT THE COLUMN'S OWN PRECISION, NOT EXACTLY.
 *
 * `corporate_events.dividend_amount` is `Decimal(10, 2)`, so a three-decimal declared dividend is
 * round-half-up'd on ingest: NBCC's ₹0.135 is stored 0.14, IRCON's ₹10.825 → 10.83, GAIL's ₹0.885 → 0.89.
 * An exact comparison calls those a SECOND dividend and renders both — "dividend ₹0.14/share (final),
 * dividend ₹0.135/share" — which is two true numbers reading as two payments. Half a paisa apart is the
 * rounding, not a payment.
 *
 * ⚠ THIS COLLAPSES NOTHING REAL, BY CONSTRUCTION. It is reachable only when `components.length === 1`;
 * a genuine two-component row (interim + special) never enters this branch at all, whatever the amounts.
 * And no real dividend differs from its own record by ≤ half a paisa except through this rounding.
 *
 * ⚠ IT IS ALSO NOT A FIX FOR THE UNDERLYING BUG. The column silently loses the third decimal for every
 * sub-rupee dividend — systematic across PSUs, not three freak rows — and the fix for that is widening
 * the column to Decimal(12,4) and re-ingesting. This only stops the display from contradicting itself
 * in the meantime, and it stays correct either way once the schema is widened (the amounts then agree
 * exactly, which this test already accepts).
 */
const COLUMN_SCALE_SLACK = 0.005 + 1e-9; // half of Decimal(_, 2)'s last place

const isRestatement = (component: number, column: number | null | undefined): boolean =>
  column != null && Math.abs(component - column) <= COLUMN_SCALE_SLACK;

/** Collapse the source's many spellings onto the four labels a reader would recognise. */
function normaliseLabel(raw: string): string {
  const s = raw.toLowerCase();
  if (s === "special" || s === "spl") return "special";
  if (s === "interim" || s === "int") return "interim";
  if (s === "final" || s === "fin") return "final";
  return "dividend";
}

/** Every currency amount in the text, in order. */
function amountsOf(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Decide what may reach the model for one event description.
 *
 * `structuredAmount` is the row's own `dividendAmount` column. It is used ONLY to suppress a redundant
 * single component (the 4,681 rows whose description merely restates the column) — never to fill a gap,
 * and never to reconcile a disagreement. Three rows in the corpus have a description that DISAGREES with
 * their column; this returns `structured` for them with the description's own components, and the
 * disagreement is an ingestion question, deliberately not papered over here.
 */
export function parseEventDescription(
  description: string | null | undefined,
  structuredAmount: number | null | undefined,
): EventDescriptionVerdict {
  const text = (description ?? "").trim();
  if (!text) return { kind: "clean", text: "" };

  const amounts = amountsOf(text);
  // No money in the sentence ⇒ nothing to attribute, nothing to invent. The common case.
  if (amounts.length === 0) return { kind: "clean", text };

  // ★ A REVISION IS ONLY DANGEROUS WHEN THERE IS SOMETHING TO ADD, AND THE FIRST CUT GOT THIS WRONG.
  //   Suppressing every "(Purpose Revised)" row cost 200 dividend rows — nearly all of them a SINGLE
  //   amount, where no false total is constructible because there is only one figure. The hazard is
  //   specifically summing two figures that may REPLACE one another, so the rule now scopes to that:
  //   multiple amounts + a revision marker ⇒ suppress; one amount ⇒ keep it and FLAG the revision, so
  //   the reader still learns the announcement was amended.
  const revised = REVISION_RE.test(text);
  if (revised && amounts.length > 1) return { kind: "suppress", reason: "revision" };

  const components: EventAmountComponent[] = [];
  for (const m of text.matchAll(COMPONENT_RE)) {
    const amount = Number(m[2]);
    if (Number.isFinite(amount)) components.push({ label: normaliseLabel(m[1]), amount });
  }

  // ★ THE ATTRIBUTION TEST, AND THE WHOLE SAFETY PROPERTY OF THIS FILE. Every amount the detector found
  // must be claimed by a component. Multiset comparison, not a count: two components of ₹11 and one
  // stray ₹11 must not certify each other.
  const claimed = [...components.map((c) => c.amount)].sort((a, b) => a - b);
  const found = [...amounts].sort((a, b) => a - b);
  const attributed = claimed.length === found.length && claimed.every((v, i) => Math.abs(v - found[i]) < 1e-9);
  if (!attributed) return { kind: "suppress", reason: "unattributed_amount" };

  // A lone component that just restates the column adds nothing the row does not already print.
  if (components.length === 1 && isRestatement(components[0].amount, structuredAmount)) {
    return { kind: "structured", components, total: components[0].amount, revised };
  }

  const total = components.reduce((n, c) => n + c.amount, 0);
  return { kind: "structured", components, total: Number(total.toFixed(4)), revised };
}

/**
 * The model-facing sentence for a `structured` verdict, or null when the components say nothing the row's
 * own `dividend ₹X/share (type)` line does not already say.
 *
 * ★ THE TOTAL IS STATED EVEN THOUGH IT IS DERIVABLE — that is the point. The reader's question ("what did
 * TCS pay in January?") has ₹57 as its answer, so ₹57 must be a figure the model can QUOTE. Leaving it
 * derivable-but-absent is precisely what made the model derive it.
 */
export function renderComponents(v: EventDescriptionVerdict, structuredAmount: number | null | undefined): string | null {
  if (v.kind !== "structured") return null;
  // ⚠ The revision FLAG survives even when the components say nothing new — a reader learning the
  //   announcement was amended matters more than the line it rides on.
  const flag = v.revised ? "this announcement was revised by the exchange" : null;
  // Judged at the column's precision — see isRestatement. Two lines for one payment is a defect.
  if (v.components.length === 1 && isRestatement(v.components[0].amount, structuredAmount)) return flag;
  const parts = v.components.map((c) => `${c.label} ₹${c.amount}/share`).join(" + ");
  const body = v.components.length > 1 ? `${parts}, total ₹${v.total}/share declared in this announcement` : parts;
  return flag ? `${body} (${flag})` : body;
}

/** The fixed, honest marker that replaces a suppressed tail. Never states or hints at the figure. */
export const SUPPRESSED_TAIL_NOTE: Record<"unattributed_amount" | "revision", string> = {
  unattributed_amount:
    "(this event's description carries an amount Vytal could not attribute to a named component — it is " +
    "withheld rather than shown unattributed; state only the figures given above)",
  revision:
    "(this event's description was revised and its figures may replace rather than add to each other — " +
    "the text is withheld rather than shown ambiguously; state only the figures given above)",
};
