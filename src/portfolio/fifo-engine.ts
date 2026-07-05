// ─────────────────────────────────────────────────────────────────────────────
// FIFO LOT-REGISTER REPLAY ENGINE — the heart of the portfolio layer.
//
// PURE (no DB) so it is exhaustively unit-testable. Replays a stock's FULL ledger
// (trade_date order) through an in-memory FIFO lot queue and returns the
// materialized state: open qty, weighted-avg cost of OPEN lots (broker display
// cost), cumulative FIFO-matched realized P&L, and the open-lot remainder.
//
// BROKER-MATCH (the non-negotiable): display cost = weighted-avg of OPEN lots;
// realized P&L = FIFO — the OLDEST lot is consumed first (IT-dept mandated), NOT an
// average. Buy 100@100 then 100@120 then sell 100@150 ⇒ realized ₹5,000 (sold the
// 100@100 lot), NOT ₹4,000 (avg-based). Getting this wrong = numbers disagree with
// the user's broker.
//
// All arithmetic is Prisma.Decimal (Decimal.js) — no float drift across the repeated
// divisions a split introduces.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "../generated/prisma/client.js";

type D = Prisma.Decimal;
const D0 = () => new Prisma.Decimal(0);

export type PortfolioTxnType = "buy" | "sell" | "split" | "bonus" | "dividend";

/** A ledger transaction as the engine sees it (DB-decoupled). */
export interface LedgerTxn {
  id: string;
  type: PortfolioTxnType;
  quantity: D | null; // buy/sell shares; null for split/bonus/dividend
  price: D | null; // buy/sell ₹/share; null for split/bonus
  fees: D | null; // ₹ total charges — buy folds into basis, sell reduces proceeds; null = 0
  tradeDate: Date;
  ratio: string | null; // "a:b" for split/bonus
  createdAt: Date; // same-trade_date tiebreak (insertion order)
}

/** An open lot in the FIFO register (the frozen remainder after replay). */
export interface OpenLot {
  quantity: D;
  costPerShare: D;
  buyDate: Date; // PRESERVED through splits/bonus (holding period unbroken)
  sourceTxnId: string; // the originating BUY (kept through corporate actions)
}

export interface ReplayResult {
  quantity: D; // Σ open lots (0 when fully exited)
  avgCost: D; // Σ(qty×cost)/Σqty of OPEN lots; 0 when qty 0
  investedValue: D; // Σ(qty×cost) of OPEN lots
  realizedPnl: D; // cumulative FIFO-matched
  lots: OpenLot[]; // FIFO order (oldest first)
}

/** A sell that exceeds the open quantity — you can't sell what you don't hold. */
export class OversellError extends Error {
  constructor(
    public readonly txnId: string,
    public readonly attempted: D,
    public readonly available: D,
  ) {
    super(`Oversell: transaction ${txnId} sells ${attempted.toString()} but only ${available.toString()} is held`);
    this.name = "OversellError";
  }
}

/**
 * Corporate-action multiplier from a ratio string "a:b".
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CONVENTION (FIXED — the transaction-entry UI MUST label inputs to match): │
 * │   "a:b"  =  "a ADDITIONAL shares for every b HELD"                        │
 * │   factor = (a + b) / b   →   qty ×= factor,  cost_per_share ÷= factor     │
 * │   "1:1" → 2×    "2:1" → 3×    "5:1" → 6×    "3:2" → 2.5×    "1:2" → 1.5×   │
 * └──────────────────────────────────────────────────────────────────────────┘
 * This is the standard BONUS reading. SPLITS use the SAME reading here — so a
 * FACE-VALUE split like 1→5 must be entered as "4:1" (4 new per 1 held), NOT "5:1".
 * The engine never guesses direction; it applies exactly this. Bonus and split are
 * mechanically identical to the register (scale qty↑ / cost↓, preserve dates); only
 * downstream TAX treatment differs (not this layer's concern).
 *
 * ⚠️ UI FLAG: the entry form must state "additional shares per held" unambiguously so
 * a user reading a broker's face-value "1:5 split" enters "4:1", not "5:1".
 */
export function corporateActionFactor(ratio: string | null): D {
  if (!ratio) throw new Error('split/bonus requires a ratio like "a:b"');
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  if (!m) throw new Error(`invalid ratio "${ratio}" — expected "a:b" (e.g. "1:1")`);
  const a = new Prisma.Decimal(m[1]);
  const b = new Prisma.Decimal(m[2]);
  if (b.lte(0) || a.lt(0)) throw new Error(`invalid ratio "${ratio}" — need a≥0, b>0`);
  return a.plus(b).div(b);
}

/** trade_date ASC, then created_at ASC (same-day insertion order). */
function ledgerOrder(a: LedgerTxn, b: LedgerTxn): number {
  const d = a.tradeDate.getTime() - b.tradeDate.getTime();
  return d !== 0 ? d : a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Replay a stock's full ledger through the FIFO queue. Throws OversellError if any
 * sell exceeds the open qty at that point. Full-replay-on-write (not incremental)
 * is what lets a back-dated insert or a late split recompute everything correctly.
 */
export function replayFifo(txns: LedgerTxn[]): ReplayResult {
  const sorted = [...txns].sort(ledgerOrder);
  const queue: OpenLot[] = []; // FIFO: index 0 = oldest
  let realized = D0();

  for (const t of sorted) {
    switch (t.type) {
      case "buy": {
        if (t.quantity == null || t.price == null) throw new Error(`buy ${t.id} missing quantity/price`);
        // Fees fold into COST BASIS: amortise the buy charge across the lot's shares so
        // the per-share cost — and therefore invested + any future realized P&L on these
        // shares — reflects the real outlay. null fee = 0 (fee-less back-compat).
        const feePerShare = (t.fees ?? D0()).div(t.quantity);
        queue.push({ quantity: t.quantity, costPerShare: t.price.plus(feePerShare), buyDate: t.tradeDate, sourceTxnId: t.id });
        break;
      }
      case "sell": {
        if (t.quantity == null || t.price == null) throw new Error(`sell ${t.id} missing quantity/price`);
        const available = queue.reduce((s, l) => s.plus(l.quantity), D0());
        if (t.quantity.gt(available)) throw new OversellError(t.id, t.quantity, available);
        let remaining = t.quantity;
        while (remaining.gt(0)) {
          const lot = queue[0]; // present — guaranteed by the available check
          const consumed = lot.quantity.lte(remaining) ? lot.quantity : remaining;
          realized = realized.plus(t.price.minus(lot.costPerShare).times(consumed));
          lot.quantity = lot.quantity.minus(consumed);
          remaining = remaining.minus(consumed);
          if (lot.quantity.lte(0)) queue.shift(); // fully consumed lot leaves the register
        }
        // Fees reduce PROCEEDS: the sell charge lowers realized P&L, once per sell (a real
        // cost, not per-lot). null fee = 0.
        realized = realized.minus(t.fees ?? D0());
        break;
      }
      case "split":
      case "bonus": {
        const factor = corporateActionFactor(t.ratio);
        for (const lot of queue) {
          lot.quantity = lot.quantity.times(factor);
          lot.costPerShare = lot.costPerShare.div(factor);
          // buyDate + sourceTxnId deliberately untouched — holding period unbroken.
        }
        break;
      }
      case "dividend":
        break; // cash event — never touches the lot register (return calc uses it later)
    }
  }

  const quantity = queue.reduce((s, l) => s.plus(l.quantity), D0());
  const investedValue = queue.reduce((s, l) => s.plus(l.quantity.times(l.costPerShare)), D0());
  const avgCost = quantity.gt(0) ? investedValue.div(quantity) : D0();
  return { quantity, avgCost, investedValue, realizedPnl: realized, lots: queue };
}
