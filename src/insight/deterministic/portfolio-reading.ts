// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PATTERN-LIBRARY SEED · PORTFOLIO — the deterministic fallback, a LAYER SELECTOR, ZERO AI.
//
// Rescued from the removed explain/portfolio-health.ts. It AUTHORS NO ANALYSIS: it selects and joins
// prose that already exists and is already proven —
//
//   LAYER 1 · snapshot.story.text — the composed PHS storyboard (portfolio/phs/story.ts).
//   LAYER 2 · constructionRead.findings[].read — the joined construction findings (covers exactly where
//             Layer 1 is null: a construction-only book has no story, and there the construction read
//             is handed the WHOLE fired set).
//   LAYER 3 · one of four fixed sentences that name a STATE (never describe a book).
//
// This "select and stitch what the pattern engine already produced" shape is precisely what the
// deterministic pattern library will generalise, which is why it is kept here as seed rather than
// deleted with the AI surface.
//
// ⚠ THE FOUR AUTHORED SENTENCES ARE THE ONLY PROSE THIS MODULE WRITES ITSELF, and they are enumerated
// in AUTHORED_FALLBACK_STRINGS and scanned (against both advice vocabularies) by
// scripts/verify-ai-portfolio-fallback.ts, which also re-reads THIS FILE to assert the array is
// exhaustive. A new authored sentence that skips the array fails that proof.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { PortfolioHealthView } from "../../portfolio/phs/portfolio-health-view.js";

// ── THE AUTHORED SET ─────────────────────────────────────────────────────────────────────────────
// Four, deliberately: each names a STATE, none describes a book.

/** No snapshot, no holdings — there is nothing to explain and nothing was lost. */
const EMPTY_BOOK = "This portfolio holds nothing right now, so there is no health reading to explain.";

/** Holdings exist, but no snapshot has landed yet. ★ THE DISTINCTION FROM EMPTY_BOOK IS LOAD-BEARING:
 *  telling someone who owns twelve positions that they "hold nothing" is a false statement about their
 *  money, not a rounding of one. */
const NO_SNAPSHOT = "This portfolio has not been scored yet, so no health reading exists for it.";

/** A snapshot exists but composed to nothing (a stale row with no findings carrying a `read`).
 *  Defensive: reachable only on stale rows, whose cure is their next recompute. */
const NO_READING = "No health reading is available for this portfolio yet.";

/** Construction-only header. The one place a sentence is genuinely owed: without it, Layer 2 opens on
 *  a bare list of construction facts and a reader is left to wonder where the health number went. */
const CONSTRUCTION_ONLY_HEADER =
  "Nothing in this book is scored yet, so it has no health reading — only a construction read.";

/**
 * ★ THE PROOF SET, EXPORTED — exhaustive BY CONSTRUCTION. verify-ai-portfolio-fallback.ts scans every
 * member against the portfolio advice vocabulary AND the runtime AI guardrail, and separately re-reads
 * THIS FILE to assert that every authored const above appears in this array.
 */
export const AUTHORED_FALLBACK_STRINGS: readonly string[] = Object.freeze([
  EMPTY_BOOK,
  NO_SNAPSHOT,
  NO_READING,
  CONSTRUCTION_ONLY_HEADER,
]);

/** Which layer answered — so a caller (and the proof) can tell a rich story from a bare decline without
 *  parsing the text. */
export type PortfolioFallbackLayer = "story" | "construction_findings" | "decline";

export interface PortfolioFallback {
  text: string;
  layer: PortfolioFallbackLayer;
}

/**
 * Compose the deterministic portfolio fallback. Pure: no DB, no AI, no clock — everything is read off
 * the view the caller already grounded with. Never throws and never returns empty; the decline
 * sentences are real answers to real states, not error strings.
 */
export function composeDeterministicPortfolioFallbackDetailed(view: PortfolioHealthView): PortfolioFallback {
  const snap = view.snapshot;

  // ── LAYER 3 · no snapshot ──
  // ⚠ `hasHoldings` is answered over the UNION (manual ∪ broker), so a broker-only book is not mistaken
  // for an empty one. Getting this branch backwards is the one failure here that would be a false
  // statement rather than a thin one.
  if (!snap) {
    return { text: view.hasHoldings ? NO_SNAPSHOT : EMPTY_BOOK, layer: "decline" };
  }

  // ── LAYER 1 · the storyboard ──
  // Preferred whenever it exists: it is the only layer that STITCHES, and it is proven as composed
  // output, not merely as ingredients.
  const story = snap.story?.text?.trim();
  if (story) return { text: story, layer: "story" };

  // ── LAYER 2 · the construction findings, joined ──
  // Reached on a construction-only book (no health read ⇒ no story) and on stale rows the composer
  // refuses to narrate. On the former, `findings` is the WHOLE fired set — nothing is dropped.
  const reads = snap.constructionRead.findings
    .map((f) => f.read?.trim())
    .filter((r): r is string => !!r);

  if (reads.length) {
    // The header is added ONLY when the health read is genuinely absent.
    const parts = snap.healthRead === null ? [CONSTRUCTION_ONLY_HEADER, ...reads] : reads;
    return { text: parts.join(" "), layer: "construction_findings" };
  }

  return { text: NO_READING, layer: "decline" };
}

/** Text-only convenience — the shape a caller serving a single string wants. */
export function composeDeterministicPortfolioFallback(view: PortfolioHealthView): string {
  return composeDeterministicPortfolioFallbackDetailed(view).text;
}
