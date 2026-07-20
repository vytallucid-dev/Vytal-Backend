// ─────────────────────────────────────────────────────────────────────────────
// REPLAY + MATERIALIZE — the DB seam around the pure FIFO engine.
//
// Full-replay-on-write: re-reads an (account, stock)'s ENTIRE ledger, runs replayFifo,
// and rewrites the materialized holding + holding_lots. Called INSIDE the caller's
// transaction (tx) so a bad write (e.g. OversellError) rolls the whole thing back —
// the offending transaction never persists.
//
// ACCOUNT-SCOPED (Accounts Step 1): the FIFO queue is per (account, stock) — the same
// stock in two accounts is two INDEPENDENT lot queues (a sell in account A never consumes
// account B's lots). With a single account this is byte-identical to the old (user, stock)
// grouping; the pure engine (fifo-engine) is unchanged — only the grouping key moved.
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
 * Replay the (account, INSTRUMENT) ledger and rewrite holdings + holding_lots. Must run inside a
 * transaction. Propagates OversellError (→ caller maps to 400 + rollback). `userId` is stored on the
 * materialized row (denormalised for whole-user reads); the FIFO grouping key is `accountId`
 * (ownership is enforced by the caller before this runs).
 *
 * ── STEP 20: THE KEY MOVED FROM THE STOCK TO THE INSTRUMENT. THE MATH DID NOT MOVE AT ALL. ──
 *
 * This used to take a `stockId`, read the ledger by (account, stock), and then look the stock UP in
 * the catalogue to find the instrument to materialize against. That last hop is what made non-stock
 * holdings impossible: it was `instrument.findUnique({ where: { stockId } })`, and every one of the
 * 18,492 non-stock instruments has stock_id NULL — so it could never resolve one. A bond, an ETF, a
 * fund could be catalogued, priced and replayed, and still had no way to BE a holding.
 *
 * So the parameter is now the instrument itself, and the lookup runs the other way (instrument → its
 * optional stock) purely to fill the denormalised `stockId` on the row. For a stock this is exactly
 * the same journey in reverse and lands on exactly the same instrument (instruments.stock_id is
 * @unique, 1:1), which is why the 19 existing equity holdings replay byte-identically.
 *
 * ⚠️  fifo-engine.ts IS NOT TOUCHED, AND MUST NOT BE. It never knew what a stock was — it walks lots,
 *     quantities, prices, fees and split/bonus ratios, and "shares" is only what the variables are
 *     called. Units of an ETF or a fund replay through it correctly ALREADY. The blocker was never
 *     the cost-basis math; it was this one line of keying.
 */
export async function replayAndMaterialize(
  tx: Tx,
  userId: string,
  accountId: string,
  instrumentId: string,
): Promise<MaterializedHolding> {
  const txns = await tx.transaction.findMany({
    where: { accountId, instrumentId }, // account-scoped ledger (independent per-account FIFO queue)
    orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
  });

  // The instrument IS the holding's identity. We read its (optional) stock only to carry the
  // denormalised pointer onto the row — NULL for a bond/fund/ETF, which is exactly correct: they
  // have no row in `stocks`. A missing instrument is a hard invariant break, not a user error.
  const instrument = await tx.instrument.findUnique({
    where: { id: instrumentId },
    select: { id: true, stockId: true },
  });
  if (!instrument) {
    throw new Error(`no instrument ${instrumentId} in the catalog — the caller resolved a row that does not exist`);
  }

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
    // The FIFO queue key — two NOT-NULL columns. It deliberately does NOT include stock_id, which is
    // now nullable: Postgres treats NULLs as DISTINCT in a unique index, so a key touching it would
    // enforce nothing for non-stocks and duplicate the holding on every re-entry.
    where: { accountId_instrumentId: { accountId, instrumentId: instrument.id } },
    create: {
      userId,
      accountId,
      instrumentId: instrument.id,
      stockId: instrument.stockId, // denormalised convenience — NULL for every non-stock instrument
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
