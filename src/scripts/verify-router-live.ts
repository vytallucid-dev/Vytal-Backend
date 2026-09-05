// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LAYER 2 — THE LIVE ROUTER. Real Gemini. The path production uses, and the one nothing tested.
//
// ── ★ WHY THIS EXISTS AS ITS OWN LAYER ────────────────────────────────────────────────────────────
// Stage 4's adversarial suite used an injected classifier. Stage 8b's corpus used `AI_PROVIDER=mock`
// and the lexical router. Every harness mocked the model to get determinism — so the composition
// layer was genuinely well tested and **the layer deciding which composition runs had never been
// exercised live**. That single gap explains most of what the first browser pass found.
//
// ── ★ INVARIANTS, NOT GOLDEN SLOTS, AND §6.5 IS THE REASON ───────────────────────────────────────
// The obvious design is a golden file of expected slots per question. It would flap on day one:
// §6.5 measured the model at 80–88% run-to-run agreement, and the classification cache is IN-MEMORY,
// so every process start re-rolls every question. A suite that goes red because a near-tie landed the
// other way is a suite that gets ignored, and then the real failure lands in an ignored suite.
//
// So nothing here asserts an exact slot. Each assertion is a property that must hold WHATEVER the
// model returned — and each is a property whose violation was a real defect:
//
//   R1  a subject we hold is never out of scope        ← "how is SHIPROCKET doing" → out_of_scope
//   R2  a genuinely foreign question still stops       ← the negative control on R1
//   R3  a bare ticker is never a full orientation      ← typing "TCS" returned seven sections
//   R4  an ambiguous mention offers candidates         ← three candidates, dropped before the reader
//   R5  a two-company question resolves two subjects   ← comparisons answered about one of them
//   R6  a request renders a control                    ← every action button
//   R7  the reader's own book is in scope              ← scope alone forced it out
//   R8  one question, one classification               ← §6.5's cache guarantee, measured
//   R9  a live-routed answer obeys every layer-1 invariant
//
// ── ★ COST ───────────────────────────────────────────────────────────────────────────────────────
// One model call per distinct question (the router), plus the planner where a question reaches it.
// The set below is deliberately small — 13 questions — and R8 re-asks two of them, which is free
// because the cache serves them. Budget is 480/day on `gemini-3.5-flash-lite`; a full run is well
// under 40. Paced at 4.5s between turns: stage 9 hit a 429 at speed and degraded to lexical, which
// would have silently turned this into a test of the fallback.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { route, modelClassifier } from "../router/route.js";
import { composeTurn } from "../composition/compose.js";
import { checkAnswer, type Violation } from "../harness/invariants.js";
import { findBookFixture, SUBJECTS } from "../harness/fixtures.js";
import type { RoutedTurn } from "../router/contract.js";
import type { TurnResult } from "../composition/compose.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const section = (s: string) => console.log(`\n══ ${s} ══`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const S = SUBJECTS;
/** ★ A SUBJECT WE HOLD THAT THE MODEL PLAUSIBLY DOES NOT KNOW — the R1 case, and the real one. */
const RECENT_LISTING = process.env.HARNESS_RECENT_LISTING ?? "SHIPROCKET";

interface Live { q: string; turn: RoutedTurn; res: TurnResult }

async function main() {
  console.log("★ LAYER 2 — THE LIVE ROUTER (real Gemini · the path production uses)");
  const model = process.env.AI_MODEL ?? "(unset)";
  const provider = process.env.AI_PROVIDER ?? "mock";
  console.log(`     provider=${provider} model=${model}`);

  // ⚠ THE ONE THING THAT WOULD MAKE EVERY ASSERTION BELOW MEANINGLESS. With no provider the router
  //   degrades to the lexical classifier and this file quietly becomes a second, worse copy of layer 1.
  if (provider === "mock") {
    console.log("  ❌ AI_PROVIDER=mock — the live router cannot be tested. This gate did NOT run.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const book = await findBookFixture();
  const reader = book && book.missing.length === 0 ? { userId: book.userId } : null;
  if (!reader) console.log("     ⚠ no usable book fixture — R7 will be reported as unexercised");

  const QUESTIONS: readonly { id: string; q: string; scoped: boolean }[] = [
    { id: "recent listing", q: `how is ${RECENT_LISTING} doing`, scoped: false },
    { id: "healthy orient", q: `how is ${S.healthy} doing`, scoped: false },
    { id: "bare ticker", q: S.healthy, scoped: false },
    { id: "ambiguous", q: "how is HDFC doing", scoped: false },
    { id: "comparison", q: `compare ${S.healthy} and ${S.bank}`, scoped: false },
    { id: "history window", q: `show me ten years of ${S.healthy} history`, scoped: false },
    { id: "price why", q: `why did ${S.healthy} fall today?`, scoped: false },
    { id: "advice", q: `should I buy ${S.healthy}?`, scoped: false },
    { id: "ownership", q: `who owns ${S.healthy}`, scoped: false },
    // ═══ ★★ PHASE 1 · BATCH 1 — THREE QUESTIONS, AND EACH IS HERE FOR A PROPERTY R9 CANNOT REACH
    //     WITHOUT IT. The bar for an authored family is that a LIVE-GEMINI assertion covers it, and
    //     the layer-1 matrix drives a FIXED classifier by design (see matrix.ts) — so until these
    //     rows existed, `I-BASIS`, `I-PLEDGE-SILENT` and `I-STEPPED` had never run over an answer the
    //     real model routed. R9 flat-maps `checkAnswer` across everything in this set, so adding the
    //     questions is what puts the new invariants on the live path; no per-slot assertion is added,
    //     because §6.5's 80–88% agreement is exactly why this file asserts properties and not slots.
    //
    //     ⚠ THE BANK, NOT THE HEALTHY SUBJECT, FOR THE STATEMENT. The basis is chosen per industry
    //       family: measured live, TCS reads consolidated and HDFCBANK reads standalone. A basis
    //       assertion that only ever saw one family has been run against half the contract.
    { id: "statement · bank basis", q: `how much debt does ${S.bank} carry`, scoped: false },
    // ⚠ THE T08 MISROUTE'S OWN SENTENCE. It classifies identically to "who owns TCS" above, so the
    //   pair is what proves the two are answered differently on the live path rather than by a
    //   fixed classifier that was told the answer.
    { id: "ownership · dealing", q: `have ${S.deepOwnership} insiders been buying or selling`, scoped: false },
    // ⚠ THE MISS-LOG'S ONE GENUINE READER ROW — subjectless by design (§6.4).
    { id: "ownership · market-wide", q: "what has changed in promoter holdings this quarter", scoped: false },
    // ═══ ★★ PHASE 1 · BATCH 2 — THREE QUESTIONS, ONE PER FAMILY, EACH FOR A PROPERTY R9 CANNOT REACH
    //     WITHOUT IT. Same reasoning as the batch-1 rows: the layer-1 matrix drives a FIXED classifier
    //     by design, so until these existed `I-DENOMINATOR` and `I-FRAME-STATED` had never run over an
    //     answer the real model routed. No per-slot assertion is added — §6.5's 80–88% agreement is
    //     exactly why this file asserts properties rather than slots.
    //
    //     ⚠ THE PEER QUESTION IS THE ONE WHOSE SLOT IS LEAST STABLE. Measured across two live runs it
    //       arrived as `compare` and as `screen`, both with one subject — which is why the family
    //       claims both and why the answer must not depend on which came back.
    { id: "peers · standing", q: `how does ${S.healthy} compare with its peer group`, scoped: false },
    // ★★ THE UNSCORED POND — 10 of 23 ponds have zero scored members, so the roster must carry no
    //    score column and the answer must say there is no median rather than draw an empty one.
    { id: "peers · unscored pond", q: `who are ${S.nbfc}'s peers`, scoped: false },
    // ★★ THE FRAME DECLINE.
    //
    // ⚠ THIS COMMENT USED TO SAY "classifies **out_of_scope** on the live model, so it also exercises
    //   the narrow override in compose.ts step 1". THAT IS NO LONGER TRUE and the verification pass
    //   measured it: 5 rolls out of 5 with ROUTER_CACHE=off return `in_scope / screen / valuation`.
    //   The row still belongs here — it is the frame decline on the live path — but it does NOT reach
    //   step 1's override any more, so nothing here exercises that branch. Corrected rather than
    //   deleted, because a stale claim about which path a test covers is worse than no claim.
    //
    // ⚠ AND WHEN THE MODEL CALL FAILS, THIS ROW IS THE ONE THAT SHOWS IT. Degraded to lexical it
    //   classifies `unresolved` with no subject, which reaches `clarify_operation` BEFORE the screen
    //   path — so the reader gets "I am not sure what you are asking" for a question the product has a
    //   designed answer to. That happened once in 34 turns on the pass's own run.
    { id: "screen · declined frame", q: "show me undervalued stocks", scoped: false },
    // ═══ ★★ PHASE 2 · BATCH 1 — THE TWO FAMILIES THAT SHARE EVERY SLOT ═════════════════════════
    //
    // ⚠ THESE EXIST FOR ONE PROPERTY THE FIXED-CLASSIFIER MATRIX STRUCTURALLY CANNOT TEST: whether
    //   the LIVE model's slot roll changes which family answers. T · Trajectory and A · Attribution
    //   both claim `{orient|…, health, subject required}` and are separated only by
    //   `healthQuestion()` — a code read of the SENTENCE. The matrix drives fixed slots by design, so
    //   it proves the partition holds for the slots it names and can say nothing about the ones the
    //   model actually produces. §6.5's 80–88% is exactly the gap.
    //
    // ★ THE ASSERTION IS ON THE FAMILY, NOT THE SLOT — see R12. A history question may legitimately
    //   arrive as `history` or as `orient · health`; what must NOT vary is which answer it gets.
    { id: "trajectory · arc", q: `how has ${S.healthy}'s score moved over time`, scoped: false },
    { id: "attribution · cause", q: `what is dragging ${S.healthy}'s score down`, scoped: false },
    { id: "attribution · why", q: `why is ${S.bank} scored the way it is`, scoped: false },
    { id: "out of scope", q: "what is Justin Bieber's income", scoped: false },
    { id: "action add", q: `add ${S.healthy} to my watchlist`, scoped: true },
    { id: "action alert", q: `alert me when ${S.bank} drops below 1400`, scoped: true },
    { id: "reader book", q: "how is my portfolio doing", scoped: true },

    // ═══ THE VERIFICATION PASS — THE SEVEN FAMILIES THIS FILE HAD NEVER ROUTED LIVE ══════════════
    //
    // Three phases authored sixteen families and this set covered NINE of them. The other seven were
    // built entirely against the LEXICAL classifier and the fixed-slot matrix, which is the exact
    // shape of the gap this file was created to close — so every row below is a family whose live
    // routing has never once been observed.
    //
    // ⚠ AND ONE OF THEM IS THE REASON. Phase 3 found that "why is X scored the way it is" arrives as
    //   `explain` from the model and `decompose` from the lexical path — an operation NO family had
    //   claimed, so it fell to the planner and produced an answer with none of the authored copy.
    //   That was invisible to every offline gate. These rows are looking for its siblings.

    // ── PT · Patterns. Never routed live; `findingsAsked` is a code read of the sentence. ──────────
    { id: "patterns · flagged", q: `what has been flagged on ${S.healthy}`, scoped: false },
    { id: "patterns · thin subject", q: `what has been flagged on ${S.thinTier1}`, scoped: false },

    // ── M · Meta. Subjectless BY PREDICATE (`subject: "none"`), so a model that resolves a subject
    //    out of "what does Foundation mean" silently unclaims the family. Worth watching. ──────────
    { id: "meta · definition", q: "what does Foundation mean", scoped: false },
    { id: "meta · how it works", q: "how does the health score work", scoped: false },

    // ── XT · Extended coverage. The 194 companies that were FIGURE-LESS until Phase 3, one per
    //    industry family, because the hole was per-family and a single row would have missed it. ───
    { id: "xt · nbfc", q: `how is ${S.nbfc} doing`, scoped: false },
    { id: "xt · life insurer", q: "how is HDFCLIFE doing", scoped: false },
    { id: "xt · general insurer", q: "how is GICRE doing", scoped: false },

    // ── DX · Failure modes. The window shortfall, and a REAL listed company we do not hold — which
    //    is a different stop from the Bieber row above and must not be answered about. ─────────────
    { id: "dx · window shortfall", q: `show me ${S.healthy}'s score over the last 20 quarters`, scoped: false },
    { id: "dx · foreign listed", q: "how is TSLA doing", scoped: false },

    // ── ★ THE PHASE 3 EXPECTATION, STATED AS A QUESTION RATHER THAN ASSUMED ───────────────────────
    //   Phase 3 measured this as `lens: health, operation: UNRESOLVED` on the lexical path and wrote
    //   that "the model classifier is expected to resolve it". That expectation has never been tested.
    { id: "dx · how healthy", q: `how healthy is ${S.healthy}`, scoped: false },

    // ── DP · Depth and prose. The register reaches PROSE only; this row is here so R9 runs over an
    //    answer the live model routed while a register is in force. ────────────────────────────────
    { id: "dp · plainly", q: `explain ${S.healthy}'s score simply`, scoped: false },

    // ── PB · Portfolio, beyond the book row above — a HEALTH question about the book. ─────────────
    { id: "pb · holdings health", q: "what is the health of my holdings", scoped: true },
  ];

  section("0 · routing every question through the real model");
  const live = new Map<string, Live>();
  let degraded = 0;
  for (const { id, q, scoped } of QUESTIONS) {
    const who = scoped ? reader : null;
    const turn = await route(q, modelClassifier, who);
    const res = await composeTurn(turn, who);
    live.set(id, { q, turn, res });
    const r = turn.router;
    if (r.source !== "model") degraded++;
    console.log(
      `     ${id.padEnd(16)} scope=${r.scope} op=${r.operation} lens=${r.lens ?? "-"} act=${r.action ?? "-"} ` +
      `subj=[${turn.subjects.map((s) => (s.kind === "stock" ? s.symbol : s.kind)).join(",")}] → ${res.kind}` +
      `${res.kind === "composed" ? `/${res.compositionId}` : ""}${r.source !== "model" ? "  ⚠ DEGRADED" : ""}`,
    );
    await sleep(4500);
  }

  // ⚠ THE ASSERTION THAT KEEPS THIS FILE HONEST. A rate limit or a quota denial degrades every turn
  //   to the lexical classifier — and every assertion below would still pass, while testing the
  //   fallback rather than the model. That is this layer's own version of passing on nothing.
  ok("every turn actually reached the model", degraded === 0,
    degraded === 0 ? `${QUESTIONS.length}/${QUESTIONS.length} model-classified` : `${degraded} turn(s) fell back to lexical — these results are NOT about the live router`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ A TOTAL DEGRADE STOPS HERE, AND IT STILL FAILS. Added Phase 2 · Batch 1.
  //
  // ⚠ THE ASSERTION ABOVE WAS HONEST AND THE REPORT BELOW IT WAS NOT. On a day when the daily model
  //   budget is spent, every turn falls back to the lexical classifier — which is DELIBERATELY
  //   under-confident and answers `unresolved` wherever the model would have answered. The file then
  //   ran all twenty-odd assertions against that output and printed ten failures, each phrased as a
  //   product defect ("the declined frame was ANSWERED rather than refused", "the phase spine NOT
  //   REACHED"). Not one of them had been tested. A reader of that output would spend an afternoon
  //   in the wrong files.
  //
  // ★ IT DOES NOT SKIP AND IT DOES NOT PASS. `verify:router-live` exists to say something about the
  //   live router; when it cannot, the run is a failure with ONE cause — the same rule
  //   `harness/fixtures.ts` states for a missing book ("a missing fixture must never be a quiet skip,
  //   because a quiet skip is indistinguishable from a pass"). What changes is the number of things
  //   it claims to have found, not whether it failed.
  //
  // ⚠ A PARTIAL DEGRADE KEEPS GOING. One turn falling back is rate-limiting or a flake, and the other
  //   nineteen still carry real information about the live router. Only a TOTAL denial means nothing
  //   below this line was exercised.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (degraded === QUESTIONS.length) {
    const why = [...live.values()].map((x) => x.turn.router.degradedReason).find(Boolean) ?? "unknown";
    console.log("\n" + "═".repeat(100));
    console.log("⚠ EVERY TURN FELL BACK TO THE LEXICAL CLASSIFIER — NOTHING BELOW THIS LINE WAS EXERCISED.");
    console.log(`   reason: ${why}`);
    console.log("   This gate asserts properties of the LIVE router. Run it again once the model is");
    console.log("   reachable; the daily window is set by AI_BUDGET_FLASH_LITE and resets on the");
    console.log("   quota timezone's midnight. The remaining checks are NOT reported, because a");
    console.log("   result computed from the fallback is not a result about the router.");
    console.log("═".repeat(100));
    console.log(`\n❌ FAILED — ${pass} passed, ${fail} failed (of which: the model was unreachable)`);
    process.exit(1);
  }

  const L = (id: string) => live.get(id)!;

  // ── R1 ────────────────────────────────────────────────────────────────────────────────────────
  section("1 · scope is ours to decide, not the model's");
  {
    const x = L("recent listing");
    const resolved = x.turn.subjects.length > 0;
    ok(`R1 · ${RECENT_LISTING} resolves and is therefore in scope`, resolved && x.turn.router.scope === "in_scope",
      `resolved=${resolved} scope=${x.turn.router.scope}${x.turn.corrections.length ? ` · corrections: ${x.turn.corrections.join("; ")}` : ""}`);
    ok(`R1b · and it is answered rather than refused`, x.res.kind !== "out_of_scope", `→ ${x.res.kind}`);
  }
  {
    // ★ THE NEGATIVE CONTROL ON R1. If the override rescued everything, R1 would be meaningless.
    const x = L("out of scope");
    ok("R2 · a genuinely foreign question still stops", x.res.kind === "out_of_scope",
      `→ ${x.res.kind}${x.turn.subjects.length ? ` (resolved ${x.turn.subjects.length} subjects — the override would have rescued it)` : " (no mentions resolved)"}`);
  }

  // ── R3 ────────────────────────────────────────────────────────────────────────────────────────
  section("2 · a bare subject is not a question");
  {
    const bare = L("bare ticker"), full = L("healthy orient");
    const bareSections = bare.res.kind === "composed" ? bare.res.sections.length : 0;
    const fullSections = full.res.kind === "composed" ? full.res.sections.length : 0;
    ok("R3 · a lone ticker does not return the full orientation",
      bare.res.kind !== "composed" || bareSections < fullSections,
      `"${S.healthy}" → ${bare.res.kind} (${bareSections} sections) vs "how is ${S.healthy} doing" → ${fullSections}`);
  }

  // ── R4 ────────────────────────────────────────────────────────────────────────────────────────
  section("3 · ambiguity offers candidates and never picks silently");
  {
    const x = L("ambiguous");
    const picked = x.turn.subjects.length;
    const offered = x.res.kind === "clarify_subject"
      ? x.res.render.sections.flatMap((s) => ((s.payload as { chips?: unknown[] }).chips ?? [])).length
      : 0;
    ok("R4 · an ambiguous mention resolves nothing and offers candidates",
      picked === 0 && offered >= 2, `picked=${picked} candidates offered=${offered}`);
  }

  // ── R5 · R6 · R7 ──────────────────────────────────────────────────────────────────────────────
  section("4 · slots the answer must keep");
  {
    const x = L("comparison");
    ok("R5 · a two-company question resolves two subjects",
      x.turn.subjects.length >= 2, `[${x.turn.subjects.map((s) => (s.kind === "stock" ? s.symbol : s.kind)).join(", ")}]`);
  }
  for (const id of ["action add", "action alert"] as const) {
    const x = L(id);
    const hasControl = x.res.kind === "composed" && x.res.sections.some((s) => s.kind === "ACTION");
    ok(`R6 · "${x.q}" renders a control`, hasControl,
      `action=${x.turn.router.action ?? "null"} → ${x.res.kind}${hasControl ? " with an ACTION section" : ""}`);
  }
  {
    const x = L("reader book");
    if (!reader) ok("R7 · the reader's own book is in scope", false, "NO BOOK FIXTURE — unexercised, not satisfied");
    else ok("R7 · the reader's own book is in scope",
      x.turn.router.perspective === "reader" && x.res.kind === "composed" && x.res.compositionId.startsWith("reader."),
      `perspective=${x.turn.router.perspective} → ${x.res.kind === "composed" ? x.res.compositionId : x.res.kind}`);
  }

  // ── R8 ────────────────────────────────────────────────────────────────────────────────────────
  section("5 · one question, one classification (§6.5's cache guarantee, measured)");
  {
    let same = 0;
    const probes = ["healthy orient", "ownership"] as const;
    for (const id of probes) {
      const first = L(id).turn.router;
      const again = await route(L(id).q, modelClassifier, null);
      const a = JSON.stringify({ s: first.scope, o: first.operation, l: first.lens, p: first.perspective, act: first.action });
      const b = JSON.stringify({ s: again.router.scope, o: again.router.operation, l: again.router.lens, p: again.router.perspective, act: again.router.action });
      if (a === b) same++;
      else console.log(`     ✗ "${L(id).q}"\n        first: ${a}\n        again: ${b}`);
    }
    // ⚠ EXACT, NOT A RATIO. Within one process the cache makes this deterministic by construction —
    //   §6.5's whole ruling. A miss here means the cache is not doing the job it was built for, which
    //   is a defect in the determinism guarantee rather than variance in the model.
    ok("R8 · re-asking the same question returns the same classification", same === probes.length,
      `${same}/${probes.length} identical (served from the classification cache — 0 extra model calls)`);
  }

  // ── R9 ────────────────────────────────────────────────────────────────────────────────────────
  section("6 · a live-routed answer obeys every layer-1 invariant");
  {
    const answers = [...live.values()].map(({ q, res }) => ({
      label: `live · ${q}`, question: q,
      compositionId: res.kind === "composed" ? res.compositionId : res.kind,
      sections: (res.kind === "composed" ? res.sections : res.render.sections).map((s) => ({ kind: s.kind, renderer: s.renderer, payload: s.payload })),
      prose: res.kind === "composed" ? res.prose : res.render.prose,
    }));
    const sections = answers.reduce((n, a) => n + a.sections.length, 0);
    // The population rule again — an empty set would make the line below pass on nothing.
    ok("the live answer set is populated", answers.length >= 10 && sections >= 30,
      `${answers.length} answers · ${sections} sections`);
    const vs: Violation[] = answers.flatMap(checkAnswer);
    ok("R9 · no invariant fires on a live-routed answer", vs.length === 0, vs.length ? `${vs.length} violations` : "clean");
    for (const v of vs.slice(0, 10)) console.log(`     ✗ [${v.invariant}] ${v.where}\n        ${v.detail}`);
  }

  // ── R10 ───────────────────────────────────────────────────────────────────────────────────────
  //
  // ★ THE POPULATION RULE, APPLIED TO THE TWO FAMILIES AUTHORED AT PHASE 1 · BATCH 1. R9 asserts that
  //   no invariant fires on a live answer — which passes trivially if the live set never renders the
  //   surfaces those invariants guard. `I-BASIS` over a set containing no statement table is a green
  //   tick on nothing, and that is §9.3's own failure mode wearing this file's badge.
  //
  // ⚠ IT DELIBERATELY ASSERTS THE SURFACE, NOT THE SLOTS. "A statement table was rendered somewhere
  //   in this set" holds whatever the model returned for any individual question; "this question
  //   produced fundamentals.balance_sheet" would flap at §6.5's measured 80–88% agreement, and a
  //   suite that flaps is a suite that gets ignored.
  section("7 · the surfaces the new invariants guard were actually rendered");
  {
    const all = [...live.values()].flatMap(({ res }) =>
      (res.kind === "composed" ? res.sections : res.render.sections).map((x) => `${x.kind}:${x.renderer}`));
    const seen = new Set(all);
    ok("R10 · a filed statement reached the live path — I-BASIS has something to guard",
      seen.has("SERIES:statement-table"), seen.has("SERIES:statement-table") ? "statement-table rendered" : "NOT RENDERED — I-BASIS passed on nothing");
    ok("R10 · a shareholding register reached the live path — I-PLEDGE-SILENT has something to guard",
      seen.has("DECOMPOSITION:ownership-split"), seen.has("DECOMPOSITION:ownership-split") ? "ownership-split rendered" : "NOT RENDERED — I-PLEDGE-SILENT passed on nothing");
    // ⚠ AND THE TWO OWNERSHIP QUESTIONS MUST NOT PRODUCE ONE ANSWER. This is the T08 misroute stated
    //   as a live property: same slots, different sentence, different answer. It compares the two
    //   answers to each other rather than either to an expected shape, so no slot is asserted.
    // ⚠ KEYED BY `id`, NOT BY THE QUESTION — see `live.set(id, …)` above. The first draft looked
    //   these up by question text and got `undefined` for both, so the assertion reported the pair as
    //   UNEXERCISED while the two answers were in fact composing correctly and differently. A lookup
    //   that misses reads exactly like a defect, which is why the branch says UNEXERCISED rather than
    //   passing quietly.
    const reg = live.get("ownership");
    const deal = live.get("ownership · dealing");
    if (reg?.res.kind === "composed" && deal?.res.kind === "composed") {
      const shape = (r: TurnResult) => r.kind === "composed" ? r.sections.map((x) => `${x.kind}:${x.renderer}`).join("|") : r.kind;
      ok("R10 · the register question and the dealing question do not produce one answer",
        shape(reg.res) !== shape(deal.res) || reg.res.compositionId !== deal.res.compositionId,
        `${reg.res.compositionId} vs ${deal.res.compositionId}`);
    } else {
      ok("R10 · the register question and the dealing question do not produce one answer", false,
        "one of the two did not compose — UNEXERCISED");
    }
  }

  // ── R11 ───────────────────────────────────────────────────────────────────────────────────────
  //
  // ★ THE POPULATION RULE AGAIN, FOR BATCH 2's SURFACES. R9 passes trivially over a set that never
  //   renders the things the new invariants guard: `I-DENOMINATOR` over a set with no aggregate is a
  //   green tick on nothing, and `I-FRAME-STATED` only ever fires on a declined answer.
  section("8 · the surfaces the Batch 2 invariants guard were actually rendered");
  {
    const composed = [...live.values()].filter((x) => x.res.kind === "composed");
    const ids = composed.map((x) => (x.res as Extract<TurnResult, { kind: "composed" }>).compositionId);
    ok("R11 · a declined frame reached the live path — I-FRAME-STATED has something to guard",
      ids.some((i) => /declined/.test(i)),
      ids.some((i) => /declined/.test(i)) ? "a frame decline composed" : "NOT REACHED — I-FRAME-STATED passed on nothing");
    ok("R11 · a peer roster reached the live path — I-DENOMINATOR has something to guard",
      ids.some((i) => /^peers\./.test(i)),
      ids.filter((i) => /^peers\./.test(i)).join(", ") || "NOT REACHED — no peer answer composed");

    // ⚠ AND THE FRAME DECLINE MUST NOT HAVE BEEN A REFUSAL. "show me undervalued stocks" is a question
    //   about Indian listed companies; answering it with "that is outside what Vytal covers" states
    //   something false about our own coverage, which is worse than declining the frame.
    const declined = live.get("screen · declined frame");
    ok("R11 · the declined frame was ANSWERED rather than refused",
      declined?.res.kind === "composed",
      declined ? `kind=${declined.res.kind}` : "question missing from the live set");

    // ★ AND THE UNSCORED POND MUST NOT CLAIM A MEDIAN. This is the family's own constraint asserted on
    //   the live path: a pond we score nothing in has no aggregate to state, and stating one would be
    //   a figure over an empty set.
    const pond = live.get("peers · unscored pond");
    if (pond?.res.kind === "composed") {
      const t = pond.res.sections.find((x) => x.renderer === "set-table");
      const totals = ((t?.payload ?? {}) as { totals?: { label: string; value: string | null }[] }).totals ?? [];
      const claimsMedian = totals.some((x) => /median/i.test(x.label) && x.value !== null);
      ok("R11 · an unscored pond states no median", !claimsMedian,
        claimsMedian ? "a median was stated over a pond with no scored members" : "no aggregate claimed");
    } else {
      ok("R11 · an unscored pond states no median", false, "the unscored pond did not compose — UNEXERCISED");
    }
  }

  // ── R12 ───────────────────────────────────────────────────────────────────────────────────────
  //
  // ★★ THE PARTITION, ASSERTED AGAINST THE MODEL RATHER THAN AGAINST A FIXED SLOT. This batch shipped
  //    the defect it guards: both families claimed `orient · health`, `compose.ts` step 4 takes the
  //    FIRST match in an ordered array, and "what is dragging TCS's score down" — the literal second
  //    example in `attribution.ts` — was answered by `trajectory.arc` with a phase chart and no
  //    decomposition. Nothing failed; a reasonable answer to a different question rendered.
  section("9 · two families share every slot — the SENTENCE decides, not the array position");
  {
    const want: [string, string][] = [
      ["trajectory · arc", "trajectory."],
      ["attribution · cause", "attribution."],
      ["attribution · why", "attribution."],
    ];
    for (const [id, prefix] of want) {
      const r = live.get(id);
      const got = r?.res.kind === "composed"
        ? (r.res as Extract<TurnResult, { kind: "composed" }>).compositionId
        : (r?.res.kind ?? "missing");
      // The slot the model actually returned, printed rather than asserted — it is allowed to vary,
      // and printing it is what makes a future failure diagnosable in one read.
      const slot = r ? `${r.turn.router.operation}/${r.turn.router.lens ?? "-"}` : "?";
      ok(`R12 · "${id}" reached the right family whatever the model rolled`,
        got.startsWith(prefix), `${got} (model said ${slot})`);
    }

    // ⚠ AND THE TWO MUST NOT PRODUCE ONE ANSWER. `I-DISTINCT` caught exactly this at layer 1 when
    //   A had no lead of its own; here the same property is checked on whatever the live model routed.
    const a = live.get("trajectory · arc");
    const b = live.get("attribution · cause");
    if (a?.res.kind === "composed" && b?.res.kind === "composed") {
      const sa = a.res as Extract<TurnResult, { kind: "composed" }>;
      const sb = b.res as Extract<TurnResult, { kind: "composed" }>;
      const same = JSON.stringify(sa.prose.opening) === JSON.stringify(sb.prose.opening);
      ok("R12 · a history question and a cause question do not open with the same words", !same,
        same ? "identical openings" : "the two openings differ");
    } else {
      ok("R12 · a history question and a cause question do not open with the same words", false,
        "one of the two did not compose — UNEXERCISED");
    }

    // ★ AND THE DERIVED OBJECT MUST CARRY ITS METHOD ON THE LIVE PATH TOO. `I-DERIVED-METHOD` only
    //   ever fires where a phase spine actually rendered; if the live router never produces one, that
    //   invariant is a green tick over nothing.
    const traj = live.get("trajectory · arc");
    if (traj?.res.kind === "composed") {
      const spine = (traj.res as Extract<TurnResult, { kind: "composed" }>)
        .sections.find((x) => x.renderer === "phase-shaded-spine");
      const p = (spine?.payload ?? {}) as { methodNote?: string; basisNote?: string };
      ok("R12 · the phase spine reached the live path, carrying its method and its basis",
        Boolean(spine) && Boolean(p.methodNote) && Boolean(p.basisNote),
        spine ? `method=${Boolean(p.methodNote)} basis=${Boolean(p.basisNote)}` : "NOT REACHED — I-DERIVED-METHOD passed on nothing");
    } else {
      ok("R12 · the phase spine reached the live path, carrying its method and its basis", false,
        "the trajectory question did not compose — UNEXERCISED");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 10 · MT · THE REFERENT — a bare "why" routed by WHAT IS ON SCREEN, on the live model.
  //
  // ⚠ NOTHING IN THIS FILE HAD EVER PASSED A PRIOR TURN. Every row above is a single question with a
  //   null context, so MT — a family whose whole subject is the SECOND turn — was built entirely
  //   against the lexical path and the fixed-slot matrix. `TurnContext.lastFamily` and the
  //   `BY_FAMILY` referent map have never been exercised by a model roll.
  //
  // ★ THE WORD IS THE SAME AND THE ANSWER MUST NOT BE. That is the whole rule, and it is asserted
  //   here as a property — three distinct families — rather than as three expected slots, for §6.5's
  //   reason.
  //
  // ★ AND IT IS NEARLY FREE. The classification cache is keyed on QUESTION TEXT, so "why" costs one
  //   model call however many times it is asked; the prior context is applied after classification.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section("10 · MT · one word, three screens (the referent, live)");
  {
    const priors: readonly { label: string; ctx: Record<string, unknown> }[] = [
      { label: "after fundamentals", ctx: { lens: "fundamentals", operation: "lookup", lastFamily: "fundamentals" } },
      { label: "after ownership", ctx: { lens: "ownership", operation: "lookup", lastFamily: "ownership" } },
      { label: "after patterns", ctx: { lens: null, operation: "list_findings", lastFamily: "patterns" } },
    ];
    const landed: string[] = [];
    for (const pr of priors) {
      const prior = {
        subjects: [{ kind: "stock", symbol: S.healthy, name: S.healthy }],
        perspective: "market", raw: "", router: {}, ...pr.ctx,
      } as never;
      const turn = await route("why", modelClassifier, null, prior);
      const res = await composeTurn(turn);
      const id = res.kind === "composed" ? res.compositionId : res.kind;
      landed.push(id);
      console.log(`     "${pr.label}" -> op=${turn.router.operation} lens=${turn.router.lens ?? "-"} => ${id}`);
      await sleep(1500);
    }
    ok("R13 · a bare why reaches three different answers depending on the screen",
      new Set(landed).size === 3, `${new Set(landed).size} distinct — ${landed.join(" · ")}`);
    // ⚠ AND THE NEGATIVE HALF: none of them may be the planner. Falling through is what MT was built
    //   to stop, and a planner answer would LOOK fine while proving the referent map never ran.
    const planned = landed.filter((x) => x.startsWith("planned:"));
    ok("R13 · none of the three fell through to the planner", planned.length === 0,
      planned.length ? `${planned.length} fell through: ${planned.join(", ")}` : "all three were claimed by a family");
  }
  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
