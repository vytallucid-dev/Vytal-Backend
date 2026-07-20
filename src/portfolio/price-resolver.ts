// ═══════════════════════════════════════════════════════════════════════
// THE PRICE RESOLVER (Step 14.5) — what is ONE unit of this instrument worth, and says who said so.
//
// THE GAP THIS CLOSES. Every portfolio surface priced a holding by reading `stock_prices` keyed on
// `stock_id`. A non-stock instrument has `stock_id = NULL` by construction (that is exactly what
// makes it held-not-scored), so it resolved to `undefined` → `currentPrice: null` → `marketValue:
// null`. The 337 ETFs loaded in Step 13 and the 21 trusts loaded in Step 14 were therefore HELD but
// never VALUED: a user saw a name and a quantity, and no ₹ beside it. (Two comments in src/brokers
// claimed they were "held and valued". They were not. They are now.)
//
// ONE RESOLVER, SHARED BY BOTH SURFACES — the display read (holdings-controller) and the disclosure
// read (phs/assemble) both call this, so they can never disagree about whether a position is
// priceable. They disagreed before: holdings-controller keyed "unvaluable" on `stockId == null`
// while phs/assemble keyed it on "no price row", and a broker-admitted stock with no bhavcopy row
// yet fell down the gap between those two answers.
//
// THE PRECEDENCE, AND WHY IT IS IN THIS ORDER:
//   1. stock          → `stock_prices` (UNCHANGED — the equity path is not touched by this file).
//   2. exchange close → `instruments.last_price`. What the thing actually TRADES at.
//   3. AMFI NAV       → `instruments.current_nav`. What one unit is WORTH.
//
// (2) beats (3) deliberately, and only ETFs can even have both. A NAV is not a price: a listed ETF
// trades at a premium or discount to its NAV, sometimes by several percent, and the user cannot
// transact at the NAV. If we know what it traded at, that is the honest number. The NAV stays on
// the row — a later surface may well want to show the spread between them — but it is the FALLBACK,
// used for the 9 ETFs NSE does not list, and for mutual funds, which have no market price at all
// because they do not trade.
//
// STALENESS IS A REFUSAL, NOT A FOOTNOTE. A fund whose `is_active` is false is one AMFI has STOPPED
// PRICING — a matured BHARAT Bond ETF still carrying its April-2025 NAV, a wound-up scheme still
// carrying its last. Valuing a holding at that number and printing it as "current value" is exactly
// the lie this codebase refuses. So a dormant fund resolves to NULL, with a reason. `is_active`
// already means precisely this (Step 9/13 compute it from the file), so there is no new threshold
// to invent and no new staleness rule to get wrong.
//
// An exchange close carries no such gate: a thinly-traded trust that last printed on Thursday is
// LIVE, merely illiquid. Its price is honestly dated to Thursday (`asOf`), and the date is returned
// so no surface can render the number without it.
//
// EVERY UNPRICED ANSWER CARRIES A REASON. `null` alone tells a user nothing; `null` + "this fund is
// dormant" tells them the truth. There is no branch in this file that returns 0.
// ═══════════════════════════════════════════════════════════════════════

/** Where a resolved price came from. Rendered as provenance — never a scoring input. */
export type PriceSource =
  /** `stock_prices` — the equity EOD path (bhavcopy → daily_prices → stock_prices). */
  | "stock_price"
  /** `instruments.last_price` — the exchange close (NSE udiff BhavCopy). Trusts, and listed ETFs. */
  | "exchange_close"
  /** `instruments.current_nav` — the AMFI NAV. Mutual funds, and ETFs NSE does not list. */
  | "amfi_nav";

/** WHY we have no price. An honest empty always says which. */
export type UnpricedReason =
  /** A broker symbol outside our universe — no catalogue row at all. Nothing to price. */
  | "no_instrument"
  /** In the catalogue, but no price has landed yet (e.g. a stock just admitted from a broker feed
   *  that has not appeared in a bhavcopy). Real shares, no number — say so, never imply ₹0.
   *
   *  THE "YET" IS A PROMISE, and it is only made where it can be kept: this instrument is expected
   *  to price, and simply has not. For one we do NOT expect to price, see `not_exchange_traded`. */
  | "no_price_yet"
  /** STEP 17 — a bond that DOES NOT TRADE ON AN EXCHANGE WE READ. Indian corporate debt is
   *  overwhelmingly privately placed, BSE-listed or traded OTC (RFQ / NDS-OM), so a bond a broker
   *  surfaced may never appear in an NSE BhavCopy at all. It has no close, and it is not going to
   *  get one.
   *
   *  WHY THIS IS NOT `no_price_yet`. "Yet" is a claim about the FUTURE, and for this instrument it
   *  is a claim we cannot keep. Telling a user their value is coming when it is not is a small lie
   *  that never resolves — the UI would show a permanent spinner-in-prose. This says the true thing
   *  instead: we cannot value this, and we do not expect to. Their NAME, QUANTITY and INVESTED
   *  AMOUNT are all still shown (see brokers/union.ts) — only the current value is absent. */
  | "not_exchange_traded"
  /** A fund AMFI has stopped pricing (matured / wound up). We hold a last-known NAV and REFUSE to
   *  present it as current. The value is not unknown-because-missing; it is unknown-because-stale. */
  | "dormant";

export interface ResolvedPrice {
  price: number | null;
  prevClose: number | null;
  dayChangePct: number | null;
  /** The day this price BELONGS to (YYYY-MM-DD). A price must never be rendered without it. */
  asOf: string | null;
  source: PriceSource | null;
  /** null ⇔ priced. Set ⇔ price is null and this is why. */
  unpricedReason: UnpricedReason | null;
}

/** The `stock_prices` row for a stock holding (the equity path — unchanged). */
export interface StockPriceInput {
  price: unknown;
  prevClose: unknown;
  dayChangePct: unknown;
  priceDate?: Date | null;
}

/** The catalogue row for a non-stock holding. */
export interface InstrumentPriceInput {
  assetClass: string;
  lastPrice: unknown;
  lastPriceDate: Date | null;
  currentNav: unknown;
  navDate: Date | null;
  isActive: boolean;
}

/** The newest `instrument_prices` row — the ONLY place a non-stock previous close exists. */
export interface InstrumentPrevInput {
  close: unknown;
  prevClose: unknown;
  date: Date;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

const UNPRICED = (unpricedReason: UnpricedReason): ResolvedPrice => ({
  price: null,
  prevClose: null,
  dayChangePct: null,
  asOf: null,
  source: null,
  unpricedReason,
});

/**
 * Resolve one position's unit price.
 *
 * `stockId` set ⇒ the equity path, and NOTHING below the first branch can run. That is the
 * byte-identical guarantee: a stock holding is priced by exactly the read it was priced by before
 * this file existed.
 */
export function resolvePrice(args: {
  stockId: string | null;
  instrumentId: string | null;
  stockPrice: StockPriceInput | undefined;
  instrument: InstrumentPriceInput | undefined;
  /** Newest instrument_prices row, for the day-change. Absent ⇒ no day-change, price still stands. */
  instrumentPrev?: InstrumentPrevInput | undefined;
}): ResolvedPrice {
  const { stockId, instrumentId, stockPrice, instrument, instrumentPrev } = args;

  // ── 1. STOCK — the equity path. UNCHANGED, and deliberately first. ──────────────────────
  if (stockId) {
    const price = num(stockPrice?.price);
    if (price == null) return UNPRICED("no_price_yet"); // admitted from a broker, no bhavcopy row yet
    return {
      price,
      prevClose: num(stockPrice?.prevClose),
      dayChangePct: num(stockPrice?.dayChangePct),
      asOf: day(stockPrice?.priceDate ?? null),
      source: "stock_price",
      unpricedReason: null,
    };
  }

  // ── No catalogue row at all → nothing to price. Never invent one. ───────────────────────
  if (!instrumentId || !instrument) return UNPRICED("no_instrument");

  // ── 2. EXCHANGE CLOSE — what it actually trades at. Beats NAV wherever both exist. ──────
  const lastPrice = num(instrument.lastPrice);
  if (lastPrice != null) {
    // The previous close lives only in instrument_prices (the snapshot columns carry the close and
    // its date, not the day before). Absent ⇒ the day-change is honestly null; the PRICE still stands.
    const prev = num(instrumentPrev?.prevClose);
    return {
      price: lastPrice,
      prevClose: prev,
      dayChangePct: prev != null && prev > 0 ? (lastPrice - prev) / prev : null,
      asOf: day(instrument.lastPriceDate),
      source: "exchange_close",
      unpricedReason: null,
    };
  }

  // ── 3. AMFI NAV — the fallback. Gated on is_active: a dormant fund's NAV is NOT current. ──
  const nav = num(instrument.currentNav);
  if (nav != null) {
    if (!instrument.isActive) return UNPRICED("dormant"); // matured/wound-up — refuse to price it
    return {
      price: nav,
      prevClose: null, // there is no NAV-history table (compute-and-discard) → no previous NAV
      dayChangePct: null, // …so no day-change. Honestly absent, never 0.
      asOf: day(instrument.navDate),
      source: "amfi_nav",
      unpricedReason: null,
    };
  }

  // ── 4. IN THE CATALOGUE, AND NOT PRICED. The two reasons are different promises. ─────────
  //
  // A BOND (Step 17) that has reached here has no exchange close, and the honest question is whether
  // it is ever going to get one. Corporate debt in India is overwhelmingly privately placed,
  // BSE-listed, or traded OTC — the 356 NSE-traded bonds all carry a close and take the branch
  // above, so a `bond` landing HERE is one a BROKER surfaced that the NSE BhavCopy has never shown
  // us. Saying "no price YET" would promise a number that is not coming.
  //
  // Everything else here — a stock just admitted from a broker feed, an instrument between its
  // creation and its first bhavcopy — genuinely IS waiting for a price that will arrive.
  if (instrument.assetClass === "bond") return UNPRICED("not_exchange_traded");
  return UNPRICED("no_price_yet");
}
