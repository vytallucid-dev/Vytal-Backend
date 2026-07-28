// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNAVAILABLE VOICE — the ONE place the "we can't answer right now" line is written.
//
// Two callers, and they must never drift:
//   · the controller, answering a send the spend gate just refused (unavailablePayload)
//   · the serializer, re-rendering a denial the reader is looking at again days later (denialFor)
//
// ★ COMPOSED AT READ TIME, NEVER STORED. What is persisted is the SCOPE and the RESET INSTANT; the
//   sentence is built from them on the way out. That is what lets the same stored denial say
//   "It resets tomorrow." this afternoon and "Vytal's assistant was at its daily limit when you sent
//   this." next week — a stored sentence would still be promising a reset that happened days ago.
//
// ★ AND IT IS NEVER AN ASSISTANT MESSAGE. This text is about the assistant, not from it. It rides on the
//   reader's own denied row (chat_messages.denied_*), so loadHistoryForModel — which reads message rows —
//   can never replay "Vytal's assistant is at its daily limit" into the model as something it once said.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export type DeniedScope = "user" | "global" | null;

/** The reader-facing state of a denial, live or remembered. Mirrored by the frontend's ChatUnavailable. */
export interface UnavailableState {
  reason: string;
  scopeDenied: DeniedScope;
  message: string;
  /** The denying ceiling's reset instant, ISO — or null when it has already passed (or was never known),
   *  in which case `message` is already in the past tense and carries no timing claim. */
  resetAt: string | null;
}

/** The line itself. `upcoming` false ⇒ the window has already rolled over and we are describing history. */
function line(scopeDenied: DeniedScope, upcoming: boolean): string {
  if (upcoming) {
    return scopeDenied === "user"
      ? "You've reached your daily limit for Vytal's assistant. It resets tomorrow."
      : "Vytal's assistant is at its daily limit right now. Please try again later.";
  }
  return scopeDenied === "user"
    ? "You'd reached your daily limit for Vytal's assistant when you sent this, so it never went through."
    : "Vytal's assistant was at its daily limit when you sent this, so it never went through.";
}

/** The live denial — the spend gate just refused this send. */
export function unavailableState(
  reason: string | undefined,
  scopeDenied: DeniedScope | undefined,
  resetAt: string | undefined,
): UnavailableState {
  const scope = scopeDenied ?? null;
  const at = resetAt ? new Date(resetAt) : null;
  const upcoming = at != null && !Number.isNaN(at.getTime()) && at.getTime() > Date.now();
  return {
    reason: reason ?? "unavailable",
    scopeDenied: scope,
    message: line(scope, upcoming),
    resetAt: upcoming ? at!.toISOString() : null,
  };
}

/**
 * ── THE COMPOSER'S QUOTA STATE ──────────────────────────────────────────────────────────────────────
 * What the client needs to know BEFORE it lets anyone type: can a send be made at all, which ceiling is
 * binding, and when it clears. Read from `ai_usage_counters` (peekAiCallQuota — read-only, never
 * consuming), so the composer lock is SERVER state that survives a refresh rather than a memory of a
 * failed request. `unavailable` is the same shape a denied send returns, so the client applies both
 * through one path and cannot render them differently.
 */
export interface ChatQuotaState {
  canSend: boolean;
  /** Which ceiling is binding — "user" (their own allowance) or "global" (everyone's). Null when able. */
  scopeDenied: DeniedScope;
  /** When the binding ceiling clears, ISO. Null when able to send (nothing to wait for). */
  resetAt: string | null;
  /** The reader-facing state, present iff !canSend. */
  unavailable: UnavailableState | null;
}

/** Shape the gate's decision (from the READ-ONLY peek) into what the composer needs. */
export function quotaStateFrom(d: {
  allowed: boolean;
  scopeDenied: DeniedScope;
  resetAt: Date;
  reason?: string;
}): ChatQuotaState {
  if (d.allowed) return { canSend: true, scopeDenied: null, resetAt: null, unavailable: null };
  const state = unavailableState(d.reason, d.scopeDenied, d.resetAt.toISOString());
  return { canSend: false, scopeDenied: d.scopeDenied, resetAt: state.resetAt, unavailable: state };
}

/** A REMEMBERED denial — the stored columns of an undelivered message, rendered against the clock NOW. */
export function denialFor(row: {
  deniedReason: string | null;
  deniedScope: string | null;
  deniedResetAt: Date | null;
}): UnavailableState {
  return unavailableState(
    row.deniedReason ?? undefined,
    (row.deniedScope as DeniedScope) ?? null,
    row.deniedResetAt?.toISOString(),
  );
}
