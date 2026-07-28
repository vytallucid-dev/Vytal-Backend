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
// ★ ADD LIVES IN src/portfolio/transactions-service.ts (Stage 3, Phase A) — together with
// the Base schema, the per-type guards, the account funnel and the serializers, which PATCH
// and DELETE below still share. It was MOVED, not reimplemented: this writes the FIFO lot
// register, and the chat recordTransaction tool calls the very same function.
//
// Envelope: { success, data } / { success:false, error, ... } — matches /me/onboarding.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { replayAndMaterialize } from "../../portfolio/replay.js";
import { OversellError } from "../../portfolio/fifo-engine.js";
import { refreshPhsForUser } from "../../portfolio/phs/refresh.js";
import {
  Base,
  typeError,
  txnData,
  serializeTxn,
  trackPositionChange,
  oversellError,
  addTransaction as addTransactionSvc,
} from "../../portfolio/transactions-service.js";
import { userHoldsStock } from "../../tracking/tracking.js";
import { ServiceError, sendServiceError } from "../../lib/service-error.js";
import { z } from "zod";

/** Oversell → the ONE body shape, built in the service so add/patch/delete cannot disagree. */
function mapOversell(res: Response, e: OversellError): Response {
  return sendServiceError(res, oversellError(e));
}

// ── POST /transactions ───────────────────────────────────────
export const addTransaction = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const data = await addTransactionSvc(req.body, userId);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    if (e instanceof ServiceError) return sendServiceError(res, e);
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
  const existing = await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true, instrumentId: true, accountId: true, instrument: { select: { stockId: true } }, account: { select: { state: true } } } });
  if (!existing) return res.status(404).json({ success: false, error: "not_found", message: "Transaction not found" });
  if (existing.account.state !== "manual") return res.status(409).json({ success: false, error: "account_linked", message: "this account is broker-managed; manual entry is disabled" });

  // Behaviour tracking: capture stock-level open state BEFORE the delete-replay.
  const stockId = existing.instrument.stockId;
  const priorOpen = stockId ? await userHoldsStock(userId, stockId) : false;

  try {
    const out = await prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id } });
      // Replay what REMAINS of this instrument's ledger. The holding row survives at qty=0 so its
      // realized P&L is preserved (a deleted transaction is a correction, not an un-happening).
      const holding = await replayAndMaterialize(tx, userId, existing.accountId, existing.instrumentId);
      return holding;
    });
    await refreshPhsForUser(userId); // book changed → refresh PHS (best-effort)
    // Behaviour tracking: a delete can close (removed the only buy) or re-open (removed a sell). Best-effort.
    await trackPositionChange(userId, stockId, priorOpen);
    return res.json({ success: true, data: { holding: out } });
  } catch (e) {
    if (e instanceof OversellError) return mapOversell(res, e);
    console.error("[DELETE /me/transactions/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to delete transaction" });
  }
};
