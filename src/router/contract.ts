// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTER CONTRACT — architecture spec §6.
//
// ── ★ THE FAILURE MODE THIS STAGE INTRODUCES, AND WHY IT IS WORSE THAN THE OLD ONE ────────────────
// Until now a wrong answer LOOKED wrong: a model free-forming over tool output produced prose a
// reader could smell. From here a misroute produces a confident, well-rendered, completely wrong
// artifact. The figures are real, the layout is right, the composition is a purpose-built view — of
// the wrong question. **The failure mode gets prettier**, and prettier means less detectable.
//
// So `operation: "unresolved"` is a VALUE, not an error path. Subject ambiguity already has its guard
// — stage 1's resolver returns `verdict: "ambiguous"` with `subject: null`, so a tier cannot be read
// off a subject nobody chose. Operation ambiguity had no such guard, and it is now the dangerous one.
//
// ── ★ WHAT THE MODEL IS ASKED FOR, AND WHAT IT IS NEVER GIVEN ─────────────────────────────────────
// Slots and a scope verdict. No tool definitions. No data. No history beyond the turn. A small fixed
// prompt — this is the ENTIRE model cost of a routed turn (§6.1), and it is the §0.2 scaling claim.
// Every figure that reaches a reader is a query result the router never saw.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Subject } from "../resolve/subject.js";

/** What the reader wants DONE. The closed operation vocabulary — a family maps to one of these. */
export type OperationSlot =
  | "orient"        // "how is X doing" — the headline read
  | "decompose"     // "why is it that" — parts and contributions
  | "compare"       // "X vs Y"
  | "screen"        // "which stocks ..."
  | "history"       // "what has it done over time"
  | "explain"       // "what does this term mean"
  | "list_findings" // "what has code flagged"
  // ★ ADDED AT STAGE 4, AND FOUND BY §6.4'S OWN WORKED EXAMPLE. "How much does TCS spend on R&D?" is
  //   the question the spec uses to demonstrate the generic path — and it mapped to NO operation in
  //   the original seven, so it routed to clarifying chips and never reached the generic composition
  //   at all. A plain value question ("how much is X's Y", "what is X's debt") is one of the
  //   commonest shapes a reader types and the generic composition exists precisely to serve it.
  //   Raised, not absorbed: this is a vocabulary extension, reported in the stage-4 report.
  | "lookup";       // "how much does X spend on Y" — a value question with no family of its own

/** WHICH FACET of the subject. Null when the question does not narrow one. */
export type LensSlot =
  | "health" | "fundamentals" | "ownership" | "valuation" | "price" | "filings" | "events";

/**
 * ★ WHOSE DATA THE QUESTION IS ABOUT — ADDED AT STAGE 6.
 *
 * `market` — companies and instruments at large. `reader` — the asker's OWN holdings, portfolio,
 * watchlist, alerts or ledger.
 *
 * ⚠ IT IS ORTHOGONAL TO `subjects`, NOT A REPLACEMENT FOR THEM, AND THAT IS THE WHOLE POINT.
 * "how much TCS do I own" is `perspective: "reader"` WITH subject TCS — a reader-relative question
 * about a company, which is a third thing and not either half. Folding the reader into `subjects` as
 * a magic mention would have made that shape unrepresentable and put natural-language parsing
 * ("me", "my book", "mera portfolio") where a closed slot belongs.
 *
 * It also fixes a live wrongness: `scope` alone forced "how is my portfolio doing?" to
 * `out_of_scope`, because the scope rule described companies and the reader's own book is not one.
 */
export type Perspective = "market" | "reader";

/**
 * ★ THE CHANGE THE READER ASKED FOR, OR `null` WHEN THEY ONLY ASKED TO BE TOLD SOMETHING.
 *
 * ⚠ A VALUE HERE NEVER CAUSES A WRITE. It causes a CONTROL TO BE RENDERED, pre-armed, and the
 * reader's tap is what calls an ordinary authenticated endpoint. Model output reaches a rendered
 * button and stops there — see §5.4. The worst case on a misclassification is a control nobody
 * taps, which is the whole reason the action slot is allowed to exist at all.
 *
 * Closed, and short on purpose: an action is only admitted here once there is a control that renders
 * it and an endpoint that validates it independently.
 */
export type ActionSlot =
  | "watchlist_add"
  | "watchlist_remove"
  | "transaction_record"
  // ── stage 7. Both land on endpoints that already ship and already serve the app's own UI, so
  //    neither adds a write surface. Both are `prefilled-form`: an alert carries a threshold and a
  //    reminder carries a lead time, and a number nobody looked at is the write that must not happen
  //    on one tap.
  | "alert_create"
  | "reminder_create"
  // ── stage 8. The last three, and the two memory ones are the first actions with NO STOCK SUBJECT:
  //    "remember that I like short answers" names no company. The control carries the READER'S OWN
  //    TEXT — not a model paraphrase of it — so what gets stored is what they typed.
  | "memory_add"
  | "memory_forget"
  | "alert_delete";

export interface TimeframeSlot {
  readonly kind: "latest" | "quarters" | "years";
  readonly n: number | null;
}

/** A subject the ROUTER heard — a string, not a resolved stock. Resolution is resolver #1's job and
 *  happens after routing, so the model never names a ticker the system then trusts. */
export interface SubjectMention {
  readonly text: string;
}

/**
 * ★ THE ENTIRE MODEL OUTPUT FOR A TURN. Slots plus a verdict. Nothing else crosses this line.
 *
 * `confidence` is the model's own, and it is advisory: `low` never upgrades a resolved operation into
 * a guess, and never downgrades `unresolved` into one either. It exists so the composer can prefer
 * chips over a marginal match, not so it can override a slot.
 */
export interface RouterOutput {
  readonly scope: "in_scope" | "out_of_scope" | "unresolved";
  readonly subjects: readonly SubjectMention[];
  readonly operation: OperationSlot | "unresolved";
  readonly lens: LensSlot | null;
  readonly timeframe: TimeframeSlot | null;
  readonly confidence: "high" | "low";
  /** Whose data — see `Perspective`. Defaults to `"market"`, which is what an unstated question is. */
  readonly perspective: Perspective;
  /** The change asked for, or null. A value renders a CONTROL; it never writes — see `ActionSlot`. */
  readonly action: ActionSlot | null;

  /**
   * ★ WHICH CLASSIFIER PRODUCED THIS, AND IT IS NOT COSMETIC.
   *
   * The lexical classifier is deliberately under-confident: it answers `unresolved` wherever the
   * model would have answered, so a turn that fell back to it produces CLARIFYING CHIPS where a
   * funded turn produces an answer. Until this field existed, a denied turn was byte-identical to a
   * funded one that happened to agree — the path that changes the ANSWER was the one path carrying
   * no evidence it had been taken, while the planner (which only makes the prose plainer) already
   * recorded its own fallback.
   *
   * The miss-log is what this is for. It is the mechanism that decides which family gets built next,
   * and an unlabelled denial makes the router look worse than it is: `unresolved` rows pile up that
   * say nothing about the question and everything about our budget. After the switchover there is no
   * old path to compare against, so the comparison has to be inside the run.
   */
  readonly source: "model" | "lexical";
  /** Why the model path was not used. `null` on the model path and on a lexical-by-configuration
   *  run. A sentence, never shown to a reader — see compose.ts for what a reader is told. */
  readonly degradedReason: string | null;
}

/**
 * ★ WHAT THE PREVIOUS TURN LEFT BEHIND — stage 9.
 *
 * ⚠ IT CARRIES RESOLVED SUBJECTS, NOT MENTIONS, AND THAT IS WHAT MAKES IT SAFE TO INHERIT. These are
 * resolver #1's output from a turn that already happened, so a follow-up inheriting them is
 * inheriting CODE's decision, not re-trusting a model's. The model is never shown this and never
 * asked about it.
 *
 * ★ AND IT IS WHY CLASSIFICATION STAYS A PURE FUNCTION OF THE SENTENCE (§6.5 rule 2). The context is
 * applied AFTER the classifier returns, so the cache key is still the question text alone. Feeding
 * history into the prompt would have made one question classify differently depending on what came
 * before it, and the cache would then be keying on a fraction of its own input.
 */
export interface TurnContext {
  readonly subjects: readonly Subject[];
  readonly operation: OperationSlot | "unresolved";
  readonly lens: LensSlot | null;
  readonly perspective: Perspective;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ WHICH FAMILY ANSWERED — §6 EXTENSION, PHASE 3 · MT · MULTI-TURN.
   *
   * ⚠ SLOTS ALONE CANNOT ROUTE A REFERENT, AND THE MEASUREMENT IS UNAMBIGUOUS. A bare "why" states
   *   its own operation (`decompose`) and carries the previous turn's lens. That is enough for two of
   *   the three cases the brief names and not for the third:
   *
   *     after a composite      decompose + health        → A · Attribution      ✓
   *     after a margin fall    decompose + fundamentals  → F · Fundamentals     ✓ (once F claims it)
   *     after a pattern card   decompose + **null**      → nothing claimed it   ✗
   *
   *   A findings census narrows no lens — it is the un-narrowed question about what fired — so the
   *   follow-up inherited nothing to route on and fell to the planner, and the reader asking "why"
   *   about a flag got a whole-company page. What is ON SCREEN is a patterns answer, and the context
   *   could not say so.
   *
   * ★ IT IS THE FAMILY, NOT THE COMPOSITION ID. `patterns.stock` and a future `patterns.<variant>` are
   *   one answer shape to a follow-up; carrying the id would make referent routing depend on variant
   *   names, which are a family's private business.
   *
   * ⚠ AND IT IS ADVISORY, NEVER AUTHORITATIVE. It is consulted only for a BARE continuation that has
   *   stated nothing of its own — never over a question that named its own subject or its own
   *   operation. The T-1 invariant is untouched.
   *
   * `null` on the first turn and on any turn that did not compose a family answer.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly lastFamily: string | null;
}

/** What the router hands the composer once subjects are RESOLVED (resolver #1, not the model). */
export interface RoutedTurn {
  readonly raw: string;
  readonly router: RouterOutput;
  /**
   * ★ EVERY RESOLVED SUBJECT, IN THE ORDER THE READER NAMED THEM — stage 6.
   *
   * ⚠ THE LIST IS THE TRUTH; `resolvedSymbols` IS A PROJECTION OF IT. Until now the composer read
   * `resolvedSymbols[0]` and silently dropped the rest, so "compare TCS and Infosys" resolved both
   * and then answered about TCS alone — a confident, well-shaped answer to half the question. A
   * comparison has two subjects and the type now says so.
   *
   * A reader subject is appended by `route()` when `perspective: "reader"`; it is never named in the
   * question, so it can never arrive as a mention.
   */
  readonly subjects: readonly Subject[];
  /**
   * The stock symbols among `subjects`, in order. Kept because most compositions are single-stock by
   * nature and reading `.symbol` off a union at every site would be noise.
   *
   * ⚠ A PROJECTION, NOT THE SUBJECT LIST. It is empty for a reader-only or instrument-only turn even
   * though a subject resolved, so `resolvedSymbols.length === 0` no longer means "nothing resolved".
   */
  readonly resolvedSymbols: readonly string[];
  /** Candidate symbols to offer when resolution was ambiguous or weak. */
  readonly subjectChoices: readonly { symbol: string; name: string }[];
  readonly needsSubjectChoice: boolean;
  /**
   * ★ EVERY DETERMINISTIC CORRECTION CODE MADE TO THE MODEL'S SLOTS, IN WORDS.
   *
   * Empty on a turn the classifier got right unaided. It is diagnostic and never shown to a reader —
   * but a router that silently overrules its own classifier is a router nobody can debug, and three
   * of the stage-9 fixes do exactly that.
   */
  readonly corrections: readonly string[];
  /** What this turn leaves for the next one, if the next one is a follow-up. */
  readonly context: TurnContext;
}

export const OPERATIONS: readonly OperationSlot[] = [
  "orient", "decompose", "compare", "screen", "history", "explain", "list_findings", "lookup",
];
export const LENSES: readonly LensSlot[] = [
  "health", "fundamentals", "ownership", "valuation", "price", "filings", "events",
];
export const PERSPECTIVES: readonly Perspective[] = ["market", "reader"];
export const ACTIONS: readonly ActionSlot[] = [
  "watchlist_add", "watchlist_remove", "transaction_record",
  "alert_create", "reminder_create", "memory_add", "memory_forget", "alert_delete",
];
