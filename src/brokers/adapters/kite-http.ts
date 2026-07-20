// ═══════════════════════════════════════════════════════════════════════
// KITE CONNECT HTTP SEAM — the two Kite HTTP calls the Zerodha adapter makes, behind an
// interface so the harness can inject a mock (Zerodha has NO sandbox — real end-to-end is a
// manual operator test). The real client uses global fetch → api.kite.trade.
//
// SECRET HYGIENE: this layer never logs request/response bodies or the Authorization header,
// and its errors carry ONLY Kite's own status/message (which never contains OUR api_secret,
// request_token, or access_token). A 403 (TokenException) is surfaced as KiteTokenError so
// the adapter can translate it to BrokerSessionError.
// ═══════════════════════════════════════════════════════════════════════

/** Kite's /session/token response payload (`data` unwrapped). */
export interface KiteSessionResponse {
  access_token: string;
  user_id?: string;
  [k: string]: unknown;
}

/** One row of Kite's /portfolio/holdings response.
 *
 *  `isin` + `exchange` are documented Kite response attributes (Kite Connect v3, GET
 *  /portfolio/holdings) that this type simply never declared — the index signature below meant
 *  they arrived on the wire and were silently dropped at normalize(). They are declared now
 *  because ISIN is the universe's dedup spine: without it an unknown holding can never become a
 *  stock. Optional, because we do not control the broker: a row without an ISIN is a fact to
 *  handle, not an error to throw.
 *
 *  ── EVERY QUANTITY KITE SENDS IS DECLARED HERE, INCLUDING THE ONES WE DO NOT COUNT. ──
 *  Kite splits ONE position across SEVERAL pools, and `quantity` is only one of them: it answers
 *  "what can you SELL today", not "what do you OWN". Until this type named the others they
 *  arrived through the index signature below and were dropped without a trace — and a live sync
 *  of a real book mirrored 3 GOLDBEES, 1 NIFTYBEES and 2 ONGC as 0/0/0, because every share sat
 *  in T1. A field an index signature absorbs is a field nobody knows exists; that is exactly how
 *  it survived. So the pools we DON'T count are declared too, with why — the next reader should
 *  not have to re-derive that from Kite's docs. All optional: we do not control the broker, and a
 *  pool it omits is a fact to handle (→ 0), not an error to throw. */
export interface KiteHolding {
  tradingsymbol: string;
  /** SETTLED and free in the demat — sellable today. NOT the whole position (see t1/collateral). */
  quantity: number;
  /** BOUGHT, YOURS, NOT YET SETTLED (T+1). Owned and fully price-exposed, merely not sellable
   *  yet. COUNTED as held. */
  t1_quantity?: number;
  /** PLEDGED for margin. Still owned, still fully exposed to price — being unable to sell is a
   *  LIQUIDITY fact, not an OWNERSHIP one. COUNTED as held: we are portfolio analytics, not a
   *  trading terminal, and a book that quietly shrank when the user pledged would understate them. */
  collateral_quantity?: number;
  /** SOLD today, out of the holding. Not owned → never counted. */
  realised_quantity?: number;
  /** Start-of-day snapshot, not a live pool — it OVERLAPS the pools above (in the live payload:
   *  3, equal to t1_quantity, while quantity is 0), so adding it would double-count. Never counted. */
  opening_quantity?: number;
  /** Authorised (CDSL TPIN) for debit — a PERMISSION over shares already counted in `quantity`,
   *  not a pool of its own. Never counted: it would double-count what it describes. */
  authorised_quantity?: number;
  /** Consumed by today's orders — intra-day accounting over the pools above, not a pool. Never counted. */
  used_quantity?: number;
  /** Short — sold beyond what is held. Not ownership. Never counted. */
  short_quantity?: number;
  average_price: number;
  last_price?: number;
  isin?: string;
  exchange?: string;
  [k: string]: unknown;
}

export interface KiteHoldingsResponse {
  data: KiteHolding[];
}

/** The seam the adapter depends on. The adapter computes the checksum (with api_secret) and
 *  passes it in — so this layer never sees the raw secret, only the derived checksum. */
export interface KiteHttpClient {
  /** POST /session/token — exchange request_token (+ checksum) → session. */
  createSession(input: { apiKey: string; requestToken: string; checksum: string }): Promise<KiteSessionResponse>;
  /** GET /portfolio/holdings — the user's holdings for a live access_token. */
  getHoldings(input: { apiKey: string; accessToken: string }): Promise<KiteHoldingsResponse>;
}

/** A Kite TokenException (403) — the session is invalid/expired. The adapter maps it to
 *  BrokerSessionError so the lifecycle marks the connection dead. */
export class KiteTokenError extends Error {
  constructor(message = "kite token is invalid or expired") {
    super(message);
    this.name = "KiteTokenError";
  }
}

const API_BASE = "https://api.kite.trade";

/** Kite's error body is `{ status, message, error_type }`. Return ONLY the message (safe —
 *  it never echoes our secrets), never the request we sent. */
function safeKiteMessage(json: unknown): string {
  const m = (json as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "unknown error";
}

export class RealKiteHttpClient implements KiteHttpClient {
  async createSession(input: { apiKey: string; requestToken: string; checksum: string }): Promise<KiteSessionResponse> {
    const body = new URLSearchParams({
      api_key: input.apiKey,
      request_token: input.requestToken,
      checksum: input.checksum,
    });
    const resp = await fetch(`${API_BASE}/session/token`, {
      method: "POST",
      headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await resp.json().catch(() => ({}))) as { data?: KiteSessionResponse };
    if (!resp.ok) {
      if (resp.status === 403) throw new KiteTokenError();
      // No request_token / checksum / api_secret in the message — only Kite's own text.
      throw new Error(`kite session exchange failed (${resp.status}): ${safeKiteMessage(json)}`);
    }
    if (!json.data?.access_token) throw new Error("kite session exchange returned no access_token");
    return json.data;
  }

  async getHoldings(input: { apiKey: string; accessToken: string }): Promise<KiteHoldingsResponse> {
    const resp = await fetch(`${API_BASE}/portfolio/holdings`, {
      headers: {
        "X-Kite-Version": "3",
        // The access_token lives only in this header, never logged.
        Authorization: `token ${input.apiKey}:${input.accessToken}`,
      },
    });
    const json = (await resp.json().catch(() => ({}))) as { data?: KiteHolding[] };
    if (!resp.ok) {
      if (resp.status === 403) throw new KiteTokenError();
      throw new Error(`kite holdings fetch failed (${resp.status}): ${safeKiteMessage(json)}`);
    }
    return { data: Array.isArray(json.data) ? json.data : [] };
  }
}
