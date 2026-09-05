// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE FACT BLOCK (builder).
//
// Assembles everything the model is allowed to say about ONE (stock, quarter), as computed facts with
// pre-rendered display strings. The model calculates nothing.
//
// ── ★ STAGE 2 · THE SWAP ─────────────────────────────────────────────────────────────────────────
// This file used to fetch through a fifteen-field `QRow` that flattened all five families. It now reads
// `FamilyQuarter<F>` from family-rows.ts, whose `values` is a Record over that family's whole manifest.
// The metric count per card went from 2–4 to 12–24. Everything else in this file — the profit source,
// the health section, the divergence, the gaps — is unchanged and was not touched by the swap.
//
// ── ★ STAGE 2 · THE SWAP ─────────────────────────────────────────────────────────────────────────
// This file used to fetch through a fifteen-field `QRow` that flattened all five families. It now reads
// `FamilyQuarter<F>` from family-rows.ts, whose `values` is a Record over that family's whole manifest.
// The metric count per card went from 2–4 to 12–24. Everything else in this file — the profit source,
// the health section, the divergence, the gaps — is unchanged and was not touched by the swap.
//
// ── FOUR RULES THIS FILE ENFORCES STRUCTURALLY ──────────────────────────────────────────────────────
//
// 1 · ★ NO BALANCE SHEET — SUPERSEDED AT STAGE 4, AND NARROWED RATHER THAN DROPPED. Every family's
//     QUARTERLY table is still P&L only, and that has not changed. What changed is that a Q4 card now
//     also carries an ANNUAL SECTION read from the five *_fundamentals tables — debt, equity, assets,
//     cash flow, per-share figures, and a lender's margin and credit cost. The rule now reads:
//
//         NO BALANCE-SHEET FACT ON Q1, Q2 OR Q3. On Q4, the annual section, presence-gated,
//         carrying its own as-of date.
//
//     ⚠⚠ THE COUPLING THAT SHIPPED WITH IT: invalidate.ts's scope widened to the five annual tables in
//     the SAME change. Its old premise — "a brief carries NO balance-sheet fact and does NO annual
//     read" — was quoted from this comment, and stopped being true here. The two files must move
//     together; see the note in invalidate.ts, which is now the second recorded instance of that
//     coupling class.
//
// 2 · GROWTH IS COMPUTED FROM THE TWO RAW VALUES, never read from the stored *Yoy/*Qoq columns. Those
//     are ~100% populated at the latest period but were not backfilled onto historical rows (banking's
//     nii_yoy: 100% latest, 0% for FY26 Q2 and Q3), so they are unreliable for an older quarter.
//     Computing from the pair we already fetched also GUARANTEES the percentage agrees with the two
//     absolutes printed beside it. ★ peers.ts obeys the same rule and that is why it does not reuse
//     result-detail.service.ts's buildPeers, which reads those columns.
//
// 3 · A PERCENTAGE IS NEVER COMPUTED OFF A ZERO OR NEGATIVE BASE — nor off a tiny positive one, nor is
//     nil ever rendered as a loss. All four live in change.ts now, one implementation, two callers.
//
// 4 · THE HEALTH SECTION IS PRESENCE-GATED. It appears when a ScoreSnapshot exists for this stock AND
//     this period — never a family check, never a hardcoded list.
//
// ── ⚠ AND ONE THAT IS EASY TO UNDO BY ACCIDENT ──────────────────────────────────────────────────────
// The PROFIT SOURCE section reads GuardrailEvent for PRESENCE ONLY. `triggeringValues` is never carried
// into the block. The guardrail catalogue is enforced digit-free (verify-catalogue.ts §7) because naming
// a detector's bar hands a company the shape to structure under; the observed values leak the same bar
// by triangulation. So the characterisation is the catalogue's own reader-facing copy, and every NUMBER
// shown comes from a raw filed line the reader could check against the statement themselves.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
// ★ THE LIVE FINDING CHANNEL — the two halves of a standing transition. See the note at the
//   findings-change block below for why a set difference over snapshots was replaced by these.
import { readNewlyStandingFilingKeys, readResolvedFilingKeys } from "../../filing/read.js";
import { LABEL_BAND_MAP, scoreDisplay } from "../../scoring/composite/label.js";
import { buildAnnualSection, priorFiscalYear, type AnnualSection } from "./annual-section.js";
import { computeAnnualContrasts, type AnnualContrastFact } from "./annual-contrasts.js";
import { fetchFamilyAnnual } from "./annual-rows.js";
import type { AnyFamilyAnnual } from "./annual-manifest.js";
import { changeFact, QOQ_REF, YOY_REF } from "./change.js";
import { computeAnchors, withAnchors, type Anchor } from "./anchors.js";
import { computeContrasts, type ContrastFact } from "./contrasts.js";
import { computeDriver, driverAbsence, type DriverFact } from "./driver.js";
import { fetchFamilyQuarters, resolveFamilyBasis } from "./family-rows.js";
import { money, moneyLoss, fractionToPct } from "./format.js";
import { buildMargins, MARGIN_WINDOW, type MarginRow } from "./margins.js";
import {
  MARGIN_NOT_A_SHARE_REASON,
  PROFIT_EXCEEDS_REVENUE_REASON,
  TOP_LINE_KEY,
  valueOf,
  type AnyFamilyQuarter,
} from "./manifest.js";
import { computePeerContext, type PeerContextFact } from "./peers.js";
import type { MetricKey } from "../../catalogue/quarter-metrics.js";
import { buildQuarterSection, type QuarterSection } from "./quarter-section.js";
import { STOOD } from "./story.js";
import { computeVerdict, directionOf, GNPA_MATERIAL_PP, type LineDirection } from "./verdict.js";
import { guardrailSignature } from "../../catalogue/guardrail-signatures.js";
import { findingName } from "../../catalogue/stock-findings.js";
import { metricGloss } from "../../catalogue/quarter-metrics.js";
import { annualMetricGloss } from "../../catalogue/annual-metrics.js";
import type {
  Basis,
  BriefIdentity,
  ChangeFact,
  DisagreementFact,
  Fact,
  Family,
  FindingChange,
  HeadlineSection,
  HealthMovementSection,
  HeadlineHealthDivergence,
  LineComparison,
  MarginSeries,
  MarginsSection,
  PillarDelta,
  ProfitSourceSection,
  QuarterBriefFactBlock,
  ScoreChange,
} from "./types.js";

// ── Formatting (for a reader who cannot read a financial statement) ─────────────────────────────────

/** A health score that moved less than a point has not "diverged" from anything. Points on the
 *  0–100 composite, not percent. */
const HEALTH_DIVERGENCE_FLOOR_POINTS = 1.0;

/** A SIGN FLIP IS ONLY WORTH HEADLINING WHEN BOTH SIDES ARE MATERIAL. Deliberately far above
 *  change.ts's MOVEMENT_FLOOR_PCT: HDFCBANK's net profit was −0.8% sequentially and +5.0% on the year,
 *  and calling that "the two comparisons point opposite ways" would dress an essentially flat quarter
 *  up as a contradiction. The disagreement that matters is the seasonal one — down 8% on the quarter,
 *  up 14% on the year. */
const DISAGREEMENT_FLOOR_PCT = 3;

/** Band LABEL for a STORED band value. The band itself always comes from the snapshot, never from
 *  re-deriving it off the composite — a snapshot is pinned to the band mapping in force when it was
 *  written, so recomputing under today's mapping would silently relabel history. */
const bandLabel = (band: string): string => LABEL_BAND_MAP.find((b) => b.band === band)?.label ?? band;

// ★ SCORES RENDER WHOLE, AND THE ROUNDING IS BAND-SAFE. `scoreDisplay` lives in scoring/composite/
// label.ts, beside the band map whose cuts it must not cross — the full argument, and the 6.01%
// measurement behind it, is in that file's header. Two surfaces round a composite (this section and
// the reader's own position section) and both call the one implementation.

/** A PILLAR subtotal, whole. No band hangs off a pillar, so there is nothing for it to disagree with.
 *  ⚠ EXACTLY 0 IS THE ENGINE'S SENTINEL for a pillar that was redistributed rather than scored — the
 *  frontend's health lib states the rule (`isRedistributed`) and 290 of 582 snapshots carry one. A
 *  pillar reported as "held at 0" is the same class of error as a nil line reported as a loss. */
const REDISTRIBUTED = 0;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** "a, b and c". Was inline in three places and became four with the annual section — a fourth copy of
 *  an Oxford-comma decision is how two of them end up disagreeing inside one gaps list. */
const listOf = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const PILLAR_LABEL = {
  foundation: "Foundation",
  momentum: "Momentum",
  market: "Market",
  ownership: "Ownership",
} as const;

// ── Headline (revenue + profit, both comparisons) ───────────────────────────────────────────────────
// ⚠ NOT RENDERED AS PROSE ANY MORE. Section 1 carries every metric with ONE comparison; this structure
// survives because two things need BOTH comparisons and neither is a sentence: the verdict's direction
// inputs, and the QoQ-vs-YoY disagreement rule. Rendering it as well would print revenue twice.

function amountFact(key: string, label: string, cr: number | null): Fact | null {
  if (cr === null) return null;
  const display = cr < 0 ? moneyLoss(cr) : money(cr);
  return { key, label, value: cr, display };
}

function buildLine(
  lineLabel: string,
  keyPrefix: string,
  current: AnyFamilyQuarter,
  prevQ: AnyFamilyQuarter | null,
  yearAgo: AnyFamilyQuarter | null,
  pick: (r: AnyFamilyQuarter) => number | null,
): LineComparison {
  const cur = pick(current);
  return {
    line: lineLabel,
    current: amountFact(`${keyPrefix}.current`, `${lineLabel}, this quarter`, cur) ?? {
      key: `${keyPrefix}.current`,
      label: `${lineLabel}, this quarter`,
      value: null,
      display: "not reported",
    },
    previousQuarter: prevQ
      ? amountFact(`${keyPrefix}.prevQuarter`, `${lineLabel}, previous quarter`, pick(prevQ))
      : null,
    yearAgoQuarter: yearAgo
      ? amountFact(`${keyPrefix}.yearAgo`, `${lineLabel}, same quarter last year`, pick(yearAgo))
      : null,
    qoq: prevQ ? changeFact(`${keyPrefix}.qoq`, cur, pick(prevQ), QOQ_REF, lineLabel.toLowerCase()) : null,
    yoy: yearAgo ? changeFact(`${keyPrefix}.yoy`, cur, pick(yearAgo), YOY_REF, lineLabel.toLowerCase()) : null,
  };
}

/** QoQ and YoY pointing opposite ways — computed, not left for the model to spot. Only meaningful
 *  when BOTH are real percentages and neither is inside the noise floor. */
function disagreement(line: LineComparison): DisagreementFact | null {
  const { qoq, yoy } = line;
  if (!qoq || !yoy) return null;
  if (qoq.kind !== "percent" || yoy.kind !== "percent") return null;
  if (qoq.value === null || yoy.value === null) return null;
  if (Math.abs(qoq.value) < DISAGREEMENT_FLOOR_PCT || Math.abs(yoy.value) < DISAGREEMENT_FLOOR_PCT) return null;
  if (Math.sign(qoq.value) === Math.sign(yoy.value)) return null;

  const l = line.line.toLowerCase();
  return {
    key: `disagreement.${line.line.toLowerCase().replace(/\s+/g, "_")}`,
    line: line.line,
    // ★★ SELF-CONTAINED, INCLUDING THE FIGURE — because this sentence now REPLACES the line's own
    // sentence in story group 1 rather than following it in group 3. It used to open "Revenue up 10%
    // …" and rely on an earlier bullet having already given the amount; standing in for that bullet,
    // it has to carry it. `current.display` is format.ts's canonical rendering, reused verbatim —
    // nothing is computed here — and `STOOD` is story.ts's frame, imported so the substituted
    // sentence opens exactly as the one it replaces.
    display:
      `${line.line} ${STOOD} ${line.current.display} this quarter, ${qoq.display} but ${yoy.display}. ` +
      `The two comparisons point opposite ways, so the ${l} trend depends on which one is read.`,
  };
}

// ── Profit source (presence from GuardrailEvent; numbers from raw filed lines) ───────────────────────

async function buildProfitSource(
  stockId: string,
  periodKey: string,
  current: AnyFamilyQuarter,
): Promise<ProfitSourceSection | null> {
  const event = await prisma.guardrailEvent.findFirst({
    where: { stockId, snapshotKey: periodKey, signatureKey: { in: ["B-1", "B-4"] } },
    select: { signatureKey: true },
    orderBy: { signatureKey: "asc" },
  });
  if (!event) return null;

  const entry = guardrailSignature(event.signatureKey);
  if (!entry) return null;

  // Filed lines only — the reader can check every one of these against the statement.
  const supporting: Fact[] = [];
  const push = (f: Fact | null) => { if (f) supporting.push(f); };

  if (event.signatureKey === "B-4") {
    push(amountFact("profitSource.otherIncome", "Other income, this quarter", valueOf(current, "otherIncome")));
    push(amountFact("profitSource.profitBeforeTax", "Pre-tax profit, this quarter", valueOf(current, "profitBeforeTax")));
  } else {
    push(amountFact("profitSource.operatingProfit", "Operating profit, this quarter", valueOf(current, "operatingProfit")));
    push(amountFact("profitSource.netProfit", "Net profit, this quarter", valueOf(current, "netProfit")));
  }

  return {
    signatureKey: event.signatureKey,
    name: entry.name,
    description: entry.description,
    doesntMean: entry.doesntMean,
    supporting,
  };
}

// ── Health movement (presence-gated — rule 4). UNCHANGED by the swap. ───────────────────────────────

async function buildHealthMovement(stockId: string, periodKey: string): Promise<HealthMovementSection | null> {
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { stockId, snapshotType: "quarterly" },
    orderBy: [{ asOfDate: "asc" }, { version: "asc" }],
    select: {
      id: true, periodKey: true, version: true, asOfDate: true, composite: true, labelBand: true,
      // ★ THE SNAPSHOT'S OWN BAND MAPPING. The comment below already says each snapshot pins the
      //   mapping in force when it was written — this is what makes that true of the ROUNDING as
      //   well as the label. Without it, band-safe rounding judges an old snapshot against today's
      //   cut points, which is the drift bandSafeScore exists to prevent.
      bandMappingVersion: { select: { version: true } },
      foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true,
    },
  });
  if (snaps.length === 0) return null;

  // Newest version wins per period (the supersede chain), preserving period order.
  const byPeriod = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) byPeriod.set(s.periodKey, s);
  const periods = [...byPeriod.keys()];

  const idx = periods.indexOf(periodKey);
  if (idx < 0) return null; // ← THE PRESENCE GATE: no snapshot for this period, no section.

  const cur = byPeriod.get(periodKey)!;
  const prior = idx > 0 ? byPeriod.get(periods[idx - 1])! : null;

  const curComposite = Number(cur.composite);
  // The STORED band, not labelFor(composite). Each snapshot pins the band mapping in force when it
  // was written; re-deriving under today's mapping would relabel an older quarter to a band it was
  // never published under.
  const curBand = { band: cur.labelBand as string, label: bandLabel(cur.labelBand as string) };

  const pillars: PillarDelta[] = (
    [
      ["foundation", cur.foundationSubtotal, prior?.foundationSubtotal],
      ["momentum", cur.momentumSubtotal, prior?.momentumSubtotal],
      ["market", cur.marketSubtotal, prior?.marketSubtotal],
      ["ownership", cur.ownershipSubtotal, prior?.ownershipSubtotal],
    ] as const
  ).map(([pillar, c, p]) => {
    const current = Number(c);
    const priorVal = p === undefined || p === null ? null : Number(p);
    const delta = priorVal === null ? null : current - priorVal;
    const label = PILLAR_LABEL[pillar];

    // ★ 3c — THE SHOWN DELTA IS DERIVED FROM THE SHOWN ENDPOINTS, NEVER ROUNDED SEPARATELY.
    // MEASURED over 487 consecutive period pairs: rounding the TRUE delta disagrees with the rounded
    // endpoints on 123 of them — 25.3%, and every one prints arithmetic a reader can see is wrong
    // ("71 → 68, moved down 4"). Deriving it from the endpoints is 0% by construction, at the cost of
    // 53 real-but-sub-point moves reading as "held" — which is the correct trade and the same rule
    // quarter-section.ts's displayFloor already applies: never claim a move you cannot show.
    const shown = Math.round(current);
    const shownPrior = priorVal === null ? null : Math.round(priorVal);
    const shownDelta = shownPrior === null ? null : shown - shownPrior;

    const display =
      // ⚠ THE SENTINEL FIRST. A redistributed pillar is not a pillar that scored zero, and "Ownership
      // held at 0" is the nil-rendered-as-a-loss failure in a different table.
      current === REDISTRIBUTED
        ? `${label} was not scored this quarter.`
        : shownDelta === null
          ? `${label} scored ${shown} — no prior quarter to compare.`
          : shownDelta === 0
            ? `${label} held at ${shown}.`
            : `${label} moved ${shownDelta > 0 ? "up" : "down"} ${Math.abs(shownDelta)} to ${shown}.`;
    return { pillar, label, current, prior: priorVal, delta, display };
  });

  const curShown = scoreDisplay(curComposite, curBand.band, cur.bandMappingVersion.version);
  const priorComposite = prior ? Number(prior.composite) : null;
  // Both endpoints go through the SAME band-safe rounding, each against its OWN stored band, and the
  // delta is the difference of what is printed. Three figures on one line that a reader can add up.
  const priorShown =
    prior && priorComposite !== null ? scoreDisplay(priorComposite, prior.labelBand as string, prior.bandMappingVersion.version) : null;
  const shownDelta =
    priorShown !== null && Number.isFinite(Number(curShown)) && Number.isFinite(Number(priorShown))
      ? Number(curShown) - Number(priorShown)
      : null;

  const compositeChange: ScoreChange | null =
    priorComposite === null
      ? null
      : {
          key: "health.compositeChange",
          // ⚠ THE FACT KEEPS FULL PRECISION; only the SENTENCE rounds. `delta` feeds
          // headlineHealthDivergence's materiality floor, and a floor fed a rounded input is a
          // different floor — 0.6 points would clear a 1.0-point test after rounding to 1.
          delta: curComposite - priorComposite,
          priorPeriodKey: periods[idx - 1],
          display:
            shownDelta === null || shownDelta === 0
              ? `The health score held at ${curShown}.`
              : `The health score moved ${shownDelta > 0 ? "up" : "down"} ` +
                `${Math.abs(shownDelta)} ${Math.abs(shownDelta) === 1 ? "point" : "points"} to ${curShown}, from ${periods[idx - 1]}.`,
        };

  const priorBand = prior ? { band: prior.labelBand as string, label: bandLabel(prior.labelBand as string) } : null;
  const bandChange =
    priorBand && priorBand.band !== curBand.band
      ? {
          from: priorBand.band, fromLabel: priorBand.label, to: curBand.band, toLabel: curBand.label,
          display: `The health band changed from ${priorBand.label} to ${curBand.label}.`,
        }
      : null;

  // ── FINDINGS CHANGES — REPOINTED 2026-08-11 ───────────────────────────────────────────────────
  //
  // WAS: a set difference of `score_red_flags.flag_key` between this snapshot and the prior one.
  // That table has had no writer since the filing cutover, and the two sides of the difference
  // decayed at different rates: the CURRENT snapshot carried zero rows while older in-force
  // snapshots still carried frozen ones. A set difference between "nothing" and "a stale something"
  // is not a transition — it reports every frozen row as having just stopped. Measured before this
  // change, that produced a false "no longer flagging" line on five companies (DIXON, GLENMARK,
  // INFY, NHPC, SBIN), and GLENMARK's had already been written into a persisted brief.
  //
  // NOW: the filing channel's own standing states, which are stamped at write time against the
  // previous period's row and are therefore transitions by construction rather than by subtraction.
  //   · `newly_standing` + a strictly-older period on record  → started    (readNewlyStandingFilingKeys)
  //   · `resolved`                                            → stopped    (readResolvedFilingKeys)
  // The "strictly-older period" guard belongs only to the started side: `resolved` is stamped ONLY
  // when the prior row fired, so it already carries its own proof. See both functions' headers.
  //
  // ⚠ THE SENTENCES ARE UNCHANGED, and so is the presence gate above — a stock with no snapshot for
  //   this period still gets no section. What changes is that a claim now requires two rows on the
  //   record rather than the absence of one.
  const [startedByStock, resolvedByStock] = await Promise.all([
    readNewlyStandingFilingKeys([stockId]),
    readResolvedFilingKeys([stockId]),
  ]);
  const curSet = startedByStock.get(stockId) ?? new Set<string>();
  const priorSet = resolvedByStock.get(stockId) ?? new Set<string>();

  const asChange = (flagKey: string, verb: string): FindingChange => {
    const name = findingName(flagKey) || flagKey;
    return { flagKey, name, display: `${name} — ${verb} this quarter.` };
  };

  const findingsFired = [...curSet].sort().map((k) => asChange(k, "started flagging"));
  const findingsCleared = [...priorSet].sort().map((k) => asChange(k, "no longer flagging"));

  return {
    periodKey,
    scoredAsOf: ymd(cur.asOfDate),
    composite: { key: "health.composite", label: "Health score", value: curComposite, display: curShown },
    band: { band: curBand.band, label: curBand.label },
    priorPeriodKey: prior ? periods[idx - 1] : null,
    compositeChange,
    bandChange,
    pillars,
    findingsFired,
    findingsCleared,
  };
}

// ── Verdict inputs ──────────────────────────────────────────────────────────────────────────────────

/** A ChangeFact → a line direction. The turnaround kinds carry NO percentage by design (rule 3), so
 *  reading `.value` alone would call a loss-to-profit swing "not computable" and drop the verdict on
 *  exactly the quarter that most needs one. `both_loss` stays null: a loss that narrowed and a loss
 *  that widened are both still a loss, and neither "grew" nor "fell back" describes them honestly.
 *
 *  ⚠ THE TWO NEW KINDS ARE HANDLED DELIBERATELY, NOT BY FALLING THROUGH:
 *  · `large_move` DOES carry `.value` — it changed only how the figure is WORDED, never the
 *    arithmetic — so it reads its direction exactly as `percent` does and the verdict is unaffected.
 *  · `nil` is null. A line that was nothing in both quarters has no direction, and it must not be
 *    mistaken for `both_loss`: nil is not a loss, which is the whole reason the kind exists. */
function directionFromChange(c: ChangeFact | null): LineDirection | null {
  if (!c) return null;
  if (c.kind === "turnaround") return "up";
  if (c.kind === "to_loss") return "down";
  if (c.kind === "both_loss") return null;
  if (c.kind === "nil") return null;
  return directionOf(c.value); // percent | large_move — both carry a signed percentage
}

/** The margin whose direction qualifies the verdict, per family.
 *  Non-financials use OPERATING margin, not net: operating margin excludes other income by
 *  construction, so it answers "did the trading business keep more or less" without being moved by
 *  the very one-off income that B-4 exists to flag. Everyone else uses net margin. General insurance's
 *  combined ratio is deliberately NOT used here — it is inverted (lower is better), and mixing an
 *  inverted axis into a shared rule is how a "margins wider" badge ends up on an insurer whose book
 *  got worse. */
function verdictMarginDirection(family: Family, margins: MarginsSection | null): MarginSeries["direction"] | null {
  if (!margins) return null;
  const wanted = family === "non_financial" ? "Operating margin" : "Net margin";
  return margins.series.find((s) => s.label === wanted)?.direction ?? null;
}

/** Banking only. null (not false) when either quarter's figure is absent — an unknown loan book must
 *  never read as a clean one.
 *
 *  ⚠⚠ IT TAKES `comparison`, NOT `prevQ`, AND THAT IS THE WHOLE POINT — see verdict.ts's SHARED BASE
 *  note. It took `prevQ` until 2026-08-10, which put the badge on a different clock from every
 *  sentence beneath it. MEASURED on the live universe: 4 of 26 banks disagreed between the two bases,
 *  and AXISBANK FY27Q1 shipped the contradiction whole — badge "Grew, bad loans up" (GNPA 1.23% →
 *  1.28% against the PREVIOUS QUARTER) above its own line "Bad-loan share: 1.3% — down 0.3 percentage
 *  points against the same quarter last year" (1.57% → 1.28%). Both figures are right. The card said
 *  bad loans rose and fell, at once. */
function gnpaRisingOf(
  family: Family,
  current: AnyFamilyQuarter,
  comparison: AnyFamilyQuarter | null,
): boolean | null {
  if (family !== "banking") return null;
  const cur = valueOf(current, "grossNpaRatio");
  const pri = comparison ? valueOf(comparison, "grossNpaRatio") : null;
  if (cur === null || pri === null) return null;
  return fractionToPct(cur) - fractionToPct(pri) >= GNPA_MATERIAL_PP;
}

// ── Headline vs health (the contrast a reader would otherwise miss) ─────────────────────────────────

/** Profit and the health score pointing opposite ways. HDFC Bank's FY27Q1 is the case this exists for:
 *  net profit up 5% on the year, health band down Healthy → Steady, driven almost entirely by Market
 *  (−12.9). "Profit up 5%" alone is true and misleading. Both sides must be MATERIAL — a 3% profit
 *  move against a sub-point score drift is not a contradiction, it is noise on both axes. */
function headlineHealthDivergence(
  profit: LineComparison,
  health: HealthMovementSection | null,
): HeadlineHealthDivergence | null {
  if (!health?.compositeChange) return null;

  const growth = profit.yoy ?? profit.qoq;
  if (!growth || growth.value === null) return null;
  if (growth.kind !== "percent" && growth.kind !== "large_move") return null;

  const scoreDelta = health.compositeChange.delta;
  if (Math.abs(growth.value) < DISAGREEMENT_FLOOR_PCT) return null;
  if (Math.abs(scoreDelta) < HEALTH_DIVERGENCE_FLOOR_POINTS) return null;
  if (Math.sign(growth.value) === Math.sign(scoreDelta)) return null;

  const profitWord = growth.value > 0 ? "higher" : "lower";
  const scoreWord = scoreDelta > 0 ? "rose" : "fell";
  const movers = [...health.pillars]
    .filter((p) => p.delta !== null && Math.sign(p.delta) === Math.sign(scoreDelta) && Math.abs(p.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
  // ⚠⚠ 3d-B — `.toLowerCase()` HERE PRINTED "The move came mostly from market." A reader meets that as
  // the common noun — the stock market, which is not what moved — when what moved is MARKET, one of
  // the four named parts of the Vytal health score, three inches below on the same card. The pillar is
  // a proper noun of this product's own vocabulary and it is named as one, with the word "pillar"
  // carrying the grammar so the sentence does not need the lowercase to read.
  const because = movers.length > 0 ? ` The move came mostly from the ${movers[0].label} pillar.` : "";

  // ⚠ THE SAME NUMBER MUST NOT APPEAR TWICE ON ONE CARD IN TWO PRECISIONS. The health section says
  // "moved down 4 points"; this sentence said "fell 3.8 points" three inches away, about the same
  // move. Both were true and a reader meets them as a contradiction. This reads the SENTENCE the
  // health section already rendered rather than re-deriving from `delta`, so the two cannot diverge:
  // one computation, one figure, quoted twice.
  // ⚠ AND IT DEGRADES TO NO MAGNITUDE RATHER THAN TO A SECOND ONE. Band-safe rounding can move an
  // endpoint by a point, so a move that clears the 1.0-point materiality floor can still print as
  // "held". The direction is what this sentence is about; the size is the health section's job.
  const shownPoints = /moved (?:up|down) (\d+) point/.exec(health.compositeChange.display)?.[1] ?? null;
  const magnitude = shownPoints ? ` ${shownPoints} ${shownPoints === "1" ? "point" : "points"}` : "";

  // ── 2a · WAS ONE SENTENCE WITH A PARENTHESIS INSIDE A "BUT". "Net profit was higher (up 5%), but
  // the Vytal health score fell 4 points over the same period." The figure the reader wants is in
  // brackets and the contradiction is behind a coordinator. Two facts, two sentences; the contrast
  // is carried by the order and by the closing line, which is what it was always doing.
  return {
    key: "divergence.headlineVsHealth",
    display:
      `Net profit was ${profitWord}, ${growth.display}. ` +
      `The Vytal health score ${scoreWord}${magnitude} over the same period.${because} ` +
      `The quarter's figures and the longer-run score are not saying the same thing.`,
  };
}

// ── Gaps (always populated — a quarterly P&L read always has a blind side) ──────────────────────────

function buildGaps(args: {
  family: Family;
  quarter: QuarterSection;
  annual: AnnualSection | null;
  isQ4: boolean;
  margins: MarginsSection | null;
  auditPending: boolean;
  prevQ: AnyFamilyQuarter | null;
  yearAgo: AnyFamilyQuarter | null;
  health: HealthMovementSection | null;
  profitSource: ProfitSourceSection | null;
  driver: DriverFact | null;
  /** Why the driver is absent — so this list can state the reason it actually was. See driverAbsence. */
  driverGap: ReturnType<typeof driverAbsence>;
  /** True ⇔ Q-K fired. Two gaps below defer to it rather than restate what it already said. */
  profitNotFromTrading: boolean;
  peers: PeerContextFact | null;
  anchors: Anchor[];
  quartersOnFile: number;
}): string[] {
  const { family, quarter, annual, isQ4, margins, auditPending, prevQ, yearAgo, health, profitSource, driver, peers } = args;
  const gaps: string[] = [];

  // ★ THE FIRST GAP IS NOW THREE GAPS, AND THE SPLIT IS THE POINT. This sentence used to be
  // unconditional and said the balance sheet was not here. On a Q4 card that carries the annual
  // section it would now be FALSE — the reader would be told nothing describes what the company owns,
  // directly above a list of what the company owns. A standing gap that outlives its own premise is
  // worse than no gap, because it teaches the reader to distrust the ones that are still true.
  // ── ★ PLAIN LANGUAGE (1a). Every sentence below leads with its own subject and carries ONE idea.
  // WAS: "The quarter's figures and the full-year figures below them are different things: the
  // quarterly lines cover three months, while what the company owns and owes is reported once a
  // year and is shown as it stood on the year-end date." — one sentence, a colon, a subordinate
  // "while" clause, and three facts. A reader who has never read a statement gets to the colon and
  // still does not know what they are being told.
  if (annual) {
    gaps.push(
      "The quarterly figures cover three months. The full-year figures below them cover twelve. " +
        "What the company owns and owes is reported once a year, and is shown as it stood on the " +
        "last day of that year.",
    );
    if (!annual.datesAgree) {
      // 4d — the second clock, stated in the gaps as well as rendered beside the section, because this
      // is the one place a reader is looking for what the card cannot tell them.
      gaps.push(
        `This company's financial year does not end on the last day of this quarter. ` +
          `The full-year figures are as at ${annual.asOfDate}. That is a different date from the quarter's own.`,
      );
    }
    if (annual.priorFiscalYear === null) {
      gaps.push(
        "The previous full year is not on file. The full-year figures below are shown with nothing to " +
          "compare them against.",
      );
    }
  } else if (isQ4) {
    // Q4 with no section — gate 2 (no annual row) or gate 4 (a row with no balance-sheet line in it).
    // ⚠ ONE SENTENCE FOR BOTH, DELIBERATELY. The two are different to the code and identical to the
    // reader: either way there is no balance sheet for this year and that is the whole of what they
    // need to know. Splitting it would put the shape of our storage into a reader's card.
    gaps.push(
      "No full-year balance sheet is on file for this company for this year. Nothing here describes " +
        "what it owns or owes. Those figures are reported once a year, separately from the quarter.",
    );
  } else {
    gaps.push(
      "These figures are the quarter's profit and loss only. Debt, cash and the balance sheet are " +
        "reported once a year, alongside the January-to-March quarter. Nothing here describes what the " +
        "company owns or owes.",
    );
  }

  if (!yearAgo) {
    gaps.push(
      "The same quarter last year is not on file. The comparison against a year ago cannot be made, " +
        "and a move against the previous quarter alone can be ordinary seasonality.",
    );
  }
  if (!prevQ) gaps.push("The previous quarter is not on file, so there is no sequential comparison.");
  if (args.quartersOnFile < 4 && (margins?.series.length ?? 0) > 0) {
    gaps.push(`Only ${args.quartersOnFile} ${args.quartersOnFile === 1 ? "quarter" : "quarters"} of history is on file, so margin direction is thinly based.`);
  }

  // ★ A SUPPRESSED METRIC IS STATED, NEVER SILENTLY MISSING. This is the live SBILIFE case: five
  // persistency ratios withheld because the filed values are mis-scaled by a factor of a hundred. A
  // reader who is not told sees a life insurer that apparently does not report persistency at all.
  // Suppressions sharing a reason collapse into ONE sentence — two near-identical lines read as a stutter.
  //
  // ★★ 1c — AND ONE REASON DEFERS, BECAUSE Q-K NOW SAYS THE SAME THING WITH THE ARITHMETIC ATTACHED.
  //
  // "profit this quarter was far larger than revenue, so a margin would not describe anything real" is
  // correct, and on a card where Q-K fired it is the SECOND telling of one fact — the first having
  // named the amount, both sides of the subtraction and the fact that the filing does not say what it
  // was. Two statements of one fact three inches apart read as two facts, and the weaker one is the
  // one without a number in it.
  //
  // ⚠ THE MARGIN'S ABSENCE IS STILL EXPLAINED. It is not dropped — a suppressed metric is stated,
  // never silent, and that rule does not bend for a duplication. What changes is that the reason now
  // carries only what is true OF THE MARGIN ("a margin is the share of revenue kept as profit, and
  // this quarter's profit did not come from revenue alone") and hands the evidence back to the rule
  // that computed it. One fact, one figure, one place.
  //
  // ⚠ MATCHED BY CONSTANT, NEVER BY READING THE PROSE. Both the metric line (manifest bounds) and the
  // margin series carry the identical exported string, which is the whole reason it is exported.
  const reasonFor = (reason: string): string =>
    args.profitNotFromTrading && reason === PROFIT_EXCEEDS_REVENUE_REASON ? MARGIN_NOT_A_SHARE_REASON : reason;

  const byReason = new Map<string, string[]>();
  for (const sup of quarter.suppressed) {
    const r = reasonFor(sup.reason);
    (byReason.get(r) ?? byReason.set(r, []).get(r)!).push(sup.label.toLowerCase());
  }
  for (const sup of margins?.suppressed ?? []) {
    const r = reasonFor(sup.reason);
    (byReason.get(r) ?? byReason.set(r, []).get(r)!).push(sup.label.toLowerCase());
  }
  // ★ THE ANNUAL SUPPRESSIONS JOIN THE SAME COLLAPSE, AND THE GUARD CASE IS THE REASON THIS MATTERS.
  // Return on shareholders' money and borrowings-against-shareholders'-money are BOTH withheld on a
  // negative-net-worth row, for the same reason in slightly different words. Sharing the reason string
  // is what collapses them into one sentence instead of two near-identical ones — the same treatment
  // SBILIFE's five persistency ratios get on the quarterly side.
  for (const sup of annual?.suppressed ?? []) {
    (byReason.get(sup.reason) ?? byReason.set(sup.reason, []).get(sup.reason)!).push(sup.label.toLowerCase());
  }
  // ── 2a · THE FRAME IS TWO SENTENCES, NOT ONE WITH AN EM DASH ───────────────────────────────────
  // "No figure is shown for X — <reason>." welds the WHAT and the WHY into one sentence whose second
  // half is itself often two clauses, and it is the most-rendered gaps shape on the card. Every
  // catalogued reason is already a complete clause with a subject, so it stands alone once its first
  // letter is raised. ⚠ THE CAPITALISATION IS THE ONLY THING DONE TO THE REASON — no rewording, no
  // truncation, no reordering. The catalogue stays the one authoring home.
  const asSentence = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
  for (const [reason, labels] of byReason) {
    gaps.push(`No figure is shown for ${listOf([...new Set(labels)])}. ${asSentence(reason)}`);
  }

  // Metrics the family files but this company did not report this quarter. Named, not silently absent.
  if (quarter.notReported.length > 0) {
    const labels = quarter.notReported.map((k) => metricGloss(k).label.toLowerCase());
    gaps.push(`This company did not report ${listOf(labels)} for this quarter.`);
  }
  // The same for the full year, in its own sentence. ⚠ NOT MERGED WITH THE QUARTERLY ONE: "did not
  // report" means a different thing about a different period, and one list spanning both would leave
  // the reader unable to tell which figure was missing from which statement.
  //
  // ⚠ AND THE SENTENCE SHAPE IS DIFFERENT ON PURPOSE — FOUND BY RENDERING BSE, whose full-year
  // accounts carry no interest-cover figure. The quarterly form reads "This company did not report
  // <label>", which works because every quarterly label is a noun phrase ("net margin", "bad-loan
  // share"). Several annual labels are not: "times profit covers the interest bill", "days customers
  // take to pay", "everything it owes". Dropped into that sentence, BSE's card read "This company did
  // not report times profit covers the interest bill in its full-year accounts." So the annual form
  // names the label as the HEADING it is, in quotes, which is grammatical whatever the label's shape.
  if (annual && annual.notReported.length > 0) {
    const labels = annual.notReported.map((k) => `"${annualMetricGloss(k).label}"`);
    gaps.push(
      `The full-year accounts do not include ${labels.length === 1 ? "a figure headed" : "figures headed"} ${listOf(labels)}.`,
    );
  }
  // ★ SHOWN BUT NOT COMPARED. The third state, and the one a reader would otherwise misread as
  // "it did not move". Grouped by reason, like the suppressions above.
  const byNoCompare = new Map<string, string[]>();
  for (const nc of annual?.notCompared ?? []) {
    (byNoCompare.get(nc.reason) ?? byNoCompare.set(nc.reason, []).get(nc.reason)!).push(nc.label.toLowerCase());
  }
  for (const [reason, labels] of byNoCompare) {
    const list = listOf([...new Set(labels)]);
    gaps.push(
      `${list.charAt(0).toUpperCase()}${list.slice(1)} is shown for this year. ` +
        `It is not compared with last year. ${asSentence(reason)}`,
    );
  }

  if (!health) {
    gaps.push("Vytal has not scored this company for this quarter. No score movement is reported.");
  }
  if (family !== "non_financial" && !profitSource) {
    gaps.push(
      "Vytal runs a set of checks that separate trading profit from one-off gains. Those checks run on " +
        "non-financial companies only, so none was applied here.",
    );
  }

  // ★ THE DRIVER'S ABSENCE IS ITSELF A FACT. Silence would read as "nothing stood out"; for a life
  // insurer it means the arithmetic that would identify a driver does not close on this family at all.
  //
  // ⚠⚠ AND IT USED TO NAME THE WRONG REASON ON THREE OF THE FOUR WAYS IT HAPPENS. One sentence — "No
  // single line accounted for enough of the profit move to be called its main cause" — stood for every
  // null the driver returns, and the driver returns null when there is no year-ago row to compare
  // against, when the identity does not close, when the move is too small to attribute, AND when no
  // line reached half of it. On IDEA, where the identity misses by ₹57,491 crore, the card told the
  // reader every line was too small. A gap exists to be honest about what is missing; asserting the
  // wrong reason there is worse than saying nothing at all.
  if (!driver) {
    // ⚠ Q-K ALREADY SAID IT, IN BETTER WORDS AND WITH THE FIGURE. Where the identity is open by enough
    // for the rule to fire, this line would be the third statement of one fact on one card.
    if (!args.profitNotFromTrading) {
      gaps.push(
        args.driverGap === "no_bridge"
          ? "The quarterly figures this kind of company reports do not add up in a way that lets one line be " +
            "named as the cause of the profit move. None is named here."
          : args.driverGap === "no_comparison"
            ? "There is no earlier quarter to measure this one against, so no line can be named as the cause " +
              "of a profit move."
            : args.driverGap === "identity_open"
              ? "The lines this company filed for the quarter do not add up to the profit it reported. Vytal " +
                "will not name a cause for the profit move from figures that do not reconcile."
              : args.driverGap === "move_too_small"
                ? "Profit barely moved this quarter, so there is no move for a single line to have caused."
                : "No single line accounted for enough of the profit move to be called its main cause. None is named.",
      );
    }
  }
  if (!peers) {
    gaps.push(
      "Too few comparable companies have filed this quarter. Nothing here says how this one sat against them.",
    );
  }
  // ★ STAGE 1 — THE MAGNITUDE GAP, AND IT IS THE 5g QUESTION ANSWERED HONESTLY.
  // "Margin narrowed 4.8 percentage points" without an anchor leaves the reader unable to tell whether
  // 4.8 is a lot, and on a card where NO figure could be anchored that limit is the most important
  // thing the gaps can say. The wording is state-neutral on purpose: it is equally true when no peer
  // group exists, when the history is too thin, and when both were available and no figure sat
  // anywhere notable. A gap that guessed which of the three applied would be wrong a third of the time.
  if (args.anchors.length === 0) {
    gaps.push(
      "Nothing here says whether these figures are large or small for a company of this kind. " +
        "No comparable position could be found for any of them, either against companies that filed the " +
        "same quarter or against this company's own history.",
    );
  }
  if (auditPending) {
    gaps.push("Asset-quality and capital figures for this quarter are pending audit and are not reported yet.");
  }

  return gaps;
}

// ── Entry ───────────────────────────────────────────────────────────────────────────────────────────

/** FamilyQuarter → the four numbers margins.ts needs. It takes a MarginRow, not the whole quarter, so
 *  its build gate can assert on synthetic rows without a database. */
const toMarginRow = (q: AnyFamilyQuarter): MarginRow => ({
  periodKey: q.periodKey,
  operatingMargin: valueOf(q, "operatingMargin"),
  netMargin: valueOf(q, "netMargin"),
  combinedRatio: valueOf(q, "combinedRatio"),
});

/** Build the fact block for ONE (stock, quarter). `periodKey` omitted → the newest quarter on file.
 *  Returns null when the symbol is unknown or the requested quarter is not on file. */
export async function buildQuarterBriefFactBlock(
  symbol: string,
  periodKey?: string,
): Promise<QuarterBriefFactBlock | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, name: true, industryType: true },
  });
  if (!stock) return null;

  const family = stock.industryType as Family;
  const basis = await resolveFamilyBasis(family, stock.id);
  if (!basis) return null;

  const rows = await fetchFamilyQuarters(family, stock.id, basis);
  if (rows.length === 0) return null;

  const idx = periodKey ? rows.findIndex((r) => r.periodKey === periodKey) : rows.length - 1;
  if (idx < 0) return null;

  const current = rows[idx];
  const prevQ = idx > 0 ? rows[idx - 1] : null;
  const yearAgo =
    rows.find((r) => r.quarter === current.quarter && r.fiscalYear === priorFy(current.fiscalYear)) ?? null;

  const identity: BriefIdentity = {
    symbol: stock.symbol,
    name: stock.name,
    family,
    basis: basis as Basis,
    periodKey: current.periodKey,
    quarter: current.quarter,
    fiscalYear: current.fiscalYear,
    reportDate: ymd(current.reportDate),
    filingDate: ymd(current.filingDate),
  };

  // YoY is the primary comparison everywhere — a single quarter against the one before it is
  // seasonality as often as it is performance. QoQ is the fallback only where no year-ago row exists.
  const comparison = yearAgo ?? prevQ;
  const comparisonIsYearAgo = yearAgo !== null;
  const reference = comparisonIsYearAgo ? YOY_REF : QOQ_REF;

  // ★ SECTION 1 — every metric the family files, including the unchanged ones.
  // ⚠ BUILT HERE, ANCHORED BELOW. quarter-section.ts is pure and the peer half of a Stage-1 anchor
  // needs a database read, so the section is assembled first and the anchors are folded into it once
  // the cross-section is in hand. The order is load-bearing: `rendered` is the set of metrics that
  // actually produced a LINE, and a suppressed or unreported metric must never be anchored.
  const quarterBase = buildQuarterSection(current, comparison, comparisonIsYearAgo);

  // ★ SECTION 2 — THE ANNUAL SECTION. Q4 ONLY, and presence-gated within that.
  //
  // ⚠ THE GATE IS `current.quarter === "Q4"` AND NOTHING ELSE. Not "the newest quarter", not "an
  // annual row exists". On Q1 an annual row DOES exist — last year's — and reading it here is exactly
  // the hazard the original ban existed for: a balance sheet up to twelve months older than the
  // quarter beside it, under one heading. The whole justification for lifting the ban is that on Q4
  // the two periods END ON THE SAME DAY, which is only true on Q4.
  const isQ4 = current.quarter === "Q4";
  const fullYear = isQ4 ? await buildAnnualFor(family, stock.id, current, basis as Basis) : null;
  const annual = fullYear?.section ?? null;
  // ★ THE FULL YEAR'S NAMED RULES, AND THE GATE IS THE SECTION — not the row, and not `isQ4`.
  // ⚠ A ROW CAN EXIST AND THE SECTION STILL BE ABSENT: annual-section.ts's fourth gate drops a year
  // that carries no balance-sheet line at all, on 13.7% of paired rows. Firing a full-year contrast
  // there would put a twelve-month fact in the takeaway of a card that shows no full-year section for
  // the reader to check it against — the suppressed-metric failure, one level up.
  const annualContrasts: AnnualContrastFact[] =
    annual && fullYear ? computeAnnualContrasts(fullYear.current, fullYear.prior) : [];

  const topLineLabel = metricGloss(TOP_LINE_KEY[family]).label;
  const revenue = buildLine(topLineLabel, "topLine", current, prevQ, yearAgo, (r) => valueOf(r, TOP_LINE_KEY[family]));
  const profit = buildLine("Net profit", "netProfit", current, prevQ, yearAgo, (r) => valueOf(r, "netProfit"));
  const headline: HeadlineSection = {
    revenue,
    profit,
    disagreements: [disagreement(revenue), disagreement(profit)].filter((d): d is DisagreementFact => d !== null),
  };

  const window = rows.slice(Math.max(0, idx - (MARGIN_WINDOW - 1)), idx + 1).map(toMarginRow);

  const [profitSource, healthMovement, peerContext] = await Promise.all([
    buildProfitSource(stock.id, current.periodKey, current),
    buildHealthMovement(stock.id, current.periodKey),
    computePeerContext(stock.id, current, yearAgo),
  ]);
  const peers = peerContext.fact;

  // ★ STAGE 1 — THE ANCHORS. One cross-section, two consumers: `peers` counts it into sentences, this
  // reads the same arrays to say where each figure sits. Folded into the section's own movement lines
  // so every renderer, the fact text and the grounding haystack pick them up unchanged.
  const anchors: Anchor[] = computeAnchors({
    family,
    rows,
    idx,
    comparison,
    comparisonIsYearAgo,
    crossSection: peerContext.crossSection,
    rendered: new Set<MetricKey>(quarterBase.lines.map((l) => l.key)),
  });
  const quarter: QuarterSection = { ...quarterBase, lines: withAnchors(quarterBase.lines, anchors) };

  const margins = buildMargins(family, window);
  const driver = computeDriver(current, comparison, reference);
  const contrasts: ContrastFact[] = computeContrasts(current, comparison, reference);

  const verdict = computeVerdict({
    family,
    toplineDirection: directionFromChange(revenue.yoy ?? revenue.qoq),
    profitDirection: directionFromChange(profit.yoy ?? profit.qoq),
    marginDirection: verdictMarginDirection(family, margins),
    profitSourceFired: profitSource !== null,
    // ★ `comparison`, the SAME row every sentence on the card is measured against — not `prevQ`.
    //   The badge and the prose share one clock. verdict.ts's SHARED BASE note carries the argument.
    gnpaRising: gnpaRisingOf(family, current, comparison),
    profitBothLoss: (profit.yoy ?? profit.qoq)?.kind === "both_loss",
  });

  return {
    identity,
    verdict,
    quarter,
    annual,
    headline,
    driver,
    contrasts,
    annualContrasts,
    peers,
    profitSource,
    margins,
    healthMovement,
    headlineHealthDivergence: headlineHealthDivergence(profit, healthMovement),
    gaps: buildGaps({
      family, quarter, annual, isQ4, margins, auditPending: current.auditPending, prevQ, yearAgo,
      health: healthMovement, profitSource, driver, peers, anchors, quartersOnFile: idx + 1,
      driverGap: driverAbsence(current, comparison),
      profitNotFromTrading: contrasts.some((c) => c.rule === "profit_not_from_trading"),
    }),
  };
}

/** The annual section for one Q4, or null. Two reads: this year and the one before it, both on the
 *  basis the quarter already resolved. The prior year is what every `movement` is measured against;
 *  its absence is a gap, not an error.
 *
 *  ★ THE TWO RAW ROWS TRAVEL BACK WITH THE SECTION, and they are the ONLY thing in this file that
 *  reaches annual-contrasts.ts. That module takes two `AnyFamilyAnnual` values and nothing else — no
 *  quarter, no section, no block — which is what makes it structurally unable to join a twelve-month
 *  figure to a three-month one. See its header. */
async function buildAnnualFor(
  family: Family,
  stockId: string,
  current: AnyFamilyQuarter,
  basis: Basis,
): Promise<{ section: AnnualSection; current: AnyFamilyAnnual; prior: AnyFamilyAnnual | null } | null> {
  const thisYear = await fetchFamilyAnnual(family, stockId, current.fiscalYear, basis);
  if (!thisYear) return null; // ← THE PRESENCE GATE. Absent annual, absent section.

  const priorFy = priorFiscalYear(current.fiscalYear);
  const lastYear = priorFy ? await fetchFamilyAnnual(family, stockId, priorFy, basis) : null;

  const section = buildAnnualSection(thisYear, lastYear, current.reportDate);
  return section ? { section, current: thisYear, prior: lastYear } : null;
}

/** "FY26" → "FY25". Returns a non-matching sentinel on an unexpected shape rather than guessing. */
function priorFy(fy: string): string {
  const m = /^FY(\d{2,4})$/.exec(fy);
  if (!m) return " ";
  const n = parseInt(m[1], 10) - 1;
  return `FY${String(n).padStart(m[1].length, "0")}`;
}
