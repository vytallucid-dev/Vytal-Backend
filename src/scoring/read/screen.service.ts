// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCREEN SERVICE — numeric conditions over the universe. View in, values in, result out.
//
// Sibling of universe-projection.service.ts and shares its spine deliberately: the same `buildReadSet`
// (so scoping is one implementation), the same `periodContract` (so a filtered list still cannot be
// relayed as a single-quarter claim), the same `capped` and `LIST_CAP`, the same `parseBand`, the same
// `percentile` as slice=overview, and the same no-internal-identifiers assertion on the way out.
//
// ── ★ THE ONE PLACE THIS IS NO LONGER PURE, AND WHY IT HAD TO STOP BEING ──────────────────────────
// Everything below `run` is still pure. `screenUniverse` itself is now async, and reads one table, for
// exactly one filter: `redFlags`.
//
// `m.firedFlags` is projected from score_red_flags. NOTHING WRITES THAT TABLE ANY MORE — every
// red-flag rule (R1…R6) is a filing rule and moved to stock_findings at migration 20260809120000. The
// 215 rows still in it are frozen on whatever head each stock was sitting on at cutover, and no
// rescore un-writes them. Measured on live data, the frozen set and the live one AGREE TODAY: the same
// six companies, on the same four keys. That agreement is a coincidence of timing and nothing holds it:
//
//   · a scored stock whose R1 fires for the FIRST time writes only to stock_findings, so it would
//     never appear in `redFlags: "any"` — and would be counted as clean by `redFlags: "none"`.
//   · one of today's six resolving writes only to stock_findings too, so its frozen row sits there as
//     a false positive permanently. NAZARA and ATHERENERG have already resolved R6 this way; neither
//     is scored, so neither is visible here yet, but the mechanism is live.
//
// So the filter reads BOTH: the frozen flags on the member row, UNIONED with the live standing filing
// red flags. It is a union rather than a swap because `firedFlags` may also carry a SCORE-channel red
// flag, which the filing channel does not serve and which dropping would erase.
//
// ── ★ THE PREDICATE IS filing/channel.ts's, INVERTED. THERE IS NO KEY LIST HERE. ──────────────────
// Every surface that serves both channels drops filing keys from the score channel with
// `isFilingChannelKey`. This is the same predicate read the other way round — the keys the LIVE side
// owns — so "what the filing pass writes" and "what this filter unions in" cannot drift apart. A
// second hardcoded list is the failure that predicate exists to prevent.
//
// ── ⚠ THE DENOMINATOR DID NOT CHANGE, AND THAT IS THE KNOWN GAP ──────────────────────────────────
// The union is applied to the members this screen can already see — the ~94 SCORED stocks. Filing
// findings exist on all 504, and 51 stocks carry a standing filing red flag today; 45 of them are
// unscored and stay invisible here. Reaching them needs a 504-stock denominator, which is step 5's
// base rates, and is deliberately NOT attempted by widening this filter over a population the rest of
// the projection (composite, band, pillars, percentile) cannot describe.
//
// ── ★ THE TWO TIERS, AND WHY ONLY ONE OF THEM COSTS ANYTHING ───────────────────────────────────────
// Score-level and structural conditions (health, the four pillars, band, sector, red-flag presence)
// read fields ALREADY on the cached UniverseHealthView member row. Ten of them cost exactly what one
// costs: a single pass over ~94 objects. Metric conditions need `metricValues`, which is one extra
// round trip for ALL keys at once (metric-values.cache.ts) — never one per condition. The red-flag
// read is a third, paid ONLY when the redFlags filter is actually asked for, behind the same
// five-minute stale-while-revalidate policy as its two siblings.
//
// ── ★ AND-COMPOSITION, WITH THE DENOMINATOR CARRIED ────────────────────────────────────────────────
// Conditions compose with AND. The subtlety is not the boolean — it is that "did not match" and
// "could not be tested" are different answers and must not collapse. A bank has no return-on-equity
// row because it is scored on a different metric family; dropping it silently would report a screen
// over 82 companies as though it ran over 94. So every company is classified into exactly one of
// { matched, did-not-match, not-evaluable-and-why } and the counts ship with the result.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { isFilingChannelKey } from "../../filing/channel.js";
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
import { SET_TABLE_TRANSPORT } from "../../section/kinds/set-table.js";
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
// THE LIVE RED-FLAG CHANNEL — the only read in this module. See the header for why it exists.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Same five minutes as universe-view.cache.ts and metric-values.cache.ts, for the same reason: the
 *  underlying rows change when a pass runs, not per request, and one cache policy in the read layer
 *  means one failure mode to reason about. */
export const LIVE_RED_FLAGS_TTL_MS = 5 * 60 * 1000;

/**
 * Every symbol carrying a CURRENTLY-STANDING filing red flag.
 *
 * ★ THE CURRENT ROW PER (stock, rule), NOT EVERY ROW. stock_findings accumulates one row per filing
 * period, so a rule that fired last quarter and resolved this one still has its fired row on file.
 * Rows arrive period_end DESC per stock — period_end is the ONLY chronological key, because the
 * grain-prefixed period_key does not sort across A:/Q:/S: — so the FIRST row for a pair is its current
 * state and every later one is history. Exactly the reduction filing/read.ts's `readStandingRedFlags`
 * performs for the portfolio's PS1 input, which is the same question asked of the same table.
 *
 * ★ GROUPED BY stockId, EMITTED BY symbol. The reduction cannot key on `symbol` — two stocks sharing
 * one would interleave their periods and resolve both to whichever filed last. `symbol` is carried
 * only because it is what a member row is identified by here; nothing in this module has a stockId.
 *
 * ⚠ NO ARGUMENTS, and it must not gain any. What it holds is public product data — the same standing
 * red flags the stock page already prints — and a per-scope or per-user variant would put a reader's
 * own scope into a process-wide cache. The scope is applied AFTER this, against `set.members`.
 */
async function loadStandingFilingRedFlagSymbols(): Promise<ReadonlySet<string>> {
  const rows = await prisma.stockFinding.findMany({
    where: { kind: "red_flag" },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, symbol: true, ruleKey: true, evaluationState: true },
  });

  const resolved = new Set<string>();
  const out = new Set<string>();
  for (const r of rows) {
    const pair = `${r.stockId}|${r.ruleKey}`;
    if (resolved.has(pair)) continue; // an older period for a rule already answered
    resolved.add(pair);
    if (r.evaluationState !== "fired") continue;
    // ★ THE REGISTRY, INVERTED — see the header. A red-flag row whose key the filing pass does not own
    //   would be some other channel's, and unioning it here would serve it from a surface that has no
    //   denominator for it.
    if (!isFilingChannelKey(r.ruleKey)) continue;
    out.add(r.symbol);
  }
  return out;
}

let liveCache: { symbols: ReadonlySet<string>; builtAt: number } | null = null;
let liveInFlight: Promise<ReadonlySet<string>> | null = null;

function rebuildLive(): Promise<ReadonlySet<string>> {
  if (liveInFlight) return liveInFlight;
  liveInFlight = loadStandingFilingRedFlagSymbols()
    .then((symbols) => {
      liveCache = { symbols, builtAt: Date.now() };
      return symbols;
    })
    .finally(() => {
      liveInFlight = null;
    });
  return liveInFlight;
}

/** Cold → builds and waits. Warm → cached. Stale → cached NOW, rebuild behind it; a failed rebuild
 *  keeps serving the last good set rather than turning a DB blip into a failed screen. */
async function standingFilingRedFlagSymbols(): Promise<ReadonlySet<string>> {
  if (!liveCache) return rebuildLive();
  if (Date.now() - liveCache.builtAt > LIVE_RED_FLAGS_TTL_MS) {
    rebuildLive().catch(() => {
      /* the last good set keeps serving; the next caller retries */
    });
  }
  return liveCache.symbols;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Run a screen. `symbols === null` is the whole scored universe; a set is the caller's OWN scope,
 * resolved one layer up from ctx.userId and never named here.
 *
 * ★ ASYNC FOR ONE FILTER ONLY. The live red-flag read is skipped entirely unless `redFlags` was
 * actually asked for, so a screen with only metric conditions costs exactly what it always did.
 */
export async function screenUniverse(
  view: UniverseHealthView,
  metricValues: UniverseMetricValues,
  symbols: ReadonlySet<string> | null,
  req: ScreenRequest,
): Promise<ScreenProjection> {
  const scope: UniverseScopeId = req.scope ?? "universe";
  const set = buildReadSet(view, symbols, scope);
  if (!set) {
    const reason = !view.scored || !view.aggregate ? "universe-unscored" : "scope-empty";
    return { kind: "empty", scope, reason };
  }
  const live =
    req.redFlags === "none" || req.redFlags === "any" ? await standingFilingRedFlagSymbols() : null;
  const out = run(set, metricValues, req, scope, live);
  assertNoInternalIdentifiers(out);
  return out;
}

function run(
  set: UniverseReadSet,
  values: UniverseMetricValues,
  req: ScreenRequest,
  scope: UniverseScopeId,
  live: ReadonlySet<string> | null,
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
    // ★ THE UNION — BOTH HALVES ARE NOW LIVE, AND THAT IS THE POINT OF THE 2026-08-11 REPOINT.
    //   `m.firedFlags` used to be the FROZEN score channel, which is why this union existed at all: a
    //   decayed half had to be propped up by a live one. `firedFlags` is now fed by
    //   `readStandingRedFlags` over the same `stock_findings` rows `live` reads, so the two halves
    //   agree by construction rather than by coincidence.
    //
    //   It is kept rather than collapsed to one side, for one reason that is not redundancy: `live`
    //   additionally filters on `isFilingChannelKey` (the registry, inverted), so a red-flag row whose
    //   key the filing pass does not own is admitted by `firedFlags` and rejected by `live`. No such
    //   row exists today. `redFlags: "none"` must still clear BOTH before calling a company clean.
    const firesRedFlag = (m: UniverseMemberView): boolean =>
      m.firedFlags.length > 0 || live?.has(m.symbol) === true;
    members = members.filter((m) => (req.redFlags === "none" ? !firesRedFlag(m) : firesRedFlag(m)));
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
    // ⚠ NOT `LIST_CAP`, AND THE DIFFERENCE IS WHAT A SCREEN IS FOR. `LIST_CAP` is 12 because a
    //   universe SLICE is a sentence — "the six that moved most". A screen result is the answer
    //   itself, and 12 of 33 is a sample presented as a set. `SET_TABLE_TRANSPORT` is the renderer's
    //   own stated budget and the table pages through it. `Capped.total` is unchanged, so "showing N
    //   of M" still tells the truth about the whole match set.
    matches: capped(matched, SET_TABLE_TRANSPORT) as Capped<ScreenRow>,
    // ★ THE SET, NOT THE PAGE. See the field's note — an intersection off a capped list is wrong.
    matchedSymbols: matched.map((m) => m.symbol),
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
