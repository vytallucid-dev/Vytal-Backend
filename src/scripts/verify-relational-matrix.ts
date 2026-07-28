// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — THE FIXTURE MATRIX (Part XI · §5.5 · §8).
//
// Relational state cannot be censused — it is per (reader, object, instant) — so verification is a
// SYNTHETIC FIXTURE MATRIX walked through the PURE composition, with no DB.
//
// ⚠ WHY THIS FILE EXISTS SEPARATELY FROM verify-relational.ts. The library declares twenty verification
// assertions and NOT ONE had ever run. That is precisely how a false header shipped while the card
// looked perfect: two assertions in the older harness were written against OBSERVED BEHAVIOUR and
// therefore DEFENDED the M1 first-view falsehood for as long as it existed.
//
// ★ EVERY ASSERTION HERE IS DERIVED FROM SPEC TEXT, NOT FROM WHAT THE CODE DOES. "It currently passes"
// is evidence of nothing. Each assertion names the section or rule it enforces, so a future reader can
// check the assertion against the spec rather than against the implementation.
//
// ★ THE SYNTHETIC-ONLY CASES ARE THE POINT. UD1 and UG9 cannot be exercised against live data — no
// live reader has a stale stamped generation, and the evaluability column is unmigrated so
// `notEvaluable` is null everywhere. Both are among the most important entries in the build. They are
// verified HERE or nowhere.
//
// Run: npx tsx src/scripts/verify-relational-matrix.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { composeRelationalState } from "../relational/service.js";
import { anonymousContext } from "../relational/reader-context.js";
import { scanAssembled } from "../relational/copy.js";
import type { BaseRateSnapshot } from "../relational/base-rates.js";
import type { ReaderContext, ObjectState, ObjectFinding, ReaderHolding, RelationalState } from "../relational/types.js";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n══ ${s} ══`);

const NOW = new Date("2026-07-28T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const claims = (s: RelationalState) => [s.header.claim, ...s.slots.filter((x) => x.entryId !== "UO1").map((x) => x.claim), ...s.overflow.filter((x) => x.entryId !== "UO1").map((x) => x.claim)];
const businessLeadClaims = (s: RelationalState) => [...s.slots, ...s.overflow].filter((x) => x.entryId === "UO1").map((x) => x.claim);
const slotClaims = (s: RelationalState) => [s.header.claim, ...s.slots.map((x) => x.claim)];
const ids = (s: RelationalState) => s.slots.map((x) => x.entryId);
const allIds = (s: RelationalState) => [...s.slots, ...s.overflow].map((x) => x.entryId);

// ── FINDINGS ────────────────────────────────────────────────────────────────────────────────────
const f = (over: Partial<ObjectFinding> & { key: string }): ObjectFinding => ({
  kind: "pattern", severity: "medium", polarity: "negative", temporalClass: "CONDITION",
  evidence: { verdict: `Verdict for ${over.key}.` }, ...over,
});
const CRITICAL = f({ key: "ownership_R1_pledge", kind: "red_flag", severity: "critical", evidence: { verdict: "A critical flag stands.", pledgeRatioQ: 62 } });
const HIGH = f({ key: "trajectory_B_deterioration", severity: "high", evidence: { verdict: "High severity.", leg: "market", sustainedSnapshots: 2 } });
const MEDIUM = f({ key: "foundation_C1_divergence", severity: "medium", evidence: { verdict: "Medium severity." } });
const CLOCK = f({ key: "ownership_H_block_events", severity: "low", polarity: "neutral", temporalClass: "CLOCK_EVENT", evidence: { verdict: "An event.", windowDays: 90, deals: 2 } });
const POSITIVE = f({ key: "foundation_N1_cash_backed_earnings", severity: "green", polarity: "positive", evidence: { verdict: "Cash-backed for 6 years.", years: 6, name: "Cash-Backed Earnings" } });

// ── OBJECTS ─────────────────────────────────────────────────────────────────────────────────────
const obj = (over: Partial<ObjectState> = {}): ObjectState => ({
  kind: "stock", stockId: "stk-1", symbol: "ACME", displayLabel: "Acme Industries",
  businessLead: "Makes industrial pumps.", isScored: true,
  coverage: { state: "scored_full", declinedCount: 0, declinedReasons: [], fullyEvaluated: true },
  snapshot: { generation: "gen-current", periodKey: "FY27Q1", composite: 71, band: "steady" },
  sector: { key: "industrials", displayName: "Industrials", sectorClass: "Cyclical" },
  peerGroup: { id: "pg-1", label: "Industrial Machinery", memberCount: 9 },
  findings: [], notEvaluable: [], pondMask: null, ...over,
});

// ── READERS ─────────────────────────────────────────────────────────────────────────────────────
const holding = (o: Partial<ReaderHolding> = {}): ReaderHolding => ({
  entityKey: "INE001A", displayLabel: "Acme Industries", value: 240000, weightPct: 24,
  accountLabels: ["Zerodha"], isScored: true, sector: "industrials", route: "direct", symbols: ["ACME"], ...o,
});
const NO_DELTA = { evaluable: false as const, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null };
const NO_ATTN = { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null };

const reader = (over: Partial<ReaderContext> = {}): ReaderContext => ({
  identity: { userId: "u1", isAuthenticated: true, aiLevel: "balanced" },
  heldThisObject: false,
  book: { exists: true, accountCount: 1, scoredHoldingsCount: 8, totalHoldingsCount: 8, unscoredHoldingsCount: 0,
    totalValue: 1_000_000, typicalPositionValue: 90000, holdings: [holding({ symbols: ["OTHER"], displayLabel: "Other Co", sector: "consumer" })],
    hasFundHoldings: false, lookThroughAvailable: false, phsComposite: 68, phsBand: "Steady" },
  watchlist: { exists: false, count: 0, thisAddedAt: null, peersInPeerGroup: [] },
  attention: NO_ATTN,
  neighbourhood: { pgWeightPct: 0, pgHeld: [], pgSize: 9, sectorWeightPct: 0, sectorHeldCount: 0 },
  echo: { scoredHoldingsCount: 8, byPatternKey: new Map() },
  delta: NO_DELTA,
  ...over,
});
const holder = (over: Partial<ReaderContext> = {}) => reader({
  heldThisObject: true,
  book: { ...reader().book!, holdings: [holding()] },
  ...over,
});

const RATES: BaseRateSnapshot = {
  rates: new Map([
    ["foundation_C1_divergence", { patternKey: "foundation_C1_divergence", firedInUniverse: 10, universeCount: 95, expectedShare: 0.105 }],
    ["trajectory_B_deterioration", { patternKey: "trajectory_B_deterioration", firedInUniverse: 38, universeCount: 95, expectedShare: 0.4 }],
    ["ownership_H_block_events", { patternKey: "ownership_H_block_events", firedInUniverse: 13, universeCount: 95, expectedShare: 0.137 }],
    ["foundation_N1_cash_backed_earnings", { patternKey: "foundation_N1_cash_backed_earnings", firedInUniverse: 5, universeCount: 95, expectedShare: 0.05 }],
  ]),
  universeCount: 95, asOfDate: new Date("2026-07-27T00:00:00.000Z"), computedAt: NOW,
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("1 · GUARANTEED-RESOLVE (§0.4) — every reader state resolves a non-empty card");
// Spec: "The card is always present. The engine must always terminate on something true."
{
  const states: [string, RelationalState][] = [
    ["anonymous", composeRelationalState(anonymousContext(), obj(), NOW, null)],
    ["authed, no book", composeRelationalState(reader({ book: { ...reader().book!, exists: false } }), obj(), NOW, RATES)],
    ["authed, book, stranger", composeRelationalState(reader(), obj(), NOW, RATES)],
    ["holder", composeRelationalState(holder(), obj(), NOW, RATES)],
    ["unscored object", composeRelationalState(reader(), obj({ isScored: false, snapshot: null, findings: [], notEvaluable: null, peerGroup: null, coverage: { state: "display_only", declinedCount: null, declinedReasons: [], fullyEvaluated: false } }), NOW, RATES)],
    ["object with no PG", composeRelationalState(reader(), obj({ peerGroup: null }), NOW, RATES)],
  ];
  for (const [label, s] of states) ok(`${label} → non-empty card with a header`, s.slots.length > 0 && s.header.claim.length > 0);
}

section("2 · NO FIRST-VIEW CLAIM FROM A MISSING ROLLUP (⚠ the falsehood that shipped)");
// Spec as amended: novelty may be ANNOTATED where lastViewedAt is known; never ASSERTED from absence.
{
  const s = composeRelationalState(holder({ attention: NO_ATTN }), obj({ findings: [HIGH] }), NOW, RATES);
  ok("M1 (held, no attention row) resolves", s.mode === "M1");
  ok("no card text claims a first view", !/first time|never (read|opened|looked)|haven't (read|opened|looked)/i.test(claims(s).join(" ")));
}

section("3 · NO STRANGER HEADER FOR A READER WITH PRIOR CONTACT (§2.2 grid)");
// Spec: M9 is NEITHER×FIRST. A returning/recurring reader is M10/M11 and cannot be told "New to you."
{
  const returning = { ...NO_ATTN, hasHistory: true, viewCount: 3, lastViewedAt: daysAgo(10) };
  const recurring = { ...NO_ATTN, hasHistory: true, viewCount: 9, viewCountTrailing30d: 9, lastViewedAt: daysAgo(2) };
  const s10 = composeRelationalState(reader({ attention: returning }), obj(), NOW, RATES);
  const s11 = composeRelationalState(reader({ attention: recurring }), obj(), NOW, RATES);
  ok("NEITHER × RETURNING → M10 (not folded to M9)", s10.mode === "M10", s10.mode);
  ok("NEITHER × RECURRING → M11 (not folded to M9)", s11.mode === "M11", s11.mode);
  ok("neither renders 'New to you'", !/new to you/i.test(s10.header.claim + s11.header.claim));
}
{
  const watched = reader({ watchlist: { exists: true, count: 1, thisAddedAt: daysAgo(60), peersInPeerGroup: [] } });
  const s = composeRelationalState(watched, obj(), NOW, RATES);
  ok("watchlisted-not-held → a WATCHED mode, never M9", ["M5", "M6", "M7", "M8"].includes(s.mode), s.mode);
  ok("watchlisted stock never renders 'New to you'", !/new to you/i.test(s.header.claim));
}

section("4 · THE LADDER (§4.1/§4.2) — floor takes mode rank; the tail is strict global rung");
{
  const s = composeRelationalState(reader(), obj({ findings: [CRITICAL, MEDIUM] }), NOW, RATES);
  const floorIds = new Set(["UO1", "UO2"]); // M9's declared floor
  const tail = s.slots.filter((x) => !floorIds.has(x.entryId));
  ok("non-floor tail is in non-decreasing rung order", tail.every((x, i, a) => i === 0 || a[i - 1].weight.ladderRung <= x.weight.ladderRung),
    tail.map((x) => `${x.entryId}@${x.weight.ladderRung}`).join(" "));
  ok("a critical finding outranks every orientation entry", (() => {
    const c = s.slots.findIndex((x) => x.family === "ELEVATED");
    const o = s.slots.findIndex((x) => x.entryId === "UO3" || x.entryId === "UO4");
    return c === -1 || o === -1 || s.slots[c].weight.ladderRung < s.slots[o].weight.ladderRung;
  })());
}

section("5 · MAGNITUDE-BLIND RELEVANCE (§0.7.1 · Part IX·20)");
// Spec: score effect is NEVER a relevance input. ObjectFinding does not even carry magnitude.
{
  const s = composeRelationalState(reader(), obj({ findings: [MEDIUM, HIGH] }), NOW, RATES);
  const a = allIds(s);
  const iH = a.indexOf(`ELEVATED:${HIGH.key}`), iM = a.indexOf(`ELEVATED:${MEDIUM.key}`);
  ok("HIGH severity precedes MEDIUM regardless of score effect", iH >= 0 && iM >= 0 && iH < iM);
  ok("no entry exposes a magnitude field", !JSON.stringify(s).includes('"magnitude"'));
}

section("6 · UD1 — SYNTHETIC (⚠ unverifiable on live data: no reader has a stale generation)");
{
  const delta = { evaluable: true, since: daysAgo(20), sinceLabel: "July 2026", lastSeenGeneration: "gen-old",
    newSnapshotSinceLastLook: true, newlyStandingKeys: [HIGH.key], clearedKeys: [], lastSeenBand: "healthy" };
  const s = composeRelationalState(holder({ attention: { ...NO_ATTN, hasHistory: true, viewCount: 3, lastViewedAt: daysAgo(20) }, delta }), obj({ findings: [HIGH, MEDIUM] }), NOW, RATES);
  const ud1 = [...s.slots, ...s.overflow].find((x) => x.entryId === `UD1:${HIGH.key}`);
  ok("UD1 fires for a newly-standing key", Boolean(ud1));
  ok("UD1 carries the novelty marker", ud1?.isNewSinceLastLook === true);
  ok("UD1 on a HELD object takes rung 2 (delta-held, §4.1)", ud1?.weight.ladderRung === 2, String(ud1?.weight.ladderRung));
  ok("the ELEVATED candidate for that key is SUPPRESSED (one claim, one owner)", !allIds(s).includes(`ELEVATED:${HIGH.key}`));
  ok("a NOT-newly-standing key still renders as ELEVATED", allIds(s).includes(`ELEVATED:${MEDIUM.key}`));
}
{
  // Echo hosts on UD1, not on ELEVATED (§Phase 7 host precedence).
  const delta = { evaluable: true, since: daysAgo(20), sinceLabel: "July 2026", lastSeenGeneration: "gen-old",
    newSnapshotSinceLastLook: true, newlyStandingKeys: [HIGH.key], clearedKeys: [], lastSeenBand: null };
  const ctx = holder({ delta, attention: { ...NO_ATTN, hasHistory: true, viewCount: 3, lastViewedAt: daysAgo(20) },
    echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[HIGH.key, ["A", "B", "C", "D"]]]) } });
  const s = composeRelationalState(ctx, obj({ findings: [HIGH] }), NOW, RATES);
  const ud1 = [...s.slots, ...s.overflow].find((x) => x.entryId.startsWith("UD1:"));
  ok("echo annotation merges into UD1 (host precedence UD1 → UO6 → ELEVATED)",
    Boolean(ud1 && /of your 8 scored holdings/.test(ud1.claim)), ud1?.claim.slice(0, 120));
  ok("no separate UE slot competes alongside its host", !ids(s).some((i) => i.startsWith("UE")));
}

section("7 · UD IS SILENT WITHOUT A COMPARISON BASIS (Standing Rule 7 · UD8)");
{
  const s = composeRelationalState(holder({ delta: NO_DELTA }), obj({ findings: [HIGH] }), NOW, RATES);
  ok("no delta ⇒ no UD entry", !allIds(s).some((i) => i.startsWith("UD")));
  ok("no delta ⇒ no 'nothing new' claim", !/nothing new/i.test(claims(s).join(" ")));
}
{
  // A last-look timestamp WITHOUT a stamped generation cannot support "nothing new".
  const delta = { evaluable: true, since: daysAgo(10), sinceLabel: "July 2026", lastSeenGeneration: null,
    newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null };
  const s = composeRelationalState(holder({ delta, attention: { ...NO_ATTN, hasHistory: true, viewCount: 2, lastViewedAt: daysAgo(10) } }), obj(), NOW, RATES);
  ok("timestamp without a stamped generation ⇒ no 'nothing new'", !/nothing new/i.test(s.header.claim));
}

section("8 · UG9 — SYNTHETIC (⚠ unverifiable live: the evaluability column is unmigrated)");
{
  const declined = [{ ruleRef: "R3", reason: "insufficient_annual_history" }, { ruleRef: "R5", reason: "insufficient_quarters" }];
  const s = composeRelationalState(reader(), obj({ notEvaluable: declined, coverage: { state: "scored_partial", declinedCount: 2, declinedReasons: ["insufficient_annual_history", "insufficient_quarters"], fullyEvaluated: false } }), NOW, RATES);
  const ug9 = [...s.slots, ...s.overflow].find((x) => x.entryId === "UG9");
  ok("UG9 fires on a populated declined set", Boolean(ug9));
  ok("UG9 names a CAPABILITY, never a rule ref", Boolean(ug9 && /earnings quality|interest coverage/.test(ug9.claim)) && !/\bR3\b|\bR5\b/.test(ug9?.claim ?? ""));
  ok("UG9 gives a plain reason, never a token", Boolean(ug9 && !/insufficient_\w+/.test(ug9.claim)));
}
{
  const s = composeRelationalState(reader(), obj({ notEvaluable: null }), NOW, RATES);
  ok("UG9 is SILENT when the declined set is null (unknown ≠ nothing)", !allIds(s).includes("UG9"));
  const uo3 = [...s.slots, ...s.overflow].find((x) => x.entryId === "UO3");
  ok("UO3 uses its unqualified variant when evaluability is unknown", Boolean(uo3 && uo3.claim === "Nothing flagged."), uo3?.claim);
}

section("9 · ECHO (§3.5) — both numbers, framing switch, no clock-events, no positive echo");
{
  const ctx = reader({ echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[MEDIUM.key, ["A", "B", "C", "D"]]]) } });
  const s = composeRelationalState(ctx, obj({ findings: [MEDIUM] }), NOW, RATES);
  const host = [...s.slots, ...s.overflow].find((x) => x.entryId === `ELEVATED:${MEDIUM.key}`);
  ok("echo renders BOTH numbers (book count AND universe count)",
    Boolean(host && /4 of your 8 scored holdings/.test(host.claim) && /10 of the 95/.test(host.claim)), host?.claim.slice(0, 150));
  ok("echo carries its own as-of date (self-describing, §6.3)", Boolean(host && /as of July 2026/.test(host.claim)));
}
{
  // expectedShare 0.4 ≥ 0.30 ⇒ UE6 environmental framing, never suppression.
  const ctx = reader({ echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[HIGH.key, ["A", "B", "C", "D", "E"]]]) } });
  const s = composeRelationalState(ctx, obj({ findings: [HIGH] }), NOW, RATES);
  const host = [...s.slots, ...s.overflow].find((x) => x.entryId === `ELEVATED:${HIGH.key}`);
  ok("a high-base-rate high-share co-occurrence resolves (UE6), never nothing",
    Boolean(host && /across much of the market/.test(host.claim)), host?.claim.slice(0, 140));
}
{
  const ctx = reader({ echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[CLOCK.key, ["A", "B", "C", "D"]]]) } });
  const s = composeRelationalState(ctx, obj({ findings: [CLOCK] }), NOW, RATES);
  ok("⚠ NO echo on a CLOCK_EVENT key (a time window is not a book trait)",
    !claims(s).join(" ").includes("of your 8 scored holdings"));
}
{
  const ctx = holder({ echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[POSITIVE.key, ["A", "B", "C", "D"]]]) } });
  const s = composeRelationalState(ctx, obj({ findings: [POSITIVE] }), NOW, RATES);
  ok("⚠ NO positive echo (Part IX·18 — never judges the reader's selection)",
    !/of your 8 scored holdings/.test(claims(s).join(" ")));
  ok("UO6 still states the strength itself", allIds(s).includes("UO6"));
}

section("10 · UO6 (§3.1) — never manufactured from an absence of flags");
{
  const clean = composeRelationalState(reader(), obj({ findings: [] }), NOW, RATES);
  ok("no positive finding ⇒ UO6 does NOT fire", !allIds(clean).includes("UO6"));
  ok("UO3 carries the clean state instead", allIds(clean).includes("UO3"));
  const strong = composeRelationalState(reader(), obj({ findings: [POSITIVE] }), NOW, RATES);
  const uo6 = [...strong.slots, ...strong.overflow].find((x) => x.entryId === "UO6");
  ok("a positive self-dating finding ⇒ UO6 fires with its duration", Boolean(uo6?.standingSince));
  ok("UO6 is celebration-free (§3.1 register discipline)",
    !/excellent|impressive|well[- ]positioned|attractive|solid|robust|compelling/i.test(uo6?.claim ?? ""));
}

section("11 · THE BOUNDARY (Part IX) — over ASSEMBLED output, every register");
{
  const cases: RelationalState[] = [
    composeRelationalState(holder({ echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[MEDIUM.key, ["A", "B", "C", "D"]]]) } }), obj({ findings: [CRITICAL, HIGH, MEDIUM, CLOCK, POSITIVE] }), NOW, RATES),
    composeRelationalState(reader(), obj({ findings: [CRITICAL] }), NOW, RATES),
    composeRelationalState(anonymousContext(), obj({ findings: [HIGH] }), NOW, null),
  ];
  const all = cases.flatMap(claims).join(" ‖ ");
  ok("no returns / gain / loss / cost basis (IX·4)", !/\breturn(s|ed)?\b|\bgain\b|\bloss\b|cost basis|\bp&l\b|invested/i.test(all));
  ok("no modeled transaction (IX·3)", !/would (take|be|bring|put|leave)|if you (add|buy|sell|reduce|trim)|after (adding|buying|selling)/i.test(all));
  ok("no advice (IX·2)", !/you should|consider (buying|selling|trimming|adding)|we recommend/i.test(all));
  ok("no reader comparison (IX·7)", !/most investors|other (users|readers)|percentile of/i.test(all));
  ok("no engagement mechanics (IX·12)", !/streak|don't miss|act now|unread/i.test(all));
  ok("no visit count or reading history as content (IX·5)", !/\b\d+ (times|views|visits)\b|you've (looked|opened|viewed)|haven't checked/i.test(all));
  ok("no raw identifier — UUID / ISIN / key / enum (IX·14)",
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(all) &&
    !/\bINE[0-9A-Z]{9}\b/.test(all) &&
    !/\b(below_par|scored_full|scored_partial|display_only|covered_unscored|insufficient_\w+|CLOCK_EVENT|red_flag)\b/.test(all) &&
    !/foundation_[A-Z]\d|trajectory_[A-Z]|ownership_[A-Z]\d|lens_lm\d/.test(all));
  for (const level of ["plain", "balanced", "technical"] as const) {
    const s = composeRelationalState({ ...holder(), identity: { userId: "u1", isAuthenticated: true, aiLevel: level } }, obj({ findings: [CRITICAL, HIGH, POSITIVE] }), NOW, RATES);
    const v = scanAssembled(claims(s), level, businessLeadClaims(s));
    ok(`register-guard clean at ${level}`, v.length === 0, v.map((x) => `${x.term}:"${x.text}"`).join(" | "));
  }
}

section("12 · ONE CLAIM, ONE OWNER — no fact stated twice on one card");
{
  const ctx = holder({ echo: { scoredHoldingsCount: 8, byPatternKey: new Map([[MEDIUM.key, ["A", "B", "C", "D"]]]) },
    neighbourhood: { pgWeightPct: 33, pgHeld: [{ stockId: "stk-1", symbol: "ACME", name: "Acme Industries", isThisObject: true }], pgSize: 9, sectorWeightPct: 33, sectorHeldCount: 1 } });
  const s = composeRelationalState(ctx, obj({ findings: [CRITICAL, HIGH, MEDIUM] }), NOW, RATES);
  ok("no two slots render the identical claim string", new Set(slotClaims(s)).size === slotClaims(s).length);
  ok("UG1 and UH10 never co-render", !(allIds(s).includes("UG1") && allIds(s).includes("UH10")));
}
{
  const unscoredHeld = composeRelationalState(holder(), obj({ isScored: false, snapshot: null, findings: [], notEvaluable: null, peerGroup: null }), NOW, RATES);
  ok("held + unscored ⇒ UH10 states it, UG1 defers", allIds(unscoredHeld).includes("UH10") && !allIds(unscoredHeld).includes("UG1"));
  ok("UO1 does not repeat the no-peer-group fact when another entry owns it",
    !(allIds(unscoredHeld).includes("UG1") && /not yet placed in a peer group/i.test(claims(unscoredHeld).join(" "))));
}

section("13 · STABILITY (§2.3) — unchanged state ⇒ identical ordering");
{
  const mk = () => composeRelationalState(holder(), obj({ findings: [CRITICAL, HIGH, MEDIUM] }), NOW, RATES);
  ok("two resolves produce identical slot ids", JSON.stringify(ids(mk())) === JSON.stringify(ids(mk())));
  const a = composeRelationalState(holder({ attention: { ...NO_ATTN, hasHistory: true, viewCount: 3, lastViewedAt: daysAgo(5) } }), obj({ findings: [HIGH, MEDIUM] }), NOW, RATES);
  const b = composeRelationalState(holder({ attention: { ...NO_ATTN, hasHistory: true, viewCount: 3, lastViewedAt: daysAgo(25) } }), obj({ findings: [HIGH, MEDIUM] }), NOW, RATES);
  ok("a different lastViewedAt alone does not reorder (§4.4)", JSON.stringify(ids(a)) === JSON.stringify(ids(b)));
}

section("14 · NOVELTY NEVER REMOVES (§0.5) — no slate-cleaning");
{
  const delta = { evaluable: true, since: daysAgo(20), sinceLabel: "July 2026", lastSeenGeneration: "gen-old",
    newSnapshotSinceLastLook: true, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null };
  const before = composeRelationalState(holder({ delta: NO_DELTA }), obj({ findings: [HIGH, MEDIUM] }), NOW, RATES);
  const after = composeRelationalState(holder({ delta, attention: { ...NO_ATTN, hasHistory: true, viewCount: 3, lastViewedAt: daysAgo(20) } }), obj({ findings: [HIGH, MEDIUM] }), NOW, RATES);
  const standingBefore = allIds(before).filter((i) => i.startsWith("ELEVATED:"));
  const standingAfter = allIds(after).filter((i) => i.startsWith("ELEVATED:") || i.startsWith("UD1:"));
  ok("advancing the last look drops no standing finding", standingBefore.every((i) => standingAfter.some((j) => j.endsWith(i.split(":")[1]))));
}

section("15 · POSITION AXIS (§2.1 amended) — quantity, not value");
{
  // A holder whose value is unresolvable is STILL a holder (honest-empty branch), not a stranger.
  const unpriced = holder({ book: { ...holder().book!, holdings: [holding({ value: 0, weightPct: 0 })] } });
  const s = composeRelationalState(unpriced, obj(), NOW, RATES);
  ok("held-but-unpriceable stays HELD and states it honestly",
    s.mode === "M1" && /position value isn't available yet/i.test(claims(s).join(" ")));
}

section("16 · HONEST-EMPTY (§0.9 / IX·11) — a missing input never becomes a value");
{
  const s = composeRelationalState(reader({ book: { ...reader().book!, exists: false } }), obj(), NOW, RATES);
  ok("authed with no portfolio ⇒ UG7 states the limit once", allIds(s).includes("UG7"));
  ok("UG7 carries no call to action (§3.6)", !/connect|add|link|get started|sign up/i.test([...s.slots, ...s.overflow].find((x) => x.entryId === "UG7")?.claim ?? ""));
  const anon = composeRelationalState(anonymousContext(), obj(), NOW, null);
  ok("anonymous never mentions an account or signing in (UG8)", !/sign ?in|signed.?in|log ?in|your account|connect a portfolio/i.test(claims(anon).join(" ")));
  ok("anonymous renders UO-family only (no reader-side entry)", !allIds(anon).some((i) => /^(UH|UW|UN|UE|UD)/.test(i)));
}

console.log(`\n${"═".repeat(64)}\nRELATIONAL MATRIX — ${pass} passed, ${fail} failed\n${"═".repeat(64)}`);
process.exit(fail === 0 ? 0 : 1);
