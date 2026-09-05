// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — MAGNITUDE ANCHORS, THE PEER CROSS-SECTION, AND THE STORY CHAIN.
//
// PURE. No database, no network, no sibling repo. Every case below is built from synthetic rows, which
// is what lets it run inside `build` (verify-build-gate-hygiene.ts fails the build if a build gate so
// much as imports the DB client).
//
// ── WHAT IS ASSERTED, AND WHY EACH ONE IS A SILENT-FAILURE RISK ──────────────────────────────────
//   1 · REGISTRY INTEGRITY — every family has an always-anchored metric and a peer set, and every key
//       in both is a metric that family's manifest actually declares. A key that is not would produce
//       an anchor for a figure the card never prints, and nothing at runtime would say so.
//   2 · THE ANCHOR IS A POSITION, NEVER A JUDGEMENT (1b). Scanned against the SAME evaluative
//       vocabulary generate.ts refuses a brief for. An adjective here would ship past that guard,
//       because the guard scans what the MODEL wrote and this text is ours.
//   3 · THE DEGENERATE CASES (1e), each as its own synthetic case. These are the ones found by
//       rendering; a regression in any of them is invisible in a corpus scan because the anchor simply
//       stops appearing, and an absent anchor looks exactly like a metric that had nothing to say.
//   4 · THE DEPTH FLOORS AND THE DEEP-HISTORY SENTENCE (1d).
//   5 · THE ANCHOR BUDGET (1c) — a card can never exceed MAX_ANCHORS_PER_CARD.
//   6 · THE PEER COUNT NEVER BECOMES A RANKING (2d).
//   7 · THE DRIVER'S SHARE FORM (3d-D) — above 100% the sentence must not contain a percentage, and
//       the decomposition must ADD UP, because a reader can check it on the page.
//   8 · THE STORY ORDER (3b) and that no group ships empty.
//   9 · ★ THE PERIOD SEPARATION — asserted FROM THE SOURCE, in both directions. contrasts.ts cannot
//       reach an annual figure and annual-contrasts.ts cannot reach a quarterly one, so no rule in
//       either can build "free cash flow was 3.5x the quarter's profit" — a fabricated ratio across two
//       period lengths that divides correctly and reads perfectly, which is why an instruction is not
//       enough. A comment is not a mechanism; this is the mechanism.
//  10 · THE TWELVE NEW RULES fire on synthetic rows, and none of them carries a judgement or a word
//       from the other period's vocabulary. A rule that can never fire is a rule nobody knows is dead.
//
//   npx tsx src/scripts/verify-quarter-brief-anchors.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { scanExplanationText } from "../ai/core/guardrail.js";
import { metricGloss, type MetricKey } from "../catalogue/quarter-metrics.js";
import type { AnnualMetricKey } from "../catalogue/annual-metrics.js";
import {
  ANCHOR_ALWAYS, DEEP_HISTORY, HISTORY_MIN_LEVELS, HISTORY_MIN_MOVES, MAX_ANCHORS_PER_CARD,
  computeAnchors, withAnchors, movementWithAnchor,
} from "../insight/quarter-brief/anchors.js";
import { computeAnnualContrasts } from "../insight/quarter-brief/annual-contrasts.js";
import { annualManifestFor, type AnyFamilyAnnual } from "../insight/quarter-brief/annual-manifest.js";
import { computeContrasts } from "../insight/quarter-brief/contrasts.js";
import { computeDriver } from "../insight/quarter-brief/driver.js";
import { manifestFor, type AnyFamilyQuarter, type Family } from "../insight/quarter-brief/manifest.js";
import { buildPeerComparisons, peerMetricsFor, type PeerCrossSection } from "../insight/quarter-brief/peer-shape.js";
import { buildQuarterSection } from "../insight/quarter-brief/quarter-section.js";

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);
const rule = (s: string) => console.log("\n" + s);

const FAMILIES: Family[] = ["non_financial", "banking", "nbfc", "life_insurance", "general_insurance"];

// ── Synthetic rows ─────────────────────────────────────────────────────────────────────────────────

/** A quarter of `family` with every manifest metric null, then the given overrides. Built from the
 *  manifest itself so a metric added to a family cannot leave this gate testing a stale shape. */
function row(family: Family, periodKey: string, overrides: Partial<Record<MetricKey, number>>): AnyFamilyQuarter {
  const values: Record<string, number | null> = {};
  for (const spec of manifestFor(family)) values[spec.key] = overrides[spec.key] ?? null;
  const [, fy, q] = /^(FY\d{2})(Q\d)$/.exec(periodKey) ?? ["", "FY26", "Q1"];
  return {
    family, periodKey, quarter: q, fiscalYear: fy, resultType: "standalone",
    reportDate: new Date("2026-06-30"), filingDate: new Date("2026-07-20"),
    auditPending: false, values,
  } as unknown as AnyFamilyQuarter;
}

/** N banking quarters whose bad-loan share walks the given fraction-scale series, oldest → newest. */
function bankSeries(gnpa: number[]): AnyFamilyQuarter[] {
  return gnpa.map((g, i) =>
    row("banking", `FY${25 + Math.floor(i / 4)}Q${(i % 4) + 1}`, {
      netInterestIncome: 30_000 + i * 100, netProfit: 15_000 + i * 50, interestEarned: 70_000,
      grossNpaRatio: g, costToIncomeRatio: 0.40, netMargin: 20,
    }),
  );
}

const anchorsFor = (
  rows: AnyFamilyQuarter[],
  cs: PeerCrossSection | null = null,
  yearOnYear = false,
) => {
  const idx = rows.length - 1;
  const section = buildQuarterSection(rows[idx], idx > 0 ? rows[idx - 1] : null, yearOnYear);
  return computeAnchors({
    family: rows[idx].family, rows, idx,
    comparison: idx > 0 ? rows[idx - 1] : null,
    comparisonIsYearAgo: yearOnYear, crossSection: cs,
    rendered: new Set(section.lines.map((l) => l.key)),
  });
};

const cross = (values: Record<string, number[]>): PeerCrossSection => ({
  peerGroupName: "Test group", filed: Math.max(...Object.values(values).map((v) => v.length)), values,
});

// ── 1 · REGISTRY INTEGRITY ─────────────────────────────────────────────────────────────────────────

function checkRegistries(): void {
  rule("1 · REGISTRIES — every declared key is a metric its family actually files");
  for (const f of FAMILIES) {
    const keys = new Set(manifestFor(f).map((s) => s.key));
    const always = ANCHOR_ALWAYS[f];
    if (!always) fail(`${f} has no ANCHOR_ALWAYS metric`);
    else if (!keys.has(always)) fail(`${f}'s always-anchored metric "${always}" is not in its manifest`);

    const set = peerMetricsFor(f);
    if (set.length === 0) fail(`${f} has an empty peer metric set`);
    for (const s of set) {
      if (!keys.has(s.key)) fail(`${f} peer metric "${s.key}" is not in its manifest`);
      if (!s.noun.trim()) fail(`${f} peer metric "${s.key}" has no comparative noun`);
      if (!s.why.trim()) fail(`${f} peer metric "${s.key}" has no reason`);
      // ⚠ THE NOUN MUST NOT BE THE LABEL. Several labels are CLAUSES, not noun phrases, and the
      // derived form produces "a higher policies still being paid after 1 year". This asserts the
      // authored noun is genuinely authored wherever the label could not have been used.
      if (s.noun === metricGloss(s.key).label.toLowerCase() && /\s(after|being|still)\s/.test(s.noun)) {
        fail(`${f} peer metric "${s.key}" reuses a clause-shaped label as its noun`);
      }
    }
    // Exactly one growth metric per family: the top line. Two would compare the same move twice.
    const growth = set.filter((s) => s.kind === "growth").length;
    if (growth !== 1) fail(`${f} declares ${growth} growth metrics; exactly one (the top line) is expected`);
  }
  if (failures === 0) pass(`all ${FAMILIES.length} families carry a valid always-anchor and peer set`);
}

// ── 2 · NO JUDGEMENT IN ANY ANCHOR OR PEER SENTENCE ────────────────────────────────────────────────

function checkNoJudgement(): void {
  rule("2 · POSITION, NEVER JUDGEMENT (1b) — scanned against the guardrail's own evaluative list");
  const RANKY = /\b(outperform\w*|underperform\w*|beat|beats|led|lagg?\w*|best|worst|top|bottom|winner|loser)\b/i;

  const sentences: string[] = [];
  // Every anchor form, from synthetic cases that produce each of them.
  for (const a of anchorsFor(bankSeries([0.010, 0.012, 0.014, 0.016, 0.018, 0.020, 0.022, 0.024, 0.026, 0.028, 0.030, 0.032, 0.034]))) {
    sentences.push(a.display);
  }
  for (const a of anchorsFor(bankSeries([0.020, 0.019, 0.018, 0.017, 0.016, 0.011]), cross({ grossNpaRatio: [1.5, 2.0, 2.5, 3.0] }))) {
    sentences.push(a.display);
  }
  for (const a of anchorsFor(bankSeries([0.020, 0.019, 0.018, 0.017, 0.016, 0.021]), cross({ grossNpaRatio: [1.5, 2.0, 2.5, 3.0] }))) {
    sentences.push(a.display);
  }
  // Every peer comparison form.
  const peers = buildPeerComparisons(
    "banking",
    cross({ netInterestIncome: [4, 6, 9, 12], grossNpaRatio: [1.5, 2.0, 2.5, 3.0], costToIncomeRatio: [40, 42, 44, 46] }),
    { netInterestIncome: 7, grossNpaRatio: 1.1, costToIncomeRatio: 50 },
  );
  for (const c of peers?.comparisons ?? []) sentences.push(c.display);

  if (sentences.length < 6) fail(`only ${sentences.length} synthetic sentences produced — the cases are not exercising the forms`);

  for (const s of sentences) {
    // ★ THE SAME SCANNER generate.ts REFUSES A BRIEF ON, pointed at OUR OWN copy. The guard there runs
    // on what the MODEL wrote; anchor text is authored here and would sail past it, so it is checked
    // at the only point it can be — before it ships.
    const v = scanExplanationText(s);
    if (!v.clean) fail(`hard-tier language in an anchor: ${v.hardHits.map((h) => h.term).join(", ")} — ${s}`);
    if (v.evaluativeHits.length > 0) fail(`evaluative language in an anchor: ${v.evaluativeHits.map((h) => h.term).join(", ")} — ${s}`);
    const ranky = RANKY.exec(s);
    if (ranky) fail(`ranking word "${ranky[0]}" in: ${s}`);
  }
  if (failures === 0) pass(`${sentences.length} anchor and peer sentences carry no evaluative or ranking word`);
}

// ── 3 · THE DEGENERATE CASES (1e) ──────────────────────────────────────────────────────────────────

function checkDegenerates(): void {
  rule("3 · DEGENERATE CASES (1e) — found by rendering, each pinned by a synthetic row");
  const before = failures;

  // (1) fewer than three comparable co-members ⇒ no peer anchor.
  const few = anchorsFor(bankSeries([0.02, 0.02, 0.02]), cross({ grossNpaRatio: [1.0, 3.0] }));
  if (few.some((a) => a.source === "peer")) fail("(1) a peer anchor was built from two co-members");

  // (2) tied at the end of the group ⇒ the COUNT form, never "the lowest".
  const tied = anchorsFor(bankSeries([0.02, 0.02, 0.02]), cross({ grossNpaRatio: [2.0, 3.0, 4.0] }));
  const tiedPeer = tied.find((a) => a.source === "peer");
  if (!tiedPeer) fail("(2) no peer anchor at all on the tie case");
  else if (/\b(lowest|highest)\b/.test(tiedPeer.display)) fail(`(2) a tie rendered as a superlative: ${tiedPeer.display}`);

  // (3) strictly mid-group ⇒ a count, never a percentile.
  const mid = anchorsFor(bankSeries([0.02, 0.02, 0.02]), cross({ grossNpaRatio: [1.0, 1.5, 3.0, 4.0] }));
  const midPeer = mid.find((a) => a.source === "peer");
  if (!midPeer) fail("(3) no peer anchor mid-group");
  else if (/\b(percentile|median|quartile)\b/i.test(midPeer.display)) fail(`(3) a percentile appeared: ${midPeer.display}`);

  // (4) every co-member reported exactly this figure ⇒ nothing to say.
  const same = anchorsFor(bankSeries([0.02, 0.02, 0.02]), cross({ grossNpaRatio: [2.0, 2.0, 2.0] }));
  if (same.some((a) => a.source === "peer")) fail("(4) an anchor was built where every co-member matched exactly");

  // (5) a MONEY level is never peer-anchored — it would rank the group by company size.
  const money = anchorsFor(bankSeries([0.02, 0.02, 0.02, 0.02, 0.02, 0.02]), cross({ netInterestIncome: [1, 2, 3, 4] }));
  if (money.some((a) => a.key === "netInterestIncome" && a.source === "peer")) fail("(5) a money LEVEL was peer-anchored");

  // (6) below the level floor ⇒ no history level anchor.
  const thin = anchorsFor(bankSeries([0.030, 0.025, 0.020, 0.015, 0.010]));
  if (thin.some((a) => a.source === "history_level")) {
    fail(`(6) a level anchor fired on ${HISTORY_MIN_LEVELS - 1} quarters, below the floor of ${HISTORY_MIN_LEVELS}`);
  }

  // (7) below the move floor ⇒ no move anchor. Three YoY pairs, needing four.
  const shortMoves = anchorsFor(
    [...bankSeries([0.02, 0.02, 0.02, 0.02]), ...bankSeries([0.02, 0.02, 0.02]).map((r, i) =>
      row("banking", `FY26Q${i + 1}`, { grossNpaRatio: 0.03, netInterestIncome: 30_000, netProfit: 15_000, interestEarned: 70_000, costToIncomeRatio: 0.4, netMargin: 20 }))],
    null, true,
  );
  if (shortMoves.filter((a) => a.source === "history_move").length > 0 && shortMoves.length < HISTORY_MIN_MOVES) {
    fail("(7) a move anchor fired below the move floor");
  }

  // (8) tied with a prior quarter at the extreme ⇒ no history level anchor.
  const tiedHistory = anchorsFor(bankSeries([0.010, 0.020, 0.030, 0.025, 0.022, 0.010]));
  if (tiedHistory.some((a) => a.source === "history_level")) {
    fail("(8) 'the lowest on file' fired while an earlier quarter held the same figure");
  }

  // (9) the whole range rounds to one printed number ⇒ no anchor.
  const flat = anchorsFor(bankSeries([0.02000, 0.02001, 0.02002, 0.02003, 0.02004, 0.02005]));
  if (flat.some((a) => a.source === "history_level")) fail("(9) an extreme was claimed inside the display precision");

  // (10) a metric the card did not render is never anchored — `rendered` is the gate.
  const rows = bankSeries([0.010, 0.020, 0.030, 0.025, 0.022, 0.009]);
  const none = computeAnchors({
    family: "banking", rows, idx: rows.length - 1, comparison: rows[rows.length - 2],
    comparisonIsYearAgo: false, crossSection: null, rendered: new Set<MetricKey>(),
  });
  if (none.length > 0) fail("(10) an anchor was built for a metric with no rendered line");

  if (failures === before) pass("10 degenerate cases hold: ties, small n, mid-group, size, depth, precision and suppression");
}

// ── 4 · DEPTH (1d) ─────────────────────────────────────────────────────────────────────────────────

function checkDepth(): void {
  rule("4 · DEPTH — the count is always named, and above DEEP_HISTORY so is the earliest period");
  const before = failures;

  const shallow = anchorsFor(bankSeries([0.010, 0.020, 0.030, 0.025, 0.022, 0.009]));
  const sl = shallow.find((a) => a.source === "history_level");
  if (!sl) fail("no level anchor at the floor exactly");
  else {
    if (!/\bthe 6 quarters on file\b/.test(sl.display)) fail(`the count is not named: ${sl.display}`);
    if (/going back to/.test(sl.display)) fail(`a shallow anchor named an earliest period: ${sl.display}`);
  }

  const deep = anchorsFor(bankSeries([0.030, 0.029, 0.028, 0.027, 0.026, 0.025, 0.024, 0.023, 0.022, 0.021, 0.020, 0.019, 0.010]));
  const dl = deep.find((a) => a.source === "history_level");
  if (!dl) fail("no level anchor at depth");
  else {
    if (!new RegExp(`the 13 quarters on file`).test(dl.display)) fail(`the count is not named at depth: ${dl.display}`);
    if (!/going back to FY25Q1/.test(dl.display)) {
      fail(`at ${DEEP_HISTORY}+ the earliest period must be named: ${dl.display}`);
    }
  }
  if (failures === before) pass(`the depth is stated on every history anchor and the span is named above ${DEEP_HISTORY}`);
}

// ── 5 · THE BUDGET (1c) ────────────────────────────────────────────────────────────────────────────

function checkBudget(): void {
  rule("5 · THE ANCHOR BUDGET — a card can never carry more than the cap");
  // Every ratio moves hugely and every one has a deep history: the worst case for the budget.
  const rows = Array.from({ length: 14 }, (_, i) =>
    row("banking", `FY${25 + Math.floor(i / 4)}Q${(i % 4) + 1}`, {
      interestEarned: 70_000 + i * 5_000, netInterestIncome: 30_000 + i * 3_000, netProfit: 15_000 + i * 2_000,
      grossNpaRatio: 0.05 - i * 0.003, netNpaRatio: 0.02 - i * 0.001, costToIncomeRatio: 0.60 - i * 0.02,
      provisionCoverageRatio: 0.50 + i * 0.02, cet1Ratio: 0.12 + i * 0.004,
      returnOnAssetsQuarterly: 0.004 + i * 0.0004, netMargin: 10 + i,
    }),
  );
  const many = anchorsFor(rows, cross({
    grossNpaRatio: [1.0, 2.0, 3.0, 4.0], costToIncomeRatio: [30, 40, 50, 60], netMargin: [10, 15, 20, 25],
  }));
  if (many.length > MAX_ANCHORS_PER_CARD) fail(`${many.length} anchors on one card, the cap is ${MAX_ANCHORS_PER_CARD}`);
  else pass(`the worst synthetic case produced ${many.length} anchors, at or under the cap of ${MAX_ANCHORS_PER_CARD}`);

  // One anchor per metric, always — a figure never carries two competing positions.
  const keys = many.map((a) => a.key);
  if (new Set(keys).size !== keys.length) fail("a metric carried two anchors");
  else pass("no metric carries more than one anchor");

  // And the always-anchored metric is present when it rendered.
  if (!many.some((a) => a.key === ANCHOR_ALWAYS.banking)) fail("the always-anchored metric was crowded out by movers");
  else pass("the always-anchored metric holds its place against the movers");

  // ★ THE ANCHOR IS ITS OWN FIELD, AND THE CONTRACT IS PINNED IN BOTH DIRECTIONS.
  //
  // ⚠ THIS ASSERTION USED TO SAY THE OPPOSITE — that the anchor had been folded INTO `movement` — and
  // it failed the build the moment the fold was undone, which is the gate working. The fold was right
  // while the anchor had to reach the reader without a renderer change and wrong once it had one: glued
  // to the movement it inherited the lowest-contrast text on the card. Re-folding is the regression
  // this now guards, because a renderer cannot un-concatenate without cutting our own prose on "; ".
  const idx = rows.length - 1;
  const section = buildQuarterSection(rows[idx], rows[idx - 1], false);
  const applied = withAnchors(section.lines, many);
  for (const a of many) {
    const l = applied.find((x) => x.key === a.key);
    if (l?.anchor !== a.display) fail(`the anchor for ${a.key} is not on its own field`);
    if (l?.anchorSource !== a.source) fail(`the anchor source for ${a.key} was not carried`);
    // SEPARATE in the store …
    if (l?.movement?.includes(a.display)) fail(`the anchor for ${a.key} was folded back into movement`);
    // … and COMPOSED for the two consumers that want one sentence.
    const composed = movementWithAnchor(l ?? { movement: null });
    if (!composed?.includes(a.display)) fail(`movementWithAnchor dropped the anchor for ${a.key}`);
    if (l?.movement && !composed?.includes(l.movement)) fail(`movementWithAnchor dropped the movement for ${a.key}`);
  }
  pass("every anchor is its own field, absent from `movement`, and composed back by movementWithAnchor");

  // A line with NO movement still surfaces its anchor, sentence-cased — the card with no comparison
  // period keeps its levels, and a level anchor is exactly what survives when the comparison does not.
  const orphan = movementWithAnchor({ movement: null, anchor: "the lowest of the 5" });
  if (orphan !== "The lowest of the 5") fail(`an anchor with no movement rendered as "${orphan}"`);
  else pass("an anchor with no movement stands alone, sentence-cased");
}

// ── 6 · THE DRIVER'S TWO FORMS (3d-D) ──────────────────────────────────────────────────────────────

function checkDriverForms(): void {
  rule("6 · SHARE-OF-MOVE — above 100% there is no percentage, and the decomposition adds up");
  const before = failures;

  // Dominant: depreciation up ₹400 cr out of a ₹600 cr fall in profit.
  const cur = row("non_financial", "FY27Q1", { revenue: 10_000, otherIncome: 100, expenses: 8_600, depreciation: 900, financeCosts: 100, tax: 300, netProfit: 1_200, operatingMargin: 15, netMargin: 12 });
  const pri = row("non_financial", "FY26Q1", { revenue: 10_000, otherIncome: 100, expenses: 8_000, depreciation: 500, financeCosts: 100, tax: 300, netProfit: 1_800, operatingMargin: 18, netMargin: 18 });
  const d1 = computeDriver(cur, pri, "against the same quarter last year");
  if (!d1) fail("no driver on the dominant case");
  else {
    if (d1.form !== "dominant") fail(`expected the dominant form, got ${d1.form}`);
    if (!/%/.test(d1.display)) fail("the dominant form dropped its share percentage");
  }

  // Offset: costs move far more than profit does. This is the 52.4% case.
  const cur2 = row("non_financial", "FY27Q1", { revenue: 10_000, otherIncome: 3_000, expenses: 11_500, depreciation: 400, financeCosts: 100, tax: 300, netProfit: 1_200, operatingMargin: 15, netMargin: 12 });
  const pri2 = row("non_financial", "FY26Q1", { revenue: 10_000, otherIncome: 100, expenses: 8_600, depreciation: 400, financeCosts: 100, tax: 300, netProfit: 1_200, operatingMargin: 15, netMargin: 12 });
  // Profit is identical, so the move floor blocks it — nudge the target instead.
  const cur3 = row("non_financial", "FY27Q1", { revenue: 10_000, otherIncome: 3_000, expenses: 11_600, depreciation: 400, financeCosts: 100, tax: 300, netProfit: 1_100, operatingMargin: 15, netMargin: 11 });
  const d2 = computeDriver(cur3, pri2, "against the same quarter last year");
  void cur2;
  if (!d2) fail("no driver on the offset case");
  else {
    if (d2.form !== "offset") fail(`expected the offset form, got ${d2.form} (share ${d2.share.toFixed(2)})`);
    if (/\d+% of the/.test(d2.display)) fail(`a share-of-move percentage survived above 100%: ${d2.display}`);
    // ★ THE ARITHMETIC MUST ADD UP ON THE PAGE. Pull the three crore figures back out of the sentence
    // and check contribution + others = the target move, which is what a reader would do.
    const nums = [...d2.display.matchAll(/₹([\d,]+) crore/g)].map((m) => Number(m[1].replace(/,/g, "")));
    if (nums.length < 4) fail(`the offset sentence names ${nums.length} figures; four are needed to check it`);
    else {
      const [, contribution, others, target] = nums;
      if (Math.abs(contribution + others - target) > 1 && Math.abs(Math.abs(contribution - others) - target) > 1) {
        fail(`the offset decomposition does not reconcile: ${contribution} / ${others} / ${target} — ${d2.display}`);
      }
    }
  }
  if (failures === before) pass("both driver forms render correctly and the offset form reconciles");
}

// ── 7 · ★ THE PERIOD SEPARATION, ASSERTED FROM THE SOURCE ──────────────────────────────────────────
//
// ⚠⚠ THE RULE: NO ARITHMETIC MAY JOIN AN ANNUAL FIGURE TO A QUARTERLY ONE.
//
// "Free cash flow was 3.5 times the quarter's profit" is a fabricated ratio — the numerator covers
// twelve months and the denominator three — and it is the exact sentence someone reaches for when one
// card carries both. It divides correctly and reads perfectly, so nothing downstream would catch it.
//
// The enforcement is that neither module can SEE the other period's numbers: `valueOf` reads a
// quarterly metric and `annualValueOf` reads an annual one, and the two live behind manifests that the
// two rule files do not import each other's. This asserts that from the text of both files, because an
// import is the only way either function could arrive.
function checkPeriodSeparation(): void {
  rule("7 · ★ PERIOD SEPARATION — neither rule file can reach the other period's figures");
  const before = failures;

  const read = (p: string) => readFileSync(new URL(`../insight/quarter-brief/${p}`, import.meta.url), "utf8");
  // Import specifiers only. The two files CITE each other in their headers — that is documentation and
  // must stay legal, so this matches the `from "…"` form and not the mention.
  const importsOf = (src: string): string[] =>
    [...src.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)].map((m) => m[1].replace(/^\.\//, ""));

  const QUARTER_ONLY = ["manifest.js", "quarter-section.js", "driver.js", "contrasts.js", "peer-shape.js", "peers.js"];
  const ANNUAL_ONLY = ["annual-manifest.js", "annual-section.js", "annual-rows.js", "annual-contrasts.js"];

  const annualImports = importsOf(read("annual-contrasts.ts"));
  const leakedIn = annualImports.filter((i) => QUARTER_ONLY.includes(i));
  if (leakedIn.length > 0) {
    fail(`annual-contrasts.ts imports a QUARTERLY module (${leakedIn.join(", ")}) — a rule there could now name a three-month figure`);
  }

  const quarterImports = importsOf(read("contrasts.ts"));
  const leakedOut = quarterImports.filter((i) => ANNUAL_ONLY.includes(i));
  if (leakedOut.length > 0) {
    fail(`contrasts.ts imports an ANNUAL module (${leakedOut.join(", ")}) — a rule there could now name a twelve-month figure`);
  }

  // ★ AND THE NEGATIVE CONTROL. A scan nobody has watched fire is a scan nobody knows works: the lists
  // above must actually name modules these files could plausibly import, or both checks pass vacuously.
  if (!annualImports.includes("annual-manifest.js")) fail("annual-contrasts.ts does not import annual-manifest.js — the scan is reading the wrong file");
  if (!quarterImports.includes("manifest.js")) fail("contrasts.ts does not import manifest.js — the scan is reading the wrong file");

  if (failures === before) {
    pass(`neither file imports the other period's manifest (${annualImports.length} + ${quarterImports.length} specifiers scanned)`);
  }
}

// ── 8 · THE THIRTEEN NEW RULES ─────────────────────────────────────────────────────────────────────

/** A full year of `family` with every manifest metric null, then the given overrides. Built from the
 *  annual manifest itself, so a metric added to a family cannot leave this gate testing a stale shape. */
function annualRow(family: Family, fiscalYear: string, overrides: Partial<Record<AnnualMetricKey, number>>): AnyFamilyAnnual {
  const values: Record<string, number | null> = {};
  for (const spec of annualManifestFor(family)) values[spec.key] = overrides[spec.key] ?? null;
  return {
    family, fiscalYear, resultType: "standalone",
    asOfDate: new Date("2026-03-31"), filingDate: new Date("2026-05-20"), values,
  } as unknown as AnyFamilyAnnual;
}

function checkNewRules(): void {
  rule("8 · THE THIRTEEN NEW RULES — each fires, each stays a fact, and neither set names the other period");
  const before = failures;
  const YOY = "against the same quarter last year";

  // ── ★★ Q-K · PROFIT THAT DID NOT COME FROM TRADING ──────────────────────────────────────────
  // The only rule in the file that needs no comparison, and the only one that speaks from the
  // FAILURE of an identity rather than from its success. Five things are asserted, and four of them
  // are refusals — because a rule that fires on a bad row here prints a confident ₹ figure about
  // something that never happened.
  const qk = (family: Family, values: Record<string, number>) =>
    computeContrasts(row(family, "FY26Q4", values), null, YOY).filter((c) => c.rule === "profit_not_from_trading");

  // IDEA's shape: the trading lines produce a loss and the reported profit is enormous.
  const qkFires = qk("non_financial", {
    revenue: 11_332, otherIncome: 104, expenses: 16_951, tax: 6, netProfit: 51_970,
    profitBeforeTax: 51_976, operatingProfit: 56_862, netMargin: 45,
  });
  if (qkFires.length !== 1) fail("Q-K did not fire on the case written for it — the rule is unreachable");

  // ⚠ AND THE THREE PRINTED FIGURES MUST RECONCILE. This is the ONLY check a reader can perform on
  // the sentence, and it is the whole reason the rule states three numbers instead of one share.
  // Rounding each independently broke it on 2 of the first 10 real cards — see contrasts.ts.
  for (const c of qkFires) {
    const found = [...c.display.matchAll(/(a )?₹([\d,]+) crore( loss)?/g)].map(
      (m) => (m[3] ? -1 : 1) * Number(m[2].replace(/,/g, "")),
    );
    if (found.length < 3) {
      fail(`Q-K printed fewer than three ₹ figures — the arithmetic cannot be checked: ${c.display}`);
    } else {
      const [profit, fromLines, gapMagnitude] = found;
      const gap = /taken off/.test(c.display) ? -gapMagnitude : gapMagnitude;
      if (profit !== fromLines + gap) {
        fail(`Q-K's three figures do not add up on the page: ${fromLines} + ${gap} ≠ ${profit} — ${c.display}`);
      }
    }
    // ⚠ NO CAUSE, EVER. Every one of these words would name something `quarterly_results` has no
    // column for, and the sentence's own closing line is the promise it does not.
    if (/\b(because|due to|owing to|one-off|exceptional|settlement|write-?back|merger|disposal)\b/i.test(c.display)) {
      fail(`Q-K named or implied a cause: ${c.display}`);
    }
    if (!/do not say what it was/.test(c.display)) {
      fail(`Q-K dropped the statement that the figures do not say what it was: ${c.display}`);
    }
  }

  // MUTUALLY EXCLUSIVE WITH THE DRIVER, BY CONSTRUCTION. The driver refuses above a 1% residual and
  // this fires above 10%, so no card can carry an attribution beside "no attribution is possible".
  const qkCur = row("non_financial", "FY26Q4", { revenue: 11_332, otherIncome: 104, expenses: 16_951, tax: 6, netProfit: 51_970, netMargin: 45 });
  const qkPri = row("non_financial", "FY25Q4", { revenue: 10_970, otherIncome: 218, expenses: 18_150, tax: 4, netProfit: -7_166, netMargin: -65 });
  if (computeDriver(qkCur, qkPri, YOY) !== null) {
    fail("the driver named a cause on a row whose identity is open by ₹57,491 crore — Q-K and the driver are not exclusive");
  }

  // ⚠ REFUSAL 1 · A TERM IS UNREPORTED. A missing column and a one-off gain leave the identity open
  // in exactly the same way, and only one of them is a fact about the company.
  if (qk("non_financial", { revenue: 11_332, expenses: 16_951, tax: 6, netProfit: 51_970, netMargin: 45 }).length > 0) {
    fail("Q-K fired on a row with an unreported bridge term — a missing column would be read as a one-off");
  }
  // ⚠ REFUSAL 2 · GENERAL INSURANCE. Its bridge targets the UNDERWRITING RESULT; the gap between that
  // and net profit is an annual-only shareholders' line, not a statement about trading.
  if (qk("general_insurance", {
    grossPremiumsWritten: 4_000, premiumEarned: 3_400, incurredClaims: 2_600, netCommission: 300,
    insuranceRunningCosts: 700, underwritingProfitOrLoss: -200, profitBeforeTax: 900, tax: 200,
    netProfit: 700, netMargin: 17,
  }).length > 0) {
    fail("Q-K fired on a general insurer — its bridge does not target net profit");
  }
  // ⚠ REFUSAL 3 · LIFE INSURANCE has no bridge at all: `net profit = PBT − tax` closes on 6% of rows
  // because policyholder tax sits inside the revenue account. Its "residual" equals the tax line.
  if (qk("life_insurance", {
    netPremiumIncome: 9_000, grossPremiumIncome: 9_400, profitBeforeTax: 400, tax: -300,
    netProfit: 700, netMargin: 8,
  }).length > 0) {
    fail("Q-K fired on a life insurer — that family has no net-profit bridge");
  }
  // ⚠ REFUSAL 4 · AN ORDINARY ROW. A residual inside the floors is rounding and reclassification.
  if (qk("non_financial", {
    revenue: 10_000, otherIncome: 200, expenses: 8_000, tax: 500, netProfit: 1_740, netMargin: 17,
  }).length > 0) {
    fail("Q-K fired on a ₹40 crore residual — the materiality floors are not holding");
  }

  // ── The five QUARTER rules, one synthetic pair each. ─────────────────────────────────────────
  const quarterCases: [string, AnyFamilyQuarter, AnyFamilyQuarter][] = [
    // Q-A · the lending engine up, the bottom line down.
    ["ppop_vs_net_profit",
      row("banking", "FY27Q1", { netInterestIncome: 30_000, preProvisionOperatingProfit: 22_000, netProfit: 9_000, provisions: 6_000, grossNpaRatio: 0.018, netMargin: 20, interestEarned: 70_000 }),
      row("banking", "FY26Q1", { netInterestIncome: 28_000, preProvisionOperatingProfit: 19_000, netProfit: 12_000, provisions: 2_000, grossNpaRatio: 0.018, netMargin: 24, interestEarned: 66_000 })],
    // Q-B · bad loans down in rupees, up as a share (the book shrank faster).
    ["npa_amount_vs_share",
      row("banking", "FY27Q1", { netInterestIncome: 30_000, netProfit: 12_000, grossNpaAmount: 8_000, grossNpaRatio: 0.024, netMargin: 20, interestEarned: 70_000 }),
      row("banking", "FY26Q1", { netInterestIncome: 30_000, netProfit: 12_000, grossNpaAmount: 10_000, grossNpaRatio: 0.020, netMargin: 20, interestEarned: 70_000 })],
    // Q-G · trading profit up, the profit left at the end down.
    ["operating_vs_net_profit",
      row("non_financial", "FY27Q1", { revenue: 10_000, operatingProfit: 2_400, netProfit: 900, profitBeforeTax: 1_200, tax: 300, expenses: 8_000, operatingMargin: 24, netMargin: 9 }),
      row("non_financial", "FY26Q1", { revenue: 10_000, operatingProfit: 2_000, netProfit: 1_400, profitBeforeTax: 1_800, tax: 400, expenses: 8_200, operatingMargin: 20, netMargin: 14 })],
    // Q-E · costs grew far faster than the top line.
    ["costs_outgrew_top_line",
      row("non_financial", "FY27Q1", { revenue: 10_500, expenses: 9_600, netProfit: 700, profitBeforeTax: 900, tax: 200, operatingMargin: 9, netMargin: 7 }),
      row("non_financial", "FY26Q1", { revenue: 10_000, expenses: 8_000, netProfit: 1_500, profitBeforeTax: 2_000, tax: 500, operatingMargin: 20, netMargin: 15 })],
    // Q-F · the effective tax rate moved wide, with pre-tax profit ALSO moving so C-5 cannot fire.
    ["effective_tax_rate_moved",
      row("non_financial", "FY27Q1", { revenue: 10_000, expenses: 8_000, profitBeforeTax: 1_600, tax: 640, netProfit: 960, operatingMargin: 16, netMargin: 9.6 }),
      row("non_financial", "FY26Q1", { revenue: 10_000, expenses: 8_000, profitBeforeTax: 2_000, tax: 400, netProfit: 1_600, operatingMargin: 20, netMargin: 16 })],
  ];

  // Q-K's sentence joins the no-judgement / no-ranking scan below with the other twelve.
  const quarterSentences: string[] = qkFires.map((c) => c.display);
  for (const [ruleId, cur, pri] of quarterCases) {
    const fired = computeContrasts(cur, pri, YOY);
    for (const c of fired) quarterSentences.push(c.display);
    if (!fired.some((c) => c.rule === ruleId)) {
      fail(`${ruleId} did not fire on the case written for it — the rule is unreachable`);
    }
  }

  // ⚠⚠ Q-F IS GATED ON C-5, AND WITHOUT THE GATE THE SAME CARD STATES THE TAX EFFECT TWICE. Pre-tax
  // profit flat, net profit down hard: C-5's exact shape, and the effective rate moves 20 points with
  // it by construction. Both rules would fire; only one may.
  const c5cur = row("non_financial", "FY27Q1", { revenue: 10_000, expenses: 8_000, profitBeforeTax: 2_000, tax: 800, netProfit: 1_200, operatingMargin: 20, netMargin: 12 });
  const c5pri = row("non_financial", "FY26Q1", { revenue: 10_000, expenses: 8_000, profitBeforeTax: 2_010, tax: 402, netProfit: 1_608, operatingMargin: 20, netMargin: 16 });
  const c5 = computeContrasts(c5cur, c5pri, YOY);
  if (!c5.some((c) => c.rule === "profit_moved_on_tax")) fail("the C-5 case stopped firing — the Q-F gate is being tested against nothing");
  if (c5.some((c) => c.rule === "effective_tax_rate_moved")) {
    fail("Q-F fired alongside C-5 — the same card states the tax effect twice");
  }

  // ── The seven ANNUAL rules, on synthetic full years. ─────────────────────────────────────────
  const annualCases: [string, AnyFamilyAnnual, AnyFamilyAnnual | null][] = [
    // A-7 · negative net worth. netWorth is unbounded and unguarded by design, so this must reach it.
    ["annual_negative_net_worth",
      annualRow("non_financial", "FY26", { netWorth: -35_758, totalAssets: 90_000, totalDebt: 120_000, returnOnEquity: 14 }),
      annualRow("non_financial", "FY25", { netWorth: -30_120, totalAssets: 95_000, totalDebt: 110_000, returnOnEquity: 12 })],
    // A-4 · borrowed more, held less.
    ["annual_borrowed_more_cash_fell",
      annualRow("non_financial", "FY26", { netWorth: 40_000, totalDebt: 12_000, cashAndCashEquivalents: 2_400 }),
      annualRow("non_financial", "FY25", { netWorth: 38_000, totalDebt: 9_000, cashAndCashEquivalents: 4_000 })],
    // A-6 · the business generated cash and still ended the year short.
    ["annual_free_cash_flow_negative",
      annualRow("non_financial", "FY26", { netWorth: 40_000, cashFromOperating: 1_240, capitalExpenditure: 2_100, freeCashFlow: -860 }),
      annualRow("non_financial", "FY25", { netWorth: 38_000, cashFromOperating: 1_100, capitalExpenditure: 900, freeCashFlow: 200 })],
    // A-5 · customers took longer to pay.
    ["annual_receivables_lengthened",
      annualRow("non_financial", "FY26", { netWorth: 40_000, receivablesDays: 74 }),
      annualRow("non_financial", "FY25", { netWorth: 38_000, receivablesDays: 62 })],
    // A-8 · thin interest cover, above zero.
    ["annual_interest_cover_thin",
      annualRow("non_financial", "FY26", { netWorth: 40_000, interestCoverage: 2.1 }),
      annualRow("non_financial", "FY25", { netWorth: 38_000, interestCoverage: 3.8 })],
    // A-8 again · BELOW zero, which is the branch that matters most and has its own wording.
    ["annual_interest_cover_thin",
      annualRow("non_financial", "FY26", { netWorth: 40_000, interestCoverage: -4.2 }),
      annualRow("non_financial", "FY25", { netWorth: 38_000, interestCoverage: 1.4 })],
    // A-3 · return on shareholders' money, on a PERCENT-scale family …
    ["annual_return_on_equity_moved",
      annualRow("non_financial", "FY26", { netWorth: 40_000, returnOnEquity: 22.5 }),
      annualRow("non_financial", "FY25", { netWorth: 38_000, returnOnEquity: 12.1 })],
    // … and on a FRACTION-scale one. Same floor, same units, because `readable` converts first.
    ["annual_return_on_equity_moved",
      annualRow("banking", "FY26", { netWorth: 200_000, deposits: 1_000_000, returnOnEquity: 0.205 }),
      annualRow("banking", "FY25", { netWorth: 190_000, deposits: 950_000, returnOnEquity: 0.112 })],
    // A-9 · a lender's cost of loans going bad rose.
    ["annual_credit_cost_rose",
      annualRow("banking", "FY26", { netWorth: 200_000, deposits: 1_000_000, creditCost: 0.0124 }),
      annualRow("banking", "FY25", { netWorth: 190_000, deposits: 950_000, creditCost: 0.0086 })],
  ];

  const annualSentences: string[] = [];
  for (const [ruleId, cur, pri] of annualCases) {
    const fired = computeAnnualContrasts(cur, pri);
    for (const c of fired) annualSentences.push(c.display);
    if (!fired.some((c) => c.rule === ruleId)) {
      fail(`${ruleId} did not fire on the case written for it — the rule is unreachable`);
    }
  }

  // ★ THE GUARD MUST REACH THE RULES TOO. IDEA's return on shareholders' money is a plausible POSITIVE
  // percentage computed by dividing a loss by a negative net worth; annual-section.ts suppresses it on
  // the cross-field guard, and a rule that read the raw value would resurrect a withheld figure in the
  // takeaway — a number printed with nothing on the card for the reader to check it against.
  const guarded = computeAnnualContrasts(
    annualRow("non_financial", "FY26", { netWorth: -35_758, returnOnEquity: 22.5 }),
    annualRow("non_financial", "FY25", { netWorth: -30_120, returnOnEquity: 12.1 }),
  );
  if (guarded.some((c) => c.rule === "annual_return_on_equity_moved")) {
    fail("A-3 fired on a figure the annual section WITHHOLDS — the cross-field guard is not reaching the rules");
  }

  // ── No judgement, and no word from the other period's vocabulary. ────────────────────────────
  const RANKY = /\b(outperform\w*|underperform\w*|beat|beats|led|lagg?\w*|best|worst|winner|loser)\b/i;
  for (const s of [...quarterSentences, ...annualSentences]) {
    const v = scanExplanationText(s);
    if (!v.clean) fail(`hard-tier language in a contrast: ${v.hardHits.map((h) => h.term).join(", ")} — ${s}`);
    if (v.evaluativeHits.length > 0) fail(`evaluative language in a contrast: ${v.evaluativeHits.map((h) => h.term).join(", ")} — ${s}`);
    const ranky = RANKY.exec(s);
    if (ranky) fail(`ranking word "${ranky[0]}" in: ${s}`);
  }
  // ⚠ AND THE PERIOD WORD ITSELF. An annual rule that says "this quarter" has either read a quarterly
  // figure — which §7 says it cannot — or mislabelled a twelve-month one, and both are the same defect
  // to a reader. The reverse is not asserted: a quarterly rule may legitimately say "the full year"
  // never, but it has no annual figure to say it about, which §7 already holds.
  for (const s of annualSentences) {
    if (/\b(this quarter|the quarter|quarterly|three months)\b/i.test(s)) {
      fail(`an annual rule used the quarter's vocabulary: ${s}`);
    }
    if (!/\b(full year|year-end|over the year|on the year before|a year earlier)\b/i.test(s)) {
      fail(`an annual rule does not name its period at all: ${s}`);
    }
  }

  if (failures === before) {
    pass(
      `Q-K + 5 quarter rules + 7 annual rules fire on their own cases; Q-K's three figures reconcile, ` +
        `it names no cause, and it refuses on an unreported term, on both insurance families and inside ` +
        `its floors; ${quarterSentences.length + annualSentences.length} sentences carry no judgement, ` +
        `and every annual one names its period`,
    );
  }
}

console.log("═".repeat(100));
console.log("QUARTER IN BRIEF — ANCHORS, PEER CROSS-SECTION AND THE STORY CHAIN");
console.log("═".repeat(100));

checkRegistries();
checkNoJudgement();
checkDegenerates();
checkDepth();
checkBudget();
checkDriverForms();
checkPeriodSeparation();
checkNewRules();

console.log("\n" + "─".repeat(100));
if (failures > 0) {
  console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("PASSED — anchors state a position, the counts stay counts, and the chain holds its order.");
