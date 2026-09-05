// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BSE BACKFILL RUNNER — chunked, ledgered, resumable, and dry by default.
//
// ⚠ `dryRun` DEFAULTS TO TRUE. A caller must opt in to writing. Every write is
//   INSERT … ON CONFLICT DO NOTHING (bse-writer.ts), so even a wet run cannot touch an NSE row —
//   but the default still points the safe way.
//
// ORDER OF OPERATIONS PER UNIT, and every step can only reduce what is written:
//   1. resolve the scrip            → unresolved is recorded, never skipped silently
//   2. find the document            → not_listed / listed_without_xbrl are DIFFERENT outcomes
//   3. fetch the instance
//   4. ASSERT period + basis        → the period trap; a failure discards the document
//   5. extract cells + ratio gate   → refused ratios become null, and every verdict is logged
//   6. insert if absent             → NSE always wins
//   6b. IF the insert declined because a row EXISTS → fill that row's NULLS ONLY (see below)
//   7. ledger the outcome           → so a resumed run never re-does step 3
//
// ── ★ STEP 6b — HOW THE RUNNER CHOOSES BETWEEN THE TWO WRITERS ────────────────────────────────────
// It does not choose. THE INSERT DECIDES, and the runner reads its answer:
//
//   insert returns written:true                          → a new row exists. Nothing to fill; the
//                                                          insert just set every column it knows.
//                                                          The fill path is NEVER called. → `written`
//   insert returns written:false, "nse_or_existing_row_present"
//                                                        → a row is already there, and it may have
//                                                          NULL columns this document can serve.
//                                                          Hand the SAME extracted cells to the
//                                                          null-only filler.
//                                                          ≥1 cell landed → `columns_filled`
//                                                          0 cells landed → `skipped_nse_holds`
//   insert returns written:false, "rejected_by_guard"     → the document failed the contentless-money
//                                                          guard. It is not trusted to CREATE a row,
//                                                          so it is not trusted to fill one either.
//                                                          The fill path is NEVER called.
//
// This keeps the guarantee where it was. bse-writer.ts still contains no statement that can modify an
// existing row — verify-bse-writer-parity.ts asserts that from source on every build, along with the
// rule that the filler's column set is EXACTLY the insert's. Two verbs, two files, two guarantees.
//
// ⚠ AND IT CHANGES WHAT THE FENCE MUST BE TOLD. Step 6b moves `updated_at` on NSE rows, deliberately.
//   Every row id it touches is collected in RunSummary.targetedRowIds and MUST be passed to
//   verifyAgainstPersisted — otherwise a correct run reports a fence violation on its own work.
//
// ⚠ ThrottleStopError is NOT caught here. It propagates and ends the run deliberately. The ledger
//   makes that free: resume after ~2 minutes and the completed units are skipped.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { PrismaClient } from "../../../generated/prisma/client.js";
import { BsePacer, ThrottleStopError } from "./bse-http.js";
import {
  fetchResultsListing,
  findDocument,
  fetchInstance,
  quarterCodeFor,
  type BseListing,
  type Grain,
} from "./bse-discovery.js";
import { assertPeriodAndBasis } from "./bse-period-guard.js";
import {
  extractNbfcQuarterlyCells,
  extractNbfcFundamentalCells,
  extractLifeInsuranceQuarterlyCells,
  extractLifeInsuranceFundamentalCells,
  extractGeneralInsuranceQuarterlyCells,
  extractGeneralInsuranceFundamentalCells,
  extractQuarterlyCells,
  extractBankingQuarterlyCells,
  extractFundamentalCells,
  extractBankingFundamentalCells,
  isBankingDocument,
} from "./bse-extract.js";
import {
  insertQuarterlyIfAbsent,
  insertNbfcQuarterlyIfAbsent,
  insertNbfcFundamentalIfAbsent,
  insertLifeInsuranceQuarterlyIfAbsent,
  insertLifeInsuranceFundamentalIfAbsent,
  insertGeneralInsuranceQuarterlyIfAbsent,
  insertGeneralInsuranceFundamentalIfAbsent,
  insertBankingQuarterlyIfAbsent,
  insertFundamentalIfAbsent,
  insertBankingFundamentalIfAbsent,
  type RowIdentity,
  type AnnualIdentity,
} from "./bse-writer.js";
import { deriveAfterBseWrite } from "./bse-derive-after-write.js";
import { BseLedger, unitKey, type LedgerOutcome } from "./bse-ledger.js";
import { cellsToColumns, fillNullColumns, type TxClient } from "./bse-column-fill.js";
import type { FencedTable } from "./bse-fence.js";
import type { RatioVerdict, CrossDocReference } from "./bse-ratio-gate.js";
import { deriveFiscalPeriod } from "../xbrl/parser-common.js";
import { extractDate } from "../legacy/parser-legacy-common.js";
import { familyForStock, bseCanWrite } from "../family-route.js";

/**
 * Thrown by an onChunk hook to END THE RUN cleanly. It is caught here and recorded in
 * `summary.stopped` exactly like a throttle stop — because a fence violation and a throttle are the
 * same shape: stop now, keep everything decided so far, resume from the ledger later. Throwing a
 * bare Error instead would propagate and DISCARD the summary, losing the outcome mix for the very
 * chunks that led up to the halt — the ones worth reading.
 */
export class HaltRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HaltRun";
  }
}

export interface BseTarget {
  symbol: string;
  stockId: string;
  scripCode: string;
  grain: Grain;
  /** The period END we want. For an annual row this is the fiscal-year end. */
  periodEnd: Date;
  /**
   * Which basis this unit is for. The ledger key, the period trap and the writer's conflict target
   * all carry it already, so the two bases are independent units end to end: they cannot collide in
   * the ledger (unitKey includes it), cannot be confused at parse time (assertPeriodAndBasis refuses
   * a document whose own declared basis disagrees), and cannot overwrite each other in the database
   * (every ON CONFLICT target includes result_type).
   */
  basis: "standalone" | "consolidated";
  /**
   * S8.4b — the ROUTING KEY. `Stock.industryType`, carried on the target so the
   * writer never has to ask the document which family it belongs to. See
   * family-route.ts for why the document cannot answer that.
   */
  industryType: string;
}

export interface RunOptions {
  dryRun?: boolean;
  ledgerFile: string;
  chunkSize?: number;
  pacer?: BsePacer;
  onRatioVerdicts?: (symbol: string, period: string, verdicts: RatioVerdict[]) => void;
  log?: (line: string) => void;
  /**
   * Called after every chunk, with the chunk's own outcome mix and the row ids the fill path has
   * touched SO FAR. THROW from here to halt the run — the ledger has already recorded every unit,
   * so a halt costs nothing but the current chunk's un-run remainder. This is where the per-chunk
   * fence check and the retention-depth check live: both must be able to stop the run, and neither
   * belongs inside the writer.
   */
  onChunk?: (info: {
    index: number;
    outcomes: Record<string, number>;
    medianLatencyMs: number;
    targetedRowIds: readonly string[];
    attempted: number;
  }) => Promise<void>;
}

export interface RunSummary {
  attempted: number;
  outcomes: Record<string, number>;
  stopped: null | { reason: "throttle" | "halted"; afterUnits: number; message: string };
  ratioRefusals: number;
  latencies: number[];
  /** ⚠ Every existing row step 6b wrote into. MUST be handed to the fence, or a correct run
   *  reports a violation on its own work. See the note in the header. */
  targetedRowIds: string[];
  /** Cells the null-only fill actually landed, per `table.column`. */
  cellsFilled: Record<string, number>;
  /** Cells offered to an existing row that already carried a value — left untouched. */
  cellsHeldNotNull: number;
}

/** Every unit's decision, in the order taken. Mirrors what the ledger records. */
type UnitResult = {
  outcome: LedgerOutcome;
  note?: string;
  refused?: string[];
  /** step 6b: the existing row written into, and which columns landed. */
  filled?: { table: FencedTable; rowId: string; columns: string[]; heldNotNull: number };
};

export async function runBseBackfill(
  prisma: PrismaClient,
  targets: BseTarget[],
  opts: RunOptions,
): Promise<RunSummary> {
  const dryRun = opts.dryRun ?? true;
  const chunkSize = opts.chunkSize ?? 25;
  const pacer = opts.pacer ?? new BsePacer();
  const log = opts.log ?? ((l: string) => console.log(l));
  const ledger = new BseLedger(opts.ledgerFile);

  const summary: RunSummary = {
    attempted: 0,
    outcomes: {},
    stopped: null,
    ratioRefusals: 0,
    latencies: pacer.latencies,
    targetedRowIds: [],
    cellsFilled: {},
    cellsHeldNotNull: 0,
  };
  const listings = new Map<string, BseListing>();
  // ★ S6.3a carve-out: one Advances reference per bank, fetched at most once. See bse-ratio-gate.ts.
  const advancesRefs = new Map<string, CrossDocReference | null>();

  log(`BSE backfill — ${dryRun ? "DRY RUN (nothing will be written)" : "LIVE"} · ${targets.length} unit(s) · ledger ${ledger.path}`);
  if (ledger.completed) log(`  resuming: ${ledger.completed} unit(s) already decided in a previous run`);

  try {
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      const chunkOutcomes: Record<string, number> = {};

      for (const t of chunk) {
        const period = t.periodEnd.toISOString().slice(0, 10);
        const key = unitKey(t.symbol, t.grain, period, t.basis);
        if (ledger.has(key)) continue;

        summary.attempted++;
        const r = await runUnit(prisma, t, period, listings, advancesRefs, pacer, dryRun, opts.onRatioVerdicts);
        if (r.refused?.length) summary.ratioRefusals += r.refused.length;
        if (r.filled) {
          summary.targetedRowIds.push(r.filled.rowId);
          summary.cellsHeldNotNull += r.filled.heldNotNull;
          for (const c of r.filled.columns) {
            const k = `${r.filled.table}.${c}`;
            summary.cellsFilled[k] = (summary.cellsFilled[k] ?? 0) + 1;
          }
        }

        ledger.append({
          unit: key,
          symbol: t.symbol,
          scripCode: t.scripCode,
          grain: t.grain,
          period,
          basis: t.basis,
          outcome: r.outcome,
          refusedRatios: r.refused,
          note: r.note,
        });
        summary.outcomes[r.outcome] = (summary.outcomes[r.outcome] ?? 0) + 1;
        chunkOutcomes[r.outcome] = (chunkOutcomes[r.outcome] ?? 0) + 1;
      }

      // ⚠ THE FAILURE MIX PER CHUNK, not just a count — a chunk that is 90% not_listed and a chunk
      //   that is 90% fetch_failed need different responses, and a single total hides that.
      const lat = pacer.latencies.slice(-chunk.length);
      const med = lat.length ? [...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)] : 0;
      log(
        `  chunk ${Math.floor(i / chunkSize) + 1}: ${JSON.stringify(chunkOutcomes)} · median latency ${med}ms`,
      );

      // ⚠ May throw to HALT. See onChunk's contract.
      await opts.onChunk?.({
        index: Math.floor(i / chunkSize) + 1,
        outcomes: chunkOutcomes,
        medianLatencyMs: med,
        targetedRowIds: summary.targetedRowIds,
        attempted: summary.attempted,
      });
    }
  } catch (e) {
    if (e instanceof ThrottleStopError) {
      summary.stopped = { reason: "throttle", afterUnits: summary.attempted, message: e.message };
      log(`  ⚠ STOPPED — ${e.message}`);
    } else if (e instanceof HaltRun) {
      summary.stopped = { reason: "halted", afterUnits: summary.attempted, message: e.message };
      log(`  ⚠ HALTED — ${e.message}`);
    } else {
      ledger.close();
      throw e;
    }
  }

  ledger.close();
  return summary;
}

async function runUnit(
  prisma: PrismaClient,
  t: BseTarget,
  period: string,
  listings: Map<string, BseListing>,
  advancesRefs: Map<string, CrossDocReference | null>,
  pacer: BsePacer,
  dryRun: boolean,
  onRatioVerdicts?: RunOptions["onRatioVerdicts"],
): Promise<UnitResult> {
  let listing = listings.get(t.scripCode);
  if (!listing) {
    // ⚠ A LISTING FAULT IS THIS UNIT'S PROBLEM, NOT THE RUN'S. fetchResultsListing throws when BSE
    //   answers `{}` three times — correct, because a fault must not masquerade as "no filings".
    //   But that throw used to escape runUnit and kill the whole run: MEASURED, scrip 532210 (CUB)
    //   ended a 46-unit run with a stack trace. Record it as fetch_failed and move on; the ledger
    //   keeps it un-decided-in-effect so a later resume can retry that stock.
    try {
      listing = await fetchResultsListing(pacer, t.scripCode);
      listings.set(t.scripCode, listing);
    } catch (e) {
      if (e instanceof ThrottleStopError) throw e;
      return { outcome: "fetch_failed", note: `listing: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  const qc = quarterCodeFor(t.periodEnd, t.grain);
  const doc = findDocument(listing, qc, t.basis);
  if (doc.kind === "not_listed") return { outcome: "not_listed", note: `no results row at ${qc}` };
  if (doc.kind === "listed_without_xbrl") {
    return { outcome: "listed_without_xbrl", note: `BSE lists the ${qc} filing but publishes no XBRL for it` };
  }

  let xml: string;
  try {
    xml = await fetchInstance(pacer, doc.url, doc.alternates);
  } catch (e) {
    if (e instanceof ThrottleStopError) throw e;
    return { outcome: "fetch_failed", note: e instanceof Error ? e.message : String(e) };
  }

  // ── 4. THE PERIOD TRAP ──────────────────────────────────────────────────────
  const assertion = assertPeriodAndBasis(xml, t.grain, t.periodEnd, t.basis);
  if (!assertion.ok) {
    return { outcome: "period_assert_failed", note: assertion.failures.join("; ") };
  }

  // Fiscal labels come from the SHARED deriver — S4.3 (any fiscal-year end) and F2 (impossible
  // declared window) both apply to BSE documents unchanged.
  // ⚠ OneD then OneI — the SAME instant-context quirk the period guard handles.
  // The GeneralInsurance/2018-11-30 taxonomy tags its financial-year dates against
  // the INSTANT context (ICICIGI FY19 carries DateOfStartOfFinancialYear only under
  // OneI), while every other family uses the duration context. Reading OneD alone
  // reported "absent from OneD" for 50 general-insurance units whose dates were
  // sitting one context away.
  const fyStart =
    extractDate(xml, "DateOfStartOfFinancialYear", "OneD") ??
    extractDate(xml, "DateOfStartOfFinancialYear", "OneI");
  const fyEnd =
    extractDate(xml, "DateOfEndOfFinancialYear", "OneD") ??
    extractDate(xml, "DateOfEndOfFinancialYear", "OneI");
  const filingDate =
    extractDate(xml, "DateOfBoardMeetingWhenFinancialResultsWereApproved", "OneD") ?? t.periodEnd;
  if (!fyStart || !fyEnd) {
    return { outcome: "parse_failed", note: "DateOfStartOfFinancialYear / DateOfEndOfFinancialYear absent from OneD and OneI" };
  }

  let quarter: string;
  let fiscalYear: string;
  let fyRepaired = false;
  try {
    ({ quarter, fiscalYear } = deriveFiscalPeriod(t.periodEnd, fyStart, fyEnd, t.grain));
  } catch (e) {
    // ── YEAR-TO-DATE MISLABEL — a filer error, recoverable without guessing ──
    // Some filers put the YEAR-TO-DATE window in the FINANCIAL-YEAR fields:
    // SHRIRAMFIN's Q1 FY23 declares 2022-04-01..2022-06-30 as its "financial year",
    // and its H1 declares 2022-04-01..2022-09-30. The shared guard is right to
    // refuse those — a 3-month "year" cannot be trusted to label anything — and it
    // must stay right, because it protects the NSE lane too.
    //
    // But the error is self-evident and the true year is recoverable: the declared
    // START is correct (it is the real fiscal-year start), only the END was filled
    // in with the period end. So project 12 months from the declared start and
    // retry. If THAT still fails, the document really is unusable.
    //
    // Two conditions, both required, so this cannot fire on a genuinely odd year:
    //   · the declared window must be SHORTER than a year, and
    //   · its end must equal the reporting period end (i.e. it is the YTD window).
    // TWO filer-error shapes are repairable, and both leave the declared START
    // trustworthy — it is the real fiscal-year start in each case:
    //   (a) YTD MISLABEL   2022-04-01 .. 2022-06-30  — the end holds the PERIOD end
    //   (b) STALE END      2022-04-01 .. 2022-03-31  — the end holds the PRIOR
    //                      year's end, so it lands before its own start (the shape
    //                      deriveFiscalPeriod's own note cites for CANBK)
    // Anything else is refused unchanged.
    const spanMs = fyEnd.getTime() - fyStart.getTime();
    const ytdMislabel = spanMs > 0 && spanMs < 300 * 86400000 && fyEnd.getTime() === t.periodEnd.getTime();
    const staleEnd = spanMs <= 0;
    // The period we asked for must actually fall inside the projected year, or the
    // repair would be inventing a label rather than restoring one.
    const projectedEnd = new Date(Date.UTC(fyStart.getUTCFullYear() + 1, fyStart.getUTCMonth(), fyStart.getUTCDate()));
    projectedEnd.setUTCDate(projectedEnd.getUTCDate() - 1);
    const periodInsideYear =
      t.periodEnd.getTime() >= fyStart.getTime() && t.periodEnd.getTime() <= projectedEnd.getTime();
    if ((!ytdMislabel && !staleEnd) || !periodInsideYear) {
      return { outcome: "parse_failed", note: e instanceof Error ? e.message : String(e) };
    }
    try {
      ({ quarter, fiscalYear } = deriveFiscalPeriod(t.periodEnd, fyStart, projectedEnd, t.grain));
      fyRepaired = true;
    } catch (e2) {
      return {
        outcome: "parse_failed",
        note: `${e instanceof Error ? e.message : String(e)} — YTD repair also failed: ${e2 instanceof Error ? e2.message : String(e2)}`,
      };
    }
  }

  // ── S8.4b · ROUTE ON THE STOCK, NOT THE DOCUMENT ──────────────────────────
  //   isBankingDocument(xml) was a two-way test standing in for a five-way
  //   decision. All 400 NBFC legacy documents classify as NOT-banking under it
  //   and would land in quarterly_results / fundamentals silently.
  const family = familyForStock(t.industryType, t.symbol);
  if (!bseCanWrite(family)) {
    // The BSE lane has no extractor or INSERT for this family yet (Step 5).
    // REFUSE rather than fall through — the fall-through IS the bug.
    return {
      outcome: "parse_failed",
      note: `BSE lane has no writer for family "${family}" (${t.symbol}); refusing rather than routing to a foreign table`,
    };
  }
  const banking = family === "banking";
  const nbfc = family === "nbfc";
  const lifeIns = family === "life_insurance";
  const genIns = family === "general_insurance";
  const rowId: RowIdentity = {
    stockId: t.stockId, quarter, fiscalYear, reportDate: t.periodEnd,
    filingDate, resultType: t.basis, xbrlUrl: doc.url,
  };
  const annualId: AnnualIdentity = {
    stockId: t.stockId, fiscalYear, reportDate: t.periodEnd,
    filingDate, resultType: t.basis, xbrlUrl: doc.url,
  };

  // ── 5. EXTRACT + RATIO GATE ────────────────────────────────────────────────
  let refused: string[] = [];
  // rowId rides along so the derive layer can be run over the row that was just created.
  let write: () => Promise<{ written: boolean; rowId?: string; detail?: string }>;
  // Step 6b needs the SAME cells the insert was offered, plus which table they belong to.
  let table: FencedTable;
  let rawCells: Record<string, number | null | undefined>;

  if (t.grain === "quarterly" && banking) {
    // ★ CARVE-OUT: the quarterly instance has no Advances, so fetch the bank's nearest ANNUAL once
    //   and use its Advances as the cross-document denominator. Cached per scrip.
    // ⚠ CACHED PER (SCRIP, BASIS), NOT PER SCRIP. The denominator has to come from the SAME basis as
    //   the numerator: a consolidated quarterly NPA ratio measured against a standalone Advances is
    //   a ratio between two different companies' worth of loan book. Keying on the scrip alone was
    //   correct only while this lane fetched one basis.
    const advKey = `${t.scripCode}|${t.basis}`;
    if (!advancesRefs.has(advKey)) {
      advancesRefs.set(advKey, await resolveAdvancesReference(pacer, listing, t.periodEnd, t.basis));
    }
    const r = extractBankingQuarterlyCells(xml, advancesRefs.get(advKey) ?? undefined);
    table = "banking_quarterly_results";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    refused = r.ratioVerdicts.filter((v) => !v.accepted).map((v) => v.field);
    onRatioVerdicts?.(t.symbol, period, r.ratioVerdicts);
    write = async () => {
      const w = await insertBankingQuarterlyIfAbsent(prisma, rowId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (t.grain === "quarterly" && lifeIns) {
    const r = extractLifeInsuranceQuarterlyCells(xml);
    table = "life_insurance_quarterly_results";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertLifeInsuranceQuarterlyIfAbsent(prisma, rowId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (t.grain === "quarterly" && genIns) {
    const r = extractGeneralInsuranceQuarterlyCells(xml);
    table = "general_insurance_quarterly_results";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertGeneralInsuranceQuarterlyIfAbsent(prisma, rowId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (t.grain === "quarterly" && nbfc) {
    // NBFC quarterly — the Ind-AS cells, routed to the NBFC table. See bse-extract.ts
    // for why this needs no new taxonomy.
    const r = extractNbfcQuarterlyCells(xml);
    table = "nbfc_quarterly_results";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertNbfcQuarterlyIfAbsent(prisma, rowId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (t.grain === "quarterly") {
    const r = extractQuarterlyCells(xml);
    table = "quarterly_results";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertQuarterlyIfAbsent(prisma, rowId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (banking) {
    const r = extractBankingFundamentalCells(xml);
    table = "banking_fundamentals";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    refused = r.ratioVerdicts.filter((v) => !v.accepted).map((v) => v.field);
    onRatioVerdicts?.(t.symbol, period, r.ratioVerdicts);
    write = async () => {
      const w = await insertBankingFundamentalIfAbsent(prisma, annualId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (lifeIns) {
    const r = extractLifeInsuranceFundamentalCells(xml);
    table = "life_insurance_fundamentals";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertLifeInsuranceFundamentalIfAbsent(prisma, annualId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (genIns) {
    const r = extractGeneralInsuranceFundamentalCells(xml);
    table = "general_insurance_fundamentals";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertGeneralInsuranceFundamentalIfAbsent(prisma, annualId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else if (nbfc) {
    const r = extractNbfcFundamentalCells(xml);
    table = "nbfc_fundamentals";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertNbfcFundamentalIfAbsent(prisma, annualId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  } else {
    const r = extractFundamentalCells(xml);
    table = "fundamentals";
    rawCells = r.cells as unknown as Record<string, number | null | undefined>;
    write = async () => {
      const w = await insertFundamentalIfAbsent(prisma, annualId, r.cells);
      return { written: w.written, rowId: "rowId" in w ? w.rowId : undefined, detail: "reason" in w ? w.reason : undefined };
    };
  }

  if (dryRun) {
    return { outcome: "dry_run", note: `${quarter} ${fiscalYear}${fyRepaired ? " (FY repaired from a mislabelled declared year)" : ""} · ${doc.url}`, refused };
  }

  const w = await write();
  if (w.written) {
    // ⚠ The row is committed with raw cells only. Derive it HERE — the BSE writer has no
    //   `...derived.columns` step the way the NSE ingesters do, and without this the row keeps its
    //   raw numbers and shows dashes for every ratio. Best-effort: see bse-derive-after-write.ts.
    const d = await deriveAfterBseWrite(prisma, table, w.rowId);
    return {
      outcome: "written",
      note: `${quarter} ${fiscalYear}${fyRepaired ? " (FY repaired from a mislabelled declared year)" : ""}`
        + (d.error ? ` · ⚠ derive failed: ${d.error}` : d.changed.length ? ` · derived ${d.changed.length}` : ""),
      refused,
    };
  }

  // ── 6b. THE INSERT DECLINED. Only ONE reason licenses the second writer. ────
  // `rejected_by_guard` means the document failed the contentless-money check: it was not trusted
  // to CREATE a row, so it is not trusted to fill one either. Only an existing row opens the fill.
  if (w.detail !== "nse_or_existing_row_present") {
    return { outcome: "skipped_nse_holds", note: `${quarter} ${fiscalYear} · ${w.detail ?? "declined"}`, refused };
  }

  const existing =
    t.grain === "quarterly"
      ? await prisma.$queryRawUnsafe<Array<{ id: string; source: string | null }>>(
          `SELECT id, source FROM "${table}" WHERE stock_id = $1 AND quarter = $2 AND fiscal_year = $3 AND result_type = $4`,
          t.stockId, quarter, fiscalYear, t.basis,
        )
      : await prisma.$queryRawUnsafe<Array<{ id: string; source: string | null }>>(
          `SELECT id, source FROM "${table}" WHERE stock_id = $1 AND fiscal_year = $2 AND result_type = $3`,
          t.stockId, fiscalYear, t.basis,
        );
  if (existing.length !== 1) {
    // The insert said a row exists and the lookup disagrees — do not guess which is right.
    return {
      outcome: "skipped_nse_holds",
      note: `${quarter} ${fiscalYear} · row present per insert but lookup returned ${existing.length}`,
      refused,
    };
  }

  const cols = cellsToColumns(table, rawCells);
  const fill = await prisma.$transaction(async (tx) =>
    fillNullColumns(
      tx as unknown as TxClient,
      table,
      existing[0].id,
      cols,
      doc.url, // CN-4: the BSE instance this value was read from
      BSE_FILL_EDITOR,
      `${quarter} ${fiscalYear} · null-only fill into a ${existing[0].source ?? "no-source"} row`,
    ),
  );

  // A filled raw cell changes what the ratios should be, so the fill path derives as well — but only
  // when something actually landed. Nothing filled means nothing to re-derive.
  const dFill = fill.landed.length > 0
    ? await deriveAfterBseWrite(prisma, table, existing[0].id)
    : { ran: false, changed: [] as string[], error: undefined as string | undefined };

  return {
    outcome: fill.landed.length > 0 ? "columns_filled" : "skipped_nse_holds",
    note:
      fill.landed.length > 0
        ? `${quarter} ${fiscalYear} · filled ${fill.landed.length}: ${fill.landed.join(",")}`
          + (dFill.error ? ` · ⚠ derive failed: ${dFill.error}` : dFill.changed.length ? ` · derived ${dFill.changed.length}` : "")
        : `${quarter} ${fiscalYear} · row present, ${fill.heldNotNull.length} cell(s) already set, nothing null to fill`,
    refused,
    filled: { table, rowId: existing[0].id, columns: fill.landed, heldNotNull: fill.heldNotNull.length },
  };
}

/** Whose edit this is, in raw_field_edits.edited_by. One value, so the run is queryable afterwards. */
export const BSE_FILL_EDITOR = "bse_xbrl_column_fill";

/**
 * ★ S6.3a CARVE-OUT — find a bank's Advances from its nearest ANNUAL filing.
 *
 * Tried in order of proximity to the quarter, because a closer reference means less loan-book drift.
 * At most two documents are fetched; if neither yields Advances the reference is null and the
 * quarterly NPA ratios are REFUSED rather than guessed.
 */
async function resolveAdvancesReference(
  pacer: BsePacer,
  listing: BseListing,
  periodEnd: Date,
  basis: "standalone" | "consolidated",
): Promise<CrossDocReference | null> {
  const y = periodEnd.getUTCFullYear();
  const m = periodEnd.getUTCMonth() + 1;
  const fyStart = m >= 4 ? y : y - 1;
  // the FY containing this quarter first, then the one before, then the one after
  const candidates = [fyStart, fyStart - 1, fyStart + 1].map((f) => `MC${f}-${f + 1}`);

  let fetched = 0;
  for (const qc of candidates) {
    if (fetched >= 2) break;
    const doc = findDocument(listing, qc, basis);
    if (doc.kind !== "found") continue;
    fetched++;
    let xml: string;
    try {
      xml = await fetchInstance(pacer, doc.url, doc.alternates);
    } catch (e) {
      if (e instanceof ThrottleStopError) throw e;
      continue;
    }
    const m2 = xml.match(
      /<in-bse-fin:Advances\b[^>]*?contextRef="OneI"[^>]*?>\s*([\-\d.eE+]+)\s*<\/in-bse-fin:Advances>/i,
    );
    if (!m2) continue;
    const v = parseFloat(m2[1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    const asOf =
      xml.match(/<in-bse-fin:DateOfEndOfReportingPeriod\b[^>]*?contextRef="FourD"[^>]*?>([^<]+)</i)?.[1]?.trim() ?? qc;
    return { advances: v, asOf, sourceUrl: doc.url };
  }
  return null;
}
