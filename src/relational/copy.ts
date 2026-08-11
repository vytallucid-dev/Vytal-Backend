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

// ── Band display labels (§0.9 — never render a raw enum) ─────────────────────────────────────────────
/** The five LabelBand tokens → their display form. The backend ships the LABEL; the frontend never maps
 *  an enum. `below_par` rendering as "below_par" on a live card was the defect this closes. An unknown
 *  token degrades to a de-underscored form rather than leaking the raw token shape. */
const BAND_LABELS: Record<string, string> = {
  fragile: "fragile",
  below_par: "below par",
  steady: "steady",
  healthy: "healthy",
  pristine: "pristine",
};
export const bandLabel = (band: string): string => BAND_LABELS[band.toLowerCase()] ?? band.replace(/_/g, " ");

// ── Dates (§0.11 — durations round to the underlying cadence; a membership date is month-grain) ──────
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "March 2026" — the month-grain label for a watchlist add / a dated membership fact. Month grain is
 *  deliberate: a precise day implies a precision the fact does not carry, and it churns the copy daily. */
export const monthYear = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

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

/**
 * THIRD-PERSON DESCRIPTIVE SCOPE — ruled over-broad against two different kinds of description that
 * share the same shape: neither is instruction or prediction, and the shared vocabularies' bare verbs
 * false-positive on both.
 *
 *   · UO1's business lead ("selling electricity", "diversified conglomerate") — what a company DOES.
 *   · UO6's finding claim — the rule's OWN authored verdict, third-person, past-tense, about what the
 *     COMPANY (or its owners) did: "FII trimmed", "promoters have increased their holding". §Phase-UO6
 *     — caught live, wiring UO6 to the filing channel: `ownership_P1_clean_rotation`'s verdict says FII
 *     "trimmed" its stake, PORTFOLIO_ADVICE_DENY_LIST denies bare "trim" ('consider trimming'), and the
 *     two collided on Yes Bank the first time a filing-only stock reached UO6. That list's own header
 *     already predicts this failure mode for a different verb ("'reduced margins' is DESCRIPTIVE… judging
 *     LM/LP strings by portfolio verbs would manufacture reds") — UO6 is the same shape of false positive,
 *     a different surface. `ownership_N6_promoter_accumulation`'s "increased" is the same collision
 *     waiting on the next stock where N6 fires; not hypothetical, just not yet observed live.
 *
 * Both get this SAME narrow list instead of the full guard — second-person instruction and explicit
 * recommendation constructions only. Not an exemption: "an attractive entry point at these levels" or
 * "consider buying" must still be caught, so the list still carries the advice-signaling words, just not
 * the bare third-person verbs (buy/sell/trim/reduce/increase/exit/…) that are how ordinary ownership-flow
 * and business-description language is written.
 */
export const BUSINESS_LEAD_DENY_LIST = [
  { term: "you-should", re: /\byou should\b/i, why: "advice" },
  { term: "worth-buying", re: /\bworth buying\b/i, why: "advice" },
  { term: "attractive", re: /\battractive\b/i, why: "advice ('an attractive entry point')" },
  { term: "undervalued", re: /\bundervalued\b/i, why: "advice / verdict" },
  { term: "overvalued", re: /\bovervalued\b/i, why: "advice / verdict" },
  { term: "recommend", re: /\brecommend(s|ed|ation|ations|ing)?\b/i, why: "advice, by name" },
  { term: "target-price", re: /\btarget price\b/i, why: "advice" },
  { term: "time-to-buy", re: /\btime to buy\b/i, why: "advice" },
  { term: "time-to-sell", re: /\btime to sell\b/i, why: "advice" },
  { term: "consider-buying", re: /\bconsider buying\b/i, why: "advice" },
  { term: "consider-selling", re: /\bconsider selling\b/i, why: "advice" },
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
 * A word like "healthy"/"strong" is a factual BAND LABEL wherever a snapshot's band renders (e.g. a UD7
 * header stating the current band, or the page's own health section) — not a verdict; denying it over
 * all output would false-positive on legitimate band copy. Celebration is forbidden only where strength
 * is STATED (UO6), which is exactly what `scanStrength` guards. (UO2, the entry this note originally
 * cited, is deleted — the band label it used to render now lives only in the page's own health section.)
 *
 * ★ `businessLeadStrings` (UO1) AND `uo6Strings` (UO6) ARE SCANNED SEPARATELY, against
 * BUSINESS_LEAD_DENY_LIST instead of the full guard — ruled: third-person description ("selling
 * electricity", "diversified conglomerate"; "FII trimmed", "promoters have increased their holding") is
 * not instruction or prediction, and PORTFOLIO_ADVICE_DENY_LIST's bare verbs (trim/reduce/increase/exit/…)
 * false-positive on it exactly as FORWARD_DENY_LIST's bare buy/sell false-positive on UO1's. `strings`
 * (everything else — findings, entries, boundary lines) keeps the full list: that copy is Vytal's own
 * voice making claims about a stock, which is exactly where advice drift happens.
 */
export function scanAssembled(strings: string[], level: ToneLevel, businessLeadStrings: string[] = [], uo6Strings: string[] = []): RegisterViolation[] {
  const extra = [...PORTFOLIO_ADVICE_DENY_LIST, ...MODELED_TXN_DENY_LIST, ...(level === "plain" ? PLAIN_DENY_LIST : [])];
  const hits = scanStringsForForwardLanguage("relational", strings, extra);
  const narrowScan = (s: string) => BUSINESS_LEAD_DENY_LIST.filter((d) => d.re.test(s)).map((d) => ({ term: d.term, why: d.why, text: s }));
  const leadHits = businessLeadStrings.flatMap(narrowScan);
  const uo6Hits = uo6Strings.flatMap(narrowScan);
  return [...hits.map((h) => ({ term: h.term, why: h.why, text: h.text })), ...leadHits, ...uo6Hits];
}

/** Scan a STRENGTH claim (UO6 and any future strength entry) for celebration language (§3.1 · Part IX·17).
 *  Applied only where strength is stated — never over band labels or the object's own finding verdicts. */
export function scanStrength(claim: string): RegisterViolation[] {
  return CELEBRATION_DENY_LIST.filter((c) => c.re.test(claim)).map((c) => ({ term: c.term, why: c.why, text: claim }));
}
