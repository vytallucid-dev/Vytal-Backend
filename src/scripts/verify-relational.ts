// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VERIFY — Relational L4, families UO + UH, modes M1 / M3 / M9 (Overview Pattern Library, Part XI).
//
// Relational state cannot be censused (§5.5) — it is per (reader, object, instant). Verification is
// therefore a SYNTHETIC FIXTURE MATRIX walked through the PURE composition (`composeRelationalState`),
// with no DB. The DB-touching resolvers are thin adapters; the LOGIC verified here is what matters.
//
// Run: npx tsx src/scripts/verify-relational.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { composeRelationalState } from "../relational/service.js";
import { anonymousContext } from "../relational/reader-context.js";
import { scanAssembled, scanStrength } from "../relational/copy.js";
import { assemble } from "../relational/arbitration.js";
import { MODE_CONTRACTS } from "../relational/mode-contract.js";
import { _debugCallCounts } from "../relational/entries.js";
import type { ReaderContext, ObjectState, ObjectFinding, ReaderHolding } from "../relational/types.js";
import { EMPTY_FILING_ECHO } from "../relational/constants.js";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const FROZEN_NOW = new Date("2026-07-25T12:00:00.000Z");
const daysAgo = (n: number) => new Date(FROZEN_NOW.getTime() - n * 24 * 60 * 60 * 1000);

// ── Finding fixtures ─────────────────────────────────────────────────────────────────────────────────
const N1_SIX_YEARS: ObjectFinding = {
  kind: "pattern",
  key: "foundation_N1_cash_backed_earnings",
  severity: "green",
  polarity: "positive",
  temporalClass: "CONDITION",
  evidence: {
    family: "N",
    pattern: "N1",
    name: "Cash-Backed Earnings",
    years: 6,
    verdict:
      "Cash-backed earnings — operating cash flow has fully covered net profit for 6 straight years (FY20–FY25); earnings converting reliably to cash.",
  },
};
const HIGH_NEG: ObjectFinding = {
  kind: "pattern",
  key: "momentum_B_deterioration",
  severity: "high",
  polarity: "negative",
  temporalClass: "CONDITION",
  evidence: { verdict: "Health has been deteriorating for two straight quarters." },
};
const MEDIUM_NEG: ObjectFinding = {
  kind: "pattern",
  key: "foundation_C1_divergence",
  severity: "medium",
  polarity: "negative",
  temporalClass: "CONDITION",
  evidence: { verdict: "A notable divergence between the pillars." },
};

// ── Object fixtures ──────────────────────────────────────────────────────────────────────────────────
function scoredObject(findings: ObjectFinding[]): ObjectState {
  return {
    kind: "stock",
    stockId: "stk-acme",
    symbol: "ACME",
    displayLabel: "Acme Industries",
    // §1.5 — the editorial lead path (a stock WITH a stock_overviews row).
    businessLead: "Makes industrial pumps and compressors for process plants.",
    isScored: true,
    coverage: { state: "scored_full", declinedCount: 0, declinedReasons: [], fullyEvaluated: true },
    snapshot: { generation: "snap-acme-1", periodKey: "FY26Q1", composite: 71, band: "steady" },
    sector: { key: "industrials", displayName: "Industrials", sectorClass: "Cyclical" },
    peerGroup: { id: "pg-1", label: "Industrial Machinery", memberCount: 9 },
    findings,
    // Phase 2 — the collector RAN and everything was evaluable. Full-strength "Nothing flagged."
    notEvaluable: [],
    pondMask: null,
  };
}
function unscoredObject(): ObjectState {
  return {
    kind: "stock",
    stockId: "stk-newco",
    symbol: "NEWCO",
    displayLabel: "Newco Ltd",
    businessLead: null, // §1.5 — the sector+classification FALLBACK path (no editorial row).
    isScored: false,
    coverage: { state: "covered_unscored", declinedCount: null, declinedReasons: [], fullyEvaluated: false },
    snapshot: null,
    sector: { key: "industrials", displayName: "Industrials", sectorClass: "Cyclical" },
    peerGroup: null,
    findings: [],
    // Unscored ⇒ no rule ever ran ⇒ we know nothing about declined checks (null, never []).
    notEvaluable: null,
    pondMask: null,
  };
}

// ── Reader fixtures ──────────────────────────────────────────────────────────────────────────────────
const acmeHolding = (): ReaderHolding => ({
  entityKey: "INE001A",
  displayLabel: "Acme Industries",
  value: 240000,
  weightPct: 24,
  accountLabels: ["Zerodha", "Long Term"],
  isScored: true,
  sector: "Industrials",
  route: "direct",
  symbols: ["ACME"],
});
const otherHoldings = (sector: string): ReaderHolding[] => [
  { entityKey: "INE900Z", displayLabel: "Beta Foods", value: 130000, weightPct: 13, accountLabels: ["Zerodha"], isScored: true, sector, route: "direct", symbols: ["BETA"] },
  { entityKey: "INE800Y", displayLabel: "Gamma Pharma", value: 90000, weightPct: 9, accountLabels: ["Long Term"], isScored: true, sector, route: "direct", symbols: ["GAMMA"] },
  { entityKey: "INE700X", displayLabel: "Delta Cement", value: 60000, weightPct: 6, accountLabels: ["Zerodha"], isScored: true, sector, route: "direct", symbols: ["DELTA"] },
  { entityKey: "INE600W", displayLabel: "Epsilon Auto", value: 55000, weightPct: 5.5, accountLabels: ["Long Term"], isScored: true, sector, route: "direct", symbols: ["EPS"] },
];

function heldContext(attention: ReaderContext["attention"], hasFund = true): ReaderContext {
  return {
    identity: { userId: "u1", isAuthenticated: true, aiLevel: "balanced" },
    heldThisObject: true,
    book: {
      exists: true,
      accountCount: 2,
      scoredHoldingsCount: 6,
      totalHoldingsCount: 7,
      unscoredHoldingsCount: 1,
      totalValue: 1_000_000,
      typicalPositionValue: 90000,
      holdings: [acmeHolding(), ...otherHoldings("Consumer")],
      hasFundHoldings: hasFund,
      lookThroughAvailable: false,
      phsComposite: 68,
      phsBand: "Steady",
    },
    watchlist: { exists: false, count: 0, thisAddedAt: null, peersInPeerGroup: [] },
    attention,
    // §Phase 4 — real pond exposure: ACME plus one other name in the same peer group, 33% of the book.
    // Above UN_PG_NOTABLE_PCT (25) and below UN_PG_HEAVY_PCT (40), so UN1 + UN2("notable") both fire.
    // §Phase 6 — 3 of 6 scored holdings carry foundation_C1_divergence: observedShare 0.50, firedInBook 3
    // ⇒ the SHARE path fires. Universe base rate is supplied by the fixture snapshot in the UE tests.
    // §Phase 7 — an evaluable delta: MEDIUM_NEG is newly standing since the last look.
    delta: { evaluable: true, since: daysAgo(10), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-0", newSnapshotSinceLastLook: true, newlyStandingKeys: ["foundation_C1_divergence"], clearedKeys: [], lastSeenBand: "healthy" },
    echo: { scoredHoldingsCount: 6, byPatternKey: new Map([["foundation_C1_divergence", ["Acme Industries", "Beta Foods", "Gamma Pharma"]]]), filing: EMPTY_FILING_ECHO() },
    neighbourhood: {
      pgWeightPct: 33,
      pgHeld: [
        { stockId: "stk-acme", symbol: "ACME", name: "Acme Industries", isThisObject: true },
        { stockId: "stk-delta", symbol: "DELTA", name: "Delta Cement", isThisObject: false },
      ],
      pgSize: 9,
      sectorWeightPct: 33,
      sectorHeldCount: 2,
    },
  };
}

function strangerContext(): ReaderContext {
  // Book exists, holds names in a DIFFERENT sector (no overlap → UO4 fires), watchlist empty, first view.
  return {
    identity: { userId: "u2", isAuthenticated: true, aiLevel: "balanced" },
    heldThisObject: false,
    book: {
      exists: true,
      accountCount: 1,
      scoredHoldingsCount: 4,
      totalHoldingsCount: 4,
      unscoredHoldingsCount: 0,
      totalValue: 400000,
      typicalPositionValue: 85000,
      holdings: otherHoldings("Consumer"),
      hasFundHoldings: false,
      lookThroughAvailable: false,
      phsComposite: 60,
      phsBand: "Steady",
    },
    watchlist: { exists: false, count: 0, thisAddedAt: null, peersInPeerGroup: [] },
    attention: { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null },
    // §Phase 7 — no last look ⇒ NOT EVALUABLE, never "nothing new".
    delta: { evaluable: false, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null },
    echo: { scoredHoldingsCount: 4, byPatternKey: new Map(), filing: EMPTY_FILING_ECHO() },
    // The stranger holds NOTHING in this pond and nothing in its sector — so UN1/UN2/UN7 all stay
    // silent and UO4 ("nothing connects") is the honest resolution. This is the UO4 path's fixture.
    neighbourhood: { pgWeightPct: 0, pgHeld: [], pgSize: 9, sectorWeightPct: 0, sectorHeldCount: 0 },
  };
}

const FIRST_ATTN: ReaderContext["attention"] = { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null };
const RETURNING_ATTN: ReaderContext["attention"] = { hasHistory: true, firstViewedAt: daysAgo(40), lastViewedAt: daysAgo(10), viewCount: 3, viewCountTrailing30d: 1, lastViewedSnapshotGeneration: "snap-acme-0" };
// RECURRING_MIN_VIEWS_30D is 4 (constants.ts) — 5 trailing-30d views clears it.
const RECURRING_ATTN: ReaderContext["attention"] = { hasHistory: true, firstViewedAt: daysAgo(60), lastViewedAt: daysAgo(2), viewCount: 8, viewCountTrailing30d: 5, lastViewedSnapshotGeneration: "snap-acme-1" };
// DORMANT_GAP_DAYS is 90 (constants.ts) — 120 days since last view clears it.
const DORMANT_ATTN: ReaderContext["attention"] = { hasHistory: true, firstViewedAt: daysAgo(200), lastViewedAt: daysAgo(120), viewCount: 6, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: "snap-acme-0" };

/** WATCHED position (M5-M8) — a real watchlist row for THIS object, never held. Position axis resolves
 *  WATCHED only via a non-null `thisAddedAt` (mode.ts's `resolvePosition`); everything else mirrors
 *  strangerContext()'s book/neighbourhood shape so the same object fixtures compose against it. */
function watchedContext(attention: ReaderContext["attention"]): ReaderContext {
  return {
    identity: { userId: "u3", isAuthenticated: true, aiLevel: "balanced" },
    heldThisObject: false,
    book: {
      exists: true,
      accountCount: 1,
      scoredHoldingsCount: 4,
      totalHoldingsCount: 4,
      unscoredHoldingsCount: 0,
      totalValue: 400000,
      typicalPositionValue: 85000,
      holdings: otherHoldings("Consumer"),
      hasFundHoldings: false,
      lookThroughAvailable: false,
      phsComposite: 60,
      phsBand: "Steady",
    },
    watchlist: { exists: true, count: 1, thisAddedAt: daysAgo(30), peersInPeerGroup: [] },
    attention,
    delta: attention?.hasHistory
      ? { evaluable: true, since: daysAgo(10), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-0", newSnapshotSinceLastLook: true, newlyStandingKeys: ["foundation_C1_divergence"], clearedKeys: [], lastSeenBand: "healthy" }
      : { evaluable: false, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null },
    echo: { scoredHoldingsCount: 4, byPatternKey: new Map(), filing: EMPTY_FILING_ECHO() },
    neighbourhood: { pgWeightPct: 0, pgHeld: [], pgSize: 9, sectorWeightPct: 0, sectorHeldCount: 0 },
  };
}

/** NEITHER position with real prior contact (M10-M12) — not held, not watched, but `attention.hasHistory`
 *  is true (RETURNING/RECURRING/DORMANT), which is exactly what distinguishes these modes from M9. */
function neitherWithHistoryContext(attention: ReaderContext["attention"]): ReaderContext {
  return {
    ...strangerContext(),
    identity: { userId: "u4", isAuthenticated: true, aiLevel: "balanced" },
    attention,
    delta: { evaluable: true, since: daysAgo(10), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-0", newSnapshotSinceLastLook: true, newlyStandingKeys: ["foundation_C1_divergence"], clearedKeys: [], lastSeenBand: "healthy" },
  };
}

const claimsOf = (s: ReturnType<typeof composeRelationalState>) => [s.header.claim, ...s.slots.filter((x) => x.entryId !== "UO1").map((x) => x.claim), ...s.overflow.filter((x) => x.entryId !== "UO1").map((x) => x.claim)];
const businessLeadClaimsOf = (s: ReturnType<typeof composeRelationalState>) => [...s.slots, ...s.overflow].filter((x) => x.entryId === "UO1").map((x) => x.claim);
const slotIds = (s: ReturnType<typeof composeRelationalState>) => s.slots.map((x) => x.entryId);
const hasEntry = (s: ReturnType<typeof composeRelationalState>, id: string) => [...s.slots, ...s.overflow].some((x) => x.entryId === id);
const negFacts = (s: ReturnType<typeof composeRelationalState>) => s.negatives.map((n) => n.fact);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n══ FIXTURE 1 · M1 — holder, first view, scored, Family N standing strength ══");
const m1 = composeRelationalState(heldContext(FIRST_ATTN), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
ok("mode is M1", m1.mode === "M1", m1.mode);
// ⚠ INVERTED IN THIS BUILD (§1.1). This assertion used to REQUIRE the "first time you're reading it"
// framing. That claim is unverifiable: M1 is selected by the ABSENCE of a BehaviorRollup row, and the
// attention beacon drops its whole buffer when no token is present, so a holder who has read the stock
// ten times could be told it was their first. The assertion now FORBIDS the claim it once demanded.
ok("header is UH6 and makes NO first-view claim", m1.header.entryId === "UH6" && !/first time|never (read|opened|looked)|haven't (read|opened|looked)/i.test(m1.header.claim));
ok("floor UH1 present (position)", hasEntry(m1, "UH1"));
ok("card is non-empty (guaranteed-resolve)", m1.slots.length > 0);
// ⚠ §1.3 — the floor guarantees INCLUSION, not position. UH1 is rung 5; a rung-1/3 critical finding
// legitimately precedes it. The assertion is now inclusion + ladder order, not "floor is first".
ok("UH1 included (floor guarantee)", slotIds(m1).includes("UH1"));
// ⚠ RE-DERIVED (§4.2, floor-as-rank). The floor takes the MODE'S floor rank, not its global rung, so
// a floor entry may legitimately precede a lower-rung entry. The ladder governs the NON-FLOOR TAIL,
// which is what this now asserts. (The previous version hardcoded a floor id list and would have
// silently rotted as floors changed per mode — an assertion written against behaviour, not spec.)
{
  // Floor derived from the CONTRACT itself, not restated — tracks mode-contract.ts instead of rotting
  // silently if a mode's floor ever changes shape (exactly the failure mode this file's own history
  // warns about, above). M1's floorIds ignores its arguments (unconditional ["UH1"]), so `null as any`
  // stands in cleanly rather than fabricating a full ResolvedMode/ObjectState just to satisfy the type.
  const declared = new Set(MODE_CONTRACTS.M1.floorIds(null as any, null as any, null as any));
  const tail = m1.slots.filter((x) => !declared.has(x.entryId));
  ok("non-floor tail is in ladder order", tail.every((s, i, a) => i === 0 || a[i - 1].weight.ladderRung <= s.weight.ladderRung));
}
{
  // Locate UH1 by id, not by position — ordering is the ladder's, not the floor's (§1.3).
  const uh1 = [...m1.slots, ...m1.overflow].find((x) => x.entryId === "UH1")!;
  ok("UH1 renders market value ₹2.4 lakh + weight", /₹2\.4 lakh/.test(uh1.claim) && /24% of your book/.test(uh1.claim));
}
ok("UO6 fires with duration from the rule's own evidence", hasEntry(m1, "UO6"));
const uo6 = [...m1.slots, ...m1.overflow].find((x) => x.entryId === "UO6")!;
ok("UO6 standingSince from run length (6), source rule_evidence, standing_since absent", uo6?.standingSince?.snapshotCount === 6 && uo6.arithmetic?.source === "rule_evidence");
ok("negatives include first_visit (held → NOT not_held)", negFacts(m1).includes("first_visit") && !negFacts(m1).includes("not_held"));
ok("negatives include lookthrough_unavailable (held fund)", negFacts(m1).includes("lookthrough_unavailable"));

console.log("\n══ FIXTURE 2 · M2 — holder, RETURNING with a delta (anti-scolding) ══");
const m3 = composeRelationalState(heldContext(RETURNING_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
// ⚠ RE-DERIVED (§2.2 grid + §Phase 7 unfold). HELD × RETURNING is M2, not M3 — M3 is HELD × RECURRING.
// This assertion previously read M3 only because M2 FOLDED to it; with M2 unfolded the grid's own
// definition applies. Asserting M3 here would now be asserting the fold, not the spec.
ok("mode is M2 (HELD × RETURNING, per the grid)", m3.mode === "M2", m3.mode);
ok("floor UH1 present", hasEntry(m3, "UH1"));
ok("card non-empty", m3.slots.length > 0);
ok("UO6 present in M3 (anti-scolding: not a bare 'nothing new')", hasEntry(m3, "UO6"));
ok("header does not quote attention as content", !/\d+ times|you.?ve (looked|opened|viewed)/i.test(m3.header.claim));
// ⚠ NEW — a returning holder does not need identity re-explained (mode contract requirement). Confirms
// the eligibility narrowing is real, not just that the old assertions still pass around it (they did —
// they never checked UO1's absence, only filtered it out via claimsOf's helper).
ok("UO1 excluded on a returning holder (M2)", !hasEntry(m3, "UO1"));

console.log("\n══ FIXTURE 3 · M9 — authenticated stranger (not held, not watched) ══");
const m9auth = composeRelationalState(strangerContext(), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M9", m9auth.mode === "M9", m9auth.mode);
ok("floor UO1 present (orientation)", hasEntry(m9auth, "UO1"));
// UO2/UO3 deleted (redundant with the page's own health section and the findings ELEVATED/UD1 already
// list individually) — no assertion of their presence; nothing replaces them at this rung.
ok("UO4 fires (book exists, no sector overlap, watchlist empty)", hasEntry(m9auth, "UO4"));
ok("card non-empty", m9auth.slots.length > 0);
ok("negatives include not_held", negFacts(m9auth).includes("not_held"));
ok("no UH entry (not held)", !slotIds(m9auth).some((id) => id.startsWith("UH")));
ok("negatives NOT anonymous", !negFacts(m9auth).includes("anonymous"));

console.log("\n══ FIXTURE 4 · M9 — ANONYMOUS reader ══");
const m9anon = composeRelationalState(anonymousContext(), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M9", m9anon.mode === "M9", m9anon.mode);
ok("floor UO1 present", hasEntry(m9anon, "UO1"));
ok("card non-empty (never errors)", m9anon.slots.length > 0);
ok("negatives include anonymous + not_held", negFacts(m9anon).includes("anonymous") && negFacts(m9anon).includes("not_held"));
ok("UO-only content (no UH/book entries)", !slotIds(m9anon).some((id) => id.startsWith("UH")));
ok("no mention of signed-in capability (UG8)", !/sign ?in|signed.?in|log ?in|connect a portfolio|when you (sign|log)/i.test(claimsOf(m9anon).join(" ")));

console.log("\n══ ASSERTION · UO6 never fires on an absence of flags (verify 17) ══");
const cleanNoStrength = composeRelationalState(strangerContext(), scoredObject([]), FROZEN_NOW);
ok("clean stock, no positive finding → UO6 does NOT fire", !hasEntry(cleanNoStrength, "UO6"));
// ⚠ UO3 ("Nothing flagged.") deleted — it used to carry this state. Per Part IX·19 (manufacture strength
// from silence is fabrication in the constructive direction), the absence of UO6 must not be filled by
// anything CLAIMING strength either — the assertion now checks the negative: nothing on the card asserts
// a positive/clean verdict when there is genuinely nothing to report at this rung.
ok("no entry fabricates a clean/strength verdict in UO3's absence", !claimsOf(cleanNoStrength).some((c) => /nothing flagged/i.test(c)));

console.log("\n══ ASSERTION · relevance is magnitude-blind (verify 18) ══");
// A high-severity finding (magnitude conceptually null) must outrank a medium (magnitude conceptually −8).
// ObjectFinding does not even carry magnitude, so ordering is severity-only by construction.
// ⚠ RE-DERIVED. The held fixture now carries an EVALUABLE delta whose newlyStandingKeys includes
// foundation_C1_divergence, so that finding correctly renders as UD1 (rung 2 — delta before state),
// not ELEVATED (rung 9). Comparing two ELEVATED ids would be asserting the absence of the UD family.
// Magnitude-blindness is tested where it is actually at stake: two findings BOTH on the elevated path.
const magCtx = { ...heldContext(RETURNING_ATTN), delta: { evaluable: false as const, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null } };
const magBlind = composeRelationalState(magCtx, scoredObject([MEDIUM_NEG, HIGH_NEG]), FROZEN_NOW);
const all = [...magBlind.slots, ...magBlind.overflow].map((x) => x.entryId);
const iHigh = all.indexOf("ELEVATED:momentum_B_deterioration");
const iMed = all.indexOf("ELEVATED:foundation_C1_divergence");
ok("HIGH severity outranks MEDIUM (rung 7 before 9), magnitude never read", iHigh >= 0 && iMed >= 0 && iHigh < iMed);

console.log("\n══ ASSERTION · stability — unchanged state ⇒ identical slot order (verify 9) ══");
const a = composeRelationalState(heldContext(RETURNING_ATTN), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
const b = composeRelationalState(heldContext(RETURNING_ATTN), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
ok("two resolves → identical slot ids", JSON.stringify(slotIds(a)) === JSON.stringify(slotIds(b)), `${slotIds(a)} vs ${slotIds(b)}`);

console.log("\n══ ASSERTION · novelty never reorders (verify 10) ══");
// Same state, differing only in lastViewedAt (both still RETURNING) → identical order.
const nov1 = composeRelationalState(heldContext({ ...RETURNING_ATTN, lastViewedAt: daysAgo(5) }), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
const nov2 = composeRelationalState(heldContext({ ...RETURNING_ATTN, lastViewedAt: daysAgo(20) }), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
ok("different lastViewedAt → same slot order", JSON.stringify(slotIds(nov1)) === JSON.stringify(slotIds(nov2)));

console.log("\n══ ASSERTION · held-but-not-scored resolves (UH1 + UH10) ══");
const heldUnscored = composeRelationalState(
  { ...heldContext(FIRST_ATTN), book: { ...heldContext(FIRST_ATTN).book!, holdings: [{ ...acmeHolding(), symbols: ["NEWCO"], displayLabel: "Newco Ltd", value: 30000, weightPct: 3, accountLabels: ["Zerodha"] }] } },
  unscoredObject(),
  FROZEN_NOW,
);
ok("held + unscored → UH1 still resolves", hasEntry(heldUnscored, "UH1"));
ok("held + unscored → UH10 coverage note", hasEntry(heldUnscored, "UH10"));
// UO2 deleted — the "no health line on an unscored stock" fact is no longer this card's business at
// all (the page's own health section states scored-or-not directly); nothing to assert in its place.

console.log("\n══ ASSERTION · degradations declared, never fabricated (§6) ══");
const degs = m1.meta.degradations.map((d) => d.prerequisite);
// ⚠ `evaluability` was RESOLVED in Phase 2 (the live path collects declined checks and persists them),
// so it is no longer an absent prerequisite. It is replaced by `evaluability_backfill` — the residual
// gap for snapshots written before the column existed. `watchlist_modes` was resolved in Phase 1.2.
for (const p of ["standing_since", "evaluability_backfill", "polarity", "universe_base_rates", "fund_look_through", "position_delta"]) {
  ok(`degradation recorded: ${p}`, degs.includes(p));
}

console.log("\n══ ASSERTION · register — no UO6 claim carries a celebration word (verify 15/register grep) ══");
ok("UO6 claim is celebration-free", scanStrength(uo6.claim).length === 0, scanStrength(uo6.claim).map((h) => h.term).join(","));

console.log("\n══ ASSERTION · a 'healthy'/'pristine' BAND label is not a register violation (band ≠ celebration) ══");
{
  // ⚠ DECOUPLED FROM UO2 (deleted). This tests scanAssembled's own carve-out — a factual band label is
  // not a celebration word — as a property of the SCANNER, not of any specific still-living entry. A
  // fabricated claim string stands in directly rather than resolving a full card through whichever
  // entry happens to render a band today (copy.ts's own carve-out comment was reworded for the same
  // reason: it no longer names a specific entryId).
  const bandClaim = "Health is about 88 — healthy.";
  ok("a factual band label alone is register-clean (band ≠ celebration)", scanAssembled([bandClaim], "balanced").length === 0);
}

console.log("\n══ ASSERTION · no reader P&L / basis / return on any UH (position) claim (§0.8) ══");
{
  const uhClaims = [m1, m3].flatMap((s) => [...s.slots, ...s.overflow]).filter((x) => x.family === "UH").map((x) => x.claim);
  const pnl = uhClaims.filter((c) => /\binvested\b|cost basis|\breturn(s|ed)?\b|\bgain\b|\bloss\b|\bp&l\b/i.test(c));
  ok("no UH claim renders invested / basis / return / gain / loss", pnl.length === 0, pnl.join(" | "));
}

console.log("\n══ ASSERTION · assembled output passes the full register guard at all three registers ══");
for (const level of ["plain", "balanced", "technical"] as const) {
  const s = composeRelationalState({ ...heldContext(FIRST_ATTN), identity: { userId: "u1", isAuthenticated: true, aiLevel: level } }, scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
  const v = scanAssembled(claimsOf(s), level, businessLeadClaimsOf(s));
  ok(`register-clean at ${level}`, v.length === 0, v.map((x) => `${x.term}:"${x.text}"`).join(" | "));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE MODE CONTRACT (new coverage) — watched modes, neither-with-history modes, contract conformance,
// construction-not-filtering proof, and the M3/M11 short-slot-list pair (formerly framed as "empty
// card"; see mode-contract.ts's ud7AwareFloor comment for why that framing was retired).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

console.log("\n══ FIXTURE 5 · M5 — watched, first view ══");
const m5 = composeRelationalState(watchedContext(FIRST_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M5", m5.mode === "M5", m5.mode);
ok("floor UW1 + UO1 present", hasEntry(m5, "UW1") && hasEntry(m5, "UO1"));
ok("never renders the stranger header 'New to you'", !/new to you/i.test(m5.header.claim));
ok("UD excluded on FIRST attention (no delta possible)", !slotIds(m5).some((id) => id.startsWith("UD")));

console.log("\n══ FIXTURE 6 · M7 — watched, RECURRING (UD eligible) ══");
// watchedContext()'s delta claims foundation_C1_divergence is newly standing — buildUD1 only emits an
// entry for a newlyStandingKey that ALSO appears in obj.findings, so the object fixture must carry it.
const m7 = composeRelationalState(watchedContext(RECURRING_ATTN), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
ok("mode is M7", m7.mode === "M7", m7.mode);
ok("floor UW1 + UO1 present", hasEntry(m7, "UW1") && hasEntry(m7, "UO1"));
ok("UD1 fires (delta eligible + evaluable on a RECURRING watcher)", hasEntry(m7, "UD1:foundation_C1_divergence"));

console.log("\n══ FIXTURE 7 · M10 — NEITHER, RETURNING (prior contact, not held/watched) ══");
const m10 = composeRelationalState(neitherWithHistoryContext(RETURNING_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M10", m10.mode === "M10", m10.mode);
ok("floor UO1 present", hasEntry(m10, "UO1"));
ok("never renders the stranger header 'New to you' (the last cross-fold falsehood this build fixed)", !/new to you/i.test(m10.header.claim));
ok("no UW1 (position axis is NEITHER, not WATCHED)", !hasEntry(m10, "UW1"));

console.log("\n══ FIXTURE 8 · M12 — NEITHER, DORMANT ══");
const m12 = composeRelationalState(neitherWithHistoryContext(DORMANT_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M12", m12.mode === "M12", m12.mode);
ok("floor UO1 present", hasEntry(m12, "UO1"));

console.log("\n══ ASSERTION · contract conformance — every live slot's family is in the mode's declared eligible set ══");
{
  // Static half of "no ineligible candidate is constructed": read the CONTRACT directly (not the
  // resolved card) for each fixture's mode, and confirm every resolved entryId maps to a slot the
  // contract actually declares eligible. UD1/UD3 share the "UD" slot name; UH1-4/UH10 share
  // "heldPositionFamily"; buildElevated/echo entries are prefixed/opaque and are treated as their
  // family's slot ("elevated", "UE") rather than a literal id.
  const baseSlotFor = (entryId: string): string => {
    if (entryId.startsWith("ELEVATED:")) return "elevated";
    if (entryId.startsWith("UD")) return "UD";
    if (entryId.startsWith("UE")) return "UE";
    if (["UH1", "UH2", "UH3", "UH4", "UH10"].includes(entryId)) return "heldPositionFamily";
    return entryId;
  };
  const fixtures: [string, ReturnType<typeof composeRelationalState>][] = [
    ["M1", m1], ["M2", m3], ["M5", m5], ["M7", m7], ["M9(auth)", m9auth], ["M10", m10], ["M12", m12],
  ];
  for (const [label, s] of fixtures) {
    const contract = MODE_CONTRACTS[s.mode];
    const offenders = [...s.slots, ...s.overflow]
      .map((e) => e.entryId)
      .filter((id) => !contract.eligible.has(baseSlotFor(id) as any));
    ok(`${label} (${s.mode}): every resolved entry maps to a contract-eligible slot`, offenders.length === 0, offenders.join(", "));
  }
}

console.log("\n══ ASSERTION · construction is gated, not filtered (dynamic half, via _debugCallCounts) ══");
{
  // buildEntries resets _debugCallCounts at the top of every call and ticks a slot only inside its
  // `if (has(slot))` guard — so re-resolving a fixture and reading the counter immediately after proves
  // the ineligible builder was never INVOKED, not merely that its result was dropped afterward.
  composeRelationalState(heldContext(RETURNING_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW); // M2
  ok("M2: UO1's builder was never called (ineligible on a returning holder)", !_debugCallCounts.UO1);
  ok("M2: UD's builder WAS called (eligible on RETURNING)", (_debugCallCounts.UD ?? 0) > 0);

  composeRelationalState(heldContext(FIRST_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW); // M1
  ok("M1: UD's builder was never called (ineligible on FIRST attention)", !_debugCallCounts.UD);
  ok("M1: UO1's builder WAS called (eligible on the true first view)", (_debugCallCounts.UO1 ?? 0) > 0);

  composeRelationalState(watchedContext(FIRST_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW); // M5
  ok("M5: heldPositionFamily's builders were never called (not held)", !_debugCallCounts.heldPositionFamily);
}

console.log("\n══ ASSERTION · fill-if-room — an honest-null never displaces real content for a contested slot ══");
{
  // strangerContext() has NOTHING connecting (UO4-eligible) and the M1 fixture's book carries a real
  // UN1/UN2 pond exposure — reuse m1's resolved card, which already contests UN8 (rung 15, honest-null)
  // against real content at higher rungs under a cap of 3. If fill-if-room works, UN8 should not have
  // displaced any of the real content that resolved at a competing rung.
  const nonNullSlots = m1.slots.filter((s) => !["UO4", "UN8", "UG5", "UE5"].includes(s.entryId));
  ok("M1: honest-nulls never crowded out the mode's real content within cap", nonNullSlots.length >= Math.min(m1.slots.length, 2), m1.slots.map((s) => s.entryId).join(","));
}

console.log("\n══ ASSERTION · assemble() boundary — empty floor + empty candidates resolves cleanly, never throws ══");
{
  let threw = false;
  let result: ReturnType<typeof assemble> | null = null;
  try {
    result = assemble([], [], 4);
  } catch {
    threw = true;
  }
  ok("assemble([], [], cap) does not throw", !threw);
  ok("assemble([], [], cap) returns empty slots and overflow", result?.slots.length === 0 && result?.overflow.length === 0);
}

console.log("\n══ FIXTURE 9 · M3 — RECURRING holder, genuinely empty delta (the UD7 short-card case) ══");
{
  const emptyDelta: ReaderContext["delta"] = { evaluable: true, since: daysAgo(5), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-1", newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: "steady" };
  const m3empty = composeRelationalState({ ...heldContext(RECURRING_ATTN), delta: emptyDelta }, scoredObject([]), FROZEN_NOW);
  ok("mode is M3", m3empty.mode === "M3", m3empty.mode);
  ok("header is UD7 (genuinely nothing changed)", m3empty.header.entryId === "UD7" && /nothing new/i.test(m3empty.header.claim));
  // ⚠ NOT slots.length === 0 — see mode-contract.ts's ud7AwareFloor comment. Clearing the floor removes
  // the RESERVATION, not UH1's eligibility; the ladder still fills the freed room with real content.
  // "Bare header" is not a reachable state under realistic inputs on ANY mode (confirmed on M3 and M11
  // during implementation) — the actual, uniform outcome is "UD7 header + short slot list led by real
  // content," which is what this asserts.
  ok("floor NOT reserved (UH1 present via the ladder, not a guaranteed floor seat)", hasEntry(m3empty, "UH1"));
  ok("led by UH1 — the reader's own position fact leads the short card", m3empty.slots[0]?.entryId === "UH1", m3empty.slots.map((s) => s.entryId).join(","));

  // Negative control: same reader, same mode, a REAL delta — floor stays reserved, standing header shows,
  // AND a real delta finding (UD1, rung 2) contests the card in addition to whatever UH1/UH3 contribute
  // on their own — so the negative control is never SHORTER than the empty-delta card, confirming the
  // comparison is meaningful rather than an arbitrary count on one side.
  const realDelta: ReaderContext["delta"] = { evaluable: true, since: daysAgo(5), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-0", newSnapshotSinceLastLook: true, newlyStandingKeys: ["foundation_C1_divergence"], clearedKeys: [], lastSeenBand: "steady" };
  const m3real = composeRelationalState({ ...heldContext(RECURRING_ATTN), delta: realDelta }, scoredObject([MEDIUM_NEG]), FROZEN_NOW);
  ok("negative control — mode is M3", m3real.mode === "M3", m3real.mode);
  ok("negative control — header is the standing frame, not UD7", m3real.header.entryId === "UH1-standing");
  ok("negative control — UD1 fires (a real delta is present)", hasEntry(m3real, "UD1:foundation_C1_divergence"));
  ok("negative control is never shorter than the empty-delta card (extra content, not less)", m3real.slots.length >= m3empty.slots.length, `${m3real.slots.length} vs ${m3empty.slots.length}`);
}

console.log("\n══ FIXTURE 10 · M11 — RECURRING, NEITHER, genuinely empty delta (the UD7 short-card case, stranger side) ══");
{
  const emptyDelta: ReaderContext["delta"] = { evaluable: true, since: daysAgo(5), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-1", newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: "steady" };
  const m11empty = composeRelationalState({ ...neitherWithHistoryContext(RECURRING_ATTN), delta: emptyDelta }, scoredObject([]), FROZEN_NOW);
  ok("mode is M11", m11empty.mode === "M11", m11empty.mode);
  ok("header is UD7", m11empty.header.entryId === "UD7" && /nothing new/i.test(m11empty.header.claim));
  ok("floor NOT reserved (UO1 present via the ladder, not a guaranteed floor seat)", hasEntry(m11empty, "UO1"));

  // Negative control.
  const realDelta: ReaderContext["delta"] = { evaluable: true, since: daysAgo(5), sinceLabel: "July 2026", lastSeenGeneration: "snap-acme-0", newSnapshotSinceLastLook: true, newlyStandingKeys: ["foundation_C1_divergence"], clearedKeys: [], lastSeenBand: "steady" };
  const m11real = composeRelationalState({ ...neitherWithHistoryContext(RECURRING_ATTN), delta: realDelta }, scoredObject([MEDIUM_NEG]), FROZEN_NOW);
  ok("negative control — mode is M11", m11real.mode === "M11", m11real.mode);
  ok("negative control — header is NOT UD7", m11real.header.entryId !== "UD7");
}

console.log(`\n${"═".repeat(60)}\nRELATIONAL VERIFY — ${pass} passed, ${fail} failed\n${"═".repeat(60)}`);
process.exit(fail === 0 ? 0 : 1);
