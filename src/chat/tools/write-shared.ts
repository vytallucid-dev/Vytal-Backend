// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WRITE-TOOL SHARED — the small pieces every `klass:"write"` tool needs, in one place.
//
// A write tool has a fixed shape and it is worth stating once:
//   resolve (symbol → the actual row)  →  parse THROUGH THE SERVICE'S OWN SCHEMA  →  propose  →  stop.
//
// ★ IT PARSES WITH THE SERVICE'S SCHEMA, NOT A COPY. `AddToWatchlistInput`, `CreateAlertInput`,
// `CreateReminderInput`, `Base`/`typeError` are all exported by the services and imported by the tools.
// A tool that re-declared "price must be positive" would be a second home for the rule and would drift
// the first time one side changed. The tool's ONLY extra job is turning conversational arguments (a
// ticker, an account name) into the ids the service takes — resolution, not validation.
//
// ⚠ ONE PLACE THE TOOL IS DELIBERATELY STRICTER THAN THE ROUTE: dates. The HTTP route's `tradeDate`
// accepts anything `Date.parse` swallows, which is right for a date-picker but wrong for a model reading
// prose — `Date.parse("2026")` succeeds and silently means 1 Jan. So `requireIsoDate` pins the tool's
// argument surface to YYYY-MM-DD. That NARROWS the tool's inputs; it does not duplicate the service's
// rule, which still runs on the way through.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { storeProposal, renderProposal, type NewProposal, type ProposalField } from "../proposals.js";
import { datesMentionedIn, howLongAgo, istToday } from "../date-resolve.js";
import { ServiceError } from "../../lib/service-error.js";
import type { ToolContext, ToolResult } from "./types.js";
import { notInUniverse } from "./boundary.js";

export type { ProposalField };

/** A covered stock, resolved from a ticker. */
export interface ResolvedStock {
  id: string;
  symbol: string;
  name: string;
}

/** Read a required string argument. Returns "" when absent/blank so callers can report it uniformly. */
export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Ticker → the covered stock row. Returns the shared universe-boundary message (as an ok:true result —
 * a coverage boundary is a real answer, not an error) when the symbol is outside Vytal's universe.
 */
export async function resolveStock(symbol: string): Promise<ResolvedStock | { boundary: ToolResult }> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return { boundary: { ok: false, error: "A ticker symbol is required (e.g. \"HDFCBANK\")." } };
  const stock = await prisma.stock.findUnique({ where: { symbol: sym }, select: { id: true, symbol: true, name: true } });
  if (!stock) return { boundary: { ok: true, content: notInUniverse(sym) } };
  return stock;
}

/** YYYY-MM-DD, and a real calendar date. See the header for why the tool is stricter than the route. */
export function requireIsoDate(v: unknown, label: string): string | { error: string } {
  const s = str(v);
  if (!s) return { error: `${label} is required, as an exact date in YYYY-MM-DD form.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return {
      error:
        `${label} must be an exact date in YYYY-MM-DD form (got "${s}"). Do not convert a vague phrase like ` +
        `"last week" or "a few months ago" into a date yourself — ask the reader for the exact date.`,
    };
  }
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { error: `${label} "${s}" is not a real calendar date.` };
  // A trade cannot have happened after today. Unlike a wrong-but-past date, this one IS decidable, so
  // it is refused rather than proposed — a future-dated buy would also sit at the wrong end of the FIFO
  // queue and reorder lots that already exist.
  if (s > istToday()) {
    return { error: `${label} "${s}" is in the future — a transaction cannot be recorded before it happens. Ask the reader for the date it actually occurred.` };
  }
  return s;
}

/**
 * How long ago a date is, in words — appended to the trade date in a proposal.
 *
 * The SECOND line of defence behind the attestation below: even for a date the reader genuinely named,
 * "2025-02-26" scans as plausible where "2025-02-26 — 17 months ago" does not. The model restates the
 * enumerated fields, so putting the age INTO the field puts it in front of the person who can catch it.
 * (Live: the model rendered it as "dating back about a year and a half".)
 */
export { howLongAgo };

/** The exact line resolveDate writes into its result. Parsing our OWN output back is what makes an
 *  earlier resolution re-checkable: the string was produced by the server, never by the model. */
const RESOLVED_LINE = /^Resolved date: (\d{4}-\d{2}-\d{2})/m;

/**
 * Did resolveDate produce this date EARLIER in this conversation? Reads the persisted tool results —
 * owner-scoped through the session relation, so another reader's transcript is unreachable.
 * Bounded to the most recent 40 tool turns; a session that long has other problems.
 */
async function serverResolvedInSession(sessionId: string, userId: string, date: string): Promise<boolean> {
  try {
    const rows = await prisma.chatMessage.findMany({
      where: { sessionId, session: { userId }, kind: "tool_result" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { toolPayload: true },
    });
    for (const r of rows) {
      const out = (r.toolPayload as any)?.response?.output;
      if (typeof out !== "string") continue;
      const m = out.match(RESOLVED_LINE);
      if (m && m[1] === date) return true;
    }
  } catch {
    // A history read failing must not turn into an accept. Fall through to the refusal.
  }
  return false;
}

/**
 * ★ THE TRADE-DATE ATTESTATION — did the READER name this date, or did the MODEL invent it?
 *
 * This is the root fix for the live finding. Asked to record a purchase made "last week", the real
 * model produced 2025-02-26, and on a rerun 2025-02-25 — seventeen months off, twice, differently. No
 * schema catches that, because an invented date is perfectly well-formed, and no description prevents
 * it, because the model is not disobeying: it does not know today's date and cannot do the arithmetic.
 *
 * So the date is checked against its PROVENANCE rather than its shape. Exactly two origins are trusted:
 *
 *   1. THE READER'S OWN MESSAGE. Their sentence is scanned server-side for date-shaped fragments and
 *      each is resolved through the same resolver. If the model's date is in that set, the reader named
 *      it — including via a relative word like "yesterday", which resolves server-side, so a model that
 *      gets "yesterday" WRONG still fails the check.
 *   2. A resolveDate CALL THIS TURN. The server computed it, so it is true by construction.
 *   3. A resolveDate CALL EARLIER IN THIS CONVERSATION, read back off the persisted tool results.
 *
 * Anything else is refused.
 *
 * ── ⚠ WHY (3) EXISTS — IT WAS ADDED AFTER A LIVE RUN, NOT BEFORE ───────────────────────────────────
 * Provenance started as this-turn-only, which is the tighter rule and looked obviously right. The live
 * conversation broke on it. The natural flow for a vague date spans three messages:
 *
 *     "…last week"  → refuse, ask which day
 *     "Tuesday"     → resolveDate resolves it        ← the server computes the date HERE
 *     "yes"         → the model finally calls recordTransaction   ← but the set is empty by now
 *
 * The model duly re-called resolveDate to recover — the error tells it to — but by then it had spent
 * its tool rounds and the turn died with an empty reply. So a rule that was "safe" produced a dead
 * conversation, which is its own kind of unsafe: a guard people cannot get past is a guard that gets
 * removed.
 *
 * Widening to the session does NOT weaken the property that matters. The set still contains only dates
 * the SERVER computed from the reader's own words, or that the reader typed outright. A model-invented
 * date is in neither, which is the entire point. What it admits is a narrow, benign case — a date
 * resolved earlier in the same conversation being reused for a later trade — and the proposal enumerates
 * that date with its age, in front of the person who can say no.
 *
 * ── THE ASYMMETRY IS DELIBERATE AND IT IS STATED IN THE ERROR ──────────────────────────────────────
 * This still refuses some dates that were fine — e.g. one the reader typed several messages ago that no
 * resolveDate call ever touched. That costs one extra resolveDate call, which the error explicitly tells
 * the model to make. A false ACCEPT writes a wrong date into the FIFO lot register, silently corrupting
 * every cost-basis and P&L number derived from it. One question against a corrupted ledger is not a
 * close call, so the guard leans toward refusing.
 */
export async function attestTradeDate(date: string, ctx: ToolContext): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ctx.resolvedDates.has(date)) return { ok: true };

  const said = datesMentionedIn(ctx.userMessage ?? "");
  if (said.has(date)) return { ok: true };

  if (await serverResolvedInSession(ctx.sessionId, ctx.userId, date)) return { ok: true };

  const namedInstead = [...said];
  const alt = namedInstead.length
    ? ` The reader's message does point at ${namedInstead.map((d) => `${d} (${howLongAgo(d)})`).join(" and ")} — if that is what they meant, use it.`
    : "";
  return {
    ok: false,
    error:
      `UNVERIFIED DATE: "${date}" (${howLongAgo(date)}) does not appear in what the reader just said, and it did ` +
      `not come from resolveDate. You do not reliably know today's date, so a date you worked out yourself is a ` +
      `guess — and a guessed trade date silently corrupts the reader's cost basis for good.${alt} ` +
      `Call resolveDate with the reader's OWN WORDS for the date ("last Tuesday", "20 July", "3 days ago") and ` +
      `use exactly what it returns; if they were vague, resolveDate will tell you what to ask them. ` +
      `Refusing here costs one extra question — accepting a wrong date costs a wrong ledger, so this errs ` +
      `toward asking.`,
  };
}

/** ₹ formatting for a proposal field — plain and exact, never abbreviated (this is a consent document). */
export const rupees = (n: number): string =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The ONE way a write tool ends successfully: store the proposal, return it enumerated. There is no
 * other exit — a write tool has no code path that executes, which is what makes "the handler never
 * writes" checkable by reading the file rather than by trusting a comment.
 */
export async function propose(ctx: ToolContext, input: NewProposal): Promise<ToolResult> {
  try {
    const stored = await storeProposal(ctx.sessionId, ctx.userId, input);
    return { ok: true, content: renderProposal(stored) };
  } catch (e) {
    return { ok: false, error: `Could not prepare that change for confirmation: ${(e as Error).message}` };
  }
}

/**
 * Turn a ServiceError (or anything else) into the model-facing sentence. `.message` is always human on a
 * ServiceError — that is the field the tool layer exists to consume, since a model cannot read a zod
 * fieldErrors map.
 */
export const serviceMessage = (e: unknown): string =>
  e instanceof ServiceError ? e.message : (e as Error)?.message ?? String(e);
