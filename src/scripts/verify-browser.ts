// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LAYER 3 — THE BROWSER. A real signed-in session, a real DOM, real clicks.
//
// ── ★ WHAT ONLY THIS LAYER CAN PROVE ──────────────────────────────────────────────────────────────
// Stage 8b offered an HTTP trace and the Operator correctly refused to call it a browser trace. The
// difference is not ceremony. Three of the ten defects are invisible to every other layer:
//
//   · TRANSPORT — `fetch` on a relative path with cookies against a Bearer-token API on another
//     origin. The source scan (C1) proves the call goes THROUGH `apiFetch`; only a real browser
//     proves the request arrives authenticated and comes back 2xx.
//   · DEAD CONTROLS — C2 proves a `<button>` has an `onClick`. Only a click proves the handler is
//     bound to something that happens.
//   · THE RENDERED SENTENCE — "nothing filed with us for  yet" was correct in the payload and wrong
//     on screen. The text a reader sees is a DOM fact.
//
// And one thing nothing else can see at all: whether text fits its container.
//
// ── ★ IT REUSES THE SAME INVARIANTS ───────────────────────────────────────────────────────────────
// `iInterpolation` and the placeholder vocabulary are imported, not re-expressed. A browser gate with
// its own private idea of "what a placeholder looks like" would drift from the payload gate, and the
// one that drifted would be the one that stopped catching things (N-3, N-5).
//
// ── ★ WHAT IT COSTS AND WHY IT IS ON DEMAND ──────────────────────────────────────────────────────
// It needs a driver, a signed-in account, and BOTH servers running. That is a minute of setup and
// ~90 seconds of run, and it cannot be a precondition of every commit — which is exactly why layers
// 1 and 1b carry cheap versions of the same three checks. This is the evidence; those are the net.
//
// ⚠ IT WRITES ONCE, DELIBERATELY, AND CLEANS UP. Proving the action transport means actually firing a
//   watchlist add against the test account — a read-only proof of a write path is not a proof. The
//   pin is removed in a `finally`, and the account is the dummy one from env, never a real book.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iInterpolation, PLACEHOLDER_LABELS, NEVER_IN_READER_TEXT, type AnswerUnderTest } from "../harness/invariants.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const section = (s: string) => console.log(`\n══ ${s} ══`);

const APP = process.env.HARNESS_APP_URL ?? "http://localhost:3000";
const API = process.env.HARNESS_API_URL ?? "http://localhost:4000";
const EMAIL = process.env.TEST_EMAIL ?? "";
/** The browser's own anon key. It belongs to the frontend env, so it is read from there when the
 *  backend does not carry it — needed only by the cleanup path, never by the test itself. */
function anonKey(): string {
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    const env = readFileSync(join(process.cwd(), "..", "Vytal-Frontend", ".env"), "utf8");
    return /^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m.exec(env)?.[1]?.trim() ?? "";
  } catch { return ""; }
}

const PASSWORD = process.env.TEST_PASSWORD ?? "";

/**
 * A Supabase access token for the dummy account, so the gate can put the ACCOUNT into a known state
 * before it asserts anything about the UI.
 *
 * ⚠ THE §6 PROBE USED TO ASSUME TCS WAS UNPINNED, AND THAT ASSUMPTION SILENTLY BROKE THE GATE. Its
 *   cleanup only runs when the probe got as far as clicking, so any earlier failure left the pin
 *   behind — and stage 12 then taught the control to read the live watchlist and say "Already on your
 *   watchlist". The button's label changed, the label-based selector found nothing, and the gate
 *   reported "no control found — UNEXERCISED". A probe that depends on leftover state from its own
 *   previous run is not a probe; it is a coin toss with a history.
 */
async function bearer(): Promise<string | null> {
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey() },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }).then((x) => x.json() as Promise<{ access_token?: string }>);
    return r.access_token ?? null;
  } catch { return null; }
}

/** Remove a symbol from the account's watchlist, whatever state it is in. Returns what it did. */
async function unpin(symbol: string): Promise<"removed" | "was-absent" | "failed"> {
  const tok = await bearer();
  if (!tok) return "failed";
  try {
    const list = await fetch(`${API}/api/v1/me/watchlist`, { headers: { Authorization: `Bearer ${tok}` } })
      .then((r) => r.json() as Promise<{ data?: { watchlist?: { stockId: string; symbol: string }[] } }>);
    const hit = (list.data?.watchlist ?? []).find((w) => w.symbol === symbol);
    if (!hit) return "was-absent";
    const del = await fetch(`${API}/api/v1/me/watchlist/${hit.stockId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${tok}` },
    });
    return del.ok ? "removed" : "failed";
  } catch { return "failed"; }
}

/** Every API request the page made, so the transport can be asserted rather than inferred. */
interface Seen { url: string; method: string; status: number; auth: boolean }

async function reachable(url: string): Promise<boolean> {
  try { await fetch(url, { method: "GET" }); return true; } catch { return false; }
}

async function signIn(page: Page): Promise<boolean> {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const pw = page.locator('input[type="password"], input[name="password"]').first();
  // ⚠ WAIT FOR THE FORM, NOT A FIXED DELAY. On a cold dev server the first request to a route
  //   compiles it, and the first run of this gate failed on exactly that: the fields were not yet
  //   attached, the click went nowhere, and it reported "check the credentials" about credentials
  //   that were fine. A gate that misdiagnoses its own environment sends people the wrong way.
  await email.waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
  if (!(await email.count()) || !(await pw.count())) return false;
  await email.fill(EMAIL);
  await pw.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  // The session has landed once the app navigates anywhere off /login. WHERE it lands is the app's
  // business — a first-time account goes to /onboarding, a returning one to /dashboard, and this
  // gate has no opinion about which.
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 90_000 }).catch(() => {});
  return !page.url().includes("/login");
}

/**
 * Send one question in the chat composer and wait for the assistant turn to actually land.
 *
 * ⚠ THE FIRST VERSION WAITED ON `networkidle` AND SILENTLY SENT NOTHING. The composer is DISABLED
 *   while a reply is generating, so the second `fill()` of a run went into a disabled textarea, the
 *   Enter did nothing, and the gate then asserted against the PREVIOUS answer — reporting a missing
 *   action control that had never been asked for. A harness that cannot tell "the feature is broken"
 *   from "I did not press the button" is worse than no harness, because it is trusted.
 *
 * So: wait for the composer to be usable, then wait for the page to have grown. Both conditions are
 * about the product's own state rather than about the network.
 */
async function ask(page: Page, question: string): Promise<boolean> {
  const box = page.locator("textarea").last();
  await box.waitFor({ state: "visible", timeout: 60_000 });
  // The composer re-enables when the previous reply is done — that is the product's own "ready".
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
    undefined, { timeout: 120_000 },
  ).catch(() => {});
  const before = (await page.locator("body").innerText()).length;
  await box.fill(question);
  await box.press("Enter");
  // The answer has landed when the page has grown AND the composer is usable again.
  await page.waitForFunction(
    (n) => document.body.innerText.length > n + 120
      && Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
    before, { timeout: 120_000 },
  ).catch(() => {});
  // ★ AND THEN WAIT FOR THE ANSWER TO FINISH DRAWING, WHICH IS NOT THE SAME EVENT.
  //
  // ⚠ A FIXED 1200ms HERE STARTED REPORTING FEATURES AS MISSING THE MOMENT THE REVEAL SLOWED DOWN.
  //   The composer re-enables when the REPLY ARRIVES; the progressive reveal then walks the answer,
  //   and stage 12 roughly doubled the per-section beats on the Operator's report that the loaders
  //   were flickering past. A six-section answer now takes well over ten seconds to finish landing,
  //   and NEXT — the follow-up chips — is the LAST step of it. So this gate looked at a half-drawn
  //   answer and honestly reported "no chip found", "no action control found": UNEXERCISED, twice,
  //   for a product where both were about to appear.
  //
  //   `data-answer-revealing` is the component's own signal and the UX gate already waits on it. One
  //   contract, both gates — the alternative is two different guesses about when an answer is done.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("[data-answer-revealing]"))
      .every((el) => el.getAttribute("data-answer-revealing") === "0"),
    undefined, { timeout: 120_000 },
  ).catch(() => {});
  await page.waitForTimeout(600);
  return (await page.locator("body").innerText()).length > before + 120;
}

async function main() {
  console.log("★ LAYER 3 — THE BROWSER (real session · real DOM · real clicks)");
  console.log(`     app=${APP}  api=${API}  as=${EMAIL || "(TEST_EMAIL unset)"}`);

  // ── PRECONDITIONS. Every one of these is a hard fail, never a skip: a browser gate that reports
  //    green because it could not run is the orphaned-gate failure with a driver attached.
  section("0 · preconditions");
  ok("TEST_EMAIL and TEST_PASSWORD are set", Boolean(EMAIL && PASSWORD), EMAIL ? "present" : "MISSING — this gate cannot sign in");
  const appUp = await reachable(APP), apiUp = await reachable(`${API}/api/v1/health`);
  ok("the app is reachable", appUp, appUp ? APP : `${APP} is not answering — start the frontend`);
  ok("the api is reachable", apiUp, apiUp ? API : `${API} is not answering — start the backend`);
  if (!EMAIL || !PASSWORD || !appUp || !apiUp) {
    console.log(`\n❌ FAILED — preconditions unmet; NOTHING below was tested.`);
    process.exit(1);
  }

  let browser: Browser | null = null;
  let pinnedStockId: string | null = null;
  try {
    browser = await chromium.launch({ headless: process.env.HARNESS_HEADED !== "1" });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    const seen: Seen[] = [];
    page.on("response", (r) => {
      const u = r.url();
      if (!u.includes("/api/v1/")) return;
      seen.push({
        url: u.replace(API, ""), method: r.request().method(), status: r.status(),
        auth: Boolean(r.request().headers()["authorization"]),
      });
    });

    section("1 · a real signed-in session");
    const signedIn = await signIn(page);
    ok("signed in with the test account", signedIn, signedIn ? `landed on ${new URL(page.url()).pathname}` : "still on /login — check the credentials");
    if (!signedIn) throw new Error("cannot continue without a session");

    section("2 · a question renders sections");
    await page.goto(`${APP}/chat`, { waitUntil: "domcontentloaded" });
    // Same reason as the login form: the composer has to exist before anything can be typed into it.
    await page.locator("textarea").first().waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
    ok("the chat page loaded with a composer", (await page.locator("textarea").count()) > 0,
      `at ${new URL(page.url()).pathname}`);
    const sent = await ask(page, "how is my portfolio doing");
    ok("the question was actually sent and answered", sent, sent ? "the transcript grew" : "nothing landed — the assertions below would be about the WRONG turn");

    const bodyText = (await page.locator("body").innerText()).replace(/ /g, " ");
    ok("the answer painted", bodyText.length > 400, `${bodyText.length} chars of visible text`);

    // ── §3 · THE RENDERED SENTENCE ────────────────────────────────────────────────────────────
    section("3 · the text a reader actually sees");
    // ★ THE SAME INVARIANT AS LAYER 1, OVER THE DOM. This is where defect 4 lived: the payload was
    //   right and the sentence was wrong, so only this side of the boundary can see it.
    const domAnswer: AnswerUnderTest = {
      label: "browser", question: "how is my portfolio doing", compositionId: "browser",
      sections: [], prose: { opening: bodyText.split("\n").filter((l) => l.trim().length > 12), leads: {}, after: {}, close: "" },
    };
    const gaps = iInterpolation(domAnswer);
    ok("I-INTERPOLATION · no empty slot in any visible sentence", gaps.length === 0, gaps.length ? `${gaps.length} gaps` : "clean");
    for (const g of gaps.slice(0, 6)) console.log(`     ✗ ${g.detail}`);

    const badToken = NEVER_IN_READER_TEXT.find((t) => t.pattern.test(bodyText));
    ok("no corrupted value in visible text", !badToken, badToken ? `found ${badToken.name}` : "clean");

    // A whole line that is nothing but a placeholder word — the `Finding / Finding` shape, on screen.
    const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
    const placeholderLines = lines.filter((l) => PLACEHOLDER_LABELS.includes(l.toLowerCase()));
    ok("no line of the answer is a bare placeholder", placeholderLines.length === 0,
      placeholderLines.length ? `${placeholderLines.length}: ${[...new Set(placeholderLines)].join(", ")}` : "clean");

    // ── §4 · LAYOUT ───────────────────────────────────────────────────────────────────────────
    section("4 · text fits its container");
    // ⚠ THE ONE CHECK NO OTHER LAYER CAN MAKE AT ALL, and the reason it is not screenshot diffing:
    //   this fires on a real overflow and stays silent on a legitimate copy change.
    const overflow = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll("main *"))) {
        const e = el as HTMLElement;
        if (!e.innerText || e.children.length > 0) continue;
        const style = getComputedStyle(e);
        if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
        if (style.textOverflow === "ellipsis" || style.whiteSpace === "nowrap") continue;
        if (e.scrollWidth > e.clientWidth + 2) bad.push(`${e.tagName.toLowerCase()}: "${e.innerText.slice(0, 60)}"`);
      }
      return bad.slice(0, 8);
    });
    ok("no visible text overflows its box", overflow.length === 0, overflow.length ? `${overflow.length} overflowing` : "clean");
    for (const o of overflow) console.log(`     ✗ ${o}`);

    // ── §5 · DEAD CONTROLS, FOR REAL ──────────────────────────────────────────────────────────
    section("5 · a chip is pressed and something happens");
    const turnsBefore = (await page.locator("body").innerText()).length;
    // ⚠ `/\?$/` MATCHED NOTHING. A chip renders its question AND the surface name beneath it, so its
    //   innerText is "What is on my watchlist?\nWatchlist" — the "?" is never last. The sidebar's
    //   conversation titles carry no question mark, so containment alone is enough to tell them apart.
    // ⚠ AND THEN THIS ONE WENT TO ZERO AT STAGE 12, when the chips moved back inside the answer. A
    //   selector built from what the copy happens to look like breaks every time the copy moves;
    //   `data-conversation-chips` is the component's stated contract, and the UX gate reads the same
    //   one, so the two gates cannot disagree about what a chip is.
    const chip = page.locator("[data-conversation-chips] button").first();
    const chipCount = await chip.count();
    if (chipCount === 0) {
      ok("a follow-up chip is offered", false, "no chip found — the dead-control check is UNEXERCISED, not satisfied");
    } else {
      const chipText = (await chip.innerText()).split("\n")[0]!;
      await chip.click();
      await page.waitForFunction(
        (n) => document.body.innerText.length > n + 120,
        turnsBefore, { timeout: 120_000 },
      ).catch(() => {});
      await page.waitForTimeout(1500);
      const turnsAfter = (await page.locator("body").innerText()).length;
      // ★ THE CLICK MUST CHANGE THE PAGE. `C2` proves a handler exists; this proves it does something.
      ok("C2-live · pressing a chip produces a new turn", turnsAfter > turnsBefore + 120,
        `"${chipText.slice(0, 60)}" → transcript ${turnsBefore} → ${turnsAfter} chars`);
    }

    // ── §6 · TRANSPORT, FOR REAL ──────────────────────────────────────────────────────────────
    section("6 · an action control fires an authenticated request");
    // ★ THE ACCOUNT IS PUT INTO A KNOWN STATE FIRST. See `unpin` — the probe used to inherit whatever
    //   the last run left behind, and once the control learned to read the live watchlist that
    //   leftover pin turned the whole section into "UNEXERCISED".
    const cleared = await unpin("TCS");
    ok("the account starts unpinned", cleared !== "failed", `TCS: ${cleared}`);
    const askedAction = await ask(page, "add TCS to my watchlist");
    ok("the action question was sent and answered", askedAction, askedAction ? "the transcript grew" : "nothing landed");
    // ⚠ ADDRESSED BY `data-action-state`, NOT BY THE BUTTON'S WORDS. The label is now one of four
    //   ("Add to watchlist", "Checking…", "Already on your watchlist", "Done") and a gate keyed to one
    //   of them reports the feature missing whenever the product is in one of the other three.
    const control = page.locator("[data-action-state]").last();
    if (await control.count() === 0) {
      ok("an action control rendered", false, "no control found — the transport check is UNEXERCISED, not satisfied");
    } else {
      // The live-state read resolves within a frame or two of the watchlist query landing.
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll("[data-action-state]"));
          const el = els[els.length - 1];
          return !!el && el.getAttribute("data-action-state") !== "checking";
        }, undefined, { timeout: 20_000 },
      ).catch(() => {});
      const armedState = await control.getAttribute("data-action-state");
      // ★ T-1 finding 4 · CAPTURE THE ARMED APPEARANCE, to compare with the post-write one below.
      //   The label already changed; what did not was how the control LOOKED, so a reader who had
      //   just changed their own data saw a button identical to the one that had not.
      const paintOf = (loc: typeof control) => loc.evaluate((el) => {
        const c = getComputedStyle(el as Element);
        return `${c.backgroundColor}|${c.borderColor}|${c.color}`;
      });
      const armedPaint = await paintOf(control);
      // ★ THE FIRST HALF OF THE STAGE-12 DEFECT: on a stock the reader does NOT hold, the control
      //   must be armed. If this says "already", the account state is wrong and everything below is
      //   measuring the wrong thing.
      ok("the control is armed for a stock that is not pinned", armedState === "ready", `state=${armedState}`);
      const before = seen.length;
      await control.click();
      await page.waitForTimeout(3500);
      const writes = seen.slice(before).filter((r) => r.method === "POST" || r.method === "DELETE");
      const wl = writes.filter((r) => r.url.includes("/me/watchlist"));
      // ⚠ ALL THREE HALVES MATTER. It must reach the API ORIGIN (not the Next server), carry an
      //   Authorization header (not cookies), and come back 2xx. The shipped defect failed the first
      //   two and would have been invisible to any check that only asserted "a request was made".
      ok("C1-live · the request reached the API origin", wl.length > 0,
        wl.length ? `${wl.map((r) => `${r.method} ${r.url}`).join(", ")}` : `no watchlist write observed (${writes.length} writes seen)`);
      ok("C1-live · it carried an Authorization header", wl.length > 0 && wl.every((r) => r.auth),
        wl.length ? `auth=${wl.map((r) => r.auth).join(",")}` : "no request to inspect");
      ok("C1-live · and the API accepted it", wl.length > 0 && wl.every((r) => r.status >= 200 && r.status < 300),
        wl.length ? `status=${wl.map((r) => r.status).join(",")}` : "no request to inspect");
      if (wl.some((r) => r.status >= 200 && r.status < 300)) pinnedStockId = "written";

      // ── ★ AND THE OTHER HALF, WHICH IS THE DEFECT THE OPERATOR ACTUALLY REPORTED ─────────────
      //
      // ⚠ "I REFRESHED AND THE BUTTON STATE WAS RESET — IT LET ME ADD THE SAME STOCK AGAIN." The
      //   control's "done" lived in React state and nothing else, so a replayed transcript redrew a
      //   fresh, armed button over a change that had already happened. Only a RELOAD can see this:
      //   before the reload the component remembers its own click, and every check passes.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll("[data-action-state]"));
          const el = els[els.length - 1];
          return !!el && el.getAttribute("data-action-state") !== "checking";
        }, undefined, { timeout: 30_000 },
      ).catch(() => {});
      const replayed = page.locator("[data-action-state]").last();
      const replayedState = (await replayed.count()) ? await replayed.getAttribute("data-action-state") : null;
      ok("the replayed control reports the change already happened", replayedState === "already",
        replayedState === null ? "no control after reload" : `state=${replayedState}`);
      ok("and it is not offering to do it again", (await replayed.count()) > 0 && await replayed.isDisabled(),
        replayedState === "already" ? "disabled" : `state=${replayedState}`);

      // ★ T-1 finding 4 · AND IT MUST LOOK DIFFERENT, NOT ONLY READ DIFFERENTLY.
      //   Before this, every non-ready state rendered through one class string whose only
      //   state-dependent rule was `disabled:opacity-50` — so "Already on your watchlist" was the
      //   same grey rectangle as the armed control. A state carried by the label alone is a state a
      //   reader scanning the card does not see.
      if ((await replayed.count()) > 0) {
        const unavailablePaint = await paintOf(replayed);
        ok("the unavailable control is visually distinct from the armed one",
          unavailablePaint !== armedPaint,
          `armed ${armedPaint}  vs  already ${unavailablePaint}`);
      }
    }

    // ── §7 · PERSISTENCE ──────────────────────────────────────────────────────────────────────
    section("7 · reopening replays the same answer");
    const url = page.url();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const after = (await page.locator("body").innerText()).replace(/ /g, " ");
    ok("the conversation survives a reload", after.length > 400 && page.url() === url,
      `${after.length} chars back after reload`);
    // The same DOM invariants, on the REPLAYED answer — a replay is a second renderer path in
    // practice even when it is the same component, and stage 8b's whole point was that it must match.
    const replayGaps = iInterpolation({ ...domAnswer, label: "browser · replay", prose: { opening: after.split("\n").filter((l) => l.trim().length > 12), leads: {}, after: {}, close: "" } });
    ok("the replayed answer is as clean as the live one", replayGaps.length === 0,
      replayGaps.length ? `${replayGaps.length} gaps on replay` : "clean");

    // ── §8 · THE CACHED TRANSCRIPT ────────────────────────────────────────────────────────────
    //
    // ★ TWO REPORTS, ONE MECHANISM, AND THEY POINTED IN OPPOSITE DIRECTIONS:
    //
    //     "each time I open a conversation it loads the history again"     — no caching
    //     "the history was incomplete, it stopped at the action turn"      — stale caching
    //
    //   Both came from the same decision. The first fix put the transcript in TanStack and then
    //   DROPPED the entry after every reply, on the reasoning that stale is worse than cold — so it
    //   was never warm; and the branches that adopted the server transcript returned before reaching
    //   the drop, so sometimes it was stale as well. The server hands back the whole durable
    //   transcript on every write, so the cache is now WRITTEN THROUGH: warm and correct together.
    //
    // ⚠ THE SWITCH MUST BE A CLIENT-SIDE NAVIGATION. `page.goto` remounts the app and takes the
    //   QueryClient with it, so a probe built on it would show a refetch every time and "prove" the
    //   feature broken however well it worked.
    section("8 · reopening a conversation does not refetch it");
    {
      // ⚠ THE SESSION IS A QUERY PARAM, NOT A PATH SEGMENT. `/chat?session=<id>` — taking the last
      //   path segment yields the literal string "chat", which then matches no row and reported
      //   "row not found" about a conversation that was right there in the list.
      const id = new URL(page.url()).searchParams.get("session") ?? "";
      const isDetailGet = (r: Seen) => r.method === "GET" && r.url.includes(`/chat/sessions/${id}`);
      const textBefore = (await page.locator("body").innerText()).length;

      // ⚠ ANOTHER CONVERSATION IN THE LIST, NOT THE "NEW CHAT" BUTTON. That control is icon-only with
      //   its label on a `title` attribute, so addressing it by text found nothing — and a blank
      //   conversation is a weaker place to leave to anyway, because it fetches no transcript of its
      //   own and so proves less about what the client does when it comes back.
      const others = await page.evaluate((self: string) =>
        Array.from(document.querySelectorAll("[data-session-id]"))
          .map((el) => el.getAttribute("data-session-id") ?? "")
          .filter((x) => x && x !== self), id);
      const switched = others.length > 0 && Boolean(id);
      ok("there is another conversation to leave to", switched,
        switched ? `${others.length} other conversation(s) in the list` : "only one conversation — the probe is UNEXERCISED");
      if (switched) {
        await page.locator(`[data-session-id="${others[0]}"]`).first().click();
        await page.waitForTimeout(2500);
        const mark = seen.length;
        // …and back, by clicking the row rather than by re-entering the URL.
        const row = page.locator(`[data-session-id="${id}"]`).first();
        const canReturn = (await row.count()) > 0;
        ok("the conversation is in the list to return to", canReturn, canReturn ? id.slice(0, 8) : "row not found");
        if (canReturn) {
          await row.click();
          await page.waitForTimeout(2500);
          const refetches = seen.slice(mark).filter(isDetailGet);
          ok("no refetch on return — the transcript came from cache", refetches.length === 0,
            refetches.length === 0 ? "0 GETs for this session" : `${refetches.length} refetch(es)`);
          const textAfter = (await page.locator("body").innerText()).length;
          // ★ AND IT IS THE WHOLE CONVERSATION. A cache that is warm and SHORT is the second report.
          ok("and the whole conversation came back", textAfter > textBefore * 0.8,
            `${textBefore} → ${textAfter} chars`);
          const hasControl = (await page.locator("[data-action-state]").count()) > 0;
          ok("including the newest turn, which was the action", hasControl,
            hasControl ? "the action control is back" : "the newest turn is missing — the cached copy is stale");
        }
      }
    }

    console.log(`\n     API calls observed: ${seen.length} · authenticated: ${seen.filter((r) => r.auth).length} · non-2xx: ${seen.filter((r) => r.status >= 300).length}`);
    const unauth = seen.filter((r) => !r.auth && r.status >= 400);
    if (unauth.length) for (const r of unauth.slice(0, 5)) console.log(`     ⚠ ${r.method} ${r.url} → ${r.status} with no Authorization header`);
  } finally {
    // ⚠ THE WRITE IS UNDONE, ALWAYS. The account is the dummy from env, and it is left as found.
    if (pinnedStockId) {
      try {
        const tok = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anonKey() },
          body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        }).then((r) => r.json() as Promise<{ access_token?: string }>);
        const list = await fetch(`${API}/api/v1/me/watchlist`, { headers: { Authorization: `Bearer ${tok.access_token}` } })
          .then((r) => r.json() as Promise<{ data?: { watchlist?: { stockId: string; symbol: string }[] } }>);
        for (const w of list.data?.watchlist ?? []) {
          if (w.symbol === "TCS") {
            const del = await fetch(`${API}/api/v1/me/watchlist/${w.stockId}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok.access_token}` } });
            console.log(`\n     cleanup: removed the test pin (${w.symbol}) → HTTP ${del.status}`);
          }
        }
      } catch (e) { console.log(`\n     ⚠ cleanup failed: ${(e as Error).message.slice(0, 120)} — remove the TCS pin from ${EMAIL} by hand`); }
    }
    await browser?.close();
  }

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
