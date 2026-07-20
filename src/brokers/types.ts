// ═══════════════════════════════════════════════════════════════════════
// BROKER ADAPTER — the broker-agnostic core abstraction (Phase 1).
//
// GOVERNING PRINCIPLE: the connection lifecycle (integrate → active → sync →
// deactivate → clear) is IDENTICAL for every broker; only SESSION ESTABLISHMENT
// differs. So the lifecycle/storage/sync core is written ONCE against THIS interface
// and NEVER learns which broker it is talking to. A new broker is a thin adapter —
// implement these five members and register it; the core is untouched.
//
// ⚠️ LAW — READ-ONLY, STRUCTURALLY. This interface has NO order / write / place /
// modify method and never will. An adapter physically cannot transact on the user's
// broker account because there is no seam through which to do so. Holdings import is a
// one-way mirror: broker → us.
//
// This module has ZERO dependency on Prisma, Express, or any broker SDK. The adapter
// boundary speaks plain JSON-serialisable values (numbers/strings) so a BrokerSession
// round-trips cleanly through encryption + DB storage, and so the core stays portable.
// ═══════════════════════════════════════════════════════════════════════

/** THE BROKER CATALOG — every broker the platform can model. Mirrored by the Postgres
 *  `BrokerId` enum (broker_connections.broker AND portfolio_accounts.broker).
 *
 *  Since Step 5.5 this union is TWO things, and the difference is load-bearing:
 *    • CATALOG  — what an ACCOUNT can be tagged as (all of them). An account belongs to a
 *      broker from CREATION; a manual account is "my Angel One book, hand-tracked".
 *    • LINKABLE — the subset with a working adapter (registry's IMPLEMENTED_BROKERS: zerodha).
 *      Everything else is CREATE-NOW-LINK-LATER: the account is already correctly identified,
 *      so the day its adapter ships it becomes linkable and NO DATA MOVES.
 *
 *  `mock` is the reference/test adapter (proves the core without real OAuth). Adapter-less
 *  members map to registry's notYet() — the pattern upstox/groww already used.
 *  Display metadata for the account picker lives in brokers/catalog.ts, NOT here: an
 *  adapter-less broker has no adapter to carry a BrokerMeta. */
export type BrokerId =
  | "mock"
  | "zerodha"
  | "upstox"
  | "groww"
  | "angelone"
  | "dhan"
  | "fyers"
  | "icicidirect"
  | "hdfcsecurities"
  | "kotak"
  | "sharekhan"
  | "fivepaisa"
  | "motilaloswal"
  | "iifl"
  | "sbisecurities"
  | "paytmmoney"
  | "axisdirect"
  // Stage 1 — the NOT-AT-A-BROKER account (SGB from a bank, direct NSDL bond, physical). A value,
  // not an absence; taggable on an account but PERMANENTLY UNLINKABLE (no adapter, ever).
  | "other";

/** Static, per-broker identity for pickers / status. No behaviour. */
export interface BrokerMeta {
  id: BrokerId;
  displayName: string;
  /** Asset key the frontend resolves to a logo (e.g. "brokers/mock.svg"). A ref, not
   *  bytes — the core never loads it. */
  logoRef: string;
}

/** The credentials/handle an adapter needs to talk to the broker on the user's behalf.
 *  The WHOLE object is encrypted at rest (see brokers/crypto.ts) — treat every field as
 *  sensitive. Broker-specific extras ride in `meta` so the envelope stays uniform. */
export interface BrokerSession {
  broker: BrokerId;
  /** The bearer/access token — the sensitive secret. Never logged, never returned to a
   *  client, only ever persisted encrypted. */
  accessToken: string;
  /** Optional refresh token (brokers that support silent renewal). Also secret. */
  refreshToken?: string | null;
  /** ISO-8601 expiry, or null when the broker issues non-expiring tokens. Liveness is
   *  derived from this by default (see isSessionAlive). Zerodha, e.g., expires daily. */
  expiresAt: string | null;
  /** The BROKER's own stable per-account identifier — Kite `user_id`, Angel `clientcode`,
   *  Upstox `user_id`: every Indian broker issues one client code per demat account. NOT a
   *  secret (it is a public account id) and NOT our user id.
   *
   *  FIRST-CLASS, NOT `meta`: the core persists this (broker_account_ref) as the second key
   *  dimension that makes two demats at one broker representable. It must therefore be
   *  broker-AGNOSTIC — reading `meta.kiteUserId` from the core would hardcode a Kite-specific
   *  key into shared code and break the meta-is-opaque contract below.
   *
   *  Stable across re-auth (same demat ⇒ same ref), so re-linking UPDATES the existing
   *  connection instead of minting a duplicate. null ⇒ the core refuses to persist (fail-loud):
   *  a null ref would silently permit duplicate connections (Postgres NULLS DISTINCT). */
  accountRef: string | null;
  /** Broker-specific extras (granted scopes, mock fixtures…). Opaque to the core — only the
   *  owning adapter reads it. The core NEVER reaches in here (see accountRef above). */
  meta?: Record<string, unknown>;
}

/** The inputs `authenticate` needs. `userId` is ALWAYS the authenticated owner
 *  (req.authUser.userId) — never a payload field — so a session can never be minted for
 *  another user (IDOR-proof by construction). `params` carries the broker-specific
 *  hand-off (e.g. a Zerodha `request_token` from the OAuth redirect); opaque to the core. */
export interface BrokerAuthContext {
  userId: string;
  params?: Record<string, unknown>;
}

/** The inputs `beginAuth` needs to start an INTERACTIVE (OAuth) flow. `state` is issued and
 *  OWNED by the core (the CSRF binding lives in the lifecycle, not the adapter); the adapter
 *  only embeds it into the broker's login URL. userId is the authenticated owner. */
export interface BrokerAuthInitContext {
  userId: string;
  state: string;
}

/** What `beginAuth` returns: the URL the user is redirected to on the BROKER's domain. It
 *  may carry public identifiers (api_key, the core-issued state) but MUST NOT carry any
 *  secret (api_secret) — the core hands this straight to the client. */
export interface BrokerAuthUrl {
  authUrl: string;
}

/** A holding in the broker's OWN raw shape, straight off fetchHoldings. The core treats
 *  this as an opaque blob — it is produced by fetchHoldings and consumed ONLY by the
 *  same adapter's normalize(); the core never inspects a field. Typing it `unknown` is
 *  what makes the abstraction leak-proof: the core literally cannot depend on any
 *  broker's payload shape. */
export type RawHoldings = unknown;

/** The canonical, broker-neutral holding — the ONLY holding shape the storage/union
 *  layers see. normalize() maps every broker's raw rows to this. Numbers are plain JS
 *  numbers at this boundary (broker APIs return JSON numbers); the storage seam converts
 *  to Prisma.Decimal. `symbol` is the broker's tradingsymbol (broker truth, UPPER-cased)
 *  — resolving it to our universe's stock_id happens at storage, not here. */
export interface StandardHolding {
  /** Broker tradingsymbol, upper-cased. Broker truth — stored verbatim even for names
   *  outside our universe (snapshot-mirror). */
  symbol: string;
  /** Net shares held (broker's figure). */
  quantity: number;
  /** Average buy cost ₹/share as the broker reports it. NOT recomputed — snapshot-mirror. */
  avgCost: number;
  /** Broker's current market value ₹ for the position, or null if the broker didn't
   *  provide it (never faked — the union layer re-enriches mapped names from our prices). */
  currentValue: number | null;

  // ── Step 7: IDENTITY, so an unknown symbol can JOIN the universe ─────────────────────────
  // These are read-only facts flowing OUT of the broker. They add no write verb and no new call:
  // Kite already sends both on /portfolio/holdings — we were simply dropping them at normalize().

  /** ISIN — THE DEDUP SPINE (Step 1.4). `stocks.isin` is UNIQUE NOT NULL, so this is the ONE
   *  field that decides whether an unknown broker symbol can be admitted to the universe at all.
   *
   *  null ⇒ the broker gave us no ISIN ⇒ WE DO NOT CREATE THE STOCK. A fabricated ISIN
   *  ("SYNTH:TCS") would poison the spine: when the real security later arrives with its true
   *  ISIN it would insert as a SECOND row for the same company, and the catalog's whole reason
   *  for existing (symbols drift, ISINs don't — LTIM→LTM) would be gone. So an ISIN-less unknown
   *  symbol keeps the held-not-scored null-stock path, and is honestly disclosed as such. */
  isin: string | null;
  /** The exchange the broker reports (NSE/BSE). Carried for the bare-stock row; null if absent. */
  exchange: string | null;
}

/**
 * THE CORE ABSTRACTION. Everything downstream (lifecycle state machine, encrypted
 * storage, the one-shot sync, clear) consumes ONLY these five members and never
 * branches on `meta.id`. Keep it minimal — a new broker should be ~a day.
 */
export interface BrokerAdapter {
  /** Static identity (id / displayName / logoRef). */
  readonly meta: BrokerMeta;

  /** OPTIONAL — INTERACTIVE (OAuth) brokers implement this to produce the URL the user is
   *  redirected to for consent. The core calls it generically (checks presence, never the
   *  broker id) and hands the URL to the client. Non-interactive brokers (e.g. mock) omit it
   *  → the core uses the one-shot authenticate() path. The adapter embeds the core-issued
   *  `state` and MUST NOT put any secret in the URL. Completion still flows through
   *  authenticate() (exchanging the redirect's callback params for a session). */
  beginAuth?(ctx: BrokerAuthInitContext): Promise<BrokerAuthUrl>;

  /** THE ONLY PER-BROKER-DIFFERENT PART. Establish a session for the owner — exchange an
   *  OAuth code, mint a token, etc. Everything else in the lifecycle is broker-agnostic. */
  authenticate(ctx: BrokerAuthContext): Promise<BrokerSession>;

  /** Is this session still usable? Default answer is derived from expiry; a broker may
   *  probe its API. Called before every fetch so a dead session fails fast + honestly. */
  isSessionAlive(session: BrokerSession): Promise<boolean>;

  /** Pull the user's holdings in the broker's raw shape. MUST throw BrokerSessionError on
   *  an expired/revoked session (so the core can mark the connection dead). READ-ONLY. */
  fetchHoldings(session: BrokerSession): Promise<RawHoldings>;

  /** Pure transform: the broker's raw rows → our canonical StandardHolding[]. No I/O. */
  normalize(raw: RawHoldings): StandardHolding[];
}

/** Thrown by an adapter when the session is expired/revoked/invalid. The lifecycle core
 *  catches THIS specifically to transition session_state → 'dead' (any other error is an
 *  unexpected fault and surfaces as a 500, connection state untouched). */
export class BrokerSessionError extends Error {
  readonly broker: BrokerId;
  constructor(broker: BrokerId, message = "broker session is not alive") {
    super(message);
    this.name = "BrokerSessionError";
    this.broker = broker;
  }
}

/** Thrown by an adapter when the broker is not CONFIGURED (e.g. Kite api_key/secret absent).
 *  Generic + broker-agnostic on purpose (lives here, NOT in an adapter file) so the core
 *  controller can map it to 503 feature_unavailable WITHOUT importing any adapter — the
 *  same fail-closed discipline as missing encryption: degrade the feature, don't crash. */
export class BrokerConfigError extends Error {
  readonly broker: BrokerId;
  constructor(broker: BrokerId, message = "broker is not configured") {
    super(message);
    this.name = "BrokerConfigError";
    this.broker = broker;
  }
}

/** Narrow an adapter to one that supports INTERACTIVE (OAuth) auth. The core uses this
 *  capability check instead of ever asking "is this Zerodha?" — keeping it broker-agnostic. */
export function isInteractive(
  a: BrokerAdapter,
): a is BrokerAdapter & { beginAuth: NonNullable<BrokerAdapter["beginAuth"]> } {
  return typeof a.beginAuth === "function";
}
