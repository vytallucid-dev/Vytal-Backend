// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — THE QUARTER IN BRIEF, AS THE FRONTEND RENDERS IT.
//
// ★★ CROSS-REPO. NEEDS BOTH CHECKOUTS, SO IT IS NOT — AND MUST NEVER BE — IN `build`. ★★
// Same reason as verify-quarter-brief-money.ts: a Railway deploy checks out the backend alone, so on
// the deploy box the frontend path does not exist and the gate would fail for a reason that has
// nothing to do with what it guards. `npm run verify:cross-repo` is its home.
//
// ── WHAT IT GUARDS ─────────────────────────────────────────────────────────────────────────────────
// The brief is COMPUTED here and RENDERED there, and three things cross the repo boundary to do it.
// Two repos cannot share a constant without a shared package, and adding one is a new dependency —
// so these are single decisions with two copies, and this gate is the only thing holding the second
// to the first.
//
//   1 · VERDICT_DOESNT_MEAN — the limit of what the badge claims. It ships WITH the badge. If the
//       backend sharpens the wording and the frontend keeps the old sentence, the product is making
//       a claim it has already decided not to make.
//   2 · The key → glyph map. The glyph carries DIRECTION so colour does not have to (BADGE_TREATMENT
//       `colourEncodesMeaning: false`). A frontend map that drifts renders a down-arrow beside
//       "Grew" — the badge then contradicts its own label, in the one component a reader trusts most.
//   3 · ★ STAGE 5 — THE SCHEMA KEYS. The brief is no longer prose; it is a `BriefPayload` object and
//       the frontend renders its sections by key. A renderer reading `payload.fullYear` where the
//       backend writes `annual` renders nothing at all — silently, and only on the Q4 cards that
//       carry it. So the KEY SET is what crosses the boundary now, and this holds the frontend to it.
//
// ── AND ONE LAYOUT RULE, BECAUSE ITS FAILURE INVERTS MEANING ───────────────────────────────────────
//   4 · The verdict label must never be truncated. "Grew, margins thinner" clipped to "Grew,
//       margins…" reads as its own opposite. This is the one CSS rule worth a gate: it is a single
//       class, it is the obvious thing to reach for on a narrow card, and nothing else would catch it.
//
// ── ⚠⚠ WHAT THIS GATE STOPPED CHECKING AT STAGE 5, AND WHY THAT IS NOT A LOSS ─────────────────────
// Two assertions were DELETED, not adapted:
//
//   · HEALTH_HEADING_MARKER matching exactly one ALLOWED_HEADING, so the pinned `scoredAsOf` date had
//     a heading to attach to.
//   · The frontend's HEADING_LINE / BULLET_LINE regexes classifying real brief lines correctly.
//
// Both guarded THE PROSE RENDERER, and there is no longer a prose renderer. The model emits no
// headings, the card parses no lines, and the pinned date is a FIELD (`health.scoredAsOf`) instead of
// a substring the renderer has to find. A gate that can no longer fail is worse than no gate — it
// reads as evidence the case is handled. Same ruling as generate.ts's deleted `unknownHeadings`.
//
// ⚠ AND BOTH HAD BEEN FAILING FOR TWO STAGES, WHICH IS THE REAL LESSON HERE. The heading assertion
// broke when ALLOWED_HEADINGS shrank from five to one; the feed assertion below broke when the chip
// was removed from the grid. Neither was wrong about the code — both were wrong about the DECISION,
// and they sat red at the top of the output while genuinely new failures appeared underneath them.
// A known failure is where a real one hides.
//
// ── WHAT IT CANNOT PROVE ───────────────────────────────────────────────────────────────────────────
// It reads the frontend as TEXT — .tsx files import React and cannot be imported into a node script.
// So it proves the CONSTANTS and KEYS still agree, not that the component renders them. Layout,
// contrast and whether the card reads like something Vytal should put its name on are for a human at
// the page; no harness proves those, which is why the operator opens it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERDICT_KEYS, VERDICTS, VERDICT_DOESNT_MEAN } from "../../insight/quarter-brief/verdict.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(HERE, "..", "..", "..");
const FE = (...p: string[]) => resolve(BACKEND_ROOT, "..", "Vytal-Frontend", ...p);

const SHARED = FE("components", "results", "shared.tsx");
const SNAPSHOT = FE("components", "results", "SnapshotTab.tsx");
const FEED = FE("app", "(main)", "results", "page.tsx");
const RENDERER = FE("components", "results", "QuarterBriefCard.tsx");
const SCHEMA_SRC = resolve(BACKEND_ROOT, "src", "insight", "quarter-brief", "schema.ts");

/** Every key the renderer must read by name. Kept as literals rather than derived from the type,
 *  because a TYPE cannot be read from a .tsx file — the whole limitation this gate works around.
 *
 *  ⚠ `verdictLabel` IS DELIBERATELY NOT IN THIS LIST. The badge renders the verdict from the STORED
 *  COLUMNS (`ai.verdictKey` / `ai.verdictLabel`), which are computed by verdict.ts and never written
 *  by the model. The payload's `takeaway.verdictLabel` is the model's ECHO of that label, kept so
 *  checkEchoes can prove by equality that the model was given and used the right wording — it is
 *  EVIDENCE, not a render source, and requiring the renderer to mention it would force a decorative
 *  reference to the less authoritative of two identical strings. `verdictMeaning` IS required: it is
 *  authored copy that nothing else on the card carries. */
const BRIEF_PAYLOAD_KEYS = [
  "takeaway", "bullets", "verdictMeaning",
  "quarter", "lines", "label", "value", "comparison", "note",
  "annual", "asOfDate", "datesAgree",
  "health", "scoredAsOf", "composite", "bandLabel", "movements",
  "gaps",
];

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`  ✗ cannot read ${path}`);
    console.error("    This gate needs BOTH checkouts side by side. It is not a build gate.");
    process.exit(1);
  }
}

const shared = read(SHARED);
const snapshot = read(SNAPSHOT);
const feed = read(FEED);
const renderer = read(RENDERER);
const schemaSrc = read(SCHEMA_SRC);

console.log("═".repeat(96));
console.log("GATE — QUARTER IN BRIEF (backend verdict.ts + schema.ts ↔ frontend results/)");
console.log("═".repeat(96));

// ── 1 · the caveat, verbatim ────────────────────────────────────────────────────────────────────────
console.log("\n1 · VERDICT_DOESNT_MEAN");
if (!shared.includes(VERDICT_DOESNT_MEAN)) {
  fail("the frontend's VERDICT_DOESNT_MEAN is not the backend's, verbatim.");
  console.error(`    backend: ${VERDICT_DOESNT_MEAN}`);
  const m = /VERDICT_DOESNT_MEAN\s*=\s*\n?\s*"([^"]*)"/.exec(shared);
  console.error(`    frontend: ${m ? m[1] : "(not found — it moved or was renamed)"}`);
} else {
  pass("caveat copy agrees, verbatim");
}

// ── 2 · where the badge ships, and where it deliberately does not ───────────────────────────────────
console.log("\n2 · THE CAVEAT SHIPS WITH THE BADGE — ON THE DETAIL CARD, AND NOWHERE ELSE");
if (!/VerdictCaveat\s*\/?>/.test(snapshot)) {
  fail("SnapshotTab no longer renders VerdictCaveat beside the verdict badge.");
} else pass("detail card renders the caveat with the badge");

// ★ THE FEED CARRIES NEITHER, AND THIS ASSERTS THE ABSENCE. The Stage-2 ruling (prompt.ts, and
// results-feed.cache.ts) removed the verdict chip from the grid: a model-placed label inches from a
// coloured health band reads as a second computed rating. The caveat went with it, correctly — a
// caveat with nothing to qualify is noise, not caution.
if (feed.includes("VERDICT_DOESNT_MEAN") || /<Verdict(Badge|Caveat)/.test(feed)) {
  fail("the results FEED renders a verdict badge or its caveat — the Stage-2 ruling removed the chip from the grid.");
} else pass("feed card carries no verdict chip and no caveat (Stage-2 ruling)");

// ── 3 · the key → glyph map ─────────────────────────────────────────────────────────────────────────
console.log("\n3 · KEY → GLYPH");
const mapBlock = /const VERDICT_GLYPH[^{]*\{([\s\S]*?)\n\};/.exec(shared);
if (!mapBlock) {
  fail("VERDICT_GLYPH not found in the frontend — it moved or was rewritten; re-point this gate.");
} else {
  const feMap = new Map<string, string>();
  for (const m of mapBlock[1].matchAll(/(\w+)\s*:\s*"(\w+)"/g)) feMap.set(m[1], m[2]);

  // ⚠ Scoped to THIS section. The first version tested the global `failures`, so a failure anywhere
  // earlier suppressed this pass line — and worse, a failure HERE still printed "✓ all 9 keys map"
  // beside its own "✗". A gate that reports a pass next to its own failure is unreadable at exactly
  // the moment someone is reading it.
  const before = failures;
  for (const key of VERDICT_KEYS) {
    const want = VERDICTS[key].glyph;
    const got = feMap.get(key);
    if (got === undefined) fail(`frontend has no glyph for verdict "${key}" — it would fall back to a wrong one`);
    else if (got !== want) fail(`glyph for "${key}": backend says "${want}", frontend says "${got}"`);
    feMap.delete(key);
  }
  for (const stray of feMap.keys()) fail(`frontend maps a glyph for "${stray}", which is not a backend verdict key`);
  if (failures === before) pass(`all ${VERDICT_KEYS.length} verdict keys map to the backend's glyph`);
}

// ── 4 · ★ THE SCHEMA KEYS THE FRONTEND RENDERS BY ──────────────────────────────────────────────────
//
// ⚠ THE PAYLOAD IS RENDERED BY TWO COMPONENTS NOW, AND THIS GATE WAS WRITTEN WHEN IT WAS ONE.
// `verdictMeaning` moved out of QuarterBriefCard and into SnapshotTab's VerdictBadge, so that the
// verdict's label and its meaning render as ONE line instead of the reader crossing the verdict twice
// (badge → caveat → heading → meaning) before the first bullet. The key is still rendered; it is
// rendered somewhere else.
//
// ★ SO THE HAYSTACK WIDENS TO THE UNION, AND THE ASSERTION IS UNWEAKENED. What this section exists to
// catch is a key that reaches NO renderer at all — a frontend reading `payload.fullYear` where the
// backend writes `annual`, rendering nothing, silently, on only the cards that carry it. Searching
// both files still catches exactly that. What it deliberately does NOT try to police is WHICH of the
// two components renders a given key: that is a layout decision, it has now changed once, and a gate
// that pinned it would fail on every future move of a section between them while catching nothing.
const renderSurfaces = `${renderer}\n${snapshot}`;
console.log("\n4 · BriefPayload KEYS ↔ the frontend renderers (card + snapshot tab)");
{
  const before = failures;
  for (const key of BRIEF_PAYLOAD_KEYS) {
    if (!renderSurfaces.includes(key)) {
      fail(`no renderer mentions "${key}" — whatever that key carries would render as nothing.`);
    }
  }
  if (failures === before) pass(`all ${BRIEF_PAYLOAD_KEYS.length} payload keys are read by a renderer`);

  // ⚠⚠ AND THE ONE THAT MUST NEVER BE A KEY. `personal` is computed per reader and merged onto the
  // RESPONSE, never onto the stored payload — schema.ts and personal.ts both turn on that. If it ever
  // appears inside BriefPayload, a reader's holdings are one refactor away from the model's prompt.
  const payloadDecl = /export interface BriefPayload \{[\s\S]*?\n\}/.exec(schemaSrc);
  if (!payloadDecl) {
    fail("BriefPayload not found in schema.ts — re-point this gate.");
  } else if (/\bpersonal\b/.test(payloadDecl[0])) {
    fail("BriefPayload has gained a `personal` key — section 3 must never be part of the stored shape.");
  } else pass("BriefPayload carries no `personal` key (section 3 is read-time only, per reader)");
}

// ── 5 · the label must never be truncated ───────────────────────────────────────────────────────────
console.log("\n5 · THE VERDICT LABEL WRAPS, NEVER TRUNCATES");
const badge = /export function VerdictBadge[\s\S]*?\n}/.exec(shared);
if (!badge) {
  fail("VerdictBadge not found in the frontend — it moved or was rewritten; re-point this gate.");
} else if (/\btruncate\b|text-ellipsis|line-clamp-/.test(badge[0])) {
  fail('VerdictBadge clips its label. "Grew, margins thinner" truncated to "Grew, margins…" reads as its own opposite.');
} else {
  pass("VerdictBadge does not clip its label");
}

// ── 6 · the dead prose renderer is GONE, not merely unused ─────────────────────────────────────────
// ⚠ AN UNUSED PARSER IS A LIVE PARSER TO THE NEXT READER. QuarterBriefProse, HEADING_LINE and
// HEALTH_HEADING_MARKER described a contract the backend no longer honours; leaving them in the file
// invites someone to render a payload through them and get one undifferentiated block. Deleted, and
// asserted deleted, for the same reason the backend deleted `unknownHeadings` rather than keeping it.
console.log("\n6 · THE PROSE RENDERER IS DELETED");
{
  const before = failures;
  // ⚠ A DECLARATION, NOT A MENTION — and the first version of this check got that wrong. It matched
  // the substring, so the TOMBSTONE COMMENT left where the parser used to be ("QuarterBriefProse,
  // HEADING_LINE … parsed a brief that arrived as text") tripped all four assertions. The comment is
  // the most useful thing in that file for the next reader; a gate that forbids naming what was
  // deleted forces the deletion to be undocumented. Same discipline as verify-build-gate-hygiene.ts:
  // test the REACH, not the mention.
  const declared = (src: string, name: string) =>
    new RegExp(`(?:^|\n)\s*(?:export\s+)?(?:const|function|let|var|class)\s+${name}\b`).test(src);
  for (const dead of ["QuarterBriefProse", "HEADING_LINE", "BULLET_LINE", "HEALTH_HEADING_MARKER"]) {
    if (declared(shared, dead) || declared(snapshot, dead)) {
      fail(`"${dead}" is still DECLARED in the frontend — it parses a prose brief the backend no longer writes.`);
    }
  }
  if (failures === before) pass("no prose-parsing machinery survives in the results components");
}

console.log("\n" + "─".repeat(96));
if (failures > 0) {
  console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}. The stored brief and the rendered card would disagree.`);
  process.exit(1);
}
console.log("PASSED — one brief, computed here and rendered there, still in step.");
