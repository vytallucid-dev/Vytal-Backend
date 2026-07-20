// ─────────────────────────────────────────────────────────────
// /api/v1/me — broker integration routes (read-only holdings import).
// Mounted behind requireAuth in app.ts alongside the other /me routers. Every handler
// derives the owner from req.authUser (never the payload/param) → IDOR-proof. The
// broker-agnostic lifecycle lives in src/brokers; these are thin HTTP shells over it.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  activateBroker,
  clearBroker,
  completeBrokerAuth,
  deactivateBroker,
  getBrokerStatus,
  initiateBrokerAuth,
  integrateBroker,
  syncBroker,
  refreshBroker,
} from "../controllers/me/brokers-controller.js";
import { rateLimit } from "../brokers/security/rate-limit.js";

export const meBrokerRouter = Router();

// Per-user throttle on the interactive-auth endpoints (brute/replay hammering defense).
// Runs AFTER requireAuth (mounted in app.ts) so the key is the authenticated userId.
const AUTH_LIMIT = 10;
const AUTH_WINDOW_MS = 60_000; // 10 attempts / minute / user

// ── ADDRESSING (Step 2b) ────────────────────────────────────────────────────────────────
// A user may hold TWO demat accounts at the SAME broker (two connections, distinguished by
// the broker's own client code). So:
//   • CREATE paths are BROKER-addressed (:broker) — no connection exists yet to point at.
//   • Every op on an EXISTING connection is CONNECTION-ID-addressed (/connections/:connectionId).
// Addressing an existing connection by broker alone would be ambiguous and could act on the
// WRONG demat; by-id makes that structurally impossible.
// GET /brokers returns each connection's `id` — that is how a client discovers what to address.

// Status: the user's connections (with id + brokerAccountRef + linkedAccountId) + pickable brokers.
meBrokerRouter.get("/brokers", getBrokerStatus);

// ── CREATE: broker-addressed (no connection yet) ──
// Interactive (OAuth) auth — two steps, both rate-limited.
meBrokerRouter.post("/brokers/:broker/auth/initiate", rateLimit("broker_auth_initiate", AUTH_LIMIT, AUTH_WINDOW_MS), initiateBrokerAuth); // → login URL
meBrokerRouter.post("/brokers/:broker/auth/complete", rateLimit("broker_auth_complete", AUTH_LIMIT, AUTH_WINDOW_MS), completeBrokerAuth); // callback → active
meBrokerRouter.post("/brokers/:broker/integrate", integrateBroker); // one-shot (non-interactive brokers, e.g. mock)

// ── OPERATE: connection-id-addressed (an existing, owned connection) ──
meBrokerRouter.post("/brokers/connections/:connectionId/activate", activateBroker); //   inactive → active
meBrokerRouter.post("/brokers/connections/:connectionId/deactivate", deactivateBroker); // active → inactive
meBrokerRouter.post("/brokers/connections/:connectionId/sync", syncBroker); //           active → active (overwrite snapshot; 409 until linked)
// REFRESH (Step 7) — the OFFLINE path: re-runs the PHS snapshot against today's prices WITHOUT
// contacting the broker, so it works while the session is dead. Touches the mirror not at all.
meBrokerRouter.post("/brokers/connections/:connectionId/refresh", refreshBroker);
meBrokerRouter.post("/brokers/connections/:connectionId/clear", clearBroker); //         inactive → gone (confirm-gated)
