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
// ★ CREATE + DELETE LIVE IN src/alerts/service.ts (Stage 3, Phase A) — together with the
// type↔operator↔target coherence rules and the shared ALERT_SELECT/serializeAlert shape.
// This file is TRANSPORT for them (and still owns list/patch/events, which are read-side or
// not yet needed by a tool). The chat write tools call the same service functions, so the
// coherence rules have exactly one home.
//
// Envelope: { success, data } / { success:false, error, … } — matches the other /me/*.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, LabelBand } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import {
  BANDS,
  ALERT_SELECT,
  serializeAlert,
  createAlert as createAlertSvc,
  deleteAlert as deleteAlertSvc,
} from "../../alerts/service.js";
import { ServiceError, sendServiceError } from "../../lib/service-error.js";

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
  try {
    const data = await createAlertSvc(req.body, userId);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    if (e instanceof ServiceError) return sendServiceError(res, e);
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
  try {
    const data = await deleteAlertSvc({ id: String(req.params.id ?? "") }, userId);
    return res.json({ success: true, data });
  } catch (e) {
    if (e instanceof ServiceError) return sendServiceError(res, e);
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
