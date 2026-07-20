// ─────────────────────────────────────────────────────────────────────────────
// LEDGERED-BOOK LIVE VALUE (Step 21, Ruling C) — the chart's live final point.
//
// Σ over the user's NET-HELD LEDGER positions of qty × resolvePrice(unit). It uses the SAME
// resolver (price-resolver.ts, Step 14.5) and the SAME price reads as holdings-controller's
// `currentValue`, over the SAME net quantities the NAV engine walks — so on a MANUAL book the
// chart's pinned endpoint EQUALS the overview by construction (the sync assertion).
//
// LEDGER, NOT UNION (Ruling C): broker snapshot holdings are NOT in the transaction ledger and have
// no history, so the historical line cannot reach them. Pinning to the union would float the
// endpoint above the line that leads to it — a discontinuity that makes BOTH look wrong. The
// ledgered value is the number the line actually continues to. The broker gap is disclosed
// separately (chart controllers), not smuggled into the endpoint.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { corporateActionFactor } from "../fifo-engine.js";
import { resolvePrice, type InstrumentPrevInput } from "../price-resolver.js";

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export interface LedgerBookValue {
  /** Σ qty × unit price over priced net positions. null ⇔ the user has no transactions. */
  value: number | null;
  /** The freshest price date across priced positions ("YYYY-MM-DD"), or today if none priced. */
  asOf: string | null;
  positions: number;
  priced: number;
}

/**
 * The live market value of the user's LEDGERED book. Mirrors walkNav's quantity folding (buy +,
 * sell max(0,−), split/bonus ×factor) so the net positions are identical to the ones the historical
 * series is built from.
 *
 * ── ACCOUNT SCOPING (optional) ──────────────────────────────────────────────────────────────────
 * `accountId` narrows the ledger fold to ONE account (against the existing
 * @@index([accountId, instrumentId, tradeDate, createdAt])). Omitted ⇒ the whole book, byte-identical
 * to before. The fold is mechanically the same either way — only the `where` narrows — so a scoped
 * value is the per-account analogue of the whole-book one, and (for a MANUAL account, whose positions
 * are entirely ledger-derived) equals the account page's "Value" by construction: same resolver, same
 * net quantities. A LINKED account carries no ledger (linking deletes it; the book is broker-only), so
 * a scoped fold there is honestly empty — its value lives in broker_holdings and is disclosed as the
 * broker gap (see brokerExcludedSummary), never walked here.
 */
export async function computeLedgerBookValue(userId: string, accountId?: string): Promise<LedgerBookValue> {
  const txns = await prisma.transaction.findMany({
    where: { userId, ...(accountId ? { accountId } : {}) },
    orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
    select: { type: true, quantity: true, ratio: true, stockId: true, instrumentId: true },
  });
  if (txns.length === 0) return { value: null, asOf: null, positions: 0, priced: 0 };

  const held = new Map<string, { qty: number; stockId: string | null; instrumentId: string }>();
  for (const t of txns) {
    const cur = held.get(t.instrumentId) ?? { qty: 0, stockId: t.stockId, instrumentId: t.instrumentId };
    const q = t.quantity != null ? Number(t.quantity) : 0;
    if (t.type === "buy") cur.qty += q;
    else if (t.type === "sell") cur.qty = Math.max(0, cur.qty - q);
    else if (t.type === "split" || t.type === "bonus") cur.qty *= Number(corporateActionFactor(t.ratio));
    held.set(t.instrumentId, cur);
  }
  const open = [...held.values()].filter((h) => h.qty > 1e-9);
  if (open.length === 0) return { value: 0, asOf: isoOf(new Date()), positions: 0, priced: 0 };

  const stockIds = [...new Set(open.filter((o) => o.stockId).map((o) => o.stockId!))];
  const instrumentIds = [...new Set(open.filter((o) => !o.stockId).map((o) => o.instrumentId))];

  const [stockPrices, instruments] = await Promise.all([
    prisma.stockPrice.findMany({
      where: { stockId: { in: stockIds } },
      select: { stockId: true, price: true, prevClose: true, dayChangePct: true, priceDate: true },
    }),
    prisma.instrument.findMany({
      where: { id: { in: instrumentIds } },
      select: { id: true, assetClass: true, lastPrice: true, lastPriceDate: true, currentNav: true, navDate: true, isActive: true },
    }),
  ]);
  // Newest instrument_prices row per non-stock (the only place a non-stock prev close lives).
  const instrPrevBy = new Map<string, InstrumentPrevInput>();
  if (instrumentIds.length > 0) {
    const rows = await prisma.$queryRawUnsafe<{ instrument_id: string; close: unknown; prev_close: unknown; date: Date }[]>(
      `SELECT DISTINCT ON (instrument_id) instrument_id, close, prev_close, date
         FROM instrument_prices WHERE instrument_id = ANY($1::text[]) ORDER BY instrument_id, date DESC`,
      instrumentIds,
    );
    for (const r of rows) instrPrevBy.set(r.instrument_id, { close: r.close, prevClose: r.prev_close, date: r.date });
  }
  const stockPriceBy = new Map(stockPrices.map((p) => [p.stockId, p]));
  const instrBy = new Map(instruments.map((i) => [i.id, i]));

  let total = 0;
  let priced = 0;
  let maxAsOf: string | null = null;
  for (const o of open) {
    const resolved = resolvePrice({
      stockId: o.stockId,
      instrumentId: o.stockId ? null : o.instrumentId,
      stockPrice: o.stockId ? stockPriceBy.get(o.stockId) : undefined,
      instrument: o.stockId ? undefined : instrBy.get(o.instrumentId),
      instrumentPrev: o.stockId ? undefined : instrPrevBy.get(o.instrumentId),
    });
    if (resolved.price != null) {
      total += o.qty * resolved.price;
      priced++;
      if (resolved.asOf && (!maxAsOf || resolved.asOf > maxAsOf)) maxAsOf = resolved.asOf;
    }
  }
  return { value: total, asOf: maxAsOf ?? isoOf(new Date()), positions: open.length, priced };
}

/**
 * Broker-linked holdings are in the overview (the union) but NOT in the ledgered time series — they
 * have no transaction history to walk. This summarises what the series therefore omits, so the chart
 * can DISCLOSE the gap (Ruling C) rather than let the endpoint silently sit below the overview.
 * Value is the broker-reported currentValue (best-effort; nulls are skipped).
 *
 * ── ACCOUNT SCOPING (optional) ──────────────────────────────────────────────────────────────────
 * broker_holdings has NO account_id, but a PortfolioAccount maps to AT MOST ONE broker connection
 * (broker_connection_id is @unique, nullable). So the per-account gap resolves through the connection:
 *   account → its brokerConnectionId → the broker_holdings on THAT connection.
 *   • MANUAL account (brokerConnectionId === null): NO broker leg → ZERO gap (count 0, value null), so
 *     the frontend renders NO broker-gap disclosure. A manual account's page must never show the whole
 *     book's gap — that would be a false disclosure. Same result for an id that isn't the caller's.
 *   • LINKED account: only ITS OWN connection's excluded holdings, never the whole user's.
 * Omitted `accountId` ⇒ whole-user aggregate, byte-identical to before.
 */
export async function brokerExcludedSummary(
  userId: string,
  accountId?: string,
): Promise<{ count: number; approxValue: number | null }> {
  let where: { userId: string; brokerConnectionId?: string };
  if (accountId) {
    // Owner-scoped resolve (defence-in-depth beside the endpoint's ownership check): a foreign id
    // finds no account → treated as a manual/no-broker scope → zero gap, never the book's.
    const account = await prisma.portfolioAccount.findFirst({
      where: { id: accountId, userId },
      select: { brokerConnectionId: true },
    });
    if (!account?.brokerConnectionId) return { count: 0, approxValue: null };
    where = { userId, brokerConnectionId: account.brokerConnectionId };
  } else {
    where = { userId };
  }
  const agg = await prisma.brokerHolding.aggregate({
    where,
    _count: { _all: true },
    _sum: { currentValue: true },
  });
  const count = agg._count._all;
  return { count, approxValue: count > 0 ? Number(agg._sum.currentValue ?? 0) : null };
}
