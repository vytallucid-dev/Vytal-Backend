// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — THE PEER-GROUP RESULTS-SEASON SECTION: its copy matrix, its season arithmetic, its ordering.
//
// A build gate (no DB, no frontend checkout — pure functions only), so it lives in `verify:copy`
// beside the stock strip's. It drives group-copy.ts and group-window.ts directly; group-service.ts
// imports prisma and is therefore deliberately NOT reachable from here (see
// verify-build-gate-hygiene.ts). The live evidence run is a separate script.
//
// ── THE MATRIX IT COVERS ───────────────────────────────────────────────────────────────────────────
//   4 states × the ahead/behind branch × 4 reader-exposure combinations × 3 scoring cases ×
//   2 quarter voices × 2 forms, plus the degenerate one-dated-member season.
//   The brief's requirement is every STATE × READER-EXPOSURE combination; this is that product with
//   the scoring and quarter axes crossed in besides, because each of them changes the sentence too.
//
// ── WHAT IT HARD-FAILS ON ──────────────────────────────────────────────────────────────────────────
//  1 · Every authored sentence, byte-identical. Copy specified verbatim can only stay verbatim if
//      something compares it; a paraphrase during a refactor is invisible to review.
//  2 · scanForwardLanguage — THE existing R2/R3 scan — over every full AND short form.
//  3 · THE SAME instruction / movement-promise / lag-number lists the stock strip's gate runs,
//      imported from ./lib/results-season-scans.js rather than re-typed. The brief's requirement that
//      the existing scans EXTEND over the new copy is met by sharing the objects, not by copying them.
//  4 · ★ THE COUNTS COME FROM DATA. Change a count and the sentence must change — the assertion that
//      catches a number quietly becoming a literal during an edit.
//  5 · ★ EXPOSURE IS COUNTS ONLY. No member name and no position value may appear in any exposure
//      clause, in either form, and all four combinations must be distinct.
//  6 · ★ THE PILLAR VOICE MATCHES THE FILING. A Q1–Q3 season must not claim Foundation moves; a Q4
//      one must name it. And a zero-scored season names no pillar at all.
//  7 · The season window at every boundary, the season split by period, and the state precedence.
//  8 · Order carries meaning — reported descending (a feed), pending ascending (a schedule), both
//      total under a ticker tie-break.
//  9 · Capsules link IFF a filing exists, and their date basis follows the filing.
// 10 · Number agreement across every count — "One of the eight HAVE reported" shipped in the first
//      draft and is now an assertion.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { scanForwardLanguage } from "../scoring/findings/trajectory/regime-tier.js";
import { INSTRUCTION, LAG_NUMBER, MOVEMENT_PROMISE } from "./lib/results-season-scans.js";
import {
  capsuleFor,
  composeGroupCopy,
  countWord,
  CountWord,
  GROUP_LINK_LABEL,
  groupLinkHref,
  type GroupCopyInput,
} from "../results-season/group-copy.js";
import {
  exposureCounts,
  groupIntoSeasons,
  insideWindow,
  orderPending,
  orderReported,
  pickSeason,
  SEASON_EDGE_DAYS,
  SEASON_SCAN_DAYS,
  seasonStateFor,
  seasonWindowFor,
  type SeasonMember,
} from "../results-season/group-window.js";
import { periodDescriptorFor, WINDOW_DAYS, type PeriodDescriptor } from "../results-season/window.js";
import type {
  CapsuleExposure,
  GroupSeasonState,
  SentenceSegment,
  SentenceStock,
} from "../results-season/group-types.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ── THE FIXTURE SEASON. Ten dated members, a season opening 15 July and closing 18 August, the next
//    pending member on 11 August, the most recent filing on 6 August. Shaped on Large-Cap Pharma,
//    which is the largest real pond (10) and today's `one_remaining` example.
const FIRST = "15 July";
const LAST = "18 August";
const NEXT = "11 August";
const FILED = "6 August";
const DUE = 10;
/** ★ A CAPSULE'S WORTH OF FACTS, not a name — the remaining member is drawn, not written. `href` is
 *  null because a pending member has nothing filed to open, which §20 asserts rather than assumes. */
const LAST_ONE: SentenceStock = {
  symbol: "ZYDUSLIFE",
  name: "Zydus Lifesciences Ltd",
  exposure: "none",
  href: null,
};

// The two period descriptors, taken from REAL meeting dates rather than hand-built, so the gate runs
// the same derivation the service does.
const JUN: PeriodDescriptor = periodDescriptorFor(D("2026-08-12")); // Q1 meeting → June quarter
const MAR: PeriodDescriptor = periodDescriptorFor(D("2026-05-14")); // Q4 meeting → March, annual

type Exposure = { held: number; watching: number; label: string };
const EXPOSURES: Exposure[] = [
  { held: 0, watching: 0, label: "stranger" },
  { held: 0, watching: 2, label: "watching×2" },
  { held: 1, watching: 0, label: "held×1" },
  { held: 1, watching: 2, label: "held×1+watching×2" },
];

type Scoring = { scored: number; label: string };
const SCORINGS = (due: number): Scoring[] => [
  { scored: due, label: "all scored" },
  { scored: Math.max(1, due - 4), label: "partly scored" },
  { scored: 0, label: "none scored" },
];

function cell(over: Partial<GroupCopyInput> & { state: GroupSeasonState }): GroupCopyInput {
  const state = over.state;
  const due = over.due ?? DUE;
  const reported =
    over.reported ??
    (state === "none_reported" ? 0 : state === "all_reported" ? due : state === "one_remaining" ? due - 1 : due - 3);
  return {
    state,
    due,
    reported,
    scored: over.scored ?? due,
    held: over.held ?? 0,
    watching: over.watching ?? 0,
    period: over.period ?? JUN,
    firstDateText: over.firstDateText ?? FIRST,
    firstIsAhead: over.firstIsAhead ?? true,
    lastDateText: over.lastDateText ?? LAST,
    nextDateText: over.nextDateText ?? NEXT,
    nextIsAhead: over.nextIsAhead ?? true,
    lastFiledDateText: over.lastFiledDateText ?? FILED,
    lastOne: over.lastOne ?? (state === "one_remaining" ? LAST_ONE : null),
  };
}

const join = (segs: SentenceSegment[]) => segs.map((s) => s.text).join("");
function say(i: GroupCopyInput): { full: string; short: string; segs: SentenceSegment[]; shortSegs: SentenceSegment[] } {
  const c = composeGroupCopy(i);
  return { full: join(c.segments), short: join(c.shortSegments), segs: c.segments, shortSegs: c.shortSegments };
}

/** Every cell of the matrix, labelled. THE brief's "every state × reader-exposure combination", with
 *  the ahead/behind branch, the scoring case and the quarter voice crossed in besides. */
function everyCell(): { label: string; input: GroupCopyInput }[] {
  const out: { label: string; input: GroupCopyInput }[] = [];
  const states: GroupSeasonState[] = ["none_reported", "partly", "one_remaining", "all_reported"];
  for (const state of states) {
    // `all_reported` has no pending date, so no ahead/behind branch — everything is behind us.
    const branches: boolean[] = state === "all_reported" ? [true] : [true, false];
    for (const ahead of branches) {
      for (const e of EXPOSURES) {
        for (const s of SCORINGS(DUE)) {
          for (const [period, voice] of [
            [JUN, "Q1–Q3"],
            [MAR, "Q4"],
          ] as const) {
            out.push({
              label: `${state}/${ahead ? "ahead" : "behind"}/${e.label}/${s.label} [${voice}]`,
              input: cell({
                state,
                held: e.held,
                watching: e.watching,
                scored: s.scored,
                period,
                firstIsAhead: ahead,
                nextIsAhead: ahead,
              }),
            });
          }
        }
      }
    }
  }
  return out;
}

function everyString(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const { label, input } of everyCell()) {
    const s = say(input);
    out.push({ label: `${label} · full`, text: s.full });
    out.push({ label: `${label} · short`, text: s.short });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORED STRINGS — transcribed from the brief's four states, never re-derived from the composer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The four state clauses, ahead branch, Q1–Q3 voice, all ten scored, no reader exposure. */
const STATE_FULL: Record<GroupSeasonState, string> = {
  none_reported:
    "Results season for this group opens on 15 July. Ten members have a date, the last of them on 18 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  partly:
    "Seven of the ten have posted results. Three are still to come, the next on 11 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  // ★ THE TICKER, NOT THE COMPANY NAME — and it renders as a capsule, not as prose. The full form
  //   used to say "Only Zydus Lifesciences Ltd is left"; the row directly below said "ZYDUSLIFE".
  one_remaining:
    "Nine of the ten have posted results. Only ZYDUSLIFE is left, on 11 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  all_reported:
    "All ten have posted results, the last on 6 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
};

const STATE_SHORT: Record<GroupSeasonState, string> = {
  none_reported: "Season opens 15 July — ten due. Momentum reads the quarter; all ten scored.",
  partly: "Seven of ten posted results, three to come — next 11 August. Momentum reads the quarter; all ten scored.",
  one_remaining: "Nine of ten posted results — ZYDUSLIFE left, 11 August. Momentum reads the quarter; all ten scored.",
  all_reported: "All ten posted results — last on 6 August. Momentum reads the quarter; all ten scored.",
};

/** The BEHIND branch — a pending date that is no longer ahead of us. Q1–Q3, all scored, no exposure. */
const BEHIND_FULL: Record<string, string> = {
  none_reported:
    "Nothing has been posted for this group's June quarter. Ten members have a date, the last of them on 18 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  partly:
    "Seven of the ten have posted results. Three are still to come; the earliest of them was scheduled for 11 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  one_remaining:
    "Nine of the ten have posted results. Only ZYDUSLIFE is left; it was scheduled for 11 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
};

const BEHIND_SHORT: Record<string, string> = {
  none_reported: "Nothing posted yet — ten due, the last on 18 August. Momentum reads the quarter; all ten scored.",
  partly: "Seven of ten posted results, three to come — earliest 11 August. Momentum reads the quarter; all ten scored.",
  one_remaining: "Nine of ten posted results — ZYDUSLIFE left, was due 11 August. Momentum reads the quarter; all ten scored.",
};

/** ★ THE READER'S EXPOSURE, AS COUNTS ONLY — the brief's own shape: "2 are on your watchlist and 1
 *  you hold", spelled in the house's number voice. Taken on the `all_reported` state so the state
 *  clause is constant and only the exposure clause varies. */
const EXPOSURE_FULL: Record<string, string> = {
  stranger:
    "All ten have posted results, the last on 6 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  "watching×2":
    "All ten have posted results, the last on 6 August. Two are on your watchlist. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  "held×1":
    "All ten have posted results, the last on 6 August. You hold one of them. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  "held×1+watching×2":
    "All ten have posted results, the last on 6 August. Two are on your watchlist and one you hold. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
};

const EXPOSURE_SHORT: Record<string, string> = {
  stranger: "All ten posted results — last on 6 August. Momentum reads the quarter; all ten scored.",
  "watching×2": "All ten posted results — last on 6 August. Two on your watchlist. Momentum reads the quarter; all ten scored.",
  "held×1": "All ten posted results — last on 6 August. You hold one. Momentum reads the quarter; all ten scored.",
  "held×1+watching×2":
    "All ten posted results — last on 6 August. Two on your watchlist, one held. Momentum reads the quarter; all ten scored.",
};

/** The scoring clause in all three cases and both quarter voices, on a constant state clause. */
const SCORING_FULL: Record<string, string> = {
  "Q1/all":
    "All ten have posted results, the last on 6 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
  "Q1/partly":
    "All ten have posted results, the last on 6 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; six of the ten are scored.",
  "Q1/none":
    "All ten have posted results, the last on 6 August. None of them carries a health score, so a June-quarter filing changes nothing on our side.",
  "Q4/all":
    "All ten have posted results, the last on 6 August. A year-end filing carries the audited full year besides the March quarter, so it bears on Foundation as well as Momentum; all ten of them are scored.",
  "Q4/partly":
    "All ten have posted results, the last on 6 August. A year-end filing carries the audited full year besides the March quarter, so it bears on Foundation as well as Momentum; six of the ten are scored.",
  "Q4/none":
    "All ten have posted results, the last on 6 August. None of them carries a health score, so a year-end filing changes nothing on our side.",
};

const SCORING_SHORT: Record<string, string> = {
  "Q1/all": "All ten posted results — last on 6 August. Momentum reads the quarter; all ten scored.",
  "Q1/partly": "All ten posted results — last on 6 August. Momentum reads the quarter; six of ten scored.",
  "Q1/none": "All ten posted results — last on 6 August. None of them is scored.",
  "Q4/all": "All ten posted results — last on 6 August. The year-end filing feeds Foundation and Momentum; all ten scored.",
  "Q4/partly": "All ten posted results — last on 6 August. The year-end filing feeds Foundation and Momentum; six of ten scored.",
  "Q4/none": "All ten posted results — last on 6 August. None of them is scored.",
};

/** ★ THE ONE-DATED-MEMBER SEASON. No pond is here today, but Large-Cap Defense already has 5 dated
 *  members out of 7, so a pond with one is a matter of calendar coverage rather than of design. Every
 *  count word would be wrong in the plural, so both branches are authored and asserted. */
const SINGLE_FULL: Record<string, string> = {
  "none_reported/ahead":
    "Results season for this group opens on 15 July, with one member due to report. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; the one member here is scored.",
  "none_reported/behind":
    "Nothing has been posted for this group's June quarter. Its one dated member was scheduled for 18 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; the one member here is scored.",
  all_reported:
    "The group's one scheduled reporter posted results on 6 August. Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; the one member here is scored.",
};

const SINGLE_SHORT: Record<string, string> = {
  "none_reported/ahead": "Season opens 15 July — one due. Momentum reads the quarter; it is scored.",
  "none_reported/behind": "Nothing posted yet — one due, on 18 August. Momentum reads the quarter; it is scored.",
  all_reported: "The one reporter posted results 6 August. Momentum reads the quarter; it is scored.",
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** A SeasonMember fixture — for the ordering, capsule and exposure sections. */
function member(
  symbol: string,
  scheduled: string,
  filed: string | null,
  scored = true,
  exposure: CapsuleExposure = "none",
): SeasonMember {
  return {
    stockId: `id-${symbol}`,
    symbol,
    name: `${symbol} Ltd`,
    scheduledDate: D(scheduled),
    filedOn: filed ? D(filed) : null,
    scored,
    exposure,
  };
}

async function main() {
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★ EVERY AUTHORED SENTENCE, BYTE-IDENTICAL");
  {
    console.log("\n  ── the four states · full · ahead branch · Q1–Q3 · all scored ──");
    for (const [state, want] of Object.entries(STATE_FULL) as [GroupSeasonState, string][]) {
      const got = say(cell({ state })).full;
      ok(state, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── the four states · short ──");
    for (const [state, want] of Object.entries(STATE_SHORT) as [GroupSeasonState, string][]) {
      const got = say(cell({ state })).short;
      ok(state, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── the BEHIND branch · full ──");
    for (const [state, want] of Object.entries(BEHIND_FULL)) {
      const got = say(cell({ state: state as GroupSeasonState, firstIsAhead: false, nextIsAhead: false })).full;
      ok(state, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── the BEHIND branch · short ──");
    for (const [state, want] of Object.entries(BEHIND_SHORT)) {
      const got = say(cell({ state: state as GroupSeasonState, firstIsAhead: false, nextIsAhead: false })).short;
      ok(state, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── reader exposure · full ──");
    for (const e of EXPOSURES) {
      const got = say(cell({ state: "all_reported", held: e.held, watching: e.watching })).full;
      const want = EXPOSURE_FULL[e.label];
      ok(e.label, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── reader exposure · short ──");
    for (const e of EXPOSURES) {
      const got = say(cell({ state: "all_reported", held: e.held, watching: e.watching })).short;
      const want = EXPOSURE_SHORT[e.label];
      ok(e.label, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── the scoring clause · full ──");
    for (const [key, want] of Object.entries(SCORING_FULL)) {
      const [voice, kind] = key.split("/");
      const scored = kind === "all" ? DUE : kind === "partly" ? 6 : 0;
      const got = say(cell({ state: "all_reported", scored, period: voice === "Q4" ? MAR : JUN })).full;
      ok(key, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── the scoring clause · short ──");
    for (const [key, want] of Object.entries(SCORING_SHORT)) {
      const [voice, kind] = key.split("/");
      const scored = kind === "all" ? DUE : kind === "partly" ? 6 : 0;
      const got = say(cell({ state: "all_reported", scored, period: voice === "Q4" ? MAR : JUN })).short;
      ok(key, got === want, got === want ? "verbatim" : `\n      want: ${want}\n      got : ${got}`);
    }
    console.log("\n  ── the one-dated-member season ──");
    const singles: [string, GroupCopyInput][] = [
      ["none_reported/ahead", cell({ state: "none_reported", due: 1, reported: 0, scored: 1, firstIsAhead: true })],
      ["none_reported/behind", cell({ state: "none_reported", due: 1, reported: 0, scored: 1, firstIsAhead: false })],
      ["all_reported", cell({ state: "all_reported", due: 1, reported: 1, scored: 1 })],
    ];
    for (const [key, input] of singles) {
      const s = say(input);
      ok(`${key} · full`, s.full === SINGLE_FULL[key], s.full === SINGLE_FULL[key] ? "verbatim" : `\n      want: ${SINGLE_FULL[key]}\n      got : ${s.full}`);
      ok(`${key} · short`, s.short === SINGLE_SHORT[key], s.short === SINGLE_SHORT[key] ? "verbatim" : `\n      want: ${SINGLE_SHORT[key]}\n      got : ${s.short}`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★ THE EXISTING FORWARD-LANGUAGE SCAN (R2/R3) OVER EVERY STRING");
  {
    const all = everyString();
    const leaks: string[] = [];
    for (const s of all) for (const v of scanForwardLanguage(s.text)) leaks.push(`${s.label}: ${v.rule} — "${v.matched}"`);
    ok(`all ${all.length} rendered strings pass scanForwardLanguage`, leaks.length === 0, leaks.slice(0, 4).join(" · ") || "clean");
    // ⚠ NEGATIVE CONTROLS. Without them this section passes just as happily on an empty string set.
    ok("NEGATIVE CONTROL — a planted R3 phrase IS caught", scanForwardLanguage("Seven of the ten have posted results, so you're early.").length > 0, "caught");
    ok("NEGATIVE CONTROL — a planted R2 phrase IS caught", scanForwardLanguage("Momentum is an early warning ahead of the composite.").length > 0, "caught");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ THE SHARED INSTRUCTION / MOVEMENT-PROMISE / LAG-NUMBER SCANS — THE SAME OBJECTS THE STOCK STRIP'S GATE RUNS");
  {
    const all = everyString();
    for (const [name, pats] of [
      ["no promise of movement (incl. `expect`)", MOVEMENT_PROMISE],
      ["no lag number", LAG_NUMBER],
      ["no instruction", INSTRUCTION],
    ] as const) {
      const hits: string[] = [];
      for (const s of all) for (const p of pats) if (p.test(s.text)) hits.push(`${s.label} ${p}`);
      ok(name, hits.length === 0, hits.slice(0, 5).join(" · ") || `clean across all ${all.length} strings`);
    }

    // Negative controls — a rule that bites nothing is a rule that is not there. Each is planted in
    // the exact shape THIS surface would tempt it into.
    ok("NEGATIVE CONTROL — 'Momentum will move once the last one lands' IS caught", MOVEMENT_PROMISE.some((p) => p.test("Momentum will move once the last one lands")));
    ok("NEGATIVE CONTROL — 'expect the group's score to shift' IS caught", MOVEMENT_PROMISE.some((p) => p.test("expect the group's score to shift")));
    ok("NEGATIVE CONTROL — 'the last three report within two days' IS caught", LAG_NUMBER.some((p) => p.test("the last three report within two days")));
    ok("NEGATIVE CONTROL — 'three are still to come over the next two weeks' IS caught", LAG_NUMBER.some((p) => p.test("three are still to come over the next two weeks")));
    for (const planted of [
      "Check the ones still to report.",
      "See the results page for each of them.",
      "Watch for the last two.",
      "Keep an eye on the remaining three.",
      "You can find them on the results feed.",
      "Review the seven that have posted results.",
    ]) {
      ok(`NEGATIVE CONTROL — "${planted}" IS caught`, INSTRUCTION.some((p) => p.test(planted)));
    }
    // …and the shipped descriptive copy must NOT be caught. Both of these use verbs from the list in
    // third person, mid-clause, with a pillar as the subject — a lint that bans them gets switched off.
    for (const shipped of [
      "Foundation reads the annual accounts, so a June-quarter filing bears on Momentum alone; all ten of them are scored.",
      "Momentum reads the quarter; all ten scored.",
      "Two are on your watchlist and one you hold.",
    ]) {
      ok(`…and shipped descriptive copy is NOT caught: "${shipped.slice(0, 44)}…"`, !INSTRUCTION.some((p) => p.test(shipped)));
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★ THE COUNTS COME FROM DATA — change one and the sentence changes");
  {
    // Every count the copy states must be reachable from the input. If any of these pairs render the
    // same string, that count has become a literal somewhere.
    const pairs: [string, GroupCopyInput, GroupCopyInput][] = [
      ["due (7 vs 10)", cell({ state: "all_reported", due: 7, reported: 7, scored: 7 }), cell({ state: "all_reported", due: 10, reported: 10, scored: 10 })],
      ["reported (5 vs 7 of ten)", cell({ state: "partly", reported: 5 }), cell({ state: "partly", reported: 7 })],
      ["remaining follows reported", cell({ state: "partly", reported: 4 }), cell({ state: "partly", reported: 6 })],
      ["scored (10 vs 6)", cell({ state: "all_reported", scored: 10 }), cell({ state: "all_reported", scored: 6 })],
      ["held (1 vs 3)", cell({ state: "all_reported", held: 1 }), cell({ state: "all_reported", held: 3 })],
      ["watching (1 vs 3)", cell({ state: "all_reported", watching: 1 }), cell({ state: "all_reported", watching: 3 })],
      ["the quarter (June vs March)", cell({ state: "all_reported", period: JUN }), cell({ state: "all_reported", period: MAR })],
      ["the opening date", cell({ state: "none_reported", firstDateText: "15 July" }), cell({ state: "none_reported", firstDateText: "2 July" })],
      ["the next date", cell({ state: "partly", nextDateText: "11 August" }), cell({ state: "partly", nextDateText: "3 August" })],
      ["the last filing date", cell({ state: "all_reported", lastFiledDateText: "6 August" }), cell({ state: "all_reported", lastFiledDateText: "1 August" })],
      ["the remaining member's name", cell({ state: "one_remaining", lastOne: LAST_ONE }), cell({ state: "one_remaining", lastOne: { symbol: "SIEMENS", name: "Siemens Ltd", exposure: "none", href: null } })],
    ];
    for (const [label, a, b] of pairs) {
      const sa = say(a), sb = say(b);
      ok(`${label} — full form varies`, sa.full !== sb.full, sa.full === sb.full ? `BOTH: ${sa.full}` : "");
      ok(`${label} — short form varies`, sa.short !== sb.short, sa.short === sb.short ? `BOTH: ${sa.short}` : "");
    }

    // …and the counts that are stated actually appear as words.
    const s = say(cell({ state: "partly", due: 9, reported: 6, scored: 4, held: 2, watching: 3 }));
    ok("a 9-member season states nine, six, three, two and four", /\bSix of the nine have posted results\b/.test(s.full) && /\bThree are still to come\b/.test(s.full) && /three are on your watchlist and two you hold/i.test(s.full) && /four of the nine are scored/i.test(s.full), s.full);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ★ THE READER'S EXPOSURE IS COUNTS ONLY — no name, no value, no position readout");
  {
    // A member NAME may appear in exactly one place — the `one_remaining` state clause, which the
    // brief requires ("that stock specifically"). It must never appear in an exposure clause.
    const FORBIDDEN_IN_EXPOSURE: [RegExp, string][] = [
      [/₹/, "a rupee figure is a position readout"],
      [/\b\d+(?:\.\d+)?%/, "a percentage is a weight, not a count"],
      [/\bshares?\b/i, "a share count is a position readout"],
      [/\bworth\b/i, "a value claim"],
      [/\bposition\b/i, "names the position rather than counting the members"],
      [/\bportfolio\b/i, "the group page is not a portfolio readout"],
    ];
    const hits: string[] = [];
    let n = 0;
    for (const { label, input } of everyCell()) {
      if (input.held === 0 && input.watching === 0) continue;
      const s = say(input);
      for (const form of [s.full, s.short]) {
        n++;
        for (const [re, why] of FORBIDDEN_IN_EXPOSURE) if (re.test(form)) hits.push(`${label}: ${why}`);
      }
    }
    ok(`all ${n} exposed strings carry counts only`, hits.length === 0, hits.slice(0, 5).join(" · ") || "clean");
    ok("NEGATIVE CONTROL — a value claim WOULD be caught", FORBIDDEN_IN_EXPOSURE.some(([re]) => re.test("You hold two of them, worth ₹1.4L.")));

    // The four exposure states must be DISTINCT in both forms, on every state clause — otherwise a
    // reader who holds one and a reader who holds none read the same sentence.
    for (const state of ["none_reported", "partly", "one_remaining", "all_reported"] as GroupSeasonState[]) {
      for (const form of ["full", "short"] as const) {
        const rendered = EXPOSURES.map((e) => say(cell({ state, held: e.held, watching: e.watching }))[form]);
        ok(`${state} · ${form} — four DISTINCT exposure variants`, new Set(rendered).size === 4, new Set(rendered).size === 4 ? "" : rendered.join(" | "));
      }
    }

    // Held and watching must BOTH be visible when both are non-zero — the brief's own example shape.
    const both = say(cell({ state: "all_reported", held: 1, watching: 2 }));
    ok("both counts appear in one clause", /Two are on your watchlist and one you hold\./.test(both.full), both.full);
    ok("…and in the short form too", /Two on your watchlist, one held\./.test(both.short), both.short);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · ★ THE PILLAR VOICE MATCHES THE FILING, AND A ZERO-SCORED SEASON NAMES NO PILLAR");
  {
    for (const { label, input } of everyCell()) {
      const t = say(input).full + say(input).short;
      if (input.period.isAnnualBearing) continue;
      if (/\bFoundation\b/.test(t) && !/Foundation reads the annual accounts/.test(t)) {
        ok(`${label} — a Q1–Q3 season names Foundation only to EXCLUDE it`, false, t);
      }
    }
    ok("no Q1–Q3 string claims Foundation is fed by the quarter", true, "checked across the whole matrix");
    ok("a Q1–Q3 season says Momentum ALONE", /bears on Momentum alone/.test(say(cell({ state: "partly", period: JUN })).full));
    ok("a Q4 season names BOTH", /bears on Foundation as well as Momentum/.test(say(cell({ state: "partly", period: MAR })).full));
    ok("a Q4 season names the audited full year", /audited full year/.test(say(cell({ state: "partly", period: MAR })).full));
    ok("the period MONTH is named and comes from the descriptor", /June-quarter/.test(say(cell({ state: "partly", period: JUN })).full) && /March quarter/.test(say(cell({ state: "partly", period: MAR })).full));

    // A zero-scored season has no pillar to name — every pillar word must be absent, both voices.
    for (const period of [JUN, MAR]) {
      const s = say(cell({ state: "all_reported", scored: 0, period }));
      const t = s.full + s.short;
      ok(`zero-scored [${period.isAnnualBearing ? "Q4" : "Q1–Q3"}] names no pillar`, !/\bFoundation\b|\bMomentum\b/.test(t), t);
      ok(`zero-scored [${period.isAnnualBearing ? "Q4" : "Q1–Q3"}] says so plainly`, /changes nothing on our side/.test(s.full) && /None of them is scored/.test(s.short));
    }
    // NEGATIVE CONTROL — the scan must bite the scored copy, or it proves nothing.
    ok("NEGATIVE CONTROL — a scored season DOES name a pillar", /\bMomentum\b/.test(say(cell({ state: "all_reported", scored: 10 })).full));

    // The derivations, driven off real meeting dates — the SAME ones the service calls.
    ok("2026-08-12 → June, not annual-bearing", JUN.monthName === "June" && JUN.isAnnualBearing === false, JSON.stringify(JUN));
    ok("2026-05-14 → March, annual-bearing", MAR.monthName === "March" && MAR.isAnnualBearing === true, JSON.stringify(MAR));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · ★ THE DATE IS A SEGMENT, IN MONO, AND ONLY THE DATE IS");
  {
    let mono = 0;
    for (const { label, input } of everyCell()) {
      const s = say(input);
      for (const [form, segs] of [["full", s.segs], ["short", s.shortSegs]] as const) {
        const monos = segs.filter((x) => x.mono);
        if (monos.length === 0) ok(`${label} · ${form} — carries at least one date`, false, join(segs));
        for (const m of monos) {
          mono++;
          // "6 August" / "18 August" — day then full month, no year. The stock strip's date voice.
          if (!/^\d{1,2} [A-Z][a-z]+$/.test(m.text)) ok(`${label} · ${form} — mono segment IS a date`, false, `"${m.text}"`);
          if (/20\d\d/.test(m.text)) ok(`${label} · ${form} — no year on the section`, false, m.text);
        }
        const dates = monos.map((m) => m.text);
        for (const plain of segs.filter((x) => !x.mono)) {
          for (const d of dates) {
            if (plain.text.includes(d)) ok(`${label} · ${form} — the date is not duplicated into a plain segment`, false, d);
          }
        }
        // No two PLAIN segments may be adjacent — the assembler must have merged them.
        // ⚠ A `stock` segment is not mono and is not plain: it ends a text run exactly as a date does,
        //   and the text after it legitimately starts a new segment. Testing `!mono` alone would call
        //   every capsule-then-prose pair a merge failure.
        const isPlain = (s: SentenceSegment) => !s.mono && !s.stock;
        for (let k = 1; k < segs.length; k++) {
          if (isPlain(segs[k]) && isPlain(segs[k - 1])) ok(`${label} · ${form} — no adjacent plain segments`, false, `${k}`);
        }
      }
    }
    ok(`${mono} mono segments across the matrix, every one a date`, true);
    ok("none_reported names TWO dates (the opening and the last)", say(cell({ state: "none_reported" })).segs.filter((s) => s.mono).length === 2);
    ok("all_reported names ONE date (the last filing)", say(cell({ state: "all_reported" })).segs.filter((s) => s.mono).length === 1);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · ★ NUMBER AGREEMENT — the seam a fragment-assembler gets wrong");
  {
    // "One of the eight HAVE reported" shipped in the first draft. This is that bug, as an assertion.
    const bad: string[] = [];
    for (const { label, input } of everyCell()) {
      const t = say(input).full;
      if (/\bOne of the \w+ have posted results\b/.test(t)) bad.push(`${label}: "One of the … have posted results"`);
      if (/\b(?:Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten) of the \w+ has posted results\b/.test(t)) bad.push(`${label}: plural + "has"`);
      if (/\bOne are on your watchlist\b/.test(t)) bad.push(`${label}: "One are"`);
      if (/\b(?:Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten) is on your watchlist\b/.test(t)) bad.push(`${label}: plural + "is"`);
    }
    ok("every count agrees in number", bad.length === 0, bad.slice(0, 4).join(" · ") || "clean");
    ok('singular reported reads "One of the ten has posted results"', /One of the ten has posted results\./.test(say(cell({ state: "partly", reported: 1 })).full));
    ok('plural reported reads "Seven of the ten have posted results"', /Seven of the ten have posted results\./.test(say(cell({ state: "partly", reported: 7 })).full));
    ok('singular watchlist reads "One is on your watchlist"', /One is on your watchlist\./.test(say(cell({ state: "all_reported", watching: 1 })).full));
    ok('plural watchlist reads "Two are on your watchlist"', /Two are on your watchlist\./.test(say(cell({ state: "all_reported", watching: 2 })).full));
    ok("NEGATIVE CONTROL — the shipped-then-fixed disagreement WOULD be caught", /\bOne of the \w+ have posted results\b/.test("One of the eight have posted results."));
    // The number voice itself.
    // ★ THE TWO-MEMBER SEASON SAYS "BOTH". "All two have posted results" is what a composer that
    //   substitutes a count into one template produces, and it is the same class of defect as
    //   "One of the eight have reported" — caught here rather than in review.
    {
      const two = say(cell({ state: "all_reported", due: 2, reported: 2, scored: 2 }));
      ok("due=2 · full reads \"Both have posted results\"", two.full.startsWith("Both have posted results, the last on 6 August."), two.full);
      ok("due=2 · short reads \"Both posted results\"", two.short.startsWith("Both posted results — last on 6 August."), two.short);
      ok("due=2 · the scoring tail says \"both\", never \"all two\"", /both of them are scored/.test(two.full) && /both scored/.test(two.short), two.short);
      ok("NEGATIVE CONTROL — \"All two\" appears nowhere in the matrix", !everyCell().some(({ input }) => /\bAll two\b/.test(say(input).full + say(input).short)));
      ok("NEGATIVE CONTROL — the retired phrasing WOULD be caught", /\bAll two\b/.test("All two have posted results, the last on 6 August."));
    }
    ok("countWord 0…10", [0, 1, 5, 10].map(countWord).join("|") === "none|one|five|ten");
    ok("countWord falls back to a numeral above ten", countWord(11) === "11" && countWord(23) === "23");
    ok("CountWord capitalises", CountWord(3) === "Three");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("9 · ★ THE AHEAD/BEHIND BRANCH MAKES NO CLAIM ABOUT A DATE THAT HAS PASSED");
  {
    // A date that is behind us may never be introduced as "the next on" / "opens on" — those assert a
    // future the calendar no longer supports. The same distinction gate 5 draws on the stock strip.
    const FUTURE_CLAIM = [/\bthe next on\b/i, /\bopens on\b/i, /\bis left, on\b/i, /— next \d/i];
    const leaks: string[] = [];
    for (const { label, input } of everyCell()) {
      if (input.nextIsAhead && input.firstIsAhead) continue;
      const s = say(input);
      for (const [form, text] of [["full", s.full], ["short", s.short]] as const) {
        for (const re of FUTURE_CLAIM) if (re.test(text)) leaks.push(`${label} · ${form} ${re}`);
      }
    }
    ok("no behind-branch string claims a future date", leaks.length === 0, leaks.slice(0, 4).join(" · ") || "clean");
    ok("NEGATIVE CONTROL — the ahead branch DOES make the claim", FUTURE_CLAIM.some((re) => re.test(say(cell({ state: "partly" })).full)));
    // …and says "was scheduled for" instead.
    for (const state of ["none_reported", "partly", "one_remaining"] as GroupSeasonState[]) {
      const t = say(cell({ state, firstIsAhead: false, nextIsAhead: false })).full;
      ok(`${state} behind — states the schedule in the past tense`, /was scheduled for|Nothing has been posted/.test(t), t);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("10 · ★ THE SHORT FORM IS SHORTER, AND KEEPS EVERY DISTINCTION");
  {
    let shorter = 0;
    for (const { label, input } of everyCell()) {
      const s = say(input);
      if (s.short.length > s.full.length) ok(`${label} — short form is not longer`, false, `${s.short.length} > ${s.full.length}`);
      else shorter++;
    }
    ok(`all ${shorter} short forms are no longer than their full form`, true);

    // ★ A CHARACTER BUDGET, BECAUSE THE REAL CONSTRAINT IS A PIXEL ONE THIS GATE CANNOT SEE.
    //   Measured on the shipped Inter metrics: below 640px the paragraph is 266px at a 360px viewport
    //   — about 41 characters a line. This section carries a third clause the stock strip does not
    //   (the scoring consequence), so its ceiling is five lines rather than four: 170 characters.
    //   A PROXY, and it says so — a font-accurate layout needs the woff2 and a browser, neither of
    //   which belongs in a build gate. What it catches is the regression that actually happens: copy
    //   edited without anyone re-measuring.
    const SHORT_BUDGET = 175;
    const lens = everyCell().map(({ label, input }) => ({ label, len: say(input).short.length }));
    const fat = lens.filter((x) => x.len > SHORT_BUDGET);
    const longest = lens.reduce((a, b) => (b.len > a.len ? b : a));
    ok(
      `every short form is within the ${SHORT_BUDGET}-character budget`,
      fat.length === 0,
      fat.map((f) => `${f.label} ${f.len}`).join(" · ") || `longest ${longest.len} — ${longest.label}`,
    );
    ok("NEGATIVE CONTROL — the FULL form of the longest cell WOULD blow the budget", Math.max(...everyCell().map(({ input }) => say(input).full.length)) > SHORT_BUDGET);

    // Every STATE must be distinguishable in the short form too — the collapse this exists to prevent.
    for (const form of ["full", "short"] as const) {
      const rendered = (["none_reported", "partly", "one_remaining", "all_reported"] as GroupSeasonState[]).map(
        (state) => say(cell({ state }))[form],
      );
      ok(`four DISTINCT ${form} state clauses`, new Set(rendered).size === 4);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("11 · ★ THE SEASON WINDOW, AT EVERY BOUNDARY");
  {
    ok("SEASON_EDGE_DAYS IS the stock strip's WINDOW_DAYS — one constant, two surfaces", SEASON_EDGE_DAYS === WINDOW_DAYS, `${SEASON_EDGE_DAYS}`);
    ok("SEASON_SCAN_DAYS clears the widest measured spread (33d) plus an edge", SEASON_SCAN_DAYS >= 33 + SEASON_EDGE_DAYS, `${SEASON_SCAN_DAYS}`);

    const w = seasonWindowFor([D("2026-07-22"), D("2026-08-11"), D("2026-07-30")]);
    ok("earliest → T-7", w.from.toISOString().slice(0, 10) === "2026-07-15", w.from.toISOString().slice(0, 10));
    ok("latest → T+7", w.to.toISOString().slice(0, 10) === "2026-08-18", w.to.toISOString().slice(0, 10));
    ok("firstDate / lastDate are the member dates themselves", w.firstDate.toISOString().slice(0, 10) === "2026-07-22" && w.lastDate.toISOString().slice(0, 10) === "2026-08-11");
    ok("a one-date season is a 15-day window", (() => {
      const s = seasonWindowFor([D("2026-08-01")]);
      return s.from.toISOString().slice(0, 10) === "2026-07-25" && s.to.toISOString().slice(0, 10) === "2026-08-08";
    })());
    ok("an unsorted input gives the same window", seasonWindowFor([D("2026-08-11"), D("2026-07-22")]).from.getTime() === w.from.getTime());
    ok("a stray time component is normalised", seasonWindowFor([new Date("2026-07-22T18:30:00.000Z")]).firstDate.toISOString() === "2026-07-22T00:00:00.000Z");

    const cases: [string, string, boolean][] = [
      ["the day before the window opens", "2026-07-14", false],
      ["the day the window opens (T-7)", "2026-07-15", true],
      ["the earliest member date", "2026-07-22", true],
      ["mid-season", "2026-08-01", true],
      ["the latest member date", "2026-08-11", true],
      ["the day the window closes (T+7)", "2026-08-18", true],
      ["the day after", "2026-08-19", false],
    ];
    for (const [label, day, want] of cases) ok(`${label} → ${want ? "inside" : "outside"}`, insideWindow(w, D(day)) === want);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("12 · ★ TWO SEASONS IN THE READ BAND ARE SEPARATED, NOT MERGED");
  {
    // The ±45d band can straddle the tail of one reporting season and the head of the next. Merged,
    // the window would span both and the counts would mix a June quarter with a September one.
    const q1 = [member("A", "2026-07-22", null), member("B", "2026-08-11", null)];
    const q2 = [member("C", "2026-10-20", null), member("D", "2026-11-05", null)];
    const seasons = groupIntoSeasons([...q1, ...q2]);
    ok("two periods → two seasons", seasons.size === 2, [...seasons.keys()].join(", "));
    ok("keyed by period END", seasons.has("2026-06-30") && seasons.has("2026-09-30"), [...seasons.keys()].join(", "));
    ok("a July and an August meeting share a season", (seasons.get("2026-06-30") ?? []).length === 2);

    const inQ1 = pickSeason(seasons, D("2026-08-09"));
    ok("today inside Q1's window → the June season", inQ1?.seasonKey === "2026-06-30", inQ1?.seasonKey ?? "null");
    const inQ2 = pickSeason(seasons, D("2026-10-25"));
    ok("today inside Q2's window → the September season", inQ2?.seasonKey === "2026-09-30", inQ2?.seasonKey ?? "null");
    ok("today between the two → null (outside_window)", pickSeason(seasons, D("2026-09-15")) === null);
    // Overlap: when two windows both contain today, the LATER period wins — that is the one under way.
    const overlap = groupIntoSeasons([member("A", "2026-09-28", null), member("B", "2026-10-02", null)]);
    ok("overlapping windows → the later period wins", pickSeason(overlap, D("2026-10-01"))?.seasonKey === "2026-09-30", [...overlap.keys()].join(","));
    ok("an empty set → null", pickSeason(new Map(), D("2026-08-09")) === null);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("13 · ★ THE STATE PRECEDENCE — reported === 0 wins over remaining === 1");
  {
    const cases: [string, number, number, GroupSeasonState][] = [
      ["nothing filed, ten due", 0, 10, "none_reported"],
      ["nothing filed, ONE due — still the season ahead, never one_remaining", 0, 1, "none_reported"],
      ["nothing filed, two due", 0, 2, "none_reported"],
      ["one filed of ten", 1, 10, "partly"],
      ["seven of ten", 7, 10, "partly"],
      ["eight of ten", 8, 10, "partly"],
      ["nine of ten", 9, 10, "one_remaining"],
      ["one of two", 1, 2, "one_remaining"],
      ["all ten", 10, 10, "all_reported"],
      ["the one dated member has filed", 1, 1, "all_reported"],
    ];
    for (const [label, reported, due, want] of cases) {
      const got = seasonStateFor(reported, due);
      ok(`${label} → ${want}`, got === want, got);
    }
    ok("one_remaining always implies at least one reporter", (["one_remaining"] as GroupSeasonState[]).every(() => seasonStateFor(0, 1) !== "one_remaining"));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("14 · ★ ORDER CARRIES MEANING — reported is a FEED, pending is a SCHEDULE");
  {
    const roster: SeasonMember[] = [
      member("BHEL", "2026-07-16", "2026-07-16"),
      member("SIEMENS", "2026-08-11", null),
      member("POWERINDIA", "2026-08-07", "2026-08-07"),
      member("LT", "2026-07-28", "2026-07-28"),
      member("CUMMINSIND", "2026-08-05", "2026-08-05"),
      member("ABB", "2026-07-31", "2026-07-31"),
      member("THERMAX", "2026-07-30", "2026-07-30"),
      member("HONAUT", "2026-07-29", "2026-07-29"),
    ];
    const rep = orderReported(roster).map((m) => m.symbol);
    const pen = orderPending(roster).map((m) => m.symbol);
    ok("reported — most recent FIRST", rep.join(",") === "POWERINDIA,CUMMINSIND,ABB,THERMAX,HONAUT,LT,BHEL", rep.join(","));
    ok("pending — the next reporter FIRST", pen.join(",") === "SIEMENS", pen.join(","));
    ok("reported excludes the unfiled", !rep.includes("SIEMENS"));
    ok("pending excludes the filed", pen.every((s) => s !== "BHEL"));
    ok("the two rows partition the roster", rep.length + pen.length === roster.length);

    // ★ THE TIE-BREAK. Nine of thirteen scored ponds have two members sharing a date; without a total
    //   order they would swap places between renders for no reason the reader could account for.
    const tied = [member("DALBHARAT", "2026-07-24", "2026-07-24"), member("ACC", "2026-07-24", "2026-07-24")];
    ok("same filing date → ticker order, stable", orderReported(tied).map((m) => m.symbol).join(",") === "ACC,DALBHARAT");
    ok("…and reversing the input does not change it", orderReported([...tied].reverse()).map((m) => m.symbol).join(",") === "ACC,DALBHARAT");
    const tiedPending = [member("VOLTAS", "2026-08-14", null), member("ASHOKLEY", "2026-08-14", null)];
    ok("same scheduled date → ticker order, stable", orderPending(tiedPending).map((m) => m.symbol).join(",") === "ASHOKLEY,VOLTAS");
    ok("…and reversing the input does not change it", orderPending([...tiedPending].reverse()).map((m) => m.symbol).join(",") === "ASHOKLEY,VOLTAS");
    // Neither may mutate its caller's array.
    const before = roster.map((m) => m.symbol).join(",");
    orderReported(roster);
    orderPending(roster);
    ok("neither ordering mutates the input", roster.map((m) => m.symbol).join(",") === before);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("15 · ★ CAPSULES — a link IFF a filing exists, and the date basis follows it");
  {
    const filed = capsuleFor(member("RAMCOCEM", "2026-08-07", "2026-08-07"));
    ok("a reported capsule links to the results page", filed.href === "/results/RAMCOCEM?tab=snapshot", String(filed.href));
    ok("…and its date basis is the FILING", filed.dateBasis === "filing");
    ok("…and its date text is the app's voice", filed.dateText === "7 August", filed.dateText);
    ok("…with no year", !/20\d\d/.test(filed.dateText));
    ok("…and the ISO date rides along for telemetry", filed.date === "2026-08-07", filed.date);

    const pending = capsuleFor(member("SIEMENS", "2026-08-11", null));
    ok("a pending capsule carries NO link — there is nothing filed to open", pending.href === null, String(pending.href));
    ok("…and its date basis is the MEETING", pending.dateBasis === "meeting");
    ok("…and it names the scheduled date", pending.dateText === "11 August", pending.dateText);

    // A filing that slipped past the meeting date: the capsule must name when it was PUBLISHED.
    const slipped = capsuleFor(member("HAL", "2026-08-12", "2026-08-14"));
    ok("a slipped filing names the publication date, not the meeting", slipped.dateText === "14 August" && slipped.date === "2026-08-14", slipped.dateText);

    // ★ THE UNSCORED MEMBER STILL LINKS. Measured against the live read layer: /results/:symbol 404s
    //   only when a stock has no filed quarterly result at all, so scoring is irrelevant to the href.
    const unscored = capsuleFor(member("MOTHERSON", "2026-07-30", "2026-07-30", false));
    ok("an UNSCORED reported member still links", unscored.href === "/results/MOTHERSON?tab=snapshot", String(unscored.href));

    // The href is encoded by the SAME function the stock strip's control uses.
    ok("the symbol is URL-encoded", capsuleFor(member("M&M", "2026-07-30", "2026-07-30")).href === "/results/M%26M?tab=snapshot");
    ok("the capsule carries the company name for its label", filed.name === "RAMCOCEM Ltd");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("16 · THE SERVER-BUILT CONTROL");
  {
    ok("link label", GROUP_LINK_LABEL === "Open results feed", GROUP_LINK_LABEL);
    ok("link href is built server-side", groupLinkHref() === "/results", groupLinkHref());
    ok("the label is a CONTROL, not a sentence — it is not scanned as copy", !everyString().some((s) => s.text.includes(GROUP_LINK_LABEL)));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("17 · ★ EXPOSURE MARKERS — four states, and 'both' is one of them");
  {
    const states: CapsuleExposure[] = ["none", "held", "watching", "both"];
    for (const e of states) {
      const c = capsuleFor(member("SUNPHARMA", "2026-07-31", "2026-07-31", true, e));
      ok(`a ${e} capsule carries exposure="${e}"`, c.exposure === e, c.exposure);
    }
    // ⚠ "both" MUST SURVIVE THE ROUND TRIP. The stock strip resolves held-beats-watching; if that
    //   precedence ever leaks into this path a both-member silently loses its watchlist ring and the
    //   sentence stops agreeing with the row.
    ok(
      "'both' is never collapsed to 'held'",
      capsuleFor(member("HDFCBANK", "2026-07-17", "2026-07-17", true, "both")).exposure === "both",
    );
    // The marker rides independently of everything else the capsule carries.
    const pendingBoth = capsuleFor(member("SIEMENS", "2026-08-11", null, true, "both"));
    ok("a PENDING capsule can be marked too", pendingBoth.exposure === "both" && pendingBoth.href === null);
    const unscoredHeld = capsuleFor(member("MOTHERSON", "2026-07-30", "2026-07-30", false, "held"));
    ok("an UNSCORED reported capsule can be marked, and still links", unscoredHeld.exposure === "held" && unscoredHeld.href !== null);
    ok(
      "ordering ignores the marker",
      orderReported([
        member("B", "2026-07-20", "2026-07-20", true, "none"),
        member("A", "2026-07-31", "2026-07-31", true, "both"),
      ])
        .map((m) => m.symbol)
        .join(",") === "A,B",
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("18 · ★★ THE SENTENCE AND THE MARKERS AGREE — one fact, one source");
  {
    // THE BUG THIS EXISTS FOR. The sentence says "One is on your watchlist"; the capsules each wear a
    // mark. Those are two renderings of one fact, and the way they drift is by being computed twice.
    // `exposureCounts` counts the MARKERS, the service feeds its result straight into the copy, and
    // this asserts the identity against `capsuleFor`'s output — the same objects the frontend draws.
    const rosters: [string, SeasonMember[]][] = [
      ["nobody exposed", [member("ACC", "2026-07-24", "2026-07-24"), member("SHREECEM", "2026-07-31", "2026-07-31")]],
      ["one held", [member("CUMMINSIND", "2026-08-05", "2026-08-05", true, "held"), member("ABB", "2026-07-31", "2026-07-31")]],
      ["one watched", [member("GLENMARK", "2026-07-31", "2026-07-31", true, "watching"), member("CIPLA", "2026-07-23", "2026-07-23")]],
      ["held + watched, different members (the live Capital Goods case)", [
        member("CUMMINSIND", "2026-08-05", "2026-08-05", true, "held"),
        member("LT", "2026-07-28", "2026-07-28", true, "watching"),
        member("BHEL", "2026-07-16", "2026-07-16"),
      ]],
      ["★ ONE member both held AND watched", [
        member("HDFCBANK", "2026-07-17", "2026-07-17", true, "both"),
        member("ICICIBANK", "2026-07-18", "2026-07-18"),
      ]],
      ["a both-member beside a watch-only one", [
        member("HDFCBANK", "2026-07-17", "2026-07-17", true, "both"),
        member("AXISBANK", "2026-07-18", "2026-07-18", true, "watching"),
      ]],
      ["every member both", [
        member("A", "2026-07-17", "2026-07-17", true, "both"),
        member("B", "2026-07-18", "2026-07-18", true, "both"),
      ]],
    ];
    for (const [label, roster] of rosters) {
      const counts = exposureCounts(roster);
      // What the ROW will actually draw, off the very capsules the payload carries.
      const capsules = [...orderReported(roster), ...orderPending(roster)].map(capsuleFor);
      const drawnHeld = capsules.filter((c) => c.exposure === "held" || c.exposure === "both").length;
      const drawnWatch = capsules.filter((c) => c.exposure === "watching" || c.exposure === "both").length;
      ok(
        `${label} — counts match the marks (held ${counts.held}, watchlist ${counts.watching})`,
        counts.held === drawnHeld && counts.watching === drawnWatch,
        `counts ${counts.held}/${counts.watching} vs drawn ${drawnHeld}/${drawnWatch}`,
      );
      // …and the SENTENCE built from those counts names them.
      const s2 = say(
        cell({
          state: "all_reported",
          due: roster.length,
          reported: roster.length,
          scored: roster.length,
          held: counts.held,
          watching: counts.watching,
        }),
      );
      if (counts.held > 0) ok(`${label} — the sentence names the holding`, /you hold/i.test(s2.full), s2.full);
      if (counts.watching > 0) ok(`${label} — the sentence names the watchlist`, /watchlist/i.test(s2.full), s2.full);
      if (counts.held === 0 && counts.watching === 0) {
        ok(`${label} — the sentence carries NO exposure clause`, !/you hold|watchlist/i.test(s2.full + s2.short), s2.full);
      }
    }

    // ★ THE PRECEDENCE BUG, AS A NEGATIVE CONTROL. Held-beats-watching would count the both-member
    //   once and print "You hold one of them" beside a capsule wearing a visible watchlist ring.
    const both = [member("HDFCBANK", "2026-07-17", "2026-07-17", true, "both")];
    const precedence = { held: 1, watching: 0 }; // what the stock strip's rule would produce
    const actual = exposureCounts(both);
    ok(
      "NEGATIVE CONTROL — the stock strip's precedence WOULD disagree with the row",
      precedence.watching !== actual.watching,
      `precedence would say watching=${precedence.watching}; the row draws ${actual.watching} ring(s)`,
    );
    ok("…and the rule actually applied counts the marker", actual.held === 1 && actual.watching === 1, JSON.stringify(actual));

    // The legend's CONDITION is the same pair of counts, so it cannot appear without a mark to explain
    // and cannot be absent when one is on screen.
    for (const [label, roster] of rosters) {
      const counts = exposureCounts(roster);
      const anyMark = roster.some((m) => m.exposure !== "none");
      ok(`${label} — legend condition matches the presence of a mark`, (counts.held > 0 || counts.watching > 0) === anyMark);
    }
    // Anonymous: no marks, no counts, no legend, no clause — all four together.
    const anon = [member("ACC", "2026-07-24", "2026-07-24"), member("SHREECEM", "2026-07-31", "2026-07-31")];
    const anonCounts = exposureCounts(anon);
    const anonSay = say(cell({ state: "all_reported", due: 2, reported: 2, scored: 2, held: 0, watching: 0 }));
    ok(
      "anonymous — no marker, no count, no legend, no exposure clause",
      anon.every((m) => m.exposure === "none") &&
        anonCounts.held === 0 &&
        anonCounts.watching === 0 &&
        !/you hold|watchlist/i.test(anonSay.full + anonSay.short),
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("19 · ★ EVERY STATE NAMES ITS SUBJECT IN THE FIRST CLAUSE");
  {
    // The change this asserts: "Seven of the eight have reported" counted members without saying what
    // they had done. Every state must now name the subject, with ONE verb phrase.
    const SUBJECT = /posted results|Results season for this group opens|Nothing has been posted|Season opens|Nothing posted yet/;
    const missing: string[] = [];
    for (const { label, input } of everyCell()) {
      const s3 = say(input);
      if (!SUBJECT.test(s3.full)) missing.push(`${label} · full`);
      if (!SUBJECT.test(s3.short)) missing.push(`${label} · short`);
    }
    ok("every cell names its subject in the first clause", missing.length === 0, missing.slice(0, 4).join(" · ") || "336 strings");

    // ★ ONE VERB, NOT TWO. The retired wording must be gone everywhere, and no second synonym may
    //   have crept in beside "posted results".
    const RETIRED = [
      /\bhave reported\b/,
      /\bhas reported\b/,
      /\breporter filed\b/,
      /\bNothing has been filed\b/,
      /\bNothing filed yet\b/,
      /\b(?:reported|filed) — last on\b/,
      /\bof \w+ in,/,
      /\bof \w+ in —/,
    ];
    const leaks: string[] = [];
    for (const { label, input } of everyCell()) {
      const s3 = say(input);
      for (const re of RETIRED) {
        if (re.test(s3.full)) leaks.push(`${label} · full ${re}`);
        if (re.test(s3.short)) leaks.push(`${label} · short ${re}`);
      }
    }
    ok("the retired subject-less wording is gone from every cell", leaks.length === 0, leaks.slice(0, 4).join(" · ") || "clean");
    ok("NEGATIVE CONTROL — the retired wording WOULD be caught", RETIRED.some((re) => re.test("Seven of the eight have reported.")));
    ok("NEGATIVE CONTROL — the retired SHORT wording WOULD be caught", RETIRED.some((re) => re.test("Nine of ten in — ZYDUSLIFE left, 11 August.")));

    // …and the degenerate one-member branches carry it too.
    for (const input of [
      cell({ state: "all_reported", due: 1, reported: 1, scored: 1 }),
      cell({ state: "none_reported", due: 1, reported: 0, scored: 1 }),
    ]) {
      const s3 = say(input);
      ok(`one-dated-member · ${input.state} names the subject`, SUBJECT.test(s3.full) && SUBJECT.test(s3.short), s3.short);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("20 · ★★ A NAMED MEMBER IS A CAPSULE, NOT PROSE — and only one state names one");
  {
    // THE MISMATCH THIS EXISTS FOR. "Only Petronet LNG Ltd is left, on 12 August" put the company in
    // prose while the identical company, one row below, was a bordered capsule wearing the reader's
    // own exposure marker. One object, two renderings, and only one of them looked like an object.

    const stockSegs = (segs: SentenceSegment[]) => segs.filter((s) => s.stock);

    // ── Which states name a member AT ALL. The brief's instruction was to check every one. ──────────
    const naming: string[] = [];
    for (const state of ["none_reported", "partly", "one_remaining", "all_reported"] as GroupSeasonState[]) {
      for (const ahead of [true, false]) {
        // `all_reported` has no pending date and therefore no ahead/behind branch.
        if (state === "all_reported" && !ahead) continue;
        const s4 = say(cell({ state, firstIsAhead: ahead, nextIsAhead: ahead }));
        const n = stockSegs(s4.segs).length;
        const nShort = stockSegs(s4.shortSegs).length;
        ok(
          `${state}/${ahead ? "ahead" : "behind"} — full and short agree on how many members they name`,
          n === nShort,
          `full ${n}, short ${nShort}`,
        );
        if (n > 0) naming.push(`${state}/${ahead ? "ahead" : "behind"}`);
      }
    }
    ok(
      "ONLY `one_remaining` names a member — checked across all four states, both branches",
      naming.every((k) => k.startsWith("one_remaining")) && naming.length === 2,
      naming.join(", ") || "none",
    );
    ok(
      "…and it names EXACTLY ONE, in both forms and both branches",
      (["one_remaining"] as GroupSeasonState[]).every((state) =>
        [true, false].every((ahead) => {
          const s4 = say(cell({ state, firstIsAhead: ahead, nextIsAhead: ahead }));
          return stockSegs(s4.segs).length === 1 && stockSegs(s4.shortSegs).length === 1;
        }),
      ),
    );
    // The degenerate one-dated-member season resolves `none_reported`, so it names nobody — the state
    // precedence at work, asserted here so a change to it shows up as a capsule appearing.
    for (const input of [
      cell({ state: "none_reported", due: 1, reported: 0, scored: 1 }),
      cell({ state: "all_reported", due: 1, reported: 1, scored: 1 }),
    ]) {
      const s4 = say(input);
      ok(`one-dated-member · ${input.state} names no member`, stockSegs(s4.segs).length === 0 && stockSegs(s4.shortSegs).length === 0);
    }

    // ── THE INVARIANTS ON THE SEGMENT ITSELF ───────────────────────────────────────────────────────
    const bad: string[] = [];
    let seen = 0;
    for (const { label, input } of everyCell()) {
      const s4 = say(input);
      for (const [form, segs] of [["full", s4.segs], ["short", s4.shortSegs]] as const) {
        for (const seg of stockSegs(segs)) {
          seen++;
          const st = seg.stock as SentenceStock;
          if (seg.text !== st.symbol) bad.push(`${label} · ${form}: text "${seg.text}" ≠ symbol "${st.symbol}"`);
          if (seg.mono) bad.push(`${label} · ${form}: a stock segment must not also be mono`);
          if (!st.name) bad.push(`${label} · ${form}: no name for the accessible label`);
        }
      }
    }
    ok(`all ${seen} stock segments: text IS the ticker, never mono, and carry a name`, bad.length === 0, bad.slice(0, 4).join(" · ") || "clean");

    // ★ THE COMPANY NAME MUST NOT APPEAR IN THE RENDERED SENTENCE. It rides on the capsule's label and
    //   its hover title — the reader sees the ticker, which is what the row below shows.
    const nameLeaks = everyString().filter((s) => s.text.includes(LAST_ONE.name));
    ok(
      "the company NAME appears in no rendered string — the ticker does",
      nameLeaks.length === 0,
      nameLeaks.slice(0, 2).map((n) => n.label).join(" · ") || "clean",
    );
    ok(
      "NEGATIVE CONTROL — the retired prose form WOULD be caught",
      "Nine of the ten have posted results. Only Zydus Lifesciences Ltd is left, on 11 August.".includes(LAST_ONE.name),
    );
    ok(
      "the ticker IS in the rendered sentence, both forms",
      say(cell({ state: "one_remaining" })).full.includes("Only ZYDUSLIFE is left") &&
        say(cell({ state: "one_remaining" })).short.includes("— ZYDUSLIFE left,"),
      say(cell({ state: "one_remaining" })).short,
    );

    // ── THE MARKER RIDES THROUGH, AND IT IS THE SAME UNION THE CAPSULE ROW USES ────────────────────
    for (const e of ["none", "held", "watching", "both"] as CapsuleExposure[]) {
      const s4 = say(cell({ state: "one_remaining", lastOne: { ...LAST_ONE, exposure: e } }));
      const full = s4.segs.find((x) => x.stock)?.stock;
      const short = s4.shortSegs.find((x) => x.stock)?.stock;
      ok(`exposure "${e}" reaches the sentence capsule in both forms`, full?.exposure === e && short?.exposure === e, `${full?.exposure}/${short?.exposure}`);
    }
    ok(
      "…and it does not change one character of the rendered text — a marker is not a word",
      say(cell({ state: "one_remaining", lastOne: { ...LAST_ONE, exposure: "both" } })).full ===
        say(cell({ state: "one_remaining", lastOne: LAST_ONE })).full,
    );

    // ── THE LINK FOLLOWS THE FILING, exactly as §15 requires of a row capsule ──────────────────────
    ok(
      "the remaining member carries no link — it is pending, and there is nothing filed to open",
      say(cell({ state: "one_remaining" })).segs.find((x) => x.stock)?.stock?.href === null,
    );
    // A href, when one is threaded, survives to both forms — so the rule stays "linked iff filed"
    // rather than "the sentence never links".
    const linked = say(cell({ state: "one_remaining", lastOne: { ...LAST_ONE, href: "/results/ZYDUSLIFE?tab=snapshot" } }));
    ok(
      "…and a threaded href reaches both forms unchanged",
      linked.segs.find((x) => x.stock)?.stock?.href === "/results/ZYDUSLIFE?tab=snapshot" &&
        linked.shortSegs.find((x) => x.stock)?.stock?.href === "/results/ZYDUSLIFE?tab=snapshot",
    );

    // ── AND THE JOINED SENTENCE IS STILL SCANNABLE COPY ───────────────────────────────────────────
    // `sentence`/`shortSentence` are what the copy gate reads. A structural segment that dropped out
    // of the join would take the member's name out of every scan in this file with it.
    const j = say(cell({ state: "one_remaining" }));
    ok("the ticker survives the join into `sentence`", j.full.includes("ZYDUSLIFE"), j.full);
    ok("…and into `shortSentence`", j.short.includes("ZYDUSLIFE"), j.short);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(100));
  const cells = everyCell().length;
  console.log(`matrix: ${cells} cells × 2 forms = ${cells * 2} rendered strings`);
  if (failures > 0) {
    console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  console.log("PASSED — every state × reader-exposure × scoring cell holds, in both quarter voices and both forms.");
}

main().catch((e) => {
  console.error("verify-results-season-group crashed:", e);
  process.exit(1);
});
