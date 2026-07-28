// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — COPY + REGISTER (Overview Pattern Library §0.11 / §0.8 / Part IX).
//
// The claim is TONE-INVARIANT (a fact with a number reads correctly to a beginner and does not patronise
// an expert). The GLOSS is tone-dependent — the ONE piece that varies on aiLevel. Precision rules are
// inherited and non-negotiable (§0.11): whole-number scores, approximate percentages, Indian money
// convention, exact holding counts.
//
// This module also owns the REGISTER GUARD run over the ASSEMBLED output (§4.2 step 7 / §0.11 — drift
// appears in composition, not in the fragments): forward/advice language (reused from the lens guard),
// celebration language (§3.1 UO6 / Part IX·17), modeled-transaction constructions (§0.8 / Part IX·3),
// and reader-ranking (Part IX·18). Fragments are never scanned alone.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { ToneLevel } from "../ai/tone.js";
import { scanStringsForForwardLanguage, PORTFOLIO_ADVICE_DENY_LIST } from "../scoring/lens-patterns/no-forward-guard.js";

// ── Precision (§0.11) ────────────────────────────────────────────────────────────────────────────────

/** Whole-number score. "about 71", never "70.82". */
export const scoreStr = (n: number): string => `${Math.round(n)}`;

/** Percentage as a whole-number approximation. A nonzero value rounding to zero renders "<1%", never
 *  "0%". `weightPct` is already 0–100. */
export function pctStr(pct: number): string {
  if (pct > 0 && pct < 0.5) return "<1%";
  return `${Math.round(pct)}%`;
}

/** Money in Indian convention: ₹2.4 lakh · ₹18,000 · ₹40 crore. No `formatINR` exists in the backend, so
 *  the relational layer authors one (§0.11). Never introduces precision the source did not carry — a
 *  lakh/crore figure is shown to one decimal only when that decimal is non-zero. */
export function formatINR(value: number): string {
  const v = Math.round(value);
  if (v >= 1_00_00_000) {
    const cr = v / 1_00_00_000;
    return `₹${trimDecimal(cr)} crore`;
  }
  if (v >= 1_00_000) {
    const lakh = v / 1_00_000;
    return `₹${trimDecimal(lakh)} lakh`;
  }
  // Below a lakh — grouped Indian digits (₹18,000).
  return `₹${groupIndian(v)}`;
}

function trimDecimal(n: number): string {
  const oneDp = Math.round(n * 10) / 10;
  return Number.isInteger(oneDp) ? `${oneDp}` : oneDp.toFixed(1);
}

function groupIndian(n: number): string {
  const s = `${n}`;
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

/** "3 accounts" / "1 account", "2 checks" / "1 check", etc. */
export const plural = (n: number, singular: string, pluralForm = `${singular}s`): string =>
  `${n} ${n === 1 ? singular : pluralForm}`;

/** Ordinal for UH3 ("your 2nd-largest position"). */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

// ── Glosses (§0.11) — one term→gloss map, authored once per term, keyed on aiLevel (three variants,
//    NOT the seven-way triple). `plain` glosses any non-everyday term; `balanced` only less-common ones;
//    `technical` suppresses entirely. This slice's UO/UH claims are near-gloss-free (they are facts with
//    numbers); the map is here so the shape is complete and the AI/card share one source. ─────────────
type GlossTier = "everyday" | "less_common" | "specialist";
interface GlossDef {
  tier: GlossTier;
  gloss: string;
}
const GLOSSARY: Record<string, GlossDef> = {
  "peer group": { tier: "less_common", gloss: "the fair comparison set — companies we score against each other" },
  composite: { tier: "specialist", gloss: "the overall health score, 0–100" },
  "health score": { tier: "less_common", gloss: "our 0–100 read of how sound the company is" },
  deleveraging: { tier: "specialist", gloss: "reducing debt relative to equity" },
};

/** Resolve the gloss for a term at a register, or null if suppressed. `plain` glosses less_common AND
 *  specialist; `balanced` glosses specialist only; `technical` suppresses everything. */
export function glossFor(term: string, level: ToneLevel): string | null {
  const def = GLOSSARY[term.toLowerCase()];
  if (!def) return null;
  if (level === "technical") return null;
  if (level === "plain") return def.tier === "everyday" ? null : def.gloss;
  // balanced
  return def.tier === "specialist" ? def.gloss : null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE REGISTER GUARD — run over the ASSEMBLED output (all rendered claims of a card), never fragments.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Celebration language forbidden on UO6 and anywhere strength is stated (§3.1 UO6 · Part IX·17). Strength
 *  is stated and dated, never celebrated; duration is the carrier of weight. Word-boundary, case-insensitive. */
export const CELEBRATION_DENY_LIST = [
  { term: "excellent", re: /\bexcellent\b/i, why: "celebration" },
  { term: "impressive", re: /\bimpressive\b/i, why: "celebration" },
  { term: "quality", re: /\bquality\b/i, why: "verdict-word (already priced)" },
  { term: "well-positioned", re: /\bwell[-\s]positioned\b/i, why: "celebration" },
  { term: "strong", re: /\bstrong(ly|er|est)?\b/i, why: "verdict-word" },
  { term: "healthy", re: /\bhealthy\b/i, why: "verdict-word" },
  { term: "attractive", re: /\battractive\b/i, why: "celebration" },
  { term: "solid", re: /\bsolid\b/i, why: "celebration" },
  { term: "robust", re: /\brobust\b/i, why: "celebration" },
  { term: "compelling", re: /\bcompelling\b/i, why: "celebration" },
  { term: "reassuring", re: /\breassuring\b/i, why: "celebration" },
];

/** Modeled-transaction + reader-judgement constructions forbidden everywhere (§0.8 · Part IX·3/18). The
 *  card may state EXISTING exposure and the object's EXISTING properties; it may never model a trade the
 *  reader has not made, nor judge their selection. */
export const MODELED_TXN_DENY_LIST = [
  { term: "would-take", re: /\bwould (take|be|bring|put|leave)\b/i, why: "models an unmade trade" },
  { term: "if-you-add", re: /\bif you (add|buy|sell|reduce|trim)\b/i, why: "models an unmade trade" },
  { term: "after-adding", re: /\bafter (adding|buying|selling|trimming)\b/i, why: "models an unmade trade" },
  { term: "adding-this", re: /\badding this\b/i, why: "models an unmade trade" },
  { term: "picked-well", re: /\bpicked (well|right|good)\b/i, why: "judges the reader's selection" },
  { term: "better-than-average", re: /\bbetter than average\b/i, why: "reader ranking / selection judgement" },
  { term: "your-approach", re: /\byour approach\b/i, why: "judges the reader's selection" },
  { term: "you-should", re: /\byou should\b/i, why: "advice" },
];

/** Plain-specific drift (§0.11): compression toward plain pulls a comparative into a verdict. Active only
 *  when the resolved register is `plain`, over the assembled output. */
export const PLAIN_DENY_LIST = [
  { term: "everyone-else-worse", re: /\beveryone else is worse\b/i, why: "plain-drift verdict" },
  { term: "so-it's-fine", re: /\bso it['’]?s fine\b/i, why: "plain-drift verdict" },
];

export interface RegisterViolation {
  term: string;
  why: string;
  text: string;
}

/**
 * Scan the ASSEMBLED card copy at a resolved register (forward/advice/modelled-txn, + plain-drift at the
 * plain register). Reuses the lens layer's forward/advice scanner (compute-once for the guard vocabulary
 * too). Returns every violation (empty ⇒ clean).
 *
 * ★ CELEBRATION IS NOT SCANNED HERE — it is a UO6-STRENGTH register rule (§3.1), scoped by `scanStrength`.
 * A word like "healthy"/"strong" is a factual BAND LABEL in UO2 ("Health is about 82 — healthy"), not a
 * verdict; denying it over all output would false-positive on legitimate band copy. Celebration is
 * forbidden only where strength is STATED (UO6), which is exactly what `scanStrength` guards.
 */
export function scanAssembled(strings: string[], level: ToneLevel): RegisterViolation[] {
  const extra = [...PORTFOLIO_ADVICE_DENY_LIST, ...MODELED_TXN_DENY_LIST, ...(level === "plain" ? PLAIN_DENY_LIST : [])];
  const hits = scanStringsForForwardLanguage("relational", strings, extra);
  return hits.map((h) => ({ term: h.term, why: h.why, text: h.text }));
}

/** Scan a STRENGTH claim (UO6 and any future strength entry) for celebration language (§3.1 · Part IX·17).
 *  Applied only where strength is stated — never over band labels or the object's own finding verdicts. */
export function scanStrength(claim: string): RegisterViolation[] {
  return CELEBRATION_DENY_LIST.filter((c) => c.re.test(claim)).map((c) => ({ term: c.term, why: c.why, text: claim }));
}
