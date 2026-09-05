// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LAYER 3b — THE UX GATE. Real browser, real session, three viewports.
//
// ── ★ WHAT IT EXISTS TO CATCH ─────────────────────────────────────────────────────────────────────
// Stage 10 named layout beyond overflow as a gap it could not see, and stage 11 is largely layout.
// These are the four failures the new work can actually produce:
//
//   U1  a loader that never resolves        — the vanishing component in a new costume
//   U2  a chart with no axis labels         — the defect the Operator reported, made assertable
//   U3  an answer that overflows its column — the sidekick panel, where `sm:` was lying about width
//   U4  chips that do not change per turn   — follow-ups that are not conversational
//   U6  chips outside the answer they follow — a toolbar where an answer's closing beat belongs
//   U5  the reader is dragged back down     — auto-scroll fighting a reader who scrolled up
//
// ── ★ WHY THESE ARE DOM ASSERTIONS AND NOT SCREENSHOTS ────────────────────────────────────────────
// A screenshot diff would flag every legitimate copy change and catch none of these four: a chart
// with no axis is pixel-stable, and so is a stale chip. Each assertion below names a property that is
// either true or false about the rendered page, and stays true when the words change.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import {
  APP, API, EMAIL, PASSWORD, ask, newPage, openChat, reachable, settled, signIn,
} from "../harness/browser.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const section = (s: string) => console.log(`\n══ ${s} ══`);

/** A healthy subject and a thin one — the absent path is where a loader most easily becomes a lie. */
const HEALTHY = process.env.HARNESS_HEALTHY ?? "TCS";
// ★ THE SUBJECT WHOSE SCORE ACTUALLY MOVED — see `SUBJECTS.moved`. A flat series renders one
//   phase and no turn, so a spine proven only on TCS would never draw the marks U11 asserts.
const MOVED = process.env.HARNESS_MOVED ?? "INDUSINDBK";
const THIN = process.env.HARNESS_THIN ?? "MOLBIO";

/**
 * ★ THE PANEL WIDTH IS SIMULATED BY CONSTRAINING THE ANSWER'S OWN CONTAINER.
 *
 * The sections size themselves with `@container/answer` queries now, so what decides their layout is
 * the width of that box and nothing else. Clamping it to the panel's width reproduces the panel's
 * conditions exactly — and does so without depending on the rail's open/close affordance, which is a
 * different feature with its own failure modes. If the rail changes, this assertion still means what
 * it says.
 */
async function clampAnswers(page: Page, px: number | null): Promise<void> {
  await page.evaluate((w) => {
    const id = "harness-clamp";
    document.getElementById(id)?.remove();
    if (w === null) return;
    const st = document.createElement("style");
    st.id = id;
    st.textContent = `[data-answer-revealing]{max-width:${w}px !important;}`;
    document.head.appendChild(st);
  }, px);
  await page.waitForTimeout(400);
}

/** Every element whose own content is wider than its box — the overflow this stage can create. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll("[data-answer-revealing] *"))) {
      const e = el as HTMLElement;
      const s = getComputedStyle(e);
      // A box that declares itself scrollable is handling its own width on purpose.
      if (s.overflowX === "auto" || s.overflowX === "scroll") continue;
      if (s.textOverflow === "ellipsis") continue;
      // ⚠ AN `sr-only` ELEMENT IS CLIPPED TO 1px ON PURPOSE — its content is MEANT to be wider, and
      //   flagging it reports the accessibility affordance as a layout defect. The gate caught its
      //   own table caption on the first run.
      if (s.clipPath !== "none" || (e.clientWidth <= 1 && e.clientHeight <= 1)) continue;
      if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) {
        bad.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} ${e.scrollWidth}>${e.clientWidth}`);
      }
    }
    return [...new Set(bad)].slice(0, 8);
  });
}

/**
 * Every Recharts plot on the page, with what it states about its own dimensions.
 *
 * ★ SHARED BY THE LIVE CHECK AND ITS NEGATIVE CONTROL. A control that re-implemented "does this
 *   chart have ticks" would be proving that the CONTROL discriminates, which is not the question.
 */
/**
 * The follow-up sets as they stand.
 *
 * ⚠ REWRITTEN AT STAGE 12, AND THE OLD SHAPE WOULD NOW ASSERT THE WRONG PRODUCT. It read ONE bar via
 *   `document.querySelector` and asserted `count === 1`, because the chips were hoisted into a single
 *   strip above the composer. The Operator reversed that: a follow-up is the closing beat of the
 *   ANSWER it belongs to, so there is one set per answered turn, each inside its own answer, and the
 *   old assertion would fail on the correct behaviour and pass on the reverted one.
 */
async function chipsSnapshot(page: Page): Promise<{
  count: number; labels: string[];
  insideScroller: boolean; insideLastAnswer: boolean | null; hasLead: boolean; cursor: string | null;
}> {
  return page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll("[data-conversation-chips]")) as HTMLElement[];
    const bar = bars[bars.length - 1] ?? null;
    if (!bar) return { count: 0, labels: [], insideScroller: false, insideLastAnswer: null, hasLead: false, cursor: null };
    // ★ IS IT PART OF THE CONVERSATION, OR PINNED BESIDE IT? Walking up to the nearest scrolling
    //   ancestor is the difference between "the closing beat of an answer" and "a toolbar".
    let el: HTMLElement | null = bar, scroller: HTMLElement | null = null;
    while (el) {
      const st = getComputedStyle(el);
      if (st.overflowY === "auto" || st.overflowY === "scroll") { scroller = el; break; }
      el = el.parentElement;
    }
    // ★ AND IS IT INSIDE THE ANSWER, or merely after it? Containment is the whole claim: a set that
    //   sits beside the newest answer rather than within it is the toolbar again, one level down.
    const answers = Array.from(document.querySelectorAll("[data-answer-revealing]")) as HTMLElement[];
    const lastAnswer = answers[answers.length - 1] ?? null;
    const firstChip = bar.querySelector("button");
    return {
      count: bars.length,
      labels: Array.from(bar.querySelectorAll("button")).map((b) => (b as HTMLElement).innerText.trim()),
      insideScroller: Boolean(scroller),
      insideLastAnswer: lastAnswer ? lastAnswer.contains(bar) : null,
      // The lead sentence is what makes the set a continuation rather than a menu.
      hasLead: Array.from(bar.querySelectorAll("p")).some((x) => (x.textContent ?? "").trim().length > 20),
      cursor: firstChip ? getComputedStyle(firstChip).cursor : null,
    };
  });
}

/**
 * Did the follow-ups follow the conversation? Both halves must move: a NEW SET appeared, and its
 * chips are not the previous set's chips.
 *
 * ⚠ BOTH, NOT EITHER. A count that grew with identical labels is the previous answer's suggestions
 *   copied under a new one, which is precisely the staleness the per-answer placement is supposed to
 *   make impossible; different labels with no new set is one bar mutating in place, which is the
 *   toolbar behaviour it replaced.
 */
const chipsChanged = (
  a: { count: number; labels: string[] },
  b: { count: number; labels: string[] },
) => b.count > a.count && JSON.stringify(a.labels) !== JSON.stringify(b.labels);

async function chartAxes(page: Page): Promise<{ xTicks: number; yTicks: number; hasLabel: boolean }[]> {
  return page.evaluate(() => {
    const out: { xTicks: number; yTicks: number; hasLabel: boolean }[] = [];
    for (const svg of Array.from(document.querySelectorAll("svg.recharts-surface"))) {
      const fig = svg.closest("figure");
      out.push({
        xTicks: svg.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value").length,
        yTicks: svg.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value").length,
        hasLabel: Boolean(fig?.getAttribute("aria-label")?.trim()),
      });
    }
    return out;
  });
}

/**
 * ★ THE NEGATIVE CONTROLS — each of the four failures, injected, and the check made to fire.
 *
 * A gate that has never failed has not been tested. Stage 10 established this discipline and it
 * applies with more force here, because every assertion in this file is about the SHAPE of a page
 * rather than the value of a field: a selector that silently matches nothing reports green forever,
 * and looks exactly like a page that is correct.
 *
 * ⚠ THE PERTURBATIONS ARE DOM-LEVEL AND UNDONE IMMEDIATELY. Nothing here edits the product; each
 *   control injects a node or a style, re-runs the SAME predicate the live check uses, and removes
 *   it. If a control cannot make its check fire, the check does not guard what it claims to.
 */
async function selfTest(page: Page, ok: (n: string, c: boolean, d?: string) => void): Promise<void> {
  // ── U1 · a loader that never resolves ──────────────────────────────────────────────────────────
  await page.evaluate(() => {
    const host = document.querySelector("[data-answer-revealing]");
    const fake = document.createElement("div");
    fake.setAttribute("data-section-loader", "SERIES");
    fake.id = "ctl-loader";
    host?.appendChild(fake);
  });
  const stuck = await page.locator("[data-section-loader]").count();
  ok("control U1 · an unresolved loader is caught", stuck > 0, `${stuck} detected after injection`);
  await page.evaluate(() => document.getElementById("ctl-loader")?.remove());
  ok("control U1 · and the page is clean again", (await page.locator("[data-section-loader]").count()) === 0);

  // ── U2 · a chart with no axis labels ───────────────────────────────────────────────────────────
  const beforeAxes = await chartAxes(page);
  await page.evaluate(() => {
    document.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value")
      .forEach((n) => n.classList.add("ctl-hidden-tick"));
    document.querySelectorAll(".ctl-hidden-tick")
      .forEach((n) => n.classList.remove("recharts-cartesian-axis-tick-value"));
  });
  const afterAxes = await chartAxes(page);
  ok("control U2 · a chart stripped of X ticks is caught",
    beforeAxes.length > 0 && beforeAxes.every((c) => c.xTicks > 0) && afterAxes.some((c) => c.xTicks === 0),
    `${beforeAxes.map((c) => c.xTicks).join("/")} -> ${afterAxes.map((c) => c.xTicks).join("/")}`);
  await page.evaluate(() => {
    document.querySelectorAll(".ctl-hidden-tick").forEach((n) => {
      n.classList.add("recharts-cartesian-axis-tick-value");
      n.classList.remove("ctl-hidden-tick");
    });
  });

  // ── U3 · an answer that overflows its column ───────────────────────────────────────────────────
  const beforeOver = await overflowing(page);
  await page.evaluate(() => {
    const host = document.querySelector("[data-answer-revealing]") as HTMLElement | null;
    if (!host) return;
    const wide = document.createElement("div");
    wide.id = "ctl-wide";
    wide.style.cssText = "width:4000px;height:8px;";
    const box = document.createElement("div");
    box.id = "ctl-wide-box";
    box.style.cssText = "width:100%;overflow:visible;";
    box.appendChild(wide);
    host.appendChild(box);
  });
  await page.waitForTimeout(200);
  const afterOver = await overflowing(page);
  ok("control U3 · an overflowing element is caught",
    beforeOver.length === 0 && afterOver.length > 0,
    `${beforeOver.length} -> ${afterOver.length} (${afterOver[0] ?? ""})`);
  await page.evaluate(() => document.getElementById("ctl-wide-box")?.remove());

  // ── U4 · chips that do not change ──────────────────────────────────────────────────────────────
  // The live check compares two snapshots; the control proves that comparison discriminates rather
  // than always reporting "changed".
  // ⚠ TWO SNAPSHOTS TAKEN AT DIFFERENT TIMES WITH NO QUESTION BETWEEN THEM. The first draft compared
  //   a snapshot with ITSELF (`snap.turn === snap.turn`), which is a tautology and proves nothing
  //   about the predicate — it would have passed against a `chipsChanged` that always returned false.
  //   Re-reading the live DOM after a delay is the weakest perturbation that is still a real one.
  const s1 = await chipsSnapshot(page);
  await page.waitForTimeout(600);
  const s2 = await chipsSnapshot(page);
  ok("control U4 · a set that did NOT follow a new turn reports unchanged",
    s1.count > 0 && !chipsChanged(s1, s2),
    s1.count === 0
      ? "NO FOLLOW-UPS ON THE PAGE — the control is UNEXERCISED, not satisfied"
      : `${s1.count} set(s), ${s1.labels.length} chips both times`);
  // And the other direction: a fabricated new set must register as a change.
  const s3 = { count: s2.count + 1, labels: [...s2.labels, "a chip that was not there"] };
  ok("control U4 · a set that DID change is caught", chipsChanged(s2, s3),
    "one more set, and a different chip list");
  // ⚠ AND THE HALF-CHANGES MUST NOT COUNT — this is what stops `chipsChanged` degrading to "||".
  ok("control U4 · a new set with the PREVIOUS answer's chips is not a change",
    !chipsChanged(s2, { count: s2.count + 1, labels: s2.labels }), "same labels under a new set");
  ok("control U4 · relabelling in place is not a change",
    !chipsChanged(s2, { count: s2.count, labels: [...s2.labels, "x"] }), "no new set");
}

async function main() {
  console.log("★ LAYER 3b — THE UX GATE (real browser · three viewports)");
  console.log(`     app=${APP}  api=${API}  as=${EMAIL || "(TEST_EMAIL unset)"}`);

  section("0 · preconditions");
  ok("TEST_EMAIL and TEST_PASSWORD are set", Boolean(EMAIL && PASSWORD), EMAIL ? "present" : "MISSING");
  const appUp = await reachable(APP), apiUp = await reachable(`${API}/api/v1/health`);
  ok("the app is reachable", appUp, APP);
  ok("the api is reachable", apiUp, API);
  if (!EMAIL || !PASSWORD || !appUp || !apiUp) {
    console.log("\n❌ FAILED — preconditions unmet; NOTHING below was tested.");
    process.exit(1);
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: process.env.HARNESS_HEADED !== "1" });

    // ── U1 · THE LOADER RESOLVES ────────────────────────────────────────────────────────────────
    section("1 · the progressive reveal, and a loader that must resolve");
    const page = await newPage(browser, 1440, 900);
    ok("signed in", await signIn(page), EMAIL);
    ok("the chat page opened with a composer", await openChat(page));

    // BOTH SUBJECT PATHS. A thin subject's sections resolve ABSENT, which is the case where a loader
    // most easily becomes permanent — there is nothing to draw, so a naive implementation waits.
    for (const [role, subject] of [["healthy", HEALTHY], ["thin", THIN]] as const) {
      const sent = await ask(page, `how is ${subject} doing`);
      ok(`${role} · "${subject}" was asked and answered`, sent);
      if (!sent) continue;

      // Sample WHILE it reveals, so "progressive" is observed rather than assumed.
      const seen: number[] = [];
      let sawLoader = false;
      for (let i = 0; i < 40; i++) {
        const s = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("[data-answer-revealing]"));
          const last = els[els.length - 1];
          return { kids: last ? last.children.length : 0, loaders: document.querySelectorAll("[data-section-loader]").length };
        });
        seen.push(s.kids);
        if (s.loaders > 0) sawLoader = true;
        if (await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("[data-answer-revealing]"));
          return els.length > 0 && els.every((e) => e.getAttribute("data-answer-revealing") === "0");
        })) break;
        await page.waitForTimeout(250);
      }
      const distinct = new Set(seen).size;
      ok(`${role} · the answer rendered progressively`, distinct > 2,
        `child count took ${distinct} distinct values (${Math.min(...seen)} → ${Math.max(...seen)})`);
      ok(`${role} · a section loader was actually shown`, sawLoader,
        sawLoader ? "seen at the reveal frontier" : "never appeared — U1 is UNEXERCISED, not satisfied");

      // ★ THE ASSERTION THIS WHOLE ITEM TURNS ON.
      const done = await settled(page);
      ok(`${role} · the reveal finished`, done, done ? "every answer reports revealing=0" : "still revealing after 90s");
      const stuck = await page.locator("[data-section-loader]").count();
      ok(`${role} · U1 · no loader survived the reveal`, stuck === 0,
        stuck === 0 ? "0 loaders on a settled page" : `${stuck} still spinning — a loader that never resolves`);
    }

    // ── U2 · CHARTS HAVE AXES ───────────────────────────────────────────────────────────────────
    section("2 · every chart states its dimensions");
    await ask(page, `show me ten years of ${HEALTHY} history`);
    await settled(page);
    const charts = await chartAxes(page);
    const _unused = await page.evaluate(() => {
      // A Recharts plot is an <svg class="recharts-surface">; its ticks are .recharts-cartesian-axis-tick.
      const out: { xTicks: number; yTicks: number; hasLabel: boolean }[] = [];
      for (const svg of Array.from(document.querySelectorAll("svg.recharts-surface"))) {
        const fig = svg.closest("figure");
        out.push({
          xTicks: svg.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value").length,
          yTicks: svg.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value").length,
          hasLabel: Boolean(fig?.getAttribute("aria-label")?.trim()),
        });
      }
      return out;
    });
    void _unused;
    ok("at least one chart rendered", charts.length > 0,
      charts.length ? `${charts.length} plot(s)` : "no chart on screen — U2 is UNEXERCISED, not satisfied");
    if (charts.length) {
      const noX = charts.filter((c) => c.xTicks === 0).length;
      const noY = charts.filter((c) => c.yTicks === 0).length;
      const noLabel = charts.filter((c) => !c.hasLabel).length;
      ok("U2 · every chart has labelled X ticks", noX === 0, noX ? `${noX} without` : `${charts.map((c) => c.xTicks).join("/")} ticks`);
      ok("U2 · every chart has labelled Y ticks", noY === 0, noY ? `${noY} without` : `${charts.map((c) => c.yTicks).join("/")} ticks`);
      ok("U2 · every chart has a text alternative", noLabel === 0, noLabel ? `${noLabel} without aria-label` : "all labelled");
    }

    // ── U4 · A FOLLOW-UP SET PER ANSWER ─────────────────────────────────────────────────────────
    section("3 · the per-answer follow-ups");
    const before = await chipsSnapshot(page);
    ok("the newest answer carries follow-ups", before.labels.length > 0,
      before.labels.length ? `${before.labels.length} chips in ${before.count} set(s)` : "no set found");
    // ⚠ A DIFFERENT QUESTION, so a set that simply re-rendered the same list is not mistaken for one
    //   that followed the conversation.
    await ask(page, `who owns ${HEALTHY}`);
    await settled(page);
    const after = await chipsSnapshot(page);
    ok("U4 · a new set arrived with the new turn, carrying different chips", chipsChanged(before, after),
      `${before.count} → ${after.count} sets; ${before.labels.length} → ${after.labels.length} chips`);

    // ── U6 · IT IS PART OF THE ANSWER, NOT A BAR BESIDE IT ──────────────────────────────────────
    ok("U6 · the follow-ups scroll with the conversation", after.insideScroller,
      after.insideScroller ? "inside the transcript's scroller" : "pinned outside it — that is a toolbar, not an answer's tail");
    // ★ THE STRONGEST FORM OF THE CLAIM. Sitting BELOW the last answer is what the hoisted bar also
    //   did; sitting INSIDE it is what makes the set that answer's own closing beat.
    ok("U6 · they are inside the newest answer, not merely after it", after.insideLastAnswer === true,
      `insideLastAnswer=${after.insideLastAnswer}`);
    ok("U6 · every answered turn keeps its own set", after.count >= 2,
      `${after.count} sets down the conversation — one per answer, not one for the window`);
    ok("U6 · they carry a lead sentence, not just pills", after.hasLead,
      after.hasLead ? "the set says what it follows from" : "no lead — a row of bare questions is a menu");
    ok("U6 · the pills are pressable to the pointer", after.cursor === "pointer", `cursor: ${after.cursor}`);

    // ★ AND THEY ARE THE LAST THING IN THE ANSWER — not the last SECTION, the last THING.
    //
    // ⚠ THE CLOSE PARAGRAPH AND THE DEEP LINKS ARE PROSE STEPS RATHER THAN SECTIONS, so for one
    //   stage they rendered UNDERNEATH the follow-ups: a synthesis and a row of exits sitting below
    //   a row of questions. "Last section" and "last block" are not the same assertion, and only the
    //   second one is what was asked for.
    {
      const tail = await page.evaluate(() => {
        const answers = Array.from(document.querySelectorAll("[data-answer-revealing]"));
        const last = answers[answers.length - 1] as HTMLElement | undefined;
        if (!last) return null;
        // ⚠ NO NAMED ARROW IN HERE. esbuild (via tsx) wraps a function assigned to a const with its
        //   `__name` helper, and that helper does not exist inside the page — the evaluate throws
        //   `ReferenceError: __name is not defined` at runtime, which reads like a page bug and is a
        //   bundler artefact. Inline the predicate.
        const kids = Array.from(last.children) as HTMLElement[];
        const flags = kids.map((el) =>
          el.hasAttribute("data-conversation-chips") || el.querySelector("[data-conversation-chips]") !== null);
        return { idx: flags.lastIndexOf(true), total: kids.length - 1 };
      });
      ok("U6 · the follow-ups are the LAST block of the answer",
        tail !== null && tail.idx >= 0 && tail.idx === tail.total,
        tail === null ? "no answer to measure" : `block ${tail.idx} of ${tail.total}`);
    }

    // ★ AND A SET APPEARS ONLY WHEN THE ANSWER IT BELONGS TO HAS FINISHED ARRIVING. NEXT is the last
    //   step of the reveal, so mid-generation the count must still be the PREVIOUS count — the new
    //   answer has no closing beat yet, and the older sets stay where they are because they belong to
    //   answers that did finish.
    {
      const box = page.locator("textarea").last();
      await box.fill(`what has been flagged on ${HEALTHY}`);
      await box.press("Enter");
      await page.waitForTimeout(2200);
      const during = await page.locator("[data-conversation-chips]").count();
      ok("U6 · no new set while the reply is still arriving", during <= after.count,
        during <= after.count
          ? `${during} sets mid-generation (was ${after.count})`
          : `${during} sets — a closing beat under an answer that has not finished`);
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
        undefined, { timeout: 180_000 },
      ).catch(() => {});
      await settled(page);
      const back = await chipsSnapshot(page);
      ok("U6 · and one arrives once the answer has landed", back.count > after.count && back.labels.length > 0,
        `${after.count} → ${back.count} sets, ${back.labels.length} chips`);
    }

    // ── U8 · THE ANSWER STARTS WHERE THE READER IS LOOKING ──────────────────────────────────────
    //
    // ⚠ "SOMETIMES IT SHOWS ME NO RENDERING AND I HAVE TO SCROLL UP TO SEE THE ANSWER." The transcript
    //   used to snap to the BOTTOM of the content on every reveal tick. For a short answer that is
    //   invisible; for a long one the top is pushed off screen as it grows, so the reader watches the
    //   tail of something being drawn and has to scroll up to find where it started.
    //
    // ★ SO A SEND ANCHORS THE READER'S OWN QUESTION NEAR THE TOP OF THE VIEW. Measured right after
    //   the send — before the answer has had time to grow — because that is the moment the old
    //   behaviour and the new one are indistinguishable by any later measurement.
    {
      const box = page.locator("textarea").last();
      await box.fill(`what has been flagged on ${HEALTHY}`);
      await box.press("Enter");
      await page.waitForTimeout(1500);
      const geom = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-msg-role="user"]')) as HTMLElement[];
        const last = rows[rows.length - 1];
        if (!last) return null;
        let el: HTMLElement | null = last, scroller: HTMLElement | null = null;
        while (el) {
          const st = getComputedStyle(el);
          if (st.overflowY === "auto" || st.overflowY === "scroll") { scroller = el; break; }
          el = el.parentElement;
        }
        if (!scroller) return null;
        return {
          offset: Math.round(last.getBoundingClientRect().top - scroller.getBoundingClientRect().top),
          viewport: Math.round(scroller.clientHeight),
        };
      });
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★ RESTATED, NOT RETUNED — this assertion encoded the defect.
      //
      // ⚠ IT RUNS 1500ms AFTER SEND, MID-GENERATION, and demanded the question sit within 40% of the
      //   top. At that moment the only content is the bubble and a loader — so the ONLY way to lift
      //   the question that high is to hold open most of a viewport of empty space beneath it. That
      //   is the void the Operator reported, and this check was requiring it.
      //
      // ★ THE CONTRACT NOW: the question rises as far as the CONTENT allows and no further. Early in
      //   a turn that is partway down the view; as sections land it climbs. A question sitting at
      //   65% with a loader under it is a chat product working normally — a near-empty screen is not.
      //
      // ⚠ THE UPPER BOUND STAYS REAL. `offset >= -4` still forbids scrolling the question off the
      //   top, and the 85% ceiling still catches a pin that never happens at all.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      ok("U8 · the newest question rises as far as the content allows, and is never scrolled off",
        geom !== null && geom.offset >= -4 && geom.offset < geom.viewport * 0.85,
        geom === null ? "could not measure — no user row or no scroller" : `${geom.offset}px from the top of a ${geom.viewport}px view`);
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
        undefined, { timeout: 180_000 },
      ).catch(() => {});
      await settled(page);
    }

    // ── U9 · A COMPARISON IS SEPARABLE BY COLOUR ────────────────────────────────────────────────
    //
    // ⚠ TEN BARS, TWO COMPANIES, AND EVERY BAR THE SAME TWO SHADES OF "IS THIS THE SUBJECT". The
    //   marks in a side-by-side alternate A, B, A, B down a composite and four pillars, and the
    //   renderer coloured them by `role` — which says "is this the thing asked about" and is true of
    //   both sides. So both composites drew blue and all eight pillar bars drew grey, and the reader
    //   could tell which MEASURE a bar was from its label but not which COMPANY without reading
    //   every label in full. A comparison chart whose two sides look identical has not compared.
    //
    // ★ ASSERTED AS "ONE COLOUR PER COMPANY, AND THE TWO DIFFER" rather than against specific hues:
    //   the palette is the design system's to change, the CONSISTENCY is the product's.
    {
      await ask(page, `compare ${HEALTHY} and INFY`);
      await settled(page);
      const bars = await page.evaluate(() => {
        const answers = Array.from(document.querySelectorAll("[data-answer-revealing]"));
        const last = answers[answers.length - 1] as HTMLElement | undefined;
        if (!last) return [];
        const out: { label: string; colour: string }[] = [];
        for (const r of Array.from(last.querySelectorAll("div.grid")) as HTMLElement[]) {
          const label = (r.querySelector("span")?.textContent ?? "").trim();
          const bar = r.querySelector("div.relative > span:nth-child(2)") as HTMLElement | null;
          if (label && bar) out.push({ label, colour: getComputedStyle(bar).backgroundColor });
        }
        return out;
      });
      ok("U9 · the comparison drew bars to read", bars.length >= 4, `${bars.length} bars`);
      if (bars.length >= 4) {
        // The row label is "<SYMBOL> · <measure>", so the side is the part before the separator.
        const bySide = new Map<string, Set<string>>();
        for (const b of bars) {
          const side = b.label.split(" · ")[0] ?? "";
          if (!bySide.has(side)) bySide.set(side, new Set());
          bySide.get(side)!.add(b.colour);
        }
        const sides = [...bySide.entries()];
        const consistent = sides.every(([, c]) => c.size === 1);
        const distinct = new Set(sides.map(([, c]) => [...c][0])).size === sides.length;
        ok("U9 · each company keeps one colour down the whole chart", consistent,
          sides.map(([k, c]) => `${k}:${c.size}`).join(" "));
        ok("U9 · and the companies do not share a colour", sides.length >= 2 && distinct,
          sides.map(([k, c]) => `${k}=${[...c][0]}`).join("  "));
      }
    }

    // ── U7 · THE DEEP LINKS ─────────────────────────────────────────────────────────────────────
    //
    // ★ THE ANSWER HAS TO POINT SOMEWHERE. Stage 12 added a code-built route table so an answer can
    //   end by sending the reader to the page that holds the working. `verify-routes.ts` proves the
    //   table resolves; this proves the links REACH THE DOM and are app-relative once rendered.
    //
    // ⚠ THE HREF IS CHECKED AS RENDERED, not as composed. A relative href that the browser resolved
    //   against another origin is still a link off the product, and only the DOM knows.
    {
      const links = await page.evaluate(() => {
        const nav = Array.from(document.querySelectorAll("[data-vytal-links]"));
        const out: { href: string; text: string; why: boolean }[] = [];
        for (const n of nav) {
          for (const a of Array.from(n.querySelectorAll("a"))) {
            const el = a as HTMLAnchorElement;
            out.push({
              href: el.getAttribute("href") ?? "",
              text: el.innerText.trim(),
              // Two lines: the destination and the reason. A bare row of page names is a nav bar.
              why: el.querySelectorAll("span > span").length >= 2,
            });
          }
        }
        return { out, sets: nav.length, origin: location.origin };
      });
      ok("U7 · the answer offers somewhere to go in Vytal", links.sets > 0 && links.out.length > 0,
        `${links.sets} link set(s), ${links.out.length} links`);
      const external = links.out.filter((l) => !l.href.startsWith("/"));
      ok("U7 · every link is app-relative", external.length === 0,
        external.length ? external.map((l) => l.href).join(" · ") : "no off-product hrefs");
      const unexplained = links.out.filter((l) => !l.why);
      ok("U7 · every link says why it is being offered", links.out.length > 0 && unexplained.length === 0,
        unexplained.length ? `${unexplained.length} without a reason line` : "each carries its clause");
      // ⚠ AND THEY MUST NOT DUPLICATE THE FOLLOW-UP CHIPS. A chip asks another question and stays in
      //   the conversation; a link leaves it. Two affordances that do the same thing is one too many.
      const chipText = new Set(after.labels.map((x) => x.toLowerCase()));
      const overlap = links.out.filter((l) => chipText.has(l.text.toLowerCase()));
      ok("U7 · the links are not the chips again", overlap.length === 0,
        overlap.length ? overlap.map((l) => l.text).join(" · ") : "distinct affordances");
    }

    // ⚠ PLACED HERE, AND THE POSITION IS LOAD-BEARING IN BOTH DIRECTIONS. It has to run BEFORE the
    //   three-viewport sweep below, because that sweep is the only thing in this suite that can see a
    //   nine-column table overflow a 380px panel. And it has to run AFTER the chip checks above: an
    //   extra completed turn inserted between `chipsSnapshot` and "no new set while the reply is still
    //   arriving" makes that comparison count one set too few, and it failed exactly that way on the
    //   first run of this addition.
    // ═══ ★★ PHASE 1 · BATCH 1 — THE STATEMENT TABLE, WHICH IS THE WIDEST THING THIS PRODUCT DRAWS ══
    //
    // ⚠ IT MUST BE ON SCREEN BEFORE THE THREE-VIEWPORT SWEEP BELOW, AND THAT IS THE WHOLE POINT OF
    //   PUTTING IT HERE. `SERIES:statement-table` renders up to nine period columns plus a pinned
    //   label column; at a 380px sidekick panel that is four times the available width. Every other
    //   renderer in this product tops out at four or five columns, so the overflow sweep has never
    //   been run against anything this wide — and "nothing overflows its box" asserted over a set
    //   that excludes the widest member is the §9.3 failure in its layout form.
    //
    // ★ AND IT ASSERTS THE BASIS IS ON SCREEN, not merely in the payload. The payload half is
    //   `I-BASIS` in the answer gate; this is the DOM half, and the two are different facts — the
    //   stage-9 lesson was a coverage payload that was correct and a renderer that ignored it.
    await ask(page, `how much debt does ${HEALTHY} carry`);
    await settled(page);
    {
      const st = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll("table"));
        // The statement table is the one whose caption names a basis — its own sr-only caption says so.
        const t = tables.find((x) => /basis/i.test(x.querySelector("caption")?.textContent ?? ""));
        if (!t) return null;
        const card = t.closest("section");
        const scroller = t.parentElement as HTMLElement | null;
        return {
          cols: t.querySelectorAll("thead th").length,
          rows: t.querySelectorAll("tbody tr").length,
          // The basis line is rendered above the table, inside the same card.
          basisText: (card?.textContent ?? "").slice(0, 400),
          // ⚠ THE SCROLL LIVES ON THE WRAPPER, NOT ON THE PAGE. That is the rule for wide content.
          wrapperScrolls: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
          wrapperOverflowX: scroller ? getComputedStyle(scroller).overflowX : "",
          sortableHeaders: t.querySelectorAll("thead th button, thead th [role=button]").length,
        };
      });
      if (st === null) {
        ok("U8 · the statement table rendered", false, "no table with a basis caption — the renderer is UNEXERCISED in the browser");
      } else {
        ok("U8 · the statement table rendered", st.cols > 2 && st.rows > 2, `${st.cols} columns x ${st.rows} rows`);
        // ★★ THE F CONSTRAINT, AS A DOM FACT.
        ok("U8 · the basis is on screen, in words, above the figures",
          /consolidated|standalone/i.test(st.basisText),
          st.basisText.slice(0, 120).replace(/\s+/g, " "));
        // ⚠ NOTHING SORTS. A statement sorted by year is not a statement — see the renderer's header.
        ok("U8 · no column of a statement is offered as sortable", st.sortableHeaders === 0,
          `${st.sortableHeaders} sortable header(s)`);
        ok("U8 · the table's own wrapper is the scroll container", st.wrapperOverflowX === "auto",
          `overflow-x: ${st.wrapperOverflowX}`);
      }
    }

    // ═══ ★★ PHASE 1 · BATCH 2 — THE PEER ROSTER, AND WHAT `verify:ux` COULD NOT SEE ═══════════════
    //
    // ⚠ THE OVERFLOW SWEEP BELOW PASSED THROUGHOUT WHILE THE ROSTER WAS UNREADABLE. `set-table` sizes
    //   its table to max-content so the WRAPPER scrolls rather than the page — which is correct, is
    //   what U3 asserts, and is exactly why U3 is blind to this: on an eight-row roster of long
    //   company names ("Cholamandalam Investment & Finance Co Ltd") the entity column consumed the
    //   card and the ONLY value column sat off the right edge. Nothing overflowed its box; the reader
    //   still had to scroll sideways to reach the thing they asked for.
    //
    // ★ SO THE ASSERTION IS ABOUT REACHABILITY, NOT OVERFLOW. A table of three columns or fewer must
    //   fit its own card — if it does not, the entity column is eating the width, and no amount of
    //   honest scrolling makes a two-column table that needs scrolling a good answer.
    //
    // ★ AND THE HIGHLIGHTED ROW IS A DOM FACT. The backend marks the reader's own company; C3 proves
    //   the field is READ by the component, and only a browser proves it is visibly distinguished —
    //   and by more than colour (D-6), which is why the rule is measured rather than the tint.
    await ask(page, `how does ${HEALTHY} compare with its peer group`);
    await settled(page);
    {
      const roster = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll("table"));
        const t = tables.find((x) => /roster|scored/i.test(x.closest("section")?.textContent ?? ""));
        if (!t) return null;
        const scroller = t.parentElement as HTMLElement | null;
        const rows = Array.from(t.querySelectorAll("tbody tr")) as HTMLElement[];
        const marked = rows.filter((r) => {
          const cs = getComputedStyle(r);
          return cs.boxShadow !== "none" || cs.backgroundColor !== "rgba(0, 0, 0, 0)";
        });
        return {
          cols: t.querySelectorAll("thead th").length,
          rows: rows.length,
          needsScroll: scroller ? scroller.scrollWidth > scroller.clientWidth + 2 : false,
          markedRows: marked.length,
          markedHasRule: marked.some((r) => getComputedStyle(r).boxShadow !== "none"),
          title: (t.closest("section")?.querySelector("h3")?.textContent ?? "").slice(0, 60),
        };
      });
      if (roster === null) {
        ok("U10 · the peer roster rendered", false, "no roster table found — the PG renderer is UNEXERCISED in the browser");
      } else {
        ok("U10 · the peer roster rendered", roster.rows >= 2, `${roster.cols} columns x ${roster.rows} rows`);
        // ★ THE TITLE IS THE SET'S OWN, NOT THE SCREEN'S. It read "What matched" over a peer group
        //   until this batch — a constant in the renderer from when the screen was its only caller.
        ok("U10 · the roster is titled as a group, not as a match set",
          !/matched/i.test(roster.title), roster.title || "(no title)");
        ok("U10 · a roster of few columns fits its card without sideways scrolling",
          roster.cols > 4 || !roster.needsScroll,
          roster.needsScroll ? `${roster.cols} columns and the wrapper still scrolls` : `${roster.cols} columns, fits`);
        ok("U10 · the reader's own company is marked, and by more than colour",
          roster.markedRows === 1 && roster.markedHasRule,
          `${roster.markedRows} row(s) marked, rule=${roster.markedHasRule}`);
      }
    }

    // ═══ ★★ PHASE 2 · BATCH 1 — THE PHASE SPINE AND THE SHORTFALL WALK ═══════════════════════════
    //
    // ⚠ TWO PROPERTIES HERE ARE UNREACHABLE FROM THE PAYLOAD, AND BOTH ARE THE POINT OF THE BATCH.
    //
    //   · THE LINE MUST STEP. `I-STEPPED` caught the first draft drawing a composite as a smooth
    //     curve — "nothing is true between two filings, so the slope between them is invented" — and
    //     the fix was `type="stepAfter"`. But the invariant now EXEMPTS this renderer by name, so
    //     nothing at layer 1 would notice if it silently went back to `monotone`. Only the rendered
    //     SVG says whether it steps: a step path is a run of alternating horizontal and vertical
    //     segments, and a monotone path is a run of cubic curve commands. That is checkable.
    //
    //   · THE BAND CHIPS MUST NOT BE COLOUR-CODED. `excellent … distress` read as praise and blame,
    //     and this family's claim is that it explains rather than rates — so all five render in ONE
    //     ink. A payload cannot express that; a computed style can.
    await ask(page, `how has ${MOVED} health score moved over time`);
    await settled(page);
    {
      // ⚠ THE INNERMOST MATCHING SECTION AND THE NAMED PATH, NOT `.find` AND "THE LONGEST PATH". The
      //   first draft took the FIRST section whose text matched, which is an outer wrapper containing
      //   the whole answer — it reported "76 phase rows" for a two-phase chart. And it took the
      //   longest `<path>`, which on a recharts surface is a band rectangle, so it reported one
      //   segment for a 14-point line. Both were assertions that passed or failed on the wrong node.
      const spine = await page.evaluate(() => {
        let sec: Element | null = null;
        for (const x of Array.from(document.querySelectorAll("section"))) {
          if (/quarter by quarter/i.test(x.textContent ?? "")) sec = x; // last match = innermost
        }
        if (!sec) return null;
        const line = sec.querySelector("path.recharts-line-curve");
        const d = line?.getAttribute("d") ?? "";
        return {
          hasChart: Boolean(sec.querySelector("svg")) && Boolean(line),
          // ★ A STEP PATH IS STRAIGHT SEGMENTS ONLY. `C` is a cubic bézier — recharts' `monotone`
          //   emits one per point. A stepped line emits `L` and nothing else.
          curves: (d.match(/C/g) ?? []).length,
          segments: (d.match(/L/g) ?? []).length,
          phaseRows: sec.querySelectorAll("ul li").length,
          bands: sec.querySelectorAll(".recharts-reference-area").length,
          notes: (sec.textContent ?? "").includes("quarter by quarter"),
          method: /phase is a run of at least/i.test(sec.textContent ?? ""),
        };
      });
      if (spine === null) {
        ok("U11 · the phase spine rendered", false, "no phase-spine section found — the T renderer is UNEXERCISED in the browser");
      } else {
        ok("U11 · the phase spine rendered a chart", spine.hasChart && spine.segments > 2,
          `${spine.segments} straight segments, ${spine.curves} curves`);
        // ★ THE BANDS THE PROSE PROMISES MUST ACTUALLY BE DRAWN. The card says "the shaded bands
        //   behind it are the five labels we publish"; a sentence pointing at something that is not
        //   there is worse than no sentence.
        ok("U11 · the published bands are drawn behind the line", spine.bands >= 2,
          `${spine.bands} band(s) painted`);
        // ⚠ THIS IS THE ASSERTION `I-STEPPED` CAN NO LONGER MAKE — see the note above.
        ok("U11 · the score line STEPS rather than sloping between quarters", spine.curves === 0,
          spine.curves === 0 ? "no curve commands in the path" : `${spine.curves} bézier segments — the line interpolates between filed quarters`);
        ok("U11 · the phases are listed as well as shaded", spine.phaseRows >= 1, `${spine.phaseRows} row(s)`);
        ok("U11 · the card says which series it is and how the phases were found",
          spine.notes && spine.method, `basis=${spine.notes} method=${spine.method}`);
      }
    }

    await ask(page, `why is ${MOVED} scored the way it is`);
    await settled(page);
    {
      const walk = await page.evaluate(() => {
        let sec: Element | null = null;
        for (const x of Array.from(document.querySelectorAll("section"))) {
          if (/gives back what it actually scored/i.test(x.textContent ?? "")) sec = x;
        }
        if (!sec) return null;
        const chips = Array.from(sec.querySelectorAll("span"))
          .filter((x) => /^(excellent|good|acceptable|concerning|distress)$/i.test((x.textContent ?? "").trim()));
        const inks = new Set(chips.map((x) => getComputedStyle(x).color));
        const scroller = sec.querySelector("ul")?.parentElement as HTMLElement | null;
        return {
          rows: sec.querySelectorAll("ul li").length,
          chips: chips.length,
          distinctInks: inks.size,
          overflows: scroller ? scroller.scrollWidth > scroller.clientWidth + 2 : false,
          // The reader must be able to see what a bar could have accounted for, not only what it cost.
          hasDenominator: /\/\s*\d/.test(sec.textContent ?? ""),
          // The group header's own total, in the order they render — read off the component's stated
          // handle rather than off a position in the tree. See the note beside `data-group-total`.
          groupTotals: Array.from(sec.querySelectorAll("[data-group-total]"))
            .map((x) => Number((x.textContent ?? "").replace(/[^0-9.]/g, "")))
            .filter((x) => Number.isFinite(x) && x > 0),
        };
      });
      if (walk === null) {
        ok("U12 · the shortfall walk rendered", false, "no shortfall section found — the A renderer is UNEXERCISED in the browser");
      } else {
        ok("U12 · the shortfall walk rendered its measures", walk.rows >= 4, `${walk.rows} row(s)`);
        // ★ THE BAND IS CONTEXT, NOT A VERDICT. One ink for all five, or none rendered at this width.
        ok("U12 · the band chips are one neutral ink, never a good-to-bad scale",
          walk.chips === 0 || walk.distinctInks === 1,
          `${walk.chips} chip(s) in ${walk.distinctInks} ink(s)`);
        ok("U12 · a gap is shown against what the measure could have accounted for", walk.hasDenominator,
          walk.hasDenominator ? "denominator present" : "a bare drag figure with no scale to read it against");
        ok("U12 · the walk fits its card", !walk.overflows,
          walk.overflows ? "the row list scrolls sideways" : "fits");
        // ★★ "LARGEST DRAG FIRST" MUST HOLD AT GROUP GRAIN TOO — the defect the screenshots found.
        //    Ordering groups by where their first BAR landed put Market's single −5.8 above
        //    Foundation's −19.2 across seven measures, and a reader scanning down reads the top row
        //    as the problem. The caveat in the prose does not undo the order of the chart.
        ok("U12 · the pillar groups are ordered by what they cost, largest first",
          walk.groupTotals.every((x, i, a) => i === 0 || a[i - 1]! >= x),
          walk.groupTotals.map((x) => x.toFixed(1)).join(" ≥ ") || "no group headers found");
      }
    }

    // ── U3 · THE THREE WIDTHS ───────────────────────────────────────────────────────────────────
    section("4 · the three viewports");

    // ── THE REAL SIDEKICK PANEL, OPENED THE WAY A READER OPENS IT ───────────────────────────────
    //
    // ★ THE CLAMP BELOW IS A FAITHFUL SIMULATION AND IT IS STILL NOT THE PANEL. Since the sections
    //   size themselves with `@container/answer`, container width is the only input to their layout,
    //   so clamping it reproduces the panel's conditions exactly — which is why the sweep uses it: it
    //   is deterministic and does not depend on the rail's open/close affordance. But "exactly
    //   reproduces the conditions" is an argument, and the panel is a fact. Both run.
    {
      const panel = await newPage(browser, 1440, 900);
      await signIn(panel);
      await panel.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" });
      await panel.waitForTimeout(2500);
      const trigger = panel.locator('button[aria-label="Ask Vytal"]').first();
      if ((await trigger.count()) === 0) {
        ok("the sidekick panel opens", false, "no 'Ask Vytal' trigger found — the REAL panel is UNEXERCISED");
      } else {
        await trigger.click();
        await panel.waitForTimeout(2000);
        const composer = await panel.locator("textarea").count();
        ok("the sidekick panel opens", composer > 0, `${composer} composer(s) in the rail`);
        if (composer > 0) {
          const sent = await ask(panel, `how is ${HEALTHY} doing`);
          await settled(panel);
          const width = await panel.evaluate(() =>
            (document.querySelector("[data-answer-revealing]") as HTMLElement | null)?.clientWidth ?? 0);
          ok("an answer rendered in the real panel", sent && width > 0, `answer column is ${width}px wide`);
          // The panel is genuinely narrow — if it is not, this assertion is not testing the panel.
          ok("the panel column is actually narrow", width > 0 && width < 480, `${width}px`);
          const over = await overflowing(panel);
          ok("U3 · REAL sidekick panel · nothing overflows its box", over.length === 0,
            over.length ? over.join(" · ") : `clean at ${width}px`);
          ok("the follow-ups ride along in the panel",
            (await panel.locator("[data-conversation-chips]").count()) >= 1);
          ok("U1 · no loader survived in the panel",
            (await panel.locator("[data-section-loader]").count()) === 0);
        }
      }
      await panel.close();
    }

    for (const [name, clamp, vp] of [
      ["sidekick panel (simulated)", 380, null],
      ["mobile", null, { w: 390, h: 844 }],
      ["full width", null, null],
    ] as const) {
      if (vp) await page.setViewportSize({ width: vp.w, height: vp.h });
      else await page.setViewportSize({ width: 1440, height: 900 });
      await clampAnswers(page, clamp);
      const over = await overflowing(page);
      const pageScrolls = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      ok(`U3 · ${name} · nothing overflows its box`, over.length === 0,
        over.length ? over.join(" · ") : `clean at ${clamp ?? (vp ? vp.w : 1440)}px`);
      ok(`U3 · ${name} · the page does not scroll sideways`, !pageScrolls);
    }
    await clampAnswers(page, null);

    // ── U5 · THE READER KEEPS THEIR PLACE ───────────────────────────────────────────────────────
    // ── ★ T-1b (finding 3) · THE SEND-TIME SPACER, AS A MEASUREMENT ───────────────────────────────────
//
// The Operator reported "the view scrolls up leaving a large gap while loading, then returns when the
// answer renders". Measured, on a conversation with three prior exchanges at a 683px viewport:
//
//     spacer at send        542px  = 79% of the view
//     spacer through load   542px  (constant, 24 samples over 6.3s)
//     spacer after settle   542px  (collapse of 0px)
//
// So the SECOND half of the report does not happen: nothing returns, because the spacer never
// collapses. What returns is the answer's own content filling the space. And the spacer persisting
// past settle is what `measurePad`'s own header says it exists to avoid — "a constant leaves a
// permanent hole under every finished answer, and a reader who scrolls to the bottom of a settled
// conversation should land on the last thing said."
//
// ⚠ THIS ASSERTS THE MEASUREMENT, NOT A TARGET, AND DELIBERATELY SO. The one lever is how far the
//   question is pinned, and trading "79% empty for ~6s while loading" against "a long answer starts
//   below the fold" is a product judgement, not a bug fix — raised for the Operator rather than
//   guessed at. What this gate does is stop the number moving silently: the pin is now a stated
//   contract, and any change to it — deliberate or accidental — fails here and has to be argued.
section("4b · the send-time spacer is bounded and stated");
{
  const p2 = await newPage(browser, 1440, 900);
  await signIn(p2);
  await openChat(p2);
  for (const seed of ["how is TCS doing", "how is INFY doing"]) { await ask(p2, seed); await settled(p2); }

  const read = () => p2.evaluate(() => {
    const sp = document.querySelector<HTMLElement>("[data-answer-spacer]");
    const l = document.querySelector<HTMLElement>("[data-transcript-list]");
    return {
      spacer: sp ? Math.round(sp.getBoundingClientRect().height) : 0,
      view: l ? Math.round(l.clientHeight) : 0,
    };
  });

  const box = p2.locator("textarea").last();
  await box.fill("how is WIPRO doing");
  await box.press("Enter");
  await p2.waitForTimeout(1500);
  const loading = await read();
  await settled(p2);
  const done = await read();

  const pctLoading = loading.view ? (loading.spacer / loading.view) * 100 : 0;
  const pctDone = done.view ? (done.spacer / done.view) * 100 : 0;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE CONTRACT CHANGED, SO THE ASSERTIONS ARE REPLACED RATHER THAN RETUNED.
  //
  // ⚠ THE OLD PAIR ASSERTED THE DEFECT. "Never fills the viewport" passed at 95% while the real
  //   value was 79% — a bound so loose it could not fail — and "the spacer is HELD through settle"
  //   asserted the very behaviour that produced the void, in the belief that a collapse would be
  //   worse. Both were honest readings of a measurement; neither was a contract anyone had chosen.
  //
  // ★ THE RULE NOW IS ONE SENTENCE: the empty space may never exceed the content it sits under.
  //   Under that rule the spacer GROWS as sections land, so "held through settle" is not merely
  //   retuned — it is false, and keeping a version of it would re-assert the old behaviour.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  ok("★ the send-time spacer is a modest gap, not a void", pctLoading < 40,
    `${loading.spacer}px of ${loading.view}px = ${pctLoading.toFixed(0)}% (was 79% — a near-empty screen)`);

  // ★★ THE CORE INVARIANT. Measured directly rather than inferred from a percentage: whatever the
  //    spacer is, there is at least that much real content above it to justify it.
  const bounded = await p2.evaluate(() => {
    const sp = document.querySelector<HTMLElement>("[data-answer-spacer]");
    const l = document.querySelector<HTMLElement>("[data-transcript-list]");
    if (!l) return { spacer: 0, below: 0 };
    const spacer = sp ? Math.round(sp.getBoundingClientRect().height) : 0;
    return { spacer, below: Math.round(l.scrollHeight - spacer) };
  });
  ok("★★ the spacer never exceeds the content below the anchor", bounded.spacer <= bounded.below + 4,
    `spacer ${bounded.spacer}px vs content ${bounded.below}px`);

  // ⚠ AND THE CASE THE READER NOTICES MOST — a SHORT answer must leave nothing to scroll into.
  // ⚠ MEASURED AS THE SPACER, NOT AS THE GAP TO THE VIEWPORT EDGE. The first version subtracted the
  //   last message's bottom from the list's bottom and read 213px — but that distance includes the
  //   list's own bottom padding, which exists to clear the composer and is chrome rather than void.
  //   Asserting against it would have been tuning a number to whatever the padding happened to be.
  //   The spacer is the thing this fix controls, so the spacer is the thing the contract names.
  const settledSpacer = await p2.evaluate(() => {
    const l = document.querySelector<HTMLElement>("[data-transcript-list]");
    const sp = document.querySelector<HTMLElement>("[data-answer-spacer]");
    if (!l) return { spacer: 0, view: 0 };
    l.scrollTop = l.scrollHeight;
    return {
      spacer: sp ? Math.round(sp.getBoundingClientRect().height) : 0,
      view: Math.round(l.clientHeight),
    };
  });
  const pctSettled = settledSpacer.view ? (settledSpacer.spacer / settledSpacer.view) * 100 : 0;
  ok("★ a settled answer leaves no viewport-sized hole to scroll into", pctSettled < 40,
    `${settledSpacer.spacer}px of ${settledSpacer.view}px = ${pctSettled.toFixed(0)}%`);
  void pctDone;
  await p2.close();
}

section("5 · scrolling up during a reveal");
    // ★ THE WINDOW THIS GUARDS GOT MUCH LONGER AT THIS STAGE. `onGrow` re-pins the view on every
    //   reveal tick, and the reveal now runs for the length of a whole answer rather than the length
    //   of its prose — so a reader who scrolls up mid-answer is, without the fix, corrected roughly
    //   once per animation frame for ten seconds. That reads as "the page will not scroll".
    {
      const scroller = () =>
        page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("*")).filter((e) => {
            const st = getComputedStyle(e as HTMLElement);
            return (st.overflowY === "auto" || st.overflowY === "scroll")
              && (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 40;
          });
          const el = els[els.length - 1] as HTMLElement | undefined;
          return el ? { top: el.scrollTop, height: el.scrollHeight } : null;
        });

      // ⚠ HELD, NOT DISCARDED. This send is deliberately not awaited — the whole point is to scroll
      //   WHILE it reveals — but a floating promise is not the same as a fire-and-forget one. Left
      //   dangling it was still resolving when the browser closed (a `Target page has been closed`
      //   crash) and still generating when the negative controls ran, which hid the chip bar and
      //   failed a control for a reason that had nothing to do with the control.
      const inFlight = ask(page, `why is ${HEALTHY} scored the way it is`).catch(() => false);
      await page.waitForTimeout(5000); // let the reveal get going
      const start = await scroller();
      if (!start || start.top < 200) {
        ok("U5 · the reader keeps their place while an answer reveals", false,
          "the transcript was not scrollable enough to test — UNEXERCISED, not satisfied");
      } else {
        // A real wheel, so the product sees the same event a reader produces.
        await page.mouse.move(700, 420);
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(120); }
        const after = await scroller();
        await page.waitForTimeout(6000);   // the reveal keeps running; nothing should drag us back
        const settledPos = await scroller();
        ok("U5 · the reader keeps their place while an answer reveals",
          Boolean(after && settledPos && settledPos.top <= after.top + 80),
          `scrolled to ${after?.top}, still at ${settledPos?.top} six seconds later`);
      }
      // Everything this section started is finished before anything else looks at the page.
      await inFlight;
      await settled(page);
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("textarea")).some((t) => !(t as HTMLTextAreaElement).disabled),
        undefined, { timeout: 180_000 },
      ).catch(() => {});
    }

    // ── §6 · THE CONTROLS ───────────────────────────────────────────────────────────────────────
    section("6 · negative controls — each check made to fire");
    await selfTest(page, ok);
  } finally {
    await browser?.close();
  }

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
