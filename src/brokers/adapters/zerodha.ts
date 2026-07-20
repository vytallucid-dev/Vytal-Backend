// ═══════════════════════════════════════════════════════════════════════
// ZERODHA (Kite Connect) ADAPTER — the FIRST real broker, implemented ENTIRELY behind the
// BrokerAdapter interface. Every Zerodha/Kite specific detail lives in this file (+ kite-http
// + config); the lifecycle/controller/registry gain ZERO Kite knowledge. If this file were
// deleted the core would still compile — that is the abstraction test.
//
// OAuth flow (all server-side except the user's login on Zerodha's own page):
//   beginAuth()    → build the Kite login URL carrying the core-issued state (NO secret in it)
//   authenticate() → exchange request_token: checksum = SHA256(api_key+request_token+
//                    api_secret) [api_secret used HERE, SERVER-SIDE ONLY], POST /session/token
//                    → access_token → BrokerSession (encrypted upstream by the core)
//   isSessionAlive → Kite tokens die ~6:00 AM IST daily; expiry check (a revoked-but-unexpired
//                    token is caught at fetch time as a 403 → BrokerSessionError)
//   fetchHoldings  → GET /portfolio/holdings; normalize() → StandardHolding[]
//
// SECRET HYGIENE: api_secret is read lazily from config and used ONLY in the checksum hash.
// It is never returned, never logged, never placed in a URL. access_token is only ever
// handed to the core (which encrypts it) and to the Authorization header at fetch time.
// ═══════════════════════════════════════════════════════════════════════
import crypto from "crypto";
import {
  BrokerConfigError,
  BrokerSessionError,
  type BrokerAdapter,
  type BrokerAuthContext,
  type BrokerAuthInitContext,
  type BrokerAuthUrl,
  type BrokerMeta,
  type BrokerSession,
  type RawHoldings,
  type StandardHolding,
} from "../types.js";
import {
  KiteTokenError,
  RealKiteHttpClient,
  type KiteHolding,
  type KiteHoldingsResponse,
  type KiteHttpClient,
} from "./kite-http.js";

const KITE_LOGIN_BASE = "https://kite.zerodha.com/connect/login";

interface KiteConfig {
  apiKey: string;
  apiSecret: string; // SERVER-SIDE ONLY
  redirectUri: string;
}

/** Dependencies overridable for tests (Zerodha has no sandbox): inject a mock HTTP client
 *  and/or explicit config so the harness never hits real Zerodha. Production uses defaults. */
export interface ZerodhaAdapterDeps {
  http?: KiteHttpClient;
  config?: Partial<KiteConfig>;
}

export class ZerodhaAdapter implements BrokerAdapter {
  readonly meta: BrokerMeta = { id: "zerodha", displayName: "Zerodha", logoRef: "brokers/zerodha.svg" };

  private readonly http: KiteHttpClient;
  private readonly configOverride?: Partial<KiteConfig>;

  constructor(deps: ZerodhaAdapterDeps = {}) {
    this.http = deps.http ?? new RealKiteHttpClient();
    this.configOverride = deps.config;
  }

  /** Resolve Kite config lazily (env, or a test override). Fail-CLOSED: absent keys throw
   *  BrokerConfigError → the controller answers 503, the platform keeps running. Never logs
   *  the secret. */
  private config(): KiteConfig {
    const apiKey = this.configOverride?.apiKey ?? process.env.KITE_API_KEY;
    const apiSecret = this.configOverride?.apiSecret ?? process.env.KITE_API_SECRET;
    const redirectUri = this.configOverride?.redirectUri ?? process.env.KITE_REDIRECT_URI;
    if (!apiKey || !apiSecret || !redirectUri) {
      throw new BrokerConfigError("zerodha", "Kite Connect is not configured");
    }
    return { apiKey, apiSecret, redirectUri };
  }

  // ── beginAuth: build the Kite login URL (public api_key + core-issued state; NO secret) ──
  async beginAuth(ctx: BrokerAuthInitContext): Promise<BrokerAuthUrl> {
    const { apiKey } = this.config(); // asserts configured; api_secret intentionally NOT used here
    // Kite has no native `state` param — pass it via redirect_params, which Kite echoes back
    // onto the (registered) redirect URL. The redirect target itself is fixed on the Kite
    // console (not client-supplied) → no open-redirect.
    const redirectParams = new URLSearchParams({ state: ctx.state }).toString();
    const authUrl = `${KITE_LOGIN_BASE}?v=3&api_key=${encodeURIComponent(apiKey)}&redirect_params=${encodeURIComponent(redirectParams)}`;
    return { authUrl };
  }

  // ── authenticate: exchange request_token → access_token (checksum uses api_secret) ──
  async authenticate(ctx: BrokerAuthContext): Promise<BrokerSession> {
    const { apiKey, apiSecret } = this.config();
    const requestToken = pickRequestToken(ctx.params);
    if (!requestToken) throw new BrokerSessionError("zerodha", "missing request_token");

    // checksum = SHA256(api_key + request_token + api_secret) — the ONLY use of api_secret,
    // entirely server-side. The HTTP layer receives the derived checksum, never the secret.
    const checksum = crypto.createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");

    let resp;
    try {
      resp = await this.http.createSession({ apiKey, requestToken, checksum });
    } catch (e) {
      if (e instanceof KiteTokenError) throw new BrokerSessionError("zerodha", "kite rejected the request_token");
      throw e;
    }
    if (!resp?.access_token) throw new BrokerSessionError("zerodha", "kite returned no access_token");

    return {
      broker: "zerodha",
      accessToken: resp.access_token,
      refreshToken: null,
      expiresAt: nextKiteExpiry().toISOString(),
      // Kite's `user_id` IS the client code (e.g. "AB1234") — one per demat, stable across
      // re-auth. Surfaced as the broker-agnostic accountRef so the core can key the connection
      // on it without knowing anything about Kite. Read from a field the session response
      // ALREADY returns — no extra broker call, read-only contract intact.
      accountRef: resp.user_id ?? null,
      meta: { kiteUserId: resp.user_id ?? null }, // public account id only; no secret
    };
  }

  // ── isSessionAlive: Kite tokens die ~6 AM IST daily → expiry check ──
  async isSessionAlive(session: BrokerSession): Promise<boolean> {
    if (session.expiresAt != null && Date.parse(session.expiresAt) <= Date.now()) return false;
    // A revoked-but-unexpired token surfaces as a 403 at fetch time → BrokerSessionError.
    return true;
  }

  // ── fetchHoldings: READ-ONLY GET /portfolio/holdings ──
  async fetchHoldings(session: BrokerSession): Promise<RawHoldings> {
    const { apiKey } = this.config();
    try {
      return await this.http.getHoldings({ apiKey, accessToken: session.accessToken });
    } catch (e) {
      if (e instanceof KiteTokenError) throw new BrokerSessionError("zerodha", "kite token expired");
      throw e;
    }
  }

  // ── normalize: Kite holdings → canonical StandardHolding[] (pure; symbol→stock_id is the core) ──
  normalize(raw: RawHoldings): StandardHolding[] {
    const r = raw as KiteHoldingsResponse | null;
    if (!r || !Array.isArray(r.data)) return [];
    return r.data.map((h) => {
      // ONE quantity, computed ONCE and used for both the position and its value. `currentValue`
      // read `h.quantity` on its own line before — the same bug, twice, free to drift apart.
      const quantity = heldQuantity(h);
      return {
        symbol: String(h.tradingsymbol).trim().toUpperCase(),
        quantity,
        avgCost: Number(h.average_price), // broker truth, taken as-is (never recomputed)
        currentValue: h.last_price != null ? quantity * Number(h.last_price) : null,
        // Step 7 — carry the IDENTITY through. Kite has always sent these; we were throwing them
        // away. An empty string is NOT an ISIN: coerce it to null so the "no ISIN ⇒ do not create
        // the stock" rule sees the absence honestly rather than trying to key the universe on "".
        isin: typeof h.isin === "string" && h.isin.trim() !== "" ? h.isin.trim().toUpperCase() : null,
        exchange: typeof h.exchange === "string" && h.exchange.trim() !== "" ? h.exchange.trim().toUpperCase() : null,
      };
    });
  }
}

// ── WHAT THE USER OWNS — and why it is not `h.quantity` ────────────────────────────────────────
//
// THE BUG THIS FIXES. normalize() read `h.quantity` alone. That is Kite's answer to "what can you
// SELL today" — not "what do you OWN". A live sync of a real book mirrored 3 GOLDBEES, 1 NIFTYBEES
// and 2 ONGC as 0 / 0 / 0, because every share sat in T1: bought, owned outright, not yet settled
// into the demat. Invested, current value and unrealised P&L all came out ₹0 on real money. The
// zero was KITE'S, and we carried it faithfully — we were not misreading the number, we were
// reading the wrong question.
//
// OWNED = settled + T1 + pledged:
//   quantity            — settled, in the demat, sellable.
//   t1_quantity         — bought, yours, awaiting settlement. Yours in every sense a portfolio cares about.
//   collateral_quantity — pledged for margin. Still owned, still fully exposed to price.
//
// A SUM, NOT A MAX, and it cannot double-count: the three pools are DISJOINT in Kite's model —
// pledging MOVES shares out of `quantity` into `collateral_quantity`, settlement MOVES them out of
// `t1_quantity` into `quantity`. Every other quantity Kite sends is deliberately excluded; see
// KiteHolding for what each one is and why it is not ownership.
//
// ⚠️ THE PLEDGED PATH IS UNVERIFIED AGAINST A REAL PLEDGE. The live account this was built from
// carries collateral_quantity: 0 on every row, so that term is reasoned-from-the-model, not
// observed. It is the one line here that a real pledged holding has never exercised.
function heldQuantity(h: KiteHolding): number {
  return qty(h.quantity) + qty(h.t1_quantity) + qty(h.collateral_quantity);
}

/** One pool → a number. Absent / null / non-numeric ⇒ 0, NEVER NaN: this value goes straight into
 *  a `new Prisma.Decimal()` at the storage seam, which THROWS on NaN — so one odd field on one row
 *  would fail the entire sync. Each pool is coerced independently so a bad one cannot poison the sum. */
function qty(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Pull the request_token out of the opaque callback bag (Kite calls it `request_token`). */
function pickRequestToken(params?: Record<string, unknown>): string | null {
  if (!params) return null;
  const v = params.request_token ?? params.requestToken;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Kite invalidates access tokens daily at ~6:00 AM IST (== 00:30 UTC). Next such instant. */
function nextKiteExpiry(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(0, 30, 0, 0); // 06:00 IST
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
