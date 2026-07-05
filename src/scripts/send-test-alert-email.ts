// ─────────────────────────────────────────────────────────────────────────────
// SEND A REAL TEST ALERT EMAIL via Resend — proves the LIVE integration end-to-end
// (API key + verified from-address + template) using the exact production code path
// (createResendMailer + renderAlertEmail), just without the DB drain.
//
//   npx tsx src/scripts/send-test-alert-email.ts [recipient]
//
// Prints whether config is present (API key as a boolean only — never the value), the
// from-address, and the Resend message id (or the error) on completion.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { createResendMailer } from "../alerts/email/mailer.js";
import { renderAlertEmail, type AlertEmailProps } from "../alerts/email/alert-email.js";

async function main() {
  const to = process.argv[2] ?? "arman.shaikh01082003@gmail.com";

  const hasKey = !!process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  console.log(`RESEND_API_KEY set : ${hasKey}`);
  console.log(`RESEND_FROM        : ${from ?? "(unset)"}`);
  console.log(
    `APP_BASE_URL       : ${process.env.APP_BASE_URL ?? "(unset → fallback https://app.vytal.in)"}`,
  );
  console.log(`Recipient          : ${to}\n`);

  if (!hasKey || !from) {
    console.error("✗ Cannot send — RESEND_API_KEY and/or RESEND_FROM is not set in .env.");
    process.exitCode = 1;
    return;
  }

  const base = (process.env.APP_BASE_URL ?? "https://app.vytal.in").replace(/\/+$/, "");
  const common = (symbol: string, name: string) => ({
    stockSymbol: symbol,
    stockName: name,
    firedAt: new Date(),
    stockUrl: `${base}/stocks/${symbol}`,
    manageUrl: `${base}/alerts`,
  });

  // One representative email per alert type, so the full redesign (price mono numbers,
  // the coloured health-band pill, findings) is visible in the inbox.
  const samples: AlertEmailProps[] = [
    { ...common("TCS", "Tata Consultancy Services Limited"), type: "price", operator: "below", snapshot: "3480.00", thresholdPrice: "3500", thresholdBand: null, findingKey: null },
    { ...common("HDFCBANK", "HDFC Bank Ltd"), type: "health_band", operator: "below", snapshot: "below_par", thresholdBand: "steady", thresholdPrice: null, findingKey: null },
    { ...common("RELIANCE", "Reliance Industries Ltd"), type: "finding", operator: "fires", snapshot: "promoter_pledge_high", findingKey: "promoter_pledge_high", thresholdPrice: null, thresholdBand: null },
  ];

  const mailer = createResendMailer();
  const ts = Date.now();
  for (const props of samples) {
    const { subject, html } = await renderAlertEmail(props);
    try {
      const { id } = await mailer.send({
        to,
        subject,
        html,
        idempotencyKey: `test-send:${to}:${props.type}:${ts}`,
      });
      console.log(`✅ ${props.type.padEnd(12)} "${subject}" — id ${id}`);
    } catch (err) {
      console.error(`✗ ${props.type} failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}

main();
