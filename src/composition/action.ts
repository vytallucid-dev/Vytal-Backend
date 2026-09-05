// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ACTION PATH — §5.4. What replaces propose → confirm → execute.
//
// ── ★ THE OLD SHAPE AND WHY IT IS GONE ────────────────────────────────────────────────────────────
// The old flow was: model calls a write tool → tool stores a proposal → model writes a confirmation
// sentence → reader types "yes" → model calls confirmPendingAction → code reads the stored proposal
// and writes. Five model-mediated steps, a stored intermediate state, a whole tool pair
// (confirm/cancel) whose only job was parsing agreement, and a live failure where a write turn ran
// out of tool rounds mid-recovery.
//
// It existed because the model was the only interface. It no longer is.
//
// ── ★ THE NEW SHAPE, AND THE ONE INVARIANT ────────────────────────────────────────────────────────
//                  **NO MODEL OUTPUT EVER REACHES A WRITE.**
//
//   router      classifies `action` + subject MENTIONS.        ← the only model step
//   code        resolves the mention to a real stock row.
//   code        picks the endpoint from a closed map.
//   code        builds the body from the RESOLVED row.
//   reader      taps.                                          ← the confirmation
//   endpoint    validates, derives the owner from the session, writes.
//
// The tap IS the confirmation, so there is no confirm turn to parse and no proposal to store. A
// misclassification renders a control nobody taps.
//
// ── ★ AMBIGUITY NEEDS NO SPECIAL HANDLING, AND THAT IS THE ELEGANT PART ───────────────────────────
// The old path had to ask "which HDFC did you mean?", wait for an answer, re-resolve, and only then
// propose. Here an unresolved mention renders ONE CONTROL PER CANDIDATE. The reader disambiguates
// and confirms in the same gesture, and no state is carried between turns to get stale.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { datesMentionedIn, resolvePhrase } from "../resolve/date-phrase.js";
import { actionSection, type ActionField } from "../section/kinds/action.js";
import { coverageSection } from "../section/kinds/coverage.js";
import { NO_COVERAGE } from "../resolve/contract.js";
import { asStock } from "../resolve/subject.js";
import { listMemories } from "../reader/memory.js";
import { resolveAlerts } from "../resolve/blocks-reader.js";
import type { ActionSlot } from "../router/contract.js";
import type { ReaderProfile } from "../reader/profile.js";
import type { AnySection, AnswerProse, ComposeContext } from "./contract.js";

/** The composed action turn, in the shape `composeTurn` returns. */
export interface ActionAnswer {
  readonly kind: "composed";
  readonly compositionId: string;
  readonly sections: readonly AnySection[];
  readonly prose: AnswerProse;
  readonly missLogged: boolean;
}

const VERB: Record<ActionSlot, string> = {
  watchlist_add: "add",
  watchlist_remove: "remove",
  transaction_record: "record",
  alert_create: "set up",
  reminder_create: "set",
  memory_add: "remember",
  memory_forget: "forget",
  alert_delete: "delete",
};

/**
 * Build the answer for a turn the router read as a request rather than a question.
 *
 * Returns `null` when there is nothing to act on — no subject resolved and no candidates — so the
 * caller falls through to its read paths rather than rendering a control with no object.
 */
export async function buildActionAnswer(
  action: ActionSlot,
  ctx: ComposeContext,
  profile: ReaderProfile,
): Promise<ActionAnswer | null> {
  const { turn } = ctx;

  // ★ AN ACTION NEEDS AN AUTHENTICATED READER, AND THE CHECK IS HERE RATHER THAN AT THE ENDPOINT.
  //   The endpoint would refuse anyway — every one is behind requireAuth — but refusing there means
  //   rendering a button that is guaranteed to fail. Offering a control we know cannot work is a
  //   worse product than saying so.
  if (!ctx.reader) {
    return say(
      `You need to be signed in before I can ${VERB[action]} anything on your account.`,
      [coverageSection(NO_COVERAGE) as AnySection],
    );
  }

  // ★ THE READER-SCOPED ACTIONS COME FIRST, BECAUSE THEY NAME NO COMPANY. "remember that I like
  //   short answers" has no subject to resolve, and every branch below would decline it.
  if (action === "memory_add" || action === "memory_forget" || action === "alert_delete") {
    return readerAction(action, ctx, profile);
  }

  const stock = asStock(turn.subjects.find((s) => s.kind === "stock"));

  // ── AMBIGUOUS: one control per candidate. The reader disambiguates and confirms in one gesture. ──
  if (!stock && turn.subjectChoices.length > 0) {
    const rows = await stockRows(turn.subjectChoices.map((c) => c.symbol));
    const sections = rows.map((r) =>
      actionSection({
        action,
        subject: { symbol: r.symbol, name: r.name, stockId: r.id },
        summary: summaryFor(action, r.name),
        body: bodyFor(action, r),
      }) as AnySection,
    );
    if (sections.length === 0) return null;
    return say(
      `More than one company matches that. Pick the one you meant — tapping it is the confirmation, ` +
      `and nothing changes until you do.`,
      sections,
      "action.ambiguous",
    );
  }

  if (!stock) return null;

  const row = (await stockRows([stock.symbol]))[0];
  if (!row) return null;

  const fields =
    action === "transaction_record" ? transactionFields(turn.raw, row.symbol)
    : action === "alert_create" ? alertFields(turn.raw, row.id)
    : action === "reminder_create" ? reminderFields(turn.raw, row.id)
    : undefined;

  const section = actionSection({
    action,
    subject: { symbol: row.symbol, name: row.name, stockId: row.id },
    summary: summaryFor(action, row.name),
    body: bodyFor(action, row),
    fields,
    coverage: { subject: stock.coverage, query: null },
  }) as AnySection;

  const who = profile.statedName ? `${profile.statedName}, ` : "";
  // ⚠ THE NOUN FOLLOWS THE ACTION. Every prefilled form said "I have read that as a <company> TRADE",
  //   so "alert me when INFY drops below 1400" came back as "I have read that as an Infosys Ltd
  //   trade" — naming a ledger entry the reader never asked for, above a form that creates an alert.
  //   Seen in the live trace, and it is the kind of wrongness that makes a reader distrust the
  //   fields underneath it.
  const NOUN: Partial<Record<ActionSlot, string>> = {
    transaction_record: "trade",
    alert_create: "price alert",
    reminder_create: "reminder",
  };
  const opening = fields
    ? `${who}I have read that as a ${row.name} ${NOUN[action] ?? "request"} and filled in what I could. ` +
      `Check the figures — I have not written anything yet.`
    : `${who}here is the control. Nothing changes until you tap it.`;

  return say(opening.charAt(0).toUpperCase() + opening.slice(1), [section], `action.${action}`);
}

const say = (
  opening: string,
  sections: readonly AnySection[],
  id = "action.unavailable",
): ActionAnswer => ({
  kind: "composed",
  compositionId: id,
  sections,
  prose: { opening: [opening], leads: {}, after: {}, close: "" },
  missLogged: false,
});

/** The resolved rows. ★ `stockId` COMES FROM HERE — a database row — never from the question text. */
async function stockRows(symbols: readonly string[]): Promise<{ id: string; symbol: string; name: string }[]> {
  if (symbols.length === 0) return [];
  return prisma.stock.findMany({
    where: { symbol: { in: symbols.map((s) => s.toUpperCase()) } },
    select: { id: true, symbol: true, name: true },
  });
}

const summaryFor = (action: ActionSlot, name: string): string =>
  action === "watchlist_add" ? `Pin ${name} to your watchlist.`
  : action === "watchlist_remove" ? `Unpin ${name} from your watchlist.`
  : action === "alert_create" ? `Watch ${name} and tell you when it crosses a level you set.`
  : action === "reminder_create" ? `Remind you before ${name}'s next corporate event.`
  : action === "alert_delete" ? `Delete your alert on ${name}.`
  : `Add a ${name} trade to your ledger.`;

/**
 * The request body, built from the RESOLVED row.
 *
 * ⚠ THE TRANSACTION BODY IS DELIBERATELY EMPTY. Its values live in `fields`, which the reader edits
 * and the client submits. Putting an extracted quantity here as well would create a second, unedited
 * copy of the same number — and the first client that posted `body` instead of the field values
 * would write the extraction the reader had just corrected.
 */
const bodyFor = (action: ActionSlot, row: { id: string; symbol: string }): Record<string, string | number> =>
  action === "watchlist_add" ? { stockId: row.id }
  : action === "watchlist_remove" ? {}
  : {};   // alert, reminder and transaction all carry their values in `fields`

/**
 * ★ EXTRACTION IS CODE, NOT THE MODEL — AND THAT IS A STAGE-6 CHOICE WORTH STATING.
 *
 * The brief allowed the model's extraction to populate the form. It reads quantity, price and date
 * off the raw text here instead, for two reasons that both point the same way:
 *
 *   1. §6.5 measured the router at 80–88% run-to-run reproducibility at temperature 0. A quantity
 *      that changes between two identical asks is a worse failure than one that is missing.
 *   2. Every value goes into a FIELD the reader reads before submitting, so the safety guarantee is
 *      identical either way — which makes the deterministic option strictly better.
 *
 * A pattern that does not match leaves the field `null` and the reader types it. `null` is a fine
 * outcome; a confident wrong number is not.
 */
export function transactionFields(raw: string, symbol: string): ActionField[] {
  const text = raw.trim();
  const qty = /\b(?:bought|sold|buy|sell|purchased)\s+(\d+(?:\.\d+)?)\b/i.exec(text)
    ?? /\b(\d+(?:\.\d+)?)\s+(?:shares?|units?|qty)\b/i.exec(text);
  const price = /\b(?:at|@|for|price)\s*(?:rs\.?|₹|inr)?\s*(\d+(?:\.\d+)?)\b/i.exec(text);
  const side = /\b(sold|sell|sale)\b/i.test(text) ? "SELL" : "BUY";

  // ★ THE DATE GOES THROUGH `resolvePhrase`, WHICH IS WHY THAT MODULE SURVIVES (§8.2). "last Tuesday"
  //   is the commonest way a reader dates a trade, and a ledger entry on the wrong day misprices the
  //   whole FIFO chain behind it. The resolved date is shown as a field so the reader sees which
  //   Tuesday we meant.
  // ⚠ `resolvePhrase` TAKES A PHRASE; THIS IS A SENTENCE. Handing it the whole thing refused every
  //   real input — "I bought 10 TCS at 3200 last Tuesday" is not a date expression — and left the
  //   field empty on exactly the example the action path exists to serve. `datesMentionedIn` is the
  //   free-text extractor built for this, and it was already in the module.
  const direct = resolvePhrase(text);
  const mentioned = direct.ok ? new Set([direct.date]) : datesMentionedIn(text);
  // ★ EXACTLY ONE DATE, OR NONE. Two dates in one sentence means we do not know which is the trade
  //   date, and picking the first would be a guess written into a ledger. The reader picks instead.
  const dateIso = mentioned.size === 1 ? [...mentioned][0]! : null;

  // ⚠ THE REFUSAL TEXT FROM `resolvePhrase` IS MODEL-FACING AND MUST NOT REACH A READER. It reads
  //   "Do not translate it yourself — ask the reader for the exact day", which is an instruction to
  //   a model about a reader, shown to that reader. Field notes are reader copy and are written here.
  const dateNote =
    dateIso === null && mentioned.size > 1 ? "more than one date in what you wrote — pick the trade date"
    : dateIso === null ? "no date in what you wrote — pick one"
    : direct.ok && direct.assumption ? direct.assumption
    : `read from what you wrote — check it`;

  return [
    { name: "symbol", label: "Company", type: "text", value: symbol, required: true,
      note: "resolved from our universe, not from the text" },
    // ★ A CLOSED CHOICE, AND LOWER-CASE ON THE WIRE — T-1 finding 5, two bugs in one field.
    //   It was `type: "text"` carrying "BUY", so (a) the reader could type anything (`sdsds` was
    //   typed into it during the browser pass) and (b) even untouched it 400d, because
    //   transactions-service.ts#Base is `z.enum(["buy","sell","split","bonus","dividend"])` and
    //   "BUY" is not "buy". The options below are the two the REST of this form is shaped for —
    //   quantity and price. split/bonus/dividend are in the endpoint's enum but need `ratio`
    //   instead of a price, so offering them here would render a form that cannot describe them.
    { name: "type", label: "Type", type: "choice", value: side.toLowerCase(), required: true, note: null,
      options: [{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }] },
    { name: "quantity", label: "Quantity", type: "number", value: qty?.[1] ?? null, required: true,
      note: qty ? "read from what you wrote — check it" : "not stated" },
    { name: "price", label: "Price", type: "number", value: price?.[1] ?? null, required: true,
      note: price ? "read from what you wrote — check it" : "not stated" },
    { name: "tradeDate", label: "Trade date", type: "date", value: dateIso, required: true, note: dateNote },
  ];
}


/**
 * An alert's own fields. ⚠ THE THRESHOLD IS THE READER'S NUMBER OR IT IS BLANK. "tell me if TCS rises
 * 5%" states 5; "alert me on TCS" states nothing, and choosing a level for someone is choosing when
 * they get woken up.
 */
export function alertFields(raw: string, stockId: string): ActionField[] {
  const pctM = /\b(?:rises?|falls?|drops?|gains?|up|down|by)\s*(?:by\s*)?(\d+(?:\.\d+)?)\s*%/i.exec(raw);
  const absM = /\b(?:above|below|crosses|hits|reaches|under|over)\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i.exec(raw);
  const down = /\b(fall|falls|drop|drops|below|under|down)\b/i.test(raw);
  return [
    { name: "stockId", label: "Company", type: "text", value: stockId, required: true, note: "resolved from our universe" },
    { name: "type", label: "Alert on", type: "text", value: pctM ? "price_pct" : absM ? "price" : null, required: true,
      note: pctM ? "a percentage move" : absM ? "a price level" : "pick what to watch" },
    { name: "operator", label: "Direction", type: "text", value: down ? "lt" : "gt", required: true,
      note: down ? "read as a fall" : "read as a rise" },
    { name: pctM ? "thresholdPercent" : "threshold", label: "Level", type: "number",
      value: pctM?.[1] ?? absM?.[1] ?? null, required: true,
      note: pctM || absM ? "read from what you wrote — check it" : "not stated" },
  ];
}

/** A reminder's lead time. Defaults to nothing rather than to a number nobody asked for. */
export function reminderFields(raw: string, stockId: string): ActionField[] {
  const d = /\b(\d+)\s*days?\s*(?:before|ahead|prior)/i.exec(raw);
  const ev = /\b(earnings|results|dividend|agm|board meeting|bonus|split|buyback|record date)\b/i.exec(raw);
  return [
    { name: "stockId", label: "Company", type: "text", value: stockId, required: true, note: "resolved from our universe" },
    { name: "eventType", label: "Event", type: "text", value: ev ? ev[1]!.toLowerCase().replace(/\s+/g, "_") : null,
      required: true, note: ev ? "read from what you wrote" : "pick the event to watch" },
    { name: "daysBefore", label: "Days before", type: "number", value: d?.[1] ?? null, required: true,
      note: d ? "read from what you wrote — check it" : "not stated" },
  ];
}


// ═══ THE READER-SCOPED ACTIONS ═════════════════════════════════════════════════════════════════════
/**
 * `memory_add` · `memory_forget` · `alert_delete` — the three that act on the reader's own rows.
 *
 * ★ `memory_forget` AND `alert_delete` RESOLVE THEIR TARGET AGAINST THE READER'S OWN LIST, IN CODE.
 *   The model says "forget the one about explanations"; code fetches that reader's memories, matches,
 *   and puts the resolved id in the path. A model that emitted an id could name a row belonging to
 *   someone else — it is never given the chance, and the endpoint is owner-scoped besides.
 *
 * ★ AMBIGUITY RENDERS ONE CONTROL PER CANDIDATE — the same shape as an ambiguous ticker. "Forget the
 *   one about explanations" matching two memories offers both; the reader picks and confirms in one
 *   gesture, and nothing is deleted on a guess.
 */
async function readerAction(
  action: "memory_add" | "memory_forget" | "alert_delete",
  ctx: ComposeContext,
  profile: ReaderProfile,
): Promise<ActionAnswer | null> {
  const userId = ctx.reader!.userId;

  if (action === "memory_add") {
    const text = memoryTextFrom(ctx.turn.raw);
    // ⚠ NOTHING EXTRACTABLE MEANS AN EMPTY FIELD, NOT A PARAPHRASE. What gets stored must be the
    //   reader's own words; a model summary of them is a different sentence with their name on it.
    const section = actionSection({
      action,
      subject: null,
      summary: "Keep this in mind for future answers.",
      body: {},
      fields: [{
        name: "text", label: "Remember", type: "text", value: text, required: true,
        note: text ? "taken from what you wrote — edit it if that is not quite right" : "type what you want us to remember",
      }],
    }) as AnySection;
    return say(
      `${profile.statedName ? profile.statedName + ", " : ""}I can keep that. Check the wording — nothing is stored until you confirm.`
        .replace(/^./, (m) => m.toUpperCase()),
      [section], "action.memory_add",
    );
  }

  if (action === "memory_forget") {
    const entries = await listMemories(userId).catch(() => []);
    if (entries.length === 0) {
      return say("There is nothing stored to forget.", [coverageSection(NO_COVERAGE) as AnySection], "action.memory_none");
    }
    const hits = matchMemories(ctx.turn.raw, entries);
    const chosen = hits.length ? hits : entries;
    const sections = chosen.slice(0, 6).map((m) =>
      actionSection({
        action, subject: null, targetId: m.id,
        summary: m.text,
        body: {},
      }) as AnySection,
    );
    return say(
      hits.length === 1 ? "This is the one I have. Tapping it forgets it — that cannot be undone."
      : hits.length > 1 ? "More than one matches. Pick the one you meant — tapping it forgets it."
      : "I could not tell which one you meant, so here is everything stored. Tapping one forgets it.",
      sections, "action.memory_forget",
    );
  }

  // ── alert_delete ────────────────────────────────────────────────────────────────────────────────
  const r = await resolveAlerts(userId);
  if (!r.ok || r.data.alerts.length === 0) {
    return say("You have no alerts set.", [coverageSection(r.coverage) as AnySection], "action.alert_none");
  }
  const stock = asStock(ctx.turn.subjects.find((s) => s.kind === "stock"));
  const matches = stock ? r.data.alerts.filter((a) => a.symbol === stock.symbol) : r.data.alerts;
  const sections = (matches.length ? matches : r.data.alerts).slice(0, 6).map((a) =>
    actionSection({
      action, targetId: a.id,
      subject: { symbol: a.symbol, name: a.name },
      summary: a.description,
      body: {},
      coverage: r.coverage,
    }) as AnySection,
  );
  return say(
    matches.length === 1 ? "This is the alert. Tapping it deletes it."
      : "Pick the alert you meant — tapping it deletes it.",
    sections, "action.alert_delete",
  );
}

/**
 * The reader's own words, with the request wrapper stripped.
 *
 * ⚠ IT REMOVES A PREFIX AND NOTHING ELSE. "remember that I like short answers" → "I like short
 * answers". It never rewrites, shortens or normalises: the stored sentence is the one the reader will
 * later be shown as their own, and a tidied version of it is a quote they never said.
 */
export function memoryTextFrom(raw: string): string | null {
  const t = raw.trim().replace(/[.!]+$/, "");
  const m = /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget|yaad rakho)\s+(?:that\s+)?(.+)$/i.exec(t)
    ?? /^(?:call me|my name is|mujhe)\s+(.+?)(?:\s+bulao)?$/i.exec(t);
  if (m?.[1]) return m[1].trim();
  return null;
}

/** Match a "forget the one about X" reference against the reader's stored entries. */
export function matchMemories(raw: string, entries: readonly { id: string; text: string }[]): { id: string; text: string }[] {
  const m = /(?:forget|drop|remove|stop remembering|bhool jao)\s+(?:the one about\s+|that\s+|about\s+)?(.+)$/i.exec(raw.trim());
  const needle = (m?.[1] ?? "").toLowerCase().replace(/[.!?]+$/, "").trim();
  if (needle.length < 3) return [];
  const words = needle.split(/\s+/).filter((w) => w.length > 3);
  return entries.filter((e) => {
    const hay = e.text.toLowerCase();
    return hay.includes(needle) || (words.length > 0 && words.every((w) => hay.includes(w)));
  });
}
