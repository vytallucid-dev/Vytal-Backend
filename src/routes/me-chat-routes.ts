// ─────────────────────────────────────────────────────────────
// /api/v1/me — chat routes (the conversation engine: discuss sidebar + chat page).
// Mounted behind requireAuth in app.ts as the EIGHTH meRouter on the same base path — the seven
// existing routers are untouched. Every handler derives the owner from req.authUser (never the
// payload). Generation, grounding, guardrail and metering live in src/chat + src/ai; this layer
// is just the HTTP surface.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  openOrResumeSession,
  sendMessage,
  editMessage,
  listSessions,
  getSession,
  renameSession,
  deleteSession,
  getQuota,
} from "../controllers/me/chat-controller.js";

export const meChatRouter = Router();

// The composer's quota lock, addressable on its own — the conversation fetches carry the same state, so
// this is what a long-open composer re-checks when the resetAt it was locked with finally passes.
// BEFORE /chat/sessions/:id in the file, but on a distinct path, so there is no ordering hazard.
meChatRouter.get("/chat/quota", getQuota);

// Open or resume (DiscussContext for the sidebar, empty body for the chat page) + the chat-page list.
meChatRouter.post("/chat/sessions", openOrResumeSession);
meChatRouter.get("/chat/sessions", listSessions);

// A single session (with messages), send a message, rename, delete. Owner-scoped (where { id, userId })
// — a non-owner or unknown id touches nothing → 404. Deleting cascades the session's messages.
meChatRouter.get("/chat/sessions/:id", getSession);
meChatRouter.post("/chat/sessions/:id/messages", sendMessage);
// Rewrite one of the reader's own messages: the turns after it are DELETED and a fresh reply generated.
// 409 write_effects_unacknowledged when a confirmed write sits in that tail and the client has not shown
// the reader that deleting it will not undo it (see the handler).
meChatRouter.patch("/chat/sessions/:id/messages/:messageId", editMessage);
meChatRouter.patch("/chat/sessions/:id", renameSession);
meChatRouter.delete("/chat/sessions/:id", deleteSession);
