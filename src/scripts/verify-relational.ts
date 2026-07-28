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
import type { ReaderContext, ObjectState, ObjectFinding, ReaderHolding } from "../relational/types.js";

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
    isScored: true,
    coverage: { state: "scored", reason: null },
    snapshot: { generation: "snap-acme-1", periodKey: "FY26Q1", composite: 71, band: "steady" },
    sector: { key: "industrials", displayName: "Industrials", sectorClass: "Cyclical" },
    peerGroup: { id: "pg-1", label: "Industrial Machinery", memberCount: 9 },
    findings,
    pondMask: null,
  };
}
function unscoredObject(): ObjectState {
  return {
    kind: "stock",
    stockId: "stk-newco",
    symbol: "NEWCO",
    displayLabel: "Newco Ltd",
    isScored: false,
    coverage: { state: "covered", reason: "needs four years of accounts and we have two" },
    snapshot: null,
    sector: { key: "industrials", displayName: "Industrials", sectorClass: "Cyclical" },
    peerGroup: null,
    findings: [],
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
    watchlist: { exists: false, count: 0, thisAddedAt: null },
    attention,
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
    watchlist: { exists: false, count: 0, thisAddedAt: null },
    attention: { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null },
  };
}

const FIRST_ATTN: ReaderContext["attention"] = { hasHistory: false, firstViewedAt: null, lastViewedAt: null, viewCount: 0, viewCountTrailing30d: 0, lastViewedSnapshotGeneration: null };
const RETURNING_ATTN: ReaderContext["attention"] = { hasHistory: true, firstViewedAt: daysAgo(40), lastViewedAt: daysAgo(10), viewCount: 3, viewCountTrailing30d: 1, lastViewedSnapshotGeneration: "snap-acme-0" };

const claimsOf = (s: ReturnType<typeof composeRelationalState>) => [s.header.claim, ...s.slots.map((x) => x.claim), ...s.overflow.map((x) => x.claim)];
const slotIds = (s: ReturnType<typeof composeRelationalState>) => s.slots.map((x) => x.entryId);
const hasEntry = (s: ReturnType<typeof composeRelationalState>, id: string) => [...s.slots, ...s.overflow].some((x) => x.entryId === id);
const negFacts = (s: ReturnType<typeof composeRelationalState>) => s.negatives.map((n) => n.fact);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n══ FIXTURE 1 · M1 — holder, first view, scored, Family N standing strength ══");
const m1 = composeRelationalState(heldContext(FIRST_ATTN), scoredObject([N1_SIX_YEARS, MEDIUM_NEG]), FROZEN_NOW);
ok("mode is M1", m1.mode === "M1", m1.mode);
ok("header is UH6 'first time' framing", m1.header.entryId === "UH6" && /first time you're reading it/i.test(m1.header.claim));
ok("floor UH1 present (position)", hasEntry(m1, "UH1"));
ok("card is non-empty (guaranteed-resolve)", m1.slots.length > 0);
ok("UH1 leads (floor reserved first)", slotIds(m1)[0] === "UH1");
ok("UH1 renders market value ₹2.4 lakh + weight", /₹2\.4 lakh/.test(m1.slots[0].claim) && /24% of your book/.test(m1.slots[0].claim));
ok("UO6 fires with duration from the rule's own evidence", hasEntry(m1, "UO6"));
const uo6 = [...m1.slots, ...m1.overflow].find((x) => x.entryId === "UO6")!;
ok("UO6 standingSince from run length (6), source rule_evidence, standing_since absent", uo6?.standingSince?.snapshotCount === 6 && uo6.arithmetic?.source === "rule_evidence");
ok("negatives include first_visit (held → NOT not_held)", negFacts(m1).includes("first_visit") && !negFacts(m1).includes("not_held"));
ok("negatives include lookthrough_unavailable (held fund)", negFacts(m1).includes("lookthrough_unavailable"));

console.log("\n══ FIXTURE 2 · M3 — holder, returning, clean-but-strong (anti-scolding) ══");
const m3 = composeRelationalState(heldContext(RETURNING_ATTN), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M3", m3.mode === "M3", m3.mode);
ok("floor UH1 present", hasEntry(m3, "UH1"));
ok("card non-empty", m3.slots.length > 0);
ok("UO6 present in M3 (anti-scolding: not a bare 'nothing new')", hasEntry(m3, "UO6"));
ok("header does not quote attention as content", !/\d+ times|you.?ve (looked|opened|viewed)/i.test(m3.header.claim));

console.log("\n══ FIXTURE 3 · M9 — authenticated stranger (not held, not watched) ══");
const m9auth = composeRelationalState(strangerContext(), scoredObject([N1_SIX_YEARS]), FROZEN_NOW);
ok("mode is M9", m9auth.mode === "M9", m9auth.mode);
ok("floor UO1 present (orientation)", hasEntry(m9auth, "UO1"));
ok("UO2 present (health plainly)", hasEntry(m9auth, "UO2"));
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
ok("UO3 'Nothing flagged.' carries it instead", [...cleanNoStrength.slots, ...cleanNoStrength.overflow].some((x) => x.entryId === "UO3" && /nothing flagged/i.test(x.claim)));

console.log("\n══ ASSERTION · relevance is magnitude-blind (verify 18) ══");
// A high-severity finding (magnitude conceptually null) must outrank a medium (magnitude conceptually −8).
// ObjectFinding does not even carry magnitude, so ordering is severity-only by construction.
const magBlind = composeRelationalState(heldContext(RETURNING_ATTN), scoredObject([MEDIUM_NEG, HIGH_NEG]), FROZEN_NOW);
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
ok("no UO2 (unscored → no health line)", !hasEntry(heldUnscored, "UO2"));

console.log("\n══ ASSERTION · degradations declared, never fabricated (§6) ══");
const degs = m1.meta.degradations.map((d) => d.prerequisite);
for (const p of ["standing_since", "evaluability", "polarity", "universe_base_rates", "fund_look_through", "position_delta", "watchlist_modes"]) {
  ok(`degradation recorded: ${p}`, degs.includes(p));
}

console.log("\n══ ASSERTION · register — no UO6 claim carries a celebration word (verify 15/register grep) ══");
ok("UO6 claim is celebration-free", scanStrength(uo6.claim).length === 0, scanStrength(uo6.claim).map((h) => h.term).join(","));

console.log("\n══ ASSERTION · a 'healthy'/'pristine' BAND label is not a register violation (band ≠ celebration) ══");
{
  const healthyObj = { ...scoredObject([N1_SIX_YEARS]), snapshot: { generation: "g", periodKey: "FY26Q1", composite: 88, band: "healthy" } };
  const s = composeRelationalState(strangerContext(), healthyObj, FROZEN_NOW);
  ok("UO2 renders the 'healthy' band label", claimsOf(s).some((c) => /Health is about 88 — healthy/.test(c)));
  ok("assembled output still register-clean (band label not flagged as celebration)", scanAssembled(claimsOf(s), "balanced").length === 0);
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
  const v = scanAssembled(claimsOf(s), level);
  ok(`register-clean at ${level}`, v.length === 0, v.map((x) => `${x.term}:"${x.text}"`).join(" | "));
}

console.log(`\n${"═".repeat(60)}\nRELATIONAL VERIFY — ${pass} passed, ${fail} failed\n${"═".repeat(60)}`);
process.exit(fail === 0 ? 0 : 1);
