// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AI OUTPUT GUARDRAIL (Layer 1) — the structural backstop behind the non-advisory spine.
//
// tone.ts INSTRUCTS the model not to advise. This CATCHES it when the model does anyway — which is not
// a hypothetical: we run on Flash-Lite, the weaker instruction-follower, precisely because its RPD is
// what makes the feature affordable. An instruction is a request; this is a gate.
//
// PURE + DETERMINISTIC + FREE. No AI call, no DB, no I/O, no network. It costs nothing to run, which is
// the whole reason it can run on EVERY generated explanation. (The regeneration, the deterministic
// fallback and the offline AI judge are Layers 2–4 and live with the generation flow, not here.)
//
// ── ⚠ WHY THIS IS NOT A FLAT REUSE OF `no-forward-guard.ts`'s LISTS ───────────────────────────────
//
// That guard exists and works, and this file REUSES ITS SCANNING MECHANISM rather than reimplementing
// it (`scanStringsForForwardLanguage`). But its VOCABULARIES were calibrated against 31 hand-written
// catalog strings, where a human wrote each sentence once and the guard is recurrence protection — its
// own header says it "passes trivially today". Free-form model prose is a completely different
// distribution, and a flat reuse fails in BOTH directions:
//
//   · FALSE POSITIVES, at a rate that would kill the feature. `\bwill\b`, `\bshould\b`, `\bexpect\b`,
//     `\breduce\b`, `\bincrease\b` are unavoidable in ordinary descriptive finance prose — "results
//     WILL be reported in October", "margins REDUCED 200bps", "promoter pledging INCREASED to 12%".
//     Blocking those blocks the truth.
//   · FALSE NEGATIVES, on the constructions that matter most. Hedged advice uses none of the banned
//     verbs: "it might be worth…", "the obvious next step is to…", "many investors would…". The
//     existing lists catch not one of them.
//
// So the vocabulary is TIERED and AI-surface-specific, on ONE organizing principle:
//
//   ★ HARD = THE MODEL SPEAKING IN ITS OWN VOICE AS AN ADVISER.  → block
//   ★ SOFT = WORDS THAT LEGITIMATELY APPEAR WHILE DESCRIBING THE WORLD.  → log, NEVER block
//
// That principle is what makes the split decidable instead of a vibes-based word list, and it settles
// the genuinely hard cases by itself:
//   "the brokerage recommends a target of ₹4,000"  → describing someone else's advice   → SOFT
//   "my recommendation is to hold"                 → the model advising                 → HARD
//   "the company will buy back shares"             → description                        → SOFT
//   "worth buying at these levels"                 → advice                             → HARD
//
// ── THE ASYMMETRY THAT SETS THE TUNING (deliberate, ruled) ────────────────────────────────────────
// When in doubt, PASS. A false block hits every user who asks and replaces a true explanation with
// nothing; a miss is caught by the offline judge over a cache of a few hundred rows. The costs are not
// symmetric, so neither is the tuning. This list is deliberately NOT exhaustive — chasing every
// possible phrasing is how a guard starts blocking innocent description, and a guard that cries wolf
// is one people route around. A known gap that a later layer covers beats a guard nobody trusts.
//
// ── SCOPE, NOT AN ALLOWLIST (inherited doctrine — no-forward-guard.ts §"SCOPE, NOT AN ALLOWLIST") ──
// ⚠ Hand this ONLY text that ASSERTS. A negation ("this does NOT mean you should sell") contains every
// forbidden construction by design and would trip the gate — correctly, which is why it must never be
// scanned rather than allow-listed around. Today an explanation is a single assertive body, so the
// doctrine is satisfied trivially. THE DAY a "what this doesn't mean" section is added to the output,
// it must be excluded here, exactly as `doesntMean` is excluded from the portfolio copy scan.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  FORWARD_DENY_LIST,
  scanStringsForForwardLanguage,
} from "../scoring/lens-patterns/no-forward-guard.js";

/** A vocabulary entry — the same shape `scanStringsForForwardLanguage` takes as `extraTerms`. */
interface Term {
  term: string;
  re: RegExp;
  why: string;
}

// ── HARD — the model advising in its own voice. A match BLOCKS. ──────────────────────────────────
//
// Two families. The first is blatant; the second is the one that actually earns this file's existence,
// because the spine instruction is most often defeated by advice that never uses an advice verb.
//
// ⚠ EVERY `term` NAME HERE MUST BE DISTINCT FROM `FORWARD_DENY_LIST`'s NAMES — the scanner merges that
// list into every call unconditionally, and tier assignment is BY NAME (see scanExplanationText).
// A collision would silently promote a shared soft term to a blocker. Asserted at module load below.
export const AI_HARD_LIST: Term[] = [
  // ── Family 1: blatant — an instruction addressed to the reader, or the model's own recommendation ──
  {
    term: "addressed-should",
    re: /\b(you|investors?|shareholders?|one)\s+(should|must|ought\s+to|needs?\s+to)\b/i,
    why: "instruction addressed to the reader",
  },
  {
    term: "i-recommend",
    re: /\bi\s+(recommend|suggest|advise)\b/i,
    why: "the model recommending in its own voice",
  },
  {
    term: "we-recommend",
    re: /\bwe\s+(recommend|suggest|advise)\b/i,
    why: "Vytal recommending in its own voice",
  },
  {
    term: "my-recommendation",
    re: /\b(my|our)\s+(recommendation|advice|suggestion)\b/i,
    why: "the model's own advice, by name",
  },
  {
    term: "would-advise",
    re: /\bwould\s+(advise|recommend|suggest)\b/i,
    why: "advice in the conditional",
  },
  {
    term: "consider-action",
    re: /\bconsider(ing)?\s+(trimming|selling|buying|reducing|exiting|adding|switching|rebalancing|diversifying)\b/i,
    why: "advice — the politest instruction is still one",
  },
  {
    term: "trade-this",
    re: /\b(buy|sell|dump|offload)\s+(this|the|your)\s+(stock|share|position|holding)\b/i,
    why: "a trade instruction on a specific holding",
  },
  {
    term: "trade-now",
    re: /\b(buy|sell)\s+(it\s+)?now\b/i,
    why: "a timed trade instruction",
  },
  {
    term: "worth-trading",
    re: /\bworth\s+(buying|selling|adding|trimming)\b/i,
    why: "advice ('worth buying at these levels')",
  },
  {
    term: "time-to-trade",
    re: /\btime\s+to\s+(buy|sell|exit|enter)\b/i,
    why: "market timing advice",
  },
  {
    term: "recommended-action",
    re: /\brecommended\s+(action|move|step)\b/i,
    why: "advice, by name",
  },

  // ── Family 2: HEDGED — advice wearing none of the banned verbs. The reason this file exists. ──
  {
    term: "might-be-worth",
    re: /\bit\s+(might|may|could)\s+be\s+worth\b/i,
    why: "hedged advice ('it might be worth trimming')",
  },
  {
    term: "next-step-to",
    re: /\bnext\s+step\s+(is|would\s+be)\s+to\b/i,
    why: "hedged advice ('the obvious next step is to exit')",
  },
  {
    term: "you-may-want",
    re: /\byou\s+(may|might|could)\s+want\s+to\b/i,
    why: "hedged instruction",
  },
  {
    term: "youll-want",
    re: /\byou['’]ll\s+want\s+to\b/i,
    why: "instruction in the future tense",
  },
  {
    term: "would-be-prudent",
    re: /\bit\s+would\s+be\s+(prudent|wise|sensible|advisable)\b/i,
    why: "hedged advice",
  },
  {
    term: "worth-watching",
    re: /\bworth\s+(keeping|watching|monitoring)\b/i,
    why: "hedged advice ('worth keeping an eye on')",
  },
  { term: "keep-an-eye", re: /\bkeep\s+an\s+eye\s+on\b/i, why: "advice idiom" },
  {
    term: "something-to",
    re: /\bsomething\s+to\s+(watch|consider|think\s+about|keep\s+in\s+mind)\b/i,
    why: "hedged advice",
  },
  {
    term: "closer-look",
    re: /\b(takes?|taking|warrants?|deserves?)\s+a\s+closer\s+look\b/i,
    why: "hedged advice",
  },
  {
    term: "if-youre-looking",
    re: /\bif\s+you(['’]re|\s+are)\s+(looking|planning|thinking)\s+to\b/i,
    why: "conditional advice",
  },
  {
    term: "be-cautious",
    re: /\bbe\s+(cautious|careful|wary)\b/i,
    why: "instruction framed as caution",
  },
  {
    term: "makes-sense-to",
    re: /\bmakes?\s+sense\s+to\b/i,
    why: "hedged advice",
  },
  {
    term: "takeaway-is-to",
    re: /\btakeaway\s+(here\s+)?is\s+to\b/i,
    why: "advice as conclusion",
  },
  {
    term: "before-you-trade",
    re: /\bbefore\s+you\s+(buy|invest|add|sell)\b/i,
    why: "advice presuming a trade",
  },
  /**
   * ⚠ ON PROBATION (operator ruling) — social-proof framing is one of the most common ways advice gets
   * past a spine instruction ("many investors would trim here"), so it earns a HARD slot. But it sits
   * one word away from legitimate DESCRIPTION of shareholder behaviour ("many investors hold this for
   * the dividend"), which must pass.
   *
   * The separation is the modal: this fires on would/will/might/tend-to/often — the SPECULATIVE
   * framings — and NOT on a plain present-tense verb, which is what description uses. Both cases are
   * pinned in verify-ai-guardrail.ts; if the innocent one ever trips, this entry is demoted to SOFT.
   */
  {
    term: "many-investors-would",
    re: /\b(many|most|some)\s+(investors?|holders?|people)\s+(would|will|might|tend\s+to|often)\b/i,
    why: "advice via social proof ('many investors would trim here')",
  },
];

// ── SOFT — legitimate in description. NEVER blocks; logged so the corpus can inform promotions. ──
//
// ★ `FORWARD_DENY_LIST` IS REUSED WHOLESALE AS THE SPINE OF THIS TIER, and that is the honest use of
// it: `will` / `likely` / `expect` / `forecast` / bare `buy` / bare `sell` are exactly the words that
// are innocent in one sentence and damning in the aggregate. They are the right thing to WATCH and the
// wrong thing to BLOCK. Derived from the import, not copied, so the tier tracks that list if it grows.
//
// Below are the AI-specific additions — bare modals a describing sentence needs, plus third-party
// `recommend` (reporting an analyst's call is description; making one is HARD's job).
const AI_SOFT_EXTRA: Term[] = [
  {
    term: "should-bare",
    re: /\bshould(n['’]?t)?\b/i,
    why: "modal — innocent in description ('pledging should be read alongside…')",
  },
  { term: "may-bare", re: /\bmay\b/i, why: "modal" },
  { term: "might-bare", re: /\bmight\b/i, why: "modal" },
  { term: "could-bare", re: /\bcould\b/i, why: "modal" },
  { term: "potentially", re: /\bpotential(ly)?\b/i, why: "hedge" },
  {
    term: "consider-bare",
    re: /\bconsider(s|ed|ing)?\b/i,
    why: "innocent alone ('the board will consider a dividend')",
  },
  {
    term: "recommend-bare",
    re: /\brecommend(s|ed|ation|ations|ing)?\b/i,
    why: "third-party recommendation is description, not advice",
  },
];

/** Tier membership is BY TERM NAME, because the scanner always merges FORWARD_DENY_LIST in. */
const HARD_TERMS = new Set(AI_HARD_LIST.map((t) => t.term));
const SOFT_TERMS = new Set(
  [...FORWARD_DENY_LIST, ...AI_SOFT_EXTRA].map((t) => t.term),
);

// FAIL AT MODULE LOAD, not in production: a HARD name colliding with a shared-list name would make a
// soft term block. Cheap, and the failure mode it prevents is invisible.
for (const t of AI_HARD_LIST) {
  if (SOFT_TERMS.has(t.term)) {
    throw new Error(
      `ai/guardrail: HARD term "${t.term}" collides with a SOFT/shared term name. Tier assignment is ` +
        `by name — rename the HARD entry, or a soft word will start blocking output.`,
    );
  }
}

export interface HardHit {
  term: string;
  match: string; // the matched substring — the scanner's ForwardViolation carries only the whole text
  why: string;
}
export interface SoftHit {
  term: string;
  match: string;
  context: string; // ± a window around the match — this is the corpus for future HARD promotions
}
export interface GuardrailVerdict {
  clean: boolean; // false ⇔ at least one HARD hit. SOFT hits NEVER make it false.
  hardHits: HardHit[];
  softHits: SoftHit[];
}

/** The matched substring. `ForwardViolation` carries the whole scanned string, not the match, so the
 *  hit regex is re-run to recover it. Safe: no entry carries /g, so exec is stateless. */
const matchOf = (re: RegExp, text: string): string => re.exec(text)?.[0] ?? "";

/** A readable window around the match, for the soft log. */
function contextOf(text: string, match: string, radius = 40): string {
  if (!match) return text.slice(0, radius * 2);
  const i = text.indexOf(match);
  if (i < 0) return text.slice(0, radius * 2);
  const from = Math.max(0, i - radius);
  const to = Math.min(text.length, i + match.length + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/** Scan `text` against one tier, keeping only that tier's own terms. The scanner merges
 *  FORWARD_DENY_LIST into EVERY call, so the name filter is what makes tiering possible at all:
 *  the HARD pass discards those shared hits, the SOFT pass keeps them (they ARE its vocabulary). */
function scanTier(
  text: string,
  extra: Term[],
  keep: Set<string>,
): { term: string; why: string; re: RegExp }[] {
  const byTerm = new Map<string, Term>(
    [...FORWARD_DENY_LIST, ...extra].map((t) => [t.term, t]),
  );
  return scanStringsForForwardLanguage("ai-explanation", [text], extra)
    .filter((v) => keep.has(v.term))
    .map((v) => {
      const t = byTerm.get(v.term)!;
      return { term: v.term, why: v.why, re: t.re };
    });
}

/**
 * LAYER 1 — scan one generated explanation body. Pure, deterministic, free.
 *
 * `clean: false` means a HARD hit: the caller must NOT serve this text (Layer 2 regenerates once,
 * Layer 3 falls back to the deterministic diagnosis). SOFT hits are informational ONLY and never
 * affect `clean` — they exist so the logs become the evidence for promoting a term later, rather
 * than the vocabulary growing on hunches.
 *
 * ⚠ Pass the ASSERTIVE body only — see the header's scope note. Empty/blank input is trivially clean.
 */
export function scanExplanationText(text: string): GuardrailVerdict {
  if (!text || !text.trim()) return { clean: true, hardHits: [], softHits: [] };

  const hardHits: HardHit[] = scanTier(text, AI_HARD_LIST, HARD_TERMS).map(
    (h) => ({
      term: h.term,
      match: matchOf(h.re, text),
      why: h.why,
    }),
  );

  const softHits: SoftHit[] = scanTier(text, AI_SOFT_EXTRA, SOFT_TERMS).map(
    (h) => {
      const match = matchOf(h.re, text);
      return { term: h.term, match, context: contextOf(text, match) };
    },
  );

  return { clean: hardHits.length === 0, hardHits, softHits };
}
