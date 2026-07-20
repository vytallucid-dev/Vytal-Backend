// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO PATTERN LIBRARY (PHS Part B) — pure, definitional. Reads the Part A
// snapshot's already-computed values (pillars, coverage, bucket splits, ledgers) +
// the underlying holdings, and NAMES the findings the single number hid. It fires
// findings; it NEVER recomputes the score (that is Part A's, immutable here).
//
// INVIOLABLE LAWS enforced here:
//  • Definitional, not predictive/advisory: every Read states what the book IS.
//  • Field-verdicts (LM3/LP2) NEVER become a penalty or a negative finding — they
//    feed ONLY PX5, explicitly-neutral (they are NOT in `findings`, never deducted).
//  • Honest-empty: a pattern whose threshold is not declared in portfolio-spec 1.1
//    (PQ2 std-dev tolerance, PQ3 low-dispersion cutoff — still undeclared) does NOT fire —
//    not-evaluable, never fabricated.
//
// Copy is the spec's VERBATIM Read where the spec provides one, with bound values
// interpolated; patterns without a spec Read carry label + bind (UI composes copy).
//
// AMENDMENT 1.1 (Change 2) — TIER COPY-TONE WIRING. structure_tier + capital_tier (from
// the Part A snapshot `r`) SELECT the narrative framing of PC/PB-family reads, and are
// stamped into every PC/PB finding's bind. This is backend-owns-string: the reframed
// sentence is composed HERE and rendered verbatim by the UI (same pattern as lens
// verdicts). HARD LOCK: tiers touch COPY ONLY — never a number, never the `tone` enum,
// never `loud`, never WHICH findings fire. The factual spec sentence is preserved
// verbatim after the tier clause; the score is byte-identical with or without tiers.
// ─────────────────────────────────────────────────────────────────────────────
import type { PhsHolding, PhsResult } from "./engine.js";
import { natureOf, type BasketEntry } from "./entity.js";
import { FINDING_COPY } from "./copy.js";
import * as K from "./constants.js";
import { bandOf, BAND_MIXED, type StructureTier, type CapitalTier } from "./constants.js";
// TYPE-ONLY, and that is the whole of this file's relationship to the taxonomy: `PfFinding` names the
// class a not-evaluable PI carries, and `null-reasons.ts` owns what the classes ARE. A value import
// would put the omission vocabulary inside the pattern library, which is a second home for it.
import type { NullReasonClass } from "../null-reasons.js";

export type Tone = "Constructive" | "Neutral" | "Caution" | "Concern";

export interface PfFinding {
  id: string; // "PC1"
  family: string; // "PC" | "PB" | "PQ" | "PS" | "PV" | "PX" | "PI"
  label: string; // spec-verbatim
  tone: Tone;
  loud: boolean;
  bind: Record<string, unknown>; // exact values the UI renders without recomputing
  read?: string; // spec-verbatim Read (values filled) where the spec provides one
  /** (Stage 9) REQUIRED — from copy.ts, never authored here. */
  doesntMean: string;
  /**
   * ★ (Stage 10b · addendum §4) A STITCHABLE FRAGMENT — not a standalone sentence.
   *
   * `read` and `storyClause` are DIFFERENT REGISTERS OF THE SAME FACT, never two facts:
   *
   *   read        standalone, for the reference list — "You hold NTPC shares (11%) and an NTPC bond
   *               (8%). That is 19% of your book riding on one company."
   *   storyClause a fragment built to be JOINED — "you hold NTPC shares at 11% and an NTPC bond at 8%
   *               — your holdings list shows two positions, your risk shows one company at 19%"
   *
   * Lower-case, no terminal period: the composer supplies the connective and the punctuation, because
   * only the composer knows what came before it (§6 — the connective is chosen by the RELATIONSHIP).
   *
   * ── ★ ITS ABSENCE IS A GATE, NOT AN OMISSION ────────────────────────────────────────────────────
   *
   * A finding with no `storyClause` is INELIGIBLE FOR THE STORY BY CONSTRUCTION — `selectMovement4`
   * skips it. That is how PD's "reference only, always" is enforced STRUCTURALLY rather than by a
   * filter somebody has to remember to write: no PD finding carries one, so no PD finding can be
   * selected even if `MOVEMENT_HOME` were wrong. Two independent locks on the same door.
   *
   * ⚠ WHICH MEANS A MOVEMENT-4 FINDING THAT FORGETS ONE GOES SILENTLY MISSING FROM EVERY STORY — a
   * gate that reads as coverage and never fires, the disease this project has shipped six of. So
   * `verify-phs-story.ts` asserts EVERY movement-4-eligible finding HAS one. The gate is proven to be
   * a gate, and the omission is proven to be impossible.
   */
  storyClause?: string;
  /**
   * ★ (Stage 10a batch 3) NOT-EVALUABLE, WITH A REASON — set ONLY by the PI family, and absent (⇒ the
   * finding is evaluable and `read` states a fact) everywhere else.
   *
   * ── WHY THIS FIELD EXISTS, WHEN "DON'T FIRE" WAS ALWAYS THE ANSWER BEFORE ────────────────────────
   *
   * Every family before PI answers a question about the BOOK, and a question about the book that we
   * cannot answer is one the user never asked: nobody wonders why we didn't tell them their sector
   * concentration. Silence costs nothing, so `patterns.ts`'s law (line 11) is simply "does not fire".
   *
   * PI is the first family whose subject is an INSTRUMENT FACT THE USER CAN SEE ELSEWHERE. "Is my ETF
   * trading away from its NAV?" is a question they have, the answer is on the exchange's own site, and
   * PI1 going quiet does not read as "we didn't check" — it reads as "no premium". ★ SILENCE IS A
   * CLAIM HERE, and it is a claim we did not verify. 326 of 328 ETFs cannot be evaluated at all
   * (see PI1), so the quiet answer would be wrong 99.4% of the time.
   *
   * So the PI family may fire in a NOT-EVALUABLE state: the finding is present, `read` says what we
   * could not tell them AND WHY, and the panel renders an absence we own rather than an absence the
   * reader fills in. This is `entity.ts`'s C1–C6 rule ("a no-subject rule is not_evaluable, NEVER a
   * silent 0") arriving in the findings library — same law, same reason, one layer out.
   *
   * ⚠ A not-evaluable finding STILL CARRIES `doesntMean`, and it is not a formality: "we can't tell
   * you whether this ETF trades away from its NAV" is the sentence most likely to be misread as
   * "something is wrong with this ETF".
   */
  notEvaluable?: {
    /** The machine reason — an `OmissionCode`, a `NullReason`, or a PI-local code. NEVER prose. */
    reason: string;
    /** WHOSE gap this is (`null-reasons.ts`'s taxonomy). ★ `refused` is the load-bearing one: it says
     *  a number EXISTS and we declined to ship it — the opposite of a gap, and it must never render in
     *  the vocabulary of absence. */
    cls: NullReasonClass;
  };
}

/** Field-weak verdicts (LM3/LP2) per holding — for PX5 ONLY. Never a deduction. */
export interface PfContext {
  fieldWeakSymbols: Set<string>;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// (Stage 9) THE SUPPRESSION MODEL — ODL cv2-s9-suppression-model. NEITHER DOC ASKS THIS QUESTION; both
// are consistent with the answer. Doc 1 §B.8 triages by tone ("several fire, the UI orders them"); doc 2
// §11.1 suppresses at fire-time. Half in each is worse than either, so:
//
//   ★ SUPPRESS when siblings describe the SAME FACT at different intensities.
//     DO NOT SUPPRESS when they describe DIFFERENT FACTS.
//
//   PC1 / PC2  — one entity's weight, two thresholds → SUPPRESS (redundancy). A 45% position is not both
//                heavy AND dominant; "dominant" IS "heavy, and more so".
//   PC3 / PC4  — one sector's weight               → SUPPRESS (redundancy)
//   PC6 / PC7  — one house's weight                → SUPPRESS (redundancy)
//   PB1 / PB7  — DIFFERENT facts (name-breadth vs sector-survival) that CONTRADICT
//                                                  → SUPPRESS (FALSITY, not redundancy). The only
//                falsity case in the library, and why it felt different from the others: it is.
//   PX vs PC/PB — different facts that AGREE       → BOTH FIRE (§11.1 already says so; never merge them)
//
// Doc 1 §B.8's tone-triage survives WHERE IT IS RIGHT: triage is for findings that are ALL TRUE.
// Fire-time suppression is for a finding that is REDUNDANT (same fact, lower intensity) or FALSE
// (contradicted by a finding measuring the same thing better). A finding that is not true does not get to
// fire quietly — §B.8's "quiet findings… present, never suppressed" is about UI PLACEMENT (secondary
// texture vs headline card), not about firing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const pct = (w: number) => `${(w * 100).toFixed(1)}%`;
// (Stage 9) THRESHOLD EPSILON. Every C-metric is a SUM OF FRACTIONS — 40/100 + 20/100 = 0.6000000000000001
// → maxHousePct 60.00000000000001. A bare `> 60` hands the boundary to float dust: a book sitting EXACTLY
// on a threshold fires or stays silent depending on the order the weights happened to be added. The
// thresholds are DECLARED as exclusive (`> 40`, `> 60`, `> 80`, `>= 0.20`), so exceed them by more than
// dust or not at all. Same 1e-9 the verify harnesses already use for synthetic-exact comparisons.
const EPS = 1e-9;

/** (Stage 9) The PC/PB copy REGISTER, from the holding count. Replaces `r.structureTier` /
 *  `structureTierOf()`, which die with the S-rules (§15). Same cuts, new home, and a name that says what
 *  it is FOR: this selects a sentence's register, it is not a tier of anything. COPY ONLY — nothing here
 *  reaches a number (Stage 6 asserts the score is byte-identical with or without it). */
function copyRegisterOf(holdingCount: number): StructureTier {
  // Reads the CONSTANTS, never restates the cuts. Writing `<= 5 / <= 7` from memory here silently made a
  // 5-holding book "Starter" when the declared cuts say Building (1–4 · 5–7 · 8+) — two homes for one
  // boundary, drifting on day one. The constants survive §15; only `structureTierOf()` dies.
  if (holdingCount >= K.STRUCT_TIER_ESTABLISHED_MIN) return "Established";
  if (holdingCount >= K.STRUCT_TIER_BUILDING_MIN) return "Building";
  return "Starter";
}

// ── (1.1 Change 2) Tier copy framing — structure_tier (row) × capital_tier (col) selects
// a LEAD clause prepended to PC/PB reads. Every clause is a self-contained sentence
// (ends "…. ") so the spec's factual sentence stays byte-verbatim after it — no
// mid-sentence recapitalisation. Descriptive only: states the book's shape/size, never an
// instruction or a forecast (§B.0 lock). Established+Moderate is the baseline (no lead). ─
const PC_PB_LEAD: Record<StructureTier, Record<CapitalTier, string>> = {
  Starter: {
    Modest: "This is an early-stage book of modest size, where weight naturally sits in a few names. ",
    Moderate: "This is an early-stage book, where weight naturally sits in a few names. ",
    Substantial: "This is an early-stage book carrying substantial capital, where weight still sits in a few names. ",
  },
  Building: {
    Modest: "Your book is still taking shape at a modest size, so some concentration is part of the picture. ",
    Moderate: "Your book is still taking shape, so some concentration is part of the picture. ",
    Substantial: "Your book is still taking shape while carrying substantial capital, so some concentration is part of the picture. ",
  },
  Established: {
    Modest: "This is an established book of modest size. ",
    Moderate: "", // baseline — an established, moderately-sized book's read stands on the fact alone
    Substantial: "This is an established book carrying substantial capital. ",
  },
};

export function firePortfolioFindings(holdings: PhsHolding[], r: PhsResult, ctx: PfContext = { fieldWeakSymbols: new Set() }): PfFinding[] {
  const out: PfFinding[] = [];
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  if (total <= 0) return out;
  const W = holdings.map((h) => h.marketValue / total);
  const n = holdings.length;

  const isHeadline = (h: PhsHolding) => h.findings.some((f) => f === "distress" || f === "critical" || f === "high" || f === "medium");

  // (1.1 Change 2) Backend-composed, tier-framed PC/PB read. Prepends the tier LEAD clause
  // to the spec's verbatim sentence. Copy only — no number is touched.
  // (Stage 9) THE COPY REGISTER NOW COMES FROM `holdingCount`, NOT `r.structureTier`. Stage 6 removed
  // structureTier from the payload; it survived here only to pick a narrative register, and
  // `structureTierOf()` dies with the S-rules (§15). Doc 2 §9.4: "holdingCount and capitalTier remain as
  // COPY INPUTS ONLY."
  //
  // ★ THE VOCABULARY LABELS THE INVESTOR, NOT THE BOOK — and it does not come back as copy. "Starter"/
  // "Building"/"Established" are a register for the SENTENCE, chosen from how many things the user holds.
  // They are never a badge, never a number, and never reach the score (asserted byte-identical, Stage 6).
  const register = copyRegisterOf(n);
  const framePcPb = (baseRead: string) => PC_PB_LEAD[register][r.capitalTier] + baseRead;
  // The tier stamp every PC/PB finding carries in its bind (so the UI/telemetry can see the
  // selector that shaped the copy, and recompose if it ever localises the string itself).
  const tierBind = { structureTier: register, capitalTier: r.capitalTier };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // (Stage 10a) PA · PE · PV6 · PX6 — THE CATALOG THE STORYBOARD ASSUMES. Every one is a PURE FUNCTION
  // of what `construction_data` already carries: archetype, exposures, entityLedger, basketLedger, the
  // rule ledger with its tri-state, gross and net. ZERO new data access.
  //
  // The addendum's four movements are fed by these: PA → 1 · PV6/PE → 2 · PX6 → 3 (and the hinge into
  // 4). They did not exist; the movements had no feeders. §9's "Nothing is removed. Three additions"
  // assumed a catalog that was not there.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const c1_ = r.construction.gross.c1, c2_ = r.construction.gross.c2;
  const ex = r.construction.exposures;
  const entityCount = r.entityLedger.length;
  const nameRiskInstruments = holdings.filter((h) => natureOf(h.assetClass ?? "unknown", h.category ?? null) === "name_risk").length;
  // §4.1's partition: equity + debt + commodity (+ unknown) = 1. `Exposures` carries debt and commodity
  // DIRECTLY; equity is the residual. NOT `nameRisk` — that is a DIFFERENT AXIS (it includes bonds, which
  // are debt). Reading nameRisk as "equity" would call a bond an equity, which is the kind of quiet
  // category error the archetype exists to prevent.
  const debtShare = ex.debt, commodityShare = ex.commodity;
  const equityShare = Math.max(0, 1 - debtShare - commodityShare);
  const mixParts = [
    equityShare > 0 ? `${pct(equityShare)} equity` : null,
    debtShare > 0 ? `${pct(debtShare)} debt` : null,
    commodityShare > 0 ? `${pct(commodityShare)} gold` : null,
  ].filter(Boolean);

  // PA1 — always. The book, before any judgment. §1 sub-lock 2: asset mix is DESCRIBED, never judged.
  out.push({ id: "PA1", doesntMean: FINDING_COPY["PA1"].doesntMean, family: "PA", label: "Composition", tone: "Neutral", loud: true,
    bind: { archetype: r.construction.archetype, holdingCount: n, entityCount, exposures: ex, equityShare, debtShare, commodityShare, ...tierBind },
    read: `${n} ${n === 1 ? "holding" : "holdings"} · ${entityCount} ${entityCount === 1 ? "company" : "companies"} · ${mixParts.join(", ")}. We read this as a ${r.construction.archetype} book.` });

  // PA2 — position scale. COPY INPUT ONLY (§9.4): never a badge, never a score input.
  const avgPositionValue = n > 0 ? r.totalValue / n : 0;
  if (n > 0 && avgPositionValue < K.PA_SMALL_POSITION) {
    out.push({ id: "PA2", doesntMean: FINDING_COPY["PA2"].doesntMean, family: "PA", label: "Position scale", tone: "Neutral", loud: false,
      bind: { holdingCount: n, avgPositionValue, ...tierBind },
      read: `${n} positions averaging ₹${Math.round(avgPositionValue).toLocaleString("en-IN")}. Brokerage and charges are a near-fixed floor per trade, so they are a larger share of a smaller position.` });
  }

  // PA3 — instruments vs companies. The fact the instrument count hides; PC8 is its loud cousin.
  if (entityCount > 0 && entityCount < nameRiskInstruments) {
    out.push({ id: "PA3", doesntMean: FINDING_COPY["PA3"].doesntMean, family: "PA", label: "Instruments vs companies", tone: "Neutral", loud: false,
      bind: { entityCount, nameRiskInstrumentCount: nameRiskInstruments, entities: r.entityLedger, ...tierBind },
      read: `You hold ${nameRiskInstruments} instruments across ${entityCount} ${entityCount === 1 ? "company" : "companies"} — ${nameRiskInstruments - entityCount} of your positions ${nameRiskInstruments - entityCount === 1 ? "is a different instrument" : "are different instruments"} of a company you already hold.` });
  }

  // ── PE — evaluability. Panel 3 / movement 2: what we measured, and what we could NOT. ──
  // PE1 — always. Reads each rule's TRI-STATE (not_evaluable / clean / fired) — the distinction Stage 6
  // built `evaluable` for. "Not applicable" is NOT "passed": a rule with no subject is SILENT, not
  // satisfied, and conflating them is the lie this whole family exists to prevent.
  const CRULE_LABEL: Record<string, string> = {
    C1: "company concentration", C2: "breadth", C3: "sector concentration",
    C4: "sector spread", C5: "fund-house concentration", C6: "monitorability",
  };
  const cRules = [c1_, c2_, r.construction.c3, r.construction.c4, r.construction.c5, r.construction.c6];
  const applied = cRules.filter((x) => x.evaluable).map((x) => CRULE_LABEL[x.rule]);
  const notApplicable = cRules.filter((x) => !x.evaluable).map((x) => CRULE_LABEL[x.rule]);
  out.push({ id: "PE1", doesntMean: FINDING_COPY["PE1"].doesntMean, family: "PE", label: "What we measured", tone: "Neutral", loud: true,
    bind: {
      archetype: r.construction.archetype,
      rules: cRules.map((x) => ({ rule: x.rule, state: !x.evaluable ? "not_evaluable" : x.points === 0 ? "clean" : "fired", subjectShare: x.subjectShare, detail: x.detail })),
      ...tierBind,
    },
    read: `We judged this as a ${r.construction.archetype} book. Applied: ${applied.join(", ") || "nothing — no rule had a subject"}.`
      + (notApplicable.length ? ` Not applicable: ${notApplicable.join(", ")} — ${notApplicable.length === 1 ? "that rule" : "those rules"} had nothing to measure here.` : "") });

  // PE2 — the sector gate closed. Keyed on the MEASURED ratio, not on C3 having fired.
  const unknownSectorRatio = r.sectors.unknownRatio;
  if (unknownSectorRatio > 0.50) {
    out.push({ id: "PE2", doesntMean: FINDING_COPY["PE2"].doesntMean, family: "PE", label: "Sector not readable", tone: "Neutral", loud: false,
      bind: { unknownSectorRatio, sectoredShare: r.sectors.sectoredShare, counts: r.sectors.counts, ...tierBind },
      read: `We could not resolve a sector for ${pct(unknownSectorRatio)} of the part of your book where sector applies, so the sector rules stayed silent rather than read a fraction of it as the whole.` });
  }

  // PE3 — the house gate closed. Mirrors C5's OWN kill (houseUnknown > 0.5 × fundShare) rather than doc
  // 2's flat `> 0.50`: a book that is 10% funds, all house-unknown, has houseUnknown 0.10 — doc 2's rule
  // would stay silent while C5 is genuinely not-evaluable, so the panel would omit the reason C5 is
  // missing. Keyed on the metric, not on C5's firing.
  const c5_ = r.construction.c5;
  const houseUnknownShare = c5_.metrics?.houseUnknown ?? 0;
  if (c5_.subjectShare > 0 && houseUnknownShare > K.C5_HOUSE_UNKNOWN_KILL * c5_.subjectShare) {
    out.push({ id: "PE3", doesntMean: FINDING_COPY["PE3"].doesntMean, family: "PE", label: "Fund house not readable", tone: "Neutral", loud: false,
      bind: { houseUnknownShare, fundShare: c5_.subjectShare, ...tierBind },
      read: `We could not resolve which fund house runs ${pct(houseUnknownShare / c5_.subjectShare)} of your fund holdings, so the house-concentration rule stayed silent.` });
  }

  // PE4 — no direct company risk. A fund-led book's honest headline, and the reason C1/C2 are silent.
  if (ex.nameRisk === 0 && r.totalValue > 0) {
    out.push({ id: "PE4", doesntMean: FINDING_COPY["PE4"].doesntMean, family: "PE", label: "No direct company risk", tone: "Neutral", loud: false,
      bind: { nameRiskShare: 0, basketShare: ex.basket, ...tierBind },
      read: `You hold no company directly — every position is a fund, a basket or government paper. The rules that measure single-company concentration had nothing to measure.` });
  }

  // PE5 — THE BLIND SPOT, NAMED. Every basket is sector-`not_applicable` this stage (§14's matcher was
  // refused at 11.9% — ODL cv2-s8-matcher-unratified), so a fund's sector exposure is invisible to C3/C4.
  // This says so instead of letting the sector figure imply it covered the whole book.
  if (r.basketLedger.length > 0) {
    const names = r.basketLedger.map((b) => b.name);
    out.push({ id: "PE5", doesntMean: FINDING_COPY["PE5"].doesntMean, family: "PE", label: "Fund contents not visible", tone: "Neutral", loud: true,
      bind: { baskets: r.basketLedger, basketShare: ex.basket, sectoredShare: r.sectors.sectoredShare, ...tierBind },
      read: `${names.length === 1 ? `Your ${names[0]} gives` : `Your ${names.length} funds give`} you exposure that our sector reading cannot currently see — we don't have look-through into fund holdings. Sector figures reflect your direct companies only.` });
  }

  // ── PV6 — the finding that makes multi-asset honest. NOT a coverage gap: a coverage FACT. ──
  // PV4 = we haven't reached it yet · PV5 = genuinely unverifiable · PV6 = THE QUESTION DOESN'T APPLY.
  // Three different facts, never one bucket (doc 2 §8.3). Lumping them into one scolding "unscored"
  // bucket is the single easiest way to break this family.
  const nonStock = holdings.filter((h) => h.assetClass !== "stock");
  const nonStockValue = nonStock.reduce((s, h) => s + h.marketValue, 0);
  if (nonStockValue > 0) {
    const byClass = new Map<string, number>();
    for (const h of nonStock) byClass.set(h.assetClass ?? "unknown", (byClass.get(h.assetClass ?? "unknown") ?? 0) + h.marketValue);
    const CLASS_WORD: Record<string, string> = { mutual_fund: "mutual funds", etf: "ETFs", bond: "bonds", gsec: "government paper", sgb: "sovereign gold bonds", reit: "REITs", invit: "InvITs" };
    const words = [...byClass.keys()].map((k) => CLASS_WORD[k] ?? k);
    out.push({ id: "PV6", doesntMean: FINDING_COPY["PV6"].doesntMean, family: "PV", label: "Held by design, not scored", tone: "Neutral", loud: true,
      bind: { nonStockValue, nonStockShare: r.totalValue > 0 ? nonStockValue / r.totalValue : 0, byClass: Object.fromEntries(byClass), ...tierBind },
      read: `₹${Math.round(nonStockValue).toLocaleString("en-IN")} of your book — ${words.join(", ")} — sits outside the Health read. That is by design, not a gap. Our health score reads businesses: a fund owns businesses we can't see inside, and gold isn't a business at all.` });
  }

  // ── PX6 — THE GROSS/NET GAP. The storyboard's hinge between movements 3 and 4. ──
  // Gross = max(0, 100 − C1 − C2) is HOW YOU'RE SPREAD. Net subtracts the specific defects (C3–C6).
  // The gap says: your spread is one story, and one specific thing is another. A flat score merges them
  // — this is the finding that un-merges them. `4c5ca537` has a gap of 30.00 and nothing said so.
  const grossV = r.construction.gross.value, netV = r.construction.net;
  const gap = grossV - netV;
  if (gap >= 10) {
    const defects = [r.construction.c3, r.construction.c4, r.construction.c5, r.construction.c6]
      .filter((x) => x.points > 0).sort((a, b) => b.points - a.points);
    out.push({ id: "PX6", doesntMean: FINDING_COPY["PX6"].doesntMean, family: "PX", label: "A specific defect moved the number", tone: "Neutral", loud: true,
      bind: { constructionGross: grossV, constructionNet: netV, gap, defects: defects.map((d) => ({ rule: d.rule, points: d.points, firedSubject: d.firedSubject })), ...tierBind },
      read: `Your money is spread across what you hold at ${grossV.toFixed(0)}. ${defects.length === 1 ? "One specific thing" : `${defects.length} specific things`} moved the number to ${netV.toFixed(0)}: ${defects.map((d) => CRULE_LABEL[d.rule]).join(", ")}.` });
  }

  // ── PC — Concentration (headline for S1/S2/S3; explanation, not extra penalty) ──
  let maxW = 0, maxWi = -1;
  W.forEach((w, i) => { if (w > maxW) { maxW = w; maxWi = i; } });
  // §11.1 — PC2 SUPPRESSES PC1. A 45% position is not both HEAVY and DOMINANT: "dominant" IS "heavy, and
  // more so". Firing both says one thing twice at two volumes. This was the one sibling pair nobody got
  // to — not a design choice (ODL cv2-s9-suppression-model).
  const pc2Fires = maxW > 0.40 + EPS;
  if (maxW > 0.25 + EPS && !pc2Fires) {
    const h = holdings[maxWi];
    const hb = h.health != null ? bandOf(h.health) : "unscored";
    out.push({ id: "PC1", doesntMean: FINDING_COPY["PC1"].doesntMean, family: "PC", label: "Heavy single position", tone: "Caution", loud: true,
      bind: { symbol: h.symbol, weight: maxW, healthBand: hb, ...tierBind },
      storyClause: `your largest holding, ${h.symbol}, is ${pct(maxW)} of the book — the portfolio read leans on this one name`,
      read: framePcPb(`Your largest holding is ${pct(maxW)} of the book. Its health contributes ${pct(maxW)} of the aggregate, so the portfolio read leans heavily on this one name (${h.symbol}, ${hb}).`) });
  }
  if (pc2Fires) {
    const h = holdings[maxWi];
    out.push({ id: "PC2", doesntMean: FINDING_COPY["PC2"].doesntMean, family: "PC", label: "Dominant single position", tone: "Concern", loud: true, bind: { symbol: h.symbol, weight: maxW, ...tierBind },
      storyClause: `${pct(maxW)} of your book is one position — ${h.symbol}` });
  }

  // (Stage 9) THE TOP SECTOR IS READ, NOT RE-DERIVED. This block used to build its own sector map and
  // sum its own weights — a SECOND computation of a fact `c3Of` had already measured. Two homes for one
  // number is the shape that served 55.01 against an engine that said 32.38; it agreed here only by the
  // accident that both copies happened to be right. The rule measures; the finding reads.
  //
  // `metrics.maxSectorPct` is RAW — uncapped. C3 stops CHARGING at 65% (its 30-point cap), but a
  // 100%-pharma book is 100% pharma. The cap is a DEDUCTION ceiling, not a TRUTH ceiling: the finding
  // says what is TRUE, the rule decides what it COSTS (§0's three homes). Keyed on `evaluable` — "we
  // could measure it" — never on `points > 0` — "it charged". A finding gated on a deduction's firing
  // has confused the two jobs.
  const c3 = r.construction.c3;
  const maxSectorPct = c3.metrics?.maxSectorPct ?? 0; // RAW %, uncapped — compare in PCT units (see EPS)
  const maxSector = maxSectorPct / 100; // fraction — BIND/DISPLAY only, never a threshold
  const maxSectorName = c3.metrics?.maxSectorName ?? "";
  // §11.1 (binding) — "PC4 suppresses PC3" (same sector; headline-wins). A book that is 70% pharma is not
  // BOTH "sector-concentrated" and "single-sector": it is single-sector, and saying both bills the user
  // twice in attention for one fact. PC4 is computed FIRST so PC3 can stand down.
  const pc4Fires = c3.evaluable && maxSectorPct > 60 + EPS;
  if (c3.evaluable && maxSectorPct > 40 + EPS && !pc4Fires) {
    out.push({ id: "PC3", doesntMean: FINDING_COPY["PC3"].doesntMean, family: "PC", label: "Sector concentration", tone: "Caution", loud: true,
      bind: { sector: maxSectorName, weight: maxSector, ...tierBind },
      storyClause: `${pct(maxSector)} of your book is in ${maxSectorName} — health and risk here move substantially with one sector`,
      read: framePcPb(`${maxSectorName} makes up ${pct(maxSector)} of your book. Health and risk in this book move substantially with that one sector's fortunes.`) });
  }
  // PC4 (doc-1 numbering) — "Single-sector book". Fires on the RAW share even where C3's charge is
  // capped: at 65%+ the deduction stops moving, the fact does not.
  if (pc4Fires) {
    out.push({ id: "PC4", doesntMean: FINDING_COPY["PC4"].doesntMean, family: "PC", label: "Single-sector book", tone: "Concern", loud: true, bind: { sector: maxSectorName, weight: maxSector, ...tierBind },
      storyClause: `${pct(maxSector)} of your book is a single sector — ${maxSectorName}` });
  }
  // (Stage 9) NEFF IS NOW C2's — entity-level and sleeve-renormalised — not S3's position-level count.
  // They are DIFFERENT NUMBERS: entity aggregation counts NTPC stock + NTPC bond ONCE, so entity-Neff is
  // strictly ≤ the old position-Neff. The repoint therefore moves findings in a knowable direction —
  // more books read as thinner — which is TRUE: that is what the aggregation is for.
  //
  // ⚠️ THE 5/8 THRESHOLDS ARE UNCHANGED, DELIBERATELY. They were tuned against a number that
  // OVER-COUNTED (two instruments of one issuer read as two positions). If they are wrong against
  // entity-Neff that is a CALIBRATION ruling with its own evidence — not a side-effect smuggled in on a
  // repoint. Repoint, keep 5/8, report which books move. (ODL cv2-s9-gate-semantics.)
  //
  // Gated on `c2.evaluable`: a fund-only book has no name-risk sleeve, so entity breadth is not
  // measurable — and `metrics` is null. Ungated, `?? 0` would read "0 effective positions" and fire a
  // Caution off a fact we never measured: not-evaluable fabricated into a finding.
  const c2 = r.construction.gross.c2;
  const neffEntity = c2.metrics?.neff ?? null;
  if (c2.evaluable && neffEntity != null && neffEntity < 5) {
    out.push({ id: "PC5", doesntMean: FINDING_COPY["PC5"].doesntMean, family: "PC", label: "Thin effective spread", tone: "Caution", loud: true,
      bind: { neff: neffEntity, holdingCount: n, ...tierBind },
      storyClause: `you hold ${n} ${n === 1 ? "stock" : "stocks"}, but weight is concentrated enough that your book behaves like roughly ${neffEntity.toFixed(1)} equally-sized positions`,
      read: framePcPb(`Although you hold ${n} stocks, weight is concentrated enough that your book behaves like roughly ${neffEntity.toFixed(1)} equally-sized positions.`) });
  }

  // ── PB — Breadth & diversification quality (also tier-framed per 1.1 Change 2) ──
  // PB1 is a CONSTRUCTIVE claim, so both halves must be measurable before we make it. Asserting
  // "well-spread" while unable to see the sectors you claim spread across is a confident claim built on
  // an absence — a green that cannot fail. It now requires C3 (sectors readable) AND C2 (entity breadth
  // readable); previously it rode `s2Evaluable` and fired for books whose sectors never resolved.
  // (Stage 9) PB7 is computed HERE, ahead of PB1, because PB1 must stand down when it fires (§11.1's
  // headline-wins, extended past PC): "your spread is false" outranks "your spread is good" when both
  // describe the SAME spread. See the PB7 build below for the ratio and why a difference was wrong.
  const c4 = r.construction.c4;
  const neffUnit = c4.metrics?.neffUnit ?? null;
  const neffSector = c4.metrics?.neff ?? null;
  const pb7Fires = c4.evaluable && neffUnit != null && neffSector != null && neffUnit > 0
    && neffSector / neffUnit <= 0.50 + EPS;

  // ★ A CONSTRUCTIVE FINDING IS THE ONE A USER ACTS ON BY DOING NOTHING, SO IT HAS TO BE THE
  // MOST-CONDITIONED, NOT THE LEAST. Every other tone survives being wrong — a Caution that shouldn't
  // have fired is noise the user dismisses. A Constructive that shouldn't have fired is a FALSE
  // ALL-CLEAR, and the user's response is to STOP LOOKING. It is the only finding whose failure mode is
  // inaction. PB1 has now broken three times for the same reason (ODL cv2-s9-constructive-most-conditioned):
  //   1. it fired while unable to SEE the sectors it claimed spread across  → now requires C3.evaluable
  //   2. it fired on books that only LOOKED sector-less                     → the fixture bug, not the gate
  //   3. it fired while PB7 said the spread was ILLUSORY                    → requires !pb7Fires (here)
  // Wide by name AND wide by sector, or it is not a well-spread book.
  if (c3.evaluable && c2.evaluable && neffEntity != null && neffEntity >= 8 && maxSector <= 0.40 && !pb7Fires) {
    out.push({ id: "PB1", doesntMean: FINDING_COPY["PB1"].doesntMean, family: "PB", label: "Well-spread book", tone: "Constructive", loud: false, bind: { neff: neffEntity, maxSectorWeight: maxSector, ...tierBind },
      storyClause: `your money is spread across ${neffEntity.toFixed(1)} effective positions with no sector above ${pct(maxSector)} — nothing here concentrates` });
  }
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // (Stage 9) FOUR NEW BUILDS — concepts doc 2 defines that doc 1 never had. IDs are DOC-1's, and two
  // of them had to be minted: doc-2's numbering is SWAPPED against doc-1's (doc-2 PC3 "One company, two
  // instruments" collides with doc-1 PC3 "Sector concentration"; doc-2 PB3 "False sector spread"
  // collides with doc-1 PB3 "Closet-index breadth"). PC6/PC7/PB6 are free in BOTH docs and keep doc-2's
  // number. PC8/PB7 are free in both docs — deliberately NOT doc-2's PC3/PB3, and not PB4/PB5 either
  // (those mean something else in doc 2), so no id ever names two findings.
  //
  // ⚠ EVERY ONE OF THESE IS STRUCTURALLY UNFIRABLE ON THE LIVE COHORT: only 7985d813 holds funds — 4
  // baskets, 0.2% of book — and no live book holds a bond. Reachability is proven by FIXTURE
  // (verify-phs-patterns), never by the live book. ODL cv2-s9-basket-isin.
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // PC8 (doc-2 PC3) — ONE COMPANY, TWO INSTRUMENTS. The flagship: only the ENTITY ledger can see it,
  // because the instrument list shows two rows and the risk is one company. Keyed on the ledger, which
  // aggregated the fact once; nothing here re-derives it.
  const multiInstrument = r.entityLedger.filter((e) => e.constituentInstruments.length >= 2 && e.weight >= 0.10);
  for (const e of multiInstrument) {
    const parts = [...e.constituentInstruments].sort((a, b) => b.marketValue - a.marketValue);
    const totalMv = parts.reduce((s, p) => s + p.marketValue, 0);
    const largest = totalMv > 0 ? (parts[0].marketValue / totalMv) * e.weight : 0;
    const list = parts.map((p) => `${p.symbol} (${pct((p.marketValue / totalMv) * e.weight)})`).join(" and ");
    out.push({ id: "PC8", doesntMean: FINDING_COPY["PC8"].doesntMean, family: "PC", label: "One company, two instruments", tone: "Caution", loud: true,
      bind: { entityKey: e.entityKey, displayName: e.displayName, weight: e.weight, constituents: e.constituentInstruments, ...tierBind },
      storyClause: `you hold ${e.displayName} across ${parts.length} instruments — ${list} — so your holdings list shows ${parts.length} positions and your risk shows one company at ${pct(e.weight)}`,
      read: framePcPb(`You hold ${e.displayName} across ${parts.length} instruments — ${list}. That is ${pct(e.weight)} of your book riding on one company; the instrument list shows ${pct(largest)}.`) });
  }

  // PC6 / PC7 (doc-2 same numbers) — FUND-HOUSE concentration. Raw `maxHousePct`, uncapped: C5's charge
  // stops at 60.8% (its 25-point cap); an 85%-one-house book is still 85%. §11.1: PC7 suppresses PC6.
  const c5 = r.construction.c5;
  const maxHousePct = c5.metrics?.maxHousePct ?? 0;
  const maxHouseName = c5.metrics?.maxHouseName ?? "";
  const houseFunds = r.basketLedger.filter((b) => b.fundHouse === maxHouseName);
  const pc7Fires = c5.evaluable && maxHousePct > 80 + EPS;
  if (c5.evaluable && maxHousePct > 40 + EPS && !pc7Fires) {
    out.push({ id: "PC6", doesntMean: FINDING_COPY["PC6"].doesntMean, family: "PC", label: "Fund-house concentration", tone: "Caution", loud: true,
      bind: { fundHouse: maxHouseName, maxHousePct, constituents: houseFunds, ...tierBind },
      storyClause: `${maxHouseName} manages ${pct(maxHousePct / 100)} of your money across ${houseFunds.length} ${houseFunds.length === 1 ? "fund" : "funds"} — one house, one set of operational arrangements`,
      read: framePcPb(`${maxHouseName} manages ${pct(maxHousePct / 100)} of your book across ${houseFunds.length} ${houseFunds.length === 1 ? "fund" : "funds"}. One fund house, one set of operational and governance arrangements.`) });
  }
  if (pc7Fires) {
    out.push({ id: "PC7", doesntMean: FINDING_COPY["PC7"].doesntMean, family: "PC", label: "Single-house book", tone: "Concern", loud: true,
      bind: { fundHouse: maxHouseName, maxHousePct, constituents: houseFunds, ...tierBind },
      storyClause: `${pct(maxHousePct / 100)} of your money sits with one fund house — ${maxHouseName}` });
  }

  // PB7 (doc-2 PB3) — FALSE SECTOR SPREAD. The hole doc 1 §6 leaves open: ten stocks across three
  // sectors at 33% each fires NOTHING under v1 — max sector 33 < 40, Neff 10 > 8 — yet the book is
  // 3-wide, not 10-wide. Keyed on C4's OWN two measurements (units post-aggregation vs sector totals);
  // `evaluable`, never "C4 fired" — a book can be measurably collapsed while C4's charge is still 0.
  // (`pb7Fires` is computed ABOVE, next to PB1, which must stand down when it fires.)
  //
  // ★ THE RATIO, NOT THE DIFFERENCE (ODL cv2-s9-pb7-ratio). Doc 2 declares
  // `(neffUnitSectored − neffSector) >= 2`. That measures the WRONG THING: EVERY real book holds more
  // names than sectors, so the difference asks "do you hold more companies than sectors" — true of
  // essentially everyone. It fired on §10's Ex1, the TYPICAL RETAIL book (diff 2.64), which doc 1 calls
  // well-spread. A guard that fires on everything is as uninformative as one that fires on nothing.
  //
  // The ratio is SCALE-FREE and asks the real question: what fraction of name-breadth SURVIVES the
  // sector collapse? Ex1 keeps 4.645/7.284 = 64% — ordinary structure. The motivating book keeps
  // 3.0/9.0 = 33% — a theme wearing a diversification costume. 0.50 is DECLARED, not derived: "at least
  // half your name-breadth must survive the sector collapse" is defensible without a corpus, and carries
  // the same status as every constant here — calibrated post-launch via a clean version bump.
  // `<= 0.50 + EPS` because the threshold is INCLUSIVE: a book sitting exactly on half must fire, and
  // float dust must not be what decides it.
  if (pb7Fires) {
    out.push({ id: "PB7", doesntMean: FINDING_COPY["PB7"].doesntMean, family: "PB", label: "False sector spread", tone: "Caution", loud: true,
      bind: { neffUnitSectored: neffUnit, neffSector, survivingBreadth: neffSector! / neffUnit!, ...tierBind },
      storyClause: `you hold about ${neffUnit!.toFixed(0)} companies but they occupy about ${neffSector!.toFixed(0)} sectors — your book reads ${neffUnit!.toFixed(0)}-wide by name and about ${neffSector!.toFixed(0)}-wide by sector`,
      read: framePcPb(`You hold about ${neffUnit!.toFixed(0)} companies, but they occupy about ${neffSector!.toFixed(0)} sectors. Your book reads ${neffUnit!.toFixed(0)}-wide by name and about ${neffSector!.toFixed(0)}-wide by sector.`) });
  }

  // PB6 (doc-2 same number) — FUNDS OCCUPYING ONE EXPOSURE. Groups the basket ledger by AMFI category.
  // Deliberately NOT a rule: redundancy is an inefficiency, not a structural risk, and scoring it would
  // mean judging the user's choice. Fund-HOUSE pile-up (PC6/PC7) IS structural — one point of failure.
  const byCategory = new Map<string, BasketEntry[]>();
  for (const b of r.basketLedger) {
    if (b.category == null) continue; // an uncategorised fund is not evidence of a shared exposure
    const g = byCategory.get(b.category);
    if (g) g.push(b); else byCategory.set(b.category, [b]);
  }
  for (const [category, funds] of byCategory) {
    const w = funds.reduce((s, b) => s + b.weight, 0);
    if (funds.length < 2 || w < 0.20 - EPS) continue;
    const leaf = category.replace(/^Open Ended Schemes\((?:Equity Scheme|Other Scheme|Debt Scheme|Hybrid Scheme)\s*-\s*/, "").replace(/\)$/, "").trim();
    out.push({ id: "PB6", doesntMean: FINDING_COPY["PB6"].doesntMean, family: "PB", label: "Funds occupying one exposure", tone: "Neutral", loud: true,
      bind: { category, categoryLeaf: leaf, combinedWeight: w, constituents: funds, ...tierBind },
      storyClause: `${funds.length} of your funds are ${leaf}s, together ${pct(w)} of your book — for breadth they read closer to one exposure than ${funds.length}`,
      read: framePcPb(`${funds.length} of your funds are ${leaf}s, together ${pct(w)} of your book. For breadth, they read closer to one exposure than ${funds.length}.`) });
  }

  if (n > 25) out.push({ id: "PB2", doesntMean: FINDING_COPY["PB2"].doesntMean, family: "PB", label: "Very broad book", tone: "Neutral", loud: false, bind: { holdingCount: n, ...tierBind },
    storyClause: `you hold ${n} positions — a book this wide takes real time to follow` });
  if (n > 40) {
    out.push({ id: "PB3", doesntMean: FINDING_COPY["PB3"].doesntMean, family: "PB", label: "Closet-index breadth", tone: "Caution", loud: false, bind: { holdingCount: n, ...tierBind },
      storyClause: `with ${n} holdings your book approaches an index in breadth — individual position moves have little effect on the whole`,
      read: framePcPb(`With ${n} holdings, your book approaches an index in breadth — individual position moves have little effect on the whole, and it is a lot to monitor by hand.`) });
  }

  // ── PQ — Quality composition (scored-holding health distribution) ──
  const scored = holdings.filter((h) => h.health != null);
  const scoredHealth = scored.map((h) => h.health as number);
  if (r.quality != null && r.quality >= 75 && scoredHealth.length > 0 && Math.min(...scoredHealth) >= 65) {
    out.push({ id: "PQ1", doesntMean: FINDING_COPY["PQ1"].doesntMean, family: "PQ", label: "Uniformly sound holdings", tone: "Constructive", loud: false, bind: { quality: r.quality, minScoredHealth: Math.min(...scoredHealth) } });
  }
  // (portfolio-findings 2.0) PQ2 + PQ3 — THE DISPERSION AXIS, READ AT TWO ENDS. Both were honest-empty
  // through 1.1/1.2 because doc 1 declares them only as "std-dev above tolerance" / "low dispersion" —
  // no number. The number is now DECLARED (K.PQ_DISPERSION_SPLIT = 15, one full Health band), so they
  // ship. Do not invent thresholds; get them ruled.
  //
  // ONE constant, both rules: PQ2 at σ ≥ 15, PQ3 at σ < 15 ⇒ MUTUALLY EXCLUSIVE BY CONSTRUCTION. A book
  // can never be told both that its average lies and that its average is trustworthy.
  //
  // `sd == null` ⇔ fewer than 2 scored holdings ⇒ BOTH not-evaluable. Sample σ is UNDEFINED at n=1 (0/0)
  // where population σ would say 0 — "no split" when the truth is "no distribution". Neither rule fires
  // off a distribution that does not exist. (K.sampleStdDev returns null, never 0.)
  const sd = K.sampleStdDev(scoredHealth);
  if (sd != null && sd >= K.PQ_DISPERSION_SPLIT) {
    const hi = scored.reduce((a, b) => ((b.health as number) > (a.health as number) ? b : a));
    const lo = scored.reduce((a, b) => ((b.health as number) < (a.health as number) ? b : a));
    out.push({ id: "PQ2", doesntMean: FINDING_COPY["PQ2"].doesntMean, family: "PQ", label: "Split quality (barbell)", tone: "Neutral", loud: true,
      bind: { quality: r.quality, stdDev: sd, scoredCount: scored.length, strongest: { symbol: hi.symbol, health: hi.health }, weakest: { symbol: lo.symbol, health: lo.health } },
      read: `Your average health of ${r.quality?.toFixed(0)} hides a split — you hold strong names (${hi.symbol} ${hi.health}) and weak ones (${lo.symbol} ${lo.health}) at meaningful weight. The single number sits between two different stories.` });
  }
  // PQ3 — "Quality ≤ 55 AND low dispersion": low quality that is NOT an artifact of averaging. The
  // holdings really are uniformly ordinary, so the aggregate describes nearly every name in the book.
  if (r.quality != null && r.quality <= 55 && sd != null && sd < K.PQ_DISPERSION_SPLIT) {
    out.push({ id: "PQ3", doesntMean: FINDING_COPY["PQ3"].doesntMean, family: "PQ", label: "Uniformly ordinary holdings", tone: "Caution", loud: false,
      bind: { quality: r.quality, stdDev: sd, scoredCount: scored.length },
      read: `Your scored holdings cluster together around ${r.quality.toFixed(0)} rather than averaging out from extremes — the aggregate describes nearly every name in the book.` });
  }
  holdings.forEach((h, i) => {
    if (h.health != null && h.health < BAND_MIXED && W[i] >= 0.10) {
      out.push({ id: "PQ4", doesntMean: FINDING_COPY["PQ4"].doesntMean, family: "PQ", label: "Weak name at size", tone: "Caution", loud: true,
        bind: { symbol: h.symbol, health: h.health, band: bandOf(h.health), weight: W[i] },
        read: `${h.symbol} sits in the ${bandOf(h.health)} health band at ${pct(W[i])} weight — a material drag on Quality.` });
    }
  });

  // ── PS — Signal exposure (capital-weighted fired findings) ──
  const critHighW = holdings.reduce((s, h, i) => (h.findings.some((f) => f === "critical" || f === "high") ? s + W[i] : s), 0);
  if (critHighW >= 0.10) {
    const names = holdings.filter((h) => h.findings.some((f) => f === "critical" || f === "high")).map((h) => h.symbol);
    out.push({ id: "PS1", doesntMean: FINDING_COPY["PS1"].doesntMean, family: "PS", label: "Capital under active red flags", tone: "Concern", loud: true,
      bind: { weight: critHighW, symbols: names },
      read: `${pct(critHighW)} of your book by value sits in holdings with active Critical/High red flags (${names.join(", ")}). These are the holdings the model is currently warning on.` });
  }
  holdings.forEach((h, i) => {
    if (h.findings.includes("distress") && W[i] >= 0.05) {
      out.push({ id: "PS2", doesntMean: FINDING_COPY["PS2"].doesntMean, family: "PS", label: "Distress exposure", tone: "Concern", loud: true, bind: { symbol: h.symbol, weight: W[i] },
        read: `${h.symbol} is in the Distress band at ${pct(W[i])} of the book.` });
    }
  });
  // PS3 — LP5 exposure, EXCLUDING holdings already headlined (B.7 anti-double-count)
  const lp5W = holdings.reduce((s, h, i) => (h.findings.includes("lp5") && !isHeadline(h) ? s + W[i] : s), 0);
  if (lp5W >= 0.25) out.push({ id: "PS3", doesntMean: FINDING_COPY["PS3"].doesntMean, family: "PS", label: "Broad-erosion exposure", tone: "Caution", loud: true, bind: { weight: lp5W } });
  const lp6W = holdings.reduce((s, h, i) => (h.findings.includes("lp6") ? s + W[i] : s), 0);
  if (lp6W >= 0.25) out.push({ id: "PS4", doesntMean: FINDING_COPY["PS4"].doesntMean, family: "PS", label: "Fading-strength exposure", tone: "Caution", loud: false, bind: { weight: lp6W } });
  const anyDeducting = holdings.some((h) => h.findings.length > 0);
  if (!anyDeducting) out.push({ id: "PS5", doesntMean: FINDING_COPY["PS5"].doesntMean, family: "PS", label: "No active red flags", tone: "Constructive", loud: false, bind: {} });

  // ── PV — Visibility & coverage ──
  const c = r.coverage;
  const recogW = r.totalValue > 0 ? r.recognizedUnscoredValue / r.totalValue : 0;
  const smallW = r.totalValue > 0 ? r.smallUnscoredValue / r.totalValue : 0;
  if (c >= 0.90) out.push({ id: "PV1", doesntMean: FINDING_COPY["PV1"].doesntMean, family: "PV", label: "Fully verified book", tone: "Constructive", loud: false, bind: { coverage: c } });
  if (c < 0.60) out.push({ id: "PV2", doesntMean: FINDING_COPY["PV2"].doesntMean, family: "PV", label: "Partly verified book", tone: "Neutral", loud: true, bind: { coverage: c } });
  // PV3 "Confidence-limited read" is RETIRED in 1.2 (Change 3): the coverage ceiling is gone,
  // so the Health number is never held below its true value — there is no cap to explain. The
  // coverage line + Provisional tag carry the honesty now. (Forced by the ceiling retirement.)
  if (recogW >= 0.15) out.push({ id: "PV4", doesntMean: FINDING_COPY["PV4"].doesntMean, family: "PV", label: "Awaiting-coverage names", tone: "Neutral", loud: false, bind: { weight: recogW } });
  if (smallW >= 0.25) out.push({ id: "PV5", doesntMean: FINDING_COPY["PV5"].doesntMean, family: "PV", label: "Untracked small-caps in book", tone: "Caution", loud: false, bind: { weight: smallW } });

  // ── PX — Cross-pillar tension (reads pillar relationships; orthogonal to PC/PS) ──
  // (Stage 9) THE LAST S-READ. `r.structure` was the S-COMPOSITE; Construction is now C1–C6's Net — the
  // number the user is actually shown (Stage 5's cutover made `construction.net` the `structure` COLUMN).
  // A PX finding reading the S-composite would have compared Quality against a number NOBODY SEES.
  //
  // ⚠ THE THRESHOLDS (PX1 <= 60, PX2 >= 85, PX4 >= 80) ARE UNCHANGED, DELIBERATELY — a repointing stage
  // does not retune (ODL cv2-s9-gate-semantics). MEASURED on the cohort (probe-s9-px-repoint-diff.ts):
  // ZERO books flip PX1/PX2/PX4. Not because the change is small — Δ is −5.97 to −34.00 — but because the
  // S-composite ALREADY sat at 55.00–55.01 on four of five books, BELOW PX1's 60. They were all already
  // under the gate; QUALITY is what decides PX1 here (only the two 72.6 books clear >= 70; e3c6bd3c misses
  // by 0.7 at 69.3).
  //
  // ★ THE CALIBRATION OBLIGATION — the threshold did not move, its MEANING did. `<= 60` selected the
  // bottom ~11% of the old [55,100] range (S1 fired on nearly every book, so 55 was the effective floor).
  // It now selects the bottom ~50% of [20,100]. PX1's Construction gate is therefore nearly always
  // satisfied, and PX1 fires on any book with Quality >= 70. That may be RIGHT — §1's own example is
  // "Health 80 · Construction 21 — a genuinely great company held in a genuinely fragile way", and the
  // re-rating IS the thesis. But it is a CALIBRATION ruling with its own evidence, not a repoint's
  // side-effect. Re-derive with the probe before touching 60.
  const Q = r.quality, S = r.construction.net, Sig = r.signals;
  if (Q != null && Q >= 70 && S <= 60) {
    out.push({ id: "PX1", doesntMean: FINDING_COPY["PX1"].doesntMean, family: "PX", label: "Sound companies, fragile construction", tone: "Caution", loud: true,
      bind: { quality: Q, structure: S },
      read: `The businesses you hold are individually healthy (Quality ${Q.toFixed(0)}), but the way they're weighted concentrates the book (Structure ${S.toFixed(0)}). Your holdings' quality and your book's construction are telling different stories.` });
  }
  if (Q != null && S >= 85 && Q <= 55) out.push({ id: "PX2", doesntMean: FINDING_COPY["PX2"].doesntMean, family: "PX", label: "Well-built, ordinary components", tone: "Neutral", loud: true, bind: { quality: Q, structure: S } });
  if (Q != null && Q >= 65 && Sig <= 60) {
    out.push({ id: "PX3", doesntMean: FINDING_COPY["PX3"].doesntMean, family: "PX", label: "Sound holdings, active deterioration", tone: "Caution", loud: true,
      bind: { quality: Q, signals: Sig },
      read: `Your holdings are fundamentally decent (Quality ${Q.toFixed(0)}), but several carry active red flags right now (Signals ${Sig.toFixed(0)}). Long-run quality and current warnings diverge in this book.` });
  }
  if (Q != null && Q >= 70 && S >= 80 && Sig >= 85 && c >= 0.80) out.push({ id: "PX4", doesntMean: FINDING_COPY["PX4"].doesntMean, family: "PX", label: "Broad strength", tone: "Constructive", loud: true, bind: { quality: Q, structure: S, signals: Sig, coverage: c } });
  const fieldWeakW = holdings.reduce((s, h, i) => (ctx.fieldWeakSymbols.has(h.symbol) ? s + W[i] : s), 0);
  if (fieldWeakW >= 0.30) {
    out.push({ id: "PX5", doesntMean: FINDING_COPY["PX5"].doesntMean, family: "PX", label: "Weak-field environment", tone: "Neutral", loud: false, // NEVER Caution/Concern; NEVER deducts
      bind: { weight: fieldWeakW },
      read: `A notable share of your book (${pct(fieldWeakW)}) is in holdings our engine reads as leading weak fields — the peer groups themselves are soft on key metrics right now. This is context about the environment your holdings sit in, not a judgment on the holdings.` });
  }

  return out;
}

/** Which patterns are honest-empty because portfolio-spec 1.1 declares no threshold. */
/** (portfolio-findings 2.0) EMPTY — and it must stay honest, not be deleted. PQ2/PQ3 lived here through
 *  1.1/1.2 because doc 1 declared their thresholds only as "std-dev above tolerance" / "low dispersion".
 *  `PQ_DISPERSION_SPLIT = 15` is now DECLARED, so both ship and this list is empty.
 *  The list STAYS as the mechanism: the next pattern whose threshold the spec describes in words rather
 *  than numbers goes here and fires NOTHING, rather than shipping with a number someone invented to make
 *  the harness green. Honest-empty is a state to declare, not a gap to fill. */
export const NOT_EVALUABLE_UNDECLARED = [] as const as readonly string[];
