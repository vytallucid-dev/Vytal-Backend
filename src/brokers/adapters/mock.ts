// ═══════════════════════════════════════════════════════════════════════
// MOCK ADAPTER — the reference broker. Implements BrokerAdapter with NO real OAuth
// and NO network, so the broker-agnostic core (lifecycle · encrypted storage · sync ·
// clear) can be proven end-to-end before a real broker exists (Zerodha = Phase 2).
//
// It is a FAITHFUL stand-in, not a stub:
//   • authenticate() mints a real BrokerSession with a secret access token + an expiry,
//     and BAKES its fixture holdings INTO the session so the whole broker state survives
//     the encrypt → store → decrypt round-trip the core puts every session through.
//   • isSessionAlive() derives liveness from the expiry (like a real daily-expiring token).
//   • fetchHoldings() returns a broker-SHAPED raw payload (Zerodha-ish field names) and
//     throws BrokerSessionError on a dead session — exactly as a real 401 would.
//   • normalize() does a REAL field remap (tradingsymbol → symbol, average_price →
//     avgCost, quantity × last_price → currentValue), proving the normalize seam works.
// ═══════════════════════════════════════════════════════════════════════
import {
  type BrokerAdapter,
  type BrokerAuthContext,
  type BrokerMeta,
  type BrokerSession,
  type RawHoldings,
  type StandardHolding,
  BrokerSessionError,
} from "../types.js";

/** The broker's OWN raw holdings shape (deliberately Zerodha-ish so normalize() has real
 *  work to do). The core never sees this type — only MockAdapter.normalize consumes it. */
interface MockRawHoldings {
  broker: "mock";
  data: Array<{
    tradingsymbol: string;
    /** Step 7: the IDENTITY fields Kite really sends. Optional here ON PURPOSE — the fixture must
     *  be able to produce an ISIN-LESS row, because that is the case add-to-universe cannot serve
     *  and must fall back on. A mock that always supplies an ISIN would never exercise it. */
    isin?: string;
    exchange?: string;
    quantity: number;
    average_price: number; // ₹/share avg cost
    last_price: number; // ₹/share current
    product: string; // CNC / MIS … (ignored by normalize; proves we drop broker noise)
  }>;
}

/** Default fixture: real universe symbols so mapped-vs-unmapped + enrichment can be
 *  exercised. FAKESTOCK is intentionally NOT in the 505 universe — it proves the
 *  snapshot-mirror law (stored verbatim, stock_id null, unscored) at the storage seam. */
const DEFAULT_FIXTURE: MockRawHoldings["data"] = [
  { tradingsymbol: "RELIANCE", isin: "INE002A01018", exchange: "NSE", quantity: 10, average_price: 2400.5, last_price: 2950.0, product: "CNC" },
  { tradingsymbol: "TCS", isin: "INE467B01029", exchange: "NSE", quantity: 5, average_price: 3200.0, last_price: 3850.25, product: "CNC" },
  { tradingsymbol: "INFY", isin: "INE009A01021", exchange: "NSE", quantity: 20, average_price: 1400.75, last_price: 1620.0, product: "CNC" },
  // FAKESTOCK carries NO ISIN, DELIBERATELY. It is outside our universe AND unidentifiable, so it
  // is the one holding add-to-universe (Step 7) must REFUSE to admit — it keeps exercising the
  // null-stock held-not-scored path and the Step-6 rescue guard, which do not go away just
  // because most brokers send an ISIN. The fixture must keep the un-servable case alive, or we
  // would only ever test the happy path. (A harness that wants an ADMISSIBLE unknown symbol
  // passes its own row with an isin via params.mockHoldings.)
  { tradingsymbol: "FAKESTOCK", quantity: 3, average_price: 100.0, last_price: 90.0, product: "CNC" },
];

/** Recognisable marker inside the secret token — the encryption-at-rest test asserts THIS
 *  never appears in the stored blob (i.e. the column holds ciphertext, not the token). */
export const MOCK_TOKEN_MARKER = "MOCK_SECRET_ACCESS_TOKEN";

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — a realistic intraday token life

/** The mock's stand-in for a Kite client code. Deterministic: a re-auth of the "same demat"
 *  yields the same ref, so the connection upsert updates rather than duplicates. */
export const DEFAULT_ACCOUNT_REF = "MOCK0001";

export class MockAdapter implements BrokerAdapter {
  readonly meta: BrokerMeta = {
    id: "mock",
    displayName: "Mock Broker",
    logoRef: "brokers/mock.svg",
  };

  /**
   * Mint a session. Honours these test directives via ctx.params:
   *   • `mockExpired: true`  → an already-expired session (proves the dead-session path)
   *   • `mockHoldings: StandardHolding-ish rows` → override the fixture (proves overwrite-
   *      on-sync when a later sync returns a different snapshot)
   *   • `mockAccountRef: string` → the broker's per-account id. TWO different refs under one
   *      (user, broker) = two demats = two connections (the multi-account property). Re-using
   *      a ref = re-linking the SAME demat → updates that connection, never duplicates it.
   *   • `mockNoAccountRef: true` → return a null accountRef, so the harness can prove the
   *      core FAILS LOUD rather than persisting an unkeyed connection.
   * The fixture is baked into session.meta so it travels with the encrypted blob.
   */
  async authenticate(ctx: BrokerAuthContext): Promise<BrokerSession> {
    const expired = ctx.params?.mockExpired === true;
    const ttlMs = expired ? -1000 : DEFAULT_TTL_MS;
    const data = (ctx.params?.mockHoldings as MockRawHoldings["data"] | undefined) ?? DEFAULT_FIXTURE;

    // Deterministic default so a plain re-auth is idempotent (same demat ⇒ same ref ⇒ the
    // connection upsert UPDATES). Overridable so a harness can mint a genuinely second demat.
    const accountRef =
      ctx.params?.mockNoAccountRef === true
        ? null
        : ((ctx.params?.mockAccountRef as string | undefined) ?? DEFAULT_ACCOUNT_REF);

    return {
      broker: "mock",
      // A secret, per-session token. The marker lets the harness prove it is encrypted at
      // rest; the userId suffix proves the session is bound to the authenticated owner.
      accessToken: `${MOCK_TOKEN_MARKER}:${ctx.userId}:${Math.abs(hashStr(ctx.userId + ttlMs))}`,
      refreshToken: null,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      accountRef, // the broker's client code (mock stands in for a Kite user_id)
      meta: { rawHoldings: { broker: "mock", data } satisfies MockRawHoldings },
    };
  }

  async isSessionAlive(session: BrokerSession): Promise<boolean> {
    if (session.expiresAt == null) return true; // non-expiring (not used by mock, honoured anyway)
    return Date.parse(session.expiresAt) > Date.now();
  }

  async fetchHoldings(session: BrokerSession): Promise<RawHoldings> {
    // A real broker returns 401 on an expired token; we mirror that as BrokerSessionError
    // so the core marks the connection dead rather than storing a bad snapshot.
    if (!(await this.isSessionAlive(session))) {
      throw new BrokerSessionError("mock", "mock session expired");
    }
    const raw = session.meta?.rawHoldings as MockRawHoldings | undefined;
    return raw ?? ({ broker: "mock", data: [] } satisfies MockRawHoldings);
  }

  normalize(raw: RawHoldings): StandardHolding[] {
    const r = raw as MockRawHoldings;
    if (!r || !Array.isArray(r.data)) return [];
    return r.data.map((row) => ({
      symbol: String(row.tradingsymbol).trim().toUpperCase(),
      quantity: Number(row.quantity),
      avgCost: Number(row.average_price),
      // Broker gives last_price; the position's current value is qty × last_price.
      currentValue: row.last_price != null ? Number(row.quantity) * Number(row.last_price) : null,
      // Same coercion as the real adapter: "" is not an ISIN, it is an absence.
      isin: typeof row.isin === "string" && row.isin.trim() !== "" ? row.isin.trim().toUpperCase() : null,
      exchange: typeof row.exchange === "string" && row.exchange.trim() !== "" ? row.exchange.trim().toUpperCase() : null,
    }));
  }
}

/** Tiny deterministic string hash (no crypto needed) — just to vary the fake token. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
