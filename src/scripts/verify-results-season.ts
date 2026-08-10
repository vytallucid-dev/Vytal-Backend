// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — THE RESULTS-SEASON BANNER: its copy matrix, its window arithmetic, and its surviving checks.
//
// A build gate (no DB, no frontend checkout — pure functions only), so it lives in `verify:copy`.
//
// ── THE MATRIX IT COVERS ───────────────────────────────────────────────────────────────────────────
//   4 phases × 3 positions × 2 copy sets × 2 quarter voices × 2 forms, plus the publication branch
//   inside `after`. Every cell is composed and scanned.
//
// ── WHAT IT HARD-FAILS ON ──────────────────────────────────────────────────────────────────────────
//  1 · Every authored sentence, byte-identical. Copy specified verbatim can only stay verbatim if
//      something compares it; a paraphrase during a refactor is invisible to review.
//  1b· ★ THE POST-RESULT PHASES CARRY NO SCORE CLAUSE, and the two copy sets CONVERGE there. This is
//      the assertion that keeps the staleness claim from creeping back one sentence at a time — it is
//      what forced the two deleted gates, and deleting them only helps if the claim stays gone.
//  2 · scanForwardLanguage — THE existing forward-language scan (R2/R3) — over every full AND short
//      form, with negative controls proving the scan is actually reaching the strings.
//  3 · Part 2's mechanical constraints over both forms: no promise of movement, no lag number, no
//      instruction verb, and no `expect`.
//  4 · ★ THE UNSCORED SET NAMES NO SCORE, NO PILLAR, NO INGESTION AND NO STALENESS. That is the whole
//      reason it exists — on a stock with no snapshot each of those clauses has no referent.
//  5 · ★ THE PILLAR VOICE MATCHES THE FILING. A Q1/Q2/Q3 meeting must not name Foundation; a Q4 one
//      must. This is the assertion that replaced a standing warning.
//  6 · The window arithmetic at every boundary, including the reschedule-residue pick.
//  7 · The unconfirmed-publication branch makes NO publication claim, in BOTH copy sets and BOTH forms.
//
// ── NO STANDING WARNINGS ───────────────────────────────────────────────────────────────────────────
// This gate used to print two, for the pillar overstatement and for "so expect the score here to
// shift". Both are fixed, so both warnings are gone and each is now an ASSERTION instead — the point
// of a warning is to stop existing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { scanForwardLanguage } from "../scoring/findings/trajectory/regime-tier.js";
// ★ THE THREE MECHANICAL SCANS NOW LIVE IN ONE PLACE AND SERVE TWO GATES. They were authored here for
//   the stock strip; the peer-group section (verify-results-season-group.ts) is a second consumer of
//   the same discipline, and two copies of a lint drift the first time one of them gains a pattern.
//   The lists moved byte-identical — every negative control below still runs against them from here.
import { INSTRUCTION, LAG_NUMBER, MOVEMENT_PROMISE } from "./lib/results-season-scans.js";
import {
  composeCopy,
  joinSegments,
  pillarVoice,
  positionChipLabel,
  linkHref,
  LINK_LABEL,
} from "../results-season/copy.js";
import {
  daysOut,
  formatBannerDate,
  periodDescriptorFor,
  periodEndFor,
  phaseFor,
  pickScheduledDate,
  pillarsAtStakeFor,
  utcMidnight,
  type PeriodDescriptor,
} from "../results-season/window.js";
import type {
  ReaderPosition,
  ResultsSeasonCopySet,
  ResultsSeasonPhase,
} from "../results-season/types.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DATE = "12 August";

const Q1 = ["momentum"] as const; // a Q1/Q2/Q3 filing — Momentum only
const Q4 = ["foundation", "momentum"] as const; // the annual-bearing Q4 filing — both pillars

// The two period descriptors, taken from REAL meeting dates rather than hand-built, so the gate is
// driven by the same derivation the service runs.
const JUN = periodDescriptorFor(D("2026-08-12")); // a Q1 meeting → June quarter, no annual
const MAR = periodDescriptorFor(D("2026-05-14")); // a Q4 meeting → March quarter, annual rides along

type Cell = {
  phase: ResultsSeasonPhase;
  position: ReaderPosition;
  copySet: ResultsSeasonCopySet;
  confirmed: boolean;
  pillars: readonly ("foundation" | "momentum")[];
  period: PeriodDescriptor;
};

function say(c: Cell): { full: string; short: string } {
  const dateText = c.phase === "day_of" || c.phase === "filed_today" ? null : DATE;
  const r = composeCopy(c.phase, c.position, c.copySet, dateText, c.confirmed, c.pillars, c.period);
  return { full: joinSegments(r.segments), short: joinSegments(r.shortSegments) };
}

/** Every cell of the matrix, labelled. BOTH quarter voices for BOTH copy sets — the scored set varies
 *  by pillar, the unscored set by what the filing contains, and each needs its own coverage. */
function everyCell(): { label: string; cell: Cell }[] {
  const out: { label: string; cell: Cell }[] = [];
  const positions: ReaderPosition[] = ["held", "watching", "none"];
  const phases: ResultsSeasonPhase[] = ["before", "day_of", "filed_today", "after"];
  for (const phase of phases) {
    for (const position of positions) {
      // `after` has a publication branch. `filed_today` is reachable ONLY with a filing, so it is
      // always confirmed; `before`/`day_of` are reachable only WITHOUT one, so never.
      const confirmations = phase === "after" ? [true, false] : phase === "filed_today" ? [true] : [false];
      for (const confirmed of confirmations) {
        const suffix = phase === "after" ? (confirmed ? " (published)" : " (scheduled only)") : "";
        for (const [pillars, period] of [
          [Q1, JUN],
          [Q4, MAR],
        ] as const) {
          const voice = pillars.length === 1 ? "Q1–Q3" : "Q4";
          out.push({
            label: `scored/${phase}/${position}${suffix} [${voice}]`,
            cell: { phase, position, copySet: "scored", confirmed, pillars, period },
          });
          out.push({
            label: `unscored/${phase}/${position}${suffix} [${voice}]`,
            cell: { phase, position, copySet: "unscored", confirmed, pillars: [], period },
          });
        }
      }
    }
  }
  return out;
}

/** Every rendered string — both forms of every cell. What the scans run over. */
function everyString(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const { label, cell } of everyCell()) {
    const s = say(cell);
    out.push({ label: `${label} · full`, text: s.full });
    out.push({ label: `${label} · short`, text: s.short });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORED STRINGS. Transcribed from the brief, never re-derived from the composer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** SCORED, Q1–Q3 (Momentum only) — the brief's nine sentences with the two corrections applied. */
const SCORED_Q1_FULL: Record<string, string> = {
  "before/held":
    "You hold this one, and results are due on 12 August. That filing is what Momentum is built from, so the reading on this page is likely to move once the numbers are in.",
  "before/watching":
    "This is on your watchlist and results are due on 12 August. One of the four pillars is drawn straight from the quarterly filing, so the score here is likely to shift once it lands.",
  "before/none":
    "Results are due on 12 August. Momentum reads the quarterly accounts, so the health score on this page will be built on new numbers shortly after.",
  "day_of/held":
    "Results are due today, and you hold this one. Once the filing is out and the figures are in, Momentum will be scored against them — the reading below is still the previous quarter's.",
  "day_of/watching":
    "Results are due today on a name you're watching. Once the filing is out and the figures are in, Momentum will be scored against them — the reading below is still the previous quarter's.",
  "day_of/none":
    "Results are due today. Once the filing is out and the figures are in, Momentum will be scored against them — the reading below is still the previous quarter's.",
  // ⚠ NO `after` ROWS. The scored set no longer HAS a post-result voice — it delegates to the
  //   results-only one, and section 1b asserts that delegation directly. Leaving stale expectations
  //   here would test a code path that no longer exists.
};

/** SCORED, Q4 (the annual rides with the quarter) — ★ the brief's ORIGINAL pillar wording, which is
 *  true exactly here and survives unchanged. Only the `expect` correction applies. */
const SCORED_Q4_FULL: Record<string, string> = {
  "before/held":
    "You hold this one, and results are due on 12 August. That filing is what Foundation and Momentum are built from, so the reading on this page is likely to move once the numbers are in.",
  "before/watching":
    "This is on your watchlist and results are due on 12 August. Two of the four pillars are drawn straight from the quarterly filing, so the score here is likely to shift once it lands.",
  "before/none":
    "Results are due on 12 August. Foundation and Momentum both read the quarterly accounts, so the health score on this page will be built on new numbers shortly after.",
  "day_of/held":
    "Results are due today, and you hold this one. Once the filing is out and the figures are in, Foundation and Momentum will be scored against them — the reading below is still the previous quarter's.",
  "day_of/watching":
    "Results are due today on a name you're watching. Once the filing is out and the figures are in, Foundation and Momentum will be scored against them — the reading below is still the previous quarter's.",
  "day_of/none":
    "Results are due today. Once the filing is out and the figures are in, Foundation and Momentum will be scored against them — the reading below is still the previous quarter's.",
  // ⚠ NO `after` ROWS — see the note on SCORED_Q1_FULL.
};

/** UNSCORED, Q1–Q3 — the results fact, the reader's position, and what the filing contains. */
const UNSCORED_JUN_FULL: Record<string, string> = {
  "before/held":
    "You hold this one, and results are due on 12 August. The June-quarter top line, profit and margins will be on the results page once they are filed.",
  "before/watching":
    "This is on your watchlist and results are due on 12 August. The June-quarter top line, profit and margins will be on the results page once they are filed.",
  "before/none":
    "Results are due on 12 August. The June-quarter top line, profit and margins will be on the results page once they are filed.",
  "day_of/held":
    "Results are due today, and you hold this one. The June-quarter top line, profit and margins will be on the results page once they are filed.",
  "day_of/watching":
    "Results are due today on a name you're watching. The June-quarter top line, profit and margins will be on the results page once they are filed.",
  "day_of/none":
    "Results are due today. The June-quarter top line, profit and margins will be on the results page once they are filed.",
  "after/held":
    "Results were published on 12 August, and you hold this one. The June-quarter top line, profit and margins are on the results page.",
  "after/watching":
    "Results came out on 12 August, and you're watching this one. The June-quarter top line, profit and margins are on the results page.",
  "after/none":
    "Results were published on 12 August. The June-quarter top line, profit and margins are on the results page.",
};

/** UNSCORED, Q4 — the audited full year rides with the March quarter, and the clause says so. */
const UNSCORED_MAR_FULL: Record<string, string> = {
  "before/held":
    "You hold this one, and results are due on 12 August. A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
  "before/watching":
    "This is on your watchlist and results are due on 12 August. A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
  "before/none":
    "Results are due on 12 August. A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
  "day_of/held":
    "Results are due today, and you hold this one. A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
  "day_of/watching":
    "Results are due today on a name you're watching. A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
  "day_of/none":
    "Results are due today. A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
  "after/held":
    "Results were published on 12 August, and you hold this one. That filing carried the audited full-year accounts as well as the March quarter, and both are on the results page.",
  "after/watching":
    "Results came out on 12 August, and you're watching this one. That filing carried the audited full-year accounts as well as the March quarter, and both are on the results page.",
  "after/none":
    "Results were published on 12 August. That filing carried the audited full-year accounts as well as the March quarter, and both are on the results page.",
};

/** THE SHORT FORMS, Q1–Q3 + unscored. Below 640px. */
const SHORT_Q1: Record<string, string> = {
  "before/held": "You hold this. Results are due 12 August — Momentum is scored from that filing.",
  "before/watching": "You're watching this. Results are due 12 August — Momentum is scored from that filing.",
  "before/none": "Results are due 12 August — Momentum is scored from that filing.",
  "day_of/held": "You hold this. Results are due today — Momentum is scored from that filing; the reading below is last quarter's.",
  "day_of/watching": "You're watching this. Results are due today — Momentum is scored from that filing; the reading below is last quarter's.",
  "day_of/none": "Results are due today — Momentum is scored from that filing; the reading below is last quarter's.",
  // ⚠ NO `after` ROWS — the scored short form delegates post-result too.
};

/** UNSCORED short, Q1–Q3 — ONE sentence, the contents riding in behind a dash. */
const SHORT_UNSCORED_JUN: Record<string, string> = {
  "before/held": "You hold this. Results are due 12 August — the June-quarter figures land on the results page once they are filed.",
  "before/watching": "You're watching this. Results are due 12 August — the June-quarter figures land on the results page once they are filed.",
  "before/none": "Results are due 12 August — the June-quarter figures land on the results page once they are filed.",
  "day_of/held": "You hold this. Results are due today — the June-quarter figures land on the results page once they are filed.",
  "day_of/watching": "You're watching this. Results are due today — the June-quarter figures land on the results page once they are filed.",
  "day_of/none": "Results are due today — the June-quarter figures land on the results page once they are filed.",
  "after/held": "You hold this. Results were published 12 August — the June-quarter figures are on the results page.",
  "after/watching": "You're watching this. Results came out 12 August — the June-quarter figures are on the results page.",
  "after/none": "Results were published 12 August — the June-quarter figures are on the results page.",
};

/** UNSCORED short, Q4. */
const SHORT_UNSCORED_MAR: Record<string, string> = {
  "before/held": "You hold this. Results are due 12 August — the March quarter and the audited full-year accounts.",
  "before/watching": "You're watching this. Results are due 12 August — the March quarter and the audited full-year accounts.",
  "before/none": "Results are due 12 August — the March quarter and the audited full-year accounts.",
  "day_of/held": "You hold this. Results are due today — the March quarter and the audited full-year accounts.",
  "day_of/watching": "You're watching this. Results are due today — the March quarter and the audited full-year accounts.",
  "day_of/none": "Results are due today — the March quarter and the audited full-year accounts.",
  "after/held": "You hold this. Results were published 12 August — the March quarter and the audited full-year accounts are on the results page.",
  "after/watching": "You're watching this. Results came out 12 August — the March quarter and the audited full-year accounts are on the results page.",
  "after/none": "Results were published 12 August — the March quarter and the audited full-year accounts are on the results page.",
};

/** ★ FILED TODAY, Q1–Q3 — the phase that replaced gate 3's silence. Given verbatim in the brief.
 *  Identical for scored and unscored: post-result, there is no score clause in either. */
const FILED_TODAY_JUN_FULL: Record<string, string> = {
  "filed_today/held":
    "Results came out today, and you hold this one. The June-quarter top line, profit and margins are on the results page.",
  "filed_today/watching":
    "Results came out today on a name you're watching. The June-quarter top line, profit and margins are on the results page.",
  "filed_today/none":
    "Results came out today. The June-quarter top line, profit and margins are on the results page.",
};

/** FILED TODAY, Q4 — the audited full year rides with the March quarter. */
const FILED_TODAY_MAR_FULL: Record<string, string> = {
  "filed_today/held":
    "Results came out today, and you hold this one. That filing carried the audited full-year accounts as well as the March quarter, and both are on the results page.",
  "filed_today/watching":
    "Results came out today on a name you're watching. That filing carried the audited full-year accounts as well as the March quarter, and both are on the results page.",
  "filed_today/none":
    "Results came out today. That filing carried the audited full-year accounts as well as the March quarter, and both are on the results page.",
};

const FILED_TODAY_JUN_SHORT: Record<string, string> = {
  "filed_today/held": "You hold this. Results came out today — the June-quarter figures are on the results page.",
  "filed_today/watching": "You're watching this. Results came out today — the June-quarter figures are on the results page.",
  "filed_today/none": "Results came out today — the June-quarter figures are on the results page.",
};

const FILED_TODAY_MAR_SHORT: Record<string, string> = {
  "filed_today/held": "You hold this. Results came out today — the March quarter and the audited full-year accounts are on the results page.",
  "filed_today/watching": "You're watching this. Results came out today — the March quarter and the audited full-year accounts are on the results page.",
  "filed_today/none": "Results came out today — the March quarter and the audited full-year accounts are on the results page.",
};

function checkTable(
  title: string,
  table: Record<string, string>,
  copySet: ResultsSeasonCopySet,
  pillars: readonly ("foundation" | "momentum")[],
  period: PeriodDescriptor,
  form: "full" | "short",
) {
  console.log(`\n  ── ${title} ──`);
  for (const [key, expected] of Object.entries(table)) {
    const [phase, position] = key.split("/") as [ResultsSeasonPhase, ReaderPosition];
    const confirmed = phase === "after" || phase === "filed_today";
    const got = say({ phase, position, copySet, confirmed, pillars, period })[form];
    const same = got === expected;
    ok(key, same, same ? "verbatim" : `\n      want: ${expected}\n      got : ${got}`);
  }
}

async function main() {
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★ EVERY AUTHORED SENTENCE, BYTE-IDENTICAL");
  checkTable("SCORED · full · Q1–Q3 voice (Momentum only)", SCORED_Q1_FULL, "scored", Q1, JUN, "full");
  checkTable("SCORED · full · Q4 voice (the brief's original pillar wording)", SCORED_Q4_FULL, "scored", Q4, MAR, "full");
  checkTable("UNSCORED · full · Q1–Q3 (quarter only)", UNSCORED_JUN_FULL, "unscored", [], JUN, "full");
  checkTable("UNSCORED · full · Q4 (audited full year rides along)", UNSCORED_MAR_FULL, "unscored", [], MAR, "full");
  checkTable("SCORED · short · Q1–Q3 voice", SHORT_Q1, "scored", Q1, JUN, "short");
  checkTable("UNSCORED · short · Q1–Q3", SHORT_UNSCORED_JUN, "unscored", [], JUN, "short");
  checkTable("UNSCORED · short · Q4", SHORT_UNSCORED_MAR, "unscored", [], MAR, "short");
  checkTable("★ FILED TODAY · full · Q1–Q3", FILED_TODAY_JUN_FULL, "unscored", [], JUN, "full");
  checkTable("★ FILED TODAY · full · Q4", FILED_TODAY_MAR_FULL, "unscored", [], MAR, "full");
  checkTable("★ FILED TODAY · short · Q1–Q3", FILED_TODAY_JUN_SHORT, "unscored", [], JUN, "short");
  checkTable("★ FILED TODAY · short · Q4", FILED_TODAY_MAR_SHORT, "unscored", [], MAR, "short");

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1b · ★ THE POST-RESULT PHASES CARRY NO SCORE CLAUSE, IN EITHER COPY SET");
  {
    // ★ THE RULING THIS ASSERTS. The post-result sentences used to say "the score on this page is
    //   still built on the previous quarter". That is false within hours of a rescore (p50 2.3h), and
    //   defending it required a gate that hid the banner from nineteen stocks whose results had just
    //   landed. The clause is gone, so the scored and unscored sets CONVERGE post-result. Asserting
    //   the convergence is what stops it drifting back apart one sentence at a time.
    for (const phase of ["filed_today", "after"] as ResultsSeasonPhase[]) {
      for (const position of ["held", "watching", "none"] as ReaderPosition[]) {
        for (const [pillars, period, voice] of [
          [Q1, JUN, "Q1–Q3"],
          [Q4, MAR, "Q4"],
        ] as const) {
          for (const confirmed of phase === "after" ? [true, false] : [true]) {
            const sc = say({ phase, position, copySet: "scored", confirmed, pillars, period });
            const un = say({ phase, position, copySet: "unscored", confirmed, pillars: [], period });
            const tag = `${phase}/${position}${phase === "after" ? (confirmed ? "/published" : "/scheduled") : ""} [${voice}]`;
            if (sc.full !== un.full || sc.short !== un.short) {
              ok(`${tag} — scored and unscored converge`, false, `\n      scored : ${sc.full}\n      unscored: ${un.full}`);
            }
          }
        }
      }
    }
    ok("every post-result cell is identical across copy sets", true, "2 phases × 3 positions × 2 quarters × publication branch");

    // …and no post-result string makes a staleness claim, in either set.
    const STALENESS = [
      /still (?:built on|scored on) the previous quarter/i,
      /hasn't taken them in/i,
      /the reading here is still/i,
      /once they(?:'re| are) ingested/i,
      /once they've been ingested/i,
    ];
    const leaks: string[] = [];
    for (const { label, cell } of everyCell()) {
      if (cell.phase !== "after" && cell.phase !== "filed_today") continue;
      const s = say(cell);
      for (const re of STALENESS) {
        if (re.test(s.full) || re.test(s.short)) leaks.push(`${label} ${re}`);
      }
    }
    ok("no post-result string claims our score is behind", leaks.length === 0, leaks.slice(0, 4).join(" · ") || "clean");
    ok(
      "NEGATIVE CONTROL — the retired after/held sentence WOULD be caught",
      STALENESS.some((re) =>
        re.test("You hold this one, and the score on this page is still built on the previous quarter — it will pick up the new figures once they are ingested."),
      ),
    );

    // The forward phases KEEP their score clause, and it is safe there by construction: `before` and
    // `day_of` are reachable only when no filing exists, so there is no quarter for the score to have
    // missed. Assert the clause is still present, or the reframe would have quietly gutted them too.
    ok(
      "the forward phases still name the score",
      /reading on this page is likely to move/.test(say({ phase: "before", position: "held", copySet: "scored", confirmed: false, pillars: Q1, period: JUN }).full) &&
        /the reading below is still the previous quarter's/.test(say({ phase: "day_of", position: "held", copySet: "scored", confirmed: false, pillars: Q1, period: JUN }).full),
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★ THE PILLAR VOICE MATCHES THE FILING (this replaced a standing warning)");
  {
    // The load-bearing fact: `fundamentals` is annual, so only a Q4 meeting can move Foundation.
    ok("a Q1 meeting names Momentum and NOT Foundation", !/Foundation/.test(SCORED_Q1_FULL["before/held"]) && /Momentum/.test(SCORED_Q1_FULL["before/held"]));
    ok("a Q4 meeting names BOTH", /Foundation and Momentum/.test(SCORED_Q4_FULL["before/held"]));
    ok('"One of the four pillars" for Q1–Q3', /One of the four pillars is/.test(SCORED_Q1_FULL["before/watching"]));
    ok('"Two of the four pillars" for Q4', /Two of the four pillars are/.test(SCORED_Q4_FULL["before/watching"]));

    // Number agreement — the seam a fragment-assembler gets wrong.
    const q1 = pillarVoice(Q1), q4 = pillarVoice(Q4);
    for (const [label, v, sing] of [["Q1–Q3", q1, true], ["Q4", q4, false]] as const) {
      const bad = Object.entries(v).filter(([, s]) =>
        sing ? /\bMomentum (are|both)\b/.test(s) : /\bFoundation and Momentum (is|reads)\b/.test(s),
      );
      ok(`${label} voice agrees in number across all ${Object.keys(v).length} clauses`, bad.length === 0, bad.map(([k]) => k).join(",") || "clean");
    }

    // And the derivation itself, driven off real meeting dates.
    ok("2026-08-12 (Q1) → momentum only", pillarsAtStakeFor(D("2026-08-12")).join() === "momentum");
    ok("2026-05-14 (Q4) → foundation + momentum", pillarsAtStakeFor(D("2026-05-14")).join() === "foundation,momentum");
    ok("no sentence in ANY cell names Foundation when the pillars do not", everyCell().every(({ cell }) => {
      const t = say(cell).full + say(cell).short;
      return cell.pillars.includes("foundation") || !/Foundation/.test(t);
    }));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ THE UNSCORED SET CLAIMS NOTHING ABOUT A SCORE THAT DOES NOT EXIST");
  {
    // Each pattern names something with no referent on an unscored page.
    const FORBIDDEN: [RegExp, string][] = [
      [/\bscore\b/i, "there is no score on this page"],
      [/\bscored\b/i, "nothing was scored"],
      [/\breading\b/i, "there is no reading"],
      [/\bpillar/i, "no pillar is computed"],
      [/\bFoundation\b/, "names a pillar"],
      [/\bMomentum\b/, "names a pillar"],
      [/\bingest/i, "nothing is waiting to be ingested into a score"],
      [/\bprevious quarter\b/i, "asserts staleness of a score that does not exist"],
      [/\blast quarter\b/i, "asserts staleness of a score that does not exist"],
      [/\bquarterly (?:filing|accounts)\b/i, "connects the filing to a computation we do not run here"],
    ];
    const hits: string[] = [];
    let n = 0;
    for (const { label, cell } of everyCell()) {
      if (cell.copySet !== "unscored") continue;
      const s = say(cell);
      for (const form of [s.full, s.short]) {
        n++;
        for (const [re, why] of FORBIDDEN) if (re.test(form)) hits.push(`${label}: ${why} — ${re}`);
      }
    }
    ok(`all ${n} unscored strings are clean of score/pillar/ingestion/staleness`, hits.length === 0, hits.slice(0, 6).join(" · ") || "clean");

    // NEGATIVE CONTROL — the scan must bite the scored copy, or it is proving nothing.
    // ⚠ `before`, NOT `after`. The post-result phases no longer carry a score clause in EITHER set, so
    //   an after-phase control would pass for the wrong reason — it would prove the scan is dead, not
    //   that it discriminates. The scored voice now lives only in the two forward phases.
    const scored = say({ phase: "before", position: "held", copySet: "scored", confirmed: false, pillars: Q1, period: JUN }).full;
    ok("NEGATIVE CONTROL — the same scan DOES bite the scored copy (forward phase)", FORBIDDEN.some(([re]) => re.test(scored)), "caught");

    // …and the unscored set still carries what it is FOR.
    for (const { label, cell } of everyCell()) {
      if (cell.copySet !== "unscored") continue;
      const s = say(cell);
      // Case-insensitive: "results" is mid-sentence in the held/watching before-variants.
      if (!/\bresults\b/i.test(s.full) || !/\bresults\b/i.test(s.short)) ok(`${label} states the results fact`, false);
    }
    ok("every unscored string still states the results fact", true, "9 cells × 2 forms");
    ok("unscored/held names the holding", /you hold this/i.test(UNSCORED_JUN_FULL["before/held"]));
    ok("unscored/watching names the watchlist", /watchlist/i.test(UNSCORED_JUN_FULL["before/watching"]));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3b · ★ THE UNSCORED SET NAMES WHAT THE FILING CONTAINS, AND VARIES IT BY QUARTER");
  {
    // Every unscored string must carry the contents clause — the date alone was the thin version.
    const missing: string[] = [];
    for (const { label, cell } of everyCell()) {
      if (cell.copySet !== "unscored") continue;
      const s = say(cell);
      if (!/results page/i.test(s.full)) missing.push(`${label} · full`);
      // The short Q4 future rider names the contents without the page, by design (width).
      if (!/results page|full-year accounts/i.test(s.short)) missing.push(`${label} · short`);
    }
    ok("every unscored string names what the filing contains", missing.length === 0, missing.join(" · ") || "18 cells × 2 forms");

    // ★ THE QUARTER ACTUALLY CHANGES THE CLAUSE. Without this the Q4 branch could be dead code and
    //   every reader would be told a quarterly filing is all there is, in the one quarter it is not.
    for (const phase of ["before", "day_of", "after"] as ResultsSeasonPhase[]) {
      const jun = say({ phase, position: "none", copySet: "unscored", confirmed: phase === "after", pillars: [], period: JUN });
      const mar = say({ phase, position: "none", copySet: "unscored", confirmed: phase === "after", pillars: [], period: MAR });
      ok(`unscored/${phase} — Q1–Q3 and Q4 differ`, jun.full !== mar.full && jun.short !== mar.short);
      ok(`unscored/${phase} — only the Q4 voice names the full year`, !/full-year/i.test(jun.full) && /full-year accounts/i.test(mar.full));
      ok(`unscored/${phase} — the period month is named`, /June/.test(jun.full) && /March/.test(mar.full));
    }

    // The derivation, from real meeting dates — the same one the service calls.
    ok("2026-08-12 → June, not annual-bearing", JUN.monthName === "June" && JUN.isAnnualBearing === false, JSON.stringify(JUN));
    ok("2026-05-14 → March, annual-bearing", MAR.monthName === "March" && MAR.isAnnualBearing === true, JSON.stringify(MAR));
    ok("2026-11-05 → September", periodDescriptorFor(D("2026-11-05")).monthName === "September");
    ok("2027-02-04 → December", periodDescriptorFor(D("2027-02-04")).monthName === "December");

    // ⚠ TENSE. Only the CONFIRMED post-result branch may say the figures ARE on the page; everywhere
    //   else nothing is known to have been filed, so the clause must speak in the future.
    for (const { label, cell } of everyCell()) {
      if (cell.copySet !== "unscored") continue;
      const filed = (cell.phase === "after" || cell.phase === "filed_today") && cell.confirmed;
      const s = say(cell).full;
      const presentTense = /\b(?:are|is) on the results page\b/i.test(s);
      if (presentTense !== filed) ok(`${label} — tense matches the publication state`, false, s);
    }
    ok("every unscored clause's tense matches whether a filing exists", true, "present only where confirmed");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★ THE DATE IS A SEGMENT, IN MONO, AND ONLY WHERE THE SENTENCE CARRIES ONE");
  {
    let dated = 0, dayOf = 0;
    for (const { label, cell } of everyCell()) {
      const noDate = cell.phase === "day_of" || cell.phase === "filed_today";
      const dateText = noDate ? null : DATE;
      const r = composeCopy(cell.phase, cell.position, cell.copySet, dateText, cell.confirmed, cell.pillars, cell.period);
      for (const [form, segs] of [["full", r.segments], ["short", r.shortSegments]] as const) {
        const mono = segs.filter((s) => s.mono);
        if (noDate) {
          dayOf++;
          if (mono.length !== 0) ok(`${label} · ${form} — a "today" phase carries no mono segment`, false, `${mono.length}`);
          if (/August/.test(joinSegments(segs))) ok(`${label} · ${form} — a "today" phase names no date`, false);
        } else {
          dated++;
          if (mono.length !== 1) ok(`${label} · ${form} — exactly one mono segment`, false, `${mono.length}`);
          else if (mono[0].text !== DATE) ok(`${label} · ${form} — the mono segment IS the date`, false, mono[0].text);
          if (segs.filter((s) => !s.mono).some((s) => s.text.includes(DATE))) {
            ok(`${label} · ${form} — the date is not duplicated into a plain segment`, false);
          }
        }
      }
    }
    ok(`${dated} dated strings carry exactly one mono date segment`, true);
    ok(`${dayOf} "today"-phase strings carry none, and name no date`, true);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ★ THE EXISTING FORWARD-LANGUAGE SCAN (R2/R3) OVER EVERY STRING");
  {
    const all = everyString();
    const leaks: string[] = [];
    for (const s of all) for (const v of scanForwardLanguage(s.text)) leaks.push(`${s.label}: ${v.rule} — "${v.matched}"`);
    ok(`all ${all.length} rendered strings pass scanForwardLanguage`, leaks.length === 0, leaks.join(" · ") || "clean");

    // ⚠ NEGATIVE CONTROLS. Without them this section passes just as happily on an empty string set or
    //   a scan that never matches anything — the exact way a copy lint dies quietly.
    ok("NEGATIVE CONTROL — a planted R3 phrase IS caught", scanForwardLanguage("Results are due on 12 August, so you're early.").length > 0, "caught");
    ok("NEGATIVE CONTROL — a planted R2 phrase IS caught", scanForwardLanguage("Momentum is an early warning ahead of the composite.").length > 0, "caught");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · ★ PART 2's MECHANICAL CONSTRAINTS, OVER BOTH FORMS");
  {
    // ★ THE THREE LISTS ARE IMPORTED, NOT DECLARED HERE — see ./lib/results-season-scans.ts and the
    //   note at the top of this file. Their content, their reasoning and every negative control below
    //   are unchanged; the only difference is that the peer-group gate now runs the SAME objects.
    const all = everyString();
    for (const [name, pats] of [
      ["no promise of movement (incl. `expect`)", MOVEMENT_PROMISE],
      ["no lag number", LAG_NUMBER],
      ["no instruction", INSTRUCTION],
    ] as const) {
      const hits: string[] = [];
      for (const s of all) for (const p of pats as RegExp[]) if (p.test(s.text)) hits.push(`${s.label} ${p}`);
      ok(name, hits.length === 0, hits.slice(0, 5).join(" · ") || `clean across all ${all.length} strings`);
    }

    // Negative controls — a rule that bites nothing is a rule that is not there.
    ok("NEGATIVE CONTROL — 'the score will move' IS caught", MOVEMENT_PROMISE.some((p) => p.test("the score will move once the numbers land")));
    ok("NEGATIVE CONTROL — 'so expect the score to shift' IS caught (the retired wording)", MOVEMENT_PROMISE.some((p) => p.test("so expect the score here to shift after it lands")));
    ok("NEGATIVE CONTROL — 'Momentum will move once ingested' IS caught", MOVEMENT_PROMISE.some((p) => p.test("Momentum will move once they're ingested")));
    ok("NEGATIVE CONTROL — 'within three days' IS caught", LAG_NUMBER.some((p) => p.test("it will be ingested within three days")));
    ok("NEGATIVE CONTROL — 'keep an eye on this' IS caught", INSTRUCTION.some((p) => p.test("keep an eye on this one")));
    ok("NEGATIVE CONTROL — 'check this after it lands' IS caught", INSTRUCTION.some((p) => p.test("check this after it lands")));
    // ★ The four the brief named explicitly, each in the shape the contents clause would tempt.
    for (const planted of [
      "See the results page for the June-quarter figures.",
      "Check the results page once they are filed.",
      "Review the results page for the full-year accounts.",
      "Look at the results page for the March quarter.",
      "You can find them on the results page.",
      "Head to the results page for the numbers.",
    ]) {
      ok(`NEGATIVE CONTROL — "${planted}" IS caught`, INSTRUCTION.some((p) => p.test(planted)));
    }
    // …and a mid-clause use of the SAME verbs, in third person, must NOT be caught. Both of these
    // ship today; a lint that bans them is a lint someone deletes.
    for (const shipped of [
      "The June-quarter top line, profit and margins are on the results page.",
      "Results are due on 12 August. Foundation and Momentum both read the quarterly accounts, so the health score on this page will be built on new numbers shortly after.",
      "A year-end filing carries the audited full-year accounts as well as the March quarter, and both will be on the results page once they are filed.",
    ]) {
      ok(`…and shipped descriptive copy is NOT caught: "${shipped.slice(0, 46)}…"`, !INSTRUCTION.some((p) => p.test(shipped)));
    }
    ok(
      "…and 'you're watching this' is NOT caught (descriptive, not an instruction)",
      !INSTRUCTION.some((p) => p.test("You're watching this. Results are due 12 August.")),
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · ★ THE SHORT FORM IS SHORTER, AND STILL DISTINGUISHES EVERY READER STATE");
  {
    let shorter = 0;
    for (const { label, cell } of everyCell()) {
      const s = say(cell);
      if (s.short.length > s.full.length) ok(`${label} — short form is not longer`, false, `${s.short.length} > ${s.full.length}`);
      else shorter++;
    }
    ok(`all ${shorter} short forms are no longer than their full form`, true);

    // ★ A CHARACTER BUDGET, BECAUSE THE REAL CONSTRAINT IS A PIXEL ONE THIS GATE CANNOT SEE.
    //   Measured on the shipped Inter metrics: below 640px the paragraph is 266px at a 360px viewport
    //   and 226px at 320px, which is ~41 and ~35 characters a line. Four lines is the ceiling the
    //   design sets, so 150 characters is the budget — it clears the longest current short form (the
    //   Q4 day-of watchlist variant, 134) and still bites a sentence that has quietly grown back.
    //   This is a PROXY and says so: a font-accurate layout needs the woff2 and a browser, neither of
    //   which belongs in a build gate. What it catches is the regression that actually happens — copy
    //   being edited without anyone re-measuring.
    const SHORT_BUDGET = 150;
    const fat = everyCell()
      .map(({ label, cell }) => ({ label, len: say(cell).short.length }))
      .filter((x) => x.len > SHORT_BUDGET);
    ok(
      `every short form is within the ${SHORT_BUDGET}-character budget (~4 lines at 360px)`,
      fat.length === 0,
      fat.map((f) => `${f.label} ${f.len}`).join(" · ") ||
        `longest ${Math.max(...everyCell().map(({ cell }) => say(cell).short.length))}`,
    );
    ok(
      "NEGATIVE CONTROL — the retired full-length day-of sentence WOULD blow the budget",
      "Results are due today on a name you're watching. Once the filing is out and the figures are in, Foundation and Momentum will be scored against them — the reading below is still the previous quarter's."
        .length > SHORT_BUDGET,
      "202 chars",
    );

    // ★ THE COLLAPSE THIS EXISTS TO PREVENT. Drop the position opener from the short forms and the
    //   watching and anonymous strings become the same sentence — the reader-state distinction the
    //   whole banner is built on would vanish at phone width, silently.
    const phases: ResultsSeasonPhase[] = ["before", "day_of", "filed_today", "after"];
    for (const copySet of ["scored", "unscored"] as ResultsSeasonCopySet[]) {
      for (const phase of phases) {
        const pillars = copySet === "scored" ? Q1 : [];
        const forms = (["held", "watching", "none"] as ReaderPosition[]).map(
          (position) => say({ phase, position, copySet, confirmed: phase === "after", pillars, period: JUN }).short,
        );
        ok(`${copySet}/${phase} — three DISTINCT short forms`, new Set(forms).size === 3, forms.length === new Set(forms).size ? "" : forms.join(" | "));
      }
    }

    // The full forms too, unchanged from before.
    for (const copySet of ["scored", "unscored"] as ResultsSeasonCopySet[]) {
      for (const phase of phases) {
        const pillars = copySet === "scored" ? Q1 : [];
        const forms = (["held", "watching", "none"] as ReaderPosition[]).map(
          (position) => say({ phase, position, copySet, confirmed: phase === "after", pillars, period: JUN }).full,
        );
        ok(`${copySet}/${phase} — three DISTINCT full forms`, new Set(forms).size === 3);
      }
    }

    // Held takes precedence, and never leaks watchlist language.
    for (const copySet of ["scored", "unscored"] as ResultsSeasonCopySet[]) {
      for (const phase of phases) {
        const pillars = copySet === "scored" ? Q1 : [];
        const s = say({ phase, position: "held", copySet, confirmed: phase === "after", pillars, period: JUN });
        ok(`${copySet}/${phase}/held names the holding, not the watchlist`, /hold this/i.test(s.full) && !/watchlist|watching/i.test(s.full + s.short));
      }
    }
    ok("chip labels", positionChipLabel("held") === "Held" && positionChipLabel("watching") === "Watching");
    ok("no chip for a stranger", positionChipLabel("none") === null);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · ★ THE UNCONFIRMED-PUBLICATION BRANCH MAKES NO PUBLICATION CLAIM — BOTH SETS, BOTH FORMS");
  {
    const PUBLICATION_CLAIM = [/\bwere published\b/i, /\bcame out\b/i, /\bhave been published\b/i, /\bare out\b/i];
    const positions: ReaderPosition[] = ["held", "watching", "none"];
    for (const copySet of ["scored", "unscored"] as ResultsSeasonCopySet[]) {
      const pillars = copySet === "scored" ? Q1 : [];
      for (const p of positions) {
        const s = say({ phase: "after", position: p, copySet, confirmed: false, pillars, period: JUN });
        for (const [form, text] of [["full", s.full], ["short", s.short]] as const) {
          const hit = PUBLICATION_CLAIM.find((re) => re.test(text));
          ok(`${copySet}/after/${p} · ${form} — no publication claim`, !hit, hit ? `MATCHED ${hit}` : "states the schedule only");
          ok(`${copySet}/after/${p} · ${form} — says "were scheduled for"`, /\bwere scheduled for\b/i.test(text));
        }
      }
      // ⚠ AND THE PRONOUN. "hasn't taken THEM in yet" / "once they're ingested" both smuggle the
      //   publication claim back through a pronoun whose referent does not exist when nothing filed.
      const w = say({ phase: "after", position: "watching", copySet, confirmed: false, pillars, period: JUN });
      ok(`${copySet} — the unconfirmed watchlist copy carries no pronoun for unpublished results`, !/taken them in/i.test(w.full) && !/they're ingested/i.test(w.short));
      // The CONFIRMED branch, by contrast, must state it plainly — otherwise gate 5 buys nothing.
      ok(
        `${copySet} — the confirmed branch DOES state publication (all three, both forms)`,
        positions.every((p) => {
          const c = say({ phase: "after", position: p, copySet, confirmed: true, pillars, period: JUN });
          return PUBLICATION_CLAIM.some((re) => re.test(c.full)) && PUBLICATION_CLAIM.some((re) => re.test(c.short));
        }),
      );
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("9 · ★ THE WINDOW, AT EVERY BOUNDARY");
  {
    const t = D("2026-08-08");
    const cases: [string, number, ResultsSeasonPhase | null][] = [
      ["T-8  (outside)", -8, null],
      ["T-7  (after, far edge)", -7, "after"],
      ["T-1  (after, near edge)", -1, "after"],
      ["T+0  (the day)", 0, "day_of"],
      ["T+1  (before, near edge)", 1, "before"],
      ["T+7  (before, far edge)", 7, "before"],
      ["T+8  (outside)", 8, null],
    ];
    for (const [label, offset, want] of cases) {
      const ev = new Date(t.getTime() + offset * 86400000);
      const got = phaseFor(ev, t);
      ok(`${label} → ${want ?? "silence"}`, got === want, got ?? "silence");
    }
    ok("daysOut ignores a stray time component", daysOut(new Date("2026-08-12T18:30:00.000Z"), t) === 4);
    ok("utcMidnight normalises", utcMidnight(new Date("2026-08-12T18:30:00.000Z")).toISOString() === "2026-08-12T00:00:00.000Z");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("10 · ★ RESCHEDULE RESIDUE — the stale row must never win");
  {
    const t = D("2026-08-08");
    // Measured live: NAUKRI carries both 10 and 11 Aug; JUBLPHARMA both 7 and 10 Aug.
    ok("two future dates → the EARLIEST (the next meeting actually coming)", pickScheduledDate([D("2026-08-11"), D("2026-08-10")], t)?.toISOString().slice(0, 10) === "2026-08-10");
    ok("one past + one future → the FUTURE one (JUBLPHARMA: 7 Aug stale, 10 Aug live)", pickScheduledDate([D("2026-08-07"), D("2026-08-10")], t)?.toISOString().slice(0, 10) === "2026-08-10");
    ok("all past → the LATEST (the most recent thing that happened)", pickScheduledDate([D("2026-08-03"), D("2026-08-06")], t)?.toISOString().slice(0, 10) === "2026-08-06");
    ok("today counts as ahead, not behind", pickScheduledDate([D("2026-08-05"), t], t)?.getTime() === t.getTime());
    ok("no dates → null", pickScheduledDate([], t) === null);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("11 · PERIOD END + THE PILLARS A FILING ACTUALLY FEEDS");
  {
    const cases: [string, string, ("foundation" | "momentum")[]][] = [
      ["2026-08-12", "2026-06-30", ["momentum"]],               // Q1  — quarterly only
      ["2026-11-05", "2026-09-30", ["momentum"]],               // Q2
      ["2027-02-04", "2026-12-31", ["momentum"]],               // Q3
      ["2026-05-14", "2026-03-31", ["foundation", "momentum"]], // Q4 — the annual rides with it
      ["2026-01-20", "2025-12-31", ["momentum"]],               // early January → previous calendar year
    ];
    for (const [ev, wantEnd, wantPillars] of cases) {
      const pe = periodEndFor(D(ev)).toISOString().slice(0, 10);
      ok(`meeting ${ev} → period end ${wantEnd}`, pe === wantEnd, pe);
      ok(`meeting ${ev} → [${wantPillars.join(", ")}]`, pillarsAtStakeFor(D(ev)).join(",") === wantPillars.join(","));
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("12 · DATE VOICE + THE SERVER-BUILT LINK");
  {
    ok('12 Aug 2026 renders as "12 August"', formatBannerDate(D("2026-08-12")) === "12 August", formatBannerDate(D("2026-08-12")));
    ok('1 Sep renders as "1 September" (no leading zero)', formatBannerDate(D("2026-09-01")) === "1 September", formatBannerDate(D("2026-09-01")));
    ok("no year on the strip", !/20\d\d/.test(formatBannerDate(D("2026-08-12"))));
    ok("link label", LINK_LABEL === "Open results");
    ok("link href is built server-side and encoded", linkHref("M&M") === "/results/M%26M?tab=snapshot", linkHref("M&M"));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(100));
  console.log(`matrix: ${everyCell().length} cells × 2 forms = ${everyString().length} rendered strings`);
  if (failures > 0) {
    console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  console.log("PASSED — every cell of the copy matrix holds, and no standing warnings remain.");
}

main().catch((e) => {
  console.error("verify-results-season crashed:", e);
  process.exit(1);
});
