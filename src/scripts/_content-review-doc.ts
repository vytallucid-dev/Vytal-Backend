// TEMP (Part 2): emit docs/REVIEW_finding_copy_vs_triggers.md.
//
// ★ WHY A GENERATOR AND NOT A HAND-WRITTEN DOC: the three "as it ships" columns (name, description,
// doesn't-mean) are pulled from STOCK_FINDINGS at run time, and the firing column from the live DB.
// Transcribing 35 descriptions by hand is exactly how a review document ends up reviewing copy the
// product does not ship. The ONLY hand-authored column is TRIGGER — read from each rule body — plus
// the verdict. Re-run this after any copy change to refresh the shipped columns.
import { prisma } from "../db/prisma.js";
import { STOCK_FINDINGS, STOCK_FINDING_KEYS, catalogueSize } from "../catalogue/index.js";
import { writeFileSync } from "node:fs";

type Verdict = "ok" | "soft" | "mismatch" | "note";

interface Review {
  /** Where the firing decision actually lives. */
  source: string;
  /** The trigger, read from the rule body, in plain terms. */
  trigger: string;
  verdict: Verdict;
  /** The defect this review FOUND. Kept after the fix as the record of what was wrong. */
  issue?: string;
  /** What the description says now, and the ruling behind it. Present iff `issue` was acted on. */
  corrected?: string;
}

const R: Record<string, Review> = {
  // ── A · Red flags ────────────────────────────────────────────────────────────────────────────
  ownership_R1_pledge: {
    source: "scoring/ownership/pledging.ts (not a FireRule — written by the ownership persist path)",
    trigger:
      "In the latest shareholding quarter, EITHER the pledge ratio (pledged promoter shares ÷ promoter shares) is above 50%, OR that ratio rose by 10pp or more versus the prior quarter. Either alone is enough. A company with no promoter holding has no ratio and cannot fire.",
    verdict: "ok",
  },
  ownership_R2_promoter_exit: {
    source: "rules/r2-promoter-exit.ts → ownership/disturbances.ts computeR2",
    trigger:
      "Promoter holding % fell by strictly more than 5pp between the latest two shareholding rows, AND a structural dilution check does not explain it (promoter share COUNT stable while total shares rose ⇒ QIP / rights / preferential ⇒ suppressed). Fires on verdict genuine_reduction or indeterminate.",
    verdict: "ok",
    issue:
      "\"in a single quarter\" is not guaranteed. The rule compares the latest two AVAILABLE shareholding rows; when a filing is missing that span covers more than one quarter. The rule itself records this as `spansQuarterGap` — the description does not.",
    corrected:
      "Now reads \"between one shareholding filing and the next\". DESCRIPTION was wrong; the rule is right — comparing the latest two available rows is the only thing it can do, and it already records `spansQuarterGap` when they are not adjacent.",
  },
  foundation_R3_earnings_quality: {
    source: "rules/r3-earnings-quality.ts",
    trigger:
      "Net profit exceeded operating cash flow in 4 or more consecutive ANNUAL periods ending at the latest year. Banking is out of scope. With fewer than 4 annual rows the rule records \"could not check\", not \"false\".",
    verdict: "ok",
    issue:
      "\"four or more consecutive periods\" reads as quarters to most readers. The rule is annual-only — there is no quarterly operating-cash-flow column, so TTM is not derivable. Four consecutive YEARS is a far stronger and rarer claim than four quarters; the word doing the work is missing.",
    corrected:
      "\"periods\" became \"years\". DESCRIPTION was wrong; the rule is right. It is annual-only because there is no quarterly operating-cash-flow column to build a TTM from — a narrower implementation than File 1 intended, documented in the rule, not drift.",
  },
  foundation_R4_debt_explosion: {
    source: "rules/r4-debt-explosion.ts",
    trigger:
      "Latest annual debt-to-equity ((current + non-current borrowings) ÷ net worth) is above 3.0, AND no year in the preceding window breached 3.0 — the FIRST breach only. Banking out of scope; needs at least one known prior year.",
    verdict: "ok",
    issue:
      "\"for the first time in five years\" describes the last FIVE ANNUAL ROWS THE COMPANY HAS, not five calendar years. The rule fires with as few as two rows. On the current ingested history (~2–3 years for most names) the sentence claims a lookback the data cannot support.",
    corrected:
      "Now reads \"for the first time in the company's recent annual accounts — no earlier year on file breached it\". DESCRIPTION was wrong; the rule is right. It cannot check years it does not hold, and the new wording is true at any history depth.",
  },
  foundation_R5_interest_coverage: {
    source: "rules/r5-interest-coverage.ts",
    trigger:
      "Trailing-twelve-month interest coverage — (Σ profit-before-tax + Σ interest) ÷ Σ interest over 4 contiguous quarters — below 1.5× for 2 consecutive TTM windows. Banking out of scope. A debt-free company (Σ interest ≤ 0) is a genuine non-fire, not a data gap.",
    verdict: "ok",
    issue:
      "Two small things. (1) \"Operating profit\" is not what the numerator is: it is EBIT derived as PBT + finance costs, which INCLUDES other income. (2) \"two or more consecutive quarters\" is two overlapping TTM windows, i.e. five quarters of data — not two quarters of trading.",
    corrected:
      "\"Operating profit\" became \"Earnings before interest and tax\", and the trailing-twelve-month basis is now stated. DESCRIPTION was wrong; the rule is right — its numerator deliberately matches the engine's own F5 interest-coverage metric rather than inventing a second definition.",
  },
  ownership_R6_distribution: {
    source: "rules/r6-distribution.ts → ownership/disturbances.ts computeR6",
    trigger:
      "Between the latest two shareholding rows: promoter % fell, FII % fell, and retail % rose — each move at least a 0.05pp noise floor. All three conditions in the same comparison.",
    verdict: "ok",
  },

  // ── E · Patterns ─────────────────────────────────────────────────────────────────────────────
  ownership_P1_clean_rotation: {
    source: "rules/p1-clean-rotation.ts → ownership/flow.ts computeCategoryB, rule B1",
    trigger:
      "DII rose by 1.0pp or more, FII fell by an amount INSIDE the band 0.05pp–0.5pp, and |promoter change| ≤ 0.5pp.",
    verdict: "ok",
    issue:
      "\"foreign institutions sold\" inverts the actual condition at the top end. The FII decline must be SMALL — a fall of more than 0.5pp DISQUALIFIES the pattern. A reader told \"DII bought while FII sold\" will assume a large FII exit is the strongest case for this pattern; it is the one case that cannot fire it.",
    corrected:
      "\"foreign institutions sold\" became \"trimmed only slightly\". DESCRIPTION was wrong; the rule is right — the upper bound on the FII decline is what makes the rotation \"clean\". A large FII exit is a different phenomenon and belongs to P4 / R6.",
  },
  ownership_P4_dual_exit: {
    source: "rules/p4-dual-exit.ts → ownership/flow.ts computeCategoryB, rule B4",
    trigger: "FII fell by 0.5pp or more AND DII fell by 0.5pp or more, in the same quarter.",
    verdict: "ok",
  },
  ownership_P5_insider_distress: {
    source: "rules/p5-insider-distress.ts",
    trigger:
      "The stock's COMPOSITE is below 62, AND over the trailing 90 days promoter- or director-role sell transactions of ≥₹1cr each net to ≥₹2cr sold by at least one distinct insider.",
    verdict: "note",
    issue:
      "The description says the selling confirms \"the ownership stress already visible in the shareholding data\". It does not. The confirming gate is the OVERALL COMPOSITE being below the Steady floor — which can be driven entirely by Foundation, Momentum or Market with the shareholding data completely clean. The description names the wrong thing as the corroboration.",
    corrected:
      "Now reads \"at a company whose overall health already reads weak\". DESCRIPTION was wrong; the rule matches its OWN stated intent (its header calls the composite gate \"what makes it confirmed distress\").\n\n📝 **Still worth a look, and left alone deliberately.** The finding is named \"Insider-Confirmed Distress\", sits in the *ownership* concern bucket, and its old description claimed the shareholding data corroborates. That is the reading its name invites — and it is not what the rule does. Either the name and bucket, or the gate, is the odd one out. A rule change moves scores, so this build corrected the copy and stopped there.",
  },
  ownership_P6_insider_conviction: {
    source: "rules/p6-insider-conviction.ts",
    trigger:
      "Over the trailing 90 days, DIRECTOR-role transactions of ≥₹1cr each net to ≥₹2cr bought, by at least one distinct director.",
    verdict: "ok",
    issue:
      "\"Company insiders\" over-claims. Promoters are deliberately excluded — they belong to P10, so the two never double-count the same trade. The rule reads directors/KMP only. The per-stock verdict sentence says \"directors/KMP\" correctly; this static description, which is what shows on the Hub census board, does not.",
    corrected:
      "\"Company insiders\" became \"Directors and key management\". DESCRIPTION was wrong; the rule is right — promoters are excluded on purpose so P6 and P10 never count the same trade twice.",
  },
  foundation_P7_accruals: {
    source: "rules/p7-accruals.ts",
    trigger:
      "In the latest ANNUAL period: net profit > 0 and operating cash flow is below 50% of net profit — and the annual exceptional-item guard finds the year's profit is not one-off-distorted. Banking out of scope.",
    verdict: "ok",
    issue:
      "\"Reported profit is running ahead of cash generation\" is directionally right but carries no magnitude, and the magnitude IS the rule — the bar is half. A company converting 60% of profit to cash reads as \"running ahead\" in plain English and does not fire. (Related: R3 is the persistence twin; P7 is the magnitude one. Neither description says so, and a reader seeing both will not know why.)",
    corrected:
      "Now names the bar: \"covered less than half of reported profit in the latest financial year\". DESCRIPTION was wrong; the rule is right. ⚠ Its HEADER COMMENT was also wrong — it read 70% above a 0.50 constant — and has been corrected in the same build.",
  },
  foundation_P8_receivables: {
    source: "rules/p8-receivables.ts",
    trigger:
      "Year on year, in the latest annual period: receivables grew 10% or more, receivables are at least 5% of revenue, AND receivables growth exceeded revenue growth by 15pp or more.",
    verdict: "ok",
    issue:
      "\"Receivable days are climbing faster than revenue\" — the rule never computes receivable days. It compares the growth RATE of the receivables BALANCE against the growth RATE of revenue. \"Days climbing faster than revenue\" is also not a coherent comparison (a ratio's growth against a level's growth). The second sentence — capital sitting in money customers owe — is accurate; the first is not.",
    corrected:
      "\"Receivable days\" became \"Money owed by customers\", and the annual grain is stated. DESCRIPTION was wrong; the rule is right — comparing balance growth against revenue growth is the more robust measure, and \"days\" was never computed.",
  },
  ownership_P10_promoter_defense: {
    source: "rules/p10-promoter-defense.ts",
    trigger:
      "The Market pillar is below 72 (or unavailable), AND over the trailing 90 days promoter-role transactions of ≥₹1cr each net to ≥₹2cr bought, with at least one buy.",
    verdict: "ok",
    issue:
      "BOTH factual claims in the description are wrong. (1) \"through block deals\" — the rule reads the INSIDER-TRANSACTION feed, not the block/bulk-deal feed. Block deals are finding H, and the score-side equivalent is Ownership Flow category D; the rule file separates them explicitly so they never double-count. (2) \"while the price sat near a multi-quarter low\" — no price low is tested. The gate is the Market PILLAR SCORE being under its strong mark, and that score blends range position, trend, relative strength versus sector and volatility. A stock well off its lows can score Market < 72 and fire this.",
    corrected:
      "Both false claims removed: no block deals, no price low. Now \"at a time when its share price was not reading strongly\". DESCRIPTION was wrong on both counts; the rule is right, and its header already documented the feed split from H and the Market-pillar gate.",
  },
  momentum_P11_margin_compression: {
    source: "rules/p11-margin-compression.ts (series built by findings/context.ts opmSeriesFromQuarters)",
    trigger:
      "Single-quarter operating margin (operating profit ÷ revenue) fell in 2 or more consecutive quarter-on-quarter steps ending at the latest quarter — i.e. three or more margin points — and the latest quarter is not flagged as an exceptional-item distortion.",
    verdict: "note",
    issue:
      "Two errors in one sentence. (1) The threshold is TWO consecutive declines, not \"three or more\". (2) The series is SINGLE-QUARTER operating margin, not \"trailing-twelve-month windows\" — opmSeriesFromQuarters divides one quarter's operating profit by the same quarter's revenue. The description's reassurance, \"a sustained trend, not a single soft quarter\", is therefore weaker than it reads: the minimum firing case is two consecutive quarterly dips.",
    corrected:
      "Both errors fixed: \"three or more\" became \"two or more\", and \"trailing-twelve-month windows\" became \"quarters\". DESCRIPTION was wrong; the rule is right.\n\n📝 **Coupling to watch.** The rule declares itself provisional — its header says \"raise to 3 once deeper OPM history is ingested\". If P11_MIN_DECLINES moves, this description, P12's mirror, and the BAR_NAMING row in verify-catalogue.ts must all move with it. Three places, one constant.",
  },
  momentum_P12_margin_recovery: {
    source: "rules/p12-margin-recovery.ts",
    trigger:
      "Single-quarter operating margin rose in 2 or more consecutive steps ending at the latest quarter; the trough is not negative and not a flagged exceptional-charge quarter; and the latest annual period does not fire an exceptional-GAIN guard.",
    verdict: "ok",
    issue:
      "The count (\"two or more\") is right. The grain is not: \"trailing-twelve-month windows\" should be quarters — same error as P11, and the two need fixing together since they are written as mirrors.",
    corrected:
      "\"trailing-twelve-month windows\" became \"quarters\". DESCRIPTION was wrong; the rule is right. Paired with P11 — they are written as mirrors and now share the corrected grain.",
  },
  momentum_P13_revenue_inflection: {
    source: "rules/p13-revenue-inflection.ts",
    trigger:
      "The latest TTM year-on-year revenue growth RATE differs from the prior quarter's TTM growth rate by 5pp or more in absolute terms. Accelerating ⇒ green/positive; decelerating ⇒ red/negative. Needs 9 contiguous quarters of revenue. Banking out of scope.",
    verdict: "note",
    issue:
      "The description states \"at least 3 percentage points\". The engine constant is P13_INFLECTION_PP = 5. This is the sharpest mismatch in the registry, because it is a NUMBER: the catalogue deliberately permits nine descriptions to name their trigger bar (those bars read filed public disclosures and cannot be gamed), so a reader is invited to trust it, and it is 40% below the real one. See also Part 4 — this is the only finding whose severity crosses the constructive/concern line.",
    corrected:
      "\"at least 3 percentage points\" became \"at least 5\", matching P13_INFLECTION_PP. DESCRIPTION was wrong; the rule is right.\n\n📝 **Coupling to watch.** The constant is marked provisional in the rule, and this is one of the nine descriptions permitted to name its bar — so the copy is now pinned to a number that may deliberately move. If it does, change the description and the BAR_NAMING row together. P13 is also the split candidate — see REVIEW_p13_split.md.",
  },

  // ── B / C / D / F / G / H / I · structural ───────────────────────────────────────────────────
  trajectory_B_deterioration: {
    source: "rules/b-deterioration.ts",
    trigger:
      "The composite crossed DOWN through 68 (out of Healthy); or sits in 68–74 having crossed DOWN through 74 (out of Pristine); or any pillar crossed down through its own strong mark. The cross must have held for at least 2 snapshots and be recent.",
    verdict: "ok",
  },
  divergence_C1_price_ahead: {
    source: "rules/c1-divergence.ts",
    trigger:
      "Market − mean(Foundation, Momentum) ≥ 25. All three pillars must be genuinely scored (a pillar that was removed from the blend stores a subtotal of 0 and is excluded here, or the gap would be fabricated).",
    verdict: "ok",
  },
  divergence_C2_ownership_vs_fundamentals: {
    source: "rules/c2-ownership-divergence.ts",
    trigger:
      "Either (Foundation ≥ 60 AND Foundation − Ownership ≥ 15) — owners stepping back from a sound business; or (Foundation < 60 AND Ownership − Foundation ≥ 15) — owners building under a weak one. Severity high when the gap reaches 25, medium otherwise.",
    verdict: "ok",
  },
  divergence_C3_floor_trajectory_split: {
    source: "rules/c3-floor-trajectory-split.ts",
    trigger: "|Foundation − Momentum| ≥ 25. Both pillars must be genuinely scored.",
    verdict: "note",
    issue:
      "Description is accurate. Code note, not copy: the severity expression is `wide ? \"high\" : \"medium\"` with `const wide = true` immediately above it, so the medium branch is unreachable and C3 can only ever emit high. Harmless today; it is a latent second severity that would surprise whoever relies on the ternary.",
  },
  divergence_C_over_time_widening: {
    source: "rules/c-over-time.ts",
    trigger:
      "The PRICE-VS-FUNDAMENTALS gap specifically (Market − mean(Foundation, Momentum) — C1's metric) is currently in the 15–25 band AND has risen by 8pp or more from its lowest value in the last 4 snapshots.",
    verdict: "ok",
    issue:
      "\"A pillar gap that was already notable\" reads as any pillar pair, and that is wrong: this rule watches ONE gap, price versus fundamentals. A widening Foundation-versus-Ownership gap does not fire it. The C family's own comment names the disjoint split (C1 owns wide-now, this owns developing, G owns narrowing) — the description does not carry it.",
    corrected:
      "\"A pillar gap\" became the price-versus-fundamentals gap specifically. DESCRIPTION was wrong; the rule is right — the narrow scope is what keeps C1 (wide now), C-over-time (developing) and G (narrowing) disjoint.",
  },
  divergence_consolidated: {
    source: "catalogue/divergence.ts consolidateDivergence (read-layer synthesis, never emitted by a rule)",
    trigger:
      "Not a rule. When any of C1 / C2 / C3 / C-over-time fired for a stock, they collapse into this single row, showing at most two sub-type sentences and counting the rest. §5C exists so four cards all saying \"two reads disagree\" do not overstate how much is wrong.",
    verdict: "ok",
  },
  trajectory_D_recovery: {
    source: "rules/d-recovery.ts",
    trigger:
      "The composite crossed UP through 62 (out of Below-par / Fragile), or any pillar crossed up out of its own weak mark, sustained at least 2 snapshots.",
    verdict: "note",
    issue:
      "The trigger half is accurate. The second sentence is not a trigger claim at all: \"In this program's testing, recovery from weakness has been the most durable signal observed\" is a RESEARCH claim shipped as product copy. Nothing in the rule, the evidence payload or the catalogue records what testing, over what period, against what benchmark — and no reader can check it. It is hedged (\"stated descriptively, not as a forecast\") but it is still the only sentence in the registry that asserts predictive durability. Worth an explicit decision on whether it ships.",
  },
  composition_F1_atypical: {
    source: "rules/f1-composition.ts",
    trigger:
      "Some pillar sits 25pp or more away from the median value of that pillar across companies in the SAME COMPOSITE BAND. At least 3 pillars must be scored, or the shape cannot be judged.",
    verdict: "ok",
    issue:
      "Accurate. One caveat the rule file raises itself and the copy does not: band-typical profiles pool all sectors, so a sector-characteristic shape (IT's habitually low Market read) can register as \"atypical\" when it is simply typical for that industry.",
  },
  trajectory_F2_composition_shift: {
    source: "rules/f2-composition-shift.ts",
    trigger:
      "|Δ composite versus the prior snapshot| < 3 (the score \"held\") AND either some pillar moved 8pp or more, OR the highest-scoring pillar changed.",
    verdict: "ok",
    issue:
      "\"changed materially\" covers the 8pp branch well. It covers the other branch loosely: a leader change alone fires with no size requirement, so two pillars a point apart swapping places is a \"material\" mix shift by this rule. Arguably right (which pillar leads IS the story) but it is not what \"materially\" signals.",
    corrected:
      "Now names both branches — one pillar moving markedly, OR the strongest pillar changing. DESCRIPTION was imprecise; the rule is right, and which pillar leads genuinely is the story.",
  },
  trajectory_G_convergence: {
    source: "rules/g-convergence.ts",
    trigger:
      "The current widest-minus-narrowest pillar spread is BELOW 25; the largest spread among prior snapshots was 15 or more; and the spread has narrowed by 8pp or more from that peak.",
    verdict: "ok",
    issue:
      "\"A pillar gap that was previously WIDE has narrowed.\" The prior gap only has to have been NOTABLE (15). \"Wide\" is the ≥25 tier — a specific, stricter thing with its own meaning elsewhere in this vocabulary (C1/C3 both use it). And the rule deliberately refuses to fire while the CURRENT spread is still wide, because the C family owns a still-open divergence. So \"previously wide\" both overstates the entry condition and muddles the handoff between G and C.",
    corrected:
      "\"previously wide\" became \"previously notable\". DESCRIPTION was wrong; the rule is right — requiring only a notable prior gap, and refusing to fire while the current gap is still wide, is what hands the still-open case to the C family.",
  },
  ownership_H_block_events: {
    source: "rules/h-ownership-events.ts",
    trigger:
      "At least one block or bulk deal worth ₹1cr or more in the trailing 90 days. That is the whole rule.",
    verdict: "note",
    issue:
      "\"or a material change in pledged shares\" is NOT IMPLEMENTED. ruleH reads feeds.blockTxns and has no pledging input at all. Pledging belongs to R1 (crisis) and N7 (release). As written the description promises a second trigger the rule does not have — so a reader who sees no H card concludes pledging did not move, when pledging was never checked here.",
    corrected:
      "The pledge clause is gone: now \"A significant block or bulk deal was recorded in the last quarter.\" DESCRIPTION was wrong; the rule does exactly what its own header says.\n\n📝 **The strongest candidate in the set for the RULE being incomplete rather than the copy.** The finding is called \"Ownership Events\" and a material change in pledged shares plainly is one — the description may have been written against an intended two-input rule that only ever got one input built. Pledging is currently reachable only through R1 (crisis level) and N7 (release), so a mid-sized pledge move surfaces nowhere at all. Copy corrected to today's engine; the gap reported, not closed.",
  },
  trajectory_I_band_transition: {
    source: "rules/i-band-transition.ts",
    trigger:
      "The composite crossed UP through 68 (into Healthy) or DOWN through 62 (into Below-par), sustained at least 2 snapshots — and is not already covered by D (for the up cross) or B (for the down cross), so the same move never renders twice.",
    verdict: "ok",
    issue:
      "\"crossed a band boundary\" — there are four boundaries (55 / 62 / 68 / 74) and this rule watches two. A drop from Below-par into Fragile, or a rise from Healthy into Pristine, does not fire I. The description's own second half names the two correctly, so this over-promises in its first clause rather than actively misleading.",
    corrected:
      "Now names the two boundaries it actually watches. DESCRIPTION over-promised; the rule is right — B and D own the other crossings, and I is deliberately subordinate to them.",
  },

  // ── N · Notable ──────────────────────────────────────────────────────────────────────────────
  foundation_N1_cash_backed_earnings: {
    source: "rules/n1-cash-backed-earnings.ts",
    trigger:
      "Operating cash flow was at least equal to net profit for 3 or more consecutive annual periods, with net profit positive in each, and the latest year clear of the exceptional-item guard. Banking out of scope.",
    verdict: "ok",
  },
  foundation_N2_working_capital: {
    source: "rules/n2-working-capital.ts",
    trigger:
      "Revenue growth exceeded receivables growth by 15pp or more for 2 or more consecutive annual periods, with receivables at least 5% of revenue in the base year. Banking out of scope.",
    verdict: "ok",
    issue:
      "The 15pp bar is not stated, and that is deliberate — Family N's §4.0 rule forbids naming threshold constants in a description. Flagged only so the operator sees the omission is a policy, not an oversight, and can compare it with P8 (the negative twin), whose description DOES try to describe its bar and gets it wrong.",
  },
  foundation_N3_deleveraging: {
    source: "rules/n3-deleveraging.ts",
    trigger:
      "Debt-to-equity fell in 3 or more consecutive annual steps AND the total fall is at least 0.5× in absolute terms or at least 25% in relative terms. Negative net worth in the window makes it unevaluable rather than false. Banking out of scope.",
    verdict: "ok",
  },
  foundation_N4_coverage_strengthening: {
    source: "rules/n4-coverage-strengthening.ts",
    trigger:
      "TTM interest coverage rose in 2 or more consecutive steps AND the trough of that run was below 3.0×. A debt-free company is unevaluable, not a non-fire. Banking out of scope.",
    verdict: "ok",
  },
  ownership_N5_dual_institutional_build: {
    source: "rules/n5-dual-institutional-build.ts",
    trigger:
      "FII and DII each rose by 0.5pp or more in the same quarter, AND Flow rule B1 (clean rotation) did not fire.",
    verdict: "ok",
  },
  ownership_N6_promoter_accumulation: {
    source: "rules/n6-promoter-accumulation.ts",
    trigger:
      "Promoter share COUNT rose for 2 or more consecutive quarters AND the cumulative promoter-% rise is at least 1.0pp. Counting shares rather than percent is what stops a buyback (percent up, count flat) from firing it.",
    verdict: "ok",
  },
  ownership_N7_pledge_release: {
    source: "rules/n7-pledge-release.ts",
    trigger:
      "The pledge ratio fell by 10pp or more quarter on quarter, OR crossed below 50% from above. Suppressed when R1 is still standing.",
    verdict: "ok",
  },
};

const VERDICT_MARK: Record<Verdict, string> = {
  ok: "✅ matches",
  soft: "⚠ imprecise",
  mismatch: "❌ mismatch",
  note: "📝 matches · open question",
};

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ key: string; severity: string | null; symbol: string }[]>(`
    WITH head AS (
      SELECT DISTINCT ON (symbol) id, symbol
      FROM score_snapshots WHERE snapshot_type='quarterly'
      ORDER BY symbol, as_of_date DESC, version DESC
    )
    SELECT p.pattern_key AS key, p.severity, h.symbol
      FROM score_patterns p JOIN head h ON p.snapshot_id = h.id
    UNION ALL
    SELECT f.flag_key AS key, f.severity, h.symbol
      FROM score_red_flags f JOIN head h ON f.snapshot_id = h.id
  `);
  const universe = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(DISTINCT symbol) AS n FROM score_snapshots WHERE snapshot_type='quarterly'`,
  );
  const M = Number(universe[0].n);

  const fires = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    if (!fires.has(r.key)) fires.set(r.key, new Map());
    const m = fires.get(r.key)!;
    const s = r.severity ?? "(none)";
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(r.symbol);
  }
  const firingText = (key: string): string => {
    const m = fires.get(key);
    if (!m) return "_Not firing on any company today._";
    return [...m.entries()]
      .sort()
      .map(([sev, syms]) => `\`${sev}\` × ${syms.length} — ${syms.sort().join(", ")}`)
      .join("<br>");
  };

  // Live lens-face activity, computed — the four escalating faces are the priority for that pass.
  const lensStat = (prefix: string) => {
    const keys = [...fires.keys()].filter((k) => k.startsWith(prefix));
    const n = keys.reduce(
      (a, k) => a + [...fires.get(k)!.values()].reduce((b, syms) => b + syms.length, 0),
      0,
    );
    return { keys: keys.length, n };
  };
  const lm3 = lensStat("lens_lm3_");
  const lm7 = lensStat("lens_lm7_");
  const lp2 = lensStat("lens_lp2_");
  const lp5 = lensStat("lens_lp5_");

  const sizes = catalogueSize();
  const counts = { ok: 0, soft: 0, mismatch: 0, note: 0 };
  for (const k of STOCK_FINDING_KEYS) counts[R[k].verdict]++;

  const L: string[] = [];
  const p = (s = "") => L.push(s);

  p("# Finding copy vs. what the rule actually fires on");
  p();
  p(
    "**Review complete, and the 18 findings it turned up have been corrected.** This document is now both the audit and the record of what changed: for every finding, the copy as it ships today, the trigger read out of the rule body, and — where they disagreed — what was wrong and how it was resolved.",
  );
  p();
  p(
    "★ **One rule governed every correction: the DESCRIPTION moved, never the RULE.** A copy change describes the engine differently; a rule change makes the engine behave differently, and would silently move live scores and re-fire findings across the universe. All 18 were adjudicated first, and all 18 were description errors. Three rules are flagged below as worth a look — none was touched.",
  );
  p();
  p(
    `_Generated from the shipped catalogue and the live database. Scored universe at time of writing: **${M} companies**. Re-run \`src/scripts/_content-review-doc.ts\` to refresh._`,
  );
  p();
  p("---");
  p();
  p("## Why this document exists");
  p();
  p(
    "Every gate built around this copy proves **presence** (a key with no description is a compile error), **register** (no advice words, no prediction) and **consistency** (the frontend fallback is byte-identical to the backend catalogue, enforced in CI). Not one of them checks whether a description is **true of the rule it describes**.",
  );
  p();
  p(
    "So all 35 stock-finding descriptions are enforced-present and unverified-correct. This document puts the shipped sentence next to the trigger read out of the rule body, for all 35, and names the ones where they disagree.",
  );
  p();
  p(
    "**Method.** The name, description and doesn't-mean columns are pulled from `STOCK_FINDINGS` at generation time — not retyped — so they are exactly what ships. The firing column is a live query against the latest quarterly snapshot per company. The trigger column is hand-read from each rule **body**, never its header comment.",
  );
  p();
  p(
    "That last point is not pedantry, and the review found the case that proves it: `rules/p7-accruals.ts` described its trigger as \"operating cash backs **< 70%** of profit\" while the constant six lines below read `P7_CASH_BACK_MAX = 0.50`. A reviewer working from headers would have confirmed P7's copy against a threshold the engine had abandoned, and signed it off. That comment is now fixed — see below.",
  );
  p();
  p("### Verdicts at a glance");
  p();
  p("| | Count | Meaning |");
  p("|---|---:|---|");
  p(`| ✅ matches | ${counts.ok} | The description describes what the rule fires on. |`);
  p(
    `| ⚠ imprecise | ${counts.soft} | Directionally right; a word or a magnitude would mislead a careful reader. |`,
  );
  p(
    `| ❌ mismatch | ${counts.mismatch} | The description asserts something the rule does not do. |`,
  );
  p(
    `| 📝 matches · open question | ${counts.note} | The copy is now right. Something *around* it still needs a decision — a rule that may be incomplete, or a threshold the copy is pinned to that may move. |`,
  );
  p();
  p(
    `All ${counts.ok + counts.note} entries now describe what their rule fires on. The 18 corrections are recorded inline: each carries the defect that was found and the ruling that resolved it.`,
  );
  p();
  p("### The three rules worth a look — reported, deliberately not changed");
  p();
  p(
    "1. **H · Ownership Events** — the strongest case for the *rule* being incomplete rather than the copy. Its old description promised \"or a material change in pledged shares\"; `ruleH` reads the block-deal feed and has no pledging input at all. Pledging is currently reachable only through R1 (crisis level) and N7 (release), so a mid-sized pledge move surfaces nowhere. The copy now describes the one input that exists.",
  );
  p(
    "2. **P5 · Insider-Confirmed Distress** — the rule gates on the overall composite being weak, but the finding is named for ownership, bucketed under ownership, and was described as corroborating the shareholding data. Either the name and bucket, or the gate, is the odd one out.",
  );
  p(
    "3. **P11 / P13 · provisional constants** — both rules declare their own thresholds provisional (P11's header intends to raise 2 → 3 once deeper margin history lands). Their descriptions now name the current bars, so a future constant change has to move the copy and the `BAR_NAMING` gate row with it.",
  );
  p();
  p("### One stale header comment, and why it mattered");
  p();
  p(
    "A sweep of all 33 rule files found exactly one header comment disagreeing with its own constant: `rules/p7-accruals.ts` described the trigger as \"operating cash backs **< 70%** of profit\" while `P7_CASH_BACK_MAX` six lines below read `0.50`. The bar had been lowered (0.70 fired on 15 names, mostly routine working-capital timing) and the comment was never updated. It is corrected, with a note pairing it to the catalogue description.",
  );
  p();
  p(
    "That single line is the reason this whole review was worth running: a reviewer working from headers would have confirmed P7's copy against a bar the engine had abandoned, and signed it off.",
  );
  p();
  p("### The gate was pinning six of the wrong bars");
  p();
  p(
    "`verify-catalogue.ts §7` asserts that nine descriptions still NAME their trigger bar — the protection against someone quietly \"harmonising\" the finding bars down to the guardrail registry's no-digits rule. It works, and it never once proved the bars were **correct**: each regex was transcribed from the very description it checks, so copy and assertion drifted from the engine together and the gate stayed green throughout.",
  );
  p();
  p(
    "Six of the nine rows were pinning wrong text — R3, R4, R5, P11, P12 and P13. All six are repointed at the corrected wording, and the section now carries a warning that the rule body, not the row, is the authority.",
  );
  p();
  p("---");
  p();
  p("## Scope of this pass — and what still needs its own");
  p();
  p("The catalogue has **four registries**. This pass covers one of them in full.");
  p();
  p("| Registry | Entries | In this pass? | Why |");
  p("|---|---:|---|---|");
  p(
    `| \`stock_finding\` | ${sizes.stock_finding} | **Yes — all ${sizes.stock_finding}** | One rule body per key, each a threshold test over a company's own data. The method (read the body, state the trigger) applies cleanly. |`,
  );
  p(
    `| \`lens_face\` | ${sizes.lens_face} | **No — needs its own pass** | LM1–LM8 / LP1–LP6 do not have FireRule bodies. A face fires on a *combination of three lens STATES* (above/below bar × above/near/below peers × improving/flat/declining), and the LP faces on pass-share fractions across a whole pillar. The reviewer's question is different — "does this sentence describe that state combination?" — and the source is \`scoring/lens-patterns/\` plus \`docs/Vytal_Three_Lens_Pattern_Library_v1.md\`. **Priority: the four that escalate into findings** (LM3, LM7, LP2, LP5) — those render on the Hub census board, so a wrong description there reaches the same surface as a stock finding. Live now: LM3 across ${lm3.keys} metric keys (${lm3.n} firings), LM7 across ${lm7.keys} (${lm7.n}), LP2 across ${lp2.keys} (${lp2.n}), LP5 across ${lp5.keys} (${lp5.n}). The other ten faces never escalate — they render as per-stock pillar-breakdown pills only. |`,
  );
  p(
    `| \`phs_finding\` | ${sizes.phs_finding} | **No — needs its own pass** | Portfolio findings are a separate engine (\`portfolio/phs/\`) over a book, not a company: different evidence shapes, a different band ladder (Weak/Fragile/Mixed/Steady/Strong) and a different vocabulary. Reviewing them alongside stock findings would invite exactly the ladder confusion the product works hard to keep apart. Largest of the four — budget accordingly. |`,
  );
  p(
    `| \`guardrail_signature\` | ${sizes.guardrail_signature} | **No — and the question is a different one** | By deliberate policy **not one of these strings contains a digit**, because guardrail thresholds ARE gameable (they detect manipulated reporting) whereas finding bars read filed disclosures that cannot be restructured to duck them. Both sides are asserted in \`verify-catalogue.ts §7\`. So "does the description name the right number?" is inapplicable by design; the reviewable question is "does the qualitative sentence describe the right *shape* of detection?" That needs the guardrail design doc open alongside. |`,
  );
  p();
  p("---");
  p();
  p("## The 35 stock findings");
  p();

  const FAMILY_TITLE: Record<string, string> = {
    A: "Family A · Critical red flags",
    E: "Family E · Patterns",
    B: "Family B · Deterioration",
    C: "Family C · Divergence",
    D: "Family D · Recovery",
    F: "Family F · Composition",
    G: "Family G · Convergence",
    H: "Family H · Ownership events",
    I: "Family I · Band transition",
    N: "Family N · Notable (constructive twins)",
  };
  const ORDER = ["A", "E", "B", "C", "D", "F", "G", "H", "I", "N"];

  for (const fam of ORDER) {
    const keys = STOCK_FINDING_KEYS.filter((k) => STOCK_FINDINGS[k].family === fam);
    if (!keys.length) continue;
    p(`### ${FAMILY_TITLE[fam]}`);
    p();
    for (const key of keys) {
      const e = STOCK_FINDINGS[key];
      const r = R[key];
      p(`#### ${e.name} <sub>${VERDICT_MARK[r.verdict]}</sub>`);
      p();
      p(`\`${key}\` · concern **${e.concern}** · status **${e.status}**`);
      p();
      p(`**Description, as it ships**`);
      p(`> ${e.description}`);
      p();
      p(`**Doesn't-mean, as it ships**`);
      p(`> …${e.doesntMean}`);
      p();
      p(`**What the rule actually fires on** — \`${r.source}\``);
      p(`> ${r.trigger}`);
      p();
      p(`**Firing now**`);
      p();
      p(firingText(key));
      p();
      if (r.issue) {
        p(`**What was wrong** — ${r.issue}`);
        p();
      }
      if (r.corrected) {
        p(`**Resolved** — ${r.corrected}`);
        p();
      }
      p("---");
      p();
    }
  }

  p("## Three things that are not copy problems, noted while reading");
  p();
  p(
    "**Retired and unbuilt keys are absent by design, and cannot acquire copy.** P2 (distribution-retail) was consolidated into R6 and P3 (promoter stress) into R1; their rule files survive but are not registered in `ALL_RULES`, so they cannot fire. P9 (capex) was never built. Copy for a key that can never arrive is copy that can never be checked, so the registry refuses it. Worth knowing before anyone asks why the P-series has gaps.",
  );
  p();
  p(
    "**Two findings can fire at more than one severity.** `momentum_P13_revenue_inflection` fires green or red depending on direction — the only rule in the registry whose severity crosses the constructive/concern line. `divergence_C2_ownership_vs_fundamentals` fires high or medium by gap size, within one direction. (`divergence_C3` looks like a third but its medium branch is unreachable — see its note.) Written up separately in `REVIEW_mixed_severity_census.md`; the case for splitting P13 into two keys is in `REVIEW_p13_split.md`.",
  );
  p();
  p(
    "**One doesn't-mean line is doing double duty.** P13's boundary — \"a condition to look at — not a trade signal\" — is its family's generic line, and it has to cover both an acceleration and a deceleration. It is not wrong for either, and it is not pointed at either. That is a consequence of one key carrying two directions, so it is part of the split decision rather than a copy fix; correcting it in place would mean writing a sentence that is honest about acceleration and deceleration at once, which is the thing that cannot be done well.",
  );
  p();

  const path = "docs/REVIEW_finding_copy_vs_triggers.md";
  writeFileSync(path, L.join("\n"), "utf8");
  console.log(`wrote ${path} (${L.join("\n").length} chars)`);
  console.log("verdicts:", counts);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
