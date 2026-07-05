// ─────────────────────────────────────────────────────────────────────────────
// ALERT DELIVERY VERIFY HARNESS — the drain contract (backend, MOCK Resend, no real sends).
//
// Proves, end-to-end through the REAL drain + REAL template + REAL DB:
//   • the drain reads undelivered alert_events, "sends" (mock), and flips delivered=true;
//   • IDEMPOTENT — a re-run over an already-drained log sends ZERO;
//   • the send-FAILURE path — a mocked failure leaves that event delivered=false (retried
//     next run) while the rest of the batch still sends, and the drain never crashes;
//   • the per-event Resend idempotencyKey is the alert_event id;
//   • the template renders correctly for all three alert types (+ the "any finding" case);
//   • a deleted alert cascades its events away (so the drain never sends for one).
//
// Throwaway auth.users (signup trigger seeds public.users), alerts + alert_events created
// directly, all cleaned up on exit (cascade). No network, no RESEND_API_KEY needed.
//   npx tsx src/scripts/verify-alerts-deliver.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { runAlertsDeliverPass } from "../alerts/deliver.js";
import type { AlertMailer, OutgoingEmail } from "../alerts/email/mailer.js";
import {
  renderAlertEmail,
  describeAlert,
  type AlertEmailProps,
} from "../alerts/email/alert-email.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n── ${t} ──`);

// ── recording mock mailer (optionally fails for chosen events) ──
interface MockMailer extends AlertMailer {
  sent: OutgoingEmail[];
}
function mockMailer(failIdempotencyKeys: Set<string> = new Set()): MockMailer {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    async send(email: OutgoingEmail) {
      if (email.idempotencyKey && failIdempotencyKeys.has(email.idempotencyKey)) {
        throw new Error("mock send failure (injected)");
      }
      sent.push(email);
      return { id: "mock-" + sent.length };
    },
  };
}

// ── throwaway users (same pattern as verify-alerts) ──
const authIds: string[] = [];
async function newUser(tag: string): Promise<{ id: string; email: string }> {
  const authId = randomUUID();
  const email = `deliver-${tag}-${authId}@test.local`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
    authId,
    email,
  );
  authIds.push(authId);
  const u = await prisma.user.findUnique({
    where: { authUserId: authId },
    select: { id: true, email: true },
  });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  return { id: u.id, email: u.email };
}

type AlertSeed =
  | { type: "price"; operator: "above" | "below"; thresholdPrice: number }
  | { type: "health_band"; operator: "above" | "below"; thresholdBand: string }
  | { type: "finding"; operator: "fires"; findingKey: string | null };

async function seedEvent(
  userId: string,
  stockId: string,
  seed: AlertSeed,
  snapshot: string,
): Promise<string> {
  const alert = await prisma.alert.create({
    data: {
      userId,
      stockId,
      type: seed.type,
      operator: seed.operator,
      thresholdPrice: seed.type === "price" ? seed.thresholdPrice : null,
      thresholdBand: seed.type === "health_band" ? (seed.thresholdBand as any) : null,
      findingKey: seed.type === "finding" ? seed.findingKey : null,
      repeatMode: "repeating",
      armed: false, // already fired (matches an event existing)
    },
    select: { id: true },
  });
  const ev = await prisma.alertEvent.create({
    data: { alertId: alert.id, userId, stockId, snapshot, delivered: false },
    select: { id: true },
  });
  return ev.id;
}

async function main() {
  const stock = await prisma.stock.findFirst({ select: { id: true, symbol: true, name: true } });
  if (!stock) {
    console.log("  ⚠ no stock in DB — cannot run delivery tests");
    return finish();
  }
  console.log(`  [fixtures] stock=${stock.symbol} (${stock.name})`);

  // ═══════════════════════════════════════════════════════════════
  // 1. Drain sends undelivered events + flips delivered (all 3 types + "any finding")
  // ═══════════════════════════════════════════════════════════════
  section("Drain: reads undelivered → sends (mock) → flips delivered");
  const userA = await newUser("A");
  const evPrice = await seedEvent(userA.id, stock.id, { type: "price", operator: "above", thresholdPrice: 1000 }, "4012.50");
  const evBand = await seedEvent(userA.id, stock.id, { type: "health_band", operator: "below", thresholdBand: "steady" }, "below_par");
  const evFindKey = await seedEvent(userA.id, stock.id, { type: "finding", operator: "fires", findingKey: "promoter_pledge_high" }, "promoter_pledge_high");
  const evFindAny = await seedEvent(userA.id, stock.id, { type: "finding", operator: "fires", findingKey: null }, "auditor_change,debt_spike");
  const allA = new Set([evPrice, evBand, evFindKey, evFindAny]);

  const mockA = mockMailer();
  const rA = await runAlertsDeliverPass({ mailer: mockA, onlyUserIds: [userA.id] });
  ok("drain result: scanned 4 · sent 4 · failed 0", rA.scanned === 4 && rA.sent === 4 && rA.failed === 0, `scanned=${rA.scanned} sent=${rA.sent} failed=${rA.failed}`);
  ok("mock received 4 emails", mockA.sent.length === 4);
  ok("all 4 events flipped delivered=true", (await prisma.alertEvent.count({ where: { id: { in: [...allA] }, delivered: true } })) === 4);
  ok("every email addressed to the user", mockA.sent.every((e) => e.to === userA.email), `to=${mockA.sent[0]?.to}`);
  ok("every email has a subject + non-empty html", mockA.sent.every((e) => e.subject.length > 0 && e.html.includes("<") && e.html.length > 100));
  ok("idempotencyKey is the alert_event id", mockA.sent.every((e) => e.idempotencyKey?.startsWith("alert-event:") && allA.has(e.idempotencyKey.slice("alert-event:".length))));
  const symbolInEveryEmail = mockA.sent.every((e) => e.html.includes(stock.symbol));
  ok("stock symbol rendered in every email body", symbolInEveryEmail);

  // ═══════════════════════════════════════════════════════════════
  // 2. Idempotency — re-run sends ZERO (delivered flag is the guard)
  // ═══════════════════════════════════════════════════════════════
  section("Idempotency: re-run over a drained log sends zero");
  const mockA2 = mockMailer();
  const rA2 = await runAlertsDeliverPass({ mailer: mockA2, onlyUserIds: [userA.id] });
  ok("re-run: scanned 0 · sent 0", rA2.scanned === 0 && rA2.sent === 0);
  ok("mock received 0 emails on re-run (no double-send)", mockA2.sent.length === 0);

  // ═══════════════════════════════════════════════════════════════
  // 3. Send-failure path — failed event stays undelivered, batch continues, retries next run
  // ═══════════════════════════════════════════════════════════════
  section("Failure path: one send fails → left for retry, rest of batch still sends");
  const userB = await newUser("B");
  const evB1 = await seedEvent(userB.id, stock.id, { type: "price", operator: "below", thresholdPrice: 5000 }, "4800.00");
  const evBfail = await seedEvent(userB.id, stock.id, { type: "health_band", operator: "above", thresholdBand: "steady" }, "healthy");
  const evB3 = await seedEvent(userB.id, stock.id, { type: "finding", operator: "fires", findingKey: null }, "margin_pressure");

  const mockB = mockMailer(new Set([`alert-event:${evBfail}`])); // fail ONLY the middle event
  const rB = await runAlertsDeliverPass({ mailer: mockB, onlyUserIds: [userB.id] });
  ok("drain did NOT crash on the failure (returned a result)", rB != null);
  ok("result: scanned 3 · sent 2 · failed 1", rB.scanned === 3 && rB.sent === 2 && rB.failed === 1, `scanned=${rB.scanned} sent=${rB.sent} failed=${rB.failed}`);
  ok("the 2 good events flipped delivered=true", (await prisma.alertEvent.count({ where: { id: { in: [evB1, evB3] }, delivered: true } })) === 2);
  ok("the FAILED event stays delivered=false (retryable)", (await prisma.alertEvent.count({ where: { id: evBfail, delivered: false } })) === 1);
  ok("mock received 2 emails (the failed one was not counted as sent)", mockB.sent.length === 2);
  ok("failed outcome recorded with an error message", rB.outcomes.some((o) => o.eventId === evBfail && o.status === "failed" && !!o.error));

  section("Failure path: the next drain retries the previously-failed event");
  const mockB2 = mockMailer(); // healthy now
  const rB2 = await runAlertsDeliverPass({ mailer: mockB2, onlyUserIds: [userB.id] });
  ok("retry run: scanned 1 · sent 1 (only the previously-failed event)", rB2.scanned === 1 && rB2.sent === 1, `scanned=${rB2.scanned} sent=${rB2.sent}`);
  ok("previously-failed event now delivered=true", (await prisma.alertEvent.count({ where: { id: evBfail, delivered: true } })) === 1);

  // ═══════════════════════════════════════════════════════════════
  // 4. Template renders correctly for all 3 alert types
  // ═══════════════════════════════════════════════════════════════
  section("Template renders per alert type (subject + html)");
  const baseProps = {
    stockSymbol: "TCS",
    stockName: "Tata Consultancy Services Limited",
    firedAt: new Date("2026-07-05T12:00:00Z"),
    stockUrl: "https://app.vytal.in/stocks/TCS",
    manageUrl: "https://app.vytal.in/alerts",
  };
  {
    // Vytal dark theme + brand mark present in the rendered HTML
    const p: AlertEmailProps = { ...baseProps, type: "price", operator: "above", snapshot: "4200", thresholdPrice: "4000", thresholdBand: null, findingKey: null };
    const { html } = await renderAlertEmail(p);
    ok("theme: near-black Vytal background #090a0d present", html.includes("#090a0d"));
    ok("theme: warm off-white ink #f1efe9 present", html.includes("#f1efe9"));
    ok("brand: 'Vytal' wordmark present", html.includes(">Vytal<") || html.includes("Vytal"));
    ok("price up: accent is healthy green #48ba7c", html.includes("#48ba7c"));
  }
  {
    const p: AlertEmailProps = { ...baseProps, type: "price", operator: "below", snapshot: "3480.00", thresholdPrice: "3500", thresholdBand: null, findingKey: null };
    const { subject, html } = await renderAlertEmail(p);
    ok("price: subject reads 'TCS fell below ₹3,500' (platform ₹ fmt)", subject === "TCS fell below ₹3,500", `subject="${subject}"`);
    ok("price: html shows the latest close ₹3,480", html.includes("₹3,480"));
    ok("price: html carries the 'checked once a day, at market close' note", html.includes("checked once a day"));
  }
  {
    const p: AlertEmailProps = { ...baseProps, type: "health_band", operator: "below", snapshot: "below_par", thresholdBand: "steady", thresholdPrice: null, findingKey: null };
    const { subject, html } = await renderAlertEmail(p);
    ok("band: subject reads 'TCS dropped below Steady'", subject === "TCS dropped below Steady", `subject="${subject}"`);
    ok("band: html shows current band pill 'Below par' (platform label)", html.includes("Below par"));
    ok("band: pill uses the below-par band colour #e0913f", html.includes("#e0913f"));
    ok("band: html has NO end-of-day price note", !html.includes("checked once a day"));
  }
  {
    const p: AlertEmailProps = { ...baseProps, type: "finding", operator: "fires", snapshot: "promoter_pledge_high", findingKey: "promoter_pledge_high", thresholdPrice: null, thresholdBand: null };
    const { subject, html } = await renderAlertEmail(p);
    ok("finding(specific): subject 'New finding on TCS: Promoter Pledge High'", subject === "New finding on TCS: Promoter Pledge High", `subject="${subject}"`);
    ok("finding(specific): html shows the prettified finding label", html.includes("Promoter Pledge High"));
  }
  {
    const p: AlertEmailProps = { ...baseProps, type: "finding", operator: "fires", snapshot: "auditor_change,debt_spike", findingKey: null, thresholdPrice: null, thresholdBand: null };
    const n = describeAlert(p);
    ok("finding(any, 2 keys): subject '2 new findings on TCS'", n.subject === "2 new findings on TCS", `subject="${n.subject}"`);
    ok("finding(any): both keys listed, prettified", n.rows[0].value === "Auditor Change, Debt Spike", `value="${n.rows[0].value}"`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. Deleted alert cascades its events away (drain never sends for a deleted alert)
  // ═══════════════════════════════════════════════════════════════
  section("Deleted alert → events cascade (nothing left to send)");
  const userC = await newUser("C");
  const evC = await seedEvent(userC.id, stock.id, { type: "price", operator: "above", thresholdPrice: 1 }, "9999.00");
  const alertC = (await prisma.alertEvent.findUnique({ where: { id: evC }, select: { alertId: true } }))!.alertId;
  await prisma.alert.delete({ where: { id: alertC } });
  ok("deleting the alert removed its event (FK cascade)", (await prisma.alertEvent.count({ where: { id: evC } })) === 0);
  const mockC = mockMailer();
  const rC = await runAlertsDeliverPass({ mailer: mockC, onlyUserIds: [userC.id] });
  ok("drain finds nothing to send for the deleted alert's owner", rC.scanned === 0 && mockC.sent.length === 0);

  await finish();
}

async function finish() {
  for (const authId of authIds) {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId).catch(() => {});
  }
  console.log(`\n  [cleanup] ${authIds.length} test user(s) + their alerts/events deleted (cascade)`);
  console.log(`\n═══ ${failures === 0 ? "ALERTS DELIVER VERIFY PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await finish().catch(() => {});
  process.exit(1);
});
