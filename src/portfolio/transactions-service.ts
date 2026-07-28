// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS WRITE SERVICE — `addTransaction`, MOVED out of transactions-controller.ts.
//
// ⚠ READ THIS BEFORE TOUCHING ANYTHING HERE. This function writes to the FIFO LOT REGISTER — the
// ledger every cost basis, realized P&L and tax number in the app is derived from. It was MOVED here
// line for line, not reimplemented, and the ordering below is load-bearing:
//
//   1. parse + per-type required-field guard      (typeError — buy/sell need qty+price, split/bonus a ratio)
//   2. resolve the INSTRUMENT before the txn      (a symbol is a convenience, an ISIN is the address;
//                                                  an ambiguous symbol is REFUSED, never guessed)
//   3. capture prior stock-level open state       (must be read BEFORE the write to detect open/close)
//   4. inside ONE $transaction: resolve the writable account → create the row → replayAndMaterialize
//      An OversellError anywhere in the replay rolls the WHOLE thing back. That is the only reason an
//      invalid sell cannot leave a half-written ledger, and it only works because the create and the
//      replay share one transaction. Do not move either out of it.
//   5. after commit, best-effort: refreshPhsForUser → enqueueHistoryBackfillIfNeeded → trackPositionChange
//      All three are post-commit on purpose: the write has already succeeded, so none of them may fail it.
//
// THE SEAM: `addTransaction(input, userId)`. ★ userId is a PARAMETER, never part of `input`. A chat
// tool passes ToolContext.userId (from the verified JWT), so a model cannot file a trade in someone
// else's book no matter what it puts in the arguments.
//
// Errors are ServiceErrors carrying the EXACT body each failure has always returned — including
// oversell's `attempted`/`available` and an ambiguous symbol's `candidates` list. Callers that speak
// HTTP spread the body; callers that speak prose read `.message`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { z } from "zod";
import { Prisma, type PortfolioAccountState } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { replayAndMaterialize } from "./replay.js";
import { OversellError, corporateActionFactor } from "./fifo-engine.js";
import { refreshPhsForUser } from "./phs/refresh.js";
import { resolveInstrument, InstrumentResolveError } from "./resolve-instrument.js";
import { disclosuresFor, entryIncludesAccruedInterest } from "./disclosures.js";
import { enqueueHistoryBackfillIfNeeded } from "./history/enqueue-backfill.js";
import { emitRelationshipEvent, userHoldsStock } from "../tracking/tracking.js";
import { ServiceError, validationError } from "../lib/service-error.js";

/** Emit a position_opened / position_closed relationship event by comparing stock-level open state
 *  before vs after a trade. Best-effort (emitRelationshipEvent never throws). No-op for a non-stock
 *  instrument (stockId null) or when the open/closed state did not flip. */
export async function trackPositionChange(userId: string, stockId: string | null, priorOpen: boolean): Promise<void> {
  if (!stockId) return;
  const postOpen = await userHoldsStock(userId, stockId);
  if (!priorOpen && postOpen) await emitRelationshipEvent(userId, stockId, "position_opened");
  else if (priorOpen && !postOpen) await emitRelationshipEvent(userId, stockId, "position_closed");
}

export const RATIO_RE = /^\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\s*$/;

// ── Body schema + per-type validation (moved verbatim) ────────────────────────
export const Base = z.object({
  symbol: z.string().trim().min(1).transform((s) => s.toUpperCase()),
  type: z.enum(["buy", "sell", "split", "bonus", "dividend"]),
  tradeDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid tradeDate"),
  quantity: z.number().positive().optional(),
  price: z.number().positive().optional(),
  fees: z.number().nonnegative().optional(), // ₹ total charges (≥0); folds into basis/proceeds; absent = 0
  ratio: z.string().optional(),
  notes: z.string().max(500).optional(),
  accountId: z.string().min(1).optional(), // which account; absent → the single owned account
});
export type BaseInput = z.infer<typeof Base>;

type Tx = Prisma.TransactionClient;

/**
 * THE SINGLE FUNNEL for resolving which account a manual write lands in. Every manual-holding
 * write path goes through here, and the state guard below is applied to EVERY branch — there is
 * no path that resolves an account without facing it.
 *
 * IDOR-safe: the lookup is owner-scoped (another user's / unknown account → 404, identical).
 *
 * ── RESOLVE, NEVER CREATE (Step 5.5) ────────────────────────────────────────────────────────
 * This used to FIND-OR-CREATE a default "My Holdings" account when no accountId was given, so a
 * new user was never blocked at "name an account first". That auto-create cannot survive the
 * broker-parent model: EVERY account belongs to a broker, and this path has no broker to give —
 * it would have to invent one. So the CREATE is gone and the RESOLVE stays:
 *
 *     0 accounts  → 400. Create an account first (and pick its broker). The only place an
 *                   account can be born is POST /accounts, where the user names the broker.
 *     1 account   → resolve to it. Unambiguous, and exactly what happened before — a
 *                   single-account user's writes keep landing where they always did.
 *     2+ accounts → 400. Which book did you mean? We do not guess; guessing would silently
 *                   file a trade in the wrong broker's ledger, and every account id is a valid
 *                   string, so the mistake would be invisible.
 *
 * The state guard applies to the resolved account either way: a lone LINKED account is refused
 * (409), never quietly rerouted to some other book. The user asked to write here; we say no.
 */
export async function resolveWritableAccount(tx: Tx, userId: string, accountId?: string): Promise<{ id: string }> {
  let acc: { id: string; state: PortfolioAccountState } | null;

  if (accountId) {
    acc = await tx.portfolioAccount.findFirst({ where: { id: accountId, userId }, select: { id: true, state: true } });
    if (!acc) throw new ServiceError(404, "account_not_found", "account not found", { message: "account not found" });
  } else {
    // take:2 — enough to tell "exactly one" from "more than one" without counting the whole set.
    const owned = await tx.portfolioAccount.findMany({ where: { userId }, select: { id: true, state: true }, take: 2 });
    if (owned.length === 0) {
      const m = "create an account first (pick your broker), then add transactions to it";
      throw new ServiceError(400, "no_account", m, { message: m });
    }
    if (owned.length > 1) {
      const m = "you have more than one account — specify which one this transaction belongs to (accountId)";
      throw new ServiceError(400, "account_required", m, { message: m });
    }
    acc = owned[0];
  }

  if (acc.state !== "manual") {
    const m = "this account is broker-managed; manual entry is disabled";
    throw new ServiceError(409, "account_linked", m, { message: m });
  }
  return { id: acc.id };
}

/** Enforce the per-type required fields (buy/sell need qty+price; split/bonus need a
 *  valid ratio; dividend needs nothing beyond symbol+date). Returns an error string
 *  or null. */
export function typeError(b: BaseInput): string | null {
  switch (b.type) {
    case "buy":
    case "sell":
      if (b.quantity == null || b.price == null) return `${b.type} requires positive quantity and price`;
      return null;
    case "split":
    case "bonus":
      if (!b.ratio || !RATIO_RE.test(b.ratio)) return `${b.type} requires a ratio like "a:b" (a additional shares per b held)`;
      try { corporateActionFactor(b.ratio); } catch (e) { return (e as Error).message; }
      return null;
    case "dividend":
      return null; // price (₹/share) optional; never touches the register
  }
}

/** Build the Prisma create/update data, normalising per type (nulling out the fields
 *  that don't apply so the ledger is clean).
 *
 *  ENTRY IS UNIFORM ACROSS EVERY ASSET CLASS: quantity + price. There is no special bond path and no
 *  accrued-interest arithmetic — the user enters what they actually paid (the entry form tells a bond
 *  buyer to include accrued interest), so the cost basis is their real outlay and is correct BY
 *  CONSTRUCTION rather than by estimation. What we cannot see (coupon income) is disclosed on the
 *  holding, not guessed at here. See portfolio/disclosures.ts. */
export function txnData(
  b: BaseInput,
  accountId: string,
  instrumentId: string,
  stockId: string | null, // NULL for every non-stock instrument — a bond has no row in `stocks`
  userId: string,
) {
  const isTrade = b.type === "buy" || b.type === "sell";
  const isAction = b.type === "split" || b.type === "bonus";
  return {
    userId,
    accountId,
    instrumentId, // THE SPINE (Step 20)
    stockId, //     the denormalised convenience
    type: b.type,
    quantity: isTrade && b.quantity != null ? new Prisma.Decimal(b.quantity) : null,
    price: (isTrade || b.type === "dividend") && b.price != null ? new Prisma.Decimal(b.price) : null,
    // A charge applies to a cash event (buy/sell/dividend), not a pure lot reshape
    // (split/bonus). Folded into cost basis (buy) / proceeds (sell) by the FIFO engine.
    fees: !isAction && b.fees != null ? new Prisma.Decimal(b.fees) : null,
    tradeDate: new Date(b.tradeDate),
    ratio: isAction ? b.ratio!.replace(/\s/g, "") : null,
    notes: b.notes ?? null,
  };
}

// ── serialization ────────────────────────────────────────────
export function serializeTxn(
  t: { id: string; type: string; quantity: Prisma.Decimal | null; price: Prisma.Decimal | null; fees: Prisma.Decimal | null; tradeDate: Date; ratio: string | null; notes: string | null; createdAt: Date },
  symbol: string,
) {
  return {
    id: t.id, symbol, type: t.type,
    quantity: t.quantity?.toString() ?? null,
    price: t.price?.toString() ?? null,
    fees: t.fees?.toString() ?? null, // ₹ total charges (null = no fee recorded)
    tradeDate: t.tradeDate.toISOString().slice(0, 10),
    ratio: t.ratio, notes: t.notes,
    createdAt: t.createdAt.toISOString(),
  };
}

// ── the two foreign error types, translated into the ONE currency, shape-for-shape ──────────────────
/** An oversell keeps its `attempted`/`available` decimals — a caller must be able to say by how much. */
export function oversellError(e: OversellError): ServiceError {
  return new ServiceError(400, "oversell", e.message, {
    message: e.message,
    attempted: e.attempted.toString(),
    available: e.available.toString(),
  });
}
/** An ambiguous symbol keeps its `candidates` — the caller must be able to offer the choice. */
export function instrumentError(e: InstrumentResolveError): ServiceError {
  return new ServiceError(e.httpStatus, e.code, e.message, {
    message: e.message,
    ...(e.candidates ? { candidates: e.candidates } : {}),
  });
}

// ── ADD ─────────────────────────────────────────────────────────────────────────────────────────────
export interface AddTransactionResult {
  transaction: ReturnType<typeof serializeTxn>;
  holding: Awaited<ReturnType<typeof replayAndMaterialize>>;
  instrument: {
    isin: string;
    symbol: string | null;
    name: string;
    assetClass: string;
    disclosures: ReturnType<typeof disclosuresFor>;
    entryIncludesAccruedInterest: boolean;
  };
}

export async function addTransaction(input: unknown, userId: string): Promise<AddTransactionResult> {
  const parsed = Base.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, parsed.error.flatten().fieldErrors);
  const te = typeError(parsed.data);
  if (te) throw new ServiceError(400, "validation_error", te, { message: te });

  // ── RESOLVE THE INSTRUMENT (Step 20) — a stock, an ETF, a fund, a REIT, a bond. ──
  // Was `prisma.stock.findUnique({ symbol })`, which could only ever find a stock. `symbol` is now a
  // CONVENIENCE, not a key: a mutual fund has no ticker at all, and three bonds share "IMC1". An ISIN
  // addresses any of them unambiguously; an ambiguous symbol is REFUSED (409) with the candidates,
  // never silently resolved to one of them. See portfolio/resolve-instrument.ts.
  let instrument;
  try {
    instrument = await resolveInstrument(prisma, parsed.data.symbol);
  } catch (e) {
    if (e instanceof InstrumentResolveError) throw instrumentError(e);
    throw e;
  }

  // Behaviour tracking: capture stock-level open state BEFORE the trade (compared after the replay).
  const priorOpen = instrument.stockId ? await userHoldsStock(userId, instrument.stockId) : false;

  try {
    const out = await prisma.$transaction(async (tx) => {
      // Resolve the target account (explicit + owned + manual, or the user's single account).
      const account = await resolveWritableAccount(tx, userId, parsed.data.accountId);
      const created = await tx.transaction.create({
        data: txnData(parsed.data, account.id, instrument.id, instrument.stockId, userId),
      });
      const holding = await replayAndMaterialize(tx, userId, account.id, instrument.id);
      return { created, holding };
    });
    // The book changed → refresh the PHS snapshot (best-effort; the write already
    // committed, so a PHS failure never fails the request). Awaited so the fresh
    // snapshot is in place before the client refetches.
    //
    // A NON-STOCK holding cannot move the HEALTH score by a single point — and not because we remember
    // to skip it. (CV2 Stage 0) It now ENTERS the weight vector as unscored capital (health=null), so
    // it weighs in totalValue / coverage / Construction; but it contributes NOTHING to Quality
    // (renormalized over scored) or Signals (also renormalized over scored), so Health is invariant to
    // it BY CONSTRUCTION. Health-neutral is structural here, not a flag.
    await refreshPhsForUser(userId);
    // (Step 21) If this is the FIRST hold of a non-stock instrument, backfill its weekly chart
    // series once — off the request path, deduped, best-effort. A stock is skipped (daily path).
    await enqueueHistoryBackfillIfNeeded(instrument.id, instrument.stockId, `user:${userId}`);
    // Behaviour tracking: opened/closed derived from before-vs-after stock-level open state. Best-effort.
    await trackPositionChange(userId, instrument.stockId, priorOpen);

    return {
      transaction: serializeTxn(out.created, instrument.symbol ?? instrument.isin),
      holding: out.holding,
      instrument: {
        isin: instrument.isin,
        symbol: instrument.symbol,
        name: instrument.name,
        assetClass: instrument.assetClass,
        // The frontend renders these; the backend only carries the truth.
        disclosures: disclosuresFor(instrument.assetClass, instrument.attributes as Record<string, unknown> | null),
        entryIncludesAccruedInterest: entryIncludesAccruedInterest(instrument.assetClass),
      },
    };
  } catch (e) {
    // The account guards already throw ServiceError; only the FIFO engine's own error needs translating.
    if (e instanceof OversellError) throw oversellError(e);
    throw e;
  }
}
