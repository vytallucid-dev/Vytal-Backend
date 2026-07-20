// ═══════════════════════════════════════════════════════════════════════
// BROKER LIFECYCLE — the broker-AGNOSTIC state machine. This is the "written once"
// core: it drives integrate → active → sync → deactivate → clear for EVERY broker and
// resolves the concrete adapter only via getAdapter(broker), then touches nothing but
// the BrokerAdapter interface. It never branches on which broker it is (grep-proof: no
// broker id, no `new *Adapter`, no broker-specific field appears below).
//
// STATE MODEL on broker_connections (two ORTHOGONAL axes — conflating them is the §2.5 trap):
//   enabled        true = ACTIVE (syncs)  ·  false = SEVERED (frozen, retains data)
//   session_state  live / dead            (token validity — INDEPENDENT of enabled)
//
// §2.5 — A DEAD TOKEN IS NOT A SEVER. Broker tokens die DAILY; that is the ordinary "Sync now →
// reconnect" case. It sets session_state='dead' on the CONNECTION and nothing else: the binding
// holds, the account stays linked_live, the data stays fresh-but-unrefreshable. Only an explicit
// sever (deactivate / unlink / clear) stops the feed. Never route token expiry into a sever.
//
// The bound ACCOUNT's state is a PROJECTION of `enabled`, written in the same transaction:
//   enabled=true ⇔ linked_live   ·   enabled=false ⇔ linked_stale   (see severBinding/resumeBinding)
//
// TRANSITIONS
//   integrate   none/any → ACTIVE   (accept+version disclaimer, adapter.authenticate,
//                                     encrypt session; upsert so reconnect re-establishes —
//                                     and reconnecting a SEVERED demat RE-LINKS it: stale → live)
//   sync        ACTIVE → ACTIVE     (adapter.fetchHoldings → normalize → OVERWRITE snapshot)
//   deactivate  ACTIVE → SEVERED    (stop syncing; RETAIN holdings + session; account → stale.
//                                     Frozen holdings KEEP their PHS weight — see union.ts)
//   activate    SEVERED → ACTIVE    (resume; does NOT re-auth — a dead session stays dead)
//   clear       SEVERED → gone      (STRUCTURAL: only when severed + confirmed; DELETE the
//                                     row → cascade wipes holdings → forgets the token. The
//                                     bound account survives as linked_stale + empty, and is
//                                     RECOVERABLE — re-linkable and deletable, not a zombie)
//
// LAWS honoured here: read-only (adapter has no write seam); snapshot-mirror (holdings
// stored verbatim, overwrite-not-append, never synthesised into transactions); token
// encrypted at rest; userId is always a caller argument (the controller passes
// req.authUser.userId), never request-body data → IDOR-proof.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import {
  BrokerSessionError,
  isInteractive,
  type BrokerAdapter,
  type BrokerId,
  type BrokerMeta,
  type BrokerSession,
} from "./types.js";
import { getAdapter, implementedBrokerMeta, isBrokerId, IMPLEMENTED_BROKERS } from "./registry.js";
import { decryptJson, encryptJson } from "./crypto.js";
import { consumeState, issueState, StateVerificationError } from "./security/state-store.js";
import { resolveHoldingsToUniverse } from "./universe-admit.js";
import { enqueueHistoryBackfillIfNeeded } from "../portfolio/history/enqueue-backfill.js";

// ── Typed lifecycle errors (the controller maps code/httpStatus straight to a response) ──
export type BrokerErrorCode =
  | "unsupported_broker"
  | "disclaimer_required"
  | "not_found"
  | "invalid_state"
  | "confirmation_required"
  | "session_dead"
  | "not_interactive" // one-shot vs OAuth mismatch (wrong entry point for this broker)
  | "state_invalid" // CSRF state missing/mismatched/expired/replayed
  | "exchange_failed" // the broker rejected our token exchange (bad/expired authorization code)
  | "account_ref_missing" // the broker gave no per-account id → the connection can't be keyed (fail-loud, never a null ref)
  | "account_not_linked" // the connection is integrated-but-unlinked → nowhere honest to land its holdings (Step 2b)
  | "wrong_demat"; // a RECONNECT authenticated a DIFFERENT demat than the one being reconnected → refuse BEFORE any write
// NOTE: `ambiguous_connection` (2a) is RETIRED — the lifecycle is connection-id addressed, so a
// lookup can no longer return >1. The ambiguity is structurally impossible, not merely guarded.

export class BrokerLifecycleError extends Error {
  readonly code: BrokerErrorCode;
  readonly httpStatus: number;
  constructor(code: BrokerErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "BrokerLifecycleError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ── Public view types (NEVER expose the encrypted session blob) ──────────────────────
export interface BrokerConnectionView {
  /** The connection's id — THE address for every lifecycle op (sync/activate/deactivate/
   *  clear) and for linking it to an account. Without this, a client that lists connections
   *  could not then act on one. Non-secret. */
  id: string;
  broker: BrokerId;
  /** The BROKER's own account id (Kite client code). Non-secret, and the ONLY way a user with
   *  two demats at one broker can tell the two connections apart. */
  brokerAccountRef: string;
  /** The portfolio account this connection is bound to (§2.3: at most one), or null while it
   *  is integrated-but-unlinked. A connection cannot sync until it is bound. */
  linkedAccountId: string | null;
  displayName: string;
  logoRef: string;
  enabled: boolean;
  state: "active" | "inactive"; // derived from `enabled`
  sessionState: "live" | "dead";
  sessionExpiresAt: string | null;
  lastSyncedAt: string | null;
  disclaimerVersion: string;
  disclaimerAcceptedAt: string;
  holdingsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncOutcome {
  broker: BrokerId;
  connectionId: string;
  /** The account this snapshot feeds. DERIVED from the connection's §2.3 binding — broker_holdings
   *  is connection-scoped, so there is no denormalised account_id that could drift out of sync. */
  accountId: string;
  synced: number; // rows written to the snapshot
  mapped: number; // resolved to a universe stock_id
  /** Symbols we could NOT identify — the broker sent no ISIN, so no stock could be created for
   *  them (a fabricated ISIN would poison the dedup spine). Stored verbatim with stock_id NULL:
   *  held, displayed, NOT scored. Named here, never silently dropped.
   *
   *  STEP 13 NARROWED THIS BACK TO ITS NAME. It was computed as `stock_id IS NULL`, which — the
   *  moment ETFs became resolvable — would have reported a perfectly identified ETF (we know its
   *  ISIN, its scheme code, its NAV, and we compute its analytics nightly) as an unidentifiable
   *  mystery, purely because an ETF has no stock_id and never will. `unmapped` now means what it
   *  says: we do not know what this is. An ETF is not unmapped; it is `heldNotScored`. */
  unmapped: string[];
  /** Step 13 — holdings resolved to a NON-EQUITY catalogue instrument (an ETF, and since Step 14 a
   *  REIT/InvIT). Fully identified: instrument_id set, stock_id NULL. Held and valued, never
   *  scored. This is a HEALTHY outcome, reported separately from `unmapped` so it never reads as a
   *  fault.
   *
   *  (Step 14.5) "and valued" is now TRUE. It was not when this line was written: every portfolio
   *  surface priced a holding through `stock_prices` keyed on stock_id, so a stock_id-NULL
   *  instrument resolved to no price and no market value — the ETF was held-not-VALUED, and this
   *  comment described an intention rather than the code. portfolio/price-resolver.ts closed that
   *  gap: an ETF now values at its exchange close (or its AMFI NAV when NSE does not list it), and
   *  a trust at its exchange close. Still never scored — pricing a thing is not judging it. */
  heldNotScored: { symbol: string; isin: string; instrumentId: string; assetClass: string }[];
  /** Step 7 — stocks this sync ADDED to the universe (bare: symbol + name + ISIN, no sector, no
   *  peer group, NEVER scored). Growing the universe is a real event and is reported as one. */
  admitted: { symbol: string; isin: string; stockId: string }[];
  /** Symbols whose TICKER we did not know but whose ISIN we already held — a rename (LTIM→LTM),
   *  resolved to the existing stock instead of forking it into a duplicate. */
  matchedByIsin: string[];
  syncedAt: string;
}

/** The stored row shape we read internally (includes the secret blob — never returned). */
type ConnRow = Prisma.BrokerConnectionGetPayload<{}>;

// ── helpers ──────────────────────────────────────────────────────────────────────────

/** Narrow a request's broker string to an IMPLEMENTED BrokerId, else a 400. `mock` counts
 *  as implemented (Phase 1); real brokers flip on as their adapters land (Phase 2+). */
function resolveImplementedBroker(brokerRaw: string): BrokerId {
  if (isBrokerId(brokerRaw) && IMPLEMENTED_BROKERS.includes(brokerRaw)) return brokerRaw;
  throw new BrokerLifecycleError(
    "unsupported_broker",
    400,
    `broker "${brokerRaw}" is not available`,
  );
}

/** meta without throwing — a stored row for a (hypothetically) unimplemented broker still
 *  renders on the status page instead of crashing it. */
function safeMeta(broker: BrokerId): BrokerMeta {
  try {
    return getAdapter(broker).meta;
  } catch {
    return { id: broker, displayName: broker, logoRef: "" };
  }
}

/**
 * ⚠️ BROKER-ADDRESSED — a Step-2b LIABILITY, deliberately left in place.
 *
 * CONNECTION-ID ADDRESSED (Step 2b). A user may hold MULTIPLE connections per broker (two
 * demats ⇒ two broker_account_refs ⇒ two rows), so addressing by (user, broker) was ambiguous
 * and could operate on the WRONG demat. Addressing by the connection's own id makes that
 * ambiguity STRUCTURALLY IMPOSSIBLE — hence the 2a `ambiguous_connection` guard is retired,
 * not merely removed: there is no longer a query that can return >1.
 *
 * IDOR: the connection is looked up scoped to the token's userId. Another user's (or an
 * unknown) connection is indistinguishable → 404, never 403-with-existence-disclosure.
 */
async function requireConn(userId: string, connectionId: string): Promise<ConnRow> {
  const conn = await prisma.brokerConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) throw new BrokerLifecycleError("not_found", 404, "connection not found");
  return conn;
}

/** The account bound to a connection (§2.3: at most one, enforced by the partial unique). */
const linkedAccountOf = (connectionId: string) =>
  prisma.portfolioAccount.findFirst({ where: { brokerConnectionId: connectionId }, select: { id: true } });

// ── THE SEVER / RESUME CORE (Step 4) ──────────────────────────────────────────────────
// The account state is a PROJECTION of the connection's feed, never an independent axis:
//
//     enabled = true   ⇔  account linked_live    (receiving fresh data)
//     enabled = false  ⇔  account linked_stale   (frozen last-known-good)
//
// Both writes happen in ONE transaction so the two can never drift into a state that means
// nothing (an "active" connection feeding a "stale" account, or the reverse).
//
// WHAT IT DOES NOT DO — and must never do:
//   • it does NOT null broker_connection_id. The union reaches a broker holding's account via
//     holding → connection → accounts[0]; nulling the pointer would orphan every frozen row and
//     silently delete the snapshot that freezing exists to preserve. The binding is the ANCHOR.
//   • it does NOT delete broker_holdings. Freezing keeps them (§2.3 no-drop). The ONLY path that
//     removes them is clearData — an explicit, confirmed "forget this broker entirely".
//   • it is NOT reached by a dead token (§2.5). Broker tokens die DAILY; that is routine, it
//     leaves session_state='dead' on the CONNECTION alone, and the account stays linked_live.
//     Nothing in the session path calls this.

/** ACTIVE → severed: freeze the feed, mark the bound account stale. Idempotent. */
async function severBinding(connectionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.brokerConnection.update({ where: { id: connectionId }, data: { enabled: false } }),
    // updateMany (not update): an integrated-but-unlinked connection has NO account — that is a
    // valid state, so severing it must be a clean no-op rather than a crash.
    prisma.portfolioAccount.updateMany({ where: { brokerConnectionId: connectionId }, data: { state: "linked_stale" } }),
  ]);
}

/** severed → ACTIVE: resume the feed, bring the bound account back live. Idempotent.
 *  Deliberately does NOT re-authenticate — a dead session stays dead (that is a reconnect, and
 *  it is routine). An account can be linked_live with a dead token: it is bound and syncing-
 *  intent, it just needs a fresh token. Its data age is disclosed either way. */
async function resumeBinding(connectionId: string): Promise<void> {
  await prisma.$transaction([
    prisma.brokerConnection.update({ where: { id: connectionId }, data: { enabled: true } }),
    prisma.portfolioAccount.updateMany({ where: { brokerConnectionId: connectionId }, data: { state: "linked_live" } }),
  ]);
}

/** THE SEVER, connection-addressed. Shared by `deactivate` (connection-addressed) and the
 *  account-addressed unlink endpoint, so the two doors into linked_stale cannot diverge. */
export async function severConnection(userId: string, connectionId: string): Promise<BrokerConnectionView> {
  const conn = await requireConn(userId, connectionId);
  await severBinding(conn.id);
  const updated = await prisma.brokerConnection.findUniqueOrThrow({ where: { id: conn.id } });
  return view(updated, safeMeta(conn.broker), await countHoldings(conn.id), (await linkedAccountOf(conn.id))?.id ?? null);
}

function view(conn: ConnRow, meta: BrokerMeta, holdingsCount: number, linkedAccountId: string | null): BrokerConnectionView {
  return {
    id: conn.id, // THE address for every lifecycle op + linking
    broker: conn.broker,
    brokerAccountRef: conn.brokerAccountRef, // public client code — distinguishes two demats
    linkedAccountId, // null ⇒ integrated-but-unlinked (cannot sync until bound)
    displayName: meta.displayName,
    logoRef: meta.logoRef,
    enabled: conn.enabled,
    state: conn.enabled ? "active" : "inactive",
    sessionState: conn.sessionState,
    sessionExpiresAt: conn.sessionExpiresAt?.toISOString() ?? null,
    lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
    disclaimerVersion: conn.disclaimerVersion,
    disclaimerAcceptedAt: conn.disclaimerAcceptedAt.toISOString(),
    holdingsCount,
    createdAt: conn.createdAt.toISOString(),
    updatedAt: conn.updatedAt.toISOString(),
    // NOTE: conn.sessionBlob is deliberately NOT included — the encrypted token never leaves the server.
  };
}

const countHoldings = (connectionId: string) =>
  prisma.brokerHolding.count({ where: { brokerConnectionId: connectionId } });

/** Persist a freshly-established session → the (upserted) connection. Shared by the one-shot
 *  `integrate` and the OAuth `completeIntegration` — the ONLY difference between brokers is how
 *  the `session` was obtained; storage is identical. Encrypts the session (→ 503 if no key),
 *  records disclaimer consent, flips the connection active. Upsert = first connect OR reconnect
 *  (re-establish after a dead session). */
async function persistSession(
  userId: string,
  broker: BrokerId,
  adapter: BrokerAdapter,
  session: BrokerSession,
  disclaimer: { version: string; acceptedAt: Date },
): Promise<BrokerConnectionView> {
  // FAIL-LOUD on a missing account ref. broker_account_ref is the second key dimension that
  // makes two demats at one broker distinguishable; it is NOT NULL by design. Persisting a
  // null would be worse than useless — Postgres UNIQUE treats NULLs as DISTINCT, so it would
  // silently permit UNLIMITED duplicate connections for that (user, broker). Refuse instead.
  // Read from the broker-agnostic BrokerSession.accountRef — the core NEVER reaches into
  // session.meta (that stays opaque to the owning adapter).
  if (!session.accountRef) {
    throw new BrokerLifecycleError(
      "account_ref_missing",
      502,
      `${broker} returned no account identifier; the connection cannot be keyed to a specific account`,
    );
  }

  const alive = await adapter.isSessionAlive(session);
  const data = {
    enabled: true,
    sessionState: (alive ? "live" : "dead") as "live" | "dead",
    sessionBlob: encryptJson(session), // access token encrypted at rest
    sessionExpiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
    disclaimerVersion: disclaimer.version,
    disclaimerAcceptedAt: disclaimer.acceptedAt,
  };
  // Keyed on (user, broker, accountRef): re-auth of the SAME demat returns the same ref →
  // UPDATE. A genuinely different demat brings a different ref → a second, distinct connection.
  const conn = await prisma.brokerConnection.upsert({
    where: { userId_broker_brokerAccountRef: { userId, broker, brokerAccountRef: session.accountRef } },
    create: { userId, broker, brokerAccountRef: session.accountRef, ...data },
    update: data, // includes enabled:true — reconnecting a severed demat resumes its feed
  });

  // ── THE RE-LINK (Step 4): linked_stale → linked_live ────────────────────────────────────
  // Reconnecting a SEVERED demat brings its account back to life, and the recovery lands on the
  // ORIGINAL account because the UPSERT KEY *IS* the demat's identity. That makes ref-matching
  // STRUCTURAL rather than a check we could forget to write:
  //   • same demat  → same broker_account_ref → the SAME connection row → the account still
  //     bound to it (we never nulled the pointer on sever) → that account, and only that one,
  //     comes back live. No parallel account, no chance of landing on the wrong book.
  //   • other demat → different ref → a DIFFERENT connection row, with no bound account. The
  //     stale account stays stale and is untouched. A wrong ref cannot hijack it.
  // `data.enabled` is already true above, so the connection is live; this brings the ACCOUNT's
  // projection back in step with it, in the same way severBinding/resumeBinding keep them paired.
  await prisma.portfolioAccount.updateMany({
    where: { brokerConnectionId: conn.id, state: "linked_stale" },
    data: { state: "linked_live" },
  });

  return view(conn, adapter.meta, await countHoldings(conn.id), (await linkedAccountOf(conn.id))?.id ?? null);
}

/** The disclaimer gate — a connection cannot exist without an accepted, versioned disclaimer. */
function requireDisclaimer(accepted?: boolean, version?: string): asserts version is string {
  if (accepted !== true || !version) {
    throw new BrokerLifecycleError(
      "disclaimer_required",
      400,
      "the broker disclaimer must be accepted (with its version) to connect",
    );
  }
}

// ── integrate: none/any → ACTIVE (ONE-SHOT — non-interactive brokers only, e.g. mock) ──
export interface IntegrateInput {
  disclaimerVersion?: string;
  accepted?: boolean;
  /** Broker-specific auth hand-off (opaque to the core; e.g. an OAuth authorization code). */
  params?: Record<string, unknown>;
}

export async function integrate(
  userId: string,
  brokerRaw: string,
  input: IntegrateInput,
): Promise<BrokerConnectionView> {
  const broker = resolveImplementedBroker(brokerRaw);
  const adapter = getAdapter(broker);

  // Capability check (NOT a broker-name check): interactive brokers must use initiate→complete.
  if (isInteractive(adapter)) {
    throw new BrokerLifecycleError(
      "not_interactive",
      400,
      `${broker} uses the interactive auth flow (initiate → complete), not one-shot integrate`,
    );
  }
  requireDisclaimer(input.accepted, input.disclaimerVersion);

  // The ONLY per-broker-different step. userId is bound in from the caller → the session
  // can never be minted for someone else.
  const session = await adapter.authenticate({ userId, params: input.params });
  return persistSession(userId, broker, adapter, session, { version: input.disclaimerVersion, acceptedAt: new Date() });
}

// ── beginIntegration: INTERACTIVE (OAuth) step 1 — issue CSRF state + return the login URL ──
export interface BeginIntegrationInput {
  disclaimerVersion?: string;
  accepted?: boolean;
}

export async function beginIntegration(
  userId: string,
  brokerRaw: string,
  input: BeginIntegrationInput,
): Promise<{ broker: BrokerId; authUrl: string }> {
  const broker = resolveImplementedBroker(brokerRaw);
  const adapter = getAdapter(broker);
  if (!isInteractive(adapter)) {
    throw new BrokerLifecycleError("not_interactive", 400, `${broker} does not use interactive auth`);
  }
  requireDisclaimer(input.accepted, input.disclaimerVersion);

  // Capture consent at initiate; it rides the state record to completion. The core OWNS the
  // CSRF state (unguessable, single-use, bound to this user+broker, short TTL).
  const { state } = await issueState(userId, broker, {
    disclaimerVersion: input.disclaimerVersion,
    disclaimerAcceptedAt: new Date(),
  });
  // The adapter builds the broker's login URL and embeds the state (→ 503 if unconfigured).
  const { authUrl } = await adapter.beginAuth({ userId, state });
  return { broker, authUrl };
}

// ── completeIntegration: INTERACTIVE step 2 — verify+consume state, exchange, persist ──
export interface CompleteIntegrationInput {
  state?: string;
  /** The opaque callback bag from the broker redirect (the adapter alone knows its shape);
   *  the core never inspects it — it forwards it to authenticate(). */
  params?: Record<string, unknown>;
  /**
   * RECONNECT PRECONDITION — the connection the caller believes it is re-authenticating.
   *
   * THE BUG THIS CLOSES. A broker authenticates WHOEVER logs in. On a reconnect (a dead Kite token,
   * every morning) the user may sign into a DIFFERENT demat — a second account, a family member's, a
   * mistyped login. Kite happily returns that demat's client code, persistSession's upsert key
   * (userId, broker, brokerAccountRef) sees an unknown ref, and `create` mints a BRAND-NEW connection
   * bound to no account: invisible on every surface, and holding an encrypted access token for a
   * demat this book does not use. One row per wrong login.
   *
   * The frontend has always guarded this (it compares the returned connection id and refuses to link
   * or sync) — but only AFTER the row was written. The intent lived in sessionStorage and never
   * reached the server, so the server had no way to know a create was WRONG rather than a first link.
   *
   * PRESENT ⇒ A PRECONDITION, NOT A HINT. The authenticated session must resolve to THIS connection,
   * or we refuse before persisting anything. ABSENT ⇒ today's behaviour, byte-identical: a first-time
   * link still creates. The normal path is not gated.
   *
   * WHY THE CONNECTION ID AND NOT THE EXPECTED brokerAccountRef. The id is a STRICTLY STRONGER
   * precondition: it asserts "a connection I OWN, that EXISTS, whose demat is the one I am about to
   * authenticate". A bare ref asserts only "the session must say NJG351" — which cannot tell that the
   * connection was cleared in another tab between initiate and complete, and would happily re-create
   * the very orphan this exists to prevent. Resolving id → ref and comparing THAT is the ref check
   * plus an ownership-and-existence check, for one owner-scoped read. It is also how the rest of this
   * lifecycle is addressed (Step 2b: connection-id addressed), and what the frontend guard already
   * compares.
   */
  expectedConnectionId?: string;
}

export async function completeIntegration(
  userId: string,
  brokerRaw: string,
  input: CompleteIntegrationInput,
): Promise<BrokerConnectionView> {
  const broker = resolveImplementedBroker(brokerRaw);
  const adapter = getAdapter(broker);
  if (!isInteractive(adapter)) {
    throw new BrokerLifecycleError("not_interactive", 400, `${broker} does not use interactive auth`);
  }

  // 1. CSRF/replay/user-binding: atomically verify + consume the state for THIS user+broker.
  //    A state issued for another user (or replayed/expired) never gets past here → no link.
  let disclaimer: { disclaimerVersion: string; disclaimerAcceptedAt: Date };
  try {
    disclaimer = await consumeState(userId, broker, input.state);
  } catch (e) {
    if (e instanceof StateVerificationError) {
      throw new BrokerLifecycleError("state_invalid", 400, "invalid, expired, or already-used auth state");
    }
    throw e;
  }

  // 2. RECONNECT PRECONDITION — resolve the expected connection BEFORE the token exchange, so a
  //    bogus/foreign id never even causes a broker call.
  //
  //    IDOR: scoped to the token's userId (and this broker), exactly like requireConn. Another
  //    user's connection and a nonexistent one are INDISTINGUISHABLE — both 404, never a
  //    403-with-existence-disclosure. A caller cannot use this to probe for someone else's rows.
  let expected: ConnRow | null = null;
  if (input.expectedConnectionId) {
    expected = await prisma.brokerConnection.findFirst({
      where: { id: input.expectedConnectionId, userId, broker },
    });
    if (!expected) throw new BrokerLifecycleError("not_found", 404, "connection not found");
  }

  // 3. Server-side token exchange. userId is bound from the caller (auth), not the payload.
  //    A broker rejection (bad/expired authorization code) is a clean 400, not a 500. The state
  //    was already consumed above → a retry starts fresh from initiate (replay-safe).
  let session: BrokerSession;
  try {
    session = await adapter.authenticate({ userId, params: input.params });
  } catch (e) {
    if (e instanceof BrokerSessionError) {
      throw new BrokerLifecycleError("exchange_failed", 400, "the broker rejected the authorization; please try connecting again");
    }
    throw e;
  }

  // 4. THE DEMAT GUARD — the whole point of expectedConnectionId. The session now names the demat
  //    that ACTUALLY logged in; if it is not the one being reconnected, refuse HERE.
  //
  //    NOTHING HAS BEEN WRITTEN AT THIS POINT, and that ordering is the requirement, not an
  //    accident: persistSession is the only writer and it is below us. We do NOT create-then-clean —
  //    a credential that briefly existed is a credential that existed. The access token lives only in
  //    the `session` local and dies with this stack frame, unencrypted, unstored, unreachable.
  //
  //    We cannot check this any EARLIER than this line: the demat's identity (Kite's `user_id`) is
  //    only knowable BY exchanging the request_token. So obtaining the token is unavoidable —
  //    PERSISTING it is not, and that is the line we hold.
  if (expected && session.accountRef !== expected.brokerAccountRef) {
    throw new BrokerLifecycleError(
      "wrong_demat",
      409,
      "that broker login is for a different account than the one being reconnected; nothing was changed",
    );
  }

  // 5. Persist encrypted, with the consent captured at initiate.
  return persistSession(userId, broker, adapter, session, {
    version: disclaimer.disclaimerVersion,
    acceptedAt: disclaimer.disclaimerAcceptedAt,
  });
}

// ── sync: ACTIVE → ACTIVE (fetch → normalize → OVERWRITE the snapshot) ─────────────────
export async function syncHoldings(userId: string, connectionId: string): Promise<SyncOutcome> {
  const conn = await requireConn(userId, connectionId);
  const broker = conn.broker;
  if (!conn.enabled) {
    throw new BrokerLifecycleError("invalid_state", 409, "connection is inactive — activate it before syncing");
  }

  // FAIL-LOUD on an ORPHANED connection. A connection is integrated-but-unlinked until the
  // user CHOOSES an account to bind it to (§2.3 — we never silent-pick). Its holdings belong
  // to that account; with no binding there is nowhere honest to land them. Refuse rather than
  // write holdings that float free of the account model.
  const bound = await linkedAccountOf(conn.id);
  if (!bound) {
    throw new BrokerLifecycleError(
      "account_not_linked",
      409,
      "this connection is not linked to an account — choose an account to link it to before syncing",
    );
  }

  const adapter = getAdapter(broker);
  const session = decryptJson<BrokerSession>(conn.sessionBlob); // → 503 if key unavailable

  let raw: unknown;
  try {
    if (!(await adapter.isSessionAlive(session))) throw new BrokerSessionError(broker);
    raw = await adapter.fetchHoldings(session);
  } catch (e) {
    if (e instanceof BrokerSessionError) {
      // Mark the connection dead (state only — data retained) and tell the caller to reconnect.
      await prisma.brokerConnection.update({ where: { id: conn.id }, data: { sessionState: "dead" } });
      throw new BrokerLifecycleError("session_dead", 409, "broker session expired — reconnect to refresh");
    }
    throw e;
  }

  const std = adapter.normalize(raw);

  // ── A ZERO-QUANTITY ROW IS NOT A HOLDING — drop it BEFORE anything downstream sees it ────────
  // Kite returns a sold instrument for the whole settlement day with every ownership pool at 0
  // (quantity/t1/collateral ⇒ heldQuantity 0; the sale is recorded in `used_quantity`). Storing it
  // is faithful to the WIRE but not to the BOOK: nothing is owned, so there is nothing to mirror.
  //
  // The read filter in listUnifiedPositions is what this bug actually turned on, and it would cover
  // the display on its own. This is the belt to that braces: a ghost should not occupy a mirror row
  // in the first place, waiting for the one future read path that forgets to filter. Cheap, because
  // delete-then-insert means "not written" IS "removed" — the sold row is gone from broker_holdings
  // on the very next sync, with no deletion logic of its own.
  //
  // ⚠️ IT MUST HAPPEN BEFORE resolveHoldingsToUniverse, NOT INSIDE THE WRITE LOOP BELOW. The
  // resolver is the one step here that MUTATES shared state: given an unknown symbol with an ISIN
  // it ADMITS a new bare stock to the 504-stock universe. Filtering after it would still let a
  // sold-out ghost enlarge the universe permanently — a company added to the platform on the
  // strength of a position the user no longer owns. Filter first and the ghost reaches nothing.
  //
  // SKIPPED, NOT ZEROED: `> 0` also drops the nonsensical negative a broker could hand us. This is
  // a filter on OWNERSHIP; the rows that survive it keep the broker's numbers exactly as given.
  const held = std.filter((h) => h.quantity > 0);

  // ── RESOLVE → the universe (Step 7: ADD-TO-UNIVERSE) ────────────────────────────────────────
  // Was: a read-only symbol lookup, with an unknown symbol left at stock_id NULL forever. Now the
  // resolver may ADMIT an unknown symbol as a bare stock — but ONLY when the broker gave us an
  // ISIN, because ISIN is the universe's dedup spine and a fabricated one would fork a company in
  // two the day the real row arrived. An unknown symbol with NO ISIN keeps the old null-stock
  // held-not-scored path, unchanged and honestly reported. See brokers/universe-admit.ts.
  //
  // The resolver also catches SYMBOL DRIFT for free: an unknown symbol whose ISIN we already hold
  // (LTIM→LTM) resolves to the EXISTING stock rather than creating a duplicate.
  const resolution = await resolveHoldingsToUniverse(held);

  const now = new Date();
  // Key by symbol (broker /holdings is one row per symbol; this is defensive against a
  // duplicate, NOT aggregation — snapshot-mirror stores what the broker gives).
  const bySymbol = new Map<string, Prisma.BrokerHoldingCreateManyInput>();
  for (const h of held) {
    const hit = resolution.bySymbol.get(h.symbol);
    bySymbol.set(h.symbol, {
      userId,
      brokerConnectionId: conn.id,
      symbol: h.symbol,
      stockId: hit?.stockId ?? null,
      instrumentId: hit?.instrumentId ?? null,
      quantity: new Prisma.Decimal(h.quantity),
      avgCost: new Prisma.Decimal(h.avgCost),
      currentValue: h.currentValue != null ? new Prisma.Decimal(h.currentValue) : null,
      source: "broker",
      syncedAt: now,
    });
  }
  const rows = [...bySymbol.values()];

  // Overwrite-in-place: delete the prior snapshot then insert the fresh one, atomically, and
  // stamp the connection live + last_synced_at. NO append, NO FIFO, NO lot register.
  await prisma.$transaction(async (tx) => {
    await tx.brokerHolding.deleteMany({ where: { brokerConnectionId: conn.id } });
    if (rows.length) await tx.brokerHolding.createMany({ data: rows });
    await tx.brokerConnection.update({
      where: { id: conn.id },
      data: { lastSyncedAt: now, sessionState: "live" },
    });
  });

  // The book changed → refresh the PHS snapshot. Best-effort: the snapshot has already committed,
  // so a PHS failure must never fail the sync (same discipline as the transaction write path).
  await refreshPhsQuietly(userId);

  // (Step 21) First hold of a non-stock instrument via broker → backfill its weekly chart series
  // once. enqueueHistoryBackfillIfNeeded is deduped (skips anything already backfilled or in
  // flight), so a routine 2-hourly re-sync of the same book enqueues nothing. Best-effort.
  for (const r of rows) {
    if (r.instrumentId && !r.stockId) {
      await enqueueHistoryBackfillIfNeeded(r.instrumentId, r.stockId ?? null, `broker:${conn.id}`);
    }
  }

  // `unmapped` means ONE thing and one thing only: the broker gave us no ISIN, so the holding
  // could not be IDENTIFIED. It is NOT "a symbol outside our 504" (that case is ADMITTED), and
  // since Step 13 it is NOT "anything without a stock_id" either.
  //
  // THAT LAST DISTINCTION IS THE POINT. A held ETF has stock_id NULL — permanently, correctly,
  // by definition — but it has an instrument_id, a name, a NAV and a nightly analytics row. It is
  // the best-understood holding in the book. Testing `stockId == null` would have filed it next
  // to FAKESTOCK and told the operator we had no idea what it was. So the test is
  // "no identity AT ALL": neither a stock nor an instrument.
  const unmapped = rows.filter((r) => r.stockId == null && r.instrumentId == null).map((r) => r.symbol);
  return {
    broker,
    connectionId: conn.id,
    accountId: bound.id, // the §2.3-bound account this snapshot feeds (derived, never denormalised)
    synced: rows.length,
    // "mapped" = resolved to SOMETHING in the catalogue — an equity or an instrument.
    mapped: rows.length - unmapped.length,
    unmapped,
    // Step 13 — identified, held, not scored. A healthy outcome, kept out of `unmapped` so it
    // never reads as a fault.
    heldNotScored: resolution.heldNotScored,
    // Step 7 — admission is LOUD. A sync that quietly grew the universe would be a sync that
    // changed what the platform knows without telling anyone.
    admitted: resolution.admitted,
    matchedByIsin: resolution.outcomes.filter((o) => o.how === "matched_by_isin").map((o) => o.symbol),
    syncedAt: now.toISOString(),
  };
}

// ── refresh: RE-VALUE WITHOUT THE BROKER (Step 7) ──────────────────────────────────────
// THE OFFLINE PATH. Sync needs a live session; refresh needs nothing at all — it never touches the
// broker, so it works while the token is dead (which, for Kite, is every morning).
//
// WHAT IT DOES NOT DO, and why that is the whole point:
//   • it does NOT call the broker. No fetch, no session, no adapter. A dead session is irrelevant.
//   • it does NOT rewrite broker_holdings.current_value. That column is the BROKER's OWN ₹ figure
//     (§2.2) — overwriting it with our price would make the mirror report something the broker
//     never said. The mirror stays exactly as the broker last left it.
//   • it does NOT touch quantity or avg_cost. Those are broker truth. Only the broker changes them.
//
// So what IS stale, then? Not the holdings: the read path already joins our live prices for broker
// rows too, so a user opening the app always sees a current valuation. The one thing that is
// STORED — and therefore goes stale as prices move — is the PHS snapshot. That is what refreshes.
export interface RefreshOutcome {
  connectionId: string;
  broker: BrokerId;
  /** Positions re-valued (the frozen quantities; unchanged by this call). */
  holdings: number;
  /** ALWAYS false. Stated explicitly because "did this hit the broker?" is the question that
   *  matters about this endpoint, and a reader should not have to infer the answer. */
  brokerContacted: false;
  /** null when the session is dead — refresh works anyway. Disclosed, not hidden. */
  sessionState: "live" | "dead";
  lastSyncedAt: string | null;
  refreshedAt: string;
}

export async function refreshHoldings(userId: string, connectionId: string): Promise<RefreshOutcome> {
  const conn = await requireConn(userId, connectionId); // IDOR: owner-scoped, 404 otherwise
  const holdings = await countHoldings(conn.id);

  // The ONLY write: recompute the user's PHS snapshot against today's prices. No broker call.
  await refreshPhsQuietly(userId);

  return {
    connectionId: conn.id,
    broker: conn.broker,
    holdings,
    brokerContacted: false,
    sessionState: conn.sessionState, // a dead session does NOT block this — that is the feature
    lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null, // the data's age, disclosed as ever
    refreshedAt: new Date().toISOString(),
  };
}

/** PHS refresh that can never fail its caller. The broker snapshot has already committed by the
 *  time this runs; a scoring hiccup must not turn a successful sync into a 500. */
async function refreshPhsQuietly(userId: string): Promise<void> {
  try {
    const { refreshPhsForUser } = await import("../portfolio/phs/refresh.js");
    await refreshPhsForUser(userId);
  } catch (e) {
    console.error("[brokers] PHS refresh failed (the snapshot itself already committed)", e);
  }
}

// ── deactivate: ACTIVE → SEVERED (holdings + session RETAINED; bound account → linked_stale) ──
// Step 4: this is a SEVER, not just a pause. "Not syncing" and "stale" are one state, so a
// paused connection and an unlinked one cannot behave differently — both freeze, both keep
// scoring, both disclose. The holdings are untouched.
export const deactivate = severConnection;

// ── activate: SEVERED → ACTIVE (resume; does NOT re-authenticate; account → linked_live) ──
export async function activate(userId: string, connectionId: string): Promise<BrokerConnectionView> {
  const conn = await requireConn(userId, connectionId);
  // Pure state flip. If the stored session is dead, it STAYS dead — a real refresh is a
  // reconnect (integrate/OAuth), not an activate. status/sync surface the dead session.
  await resumeBinding(conn.id);
  const updated = await prisma.brokerConnection.findUniqueOrThrow({ where: { id: conn.id } });
  return view(updated, safeMeta(conn.broker), await countHoldings(conn.id), (await linkedAccountOf(conn.id))?.id ?? null);
}

// ── clear: INACTIVE → gone (STRUCTURAL only-when-inactive + confirm) ───────────────────
export interface ClearInput {
  confirm?: boolean;
}
export async function clearData(
  userId: string,
  connectionId: string,
  input: ClearInput,
): Promise<{ cleared: true; broker: BrokerId; wipedHoldings: number }> {
  const conn = await requireConn(userId, connectionId);
  const broker = conn.broker;

  // STRUCTURAL RULE: clear-data is only reachable from the inactive state. An active
  // connection must be deliberately deactivated first (a two-step guard against nuking a
  // live, syncing connection).
  if (conn.enabled) {
    throw new BrokerLifecycleError("invalid_state", 409, "deactivate the connection before clearing its data");
  }
  if (input.confirm !== true) {
    throw new BrokerLifecycleError("confirmation_required", 400, "clearing broker data requires explicit confirmation");
  }

  const wipedHoldings = await countHoldings(conn.id);

  // THE ZOMBIE FIX (Step 4). Deleting the connection cascades broker_holdings away AND forgets
  // the encrypted token; the FK from portfolio_accounts is ON DELETE SET NULL, so a bound account
  // survives with a NULL binding. Until Step 4 its `state` was left at linked_live — and that
  // account was then permanently BRICKED: it could not sync (no connection to address), could not
  // accept manual entry (state ≠ manual), could not be deleted (state ≠ manual), and could not be
  // re-linked (link required state = manual). Every door was shut.
  //
  // So we stamp linked_stale FIRST, in the same transaction as the delete. That is the honest
  // description of what the user now has — an account that was broker-fed and no longer is — and
  // it is the RECOVERABLE state: a stale account with a null binding can be re-linked to a fresh
  // connection, or deleted outright (accounts-controller admits both).
  //
  // This is the ONE path that removes broker_holdings. It is not a contradiction of the §2.3
  // no-drop rule: the user explicitly asked to forget this broker (inactive-first + confirm:true).
  // Sever FREEZES; clear FORGETS. Only the second is destructive, and only on request.
  await prisma.$transaction([
    prisma.portfolioAccount.updateMany({ where: { brokerConnectionId: conn.id }, data: { state: "linked_stale" } }),
    prisma.brokerConnection.delete({ where: { id: conn.id } }),
  ]);
  return { cleared: true, broker, wipedHoldings };
}

// ── status: read all of a user's connections + the pickable brokers ────────────────────
export async function status(
  userId: string,
): Promise<{ connections: BrokerConnectionView[]; available: BrokerMeta[] }> {
  // `accounts` is the §2.3 binding (at most one per connection). Included here so a client can
  // see, per connection, which account it feeds — and which connections are still unlinked.
  const conns = await prisma.brokerConnection.findMany({
    where: { userId },
    include: { _count: { select: { holdings: true } }, accounts: { select: { id: true }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });
  const connections = conns.map((c) => view(c, safeMeta(c.broker), c._count.holdings, c.accounts[0]?.id ?? null));
  return { connections, available: implementedBrokerMeta() };
}
