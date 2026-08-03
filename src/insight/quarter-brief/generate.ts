// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — GENERATION, WITH THE GUARDS CHAT DOES NOT HAVE.
//
// Chat logs its scans because a human reads every reply within seconds and can discard a bad one.
// This runs unattended and STORES what it writes, so the same signals REFUSE instead. Nothing here
// changes how chat behaves — see the note on the evaluative tier below.
//
// ── THE REFUSAL CONTRACT ────────────────────────────────────────────────────────────────────────────
// Every path either returns prose that passed every guard, or returns a refusal with a reason. There is
// no third outcome and no partial one: a brief is whole or it does not exist. A caller that gets a
// refusal stores NOTHING, and the reader sees no section rather than a half-written one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { createGeminiAdapter } from "../../ai/adapters/gemini.js";
import { checkAndConsumeAiCall, recordAiTokens, type Actor } from "../../ai/quota.js";
import { scanUngroundedNumbers } from "../../ai/number-grounding.js";
import { scanExplanationText } from "../../ai/guardrail.js";
import { QUARTER_BRIEF_SYSTEM, renderFactText, ALLOWED_HEADINGS } from "./prompt.js";
import type { QuarterBriefFactBlock } from "./types.js";

/** The model this feature runs on. Matches the budgeted tier (AI_BUDGET_FLASH_LITE). */
export const QUARTER_BRIEF_MODEL = "gemini-3.5-flash-lite";

/** ⚠ 15 requests/minute is a GOOGLE ceiling that nothing in app code enforces — measured in the live
 *  verify scripts, never implemented. ~12 briefs/day average is trivial against 480 RPD; the risk is
 *  a heavy filing day when 50–100 companies report at once and an unpaced loop fires them back to
 *  back. 4.2s between calls holds us under 15/min with headroom. */
const MIN_CALL_SPACING_MS = 4_200;

/** Two attempts total. A blank is retried once because it is usually transient (see BLANK below). */
const MAX_ATTEMPTS = 2;

/** ⚠ `blank_output` IS LOAD-BEARING, NOT TIDINESS. A 429 from Google can return an EMPTY BODY, which
 *  is indistinguishable from a successful empty generation — both arrive as "" with no error. So a
 *  rate-limit breach does NOT announce itself; it surfaces as a RUN OF blank_output REFUSALS and
 *  nothing else. If you are reading a cluster of these in background_jobs, suspect the 15 req/min
 *  ceiling before you suspect the model, and check whether a second worker process is running (see
 *  worker.ts's single-worker prohibition — that is the only way pacing can be defeated). Keeping this
 *  reason distinct from `provider_error` is what makes that signature visible at all. */
export type RefusalReason =
  | "quota_exhausted"
  | "provider_error"
  | "blank_output"
  | "ungrounded_number"
  | "evaluative_language"
  | "forward_language"
  | "unknown_heading";

export interface GenerateOk {
  ok: true;
  text: string;
  model: string;
  promptTokens: number | null;
  outputTokens: number | null;
  /** What the guards actually examined — stored so a clean run is auditable, not merely asserted. */
  audit: { numbersChecked: number; numbersSkipped: number; attempts: number };
}

export interface GenerateRefused {
  ok: false;
  reason: RefusalReason;
  /** Operator-facing detail. Never shown to a reader — a refusal renders as absence. */
  detail: string;
  /** The rejected text, for the refusal log. NEVER stored as a brief. */
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
// comparison — no tolerance, no conversion. So this runs ALONGSIDE the shared scan, not instead of it:
// the shared scan still catches invented conversions of real figures, and this catches everything the
// tolerance would launder.
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

const HEADING_RE = /^\s{0,3}(?:#{1,6}\s*|\*\*)?([A-Z][^\n*#:]{3,60}?)(?:\*\*)?\s*:?\s*$/gm;

/** Headings the model actually emitted that are not in the allowed set. A model that invents
 *  "Outlook" or "Key takeaways" has left the specified shape, and those are exactly the sections the
 *  facts cannot support. */
function unknownHeadings(text: string): string[] {
  const allowed = new Set<string>(ALLOWED_HEADINGS.map((h) => h.toLowerCase()));
  const found: string[] = [];
  for (const m of text.matchAll(HEADING_RE)) {
    const h = m[1].trim();
    // A sentence that happens to end a line is not a heading; require it to be short and unpunctuated.
    if (/[.!?,;]$/.test(h) || h.split(/\s+/).length > 8) continue;
    if (!allowed.has(h.toLowerCase())) found.push(h);
  }
  return found;
}

/**
 * Generate one brief. Returns prose that cleared every guard, or a refusal.
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
  // ⚠ THE HAYSTACK IS THE SYSTEM PROMPT + THE EXACT FACT TEXT THE MODEL SAW — nothing narrower.
  // number-grounding.ts's header is explicit that a caller passing only the data has rebuilt the blind
  // version of the scan: the product's own vocabulary (band cuts, "0 to 100") lives in the system
  // prompt, and without it the scan fires on obedience.
  const haystack = `${QUARTER_BRIEF_SYSTEM}\n${facts}`;

  let lastDetail = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;

    const quota = await checkAndConsumeAiCall(model, actor);
    if (!quota.allowed) {
      return { ok: false, reason: "quota_exhausted", detail: quota.reason ?? "daily AI budget reached", attempts };
    }

    await pace();

    let text: string;
    let usage: { promptTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    try {
      const res = await createGeminiAdapter().generate({
        model,
        system: QUARTER_BRIEF_SYSTEM,
        messages: [{ role: "user", content: facts }],
        temperature: 0.2,
        maxTokens: 900,
      });
      text = res.text ?? "";
      usage = res.usage as { promptTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    } catch (e) {
      lastDetail = (e as Error).message;
      continue; // transient provider failure — retry once, then refuse
    }

    if (usage?.totalTokens) await recordAiTokens(model, usage.totalTokens);

    // ── BLANK IS NOT A RESULT ────────────────────────────────────────────────────────────────────
    // ⚠ A blank 429 is indistinguishable from a successful empty generation: both arrive as "" with no
    // error. Treating "" as success would store an empty brief and count it as a win, which is the
    // worst available outcome — a reader sees a section that exists and says nothing. So a blank is
    // retried, and if it blanks again it REFUSES. It is never stored and never counted as a success.
    if (!text.trim()) {
      lastDetail = "provider returned empty text (indistinguishable from a blank 429)";
      continue;
    }

    const body = text.trim();

    // ── GUARD 1 · NUMBER GROUNDING — BLOCKS ──────────────────────────────────────────────────────
    // ⚠ RESTATED BLIND SPOT: integers ≤ 12 and years 1990–2100 are NOT CHECKED. An invented COUNT is
    // invisible to this scan ("three findings fired" when one did). A clean scan proves only that no
    // LARGE unexplained figure appeared — it is not proof the brief's numbers are right. The prompt
    // carries a matching instruction ("do not say how many things happened unless the facts say so")
    // because instruction is the only cover this scan does not give.
    const numbers = scanUngroundedNumbers(body, haystack);
    if (!numbers.clean) {
      return {
        ok: false,
        reason: "ungrounded_number",
        detail: numbers.hits.map((h) => `${h.raw} — ${h.context}`).join(" | "),
        rejectedText: body,
        attempts,
      };
    }

    // ── GUARD 1b · VERBATIM FIGURES — BLOCKS what the tolerance would launder (see header above) ──
    const nonVerbatim = nonVerbatimFigures(body, facts);
    if (nonVerbatim.length > 0) {
      return {
        ok: false,
        reason: "ungrounded_number",
        detail: `figure(s) not reproduced verbatim from the facts: ${nonVerbatim.join(", ")}`,
        rejectedText: body,
        attempts,
      };
    }

    // ── GUARD 2 · LANGUAGE — BLOCKS ON A CHANNEL CHAT ONLY LOGS ──────────────────────────────────
    // scanExplanationText is called UNCHANGED. `clean` still reads only the hard channels, and
    // `evaluativeHits` is still structurally unable to affect it — the tier's signature and chat's
    // behaviour are untouched. What differs is the POLICY APPLIED HERE: this caller refuses on a
    // channel chat logs, because chat has a human reader and this does not. Promotion of the tier
    // remains the deliberate two-line edit it was; this is a second consumer choosing to be stricter.
    // ★ D4 — SOFT IS DELIBERATELY NOT CONSULTED, ON EVIDENCE GATHERED TWICE.
    // In two independent runs the SOFT tier fired on the SAME sentence — and it is Vytal's own
    // catalogue copy, the `doesntMean` string from guardrail-signatures.ts that this feature is
    // INSTRUCTED to reproduce: "…the two should not be read as saying the same thing" (term
    // `should-bare`). A blocking SOFT tier would refuse the product's own words, every time that
    // finding fires. Do not promote SOFT here without first resolving that case.
    const verdict = scanExplanationText(body);
    if (!verdict.clean) {
      return {
        ok: false,
        reason: "forward_language",
        detail: verdict.hardHits.map((h) => `${h.term}: "${h.match}"`).join(" | "),
        rejectedText: body,
        attempts,
      };
    }
    // ★ D3 — THIS BLOCK IS UNTESTED, NOT VALIDATED. Across 23 generated briefs (5 at Stage 3, 18 at
    // Stage 5) the evaluative tier fired ZERO times. That is evidence the PROMPT holds; it is not
    // evidence the tier is calibrated, because it has never fired here at all. Blocking is therefore
    // free, and stays.
    // ⚠ WHEN IT FIRES FOR THE FIRST TIME, READ THE SENTENCE BEFORE REACHING FOR THE COPY. If the text
    // it caught is CORRECT, the finding is the POLICY, not the prose — loosen or scope this block and
    // say why. Editing product copy to satisfy a scanner is how a guard starts shaping the product
    // instead of checking it. (Precedent: the SOFT tier below.)
    if (verdict.evaluativeHits.length > 0) {
      return {
        ok: false,
        reason: "evaluative_language",
        detail: verdict.evaluativeHits.map((h) => `${h.term}: "${h.match}"`).join(" | "),
        rejectedText: body,
        attempts,
      };
    }

    // ── GUARD 3 · SHAPE ──────────────────────────────────────────────────────────────────────────
    const strays = unknownHeadings(body);
    if (strays.length > 0) {
      return {
        ok: false,
        reason: "unknown_heading",
        detail: `invented section(s): ${strays.join(", ")}`,
        rejectedText: body,
        attempts,
      };
    }

    return {
      ok: true,
      text: body,
      model,
      promptTokens: usage?.promptTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      audit: { numbersChecked: numbers.checked, numbersSkipped: numbers.skipped, attempts },
    };
  }

  const blank = /empty text/.test(lastDetail);
  return {
    ok: false,
    reason: blank ? "blank_output" : "provider_error",
    detail: lastDetail || "generation failed",
    attempts,
  };
}
