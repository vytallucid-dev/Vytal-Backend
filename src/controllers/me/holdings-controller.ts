// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO HOLDINGS — the authenticated user's WHOLE book: manual (FIFO lot-replay) ⊎
// broker (mirrored snapshot), across every account they own, enriched with the live read
// layer (price · health · tier) every portfolio surface needs.
//
//   GET /api/v1/me/holdings            current positions (qty>0), per-position
//                                      currentPrice / marketValue / dayChange / health+band /
//                                      tier / weight, + book totals
//   GET /api/v1/me/holdings?includeExited=true   also manual rows fully exited (qty=0),
//                                                 whose realized_pnl still matters
//
// Reads the UNION (Step 5). Until now this endpoint queried `holdings` directly and was
// therefore BLIND to broker positions — a user with a linked demat saw a partial book on the
// one screen that claims to show everything.
//
// ── THE WHOLE POINT OF THIS FILE: null ≠ 0 ────────────────────────────────────────────────
// A manual position has a cost basis (FIFO): avgCost, investedValue, realizedPnl, a lot register.
// A broker position has NONE of those. We MIRROR the broker, we do not recompute it (§2.2), and
// the holdings feed carries no cost history — so those fields are `null`: HONESTLY ABSENT.
//
//   • `realizedPnl: "0"`  on a manual row means "nothing was realized" — a FACT we computed.
//   • `realizedPnl: null` on a broker row means "we do not know" — the ABSENCE of a fact.
// They render as "0" and "—". Collapsing the second into the first would state, on the user's
// behalf, something we never established. Both inhabit the SAME TypeScript field, so nothing but
// a live assertion can keep them apart — hence the harness asserts `=== null`, not "is falsy".
//
// Every TOTAL therefore sums only the rows that HAVE the value, and says so (`totals.partial`).
// Coercing null→0 in a sum is the same lie wearing arithmetic — and it is worse than an omission:
// unrealized = marketValue(incl. broker) − invested(excl. broker) would hand back a broker
// position's ENTIRE market value as phantom profit. So: no null→0, anywhere, ever.
//
// `currentValue` is the ONE total broker rows legitimately join: we value every share with OUR
// price (§2.4), so a market value exists for every mapped row regardless of who reported it.
//
// Nothing is scored here; composite/band/tier are READ, never recomputed. Owner =
// req.authUser.userId (IDOR-proof — no id/userId input).
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { listUnifiedPositions } from "../../brokers/union.js";
import { resolvePrice, type InstrumentPrevInput } from "../../portfolio/price-resolver.js";
import { disclosuresFor, holdingDisclosureNotes } from "../../portfolio/disclosures.js";
// (Combined-book display) The SAME entity key the Construction engine collapses on — reused here, never
// re-derived, so the holdings table can group by issuer exactly as the engine does (RELIANCE across two
// accounts = one entity; an NTPC stock + bond = one entity). `null` for baskets/gold/sovereign, which are
// never aggregated by issuer — the display groups those by isin (same instrument across accounts) instead.
import { entityKeyOf, type AssetClass } from "../../portfolio/phs/entity.js";

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** Sum ONLY the rows that have the value. `null` is SKIPPED, never read as 0 — and we return how
 *  many were skipped, so a partial total can never quietly pass itself off as a complete one. */
function sumPresent(values: (number | null)[]): { total: number; missing: number } {
  let total = 0;
  let missing = 0;
  for (const v of values) {
    if (v == null) missing++;
    else total += v;
  }
  return { total, missing };
}

export const listHoldings = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const includeExited = String(req.query.includeExited ?? "") === "true";

  // THE UNION: manual (FIFO) ⊎ broker (snapshot), every account, fresh AND frozen. IDOR-scoped —
  // userId comes from the token, and every row the union returns is bound to it.
  const positions = await listUnifiedPositions(userId, { includeExited });

  // ── Enrichment keys ──
  const stockIds = [...new Set(positions.flatMap((p) => (p.stockId ? [p.stockId] : [])))];
  const instrumentIds = [...new Set(positions.flatMap((p) => (p.instrumentId ? [p.instrumentId] : [])))];
  const holdingIds = positions.flatMap((p) => (p.holdingId ? [p.holdingId] : []));

  // ── Bulk read layer (no N+1). Latest-per-stock resolved in JS from the ordered rows,
  //    mirroring assemblePortfolio's per-stock findFirst ordering exactly. ──
  const [stocks, instruments, manualDetail, prices, scores, tiers] = await Promise.all([
    prisma.stock.findMany({
      where: { id: { in: stockIds } },
      select: { id: true, symbol: true, name: true, sector: { select: { name: true, displayName: true } } },
    }),
    // An instrument with NO stock (an ETF / REIT / InvIT / fund) still renders — with its own name
    // — rather than being silently dropped. (Step 14.5) It is now also PRICED: the class + both
    // price columns ride this same read, so resolvePrice needs no extra query per row.
    prisma.instrument.findMany({
      where: { id: { in: instrumentIds } },
      select: {
        id: true,
        isin: true, // the dedup spine — served so the display can group by instrument/issuer like the engine
        symbol: true,
        name: true,
        assetClass: true,
        category: true, // the AMFI leaf — `natureOf` needs it to tell a gold ETF (commodity) from a basket
        attributes: true, // (T-1) `couponNullReason` lives here — a T-bill pays no coupon to disclose
        lastPrice: true, // the exchange close (trusts; listed ETFs)
        lastPriceDate: true,
        currentNav: true, // the AMFI NAV (funds; the 9 ETFs NSE does not list)
        navDate: true,
        isActive: true, // false ⇒ AMFI stopped pricing it → the NAV is NOT current (see resolver)
        amfiSchemeCode: true, // funds/ETFs only — served as `schemeCode` so the display can link to the fund page
      },
    }),
    // The manual-only facts the union deliberately does not carry: the FIFO lot register and the
    // replay stamp. Joined by holdingId (identity, Step 5). A broker row has neither, by nature.
    prisma.holding.findMany({
      where: { id: { in: holdingIds } },
      select: {
        id: true,
        lastComputedAt: true,
        lots: { orderBy: { buyDate: "asc" }, select: { quantity: true, costPerShare: true, buyDate: true, sourceTxnId: true } },
      },
    }),
    prisma.stockPrice.findMany({
      where: { stockId: { in: stockIds } },
      select: { stockId: true, price: true, prevClose: true, dayChangePct: true, priceDate: true },
    }),
    prisma.scoreSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
      select: { stockId: true, composite: true, labelBand: true, asOfDate: true },
    }),
    prisma.marketCapTierSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: { asOfDate: "desc" },
      select: { stockId: true, tier: true },
    }),
  ]);

  // (Step 14.5) The NEWEST instrument_prices row per held non-stock instrument — the ONLY place a
  // non-stock PREVIOUS close exists (the snapshot columns carry the close and its date, not the day
  // before). It buys the day-change for trusts and listed ETFs; a NAV-priced fund has no previous
  // NAV to compare against (there is no NAV-history table, by design), so its day-change stays
  // honestly null. One DISTINCT ON over the held instruments — not a query per row.
  const instrPrevBy = new Map<string, InstrumentPrevInput>();
  if (instrumentIds.length > 0) {
    const prevRows = await prisma.$queryRawUnsafe<
      { instrument_id: string; close: unknown; prev_close: unknown; date: Date }[]
    >(
      `SELECT DISTINCT ON (instrument_id) instrument_id, close, prev_close, date
         FROM instrument_prices
        WHERE instrument_id = ANY($1::text[])
        ORDER BY instrument_id, date DESC`,
      instrumentIds,
    );
    for (const r of prevRows) {
      instrPrevBy.set(r.instrument_id, { close: r.close, prevClose: r.prev_close, date: r.date });
    }
  }

  const stockBy = new Map(stocks.map((s) => [s.id, s]));
  const instrBy = new Map(instruments.map((i) => [i.id, i]));
  const detailBy = new Map(manualDetail.map((h) => [h.id, h]));
  const priceBy = new Map(prices.map((p) => [p.stockId, p]));
  const scoreBy = new Map<string, (typeof scores)[number]>();
  for (const s of scores) if (!scoreBy.has(s.stockId)) scoreBy.set(s.stockId, s); // first = latest
  const tierBy = new Map<string, string>();
  for (const t of tiers) if (!tierBy.has(t.stockId)) tierBy.set(t.stockId, t.tier); // first = latest

  const enriched = positions.map((p) => {
    const stock = p.stockId ? stockBy.get(p.stockId) : undefined;
    const instr = p.instrumentId ? instrBy.get(p.instrumentId) : undefined;
    const detail = p.holdingId ? detailBy.get(p.holdingId) : undefined;
    const score = p.stockId ? scoreBy.get(p.stockId) : undefined;

    const qty = Number(p.quantity);
    // HONEST-EMPTY: no cost basis ⇒ null, NOT 0. Every broker row lands here.
    const invested = p.investedValue == null ? null : Number(p.investedValue);

    // (Step 14.5) ONE resolver, shared with the disclosure read, so the two surfaces can never
    // disagree about whether a position is priceable. A STOCK takes the first branch and is priced
    // by exactly the `stock_prices` read it always was — byte-identical. A non-stock instrument now
    // resolves to its exchange close (trust / listed ETF) or its AMFI NAV (fund / unlisted ETF),
    // and a dormant fund honestly resolves to NULL rather than to a matured scheme's last NAV.
    const resolved = resolvePrice({
      stockId: p.stockId,
      instrumentId: p.instrumentId,
      stockPrice: p.stockId ? priceBy.get(p.stockId) : undefined,
      instrument: instr,
      instrumentPrev: p.instrumentId ? instrPrevBy.get(p.instrumentId) : undefined,
    });

    const currentPrice = resolved.price;
    const prevClose = resolved.prevClose;
    const dayChangePct = resolved.dayChangePct;
    // OUR price × qty — for every share, whoever reported it (§2.4). A FROZEN (stale) broker row
    // is therefore marked to TODAY's market: only its quantity is last-known, never its value.
    const marketValue = currentPrice != null ? qty * currentPrice : null;
    const dayChangeValue = currentPrice != null && prevClose != null ? qty * (currentPrice - prevClose) : null;
    // Needs BOTH a market value and a cost basis. NEVER `marketValue − 0`, which would report the
    // position's entire value as profit — the phantom-profit bug Step 5 exists to prevent, and the
    // reason this is a null-GUARD rather than a subtraction with a default.
    //
    // (Step 17) A BROKER row now satisfies both: it has our market value and a real cost basis
    // (quantity × the broker's avgCost). So it finally reports an honest unrealized P&L instead of a
    // dash. The guard is unchanged and still does its job — there is simply nothing left for it to
    // guard against on this row, because `invested` is no longer null to begin with.
    const unrealizedPnl = marketValue != null && invested != null ? marketValue - invested : null;

    // (Disclosure taxonomy) The Step-20 disclosures this holding carries — computed ONCE and reused for
    // both the raw `disclosures` codes (unchanged) and the enriched `disclosureNotes` below.
    const attrs = instr?.attributes as Record<string, unknown> | null;
    const holdingDisclosures = disclosuresFor(instr?.assetClass, attrs);

    // (Combined-book display) The engine's issuer key — name-risk holdings collapse on it (RELIANCE's two
    // accounts, an NTPC stock+bond), baskets/gold/sovereign get `null` (never aggregated by issuer). The
    // display groups on `entityKey ?? isin`, so it matches the Construction entity count exactly.
    const entityKey = entityKeyOf({
      symbol: instr?.symbol ?? stock?.symbol ?? p.symbol,
      marketValue: marketValue ?? 0,
      isin: instr?.isin ?? null,
      assetClass: (instr?.assetClass ?? undefined) as AssetClass | undefined,
      category: instr?.category ?? null,
    });

    return {
      symbol: stock?.symbol ?? instr?.symbol ?? p.symbol,
      name: stock?.name ?? instr?.name ?? null,
      sector: stock?.sector?.displayName ?? stock?.sector?.name ?? null,
      /** (Combined-book display) The immutable security id + the engine's issuer key, so the Health
       *  holdings table can aggregate across accounts exactly as Construction does. Additive — no
       *  existing consumer reads them. */
      isin: instr?.isin ?? null,
      entityKey,
      /** (Stored-series sparkline) The catalogue instrument id — the KEY for
       *  GET /instruments/:instrumentId/series (the stored weekly NAV). The union already carries it;
       *  it was simply never served. null for a broker symbol outside our universe (no instrument).
       *  Additive — no existing consumer reads it. */
      instrumentId: p.instrumentId,
      /** (Fund-page link) The instrument's AMFI scheme code — funds/ETFs only; null for
       *  stock/bond/gsec/sgb/reit/invit (they carry none). A passthrough of instruments.amfi_scheme_code
       *  (already joined — no new query). The frontend links a fund/ETF row to /research/funds/{schemeCode}
       *  and gates that link on presence; the series sparkline keys off `instrumentId`, not this. Additive. */
      schemeCode: instr?.amfiSchemeCode ?? null,
      quantity: p.quantity,
      avgCost: p.avgCost, // manual → FIFO weighted-avg of open lots. broker → the broker's, as-given.
      // (Step 17) Present on BOTH sides now: manual → FIFO Σ(open lot qty × cost); broker → quantity
      // × the broker's avgCost. Needs no price of ours, so it survives an unpriceable holding — which
      // is the whole point: a bond we cannot value still shows what the user put into it.
      investedValue: p.investedValue,
      realizedPnl: p.realizedPnl, // null ⇒ broker (no LOT REGISTER — a snapshot has none, and we do
      //                             not invent one). "0" on a manual row is a REAL zero. This is the
      //                             honest-null that REMAINS after Step 17 gave broker rows a cost basis.
      lastComputedAt: detail?.lastComputedAt.toISOString() ?? null, // manual: the FIFO replay stamp
      // ── live read layer (null = honestly not available, never faked) ──
      currentPrice,
      marketValue,
      dayChangePct,
      dayChangeValue,
      unrealizedPnl, // null ⇒ no cost basis to measure against
      // ── (Step 14.5) PRICE PROVENANCE — a number the user can interrogate. ──
      /** stock_price | exchange_close | amfi_nav — WHO said so. null ⇔ unpriced. */
      priceSource: resolved.source,
      /** The day this price belongs to. A trust that last traded on Thursday says Thursday; an
       *  ETF valued off Friday's NAV says Friday. A price rendered without its date is a lie
       *  waiting to happen — so the date always travels with it. */
      priceAsOf: resolved.asOf,
      /** null ⇔ priced. Otherwise WHY not: no_instrument | no_price_yet | not_exchange_traded | dormant
       *  (the full UnpricedReason enum — see price-resolver.ts; `not_exchange_traded` was the 4th, added
       *  for OTC debt that never reaches a BhavCopy). The rendered sentence + tone ride in disclosureNotes. */
      unpricedReason: resolved.unpricedReason,
      // ── (Step 20) WHAT KIND OF THING THIS IS, AND WHAT WE DO NOT TRACK ABOUT IT. ──
      /** stock | etf | bond | gsec | sgb | mutual_fund | reit | invit. The frontend keys its entry
       *  hint and its labels off this; the backend only carries the truth. */
      assetClass: instr?.assetClass ?? null,
      /**
       * Codes for what this holding's numbers DO NOT include. Empty for a stock, an ETF, a fund, a
       * REIT, an InvIT — for those, quantity × price IS the whole story.
       *
       * A BOND / G-SEC / SGB carries `coupon_income_not_tracked`. Its cost basis is exactly right
       * (the user entered what they paid, accrued interest included — that is what the entry hint is
       * for), and its market value is the real close. What is missing is the INCOME leg: we hold no
       * coupon schedule for Indian debt, so the P&L shown is a PRICE return and understates the bond
       * by whatever it has paid out. We say so rather than estimate it — the same refusal Step 19
       * made for IDCW plans whose NAV falls on every payout. See portfolio/disclosures.ts.
       */
      disclosures: holdingDisclosures,
      health: score ? Number(score.composite) : null,
      band: score ? score.labelBand : null,
      healthAsOf: score ? score.asOfDate.toISOString().slice(0, 10) : null,
      tier: (p.stockId ? tierBy.get(p.stockId) : undefined) ?? "unknown",
      weight: 0, // filled below, once totalMarketValue is known
      // null ⇒ NO LOT REGISTER EXISTS (broker). Deliberately not `[]`, which would assert that a
      // register exists and merely happens to be empty — a different, and false, statement.
      lots:
        detail?.lots.map((l) => ({
          quantity: l.quantity.toString(),
          costPerShare: l.costPerShare.toString(),
          buyDate: l.buyDate.toISOString().slice(0, 10),
          sourceTxnId: l.sourceTxnId,
        })) ?? null,
      // ── provenance (Step 5): what this row IS, and how far to trust it ──
      source: p.source, // manual | broker — a display/trust label only, never a score input
      accountId: p.accountId,
      accountName: p.accountName,
      /** FROZEN (Step 4): its account's broker feed is severed, so the QUANTITY is last-known.
       *  The value above is still today's — we price it ourselves. */
      stale: p.stale ?? false,
      lastSyncedAt: p.lastSyncedAt ?? null,
      /** true ⇒ we could not price it. The position is REAL and it is SHOWN — we simply refuse to
       *  invent a number for it (held-not-valued, Step 3).
       *
       *  (Step 14.5) This was `p.stockId == null`, which conflated TWO different things: "we cannot
       *  price it" and "it is not an equity". Those came apart the moment ETFs/REITs became
       *  priceable — a REIT has no stockId and now HAS a value — and they were already apart for a
       *  broker-admitted stock with no bhavcopy row yet (a stockId, and no price), which this flag
       *  called valued while phs/assemble correctly called it not. The honest key is, and always
       *  was, CAN WE VALUE IT. `unpricedReason` says which kind of "no". */
      heldNotValued: marketValue == null,
      /** true ⇒ priced, shown, counted in the book — but NEVER scored. An ETF/REIT/InvIT/fund is
       *  not an equity: the Health Score is built on fundamentals it does not have. Held, valued,
       *  unscored is a legitimate and permanent state, not a gap waiting to be filled. */
      heldNotScored: p.stockId == null,
      /** (Disclosure taxonomy) Every disclosure this holding carries, each as { code, cls, sentence },
       *  rendered from the ONE shared composer (disclosures.ts) — never re-derived here. Order: unscored →
       *  unpriced → instrument (coupon/discount). Empty for a scored, priced, non-coupon holding. ADDITIVE:
       *  the raw heldNotScored / heldNotValued / unpricedReason / disclosures fields above are unchanged,
       *  so existing consumers are byte-identical. */
      disclosureNotes: holdingDisclosureNotes({
        heldNotScored: p.stockId == null,
        heldNotValued: marketValue == null,
        unpricedReason: resolved.unpricedReason,
        disclosures: holdingDisclosures,
      }),
    };
  });

  // MARKET VALUE DESC — the only axis a manual row and a broker row genuinely share (a broker row
  // has no invested value to sort on). Unpriced rows (held-not-valued) sort LAST rather than being
  // ranked by a number we don't have. Symbol breaks ties, so the order is deterministic.
  enriched.sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1) || a.symbol.localeCompare(b.symbol));

  // ── Book totals ──────────────────────────────────────────────────────────────────────────
  // Each sum takes ONLY the rows carrying the value, and reports what it had to skip. No null is
  // ever read as 0 (see the header — that coercion was already latent here, waiting for the first
  // broker row to reach this endpoint).
  const mv = sumPresent(enriched.map((h) => h.marketValue));
  const totalMarketValue = mv.total;
  for (const h of enriched) {
    h.weight = totalMarketValue > 0 && h.marketValue != null ? h.marketValue / totalMarketValue : 0;
  }

  const invested = sumPresent(enriched.map((h) => (h.investedValue == null ? null : Number(h.investedValue))));
  const dayChange = sumPresent(enriched.map((h) => h.dayChangeValue));

  // Unrealized: sum the PER-ROW figures (each already null-guarded), rather than differencing two
  // totals drawn from different row sets. That mismatch — market value including broker rows, cost
  // basis excluding them — is precisely how a broker position's value turns into phantom profit.
  const unrealized = sumPresent(enriched.map((h) => h.unrealizedPnl));
  // ...and state how much of the book that figure actually covers, in ₹, so a partial number can
  // never be mistaken for a whole one.
  const noCostBasis = enriched.filter((h) => h.investedValue == null);
  const valueWithoutCostBasis = sumPresent(noCostBasis.map((h) => h.marketValue)).total;

  // ── COST BASIS AND LOT REGISTER ARE NOW TWO DIFFERENT THINGS (Step 17) ────────────────────
  // They used to travel together: a broker row had NEITHER, so "lacks a cost basis" was a usable
  // PROXY for "lacks realized P&L" and `partial.realizedPnl` was keyed on `noCostBasis`.
  //
  // That proxy is now WRONG. A broker row HAS a cost basis (quantity × the broker's avgCost — see
  // brokers/union.ts) but still has NO LOT REGISTER, so its realized P&L remains honestly null.
  // Left as it was, `partial.realizedPnl` would have flipped to false the moment invested became
  // computable — and the API would have quietly claimed that realized P&L covered the WHOLE book
  // when it still covers only the manual side of it.
  //
  // So the flag is keyed on the thing it actually describes. A disclosure that is right by
  // coincidence stops being right the moment the coincidence ends.
  const noRealized = enriched.filter((h) => h.realizedPnl == null);

  // Realized: read from the manual ledger — the only place realized P&L exists at all. Includes
  // fully-exited positions (realized still counts at qty 0), which is why it is not derived from
  // the row list above. Broker rows contribute NOTHING to it — not zero, nothing.
  const realizedTotal = await prisma.holding.aggregate({ where: { userId }, _sum: { realizedPnl: true } });

  // YESTERDAY'S BOOK VALUE — the denominator for dayChangePct.
  //
  // (Step 14.5) This was `totalMarketValue - dayChange.total`, which is only coherent while EVERY
  // valued row also has a day-change. That held right up until a fund became valuable: an ETF priced
  // off its AMFI NAV has NO previous NAV to compare against (there is deliberately no NAV-history
  // table), so it contributes market value and no day-change — and the old formula would have put
  // its capital in the denominator while its movement was absent from the numerator, quietly
  // understating the day's move on every mixed book.
  //
  // So the denominator is now built from exactly the rows that HAVE a day-change: Σ(marketValue −
  // dayChangeValue) over those rows. The percentage then describes precisely the capital it was
  // measured on. BYTE-IDENTICAL on an all-stock book — every priced stock carries a prev_close, so
  // the row set is the same one and the arithmetic is the same arithmetic.
  const movers = enriched.filter((h) => h.dayChangeValue != null && h.marketValue != null);
  const prevValue = movers.reduce((s, h) => s + (h.marketValue! - h.dayChangeValue!), 0);

  return res.json({
    success: true,
    data: {
      holdings: enriched,
      totals: {
        positions: enriched.length,
        pricedPositions: enriched.length - mv.missing, // rows carrying a live price (value-coverage honesty)
        investedValue: invested.total.toFixed(2), // ONLY rows with a cost basis
        realizedPnlAll: (realizedTotal._sum.realizedPnl ?? 0).toString(), // the manual ledger only
        currentValue: totalMarketValue.toFixed(2), // ALL priced rows — broker included (our price)
        unrealizedPnl: unrealized.total.toFixed(2), // ONLY rows with both a value and a cost basis
        dayChangeValue: dayChange.total.toFixed(2),
        dayChangePct: prevValue > 0 ? ((dayChange.total / prevValue) * 100).toFixed(4) : null,
        // ── PARTIALITY (Step 5): which totals are missing rows, and how much they miss. ──
        // A number the user cannot tell is incomplete is worse than no number at all.
        partial: {
          /** true ⇒ positions exist with no cost basis, so these totals cover only part of the book.
           *  (Step 17: a BROKER row now HAS a cost basis — quantity × the broker's avgCost — so this
           *  is false on an ordinary manual+broker book. What still lands here is a position we
           *  cannot value or cost at all.) */
          investedValue: invested.missing > 0,
          unrealizedPnl: unrealized.missing > 0,
          /** true ⇒ positions exist with NO LOT REGISTER, so realized P&L covers only part of the
           *  book. Keyed on the rows that actually lack it — NOT on `noCostBasis`, which used to be
           *  the same set and, since Step 17, is not. Broker rows have a cost basis and still have
           *  no realized P&L: those are two different absences and they are disclosed separately. */
          realizedPnl: noRealized.length > 0,
          /** (Step 14.5) true ⇒ some positions have a VALUE but no day-change (a NAV-priced fund
           *  has no previous NAV to move from), so the day figures cover only part of the book.
           *  dayChangePct is measured against exactly the capital that HAS a day-change — this
           *  flag is how the reader knows that is not the whole book. */
          dayChange: dayChange.missing > 0,
          positionsWithoutCostBasis: noCostBasis.length,
          /** the ₹ market value that the cost-basis figures above do NOT account for. */
          valueWithoutCostBasis: valueWithoutCostBasis.toFixed(2),
          /** (Step 17) how many positions carry no LOT REGISTER — i.e. how much of the book the
           *  realized-P&L figure is silent about. Broker rows: their realized P&L is unknowable from
           *  a snapshot, and we will not invent it. */
          positionsWithoutLotRegister: noRealized.length,
        },
      },
    },
  });
};
