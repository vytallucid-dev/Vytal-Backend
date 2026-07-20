// ═══════════════════════════════════════════════════════════════════════
// BROKER CONNECTIONS — the authenticated user's own broker integrations (req.authUser).
//
//   GET  /api/v1/me/brokers                     status: this user's connections + pickable brokers
//   POST /api/v1/me/brokers/:broker/integrate   connect (accept+version disclaimer → active)
//   POST /api/v1/me/brokers/:broker/activate    resume a deactivated connection
//   POST /api/v1/me/brokers/:broker/deactivate  stop syncing (retains data)
//   POST /api/v1/me/brokers/:broker/sync        pull holdings now → overwrite the snapshot
//   POST /api/v1/me/brokers/:broker/clear       wipe (only when inactive; { confirm:true })
//
// SECURITY: owner = req.authUser.userId, NEVER the payload/param — there is no userId input,
// so a user can only ever touch their OWN connections (IDOR structurally impossible). The
// :broker path param selects WHICH broker, not whose.
//
// FAIL-CLOSED: a missing/broken BROKER_TOKEN_ENC_KEY surfaces as 503 feature_unavailable —
// the broker feature degrades; the platform keeps running. Everything else maps from the
// service's typed BrokerLifecycleError (code + httpStatus). Envelope matches the rest of /me.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import {
  activate,
  beginIntegration,
  clearData,
  completeIntegration,
  deactivate,
  integrate,
  status,
  syncHoldings,
  refreshHoldings,
  BrokerLifecycleError,
} from "../../brokers/lifecycle.js";
import { BrokerEncryptionUnavailableError } from "../../brokers/crypto.js";
import { BrokerConfigError } from "../../brokers/types.js";

/** Run a handler, mapping the broker error taxonomy to responses. Keeps every endpoint
 *  to its happy path; the taxonomy lives in one place. */
async function handle(res: Response, fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    return res.json({ success: true, data });
  } catch (e) {
    // Fail-closed: a missing encryption key OR an unconfigured broker degrades the feature to
    // 503 — it never 500s and never crashes the platform. No key/secret details leaked.
    if (e instanceof BrokerEncryptionUnavailableError || e instanceof BrokerConfigError) {
      return res.status(503).json({
        success: false,
        error: "feature_unavailable",
        message: "Broker integration is temporarily unavailable.",
      });
    }
    if (e instanceof BrokerLifecycleError) {
      return res.status(e.httpStatus).json({ success: false, error: e.code, message: e.message });
    }
    console.error("[/me/brokers]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Broker operation failed" });
  }
}

/** Broker-addressed — ONLY the CREATE paths (integrate / auth), where no connection exists yet. */
const broker = (req: Request) => String(req.params.broker);

/** Connection-id addressed — every op on an EXISTING connection. Addressing by the connection's
 *  own id is what makes multi-demat unambiguous (a user may hold two accounts at one broker).
 *  Ownership is enforced in the lifecycle (scoped to the token's userId) → 404, never the payload. */
const connectionId = (req: Request) => String(req.params.connectionId);

// ── GET /brokers ──────────────────────────────────────────────────────────
export const getBrokerStatus = (req: Request, res: Response) =>
  handle(res, () => status(req.authUser!.userId));

// ── POST /brokers/:broker/integrate ─────────────────────────────────────────
const IntegrateBody = z.object({
  disclaimerVersion: z.string().trim().min(1),
  accepted: z.boolean(),
  params: z.record(z.string(), z.unknown()).optional(), // opaque broker auth hand-off
});
export const integrateBroker = async (req: Request, res: Response) => {
  const parsed = IntegrateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  }
  return handle(res, () => integrate(req.authUser!.userId, broker(req), parsed.data));
};

// ── POST /brokers/:broker/auth/initiate ─────────────────────────────────────
// Interactive (OAuth) step 1: accept+version the disclaimer, issue a CSRF state, return the
// broker login URL. Rate-limited per user (route middleware). Response carries NO secret.
const InitiateBody = z.object({
  disclaimerVersion: z.string().trim().min(1),
  accepted: z.boolean(),
});
export const initiateBrokerAuth = async (req: Request, res: Response) => {
  const parsed = InitiateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  }
  return handle(res, () => beginIntegration(req.authUser!.userId, broker(req), parsed.data));
};

// ── POST /brokers/:broker/auth/complete ─────────────────────────────────────
// Interactive step 2: verify+consume the state (CSRF/replay/user-binding), exchange the
// callback params server-side, store the encrypted session. `params` is opaque (the adapter
// alone knows its shape) — the core never inspects it. Rate-limited per user.
const CompleteBody = z.object({
  state: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  /** RECONNECT: the connection the client believes it is re-authenticating. Present ⇒ the lifecycle
   *  refuses (409 wrong_demat) rather than minting an orphan connection when the user signs into a
   *  DIFFERENT demat. Owner-scoped server-side — naming a connection is not the same as reaching it.
   *  Absent ⇒ first-time link, unchanged. See CompleteIntegrationInput.expectedConnectionId. */
  expectedConnectionId: z.string().uuid().optional(),
});
export const completeBrokerAuth = async (req: Request, res: Response) => {
  const parsed = CompleteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  }
  return handle(res, () => completeIntegration(req.authUser!.userId, broker(req), parsed.data));
};

// ── POST /brokers/connections/:connectionId/activate ────────────────────────
export const activateBroker = (req: Request, res: Response) =>
  handle(res, () => activate(req.authUser!.userId, connectionId(req)));

// ── POST /brokers/connections/:connectionId/deactivate ──────────────────────
export const deactivateBroker = (req: Request, res: Response) =>
  handle(res, () => deactivate(req.authUser!.userId, connectionId(req)));

// ── POST /brokers/connections/:connectionId/sync ────────────────────────────
// "SYNC NOW" — go to the broker. Needs a LIVE session: a dead token returns 409 session_dead
// ("reconnect to refresh"), which is routine (§2.5) and leaves the account linked_live, its
// holdings intact. Refuses (409 account_not_linked) until the connection is bound to an account —
// its holdings belong to that account, and we never silent-pick one.
export const syncBroker = (req: Request, res: Response) =>
  handle(res, () => syncHoldings(req.authUser!.userId, connectionId(req)));

// ── POST /brokers/connections/:connectionId/refresh ─────────────────────────
// "REFRESH" — the OFFLINE path. It does NOT contact the broker, so unlike sync it works while the
// session is DEAD (which, for Kite, is every morning until the user reconnects).
//
// It re-values nothing in the mirror: quantity, avg_cost and current_value are the BROKER's
// figures and only the broker changes them (§2.2). The read path already prices broker holdings
// with OUR live price, so the holdings a user sees were never stale to begin with. The one thing
// that IS stored — and so goes stale as prices move — is the PHS snapshot. That is what this
// recomputes, and all it recomputes.
export const refreshBroker = (req: Request, res: Response) =>
  handle(res, () => refreshHoldings(req.authUser!.userId, connectionId(req)));

// ── POST /brokers/connections/:connectionId/clear ───────────────────────────
const ClearBody = z.object({ confirm: z.boolean().optional() });
export const clearBroker = async (req: Request, res: Response) => {
  const parsed = ClearBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  }
  return handle(res, () => clearData(req.authUser!.userId, connectionId(req), parsed.data));
};
