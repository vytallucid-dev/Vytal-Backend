// One-off: print the full RelationalState payload for the four required fixtures (M1 / M3 / M9-auth /
// M9-anon). Reuses the synthetic fixtures from the verify harness's shape. Run: npx tsx this-file.
import { composeRelationalState } from "../relational/service.js";
import { anonymousContext } from "../relational/reader-context.js";
import type { ReaderContext, ObjectState, ObjectFinding, ReaderHolding } from "../relational/types.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

const N1: ObjectFinding = {
  kind: "pattern", key: "foundation_N1_cash_backed_earnings", severity: "green", polarity: "positive", temporalClass: "CONDITION",
  evidence: { family: "N", pattern: "N1", name: "Cash-Backed Earnings", years: 6, verdict: "Cash-backed earnings — operating cash flow has fully covered net profit for 6 straight years (FY20–FY25); earnings converting reliably to cash." },
};
const MED: ObjectFinding = { kind: "pattern", key: "foundation_C1_divergence", severity: "medium", polarity: "negative", temporalClass: "CONDITION", evidence: { verdict: "A notable divergence between the pillars." } };

const obj = (findings: ObjectFinding[]): ObjectState => ({
  kind: "stock", stockId: "stk-acme", symbol: "ACME", displayLabel: "Acme Industries", businessLead: null, isScored: true, notEvaluable: [],
  coverage: { state: "scored_full", declinedCount: 0, declinedReasons: [], fullyEvaluated: true }, snapshot: { generation: "snap-acme-1", periodKey: "FY26Q1", composite: 71, band: "steady" },
  sector: { key: "industrials", displayName: "Industrials", sectorClass: "Cyclical" }, peerGroup: { id: "pg-1", label: "Industrial Machinery", memberCount: 9 }, findings, pondMask: null,
});
const acme = (): ReaderHolding => ({ entityKey: "INE001A", displayLabel: "Acme Industries", value: 240000, weightPct: 24, accountLabels: ["Zerodha", "Long Term"], isScored: true, sector: "Industrials", route: "direct", symbols: ["ACME"] });
const others = (sector: string): ReaderHolding[] => [
  { entityKey: "INE900Z", displayLabel: "Beta Foods", value: 130000, weightPct: 13, accountLabels: ["Zerodha"], isScored: true, sector, route: "direct", symbols: ["BETA"] },
  { entityKey: "INE800Y", displayLabel: "Gamma Pharma", value: 90000, weightPct: 9, accountLabels: ["Long Term"], isScored: true, sector, route: "direct", symbols: ["GAMMA"] },
];
const held = (attn: ReaderContext["attention"]): ReaderContext => ({
  identity: { userId: "u1", isAuthenticated: true, aiLevel: "balanced" }, heldThisObject: true,
  book: { exists: true, accountCount: 2, scoredHoldingsCount: 6, totalHoldingsCount: 7, unscoredHoldingsCount: 1, totalValue: 1_000_000, typicalPositionValue: 90000, holdings: [acme(), ...others("Consumer")], hasFundHoldings: true, lookThroughAvailable: false, phsComposite: 68, phsBand: "Steady" },
  watchlist: { exists: false, count: 0, thisAddedAt: null, peersInPeerGroup: [] }, attention: attn,
  echo: { scoredHoldingsCount: 6, byPatternKey: new Map() },
  delta: { evaluable: false, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null },
  neighbourhood: { pgWeightPct: 33, pgHeld: [{ stockId: "stk-acme", symbol: "ACME", name: "Acme Industries", isThisObject: true }, { stockId: "stk-d", symbol: "DELTA", name: "Delta Cement", isThisObject: false }], pgSize: 9, sectorWeightPct: 33, sectorHeldCount: 2 },
});
const stranger = (): ReaderContext => ({
  identity: { userId: "u2", isAuthenticated: true, aiLevel: "balanced" }, heldThisObject: false,
  book: { exists: true, accountCount: 1, scoredHoldingsCount: 4, totalHoldingsCount: 4, unscoredHoldingsCount: 0, totalValue: 400000, typicalPositionValue: 85000, holdings: others("Consumer"), hasFundHoldings: false, lookThroughAvailable: false, phsComposite: 60, phsBand: "Steady" },
  watchlist: { exists: false, count: 0, thisAddedAt: null, peersInPeerGroup: [] }, attention: { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null },
  echo: { scoredHoldingsCount: 4, byPatternKey: new Map() },
  delta: { evaluable: false, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null },
  neighbourhood: { pgWeightPct: 0, pgHeld: [], pgSize: 9, sectorWeightPct: 0, sectorHeldCount: 0 },
});
const FIRST: ReaderContext["attention"] = { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null };
const RETURNING: ReaderContext["attention"] = { hasHistory: true, firstViewedAt: daysAgo(40), lastViewedAt: daysAgo(10), viewCount: 3, viewCountTrailing30d: 1, lastViewedSnapshotGeneration: "snap-acme-0" };

const show = (title: string, s: ReturnType<typeof composeRelationalState>) => {
  console.log(`\n${"═".repeat(78)}\n${title} — mode ${s.mode}\n${"═".repeat(78)}`);
  console.log(`HEADER  [${s.header.entryId}] ${s.header.claim}`);
  s.slots.forEach((x, i) => console.log(`SLOT ${i + 1}  [${x.entryId}] r${x.weight.ladderRung}  ${x.claim}${x.standingSince ? `  ⟨${x.standingSince.label}⟩` : ""}`));
  if (s.overflow.length) s.overflow.forEach((x) => console.log(`OVERFLOW [${x.entryId}] r${x.weight.ladderRung}  ${x.claim}`));
  console.log(`NEGATIVES  ${s.negatives.map((n) => n.fact).join(", ")}`);
  console.log(`META  snapshotGeneration=${s.meta.snapshotGeneration}  degradations=${s.meta.degradations.length}`);
};

show("FIXTURE 1 · M1 holder-first", composeRelationalState(held(FIRST), obj([N1, MED]), NOW));
show("FIXTURE 2 · M3 holder-return", composeRelationalState(held(RETURNING), obj([N1]), NOW));
show("FIXTURE 3 · M9 authenticated-stranger", composeRelationalState(stranger(), obj([N1]), NOW));
show("FIXTURE 4 · M9 anonymous", composeRelationalState(anonymousContext(), obj([N1]), NOW));

// Full JSON of fixture 1 (the richest), for the record.
console.log(`\n${"═".repeat(78)}\nFULL JSON · FIXTURE 1 (M1)\n${"═".repeat(78)}`);
console.log(JSON.stringify(composeRelationalState(held(FIRST), obj([N1, MED]), NOW), null, 2));
