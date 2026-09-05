// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BROWSER HELPERS — sign in, ask, wait. Shared by every gate that drives a real page.
//
// ★ ONE COPY, BECAUSE THE WAITING IS THE HARD PART AND IT WAS ALREADY GOT WRONG ONCE. `ask()` below
//   waits for the composer to be USABLE and then for the transcript to GROW. The first version of
//   the browser gate waited on `networkidle` instead, and since the composer is disabled while a
//   reply generates, the second question of a run went into a disabled textarea, sent nothing, and
//   the gate asserted against the previous turn — reporting a missing control that had never been
//   asked for. A second copy of that logic is a second chance to make the same mistake.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Browser, Page } from "playwright";

export const APP = process.env.HARNESS_APP_URL ?? "http://localhost:3000";
export const API = process.env.HARNESS_API_URL ?? "http://localhost:4000";
export const EMAIL = process.env.TEST_EMAIL ?? "";
export const PASSWORD = process.env.TEST_PASSWORD ?? "";

/** The three widths this product is read at. Named, because "mobile" is an argument, 390 is a fact. */
export const VIEWPORTS = [
  { name: "sidekick panel", width: 1440, height: 900, panel: true },
  { name: "mobile", width: 390, height: 844, panel: false },
  { name: "full width", width: 1440, height: 900, panel: false },
] as const;

export async function reachable(url: string): Promise<boolean> {
  try { await fetch(url); return true; } catch { return false; }
}

export async function signIn(page: Page): Promise<boolean> {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const pw = page.locator('input[type="password"], input[name="password"]').first();
  // ⚠ WAIT FOR THE FORM, NOT A FIXED DELAY. On a cold dev server the first request to a route
  //   compiles it; without this the click lands on nothing and the gate blames the credentials.
  await email.waitFor({ state: "visible", timeout: 120_000 }).catch(() => {});
  if (!(await email.count()) || !(await pw.count())) return false;
  await email.fill(EMAIL);
  await pw.fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  // WHERE it lands is the app's business — a new account goes to /onboarding, a returning one to
  // /dashboard. This only cares that the session exists.
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 120_000 }).catch(() => {});
  return !page.url().includes("/login");
}

/** Open the chat surface and wait for a usable composer. Returns false if it never appears. */
export async function openChat(page: Page): Promise<boolean> {
  await page.goto(`${APP}/chat`, { waitUntil: "domcontentloaded" });
  const box = page.locator("textarea").first();
  await box.waitFor({ state: "visible", timeout: 120_000 }).catch(() => {});
  return (await page.locator("textarea").count()) > 0 && (await box.isVisible().catch(() => false));
}

/**
 * Send one question and wait for the answer to LAND — not for the network to go quiet.
 *
 * Returns false when nothing arrived, so a caller can report "I did not manage to ask" rather than
 * asserting against whatever was already on screen.
 */
export async function ask(page: Page, question: string): Promise<boolean> {
  const box = page.locator("textarea").last();
  await box.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
    undefined, { timeout: 180_000 },
  ).catch(() => {});
  const before = (await page.locator("body").innerText()).length;
  await box.fill(question);
  await box.press("Enter");
  await page.waitForFunction(
    (n) => document.body.innerText.length > n + 120
      && Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
    before, { timeout: 180_000 },
  ).catch(() => {});
  return (await page.locator("body").innerText()).length > before + 120;
}

/**
 * ★ WAIT FOR THE PROGRESSIVE REVEAL TO FINISH — not for a fixed time.
 *
 * `data-answer-revealing` is "1" while the reveal clock is running. Polling it is how the harness
 * distinguishes "the loader is still legitimately on screen" from "the loader never resolved", which
 * is the whole point of the loader assertions.
 */
export async function settled(page: Page, timeout = 90_000): Promise<boolean> {
  return page.waitForFunction(
    () => {
      const els = Array.from(document.querySelectorAll("[data-answer-revealing]"));
      return els.length > 0 && els.every((e) => e.getAttribute("data-answer-revealing") === "0");
    },
    undefined, { timeout },
  ).then(() => true).catch(() => false);
}

/** Open the sidekick panel, if this surface has one. Returns whether it opened. */
export async function openSidekick(page: Page): Promise<boolean> {
  // The rail is opened from any page that carries it; the trigger is labelled for assistive tech.
  const trigger = page.locator(
    '[aria-label*="Vytal" i][aria-label*="ask" i], [data-sidekick-toggle], button[aria-label*="sidekick" i]',
  ).first();
  if ((await trigger.count()) === 0) return false;
  await trigger.click().catch(() => {});
  await page.waitForTimeout(1200);
  return (await page.locator("textarea").count()) > 0;
}

export async function newPage(browser: Browser, w: number, h: number): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    // ⚠ PINNED, NOT INHERITED. Under `reduce` the product renders every answer at once by design, so
    //   a harness that let the host decide could assert progressive render on a machine where it is
    //   correctly switched off — and pass, having tested nothing.
    reducedMotion: "no-preference",
  });
  return ctx.newPage();
}
