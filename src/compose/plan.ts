// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PLAN — what the model returns, and the menu it must choose from.
//
// ★ THE MODEL PICKS FROM A TYPED MENU, IT DOES NOT INVENT. Every entry below names a renderer that
//   exists and the manifest flag that must be true for it to be plannable. A plan referencing a
//   renderer we do not have, or a block whose data the manifest says is absent, is REJECTED before
//   anything runs — §5.1's compile-time guarantees become admission-time ones, and a broken plan
//   still cannot reach a reader.
//
// ★ PROSE IS AN INTENT, NOT A SENTENCE WITH FIGURES IN IT. `lead` and `close` are written by the
//   model, and they are the one place its own words ship — over a digest it will be handed, never
//   over values it invented. The executor asserts afterwards that no digit the resolvers did not
//   produce appears in them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { scanExplanationText } from "../ai/core/guardrail.js";
import type { CapabilityManifest } from "./manifest.js";

export type BlockId =
  | "business"        // ANCHOR · hero-fundamental — what the company is, latest quarter headline
  | "metrics"         // SERIES · statement-trend — the figures, QoQ and YoY
  | "shareholding"    // DECOMPOSITION · ownership-split — the register as filed
  | "score"           // DECOMPOSITION · waterfall — the four-pillar breakdown
  | "pillar"          // DECOMPOSITION · pillar-bars — ONE pillar's own metrics, explained
  | "findings"        // CALLOUT — what code flagged, or that it flagged nothing
  // ── ★ THE SEVEN STAGE-7 BLOCKS. Each closes a row of the 33-capability map. ────────────────────
  | "price"            // SERIES · composite-spine — the price line against its benchmark
  | "quarterSeries"    // SERIES · stepped-filing-line — the last N quarters, as filed
  | "events"           // RAIL · event-rail — dividends, results dates, splits, board meetings
  | "ownershipEvents"  // RAIL · filing-rail — insider disclosures and block/bulk deals
  | "ownershipSeries"  // RELATIVE · own-history-band — the register against its own history
  | "peers"            // RELATIVE · peer-marker — this stock against its peer group and index
  | "news"             // RAIL · news-list — stored headlines, other people's words
  ;

export interface BlockSpec {
  readonly id: BlockId;
  /** Model-authored. One sentence, said before the block, explaining what it shows and why here. */
  readonly lead: string;
  /** ★ Model-authored. Said AFTER the block: what it showed and what follows from it (§4.3 amended,
   *  stage 9). Optional — omitted where the component needs no epilogue. No figures, as ever. */
  readonly after?: string;
  /** Only meaningful for `pillar` — which one to open up. */
  readonly pillar?: "foundation" | "momentum" | "market" | "ownership";
}

export interface Plan {
  /** 1–3 sentences. Model-authored, over the manifest — no figures. */
  readonly opening: readonly string[];
  readonly blocks: readonly BlockSpec[];
  /** The synthesis. Model-authored. */
  readonly close: string;
  /** Follow-ups the model chose, each naming a Vytal surface. */
  readonly followUps: readonly { readonly question: string; readonly surface: string }[];
  /** Why it planned this way — logged, never rendered. Makes a bad plan diagnosable. */
  readonly rationale: string;
}

/** ★ THE MENU. `requires` is checked against the manifest at admission. */
export const BLOCK_MENU: Readonly<Record<BlockId, { what: string; requires: (m: CapabilityManifest) => boolean }>> = {
  business: {
    what: "What the company is and the headline figures from the quarter it just reported.",
    requires: (m) => m.has.latestQuarter || m.has.businessProfile,
  },
  metrics: {
    what: "A table of revenue, profit and margin, each against the previous quarter and the year-ago quarter, plus the full year against the prior year.",
    requires: (m) => m.has.quarterHistory || m.has.annualAccounts,
  },
  shareholding: {
    // ⚠ "and pledging" WAS HERE AND IS GONE. The menu is what the planner is told a block can do, so
    //   a menu naming a capability we decline to exercise is the model being invited to plan an
    //   answer to a pledge question and then handed a register instead. See resolve/pledge.ts: no
    //   pledge magnitude is defensible from this data, so no block may advertise one.
    what: "The shareholding register as filed — promoter, FII, DII, retail — with the change on the previous filing. It does not carry a pledge figure; pledging is stated in words or declined.",
    requires: (m) => m.has.shareholding,
  },
  score: {
    what: "The health score broken into its four pillars, showing which part carries it.",
    requires: (m) => m.has.pillarBreakdown,
  },
  pillar: {
    what: "ONE pillar of the health score opened up: its own reading, what it contributed, and what it is built from. Use when the question is about that pillar's subject.",
    requires: (m) => m.has.pillarBreakdown,
  },
  findings: {
    what: "What code flagged on this company — or, when nothing fired, that the checks ran and came back clear.",
    requires: () => true,
  },
  price: {
    what: "The share price over time against its benchmark index, with the 52-week range and the trailing returns.",
    requires: (m) => m.has.priceSeries,
  },
  quarterSeries: {
    what: "The last several quarters as a trend — revenue, operating profit, net profit and margin, one row per quarter as filed. Use when the reader asks about a RUN of quarters rather than the latest one.",
    requires: (m) => m.has.quarterSeries,
  },
  events: {
    what: "Scheduled and past corporate events — dividends with their ex-dates, results dates, bonus issues, splits, board meetings.",
    requires: (m) => m.has.corporateEvents,
  },
  ownershipEvents: {
    what: "Insider transactions disclosed under SEBI rules, and block or bulk deals reported to the exchange. Use for who has been BUYING OR SELLING, which is a different question from who owns it.",
    requires: (m) => m.has.ownershipEvents,
  },
  ownershipSeries: {
    what: "How the shareholding register has moved across the last several filings — promoter, foreign and domestic institutions, retail.",
    requires: (m) => m.has.ownershipSeries,
  },
  peers: {
    what: "This stock against its peer group and its sector index over the same window — who it is judged against, and how many.",
    requires: (m) => m.has.peerGroup,
  },
  news: {
    what: "Headlines we hold about this company. These are other people's words, not our reading.",
    requires: (m) => m.has.news,
  },
};

export interface PlanRejection { readonly ok: false; readonly why: string }
export interface PlanAccepted { readonly ok: true; readonly plan: Plan }

/**
 * Admission. A plan that fails here never runs — the deterministic planner takes over.
 *
 * ⚠ THE CHECKS ARE ABOUT SAFETY, NOT TASTE. A dull plan is allowed; a plan that would render a block
 * over data we do not hold, or name a renderer we do not have, is not.
 */
/** Any digit that is not part of a period key (FY27Q1) or an ordinal. The model must not write a
 *  figure — code owns every one — and this is the check that makes N-1 true of MODEL PROSE, which is
 *  new surface as of §5.3: before the planner, the model's words never carried a claim about a value. */
const FIGURE = /\d+(?:[.,]\d+)?\s*(?:%|pp|cr|crore|lakh|x|×|bn|billion|million)?/i;
const ALLOWED = /^(?:FY\d{2}(?:Q[1-4])?|Q[1-4]|H[12])$/i;

/**
 * ★ EXPORTED FOR THE META SURFACE (§7.1), CONSUMED NOT REBUILT (N-5).
 *
 * ⚠ META NOW LETS THE MODEL EXPLAIN A CONCEPT, which is the second surface where model words reach a
 *   reader beside real figures. This is the check that makes N-1 true of model prose, and a second
 *   copy of it — subtly different, drifting quietly — is exactly the failure it exists to prevent.
 *   One home, two callers: `admitPlan` below and `families/meta.ts`.
 */
export function prosePasses(text: string): string | null {
  // ★ THE GUARDRAIL IS THE EXISTING ONE (ai/guardrail.ts), CONSUMED NOT REBUILT (N-5). It is the same
  //   scanner the Quarter Brief and the old chat ran, and it already encodes the register the product
  //   is allowed to speak in — forward-looking claims, advice, and evaluative words it must not use.
  const verdict = scanExplanationText(text);
  if (verdict.hardHits.length) return `guardrail hard hit: ${verdict.hardHits.map((h) => h.term).join(", ")}`;
  for (const tok of text.split(/\s+/)) {
    const bare = tok.replace(/[(),.;:"'—–]/g, "");
    if (!bare || ALLOWED.test(bare)) continue;
    if (FIGURE.test(bare) && /\d/.test(bare)) return `model prose contains a figure ("${bare}") — code owns every number (N-1)`;
  }
  return null;
}

export function admitPlan(raw: unknown, m: CapabilityManifest): PlanAccepted | PlanRejection {
  const p = raw as Partial<Plan> | null;
  if (!p || typeof p !== "object") return { ok: false, why: "not an object" };
  if (!Array.isArray(p.blocks)) return { ok: false, why: "blocks is not a list" };
  // ⚠ AN EMPTY BLOCK LIST IS VALID WHEN THERE IS GENUINELY NOTHING TO DRAW. A tier-0 company has no
  //   quarter, no register and no score; a planner that returns no blocks for it is RIGHT, and
  //   rejecting that as malformed forced the deterministic plan to answer a question the model had
  //   already answered correctly. Only reject emptiness when the manifest says something was showable.
  const showable = Object.values(BLOCK_MENU).some((e) => e.requires(m));
  if (p.blocks.length === 0 && showable && m.tier > 0) return { ok: false, why: "no blocks planned but data was available" };

  const seen = new Set<string>();
  for (const b of p.blocks) {
    if (!b || typeof b !== "object") return { ok: false, why: "malformed block" };
    const entry = BLOCK_MENU[b.id as BlockId];
    if (!entry) return { ok: false, why: `unknown block "${String(b.id)}" — not on the menu` };
    if (!entry.requires(m)) return { ok: false, why: `block "${b.id}" planned but the manifest says its data is absent` };
    if (typeof b.lead !== "string" || b.lead.trim().length === 0) return { ok: false, why: `block "${b.id}" has no lead sentence` };
    const key = b.id === "pillar" ? `pillar:${b.pillar}` : b.id;
    if (seen.has(key)) return { ok: false, why: `block "${key}" planned twice` };
    seen.add(key);
  }
  if (typeof p.close !== "string" || p.close.trim().length === 0) return { ok: false, why: "no closing synthesis" };
  if (!Array.isArray(p.opening)) return { ok: false, why: "opening is not a list" };

  // ★ EVERY SENTENCE THE MODEL WROTE IS SCANNED BEFORE ANY OF IT SHIPS. A plan whose prose breaks the
  //   register or invents a figure is rejected WHOLE — not sanitised — because a plan that had to be
  //   edited to be safe is a plan whose judgement was wrong, and the deterministic one is better.
  for (const [where, text] of [
    ["close", p.close] as const,
    ...p.opening.map((o, i) => [`opening[${i}]`, String(o)] as const),
    ...p.blocks.map((b) => [`lead(${String(b.id)})`, String(b.lead)] as const),
    // ★ THE `after` PROSE IS SCANNED TOO, AND OMITTING IT WOULD HAVE BEEN A HOLE STRAIGHT THROUGH
    //   N-1. It is new model-authored text (§4.3 as amended, stage 9) that ships to a reader beside
    //   real figures — the single easiest place for an invented number to land, because it is written
    //   ABOUT the block it follows. Every model-written sentence goes through `prosePasses` or none
    //   of the guarantee means anything.
    ...p.blocks
      .filter((b) => typeof b.after === "string" && b.after.trim().length > 0)
      .map((b) => [`after(${String(b.id)})`, String(b.after)] as const),
  ]) {
    const bad = prosePasses(text);
    if (bad) return { ok: false, why: `${where}: ${bad}` };
  }

  return {
    ok: true,
    plan: {
      opening: p.opening.filter((x): x is string => typeof x === "string").slice(0, 3),
      blocks: p.blocks as BlockSpec[],
      close: p.close,
      followUps: (Array.isArray(p.followUps) ? p.followUps : []).filter(
        (f): f is { question: string; surface: string } =>
          !!f && typeof f.question === "string" && typeof f.surface === "string",
      ).slice(0, 6),
      rationale: typeof p.rationale === "string" ? p.rationale : "",
    },
  };
}
