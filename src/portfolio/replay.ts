// ─────────────────────────────────────────────────────────────────────────────
// REPLAY + MATERIALIZE — the DB seam around the pure FIFO engine.
//
// Full-replay-on-write: re-reads a (user, stock)'s ENTIRE ledger, runs replayFifo,
// and rewrites the materialized holding + holding_lots. Called INSIDE the caller's
// transaction (tx) so a bad write (e.g. OversellError) rolls the whole thing back —
// the offending transaction never persists.
//
// The holding row is KEPT even at qty=0 (fully exited) so realized_pnl survives for
// tax / broker Tax P&L; the lot register is emptied. GET /holdings filters qty>0 for
// the current-holdings view.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "../generated/prisma/client.js";
import { replayFifo, type LedgerTxn } from "./fifo-engine.js";

/** Prisma transaction-client type (the `tx` handed to $transaction callbacks). */
type Tx = Prisma.TransactionClient;

export interface MaterializedHolding {
  id: string;
  quantity: string;
  avgCost: string;
  investedValue: string;
  realizedPnl: string;
  lastComputedAt: Date;
  lots: { quantity: string; costPerShare: string; buyDate: string; sourceTxnId: string }[];
}

/**
 * Replay the (user, stock) ledger and rewrite holdings + holding_lots. Must run
 * inside a transaction. Propagates OversellError (→ caller maps to 400 + rollback).
 */
export async function replayAndMaterialize(
  tx: Tx,
  userId: string,
  stockId: string,
): Promise<MaterializedHolding> {
  const txns = await tx.transaction.findMany({
    where: { userId, stockId },
    orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
  });

  const ledger: LedgerTxn[] = txns.map((t) => ({
    id: t.id,
    type: t.type,
    quantity: t.quantity, // Prisma.Decimal | null
    price: t.price,
    fees: t.fees, // Prisma.Decimal | null → folds into basis/proceeds (null = 0)
    tradeDate: t.tradeDate,
    ratio: t.ratio,
    createdAt: t.createdAt,
  }));

  const result = replayFifo(ledger); // throws OversellError → rolls back

  const holding = await tx.holding.upsert({
    where: { userId_stockId: { userId, stockId } },
    create: {
      userId,
      stockId,
      quantity: result.quantity,
      avgCost: result.avgCost,
      investedValue: result.investedValue,
      realizedPnl: result.realizedPnl,
      lastComputedAt: new Date(),
    },
    update: {
      quantity: result.quantity,
      avgCost: result.avgCost,
      investedValue: result.investedValue,
      realizedPnl: result.realizedPnl,
      lastComputedAt: new Date(),
    },
  });

  // Rewrite the open-lot register (frozen remainder). Delete-then-insert keeps it a
  // faithful projection of the replay — no stale lots survive a correction.
  await tx.holdingLot.deleteMany({ where: { holdingId: holding.id } });
  if (result.lots.length > 0) {
    await tx.holdingLot.createMany({
      data: result.lots.map((l) => ({
        holdingId: holding.id,
        quantity: l.quantity,
        costPerShare: l.costPerShare,
        buyDate: l.buyDate,
        sourceTxnId: l.sourceTxnId,
      })),
    });
  }

  return {
    id: holding.id,
    quantity: holding.quantity.toString(),
    avgCost: holding.avgCost.toString(),
    investedValue: holding.investedValue.toString(),
    realizedPnl: holding.realizedPnl.toString(),
    lastComputedAt: holding.lastComputedAt,
    lots: result.lots.map((l) => ({
      quantity: l.quantity.toString(),
      costPerShare: l.costPerShare.toString(),
      buyDate: l.buyDate.toISOString().slice(0, 10),
      sourceTxnId: l.sourceTxnId,
    })),
  };
}
