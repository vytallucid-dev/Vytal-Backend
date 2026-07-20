// ═══════════════════════════════════════════════════════════════════════
// OAUTH STATE STORE — the CSRF perimeter for interactive broker auth. Broker-AGNOSTIC:
// every OAuth broker uses the identical protection, so it lives in the core, not an adapter.
//
// An unguessable 256-bit `state` is issued at initiate, bound to (user, broker), stored
// server-side with a short TTL. At the callback it is verified + ATOMICALLY CONSUMED. This
// blocks: (a) an attacker linking THEIR broker to a victim's account, (b) CSRF on the
// callback, (c) replay of a captured state. The state also carries the disclaimer accepted
// at initiate, so it is the pending-integration record too.
//
// The verify+consume is a SINGLE atomic UPDATE guarded on (state, userId, broker,
// unconsumed, unexpired). That one query enforces, together and race-free: single-use
// (consumed_at was null), the user-binding (userId must match — a state issued for A cannot
// be consumed by B), the broker-binding, and the TTL. count===1 ⇒ ok; anything else ⇒ reject
// WITHOUT revealing which check failed (no oracle).
// ═══════════════════════════════════════════════════════════════════════
import crypto from "crypto";
import { prisma } from "../../db/prisma.js";
import type { BrokerId } from "../types.js";

/** State lifetime — an OAuth login round-trip is quick; keep the window tight. */
export const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Thrown when a returned state is missing / mismatched / expired / already-used. The
 *  lifecycle maps it to a generic 400 — deliberately opaque (don't leak which check failed). */
export class StateVerificationError extends Error {
  constructor(message = "invalid, expired, or already-used auth state") {
    super(message);
    this.name = "StateVerificationError";
  }
}

export interface IssuedState {
  state: string;
  expiresAt: Date;
}

export interface StatePayload {
  disclaimerVersion: string;
  disclaimerAcceptedAt: Date;
}

/** Issue a fresh single-use state bound to (userId, broker), carrying the disclaimer captured
 *  at initiate. Opportunistically prunes this user's expired rows (housekeeping, not
 *  correctness). Returns the unguessable token to embed in the broker's login URL. */
export async function issueState(
  userId: string,
  broker: BrokerId,
  payload: StatePayload,
): Promise<IssuedState> {
  const state = crypto.randomBytes(32).toString("base64url"); // 256 bits of entropy
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS);

  await prisma.brokerAuthState.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  await prisma.brokerAuthState.create({
    data: {
      userId,
      broker,
      state,
      disclaimerVersion: payload.disclaimerVersion,
      disclaimerAcceptedAt: payload.disclaimerAcceptedAt,
      expiresAt,
    },
  });
  return { state, expiresAt };
}

/** Atomically verify + CONSUME a state for (userId, broker). The single guarded UPDATE
 *  enforces single-use + user-binding + broker-binding + TTL together. Throws
 *  StateVerificationError on any failure (no linking happens). Returns the carried disclaimer
 *  so completion can finalize the connection with consent already recorded. */
export async function consumeState(
  userId: string,
  broker: BrokerId,
  state: unknown,
): Promise<StatePayload> {
  if (typeof state !== "string" || state.length === 0) throw new StateVerificationError();
  const now = new Date();

  // Atomic single-use consume: only flips consumed_at if it was null AND the row belongs to
  // THIS user+broker AND is unexpired. A concurrent replay finds count 0 on the second call.
  const res = await prisma.brokerAuthState.updateMany({
    where: { state, userId, broker, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (res.count !== 1) throw new StateVerificationError();

  const rec = await prisma.brokerAuthState.findUniqueOrThrow({ where: { state } });
  return { disclaimerVersion: rec.disclaimerVersion, disclaimerAcceptedAt: rec.disclaimerAcceptedAt };
}
