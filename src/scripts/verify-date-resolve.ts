// ─────────────────────────────────────────────────────────────────────────────
// DATE RESOLVER + TRANSACTION DATE GUARD — deterministic proofs.
//
// The resolver is pure arithmetic, so every case here is pinned against a FIXED "now" and asserted
// exactly. That is the whole point of moving the date work server-side: unlike a description, this is
// decidable without spending a model call.
//
// Pinned clock: 2026-07-26T04:00:00Z — deliberately BEFORE 05:30 UTC, so the UTC date and the IST date
// DISAGREE (UTC says the 26th at 04:00, IST is already the 26th at 09:30 — and at 2026-07-25T22:00Z UTC
// says the 25th while IST says the 26th). The timezone cases below pin exactly that boundary.
//
//   npx tsx src/scripts/verify-date-resolve.ts
// ─────────────────────────────────────────────────────────────────────────────
import { resolvePhrase, datesMentionedIn, istToday, howLongAgo, boundsPhrase } from "../chat/date-resolve.js";
import { attestTradeDate } from "../chat/tools/write-shared.js";
import { makeToolContext } from "../chat/tools/registry.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);

// Sunday 26 July 2026, 09:30 IST.
const NOW = new Date("2026-07-26T04:00:00.000Z");

function res(phrase: string) {
  return resolvePhrase(phrase, NOW);
}
/** Assert a phrase resolves to an exact date. */
function accepts(phrase: string, expected: string) {
  const r = res(phrase);
  ok(`"${phrase}" → ${expected}`, r.ok && r.date === expected, r.ok ? (r.date === expected ? (r.assumption ?? "") : `got ${r.date}`) : `REFUSED: ${r.reason}`);
}
/** Assert a phrase is refused, optionally checking the bounds it reports. */
function refuses(phrase: string, expectBounds?: [string, string]) {
  const r = res(phrase);
  const boundsOk = !expectBounds || (!!r.ok === false && !!(r as any).bounds && (r as any).bounds.from === expectBounds[0] && (r as any).bounds.to === expectBounds[1]);
  ok(`"${phrase}" → refused${expectBounds ? ` (${expectBounds[0]}…${expectBounds[1]})` : ""}`, !r.ok && boundsOk,
    r.ok ? `RESOLVED to ${r.date} — should have refused` : `${r.reason}${(r as any).bounds ? ` [${boundsPhrase((r as any).bounds)}]` : ""}`);
}

async function main() {
  console.log(`Pinned now = ${NOW.toISOString()}  ·  IST today = ${istToday(NOW)} (Sunday)`);

  // ═══════════════════════════════════════════════════════════════════════════
  section("1 · Timezone — 'today' is the reader's day in India, not UTC's");
  {
    ok("IST today at 04:00Z is 2026-07-26", istToday(new Date("2026-07-26T04:00:00Z")) === "2026-07-26");
    // 22:00 UTC on the 25th is 03:30 IST on the 26th — the case a UTC-based resolver gets wrong.
    ok("★ 2026-07-25T22:00Z → IST today is the 26th (UTC would say the 25th)", istToday(new Date("2026-07-25T22:00:00Z")) === "2026-07-26",
      `got ${istToday(new Date("2026-07-25T22:00:00Z"))}`);
    // 18:00 UTC on the 25th is 23:30 IST on the 25th — still the 25th.
    ok("2026-07-25T18:00Z → IST today is the 25th", istToday(new Date("2026-07-25T18:00:00Z")) === "2026-07-25");
    const r = resolvePhrase("today", new Date("2026-07-25T22:00:00Z"));
    ok("★ 'today' at 03:30 IST resolves to the IST day", r.ok && r.date === "2026-07-26", r.ok ? r.date : r.reason);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("2 · Absolute dates (day-first, Indian convention)");
  accepts("2026-07-20", "2026-07-20");
  accepts("20/07/2026", "2026-07-20");
  accepts("20-07-2026", "2026-07-20");
  accepts("20.07.2026", "2026-07-20");
  accepts("20/07/26", "2026-07-20");
  accepts("12/03/2025", "2025-03-12"); // ★ 12 March, NOT 3 December — the ordering that matters
  accepts("20 July 2026", "2026-07-20");
  accepts("20 Jul 2026", "2026-07-20");
  accepts("20th July 2026", "2026-07-20");
  accepts("July 20 2026", "2026-07-20");
  accepts("July 20, 2026", "2026-07-20");
  accepts("on the 20th of July 2026", "2026-07-20");
  accepts("12 March 2025", "2025-03-12");
  refuses("31 February 2026");
  refuses("2026-13-01");

  // ═══════════════════════════════════════════════════════════════════════════
  section("3 · ★ Day + month, NO year — the case that produced 2025-07-20 for '20 July'");
  accepts("20 July", "2026-07-20"); //  6 days ago → THIS year
  accepts("20 Jul", "2026-07-20");
  accepts("July 20", "2026-07-20");
  accepts("20th July", "2026-07-20");
  accepts("20 December", "2025-12-20"); // in the future this year ⇒ last year
  accepts("1 January", "2026-01-01");
  {
    const r = res("20 July");
    ok("★ the year assumption is REPORTED so the model can say it out loud", r.ok && /THIS year \(2026\)/.test(r.assumption ?? ""), r.ok ? r.assumption : "");
    const r2 = res("20 December");
    ok("★ a last-year reading is reported too", r2.ok && /LAST year \(2025\)/.test(r2.assumption ?? ""), r2.ok ? r2.assumption : "");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("4 · Unambiguous relatives");
  accepts("today", "2026-07-26");
  accepts("yesterday", "2026-07-25");
  accepts("day before yesterday", "2026-07-24");
  accepts("the day before yesterday", "2026-07-24");
  accepts("2 days ago", "2026-07-24");
  accepts("10 days back", "2026-07-16");
  accepts("a week ago", "2026-07-19");
  accepts("2 weeks ago", "2026-07-12");
  accepts("a fortnight ago", "2026-07-12");
  accepts("2 months ago", "2026-05-26");
  accepts("last month on the 12th", "2026-06-12");
  accepts("12 of last month", "2026-06-12");
  accepts("the 12th", "2026-07-12"); // most recent 12th — this month, already passed
  accepts("the 30th", "2026-06-30"); // the 30th hasn't happened this month → last month

  // ═══════════════════════════════════════════════════════════════════════════
  section("5 · Weekdays (today = Sunday 26 July 2026)");
  accepts("last Tuesday", "2026-07-21");
  accepts("Tuesday", "2026-07-21"); // bare weekday → most recent past
  accepts("tues", "2026-07-21");
  accepts("last Monday", "2026-07-20");
  accepts("last to last Monday", "2026-07-13"); // Indian English
  accepts("this Friday", "2026-07-24"); // inside the current Mon-start week, already passed
  accepts("last Sunday", "2026-07-19"); // today is Sunday → the PREVIOUS one, never today
  {
    const r = res("Tuesday");
    ok("★ a bare weekday reports the most-recent-past assumption", r.ok && /most recent tuesday/i.test(r.assumption ?? ""), r.ok ? r.assumption : "");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("6 · ★ REFUSALS — spans, with usable bounds");
  refuses("last week", ["2026-07-13", "2026-07-19"]); // ★ the phrase that started all of this
  refuses("this week", ["2026-07-20", "2026-07-26"]);
  refuses("last to last week", ["2026-07-06", "2026-07-12"]);
  refuses("a few days ago", ["2026-07-20", "2026-07-24"]);
  refuses("couple of days back", ["2026-07-20", "2026-07-24"]);
  refuses("some days back");
  refuses("recently");
  refuses("a while back");
  refuses("the other day");
  refuses("earlier this month", ["2026-07-01", "2026-07-26"]);
  refuses("last month", ["2026-06-01", "2026-06-30"]);
  refuses("this month", ["2026-07-01", "2026-07-26"]);
  refuses("sometime in March", ["2026-03-01", "2026-03-31"]);
  refuses("in March");
  refuses("March");
  refuses("2025", ["2025-01-01", "2025-12-31"]);
  refuses("mid-July");
  refuses("end of March");
  refuses("beginning of the month");
  refuses("around 20 July");
  refuses("a few weeks ago");
  refuses("last few days");
  refuses("since Monday");
  refuses("between 10 and 15 July");
  refuses("gibberish");
  {
    const r = res("last week") as any;
    console.log(`     bounded question the model gets: "last week covers ${boundsPhrase(r.bounds)} — which day?"`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("7 · Never the future");
  {
    const r = res("2026-12-25");
    ok("an explicit future date is refused", !r.ok, r.ok ? `resolved ${r.date}` : r.reason);
    const r2 = resolvePhrase("this Friday", new Date("2026-07-20T04:00:00Z")); // Monday → Friday is ahead
    ok("★ 'this Friday' on a Monday is refused as not-yet-happened", !r2.ok, r2.ok ? `resolved ${r2.date}` : r2.reason);
    const r3 = res("20 December");
    ok("a bare day+month never resolves forward", r3.ok && r3.date <= istToday(NOW));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("8 · howLongAgo");
  ok("6 days ago", howLongAgo("2026-07-20", "2026-07-26") === "6 days ago", howLongAgo("2026-07-20", "2026-07-26"));
  ok("yesterday", howLongAgo("2026-07-25", "2026-07-26") === "yesterday");
  ok("★ 17 months ago (the fabricated date's real age)", howLongAgo("2025-02-26", "2026-07-26") === "17 months ago", howLongAgo("2025-02-26", "2026-07-26"));

  // ═══════════════════════════════════════════════════════════════════════════
  section("9 · Scanning the reader's own message");
  {
    const scan = (t: string) => [...datesMentionedIn(t, NOW)].sort().join(",");
    ok("\"I bought 10 ACC at 1850 yesterday\" names 2026-07-25", scan("I bought 10 ACC at 1850 yesterday") === "2026-07-25", scan("I bought 10 ACC at 1850 yesterday"));
    ok("\"...on 12 March 2025\" names 2025-03-12", scan("I bought 5 ABB at 4000 on 12 March 2025") === "2025-03-12", scan("I bought 5 ABB at 4000 on 12 March 2025"));
    ok("\"...on 20 July\" names 2026-07-20", scan("I bought 10 TCS at 3500 on 20 July") === "2026-07-20", scan("I bought 10 TCS at 3500 on 20 July"));
    ok("\"...last Tuesday\" names 2026-07-21", scan("bought it last Tuesday") === "2026-07-21", scan("bought it last Tuesday"));
    ok("★ \"...last week\" names NOTHING", scan("I added 20 TCS at 3500 last week") === "", `got "${scan("I added 20 TCS at 3500 last week")}"`);
    ok("★ \"some TCS last week\" names NOTHING", scan("I bought some TCS last week") === "");
    ok("\"12/03/2025\" names 2025-03-12 (day-first)", scan("bought on 12/03/2025") === "2025-03-12", scan("bought on 12/03/2025"));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("10 · ★ THE GUARD — attestTradeDate");
  {
    const ctx = (msg?: string) => makeToolContext({ userId: "u", sessionId: "s", ...(msg !== undefined ? { userMessage: msg } : {}) });

    // 1. The reader named it outright.
    ok("accepts a date the reader wrote exactly", (await attestTradeDate("2025-03-12", ctx("I bought 5 ABB at 4000 on 12 March 2025"))).ok);
    // 2. The reader named it RELATIVELY; the SERVER resolved their words. Uses the real clock (the guard
    //    always does), so the expected date is computed the same way rather than hard-coded.
    const c2 = ctx("I bought 10 ACC at 1850 yesterday");
    const yday = [...datesMentionedIn("I bought 10 ACC at 1850 yesterday")][0];
    ok("★ accepts a relative date the reader used, resolved server-side", !!yday && (await attestTradeDate(yday, c2)).ok, `"yesterday" → ${yday}`);
    ok("★★ but REFUSES a different date on the same message (a model that got 'yesterday' wrong)",
      !(await attestTradeDate("2020-01-01", c2)).ok);

    // 3. resolveDate produced it this turn.
    const c3 = ctx("I added 20 TCS at 3500 last week");
    c3.resolvedDates.add("2026-07-21");
    ok("★ accepts a date resolveDate produced this turn", (await attestTradeDate("2026-07-21", c3)).ok);

    // 4. ★ THE FABRICATION — the exact failure the live run produced.
    const c4 = ctx("I bought 10 TCS at 3500 last week");
    const bad = await attestTradeDate("2025-02-26", c4);
    ok("★★ REFUSES the model's invented date (the live 2025-02-26 case)", !bad.ok);
    if (!bad.ok) console.log(`     → ${bad.error.slice(0, 150)}…`);

    // 5. A date the reader did not say, when they DID say another one — the error names the right one.
    const c5 = ctx("I bought 10 ACC at 1850 on 20 July");
    const wrong = await attestTradeDate("2025-07-20", c5);
    ok("★★ REFUSES last year's 20 July when the reader meant this year's", !wrong.ok);
    if (!wrong.ok) ok("   …and the error points at the date the reader DID name", /2026-07-20/.test(wrong.error), wrong.error.slice(0, 120));

    // 6. No message at all ⇒ resolveDate is the only way in.
    const c6 = ctx();
    ok("with no reader message, an unresolved date is refused", !(await attestTradeDate("2026-07-20", c6)).ok);
    c6.resolvedDates.add("2026-07-20");
    ok("…and the same date passes once resolveDate produced it", (await attestTradeDate("2026-07-20", c6)).ok);

    // 7. Provenance does NOT leak between turns (a fresh context is a fresh set).
    const c7 = ctx("anything");
    ok("★ a new turn's context starts with no resolved dates", c7.resolvedDates.size === 0);
  }

  console.log(`\n${failures === 0 ? "═══ ALL DATE-RESOLVER CHECKS PASSED ✅ ═══" : `═══ ${failures} FAILURE(S) ❌ ═══`}`);
  if (failures) process.exitCode = 1;
}

await main();
