// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ALERTS WRITE SERVICE — create / delete, extracted from alerts-controller.ts UNCHANGED.
//
// THE SEAM: `service(input, userId)`. ★ userId is a PARAMETER, never part of `input` — the caller
// supplies it from an authenticated source (req.authUser.userId / ToolContext.userId), so no client
// payload and no model argument can name another user. IDOR stays structurally impossible.
//
// ── THE COHERENCE RULES ARE THE REASON THIS EXTRACTION MATTERS ─────────────────────────────────────
// An alert's target is polymorphic and the three columns are mutually exclusive at the DB level
// (a CHECK constraint). Which one is legal depends on `type`, and `operator` is constrained by `type`
// too:
//     price        → operator above|below · a POSITIVE number threshold  · no findingKey
//     health_band  → operator above|below · a LabelBand threshold        · no findingKey
//     finding      → operator fires       · no threshold                 · findingKey or null (= "any")
// Those are enforced HERE, in one superRefine, so a caller gets a 400 with a readable path instead of
// a Postgres CHECK violation surfacing as a 500. A second copy of these rules inside a chat tool would
// be a guarantee of drift — which is exactly why the tool calls this function instead.
//
// This module manages RULES only. Evaluation (firing) is the daily pass (src/alerts/eval-pass.ts);
// nothing here sends email.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { z } from "zod";
import { Prisma, LabelBand } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { emitRelationshipEvent } from "../tracking/tracking.js";
import { failure, validationError } from "../lib/service-error.js";

/** fragile..pristine — the real band order (see the alerts build). */
export const BANDS = Object.values(LabelBand) as [string, ...string[]];

// ── create input: polymorphic target validated per type via superRefine (moved verbatim) ────────────
export const CreateAlertInput = z
  .object({
    stockId: z.string().trim().min(1),
    type: z.enum(["price", "health_band", "finding"]),
    operator: z.enum(["above", "below", "fires"]),
    // price: a positive number. health_band: a LabelBand string. (finding uses findingKey.)
    threshold: z.union([z.number(), z.string().trim().min(1)]).optional(),
    // finding: a specific finding key, or null/omitted ⇒ "any new finding".
    findingKey: z.string().trim().min(1).max(200).nullish(),
    repeatMode: z.enum(["one_shot", "repeating"]).default("one_shot"),
  })
  .superRefine((v, ctx) => {
    if (v.type === "finding") {
      if (v.operator !== "fires")
        ctx.addIssue({ code: "custom", path: ["operator"], message: "finding alerts use operator 'fires'" });
      if (v.threshold !== undefined)
        ctx.addIssue({ code: "custom", path: ["threshold"], message: "finding alerts take findingKey, not threshold" });
      return;
    }
    // price | health_band
    if (v.operator !== "above" && v.operator !== "below")
      ctx.addIssue({ code: "custom", path: ["operator"], message: `${v.type} alerts use operator 'above' or 'below'` });
    if (v.findingKey != null)
      ctx.addIssue({ code: "custom", path: ["findingKey"], message: `${v.type} alerts do not take findingKey` });
    if (v.type === "price") {
      const n = typeof v.threshold === "string" ? Number(v.threshold) : v.threshold;
      if (n == null || !Number.isFinite(n) || n <= 0)
        ctx.addIssue({ code: "custom", path: ["threshold"], message: "price threshold must be a positive number" });
    } else {
      // health_band
      if (typeof v.threshold !== "string" || !BANDS.includes(v.threshold))
        ctx.addIssue({ code: "custom", path: ["threshold"], message: `health_band threshold must be one of ${BANDS.join(", ")}` });
    }
  });

const DeleteAlertInput = z.object({ id: z.string() });

// ── the shared alert shape (create writes it; list/patch in the controller read it) ─────────────────
export const ALERT_SELECT = {
  id: true,
  stockId: true,
  type: true,
  operator: true,
  thresholdPrice: true,
  thresholdBand: true,
  findingKey: true,
  repeatMode: true,
  active: true,
  armed: true,
  lastTriggeredAt: true,
  createdAt: true,
  updatedAt: true,
  stock: { select: { symbol: true, name: true } },
} satisfies Prisma.AlertSelect;

export type AlertRow = Prisma.AlertGetPayload<{ select: typeof ALERT_SELECT }>;

export function serializeAlert(a: AlertRow) {
  return {
    id: a.id,
    stockId: a.stockId,
    symbol: a.stock?.symbol ?? null,
    name: a.stock?.name ?? null,
    type: a.type,
    operator: a.operator,
    // exactly one of these is non-null (guaranteed by the DB CHECK)
    thresholdPrice: a.thresholdPrice != null ? Number(a.thresholdPrice) : null,
    thresholdBand: a.thresholdBand ?? null,
    findingKey: a.findingKey ?? null,
    repeatMode: a.repeatMode,
    active: a.active,
    armed: a.armed,
    lastTriggeredAt: a.lastTriggeredAt ? a.lastTriggeredAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ── CREATE ──────────────────────────────────────────────────────────────────────────────────────────
export async function createAlert(input: unknown, userId: string): Promise<{ alert: ReturnType<typeof serializeAlert> }> {
  const parsed = CreateAlertInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, parsed.error.flatten());
  const v = parsed.data;

  // Universe gate: the stockId must resolve to a real stock (the 505-stock universe).
  const stock = await prisma.stock.findUnique({ where: { id: v.stockId }, select: { id: true } });
  if (!stock) throw failure(400, "stock_not_found", "Not a stock in the universe");

  // Map the validated payload → the typed target columns (exactly one populated).
  const data: Prisma.AlertUncheckedCreateInput = {
    userId,
    stockId: v.stockId,
    type: v.type,
    operator: v.operator,
    repeatMode: v.repeatMode,
    thresholdPrice: null,
    thresholdBand: null,
    findingKey: null,
  };
  if (v.type === "price") {
    data.thresholdPrice = new Prisma.Decimal(typeof v.threshold === "string" ? Number(v.threshold) : v.threshold!);
  } else if (v.type === "health_band") {
    data.thresholdBand = v.threshold as LabelBand;
  } else {
    data.findingKey = v.findingKey ?? null; // null ⇒ "any new finding"
  }

  const created = await prisma.alert.create({ data, select: ALERT_SELECT });
  // Behaviour tracking: an alert set on this stock. Best-effort after commit.
  await emitRelationshipEvent(userId, v.stockId, "alert_set");
  return { alert: serializeAlert(created) };
}

// ── DELETE ──────────────────────────────────────────────────────────────────────────────────────────
export async function deleteAlert(input: unknown, userId: string): Promise<{ removed: true; id: string }> {
  const parsed = DeleteAlertInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, parsed.error.flatten());
  const { id } = parsed.data;

  // Resolve the owned alert's stock BEFORE deleting (owner-scoped) — behaviour tracking needs the
  // stockId, and a non-owner/unknown id resolves to nothing (→ the deleteMany below 404s).
  const owned = await prisma.alert.findFirst({ where: { id, userId }, select: { stockId: true } });
  // Scoped to the owner: a non-owner (or an unknown id) deletes 0 rows → not_found. The
  // alert's events cascade with it (alert_events.alert_id FK ON DELETE CASCADE).
  const result = await prisma.alert.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw failure(404, "not_found", "Not your alert");

  // Behaviour tracking: an alert removed from this stock. Best-effort after commit.
  if (owned) await emitRelationshipEvent(userId, owned.stockId, "alert_removed");
  return { removed: true, id };
}
