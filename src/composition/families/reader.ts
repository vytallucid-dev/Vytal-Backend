// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER'S OWN BOOK — portfolio · watchlist · relationship. Stage 6 plumbing, stage 7 blocks.
//
// ── ★ WHAT CHANGED AT STAGE 7 ─────────────────────────────────────────────────────────────────────
// Stage 6 proved the reader-subject plumbing with coverage plus a callout, and its own closing note
// called that out: "it comes out fragile" with no supporting figures sits on the wrong side of the
// vanishing-component line. The holdings are now here. The coverage header still leads, because
// "11 of 21 scored" is the bound on every sentence after it and a bound stated afterwards has
// already let the reader over-read the score.
//
// ── ★ THREE QUESTIONS, THREE SHAPES, ONE SUBJECT KIND ─────────────────────────────────────────────
//   no stock named, book question       → portfolio
//   no stock named, watchlist question  → watchlist
//   a stock named, reader perspective   → relationship  ("how much TCS do I own")
//
// The third is the one that needed the `perspective` slot to exist separately from `subjects` (§3.7):
// its subject is a company and its numbers are the reader's.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { portfolioValueBlock, portfolioHealthBlock, portfolioBlock, watchlistBlock, relationshipBlock, memoryBlock, alertsBlock, remindersBlock } from "../../compose/blocks-subject.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { calloutSection, type CalloutItem } from "../../section/kinds/callout.js";
import { nextSection, chipSection, type Chip } from "../../section/kinds/anchor.js";
import { resolvePortfolio } from "../../resolve/blocks-reader.js";
import { blockCopy } from "../../catalogue/block-copy.js";
import type { ReaderSubjectRef } from "../../resolve/subject.js";
import type { Coverage } from "../../resolve/contract.js";
import type { ReaderProfile } from "../../reader/profile.js";
import type { AnySection, AnswerProse, ComposeContext } from "../contract.js";

export interface ReaderTurnResult {
  readonly kind: "composed";
  readonly compositionId: string;
  readonly sections: readonly AnySection[];
  readonly prose: AnswerProse;
  readonly missLogged: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Follow-ups for a reader-scoped answer — questions ABOUT A BOOK, which is a different object from a
 * company and takes different questions. Signal-driven the same way `nextSection` is: what is offered
 * depends on what this particular book actually has.
 */
function readerChips(shape: string, c: { holdings: number; holdingsScored: number }): Chip[] {
  const chips: Chip[] = [];
  if (shape !== "watchlist") chips.push({ label: "Watchlist", question: "What is on my watchlist?", surface: "Watchlist" });
  if (shape !== "portfolio") chips.push({ label: "Book", question: "How is my portfolio doing?", surface: "Portfolio" });
  if (c.holdings > 0) {
    chips.push({ label: "Risk", question: "What has been flagged across my holdings?", surface: "Findings" });
    chips.push({ label: "Mix", question: "How is my book split across sectors?", surface: "Portfolio" });
  }
  // ⚠ OFFERED ONLY WHEN THERE IS A GAP TO EXPLAIN. On a fully scored book this chip would ask about
  //   an absence that does not exist.
  if (c.holdingsScored < c.holdings) {
    chips.push({ label: "Coverage", question: "Which of my holdings do you not score, and why?", surface: "Coverage" });
  }
  chips.push({ label: "Alerts", question: "What alerts do I have set?", surface: "Alerts" });
  return chips.slice(0, 5);
}

/**
 * How many rows a built hero-set actually carries.
 *
 * ⚠ READ OFF THE SECTION, NOT OFF THE RESOLVER, so the count and the thing on screen cannot
 *   disagree — the sentence "you have no alerts but four reminders" is only honest if it counts the
 *   same rows the reader is looking at.
 */
function countMembers(section: AnySection): number {
  return ((section.payload as { members?: readonly unknown[] } | undefined)?.members ?? []).length;
}

export type ReaderShape = "watchlist" | "relationship" | "portfolio" | "memory" | "alerts";

/**
 * Which of the five the reader asked for. Slot-only — no data read to decide.
 *
 * ★ EXPORTED SINCE STAGE 12 so `composeTurn` can pick the right deep link for a reader-scoped
 *   answer without re-deriving the shape from the question a second time (N-3: one vocabulary,
 *   one decision).
 */
export function readerShape(ctx: ComposeContext): ReaderShape {
  // ⚠ WORD LISTS, NOT REGEX LITERALS, AND THAT IS A SCAR. Three times in this build a `\b` written
  //   into a regex through a script became a literal 0x08 backspace — invisible in every listing,
  //   matching nothing, and the fourth time it silently sent "what alerts do I have" to the portfolio.
  //   A membership test over lowercased words cannot be corrupted that way and reads the same.
  const words = new Set(ctx.turn.raw.toLowerCase().replace(/[^a-z ]+/g, " ").split(/ +/).filter(Boolean));
  const any = (...xs: string[]) => xs.some((x) => words.has(x));

  // MEMORY IS TESTED FIRST. "what do you remember about me" names no company and no holding, so every
  // later branch would answer with a book the reader did not ask about.
  if (any("remember", "remembers", "memory", "memories", "yaad")) return "memory";
  // ★ REMINDERS ANSWER HERE TOO, AND THAT IS THE POINT. "alerts" and "event reminders" are two
  //   tables to us and one question to a reader — see resolveReminders. A reader who asks about
  //   either gets both, so an empty alerts table can never be reported as an empty inbox.
  if (any("alert", "alerts", "notification", "notifications", "notify",
          "reminder", "reminders", "remind", "reminding")) return "alerts";
  if (ctx.symbol) return "relationship";
  return any("watchlist", "watching", "pinned", "starred") ? "watchlist" : "portfolio";
}


export async function composeReaderAnswer(
  subject: ReaderSubjectRef,
  ctx: ComposeContext,
  profile: ReaderProfile,
): Promise<ReaderTurnResult> {
  const coverage: Coverage = { subject: subject.coverage, query: null };
  const c = subject.coverage;
  const who = profile.statedName ? `${profile.statedName}, ` : "";
  const shape = readerShape(ctx);

  const sections: AnySection[] = [coverageSection(coverage) as AnySection];
  const leads: Record<string, string> = {};
  // §4.3 as amended (stage 9) — what a section SHOWED, said after it. See composition/contract.ts.
  const after: Record<string, string> = {};
  const opening: string[] = [];
  let close = "";

  if (shape === "alerts") {
    // ★ BOTH MECHANISMS, ALWAYS, WHICHEVER ONE THE READER NAMED. The keys are indexed
    //   (`KIND:renderer#i`) because these are two sections of the SAME kind and renderer — the exact
    //   collision the indexed form exists for, and without it both would render under one sentence.
    const [a, rm] = await Promise.all([alertsBlock(subject.userId), remindersBlock(subject.userId)]);
    const nAlerts = a ? countMembers(a.section) : 0;
    const nRem = rm ? countMembers(rm.section) : 0;
    if (a) {
      sections.push(a.section);
      leads[`${a.section.kind}:${a.section.renderer}#${sections.length - 1}`] =
        "The condition rules first — these fire when something crosses a level you set.";
      if (nAlerts === 0 && nRem > 0) {
        after[`${a.section.kind}:${a.section.renderer}#${sections.length - 1}`] =
          "Nothing there — but that is only half of it, because a date rule is not an alert.";
      }
    }
    if (rm) {
      sections.push(rm.section);
      leads[`${rm.section.kind}:${rm.section.renderer}#${sections.length - 1}`] =
        "And the date rules — these fire ahead of a scheduled corporate event, not on a price move.";
    }
    // ⚠ THE OPENING COUNTS BOTH, BECAUSE THE OLD ONE COULD SAY "HERE ARE YOUR ALERTS" OVER AN EMPTY
    //   LIST WHILE FOUR REMINDERS SAT UNREAD. The sentence now states what was actually found.
    opening.push(cap(
      nAlerts === 0 && nRem === 0
        ? `${who}you have nothing set — no price or finding alerts, and no event reminders.`
        : nAlerts === 0
          ? `${who}you have no alerts set, but you do have ${nRem === 1 ? "an event reminder" : `${nRem} event reminders`}.`
          : nRem === 0
            ? `${who}here ${nAlerts === 1 ? "is your alert" : "are your alerts"}. No event reminders are set.`
            : `${who}here is everything you have asked to be told about — the alerts, and the event reminders under them.`,
    ));
    close =
      "An alert fires once its condition is met and a reminder fires ahead of a filed date; " +
      "neither predicts that anything will happen, and both are edited in Settings.";
  } else if (shape === "memory") {
    const m = await memoryBlock(profile, coverage);
    if (m) {
      sections.push(m.section);
      leads[`${m.section.kind}:${m.section.renderer}`] = "What you told us, and what we inferred — labelled apart.";
    }
    opening.push(cap(`${who}here is everything we hold about you.`));
    close = "Anything marked stated is your own words. Anything inferred we worked out from how you read, and you can tell us to drop it.";
  } else if (shape === "relationship") {
    const rel = await relationshipBlock(subject.userId, ctx.symbol!);
    if (rel) {
      sections.push(rel.section);
      leads[`${rel.section.kind}:${rel.section.renderer}`] =
        "Your position in it, and what that is beside the rest of your book.";
    }
    opening.push(cap(`${who}here is where you stand to ${ctx.symbol}.`));
    close = "That is your side of it. What the company itself is doing is a separate question.";
  } else if (shape === "watchlist") {
    const w = await watchlistBlock(subject.userId);
    if (w) {
      sections.push(w.section);
      leads[`${w.section.kind}:${w.section.renderer}`] = "Everything you have pinned, with where each one scores now.";
      opening.push(cap(`${who}here is what you are watching.`));
      close = "A pin is a bookmark, not a position — none of these is in your book unless you also hold it.";
    } else {
      // ⚠ A NULL BLOCK HERE IS A FAILED READ, NOT AN EMPTY WATCHLIST. `watchlistBlock` returns null
      //   only on `!r.ok` (blocks-subject.ts:97); an empty watchlist resolves `ok` with `total: 0` and
      //   renders its own `watchlist_empty` phrase inside the set. So the two states were already
      //   distinguishable and the prose was not distinguishing them — it opened "here is what you are
      //   watching" over no section at all, promising a list we did not have. Same shape as the book.
      opening.push(cap(`${who}${blockCopy("watchlist_read_failed")}.`));
      close = "That is a statement about our read, not about what you have pinned.";
    }
  } else {
    // ── PORTFOLIO ──────────────────────────────────────────────────────────────────────────────
    const p = await portfolioBlock(subject.userId);
    if (p) {
      sections.push(p.section);
      leads[`${p.section.kind}:${p.section.renderer}`] =
        "Your positions, largest first, with what we score each of them.";
    }

    // ★ T-1b finding 6 · THE BOOK OVER TIME. Two components the product already had, now reachable
    //   from an answer: the value line (the Overview tab's chart, from the SAME computePortfolioNav)
    //   and health with its trendline (the same portfolio_score_history HealthHistoryChart reads).
    //
    //   ⚠ ADDED HERE, WHERE EVERY BOOK QUESTION LANDS, RATHER THAN TO ONE COMPOSITION. The Operator's
    //     instruction was that these attach whenever a reader asks about their book — "how is my
    //     portfolio doing", "how am I doing", a bare book question all reach this branch.
    //
    //   ⚠ EACH DECLINES ON ABSENT AND THE ANSWER SIMPLY LACKS IT. A new account has no valuation and
    //     no score rows; an axis drawn over nothing is where a reused chart most easily lies.
    const [pv, ph] = await Promise.all([
      portfolioValueBlock(subject.userId),
      portfolioHealthBlock(subject.userId),
    ]);
    if (pv) {
      sections.push(pv.section);
      leads[`${pv.section.kind}:${pv.section.renderer}`] =
        "What the book has been worth — the same series the portfolio page draws.";
    }
    if (ph) {
      sections.push(ph.section);
      leads[`${ph.section.kind}:${ph.section.renderer}`] =
        "And how its health has moved, on the same 0-100 scale a company is scored on.";
    }

    const r = await resolvePortfolio(subject.userId);
    const d = r.ok ? r.data : null;
    // ★★ THE BOUNDARY TRAVELS — Phase 2 · Batch 2. Every one of the 58 PHS registry entries carries a
    //    `doesntMean` and NO name and NO description, so it is the only authored copy those entries
    //    hold; it was on the object and was being dropped one field short of the reader. The portfolio
    //    register is the "≠ x ≠ y" form, which is exactly what `BoundaryLine` renders — *"≠ the
    //    position is a mistake, ≠ it will fall, ≠ trim it. Concentration is a fact about how much the
    //    score depends on one name, not a judgment on the name."* That sentence is the reason a
    //    concentration finding is safe to put in front of a reader at all.
    // ⚠⚠ THE CALLOUT IS ONLY BUILT WHEN THE READ SUCCEEDED, AND THIS IS THE `?? []` COSTUME AGAIN —
    //    one layer up from the resolvers, where the same defect is harder to see. `d?.findings ?? []`
    //    turns a FAILED read into an empty findings list, and an empty list renders through the
    //    `nothing-found` path as "We checked your holdings for anything that needed raising and found
    //    nothing notable to raise." That is a clean bill of health on a book we never opened, and it
    //    is worse than the empty-book sentence because it claims an ACTION we did not take.
    //
    //    ⚠ SUPPRESSED, NOT FILLED WITH A PLACEHOLDER. The answer simply lacks the section — the same
    //      rule the value and health blocks already follow when they decline (§N-4: the absence is
    //      stated once, in the prose, rather than mumbled in every section).
    if (r.ok) {
      const items: CalloutItem[] = (d?.findings ?? []).map((f) => ({
        label: f.label, detail: f.detail, severity: f.severity,
        doesntMean: f.doesntMean ?? undefined,
      }));
      sections.push(calloutSection(
        "your holdings for anything that needed raising", items, coverage, "findings",
        { totalAvailable: d && d.findingsHeld > items.length ? d.findingsHeld : null },
      ) as AnySection);
      leads.CALLOUT = "Separately, everything we check across a book — whether or not it found anything.";
    }

    // ★★ A FAILED READ IS NOT AN EMPTY BOOK, AND THIS BRANCH IS THE ONE THAT SHIPPED SAYING IT WAS.
    //    `d` went null on absent and the code fell straight to `c.holdings === 0` — because `c` is
    //    `subject.coverage`, a DIFFERENT read, which reports 0 whenever it has nothing to say. So a
    //    reader whose positions we could not read was told "your book is empty — no open positions
    //    are recorded against your account", and then reassured it was "a statement about what we
    //    have on file". Both sentences were false and neither was checkable by the reader.
    //
    //    ⚠ IT IS TESTED FIRST, BEFORE THE COUNT. Ordering it after `holdings === 0` would leave the
    //      defect intact for exactly the readers it hurt: the ones whose coverage read ALSO came back
    //      empty. The absence outranks the count because the count is only meaningful once the read
    //      succeeded.
    if (c.holdings === 0) {
      opening.push(cap(`${who}${blockCopy("portfolio_empty")}.`));
      opening.push("Once you add holdings or link a broker, this answers with what we hold on each of them.");
      close = "That is a statement about what we have on file, not about the market.";
    } else if (!r.ok) {
      // ★★ A FAILED READ IS NOT AN EMPTY BOOK. `d` goes null on absent, and this branch used to be
      //    absent entirely: the code fell through to the `holdings === 0` test above and, failing
      //    that, to the normal branch — which describes a book it could not read.
      //
      //    ⚠ AND THE ORDER IS DELIBERATE, AGAINST MY FIRST ATTEMPT. I put this test FIRST, reasoning
      //      that an absence outranks a count. It does not, because of where the count comes from:
      //      `c` is `subject.coverage`, built by a query that THROWS on failure rather than
      //      defaulting — `holdings: 0` is therefore a successful read that found nothing, a fact we
      //      hold. Testing this first would have answered "we could not read your book" to a reader
      //      whose empty book we had read perfectly well, trading a false claim for a withheld one.
      //      `holdings > 0` and a failed read is the case that needed a sentence, and it is this one.
      opening.push(cap(`${who}${blockCopy("portfolio_read_failed")}.`));
      opening.push(`We hold ${c.holdings} position${c.holdings === 1 ? "" : "s"} for you — that count is from a read that did work. Ask again in a moment; nothing about your holdings has changed.`);
      close = "That is a statement about our read, not about what you hold.";
    } else {
      // ⚠ POSITIONS AND INSTRUMENTS ARE TWO COUNTS AND THE LIST BELOW SHOWS THE SECOND. Measured on
      //   the fixture book: 21 positions, 20 rows, nothing omitted — because RELIANCE is held in two
      //   accounts. Every number was right and, side by side, they read as a discrepancy the reader
      //   has no way to resolve. One clause fixes it; `I-SET-RECONCILES` never could, because by its
      //   own definition the set reconciles.
      const dupes = d?.heldInSeveralAccounts ?? 0;
      opening.push(cap(
        `${who}you hold ${c.holdings} position${c.holdings === 1 ? "" : "s"}`
        + (dupes > 0
          ? ` across ${c.holdings - dupes} instrument${c.holdings - dupes === 1 ? "" : "s"} — `
            + `${dupes === 1 ? "one is" : `${dupes} are`} held in more than one account — `
            + `and we score ${c.holdingsScored} of them.`
          : `, and we score ${c.holdingsScored} of them.`),
      ));
      if (d?.band && d.score != null) {
        // ⚠ THE SCORE AND ITS BOUND IN ONE SENTENCE. Split apart, the first gets quoted as though the
        //   second did not exist — and the bound is a share of VALUE, not of count.
        const share = d.scoredWeight === null ? null : Math.round(d.scoredWeight * 100);
        opening.push(
          `Across the ${share === null ? `${c.holdingsScored} we can read` : `${share}% of your book we can read`}, ` +
          `it comes out ${d.band.toLowerCase()}${d.provisional ? " — and provisional, because that share is thin" : ""}.`,
        );

        // ═══ §4.3 AS AMENDED — THE REASONING, NOT JUST THE VERDICT ══════════════════════════════
        //
        // ★ THIS IS DEFECT 19'S OWN EXAMPLE. The answer said "Across the 84% of your book we can
        //   read, it comes out fragile" and then showed a table. Nothing said what fragile MEANS
        //   here, why this book comes out that way, or which holdings are dragging it — the reader
        //   was handed a verdict and a grid and left to join them up themselves.
        //
        //   The band is a summary OF the rows below it, so the sentence that connects them belongs
        //   between them. Every figure here is still code's: `d.lines` is a query result, and the
        //   sentence is assembled from it rather than written about it.
        opening.push(
          `That reading is the weighted average of the ${c.holdingsScored} we score — so it describes those, ` +
          `and the band is a statement about the businesses, not about what you paid for them.`,
        );
      } else {
        opening.push(cap(`${blockCopy("portfolio_no_snapshot")}, so there is no score to quote.`));
      }

      // ── after the BOOK: what the list of positions actually shows ──────────────────────────────
      if (d && d.lines.length > 0) {
        const scoredLines = d.lines.filter((l) => l.band !== null);
        const weak = scoredLines.filter((l) => l.band === "fragile" || l.band === "below_par");
        const totalCr = d.lines.reduce((a, l) => a + (l.valueCr ?? 0), 0);
        const topShare = totalCr > 0 ? Math.round(((d.lines[0]?.valueCr ?? 0) / totalCr) * 100) : null;
        const bits: string[] = [];
        if (topShare !== null && d.lines[0]) {
          bits.push(
            `${d.lines[0].name} is your largest position at ${topShare}% of the book` +
            (topShare >= 25 ? ", which is concentrated enough that its own reading moves the whole number" : ""),
          );
        }
        if (weak.length > 0) {
          // ★ NAMED, BECAUSE "fragile" WITHOUT THE NAMES IS THE VERDICT AGAIN. The reader can act on
          //   a list of holdings; they cannot act on an adjective.
          bits.push(
            `the ${weak.length === 1 ? "one holding" : `${weak.length} holdings`} reading below par — ` +
            `${weak.slice(0, 4).map((l) => l.symbol).join(", ")} — ${weak.length === 1 ? "is" : "are"} what pulls the average down`,
          );
        } else if (scoredLines.length > 0) {
          bits.push("none of the scored positions reads below par, so the average is not being dragged by a single holding");
        }
        if (bits.length > 0) {
          after["ANCHOR:hero-set"] = `${cap(bits.join("; and "))}.`;
        }
      }

      // ── after the FINDINGS: what they add up to ────────────────────────────────────────────────
      if (d && d.findings.length > 0) {
        const loud = d.findings.filter((f) => f.severity === "high").length;
        after.CALLOUT =
          `${d.findingsHeld === d.findings.length ? `Those are all ${d.findingsHeld}` : `Those are the ${d.findings.length} that matter most of ${d.findingsHeld}`} ` +
          `our checks raised on this book` +
          (loud > 0 ? `, and the ${loud === 1 ? "first is" : `first ${loud} are`} the kind we would want you to have read before anything else` : "") +
          `. Each describes something already on file — none of them is a prediction.`;
      } else if (d) {
        after.CALLOUT = "Nothing raised is a result, not an omission: the checks ran across every position we can read and came back clean.";
      }

      close = c.holdingsScored < c.holdings
        ? `Everything above covers the ${c.holdingsScored} holding${c.holdingsScored === 1 ? "" : "s"} we score. ` +
          `The other ${c.holdings - c.holdingsScored} are in your book and outside what we can read.`
        : "That covers every position in your book.";
    }
  }

  // ★ AN ANSWER ALWAYS OFFERS SOMEWHERE TO GO — AND A BOOK IS NOT A COMPANY.
  //
  // ⚠ THIS PASSED "your book" INTO `nextSection`, WHICH IS STOCK-SHAPED, AND THE SUBSTITUTION
  //   PRODUCED NONSENSE ON EVERY READER ANSWER: "Who owns your book, and has that changed?",
  //   "How does your book compare with its peer group?", "Show your book across its last eight
  //   quarters". A template built to take a ticker was handed a phrase, and the result reads as
  //   though the product does not know what it is looking at.
  //
  //   The RELATIONSHIP shape is the one exception: it has a real symbol, and its follow-ups are
  //   genuinely about that company, so it keeps the stock chips.
  const next = shape === "relationship" && ctx.symbol
    ? nextSection(ctx.symbol, {
        scored: c.holdingsScored > 0, findings: [], pledged: false, instSold: false,
        thin: c.holdings > 0 && c.holdingsScored < c.holdings, marginFell: false,
      }) as AnySection
    : chipSection(readerChips(shape, c)) as AnySection;
  sections.push(next);
  leads.NEXT = "If any of that raised a question, these follow it.";

  return {
    kind: "composed",
    compositionId: `reader.${shape}`,
    sections,
    prose: { opening, leads, after, close },
    missLogged: false,
  };
}
