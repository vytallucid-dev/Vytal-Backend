// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPENING REGISTRY — one entry per surface. A card sends {surface, subject, label, detail}; the
// SERVER composes the opening ask. This map IS the extension point: a new surface is one entry.
//
// ★ THE GOVERNING RULE (spec): a bare financial ratio gets a GENERIC explanation with no Vytal grounding;
// a Vytal-specific thing gets FULL grounding plus translation. `grounding` encodes which side a surface
// is on — "stock"/"portfolio" load a closed-world fact block; "none" (concept) deliberately loads none.
//
// ★ THE OPENING PERFORMS THE TRANSLATION MOVE, it does not merely request it. Each `buildAsk` contains a
// fully-worked example sentence in the exact target voice — real-world thing first, Vytal term attached
// second — clearly marked as the shape to CONTINUE. It is the few-shot the model imitates against the
// real numbers in the fact block. The example is generic (never asserts a fact about the actual subject),
// so the model cannot parrot it as truth: the specifics come from the facts, the STYLE comes from here.
//
// ★ EVERY SURFACE HAS TWO TEXTS, AND THEY LIVE SIDE BY SIDE ON PURPOSE.
//   buildAsk     → what the MODEL receives. Long, grounded, instruction-shaped. Persisted as message[0]
//                  `content` and replayed into history forever.
//   buildDisplay → what the READER sees themselves say. One sentence, in their voice, persisted as that
//                  same row's `display_content`. The model never sees it.
// They are adjacent because they must agree: the display line is a PROMISE about what the answer will
// cover, and the only thing that can honour it is the ask directly above. So the rule for writing one is
// mechanical — name what buildAsk actually instructs, in plain words, and nothing else. Under-promising
// is fine; naming something the ask never asked for is a lie the reader will notice in the reply.
// (⚠ And it must stay a plausible human message. Not a spec, not a list — one sentence someone would type.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { DiscussContext } from "./discuss-context.js";

export type GroundingKind = "stock" | "portfolio" | "none";

export interface OpeningSpec {
  /** Which closed-world fact block the opening carries. "none" = the concept branch (no grounding). */
  grounding: GroundingKind;
  /** The composed opening ask — the few-shot performance the model continues. MODEL-FACING. */
  buildAsk(ctx: DiscussContext, subjectLabel: string): string;
  /** The one line the reader sees themselves say. READER-FACING — see the header's two-texts rule. */
  buildDisplay(ctx: DiscussContext, subjectLabel: string): string;
  /** The immediate DERIVED title (no model call, no network). */
  deriveTitle(ctx: DiscussContext, subjectLabel: string): string;
}

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────
/** First non-empty string hint from `detail` under any of `keys` (seed material the card passed). */
function hint(ctx: DiscussContext, ...keys: string[]): string | null {
  const d = ctx.detail ?? {};
  for (const k of keys) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const sym = (ctx: DiscussContext): string => ctx.subject.symbol?.toUpperCase() ?? ctx.subject.name ?? "this stock";

/** Possessive of a subject label. ALWAYS "'s", including for tickers ending in S — a ticker is a singular
 *  proper noun, so it takes "TCS's", not the bare plural apostrophe "TCS'". Getting this wrong is small
 *  and very visible: it sits in the first words the reader appears to have said. */
const poss = (s: string): string => `${s}'s`;

/** The human label used for the header, the Layer-3 redirect, and titles. */
export function subjectLabelFor(ctx: DiscussContext, grounding: GroundingKind): string {
  if (grounding === "portfolio") return "your portfolio";
  if (grounding === "none") return ctx.subject.name ?? ctx.label ?? "this idea";
  return sym(ctx);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIVE SURFACES
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const stockHealth: OpeningSpec = {
  grounding: "stock",
  buildAsk: (ctx, s) => {
    const band = hint(ctx, "band");
    const bandClause = band ? ` (currently reading ${band})` : "";
    return [
      `The reader just opened ${s}'s health read${bandClause} and asked you to explain what's behind it. Open the conversation.`,
      `⚠ Do NOT open with the composite score or the band name — your FIRST sentence must be MEANING, not a number. Lead with the real-world thing most driving the read, in plain business terms; the score and the band arrive only AFTER their meaning has landed. GOOD first line: "What holds this business up is the quality of what it owns and how steadily it earns." BAD first line: "Its health score is 66, in the Steady band."`,
      `Keep translating from there — the real-world thing first, the Vytal pillar name attached second. Perform this move; do not describe it. The shape to continue (a STYLE example, not a fact about ${s}):`,
      `  "What's holding a company like this up tends to be the quality of the underlying business — how profitably it turns capital into earnings and how solid its balance sheet is; Vytal groups that into the Foundation pillar. What can pull the other way is the trajectory of those same fundamentals — whether earnings and margins are still growing or have flattened — which is the Momentum pillar."`,
      `Now do it for ${s} using ONLY the numbers in the facts: name the four pillars, say which are strong and which are weak for THIS company, and translate each the same way — the finance reality first, the pillar name second. Where the reader's own relationship facts make it relevant, read the health through their position. Two or three short paragraphs. End with an open invitation to go deeper on any pillar or finding — never a suggestion about what to do.`,
    ].join("\n\n");
  },
  // Promises exactly the two things the ask instructs: the driver of the read, and the pillar split.
  // NOT "where the pillars disagree" — they may not; "strong or weak" is true whichever way it falls.
  buildDisplay: (_ctx, s) => `Explain ${poss(s)} health read — what's driving it, and where the pillars are strong or weak`,
  deriveTitle: (_ctx, s) => `${s} — health read`,
};

const finding: OpeningSpec = {
  grounding: "stock",
  buildAsk: (ctx, s) => {
    const name = hint(ctx, "name", "finding", "label", "title");
    const which = name ? `the "${name}" finding` : "a specific finding";
    return [
      `The reader is looking at ${which} on ${s} and asked you to explain it. Its evidence is already in the [FINDINGS] section of the facts. Open the conversation.`,
      `Explain the REAL phenomenon FIRST — what it actually is and why it matters — before you name Vytal's label for it. Do NOT open with the finding's code, tone word, or severity number; open with the plain-English thing that is happening. Perform the move (a STYLE example):`,
      `  "Share pledging means the people who control the company have posted some of their own shares as collateral for a loan. It matters because if the price falls far enough the lender can sell those shares into the market, which can push the price down further — so it's a fragility in WHO controls the company, not a statement about how the business is doing. Vytal surfaces this as a red flag."`,
      `Then say plainly what this finding does and — just as important — does NOT imply; honour its "doesn't mean" so the reader doesn't over-read it. If it is a red flag, frame it as "worth looking at closely", an invitation to INVESTIGATE — never a signal to trade. End open, inviting a follow-up.`,
    ].join("\n\n");
  },
  // "and what it doesn't" is the ask's "honour its 'doesn't mean'" — the half readers most need and
  // least expect, so it is the half worth naming.
  buildDisplay: (ctx, s) => {
    const name = hint(ctx, "name", "finding", "label", "title");
    const which = name ? `the “${name}” finding` : "this finding";
    return `Explain ${which} on ${s} — what it actually means, and what it doesn't`;
  },
  deriveTitle: (ctx, s) => {
    const name = hint(ctx, "name", "finding", "label", "title");
    return name ? `${name} finding on ${s}` : `Finding on ${s}`;
  },
};

const metricVerdict: OpeningSpec = {
  grounding: "stock",
  buildAsk: (ctx, s) => {
    const metric = hint(ctx, "metric", "name", "label");
    const which = metric ? `the ${metric} metric` : "one metric";
    return [
      `The reader is looking at ${which} on ${s} and its VERDICT — the split between how it reads against the universal bar and against its peers — and asked you to explain it. Open the conversation.`,
      `Explain the bar-vs-peer split in plain terms first. Do NOT open with the metric's raw value or its score — open with the SPLIT and what it means; the numbers come after. Perform the move on whichever way it actually splits in the facts (a STYLE example):`,
      `  "This sits BELOW the level we'd call good in absolute terms, but ABOVE its peer group — so the honest read is about the FIELD, not this company: the whole peer group is soft on this measure right now, and this one is simply the best of a weak field. That's a statement about the pond, not the fish."`,
      `⚠ Never treat "best of a weak field" as a point in the company's favour, and never treat "above the bar but below peers" as a flaw (that's an elite field, and trailing it is context, not weakness). Always split the two verdicts a metric carries — what it says about the COMPANY versus what it says about its FIELD — and read whichever way THESE facts fall. End open.`,
    ].join("\n\n");
  },
  // The two verdicts a metric carries, in the words a reader would use for them — "on its own" is the
  // universal bar, "compares to its peers" is the field. Naming both is the whole point of the surface.
  buildDisplay: (ctx, s) => {
    const metric = hint(ctx, "metric", "name", "label");
    const which = metric ? metric : "this metric";
    return `Explain ${which} on ${s} — whether that's good on its own, and how it compares to its peers`;
  },
  deriveTitle: (ctx, s) => {
    const metric = hint(ctx, "metric", "name", "label");
    return metric ? `${metric} on ${s}` : `Metric read on ${s}`;
  },
};

const portfolioHealth: OpeningSpec = {
  grounding: "portfolio",
  buildAsk: (_ctx, _s) => {
    return [
      `The reader just opened their portfolio's health read and asked you to explain it. The facts carry two co-equal reads plus a coverage figure. Open the conversation.`,
      `Keep the three APART — never average them — and give the plain meaning before the Vytal term. Do NOT open with the health or construction number; open with the DISTINCTION between what they answer, and let the figures arrive after their meaning. Perform the move (a STYLE example):`,
      `  "There are two different questions here, and they don't answer each other. One is how good the companies you own are — that's the Health read, weighted so bigger positions count more. The other is the SHAPE of the book — how concentrated or spread it is across names, sectors and fund houses — that's the Construction read. A book of excellent companies can still be fragile in construction, and a safely-built book can hold only ordinary ones, so I'll tell you which is which. Coverage is the third thing: how much of the book, by value, Vytal has actually scored."`,
      `Now read THIS book's real Health, Construction and Coverage from the facts, each translated the same way. If coverage is limited the health read is Provisional — say what that does and doesn't mean (it limits Vytal's claim, not the book). End with an open invitation to go deeper — never a suggestion about what to change.`,
    ].join("\n\n");
  },
  // The three things the facts actually carry, in order, in plain words: Health, Construction, Coverage.
  // Coverage is named because a Provisional read is the reader's to know about, not a footnote.
  buildDisplay: () =>
    `Explain my portfolio's health read — how good the companies I own are, how the book is built, and how much of it Vytal has scored`,
  deriveTitle: () => `Portfolio health`,
};

// ★ THE BRANCH THAT PROVES THE RULE. No fact block, no closed-world header, no company specifics.
const concept: OpeningSpec = {
  grounding: "none",
  buildAsk: (_ctx, s) => {
    return [
      `The reader asked you to explain a general finance concept: "${s}". There is NO Vytal data in play here — this is a plain, generic explanation of the idea ITSELF.`,
      `Teach it the way you'd teach a smart friend: the intuition, a concrete everyday example, and where it matters. Do NOT attach it to any specific company, portfolio, or Vytal score — you have no facts about any, and inventing them would be a fabrication. Do NOT use closed-world "only these facts" framing; there are no facts to be closed over.`,
      `Explain the concept clearly, then end with an open invitation to ask how Vytal looks at it, if they'd like.`,
    ].join("\n\n");
  },
  // ⚠ DELIBERATELY PROMISES NOTHING ABOUT THE READER'S HOLDINGS. This branch loads no fact block at all,
  // so a line hinting at "…for the stocks I own" would be an over-promise the ask cannot honour.
  buildDisplay: (_ctx, s) => `Explain ${s} — what it actually means, and where it matters`,
  deriveTitle: (_ctx, s) => {
    const t = s.length > 48 ? s.slice(0, 47).trimEnd() + "…" : s;
    return t.charAt(0).toUpperCase() + t.slice(1);
  },
};

// ── The registry + resolution ────────────────────────────────────────────────────────────────────
const REGISTRY: Record<string, OpeningSpec> = {
  stock_health: stockHealth,
  finding,
  metric_verdict: metricVerdict,
  portfolio_health: portfolioHealth,
  concept,
};

export interface ResolvedOpening {
  /** The resolved surface key (may differ from ctx.surface when a fallback fired). */
  surfaceKey: string;
  spec: OpeningSpec;
  subjectLabel: string;
  fellBack: boolean;
}

/**
 * Resolve the opening spec for an incoming context. A known surface wins. An UNKNOWN surface (a card
 * shipped ahead of the backend) falls back BY SUBJECT KIND rather than hard-failing the conversation:
 * stock/finding/comparison → stock_health, portfolio → portfolio_health, else → concept. The fallback is
 * logged so the gap is visible, never silent.
 */
export function resolveOpening(ctx: DiscussContext): ResolvedOpening {
  const direct = REGISTRY[ctx.surface];
  if (direct) {
    return { surfaceKey: ctx.surface, spec: direct, subjectLabel: subjectLabelFor(ctx, direct.grounding), fellBack: false };
  }
  const kind = ctx.subject.kind;
  const fallbackKey = kind === "portfolio" ? "portfolio_health" : kind === "stock" || kind === "finding" || kind === "comparison" ? "stock_health" : "concept";
  const spec = REGISTRY[fallbackKey];
  console.warn(`[chat/openings] unknown surface "${ctx.surface}" — falling back to "${fallbackKey}" by subject kind "${kind}"`);
  return { surfaceKey: fallbackKey, spec, subjectLabel: subjectLabelFor(ctx, spec.grounding), fellBack: true };
}

/** The set of known surface keys — for docs / the proof harness. */
export const KNOWN_SURFACES = Object.keys(REGISTRY);
