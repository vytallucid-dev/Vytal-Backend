// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 5 — THE STORED SCHEMA. What a Quarter in Brief IS, as data.
//
// ── ★★ WHAT THE MODEL AUTHORS, AND WHAT IT ONLY ECHOES ───────────────────────────────────────────
// The model's job shrank at Stage 2 and it shrinks no further here — it gets SMALLER, because it now
// answers with a three-field object instead of prose:
//
//   AUTHORED   takeaway.bullets            1–5 sentences. The ONLY generated text in the product.
//   ECHOED     takeaway.verdictLabel       must equal block.verdict.label,   character for character
//   ECHOED     takeaway.verdictMeaning     must equal block.verdict.meaning, character for character
//
// Everything else in the payload below — the 12–24 quarter lines, the annual section, the health
// movements, the gaps — is ASSEMBLED HERE from the fact block. The model never sees a chance to
// retype them.
//
// ⚠ THAT IS A DELIBERATE REFUSAL OF THE OBVIOUS SCHEMA. Handing the model the whole five-section
// object and asking it to fill every field is what a `responseSchema` invites, and prompt.ts already
// ruled against it in words: "Asking a model to re-narrate them would triple the output cost to
// restate strings it was handed, and every restatement is a fresh chance to mistype a figure." A
// schema does not repeal that; it would only make the mistyping tidier. So the schema the model
// receives (TAKEAWAY_RESPONSE_SCHEMA) is a SUBSET of the schema that gets stored (BriefPayload).
//
// ── ★ THE TWO ECHOED FIELDS ARE CHECKED BY EQUALITY, NOT BY SCANNING ─────────────────────────────
// `verdictLabel` and `verdictMeaning` are handed to the model as the wording it must place, so the
// honest test is `===`, not a scan. A scan asks "does this look grounded"; equality asks the question
// that matters, which is "is this the sentence we wrote". Cheaper, exact, and it cannot be argued
// with. checkEchoes() below is that test, and generate.ts refuses on it.
//
// ── ⚠⚠ NO NUMERIC FIELDS. ANYWHERE. NOT ONE. ────────────────────────────────────────────────────
// Every number in this payload is a STRING, copied verbatim from a display the fact block already
// rendered — "65.0", "₹31.05 lakh crore", "up 14% against the year before". Three reasons, and the
// third is the one that decides it:
//   · one figure, one rendering — the whole point of format.ts, which would otherwise be bypassed by
//     any consumer that re-formats a raw number;
//   · a reader checking the card against the statement sees the same characters on both;
//   · ★ THE VERBATIM GUARD WOULD CORRECTLY FIRE ON A NUMERIC FIELD. generate.ts compares figures in
//     the output against figures in the fact text, character for character. A numeric 65.0 was never
//     a display string, so it has no verbatim match and the brief would be refused — rightly. The fix
//     for that is the schema, not a hole in the guard.
//
// ── ABSENT SECTION = MISSING KEY ────────────────────────────────────────────────────────────────
// `annual`, `health` and the two verdict fields are OPTIONAL BY PRESENCE. An absent section is a key
// that is not there — never `{}`, never `null`, never an empty array. A renderer written against this
// asks `if (payload.annual)` and is finished; a renderer written against empty objects has to know
// which emptiness means "nothing happened" and which means "we could not look", and it will get one
// of them wrong.
//
// ── ⚠ `personal` IS ABSENT FROM THIS FILE ENTIRELY, AND THAT IS THE MECHANISM ───────────────────
// personal.ts states it: a field on the stored shape is how a reader's position accidentally reaches
// a model. There is no `personal` key in BriefPayload, nothing here imports personal.ts, and the read
// path merges it onto the RESPONSE after this payload has been read from the database. Sections 1, 2,
// 4 and 5 are stored and shared; section 3 renders live, per reader, and is never written down.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { QuarterBriefFactBlock } from "./types.js";

/**
 * 1–8, and DELIBERATELY NO FLOOR ABOVE 1. A minimum forces the model to pad a thin quarter, and
 * padding is where invented claims come from. Moved here from prompt.ts with the schema.
 *
 * ── ⚠⚠ RAISED FROM 5, AND THE CAP IS NOW DOING LESS WORK THAN IT WAS ────────────────────────────
 * MEASURED at 5: five of seventeen renders sat exactly ON the cap — HDFCBANK ×2, HDFCLIFE, MARUTI,
 * TMPV — which is the signature of a ceiling that is binding rather than protecting. Those cards
 * carry five or six groups and up to sixteen facts; the takeaway was being truncated by arithmetic
 * rather than by editorial judgement.
 *
 * ★ BUT RAISING IT RE-OPENS THE FAILURE THE CAP WAS INTRODUCED FOR. The original 9-bullet run wrote
 * roughly ONE BULLET PER FACT, and at 5 the refusal caught it: nine is more than five, the answer was
 * thrown away, and the guard's report is what surfaced the defect. At 8 it would NOT be caught — a
 * 20-fact card writing eight bullets is inside the cap and stores silently.
 *
 * So the defence moved off the number and into the instruction, and it had to be re-anchored to be
 * able to hold: prompt.ts now calibrates the count against the GROUPS (at most six) rather than
 * against the facts (up to twenty), so "one sentence per group, two where a group holds two things
 * the reader needs" lands at six or seven and one-per-fact is excluded by a positive rule instead of
 * by a ceiling. See the block comment there — it names both failures and what holds against each.
 * The cap is now a backstop for a model that ignores the instruction entirely, not the mechanism.
 */
export const MAX_TAKEAWAY_BULLETS = 8;

/** ONE reported line, as the card shows it. Every field a string; see the header.
 *  · label      the gloss catalogue's heading — never a filed column name
 *  · value      THE canonical rendering, from format.ts. The only string for this figure.
 *  · comparison how it moved, or that it held. Absent when there is nothing to compare against.
 *  · note       the plain-words companion, where the bare figure means nothing on its own. */
export interface BriefLine {
  label: string;
  value: string;
  comparison?: string;
  note?: string;
  /** ★ WHERE THIS FIGURE SITS — "lower than all 5 companies in its peer group that have filed this
   *  quarter", "the widest fall in the 16 year-on-year comparisons on file".
   *
   *  ⚠ ITS OWN KEY, NOT CONCATENATED ONTO `comparison`. It shipped concatenated, which reached the
   *  reader with no renderer change and cost the anchor the ability to carry its own typographic
   *  weight — it inherited the comparison line's, which is the quietest text on the card. Splitting
   *  it in the store is the only way a renderer can treat it differently, because splitting it in the
   *  renderer would mean cutting our own prose on "; ". */
  anchor?: string;
}

/** The takeaway. `bullets` is the only generated text in the product. */
export interface BriefTakeaway {
  /** Absent when the quarter has no comparison period at all and so no verdict. */
  verdictLabel?: string;
  verdictMeaning?: string;
  bullets: string[];
}

export interface BriefQuarterSection {
  lines: BriefLine[];
}

/** Q4 only, and only when the year carried a balance sheet. Its own as-of date, always — see
 *  annual-section.ts's second-clock note. */
export interface BriefAnnualSection {
  fiscalYear: string;
  asOfDate: string;
  /** True ⇒ asOfDate is the quarter's own date and a renderer need not print it a second time. */
  datesAgree: boolean;
  lines: BriefLine[];
}

/** Present ONLY when a score snapshot existed for this stock and period at generation time. */
export interface BriefHealthSection {
  scoredAsOf: string;
  /** A STRING. "65", not 65 — see the header. */
  composite: string;
  bandLabel: string;
  /** ★ THE BAND KEY — "steady", "pristine". Carried so a renderer can colour the band from the design
   *  system's own map instead of matching on the LABEL.
   *
   *  ⚠ THE TWO REPOS DISAGREE ABOUT THE LABEL AND THIS IS WHY THE KEY IS NEEDED. The scoring layer's
   *  LABEL_BAND_MAP calls the top band "Pristine — fully priced"; the frontend's BAND_META calls it
   *  "Pristine". Both are shipped copy in their own surface, and a renderer keying a colour off the
   *  string would silently fall through to neutral the day either one is reworded. The key cannot be
   *  reworded — it is the enum. */
  band: string;
  /** Composite move, band change, pillars, findings fired and cleared — each a whole sentence. */
  movements: string[];
}

/**
 * THE STORED PAYLOAD. Serialised into `quarter_briefs.content`.
 *
 * ⚠ `content` HELD PROSE UNTIL THIS STAGE, AND THE TABLE WAS PURGED RATHER THAN CONVERTED. The 908
 * rows written before it were prose and did not parse. They were DELETED on 2026-08-09, not marked
 * stale: a stale row is one that is coming back, and with generation off (BRIEF_ENQUEUE_ON_INGEST)
 * nothing would ever have restored them. The table is empty, so no reader meets an old shape.
 *
 * ⚠ IF ROWS EVER EXIST IN AN OLDER SHAPE AGAIN, THEY GO BEFORE THE READ PATH SHIPS, NOT AFTER. A
 * brief is DERIVED data — every input row is untouched and writeQuarterBrief rebuilds any of them for
 * one AI call — so deleting is cheap and converting is not worth writing.
 */
export interface BriefPayload {
  takeaway: BriefTakeaway;
  quarter: BriefQuarterSection;
  annual?: BriefAnnualSection;
  health?: BriefHealthSection;
  gaps: string[];
}

/** What the MODEL is asked for — a strict subset of the payload above.
 *
 *  ⚠ `minItems`/`maxItems` ARE DELIBERATELY NOT DECLARED HERE. Gemini's responseSchema is an untyped
 *  Record and does not enforce array cardinality; declaring a bound it does not honour would read as a
 *  guarantee and behave as a comment. The 1..5 range is enforced in code, by the empty-section guard
 *  and by takeawayShapeError() below — which is exactly the blank_output lesson: a constraint that is
 *  not mechanically enforced is not a constraint. */
export const TAKEAWAY_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdictLabel: {
      type: "string",
      description: "Copy the OVERALL label from the facts, exactly. Omit this key if the facts have no OVERALL line.",
    },
    verdictMeaning: {
      type: "string",
      description: "Copy the sentence after the OVERALL label, exactly. Omit this key if the facts have no OVERALL line.",
    },
    bullets: {
      type: "array",
      description: `Between 1 and ${MAX_TAKEAWAY_BULLETS} plain-language sentences about the quarter.`,
      items: { type: "string" },
    },
  },
  required: ["bullets"],
};

/** The model's response, before any checking. Every field optional because the model may omit any. */
export interface RawTakeaway {
  verdictLabel?: unknown;
  verdictMeaning?: unknown;
  bullets?: unknown;
}

// ── The shape check (5b-2) ─────────────────────────────────────────────────────────────────────────

/** What went wrong with the shape, and which refusal it is. `code` is the RefusalReason generate.ts
 *  raises; the two are separate values because they have opposite next actions — see below. */
export interface ShapeError {
  code: "empty_section" | "overlong_takeaway";
  detail: string;
}

/**
 * Is the model's object the shape the schema promised? Returns the fault, or null when it is fine.
 *
 * ⚠ THIS EXISTS BECAUSE THE SCHEMA CANNOT SAY "NON-EMPTY". `responseSchema` gets us an object with a
 * `bullets` array; it does not get us an array with anything in it, and `{"bullets":[]}` is valid
 * JSON that satisfies the schema and says nothing. That is the blank_output failure again in a new
 * costume: a well-formed empty result that reads as success.
 *
 * ── ★★ AND TOO MANY BULLETS IS NOT THE SAME EVENT AS TOO FEW ─────────────────────────────────────
 * Every shape fault used to be raised as `empty_section`. That was defensible when the only realistic
 * one was emptiness, and it stopped being defensible the moment the fact block started arriving in
 * ordered groups: on the two richest cards in the review set the model wrote NINE bullets — one per
 * group fact — and the refusal reported "empty_section" on a takeaway that was nearly twice too long.
 *
 * An operator reading that log goes looking for a fact block with nothing in it. The truth was the
 * opposite, and the fix was one line of instruction. This is 5b-1's own rule — two events with two
 * next actions must not share a name — applied to a case 5b-1 did not foresee:
 *
 *   empty_section       the model had nothing to say, or the fact block gave it nothing. NOT retried:
 *                       a retry that eventually "succeeds" is the model padding to escape the guard.
 *   overlong_takeaway   the model had too much to say and did not compress. RETRIED, because it is a
 *                       counting slip and the second sample is a different draw. Retrying cannot
 *                       manufacture content here — the failure is surplus, not absence.
 */
export function takeawayShapeError(raw: RawTakeaway): ShapeError | null {
  const empty = (detail: string): ShapeError => ({ code: "empty_section", detail });
  if (!raw || typeof raw !== "object") return empty("response was not an object");
  if (!Array.isArray(raw.bullets)) return empty("bullets is missing or not an array");
  if (raw.bullets.some((b) => typeof b !== "string")) return empty("bullets contains a non-string");
  const bullets = (raw.bullets as string[]).map((b) => b.trim());
  if (bullets.length === 0) return empty("bullets is empty");
  if (bullets.every((b) => b.length === 0)) return empty("every bullet is an empty string");
  if (bullets.length > MAX_TAKEAWAY_BULLETS) {
    return { code: "overlong_takeaway", detail: `${bullets.length} bullets, the limit is ${MAX_TAKEAWAY_BULLETS}` };
  }
  for (const k of ["verdictLabel", "verdictMeaning"] as const) {
    if (raw[k] !== undefined && typeof raw[k] !== "string") return empty(`${k} is present but not a string`);
  }
  return null;
}

/**
 * ★ THE ECHO CHECK — equality, not scanning (see the header).
 *
 * Returns a reason, or null. Both directions matter: a verdict present in the facts and missing from
 * the answer loses the one characterisation the card is allowed to make, and a verdict ABSENT from the
 * facts but present in the answer is the model writing its own — which is the single thing the Stage-2
 * ruling gave up "structurally impossible" for, and therefore the thing that must be checked hardest.
 */
export function checkEchoes(raw: RawTakeaway, block: QuarterBriefFactBlock): string | null {
  const v = block.verdict;
  const label = typeof raw.verdictLabel === "string" ? raw.verdictLabel.trim() : undefined;
  const meaning = typeof raw.verdictMeaning === "string" ? raw.verdictMeaning.trim() : undefined;

  if (!v) {
    if (label !== undefined) return `no verdict was supplied, but the answer carries verdictLabel "${label}"`;
    if (meaning !== undefined) return "no verdict was supplied, but the answer carries verdictMeaning";
    return null;
  }
  if (label === undefined) return `verdictLabel is missing; the facts supplied "${v.label}"`;
  if (label !== v.label) return `verdictLabel "${label}" is not the supplied "${v.label}"`;
  // The meaning is whitespace-normalised on the way INTO the fact text (prompt.ts's `line`), so it is
  // compared against that same normalisation rather than against the raw catalogue string.
  const want = v.meaning.replace(/\s+/g, " ").trim();
  if (meaning === undefined) return "verdictMeaning is missing; the facts supplied one";
  if (meaning.replace(/\s+/g, " ") !== want) return "verdictMeaning is not the supplied sentence, verbatim";
  return null;
}

// ── Assembly ───────────────────────────────────────────────────────────────────────────────────────

const line = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * THE FACT BLOCK + THE MODEL'S TAKEAWAY → the stored payload.
 *
 * Every field below is a COPY of a string the fact block already rendered. Nothing is re-formatted,
 * re-rounded or re-worded here, and there is no number in this function — which is what makes the
 * pass-through half of the payload checkable by equality rather than by inspection.
 */
export function assembleBriefPayload(
  block: QuarterBriefFactBlock,
  takeaway: { verdictLabel?: string; verdictMeaning?: string; bullets: string[] },
): BriefPayload {
  const payload: BriefPayload = {
    takeaway: {
      ...(takeaway.verdictLabel !== undefined ? { verdictLabel: takeaway.verdictLabel } : {}),
      ...(takeaway.verdictMeaning !== undefined ? { verdictMeaning: takeaway.verdictMeaning } : {}),
      bullets: takeaway.bullets.map((b) => b.trim()).filter((b) => b.length > 0),
    },
    quarter: {
      lines: block.quarter.lines.map((l) => ({
        label: l.label,
        value: l.display,
        ...(l.movement ? { comparison: l.movement } : {}),
        ...(l.anchor ? { anchor: l.anchor } : {}),
        ...(l.plain ? { note: l.plain } : {}),
      })),
    },
    gaps: block.gaps.map(line),
  };

  // Q4 with a balance sheet. Absent ⇒ the key is not written at all.
  if (block.annual) {
    payload.annual = {
      fiscalYear: block.annual.fiscalYear,
      asOfDate: block.annual.asOfDate,
      datesAgree: block.annual.datesAgree,
      lines: block.annual.lines.map((l) => ({
        label: l.label,
        value: l.display,
        ...(l.movement ? { comparison: l.movement } : {}),
        ...(l.plain ? { note: l.plain } : {}),
      })),
    };
  }

  // Scored ⇒ present, pinned and dated. `composite` is the display string, never the number.
  if (block.healthMovement) {
    const h = block.healthMovement;
    const movements: string[] = [];
    if (h.compositeChange) movements.push(line(h.compositeChange.display));
    if (h.bandChange) movements.push(line(h.bandChange.display));
    for (const p of h.pillars) movements.push(line(p.display));
    for (const f of h.findingsFired) movements.push(line(f.display));
    for (const f of h.findingsCleared) movements.push(line(f.display));
    payload.health = {
      scoredAsOf: h.scoredAsOf,
      composite: h.composite.display,
      bandLabel: h.band.label,
      band: h.band.band,
      movements,
    };
  }

  return payload;
}

// ── The empty-section guard (5b-2), over the ASSEMBLED payload ────────────────────────────────────

/**
 * Sections that are PRESENT and say NOTHING. Returns their names; empty array means clean.
 *
 * ⚠ A PRESENT-BUT-EMPTY SECTION IS THE WORST OUTCOME AVAILABLE, which is precisely why blank_output
 * had to be made a refusal rather than a success: a reader sees a heading that exists and contains no
 * information, and concludes that nothing happened rather than that nothing was written. Absence is
 * honest; a hollow section is not.
 *
 * `annual` and `health` are checked only WHEN PRESENT — the whole point of optional-by-presence is
 * that their absence is a legitimate, common, documented state and must never be a refusal.
 */
export function emptySections(payload: BriefPayload): string[] {
  const bad: string[] = [];
  const allBlank = (xs: string[]) => xs.length === 0 || xs.every((x) => x.trim().length === 0);
  const blankLines = (ls: BriefLine[]) =>
    ls.length === 0 || ls.every((l) => l.label.trim().length === 0 || l.value.trim().length === 0);

  if (allBlank(payload.takeaway.bullets)) bad.push("takeaway.bullets");
  if (blankLines(payload.quarter.lines)) bad.push("quarter.lines");
  if (allBlank(payload.gaps)) bad.push("gaps");
  if (payload.annual && blankLines(payload.annual.lines)) bad.push("annual.lines");
  if (payload.health) {
    if (!payload.health.composite.trim()) bad.push("health.composite");
    if (!payload.health.bandLabel.trim()) bad.push("health.bandLabel");
  }
  return bad;
}

// ── The structural walk (5c-1) ────────────────────────────────────────────────────────────────────

/** One string found in the object, with the path that carried it. */
export interface StringLeaf {
  path: string;
  text: string;
}

/**
 * ★ EVERY STRING IN AN OBJECT, WITH ITS PATH. The guards scan THESE, one at a time — never the
 * serialised blob.
 *
 * ── ⚠ WHY NOT JSON.stringify(payload) AND ONE SCAN ──────────────────────────────────────────────
 * Three failures, and each is silent:
 *
 *   1 · FALSE ADJACENCIES ACROSS FIELD BOUNDARIES. Concatenation puts the end of one field against the
 *       start of the next. A bullet ending "…and whether the company should" beside a gap beginning
 *       "buy back shares…" synthesises "should buy" — a hard-tier hit that exists in NEITHER field.
 *       The guard would refuse a brief for a sentence nobody wrote.
 *   2 · SCHEMA KEY NAMES ENTER THE SCANNED TEXT. "verdictLabel", "datesAgree", "scoredAsOf" are not
 *       prose and were never in the haystack; any scan that reads them is reading our own plumbing.
 *   3 · THE FINDING LOSES ITS ADDRESS. "an ungrounded figure somewhere in 4 KB of JSON" is not a
 *       refusal detail anyone can act on. `takeaway.bullets[2]` is.
 *
 * ── ⚠⚠ AND WHY THIS IS A WALK AND NOT A LIST OF FIELDS ──────────────────────────────────────────
 * A hand-maintained list of scanned paths would exempt every field added after it was written, and it
 * would do so SILENTLY — the guard keeps passing, the new field is simply never looked at. The walk
 * has no list to fall out of date. Add a field to the payload and it is scanned because it exists.
 */
export function stringLeaves(value: unknown, path = ""): StringLeaf[] {
  if (typeof value === "string") return [{ path: path || "(root)", text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      stringLeaves(v, path ? `${path}.${k}` : k),
    );
  }
  return []; // numbers, booleans, null — nothing to scan, and by design nothing to find
}
