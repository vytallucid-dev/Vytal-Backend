// ─────────────────────────────────────────────────────────────────────────────
// THE ENTITY MODEL (Construction v2 Stage 1) — nature + entity key + the entity ledger.
//
// TWO FACTS, computed BY FACT (never inferred), available to the Construction rules that follow
// (C1/C2/C4, Stages 3/5). NOTHING here scores. No deduction reads it yet.
//
//  1. NATURE — what KIND of risk a holding carries, from what the instrument IS (§3):
//       name_risk — value rides on ONE entity's fate            (stock, bond, reit, invit)
//       basket    — holds many businesses BY CONSTRUCTION       (mutual_fund, non-commodity etf)
//       sovereign — one issuer, not a diversification question  (gsec, sgb)
//       commodity — one thing, but NOT an entity                (gold/silver ETFs, by category)
//     Commodity sits OUTSIDE the name-risk sleeve: C2 asks "if one ENTITY fails, how much goes with
//     it?" — and gold is not an entity. It is never given an entity key.
//
//  2. ENTITY KEY = isin.slice(0,7) — the 7-char issuer stem, for NAME-RISK holdings ONLY. It is the
//     hard key that makes an NTPC stock and an NTPC bond ONE entity at their combined weight. Baskets,
//     sovereign and commodity have NO key, ever — they are never aggregated.
//
// PURE. No DB, no clock, no I/O. Same holdings in, same ledger out — which is what lets it be
// computed once (doc 2 §0) alongside the score and read by whatever needs it, without drift.
// ─────────────────────────────────────────────────────────────────────────────

import * as K from "./constants.js";

/** The 8 catalogued asset classes (mirrors the Prisma AssetClass enum; a string-union keeps this
 *  module DB-free). `natureOf` accepts a plain string so an unrecognized class degrades to `basket`. */
export type AssetClass = "stock" | "etf" | "bond" | "gsec" | "sgb" | "mutual_fund" | "reit" | "invit";

export type Nature = "name_risk" | "basket" | "sovereign" | "commodity";

/** The minimal per-holding facts the entity model reads. A `PhsHolding` satisfies it structurally. */
export interface EntityInput {
  symbol: string;
  marketValue: number;
  isin?: string | null;
  assetClass?: AssetClass;
  category?: string | null;
  /** (Stage 4) the RESOLVED sector — a stock's own, or a bond's inherited issuer sector; null otherwise. */
  sector?: string | null;
  /** (Stage 5) the RESOLVED fund house — for a fund product (basket ∪ commodity), from
   *  mf_family_members → mf_families.fund_house (resolved upstream in assemble, DB-free here). null
   *  for name-risk / sovereign, and for a fund product whose house did not resolve (→ houseUnknown). */
  fundHouse?: string | null;
  /** (Stage 9) the instrument's catalog name — a DISPLAY fact, read by nothing that scores. Needed
   *  because a fund's `symbol` IS its isin (assemble), so PB6's bind would otherwise read
   *  "INF204K01234 is a Large Cap Fund". Optional: a stock never needs it (its symbol IS its handle). */
  name?: string | null;
}

export interface EntityConstituent {
  symbol: string;
  assetClass: AssetClass;
  marketValue: number;
}

/** One aggregated entity: its stem, a display handle, its combined book weight, and the instruments
 *  that make it up. Powers the NTPC story (PC3, doc 2 §5). Stage 7 persists this; nothing scores it. */
export interface EntityLedgerEntry {
  entityKey: string; // isin.slice(0,7)
  displayName: string;
  weight: number; // Σ constituent marketValue ÷ totalValue (whole book)
  constituentInstruments: EntityConstituent[];
  /** (Stage 5) the entity's RESOLVED sector — one issuer stem → one sector, so every constituent (a
   *  stock + its same-issuer bonds) shares it. First non-null constituent sector; null when unresolved
   *  (a lone unheld-issuer bond → not_applicable → not a C4 unit). C4 reads this. */
  sector: string | null;
}

/** (Stage 9) One held BASKET — a fund/ETF, the things the entity ledger deliberately never aggregates.
 *  The MIRROR of `EntityLedgerEntry`: name-risk is aggregated by issuer and lands there; baskets are held
 *  as-is and land here. Together they cover the book.
 *
 *  Keyed on `isin`, NOT an `instrumentId` uuid — and the deviation is deliberate. Nothing in
 *  `construction_data` uses an instrument uuid: `EntityLedgerEntry.entityKey` is an isin STEM,
 *  `EntityConstituent` carries a symbol. The schema itself settles it — isin is *"the dedup spine…
 *  immutable security identifier; symbols drift, ISIN does not"*. This row is APPEND-ONLY and frozen
 *  forever; keying history to a uuid that a catalog re-seed can reissue makes the record unresolvable,
 *  while the isin still identifies the security in ten years. A uuid here would also be a SECOND
 *  identifier for a thing already identified — one home per fact.
 *
 *  `name` is carried (not resolved at read) because this is a HISTORICAL record: it says what the fund
 *  was called when the book was scored. That is not the live-fact refusal of `cv2-s7-refuse-live-facts`
 *  — `unvaluedShare` was refused because staleness would make the row LIE about the book; a renamed
 *  scheme does not. And a bind cannot key into a name the FE has to go find. */
export interface BasketEntry {
  isin: string;
  name: string; // display handle — a fund's `symbol` IS its isin (assemble), so symbol cannot serve
  category: string | null; // the AMFI leaf — PB6 groups on it
  fundHouse: string | null; // null ⇒ unresolved (C5's house-unknown share); PC6/PC7 read the house
  weight: number; // marketValue ÷ totalValue (WHOLE book, like EntityLedgerEntry.weight)
}

/** Every basket held, in deterministic order (isin) so Stage 7 can fingerprint it. Aggregation is NOT
 *  performed and must not be: two funds of one house are two funds — C5 measures the HOUSE pile-up, PB6
 *  the CATEGORY pile-up, and collapsing them here would pre-empt both rules with one wrong answer. */
export function buildBasketLedger(holdings: EntityInput[], totalValue: number): BasketEntry[] {
  const out: BasketEntry[] = [];
  for (const h of holdings) {
    const nat = natureOf(h.assetClass ?? "unknown", h.category ?? null);
    if (nat !== "basket" && nat !== "commodity") continue; // fund products only — the same set C5 scores
    out.push({
      isin: h.isin ?? h.symbol,
      name: h.name ?? h.symbol,
      category: h.category ?? null,
      fundHouse: h.fundHouse ?? null,
      weight: totalValue > 0 ? h.marketValue / totalValue : 0,
    });
  }
  return out.sort((a, b) => (a.isin < b.isin ? -1 : a.isin > b.isin ? 1 : 0));
}

// (ODL cv2-s1-commodity) COMMODITY matcher — ETF-SCOPED substring `gold|silver` on the AMFI category
// leaf ("… - Gold ETF" / "… - Silver ETF"). Forward-covers a future Silver leaf; a non-match falls to
// `basket`, the conservative default that never manufactures a name-risk charge. Applied ONLY to
// asset_class='etf': a "Gold Sector FUND" is a basket of mining businesses, not the metal — nature is
// a fact about THIS instrument, not a word in its name.
const COMMODITY_CATEGORY = /\b(gold|silver)\b/i;

/** The nature of a holding, by fact. `assetClass` is a plain string so an unknown class → `basket`. */
export function natureOf(assetClass: string, category: string | null): Nature {
  if (assetClass === "stock" || assetClass === "bond" || assetClass === "reit" || assetClass === "invit") return "name_risk";
  if (assetClass === "gsec" || assetClass === "sgb") return "sovereign";
  if (assetClass === "etf" && category != null && COMMODITY_CATEGORY.test(category)) return "commodity";
  return "basket"; // mutual_fund, non-commodity etf, or an unrecognized class (conservative)
}

/** The entity key for a holding — its 7-char issuer stem, for NAME-RISK holdings only. `null` for
 *  baskets / sovereign / commodity (never aggregated) and for a holding missing its isin/assetClass
 *  (a synthetic or legacy holding — not aggregatable, so it earns no entity). */
export function entityKeyOf(h: EntityInput): string | null {
  if (h.assetClass == null || h.isin == null) return null;
  if (natureOf(h.assetClass, h.category ?? null) !== "name_risk") return null;
  return h.isin.length >= 7 ? h.isin.slice(0, 7) : null;
}

/** Aggregate the weight vector by entity key. Every NAME-RISK holding lands in exactly one entity
 *  (a lone bond of an unheld issuer is its own singleton entity — aggregates with nothing, charged
 *  nothing). Deterministic order (entityKey, then constituent symbol) so Stage 7 can fingerprint it. */
export function buildEntityLedger(holdings: EntityInput[], totalValue: number): EntityLedgerEntry[] {
  const byEntity = new Map<string, EntityInput[]>();
  for (const h of holdings) {
    const key = entityKeyOf(h);
    if (key == null) continue; // baskets/sovereign/commodity/keyless — never aggregated
    const g = byEntity.get(key);
    if (g) g.push(h); else byEntity.set(key, [h]);
  }
  const entries: EntityLedgerEntry[] = [];
  for (const [entityKey, hs] of byEntity) {
    const value = hs.reduce((s, h) => s + h.marketValue, 0);
    const constituentInstruments: EntityConstituent[] = hs
      .map((h) => ({ symbol: h.symbol, assetClass: h.assetClass!, marketValue: h.marketValue }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.marketValue - b.marketValue);
    entries.push({
      entityKey,
      displayName: displayNameFor(hs),
      weight: totalValue > 0 ? value / totalValue : 0,
      constituentInstruments,
      // one issuer stem → one sector; a stock carries its own, a same-issuer bond inherits it (assemble).
      // First non-null wins (constituents agree by construction); null ⇒ this entity is not a C4 unit.
      sector: hs.map((h) => h.sector ?? null).find((s) => s != null) ?? null,
    });
  }
  return entries.sort((a, b) => a.entityKey.localeCompare(b.entityKey));
}

/** The issuer's display handle — prefer the equity's ticker (the human name for the entity), else the
 *  first constituent's symbol. Display-only; Stage 6 may enrich (e.g. a bond's `attributes.issuer`). */
function displayNameFor(hs: EntityInput[]): string {
  const equity = hs.find((h) => h.assetClass === "stock");
  return (equity ?? hs[0]!).symbol;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SLEEVE SHARES (Construction v2 Stage 2, §5) — the book split into risk sleeves by nature. Pure.
// `unvaluedShare` is NOT here: it is computed read-time in the controller (it needs heldNotValued,
// which the engine never sees). `sectoredShare` is DEFERRED to Stage 4 (sector resolution does not
// exist yet — a share from a non-existent resolution would be a fabricated zero).
// ═════════════════════════════════════════════════════════════════════════════════════════════════
export interface Sleeves {
  nameRisk: number; // Σ w_i over name-risk holdings, ∈ [0,1]
  basket: number; // Σ w_i over baskets, ∈ [0,1]
}

/** (Stage 7 §12) Sleeves is a PROJECTION of Exposures — never a second computation. Until Stage 7,
 *  `buildSleeves` and `buildExposures` each summed nameRisk/basket with IDENTICAL logic: one fact, two
 *  homes, agreeing only by the accident that both copies happened to be right. Exposures is the superset
 *  (it also carries debt/commodity), so it is the single source and Sleeves is a view of it. Callers that
 *  already hold an Exposures should use this and never re-derive. */
export function sleevesOf(e: Exposures): Sleeves {
  return { nameRisk: e.nameRisk, basket: e.basket };
}

/** The sleeves of a book. Computes Exposures ONCE and projects it. (`buildExposures` is declared below;
 *  function declarations hoist, so the single-source direction reads Exposures → Sleeves regardless of
 *  file order.) */
export function buildSleeves(holdings: EntityInput[], totalValue: number): Sleeves {
  return sleevesOf(buildExposures(holdings, totalValue));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// C1 · C2 · GROSS (Construction v2 Stage 3, §6/§8) — the FIRST rules that DEDUCT. Pure. Read by
// no display this stage (§8: Gross is never shown as a competing score); they do not touch Health or
// the live S-rules. Each rule reports `evaluable` — a no-subject rule is not_evaluable, NEVER a
// silent 0 ("we checked, nothing wrong" when the truth is "we had nothing to check").
// ═════════════════════════════════════════════════════════════════════════════════════════════════
/** (Stage 6) the STRUCTURED subject a rule fired on — so the FE renders from FIELDS, never by parsing
 *  `detail` prose (rebuilding that trap is what broke the old Construction read). null when clean or
 *  not-evaluable (nothing fired). One shape per rule kind. */
export type FiredSubject =
  | { kind: "entity"; label: string; weight: number }   // C1 — the dominant entity (whole-book weight)
  | { kind: "sector"; label: string; weight: number }   // C3 — the top sector (whole-book weight)
  | { kind: "house"; label: string; weight: number }    // C5 — the top fund house (whole-book weight)
  | { kind: "breadth" }                                 // C2 / C4 — the numbers live in `metrics` (below)
  | { kind: "count"; count: number };                   // C6 — holding count

/** (Stage 7 §12) the measurements a rule MADE — present whether or not it fired.
 *
 *  `firedSubject` is a FIRE-TIME artifact: null when the rule is clean. But a clean C2 still MEASURED
 *  Neff, and a clean C4 still measured both Neffs — and until Stage 7 those numbers survived ONLY inside
 *  `detail` prose ("Neff_unit 1.91 → target 1.91 ≤ Neff_sector 1.91 — clean"). Unrecoverable without
 *  parsing it: the exact trap the structured fields exist to kill, resurrected by accident. A measurement
 *  is not a subject. This is its home — the ONE home; nothing re-derives it. */
export interface CMetrics {
  neff?: number;        // C2 → Neff over ENTITIES (name-risk sleeve) · C4 → Neff over SECTOR totals
  target?: number;      // C2 → C2_TARGET · C4 → min(C4_TARGET, Neff_unit) — the anti-double-charge target
  neffUnit?: number;    // C4 ONLY — Neff over UNITS (entities POST-aggregation). Never positions (§15).
  houseUnknown?: number; // C5 ONLY — the fund-product share whose house did not resolve
  /** (Stage 9) C3 ONLY — the top RESOLVED sector's whole-book share, as a PERCENT, RAW.
   *  Raw meaning: uncapped. C3 stops CHARGING at 65% (the 30-point cap), but a 100%-pharma book is still
   *  100% pharma — the cap is a DEDUCTION ceiling, not a TRUTH ceiling. The findings key off this, so a
   *  finding says what is TRUE while the rule decides what it COSTS (§0's three homes).
   *  Present whether or not C3 fired: `firedSubject` is null when clean, and a clean book's top-sector
   *  share is exactly what "well-spread" needs to state. */
  maxSectorPct?: number;
  /** C3 ONLY — the sector that share belongs to. */
  maxSectorName?: string;
  /** (Stage 9) C5 ONLY — the top fund house's whole-book share, as a PERCENT, RAW (uncapped: C5's
   *  25-point cap binds at 60.8%). Present whether or not C5 fired. */
  maxHousePct?: number;
  /** C5 ONLY — the house that share belongs to. */
  maxHouseName?: string;
}

export interface CDeduction {
  rule: "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
  /** false ⇔ NO SUBJECT (not_evaluable ≠ fired-with-0). The distinguishing bit; §9.5's panel reads it.
   *  Three states: !evaluable → not_evaluable · evaluable && points===0 → clean · else → fired.
   *  (Stage 7) §12 lists a persisted `state` — REFUSED: it is a pure function of (evaluable, points),
   *  so persisting it is a THIRD encoding that can disagree with the two it derives from. Derived at read
   *  (FE `firedRules`/`cleanRules`/`notEvaluableRules`). A fact with zero homes cannot drift. */
  evaluable: boolean;
  points: number; // magnitude deducted; 0 when not-evaluable OR evaluable-but-clean
  /** (Stage 6, §9.4) the whole-book share the rule's SUBJECT occupies — what the rule COULD see. The
   *  evaluability panel reads it ("fund-house — 0% of book is funds"). 0 when there is no subject. */
  subjectShare: number;
  /** (Stage 6) structured — what actually fired. null when clean OR not-evaluable. */
  firedSubject: FiredSubject | null;
  /** (Stage 7) what the rule measured, fired or not. null for rules that measure nothing (C1/C3/C6 —
   *  their subject IS the measurement, and `firedSubject` carries it). */
  metrics: CMetrics | null;
  detail: string; // HUMAN COPY ONLY — never the FE's data source
}
export interface GrossResult {
  value: number; // max(0, 100 − C1 − C2). Not-evaluable rules contribute 0. NEVER displayed.
  c1: CDeduction;
  c2: CDeduction;
}

/** C1 — entity DOMINANCE. Subject: name-risk entities (Stage 1's ledger, post-aggregation). No
 *  name-risk entities → NOT EVALUABLE. Denominator: the whole book. N is POSITIONS, not entities
 *  (NTPC stock + bond = one entity but two positions — fairShare measures the user's own structure).
 *  Sum THEN cap on the TOTAL (monotonic — v1's per-holding cap made two 50%s cost more than one 100%). */
export function c1Of(entityLedger: EntityLedgerEntry[], positionCount: number, nameRiskShare: number): CDeduction {
  if (entityLedger.length === 0) return { rule: "C1", evaluable: false, points: 0, subjectShare: 0, firedSubject: null, metrics: null, detail: "no name-risk entities — not evaluable" };
  const fairShare = positionCount > 0 ? 100 / positionCount : 0;
  const threshold = Math.max(K.C1_FLOOR, K.C1_FAIR_MULT * fairShare);
  let sum = 0;
  const fired: string[] = [];
  let top: EntityLedgerEntry | null = null; // the heaviest entity that fired (the panel's primary subject)
  for (const e of entityLedger) {
    const pct = e.weight * 100;
    if (pct > threshold) {
      const d = K.C1_RATE * (pct - threshold);
      sum += d;
      fired.push(`${e.displayName} ${pct.toFixed(1)}% → −${d.toFixed(2)}`);
      if (!top || e.weight > top.weight) top = e;
    }
  }
  const points = Math.min(sum, K.C1_TOTAL_CAP);
  const detail = `threshold ${threshold.toFixed(1)}% (N=${positionCount})` +
    (fired.length ? ` · ${fired.join(" · ")}${sum > K.C1_TOTAL_CAP ? ` · Σ${sum.toFixed(2)} capped at ${K.C1_TOTAL_CAP}` : ""}` : " · no entity above — clean");
  return { rule: "C1", evaluable: true, points, subjectShare: nameRiskShare, firedSubject: top ? { kind: "entity", label: top.displayName, weight: top.weight } : null, metrics: null, detail };
}

/** C2 — entity BREADTH (the load-bearing rule). Subject: the name-risk sleeve. `nameRiskShare = 0`
 *  → NOT EVALUABLE, skipped entirely. Neff over ENTITIES (sleeve-renormalized — Stage 1's ledger ÷
 *  nameRiskShare, so Σ = 1). NO CAP. Scaled by nameRiskShare — THIS is the no-cliff mechanism
 *  (₹100 of a fund nudges nameRiskShare 1.0000 → 0.9999, and C2 by ~0.01). */
export function c2Of(entityLedger: EntityLedgerEntry[], nameRiskShare: number): CDeduction {
  if (nameRiskShare <= 0 || entityLedger.length === 0) return { rule: "C2", evaluable: false, points: 0, subjectShare: 0, firedSubject: null, metrics: null, detail: "name-risk sleeve empty — not evaluable, skipped" };
  const sumW2 = entityLedger.reduce((s, e) => { const w = e.weight / nameRiskShare; return s + w * w; }, 0);
  const neff = sumW2 > 0 ? 1 / sumW2 : 0;
  // (Stage 7) `metrics` carries the Neff whether or not the rule fires — a clean C2 still MEASURED it.
  const metrics: CMetrics = { neff, target: K.C2_TARGET };
  if (neff >= K.C2_TARGET) return { rule: "C2", evaluable: true, points: 0, subjectShare: nameRiskShare, firedSubject: null, metrics, detail: `Neff ${neff.toFixed(2)} ≥ ${K.C2_TARGET} — clean` };
  const points = K.C2_RATE * (K.C2_TARGET - neff) * nameRiskShare;
  return { rule: "C2", evaluable: true, points, subjectShare: nameRiskShare, firedSubject: { kind: "breadth" }, metrics, detail: `Neff ${neff.toFixed(2)} < ${K.C2_TARGET} · ${K.C2_RATE}×${(K.C2_TARGET - neff).toFixed(2)}×${nameRiskShare.toFixed(4)} → −${points.toFixed(2)}` };
}

/** Gross = max(0, 100 − C1 − C2). A not-evaluable rule contributes 0 (nothing to deduct), while the
 *  ledger still records WHY (not_evaluable, not a checked-clean 0). §8: never displayed. */
export function grossOf(c1: CDeduction, c2: CDeduction): number {
  return Math.max(0, 100 - c1.points - c2.points);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SECTOR RESOLUTION (Construction v2 Stage 4, §7) — THREE states that must NEVER pool. Pure.
//   resolved       — a stock (its own sector) or a bond whose issuer resolved (inherited sector). C3/C4.
//   unknown        — should have a sector but we couldn't resolve it (a null-sector STOCK — 0 today).
//                    (§14, later: a thematic fund the matcher can't place. INTERIM: no fund lands here.)
//   not_applicable — sector does not apply: sovereign, baskets (interim: ALL funds/ETFs), commodity,
//                    reit/invit, AND bonds with an UNRESOLVED issuer (our gap, NOT the book's).
// `unknown` and `not_applicable` are different FACTS: the gate runs over `sectorable = resolved ∪
// unknown`, NEVER the whole book — so a 90%-gilt book (gilt = not_applicable) is not killed by gilt
// weight. Porting v1's whole-book semantics here is the regression §7 forbids.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
export type SectorState = "resolved" | "unknown" | "not_applicable";

/** The sector state of a holding, from its class + its RESOLVED sector (set upstream in assemble). A
 *  null-sector STOCK is `unknown` (we expect a sector, don't have it); a null-sector BOND is
 *  `not_applicable` (unresolved issuer — our gap must not drive the gate). Everything else non-stock
 *  is `not_applicable` this stage (§14 will move thematic funds out of here). */
export function sectorStateOf(assetClass: string | undefined, sector: string | null | undefined): SectorState {
  // (Stage 9) A MISSING class is not a state — it is an unanswerable question, and `not_applicable` is
  // an ANSWER: "sector does not apply here." We cannot know that without knowing what the thing IS.
  // Answering it anyway is what let §10's worked examples run as BASKET books for an entire stage —
  // `sectorStateOf(undefined, "IT")` silently discarded a declared sector and every example read as
  // Fund-led. The real path ALWAYS supplies the class (assemble.ts:448/509 are the only two holding
  // constructors; `stocks.isin` is NOT NULL), so this is unreachable in production — which is precisely
  // what `sectorVersion` and PC5 were before they were found dead. **"Unreachable today" is not a reason
  // to answer quietly; it is a reason to fail loud when it happens.**
  //
  // The param stays OPTIONAL on purpose. Making it `string` would force every caller to write
  // `?? "unknown"` to compile — re-creating this exact bug at the call site, one layer out, where no
  // guard can see it. The type permits the mistake so the runtime can NAME it.
  // SCOPED TO THE INCOHERENCE, NOT TO THE ABSENCE — and the distinction is load-bearing. The defect is
  // being handed a sector we CANNOT INTERPRET and dropping it on the floor; class-absent WITH sector-null
  // discards nothing. That narrower line is not a softening — it is the only line that leaves §13's
  // contamination micro-proof (verify-cv2-stage3) able to exist: it strips isin/assetClass from a book
  // ON PURPOSE to prove Gross MOVES while Health/Quality/Signals do not. An isolation proof needs an
  // impossible book — on the real path a stock is always a stock, so the ONLY way to vary Construction
  // while holding the Health inputs fixed is to strip the facts. Throwing on absence outlaws the
  // technique that proves the guarantee. It still catches every case that motivated it: all four §10
  // examples declare sectors, so all four throw.
  if (assetClass == null && sector != null) {
    throw new Error(
      `sectorStateOf: handed sector ${JSON.stringify(sector)} with NO assetClass. The class is what `
      + `interprets the sector — without it this sector gets silently discarded as "not_applicable", which `
      + `is an ANSWER to an UNANSWERABLE question. The real path always sets assetClass (assemble.ts:448/509); `
      + `a synthetic holding must carry it too (see verify-phs-patterns.ts H/HF).`,
    );
  }
  // A KNOWN class that discards a sector is a RULED decision, not a defect: every fund/ETF is
  // `not_applicable` this stage (§14 interim, ODL cv2-s8-matcher-unratified), asserted by
  // verify-cv2-stage4 — `sectorStateOf("etf", "Energy") === "not_applicable"`. Do not throw on that.
  if (assetClass === "stock") return sector != null ? "resolved" : "unknown";
  if (assetClass === "bond") return sector != null ? "resolved" : "not_applicable";
  return "not_applicable";
}

export interface SectorResolution {
  sectoredShare: number; // Σ w_i over RESOLVED — WHOLE-BOOK denominator (§5)
  unknownRatio: number; // unknownSectorValue / sectorableValue — SECTORABLE denominator (§7)
  sectorableValue: number; // Σ marketValue over (resolved ∪ unknown)
  unknownSectorValue: number; // Σ marketValue over unknown
  gateOpen: boolean; // unknownRatio ≤ C3_UNKNOWN_KILL — false ⇒ C3 AND C4 both not-evaluable
  counts: { resolved: number; unknown: number; notApplicable: number };
  /** whole-book weight per RESOLVED sector — what C3/C4 (Stage 5) read for sector concentration.
   *  A stock and a same-issuer bond both land in the issuer's sector (e.g. NTPC stock + bond → Energy). */
  sectorWeights: { sector: string; weight: number }[];
}

export function buildSectorResolution(holdings: EntityInput[], totalValue: number): SectorResolution {
  let resolvedValue = 0, unknownSectorValue = 0, rN = 0, uN = 0, naN = 0;
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    const st = sectorStateOf(h.assetClass, h.sector);
    if (st === "resolved") { resolvedValue += h.marketValue; rN++; bySector.set(h.sector!, (bySector.get(h.sector!) ?? 0) + h.marketValue); }
    else if (st === "unknown") { unknownSectorValue += h.marketValue; uN++; }
    else naN++;
  }
  const sectorableValue = resolvedValue + unknownSectorValue;
  const unknownRatio = sectorableValue > 0 ? unknownSectorValue / sectorableValue : 0;
  const sectorWeights = [...bySector.entries()]
    .map(([sector, v]) => ({ sector, weight: totalValue > 0 ? v / totalValue : 0 }))
    .sort((a, b) => a.sector.localeCompare(b.sector));
  return {
    sectoredShare: totalValue > 0 ? resolvedValue / totalValue : 0,
    unknownRatio,
    sectorableValue,
    unknownSectorValue,
    gateOpen: unknownRatio <= K.C3_UNKNOWN_KILL,
    counts: { resolved: rN, unknown: uN, notApplicable: naN },
    sectorWeights,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// C3 · C4 · C5 · C6 · NET (Construction v2 Stage 5, §6/§8) — the rules that complete the library and
// FEED THE DISPLAYED number. Pure. Each reports `evaluable` (not_evaluable ≠ fired-with-0). C3/C4 are
// gated by the sector resolution (`gateOpen`); C5 by fund-house resolvability; C6 is always evaluable.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** C3 — SECTOR DOMINANCE. Subject: resolved-sector weight. Denominator: the WHOLE BOOK (a 20%-equity
 *  book all in one sector is 20% exposed, not 100%). No resolved sector, or the gate KILLED (unknown
 *  sector > C3_UNKNOWN_KILL of the sectorable population) → NOT EVALUABLE. */
export function c3Of(sectors: SectorResolution): CDeduction {
  // (Stage 9) the top sector is measured FIRST, so `metrics` can carry it in EVERY branch — including
  // the not-evaluable ones, where the share is still a fact even though we decline to charge for it.
  // PC3/PC4 read this and never re-derive it: patterns.ts used to sum its own sector map, a SECOND
  // computation of a fact the engine already had. That shape is what served 55.01 against an engine 32.38.
  let maxPct = 0, maxName = "";
  for (const s of sectors.sectorWeights) { const p = s.weight * 100; if (p > maxPct) { maxPct = p; maxName = s.sector; } }
  const metrics: CMetrics = { maxSectorPct: maxPct, maxSectorName: maxName };

  if (sectors.sectorWeights.length === 0) return { rule: "C3", evaluable: false, points: 0, subjectShare: sectors.sectoredShare, firedSubject: null, metrics: null, detail: "no resolved sector — not evaluable" };
  if (!sectors.gateOpen) return { rule: "C3", evaluable: false, points: 0, subjectShare: sectors.sectoredShare, firedSubject: null, metrics, detail: `sector gate killed — unknownRatio ${(sectors.unknownRatio * 100).toFixed(1)}% > ${K.C3_UNKNOWN_KILL * 100}% — not evaluable` };
  if (maxPct <= K.C3_THRESH) return { rule: "C3", evaluable: true, points: 0, subjectShare: sectors.sectoredShare, firedSubject: null, metrics, detail: `top sector ${maxName} ${maxPct.toFixed(1)}% ≤ ${K.C3_THRESH}% — clean` };
  const points = Math.min(K.C3_RATE * (maxPct - K.C3_THRESH), K.C3_CAP);
  return { rule: "C3", evaluable: true, points, subjectShare: sectors.sectoredShare, firedSubject: { kind: "sector", label: maxName, weight: maxPct / 100 }, metrics, detail: `${maxName} ${maxPct.toFixed(1)}% > ${K.C3_THRESH}% → −${points.toFixed(2)}${points >= K.C3_CAP ? ` (capped — the CHARGE stops here; ${maxPct.toFixed(1)}% remains the truth)` : ""}` };
}

/** C4 — SECTOR BREADTH. UNITS = name-risk ENTITIES with a resolved sector (Stage 1's ledger,
 *  post-aggregation — NTPC stock + bond are ONE unit) OR thematic baskets (§14, later — interim: none).
 *  Neff over units AND over sector totals, both renormalized within sectoredShare. target =
 *  min(C4_TARGET, Neff_unit) — the ANTI-DOUBLE-CHARGE: every unit in its own sector ⇒ Neff_sector =
 *  Neff_unit = target ⇒ C4 = 0, always. Scaled by sectoredShare. Same gate as C3. */
export function c4Of(entityLedger: EntityLedgerEntry[], sectors: SectorResolution): CDeduction {
  const sectoredShare = sectors.sectoredShare;
  if (sectoredShare <= 0 || sectors.sectorWeights.length === 0) return { rule: "C4", evaluable: false, points: 0, subjectShare: sectoredShare, firedSubject: null, metrics: null, detail: "no resolved sector — not evaluable" };
  if (!sectors.gateOpen) return { rule: "C4", evaluable: false, points: 0, subjectShare: sectoredShare, firedSubject: null, metrics: null, detail: `sector gate killed — unknownRatio ${(sectors.unknownRatio * 100).toFixed(1)}% > ${K.C3_UNKNOWN_KILL * 100}% — not evaluable` };
  // units: name-risk entities that resolved to a sector (a thematic basket would join here under §14).
  const unitW = entityLedger.filter((e) => e.sector != null).map((e) => e.weight / sectoredShare); // renorm within sectoredShare
  const sumU2 = unitW.reduce((s, w) => s + w * w, 0);
  const neffUnit = sumU2 > 0 ? 1 / sumU2 : 0;
  const sectorW = sectors.sectorWeights.map((s) => s.weight / sectoredShare); // renorm within sectoredShare
  const sumS2 = sectorW.reduce((s, w) => s + w * w, 0);
  const neffSector = sumS2 > 0 ? 1 / sumS2 : 0;
  const target = Math.min(K.C4_TARGET, neffUnit);
  // (Stage 7) both Neffs survive a CLEAN rule here — the anti-double-charge case (every unit in its own
  // sector) is exactly when C4 is clean, so `neffUnit` was previously readable only from `detail` prose.
  // `neffUnit` is UNITS = entities post-aggregation (§15), never positions — hence `neffUnitSectored`.
  const metrics: CMetrics = { neff: neffSector, target, neffUnit };
  if (neffSector >= target) return { rule: "C4", evaluable: true, points: 0, subjectShare: sectoredShare, firedSubject: null, metrics, detail: `Neff_unit ${neffUnit.toFixed(2)} → target ${target.toFixed(2)} ≤ Neff_sector ${neffSector.toFixed(2)} — clean (units in distinct sectors)` };
  const points = Math.min(K.C4_RATE * (target - neffSector), K.C4_CAP) * sectoredShare;
  return { rule: "C4", evaluable: true, points, subjectShare: sectoredShare, firedSubject: { kind: "breadth" }, metrics, detail: `${unitW.length} units · Neff_unit ${neffUnit.toFixed(2)} target ${target.toFixed(2)} · Neff_sector ${neffSector.toFixed(2)} · ${K.C4_RATE}×${(target - neffSector).toFixed(2)}×${sectoredShare.toFixed(3)} → −${points.toFixed(2)}` };
}

/** C5 — FUND-HOUSE DOMINANCE. Subject: FUND PRODUCTS (basket ∪ commodity) with a resolved house
 *  (ODL cv2-s5-c5-commodity). Denominator: the WHOLE BOOK. Fund products whose house did not resolve
 *  are EXCLUDED from the numerator and pooled as houseUnknown; when houseUnknown > C5_HOUSE_UNKNOWN_KILL
 *  × fundShare, C5 is NOT EVALUABLE (we cannot read house concentration honestly). No fund products at
 *  all → not evaluable. Commodity stays outside C1/C2 (not an entity) and C3/C4 (no sector) — only C5. */
export function c5Of(holdings: EntityInput[], totalValue: number): CDeduction {
  let fundShare = 0, houseUnknownShare = 0;
  const byHouse = new Map<string, number>();
  for (const h of holdings) {
    const nat = natureOf(h.assetClass ?? "unknown", h.category ?? null);
    if (nat !== "basket" && nat !== "commodity") continue; // fund products only (baskets + gold/silver ETFs)
    const w = totalValue > 0 ? h.marketValue / totalValue : 0;
    fundShare += w;
    const house = h.fundHouse ?? null;
    if (house == null) houseUnknownShare += w;
    else byHouse.set(house, (byHouse.get(house) ?? 0) + w);
  }
  // (Stage 7) houseUnknownShare is §12's `houseUnknownShare` — measured HERE and nowhere else. It was a
  // local: the engine could not report it without re-running this loop (one fact, two homes). Now the
  // rule that measures it owns it, and construction_data PROJECTS it.
  if (fundShare <= 0) return { rule: "C5", evaluable: false, points: 0, subjectShare: 0, firedSubject: null, metrics: null, detail: "no fund products — not evaluable" };
  // (Stage 9) measured before the gates, so `maxHousePct` rides EVERY branch — raw and uncapped (C5's
  // 25-point cap binds at 60.8%; an 80% single-house book is still 80%). PC6/PC7 (new, doc 2) read this.
  let maxPct = 0, maxHouse = "";
  for (const [house, w] of byHouse) { const p = w * 100; if (p > maxPct) { maxPct = p; maxHouse = house; } }
  const metrics: CMetrics = { houseUnknown: houseUnknownShare, maxHousePct: maxPct, maxHouseName: maxHouse };
  if (houseUnknownShare > K.C5_HOUSE_UNKNOWN_KILL * fundShare)
    return { rule: "C5", evaluable: false, points: 0, subjectShare: fundShare, firedSubject: null, metrics, detail: `house-unknown ${(houseUnknownShare * 100).toFixed(1)}% > ${K.C5_HOUSE_UNKNOWN_KILL}×fundShare ${(fundShare * 100).toFixed(1)}% — not evaluable` };
  if (maxPct <= K.C5_THRESH) return { rule: "C5", evaluable: true, points: 0, subjectShare: fundShare, firedSubject: null, metrics, detail: `top house ${maxHouse} ${maxPct.toFixed(1)}% ≤ ${K.C5_THRESH}% — clean` };
  const points = Math.min(K.C5_RATE * (maxPct - K.C5_THRESH), K.C5_CAP);
  return { rule: "C5", evaluable: true, points, subjectShare: fundShare, firedSubject: { kind: "house", label: maxHouse, weight: maxPct / 100 }, metrics, detail: `${maxHouse} ${maxPct.toFixed(1)}% > ${K.C5_THRESH}% → −${points.toFixed(2)}${points >= K.C5_CAP ? ` (capped — the CHARGE stops here; ${maxPct.toFixed(1)}% remains the truth)` : ""}` };
}

/** C6 — MONITORABILITY. Subject: holding count (positions) — ALWAYS the whole book. Always evaluable.
 *  Deliberately mild. */
export function c6Of(positionCount: number): CDeduction {
  if (positionCount <= K.C6_THRESH) return { rule: "C6", evaluable: true, points: 0, subjectShare: 1, firedSubject: null, metrics: null, detail: `${positionCount} ≤ ${K.C6_THRESH} holdings — clean` };
  const points = Math.min(K.C6_RATE * (positionCount - K.C6_THRESH), K.C6_CAP);
  return { rule: "C6", evaluable: true, points, subjectShare: 1, firedSubject: { kind: "count", count: positionCount }, metrics: null, detail: `${positionCount} > ${K.C6_THRESH} holdings → −${points.toFixed(2)}` };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// EXPOSURES + ARCHETYPE (Construction v2 Stage 6, §9.4 / doc 2 §4.1) — the DESCRIPTIVE composition read.
// Purely descriptive: never good/bad, never scored, never compared to another user. Asset mix is
// DESCRIBED (the archetype label), never a deduction (§3 — there is no correct equity/debt ratio).
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** Composition shares over the whole book — the SINGLE SOURCE for every share the model quotes.
 *  `Sleeves` is a projection of this (see `sleevesOf`), not a parallel sum; `debt`/`commodity`
 *  are the economic reads the archetype needs. A holding can count toward more than one (a bond is
 *  name-risk AND debt) — these are OVERLAPPING exposure lenses, not a partition. */
export interface Exposures {
  nameRisk: number;  // Σ w over name-risk (stock/bond/reit/invit)
  basket: number;    // Σ w over baskets (funds + non-commodity ETFs)
  debt: number;      // Σ w over bonds + gsec + "Debt Scheme" funds/ETFs (economic debt)
  commodity: number; // Σ w over commodity (gold/silver ETFs) + SGB
}

// A DEBT fund/ETF by AMFI category. NOTE (ODL cv2-s6-archetype): AMFI labels ETFs "Other Scheme", so a
// debt ETF is not distinguishable from an equity one by category — only bond/gsec (by asset_class) and
// "Debt Scheme" MUTUAL FUNDS resolve as debt. A documented gap (debt ETFs rare in retail books); we do
// NOT guess an ETF's asset class from its name.
const DEBT_CATEGORY = /\bDebt Scheme\b/i;

export function buildExposures(holdings: EntityInput[], totalValue: number): Exposures {
  let nameRisk = 0, basket = 0, debt = 0, commodity = 0;
  for (const h of holdings) {
    const w = totalValue > 0 ? h.marketValue / totalValue : 0;
    const ac = h.assetClass ?? "unknown";
    const nat = natureOf(ac, h.category ?? null);
    if (nat === "name_risk") nameRisk += w;
    else if (nat === "basket") basket += w;
    if (ac === "bond" || ac === "gsec" || ((ac === "mutual_fund" || ac === "etf") && DEBT_CATEGORY.test(h.category ?? ""))) debt += w;
    if (nat === "commodity" || ac === "sgb") commodity += w;
  }
  return { nameRisk, basket, debt, commodity };
}

/** The archetype labels (§9.4). Descriptive composition, never a score. */
export type Archetype = "Income-led" | "Commodity-led" | "Stock-led" | "Fund-led" | "Blended";

/** Archetype by the §9.4 order — 1–2 ask WHAT you own economically, 3–4 ask HOW you hold it. A 100%
 *  bond book is both name-risk and income → Income-led WINS (the truer sentence). Thresholds in K. */
export function archetypeOf(e: Exposures): Archetype {
  if (e.debt >= K.ARCHETYPE_DEBT_MIN) return "Income-led";           // 1
  if (e.commodity >= K.ARCHETYPE_COMMODITY_MIN) return "Commodity-led"; // 2
  if (e.nameRisk >= K.ARCHETYPE_NAMERISK_MIN) return "Stock-led";    // 3
  if (e.basket >= K.ARCHETYPE_BASKET_MIN) return "Fund-led";         // 4
  return "Blended";                                                  // 5
}

/** The full Construction decomposition. `net` is the DISPLAYED number (persist writes it into the
 *  `structure` column §8); `gross` persists as decomposition only, never shown as a competing score.
 *  `archetype`/`exposures` are the descriptive composition read (§9.4). */
export interface ConstructionResult {
  gross: GrossResult;
  c3: CDeduction;
  c4: CDeduction;
  c5: CDeduction;
  c6: CDeduction;
  net: number; // max(0, Gross − C3 − C4 − C5 − C6)
  archetype: Archetype;
  exposures: Exposures;
}

/** Net = max(0, Gross − C3 − C4 − C5 − C6). A not-evaluable rule contributes 0 (nothing to deduct),
 *  while its ledger still records WHY. Construction = Net. */
export function netOf(gross: number, c3: CDeduction, c4: CDeduction, c5: CDeduction, c6: CDeduction): number {
  return Math.max(0, gross - c3.points - c4.points - c5.points - c6.points);
}

/** (Stage 6 · extended Stage 7 §12) the flat, self-contained shape persisted to `construction_data` and
 *  served to the FE. The FE renders the evaluability panel + ShapePicture from
 *  `rules[].firedSubject`/`subjectShare`/`evaluable`/`metrics` — NEVER by parsing `detail`.
 *
 *  (Stage 7 ruling) THIS JSONB IS THE SINGLE PERSISTED HOME for the Construction decomposition. §12 lists
 *  its contents as "new fields"; they land HERE, not as columns beside it. Zero new columns: a speculative
 *  column is a second home for a fact that already lives here, and a fact with two homes drifts — that is
 *  exactly what produced a served 55.01 against an engine 32.38. The ONE derived projection is the
 *  pre-existing `structure` column (= `net`), assigned from this same object in the same write and
 *  asserted equal per row. `band` and each rule's tri-state `state` are NOT here: both are pure functions
 *  (of `net`, and of `evaluable`+`points`) computed at read. A fact with zero homes cannot drift.
 *
 *  NOT here, deliberately (ODL `cv2-s7-refuse-live-facts`): `unvaluedShare` / `unvaluedValue` /
 *  `provisionalConstruction`. §12 lists them; they are LIVE facts — whether a symbol is valuable is
 *  something the catalog can learn tomorrow. Freezing them into an append-only row manufactures the very
 *  staleness bug this stage exists to kill. The disclosure read serves them fresh. */
export interface ConstructionData {
  gross: number;
  net: number;
  archetype: Archetype;
  exposures: Exposures; // §12's nameRiskShare/basketShare live here — Sleeves is a projection of this
  rules: CDeduction[]; // §12's `constructionLedger` — [C1…C6] in order
  /** §12's `entityLedger` — every aggregated entity + its resolved sector. THIS powers the NTPC story
   *  (PC3): one 19% issuer built from a stock and a bond, which no position-level view can show. */
  entities: EntityLedgerEntry[];
  /** (Stage 9) every held BASKET — the mirror of `entities`, which never aggregates a fund. PB6 ("Funds
   *  occupying one exposure") groups these by `category`; PC6/PC7 name the constituent funds of a
   *  dominant `fundHouse`. Without it those findings would have to re-derive the fund set from `rules`,
   *  which carries only C5's AGGREGATE house shares — a second, lossy computation of a fact C5 already
   *  looped over. Not scored: a ledger, like `entities`. */
  baskets: BasketEntry[];
  /** §12's neffEntity / neffPosSectored / neffSector. PROJECTED from the rules that measure them
   *  (`rules[C2].metrics` / `rules[C4].metrics`) — never recomputed. `unitSectored` is §12's
   *  `neffPosSectored` RENAMED: the value is entity-aggregated UNITS, not positions, and a name that
   *  lies invites a future "fix" back to positions — which would break the anti-double-charge guarantee.
   *  null ⇔ the measuring rule was not evaluable (no subject ⇒ nothing measured — never a fabricated 0). */
  neff: { entity: number | null; unitSectored: number | null; sector: number | null };
  /** §12's unknownSectorRatio + houseUnknownShare. `houseUnknown` is projected from `rules[C5].metrics`. */
  shares: { unknownSectorRatio: number; houseUnknown: number | null };
  /** §12's `holdingCount` — COPY INPUT ONLY, never a badge (§9.4). POSITIONS, not entities: it is the
   *  count of things the user actually tracks. */
  holdingCount: number;
  /** (Stage 9) THE COVERAGE COUNTS' scored half — the "N" in the read's "Covers N of M holdings · c% of
   *  book value". It lives HERE, beside `holdingCount` (the "M"), for one reason: **both must be counted
   *  over the same population `totalValue` sums** — the AGGREGATED `holdings`, after the same instrument
   *  held in two accounts has been collapsed into one exposure.
   *
   *  It used to be a live `prisma.holding.count(...)` in the controller — the MANUAL table only — printed
   *  in the same sentence as a `coverage` computed over the UNION. Two populations, one sentence:
   *  `e3c6bd3c` rendered "Covers 1 of 1 holdings · 100% of book value" while holding THREE positions
   *  (four broker rows invisible to the count, fully present in the %); `7985d813` said "7 of 10" against
   *  a 12-holding book. Counting it over the raw union does not fix it either — that is a THIRD
   *  population (13 positions vs 12 holdings), because it skips the aggregation. The only set that
   *  matches the % is the one the % is made of.
   *
   *  Frozen with the snapshot, deliberately: `coverage` is frozen, so a LIVE count beside it would drift
   *  from it between recomputes. They move together or they lie together — never separately. (§12's
   *  zero-new-columns ruling puts it in this JSONB rather than a column; it rides beside `holdingCount`,
   *  which §12 already placed here.) */
  scoredCount: number;
}

/** Assemble the persisted decomposition. Every field is READ from the engine's already-computed values —
 *  nothing here re-derives a number. `sectors` and `holdingCount` are passed in rather than stored on
 *  ConstructionResult so they keep exactly one home (the engine's own locals). */
export function constructionDataOf(
  c: ConstructionResult,
  entities: EntityLedgerEntry[],
  baskets: BasketEntry[],
  sectors: SectorResolution,
  holdingCount: number,
  scoredCount: number,
): ConstructionData {
  const rules = [c.gross.c1, c.gross.c2, c.c3, c.c4, c.c5, c.c6];
  const m = (rule: string) => rules.find((r) => r.rule === rule)?.metrics ?? null;
  const c2m = m("C2"), c4m = m("C4"), c5m = m("C5");
  return {
    gross: c.gross.value,
    net: c.net,
    archetype: c.archetype,
    exposures: c.exposures,
    rules,
    entities,
    baskets,
    neff: {
      entity: c2m?.neff ?? null,
      unitSectored: c4m?.neffUnit ?? null,
      sector: c4m?.neff ?? null,
    },
    shares: { unknownSectorRatio: sectors.unknownRatio, houseUnknown: c5m?.houseUnknown ?? null },
    holdingCount,
    scoredCount,
  };
}
