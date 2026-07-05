// ═══════════════════════════════════════════════════════════════════════
// ALERTS — the authenticated user's own alert rules + fired-events log (req.authUser).
//
//   POST   /api/v1/me/alerts             { stockId, type, operator, … } → create
//   GET    /api/v1/me/alerts             [?includeEvents=true]          → list the rules
//   PATCH  /api/v1/me/alerts/:id         { active? | target? | … }      → edit
//   DELETE /api/v1/me/alerts/:id                                        → remove
//   GET    /api/v1/me/alerts/events      [?limit=&alertId=]             → the fired log
//
// SECURITY: owner = req.authUser.userId (public.users.id), NEVER the payload — there is
// no userId input, so IDOR is structurally impossible. Mutations are owner-scoped
// (where { id, userId }); a non-owner touches 0 rows → 404. Universe-gated on create
// (stockId must resolve to a stock in the 505). Coherence (type↔operator↔target) is
// validated HERE → 400 before the DB CHECK is ever reached.
//
// This layer only manages the RULES + serves the log. Evaluation (firing) is the daily
// pass (src/alerts/eval-pass.ts); nothing here sends email.
//
// Envelope: { success, data } / { success:false, error, … } — matches the other /me/*.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, LabelBand } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";

const BANDS = Object.values(LabelBand) as [string, ...string[]]; // fragile..pristine

// ── create body: polymorphic target validated per type via superRefine ──
const CreateBody = z
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

// ── PATCH body: edit an existing rule. type is IMMUTABLE (a type change = a new alert).
//    Exactly the target field matching the alert's OWN type is accepted (checked in the
//    handler, where the alert's type is known). ──
const PatchBody = z
  .object({
    active: z.boolean().optional(),
    repeatMode: z.enum(["one_shot", "repeating"]).optional(),
    threshold: z.union([z.number(), z.string().trim().min(1)]).optional(),
    findingKey: z.string().trim().min(1).max(200).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });

const EventsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  alertId: z.string().trim().min(1).optional(),
});

const ALERT_SELECT = {
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

type AlertRow = Prisma.AlertGetPayload<{ select: typeof ALERT_SELECT }>;

function serializeAlert(a: AlertRow) {
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

function serializeEvent(e: {
  id: string;
  alertId: string;
  stockId: string;
  firedAt: Date;
  snapshot: string;
  delivered: boolean;
  stock?: { symbol: string } | null;
}) {
  return {
    id: e.id,
    alertId: e.alertId,
    stockId: e.stockId,
    symbol: e.stock?.symbol ?? null,
    firedAt: e.firedAt.toISOString(),
    snapshot: e.snapshot,
    delivered: e.delivered,
  };
}

// ── POST /alerts — create a rule ────────────────────────────────────────
export const createAlert = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const v = parsed.data;

  try {
    // Universe gate: the stockId must resolve to a real stock (the 505-stock universe).
    const stock = await prisma.stock.findUnique({ where: { id: v.stockId }, select: { id: true } });
    if (!stock) {
      return res.status(400).json({ success: false, error: "stock_not_found", message: "Not a stock in the universe" });
    }

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
    return res.status(201).json({ success: true, data: { alert: serializeAlert(created) } });
  } catch (e) {
    console.error("[POST /me/alerts]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to create alert" });
  }
};

// ── GET /alerts — list the user's rules (+ optional recent events) ───────
export const listAlerts = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const includeEvents = String(req.query.includeEvents ?? "") === "true";

  try {
    const alerts = await prisma.alert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: ALERT_SELECT,
    });

    if (!includeEvents) {
      return res.json({ success: true, data: { alerts: alerts.map(serializeAlert), count: alerts.length } });
    }

    // Optional embed: the 5 most-recent fired events per alert (one bulk query, grouped).
    const alertIds = alerts.map((a) => a.id);
    const events = alertIds.length
      ? await prisma.alertEvent.findMany({
          where: { userId, alertId: { in: alertIds } },
          orderBy: { firedAt: "desc" },
          select: { id: true, alertId: true, stockId: true, firedAt: true, snapshot: true, delivered: true },
        })
      : [];
    const byAlert = new Map<string, ReturnType<typeof serializeEvent>[]>();
    for (const e of events) {
      const arr = byAlert.get(e.alertId) ?? [];
      if (arr.length < 5) arr.push(serializeEvent(e));
      byAlert.set(e.alertId, arr);
    }

    const withEvents = alerts.map((a) => ({ ...serializeAlert(a), recentEvents: byAlert.get(a.id) ?? [] }));
    return res.json({ success: true, data: { alerts: withEvents, count: withEvents.length } });
  } catch (e) {
    console.error("[GET /me/alerts]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to load alerts" });
  }
};

// ── PATCH /alerts/:id — edit (owner-scoped) ─────────────────────────────
export const updateAlert = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const v = parsed.data;

  try {
    // Owner check + fetch the type (target edits are validated against the alert's OWN type).
    const existing = await prisma.alert.findFirst({
      where: { id, userId },
      select: { id: true, type: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your alert" });
    }

    const data: Prisma.AlertUncheckedUpdateInput = {};

    if (v.repeatMode !== undefined) data.repeatMode = v.repeatMode;

    // Re-activating (false→true) re-arms so the rule can fire again on the next crossing.
    if (v.active !== undefined) {
      data.active = v.active;
      if (v.active === true) data.armed = true;
    }

    // Target edit — must match the alert's immutable type; a mismatch is a 400.
    const editingTarget = v.threshold !== undefined || v.findingKey !== undefined;
    if (editingTarget) {
      if (existing.type === "price") {
        if (v.findingKey != null)
          return res.status(400).json({ success: false, error: "validation_error", message: "price alerts have no findingKey" });
        const n = typeof v.threshold === "string" ? Number(v.threshold) : v.threshold;
        if (n == null || !Number.isFinite(n) || n <= 0)
          return res.status(400).json({ success: false, error: "validation_error", message: "price threshold must be a positive number" });
        data.thresholdPrice = new Prisma.Decimal(n);
      } else if (existing.type === "health_band") {
        if (v.findingKey != null)
          return res.status(400).json({ success: false, error: "validation_error", message: "health_band alerts have no findingKey" });
        if (typeof v.threshold !== "string" || !BANDS.includes(v.threshold))
          return res.status(400).json({ success: false, error: "validation_error", message: `health_band threshold must be one of ${BANDS.join(", ")}` });
        data.thresholdBand = v.threshold as LabelBand;
      } else {
        // finding: only findingKey is editable (null clears → "any new finding").
        if (v.threshold !== undefined)
          return res.status(400).json({ success: false, error: "validation_error", message: "finding alerts take findingKey, not threshold" });
        data.findingKey = v.findingKey ?? null;
      }
      // Any target change resets the crossing baseline → re-arm.
      data.armed = true;
    }

    const updated = await prisma.alert.update({ where: { id: existing.id }, data, select: ALERT_SELECT });
    return res.json({ success: true, data: { alert: serializeAlert(updated) } });
  } catch (e) {
    console.error("[PATCH /me/alerts/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to update alert" });
  }
};

// ── DELETE /alerts/:id — remove (owner-scoped) ──────────────────────────
export const deleteAlert = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");

  try {
    // Scoped to the owner: a non-owner (or an unknown id) deletes 0 rows → 404. The
    // alert's events cascade with it (alert_events.alert_id FK ON DELETE CASCADE).
    const result = await prisma.alert.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your alert" });
    }
    return res.json({ success: true, data: { removed: true, id } });
  } catch (e) {
    console.error("[DELETE /me/alerts/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to delete alert" });
  }
};

// ── GET /alerts/events — the user's fired-events log (in-app surface) ────
export const listAlertEvents = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = EventsQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const { limit, alertId } = parsed.data;

  try {
    const events = await prisma.alertEvent.findMany({
      // Owner-scoped: only the user's OWN events. An alertId filter (if given) is ALSO
      // constrained by userId, so it can never read another user's events.
      where: { userId, ...(alertId ? { alertId } : {}) },
      orderBy: { firedAt: "desc" },
      take: limit,
      select: {
        id: true,
        alertId: true,
        stockId: true,
        firedAt: true,
        snapshot: true,
        delivered: true,
        stock: { select: { symbol: true } },
      },
    });
    return res.json({ success: true, data: { events: events.map(serializeEvent), count: events.length } });
  } catch (e) {
    console.error("[GET /me/alerts/events]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to load alert events" });
  }
};
