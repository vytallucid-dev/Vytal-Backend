// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 4 of 4 — GUARDRAIL SIGNATURES. The eleven detectors that decide whether a reported number
// is describing the BUSINESS or describing an EVENT that happened to the accounts.
//
// ── ★ THIS COPY DID NOT EXIST ANYWHERE BEFORE ─────────────────────────────────────────────────────
// Unlike every other registry in this catalogue, nothing was moved here. The eleven signatures carried
// their meaning ONLY in file-header comments written for whoever was building the next one — rulebook
// citations, threshold constants, fixed metrics-affected maps, FLAG notes about forward dependencies.
// Correct for an engineer; unusable as product vocabulary. These sentences are newly authored FROM
// those headers and from each signature's evaluate() body (which in several cases gates on something
// the header does not say — B-2 also requires the operating margin to stay positive; B-3 and B-4 use
// the prior year as the "normally" baseline and proceed with a note when it is unavailable; C-2 splits
// into two different outcomes under one key).
//
// ── ⚠⚠ THE THRESHOLD RULE — THE REASON THIS REGISTRY IS DIFFERENT FROM ALL THE OTHERS ─────────────
//
//   NOT ONE OF THESE STRINGS CONTAINS A DIGIT. That is enforced, not intended: verify-catalogue.ts §7
//   scans every string against every constant-shaped pattern and carries a negative control proving
//   the scan catches the raw header sentences it protects against.
//
// WHY. A guardrail signature detects DISTORTED OR GAMED REPORTING. Publish "profit up more than 100%
// year on year while operating margin stays within ±3pp and the below-line share exceeds 40%" and you
// have handed a company the exact shape to structure under. The bar IS the detector; naming it
// disarms it.
//
// ── ⚠ AND WHY THE STOCK-FINDING REGISTRY DOES THE OPPOSITE, DELIBERATELY ──────────────────────────
// Nine stock-finding descriptions NAME their trigger bar — "more than half their stake", "crossed 3×
// for the first time", "less than 1.5 times, measured over the trailing twelve months" — and
// all nine STAY. Those bars read filed, regulator-mandated disclosures. A company cannot restructure a
// shareholding pattern to duck a pledge ratio the exchange publishes, so naming the bar costs nothing
// and buys the reader an exact definition.
//
//   THE TWO RULES ARE OPPOSITE BECAUSE THE DATA IS OPPOSITE. Do not "harmonise" them in either
//   direction: stripping the finding bars loses precision for no gain, and adding bars here loses the
//   detector. If you are reading both registries in one sitting and the inconsistency looks like an
//   oversight — it is this paragraph.
//
// ── ★ 0a · DESCRIPTIONS STATE THE SHAPE. THEY DO NOT STATE THE CONSEQUENCE. ───────────────────────
//
// The first draft of this file said things like "profit-based readings stand down for the period",
// "growth comparisons are withheld from the peer cross-section", "escalates from a hold to removal",
// "held for a human ruling". Every one of those described a system we have deliberately turned off:
//
//     GUARDRAIL_BEHAVIOUR.suppress is EMPTY — nothing here changes a score, at all.
//     A-1, A-4 and C-2 are `disabled` — never evaluated; they cannot even fire.
//     B-5 and C-1 are `detect` — "no workflow exists to resolve these; they accumulate as a
//       deliberate backlog" (registry.ts). Nothing is ever ruled on.
//     O5 (hold) and O6 (remove) are dead ends — no orchestrator consumes them.
//
// Copy asserting a live response that does not happen is the same class of untruth as a methodology
// page describing nine pillars when four are computed. So the consequence is no longer authored: it
// is GENERATED from GUARDRAIL_BEHAVIOUR (0b) and the run-status is GENERATED from `isEvaluable` (0c).
// Both derive from the map that is already the enforced contract, so the copy cannot drift from it.
//
// ── ★ 0d · THE REGISTER IS PROSE, NOT "≠" ─────────────────────────────────────────────────────────
// There is no "Doesn't mean:" label anywhere in the product. Every render site prints the string RAW
// into an italic, left-bordered <p> (findings-section.tsx:209, flags-tab.tsx:200/230/268,
// structure-section.tsx:166, finding-columns.tsx:56, portfolio/health/findings.tsx:89). The portfolio
// library's "≠ trim it" form therefore reaches a reader LITERALLY today, on the portfolio page. That
// is shipped behaviour for that library and not ours to change — but it is not a form to copy into a
// new one, for three reasons: a guardrail entry will surface on STOCK surfaces, which use prose; a
// screen reader announces "≠" as "not equal to"; and the chat — the likeliest first destination for
// this copy — has no italics, no left border and no styling to carry the glyph's meaning.
//
// ── SCOPE: NOT SURFACED TO READERS YET ────────────────────────────────────────────────────────────
// Guardrail surfacing is backlogged and needs its own call. This registry exists so the copy has ONE
// home the day that call is made — and so the chat can answer "why is this stock's profit metric
// missing?" from the product's own words instead of inventing a limitation.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import {
  GUARDRAIL_BEHAVIOUR,
  isEvaluable,
  type GuardrailBehaviour,
} from "../scoring/guardrail/signatures/registry.js";
import type { SignatureKey } from "../scoring/guardrail/types.js";
import type { GuardrailSignatureEntry, GuardrailStatus, Registry } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ 0b · THE CONSEQUENCE SENTENCES — one per BEHAVIOUR, not one per signature.
//
// Total over GuardrailBehaviour: adding a fifth behaviour without a sentence is a compile error, the
// same way adding a signature without a behaviour already is. Keyed on the behaviour rather than the
// key so there is exactly one place to change if the wording is ever wrong, and no per-signature copy
// that could fall out of step with the map.
//
// ⚠ THESE SENTENCES ARE ABOUT OUR MACHINE, SO THEY NAME NO METRIC. "The readings it affects" — not
// "F1 ROCE, F2 ROE, M2 TTM NPM". Those are internal identifiers and a served string is the wrong place
// for them (Stage 4d), quite apart from the fact that the affected map is a per-signature detail a
// reader has no use for.
//
// ⚠⚠ AND THEY DESCRIBE THE BEHAVIOUR, NOT THE STATE OF THE DATA. `detect` used to end "…and no ruling
// has been made", which is a claim about how many rows the pending-review table happens to hold. It is
// true today because nothing has been ruled on — but it is DATA, and rule on one B-5 or C-1 case and a
// frozen module constant is now lying, with no gate that could catch it (the digit scan and the 0a
// clause scan both pass a false sentence). The behaviour is the durable part: recorded, proposed,
// never applied on its own. That stays true whether the backlog is empty, one row deep, or resolved.
// If you want to state that nothing has been ruled on, count the rows and say it at read time.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const CONSEQUENCE_BY_BEHAVIOUR: Readonly<Record<GuardrailBehaviour, string>> = {
  suppress:
    "When this is detected, the figures it affects are set aside for the period and the health score is assembled without them. The raw numbers stay visible, marked as excluded.",
  annotate:
    "Detecting this does not change the health score. It is recorded so the reading can be explained, and every figure is scored exactly as it would have been.",
  detect:
    "Detecting this does not change the health score. It is recorded together with the change it would propose, and that change is put to a person rather than applied — nothing here reaches the score on its own.",
  disabled:
    "This check is not running. It is described here because it is built and specified, but nothing is being detected and nothing is being recorded.",
};

/** ★ 0b — the consequence for a behaviour. Exported so the gate can paste the suppress sentence
 *  without having to fake a signature into the suppress set. */
export const consequenceForBehaviour = (b: GuardrailBehaviour): string => CONSEQUENCE_BY_BEHAVIOUR[b];

/** ★ 0b — the consequence for a signature, resolved through the live behaviour contract. */
export const consequenceOf = (key: SignatureKey): string =>
  CONSEQUENCE_BY_BEHAVIOUR[GUARDRAIL_BEHAVIOUR[key]];

/** ★ 0c — is the signature actually evaluated? Derived, never authored. */
export const statusOf = (key: SignatureKey): GuardrailStatus => (isEvaluable(key) ? "active" : "not_running");

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORED COPY. Name · description (SHAPE ONLY) · doesn't-mean. Nothing else.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
interface GuardrailCopy {
  name: string;
  /** ⚠ SHAPE ONLY — what is detected. Never what happens as a result (that is generated). */
  description: string;
  /** Prose. No "≠" — see 0d in the header. */
  doesntMean: string;
  category: "A" | "B" | "C";
}

const COPY: Readonly<Record<SignatureKey, GuardrailCopy>> = {
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Category A · DATA INTEGRITY. Not about the accounts being distorted — about them being ABSENT,
  // SHORT, or STALE. Every one of these is a statement about the reach of our reading.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  "A-1": {
    name: "Results not yet filed",
    description:
      "The company's latest quarterly results have not been filed by the date they were due. Vytal's momentum reading is built from the most recent quarter of accounts, so the newest figures behind it are older than the period now current, and stay that way until the filing arrives.",
    doesntMean:
      "Filings run late for ordinary reasons — auditor timing, a board date that moved. This is not a sign the company is in trouble, and not a sign it has stopped reporting. It says our reading is waiting on a document that has not arrived.",
    category: "A",
  },

  "A-2": {
    name: "Core figures missing",
    description:
      "One or more of the line items the Foundation metrics are built from — revenue, net profit, net worth, total assets — is absent from the latest annual accounts we hold. Every metric that reads a missing field is uncomputable from the data as we have it.",
    doesntMean:
      "These figures exist in the company's filed accounts. We do not hold them for this period in the form the metrics read. The gap is ours, and it says nothing about the business.",
    category: "A",
  },

  "A-3": {
    name: "History too short to read",
    description:
      "We hold fewer periods of accounts, or fewer quarters of shareholding, than the own-history and ownership-baseline lenses need. There is not enough record behind this stock to read it against itself.",
    doesntMean:
      "This is not a statement that the company is new, or that its record is worse than a longer one. Our coverage of it starts where it starts. A trend read over too few points is not a cautious trend — it is a number with nothing under it, and we would rather not state one.",
    category: "A",
  },

  "A-4": {
    name: "Not currently trading",
    description:
      "The stock is marked inactive, or no price has printed for a run of consecutive sessions long enough to read as a suspension. There is no current price for the Market pillar to read.",
    doesntMean:
      "Trading halts for many reasons, including ones that clear in days. This is not a sign the company has failed or that the holding is worthless. It says we have no current price to read.",
    category: "A",
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Category B · ACCOUNTING DISTORTION. One shape underneath all five: the OPERATING LINE stays
  // honest while the BOTTOM LINE moves sharply, so the gap between them belongs to an event rather
  // than to trading. B-1 and B-2 are mirror images; B-3 and B-4 name where the movement entered;
  // B-5 is the reverse case, where the distortion makes a number look BETTER.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  "B-1": {
    name: "One-off gain below the operating line",
    description:
      "Net profit jumped year on year while the operating margin barely moved, and the arithmetic gap between the two traces to something recognised below the operating line — an asset disposal, an investment revaluation, a settlement. The operating business traded much as it did before; the bottom line did not. Profit-based figures such as return on equity, return on capital, net margin and profit growth are describing the one-off rather than the operations.",
    doesntMean:
      "A one-time gain is a real, properly disclosed event, and the company is entitled to report it. Nothing here says the accounts are wrong or that anything was concealed. It says the profit figure for this period is not a description of how the business trades.",
    category: "B",
  },

  "B-2": {
    name: "One-off charge below the operating line",
    description:
      "Net profit collapsed, or turned negative, while the operating margin held and stayed positive — the fall traces to something recognised below the operating line, such as an impairment or a write-down, rather than to the trading business. Profit-based figures are describing a single charge; balance-sheet figures are describing something a genuine write-down really did change.",
    doesntMean:
      "The write-down matters, and the balance-sheet figures it changed are describing something real. What this says is narrower: the year's profit figure is describing a single charge rather than the trading business, so a return ratio computed on it would be describing the charge too.",
    category: "B",
  },

  "B-3": {
    name: "Profit moved on the tax line",
    description:
      "The period's effective tax rate fell far below what this company normally pays — in some cases to a credit — while net profit swung much harder than pre-tax profit did. The movement entered below the pre-tax line, so post-tax figures are describing a tax event rather than a change in trading. Everything measured before tax is untouched by it.",
    doesntMean:
      "Tax charges move for ordinary reasons — a rate change, a deferred-tax adjustment, a prior-year settlement. This is not a statement that the company underpaid its tax, or that the rate is wrong. It says the profit figure moved for a reason that sits below the business.",
    category: "B",
  },

  "B-4": {
    name: "Profit lifted by non-operating income",
    description:
      "Income from outside the operating business — interest, investment gains, disposals — accounts for a share of pre-tax profit far above what it accounts for at this company in an ordinary period. Profit and return figures that take that income into their numerator are describing it rather than the operations. Operating margin excludes it by construction.",
    doesntMean:
      "Treasury income and disposal gains are ordinary parts of a set of accounts. Nothing here says other income is illegitimate, or that the company is disguising weakness. It says the profit figure contains a large amount of something the operating figures deliberately exclude, and the two should not be read as saying the same thing.",
    category: "B",
  },

  "B-5": {
    name: "Return ratios lifted by a shrunken equity base",
    description:
      "Shareholder equity fell sharply year on year at a profitable company whose controlling shareholder holds the majority — the shape a large special dividend or capital return to that shareholder leaves, rather than the shape losses leave. Return on equity and return on capital rise arithmetically when the denominator shrinks, so the period's ratios read higher partly because there is less equity beneath them. The arithmetic is correct; what it is measuring has changed.",
    doesntMean:
      "Returning capital to shareholders is a legitimate decision, and the ratios are correctly computed. This is not a statement that the payout was improper or the numbers wrong. It says part of the rise came from the size of the base rather than from what the business earned — the one case where a number reading better is the thing worth looking at.",
    category: "B",
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Category C · STRUCTURAL CHANGE. Nothing is distorted and nothing is missing — the SUBJECT itself
  // changed between the two periods being compared, so the comparison is measuring two different
  // things. C-1 is the company changing size; C-2 is the share changing meaning.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  "C-1": {
    name: "Structural step in the business",
    description:
      "Revenue or total assets stepped year on year by a margin that does not read as a growth ramp — the discontinuity a merger, demerger or large acquisition leaves, often with a corporate event recorded near the date. The growth is real: the company genuinely is larger. But it grew by absorption rather than by trading, so a year-on-year growth rate here is measuring two different companies against each other.",
    doesntMean:
      "The company really is bigger, and the transaction was not a mistake. Nothing here says the growth is fake. It says one year's growth rate is measuring two different companies against each other, so it describes the transaction rather than the trading.",
    category: "C",
  },

  "C-2": {
    name: "Share count changed",
    description:
      "The share count moved discontinuously between periods, or a bonus, split or rights issue was recorded. A bonus or split is cosmetic — the same company divided into more pieces, and the price history is already adjusted for it. A rights issue or large fresh issuance is real dilution: each share carries a smaller claim than it did, and per-share figures across the break are not measuring the same unit.",
    doesntMean:
      "Companies issue shares to raise capital and split them to change the trading unit, and neither is a judgement on the business. Dilution is not a mistake, and a bonus is not a gain. It says per-share figures on either side of the change are not measuring the same unit.",
    category: "C",
  },
};

export const GUARDRAIL_SIGNATURE_KEYS = Object.keys(COPY) as SignatureKey[];

/**
 * THE REGISTRY. Total over SignatureKey — the SAME union GUARDRAIL_BEHAVIOUR is total over, so a
 * twelfth signature added to the union is a compile error in TWO places at once: once for "what may
 * this do to a score?" and once for "what does this say to a reader?". Neither can be answered by
 * default.
 *
 * `consequence` and `status` are assembled HERE, from the behaviour map, at module load. They are not
 * in COPY above and cannot be: there is nowhere to type them.
 */
export const GUARDRAIL_SIGNATURES: Registry<SignatureKey, GuardrailSignatureEntry> = Object.freeze(
  Object.fromEntries(
    (Object.entries(COPY) as [SignatureKey, GuardrailCopy][]).map(([key, c]) => {
      const entry: GuardrailSignatureEntry = {
        registry: "guardrail_signature",
        key,
        name: c.name,
        description: c.description,
        consequence: consequenceOf(key), // ★ 0b — generated
        status: statusOf(key), // ★ 0c — generated
        category: c.category,
        doesntMean: c.doesntMean,
      };
      return [key, entry];
    }),
  ) as Record<SignatureKey, GuardrailSignatureEntry>,
);

export function guardrailSignature(key: string): GuardrailSignatureEntry | null {
  return (GUARDRAIL_SIGNATURES as Record<string, GuardrailSignatureEntry | undefined>)[key] ?? null;
}
