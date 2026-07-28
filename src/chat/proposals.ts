// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PENDING PROPOSAL — the thing that makes "yes" mean something exact.
//
// ── THE MODEL, IN FOUR STEPS ───────────────────────────────────────────────────────────────────────
//   1. A write tool validates and parses, and STOPS. It writes a Proposal here and returns it enumerated.
//   2. The model restates every value and asks. Closed-world by construction: it was handed the exact
//      list, so restating it is transcription, not recall.
//   3. The user confirms → `confirmPendingAction` runs the write FROM THIS RECORD.
//   4. Cleared on execute, on cancel, or by the server sweep at the end of any turn that did neither.
//
// ── ★ WHY EXECUTION READS FROM HERE AND NOT FROM THE MODEL ─────────────────────────────────────────
// The model proposes "40 shares at ₹1,750" and the user says "yes". If the confirm step took the values
// from the model again, a single token of drift between the two generations would file a trade the user
// never agreed to — and it would look perfectly correct in the transcript, because the transcript shows
// what the model SAID, not what was written. So `args` is captured once, at parse time, and the confirm
// tool takes NO arguments at all. There is nothing in the confirm call that COULD drift; correctness is
// structural rather than a discipline someone has to keep.
//
// ── ONE AT A TIME, ENFORCED BY THE STORAGE ─────────────────────────────────────────────────────────
// One nullable column per session. It cannot hold two proposals, so "yes" cannot be ambiguous — propose
// B while A is pending and A is simply gone. See the migration for the full argument.
//
// ── SINGLE-USE BY ATOMIC CONSUME ───────────────────────────────────────────────────────────────────
// `consumeProposal` is ONE statement: null the column and return what was there, conditional on it being
// non-null. Two concurrent confirms cannot both win — the loser reads zero rows. Same shape as the
// broker CSRF state consume. Consent is spent when it is taken, BEFORE the write runs: a write that
// fails is re-proposed, never silently re-armed.
//
// Every statement is owner-scoped by userId as well as sessionId. A session id alone can never reach
// another user's proposal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";

/** The write actions a proposal can carry. One per write tool. */
export type ProposalKind =
  | "addToWatchlist"
  | "removeFromWatchlist"
  | "createAlert"
  | "deleteAlert"
  | "setEventReminder"
  | "recordTransaction"
  | "rememberThis";

/**
 * ★ WHAT A WRITE CHANGED, as a SEMANTIC DOMAIN — the vocabulary the client is told about.
 *
 * Deliberately NOT React Query keys. The browser's cache-key shapes are a frontend concern; putting
 * `["me","alerts"]` on the wire would mean a frontend refactor could silently make the backend lie.
 * A stable domain noun survives that: the frontend owns the domain → key map and can change its keys
 * freely.
 *
 * ⚠ THIS EXISTS BECAUSE THE CLIENT HAS NO OTHER SIGNAL. Tool turns are stripped from the visible
 * transcript (serializeVisibleMessages keeps only kind === "text"), so the browser cannot see that
 * confirmPendingAction ran. Its only alternative would be reading the model's prose for "I've added…"
 * — the same unreliable inference the confirm step itself was designed to avoid.
 */
export type ChangeDomain = "watchlist" | "alerts" | "reminders" | "portfolio" | "profile";

/** Which domain each write touches. Total over ProposalKind — a new write tool cannot forget to
 *  declare its effect, because the map would fail to typecheck without it. */
export const CHANGE_DOMAIN_BY_KIND: Record<ProposalKind, ChangeDomain> = {
  addToWatchlist: "watchlist",
  removeFromWatchlist: "watchlist",
  createAlert: "alerts",
  deleteAlert: "alerts",
  setEventReminder: "reminders",
  recordTransaction: "portfolio",
  rememberThis: "profile",
};

/** One enumerated value: what it is, and exactly what it is. The model restates these. */
export interface ProposalField {
  label: string;
  value: string;
}

export interface PendingProposal {
  /** Identity — lets the end-of-turn sweep tell "the one that was already here" from "a new one". */
  id: string;
  kind: ProposalKind;
  /** ★ The owner at propose time. Re-asserted at execute; a mismatch is refused, never executed. */
  userId: string;
  createdAt: string;
  /** One line naming the action, for the top of the restatement. */
  summary: string;
  /** EVERY parsed value, labeled. This is the closed world the model restates from. */
  fields: ProposalField[];
  /** ★ THE EXECUTABLE PAYLOAD — handed verbatim to `service(args, userId)` on confirm. */
  args: Record<string, unknown>;
}

export interface NewProposal {
  kind: ProposalKind;
  summary: string;
  fields: ProposalField[];
  args: Record<string, unknown>;
}

/** Mint + store a proposal, replacing whatever was pending. Returns the stored record. */
export async function storeProposal(sessionId: string, userId: string, input: NewProposal): Promise<PendingProposal> {
  const proposal: PendingProposal = {
    id: randomUUID(),
    kind: input.kind,
    userId,
    createdAt: new Date().toISOString(),
    summary: input.summary,
    fields: input.fields,
    args: input.args,
  };
  // Owner-scoped write. updateMany (not update) so a foreign/unknown session id touches 0 rows rather
  // than throwing — the tool then reports honestly instead of 500ing the turn.
  const res = await prisma.chatSession.updateMany({
    where: { id: sessionId, userId },
    data: { pendingProposal: proposal as unknown as object },
  });
  if (res.count === 0) throw new Error("chat session not found for this reader");
  return proposal;
}

/** Read the pending proposal without consuming it. Owner-scoped. */
export async function peekProposal(sessionId: string, userId: string): Promise<PendingProposal | null> {
  const row = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { pendingProposal: true },
  });
  return (row?.pendingProposal as unknown as PendingProposal | null) ?? null;
}

/**
 * ATOMIC SINGLE-USE CONSUME: null the column and hand back what was in it, in one statement. Returns
 * null when nothing was pending. Two concurrent confirms → exactly one non-null return.
 *
 * Raw SQL because this is a read-and-clear that must not be two statements: a findFirst followed by an
 * update has a window in which both callers see the same proposal, which on `recordTransaction` means
 * writing the same trade twice.
 *
 * ⚠ WHY THE CTE, AND NOT A PLAIN `UPDATE … RETURNING pending_proposal`. That was the first version and it
 * silently never worked: Postgres `RETURNING` on an UPDATE yields the NEW row, so it handed back the NULL
 * it had just written — every confirm read "nothing pending" and no chat write ever executed. Selecting
 * the row into a CTE first captures the OLD value, and `RETURNING v.pending_proposal` reads from that
 * snapshot. Still ONE statement, so still atomic.
 *
 * `FOR UPDATE` in the CTE is what makes it single-use under concurrency: the second caller blocks on the
 * row lock, and when it unblocks READ COMMITTED re-evaluates the qual against the updated row — which now
 * fails `IS NOT NULL`, so its CTE is empty and it updates nothing. Exactly one caller can win.
 */
export async function consumeProposal(sessionId: string, userId: string): Promise<PendingProposal | null> {
  const rows = await prisma.$queryRawUnsafe<{ taken: unknown }[]>(
    `WITH victim AS (
       SELECT id, pending_proposal
         FROM chat_sessions
        WHERE id = $1 AND user_id = $2 AND pending_proposal IS NOT NULL
        FOR UPDATE
     )
     UPDATE chat_sessions c
        SET pending_proposal = NULL
       FROM victim v
      WHERE c.id = v.id
     RETURNING v.pending_proposal AS taken`,
    sessionId,
    userId,
  );
  const raw = rows[0]?.taken;
  return raw ? (raw as PendingProposal) : null;
}

/**
 * THE END-OF-TURN SWEEP. Clear the pending proposal ONLY IF it is still the one that was there when the
 * turn began — i.e. the turn neither confirmed it (consume already nulled it) nor replaced it with a new
 * one (different id).
 *
 * ★ THIS IS WHY A PROPOSAL CANNOT LINGER AND FIRE LATER. Consent is scoped to the very next message. Ask
 * "add HDFCBANK to my watchlist?", then ask something else instead — the proposal is gone before the
 * next message is read, so a later unrelated "yes, exactly" has nothing to attach to. The cost, accepted
 * deliberately: a mid-flow clarifying question also clears it, so the model must re-propose. Re-proposing
 * is cheap; an armed write waiting three messages for an ambiguous "yes" is not.
 *
 * Returns true when a stale proposal was actually cleared.
 */
export async function sweepProposal(sessionId: string, userId: string, idAtTurnStart: string | null): Promise<boolean> {
  if (!idAtTurnStart) return false;
  const n = await prisma.$executeRawUnsafe(
    `UPDATE chat_sessions
        SET pending_proposal = NULL
      WHERE id = $1 AND user_id = $2 AND pending_proposal->>'id' = $3`,
    sessionId,
    userId,
    idAtTurnStart,
  );
  return n > 0;
}

// ── RENDERING — the tool-result text the model reads ────────────────────────────────────────────────

/**
 * The PROPOSED result. It is written as an instruction to the model, because that is what a tool result
 * is: input, not output. Three jobs, in order of how badly they fail if omitted:
 *   · say plainly that NOTHING HAS BEEN WRITTEN (the "and then it said done" failure)
 *   · enumerate every value (so restating is closed-world, like the fact block)
 *   · name the two exits by tool name (so confirm/cancel are explicit acts, not inferred from prose)
 */
export function renderProposal(p: PendingProposal): string {
  const L: string[] = [
    "=== PROPOSED — NOTHING HAS BEEN WRITTEN YET ===",
    "This is a proposal awaiting the reader's confirmation. No change has been made to their data.",
    "",
    `Action: ${p.summary}`,
  ];
  for (const f of p.fields) L.push(`  ${f.label}: ${f.value}`);
  L.push(
    "",
    "WHAT TO DO NOW — in your reply, state EVERY value listed above back to the reader in your own words,",
    "then ask them to confirm. Do NOT say this is done, saved, added, or recorded — none of it has happened.",
    "Describe the action plainly and do not tell the reader whether it is a good idea.",
    "If they confirm, call confirmPendingAction (it takes no arguments — the exact values above are already",
    "held server-side and are what will be written). If they decline, or ask for something different, call",
    "cancelPendingAction.",
  );
  return L.join("\n");
}
