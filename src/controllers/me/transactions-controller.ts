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
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { replayAndMaterialize } from "../../portfolio/replay.js";
import { OversellError, corporateActionFactor } from "../../portfolio/fifo-engine.js";
import { refreshPhsForUser } from "../../portfolio/phs/refresh.js";

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
});

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
 *  that don't apply so the ledger is clean). */
function txnData(b: z.infer<typeof Base>, stockId: string, userId: string) {
  const isTrade = b.type === "buy" || b.type === "sell";
  const isAction = b.type === "split" || b.type === "bonus";
  return {
    userId,
    stockId,
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

  const stock = await prisma.stock.findUnique({ where: { symbol: parsed.data.symbol }, select: { id: true, symbol: true } });
  if (!stock) return res.status(400).json({ success: false, error: "stock_not_found", message: `${parsed.data.symbol} is not in the universe` });

  try {
    const out = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({ data: txnData(parsed.data, stock.id, userId) });
      const holding = await replayAndMaterialize(tx, userId, stock.id);
      return { created, holding };
    });
    // The book changed → refresh the PHS snapshot (best-effort; the write already
    // committed, so a PHS failure never fails the request). Awaited so the fresh
    // snapshot is in place before the client refetches.
    await refreshPhsForUser(userId);
    return res.status(201).json({ success: true, data: { transaction: serializeTxn(out.created, stock.symbol), holding: out.holding } });
  } catch (e) {
    if (e instanceof OversellError) return mapOversell(res, e);
    console.error("[POST /me/transactions]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to add transaction" });
  }
};

// ── GET /transactions ────────────────────────────────────────
export const listTransactions = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const rows = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ tradeDate: "desc" }, { createdAt: "desc" }],
    include: { stock: { select: { symbol: true, name: true } } },
  });
  return res.json({ success: true, data: rows.map((r) => serializeTxn(r, r.stock.symbol)) });
};

// ── PATCH /transactions/:id ──────────────────────────────────
const Patch = Base.partial().omit({ symbol: true }); // symbol/stock not editable; correct the numbers/type/date
export const patchTransaction = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id);
  const existing = await prisma.transaction.findFirst({ where: { id, userId }, include: { stock: { select: { id: true, symbol: true } } } });
  if (!existing) return res.status(404).json({ success: false, error: "not_found", message: "Transaction not found" });

  const parsed = Patch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });

  // Merge the patch onto the existing row, then re-validate the WHOLE thing per type.
  const merged = {
    symbol: existing.stock.symbol,
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
      await tx.transaction.update({ where: { id }, data: txnData(merged, existing.stock.id, userId) });
      const holding = await replayAndMaterialize(tx, userId, existing.stock.id);
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
  const existing = await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true, stockId: true } });
  if (!existing) return res.status(404).json({ success: false, error: "not_found", message: "Transaction not found" });

  try {
    const out = await prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id } });
      const holding = await replayAndMaterialize(tx, userId, existing.stockId);
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
