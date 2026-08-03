// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE FACT BLOCK (builder).
//
// Assembles everything the model is allowed to say about ONE (stock, quarter), as computed facts with
// pre-rendered display strings. The model calculates nothing.
//
// ── FOUR RULES THIS FILE ENFORCES STRUCTURALLY ──────────────────────────────────────────────────────
//
// 1 · NO BALANCE SHEET. Every family's QUARTERLY table is P&L only — debt, equity and cash conversion
//     exist on the ANNUAL tables alone, and the newest annual can be up to twelve months older than
//     the quarter being described. A debt figure printed beside a quarterly headline is two clocks on
//     one card. There is no balance-sheet section and no annual read in this file at all.
//
// 2 · GROWTH IS COMPUTED FROM THE TWO RAW VALUES, never read from the stored *Yoy/*Qoq columns. Those
//     columns are ~100% populated at the latest period but were not backfilled onto historical rows
//     (banking's nii_yoy: 100% latest, 17.5% across all rows), so they are unreliable for an older
//     quarter. Computing from the pair we already fetched also GUARANTEES the percentage agrees with
//     the two absolutes printed beside it — a stored value that disagreed would put a contradiction
//     in front of the reader.
//
// 3 · A PERCENTAGE IS NEVER COMPUTED OFF A ZERO OR NEGATIVE BASE. `changeFact` switches on the sign
//     of both sides and renders a turnaround in words ("from a loss of ₹12 crore to a profit of
//     ₹8 crore"). "Profit up 340%" off a prior-year loss is arithmetically defensible and completely
//     meaningless to the reader this feature is for.
//
// 4 · THE HEALTH SECTION IS PRESENCE-GATED. It appears when a ScoreSnapshot exists for this stock AND
//     this period — never a family check, never a hardcoded list. 95 of 504 stocks are scored today;
//     score one more and its next brief carries the section with no code change here.
//
// ── ⚠ AND ONE THAT IS EASY TO UNDO BY ACCIDENT ──────────────────────────────────────────────────────
// The PROFIT SOURCE section reads GuardrailEvent for PRESENCE ONLY. `triggeringValues` is never
// carried into the block. The guardrail catalogue is enforced digit-free (verify-catalogue.ts §7)
// because naming a detector's bar hands a company the shape to structure under; the observed values
// leak the same bar by triangulation. So the characterisation is the catalogue's own reader-facing
// copy, and every NUMBER shown comes from a raw filed line (other income, pre-tax profit, operating
// profit) that the reader could check against the statement themselves.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { LABEL_BAND_MAP } from "../../scoring/composite/label.js";
import { money, fractionToPct } from "./format.js";
import { buildMargins, MARGIN_WINDOW } from "./margins.js";
import { computeVerdict, directionOf, GNPA_MATERIAL_PP, type LineDirection } from "./verdict.js";
import { guardrailSignature } from "../../catalogue/guardrail-signatures.js";
import { findingName } from "../../catalogue/stock-findings.js";
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

// ── Formatting (1c: for a reader who cannot read a financial statement) ─────────────────────────────

/** Movement below half a point is noise at whole-number precision; saying "up 0%" is worse than
 *  saying it barely moved. */
const MOVEMENT_FLOOR_PCT = 0.5;
const MARGIN_FLOOR_PP = 0.5;

/** A health score that moved less than a point has not "diverged" from anything. Points on the
 *  0–100 composite, not percent. */
const HEALTH_DIVERGENCE_FLOOR_POINTS = 1.0;

/** A SIGN FLIP IS ONLY WORTH HEADLINING WHEN BOTH SIDES ARE MATERIAL. Deliberately far above
 *  MOVEMENT_FLOOR_PCT: HDFCBANK's net profit was −0.8% sequentially and +5.0% on the year, and
 *  calling that "the two comparisons point opposite ways" would dress an essentially flat quarter
 *  up as a contradiction. The disagreement that matters is the seasonal one — down 8% on the
 *  quarter, up 14% on the year. */
const DISAGREEMENT_FLOOR_PCT = 3;

/** Band LABEL for a STORED band value. The band itself always comes from the snapshot, never from
 *  re-deriving it off the composite — a snapshot is pinned to the band mapping in force when it was
 *  written, so recomputing under today's mapping would silently relabel history. */
const bandLabel = (band: string): string => LABEL_BAND_MAP.find((b) => b.band === band)?.label ?? band;

const toNum = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

const PILLAR_LABEL = {
  foundation: "Foundation",
  momentum: "Momentum",
  market: "Market",
  ownership: "Ownership",
} as const;

// ── Per-family shape ────────────────────────────────────────────────────────────────────────────────
// The top line differs per family and MUST match what the Results feed already prints beside it
// (results-feed.cache.ts) — a brief that calls a bank's NII "revenue" contradicts the card it sits on.

/** One quarter, normalised across the five family tables.
 *  Exported so the margin contract can be asserted on SYNTHETIC rows — a build gate must not need a
 *  database, and a gate that reads production is not deterministic anyway. */
export interface QRow {
  periodKey: string;
  quarter: string;
  fiscalYear: string;
  resultType: string;
  reportDate: Date;
  filingDate: Date;
  topLine: number | null;
  netProfit: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  combinedRatio: number | null;
  otherIncome: number | null;
  profitBeforeTax: number | null;
  operatingProfit: number | null;
  /** Banking only, stored as a FRACTION (0.0134 = 1.34%). Converted at the comparison site. */
  gnpaPct: number | null;
  auditPending: boolean;
}

const TOP_LINE_LABEL: Record<Family, string> = {
  non_financial: "Revenue",
  banking: "Net interest income",
  nbfc: "Revenue",
  life_insurance: "Net premium",
  general_insurance: "Gross premium",
};

const PREFERRED_BASIS: Record<Family, Basis> = {
  non_financial: "consolidated",
  banking: "standalone",
  nbfc: "consolidated",
  life_insurance: "standalone",
  general_insurance: "standalone",
};

const base = (r: {
  quarter: string;
  fiscalYear: string;
  resultType: string;
  reportDate: Date;
  filingDate: Date;
}) => ({
  periodKey: `${r.fiscalYear}${r.quarter}`,
  quarter: r.quarter,
  fiscalYear: r.fiscalYear,
  resultType: r.resultType,
  reportDate: r.reportDate,
  filingDate: r.filingDate,
});

const EMPTY = {
  operatingMargin: null,
  combinedRatio: null,
  operatingProfit: null,
  gnpaPct: null,
  auditPending: false,
} as const;

/** Explicit per-family fetch + normalise, mirroring the dispatch in fundamentals-view.service.ts.
 *  Oldest → newest. */
async function fetchQuarters(family: Family, stockId: string, basis: Basis): Promise<QRow[]> {
  const where = { stockId, resultType: basis };
  const orderBy = { reportDate: "asc" } as const;

  if (family === "non_financial") {
    const rows = await prisma.quarterlyResult.findMany({ where, orderBy });
    return rows.map((r) => ({
      ...base(r),
      ...EMPTY,
      topLine: toNum(r.revenue),
      netProfit: toNum(r.netProfit),
      operatingMargin: toNum(r.operatingMargin),
      netMargin: toNum(r.netMargin),
      otherIncome: toNum(r.otherIncome),
      profitBeforeTax: toNum(r.profitBeforeTax),
      operatingProfit: toNum(r.operatingProfit),
    }));
  }

  if (family === "banking") {
    const rows = await prisma.bankingQuarterlyResult.findMany({ where, orderBy });
    return rows.map((r) => ({
      ...base(r),
      ...EMPTY,
      topLine: toNum(r.nii),
      netProfit: toNum(r.netProfit),
      netMargin: toNum(r.netMargin),
      otherIncome: toNum(r.otherIncome),
      profitBeforeTax: toNum(r.profitBeforeTax),
      gnpaPct: toNum(r.gnpaPct),
      auditPending: r.auditPending,
    }));
  }

  if (family === "nbfc") {
    const rows = await prisma.nbfcQuarterlyResult.findMany({ where, orderBy });
    return rows.map((r) => ({
      ...base(r),
      ...EMPTY,
      topLine: toNum(r.revenue),
      netProfit: toNum(r.netProfit),
      netMargin: toNum(r.netMargin),
      otherIncome: toNum(r.otherIncome),
      profitBeforeTax: toNum(r.profitBeforeTax),
    }));
  }

  if (family === "life_insurance") {
    const rows = await prisma.lifeInsuranceQuarterlyResult.findMany({ where, orderBy });
    return rows.map((r) => ({
      ...base(r),
      ...EMPTY,
      topLine: toNum(r.netPremiumIncome),
      netProfit: toNum(r.netProfit),
      netMargin: toNum(r.netMargin),
      otherIncome: null, // life quarterlies carry investment income, not an "other income" line
      profitBeforeTax: toNum(r.profitBeforeTax),
    }));
  }

  const rows = await prisma.generalInsuranceQuarterlyResult.findMany({ where, orderBy });
  return rows.map((r) => ({
    ...base(r),
    ...EMPTY,
    topLine: toNum(r.grossPremiumsWritten),
    netProfit: toNum(r.netProfit),
    netMargin: toNum(r.netMargin),
    combinedRatio: toNum(r.combinedRatio),
    otherIncome: toNum(r.otherIncome),
    profitBeforeTax: toNum(r.profitBeforeTax),
  }));
}

async function resolveBasis(family: Family, stockId: string): Promise<Basis | null> {
  const preferred = PREFERRED_BASIS[family];
  const rows = await fetchQuarters(family, stockId, preferred);
  if (rows.length > 0) return preferred;
  const other: Basis = preferred === "consolidated" ? "standalone" : "consolidated";
  const alt = await fetchQuarters(family, stockId, other);
  return alt.length > 0 ? other : null;
}

// ── Change arithmetic (rule 3) ──────────────────────────────────────────────────────────────────────

function changeFact(
  key: string,
  current: number | null,
  prior: number | null,
  reference: string,
  // The line's own name. NOT interpolated into the turnaround phrasings: the caller already prefixes
  // them with the line ("Net profit " + "moved from a loss of…"), so including it again produced
  // "Net profit moved from a net profit loss of ₹5,286 crore" on IDEA.
  _noun: string,
): ChangeFact | null {
  if (current === null || prior === null) return null;

  // Both sides healthy — a percentage is meaningful.
  if (prior > 0 && current > 0) {
    const pct = ((current - prior) / prior) * 100;
    if (Math.abs(pct) < MOVEMENT_FLOOR_PCT) {
      return { key, kind: "percent", value: pct, reference, display: `little changed ${reference}` };
    }
    const dir = pct > 0 ? "up" : "down";
    return {
      key,
      kind: "percent",
      value: pct,
      reference,
      display: `${dir} ${Math.round(Math.abs(pct))}% ${reference}`,
    };
  }

  if (prior <= 0 && current > 0) {
    return {
      key,
      kind: "turnaround",
      value: null,
      reference,
      display: `moved from a loss of ${money(prior)} to a profit of ${money(current)} ${reference}`,
    };
  }

  if (prior > 0 && current <= 0) {
    return {
      key,
      kind: "to_loss",
      value: null,
      reference,
      display: `moved from a profit of ${money(prior)} to a loss of ${money(current)} ${reference}`,
    };
  }

  return {
    key,
    kind: "both_loss",
    value: null,
    reference,
    display: `a loss of ${money(current)}, against a loss of ${money(prior)} ${reference}`,
  };
}

const QOQ_REF = "against the previous quarter";
const YOY_REF = "against the same quarter last year";

function amountFact(key: string, label: string, cr: number | null): Fact | null {
  if (cr === null) return null;
  const display = cr < 0 ? `a loss of ${money(cr)}` : money(cr);
  return { key, label, value: cr, display };
}

function buildLine(
  lineLabel: string,
  keyPrefix: string,
  current: QRow,
  prevQ: QRow | null,
  yearAgo: QRow | null,
  pick: (r: QRow) => number | null,
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
    display:
      `${line.line} ${qoq.display} but ${yoy.display}. The two comparisons point opposite ways, ` +
      `so the ${l} trend depends on which one is read.`,
  };
}

// ── Profit source (presence from GuardrailEvent; numbers from raw filed lines) ───────────────────────

async function buildProfitSource(stockId: string, periodKey: string, current: QRow): Promise<ProfitSourceSection | null> {
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
    push(amountFact("profitSource.otherIncome", "Other income, this quarter", current.otherIncome));
    push(amountFact("profitSource.profitBeforeTax", "Pre-tax profit, this quarter", current.profitBeforeTax));
  } else {
    push(amountFact("profitSource.operatingProfit", "Operating profit, this quarter", current.operatingProfit));
    push(amountFact("profitSource.netProfit", "Net profit, this quarter", current.netProfit));
  }

  return {
    signatureKey: event.signatureKey,
    name: entry.name,
    description: entry.description,
    doesntMean: entry.doesntMean,
    supporting,
  };
}

// ── Health movement (presence-gated — rule 4) ────────────────────────────────────────────────────────

async function buildHealthMovement(stockId: string, periodKey: string): Promise<HealthMovementSection | null> {
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { stockId, snapshotType: "quarterly" },
    orderBy: [{ asOfDate: "asc" }, { version: "asc" }],
    select: {
      id: true,
      periodKey: true,
      version: true,
      asOfDate: true,
      composite: true,
      labelBand: true,
      foundationSubtotal: true,
      momentumSubtotal: true,
      marketSubtotal: true,
      ownershipSubtotal: true,
    },
  });
  if (snaps.length === 0) return null;

  // Newest version wins per period (the supersede chain), preserving period order.
  const byPeriod = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) byPeriod.set(s.periodKey, s); // ordered asc by version → last write wins
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
    const display =
      delta === null
        ? `${label} scored ${current.toFixed(1)} — no prior quarter to compare.`
        : Math.abs(delta) < 0.05
          ? `${label} held at ${current.toFixed(1)}.`
          : `${label} moved ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} to ${current.toFixed(1)}.`;
    return { pillar, label, current, prior: priorVal, delta, display };
  });

  const priorComposite = prior ? Number(prior.composite) : null;
  const compositeChange: ScoreChange | null =
    priorComposite === null
      ? null
      : {
          key: "health.compositeChange",
          delta: curComposite - priorComposite,
          priorPeriodKey: periods[idx - 1],
          display:
            Math.abs(curComposite - priorComposite) < 0.05
              ? `The health score held at ${curComposite.toFixed(1)}.`
              : `The health score moved ${curComposite > priorComposite ? "up" : "down"} ` +
                `${Math.abs(curComposite - priorComposite).toFixed(1)} points to ${curComposite.toFixed(1)}, from ${periods[idx - 1]}.`,
        };

  const priorBand = prior ? { band: prior.labelBand as string, label: bandLabel(prior.labelBand as string) } : null;
  const bandChange =
    priorBand && priorBand.band !== curBand.band
      ? {
          from: priorBand.band,
          fromLabel: priorBand.label,
          to: curBand.band,
          toLabel: curBand.label,
          display: `The health band changed from ${priorBand.label} to ${curBand.label}.`,
        }
      : null;

  // Findings are re-derived on every snapshot with no active/resolved flag, so the honest diff is a
  // set difference of flagKeys between the two snapshots.
  const [curFlags, priorFlags] = await Promise.all([
    prisma.redFlag.findMany({ where: { snapshotId: cur.id }, select: { flagKey: true } }),
    prior
      ? prisma.redFlag.findMany({ where: { snapshotId: prior.id }, select: { flagKey: true } })
      : Promise.resolve([] as { flagKey: string }[]),
  ]);
  const curSet = new Set(curFlags.map((f) => f.flagKey));
  const priorSet = new Set(priorFlags.map((f) => f.flagKey));

  const asChange = (flagKey: string, verb: string): FindingChange => {
    const name = findingName(flagKey) || flagKey;
    return { flagKey, name, display: `${name} — ${verb} this quarter.` };
  };

  const findingsFired = [...curSet].filter((k) => !priorSet.has(k)).map((k) => asChange(k, "started flagging"));
  const findingsCleared = prior
    ? [...priorSet].filter((k) => !curSet.has(k)).map((k) => asChange(k, "no longer flagging"))
    : [];

  return {
    periodKey,
    scoredAsOf: ymd(cur.asOfDate),
    composite: {
      key: "health.composite",
      label: "Health score",
      value: curComposite,
      display: curComposite.toFixed(1),
    },
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
 *  that widened are both still a loss, and neither "grew" nor "fell back" describes them honestly. */
function directionFromChange(c: ChangeFact | null): LineDirection | null {
  if (!c) return null;
  if (c.kind === "turnaround") return "up";
  if (c.kind === "to_loss") return "down";
  if (c.kind === "both_loss") return null;
  return directionOf(c.value);
}

/** The margin whose direction qualifies the verdict, per family.
 *  Non-financials use OPERATING margin, not net: operating margin excludes other income by
 *  construction, so it answers "did the trading business keep more or less" without being moved by
 *  the very one-off income that B-4 exists to flag. Everyone else uses net margin (the only margin
 *  their quarterly table carries). General insurance's combined ratio is deliberately NOT used here —
 *  it is inverted (lower is better), and mixing an inverted axis into a shared rule is how a
 *  "margins wider" badge ends up on an insurer whose book got worse. */
function verdictMarginDirection(family: Family, margins: MarginsSection | null): MarginSeries["direction"] | null {
  if (!margins) return null;
  const wanted = family === "non_financial" ? "Operating margin" : "Net margin";
  return margins.series.find((s) => s.label === wanted)?.direction ?? null;
}

/** Banking only. null (not false) when either quarter's figure is absent — an unknown loan book must
 *  never read as a clean one. */
function gnpaRisingOf(family: Family, current: QRow, prevQ: QRow | null): boolean | null {
  if (family !== "banking") return null;
  if (current.gnpaPct === null || !prevQ || prevQ.gnpaPct === null) return null;
  return fractionToPct(current.gnpaPct) - fractionToPct(prevQ.gnpaPct) >= GNPA_MATERIAL_PP;
}

// ── Headline vs health (the contrast a reader would otherwise miss) ─────────────────────────────────

/** Profit and the health score pointing opposite ways. HDFC Bank's FY27Q1 is the case this exists for:
 *  net profit up 5% on the year, health band down Healthy → Steady, driven almost entirely by Market
 *  (−12.9). "Profit up 5%" alone is true and misleading. Both sides must be MATERIAL — a 3% profit
 *  move against a sub-point score drift is not a contradiction, it is noise on both axes. */
function headlineHealthDivergence(
  profit: LineComparison,
  health: HealthMovementSection | null,
): { key: string; display: string } | null {
  if (!health?.compositeChange) return null;

  const growth = profit.yoy ?? profit.qoq;
  if (!growth || growth.kind !== "percent" || growth.value === null) return null;

  const scoreDelta = health.compositeChange.delta;
  if (Math.abs(growth.value) < DISAGREEMENT_FLOOR_PCT) return null;
  if (Math.abs(scoreDelta) < HEALTH_DIVERGENCE_FLOOR_POINTS) return null;
  if (Math.sign(growth.value) === Math.sign(scoreDelta)) return null;

  const profitWord = growth.value > 0 ? "higher" : "lower";
  const scoreWord = scoreDelta > 0 ? "rose" : "fell";
  const movers = [...health.pillars]
    .filter((p) => p.delta !== null && Math.sign(p.delta) === Math.sign(scoreDelta) && Math.abs(p.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
  const because =
    movers.length > 0
      ? ` The move came mostly from ${movers[0].label.toLowerCase()}.`
      : "";

  return {
    key: "divergence.headlineVsHealth",
    display:
      `Net profit was ${profitWord} (${growth.display}), but the Vytal health score ${scoreWord} ` +
      `${Math.abs(scoreDelta).toFixed(1)} points over the same period.${because} ` +
      `The quarter's figures and the longer-run score are not saying the same thing.`,
  };
}

// ── Gaps (always populated — a quarterly P&L read always has a blind side) ──────────────────────────

function buildGaps(
  family: Family,
  margins: MarginsSection | null,
  current: QRow,
  prevQ: QRow | null,
  yearAgo: QRow | null,
  health: HealthMovementSection | null,
  profitSource: ProfitSourceSection | null,
  quartersOnFile: number,
): string[] {
  const gaps: string[] = [];

  gaps.push(
    "These are quarterly profit-and-loss figures only. Debt, cash and the balance sheet are reported " +
      "once a year, so nothing here describes what the company owns or owes.",
  );

  if (!yearAgo) {
    gaps.push(
      "The same quarter last year is not on file, so the comparison against a year ago cannot be made — " +
        "and a quarter-on-quarter move alone can be ordinary seasonality.",
    );
  }
  if (!prevQ) gaps.push("The previous quarter is not on file, so there is no sequential comparison.");
  // Only meaningful when a margin is actually shown — "margin direction is thinly based" beside a
  // suppressed margin tells the reader about a line that is not on the page.
  if (quartersOnFile < 4 && (margins?.series.length ?? 0) > 0) {
    gaps.push(`Only ${quartersOnFile} ${quartersOnFile === 1 ? "quarter" : "quarters"} of history is on file, so margin direction is thinly based.`);
  }
  // A suppressed margin is STATED, never silently missing — the reader is told there is no margin and
  // why, rather than left to wonder where the section went.
  // Suppressions sharing a reason collapse into ONE sentence. Two near-identical lines ("No operating
  // margin is shown — <reason>. No net margin is shown — <same reason>.") reads as a stutter.
  const byReason = new Map<string, string[]>();
  for (const sup of margins?.suppressed ?? []) {
    (byReason.get(sup.reason) ?? byReason.set(sup.reason, []).get(sup.reason)!).push(sup.label.toLowerCase());
  }
  for (const [reason, labels] of byReason) {
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
    gaps.push(`No ${list} is shown — ${reason}.`);
  }
  if (!health) {
    gaps.push("This stock does not carry a Vytal health score for this quarter, so no score movement is reported.");
  }
  if (family !== "non_financial" && !profitSource) {
    gaps.push(
      "The checks that separate operating profit from one-off gains run on non-financial companies only, " +
        "so no such check was applied here.",
    );
  }
  if (current.auditPending) {
    gaps.push("Asset-quality and capital figures for this quarter are pending audit and are not reported yet.");
  }

  return gaps;
}

// ── Entry ───────────────────────────────────────────────────────────────────────────────────────────

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
  const basis = await resolveBasis(family, stock.id);
  if (!basis) return null;

  const rows = await fetchQuarters(family, stock.id, basis);
  if (rows.length === 0) return null;

  const idx = periodKey ? rows.findIndex((r) => r.periodKey === periodKey) : rows.length - 1;
  if (idx < 0) return null;

  const current = rows[idx];
  const prevQ = idx > 0 ? rows[idx - 1] : null;
  const yearAgo =
    rows.find(
      (r) => r.quarter === current.quarter && r.fiscalYear === priorFy(current.fiscalYear),
    ) ?? null;

  const identity: BriefIdentity = {
    symbol: stock.symbol,
    name: stock.name,
    family,
    basis,
    periodKey: current.periodKey,
    quarter: current.quarter,
    fiscalYear: current.fiscalYear,
    reportDate: ymd(current.reportDate),
    filingDate: ymd(current.filingDate),
  };

  const revenue = buildLine(TOP_LINE_LABEL[family], "topLine", current, prevQ, yearAgo, (r) => r.topLine);
  const profit = buildLine("Net profit", "netProfit", current, prevQ, yearAgo, (r) => r.netProfit);
  const headline: HeadlineSection = {
    revenue,
    profit,
    disagreements: [disagreement(revenue), disagreement(profit)].filter((d): d is DisagreementFact => d !== null),
  };

  const window = rows.slice(Math.max(0, idx - (MARGIN_WINDOW - 1)), idx + 1);

  const [profitSource, healthMovement] = await Promise.all([
    buildProfitSource(stock.id, current.periodKey, current),
    buildHealthMovement(stock.id, current.periodKey),
  ]);

  const margins = buildMargins(family, window);

  // YoY is the primary comparison — a single quarter against the previous one is seasonality as often
  // as it is performance. QoQ is the fallback only where no year-ago quarter is on file.
  const verdict = computeVerdict({
    family,
    toplineDirection: directionFromChange(revenue.yoy ?? revenue.qoq),
    profitDirection: directionFromChange(profit.yoy ?? profit.qoq),
    marginDirection: verdictMarginDirection(family, margins),
    profitSourceFired: profitSource !== null,
    gnpaRising: gnpaRisingOf(family, current, prevQ),
    profitBothLoss: (profit.yoy ?? profit.qoq)?.kind === "both_loss",
  });

  return {
    identity,
    verdict,
    headline,
    profitSource,
    margins,
    healthMovement,
    headlineHealthDivergence: headlineHealthDivergence(profit, healthMovement),
    gaps: buildGaps(family, margins, current, prevQ, yearAgo, healthMovement, profitSource, idx + 1),
  };
}

/** "FY26" → "FY25". Returns a non-matching sentinel on an unexpected shape rather than guessing. */
function priorFy(fy: string): string {
  const m = /^FY(\d{2,4})$/.exec(fy);
  if (!m) return " ";
  const n = parseInt(m[1], 10) - 1;
  return `FY${String(n).padStart(m[1].length, "0")}`;
}
