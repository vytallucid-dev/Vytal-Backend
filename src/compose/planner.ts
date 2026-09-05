// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PLANNER — the brain. §5.3.
//
// It is given the question, the router's slots, what we HOLD (never what the values are), the menu of
// blocks that exist, and the reader's tone. It returns a plan. Code executes it.
//
// ★ THE PROMPT CARRIES THE HOUSE STYLE (§4.5) AS INSTRUCTIONS RATHER THAN AS A HARDCODED ORDER. That
//   is the whole change: the voice is stated once and applied by judgement to each question, instead
//   of being a skeleton every question is bent into.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createAiProvider } from "../ai/core/registry.js";
import { checkAndConsumeAiCall, recordAiTokens, type Actor } from "../ai/core/quota.js";
import { getStructure, planKey, putStructure } from "./plan-cache.js";
import type { ToneDirective } from "../ai/tone.js";
import type { RouterOutput } from "../router/contract.js";
import { BLOCK_MENU, admitPlan, type BlockId, type Plan } from "./plan.js";
import type { CapabilityManifest } from "./manifest.js";

const MENU_TEXT = (Object.entries(BLOCK_MENU) as [BlockId, { what: string }][])
  .map(([id, v]) => `  "${id}" — ${v.what}`).join("\n");

/**
 * The window, in words.
 *
 * ⚠ THE PLANNER PROMPT NEVER MENTIONED THE TIMEFRAME AT ALL. The router resolved
 *   `timeframe: {kind:"years", n:10}` off "show me ten years of TCS history", carried it into
 *   `RouterOutput`, and the prompt printed operation and lens and dropped it — so the MODEL planner
 *   had exactly as little to distinguish that question from "what is TCS's revenue trend?" as the
 *   deterministic one did. Both produced the same plan, correctly, from the same inputs.
 */
export function windowPhrase(router: RouterOutput): string {
  const tf = router.timeframe;
  if (!tf) return "not stated";
  if (tf.kind === "latest") return "the latest period only";
  if (tf.n === null) return tf.kind === "years" ? "several years" : "several quarters";
  return `${tf.n} ${tf.kind === "years" ? (tf.n === 1 ? "year" : "years") : tf.n === 1 ? "quarter" : "quarters"}`;
}

/** The same window in the reader's words. `null` becomes what we hold, never "not stated". */
function readerSpan(router: RouterOutput): string {
  const tf = router.timeframe;
  if (!tf || tf.kind === "latest" || tf.n === null) return "the period we hold";
  return `${tf.n} ${tf.kind === "years" ? (tf.n === 1 ? "year" : "years") : tf.n === 1 ? "quarter" : "quarters"}`;
}

export function plannerPrompt(m: CapabilityManifest, router: RouterOutput, tone: ToneDirective, question: string): string {
  const held = Object.entries(m.has).filter(([, v]) => v).map(([k]) => k);
  const missing = Object.entries(m.has).filter(([, v]) => !v).map(([k]) => k);
  return `You plan ONE answer to a question about an Indian listed company. Reply with JSON only.

THE QUESTION: "${question}"
Router read it as: operation=${router.operation}, lens=${router.lens ?? "none"}, window=${windowPhrase(router)}.
⚠ THE WINDOW IS PART OF THE QUESTION. A reader who asked for ten years is not asking what a reader
who asked for "the trend" asked. Plan the run of periods the window implies, and say the window in
the lead — not the figure, the SPAN.

WHAT WE HOLD ON ${m.symbol} (${m.name}):
  coverage tier ${m.tier} · ${m.quartersHeld} quarters of results · ${m.scoredPeriods ?? 0} scored periods
  available: ${held.join(", ") || "almost nothing"}
  NOT available: ${missing.join(", ") || "nothing missing"}
  pillars scored: ${m.pillarsScored.join(", ") || "none"}
  findings fired: ${m.findingNames.join(", ") || "none"}
  ${m.undisclosed.length ? `classes not disclosed this filing: ${m.undisclosed.join(", ")}` : ""}

⚠ YOU DO NOT SEE ANY FIGURE AND YOU MUST NOT WRITE ONE. No numbers, no percentages, no amounts, no
dates in your prose. Code fills every figure. If a sentence needs a number, write it so the number can
be inserted, or say it qualitatively. A number you invent is the single worst failure here.

BLOCKS YOU MAY PLAN (choose only these ids, only where the data above allows):
${MENU_TEXT}

HOW TO PLAN — this is the product's voice:
  · ANSWER THE QUESTION ASKED. A question about ownership leads with the register and the ownership
    pillar, not with revenue. A general question leads with the business. Order the blocks the way a
    person would answer, not in a fixed sequence.
  · ★ PROSE CARRIES THE REASONING; BLOCKS CARRY THE EVIDENCE. THEY INTERLEAVE. A block is not a
    caption with a chart under it. Every block gets a "lead" saying what is coming and why it follows
    from the last — and, where the figures carry a conclusion the reader would otherwise have to work
    out for themselves, an "after" saying what it showed and what follows from it.
  · WRITE THE "after" WHEREVER THE BLOCK ANSWERS SOMETHING RATHER THAN JUST DISPLAYING IT. A verdict
    with a table under it and nothing joining them is the single most common failure of this product:
    the reader is handed a conclusion and a grid and left to connect them. Omit it only where the
    block genuinely speaks for itself — an epilogue under every card is padding, not reasoning.
  · The "after" is still prose about figures you cannot see. Say what the SHAPE means — that one
    pillar carries the score, that the trend reverses, that a gap is the thing to look at — never a
    number.
  · Do not plan a block whose data is unavailable. Say the gap in prose instead.
  · Never describe our thresholds, weights or bars — those are facts about our model, not the company.
  · Close with a synthesis that pulls the answer together. State what it does NOT mean where useful.
  · Follow-ups must follow from what we actually hold or found — name the Vytal surface for each
    (Ownership tool, Comparison, Fundamentals, Quarterly results, Health score, Findings).

TONE: ${tone.level} — ${tone.depth} depth, jargon: ${tone.jargon}.

REPLY:
{"opening":["1-3 sentences, no figures"],
 "blocks":[{"id":"<menu id>","lead":"one sentence before the block","after":"one or two sentences after it, or omit","pillar":"ownership|foundation|momentum|market (only for id=pillar)"}],
 "close":"the synthesis, no figures",
 "followUps":[{"question":"what a reader would type","surface":"the Vytal surface"}],
 "rationale":"why this order, one line"}`;
}

/**
 * ★ THE DETERMINISTIC PLANNER. Runs when no provider is configured, when the model errors, or when a
 * plan fails admission. It is not a stub — it encodes the same voice as rules, so the product degrades
 * to something correct rather than to nothing.
 *
 * ── ⚠ WHAT STAGE 9 FOUND, AND WHY IT WAS INVISIBLE ────────────────────────────────────────────────
 * This function used to branch on ONE condition: `lens === "ownership"`. Every other question — every
 * operation, every other lens, every timeframe — produced a byte-identical block list. Three separate
 * browser defects were the same line of code:
 *
 *     "show me ten years of TCS history"  → identical to "how is TCS doing"
 *     "why did TCS fall today?"           → identical to "how is TCS doing"
 *
 * The router had classified both correctly (`history`/`price`/10 years, and `explain`/`price`), and
 * the plan threw all of it away. It looked like a routing bug and was not one, which is why it took a
 * live run to see: the slots were right in the log and absent from the answer.
 *
 * It survived because the model planner normally runs in front of it. But the model planner is
 * REJECTED often — unparseable output, a guardrail hit on its close — and every rejection lands here.
 * A fallback that answers a different question than the one asked is not a degraded answer; it is a
 * wrong one, and it arrives looking exactly like a right one.
 *
 * ── ★ SO THE PLAN IS BUILT FROM THE SLOTS, IN THREE LAYERS ───────────────────────────────────────
 *   1. LENS decides what leads — what the reader narrowed to goes first, or nothing did.
 *   2. OPERATION decides what that means — `history` wants a run of quarters, `decompose` wants the
 *      score broken open, `list_findings` wants the checks.
 *   3. The general order fills the rest, so a narrow question still ends with context around it.
 *
 * Blocks are de-duplicated in first-seen order, so a lead block promoted by layer 1 keeps its place
 * when layer 3 would have added it later.
 */
export function deterministicPlan(m: CapabilityManifest, router: RouterOutput): Plan {
  const lens = router.lens;
  const op = router.operation;
  const tf = router.timeframe;
  type B = { id: BlockId; lead: string; pillar?: "ownership" | "foundation" | "momentum" | "market" };
  const out: B[] = [];
  const seen = new Set<BlockId>();
  const has: Record<BlockId, boolean> = {
    business: m.has.latestQuarter || m.has.businessProfile,
    metrics: m.has.quarterHistory || m.has.annualAccounts,
    shareholding: m.has.shareholding,
    score: m.has.pillarBreakdown,
    pillar: m.has.pillarBreakdown,
    findings: true,
    price: m.has.priceSeries,
    quarterSeries: m.has.quarterSeries,
    events: m.has.corporateEvents,
    ownershipEvents: m.has.ownershipEvents,
    ownershipSeries: m.has.ownershipSeries,
    peers: m.has.peerGroup,
    news: m.has.news,
  };
  /** Add a block if we hold its data and it is not already planned. `pillar` needs a scored pillar. */
  const add = (id: BlockId, lead: string, pillar?: B["pillar"]) => {
    if (!has[id] || seen.has(id)) return;
    if (id === "pillar" && (!pillar || !m.pillarsScored.includes(pillar))) return;
    seen.add(id);
    out.push(pillar ? { id, lead, pillar } : { id, lead });
  };

  // ── 1 · WHAT THE READER NARROWED TO LEADS ────────────────────────────────────────────────────
  if (lens === "ownership") {
    add("shareholding", "The register as filed, and how it moved on the previous filing.");
    add("pillar", "How that register reads inside our own score, and what it is built from.", "ownership");
    add("ownershipSeries", "The same register against its own history, so a one-quarter move can be told from a trend.");
    add("ownershipEvents", "What the people closest to it did with their own holdings, as disclosed.");
  } else if (lens === "price") {
    // ★ THE PRICE BLOCK EXISTS AND NO QUESTION EVER REACHED IT. "why did TCS fall today?" resolves
    //   lens=price, and the old body answered it with revenue tables and a shareholding register.
    add("price", "How the market has actually priced it, against its benchmark rather than on its own.");
    add("peers", "Where that leaves it beside the companies it is judged against.");
    add("events", "Anything scheduled or on record that the price would have been reacting to.");
    add("news", "What was being written about it over the same stretch — other people's words, not ours.");
  } else if (lens === "valuation") {
    add("business", "What the business is, and the headline figures the valuation is a multiple of.");
    add("peers", "What the same measures look like across the companies it is judged against.");
    add("score", "And our own reading of the underlying business, which a multiple does not tell you.");
  } else if (lens === "filings") {
    add("ownershipEvents", "What has actually been filed — insider disclosures and block deals, as reported.");
    add("findings", "And whether our checks found anything in them.");
  } else if (lens === "events") {
    add("events", "What is scheduled and what is already on record.");
    add("price", "How the price has moved around them.");
  } else if (lens === "health") {
    add("score", "The score broken into its four pillars, so you can see which part carries it.");
    add("findings", "What tripped a check, or that nothing did.");
    add("metrics", "The figures those pillars are computed from.");
  } else if (lens === "fundamentals") {
    add("business", "What the business is, and the headline figures from the quarter it just reported.");
    add("metrics", "The figures behind that, quarter against quarter and year against year.");
    add("quarterSeries", "And the same lines as a run, so the direction is visible rather than inferred.");
  }

  // ── 2 · WHAT THE READER WANTS DONE WITH IT ───────────────────────────────────────────────────
  if (op === "history") {
    // ⚠ A WINDOW WAS ASKED FOR AND NOTHING READ IT. "show me ten years of TCS history" carried
    //   `timeframe: {years, 10}` all the way here and produced the latest-quarter answer.
    const span = tf?.n ? `${tf.n} ${tf.kind === "years" ? "years" : "quarters"}` : "the period we hold";

    // ★ AND A NARROWED HISTORY IS NOT A BROAD ONE — THE SECOND HALF OF THE SAME DEFECT.
    //
    // ⚠ "what is TCS's revenue trend?" AND "show me ten years of TCS history" RENDERED IDENTICALLY.
    //   Both resolve `operation: "history"`, so this branch answered them with the same three blocks
    //   in the same order and the same words. But they are not the same question: one asks about ONE
    //   FILED LINE and wants the statements; the other asks about the COMPANY OVER TIME and wants the
    //   price and the market beside the filings. A lens is exactly the signal that separates them,
    //   and it was being read one layer up and then ignored here.
    //
    //   The price block is the tell. A revenue-trend question that leads with a price chart has
    //   answered a different question; a ten-year-history question that omits one has answered half
    //   of the right one.
    if (lens === "fundamentals" || lens === "valuation") {
      add("quarterSeries", `Every quarter we hold of that line, as filed — this is ${span} of it in our records.`);
      add("metrics", "The same periods side by side, so a move can be told from a level.");
      add("business", "And what the business is, so the line has something to sit against.");
    } else {
      add("quarterSeries", `Every quarter we hold, as filed — this is what ${span} looks like in our records.`);
      add("price", "The price over the same stretch, against its benchmark.");
      add("metrics", "The year-on-year comparison underneath that run.");
      add("events", "And what was scheduled or on record across the window.");
    }
  } else if (op === "decompose") {
    add("score", "Broken into its four pillars, because the single number hides which part is doing the work.");
    add("findings", "And what specifically tripped a check.");
    add("metrics", "The figures those readings are computed from.");
  } else if (op === "list_findings") {
    add("findings", "Everything our checks raised — and if nothing is listed, the checks ran and came back clear.");
    add("score", "Where those sit inside the score.");
  } else if (op === "compare") {
    add("peers", "Against the companies it is judged with, on the same scale.");
    add("score", "And how its own score is built.");
  } else if (op === "lookup") {
    // ★ CAUGHT BY THE HARNESS (stage 10), AND IT IS THE SAME CLASS AS THE DEFECT THIS FUNCTION WAS
    //   REWRITTEN FOR. `lookup` had no branch, so "how much does TCS spend on R&D" (lookup +
    //   fundamentals) and "tell me about TCS financials" (orient + fundamentals) produced a
    //   byte-identical answer — different operations, one plan. §6.4 uses that exact R&D question as
    //   its worked example of the generic path, and the path was giving it the general answer.
    //
    //   A value question wants the FIGURES first and the framing second; an orientation wants the
    //   business first. Same blocks, deliberately different order and a different opening.
    add("metrics", "The line you asked about, with the periods around it so the figure has a shape.");
    add("quarterSeries", "The same line quarter by quarter, in case one period is not the answer.");
    add("business", "And what the business is, so the figure sits against something.");
  }

  // ── 3 · THE GENERAL ORDER FILLS THE REST, UP TO A CEILING ────────────────────────────────────
  //
  //    A narrow question still ends with some context around it; a broad one is entirely this.
  //
  // ⚠ THE CEILING IS THE POINT, AND WITHOUT IT THE FIX FOR ONE DEFECT CREATED ANOTHER. "why did TCS
  //   fall today?" led correctly with price, peers, events and news — and then this step appended
  //   everything else, producing an ELEVEN-section answer to a one-line question. Answering the
  //   question asked and then also answering every other question is not an improvement on answering
  //   the wrong one; it just buries the right answer in the middle.
  //
  //   A question that narrowed nothing keeps the full general order, because for that question the
  //   general order IS the answer.
  const narrowed = lens !== null || op === "history" || op === "list_findings" || op === "decompose" || op === "lookup";
  const CEILING = narrowed ? 6 : 99;
  const room = () => out.length < CEILING;
  if (room()) add("business", "What the business is, and the headline figures from the quarter it just reported.");
  if (room()) add("metrics", "The figures behind that, quarter against quarter and year against year.");
  if (room()) add("shareholding", "Who actually holds it.");
  if (room()) add("score", "Our own reading of all that is a single score, and it is worth seeing which part carries it.");
  // ⚠ FINDINGS ALWAYS, CEILING OR NOT. "we checked and found nothing" is itself a finding (§4.2), and
  //   dropping it for length turns a clean result into an unanswered question.
  add("findings", "And whether any of that tripped a check.");

  const scored = m.tier === 2 ? ", which we score" : m.tier === 1 ? ", which we do not score yet" : "";
  // The opening names the question rather than the subject alone — the old one said "here is what we
  // hold on X" whatever was asked, which is the same non-answer the block list was giving.
  const opening =
    lens === "price" ? [`Here is how ${m.name} has been priced${scored}, and what we hold around it.`]
    : lens === "ownership" ? [`Here is who holds ${m.name}, and how that has moved.`]
    // ⚠ NOT `windowPhrase` — that one is written for the MODEL and says "not stated" where the reader
    //   named no window, which would reach a reader as "Here is TCS across not stated."
    : op === "history" && (lens === "fundamentals" || lens === "valuation")
      ? [`Here is that line for ${m.name} across ${readerSpan(router)} of filings${scored}.`]
    : op === "history" ? [`Here is ${m.name} across ${readerSpan(router)}${scored}.`]
    : op === "decompose" ? [`Here is what our reading of ${m.name} is built from${scored}.`]
    : op === "list_findings" ? [`Here is what our checks raised on ${m.name}${scored}.`]
    : op === "lookup" ? [`Here is what we hold on that for ${m.name}${scored} — the figures first, and what they sit against underneath.`]
    : [`Here is what we hold on ${m.name}${scored}.`];

  return {
    opening,
    blocks: out,
    close: m.findingNames.length
      ? "Taken together, the figures above sit alongside what our checks flagged — which describes what has been filed, not what happens next."
      : "Taken together, nothing in what we hold was flagged for attention — a statement about our checks, not a forecast.",
    followUps: [],
    rationale: `deterministic: lens=${lens ?? "none"} op=${op} tf=${tf ? `${tf.kind}:${tf.n ?? "?"}` : "none"}`,
  };
}

export interface PlanResult {
  readonly plan: Plan;
  readonly source: "model" | "deterministic" | "cache";
  readonly rejected: string | null;
}

const MODEL = () => process.env.AI_MODEL ?? "gemini-3.5-flash";

export async function planAnswer(
  question: string, m: CapabilityManifest, router: RouterOutput, tone: ToneDirective,
  actor: Actor = { kind: "system", job: "compose-planner" },
): Promise<PlanResult> {
  const fallback = (rejected: string | null): PlanResult =>
    ({ plan: deterministicPlan(m, router), source: "deterministic", rejected });

  // 1 · ★ CACHE FIRST — structure only, prose from the deterministic writer over THIS manifest.
  //     Most planning questions are the same question: "how is X doing" over two tier-2 companies with
  //     the same fields wants the same blocks, and that is the bulk of real request volume.
  const key = planKey(m, router);
  const cached = getStructure(key);
  if (cached) {
    const base = deterministicPlan(m, router);
    return {
      plan: { ...base, blocks: cached.blocks, followUps: cached.followUps, rationale: `cached structure: ${cached.rationale}` },
      source: "cache", rejected: null,
    };
  }

  if ((process.env.AI_PROVIDER ?? "mock") === "mock") return fallback(null);

  // 2 · ★ THE QUOTA GATE, WHICH THIS SURFACE PREVIOUSLY BYPASSED ENTIRELY. `ai/quota.ts` is shared AI
  //     infrastructure (§8.1a) and the planner is its third consumer. Without this the ceiling is not
  //     enforced and the spend is not counted — which is how ~43 calls landed against an 18/day
  //     free-tier model with nothing recording it. A denial is not an error: it falls to the
  //     deterministic planner, so a reader still gets an answer.
  const model = MODEL();
  const decision = await checkAndConsumeAiCall(model, actor);
  if (!decision.allowed) {
    return fallback(`quota: ${decision.scopeDenied ?? "budget"} exhausted for ${model}, resets ${decision.resetAt.toISOString().slice(0, 16)}`);
  }

  try {
    const provider = createAiProvider();
    // ★ `generateStructured` BECAUSE UNPARSEABLE OUTPUT IS DATA, NOT AN EXCEPTION — the adapter
    //   separates "the network failed" from "the model wrote something we cannot read", and those are
    //   different operational facts a planner must log differently.
    const res = await provider.generateStructured<unknown>({
      system: "You output JSON only. No prose outside the JSON.",
      messages: [{ role: "user", content: plannerPrompt(m, router, tone, question) }],
      // ★ SAME FIX, SAME REASON AS THE ROUTER (route.ts). A plan is a SHAPE decision over a fixed
      //   manifest, and the same holdings should yield the same shape — otherwise the plan cache
      //   stores whichever roll of the dice happened to land first and serves it for six hours,
      //   which turns sampling variance into a persisted product decision.
      temperature: 0,
    } as never);

    // Tokens are recorded whatever the outcome — a call that produced garbage still cost what it cost,
    // and a spend log that only counts successes under-reports exactly when you most need it.
    const spent = (res.usage?.promptTokens ?? 0) + (res.usage?.outputTokens ?? 0);
    if (spent > 0) await recordAiTokens(model, spent);

    if (!res.ok) return fallback(`model output unparseable (${res.finishReason ?? "no reason"})`);
    const admitted = admitPlan(res.data, m);
    if (!admitted.ok) return fallback(admitted.why);

    putStructure(key, {
      blocks: admitted.plan.blocks,
      followUps: admitted.plan.followUps,
      rationale: admitted.plan.rationale,
    });
    return { plan: admitted.plan, source: "model", rejected: null };
  } catch (e) {
    return fallback(`provider error: ${(e as Error).message.slice(0, 80)}`);
  }
}
