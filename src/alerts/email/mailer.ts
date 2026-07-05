// ═══════════════════════════════════════════════════════════════════════
// MAILER — the send seam.
//
// The drain (deliver.ts) sends through an AlertMailer, never through the Resend SDK
// directly. That indirection is the whole test story: production wires createResendMailer()
// (the real SDK), the verify harness injects a mock that records/fails on demand — so no
// test ever hits the network or needs a live API key.
//
// The Resend implementation is LAZY: it reads RESEND_API_KEY / RESEND_FROM only when
// actually constructed. A drain that runs with an injected mailer therefore needs neither
// env var set.
//
// Idempotency: send() forwards an optional idempotencyKey to Resend's Idempotency-Key
// header. The drain passes the alert_event id, so even a crash between a successful send
// and the delivered=true flip can't double-send within Resend's dedup window (~24h — which
// comfortably covers the daily drain's retry cadence).
// ═══════════════════════════════════════════════════════════════════════
import { Resend } from "resend";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  /** Forwarded as Resend's Idempotency-Key. Same key ⇒ provider-side dedup. */
  idempotencyKey?: string;
}

export interface AlertMailer {
  /** Send one email. MUST reject (throw) on any failure so the drain can leave the event
   *  undelivered for the next run. Resolves with the provider message id on success. */
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/**
 * The production mailer, backed by the Resend Node SDK. Reads its config from the
 * environment at construction time. The sending domain (RESEND_FROM) is a verified Vytal
 * address — the DNS/SPF/DKIM setup is done separately by the operator; this code only uses
 * the from-address.
 */
export function createResendMailer(): AlertMailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set — cannot send alert emails");
  if (!from) throw new Error("RESEND_FROM is not set — cannot send alert emails");

  const resend = new Resend(apiKey);

  return {
    async send({ to, subject, html, idempotencyKey }) {
      // Resend returns { data, error } rather than throwing on API-level failures; we
      // normalise BOTH the returned error and any thrown network error into a throw, so the
      // drain's single try/catch is the one failure path.
      const { data, error } = await resend.emails.send(
        { from, to, subject, html },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
      if (error) {
        throw new Error(`Resend send failed: ${error.name ?? "error"} — ${error.message ?? ""}`);
      }
      if (!data?.id) throw new Error("Resend returned no message id");
      return { id: data.id };
    },
  };
}
