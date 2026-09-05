// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ BEFORE YOU RUN THIS: `verify:harness` IS A STRICT SUBSET OF `verify:live`. RUN ONE.
//
//   verify:harness  = selftest · routes · THIS FILE
//   verify:live     = selftest · routes · THIS FILE · t5-omission-keys · evaluative-tier ·
//                     number-grounding · phs-pd-readtime · filing-model-facing · bse-lane
//
// Running both — which is the obvious thing to type, and which was done repeatedly through Phase 2 —
// builds the matrix TWICE FOR ONE RESULT. The matrix is ~93 cases, each composing a whole answer
// against the live database, and this file builds it twice again for the two planner arms. So
// `verify:harness && verify:live` is FOUR matrix builds where one command needs two. That was the
// single largest avoidable cost in the batch, and nothing asked for it.
//
// ★ WHICH TO RUN:
//     working on the answer layer   `npm run verify:ai`       typecheck + the 16 copy gates that can
//                                                             break + cross-repo + this
//     iterating inside one family   `npm run verify:ai-fast`  the same, one matrix arm (see §3)
//     before calling it done        `npm run build` once, then `verify:live`, `verify:browser`,
//                                   `verify:ux`, `verify:router-live`
//
// ⚠ AND `npm run build` IS 29 COPY GATES, OF WHICH 13 GUARD SUBSYSTEMS THE ANSWER LAYER CANNOT TOUCH
//   (BSE parsing, ingestion write semantics, the quarter-brief surface, results-season, session
//   dates). They are welded into the build because the build is the contract; they do not need to run
//   between two edits to a composition file. `verify:ai-copy` is the sixteen that do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LAYER 1 — THE ANSWER INVARIANTS. Deterministic, no model, no browser, DB read-only.
//
//   §1  the fixtures are real and populated enough to be evidence (§9.3)
//   §2  the matrix, with the MODEL planner in front (the normal path)
//   §3  ★ the matrix with the FALLBACK PLANNER ALONE — the arm that would have caught `deterministicPlan`
//   §4  every per-answer invariant over both arms
//   §5  ★ SLOTS SURVIVE — the router was right and the answer lost it (four of stage 9's seven)
//   §6  ★ DISTINCTNESS — two different questions must not produce one answer
//   §7  multi-turn: the rules that only meet when there is a prior turn
//   §8  ★ THE CLIENT CONTRACT — the two client-only defects and the unread-payload-field one
//
// ── ★ WHY §8 LIVES HERE RATHER THAN IN ITS OWN SCRIPT ─────────────────────────────────────────────
// It was its own script for one round and cost 147 seconds, ALL of it rebuilding a matrix this file
// had already built. C3 checks its contract against the sections the product actually emits, so it
// needs the matrix; building it twice in two processes is two minutes spent proving the same thing
// twice. One gate, one matrix, both families of check.
//
// ── ★ WHAT THIS LAYER IS FOR, AND WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────
// It costs ZERO model calls and runs in seconds, so it can sit inside `verify:live` and run on every
// change. That is the whole design constraint: a suite that cannot run on every change is a suite
// that runs rarely and rots (and this repo has the retired-gates file to prove it).
//
// It cannot see the live router, the transport, or the DOM. Those are layers 2, 3 and 4, and their
// absence from this file is stated rather than papered over.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { buildMatrix, assertPopulated, poolMirrorDrift } from "../harness/matrix.js";
// ★ THE ENDPOINT'S OWN SCHEMA, IMPORTED RATHER THAN RESTATED — a restated copy is a copy that drifts
//   from the thing it is meant to be checking (T-1 finding 5).
import { Base as TransactionBase } from "../portfolio/transactions-service.js";

/** The prefilled-form field shape, as the ACTION payload carries it. */
interface ActionFieldShape {
  name: string; type: string; value: string | null;
  options?: { value: string; label: string }[];
}

import { checkAnswer, iDistinct, PER_ANSWER, type Violation } from "../harness/invariants.js";
import { findBookFixture, checkPeerFixtures, checkTrajectoryFixtures, checkSubjects, expectedBook, BOOK_FLOOR } from "../harness/fixtures.js";
import { SLOT_OBLIGATIONS } from "../harness/obligations.js";
import {
  clientRootExists, checkNoBareFetch, checkNoDeadControl, checkPayloadFieldsRead,
  checkEmittableDrawn, rendererComponentMap, FRONTEND_ROOT,
} from "../harness/client-contract.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const section = (s: string) => console.log(`\n══ ${s} ══`);

const report = (vs: readonly Violation[], limit = 12) => {
  for (const v of vs.slice(0, limit)) console.log(`     ✗ [${v.invariant}] ${v.where}\n        ${v.detail}`);
  if (vs.length > limit) console.log(`     … and ${vs.length - limit} more`);
};

async function main() {
  console.log("★ LAYER 1 — ANSWER INVARIANTS (deterministic · 0 model calls)");

  // ── §1 · FIXTURES ─────────────────────────────────────────────────────────────────────────────
  section("1 · fixtures — real, and populated enough to be evidence");
  const drift = poolMirrorDrift();
  ok("the harness concurrency is still bounded by the real connection pool", drift === null,
    drift ?? "matrix.ts and src/db/prisma.ts agree");

  const subs = await checkSubjects();
  for (const s of subs) ok(`subject ${s.symbol} still has its shape`, s.ok, s.note);

  // ★★ AND ITS PEER-GROUP SHAPE, WHICH `StockCoverage` CANNOT EXPRESS. Three PG cases turn on whether
  //    the subject is in a pond and whether that pond is scored — facts that can flip without tier or
  //    depth moving at all. See `checkPeerFixtures`: this is the MOLBIO lesson applied before the
  //    cases were written rather than two batches after.
  const peers = await checkPeerFixtures();
  for (const p of peers) ok(`peer fixture ${p.symbol} still has its shape`, p.ok, p.note);

  // ★★ AND ITS HISTORY SHAPE — Phase 2 · Batch 1. T and A turn on two more facts neither of the
  //    checks above can see: whether the score actually SEGMENTS, and whether a pillar's weight is
  //    carried by the others in the period ATTRIBUTION reads. Both flip on a single new quarter.
  const traj = await checkTrajectoryFixtures();
  for (const p of traj) ok(`history fixture ${p.symbol} still has its shape`, p.ok, p.note);

  const book = await findBookFixture();
  if (!book) {
    // ⚠ NOT A SKIP. A missing book means four of the ten defects are unexercisable, and a run that
    //   reported success would be claiming coverage it does not have.
    fail++;
    console.log(`  ❌ no book fixture found — the reader half of this suite cannot run`);
    console.log(`     NEEDED: one account with ≥${BOOK_FLOOR.holdings} holdings, ≥${BOOK_FLOOR.nonEquity} of them non-equity, ≥${BOOK_FLOOR.scored} scored.`);
    console.log(`     Pin one with HARNESS_BOOK_USER_ID. This harness does not create it (see harness/fixtures.ts).`);
  } else {
    console.log(`     book: ${book.email} — ${book.holdings} holdings (${book.nonEquity} non-equity, ${book.scored} scored), ${book.watchlist} pinned`);
    ok("the book fixture meets its floors", book.missing.length === 0, book.missing.join("; ") || "all floors met");
    if (book.watchlist === 0) {
      console.log(`     ⚠ 0 pins — I-SET-RECONCILES cannot be exercised on the watchlist path by this book.`);
    }
  }
  const reader = book && book.missing.length === 0 ? { userId: book.userId } : null;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ TWO ARMS BY DEFAULT, ONE UNDER `--one-arm` — AND THE DEFAULT IS BOTH ON PURPOSE.
  //
  // The matrix is ~93 cases and each one composes a whole answer against the live database. Building
  // it TWICE is the single largest cost in the gate chain, and for most of a working session the
  // second arm cannot fail from what was just edited: it exercises the FALLBACK PLANNER, which only
  // runs when the model is unavailable.
  //
  // ⚠ IT IS OPT-OUT AND NEVER OPT-IN, WHICH IS THE WHOLE DESIGN. The fallback arm exists because
  //   `deterministicPlan` branched on one condition and produced identical blocks for everything else,
  //   and it survived because the model planner normally runs in front of it — a defect reachable only
  //   when nobody is looking. A flag that had to be REMEMBERED to get full coverage would recreate
  //   exactly that: the important arm running only when someone thought of it.
  //
  // ★ SO CI AND `npm run verify:live` GET BOTH WITHOUT DOING ANYTHING, and a developer iterating on
  //   one family opts out explicitly, for one run, and is told so in the output.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ AN ARGV FLAG, NOT AN ENV VAR, AND THAT IS A WINDOWS DECISION AS MUCH AS A STYLE ONE. There is no
  //   `cross-env` in this project and `VAR=x npm run …` does not set anything on the shell this repo
  //   is developed on — a flag written that way would silently do nothing and the "fast" run would
  //   quietly be the slow one. The generators already take `--check` the same way.
  const bothArms = !process.argv.includes("--one-arm");

  // ── §2 · THE MATRIX, MODEL PLANNER IN FRONT ───────────────────────────────────────────────────
  section("2 · the matrix — normal path");
  const normal = await buildMatrix(reader, { plannerless: false });
  assertPopulated(normal, reader !== null);
  ok("every case produced an answer", normal.every((a) => a.kind.length > 0), `${normal.length} answers`);

  // ── §3 · THE FALLBACK PLANNER, ALONE ──────────────────────────────────────────────────────────
  section("3 · the FALLBACK planner, exercised alone");
  let fallback: typeof normal = [];
  if (!bothArms) {
    // ⚠ NOT A SILENT SKIP. The run says which arm it did not build and how to get it back, because a
    //   quiet skip is indistinguishable from a pass — the rule `harness/fixtures.ts` states for a
    //   missing book, applied to a missing ARM.
    console.log("     ⚠ SKIPPED — --one-arm was passed. The fallback planner was NOT exercised in this");
    console.log("       run, so every §4 assertion below covers ONE arm. Drop the flag for both.");
  } else {
    console.log("     AI_PROVIDER=mock → planAnswer returns deterministicPlan directly.");
    fallback = await buildMatrix(reader, { plannerless: true });
    assertPopulated(fallback, reader !== null);
    const plannedFallback = fallback.filter((a) => a.compositionId.startsWith("planned:"));
    ok("the fallback path was actually reached", plannedFallback.length >= 3,
      `${plannedFallback.length} answers came from the planner (${[...new Set(plannedFallback.map((a) => a.compositionId))].join(", ")})`);
  }

  // ── §4 · THE INVARIANTS ───────────────────────────────────────────────────────────────────────
  section(bothArms ? "4 · per-answer invariants over BOTH arms" : "4 · per-answer invariants over the normal arm only");
  const arms = bothArms
    ? ([["normal", normal], ["fallback", fallback]] as const)
    : ([["normal", normal]] as const);
  for (const [arm, answers] of arms) {
    const vs = answers.flatMap(checkAnswer);
    const byId = new Map<string, Violation[]>();
    for (const v of vs) byId.set(v.invariant, [...(byId.get(v.invariant) ?? []), v]);
    // ⚠ A HAND-KEPT LIST, AND IT HAD ALREADY GONE STALE ONCE. `checkAnswer` runs every invariant in
    //   `PER_ANSWER`, so a new one takes effect immediately — but it is REPORTED only if its id is
    //   named here, and an invariant nobody reports is one nobody notices going quiet. Read the
    //   registry instead, so registering an invariant is the only step there is.
    for (const { id } of PER_ANSWER) {
      const hits = byId.get(id) ?? [];
      ok(`${arm} · ${id}`, hits.length === 0, hits.length === 0 ? `clean over ${answers.length} answers` : `${hits.length} violations`);
      if (hits.length) report(hits);
    }
  }

  // ── §4b · THE BOOK IS WHOLE ───────────────────────────────────────────────────────────────────
  section("4b · the reader's book answer accounts for every position they hold");
  if (!reader) {
    ok("F-BOOK-COMPLETE · every holding reaches the list", false, "NO BOOK FIXTURE — unexercised, not satisfied");
  } else {
    // ★ AGAINST AN ORACLE THE CODE UNDER TEST DOES NOT SHARE. See fixtures.ts::expectedBook for why
    //   no payload-only invariant can do this — a silently lossy query and an honest cap produce the
    //   same payload, and the acceptance test caught exactly that gap.
    const expected = await expectedBook(reader.userId);
    for (const [arm, answers] of arms) {
      const book = answers.find((a) => a.compositionId === "reader.portfolio");
      const set = book?.sections.find((sec) => sec.renderer === "hero-set");
      const members = ((set?.payload as { members?: unknown[] })?.members ?? []) as { subtitle?: string }[];
      // The list is capped at 40 and this fixture is far below it, so equality is the honest test.
      ok(`${arm} · F-BOOK-COMPLETE · every holding reaches the list`,
        set !== undefined && members.length === expected.symbols,
        set === undefined
          ? "the portfolio answer carried no member set at all"
          : `${members.length} listed vs ${expected.symbols} held (${expected.nonEquity} of them non-equity)`);
    }
  }

  // ── §5 · SLOTS SURVIVE ────────────────────────────────────────────────────────────────────────
  section("5 · the router was right — did the answer keep it?");
  for (const [arm, answers] of arms) {
    for (const o of SLOT_OBLIGATIONS) {
      const applicable = answers.filter(o.when);
      const broken = applicable.filter((a) => !o.requires(a));
      if (applicable.length === 0) {
        // ⚠ AN OBLIGATION NOTHING TRIGGERS IS NOT A PASS. It means the matrix stopped producing the
        //   slot combination this rule guards, and the rule is now decorative.
        ok(`${arm} · ${o.id}`, false, "NOTHING IN THE MATRIX TRIGGERS THIS — the rule is unexercised, not satisfied");
        continue;
      }
      ok(`${arm} · ${o.id}`, broken.length === 0,
        broken.length === 0 ? `${applicable.length} applicable, all honoured` : `${broken.length}/${applicable.length} broke it`);
      for (const b of broken.slice(0, 4)) console.log(`     ✗ "${b.question}" [${b.compositionId}] — ${o.why}\n        slots: op=${b.slots.operation} lens=${b.slots.lens} tf=${b.slots.timeframe} · sections: ${b.sections.map((s) => s.renderer).join(", ") || "none"}`);
    }
  }

  // ── §6 · DISTINCTNESS ─────────────────────────────────────────────────────────────────────────
  section("6 · two different questions must not produce one answer");
  for (const [arm, answers] of arms) {
    const composedOnly = answers.filter((a) => a.kind === "composed");
    const vs = iDistinct(composedOnly);
    const shapes = new Set(composedOnly.map((a) => a.sections.map((s) => `${s.kind}:${s.renderer}`).join("|")));
    ok(`${arm} · I-DISTINCT`, vs.length === 0,
      vs.length === 0 ? `${composedOnly.length} composed answers, ${shapes.size} distinct shapes` : `${vs.length} identical pairs`);
    report(vs);
  }

  // ── ★ T-1 · A PREFILLED FORM MUST BUILD A BODY ITS OWN ENDPOINT ACCEPTS ───────────────────────
  //
  //    ⚠ THE GAP THIS CLOSES. Stage 6 proved POST /me/transactions at 201 with a CODE-BUILT body and
  //      called the write path proven. The prefilled FORM sends the reader's edited field values, and
  //      nothing had ever validated those against the endpoint. Live result: 400, on three fields at
  //      once — `type` was "BUY" against `z.enum(["buy",…])`, and `quantity`/`price` were strings
  //      against `z.number()` because that is what an <input> yields.
  //
  //    Validated against `Base` — the endpoint's OWN schema, imported, not restated — so this cannot
  //    drift from what the server actually accepts.
  section("6a · a prefilled form's fields satisfy the endpoint that receives them");
  {
    const a = normal.find((x) => x.label === "action · transaction_record");
    const sec = a?.sections.find((sx) => sx.renderer === "prefilled-form");
    const p = sec?.payload as { fields?: ActionFieldShape[] } | undefined;
    const fields = p?.fields ?? [];
    ok("the transaction control renders a form with fields", fields.length > 0,
      fields.length ? `${fields.length} fields: ${fields.map((f) => `${f.name}:${f.type}`).join(", ")}` : "no prefilled-form section");

    if (fields.length) {
      // Every closed field must offer options, and its own value must be one of them.
      const choices = fields.filter((f) => f.type === "choice");
      ok("every closed-vocabulary field offers its options and carries a valid one",
        choices.length > 0 && choices.every((f) => (f.options ?? []).some((o) => o.value === f.value)),
        choices.length
          ? choices.map((f) => `${f.name}=${f.value} ∈ [${(f.options ?? []).map((o) => o.value).join("|")}]`).join(" · ")
          : "no choice field — the TYPE field is free text again");

      // The body the form submits, typed exactly as action-control.tsx#formBody types it.
      const body: Record<string, string | number> = {};
      for (const f of fields) {
        const raw = (f.value ?? "").trim();
        if (raw === "") continue;
        body[f.name] = f.type === "number" ? Number(raw) : raw;
      }
      const parsed = TransactionBase.safeParse(body);
      ok("the submitted body is accepted by POST /me/transactions' own schema",
        parsed.success,
        parsed.success
          ? `accepted: ${JSON.stringify(body)}`
          : Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => `${k}: ${(v as string[])[0]}`).join(" · "));
    }
  }

  // ── ★ T-1 · A SCREEN'S COUNT AND ITS LIST MUST AGREE ──────────────────────────────────────────
  //    The card carries both. When they disagree it prints two statements and one of them is false.
  section("6b · a screen's totals and its rows tell the same story");
  for (const label of ["screen · matches", "screen · non-health metric", "screen · honest empty"] as const) {
    const a = normal.find((x) => x.label === label);
    // ★ T-1b · NOW `set-table` (§4.1 amendment). The renderer changed; every property asserted below
    //   is the same property, because they are properties of the ANSWER rather than of the layout.
    const set = a?.sections.find((sx) => sx.renderer === "set-table");
    const p = set?.payload as
      | {
          rows?: { symbol?: string | null; cells?: Record<string, { display: string; sort: number | null }> }[];
          columns?: { key: string; label: string; align: string; primary?: boolean }[];
          totals?: { label: string; value: string | null }[];
          emptyPhrase?: string;
        }
      | undefined;
    const matched = Number(p?.totals?.find((t) => t.label === "Matched")?.value ?? "0");
    const shown = p?.rows?.length ?? 0;
    ok(`${label} — the count and the list agree`,
      !!p && (matched === 0 ? shown === 0 : shown > 0),
      p ? `Matched ${matched}, ${shown} row(s) rendered` : "no set-table section was produced");

    // ★ THE HONEST EMPTY MUST STILL READ AS DELIBERATE. A zero-match screen carries its own sentence
    //   AND its columns, so the reader can see what was filtered on — not a blank card.
    if (p && shown === 0) {
      ok(`${label} — the empty says what it is, and still shows what was searched on`,
        !!p.emptyPhrase && p.emptyPhrase.length > 0 && (p.columns?.length ?? 0) > 0,
        `"${p.emptyPhrase}" over ${p.columns?.length ?? 0} column(s)`);
    }

    if (p && shown > 0) {
      // Finding 8's third ask: every matched row must be openable.
      ok(`${label} — every row carries the stock it is about`,
        p.rows!.every((r) => typeof r.symbol === "string" && r.symbol.length > 0),
        `${p.rows!.filter((r) => r.symbol).length}/${shown} rows carry a symbol`);

      // ★ THE COLUMN THE READER FILTERED ON IS PRESENT, AND IS THE ONE THE TABLE SORTS BY FIRST.
      //   This is what `hero-set` could not do: a screen on ROE showed a HEALTH score per row and
      //   put ROE in a subtitle string.
      const primary = p.columns?.find((c) => c.primary);
      ok(`${label} — the filtered metric is a column, and it is the primary sort`,
        !!primary && p.rows!.every((r) => primary.key in (r.cells ?? {})),
        primary ? `primary column "${primary.label}", present on ${shown}/${shown} rows` : "no primary column");

      // ⚠ A SORT VALUE, NOT A DISPLAY STRING — and null for unheld, never 0.
      const cells = p.rows!.flatMap((r) => Object.values(r.cells ?? {}));
      ok(`${label} — every cell sorts on a number or on null, never on its display string`,
        cells.length > 0 && cells.every((c) => c.sort === null || typeof c.sort === "number"),
        `${cells.length} cells, ${cells.filter((c) => c.sort === null).length} not held (sort null)`);
    }
  }

  // ── ★ T-1b · THE READER'S BOOK OVER TIME (finding 6) ──────────────────────────────────────────
  section("6c · a book answer carries the book over time");
  {
    const a = normal.find((x) => x.label === "portfolio");
    const value = a?.sections.find((sx) => sx.renderer === "value-line");
    const health = a?.sections.find((sx) => sx.renderer === "composite-spine");
    // ⚠ THE TEST ACCOUNT MAY LEGITIMATELY HAVE NEITHER — a book with no valuation history and no
    //   score rows is a real state, and both blocks decline rather than draw an axis over nothing.
    //   So this asserts the SHAPE when present, and reports honestly when absent.
    const vp = value?.payload as { points?: unknown[]; range?: { min: number; max: number } | null; unit?: string } | undefined;
    if (vp) {
      ok("the value line carries points and a fitted range",
        (vp.points?.length ?? 0) > 0 && vp.range !== null && vp.unit === "inr",
        `${vp.points?.length} points, range ${JSON.stringify(vp.range)}, unit ${vp.unit}`);
    } else {
      ok("the value line is ABSENT rather than empty on a book with no history", true,
        "no value-line section — the block declined, which is the honest path for a new book");
    }
    const hp = health?.payload as { points?: unknown[]; unit?: string } | undefined;
    if (hp) {
      ok("the health spine reuses composite-spine on a 0-100 axis",
        (hp.points?.length ?? 0) > 0 && hp.unit === "pct",
        `${hp.points?.length} points, unit ${hp.unit}`);
    } else {
      ok("the health spine is ABSENT rather than empty on a book with no score rows", true,
        "no composite-spine section — the block declined");
    }
  }

  // ── §7 · MULTI-TURN ───────────────────────────────────────────────────────────────────────────
  section("7 · the rules that only meet when there IS a prior turn");
  const chainOf = (name: string) => normal.filter((a) => a.label.startsWith(name));

  const pronoun = chainOf("chain · pronoun follow-up");
  ok("a pronoun follow-up inherits the subject", pronoun.length === 3 && pronoun[2]!.slots.subjects.length >= 2,
    pronoun.length === 3 ? `"compare them" resolved [${pronoun[2]!.slots.subjects.join(", ")}]` : "chain did not run");

  const bare = chainOf("chain · clarify then bare");
  ok("a clarify turn does NOT seed the next turn's operation",
    bare.length === 2 && bare[1]!.kind === "clarify_operation",
    bare.length === 2 ? `bare ticker after an ambiguous turn → ${bare[1]!.kind}` : "chain did not run");

  // ── ★ T-1 · INHERITANCE MUST **NOT** FIRE. The negative cases that did not exist. ──────────────
  //    Each asserts the turn answered ITS OWN question rather than the previous turn's subject.
  const unresolvable = chainOf("chain · named-but-unresolvable must not inherit");
  ok("a named-but-UNRESOLVABLE subject does not inherit the previous one",
    unresolvable.length === 2
      && unresolvable[1]!.slots.subjects.length === 0
      && unresolvable[1]!.kind !== "composed",
    unresolvable.length === 2
      ? `"how is Tesla doing" → ${unresolvable[1]!.kind}, subjects [${unresolvable[1]!.slots.subjects.join(", ") || "none"}] — a stop, not an answer about the prior company`
      : "chain did not run");

  const ambiguous = chainOf("chain · named-but-ambiguous must not inherit");
  ok("a named-but-AMBIGUOUS subject does not inherit, and the reader is asked which",
    ambiguous.length === 2
      && ambiguous[1]!.kind === "clarify_subject"
      && ambiguous[1]!.slots.subjects.length === 0,
    ambiguous.length === 2
      ? `"how is HDFC doing" → ${ambiguous[1]!.kind}, subjects [${ambiguous[1]!.slots.subjects.join(", ") || "none"}]`
      : "chain did not run");

  const screenChain = chainOf("chain · a screen must not inherit a subject");
  ok("a SCREEN never inherits a subject",
    screenChain.length === 2
      && screenChain[1]!.slots.subjects.length === 0
      && screenChain[1]!.slots.perspective !== "reader",
    screenChain.length === 2
      ? `"find undervalued stocks" → subjects [${screenChain[1]!.slots.subjects.join(", ") || "none"}], perspective ${screenChain[1]!.slots.perspective}`
      : "chain did not run");

  const advice = chainOf("chain · question then advice");
  ok("an advice question keeps its own unresolved operation after another turn",
    advice.length === 2 && advice[1]!.compositionId.includes("declined-advice"),
    advice.length === 2 ? `→ ${advice[1]!.compositionId}` : "chain did not run");

  // ── §8 · THE CLIENT CONTRACT ──────────────────────────────────────────────────────────────────
  section("8 · the client contract — what the renderer must do with what we send");
  if (!clientRootExists()) {
    // ⚠ NOT A SKIP. A missing sibling repo means three checks did not run, and a green tick would
    //   claim they did.
    ok("the frontend is reachable", false, `not found at ${FRONTEND_ROOT} — set HARNESS_FRONTEND_ROOT. C1/C2/C3/C4 did NOT run.`);
  } else {
    const bare = checkNoBareFetch();
    ok("C1 · every API call goes through apiFetch", bare.length === 0,
      bare.length ? `${bare.length} findings` : "no bare fetch to an API path, no cookie auth");
    for (const f of bare.slice(0, 6)) console.log(`     ✗ ${f.where}\n        ${f.detail}`);

    const dead = checkNoDeadControl();
    ok("C2 · no dead control", dead.length === 0,
      dead.length ? `${dead.length} findings` : "every button is wired, submits, or is explicitly disabled");
    for (const f of dead.slice(0, 6)) console.log(`     ✗ ${f.where}\n        ${f.detail}`);

    // Checked against what the product ACTUALLY emits, not against a type that may describe fields
    // nothing ever produces — which is why this needs the matrix above.
    const live = normal.flatMap((a) => a.sections);
    const pairs = new Set(live.map((sec) => `${sec.kind}:${sec.renderer}`));
    ok("the live section set is populated", pairs.size >= 8 && live.length >= 40,
      `${live.length} sections across ${pairs.size} distinct kind:renderer pairs`);

    const map = rendererComponentMap();
    ok("the dispatch was parsed", map.size >= 15, `${map.size} kind:renderer → component mappings`);

    const drawn = checkEmittableDrawn(live);
    ok("C4 · every renderer the backend emits has a case", drawn.length === 0,
      drawn.length ? `${drawn.length} undrawn` : `${pairs.size} pairs, all drawn`);
    for (const f of drawn) console.log(`     ✗ ${f.where} — ${f.detail}`);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ C5 · THE REVERSE OF C4 — a renderer the CLIENT can draw that the backend never emits.
    //
    // ⚠ C4 HAS ALWAYS CHECKED emitted → drawn AND NOTHING CHECKED drawn → emitted, which is how
    //   `CALLOUT : divergence` sat in the dispatch for two phases while no path produced it. It was
    //   `calloutSection`'s DEFAULT parameter; Phase 1 · Batch 2 gave every OTHER case a specific id
    //   and left divergence with the residual default, so the id looked alive and the capability
    //   behind it — eleven family-C findings, firing on real companies today — reached no reader.
    //
    // ★★ AND THIS CHECK RAISES A QUESTION; IT NEVER PRESCRIBES A DELETION. An unreached renderer has
    //    two causes with OPPOSITE fixes:
    //      · a leftover from a superseded design            → delete it
    //      · a capability that lost its caller              → WIRE it
    //    Nothing in a static check can tell those apart — it is a product judgement every time. A
    //    verification pass read this exact signal and proposed deleting divergence; the right answer
    //    was to wire it into orientation, where it now replaces a false all-clear. So the failure
    //    message asks rather than instructs.
    //
    // ⚠ AND THE CORPUS IS THE WEAK SIDE OF THE COMPARISON. "Never emitted" here means "never emitted
    //   BY THE MATRIX", which is a claim about our fixtures as much as about the code — divergence
    //   was reachable all along from `families/generic.ts`, down a branch no case drove. That is why
    //   this reports rather than fails on an allowlisted id.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const KNOWN_UNREACHED = new Set<string>([
      // ⚠ Reachable ONLY from the generic family's missing-data branch, which no matrix case drives.
      //   Named here rather than deleted: it has a producer, and the corpus is what is short.
      "CALLOUT:divergence",
    ]);
    const neverEmitted = [...map.keys()].filter((k) => !pairs.has(k));
    const fresh = neverEmitted.filter((k) => !KNOWN_UNREACHED.has(k));
    ok("C5 · every renderer the client can draw is reached by the corpus", fresh.length === 0,
      fresh.length
        ? `${fresh.join(", ")} — DRAWN BUT NEVER EMITTED. Is it a leftover (delete) or a capability that lost its caller (wire it)? Raise it; do not delete on this signal alone.`
        : `${map.size} drawn, ${pairs.size} emitted, ${neverEmitted.length} known-unreached`);
    // ⚠ AND THE ALLOWLIST MUST NOT GO STALE, for the same reason the swallowed-absence gate's must not.
    const stale = [...KNOWN_UNREACHED].filter((k) => pairs.has(k));
    ok("C5 · the known-unreached list names only renderers the corpus still misses", stale.length === 0,
      stale.length ? `NOW REACHED — remove from the list: ${stale.join(", ")}` : `${KNOWN_UNREACHED.size} entry(ies), all still unreached`);

    const unread = checkPayloadFieldsRead(live);
    ok("C3 · every payload field is read by its renderer", unread.length === 0,
      unread.length ? `${unread.length} unread fields` : "no computed field goes unread");
    for (const f of unread.slice(0, 15)) console.log(`     ✗ ${f.where}\n        ${f.detail}`);
  }

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
