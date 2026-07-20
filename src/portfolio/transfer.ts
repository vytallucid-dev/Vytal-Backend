// ═══════════════════════════════════════════════════════════════════════
// HOLDING TRANSFER + RESCUE-ON-DELETE (Step 6) — how a position MOVES between accounts.
//
// THE SOURCE DECIDES THE RULE:
//   MANUAL source → any MANUAL destination, ANY broker. A Zerodha book's position can move to
//     an Upstox book: a manual ledger is the USER's, not a broker's, so nothing is mirrored and
//     nothing is lied about. Full position only (all lots of one instrument, together).
//   LINKED source → a SAME-BROKER MANUAL destination ONLY, and it DELETES the linked account.
//     This IS "transferring out of a broker account", and it is the ONLY way a broker holding
//     ever becomes manual (rescue). It cannot cherry-pick: the account goes, so everything in
//     it must go, or positions would be silently stranded.
//   INTO a linked account → NEVER. Same wall as manual entry: the mirror stays faithful.
//
// WHY A TRANSFER IS ALMOST NOTHING (the recon's finding): a manual holding IS its transactions.
// `holdings` + `holding_lots` are MATERIALIZED projections — replay.ts is their only writer. So
// moving a position is re-parenting ONE COLUMN (transactions.account_id) and replaying both
// accounts. The lot math is never touched; it is re-derived, identically, from the same rows.
//
// ── THE TWO TRAPS (both proven before they were coded, see the Step-6 recon) ─────────────────
//
// R1 — MERGING ACROSS A CORPORATE ACTION INVENTS SHARES.
//   A split/bonus is a MARKET event, but it is recorded once PER ACCOUNT (each account's FIFO
//   queue only scales its own lots — so a user holding RELIANCE in two books correctly enters
//   the same 1:1 bonus in BOTH). Concatenate those ledgers and the replay applies the bonus
//   TWICE to the combined queue: 200 + 100 real shares replay to 600. Three hundred shares out
//   of thin air. So identical corporate actions (same type + tradeDate + ratio) are DEDUPED
//   before the replay — two rows describing one market event are one fact recorded twice.
//
// R2 — MERGING MOVES REALIZED P&L, AND THAT IS A TAX NUMBER.
//   FIFO consumes the oldest lot first — across the COMBINED queue. So a sell that already
//   happened in the destination can retroactively re-match against an older lot the source
//   brought in (proven: realized 10,000 → 25,000). This is not a bug to fix; it is what "one
//   FIFO queue per (account, instrument)" MEANS — you cannot merge two queues without re-deciding
//   which lots the past sells consumed. So we do the honest thing and SAY SO: every transfer
//   reports realizedBefore → realizedAfter (and quantityBefore → quantityAfter). The user watches
//   the number move; they do not discover it later on a tax statement.
//
// R3 — A RESCUED BROKER HOLDING NEEDS A LEDGER, OR IT IS A LIE WAITING TO BE ERASED.
//   A broker holding has qty + avgCost and NO transactions. But holdings are DERIVED from
//   transactions, so a holding with no ledger behind it is erased by the very next write for
//   that stock (replayFifo([]) → qty 0, lots deleted) and can never be sold (OversellError,
//   available 0). So rescue writes ONE SYNTHETIC BUY per position: the broker's qty at the
//   broker's avgCost, dated the snapshot's syncedAt, tagged [rescue:…] in notes so it can never
//   be mistaken for a trade the user actually made. The economics are the broker's own; only the
//   DATE is ours, and it is disclosed. That is the least-bad option, not a free one.
//
// R4 — AN UNMAPPED BROKER HOLDING CANNOT BECOME MANUAL, SO WE REFUSE RATHER THAN DROP IT.
//   A broker symbol outside our universe is stored verbatim with stock_id NULL (held-not-scored
//   — honest). But holdings.stock_id / transactions.stock_id are NOT NULL: there is no manual
//   holding that can express it. Rescue therefore REFUSES and NAMES those symbols. It never
//   silently drops a position the user actually owns. (When sync later adds unknown symbols to
//   the universe, no unmapped rows will exist and this guard goes quiet on its own.)
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { replayAndMaterialize } from "./replay.js";
import { OversellError, replayFifo, type LedgerTxn } from "./fifo-engine.js";
import { resolveInstrument, InstrumentResolveError } from "./resolve-instrument.js";

/** Transfer failures the controller maps straight to HTTP. */
export class TransferError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    /** Extra, machine-readable context (e.g. the symbols that blocked a rescue). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TransferError";
  }
}

/** What a position looked like before, and after. The R2 disclosure. */
export interface PositionDelta {
  symbol: string;
  quantityBefore: string;
  quantityAfter: string;
  avgCostBefore: string;
  avgCostAfter: string;
  /** THE TAX NUMBER. A merge can move it (R2) — so it is always reported, never assumed stable. */
  realizedPnlBefore: string;
  realizedPnlAfter: string;
}

export interface TransferResult {
  // "manual" — one position moved · "manual_all" — the whole account moved (Stage 2) · "rescue" — broker→manual.
  kind: "manual" | "manual_all" | "rescue";
  sourceAccountId: string;
  destinationAccountId: string;
  /** true ⇔ the destination ALREADY held the instrument (ANY instrument, for manual_all), so two
   *  FIFO queues became one. */
  merged: boolean;
  /** Identical corporate actions dropped as duplicates of the SAME market event (R1). */
  dedupedCorporateActions: { symbol: string; type: string; tradeDate: string; ratio: string | null }[];
  /** Per-instrument before → after on the DESTINATION. One entry (manual) or every moved
   *  instrument (manual_all). */
  destination: PositionDelta[];
  /** The source account was removed. rescue → its broker connection is gone too (the token is
   *  forgotten: connectionForgotten). manual_all with delete → a manual account has no connection,
   *  so connectionForgotten is absent. */
  deletedAccount?: { id: string; name: string; connectionForgotten?: true };
  /** rescue only: the synthetic buys written (R3) — surfaced so the fabricated DATE is visible. */
  rescued?: { symbol: string; quantity: string; costPerShare: string; tradeDate: string; note: string }[];
  /** manual_all only: true ⇔ the emptied source account was KEPT; false ⇔ it was deleted. */
  sourceKept?: boolean;
}

type Tx = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);
const dstr = (d: Prisma.Decimal | null | undefined) => (d ?? ZERO).toString();
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));

/** Split into fixed-size batches so a bulk createMany stays under Postgres's 65535-bind-parameter
 *  ceiling — a whole-account move can rematerialize thousands of holding/lot rows at once. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
// Rows-per-INSERT ceilings: holdings carry ~9 columns, lots ~5. 1000 rows keeps both well under
// 65535 params with headroom, and turns any account size into a bounded handful of statements.
const HOLDING_BATCH = 1000;
const LOT_BATCH = 1000;

/** The destination's CURRENT materialized position for an instrument (all zeros if it holds none). */
async function snapshotPosition(tx: Tx, accountId: string, instrumentId: string, symbol: string) {
  const h = await tx.holding.findUnique({
    where: { accountId_instrumentId: { accountId, instrumentId } },
    select: { quantity: true, avgCost: true, realizedPnl: true },
  });
  return {
    symbol,
    exists: !!h,
    quantity: dstr(h?.quantity),
    avgCost: dstr(h?.avgCost),
    realizedPnl: dstr(h?.realizedPnl),
  };
}

/**
 * BOTH accounts, owner-scoped. IDOR is structural: the token's userId scopes the lookup, so a
 * foreign (or nonexistent) account is a 404 either way — indistinguishable, no existence leak.
 * A transfer touches TWO accounts, so BOTH must be the caller's; checking only one would let a
 * user push their position into someone else's book, or pull one out of it.
 */
async function requireBothAccounts(userId: string, sourceId: string, destId: string) {
  if (sourceId === destId) {
    throw new TransferError(400, "same_account", "the source and destination accounts are the same");
  }
  const accounts = await prisma.portfolioAccount.findMany({
    where: { id: { in: [sourceId, destId] }, userId }, // ← the whole IDOR story, in one clause
    select: { id: true, name: true, broker: true, state: true, brokerConnectionId: true },
  });
  const source = accounts.find((a) => a.id === sourceId);
  const destination = accounts.find((a) => a.id === destId);
  if (!source) throw new TransferError(404, "source_not_found", "source account not found");
  if (!destination) throw new TransferError(404, "destination_not_found", "destination account not found");
  return { source, destination };
}

/** THE MIRROR WALL. Nothing is ever written INTO a linked account — not a manual trade, not a
 *  transfer. The same guard as the manual-entry funnel, for the same reason: a broker's book is
 *  a mirror, and a mirror with our rows in it is no longer a mirror. */
function requireWritableDestination(destination: { state: string; name: string }) {
  if (destination.state !== "manual") {
    throw new TransferError(
      409,
      "destination_linked",
      `"${destination.name}" is broker-managed — nothing can be transferred into it (its holdings mirror the broker). Transfer into a manual account instead.`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// THE PER-POSITION CORE — one instrument's full move, inside a CALLER-SUPPLIED transaction.
//
// Shared VERBATIM by the single-position path (transferManualPosition) and the whole-account path
// (transferAllManualPositions), so the dedup (R1), the FIFO merge when the destination already
// holds the instrument (R2), the transaction re-parenting, and the source-holding cleanup live in
// ONE place and cannot drift between the two. The CALLER owns the transaction — which is exactly
// what lets a whole-account move be all-or-nothing (every position on one `tx`) — and the caller
// runs the ownership/state guards BEFORE opening it. This function touches only rows for ONE
// (source, destination, instrument); it never opens or commits a transaction of its own.
// ═══════════════════════════════════════════════════════════════════════
interface MoveCtx {
  tx: Tx;
  userId: string;
  sourceAccountId: string;
  sourceName: string; // for the position_not_found message only
  destinationAccountId: string;
  instrumentId: string;
  symbol: string; // display label (delta rows + dedup detail); never a key
}
async function movePositionWithinTx(c: MoveCtx): Promise<{
  before: Awaited<ReturnType<typeof snapshotPosition>>;
  after: Awaited<ReturnType<typeof snapshotPosition>>;
  merged: boolean;
  deduped: TransferResult["dedupedCorporateActions"];
}> {
  const { tx, userId, sourceAccountId, sourceName, destinationAccountId, instrumentId, symbol } = c;

  const sourceTxns = await tx.transaction.findMany({
    where: { accountId: sourceAccountId, instrumentId },
    select: { id: true, type: true, tradeDate: true, ratio: true },
  });
  if (sourceTxns.length === 0) {
    // Single path only: the user named a symbol the source does not hold. The whole-account path
    // iterates instruments that provably HAVE transactions, so this can never fire for it.
    throw new TransferError(404, "position_not_found", `"${sourceName}" holds no ${symbol} position to transfer`);
  }

  const before = await snapshotPosition(tx, destinationAccountId, instrumentId, symbol);
  const merged = before.exists;

  // ── R1: DEDUPE THE CORPORATE ACTIONS ──────────────────────────────────────────────
  // Only where the destination ALREADY records the same market event. One split/bonus row
  // per (type, tradeDate, ratio) survives into the merged ledger; the source's duplicate is
  // deleted. Without this the combined replay applies the action twice and INVENTS shares.
  const deduped: TransferResult["dedupedCorporateActions"] = [];
  if (merged) {
    const destActions = await tx.transaction.findMany({
      where: { accountId: destinationAccountId, instrumentId, type: { in: ["split", "bonus"] } },
      select: { type: true, tradeDate: true, ratio: true },
    });
    const key = (t: { type: string; tradeDate: Date; ratio: string | null }) =>
      `${t.type}|${t.tradeDate.toISOString().slice(0, 10)}|${t.ratio ?? ""}`;
    const destKeys = new Set(destActions.map(key));

    const dupes = sourceTxns.filter((t) => (t.type === "split" || t.type === "bonus") && destKeys.has(key(t)));
    if (dupes.length > 0) {
      await tx.transaction.deleteMany({ where: { id: { in: dupes.map((d) => d.id) } } });
      for (const d of dupes) {
        deduped.push({ symbol, type: d.type, tradeDate: d.tradeDate.toISOString().slice(0, 10), ratio: d.ratio });
      }
    }
  }

  // ── THE TRANSFER ITSELF: one column. ──────────────────────────────────────────────
  // Everything else (the holding row, the lot register, avg cost, realized P&L) is DERIVED,
  // and is rebuilt below from exactly these rows. The FIFO algorithm is not involved in the
  // move at all — which is why a moved position replays to identical economics.
  await tx.transaction.updateMany({
    where: { accountId: sourceAccountId, instrumentId },
    data: { accountId: destinationAccountId },
  });

  // Destination: replay the (now combined, deduped) ledger → one position, one lot queue.
  await replayAndMaterialize(tx, userId, destinationAccountId, instrumentId);

  // Source: its ledger for this instrument is now EMPTY. Drop the materialized row rather than
  // leaving a 0-qty / 0-realized husk behind: the 0-qty row exists to preserve realized P&L
  // for an EXITED position, and this position did not exit — it LEFT, taking its realized
  // with it. A husk here would assert "nothing was ever realized in this account", which is
  // not a fact we hold. (The delete cascades its holding_lots.)
  await tx.holding.deleteMany({ where: { accountId: sourceAccountId, instrumentId } });

  const after = await snapshotPosition(tx, destinationAccountId, instrumentId, symbol);
  return { before, after, merged, deduped };
}

// ═══════════════════════════════════════════════════════════════════════
// MANUAL → MANUAL (rule 1) — re-parent one instrument's full position.
// ═══════════════════════════════════════════════════════════════════════
export async function transferManualPosition(
  userId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  symbolRaw: string,
): Promise<TransferResult> {
  const { source, destination } = await requireBothAccounts(userId, sourceAccountId, destinationAccountId);

  // A LINKED source does not come through here — it has no manual ledger to re-parent (5.5 made a
  // linked account broker-only). Its exit is rescue, which takes the WHOLE account. Refusing here
  // is what makes "no cherry-picking out of a broker book" structural rather than a promise.
  if (source.state !== "manual") {
    throw new TransferError(
      409,
      "source_linked",
      `"${source.name}" is broker-managed — a single holding cannot be moved out of it. Transfer the whole account to a ${source.broker} manual account (which removes the linked account), or unlink it first.`,
    );
  }
  requireWritableDestination(destination);
  // NOTE: rule 1 imposes NO same-broker restriction here. A manual ledger belongs to the USER,
  // not to a broker, so a Zerodha book's position may move to an Upstox book. Deliberate.

  // (Step 20) Resolve to an INSTRUMENT, not a stock — an ETF, a fund or a bond can be held manually
  // now, so it can be transferred between manual books like anything else. ISIN or symbol; an
  // ambiguous symbol is refused rather than guessed (three bonds share "IMC1").
  const symbol = symbolRaw.trim().toUpperCase();
  let instrument;
  try {
    instrument = await resolveInstrument(prisma, symbol);
  } catch (e) {
    if (e instanceof InstrumentResolveError) throw new TransferError(e.httpStatus, e.code, e.message);
    throw e;
  }

  try {
    // ONE instrument, its OWN transaction, through the SHARED per-position core. The whole-account
    // path (transferAllManualPositions) runs the very same core, looped, on one shared tx.
    const result = await prisma.$transaction((tx) =>
      movePositionWithinTx({
        tx,
        userId,
        sourceAccountId: source.id,
        sourceName: source.name,
        destinationAccountId: destination.id,
        instrumentId: instrument.id,
        symbol,
      }),
    );

    // The book changed → refresh PHS. FIRE-AND-FORGET: the write already committed, so the response
    // must not wait on a whole-portfolio rescore (the dominant latency for a large book).
    refreshPhs(userId);

    return {
      kind: "manual",
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      merged: result.merged,
      dedupedCorporateActions: result.deduped,
      destination: [toDelta(result.before, result.after)],
    };
  } catch (e) {
    throw mapReplayFailure(e, symbol);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MANUAL → MANUAL, WHOLE ACCOUNT (Stage 2) — every position moves, ATOMICALLY.
//
// The product rule is all-or-nothing. The only way the frontend could express it before was to
// loop the single-position endpoint per holding — which is NON-ATOMIC: a failure at holding 4 of 7
// leaves a half-moved book, two accounts each owning part of a position, lots split across them.
// That is a corrupted ledger no UI can repair. So the whole move runs on ONE transaction: every
// position moves, or none does.
//
//   • BOTH accounts must be MANUAL. A linked source → 409 (its exit is rescue — a different truth:
//     a broker mirror, not a user ledger). A linked destination → 409 (the mirror wall).
//   • THE BROKER TAG IS IRRELEVANT — a Zerodha manual book may move to a Groww manual book. A manual
//     ledger belongs to the USER, not a broker (§2.4). The same-broker rule exists ONLY on rescue.
//   • SET-BASED, NOT LOOPED. The per-position core (movePositionWithinTx) costs ~10 round-trips PER
//     instrument, all serialized inside the one interactive transaction — a real book blew even a
//     generous timeout. This path does the SAME work (R1 dedup, R2 FIFO merge, re-parent, source
//     cleanup) but batched: a handful of bulk reads, ONE re-parent updateMany, an IN-MEMORY
//     replayFifo per instrument, then chunked createMany writes. The number of round-trips no longer
//     grows with the number of holdings. The ECONOMICS still route through the ONE shared engine
//     (replayFifo), so the number that matters — realized P&L — cannot drift from the single path.
//     Equivalence is exact: FIFO queues are per-(account, instrument), so replaying every position
//     together is byte-identical to replaying them one at a time, and before/after deltas are read
//     back from the DB (column-rounded), exactly as the looped snapshotPosition did.
//   • "Every position" = every distinct instrument in the source's TRANSACTIONS (the source of
//     truth). That includes fully-exited positions (qty 0, realized P&L only): their history moves
//     too, and it is what lets the emptied source be deleted with nothing stranded.
//   • deleteSource decides the emptied source's fate — kept (empty) or removed. NO date is ever
//     synthesised: this re-parents real transactions, every one of which already has its date.
// ═══════════════════════════════════════════════════════════════════════
export async function transferAllManualPositions(
  userId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  deleteSource: boolean,
): Promise<TransferResult> {
  const { source, destination } = await requireBothAccounts(userId, sourceAccountId, destinationAccountId);

  // Source must be a manual ledger — a broker account leaves through rescue (whole-book, same-broker,
  // deletes the connection), which is a different door and a different truth. Not merged here.
  if (source.state !== "manual") {
    throw new TransferError(
      409,
      "source_linked",
      `"${source.name}" is broker-managed — its holdings mirror the broker, so they cannot be moved as manual positions. Transfer the whole account to a ${source.broker} manual account (rescue), or unlink it first.`,
    );
  }
  // Destination must be manual too — the mirror wall (nothing is written into a linked account).
  requireWritableDestination(destination);
  // NOTE: deliberately NO same-broker gate. A manual ledger is the user's, not a broker's.

  try {
    const out = await prisma.$transaction(async (tx) => {
      // ── 1. THE SOURCE LEDGER IN ONE READ. It yields BOTH the distinct instrument set (what "every
      // position" means — including fully-exited qty-0 positions, whose history moves too) AND the
      // split/bonus rows R1 dedup needs, replacing the per-instrument findMany the old loop issued.
      const sourceTxns = await tx.transaction.findMany({
        where: { accountId: source.id },
        select: { id: true, instrumentId: true, type: true, tradeDate: true, ratio: true },
      });
      if (sourceTxns.length === 0) {
        // An empty manual account has nothing to move. Deleting an empty account is the DELETE
        // endpoint's job, not this one — refuse rather than silently no-op (mirrors rescue's
        // nothing_to_rescue).
        throw new TransferError(400, "nothing_to_transfer", `"${source.name}" holds no positions to transfer.`);
      }
      // Distinct instruments, deterministic order (id asc — uuids sort identically in JS and PG) so
      // the result, and any test asserting on it, is reproducible.
      const instrumentIds = [...new Set(sourceTxns.map((t) => t.instrumentId))].sort();
      // Source split/bonus rows grouped by instrument — the only rows R1 dedup can drop.
      const srcActionsByInstr = new Map<string, typeof sourceTxns>();
      for (const t of sourceTxns) {
        if (t.type === "split" || t.type === "bonus") {
          const arr = srcActionsByInstr.get(t.instrumentId) ?? [];
          arr.push(t);
          srcActionsByInstr.set(t.instrumentId, arr);
        }
      }

      // ── 2. Display labels (delta rows + dedup detail) + the denormalised stock pointer for the
      // rematerialized holding. A fund has no ticker (instruments.symbol NULL) → fall back to its
      // ISIN, exactly as the union read does. Never a key.
      const instrs = await tx.instrument.findMany({
        where: { id: { in: instrumentIds } },
        select: { id: true, symbol: true, isin: true, stockId: true },
      });
      const labelById = new Map(instrs.map((i) => [i.id, i.symbol ?? i.isin]));
      const stockIdById = new Map(instrs.map((i) => [i.id, i.stockId]));

      // ── 3. The destination's CURRENT positions for these instruments (read BEFORE any mutation):
      // the R2 "before" snapshot AND the merge test — an instrument present here means two FIFO
      // queues will become one. (Read now is equivalent to per-instrument reads: distinct
      // instruments have independent queues, so no move perturbs another's before-state.)
      const destBefore = await tx.holding.findMany({
        where: { accountId: destination.id, instrumentId: { in: instrumentIds } },
        select: { instrumentId: true, quantity: true, avgCost: true, realizedPnl: true },
      });
      const beforeByInstr = new Map(destBefore.map((h) => [h.instrumentId, h]));
      const anyMerged = destBefore.length > 0;

      // ── 4. R1: DEDUPE THE CORPORATE ACTIONS — only where the destination ALREADY records the same
      // market event. One split/bonus row per (type, tradeDate, ratio) survives the merge; the
      // source's duplicate is dropped, or the combined replay applies it twice and invents shares.
      // A fresh instrument has no destination actions, so only merges can dedupe → gate on anyMerged.
      const dedupedAll: TransferResult["dedupedCorporateActions"] = [];
      if (anyMerged) {
        const destActions = await tx.transaction.findMany({
          where: { accountId: destination.id, instrumentId: { in: instrumentIds }, type: { in: ["split", "bonus"] } },
          select: { instrumentId: true, type: true, tradeDate: true, ratio: true },
        });
        const key = (t: { type: string; tradeDate: Date; ratio: string | null }) =>
          `${t.type}|${t.tradeDate.toISOString().slice(0, 10)}|${t.ratio ?? ""}`;
        const destKeysByInstr = new Map<string, Set<string>>();
        for (const a of destActions) {
          const s = destKeysByInstr.get(a.instrumentId) ?? new Set<string>();
          s.add(key(a));
          destKeysByInstr.set(a.instrumentId, s);
        }
        const dupeIds: string[] = [];
        for (const instrumentId of instrumentIds) {
          const destKeys = destKeysByInstr.get(instrumentId);
          if (!destKeys) continue; // fresh instrument (or no dest actions) — nothing to dedupe
          const label = labelById.get(instrumentId) ?? instrumentId;
          for (const t of srcActionsByInstr.get(instrumentId) ?? []) {
            if (destKeys.has(key(t))) {
              dupeIds.push(t.id);
              dedupedAll.push({ symbol: label, type: t.type, tradeDate: t.tradeDate.toISOString().slice(0, 10), ratio: t.ratio });
            }
          }
        }
        if (dupeIds.length > 0) {
          await tx.transaction.deleteMany({ where: { id: { in: dupeIds } } });
        }
      }

      // ── 5. THE TRANSFER ITSELF: one column, for the WHOLE account in ONE statement. Everything
      // else (holding rows, lot registers, avg cost, realized P&L) is DERIVED and rebuilt below.
      // After the dedup delete above, every remaining source row moves.
      await tx.transaction.updateMany({
        where: { accountId: source.id },
        data: { accountId: destination.id },
      });

      // ── 6. Read the COMBINED, deduped ledger for every affected instrument in ONE replay-ordered
      // query, group in memory, and replay each with the pure FIFO engine — NO per-instrument round
      // trip. This is the optimisation: the only work that grows with holding count is CPU, in-memory.
      const combined = await tx.transaction.findMany({
        where: { accountId: destination.id, instrumentId: { in: instrumentIds } },
        orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, instrumentId: true, type: true, quantity: true, price: true, fees: true, tradeDate: true, ratio: true, createdAt: true },
      });
      const ledgerByInstr = new Map<string, LedgerTxn[]>();
      for (const t of combined) {
        const arr = ledgerByInstr.get(t.instrumentId) ?? [];
        arr.push({ id: t.id, type: t.type, quantity: t.quantity, price: t.price, fees: t.fees, tradeDate: t.tradeDate, ratio: t.ratio, createdAt: t.createdAt });
        ledgerByInstr.set(t.instrumentId, arr);
      }

      const now = new Date();
      const holdingRows: Prisma.HoldingCreateManyInput[] = [];
      const lotsByInstr = new Map<string, ReturnType<typeof replayFifo>["lots"]>();
      for (const instrumentId of instrumentIds) {
        const result = replayFifo(ledgerByInstr.get(instrumentId) ?? []); // OversellError → rollback (mapReplayFailure)
        lotsByInstr.set(instrumentId, result.lots);
        holdingRows.push({
          userId,
          accountId: destination.id,
          instrumentId,
          stockId: stockIdById.get(instrumentId) ?? null,
          quantity: result.quantity,
          avgCost: result.avgCost,
          investedValue: result.investedValue,
          realizedPnl: result.realizedPnl,
          lastComputedAt: now,
        });
      }

      // ── 7. Rewrite the materialized projection in bulk. Delete both sides' rows first — dest: the
      // old pre-merge rows + their lots (cascade); source: the husks the emptied ledger leaves —
      // then re-create the destination holdings from the replay. Set-based: a handful of statements
      // for the whole account, chunked to stay under the 65535-bind-parameter ceiling.
      await tx.holding.deleteMany({ where: { accountId: destination.id, instrumentId: { in: instrumentIds } } });
      await tx.holding.deleteMany({ where: { accountId: source.id } });
      for (const batch of chunk(holdingRows, HOLDING_BATCH)) {
        await tx.holding.createMany({ data: batch });
      }

      // ── 8. Read back the created holdings — their ids (to parent the lots) AND their column-rounded
      // values (the R2 "after" snapshot, read from the DB exactly as the looped snapshotPosition was,
      // so the reported deltas round identically to the stored rows).
      const created = await tx.holding.findMany({
        where: { accountId: destination.id, instrumentId: { in: instrumentIds } },
        select: { id: true, instrumentId: true, quantity: true, avgCost: true, realizedPnl: true },
      });
      const afterByInstr = new Map(created.map((h) => [h.instrumentId, h]));
      const holdingIdByInstr = new Map(created.map((h) => [h.instrumentId, h.id]));

      const lotData: Prisma.HoldingLotCreateManyInput[] = [];
      for (const instrumentId of instrumentIds) {
        const holdingId = holdingIdByInstr.get(instrumentId);
        if (!holdingId) continue; // unreachable: step 7 created one per instrument
        for (const l of lotsByInstr.get(instrumentId) ?? []) {
          lotData.push({ holdingId, quantity: l.quantity, costPerShare: l.costPerShare, buyDate: l.buyDate, sourceTxnId: l.sourceTxnId });
        }
      }
      for (const batch of chunk(lotData, LOT_BATCH)) {
        await tx.holdingLot.createMany({ data: batch });
      }

      // ── 9. The R2 disclosure: per-instrument before → after on the destination, in instrument order.
      const deltas: PositionDelta[] = instrumentIds.map((instrumentId) => {
        const before = beforeByInstr.get(instrumentId);
        const after = afterByInstr.get(instrumentId);
        const label = labelById.get(instrumentId) ?? instrumentId;
        return toDelta(
          { symbol: label, quantity: dstr(before?.quantity), avgCost: dstr(before?.avgCost), realizedPnl: dstr(before?.realizedPnl) },
          { quantity: dstr(after?.quantity), avgCost: dstr(after?.avgCost), realizedPnl: dstr(after?.realizedPnl) },
        );
      });

      // ── 10. Keep or delete the now-emptied source, per the request flag.
      let deletedAccount: TransferResult["deletedAccount"] | undefined;
      if (deleteSource) {
        // FAIL-CLOSED INVARIANT: the source must be truly empty before we remove it. Every row was
        // re-parented and every source holding deleted above, so this should always hold — but if it
        // does not, the throw rolls the WHOLE transaction back and we delete nothing. We never
        // destroy an account that still owns rows. (The user keeps ≥1 account: the destination survives.)
        const [remTxns, remHoldings] = await Promise.all([
          tx.transaction.count({ where: { accountId: source.id } }),
          tx.holding.count({ where: { accountId: source.id } }),
        ]);
        if (remTxns > 0 || remHoldings > 0) {
          throw new TransferError(
            500,
            "source_not_empty",
            `internal: "${source.name}" still holds ${remTxns} transaction(s) and ${remHoldings} holding(s) after the move — nothing was transferred or deleted.`,
          );
        }
        await tx.portfolioAccount.delete({ where: { id: source.id } });
        deletedAccount = { id: source.id, name: source.name };
      }

      return { deltas, dedupedAll, anyMerged, deletedAccount };
    }, {
      // The move is SET-BASED now: a fixed handful of statements (bulk reads, ONE re-parent
      // updateMany, chunked createMany writes) plus an in-memory FIFO replay per instrument — the
      // round-trip count no longer grows with the number of holdings, which is what once blew even
      // this budget on a real book. Still ONE interactive transaction, so it stays all-or-nothing;
      // the ceiling is kept generous and below the DB's idle-in-transaction / pooler timeout.
      timeout: 30_000,
      maxWait: 10_000,
    });

    // The book changed → refresh PHS. FIRE-AND-FORGET: the write already committed, so the response
    // must not wait on a whole-portfolio rescore (the dominant latency for a large book).
    refreshPhs(userId);

    return {
      kind: "manual_all",
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      merged: out.anyMerged,
      dedupedCorporateActions: out.dedupedAll,
      destination: out.deltas,
      ...(out.deletedAccount ? { deletedAccount: out.deletedAccount } : {}),
      sourceKept: !deleteSource,
    };
  } catch (e) {
    throw mapReplayFailure(e, "transfer-all");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LINKED → SAME-BROKER MANUAL (rule 2) = RESCUE-ON-DELETE.
// The whole account moves, then the account and its connection are destroyed.
// ═══════════════════════════════════════════════════════════════════════
export async function rescueLinkedAccount(
  userId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  confirm: boolean,
): Promise<TransferResult> {
  const { source, destination } = await requireBothAccounts(userId, sourceAccountId, destinationAccountId);

  if (source.state === "manual" || source.brokerConnectionId === null) {
    // Includes the post-clear-data shell (stale, unbound): it has NO broker holdings left, so
    // there is nothing to rescue — and it is already deletable through the ordinary delete path.
    throw new TransferError(
      409,
      "source_not_linked",
      `"${source.name}" is not a linked broker account — there is nothing to rescue. Transfer an individual holding instead, or delete the account.`,
    );
  }
  requireWritableDestination(destination);

  // RULE 2 — SAME BROKER. A Zerodha book's positions land in a Zerodha book. The check is a plain
  // field compare on two rows (5.5 made `broker` NOT NULL, so it is total) — and it is a real
  // guard, not a formality: `zerodha` and `upstox` are both perfectly valid strings, and a rescue
  // into the wrong broker's book would relabel the user's demat with no error anywhere.
  if (source.broker !== destination.broker) {
    throw new TransferError(
      400,
      "broker_mismatch",
      `"${source.name}" is a ${source.broker} account — its holdings can only move to a ${source.broker} manual account. "${destination.name}" is ${destination.broker}. Create a ${source.broker} manual account first, then transfer into it.`,
      { sourceBroker: source.broker, destinationBroker: destination.broker },
    );
  }

  const brokerHoldings = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: source.brokerConnectionId },
    select: { symbol: true, stockId: true, instrumentId: true, quantity: true, avgCost: true, syncedAt: true },
    orderBy: { symbol: "asc" },
  });
  if (brokerHoldings.length === 0) {
    throw new TransferError(
      400,
      "nothing_to_rescue",
      `"${source.name}" holds no broker positions — there is nothing to transfer. Unlink and clear its connection to remove the account.`,
    );
  }

  // ── R4: FAIL LOUD ON WHAT WE CANNOT EXPRESS ────────────────────────────────────────────
  //
  // (Step 20) THE TEST NARROWED, BECAUSE THE CONSTRAINT DID. This used to refuse any broker holding
  // with `stockId === null || instrumentId === null`, and the reason given was explicit: "both are
  // NOT NULL on a manual holding — it CANNOT become one." That is no longer true. `holdings.stock_id`
  // is nullable now and the INSTRUMENT is the spine, so a broker-held ETF or bond — which has a
  // catalogue instrument and no stock — is perfectly expressible as a manual holding and is rescued
  // like anything else.
  //
  // What we still cannot express is a broker symbol we could not IDENTIFY at all: no ISIN match, so
  // no instrument, so nothing to hold. That one is still refused BY NAME. Rescuing "most of" a book
  // and quietly dropping the rest would destroy a real position under the banner of preserving them.
  const unmapped = brokerHoldings.filter((b) => b.instrumentId === null);
  if (unmapped.length > 0) {
    const symbols = unmapped.map((u) => u.symbol);
    throw new TransferError(
      409,
      "unrescuable_holdings",
      `${symbols.length} holding${symbols.length === 1 ? "" : "s"} in "${source.name}" cannot be converted to manual — ${symbols.join(", ")} ${symbols.length === 1 ? "is" : "are"} outside our universe, so there is no instrument to hold ${symbols.length === 1 ? "it" : "them"}. Nothing was transferred or deleted.`,
      { symbols },
    );
  }

  // DESTRUCTIVE: this deletes the account AND its connection (forgetting the encrypted token).
  // Same explicit-consent gate as clear-data and account-delete. Checked AFTER the guards above
  // so the caller learns about an unrescuable holding BEFORE being asked to confirm anything.
  if (confirm !== true) {
    throw new TransferError(
      400,
      "confirmation_required",
      `this converts ${brokerHoldings.length} broker holding${brokerHoldings.length === 1 ? "" : "s"} in "${source.name}" into manual holdings on "${destination.name}", then permanently removes "${source.name}" and disconnects ${source.broker}. Pass confirm:true to proceed.`,
      {
        // `tradeDate` is the FABRICATED date each synthetic buy WILL carry — computed by the exact
        // same rule the R3 write uses below (`dateOnly(b.syncedAt)`), from the same column. The
        // preview is a promise and the ledger is the record; surfacing it here is what lets the UI
        // show the honest date without re-deriving it, and lets a test assert they agree row-for-row.
        willRescue: brokerHoldings.map((b) => ({
          symbol: b.symbol,
          quantity: b.quantity.toString(),
          costPerShare: b.avgCost.toString(),
          tradeDate: dateOnly(b.syncedAt).toISOString().slice(0, 10),
        })),
        willDeleteAccount: source.name,
      },
    );
  }

  const connectionId = source.brokerConnectionId;
  const conn = await prisma.brokerConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { broker: true, brokerAccountRef: true },
  });
  // The tag that makes a synthetic row honest: greppable, human-readable, and it names the demat
  // it came from — so a rescued lot can never be mistaken for a trade the user actually made.
  const tag = `[rescue:${conn.broker}:${conn.brokerAccountRef}]`;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const befores: Awaited<ReturnType<typeof snapshotPosition>>[] = [];
      const afters: Awaited<ReturnType<typeof snapshotPosition>>[] = [];
      const rescued: NonNullable<TransferResult["rescued"]> = [];
      let anyMerged = false;

      for (const b of brokerHoldings) {
        // (Step 20) The INSTRUMENT is required (R4 refused the book if any row lacked one); the STOCK
        // is optional — a rescued ETF or bond simply has none, and the ledger row carries NULL there.
        const instrumentId = b.instrumentId!;
        const stockId = b.stockId ?? null;
        const before = await snapshotPosition(tx, destination.id, instrumentId, b.symbol);
        if (before.exists) anyMerged = true;
        befores.push(before);

        // ── R3: THE SYNTHETIC BUY ──────────────────────────────────────────────────────
        // qty and cost are the BROKER's own figures (the user's real position, their real cost).
        // The DATE is not: the broker's holdings feed carries no purchase date, so we use the
        // snapshot's syncedAt — the day we last verified these shares were held. It understates
        // the true holding period (never overstates it, so it can never manufacture an LTCG
        // claim), and it lands in NAV/XIRR as a cash outflow on that date. Both are disclosed.
        const tradeDate = dateOnly(b.syncedAt);
        await tx.transaction.create({
          data: {
            userId,
            accountId: destination.id,
            instrumentId, // the spine
            stockId, //     NULL for a rescued ETF/bond — it has no row in `stocks`
            type: "buy",
            quantity: b.quantity,
            price: b.avgCost, // the broker's avg cost becomes the lot's cost — the user's real basis
            fees: null,
            tradeDate,
            ratio: null,
            notes: `${tag} opening balance carried over from ${conn.broker} on ${tradeDate.toISOString().slice(0, 10)} (broker snapshot; purchase date unknown)`,
          },
        });

        // Replay: one lot, at the broker's cost. Sellable, correctable, and it SURVIVES the next
        // write — which a ledger-less holding would not have (it would be erased by the replay).
        await replayAndMaterialize(tx, userId, destination.id, instrumentId);
        afters.push(await snapshotPosition(tx, destination.id, instrumentId, b.symbol));
        rescued.push({
          symbol: b.symbol,
          quantity: b.quantity.toString(),
          costPerShare: b.avgCost.toString(),
          tradeDate: tradeDate.toISOString().slice(0, 10),
          note: tag,
        });
      }

      // ── DELETE THE CONNECTION, NOT JUST THE ACCOUNT ────────────────────────────────────
      // The union reaches a broker holding's account via holding → connection → accounts[0]. Kill
      // the account and leave the connection, and every broker_holding row falls into the union's
      // `if (!acct) continue`: still in the table, invisible everywhere — a silent data drop
      // wearing a delete's clothes. Deleting the CONNECTION cascades broker_holdings away for
      // real, and forgets the encrypted token in the same stroke. (Verified in recon: nulling the
      // binding made 4 broker positions vanish from the union while all 4 rows remained.)
      await tx.brokerConnection.delete({ where: { id: connectionId } });
      // Then the account. It is broker-only (5.5), so this cascades nothing of value — there is
      // no manual ledger left inside a linked account to strand.
      await tx.portfolioAccount.delete({ where: { id: source.id } });

      return { befores, afters, rescued, anyMerged };
    });

    // Fire-and-forget PHS refresh (best-effort; the rescue already committed).
    refreshPhs(userId);

    return {
      kind: "rescue",
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      merged: out.anyMerged,
      dedupedCorporateActions: [], // a broker snapshot carries no corporate actions to dedupe
      destination: out.befores.map((b, i) => toDelta(b, out.afters[i])),
      deletedAccount: { id: source.id, name: source.name, connectionForgotten: true },
      rescued: out.rescued,
    };
  } catch (e) {
    throw mapReplayFailure(e, "rescue");
  }
}

// ── shared ──────────────────────────────────────────────────────────────────────────────
function toDelta(
  before: { symbol: string; quantity: string; avgCost: string; realizedPnl: string },
  after: { quantity: string; avgCost: string; realizedPnl: string },
): PositionDelta {
  return {
    symbol: before.symbol,
    quantityBefore: before.quantity,
    quantityAfter: after.quantity,
    avgCostBefore: before.avgCost,
    avgCostAfter: after.avgCost,
    realizedPnlBefore: before.realizedPnl,
    realizedPnlAfter: after.realizedPnl,
  };
}

/** An OversellError inside a transfer means the COMBINED ledger cannot replay (a merged sell now
 *  exceeds the combined open qty). The $transaction has already rolled back — nothing moved — so
 *  this is a clean 409, never a 500 and never a half-done transfer. */
function mapReplayFailure(e: unknown, what: string): unknown {
  if (e instanceof OversellError) {
    return new TransferError(
      409,
      "replay_failed",
      `the combined ledger for ${what} cannot be replayed — a sell would exceed the shares held (${e.attempted.toString()} sold, ${e.available.toString()} available). Nothing was transferred.`,
    );
  }
  return e;
}

/** PHS is a per-user snapshot; a transfer changes the book, so it is refreshed. FIRE-AND-FORGET:
 *  the transfer has ALREADY committed, so the response must neither WAIT on nor FAIL for a PHS
 *  recompute. PHS re-scores the WHOLE portfolio, so for a large book it dominates the response
 *  wall-clock (and could trip an HTTP/proxy timeout) even though the data is already durable — the
 *  set-based whole-account move made the transaction cheap, and this is now the tallest pole. We
 *  kick it off and return; it settles a moment later. Best-effort BY CONSTRUCTION: the dynamic
 *  import AND the refresh are inside the catch, so this can never reject or fail the request. The
 *  snapshot self-heals on the next write, so a lost race between overlapping refreshes is harmless. */
function refreshPhs(userId: string): void {
  void (async () => {
    try {
      const { refreshPhsForUser } = await import("./phs/refresh.js");
      await refreshPhsForUser(userId);
    } catch (e) {
      console.error("[transfer] PHS refresh failed (transfer already committed)", e);
    }
  })();
}
