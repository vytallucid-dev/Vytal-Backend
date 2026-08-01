// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE PROJECTION SERVICE — `UniverseHealthView` (21,656 tokens) → one slice (150–950).
//
// PURE. No DB, no user, no chat imports. Given a built view (and optionally a set of symbols to
// intersect with), it returns one of the seven slices in universe-projection.types.ts. Rendering to
// reader-facing text is a SEPARATE seam (chat/universe-brief.ts); tool wiring is a third
// (chat/tools/get-universe-scan.ts). Three seams, because each has a different reason to change.
//
// ── FOUR RULES THIS MODULE ENFORCES, ALL OF THEM CORRECTNESS ───────────────────────────────────────
//
// 1 · EVERY FINDING IS NAMED THROUGH THE CATALOGUE, NEVER KEYED.
//     `pathology[].key` is `ownership_R6_distribution`. A reader has never seen that string and never
//     should. Every name and description here comes from `catalogue/index.js` — the same resolver the
//     stock page and getStockFacts use, a module import, no fetch. `assertNoInternalIdentifiers`
//     re-checks the finished object and THROWS if a key shape survived: the tool layer is fail-soft,
//     so a leak becomes an honest error to the model rather than an identifier in front of a reader.
//
// 2 · lensPathology IS EXCLUDED ENTIRELY, AND THAT IS DELIBERATE.
//     Its keys are `lens_lm3_F7`, `lens_lm7_CASA`, `lens_lp5_foundation` — composed at runtime from a
//     face id and a RAW METRIC CODE. The face has catalogue copy; the metric code does not, and there
//     is no reader-safe name for `F7` anywhere in the product today. Sixteen rows, 704 tokens, and not
//     one of them can be said out loud. Naming the face alone ("Weak Field") would collapse sixteen
//     distinct facts into four indistinguishable ones and misstate all of them. So they are dropped,
//     not renamed and not guessed at. When metric copy exists, this is the line that changes.
//
// 3 · THE §5C DIVERGENCE CONSOLIDATION IS APPLIED (catalogue/divergence.ts).
//     The engine fires four C sub-types; the Flags board shows ONE row. Without this, a reader sees one
//     divergence row on screen and hears "four divergence findings" from the chat about the same
//     universe in the same session. The member count is the DISTINCT UNION across sub-types, not the
//     sum — a company firing C1 and C2 is one company with a divergence, not two.
//
// 4 · THE CENSUS IS RECOMPUTED FROM members[], NOT READ FROM pathology[].
//     Both are in the view and they agree — for the FULL universe. Under a scope they cannot: the
//     census rows carry counts over all 94. Recomputing from the (possibly filtered) member rows makes
//     every slice scope-correct by construction instead of by a second filtering pass that has to be
//     kept in step. Same reason the aggregate is recomputed through `computeScopeAggregate` — the
//     builder's own function — rather than a hand-rolled median.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import {
  consolidateDivergence,
  FAMILY_DOESNT_MEAN,
  familyOf,
  findingDescription,
  findingName,
  doesntMean,
  isDivergenceSubType,
  severityWeight,
  STOCK_FINDING_KEYS,
  CONSOLIDATED_DIVERGENCE_KEY,
} from "../../catalogue/index.js";
import { computeScopeAggregate, type ScopeMember } from "./scope-aggregate.js";
import type { LabelBand, PillarKey } from "./health-view.types.js";
import type {
  UniverseHealthView,
  UniverseMemberView,
  UniverseAggregate,
  UniverseSinceLastWeek,
} from "./universe-view.types.js";
import {
  BAND_LABEL,
  BAND_ORDER,
  PILLAR_LABEL,
  type BandSlice,
  type Capped,
  type CensusRow,
  type CensusSlice,
  type CompanyRef,
  type DivergenceSlice,
  type EmptySlice,
  type FindingDetail,
  type FindingSlice,
  type MoverRow,
  type MoversSlice,
  type OverviewSlice,
  type PeriodContract,
  type ScoredCompany,
  type UniverseProjection,
  type UniverseProjectionRequest,
  type UniverseScopeId,
  type WeekMove,
  type WeekSlice,
} from "./universe-projection.types.js";

// ── caps ───────────────────────────────────────────────────────────────────────────────────────────
/** Every list slice's cap. Twelve is enough to name a group and short enough to stay a sentence. */
export const LIST_CAP = 12;
/** Movers keep the ten the service already computes — matching, not re-deriving, the page's own top-10. */
export const MOVER_CAP = 10;

/** ★ EXPORTED for screen.service.ts. One `Capped` constructor, so "showing N of M" cannot come to mean
 *  two things on two surfaces. */
export const capped = <T>(all: readonly T[], cap: number): Capped<T> => ({ total: all.length, shown: all.slice(0, cap) });

const PILLAR_ORDER: readonly PillarKey[] = ["foundation", "momentum", "market", "ownership"];

/** Normalise for name matching: case, punctuation and spacing all irrelevant. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Resolve a band word the caller typed ("pristine", "Below Par", "below-par") to a LabelBand.
 *  ★ EXPORTED for screen.service.ts — a second band parser is how "Below Par" stops resolving on
 *  exactly one surface. */
export function parseBand(input: string): LabelBand | null {
  const n = norm(input);
  for (const b of BAND_ORDER) if (norm(BAND_LABEL[b]) === n || norm(b) === n) return b;
  return null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READ SET — one scoped-or-unscoped view of the universe, from which every slice is projected.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface UniverseReadSet {
  scope: UniverseScopeId;
  members: UniverseMemberView[];
  aggregate: UniverseAggregate;
  sinceLastWeek: UniverseSinceLastWeek;
  notRescored: { symbol: string; latestPeriod: string }[];
  asOfDate: string | null;
}

/**
 * Build the read set. `symbols === null` means the whole scored universe (the view is used as built);
 * a set intersects it.
 *
 * ★ THE INTERSECTION IS PURE AND TAKES NO USER. Who the symbols belong to is resolved one layer up,
 * from ctx.userId, and never enters this module. See get-universe-scan.ts.
 *
 * The scoped aggregate goes through `computeScopeAggregate` — the SAME function
 * buildUniverseHealthView calls — so a scoped median and a universe median can never be two different
 * arithmetics. `priorPeriodKey` is dropped (it is a plurality label; nothing downstream may read it).
 */
export function buildReadSet(
  view: UniverseHealthView,
  symbols: ReadonlySet<string> | null,
  scope: UniverseScopeId,
): UniverseReadSet | null {
  if (!view.scored || !view.aggregate) return null;

  if (symbols === null) {
    return {
      scope,
      members: view.members,
      aggregate: view.aggregate,
      sinceLastWeek: view.sinceLastWeek,
      notRescored: view.notAtCurrentPeriod,
      asOfDate: view.asOfDate,
    };
  }

  const members = view.members.filter((m) => symbols.has(m.symbol));
  if (members.length === 0) return null;

  const scopeMembers: ScopeMember[] = members.map((m) => ({
    stockId: m.symbol, // identity is only used for counting here; symbol is unique in the cross-section
    symbol: m.symbol,
    composite: m.composite,
    labelBand: m.labelBand,
    pillars: m.pillars,
    firesAnyRedFlag: m.firedFlags.length > 0,
    weight: 1,
  }));
  const agg = computeScopeAggregate(scopeMembers);

  // Prior median for the scope, reconstructed from each member's own trajectory delta — its OWN
  // prior quarter, never the universe's. Members without a prior quarter simply do not contribute.
  const priors = members.filter((m) => m.trajectoryDelta != null).map((m) => m.composite - (m.trajectoryDelta as number));
  const priorMedian = priors.length ? median(priors) : null;

  const w = view.sinceLastWeek;
  const bandCrossings = w.bandCrossings.filter((c) => symbols.has(c.symbol));
  const newFlags = w.newFlags.filter((f) => symbols.has(f.symbol));
  const newDeteriorations = w.newDeteriorations.filter((d) => symbols.has(d.symbol));
  const newRecoveries = w.newRecoveries.filter((r) => symbols.has(r.symbol));
  // `newVersionCount` has no per-symbol list on the view, so it becomes an honest LOWER BOUND: the
  // distinct in-scope names we can SEE changed. Never over-counts. (Same rule as the Hub's own
  // browser-side scoping, deliberately.)
  const seen = new Set<string>();
  for (const x of bandCrossings) seen.add(x.symbol);
  for (const x of newFlags) seen.add(x.symbol);
  for (const x of newDeteriorations) seen.add(x.symbol);
  for (const x of newRecoveries) seen.add(x.symbol);

  return {
    scope,
    members,
    aggregate: {
      ...view.aggregate,
      scoredCount: agg.scoredCount,
      medianComposite: agg.medianComposite,
      meanComposite: agg.meanComposite,
      priorMedianComposite: priorMedian,
      medianDrift: priorMedian != null ? round2(agg.medianComposite - priorMedian) : null,
      priorPeriodKey: null,
      dispersion: agg.dispersion,
      range: agg.min && agg.max ? { min: agg.min, max: agg.max } : null,
      composites: agg.composites,
      bandDistribution: agg.bandDistribution as UniverseAggregate["bandDistribution"],
      pillarMedians: agg.pillarMedians,
      redFlagMemberCount: agg.redFlagMemberCount,
    },
    sinceLastWeek: { ...w, bandCrossings, newFlags, newDeteriorations, newRecoveries, newVersionCount: seen.size },
    notRescored: view.notAtCurrentPeriod.filter((x) => symbols.has(x.symbol)),
    asOfDate: view.asOfDate,
  };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return round2(n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERIOD CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ Counted from each member's OWN `periodKey`, which is why that field was added to the member row.
 * The view's `periodKey` — the plurality label — is never read here and has no field to travel in.
 *
 * ★ EXPORTED for screen.service.ts. A filtered list is still a mixed-period cross-section, and the
 * period contract is the ONE shape that stops "as of FY27Q1, 12 companies have ROE above 20%" — false
 * for a third of them. A second implementation is a second chance to omit it.
 */
export function periodContract(set: UniverseReadSet): PeriodContract {
  const counts = new Map<string, number>();
  for (const m of set.members) counts.set(m.periodKey, (counts.get(m.periodKey) ?? 0) + 1);
  const spread = [...counts.entries()]
    .map(([period, count]) => ({ period, count }))
    .sort((a, b) => b.count - a.count || b.period.localeCompare(a.period));
  return {
    asOfDate: set.asOfDate,
    companiesRead: set.members.length,
    spread,
    mixed: spread.length > 1,
    notRescored: capped(
      set.notRescored.map((x) => ({ symbol: x.symbol, lastQuarter: x.latestPeriod })),
      LIST_CAP,
    ),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CENSUS — rebuilt from members[], named through the catalogue, §5C applied.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

interface CensusEntry {
  /** Kept INTERNAL for matching and consolidation. Never copied onto a slice. */
  key: string;
  name: string;
  description: string;
  doesntMean: string;
  kind: "red flag" | "pattern";
  severity: string | null;
  /** Symbols firing it, alphabetical. */
  symbols: string[];
  subTypesShown?: { name: string; firingCount: number }[];
  subTypesTotal?: number;
}

const SEVERITY_WORST = (a: string | null, b: string | null): string | null =>
  severityWeight(a) <= severityWeight(b) ? a : b;

/**
 * Roll every member's fired findings into one named census.
 *
 * lensPathology never reaches here: it lives in its own field on the view and this function reads
 * `firedPatterns`, which carries the same `lens_*` keys — so they are filtered explicitly, with the
 * reason at the top of this file. That filter is the ONLY place a `lens_` key is handled.
 */
function buildCensusEntries(members: readonly UniverseMemberView[]): CensusEntry[] {
  const acc = new Map<string, { severity: string | null; kind: "red flag" | "pattern"; symbols: Set<string> }>();
  const add = (key: string, kind: "red flag" | "pattern", severity: string | null, symbol: string) => {
    const cur = acc.get(key) ?? { severity: null, kind, symbols: new Set<string>() };
    cur.severity = cur.symbols.size === 0 ? severity : SEVERITY_WORST(cur.severity, severity);
    cur.symbols.add(symbol);
    acc.set(key, cur);
  };
  for (const m of members) {
    for (const f of m.firedFlags) add(f.flagKey, "red flag", f.severity, m.symbol);
    for (const p of m.firedPatterns) {
      if (p.patternKey.startsWith("lens_")) continue; // ⚠ rule 2 — see the header. Not renamed; dropped.
      add(p.patternKey, "pattern", p.severity, m.symbol);
    }
  }

  const rows: CensusEntry[] = [];
  const cRows: { key: string; severity: string | null; symbols: Set<string> }[] = [];
  for (const [key, v] of acc) {
    if (isDivergenceSubType(key)) {
      cRows.push({ key, severity: v.severity, symbols: v.symbols });
      continue;
    }
    rows.push(entryOf(key, v.kind, v.severity, [...v.symbols]));
  }

  // ── §5C · four sub-types → ONE row. The count is the DISTINCT UNION. ──
  // ★ ORDER THE SUB-TYPES BEFORE CONSOLIDATING. `consolidateDivergence` sorts by severity weight and
  //   is stable, so INPUT order decides which of the equally-severe sub-types are the two it shows.
  //   The Flags board's input arrives already sorted (severity, then member count descending) from the
  //   backend census, so feeding an arbitrary Map-iteration order here would name a different pair
  //   than the card — three sub-types tie at "high" today, and the board leads with the 25-company one.
  //   Same rule in, same two out.
  cRows.sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity) || b.symbols.size - a.symbols.size);
  const consolidation = consolidateDivergence(cRows.map((c) => ({ key: c.key, severity: c.severity })));
  if (consolidation) {
    const bySubKey = new Map(cRows.map((c) => [c.key, c]));
    const union = new Set<string>();
    for (const c of cRows) for (const s of c.symbols) union.add(s);
    const e = entryOf(CONSOLIDATED_DIVERGENCE_KEY, "pattern", consolidation.lead.severity, [...union]);
    // Sub-types dominant-first; §5C shows at most two and COUNTS the rest.
    e.subTypesShown = consolidation.shown.map((s) => ({
      name: findingName(s.key),
      firingCount: bySubKey.get(s.key)?.symbols.size ?? 0,
    }));
    e.subTypesTotal = consolidation.count;
    rows.push(e);
  }

  // Worst severity first, then by how many companies fire it. Uses the CATALOGUE's severity weights —
  // the same ordering the Flags board sorts by — not the census builder's four-value table, which
  // ranks "red"/"amber"/"green"/"recovery" all equal-and-last.
  rows.sort(
    (a, b) => severityWeight(a.severity) - severityWeight(b.severity) || b.symbols.length - a.symbols.length || a.name.localeCompare(b.name),
  );
  return rows;
}

function entryOf(key: string, kind: "red flag" | "pattern", severity: string | null, symbols: string[]): CensusEntry {
  return {
    key,
    name: findingName(key),
    // A registry member always has a description; the fallback exists for a key that reaches a payload
    // before its copy lands, and says so rather than inventing meaning.
    description: findingDescription(key) ?? "Vytal has no published description for this finding yet.",
    doesntMean: doesntMean(key),
    kind,
    severity,
    symbols: symbols.sort(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FINDING NAME RESOLUTION — the model names a finding the way a reader would, never by key.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Every catalogue finding name → key. Built once. Divergence sub-type names deliberately all point at
 *  the consolidated row: the board shows one divergence card, so the chat answers with one. */
const NAME_TO_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const key of STOCK_FINDING_KEYS) {
    const target = isDivergenceSubType(key) ? CONSOLIDATED_DIVERGENCE_KEY : key;
    m.set(norm(findingName(key)), target);
  }
  return m;
})();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FAMILY SELECTOR — "red flags" is not a finding, and asking for it is not a mistake.
//
// ── ★ WHY THIS IS STRUCTURAL AND NOT A PROMPT FIX ─────────────────────────────────────────────────
// Measured across six paced live runs: "which stocks are firing red flags?" named the six companies
// only 3 of 6 times. The other three answered with the red-flag CATEGORIES and their counts, then
// invited the reader to name a company — a fair reading of the CENSUS slice, whose whole shape is a
// roll-call of findings. Four render rewrites moved the number but not this. The diagnosis was that
// the model was answering the slice it was handed, and the slice that answers "which companies" is
// `finding` — which had no way to accept "red flags", because red flags are a FAMILY of four keys and
// every name in the catalogue is a single key.
//
// So the selector resolves to the same FindingDetail shape a single finding produces: the DISTINCT
// UNION of companies firing any of them, capped identically, with the constituent flags named through
// the catalogue as sub-forms — the exact structure §5C's consolidated divergence row already uses.
// No eighth slice, no new type, no new copy.
//
// ── ⚠ RED FLAGS ONLY. "PATTERNS" IS DELIBERATELY NOT A SELECTOR. ──────────────────────────────────
// The pattern family's union today is Deterioration (41) ∪ Divergence (38) ∪ Recovery (18) ∪ … — most
// of the scored universe. "Which companies are firing a pattern?" answered with 80-odd names is a
// list that distinguishes nothing and reads as an alarm. Red flags are the family that is meant to be
// rare, and the count (6 of 94) is the fact. Adding a second family is one entry in the map below;
// the reason not to is editorial, not technical.
const FAMILY_SELECTORS: ReadonlyMap<string, "red flag"> = new Map(
  [
    // What the model actually writes when the reader says "red flags". Normalised, so case, spacing
    // and punctuation are already irrelevant — "Red Flags", "red-flags" and "RED FLAGS" are one entry.
    "red flag", "red flags", "any red flag", "any red flags", "all red flags", "the red flags",
    "red flag findings", "critical finding", "critical findings", "critical red flag", "critical red flags",
    "companies firing red flags", "stocks firing red flags",
    // ⚠ BARE "flags" RESOLVES HERE TOO, and that is a judgement call worth stating. The Hub's tab is
    //   named "Flags & Patterns", so "flags" could in principle mean both families. But a reader who
    //   says "flags" almost always means the loud ones, the answer is LABELLED "Red Flags" so nobody
    //   is misled about what they got, and the alternative was worse: an honest-miss response saying
    //   "'flags' is not a finding Vytal computes" — a false statement about a real product word.
    "flag", "flags", "any flag", "any flags",
  ].map((alias) => [norm(alias), "red flag" as const]),
);

/**
 * Real Vytal families that are NOT selectable here, and the slice that does answer them.
 *
 * ★ WHY THIS EXISTS SEPARATELY FROM THE HONEST MISS. The miss says "X is not a finding Vytal
 * computes" — true and useful for "ROE above 20%", and FALSE for "patterns", which is one of the two
 * finding families the context layer teaches by name. Denying our own vocabulary is the §THE PAGES
 * failure in miniature. So a known-but-unselectable family gets a redirect instead of a denial.
 */
const FAMILY_REDIRECTS: ReadonlyMap<string, string> = new Map(
  [
    ["pattern", "Patterns"], ["patterns", "Patterns"], ["all patterns", "Patterns"], ["any pattern", "Patterns"],
    ["the patterns", "Patterns"], ["pattern findings", "Patterns"],
  ].map(([alias, label]) => [norm(alias), label]),
);

/** Build the family's FindingDetail: the union, the constituents, the family's own boundary line. */
function familyDetail(
  kind: "red flag",
  entries: CensusEntry[],
  members: readonly UniverseMemberView[],
  ref: (s: string) => CompanyRef,
): FindingDetail {
  const rows = entries.filter((e) => e.kind === kind).sort((a, b) => b.symbols.length - a.symbols.length);
  // ★ THE UNION, from the member rows themselves — a company firing two red flags is one company.
  const firing = members.filter((m) => m.firedFlags.length > 0).map((m) => m.symbol).sort();
  return {
    name: "Red Flags",
    // Factual, not authored: what this row IS, stated from the numbers. The context layer already
    // teaches what a red flag MEANS; re-teaching it here would be a fifth vocabulary.
    description:
      rows.length === 0
        ? "Vytal's critical risk findings, taken as a family. None is firing on any company in this read."
        : `Vytal's critical risk findings, taken as a family — ${rows.length} different red flag${rows.length === 1 ? " is" : "s are"} firing, on ${firing.length} compan${firing.length === 1 ? "y" : "ies"} between them. A company firing two is counted once.`,
    // ★ THE CATALOGUE'S OWN family-A boundary. Not re-authored here.
    doesntMean: FAMILY_DOESNT_MEAN.A,
    kind,
    firingCount: firing.length,
    outOf: members.length,
    members: capped(firing.map(ref), LIST_CAP),
    // Every constituent named WITH ITS OWN COMPANIES — not just a count. See the field's comment:
    // counts beside a separate union is what the model joined incorrectly, five times out of six.
    subTypesShown: rows.slice(0, LIST_CAP).map((r) => ({
      name: r.name,
      firingCount: r.symbols.length,
      members: capped(r.symbols.map(ref), LIST_CAP),
    })),
    subTypesTotal: rows.length,
  };
}

function resolveFinding(query: string, entries: CensusEntry[]): CensusEntry | { notFiringKey: string } | null {
  const q = norm(query);
  if (!q) return null;
  const firing = new Map(entries.map((e) => [norm(e.name), e]));

  const exact = firing.get(q);
  if (exact) return exact;

  // Partial: the reader said "divergence" and the row is "Divergence", or "margin compression" for
  // "Margin Compression". Longest match wins so "margin recovery" cannot land on "Recovery".
  const partial = [...firing.entries()]
    .filter(([n]) => n.includes(q) || q.includes(n))
    .sort((a, b) => b[0].length - a[0].length);
  if (partial.length) return partial[0][1];

  // Known to Vytal, firing nowhere in scope. A real answer — "no company is showing that right now" —
  // and a materially different one from "that is not a Vytal finding at all".
  const known =
    NAME_TO_KEY.get(q) ??
    [...NAME_TO_KEY.keys()]
      .filter((n) => n.includes(q) || q.includes(n))
      .sort((a, b) => b.length - a.length)
      .map((n) => NAME_TO_KEY.get(n) as string)[0];
  return known ? { notFiringKey: known } : null;
}

/** A finding Vytal knows and nobody is firing. Zero is the answer, stated with the same copy a
 *  firing one would carry — so "nothing is showing this" reads as a finding, not as a failure. */
function notFiringDetail(key: string, outOf: number): FindingDetail {
  return {
    name: findingName(key),
    description: findingDescription(key) ?? "Vytal has no published description for this finding yet.",
    doesntMean: doesntMean(key),
    kind: familyOf(key) === "A" ? "red flag" : "pattern",
    firingCount: 0,
    outOf,
    members: { total: 0, shown: [] },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SLICES
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Project one slice. Returns an `EmptySlice` when there is genuinely nothing to read — the universe
 * has no in-force snapshots, or the reader's scope holds nothing Vytal scores. Both are real states.
 */
export function projectUniverse(
  view: UniverseHealthView,
  symbols: ReadonlySet<string> | null,
  req: UniverseProjectionRequest,
): UniverseProjection {
  const scope = req.scope ?? "universe";
  const set = buildReadSet(view, symbols, scope);
  if (!set) {
    const reason: EmptySlice["reason"] = !view.scored || !view.aggregate ? "universe-unscored" : "scope-empty";
    return { slice: "empty", scope, requested: req.slice, reason };
  }
  const out = project(set, req);
  assertNoInternalIdentifiers(out);
  return out;
}

function project(set: UniverseReadSet, req: UniverseProjectionRequest): UniverseProjection {
  const period = periodContract(set);
  const nameOf = new Map(set.members.map((m) => [m.symbol, m.name]));
  const ref = (symbol: string): CompanyRef => ({ symbol, name: nameOf.get(symbol) ?? symbol });

  switch (req.slice) {
    case "overview":
      return overview(set, period);
    case "band":
      return band(set, period, req.band);
    case "census":
      return census(set, period, ref);
    case "finding":
      return finding(set, period, ref, req.finding ?? "");
    case "movers":
      return movers(set, period);
    case "divergence":
      return divergence(set, period, ref);
    case "week":
      return week(set, period, ref);
  }
}

function overview(set: UniverseReadSet, period: PeriodContract): OverviewSlice {
  const a = set.aggregate;
  const byBand = a.bandDistribution;
  const scoredCompany = (x: { symbol: string; composite: number } | undefined | null): ScoredCompany | null => {
    if (!x) return null;
    const m = set.members.find((mm) => mm.symbol === x.symbol);
    return { symbol: x.symbol, name: m?.name ?? x.symbol, score: x.composite, band: BAND_LABEL[(m?.labelBand ?? "steady") as LabelBand] };
  };
  return {
    slice: "overview",
    scope: set.scope,
    period,
    companiesScored: set.members.length,
    medianScore: a.medianComposite,
    meanScore: a.meanComposite,
    medianQuarterMove: a.medianDrift,
    p25: round2(a.dispersion.p25),
    p75: round2(a.dispersion.p75),
    stdDev: round2(a.dispersion.stdDev),
    lowest: scoredCompany(a.range?.min),
    highest: scoredCompany(a.range?.max),
    bands: BAND_ORDER.map((b) => ({ band: BAND_LABEL[b], count: byBand[b] ?? 0 })),
    pillarMedians: PILLAR_ORDER.map((p) => ({ pillar: PILLAR_LABEL[p], median: round1(a.pillarMedians[p] ?? 0) })),
    redFlagCompanies: a.redFlagMemberCount,
  };
}

function band(set: UniverseReadSet, period: PeriodContract, requested: string | undefined): BandSlice {
  const dist = set.aggregate.bandDistribution;
  const bands = BAND_ORDER.map((b) => ({ band: BAND_LABEL[b], count: dist[b] ?? 0 }));
  const base: BandSlice = {
    slice: "band",
    scope: set.scope,
    period,
    companiesScored: set.members.length,
    bands,
    focus: null,
    unrecognisedBand: null,
  };
  if (!requested || !requested.trim()) return base;

  const parsed = parseBand(requested);
  if (!parsed) return { ...base, unrecognisedBand: requested.trim() };

  const inBand = set.members
    .filter((m) => m.labelBand === parsed)
    .sort((a, b) => b.composite - a.composite)
    .map((m): ScoredCompany => ({ symbol: m.symbol, name: m.name, score: m.composite, band: BAND_LABEL[parsed] }));

  return { ...base, focus: { band: BAND_LABEL[parsed], count: inBand.length, members: capped(inBand, LIST_CAP) } };
}

function census(set: UniverseReadSet, period: PeriodContract, ref: (s: string) => CompanyRef): CensusSlice {
  const entries = buildCensusEntries(set.members);
  const outOf = set.members.length;
  const redFlagSymbols = set.members
    .filter((m) => m.firedFlags.length > 0)
    .map((m) => m.symbol)
    .sort();
  const rows: CensusRow[] = entries.map((e) => ({
    name: e.name,
    description: e.description,
    kind: e.kind,
    firingCount: e.symbols.length,
    outOf,
  }));
  return {
    slice: "census",
    scope: set.scope,
    period,
    outOf,
    redFlagCompanies: capped(redFlagSymbols.map(ref), LIST_CAP),
    rows: capped(rows, LIST_CAP),
  };
}

function detailOf(e: CensusEntry, outOf: number, ref: (s: string) => CompanyRef): FindingDetail {
  return {
    name: e.name,
    description: e.description,
    doesntMean: e.doesntMean,
    kind: e.kind,
    firingCount: e.symbols.length,
    outOf,
    members: capped(e.symbols.map(ref), LIST_CAP),
    ...(e.subTypesShown ? { subTypesShown: e.subTypesShown, subTypesTotal: e.subTypesTotal } : {}),
  };
}

function finding(set: UniverseReadSet, period: PeriodContract, ref: (s: string) => CompanyRef, query: string): FindingSlice {
  const entries = buildCensusEntries(set.members);
  const outOf = set.members.length;
  const available = capped(entries.map((e) => e.name), LIST_CAP);

  // ★ THE FAMILY WORDS RUN FIRST. A family word is not a finding name, so it must not reach the name
  //   matcher — a fuzzy hit on "red flags" would answer a different question quietly.
  const base = { slice: "finding" as const, scope: set.scope, period, query, available, unselectableFamily: null };
  const family = FAMILY_SELECTORS.get(norm(query));
  if (family) return { ...base, finding: familyDetail(family, entries, set.members, ref) };
  const redirect = FAMILY_REDIRECTS.get(norm(query));
  if (redirect) return { ...base, finding: null, unselectableFamily: redirect };

  const hit = resolveFinding(query, entries);

  if (hit && "notFiringKey" in hit) return { ...base, finding: notFiringDetail(hit.notFiringKey, outOf) };
  return { ...base, finding: hit ? detailOf(hit, outOf, ref) : null };
}

function movers(set: UniverseReadSet, period: PeriodContract): MoversSlice {
  const rows: MoverRow[] = set.members
    .filter((m) => m.trajectoryDelta != null && m.trajectoryDelta !== 0)
    .map((m) => ({
      symbol: m.symbol,
      name: m.name,
      score: m.composite,
      priorScore: round2(m.composite - (m.trajectoryDelta as number)),
      delta: m.trajectoryDelta as number,
    }));
  const risers = rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);
  const slippers = rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta);
  return {
    slice: "movers",
    scope: set.scope,
    period,
    risers: capped(risers, MOVER_CAP),
    slippers: capped(slippers, MOVER_CAP),
    unchangedOrNoPrior: set.members.length - rows.length,
  };
}

function divergence(set: UniverseReadSet, period: PeriodContract, ref: (s: string) => CompanyRef): DivergenceSlice {
  const entries = buildCensusEntries(set.members);
  const e = entries.find((x) => x.key === CONSOLIDATED_DIVERGENCE_KEY) ?? null;
  return {
    slice: "divergence",
    scope: set.scope,
    period,
    outOf: set.members.length,
    detail: e ? detailOf(e, set.members.length, ref) : null,
  };
}

function week(set: UniverseReadSet, period: PeriodContract, ref: (s: string) => CompanyRef): WeekSlice {
  const w = set.sinceLastWeek;
  const move = (x: {
    symbol: string;
    delta: number;
    fromComposite: number;
    toComposite: number;
    fromBand: LabelBand;
    toBand: LabelBand;
  }): WeekMove => ({
    ...ref(x.symbol),
    score: x.toComposite,
    priorScore: x.fromComposite,
    delta: x.delta,
    fromBand: BAND_LABEL[x.fromBand],
    toBand: BAND_LABEL[x.toBand],
  });
  return {
    slice: "week",
    scope: set.scope,
    period,
    windowStart: w.anchorDate,
    rescored: w.newVersionCount,
    bandCrossings: capped(
      w.bandCrossings.map((c) => ({ ...ref(c.symbol), from: BAND_LABEL[c.from], to: BAND_LABEL[c.to], direction: c.direction })),
      LIST_CAP,
    ),
    // ★ the key → the catalogue name. This is the one place `week` could have leaked an identifier.
    newFindings: capped(
      w.newFlags.map((f) => ({ ...ref(f.symbol), finding: findingName(f.flagKey) })),
      LIST_CAP,
    ),
    improved: capped(w.newRecoveries.map(move), LIST_CAP),
    slipped: capped(w.newDeteriorations.map(move), LIST_CAP),
    note: w.honestNote,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ASSERTION (1c) — a raw key reaching the model is the defect the catalogue was built to close.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Patterns that must never appear in a projection. Narrow on purpose: each matches a SHAPE no product
 * copy has, so a legitimate string cannot trip it.
 *   · finding keys        ownership_R6_distribution, trajectory_B_deterioration, divergence_C1_…
 *   · composed lens keys  lens_lm3_F7 (rule 2 — these have no reader-safe name at all)
 *   · the raw band enum   below_par
 *   · view field names    labelBand / firedFlags / firedPatterns / trajectoryMarker / periodKey
 */
const INTERNAL_SHAPES: readonly RegExp[] = [
  /\b(?:ownership|foundation|momentum|trajectory|divergence|composition)_[A-Za-z]?\d*_[a-z]/,
  /\blens_[a-z]{2}\d_/,
  /\bbelow_par\b/,
  /\b(?:labelBand|firedFlags|firedPatterns|trajectoryMarker|periodKey|patternKey|flagKey)\b/,
];

/**
 * Walk every string in a finished projection and THROW on an internal identifier.
 *
 * ★ WHY THROW RATHER THAN STRIP. A key here is a programming error, not a data condition — every path
 * that produces a name runs through the catalogue. Stripping would hide the bug and ship a sentence
 * with a hole in it. The tool layer is fail-soft by construction (registry.ts), so the throw becomes
 * an honest error handed to the model, never an exception in front of a reader.
 */
export function assertNoInternalIdentifiers(value: unknown, path = "$"): void {
  if (typeof value === "string") {
    for (const re of INTERNAL_SHAPES) {
      const hit = re.exec(value);
      if (hit) throw new Error(`universe projection leaked an internal identifier at ${path}: "${hit[0]}"`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoInternalIdentifiers(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoInternalIdentifiers(v, `${path}.${k}`);
  }
}
