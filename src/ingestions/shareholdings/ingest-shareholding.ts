// ─────────────────────────────────────────────────────────────
// Shareholding pattern ingestion pipeline.
//
// Full flow per stock:
//  1. Hit NSE API → get list of XBRL URLs + metadata
//  2. Filter to last N quarters (or all for backfill)
//  3. For each quarter: fetch XBRL XML → parse → upsert
//  4. Log result
//
// Quarterly job processes ALL active stocks.
// Smart trigger: only fetches stocks due for an update
// (earnings event passed 7–21 days ago without a new filing).
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { scoreRelevantSelect } from "../../scoring/inputs/score-input-columns.js";
import { diffScoreRelevant } from "../../scoring/inputs/score-relevant-diff.js";
import { Prisma } from "../../generated/prisma/browser.js";
import { dateToQuarterFY, parseAsOnDate } from "./shareholding-dates.js";
import { fetchShareholdingIndex, fetchXbrlXml } from "./shareholding-fetch.js";
import { nseClient } from "../../lib/client.js";
import { parseXbrlShareholding } from "./xbrl-parser.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  SHAREHOLDING_CRON,
  SHAREHOLDING_SOURCE,
  PARTITION_MIN,
  PCT_MIN,
  PCT_MAX,
  CONTINUITY_PROMOTER_PP,
  FII_DII_NULL_MAX,
  BANKS_NULL_MAX,
  checkPartitionBroken,
  classifyCoverage,
  checkZeroFilingRate,
  checkBatchNullRate,
  checkPledgeCollapse,
  checkPctRange,
  checkShareInvariants,
  checkPromoterContinuity,
  shareholdingRunRef,
} from "./shareholding-guards.js";

// The breakdown fields the batch NULL-RATE guard inspects, captured for
// each genuinely-new quarter's row so the run-level guard sees through
// the CSV top-level mask.
interface NewQuarterParsed {
  symbol: string;
  asOnDate: Date;
  fiiPct: number | null;
  diiPct: number | null;
  banksFisPct: number | null;
  promoterPledgedPct: number | null;
}

// ── Types ─────────────────────────────────────────────────────

/**
 * Called after each batch of stocks completes.
 * Return false to abort remaining batches.
 */
export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

export interface IngestShareholdingResult {
  success: boolean;
  symbol: string;
  stockId: string | null;
  quartersProcessed: number;
  /** Upserts that RAN. Unchanged meaning — the name predates the rescore narrowing and is a
   *  misnomer (it counts insert OR update), but run logs have always reported it this way. */
  quartersInserted: number;
  /**
   * Quarters where a column computeOwnership ACTUALLY READS moved.
   *
   * The rescore trigger keys off this, not off quartersInserted. The ingest upserts with
   * `update: recordData` (a blind overwrite) on every pass, so "an upsert ran" says nothing
   * about whether promoter/pledge/FII/DII/retail actually moved. See score-relevant-diff.ts.
   */
  quartersScoreRelevantChanged: number;
  quartersSkipped: number;
  durationMs: number;
  errors: string[];
  /** GUARD 2b: the NSE filing index came back empty (no XBRL filings). */
  zeroFilings: boolean;
  /** GUARD 3: breakdown of the newest genuinely-new quarter (null if none). */
  newQuarter: NewQuarterParsed | null;
}

export interface BulkIngestResult {
  totalStocks: number;
  successStocks: number;
  failedStocks: number;
  totalInserted: number;
  totalSkipped: number;
  durationMs: number;
  errors: Array<{ symbol: string; error: string }>;
  /** Symbols that actually had shareholding rows written this run (quartersInserted > 0)
   *  — fanned out to their PGs by the scoring-trigger layer. */
  changedSymbols: string[];
}

// ── Per-stock ingest ──────────────────────────────────────────

export async function ingestShareholdingForStock(
  symbol: string,
  quartersBack: number = 40,
  signal?: AbortSignal,
): Promise<IngestShareholdingResult> {
  const start = Date.now();
  const errors: string[] = [];
  let quartersInserted = 0;
  let quartersScoreRelevantChanged = 0;
  let quartersSkipped = 0;

  // Find stock in DB
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true },
  });

  if (!stock) {
    return {
      success: false,
      symbol,
      stockId: null,
      quartersProcessed: 0,
      quartersInserted: 0,
      quartersScoreRelevantChanged: 0,
      quartersSkipped: 0,
      durationMs: Date.now() - start,
      errors: [`Stock ${symbol} not found in universe`],
      zeroFilings: false,
      newQuarter: null,
    };
  }

  // Step 1: Get the list of XBRL URLs from NSE
  let filingIndex;
  try {
    filingIndex = await fetchShareholdingIndex(symbol, signal);
  } catch (e) {
    const msg = (e as Error).message;
    await logFetch(
      symbol,
      stock.id,
      "manual",
      0,
      0,
      0,
      "failed",
      msg,
      Date.now() - start,
    );
    return {
      success: false,
      symbol,
      stockId: stock.id,
      quartersProcessed: 0,
      quartersInserted: 0,
      quartersScoreRelevantChanged: 0,
      quartersSkipped: 0,
      durationMs: Date.now() - start,
      errors: [msg],
      zeroFilings: false,
      newQuarter: null,
    };
  }

  if (filingIndex.length === 0) {
    return {
      success: true,
      symbol,
      stockId: stock.id,
      quartersProcessed: 0,
      quartersInserted: 0,
      quartersScoreRelevantChanged: 0,
      quartersSkipped: 0,
      durationMs: Date.now() - start,
      errors: ["No XBRL filings found for this stock"],
      zeroFilings: true, // GUARD 2b: empty index — a silent index-API break if widespread
      newQuarter: null,
    };
  }

  // Step 2: Filter to the most recent N quarters
  // Sort descending by date, take first N
  const sorted = filingIndex
    .filter((row) => row.asOnDate && row.xbrlUrl)
    .map((row) => ({
      ...row,
      parsedDate: parseAsOnDate(row.asOnDate),
    }))
    .filter((row) => row.parsedDate !== null)
    .sort((a, b) => b.parsedDate!.getTime() - a.parsedDate!.getTime())
    .slice(0, quartersBack);

  console.log(`[Shareholding] ${symbol}: ${sorted.length} quarters to process`);

  // For the per-record guards: the stock's latest existing row at run
  // start. Per-record FLAG guards (range/continuity) fire ONLY on quarters
  // strictly newer than this — so re-upserting old quarters every run never
  // re-flags known history (the shareholding analog of the prices Guard-3
  // fix). The SHAPE reject runs on EVERY upsert (it protects existing rows
  // from being overwritten by a broken-parse zero). For a brand-new stock
  // (no prior row) only the single newest filing is guarded.
  const priorRow = await prisma.shareholdingPattern.findFirst({
    where: { stockId: stock.id },
    orderBy: { asOnDate: "desc" },
    select: { asOnDate: true, promoterPct: true },
  });
  const priorAsOnDate = priorRow?.asOnDate ?? null;
  const priorPromoterPct = priorRow
    ? parseFloat(priorRow.promoterPct.toString())
    : null;
  const newestAsOnDate = sorted[0].parsedDate!;
  let newQuarter: NewQuarterParsed | null = null;

  // Step 3: For each quarter, check if we already have it, if not fetch+parse
  for (const filing of sorted) {
    const asOnDate = filing.parsedDate!;
    const { quarter, fiscalYear } = dateToQuarterFY(asOnDate);

    // Fetch the XBRL XML
    let xmlText: string;
    try {
      xmlText = await fetchXbrlXml(filing.xbrlUrl, signal);
      console.log(`[Shareholding] ${symbol} ${quarter} ${fiscalYear}: fetched XBRL`);
    } catch (e) {
      const msg = `Failed to fetch XBRL for ${filing.asOnDate}: ${(e as Error).message}`;
      errors.push(msg);
      console.warn(`[Shareholding] ${symbol}: ${msg}`);
      // Rate limiting pause
      await sleep(1000);
      continue;
    }

    // Parse the XML
    let parsed;
    try {
      parsed = parseXbrlShareholding(xmlText);
    } catch (e) {
      const msg = `Failed to parse XBRL for ${filing.asOnDate}: ${(e as Error).message}`;
      errors.push(msg);
      console.warn(`[Shareholding] ${symbol}: ${msg}`);
      continue;
    }

    // Use CSV top-level values as fallback/validation for promoter/public %
    // (more reliable than XBRL for top-level percentages)
    const csvPromoterPct = parseFloat(filing.promoter);
    const csvPublicPct = parseFloat(filing.public);

    const promoterPct =
      !isNaN(csvPromoterPct) && csvPromoterPct > 0
        ? csvPromoterPct
        : parsed.promoterPct;

    const publicPct =
      !isNaN(csvPublicPct) && csvPublicPct > 0
        ? csvPublicPct
        : parsed.publicPct;

    const dec = (v: number | null) =>
      v != null ? new Prisma.Decimal(v) : null;

    const entity = `${symbol}@${asOnDate.toISOString().slice(0, 10)}`;
    const runRef = shareholdingRunRef(asOnDate);

    // ── GUARD 1: SHAPE / partition (critical · source_code · REJECT) ──
    // Runs on EVERY upsert (new + re-upsert): a broken parse here would
    // OVERWRITE an existing good row with zeros. promoter+public+empTrust
    // partitions the register (~100); <50 ⇒ total context break (≈0) or a
    // fraction-scale break (≈1). Reject = skip the upsert, keep prior data.
    if (checkPartitionBroken(promoterPct, publicPct, parsed.employeeTrustPct)) {
      await reportIngestionError({
        source: SHAREHOLDING_SOURCE,
        cron: SHAREHOLDING_CRON,
        guardType: "shape",
        targetTable: "ShareholdingPattern",
        targetEntity: entity,
        severity: "critical",
        resolutionPath: "source_code",
        expected: `promoter+public+empTrust ≥ ${PARTITION_MIN} (≈100)`,
        observed: `sum=${(promoterPct + publicPct + parsed.employeeTrustPct).toFixed(2)} (promoter=${promoterPct}, public=${publicPct})`,
        detail:
          "Partition collapsed — XBRL context resolution likely broke (new SEBI taxonomy vintage) and the CSV top-level fallback was also empty. Rejecting the upsert to preserve any existing row.",
        runRef,
      });
      console.warn(
        `[Shareholding] ${symbol} ${quarter} ${fiscalYear}: REJECTED (partition sum < ${PARTITION_MIN})`,
      );
      quartersSkipped++;
      await sleep(800);
      continue;
    }

    // Per-record FLAG guards run ONLY on quarters newer than what we had,
    // so re-upserting history never re-flags it.
    const isNewQuarter = priorAsOnDate
      ? asOnDate.getTime() > priorAsOnDate.getTime()
      : asOnDate.getTime() === newestAsOnDate.getTime();

    if (isNewQuarter) {
      // ── GUARD 4: RANGE / validity (medium · per-record) ──
      const pctFields: Array<[string, number | null]> = [
        ["promoterPct", promoterPct],
        ["publicPct", publicPct],
        ["fiiPct", parsed.fiiPct],
        ["diiPct", parsed.diiPct],
        ["retailPct", parsed.retailPct],
        ["othersPct", parsed.othersPct],
        ["promoterPledgedPct", parsed.promoterPledgedPct],
        ["promoterPledgedSharesPct", parsed.promoterPledgedSharesPct],
      ];
      const pctOob = pctFields
        .filter(([, v]) => checkPctRange(v))
        .map(([k, v]) => `${k}=${v}`);
      if (pctOob.length > 0) {
        await reportIngestionError({
          source: SHAREHOLDING_SOURCE,
          cron: SHAREHOLDING_CRON,
          guardType: "range",
          targetTable: "ShareholdingPattern",
          targetField: "pct",
          targetEntity: entity,
          severity: "medium",
          resolutionPath: "admin_fill",
          expected: `percentages in [${PCT_MIN}, ${PCT_MAX}]`,
          observed: pctOob.join(", "),
          detail: "Percentage out of bounds — possible scale error.",
          runRef,
        });
      }

      const shareViolations = checkShareInvariants({
        totalShares: parsed.totalShares,
        promoterShares: parsed.promoterShares,
        pledgedShares: parsed.pledgedShares,
      });
      if (shareViolations.length > 0) {
        await reportIngestionError({
          source: SHAREHOLDING_SOURCE,
          cron: SHAREHOLDING_CRON,
          guardType: "range",
          targetTable: "ShareholdingPattern",
          targetField: "shares",
          targetEntity: entity,
          severity: "medium",
          resolutionPath: "source_code",
          expected:
            "totalShares>0, promoterShares≤totalShares, pledgedShares≤promoterShares",
          observed: `${shareViolations.join(", ")} (total=${parsed.totalShares}, promoter=${parsed.promoterShares}, pledged=${parsed.pledgedShares})`,
          detail: "Share-count invariant broken — likely a share context parse miss.",
          runRef,
        });
      }

      // ── GUARD 5: CONTINUITY (low · per-record · QoQ) ──
      const promoterDelta = checkPromoterContinuity(promoterPct, priorPromoterPct);
      if (promoterDelta != null) {
        await reportIngestionError({
          source: SHAREHOLDING_SOURCE,
          cron: SHAREHOLDING_CRON,
          guardType: "continuity",
          targetTable: "ShareholdingPattern",
          targetField: "promoterPct",
          targetEntity: entity,
          severity: "low",
          resolutionPath: "source_code",
          expected: `|Δpromoter vs prior quarter| ≤ ${CONTINUITY_PROMOTER_PP}pp`,
          observed: `${priorPromoterPct}→${promoterPct} (Δ${promoterDelta.toFixed(2)}pp)`,
          detail:
            "Large promoter-stake move — genuine action or a parse miss; eyeball.",
          runRef,
        });
      }

      // Capture the newest new quarter's breakdown for the run-level
      // batch NULL-RATE guard (sees through the CSV top-level mask).
      if (!newQuarter) {
        newQuarter = {
          symbol,
          asOnDate,
          fiiPct: parsed.fiiPct,
          diiPct: parsed.diiPct,
          banksFisPct: parsed.banksFisPct,
          promoterPledgedPct: parsed.promoterPledgedPct,
        };
      }
    }

    // Upsert the shareholding record
    const recordData = {
      symbol,
      quarter,
      fiscalYear,
      promoterPct: new Prisma.Decimal(promoterPct),
      publicPct: new Prisma.Decimal(publicPct),
      employeeTrustPct: new Prisma.Decimal(parsed.employeeTrustPct),
      fiiPct: dec(parsed.fiiPct),
      diiPct: dec(parsed.diiPct),
      retailPct: dec(parsed.retailPct),
      othersPct: dec(parsed.othersPct),
      mutualFundPct: dec(parsed.mutualFundPct),
      insurancePct: dec(parsed.insurancePct),
      banksFisPct: dec(parsed.banksFisPct),
      promoterPledgedPct: dec(parsed.promoterPledgedPct),
      promoterPledgedSharesPct: dec(parsed.promoterPledgedSharesPct),
      totalShares: parsed.totalShares ? BigInt(parsed.totalShares) : BigInt(0),
      promoterShares: parsed.promoterShares
        ? BigInt(parsed.promoterShares)
        : BigInt(0),
      pledgedShares: parsed.pledgedShares
        ? BigInt(parsed.pledgedShares)
        : BigInt(0),
      xbrlUrl: filing.xbrlUrl,
      sourceDate: parseAsOnDate(filing.submissionDate) ?? asOnDate,
    };
    try {
      // ── SCORE-RELEVANT DIFF (before/after) — see score-relevant-diff.ts. ──
      // promoterPledgedPct / promoterPledgedSharesPct are COSMETIC here: computeOwnership
      // derives pledge from the raw pledgedShares/promoterShares BigInts.
      const shKey = { stockId_asOnDate: { stockId: stock.id, asOnDate } };
      const before = await prisma.shareholdingPattern.findUnique({
        where: shKey,
        select: scoreRelevantSelect("shareholding_patterns") as never,
      });
      const result = await prisma.shareholdingPattern.upsert({
        where: shKey,
        create: { stockId: stock.id, asOnDate, ...recordData },
        update: recordData,
      });
      const shDiff = diffScoreRelevant(
        "shareholding_patterns",
        before as Record<string, unknown> | null,
        result as unknown as Record<string, unknown>,
      );
      if (shDiff.changed) quartersScoreRelevantChanged++;
      quartersInserted++;
      console.log(
        `[Shareholding] ${symbol} ${quarter} ${fiscalYear}: upserted`,
      );
    } catch (e) {
      errors.push(
        `DB upsert failed for ${filing.asOnDate}: ${(e as Error).message}`,
      );
    }

    // Respect NSE rate limits
    await sleep(800);
  }

  const durationMs = Date.now() - start;

  await logFetch(
    symbol,
    stock.id,
    "manual",
    sorted.length,
    quartersInserted,
    quartersSkipped,
    errors.length === 0 ? "success" : "partial",
    errors.length > 0 ? errors.join("; ") : null,
    durationMs,
  );

  return {
    success: true,
    symbol,
    stockId: stock.id,
    quartersProcessed: sorted.length,
    quartersInserted,
    quartersScoreRelevantChanged,
    quartersSkipped,
    durationMs,
    errors,
    zeroFilings: false,
    newQuarter,
  };
}

// ── Batch processor ───────────────────────────────────────────
// Runs ingest for a list of symbols in concurrent batches.
// A per-stock timeout prevents a single hung request from
// blocking an entire batch.

async function runInBatches(
  symbols: string[],
  processFn: (symbol: string) => Promise<IngestShareholdingResult>,
  batchSize: number,
  delayBetweenBatches: number,
  timeoutMs: number,
  label: string,
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<{
  totalInserted: number;
  totalSkipped: number;
  successStocks: number;
  failedStocks: number;
  errors: Array<{ symbol: string; error: string }>;
  changedSymbols: string[];
  zeroFilingStocks: number;
  newQuarters: NewQuarterParsed[];
}> {
  let totalInserted = 0;
  let totalSkipped = 0;
  let successStocks = 0;
  let failedStocks = 0;
  let zeroFilingStocks = 0;
  const errors: Array<{ symbol: string; error: string }> = [];
  const changedSymbols: string[] = [];
  const newQuarters: NewQuarterParsed[] = [];
  const totalBatches = Math.ceil(symbols.length / batchSize);

  for (let i = 0; i < symbols.length; i += batchSize) {
    // Fast-path abort check before starting each batch
    if (signal?.aborted) break;

    const batch = symbols.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(
      `[Shareholding] ${label} batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`,
    );

    const settled = await Promise.allSettled(
      batch.map((symbol) =>
        Promise.race([
          processFn(symbol),
          new Promise<IngestShareholdingResult>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timed out after ${timeoutMs / 1000}s`)),
              timeoutMs,
            ),
          ),
        ]),
      ),
    );

    for (let j = 0; j < settled.length; j++) {
      const symbol = batch[j];
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        const r = outcome.value;
        totalInserted += r.quartersInserted;
        totalSkipped += r.quartersSkipped;
        if (r.zeroFilings) zeroFilingStocks++;
        if (r.newQuarter) newQuarters.push(r.newQuarter);
        // A SCORE INPUT actually moved → this symbol's PG(s) should rescore.
        // NOT `quartersInserted > 0`: that counts upserts, and the upsert blind-overwrites
        // on every pass (1,632 in-place updates measured), so it fired for rewrites whose
        // ownership numbers were identical. See score-relevant-diff.ts.
        if (r.quartersScoreRelevantChanged > 0) changedSymbols.push(symbol);
        if (r.errors.length > 0) {
          errors.push({ symbol, error: r.errors.join("; ") });
          failedStocks++;
        } else {
          successStocks++;
        }
      } else {
        const msg =
          (outcome.reason as Error)?.message ?? String(outcome.reason);
        errors.push({ symbol, error: msg });
        failedStocks++;
        console.error(`[Shareholding] ${symbol} failed: ${msg}`);
      }
    }

    if (onBatchComplete) {
      const shouldContinue = await onBatchComplete(
        batchNum,
        totalBatches,
        `batch ${batchNum}/${totalBatches} — ${batch.join(", ")}`,
      );
      if (!shouldContinue) break;
    }

    if (i + batchSize < symbols.length) {
      // Reset NSE session every 3 batches — long-lived sessions get silently
      // dropped by NSE, causing all stocks in the next batch to hang/fail.
      if (batchNum % 3 === 0) {
        console.log(`[Shareholding] ${label} resetting NSE session after batch ${batchNum}…`);
        nseClient.resetSession();
        await sleep(3_000); // give NSE a moment before the next init
      } else {
        await sleep(delayBetweenBatches);
      }
    }
  }

  return {
    totalInserted,
    totalSkipped,
    successStocks,
    failedStocks,
    errors,
    changedSymbols,
    zeroFilingStocks,
    newQuarters,
  };
}

// ── Run-level coverage + null-rate guards (GUARDS 2 + 3) ──────
// Called at the end of each bulk job over the run's aggregate. These see
// through the CSV top-level mask by inspecting the XBRL BREAKDOWN of the
// genuinely-new quarters. Batch rates are skipped below MIN_BATCH_FOR_RATE
// (noise on small smart-refresh runs).
async function runCoverageGuards(
  jobLabel: string,
  agg: {
    totalStocks: number;
    successStocks: number;
    zeroFilingStocks: number;
    newQuarters: NewQuarterParsed[];
  },
): Promise<void> {
  const runRef = `${SHAREHOLDING_CRON}:${jobLabel}`;
  const base = {
    source: SHAREHOLDING_SOURCE,
    cron: SHAREHOLDING_CRON,
    targetTable: "ShareholdingPattern",
    runRef,
  } as const;

  // ── GUARD 2a: COUNT / coverage ──
  const coverage = classifyCoverage(agg.successStocks, agg.totalStocks);
  if (coverage) {
    await reportIngestionError({
      ...base,
      guardType: "count",
      severity: coverage.severity,
      resolutionPath: "source_code",
      expected: `≥75% of ${agg.totalStocks} stocks succeed`,
      observed: coverage.note,
      detail: `${jobLabel} run coverage below floor — session cascade or NSE outage.`,
    });
  }

  // ── GUARD 2b: zero-filing rate (silent index-API break) ──
  const zeroRate = checkZeroFilingRate(agg.zeroFilingStocks, agg.totalStocks);
  if (zeroRate != null) {
    await reportIngestionError({
      ...base,
      guardType: "count",
      targetField: "filingIndex",
      severity: "high",
      resolutionPath: "source_code",
      expected: `≤10% of stocks return an empty filing index`,
      observed: `${agg.zeroFilingStocks}/${agg.totalStocks} (${(zeroRate * 100).toFixed(1)}%) returned 0 filings`,
      detail:
        "Spike in empty filing indexes — the NSE index API likely changed/broke (these otherwise log as silent 'success').",
    });
  }

  // ── GUARD 3: NULL-RATE on the XBRL breakdown (sees through CSV mask) ──
  const n = agg.newQuarters.length;
  const nq = agg.newQuarters;
  const nullRateGuard = (
    field: "fiiPct" | "diiPct" | "banksFisPct",
    max: number,
  ) => {
    const nulls = nq.filter((q) => q[field] == null).length;
    const rate = checkBatchNullRate(nulls, n, max);
    if (rate == null) return null;
    return { nulls, rate };
  };

  for (const [field, max, normal] of [
    ["fiiPct", FII_DII_NULL_MAX, "0.2%"],
    ["diiPct", FII_DII_NULL_MAX, "0.2%"],
    ["banksFisPct", BANKS_NULL_MAX, "2.5%"],
  ] as const) {
    const hit = nullRateGuard(field, max);
    if (hit) {
      await reportIngestionError({
        ...base,
        guardType: "null_rate",
        targetField: field,
        severity: "medium",
        resolutionPath: "source_code",
        expected: `${field} null-rate ≤ ${(max * 100).toFixed(0)}% (normal ${normal})`,
        observed: `${(hit.rate * 100).toFixed(1)}% null (${hit.nulls}/${n})`,
        detail:
          "XBRL breakdown silently lost across the run — the CSV top-level can still look fine, so this is the guard that catches a total XBRL break.",
      });
    }
  }

  // ── GUARD 3 (pledge collapse) ──
  const pledgePresent = nq.filter(
    (q) => q.promoterPledgedPct != null && q.promoterPledgedPct > 0,
  ).length;
  const pledgeRate = checkPledgeCollapse(pledgePresent, n);
  if (pledgeRate != null) {
    await reportIngestionError({
      ...base,
      guardType: "null_rate",
      targetField: "promoterPledgedPct",
      severity: "medium",
      resolutionPath: "source_code",
      expected: `pledge-present rate ≥ 5% (normal 18.7%)`,
      observed: `${(pledgeRate * 100).toFixed(1)}% have pledge>0 (${pledgePresent}/${n})`,
      detail:
        "Pledge-present rate collapsed — the pledge/encumbrance context likely broke, defaulting everything to 0 (pledge is critical for the health score).",
    });
  }
}

// ── Bulk quarterly job (all active stocks) ────────────────────
// Run quarterly: Jan 20, Apr 20, Jul 20, Oct 20
// By then most companies have filed (21-day deadline from quarter end)

export async function runQuarterlyShareholdingIngest(
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<BulkIngestResult> {
  const start = Date.now();

  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });

  console.log(
    `[Shareholding] Quarterly job: ${stocks.length} stocks to process`,
  );

  const { totalInserted, totalSkipped, successStocks, failedStocks, errors, changedSymbols, zeroFilingStocks, newQuarters } =
    await runInBatches(
      stocks.map((s) => s.symbol),
      (symbol) => ingestShareholdingForStock(symbol, 4, signal),
      5,
      4_000,
      90_000,
      "Quarterly",
      onBatchComplete,
      signal,
    );

  await runCoverageGuards("quarterly", {
    totalStocks: stocks.length,
    successStocks,
    zeroFilingStocks,
    newQuarters,
  });

  const durationMs = Date.now() - start;
  console.log(
    `[Shareholding] Done — inserted: ${totalInserted}, stocks: ${successStocks}/${stocks.length}`,
  );

  return {
    totalStocks: stocks.length,
    successStocks,
    failedStocks,
    totalInserted,
    totalSkipped,
    durationMs,
    errors,
    changedSymbols,
  };
}

// ── Smart trigger: fetch stocks due for update ─────────────────
// Checks corporate_events: if a stock's Q results event
// passed 7–21 days ago, it's due for a new shareholding filing.

export async function runSmartShareholdingRefresh(
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<BulkIngestResult> {
  const start = Date.now();
  const now = new Date();

  // Find stocks where earnings event was 7–21 days ago
  const cutoffFrom = new Date(now.getTime() - 21 * 86400_000);
  const cutoffTo = new Date(now.getTime() - 7 * 86400_000);

  const dueStocks = await prisma.corporateEvent.findMany({
    where: {
      eventType: "earnings",
      eventDate: { gte: cutoffFrom, lte: cutoffTo },
      stock: { isActive: true },
    },
    select: { symbol: true },
    distinct: ["symbol"],
  });

  if (dueStocks.length === 0) {
    console.log("[Shareholding] Smart refresh: no stocks due");
    return {
      totalStocks: 0,
      successStocks: 0,
      failedStocks: 0,
      totalInserted: 0,
      totalSkipped: 0,
      durationMs: Date.now() - start,
      errors: [],
      changedSymbols: [],
    };
  }

  console.log(`[Shareholding] Smart refresh: ${dueStocks.length} stocks due`);

  const { totalInserted, totalSkipped, successStocks, failedStocks, errors, changedSymbols, zeroFilingStocks, newQuarters } =
    await runInBatches(
      dueStocks.map((s) => s.symbol),
      (symbol) => ingestShareholdingForStock(symbol, 1, signal),
      5,
      3_000,
      60_000,
      "SmartRefresh",
      onBatchComplete,
      signal,
    );

  await runCoverageGuards("smart", {
    totalStocks: dueStocks.length,
    successStocks,
    zeroFilingStocks,
    newQuarters,
  });

  return {
    totalStocks: dueStocks.length,
    successStocks,
    failedStocks,
    totalInserted,
    totalSkipped,
    durationMs: Date.now() - start,
    errors,
    changedSymbols,
  };
}

// ── Backfill (run once on setup) ───────────────────────────────

export async function runShareholdingBackfill(
  quartersBack: number = 20,
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<BulkIngestResult> {
  const start = Date.now();

  const stocks = await prisma.stock.findMany({
    where: { isActive: true },
    select: { symbol: true },
  });

  console.log(
    `[Shareholding] Backfill: ${stocks.length} stocks × ${quartersBack} quarters`,
  );

  const { totalInserted, totalSkipped, successStocks, failedStocks, errors, changedSymbols, zeroFilingStocks, newQuarters } =
    await runInBatches(
      stocks.map((s) => s.symbol),
      (symbol) => ingestShareholdingForStock(symbol, quartersBack, signal),
      3,
      8_000,
      300_000, // 5 min per stock — 40 quarters × ~4s each
      "Backfill",
      onBatchComplete,
      signal,
    );

  await runCoverageGuards("backfill", {
    totalStocks: stocks.length,
    successStocks,
    zeroFilingStocks,
    newQuarters,
  });

  return {
    totalStocks: stocks.length,
    successStocks,
    failedStocks,
    totalInserted,
    totalSkipped,
    durationMs: Date.now() - start,
    errors,
    changedSymbols,
  };
}

// ── Helpers ───────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function logFetch(
  symbol: string,
  stockId: string | null,
  fetchType: string,
  found: number,
  inserted: number,
  skipped: number,
  status: string,
  error: string | null,
  durationMs: number,
) {
  try {
    await prisma.shareholdingFetchLog.create({
      data: {
        stockSymbol: symbol,
        stockId,
        fetchType,
        quartersFound: found,
        quartersInserted: inserted,
        quartersSkipped: skipped,
        status,
        error,
        durationMs,
      },
    });
  } catch {
    // Non-critical — don't throw
  }
}
