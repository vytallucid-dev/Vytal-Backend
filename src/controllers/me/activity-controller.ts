// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BEHAVIOUR TRACKING — the ingest + clear surface (Phase 1).
//
//   POST   /api/v1/me/activity   an ARRAY of attention events → bulk-insert + one rollup fold per stock
//   DELETE /api/v1/me/activity   clear ALL of this user's activity (both event tables + the rollup)
//
// SECURITY: owner = req.authUser.userId (never the payload). Auth is the whole spoofing boundary — a
// user can only forge THEIR OWN activity, which is self-inflicted noise with zero cross-user or scoring
// impact, so there are no signed events or nonces. The ingest is a BEACON: it returns fast and its body
// is irrelevant to the client. Sanity clamps below reject a malformed/oversized/abusive batch.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { ATTENTION_EVENT_TYPES, foldAttentionBatch, type AttentionEventInput } from "../../tracking/tracking.js";

// ── Clamps ──────────────────────────────────────────────────────────────────────────────────────────
const MAX_BATCH = 100; // one flush carries at most this many events
const MAX_DWELL_MS = 3_600_000; // 1h — anything larger is a bug or a spoof, not a real dwell
const MAX_DETAIL_LEN = 64; // a tab/section key, never prose
const RATE_CAP_PER_MIN = 600; // coarse per-user backstop against a runaway/abusive client

const EventSchema = z.object({
  stockId: z.string().trim().min(1),
  eventType: z.enum(ATTENTION_EVENT_TYPES),
  detail: z.string().trim().min(1).max(MAX_DETAIL_LEN).optional(),
  dwellMs: z.number().int().min(0).max(MAX_DWELL_MS).optional(),
});
// Accepts a bare array, or `{ events: [...] }` (either is a valid beacon body).
const BatchSchema = z.union([
  z.array(EventSchema),
  z.object({ events: z.array(EventSchema) }).transform((o) => o.events),
]);

export const postActivity = async (req: Request, res: Response): Promise<Response> => {
  const userId = req.authUser!.userId;

  const parsed = BatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const events: AttentionEventInput[] = parsed.data;

  if (events.length === 0) return res.json({ success: true, data: { accepted: 0 } }); // empty beacon → no-op
  if (events.length > MAX_BATCH) {
    return res.status(400).json({ success: false, error: "batch_too_large", message: `Max ${MAX_BATCH} events per batch` });
  }

  try {
    // ── Universe clamp — every stockId must resolve to a real stock. A batch naming an unknown stock
    //    is rejected whole (a well-behaved client never sends one; a bad one is a bug or a spoof). ──
    const stockIds = [...new Set(events.map((e) => e.stockId))];
    const known = await prisma.stock.findMany({ where: { id: { in: stockIds } }, select: { id: true } });
    if (known.length !== stockIds.length) {
      const knownSet = new Set(known.map((s) => s.id));
      const unknown = stockIds.filter((id) => !knownSet.has(id));
      return res.status(400).json({ success: false, error: "unknown_stock", message: `Not in the universe: ${unknown.slice(0, 5).join(", ")}` });
    }

    // ── Coarse per-user rate cap — bounds a runaway/abusive client without any per-request state. ──
    const recent = await prisma.attentionEvent.count({
      where: { userId, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent + events.length > RATE_CAP_PER_MIN) {
      return res.status(429).json({ success: false, error: "rate_limited", message: "Too many activity events; slow down." });
    }

    const { inserted, stocksFolded } = await foldAttentionBatch(userId, events);
    return res.json({ success: true, data: { accepted: inserted, stocksFolded } });
  } catch (e) {
    // A beacon must never surface a hard error to the client. Log and return a benign 200 — losing a
    // batch is acceptable (this is statistical context, not an audit log).
    console.error("[POST /me/activity]", e);
    return res.json({ success: true, data: { accepted: 0 } });
  }
};

export const clearMyActivity = async (req: Request, res: Response): Promise<Response> => {
  const userId = req.authUser!.userId;
  try {
    // ★ STAGE 5 — THE CHAT READER PROFILE IS CLEARED TOO, AND IT HAS TO BE.
    //
    // From the reader's side, "what Vytal has noticed about how you use the app" IS the distilled chat
    // profile. A control that resets the browse counters but leaves the assistant still treating them as a
    // beginner would make this control a lie about its own scope.
    //
    // ⚠ AND IT IS NOT ENOUGH TO DELETE THE ROW. The transcripts survive (they are the reader's own
    // record, listed and individually deletable on the chat page), so the next nightly distillation would
    // rebuild the profile from them within days and the reader would find it back. So we delete the row
    // AND recreate it carrying `profileClearedAt = now`, which the distiller treats as a floor: sessions
    // that went quiet before this instant are invisible to it forever. A clear means a clear.
    //
    // Chat SESSIONS are deliberately NOT touched — clearing what the assistant has picked up and deleting
    // your conversation history are different asks, and the chat page already offers the second one.
    const clearedAt = new Date();
    // Ops run in array order, so the delete precedes the recreate — required, since userId is unique.
    // A reader who had no profile yet still gets the floor stamped, which bounds all future distillation.
    const [attention, relationship, rollup, profileDeleted] = await prisma.$transaction([
      prisma.attentionEvent.deleteMany({ where: { userId } }),
      prisma.relationshipEvent.deleteMany({ where: { userId } }),
      prisma.behaviorRollup.deleteMany({ where: { userId } }),
      prisma.chatReaderProfile.deleteMany({ where: { userId } }),
      prisma.chatReaderProfile.create({ data: { userId, profileClearedAt: clearedAt } }),
    ]);
    return res.json({
      success: true,
      data: {
        attentionDeleted: attention.count,
        relationshipDeleted: relationship.count,
        rollupDeleted: rollup.count,
        chatProfileCleared: profileDeleted.count > 0,
        clearedAt: clearedAt.toISOString(),
      },
    });
  } catch (e) {
    console.error("[DELETE /me/activity]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to clear activity" });
  }
};
