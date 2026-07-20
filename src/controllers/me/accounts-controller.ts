// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO ACCOUNTS — the authenticated user's own accounts (req.authUser). An account is
// the first-class unit of the portfolio; a user has ≥1 (default "My Holdings"). Manual
// accounts hold user-authored ledgers; linked accounts are broker-managed (Step 2+).
//
//   GET    /api/v1/me/accounts/brokers   the broker PICKER list (catalog + linkable flags)
//   GET    /api/v1/me/accounts           list the user's accounts (+ state, staleness, counts)
//   POST   /api/v1/me/accounts           create a manual account UNDER A BROKER (broker required)
//   PATCH  /api/v1/me/accounts/:id       rename and/or RETAG (retag: manual + unbound only)
//   POST   /api/v1/me/accounts/:id/link  bind a broker connection   (manual → linked_live)
//   POST   /api/v1/me/accounts/:id/unlink  sever the broker feed    (linked_live → linked_stale)
//   DELETE /api/v1/me/accounts/:id       delete (cascades its manual ledger) — guarded:
//                                         NOT still bound to a connection, NOT the user's last
//                                         account (must keep ≥1)
//
// THE BROKER-PARENT MODEL (Step 5.5): EVERY ACCOUNT BELONGS TO A BROKER, FROM CREATION.
// A user picks a broker from the catalog and creates manual accounts under it; a LINKED account
// is simply a manual account that got connected to that broker's real feed. So:
//   • `broker` is required at creation and NOT NULL — it is the account's identity, not a
//     side-effect of linking (before 5.5 it was null until link, and link OVERWROTE it).
//   • link CHECKS the broker (account.broker === connection.broker) instead of assigning it.
//   • CREATE-NOW-LINK-LATER: the catalog (17 brokers) is far wider than the linkable set
//     (zerodha). An Angel One account is created and hand-tracked today, and becomes connectable
//     the day its adapter ships — with NO data movement, because its identity was already right.
//   • A LINKED ACCOUNT IS BROKER-ONLY: it never holds hand-entered rows. Linking a non-empty
//     manual account warns, then REPLACES (see linkAccount).
//
// THE ACCOUNT STATE MACHINE (complete as of Step 4):
//
//        manual ──link──▶ linked_live ──deactivate / unlink──▶ linked_stale
//                              ▲                                    │
//                              └────── reconnect same demat ────────┘
//                                      (broker_account_ref match)
//
//   linked_stale = broker-bound, no longer receiving data. Its holdings are a FROZEN
//   last-known-good snapshot: still read, still scored (at OUR live price × the last-known
//   quantity), never dropped — and disclosed as stale everywhere they are shown. Manual entry
//   stays disabled: a severed account is still a broker's book.
//   clear-data leaves it stale AND empty (connection + holdings forgotten on request) — and
//   that shell is recoverable: re-linkable, and deletable.
//
// SECURITY: owner = req.authUser.userId, NEVER the payload — every query is owner-scoped, so
// a user only ever touches their OWN accounts (IDOR structurally impossible).
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { severConnection, BrokerLifecycleError } from "../../brokers/lifecycle.js";
import { isCatalogBroker, pickableBrokers, brokerDisplayName } from "../../brokers/catalog.js";
import { refreshPhsForUser } from "../../portfolio/phs/refresh.js";
import { transferManualPosition, transferAllManualPositions, rescueLinkedAccount, TransferError } from "../../portfolio/transfer.js";

const NameSchema = z.string().trim().min(1).max(60);

/** THE BROKER GATE (Step 5.5) — an account's broker must be a CATALOG member. Validated against
 *  the catalog, NOT against IMPLEMENTED_BROKERS: a user may create an Angel One account long
 *  before an Angel adapter exists (create-now-link-later). A broker outside the catalog has no
 *  home in the model at all — an unknown broker string is a hard 400, never silently coerced to a
 *  default. `other` (Stage 1, the not-at-a-broker account) is a catalog member a user picks
 *  deliberately; it is NOT the bucket an unrecognised broker falls into. */
const BrokerSchema = z.string().refine(isCatalogBroker, { message: "unknown broker" });

type AccountRow = Prisma.PortfolioAccountGetPayload<{
  include: {
    _count: { select: { transactions: true; holdings: true } };
    brokerConnection: { select: { enabled: true; lastSyncedAt: true; sessionState: true; brokerAccountRef: true } };
  };
}>;

/** STALENESS IS DERIVED AT READ, NEVER STORED (Step 4). `ageDays` grows every day the account
 *  stays severed, so a persisted copy would begin lying the moment it was written. */
function staleness(a: AccountRow, now: Date) {
  if (a.state === "manual") return null; // a manual book is our own ledger — it is never "stale"
  const conn = a.brokerConnection;
  const lastSyncedAt = conn?.lastSyncedAt ?? null;
  return {
    // The SEVER flag — NOT a token flag. A dead token is routine (§2.5): the account stays
    // linked_live and this stays false. Data age is disclosed separately, for live and stale alike.
    isStale: a.state === "linked_stale",
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    ageDays: lastSyncedAt ? Math.max(0, Math.floor((now.getTime() - lastSyncedAt.getTime()) / 86_400_000)) : null,
    /** null ⇔ the connection is gone (clear-data): the account is stale AND empty. */
    sessionState: conn?.sessionState ?? null,
    brokerAccountRef: conn?.brokerAccountRef ?? null, // WHICH demat — non-secret, disambiguates two
  };
}

function serialize(a: AccountRow, now: Date = new Date()) {
  return {
    id: a.id,
    name: a.name,
    broker: a.broker, // null = pure-manual account
    brokerConnectionId: a.brokerConnectionId, // null until linked; null again after clear-data
    state: a.state, // manual | linked_live | linked_stale
    manualEntryAllowed: a.state === "manual", // a severed account is STILL broker-managed (§2.3)
    // LOUD DISCLOSURE (Step 4): never show a frozen book as though it were fresh.
    staleness: staleness(a, now),
    transactionCount: a._count.transactions,
    holdingCount: a._count.holdings,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

const withCounts = {
  _count: { select: { transactions: true, holdings: true } },
  brokerConnection: { select: { enabled: true, lastSyncedAt: true, sessionState: true, brokerAccountRef: true } },
} as const;

// ── GET /accounts ────────────────────────────────────────────
export const listAccounts = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const rows = await prisma.portfolioAccount.findMany({
    where: { userId },
    include: withCounts,
    orderBy: { createdAt: "asc" },
  });
  // ONE `now` for the whole list — so two accounts synced at the same instant can never report
  // different ages just because the clock ticked between them. (And never `rows.map(serialize)`:
  // .map would pass the array index as the second argument, silently becoming the timestamp.)
  const now = new Date();
  return res.json({ success: true, data: rows.map((a) => serialize(a, now)) });
};

// ── GET /accounts/brokers ────────────────────────────────────
// The account-creation PICKER list. Read from the catalog, NOT from the adapter registry:
// `getAdapter()` throws for every broker that has no adapter yet, so a picker built on adapters
// could only ever offer Zerodha. Each entry carries `linkable` — the honest disclosure that an
// Angel One account can be created and hand-tracked today, but not connected until its adapter
// ships. `mock` is excluded (API-creatable for harnesses, never shown).
export const listBrokerCatalog = async (_req: Request, res: Response) => {
  return res.json({ success: true, data: pickableBrokers() });
};

// ── POST /accounts ───────────────────────────────────────────
// EVERY ACCOUNT BELONGS TO A BROKER, FROM CREATION (Step 5.5). `broker` is required — it is the
// account's identity, not a consequence of linking. A manual account is "my Zerodha book, kept by
// hand"; linking is the act of connecting that book to the real feed, and it CHECKS this broker
// rather than assigning one (see linkAccount).
const CreateBody = z.object({ name: NameSchema, broker: BrokerSchema });
export const createAccount = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  const dup = await prisma.portfolioAccount.findFirst({ where: { userId, name: parsed.data.name }, select: { id: true } });
  if (dup) return res.status(409).json({ success: false, error: "duplicate_name", message: `an account named "${parsed.data.name}" already exists` });

  // Born MANUAL and broker-tagged: it is a hand-kept book belonging to a named broker. No
  // connection yet (that is `link`), and none is required — a catalog-only broker never gets one.
  const created = await prisma.portfolioAccount.create({
    data: { userId, name: parsed.data.name, broker: parsed.data.broker, state: "manual" },
    include: withCounts,
  });
  return res.status(201).json({ success: true, data: serialize(created) });
};

// ── PATCH /accounts/:id (rename + RETAG) ─────────────────────
// Rename is unconditional. RETAG (changing the broker) is NOT:
//
//   permitted  ⇔  state = manual  AND  no binding
//
// A bound account's broker is a FACT about its connection, not a preference — the mirror is
// keyed to that demat. Retagging one would leave an account labelled "Upstox" holding Zerodha's
// snapshot, and the next link/reconnect would compare a broker against a book that lies about
// which broker it is. So it is refused, not silently ignored.
//
// The retag exists because broker-at-creation would otherwise be a one-way door: a user who
// picked the wrong broker (or whose account was backfilled) could never move it to the broker
// they can actually link. Manual + unbound = nothing downstream depends on the label yet.
const PatchBody = z
  .object({ name: NameSchema.optional(), broker: BrokerSchema.optional() })
  .refine((b) => b.name !== undefined || b.broker !== undefined, { message: "nothing to update — provide name and/or broker" });
export const patchAccount = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id);
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  const existing = await prisma.portfolioAccount.findFirst({
    where: { id, userId }, // owner-scoped → another user's account is a 404, same as a missing one
    select: { id: true, state: true, broker: true, brokerConnectionId: true },
  });
  if (!existing) return res.status(404).json({ success: false, error: "not_found", message: "Account not found" });

  // THE RETAG GUARD. Note it fires only on an ACTUAL change: re-sending the same broker is a
  // no-op, not a violation — a client PATCHing {name, broker} to rename a linked account must
  // not be refused for faithfully echoing the broker it already has.
  const retagging = parsed.data.broker !== undefined && parsed.data.broker !== existing.broker;
  if (retagging && (existing.state !== "manual" || existing.brokerConnectionId !== null)) {
    return res.status(409).json({
      success: false,
      error: "account_linked",
      message: `this account is bound to ${brokerDisplayName(existing.broker)} — a linked account's broker is a fact about its connection, not a label; unlink and clear it first`,
    });
  }

  if (parsed.data.name !== undefined) {
    const dup = await prisma.portfolioAccount.findFirst({ where: { userId, name: parsed.data.name, NOT: { id } }, select: { id: true } });
    if (dup) return res.status(409).json({ success: false, error: "duplicate_name", message: `an account named "${parsed.data.name}" already exists` });
  }

  const updated = await prisma.portfolioAccount.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(retagging ? { broker: parsed.data.broker } : {}),
    },
    include: withCounts,
  });
  return res.json({ success: true, data: serialize(updated) });
};

// ── POST /accounts/:id/link ──────────────────────────────────
// The manual → linked_live transition (§2.3). The user CHOOSES which account a broker
// connection feeds — we NEVER silent-pick one. After this, the account is broker-managed:
// manual entry is refused (structurally, in the write path) and sync overwrites its snapshot.
//
// Preconditions, ALL enforced server-side (a client cannot talk its way past any of them):
//   • the account is OWNED by the token's user      → else 404 (no existence disclosure)
//   • the account has NO binding yet                → else 409 (§2.3; see the re-link note)
//   • the connection is OWNED by the token's user   → else 404 (IDOR: another user's
//     connection is indistinguishable from a nonexistent one)
//   • the connection is not already bound elsewhere → else 409 (§2.3 one account per
//     connection). Checked BEFORE the write so the caller gets a clean 409 rather than a
//     raw unique-constraint error; the partial unique index is the race backstop.
//
// RE-LINK (Step 4) — this endpoint admits `linked_stale`, but ONLY with a null binding:
//   • stale WITH a binding (deactivate/unlink): its connection row is intact and still owns its
//     frozen holdings. Recovery is a RECONNECT, not a re-link — re-authenticating the same demat
//     upserts the SAME connection row (the key IS broker_account_ref) and lifecycle flips the
//     account back to linked_live. Routing that through here would let a DIFFERENT connection be
//     bolted onto a book full of another demat's frozen holdings. So: refused (409).
//   • stale with a NULL binding (post clear-data): the connection and its holdings are gone; the
//     account is an empty shell. There is no frozen snapshot to protect and no ref left to match
//     against, so binding a fresh connection is safe — and is the ONLY way out of the state.
// The guard is therefore on the BINDING, not on the state name: `brokerConnectionId === null`.
// ── RULING 4 (Step 5.5): LINK *CHECKS* THE BROKER, IT NO LONGER ASSIGNS IT ──────────────────
//   • the account has carried a broker since CREATION, so linking must agree with it:
//     account.broker === connection.broker, else 409. You cannot bolt an Upstox connection onto
//     a book that says Zerodha. (Before 5.5 this endpoint OVERWROTE account.broker from the
//     connection — which meant the account's identity was whatever the last link said it was.)
//
// ── RULING 5 (Step 5.5): A LINKED ACCOUNT IS BROKER-ONLY — warn, then REPLACE ────────────────
// Until now, linking a NON-EMPTY manual account was silently accepted and its manual ledger
// SURVIVED inside the now-broker-managed book. The union then read both, and the same stock
// double-counted: a hand-entered RELIANCE 100 alongside the broker's RELIANCE 10 read as 110
// shares in an account the broker says holds 10 — and PHS scored the inflated exposure.
//
// The mirror cannot be faithful and also contain hand-written rows. So on linking a non-empty
// manual account we REPLACE: the manual ledger is DELETED and the broker's snapshot becomes the
// account's whole truth. That is destructive, so it requires explicit consent (confirm:true) —
// the same pattern as clear-data and account-delete. Never a half-state, never a silent merge.
const LinkBody = z.object({ connectionId: z.string().min(1), confirm: z.boolean().optional() });
export const linkAccount = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId; // ALWAYS the token — never the payload
  const id = String(req.params.id);
  const parsed = LinkBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  const account = await prisma.portfolioAccount.findFirst({
    where: { id, userId },
    select: { id: true, name: true, state: true, broker: true, brokerConnectionId: true, _count: { select: { transactions: true, holdings: true } } },
  });
  if (!account) return res.status(404).json({ success: false, error: "not_found", message: "Account not found" });

  // `other` is the NOT-AT-A-BROKER account — permanently unlinkable (Stage 1). There is no broker
  // behind it to connect to (the user told us: the answer is nowhere), so no connection can ever
  // match it. Rejected here with its OWN renderable reason, ahead of the broker-mismatch 409 below
  // — that one names a real broker and reads as a fixable typo; this is a permanent fact, not a
  // mistake. Same error shape as broker_mismatch ({ success, error, message }) so the frontend
  // renders it through the one path.
  if (account.broker === "other") {
    return res.status(409).json({
      success: false,
      error: "broker_not_linkable",
      message: `"${account.name}" isn't held at a broker, so it can't be connected to a broker feed. Retag it to a broker first (while it's unlinked) if you want to link it.`,
    });
  }
  if (account.brokerConnectionId !== null) {
    return res.status(409).json({
      success: false,
      error: "already_linked",
      message:
        account.state === "linked_stale"
          ? "this account is still bound to a broker connection — reconnect that broker to bring it back live, or clear its data first"
          : "this account is already linked to a broker; unlink it first",
    });
  }

  // Owner-scoped → another user's connection is a 404, identical to a nonexistent one.
  const conn = await prisma.brokerConnection.findFirst({
    where: { id: parsed.data.connectionId, userId },
    select: { id: true, broker: true },
  });
  if (!conn) return res.status(404).json({ success: false, error: "connection_not_found", message: "Broker connection not found" });

  // RULING 4 — the account's broker is its identity; the connection must match it.
  if (account.broker !== conn.broker) {
    return res.status(409).json({
      success: false,
      error: "broker_mismatch",
      message: `this account is a ${brokerDisplayName(account.broker)} book — it cannot be linked to a ${brokerDisplayName(conn.broker)} connection. Retag the account first (it must be unlinked), or link a ${brokerDisplayName(account.broker)} connection.`,
    });
  }

  const bound = await prisma.portfolioAccount.findFirst({ where: { brokerConnectionId: conn.id }, select: { id: true, name: true } });
  if (bound) {
    return res.status(409).json({
      success: false,
      error: "connection_already_linked",
      message: `this broker connection already feeds the account "${bound.name}" — one connection backs exactly one account`,
    });
  }

  // RULING 5 — the warn half. A non-empty manual book cannot survive the link, so say so and
  // stop, unless the user has already said yes.
  const txnCount = account._count.transactions;
  const holdCount = account._count.holdings;
  const nonEmpty = txnCount > 0 || holdCount > 0;
  if (nonEmpty && parsed.data.confirm !== true) {
    return res.status(400).json({
      success: false,
      error: "confirmation_required",
      message: `linking replaces this account's manual holdings with ${brokerDisplayName(conn.broker)}'s data — ${txnCount} transaction${txnCount === 1 ? "" : "s"} and ${holdCount} holding${holdCount === 1 ? "" : "s"} will be permanently deleted. Pass confirm:true to proceed.`,
      willDelete: { transactions: txnCount, holdings: holdCount },
    });
  }

  // RULING 5 — the replace half. ONE transaction: the ledger is gone and the account is
  // broker-managed together, or neither happened. holdings.deleteMany cascades holding_lots
  // (FK ON DELETE CASCADE), so the FIFO register goes with it — a clean deletion, no orphans,
  // no zombie 0-qty rows. `broker` is NOT written: it already equals conn.broker (checked above).
  const updated = await prisma.$transaction(async (tx) => {
    if (nonEmpty) {
      await tx.transaction.deleteMany({ where: { accountId: account.id } });
      await tx.holding.deleteMany({ where: { accountId: account.id } }); // → cascades holding_lots
    }
    return tx.portfolioAccount.update({
      where: { id: account.id },
      data: { brokerConnectionId: conn.id, state: "linked_live" },
      include: withCounts,
    });
  });

  // The book changed → refresh the PHS snapshot (best-effort; the write already committed, so a
  // PHS failure never fails the request). Same discipline as the transaction write path.
  if (nonEmpty) await refreshPhsForUser(userId);

  return res.json({ success: true, data: serialize(updated), replaced: nonEmpty ? { transactions: txnCount, holdings: holdCount } : null });
};

// ── POST /accounts/:id/unlink ────────────────────────────────
// THE SEVER (Step 4), account-addressed — the user thinks in accounts ("disconnect my broker
// from this book"), not in connection ids. It performs exactly the same transition as the
// connection-addressed `deactivate`, through exactly the same core (lifecycle.severConnection),
// so the two doors into linked_stale cannot drift apart.
//
// WHAT IT DOES NOT DO — the whole point of the step:
//   • it does NOT delete broker_holdings. They are FROZEN — kept, still read, still carrying
//     their PHS weight (the user still owns those shares; only the quantity's freshness is now
//     uncertain, and that is disclosed). §2.3 no-drop.
//   • it does NOT null broker_connection_id. That pointer is how the union reaches the frozen
//     rows' account; nulling it would orphan them. The binding is the anchor (see lifecycle).
//   • it does NOT re-open manual entry. A severed account is still a broker's book — writing
//     hand-entered trades into it would corrupt the mirror the moment it is reconnected (§2.3).
// Recovery: reconnect the same demat → linked_live, sync resumes, same account.
export const unlinkAccount = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId; // ALWAYS the token — never the payload/param
  const id = String(req.params.id);

  const account = await prisma.portfolioAccount.findFirst({
    where: { id, userId }, // owner-scoped → another user's account is a 404, same as a missing one
    select: { id: true, state: true, brokerConnectionId: true },
  });
  if (!account) return res.status(404).json({ success: false, error: "not_found", message: "Account not found" });
  if (account.state === "manual" || !account.brokerConnectionId) {
    return res.status(409).json({
      success: false,
      error: "not_linked",
      message: "this account is not linked to a broker connection",
    });
  }

  try {
    // userId is passed through to the lifecycle, which re-scopes the connection lookup to it —
    // so even a mis-bound connection id cannot be severed across users.
    await severConnection(userId, account.brokerConnectionId);
  } catch (e) {
    if (e instanceof BrokerLifecycleError) {
      return res.status(e.httpStatus).json({ success: false, error: e.code, message: e.message });
    }
    throw e;
  }

  const updated = await prisma.portfolioAccount.findUniqueOrThrow({ where: { id: account.id }, include: withCounts });
  return res.json({ success: true, data: serialize(updated) });
};

// ── POST /accounts/:id/transfer ──────────────────────────────
// MOVE A POSITION BETWEEN ACCOUNTS. THE SOURCE DECIDES THE RULE (Step 6):
//
//   MANUAL source  → `symbol` REQUIRED. That one instrument's FULL position (every lot) moves to
//                    any MANUAL destination, under ANY broker — a manual ledger is the user's,
//                    not a broker's, so a Zerodha book's position may land in an Upstox book.
//   LINKED source  → `symbol` FORBIDDEN, `confirm` REQUIRED. The WHOLE account is rescued into a
//                    SAME-BROKER manual account and then deleted (this IS rescue-on-delete).
//                    A symbol here would be a cherry-pick: the account is destroyed, so anything
//                    left behind would be silently lost. Refused rather than half-honoured.
//
// FULL POSITION ONLY. There is no `quantity`/`lotId` — a partial transfer would split a FIFO lot
// queue in two, and neither half would replay to the economics the user's broker shows. An
// attempt to send one is refused BY NAME (not ignored), so a client cannot believe it worked.
const TransferBody = z.object({
  toAccountId: z.string().min(1),
  symbol: z.string().trim().min(1).optional(),
  confirm: z.boolean().optional(),
  // Declared ONLY so they can be explicitly rejected below — see the full-position rule.
  quantity: z.unknown().optional(),
  lotId: z.unknown().optional(),
});
export const transferHolding = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId; // ALWAYS the token — both accounts are scoped to it
  const id = String(req.params.id);
  const parsed = TransferBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  const { toAccountId, symbol, confirm } = parsed.data;

  if (parsed.data.quantity !== undefined || parsed.data.lotId !== undefined) {
    return res.status(400).json({
      success: false,
      error: "partial_transfer_unsupported",
      message: "a holding moves in full — every lot together. Splitting a FIFO lot queue would leave neither account replaying to the position the broker shows.",
    });
  }

  // Which rule applies is a property of the SOURCE, so read it first. (Owner-scoped: a foreign
  // account is a 404 here exactly as it is inside the transfer core — no existence disclosure.)
  const source = await prisma.portfolioAccount.findFirst({ where: { id, userId }, select: { state: true } });
  if (!source) return res.status(404).json({ success: false, error: "source_not_found", message: "source account not found" });

  try {
    let result;
    if (source.state === "manual") {
      if (!symbol) {
        return res.status(400).json({ success: false, error: "symbol_required", message: "name the holding to transfer (symbol)" });
      }
      result = await transferManualPosition(userId, id, toAccountId, symbol);
    } else {
      // A broker account leaves as a WHOLE BOOK or not at all.
      if (symbol) {
        return res.status(400).json({
          success: false,
          error: "no_cherry_pick",
          message: "a single holding cannot be taken out of a broker account — transferring it moves the ENTIRE account (and removes it). Omit `symbol` to do that.",
        });
      }
      result = await rescueLinkedAccount(userId, id, toAccountId, confirm === true);
    }
    return res.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof TransferError) {
      return res.status(e.httpStatus).json({ success: false, error: e.code, message: e.message, ...(e.details ?? {}) });
    }
    console.error("[POST /me/accounts/:id/transfer]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to transfer the holding" });
  }
};

// ── POST /accounts/:id/transfer-all ──────────────────────────
// MOVE THE WHOLE ACCOUNT (Stage 2). Every position in the MANUAL source (`:id`) moves to a MANUAL
// destination in ONE transaction — all-or-nothing. This is what lets the frontend say "move
// everything" WITHOUT looping the single-position endpoint per holding: a loop is non-atomic, and a
// failure partway leaves a half-moved, corrupted book that no UI can repair.
//
//   • BOTH accounts must be manual → a linked source or destination is a 409 (from the core).
//   • THE BROKER TAG IS IRRELEVANT — a Zerodha manual book may move to a Groww manual book. The
//     same-broker rule lives ONLY on the rescue path (POST /transfer with a linked source).
//   • `deleteSource` decides the emptied source's fate: true → removed (empty by then, nothing
//     stranded); false → kept as an empty account.
// Broker → manual keeps its OWN, separate door (rescueLinkedAccount via POST /transfer / DELETE with
// rescueToAccountId) — not merged here; they are different truths.
const TransferAllBody = z.object({
  toAccountId: z.string().min(1),
  deleteSource: z.boolean(),
});
export const transferAllHoldings = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId; // ALWAYS the token — both accounts are scoped to it
  const id = String(req.params.id);
  const parsed = TransferAllBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  try {
    const result = await transferAllManualPositions(userId, id, parsed.data.toAccountId, parsed.data.deleteSource);
    return res.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof TransferError) {
      return res.status(e.httpStatus).json({ success: false, error: e.code, message: e.message, ...(e.details ?? {}) });
    }
    console.error("[POST /me/accounts/:id/transfer-all]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to transfer the account" });
  }
};

// ── DELETE /accounts/:id ─────────────────────────────────────
// Cascades the account's manual transactions + holdings (FK ON DELETE CASCADE). Guarded:
// a user can't delete their LAST account (must keep ≥1), and a NON-EMPTY manual account requires
// explicit confirmation (matches brokers-controller.ts's clear-endpoint {confirm:true} pattern —
// no silent wipe).
//
// WHICH ACCOUNTS ARE DELETABLE (Step 4) — an explicit ALLOW-list, deliberately not a deny-list:
//   • manual                              — a user's own book, always theirs to remove
//   • linked_stale WITH NO BINDING         — the empty shell left by clear-data
// Everything else is refused, and not merely on principle:
//   • a still-BOUND account (linked_live, or stale-but-still-anchored) still has a connection
//     holding broker_holdings. The union reaches those rows via connection → accounts[0], so
//     deleting the account would strand them: permanently unreachable, a silent data drop
//     dressed up as a delete. Sever + clear the connection first; then the shell can go.
//   • anything ELSE (e.g. linked_live with a null binding) is a state the machine cannot
//     produce. Refusing beats silently deleting whatever it turns out to be — an allow-list
//     fails closed on a corrupt row, where a deny-list would wave it straight through.
// RESCUE-ON-DELETE (Step 6) — the SECOND door into the rescue core. Deleting a still-bound
// broker account is the natural way a user says "I'm done with this broker", and until now it was
// simply refused (409), because deleting it would have destroyed its positions. Now it can carry
// `rescueToAccountId`: the account's broker holdings are converted to manual holdings on that
// account FIRST (same-broker, per rule 2), and only then is the account removed.
//
// It routes through the SAME core as POST /accounts/:id/transfer (rescueLinkedAccount) — one
// implementation, two doors, exactly as `severConnection` backs both deactivate and unlink. The
// two can therefore never drift into disagreeing about what a rescue is.
//
// WITHOUT `rescueToAccountId` a bound account is still refused — but the message now names the
// way out, instead of leaving the user to discover that clear-data would have eaten their book.
const DeleteBody = z.object({ confirm: z.boolean().optional(), rescueToAccountId: z.string().min(1).optional() });
export const deleteAccount = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id);
  const parsed = DeleteBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  const account = await prisma.portfolioAccount.findFirst({
    where: { id, userId },
    select: { id: true, state: true, brokerConnectionId: true, _count: { select: { transactions: true } } },
  });
  if (!account) return res.status(404).json({ success: false, error: "not_found", message: "Account not found" });

  // THE RESCUE DOOR: a bound broker account + a destination ⇒ preserve the positions, then delete.
  if (account.brokerConnectionId !== null && parsed.data.rescueToAccountId) {
    try {
      const result = await rescueLinkedAccount(userId, id, parsed.data.rescueToAccountId, parsed.data.confirm === true);
      return res.json({ success: true, data: { deleted: true, id, rescue: result } });
    } catch (e) {
      if (e instanceof TransferError) {
        return res.status(e.httpStatus).json({ success: false, error: e.code, message: e.message, ...(e.details ?? {}) });
      }
      console.error("[DELETE /me/accounts/:id rescue]", e);
      return res.status(500).json({ success: false, error: "server_error", message: "Failed to rescue the account's holdings" });
    }
  }

  const deletable =
    account.state === "manual" ||
    (account.state === "linked_stale" && account.brokerConnectionId === null);
  if (!deletable) {
    return res.status(409).json({
      success: false,
      error: "account_linked",
      message:
        "this account is still bound to a broker connection — deleting it would destroy its holdings. Pass rescueToAccountId (a manual account with the SAME broker) to convert them to manual holdings first, or unlink and clear the connection to discard them deliberately.",
    });
  }

  const total = await prisma.portfolioAccount.count({ where: { userId } });
  if (total <= 1) {
    return res.status(409).json({ success: false, error: "last_account", message: "you must keep at least one account" });
  }

  const txnCount = account._count.transactions;
  if (txnCount > 0 && parsed.data.confirm !== true) {
    return res.status(400).json({
      success: false,
      error: "confirmation_required",
      message: `this removes ${txnCount} transaction${txnCount === 1 ? "" : "s"} permanently, pass confirm:true`,
    });
  }

  // Delete → cascades this account's transactions + holdings (+ their lots). PHS is a
  // per-user snapshot; refreshing it is a Step-3 read concern (union), not touched here.
  await prisma.portfolioAccount.delete({ where: { id } });
  return res.json({ success: true, data: { deleted: true, id } });
};
