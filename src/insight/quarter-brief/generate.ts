// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — GENERATION, WITH THE GUARDS CHAT DOES NOT HAVE.
//
// Chat logs its scans because a human reads every reply within seconds and can discard a bad one.
// This runs unattended and STORES what it writes, so the same signals REFUSE instead. Nothing here
// changes how chat behaves — see the note on the evaluative tier below.
//
// ── THE REFUSAL CONTRACT ────────────────────────────────────────────────────────────────────────────
// Every path either returns a payload that passed every guard, or returns a refusal with a reason.
// There is no third outcome and no partial one: a brief is whole or it does not exist. A caller that
// gets a refusal stores NOTHING, and the reader sees no section rather than a half-written one.
//
// ── ★★ STAGE 5 · THE MODEL ANSWERS A SCHEMA NOW ─────────────────────────────────────────────────
// It returns `{ bullets, verdictLabel?, verdictMeaning? }` and nothing else; the stored payload is
// ASSEMBLED around that (schema.ts). Three consequences run through this file:
//
//   · TWO NEW REFUSAL REASONS, and they are separate on purpose — see RefusalReason below.
//   · TWO RETRY POLICIES, because the two failures mean opposite things about retrying.
//   · THE GUARDS TRAVERSE, they do not concatenate. A serialised blob invents adjacencies across
//     field boundaries and loses which field carried the fault. See scanLeaves.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { createGeminiAdapter } from "../../ai/adapters/gemini.js";
import { checkAndConsumeAiCall, recordAiTokens, type Actor } from "../../ai/quota.js";
import { scanUngroundedNumbers } from "../../ai/number-grounding.js";
import { scanExplanationText } from "../../ai/guardrail.js";
import { QUARTER_BRIEF_SYSTEM, renderFactText } from "./prompt.js";
import {
  assembleBriefPayload,
  checkEchoes,
  emptySections,
  stringLeaves,
  takeawayShapeError,
  TAKEAWAY_RESPONSE_SCHEMA,
  type BriefPayload,
  type RawTakeaway,
} from "./schema.js";
import type { QuarterBriefFactBlock } from "./types.js";

/** The model this feature runs on. Matches the budgeted tier (AI_BUDGET_FLASH_LITE). */
export const QUARTER_BRIEF_MODEL = "gemini-3.5-flash-lite";

/** ⚠ 15 requests/minute is a GOOGLE ceiling that nothing in app code enforces — measured in the live
 *  verify scripts, never implemented. ~12 briefs/day average is trivial against 480 RPD; the risk is
 *  a heavy filing day when 50–100 companies report at once and an unpaced loop fires them back to
 *  back. 4.2s between calls holds us under 15/min with headroom. */
const MIN_CALL_SPACING_MS = 4_200;

/**
 * ★ THE OUTPUT CEILING, RAISED FROM 900 AND MEASURED RATHER THAN GUESSED.
 *
 * 900 was fitted to prose, whose measured maximum was 595 tokens. Under the schema the model emits
 * JSON — braces, quotes, key names and escaping around the same sentences — plus two ECHOED fields it
 * did not previously write at all (`verdictMeaning` alone is a full sentence of ~40 tokens).
 *
 * MEASURED under this schema, one card per family (scripts/measure-brief-tokens.ts): output ran
 * 157–210 tokens — NMDC 157, HDFCLIFE 166, HDFCBANK 177, GICRE 181, BAJFINANCE 210 on five bullets.
 * The worst case is 210 against a prose maximum of 595, because the model stopped writing the
 * figures and now writes only the sentences. That is far under 900 — and the
 * ceiling is still raised, because the number that matters is not the typical case but the one where
 * the model runs long on a card with five bullets and a long verdict sentence. 1,600 buys roughly
 * eight times the measured worst case at zero cost when unused (maxOutputTokens is a ceiling, not a
 * reservation, and is not billed).
 *
 * ⚠ THE FAILURE THIS PREVENTS IS INVISIBLE WITHOUT finishReason. A truncated answer is not "the model
 * wrote bad JSON" — it is valid JSON cut mid-string, and it arrives at JSON.parse looking exactly like
 * nonsense. Reading finishReason is what separates them, which is why it is now carried out of the
 * adapter and read below.
 */
const MAX_OUTPUT_TOKENS = 1_600;

/** Two attempts total. WHAT gets retried is decided per reason — see RETRYABLE. */
const MAX_ATTEMPTS = 2;

/**
 * ⚠ `blank_output` IS LOAD-BEARING, NOT TIDINESS. A 429 from Google can return an EMPTY BODY, which
 * is indistinguishable from a successful empty generation — both arrive as "" with no error. So a
 * rate-limit breach does NOT announce itself; it surfaces as a RUN OF blank_output REFUSALS and
 * nothing else.
 *
 * ⚠⚠ AND THAT DIAGNOSIS NOW HAS A SECOND SUSPECT. This file used to advise "suspect the 15 req/min
 * ceiling first", and after Stage 4 that advice is wrong about half the time. MEASURED: 2,296–2,849
 * PROMPT tokens per brief (NMDC 2,296, BAJFINANCE 2,512, GICRE 2,499, HDFCLIFE 2,629, HDFCBANK
 * 2,849) — the fact block grew from 2–4 metrics to 12–24 plus an annual section, and a burst now
 * spends far more TOKENS per minute at the same request rate. Pacing bounds REQUESTS; nothing bounds
 * TOKENS. Read PACING AND TPM at the foot of this file before concluding which ceiling was hit.
 *
 * ── ★ THE TWO NEW REASONS, AND WHY THEY ARE NOT ONE ────────────────────────────────────────────
 * `malformed_json` and `empty_section` are BOTH "the answer was unusable", and folding either into
 * `provider_error` would destroy the only signature there is:
 *   · a run of `malformed_json` with finishReason MAX_TOKENS means the ceiling above is too low;
 *   · a run of `malformed_json` with finishReason STOP means the model or the schema is wrong;
 *   · a run of `empty_section` means the FACT BLOCK produced nothing to say — a data problem, on our
 *     side, that no amount of retrying or model-swapping will move.
 * Three different next actions. One name for all three would hide all three.
 */
export type RefusalReason =
  | "quota_exhausted"
  | "provider_error"
  | "blank_output"
  | "malformed_json"
  | "empty_section"
  /** ★ The takeaway ran past MAX_TAKEAWAY_BULLETS. Its own reason, not `empty_section`: a run of these
   *  means the model is writing one bullet per fact and the PROMPT needs tightening, which is the
   *  opposite diagnosis from an empty one. Found the day the fact block started arriving in groups. */
  | "overlong_takeaway"
  | "echo_mismatch"
  /** ★ A COMPUTED AMOUNT A RULE DECLARED REQUIRED DID NOT SURVIVE INTO THE BULLETS. Its own reason,
   *  not `echo_mismatch`: an echo is a field the model was told to COPY, and this is a figure it was
   *  told to KEEP while writing its own sentence. A run of these means the prompt is losing figures
   *  to summary, which is a different diagnosis and a different fix. */
  | "missing_required_figure"
  | "ungrounded_number"
  | "evaluative_language"
  | "forward_language";

/**
 * ★ 5b-3 — TWO FAILURES, TWO RETRY POLICIES, AND THE ASYMMETRY IS THE POINT.
 *
 *   malformed_json  RETRIES. It is usually truncation or a transient formatting slip, and the second
 *                   attempt is a different sample of the same distribution. Cheap, and it works.
 *   empty_section   DOES NOT. It is either the model correctly reporting that there is nothing to say,
 *                   or a fact block with nothing in it. A retry pays a second time for the same
 *                   answer and, worse, a retry that eventually "succeeds" on an empty card would be
 *                   the model padding to escape the guard — which is exactly what the no-floor rule
 *                   on bullet count exists to prevent.
 *
 *   echo_mismatch   RETRIES, for the same reason malformed_json does — it is a copying slip, not a
 *                   judgement. ⚠ AND IT IS ITS OWN REASON RATHER THAN evaluative_language, which is
 *                   where it briefly lived: a model that mis-split one field and a model that INVENTED
 *                   a verdict where the facts supplied none are two different events with two
 *                   different next actions, and one name for both would hide the serious one behind
 *                   the trivial one. That is 5b-1's rule applied to a case 5b-1 did not name.
 *
 * The language and grounding refusals do not retry: those are the model saying something it should
 * not, and rolling the dice until it stops saying it is not a guard, it is a lottery.
 */
const RETRYABLE: ReadonlySet<RefusalReason> = new Set<RefusalReason>([
  "malformed_json",
  "echo_mismatch",
  // ⚠ RETRIED FOR THE SAME REASON THE OTHER TWO ARE, AND FOR THE OPPOSITE REASON empty_section IS NOT.
  // A retry cannot manufacture content here: the failure is SURPLUS. The second sample is simply a
  // different draw from a distribution that has already produced a compliant answer on ten cards in
  // twelve, so it costs one call and usually works. `empty_section` stays out because a retry there
  // would be paying for the model to pad.
  "overlong_takeaway",
  // ⚠ RETRIES. Dropping a figure into "a large part of" is a summarising slip, not a judgement — the
  // same class as a copying slip, and the same fix. The prompt now says to keep the amount, so the
  // second draw has an instruction behind it rather than only luck.
  "missing_required_figure",
]);

/**
 * ★★ EVERY FIGURE A RULE DECLARED REQUIRED, STILL PRESENT IN THE BULLETS. Returns the first missing
 * one, or null.
 *
 * ⚠ IT LOOKS ONLY AT THE BULLETS. `verdictLabel` and `verdictMeaning` are copy-verbatim fields with a
 * fixed vocabulary and no figures in them, so a match there would be an accident and would let the
 * takeaway ship without the number anyway.
 *
 * ⚠ AND IT IS A SUBSTRING TEST ON THE RENDERED STRING, DELIBERATELY. "₹57,491 crore" is format.ts's
 * one rendering of that amount; anything else the model writes for it — a different grouping, a
 * different unit, a rounded version — is a second rendering of a figure this feature renders once,
 * and the number-grounding scan would refuse it on the next line anyway.
 */
function missingRequiredFigure(answer: RawTakeaway, block: QuarterBriefFactBlock): string | null {
  const bullets = Array.isArray(answer.bullets) ? (answer.bullets as string[]).join("\n") : "";
  for (const c of block.contrasts) {
    if (c.requiredFigure && !bullets.includes(c.requiredFigure)) {
      return `${c.rule} requires "${c.requiredFigure}" and no bullet carries it`;
    }
  }
  return null;
}

export interface GenerateOk {
  ok: true;
  payload: BriefPayload;
  model: string;
  promptTokens: number | null;
  outputTokens: number | null;
  /** What the guards actually examined — stored so a clean run is auditable, not merely asserted. */
  audit: { leavesScanned: number; numbersChecked: number; numbersSkipped: number; attempts: number };
}

export interface GenerateRefused {
  ok: false;
  reason: RefusalReason;
  /** Operator-facing detail. Never shown to a reader — a refusal renders as absence. */
  detail: string;
  /** The rejected answer, for the refusal log. NEVER stored as a brief. */
  rejectedText?: string;
  attempts: number;
}

export type GenerateResult = GenerateOk | GenerateRefused;

// ── Pacing ──────────────────────────────────────────────────────────────────────────────────────────
// Process-local. Enough for the single worker that runs this; if generation ever fans out across
// processes this must move to a shared limiter, and the RPD gate in quota.ts is the only thing that
// would still hold. Stated so the limit of this mechanism is on the record.
let lastCallAt = 0;
async function pace(): Promise<void> {
  const wait = lastCallAt + MIN_CALL_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

// ═══ VERBATIM-FIGURE CHECK — the guard that the shared value scan cannot be ═══════════════════════
//
// ⚠ MEASURED, NOT ASSUMED. scanUngroundedNumbers compares VALUES with a 2% relative tolerance and a
// finite list of unit factors (×100, ×1000, ×1e5, ×1e7 and inverses). Those two features multiply: on
// a real DIXON haystack, the fabricated figure "₹47,318 crore" scanned CLEAN, because the block
// contains 48 (from "up 48% against the previous quarter") and 48 × 1000 = 48,000, which is inside 2%
// of 47,318. A PERCENTAGE LAUNDERED A CRORE FIGURE. The effective grounded set is far larger than the
// literal figures, and on a block dense with percentages almost any large number finds a cover.
//
// That tolerance is right for CHAT, where the model paraphrases and converts units legitimately. It is
// wrong here, because this prompt orders something stricter: "Reproduce every figure EXACTLY as
// written in the facts." When the only legal output is a verbatim copy, the correct test is a verbatim
// comparison — no tolerance, no conversion. So this runs ALONGSIDE the shared scan, not instead of it.
//
// The blind spot is preserved DELIBERATELY and identically (years, integers ≤ 12), so this guard is
// strictly additive and never fires on "the three months ended" or a small count the prompt allows.

const FIGURE_RE = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g;

const figureTokens = (s: string): string[] =>
  [...s.matchAll(FIGURE_RE)].map((m) => m[1].replace(/,/g, ""));

const isYearish = (v: number): boolean => Number.isInteger(v) && v >= 1990 && v <= 2100;
const isSmallCount = (v: number): boolean => Number.isInteger(v) && v <= 12;

/** Figures in `text` that do not appear, character for character, among the figures of `factText`. */
function nonVerbatimFigures(text: string, factText: string): string[] {
  const allowed = new Set(figureTokens(factText));
  const out: string[] = [];
  for (const tok of figureTokens(text)) {
    const v = Number(tok);
    if (!Number.isFinite(v) || isYearish(v) || isSmallCount(v)) continue; // same blind spot, on purpose
    if (!allowed.has(tok)) out.push(tok);
  }
  return [...new Set(out)];
}

// ═══ THE SCAN, PER STRING LEAF ════════════════════════════════════════════════════════════════════

interface LeafFinding {
  reason: RefusalReason;
  detail: string;
}

/**
 * ★ EVERY GUARD, ON EVERY STRING THE MODEL AUTHORED, ONE STRING AT A TIME.
 *
 * ⚠⚠ NOT ON `JSON.stringify(answer)`. schema.ts's `stringLeaves` header carries the full argument;
 * the short version is that concatenating fields synthesises hard-tier hits that exist in neither
 * field ("…should" + "buy…"), feeds our own schema key names into a prose scanner, and reduces a
 * finding to "somewhere in 4 KB of JSON". Walking gives every finding an address.
 *
 * ⚠ AND IT IS A WALK, NOT A LIST. A hand-kept list of scanned paths silently exempts every field
 * added after it was written. Nothing here names a field.
 */
function scanLeaves(answer: unknown, factText: string, haystack: string): {
  finding: LeafFinding | null;
  leaves: number;
  numbersChecked: number;
  numbersSkipped: number;
} {
  const leaves = stringLeaves(answer);
  let numbersChecked = 0;
  let numbersSkipped = 0;

  for (const leaf of leaves) {
    const text = leaf.text.trim();
    if (!text) continue;

    // ── GUARD 1 · NUMBER GROUNDING ────────────────────────────────────────────────────────────────
    // ⚠ RESTATED BLIND SPOT: integers ≤ 12 and years 1990–2100 are NOT CHECKED. An invented COUNT is
    // invisible to this scan ("three findings fired" when one did). A clean scan proves only that no
    // LARGE unexplained figure appeared. The prompt carries a matching instruction because instruction
    // is the only cover this scan does not give.
    const numbers = scanUngroundedNumbers(text, haystack);
    numbersChecked += numbers.checked;
    numbersSkipped += numbers.skipped;
    if (!numbers.clean) {
      return {
        finding: {
          reason: "ungrounded_number",
          detail: `${leaf.path}: ${numbers.hits.map((h) => `${h.raw} — ${h.context}`).join(" | ")}`,
        },
        leaves: leaves.length, numbersChecked, numbersSkipped,
      };
    }

    // ── GUARD 1b · VERBATIM FIGURES — what the tolerance would launder ────────────────────────────
    const nonVerbatim = nonVerbatimFigures(text, factText);
    if (nonVerbatim.length > 0) {
      return {
        finding: {
          reason: "ungrounded_number",
          detail: `${leaf.path}: figure(s) not reproduced verbatim from the facts: ${nonVerbatim.join(", ")}`,
        },
        leaves: leaves.length, numbersChecked, numbersSkipped,
      };
    }

    // ── GUARD 2 · LANGUAGE — BLOCKS ON A CHANNEL CHAT ONLY LOGS ───────────────────────────────────
    // scanExplanationText is called UNCHANGED. `clean` still reads only the hard channels, and
    // `evaluativeHits` is still structurally unable to affect it — the tier's signature and chat's
    // behaviour are untouched. What differs is the POLICY APPLIED HERE: this caller refuses on a
    // channel chat logs, because chat has a human reader and this does not.
    // ★ D4 — SOFT IS DELIBERATELY NOT CONSULTED, ON EVIDENCE GATHERED TWICE. In two independent runs
    // the SOFT tier fired on Vytal's OWN catalogue copy — the `doesntMean` string this feature is
    // instructed to reproduce ("…the two should not be read as saying the same thing", term
    // `should-bare`). A blocking SOFT tier would refuse the product's own words. Do not promote it
    // here without first resolving that case.
    const verdict = scanExplanationText(text);
    if (!verdict.clean) {
      return {
        finding: {
          reason: "forward_language",
          detail: `${leaf.path}: ${verdict.hardHits.map((h) => `${h.term}: "${h.match}"`).join(" | ")}`,
        },
        leaves: leaves.length, numbersChecked, numbersSkipped,
      };
    }
    // ★ D3 — THIS BLOCK IS UNTESTED, NOT VALIDATED. Across 23 generated briefs the evaluative tier
    // fired ZERO times. That is evidence the PROMPT holds; it is not evidence the tier is calibrated,
    // because it has never fired here at all. Blocking is therefore free, and stays.
    // ⚠ WHEN IT FIRES FOR THE FIRST TIME, READ THE SENTENCE BEFORE REACHING FOR THE COPY. If the text
    // it caught is CORRECT, the finding is the POLICY, not the prose.
    if (verdict.evaluativeHits.length > 0) {
      return {
        finding: {
          reason: "evaluative_language",
          detail: `${leaf.path}: ${verdict.evaluativeHits.map((h) => `${h.term}: "${h.match}"`).join(" | ")}`,
        },
        leaves: leaves.length, numbersChecked, numbersSkipped,
      };
    }
  }

  return { finding: null, leaves: leaves.length, numbersChecked, numbersSkipped };
}

/**
 * Generate one brief. Returns a payload that cleared every guard, or a refusal.
 *
 * `actor` is the system actor for scheduled generation — it bypasses the PER-USER sub-cap but is still
 * counted against the global daily budget, which is the cap that matters here.
 */
export async function generateQuarterBrief(
  block: QuarterBriefFactBlock,
  opts: { actor?: Actor; model?: string } = {},
): Promise<GenerateResult> {
  const model = opts.model ?? QUARTER_BRIEF_MODEL;
  const actor: Actor = opts.actor ?? { kind: "system", job: "quarter_brief" };

  const facts = renderFactText(block);
  // ⚠ THE HAYSTACK IS THE SYSTEM PROMPT + THE EXACT FACT TEXT THE MODEL SAW — nothing narrower, and
  // it is UNCHANGED by the schema (5c-2). number-grounding.ts's header is explicit that a caller
  // passing only the data has rebuilt the blind version of the scan: the product's own vocabulary
  // (band cuts, "0 to 100") lives in the system prompt, and without it the scan fires on obedience.
  const haystack = `${QUARTER_BRIEF_SYSTEM}\n${facts}`;

  let lastDetail = "";
  let lastBlank = false;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;

    const quota = await checkAndConsumeAiCall(model, actor);
    if (!quota.allowed) {
      return { ok: false, reason: "quota_exhausted", detail: quota.reason ?? "daily AI budget reached", attempts };
    }

    await pace();

    let answer: RawTakeaway;
    let usage: { promptTokens?: number; outputTokens?: number } | undefined;
    try {
      const res = await createGeminiAdapter().generateStructured<RawTakeaway>({
        model,
        system: QUARTER_BRIEF_SYSTEM,
        messages: [{ role: "user", content: facts }],
        temperature: 0.2,
        maxTokens: MAX_OUTPUT_TOKENS,
        jsonSchema: TAKEAWAY_RESPONSE_SCHEMA,
      });
      usage = res.usage;
      if (res.usage.promptTokens + res.usage.outputTokens > 0) {
        await recordAiTokens(model, res.usage.promptTokens + res.usage.outputTokens);
      }

      if (!res.ok) {
        // ── MALFORMED — AND finishReason IS THE DIAGNOSIS ────────────────────────────────────────
        // ⚠ AN EMPTY BODY IS STILL blank_output, NOT malformed_json. "" fails JSON.parse, so without
        // this branch a blank 429 would arrive here wearing the new reason and the rate-limit
        // signature the previous stage went to some trouble to preserve would be gone. The empty case
        // is checked FIRST and keeps its own name.
        if (!res.raw.trim()) {
          lastBlank = true;
          lastDetail = "provider returned empty text (indistinguishable from a blank 429)";
          continue;
        }
        lastBlank = false;
        const truncated = res.finishReason === "MAX_TOKENS";
        lastDetail =
          `finishReason=${res.finishReason ?? "unknown"}` +
          (truncated
            ? ` — TRUNCATED at the ${MAX_OUTPUT_TOKENS}-token ceiling, not malformed; raise MAX_OUTPUT_TOKENS`
            : ` — the model returned unparseable text`) +
          `; ${res.raw.length} chars, ${usage?.outputTokens ?? "?"} output tokens`;
        if (attempt < MAX_ATTEMPTS && RETRYABLE.has("malformed_json")) continue;
        return { ok: false, reason: "malformed_json", detail: lastDetail, rejectedText: res.raw, attempts };
      }
      answer = res.data;
      lastBlank = false;
    } catch (e) {
      lastDetail = (e as Error).message;
      lastBlank = false;
      continue; // transient provider failure — retry once, then refuse
    }

    // ── GUARD 3 · SHAPE. The schema got us an object; it could not get us a non-empty one, and it
    //    could not get us a SHORT one either — Gemini's responseSchema honours neither minItems nor
    //    maxItems, which is why the 1..5 range is enforced here in code. ────────────────────────────
    const shape = takeawayShapeError(answer);
    if (shape) {
      // ⚠ THE TWO SHAPE FAULTS RETRY DIFFERENTLY, AND THE REASON CARRIES WHICH ONE IT WAS. An empty
      // answer is either the honest one or a fact-block fault and is NOT retried; an overlong one is
      // a counting slip and is. See schema.ts's ShapeError note.
      lastDetail = `takeaway: ${shape.detail}`;
      if (RETRYABLE.has(shape.code) && attempt < MAX_ATTEMPTS) continue;
      return {
        ok: false,
        reason: shape.code,
        detail: lastDetail,
        rejectedText: JSON.stringify(answer),
        attempts,
      };
    }

    // ── GUARD 4 · THE ECHOES, BY EQUALITY ────────────────────────────────────────────────────────
    // Not a scan. The two verdict fields were HANDED to the model, so the honest test is `===`.
    const echo = checkEchoes(answer, block);
    if (echo) {
      lastDetail = `echo: ${echo}`;
      if (attempt < MAX_ATTEMPTS) continue;
      return { ok: false, reason: "echo_mismatch", detail: lastDetail, rejectedText: JSON.stringify(answer), attempts };
    }

    // ── GUARD 4b · THE FIGURES A RULE DECLARED REQUIRED ──────────────────────────────────────────
    // Beside the echo check because it is the same shape of question — was something the fact block
    // handed over still there — and a different one from "did the model say anything it should not".
    const missing = missingRequiredFigure(answer, block);
    if (missing) {
      lastDetail = `required figure: ${missing}`;
      if (attempt < MAX_ATTEMPTS) continue;
      return {
        ok: false,
        reason: "missing_required_figure",
        detail: lastDetail,
        rejectedText: JSON.stringify(answer),
        attempts,
      };
    }

    // ── GUARDS 1, 1b AND 2 · PER STRING LEAF ─────────────────────────────────────────────────────
    const scan = scanLeaves(answer, facts, haystack);
    if (scan.finding) {
      return {
        ok: false,
        reason: scan.finding.reason,
        detail: scan.finding.detail,
        rejectedText: JSON.stringify(answer),
        attempts,
      };
    }

    // ── ASSEMBLE, THEN GUARD 5 ON THE WHOLE PAYLOAD ──────────────────────────────────────────────
    // The empty-section check runs on the ASSEMBLED object, not on the model's answer, because the
    // sections it protects are ours: a quarter section with no lines, or gaps with nothing in them,
    // is a fact-block fault and it would otherwise ship as a card with headings and no content.
    const payload = assembleBriefPayload(block, {
      ...(typeof answer.verdictLabel === "string" ? { verdictLabel: answer.verdictLabel.trim() } : {}),
      ...(typeof answer.verdictMeaning === "string" ? { verdictMeaning: answer.verdictMeaning.trim() } : {}),
      bullets: (answer.bullets as string[]).map((b) => b.trim()),
    });

    const empties = emptySections(payload);
    if (empties.length > 0) {
      return {
        ok: false,
        reason: "empty_section",
        detail: `present but empty: ${empties.join(", ")}`,
        rejectedText: JSON.stringify(payload),
        attempts,
      };
    }

    return {
      ok: true,
      payload,
      model,
      promptTokens: usage?.promptTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      audit: {
        leavesScanned: scan.leaves,
        numbersChecked: scan.numbersChecked,
        numbersSkipped: scan.numbersSkipped,
        attempts,
      },
    };
  }

  return {
    ok: false,
    reason: lastBlank ? "blank_output" : "provider_error",
    detail: lastDetail || "generation failed",
    attempts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ PACING AND TPM — A CEILING NOTHING IN THIS CODEBASE TRACKS
//
// `pace()` bounds REQUESTS: 4.2 s apart is at most 14.3 calls/min, comfortably under Google's 15 RPM.
// It does not bound TOKENS, and tokens are what moved.
//
// MEASURED (scripts/measure-brief-tokens.ts, one card per family): 2,296–2,849 prompt tokens plus
// 157–210 output ⇒ 3,059 tokens on the worst call. At the pacing ceiling that is
// 14.3 × 3,059 ≈ 43,700 tokens/min sustained — inside Flash-Lite's published free-tier TPM, but
// the point is that NOTHING HERE KNOWS THAT. There is no TPM term in the limiter and no counter to
// read; the first evidence of a breach would be a 429, and a 429 can return an empty body, which
// arrives as `blank_output` — the same symptom as an RPM breach, from a different cause.
//
// ── SHOULD A TPM TERM JOIN PACING? NOT YET, AND HERE IS THE CONDITION ──────────────────────────
// Adding one now would be a limiter fitted to a number nobody has measured against a ceiling nobody
// has read from the provider. The honest position is: the RPM term is enforced and the TPM term is
// NOT, the headroom looks large, and if a run of blank_output ever appears the FIRST thing to check
// is no longer "is a second worker running" but "what were the prompt tokens on the calls either
// side". If briefs ever fan out across processes, or if the fact block grows again the way Stage 4
// grew it, this becomes a real limiter and not a comment.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
