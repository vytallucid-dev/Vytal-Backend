// ─────────────────────────────────────────────────────────────────────────────
// NAV ASSEMBLE — resolve a user's book into the NAV engine's inputs, then compute.
// READ-ONLY: the series is DERIVED from the Transaction ledger × DailyPrice closes —
// there is no stored NAV field (the ledger is truth). Two reads, zero writes.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import {
  computeNavSeries,
  walkNav,
  type NavLedgerTxn,
  type NavPricePoint,
  type NavSeriesResult,
} from "./engine.js";
import { computeTwr, type TwrResult } from "./twr.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The engine inputs (ledger × per-symbol daily closes) for a user's book, or null when
 *  the user has no transactions. Both NAV and TWR read from the SAME assembled inputs. */
async function assembleNavInputs(
  userId: string,
): Promise<{ ledger: NavLedgerTxn[]; pricesBySymbol: Map<string, NavPricePoint[]> } | null> {
  // 1. The ledger (canonical order: tradeDate ASC, then same-day createdAt ASC).
  const txns = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
    include: { stock: { select: { id: true, symbol: true } } },
  });
  if (txns.length === 0) return null;

  const ledger: NavLedgerTxn[] = txns.map((t) => ({
    symbol: t.stock.symbol,
    type: t.type,
    quantity: t.quantity != null ? Number(t.quantity) : null,
    ratio: t.ratio,
    tradeDate: iso(t.tradeDate),
  }));

  const firstBuyDate = ledger[0].tradeDate; // earliest tradeDate == the first buy
  const stockIds = [...new Set(txns.map((t) => t.stock.id))];
  const symbolById = new Map(txns.map((t) => [t.stock.id, t.stock.symbol] as const));

  // 2. Daily closes for the held symbols, from the first buy forward (EOD; only close + date).
  const prices = await prisma.dailyPrice.findMany({
    where: { stockId: { in: stockIds }, date: { gte: new Date(firstBuyDate) } },
    orderBy: { date: "asc" },
    select: { stockId: true, date: true, close: true },
  });

  const pricesBySymbol = new Map<string, NavPricePoint[]>();
  for (const sym of symbolById.values()) pricesBySymbol.set(sym, []);
  for (const p of prices) {
    const sym = symbolById.get(p.stockId);
    if (sym) pricesBySymbol.get(sym)!.push({ date: iso(p.date), close: Number(p.close) });
  }

  return { ledger, pricesBySymbol };
}

/** Compute the full daily NAV (₹ value) series for a user's book. Read-only. */
export async function computePortfolioNav(userId: string): Promise<NavSeriesResult> {
  const inp = await assembleNavInputs(userId);
  if (!inp) return { series: [], firstDate: null, lastDate: null, points: 0, symbolsNoPrice: [] };
  return computeNavSeries(inp.ledger, inp.pricesBySymbol);
}

/** Compute the full time-weighted return (cash-flow-neutral) series + scalars. Read-only. */
export async function computePortfolioTwr(userId: string): Promise<TwrResult> {
  const inp = await assembleNavInputs(userId);
  if (!inp) return { series: [], firstDate: null, lastDate: null, totalTwrPct: null, annualizedPct: null, days: 0 };
  return computeTwr(walkNav(inp.ledger, inp.pricesBySymbol));
}
