// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERVICE ERROR — the ONE failure currency a write service speaks, so a write has exactly one home
// for its rules no matter who calls it (an HTTP controller, a chat tool, a job).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
// Before Stage 3 every write lived inside its controller and expressed failure by RETURNING an HTTP
// response. That is unreachable from anywhere that isn't Express — a chat tool would have had to
// either re-implement the validation (two homes, guaranteed to drift) or make an HTTP round-trip back
// into its own process carrying a forged token. So the rules move down into a service, and the service
// throws THIS instead of writing a response.
//
// ── IT CARRIES THE BODY, NOT A RECIPE FOR THE BODY ─────────────────────────────────────────────────
// `body` is the EXACT set of extra JSON fields the endpoint has always returned beside
// `{ success:false, error:<code> }` — nothing is reconstructed or normalised. That matters because the
// four extracted endpoints genuinely disagree with each other on shape and always have:
//   · watchlist/transactions validation → { details: <zod fieldErrors> }   (fieldErrors only)
//   · alerts/reminders validation       → { details: <zod flatten> }       (the whole flatten)
//   · not-found / gate failures         → { message: "…" }
//   · oversell                          → { message, attempted, available }
//   · ambiguous instrument              → { message, candidates: […] }
// A "tidier" uniform envelope here would be a silent API change for the frontend, which is exactly what
// the extraction promised not to do. So the shape is carried verbatim and `sendServiceError` spreads it.
//
// `message` on the Error itself is ALWAYS a human sentence (even where the HTTP body carries none) —
// that is what the chat tool layer hands back to the model, which cannot read a zod fieldErrors map.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Response } from "express";
import type { ZodError } from "zod";

export class ServiceError extends Error {
  constructor(
    /** The status the HTTP caller returns. A non-HTTP caller may ignore it. */
    public readonly httpStatus: number,
    /** The stable machine code (`validation_error`, `stock_not_found`, `oversell`, …). */
    public readonly code: string,
    /** A human sentence. ALWAYS present — the model-facing callers render this. */
    message: string,
    /** The extra body fields this endpoint has always returned. Spread verbatim; never normalised. */
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** The HTTP half. `{ success:false, error:<code> }` plus whatever body fields the endpoint carries. */
export function sendServiceError(res: Response, e: ServiceError): Response {
  return res.status(e.httpStatus).json({ success: false, error: e.code, ...e.body });
}

/** A failure whose body is `{ message }` — the shape every gate/not-found in /me/* already uses. */
export const failure = (httpStatus: number, code: string, message: string): ServiceError =>
  new ServiceError(httpStatus, code, message, { message });

/**
 * A zod rejection. `details` is passed in RAW by the caller — `err.flatten()` or
 * `err.flatten().fieldErrors` — because the two families of endpoints differ and both are load-bearing.
 * The human `message` is derived from the issues so a non-HTTP caller has something to say out loud.
 */
export function validationError(err: ZodError, details: unknown): ServiceError {
  return new ServiceError(400, "validation_error", zodMessage(err), { details });
}

/** `path: message; path: message` — a readable one-liner for the callers that speak prose, not JSON. */
export function zodMessage(err: ZodError): string {
  const parts = err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(body)"}: ${i.message}`);
  return parts.length ? parts.join("; ") : "validation failed";
}
