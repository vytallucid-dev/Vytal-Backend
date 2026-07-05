// ─────────────────────────────────────────────────────────────────────────────
// EVENT-REMINDERS VERIFY HARNESS — the full contract for date-triggered reminders.
// Proves, end-to-end through the REAL controllers / eval pass / deliver drain / template / DB:
//   • the pure fire decision (lead window, never on the event day);
//   • resolveNextEvents against REAL corporate_events (the nearest upcoming of a type);
//   • CRUD round-trips (create 201 / re-affirm 200 idempotent / list / pause / delete);
//   • validation 400s (bad eventType, daysBefore<1) + universe gate + pause-only PATCH;
//   • IDOR isolation (a non-owner can't pause/delete/list another user's reminders);
//   • the FIRE / DEDUPE / FOLLOWS-RESCHEDULE sequence through the real eval + write path
//     (driven deterministically via the eventOverrides + now seams);
//   • delivery through the REAL drain + REAL template + the SAME alerts mailer (mocked, no
//     real sends): sends + flips delivered, idempotent re-run sends 0, failure path retries;
//   • a deleted reminder cascades its fired events away.
//
// Throwaway auth.users (signup trigger seeds public.users), cleaned up on exit (cascade).
//   npx tsx src/scripts/verify-reminders.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import {
  createReminder,
  listReminders,
  updateReminder,
  deleteReminder,
} from "../controllers/me/reminders-controller.js";
import {
  reminderFireDecision,
  resolveNextEvents,
  startOfUtcDay,
  addUtcDays,
  nextEventKey,
  type NextEvent,
} from "../reminders/resolve.js";
import { runRemindersEvalPass } from "../reminders/eval-pass.js";
import { runRemindersDeliverPass } from "../reminders/deliver.js";
import { describeReminder, renderReminderEmail } from "../reminders/email/reminder-email.js";
import type { AlertMailer, OutgoingEmail } from "../alerts/email/mailer.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n── ${t} ──`);

// ── mock (req,res) so the real controllers run without a server ──
function mkReq(userId: string, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, unknown> } = {}): Request {
  return {
    authUser: { userId, authUserId: "auth-" + userId, email: "t@test.local", role: "user" },
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    headers: {},
  } as unknown as Request;
}
interface CapRes { _status: number; _json: any; }
function mkRes(): Response & CapRes {
  const r: any = { _status: 200, _json: null };
  r.status = (c: number) => { r._status = c; return r; };
  r.json = (b: unknown) => { r._json = b; return r; };
  return r as Response & CapRes;
}
async function call(handler: (req: Request, res: Response) => Promise<unknown> | unknown, req: Request): Promise<CapRes> {
  const res = mkRes();
  await handler(req, res);
  return res;
}

// ── throwaway users ──
const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
    authId,
    `reminder-${tag}-${authId}@test.local`,
  );
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  return u.id;
}

const ev = (eventDate: Date): NextEvent => ({ eventDate, impactLevel: "high", description: null });

async function finish() {
  // cleanup — drop throwaway auth users (cascade → public.users → reminders → events)
  for (const id of authIds) {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, id).catch(() => {});
  }
  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  // ═══════════════════════════════════════════════════════════════
  // 1. PURE fire decision (no DB)
  // ═══════════════════════════════════════════════════════════════
  section("Pure fire decision (lead window, never on the event day)");
  {
    const today = startOfUtcDay(new Date(Date.UTC(2026, 6, 5)));
    // daysBefore=1 → fires exactly the day before
    ok("no upcoming event → no fire", reminderFireDecision({ today, next: undefined, daysBefore: 1 }).fire === false);
    ok(
      "daysBefore=1 fires the day before",
      reminderFireDecision({ today, next: ev(addUtcDays(today, 1)), daysBefore: 1 }).fire === true,
    );
    ok(
      "never on the event day (today == eventDate → no fire)",
      reminderFireDecision({ today, next: ev(today), daysBefore: 1 }).fire === false &&
        (reminderFireDecision({ today, next: ev(today), daysBefore: 1 }) as any).reason === "past_lead",
    );
    ok(
      "two days out with daysBefore=1 → before window",
      reminderFireDecision({ today, next: ev(addUtcDays(today, 2)), daysBefore: 1 }).fire === false,
    );
    // daysBefore=3 → window [eventDate-3, eventDate)
    ok(
      "daysBefore=3 fires 3 days before (window opens)",
      reminderFireDecision({ today, next: ev(addUtcDays(today, 3)), daysBefore: 3 }).fire === true,
    );
    ok(
      "daysBefore=3 still fires 1 day before (inside window)",
      reminderFireDecision({ today, next: ev(addUtcDays(today, 1)), daysBefore: 3 }).fire === true,
    );
    ok(
      "daysBefore=3 does NOT fire 4 days before (before window)",
      reminderFireDecision({ today, next: ev(addUtcDays(today, 4)), daysBefore: 3 }).fire === false,
    );
    const fired = reminderFireDecision({ today, next: ev(addUtcDays(today, 1)), daysBefore: 1 });
    ok(
      "fire returns the resolved occurrence date",
      fired.fire === true && (fired as any).resolvedEventDate.getTime() === addUtcDays(today, 1).getTime(),
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. resolveNextEvents against REAL corporate_events
  // ═══════════════════════════════════════════════════════════════
  section("resolveNextEvents (real corporate_events)");
  const today = startOfUtcDay(new Date());
  const realEvent = await prisma.corporateEvent.findFirst({
    where: { eventDate: { gte: today }, eventType: { in: ["earnings", "dividend"] } },
    orderBy: { eventDate: "asc" },
    select: { stockId: true, eventType: true, eventDate: true, stock: { select: { symbol: true } } },
  });
  if (!realEvent) { console.log("  ⚠ no upcoming corporate event found — cannot run DB tests"); return finish(); }
  {
    const map = await resolveNextEvents([{ stockId: realEvent.stockId, eventType: realEvent.eventType }], today);
    const got = map.get(nextEventKey(realEvent.stockId, realEvent.eventType));
    ok(
      `resolves nearest upcoming ${realEvent.eventType} for ${realEvent.stock.symbol}`,
      got != null && startOfUtcDay(got.eventDate).getTime() === startOfUtcDay(realEvent.eventDate).getTime(),
      got ? got.eventDate.toISOString().slice(0, 10) : "none",
    );
    const none = await resolveNextEvents([{ stockId: realEvent.stockId, eventType: "buyback_nonexistent" }], today);
    ok("a type with no upcoming event resolves to nothing", none.size === 0);
  }

  // Resolve real stock ids for CRUD/eval (any real stock works — reminders are date-based).
  const stockA = await prisma.stock.findUnique({ where: { id: realEvent.stockId }, select: { id: true, symbol: true } });
  const stockB = await prisma.stock.findFirst({
    where: { id: { not: realEvent.stockId }, isActive: true },
    select: { id: true, symbol: true, name: true },
  });
  console.log(`\n  [fixtures] stockA=${stockA!.symbol} · stockB=${stockB!.symbol}`);

  // ═══════════════════════════════════════════════════════════════
  // 3. CRUD + validation + universe gate + pause-only PATCH
  // ═══════════════════════════════════════════════════════════════
  section("CRUD round-trips (real controllers, mock auth)");
  const userA = await newUser("A");
  let reminderId = "";
  {
    // create
    const c = await call(createReminder, mkReq(userA, { body: { stockId: stockA!.id, eventType: realEvent.eventType, daysBefore: 2 } }));
    ok("POST create → 201", c._status === 201 && c._json?.success === true, `status ${c._status}`);
    ok("created reminder bound by (stockId, eventType)", c._json?.data?.reminder?.stockId === stockA!.id && c._json?.data?.reminder?.eventType === realEvent.eventType);
    ok("created reminder carries daysBefore=2", c._json?.data?.reminder?.daysBefore === 2);
    ok("created reminder resolves a nextEventDate (real event exists)", typeof c._json?.data?.reminder?.nextEventDate === "string");
    ok("created reminder exposes remindDate = nextEventDate − daysBefore", c._json?.data?.reminder?.remindDate != null);
    reminderId = c._json?.data?.reminder?.id;

    // re-affirm (idempotent — same pair) → 200, updates daysBefore, no duplicate row
    const c2 = await call(createReminder, mkReq(userA, { body: { stockId: stockA!.id, eventType: realEvent.eventType, daysBefore: 5 } }));
    ok("POST same pair → 200 (re-affirm, not duplicate)", c2._status === 200 && c2._json?.data?.created === false);
    ok("re-affirm updates daysBefore to 5", c2._json?.data?.reminder?.daysBefore === 5 && c2._json?.data?.reminder?.id === reminderId);
    const count = await prisma.eventReminder.count({ where: { userId: userA } });
    ok("only ONE reminder row for the pair (no duplicate)", count === 1, `rows=${count}`);

    // list (with resolved next event)
    const l = await call(listReminders, mkReq(userA));
    ok("GET list returns the reminder", l._json?.data?.count === 1 && l._json?.data?.reminders?.[0]?.id === reminderId);

    // pause (PATCH active=false)
    const p = await call(updateReminder, mkReq(userA, { params: { id: reminderId }, body: { active: false } }));
    ok("PATCH pause → active=false", p._status === 200 && p._json?.data?.reminder?.active === false);
    // resume
    const r = await call(updateReminder, mkReq(userA, { params: { id: reminderId }, body: { active: true } }));
    ok("PATCH resume → active=true", r._json?.data?.reminder?.active === true);
  }

  section("Validation + universe gate + pause-only lifecycle");
  {
    const badType = await call(createReminder, mkReq(userA, { body: { stockId: stockA!.id, eventType: "not_a_type" } }));
    ok("bad eventType → 400", badType._status === 400);
    const badDays = await call(createReminder, mkReq(userA, { body: { stockId: stockB!.id, eventType: "earnings", daysBefore: 0 } }));
    ok("daysBefore < 1 → 400 (never on the event day)", badDays._status === 400);
    const noStock = await call(createReminder, mkReq(userA, { body: { stockId: "does-not-exist", eventType: "earnings" } }));
    ok("unknown stockId → 400 (universe gate)", noStock._status === 400 && noStock._json?.error === "stock_not_found");
    // PATCH is pause/resume ONLY — a daysBefore edit is rejected (strict body)
    const patchDays = await call(updateReminder, mkReq(userA, { params: { id: reminderId }, body: { daysBefore: 10 } }));
    ok("PATCH with daysBefore → 400 (pause-only lifecycle)", patchDays._status === 400);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. IDOR isolation
  // ═══════════════════════════════════════════════════════════════
  section("IDOR isolation (owner scoping)");
  const userB = await newUser("B");
  {
    const patchOther = await call(updateReminder, mkReq(userB, { params: { id: reminderId }, body: { active: false } }));
    ok("userB cannot pause userA's reminder → 404", patchOther._status === 404);
    const delOther = await call(deleteReminder, mkReq(userB, { params: { id: reminderId } }));
    ok("userB cannot delete userA's reminder → 404", delOther._status === 404);
    const stillActive = await prisma.eventReminder.findUnique({ where: { id: reminderId }, select: { active: true } });
    ok("userA's reminder untouched by userB", stillActive?.active === true);
    const bList = await call(listReminders, mkReq(userB));
    ok("userB's list is empty (owner-scoped)", bList._json?.data?.count === 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. FIRE / DEDUPE / FOLLOWS-RESCHEDULE (real eval + write path)
  // ═══════════════════════════════════════════════════════════════
  section("Eval: fire 1 day before · dedupe per occurrence · follows reschedule");
  const userC = await newUser("C");
  {
    // one reminder, daysBefore=1, on stockB + earnings
    const created = await prisma.eventReminder.create({
      data: { userId: userC, stockId: stockB!.id, eventType: "earnings", daysBefore: 1 },
      select: { id: true },
    });
    const key = nextEventKey(stockB!.id, "earnings");

    // Day 1: event is tomorrow → fires
    const D1 = startOfUtcDay(new Date(Date.UTC(2026, 6, 10)));
    const occA = addUtcDays(D1, 1);
    const r1 = await runRemindersEvalPass({ now: D1, onlyUserIds: [userC], eventOverrides: new Map([[key, ev(occA)]]) });
    ok("fires 1 day before the resolved event", r1.fired === 1 && r1.outcomes[0]?.status === "fired", JSON.stringify(r1.outcomes[0]));
    const afterFire = await prisma.eventReminder.findUnique({ where: { id: created.id }, select: { lastFiredAt: true } });
    ok("lastFiredAt stamped on fire", afterFire?.lastFiredAt != null);
    const evRows1 = await prisma.eventReminderEvent.findMany({ where: { reminderId: created.id }, select: { resolvedEventDate: true, delivered: true } });
    ok("one fired event, delivered=false (sends nothing here)", evRows1.length === 1 && evRows1[0].delivered === false);
    ok("fired event dedupe-keyed on the resolved occurrence date", startOfUtcDay(evRows1[0].resolvedEventDate).getTime() === occA.getTime());

    // Re-eval SAME day, SAME occurrence → deduped (no double-send)
    const r2 = await runRemindersEvalPass({ now: D1, onlyUserIds: [userC], eventOverrides: new Map([[key, ev(occA)]]) });
    ok("re-eval same occurrence → deduped (fire once per occurrence)", r2.fired === 0 && r2.deduped === 1);
    const evCount2 = await prisma.eventReminderEvent.count({ where: { reminderId: created.id } });
    ok("no second event row for the same occurrence", evCount2 === 1);

    // RESCHEDULE: the event moves to a new date → re-resolves to the nearer new row, fires again
    const D2 = addUtcDays(D1, 5);
    const occB = addUtcDays(D2, 1); // rescheduled event, now tomorrow relative to D2
    const r3 = await runRemindersEvalPass({ now: D2, onlyUserIds: [userC], eventOverrides: new Map([[key, ev(occB)]]) });
    ok("follows a reschedule (new date → fires for the new occurrence)", r3.fired === 1 && r3.outcomes[0]?.status === "fired");
    const evCount3 = await prisma.eventReminderEvent.count({ where: { reminderId: created.id } });
    ok("a genuinely new occurrence is a new fired row (not pinned to the stale date)", evCount3 === 2);

    // never on the event day
    const D3 = startOfUtcDay(new Date(Date.UTC(2026, 6, 20)));
    const r4 = await runRemindersEvalPass({ now: D3, onlyUserIds: [userC], eventOverrides: new Map([[key, ev(D3)]]) });
    ok("never fires ON the event day (past_lead)", r4.fired === 0 && r4.outcomes[0]?.status === "past_lead");

    // before the window
    const D4 = startOfUtcDay(new Date(Date.UTC(2026, 6, 21)));
    const r5 = await runRemindersEvalPass({ now: D4, onlyUserIds: [userC], eventOverrides: new Map([[key, ev(addUtcDays(D4, 5))]]) });
    ok("before the lead window → no fire (before_window)", r5.fired === 0 && r5.outcomes[0]?.status === "before_window");

    // paused reminder is not scanned
    await prisma.eventReminder.update({ where: { id: created.id }, data: { active: false } });
    const r6 = await runRemindersEvalPass({ now: D1, onlyUserIds: [userC], eventOverrides: new Map([[key, ev(addUtcDays(D1, 1))]]) });
    ok("paused reminder is not scanned", r6.scanned === 0);
    await prisma.eventReminder.update({ where: { id: created.id }, data: { active: true } });
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. DELIVERY through the real drain + template + the SAME alerts mailer (mocked)
  // ═══════════════════════════════════════════════════════════════
  section("Delivery (real drain + template · mock Resend · reuses alerts mailer)");
  {
    interface MockMailer extends AlertMailer { sent: OutgoingEmail[]; }
    const mockMailer = (failKeys: Set<string> = new Set()): MockMailer => {
      const sent: OutgoingEmail[] = [];
      return {
        sent,
        async send(email: OutgoingEmail) {
          if (email.idempotencyKey && failKeys.has(email.idempotencyKey)) throw new Error("mock send failure (injected)");
          sent.push(email);
          return { id: "mock-" + sent.length };
        },
      };
    };

    // userC has 2 undelivered fired events from Section 5.
    const undelivered = await prisma.eventReminderEvent.findMany({ where: { userId: userC, delivered: false }, select: { id: true } });
    ok("two undelivered reminder events to drain", undelivered.length === 2, `count=${undelivered.length}`);

    const m1 = mockMailer();
    const d1 = await runRemindersDeliverPass({ mailer: m1, onlyUserIds: [userC] });
    ok("drain sends all undelivered + flips delivered", d1.sent === 2 && d1.failed === 0);
    ok("mock mailer received the sends via the alerts mailer seam", m1.sent.length === 2);
    ok("idempotencyKey is the reminder-event id", m1.sent.every((e) => e.idempotencyKey?.startsWith("reminder-event:")));
    const stillUndelivered = await prisma.eventReminderEvent.count({ where: { userId: userC, delivered: false } });
    ok("no undelivered events remain", stillUndelivered === 0);

    // idempotent re-run
    const d2 = await runRemindersDeliverPass({ mailer: mockMailer(), onlyUserIds: [userC] });
    ok("idempotent re-run sends 0", d2.scanned === 0 && d2.sent === 0);

    // failure path — seed one more undelivered, fail it → left for retry, then retry succeeds
    const one = await prisma.eventReminderEvent.findFirst({ where: { userId: userC }, select: { id: true } });
    await prisma.eventReminderEvent.update({ where: { id: one!.id }, data: { delivered: false } });
    const failKey = `reminder-event:${one!.id}`;
    const d3 = await runRemindersDeliverPass({ mailer: mockMailer(new Set([failKey])), onlyUserIds: [userC] });
    ok("a failed send is counted + left undelivered (no crash)", d3.sent === 0 && d3.failed === 1);
    ok("the failed event stays delivered=false", (await prisma.eventReminderEvent.findUnique({ where: { id: one!.id }, select: { delivered: true } }))?.delivered === false);
    const d4 = await runRemindersDeliverPass({ mailer: mockMailer(), onlyUserIds: [userC] });
    ok("next drain RETRIES the previously-failed event", d4.sent === 1);
  }

  section("Reminder email template (pure copy engine + render)");
  {
    const n1 = describeReminder({ stockSymbol: "RELIANCE", stockName: "Reliance Industries", eventType: "earnings", eventDate: "2026-08-05", daysBefore: 1, stockUrl: "x", manageUrl: "y" });
    ok("earnings · 1 day → subject '… earnings tomorrow'", n1.subject === "Reminder: RELIANCE — earnings tomorrow", n1.subject);
    const n3 = describeReminder({ stockSymbol: "TCS", stockName: "Tata Consultancy", eventType: "dividend", eventDate: "2026-08-10", daysBefore: 3, stockUrl: "x", manageUrl: "y" });
    ok("dividend · 3 days → subject '… in 3 days'", n3.subject === "Reminder: TCS — dividend in 3 days", n3.subject);
    const rendered = await renderReminderEmail({ stockSymbol: "TCS", stockName: "Tata Consultancy", eventType: "dividend", eventDate: "2026-08-10", daysBefore: 3, stockUrl: "https://app.vytal.in/stocks/TCS", manageUrl: "https://app.vytal.in/calendar" });
    ok(
      "renders HTML (brand + CTA link + subject)",
      rendered.html.includes("Vytal") &&
        rendered.html.includes("https://app.vytal.in/stocks/TCS") &&
        rendered.html.includes("Event reminder") &&
        rendered.subject.length > 0,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. Cascade: delete a reminder → its fired events go with it
  // ═══════════════════════════════════════════════════════════════
  section("Delete cascades fired events");
  {
    const rem = await prisma.eventReminder.findFirst({ where: { userId: userC }, select: { id: true } });
    const before = await prisma.eventReminderEvent.count({ where: { reminderId: rem!.id } });
    ok("reminder has fired events before delete", before > 0);
    const del = await call(deleteReminder, mkReq(userC, { params: { id: rem!.id } }));
    ok("DELETE → 200 removed", del._status === 200 && del._json?.data?.removed === true);
    const after = await prisma.eventReminderEvent.count({ where: { reminderId: rem!.id } });
    ok("fired events cascaded away with the reminder", after === 0);
  }

  await finish();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await finish();
});
