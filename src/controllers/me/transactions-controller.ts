// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO TRANSACTIONS — the authenticated user's own ledger (req.authUser).
//
//   POST   /api/v1/me/transactions       add a txn → full FIFO replay → updated holding
//   GET    /api/v1/me/transactions       the ledger (newest first)
//   PATCH  /api/v1/me/transactions/:id   correct a txn → full replay
//   DELETE /api/v1/me/transactions/:id   remove a txn → full replay
//
// SECURITY: owner = req.authUser.userId (public.users.id), NEVER the payload — there
// is no userId input, so IDOR is structurally impossible. Mutations on :id are
// ownership-scoped (where: { id, userId }); a non-owner gets 404.
//
// CORRECTNESS: every write runs INSIDE prisma.$transaction with a full ledger replay
// (replayAndMaterialize). An OversellError (a sell — or a correction that makes an
// existing sell invalid) rolls the whole write back → 400, ledger stays consistent.
//
// Envelope: { success, data } / { success:false, error, ... } — matches /me/onboarding.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, type PortfolioAccountState } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { replayAndMaterialize } from "../../portfolio/replay.js";
import { OversellError, corporateActionFactor } from "../../portfolio/fifo-engine.js";
import { refreshPhsForUser } from "../../portfolio/phs/refresh.js";
import { resolveInstrument, InstrumentResolveError } from "../../portfolio/resolve-instrument.js";
import { disclosuresFor, entryIncludesAccruedInterest } from "../../portfolio/disclosures.js";
import { enqueueHistoryBackfillIfNeeded } from "../../portfolio/history/enqueue-backfill.js";

const RATIO_RE = /^\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\s*$/;

// ── Body schema + per-type validation ────────────────────────
const Base = z.object({
  symbol: z.string().trim().min(1).transform((s) => s.toUpperCase()),
  type: z.enum(["buy", "sell", "split", "bonus", "dividend"]),
  tradeDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid tradeDate"),
  quantity: z.number().positive().optional(),
  price: z.number().positive().optional(),
  fees: z.number().nonnegative().optional(), // ₹ total charges (≥0); folds into basis/proceeds; absent = 0
  ratio: z.string().optional(),
  notes: z.string().max(500).optional(),
  accountId: z.string().min(1).optional(), // which account; absent → the default "My Holdings"
});

type Tx = Prisma.TransactionClient;

/** Account-resolution failures the write path maps to HTTP (inside $transaction → rolls back). */
class AccountError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string, message: string) {
    super(message);
    this.name = "AccountError";
  }
}

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
async function resolveWritableAccount(tx: Tx, userId: string, accountId?: string): Promise<{ id: string }> {
  let acc: { id: string; state: PortfolioAccountState } | null;

  if (accountId) {
    acc = await tx.portfolioAccount.findFirst({ where: { id: accountId, userId }, select: { id: true, state: true } });
    if (!acc) throw new AccountError(404, "account_not_found", "account not found");
  } else {
    // take:2 — enough to tell "exactly one" from "more than one" without counting the whole set.
    const owned = await tx.portfolioAccount.findMany({ where: { userId }, select: { id: true, state: true }, take: 2 });
    if (owned.length === 0) {
      throw new AccountError(400, "no_account", "create an account first (pick your broker), then add transactions to it");
    }
    if (owned.length > 1) {
      throw new AccountError(400, "account_required", "you have more than one account — specify which one this transaction belongs to (accountId)");
    }
    acc = owned[0];
  }

  if (acc.state !== "manual") {
    throw new AccountError(409, "account_linked", "this account is broker-managed; manual entry is disabled");
  }
  return { id: acc.id };
}

/** Enforce the per-type required fields (buy/sell need qty+price; split/bonus need a
 *  valid ratio; dividend needs nothing beyond symbol+date). Returns an error string
 *  or null. */
function typeError(b: z.infer<typeof Base>): string | null {
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
function txnData(
  b: z.infer<typeof Base>,
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

function mapOversell(res: Response, e: OversellError): Response {
  return res.status(400).json({
    success: false,
    error: "oversell",
    message: e.message,
    attempted: e.attempted.toString(),
    available: e.available.toString(),
  });
}

// ── POST /transactions ───────────────────────────────────────
export const addTransaction = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = Base.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  const te = typeError(parsed.data);
  if (te) return res.status(400).json({ success: false, error: "validation_error", message: te });

  // ── RESOLVE THE INSTRUMENT (Step 20) — a stock, an ETF, a fund, a REIT, a bond. ──
  // Was `prisma.stock.findUnique({ symbol })`, which could only ever find a stock. `symbol` is now a
  // CONVENIENCE, not a key: a mutual fund has no ticker at all, and three bonds share "IMC1". An ISIN
  // addresses any of them unambiguously; an ambiguous symbol is REFUSED (409) with the candidates,
  // never silently resolved to one of them. See portfolio/resolve-instrument.ts.
  let instrument;
  try {
    instrument = await resolveInstrument(prisma, parsed.data.symbol);
  } catch (e) {
    if (e instanceof InstrumentResolveError) {
      return res.status(e.httpStatus).json({
        success: false, error: e.code, message: e.message,
        ...(e.candidates ? { candidates: e.candidates } : {}),
      });
    }
    throw e;
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      // Resolve the target account (explicit + owned + manual, or the default "My Holdings").
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
    return res.status(201).json({
      success: true,
      data: {
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
      },
    });
  } catch (e) {
    if (e instanceof OversellError) return mapOversell(res, e);
    if (e instanceof AccountError) return res.status(e.httpStatus).json({ success: false, error: e.code, message: e.message });
    console.error("[POST /me/transactions]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to add transaction" });
  }
};

// ── GET /transactions ────────────────────────────────────────
// Optional `accountId` scopes the ledger to a single account. Absent → the whole user's ledger,
// exactly as before. Ownership is enforced by the SAME shape used everywhere in the /me
// controllers (cf. listAlertEvents): the query is owner-scoped by userId, and the accountId
// filter is ANDed on top of it — so a foreign or unknown accountId simply matches no rows (empty
// list, success), indistinguishable from an owned-but-empty account. No existence is leaked, and
// an empty book is an honest empty, never a 404.
const ListQuery = z.object({
  accountId: z.string().trim().min(1).optional(),
});
export const listTransactions = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  const { accountId } = parsed.data;

  const rows = await prisma.transaction.findMany({
    // Owner-scoped: only the user's OWN rows. An accountId filter (if given) is ALSO constrained by
    // userId, so it can never read another user's ledger — a non-owned id just yields nothing.
    where: { userId, ...(accountId ? { accountId } : {}) },
    orderBy: [{ tradeDate: "desc" }, { createdAt: "desc" }],
    // `stock` is now NULLABLE (Step 20) — a bond/fund/ETF transaction has none. The INSTRUMENT is the
    // spine and is always present, so the display label falls back to it, and finally to the ISIN
    // (a mutual fund has no ticker at all — 17,567 of them).
    include: {
      stock: { select: { symbol: true, name: true } },
      instrument: { select: { symbol: true, isin: true, name: true, assetClass: true } },
      account: { select: { name: true } }, // the book's DISPLAY name ("Grow 1"/"demo") — the only added join
    },
  });
  return res.json({
    success: true,
    data: rows.map((r) => ({
      ...serializeTxn(r, r.stock?.symbol ?? r.instrument.symbol ?? r.instrument.isin),
      accountId: r.accountId, // NOT NULL in the schema → non-nullable on the wire (the KEY)
      accountName: r.account.name, // its human-readable name; PortfolioAccount.name is NOT NULL
      assetClass: r.instrument.assetClass,
      isin: r.instrument.isin,
      // The human-readable instrument NAME (a fund's real name, not its ISIN). Instrument.name is NOT
      // NULL, so this is always present; `stock.name` wins for equities to mirror the symbol fallback.
      name: r.stock?.name ?? r.instrument.name,
    })),
  });
};

// ── PATCH /transactions/:id ──────────────────────────────────
const Patch = Base.partial().omit({ symbol: true, accountId: true }); // instrument + account fixed at create
export const patchTransaction = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id);
  const existing = await prisma.transaction.findFirst({
    where: { id, userId },
    include: {
      stock: { select: { id: true, symbol: true } },
      instrument: { select: { id: true, symbol: true, isin: true } },
      account: { select: { state: true } },
    },
  });
  if (!existing) return res.status(404).json({ success: false, error: "not_found", message: "Transaction not found" });
  // Manual entry is disabled on a broker-managed (linked) account — corrections included.
  if (existing.account.state !== "manual") return res.status(409).json({ success: false, error: "account_linked", message: "this account is broker-managed; manual entry is disabled" });

  const parsed = Patch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  // Merge the patch onto the existing row, then re-validate the WHOLE thing per type.
  // The instrument is FIXED at create — a correction may change the numbers, never WHAT was bought.
  const merged = {
    symbol: existing.stock?.symbol ?? existing.instrument.symbol ?? existing.instrument.isin,
    type: parsed.data.type ?? existing.type,
    tradeDate: parsed.data.tradeDate ?? existing.tradeDate.toISOString().slice(0, 10),
    quantity: parsed.data.quantity ?? (existing.quantity != null ? Number(existing.quantity) : undefined),
    price: parsed.data.price ?? (existing.price != null ? Number(existing.price) : undefined),
    fees: parsed.data.fees ?? (existing.fees != null ? Number(existing.fees) : undefined),
    ratio: parsed.data.ratio ?? existing.ratio ?? undefined,
    notes: parsed.data.notes ?? existing.notes ?? undefined,
  } as z.infer<typeof Base>;
  const te = typeError(merged);
  if (te) return res.status(400).json({ success: false, error: "validation_error", message: te });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: txnData(merged, existing.accountId, existing.instrument.id, existing.stock?.id ?? null, userId),
      });
      const holding = await replayAndMaterialize(tx, userId, existing.accountId, existing.instrument.id);
      return holding;
    });
    await refreshPhsForUser(userId); // book changed → refresh PHS (best-effort)
    return res.json({ success: true, data: { holding: out } });
  } catch (e) {
    if (e instanceof OversellError) return mapOversell(res, e);
    console.error("[PATCH /me/transactions/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to update transaction" });
  }
};

// ── DELETE /transactions/:id ─────────────────────────────────
export const deleteTransaction = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id);
  const existing = await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true, instrumentId: true, accountId: true, account: { select: { state: true } } } });
  if (!existing) return res.status(404).json({ success: false, error: "not_found", message: "Transaction not found" });
  if (existing.account.state !== "manual") return res.status(409).json({ success: false, error: "account_linked", message: "this account is broker-managed; manual entry is disabled" });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id } });
      // Replay what REMAINS of this instrument's ledger. The holding row survives at qty=0 so its
      // realized P&L is preserved (a deleted transaction is a correction, not an un-happening).
      const holding = await replayAndMaterialize(tx, userId, existing.accountId, existing.instrumentId);
      return holding;
    });
    await refreshPhsForUser(userId); // book changed → refresh PHS (best-effort)
    return res.json({ success: true, data: { holding: out } });
  } catch (e) {
    if (e instanceof OversellError) return mapOversell(res, e);
    console.error("[DELETE /me/transactions/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to delete transaction" });
  }
};

// ── serialization ────────────────────────────────────────────
function serializeTxn(t: { id: string; type: string; quantity: Prisma.Decimal | null; price: Prisma.Decimal | null; fees: Prisma.Decimal | null; tradeDate: Date; ratio: string | null; notes: string | null; createdAt: Date }, symbol: string) {
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
