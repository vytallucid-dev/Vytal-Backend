// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCREEN SERVICE — numeric conditions over the universe. PURE: view in, values in, result out.
//
// Sibling of universe-projection.service.ts and shares its spine deliberately: the same `buildReadSet`
// (so scoping is one implementation), the same `periodContract` (so a filtered list still cannot be
// relayed as a single-quarter claim), the same `capped` and `LIST_CAP`, the same `parseBand`, the same
// `percentile` as slice=overview, and the same no-internal-identifiers assertion on the way out.
//
// ── ★ THE TWO TIERS, AND WHY ONLY ONE OF THEM COSTS ANYTHING ───────────────────────────────────────
// Score-level and structural conditions (health, the four pillars, band, sector, red-flag presence)
// read fields ALREADY on the cached UniverseHealthView member row. Ten of them cost exactly what one
// costs: a single pass over ~94 objects. Metric conditions need `metricValues`, which is one extra
// round trip for ALL keys at once (metric-values.cache.ts) — never one per condition.
//
// ── ★ AND-COMPOSITION, WITH THE DENOMINATOR CARRIED ────────────────────────────────────────────────
// Conditions compose with AND. The subtlety is not the boolean — it is that "did not match" and
// "could not be tested" are different answers and must not collapse. A bank has no return-on-equity
// row because it is scored on a different metric family; dropping it silently would report a screen
// over 82 companies as though it ran over 94. So every company is classified into exactly one of
// { matched, did-not-match, not-evaluable-and-why } and the counts ship with the result.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { CANONICAL_METRICS } from "../bars-loader/label-map.js";
import { METRIC_DEFINITIONS } from "../metric-scoring/definition-guard.js";
import { percentile } from "./scope-aggregate.js";
import {
  LIST_CAP,
  buildReadSet,
  capped,
  parseBand,
  periodContract,
  assertNoInternalIdentifiers,
  type UniverseReadSet,
} from "./universe-projection.service.js";
import { BAND_LABEL, type Capped, type CompanyRef, type UniverseScopeId } from "./universe-projection.types.js";
import type { UniverseHealthView, UniverseMemberView } from "./universe-view.types.js";
import type { UniverseMetricValues } from "./metric-values.cache.js";
import {
  SCREEN_FIELDS,
  type AppliedCondition,
  type Evaluable,
  type EvaluableReason,
  type FieldSpread,
  type MatchesResult,
  type ScreenCondition,
  type ScreenField,
  type ScreenFieldId,
  type ScreenProjection,
  type ScreenRequest,
  type ScreenRow,
  type ScreenValue,
  type SpreadResult,
  type StructuralFilters,
} from "./screen.types.js";

const round2 = (x: number): number => Math.round(x * 100) / 100;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE OPERATING-MARGIN UNION, ASSERTED RATHER THAN ASSUMED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `operatingMargin` is the one field that unions two engine keys. It is legitimate ONLY because the
 * engine itself pins them as the same definition — `definition-guard.ts` gives M1_OPM_TTM the
 * signature "= M1 (the SHARED EBITDA m1TtmOpm, emit-renamed)" and the explicit rejects-line "a
 * separate PG8-only OPM definition (there is none — M1 and M1_OPM_TTM are identical)".
 *
 * ⚠ IF THAT EVER STOPS BEING TRUE, THE UNION SILENTLY BLENDS TWO DEFINITIONS and seven Power-pond
 * companies get an operating margin computed a different way from everyone else's, with nothing on
 * screen to say so. That is precisely the class of failure definition-guard.ts exists to catch, so
 * this asserts against the guard rather than trusting a comment: module load fails loudly instead.
 */
function assertOperatingMarginUnionStillValid(): void {
  const alias = METRIC_DEFINITIONS.M1_OPM_TTM;
  if (!alias || !/=\s*M1\b/.test(alias.signature)) {
    throw new Error(
      "screen.service: operatingMargin unions M1 and M1_OPM_TTM, which is valid only while " +
        "definition-guard.ts pins M1_OPM_TTM as identical to M1. That pin is gone — split the field " +
        "or drop the union before shipping.",
    );
  }
}
assertOperatingMarginUnionStillValid();

/** Engine keys the registry marks as the BANKING family — used only to explain a not-evaluable. */
const BANKING_KEYS: ReadonlySet<string> = new Set(
  CANONICAL_METRICS.filter((m) => m.industry === "banking").map((m) => m.key),
);

/**
 * Is this company measured on the banking metric family? Read from the values it actually carries,
 * not from a sector label — so the sentence "measured on banking metrics instead" is provably true of
 * the company it is said about, rather than inferred from a display name that could be renamed.
 */
function isBankingMeasured(symbol: string, values: UniverseMetricValues): boolean {
  const forSymbol = values.get(symbol);
  if (!forSymbol) return false;
  for (const k of forSymbol.keys()) if (BANKING_KEYS.has(k)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FIELD VALUE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * This company's value for one field, or null when it is not measured on it.
 *
 * ★ null MEANS NOT-MEASURED AND NOTHING ELSE. It never means zero. `metric-values.cache.ts` omits
 * non-finite raw values rather than storing them, so a null here is always the honest state.
 */
function valueOf(m: UniverseMemberView, field: ScreenField, values: UniverseMetricValues): number | null {
  if (field.tier === "score") {
    if (field.id === "health") return m.composite;
    const sub = m.pillars[field.id as "foundation" | "momentum" | "market" | "ownership"];
    return typeof sub === "number" && Number.isFinite(sub) ? sub : null;
  }
  const forSymbol = values.get(m.symbol);
  if (!forSymbol) return null;
  // First key wins. Multi-key fields are RENAMES of one definition, never a blend — see the assert above.
  for (const k of field.metricKeys ?? []) {
    const v = forSymbol.get(k);
    if (v !== undefined) return v;
  }
  return null;
}

/** A value as it will be said. Rounded once, here, so a row and a spread can never disagree. */
const say = (x: number): number => round2(x);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EVALUABILITY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Why this company could not be tested. Two genuinely different causes, two different sentences —
 * collapsing them into "no data" would make a structural fact look like a gap in Vytal.
 */
function reasonFor(m: UniverseMemberView, field: ScreenField, values: UniverseMetricValues): string {
  if (isBankingMeasured(m.symbol, values)) {
    return `measured on banking metrics instead — ${field.label} is not one of them, so these are not comparable on it`;
  }
  return `not scored on ${field.label} in its peer group — Vytal measures these companies on a different set`;
}

/**
 * Not-evaluable companies are named, but more tightly than a match list.
 *
 * ★ SIX, NOT LIST_CAP. The count is the load-bearing fact ("12 could not be tested"); the names are
 * there so the claim is concrete and checkable. Naming all twelve banks costs ~380 characters, and a
 * spread over two metric fields would print the same twelve twice. Six names plus "and N more" makes
 * the point at half the width, and `Capped` still carries the true total so nothing is hidden.
 */
const REASON_CAP = 6;

function buildEvaluable(
  considered: UniverseMemberView[],
  evaluableMembers: UniverseMemberView[],
  blocked: { member: UniverseMemberView; reason: string }[],
): Evaluable {
  const byReason = new Map<string, UniverseMemberView[]>();
  for (const b of blocked) {
    const a = byReason.get(b.reason) ?? [];
    a.push(b.member);
    byReason.set(b.reason, a);
  }
  const reasons: EvaluableReason[] = [...byReason.entries()]
    .map(([reason, members]) => ({
      reason,
      count: members.length,
      companies: capped(members.map(refOf), REASON_CAP),
    }))
    .sort((a, b) => b.count - a.count);
  return {
    considered: considered.length,
    evaluable: evaluableMembers.length,
    notEvaluable: considered.length - evaluableMembers.length,
    reasons,
  };
}

const refOf = (m: UniverseMemberView): CompanyRef => ({ symbol: m.symbol, name: m.name });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STRUCTURAL FILTERS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Distinct sector display names in the read set, alphabetical — the real vocabulary for a miss. */
function sectorsIn(set: UniverseReadSet): string[] {
  const s = new Set<string>();
  for (const m of set.members) if (m.sector) s.add(m.sector.displayName);
  return [...s].sort();
}

function matchSector(m: UniverseMemberView, wanted: string): boolean {
  return m.sector != null && norm(m.sector.displayName) === norm(wanted);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Run a screen. `symbols === null` is the whole scored universe; a set is the caller's OWN scope,
 * resolved one layer up from ctx.userId and never named here.
 */
export function screenUniverse(
  view: UniverseHealthView,
  metricValues: UniverseMetricValues,
  symbols: ReadonlySet<string> | null,
  req: ScreenRequest,
): ScreenProjection {
  const scope: UniverseScopeId = req.scope ?? "universe";
  const set = buildReadSet(view, symbols, scope);
  if (!set) {
    const reason = !view.scored || !view.aggregate ? "universe-unscored" : "scope-empty";
    return { kind: "empty", scope, reason };
  }
  const out = run(set, metricValues, req, scope);
  assertNoInternalIdentifiers(out);
  return out;
}

function run(
  set: UniverseReadSet,
  values: UniverseMetricValues,
  req: ScreenRequest,
  scope: UniverseScopeId,
): ScreenProjection {
  const period = periodContract(set);

  // ── structural narrowing first: it is free, and it shrinks the metric work ──────────────────────
  let members = set.members;
  const structural: StructuralFilters = { band: null, sector: null, redFlags: null };

  if (req.band !== undefined && req.band !== null && String(req.band).trim() !== "") {
    const parsed = parseBand(String(req.band));
    if (!parsed) {
      // ★ NEVER MAP AN UNKNOWN WORD ONTO THE NEAREST BAND. That is the guess this build refuses.
      return { kind: "unrecognised", scope, what: "band", given: String(req.band), available: Object.values(BAND_LABEL) };
    }
    structural.band = BAND_LABEL[parsed];
    members = members.filter((m) => m.labelBand === parsed);
  }

  if (req.sector !== undefined && req.sector !== null && String(req.sector).trim() !== "") {
    const wanted = String(req.sector);
    const known = sectorsIn(set);
    if (!known.some((s) => norm(s) === norm(wanted))) {
      return { kind: "unrecognised", scope, what: "sector", given: wanted, available: known };
    }
    structural.sector = known.find((s) => norm(s) === norm(wanted)) ?? wanted;
    members = members.filter((m) => matchSector(m, wanted));
  }

  if (req.redFlags === "none" || req.redFlags === "any") {
    structural.redFlags = req.redFlags;
    members = members.filter((m) => (req.redFlags === "none" ? m.firedFlags.length === 0 : m.firedFlags.length > 0));
  }

  // ── the conditions ─────────────────────────────────────────────────────────────────────────────
  const conditions = req.conditions ?? [];
  const bounded = conditions.filter((c) => c.min != null || c.max != null);
  const unbounded = conditions.filter((c) => c.min == null && c.max == null);

  // ★ ANY unbounded condition makes this a SPREAD request. A reader who said "good ROE and debt under
  //   1" gets the ROE spread back and keeps their own number for debt — answering half of it with an
  //   invented threshold for the other half would be the exact failure this shape exists to prevent.
  if (unbounded.length > 0) return spreadResult(members, values, unbounded, period, structural, scope);

  return matchesResult(members, values, bounded, period, structural, scope, req.sort ?? "health");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// MATCHES
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function matchesResult(
  considered: UniverseMemberView[],
  values: UniverseMetricValues,
  conditions: ScreenCondition[],
  period: MatchesResult["period"],
  structural: StructuralFilters,
  scope: UniverseScopeId,
  sort: "health" | "field",
): MatchesResult {
  const fields = conditions.map((c) => SCREEN_FIELDS[c.field]);

  // Per-condition evaluable counts — so a reply can attribute WHICH condition narrowed the set.
  const applied: AppliedCondition[] = conditions.map((c, i) => ({
    field: c.field,
    label: fields[i].label,
    unit: fields[i].unit,
    min: c.min ?? null,
    max: c.max ?? null,
    evaluable: considered.filter((m) => valueOf(m, fields[i], values) !== null).length,
  }));

  // Classify every company into exactly one of: not-evaluable / matched / did-not-match.
  const blocked: { member: UniverseMemberView; reason: string }[] = [];
  const evaluableMembers: UniverseMemberView[] = [];
  const matched: ScreenRow[] = [];

  for (const m of considered) {
    let firstMiss: ScreenField | null = null;
    const resolved: (number | null)[] = [];
    for (const f of fields) {
      const v = valueOf(m, f, values);
      resolved.push(v);
      if (v === null && firstMiss === null) firstMiss = f;
    }
    if (firstMiss) {
      // Not testable against every condition asked for — reported, never dropped.
      blocked.push({ member: m, reason: reasonFor(m, firstMiss, values) });
      continue;
    }
    evaluableMembers.push(m);

    const passes = conditions.every((c, i) => {
      const v = resolved[i] as number;
      if (c.min != null && v < c.min) return false;
      if (c.max != null && v > c.max) return false;
      return true;
    });
    if (!passes) continue;

    matched.push({
      symbol: m.symbol,
      name: m.name,
      score: say(m.composite),
      band: BAND_LABEL[m.labelBand],
      // ★ every applied condition's value, on the row. See ScreenRow's comment for the measured reason.
      values: conditions.map((c, i): ScreenValue => ({
        field: c.field,
        label: fields[i].label,
        value: say(resolved[i] as number),
        unit: fields[i].unit,
      })),
    });
  }

  // ── ordering ───────────────────────────────────────────────────────────────────────────────────
  // ★ sort=field uses the FIRST condition only. A multi-key ordering is a statement about which
  //   condition matters more, which is a ranking judgement and therefore not Vytal's to make.
  let sortedBy: string;
  if (sort === "field" && fields.length > 0) {
    const f = fields[0];
    const dir = f.higherBetter ? -1 : 1;
    matched.sort((a, b) => dir * (a.values[0].value - b.values[0].value) || a.symbol.localeCompare(b.symbol));
    sortedBy = `${f.label}, ${f.higherBetter ? "highest" : "lowest"} first`;
  } else {
    matched.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    sortedBy = "health score, highest first";
  }

  return {
    kind: "matches",
    scope,
    period,
    conditions: applied,
    structural,
    evaluable: buildEvaluable(considered, evaluableMembers, blocked),
    matches: capped(matched, LIST_CAP) as Capped<ScreenRow>,
    sortedBy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SPREAD — the answer to a threshold that was never named
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function spreadResult(
  considered: UniverseMemberView[],
  values: UniverseMetricValues,
  unbounded: ScreenCondition[],
  period: SpreadResult["period"],
  structural: StructuralFilters,
  scope: UniverseScopeId,
): SpreadResult {
  // De-dupe: asking for the same field's spread twice is one spread.
  const seen = new Set<ScreenFieldId>();
  const spreads: FieldSpread[] = [];

  for (const c of unbounded) {
    if (seen.has(c.field)) continue;
    seen.add(c.field);
    const f = SCREEN_FIELDS[c.field];

    const blocked: { member: UniverseMemberView; reason: string }[] = [];
    const evaluableMembers: UniverseMemberView[] = [];
    const xs: number[] = [];
    for (const m of considered) {
      const v = valueOf(m, f, values);
      if (v === null) {
        blocked.push({ member: m, reason: reasonFor(m, f, values) });
        continue;
      }
      evaluableMembers.push(m);
      xs.push(v);
    }

    // ★ percentile() is scope-aggregate's own — the SAME arithmetic slice=overview publishes for the
    //   composite, so "the middle half sits between…" cannot mean two things in one conversation.
    spreads.push({
      field: f.id,
      label: f.label,
      unit: f.unit,
      higherBetter: f.higherBetter,
      evaluable: buildEvaluable(considered, evaluableMembers, blocked),
      min: xs.length ? say(Math.min(...xs)) : 0,
      p25: xs.length ? say(percentile(xs, 25)) : 0,
      median: xs.length ? say(percentile(xs, 50)) : 0,
      p75: xs.length ? say(percentile(xs, 75)) : 0,
      max: xs.length ? say(Math.max(...xs)) : 0,
    });
  }

  return { kind: "spread", scope, period, spreads, structural };
}
