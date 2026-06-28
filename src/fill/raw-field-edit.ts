// ─────────────────────────────────────────────────────────────
// RAW-FIELD EDIT WRITE PATH (Part 2) + FILL CASCADE (Part 3).
//
// The analog of the CASA inject (POST /admin/.../casa), generalised to any RAW
// fundamentals field. On a corrected raw field it: (a) writes the raw value,
// (b) RE-DERIVES the dependent ratios via the single deriveFromRow path (closing
// the stale-stored-ratio gap), (c) records an append-only audit row with the
// MANDATORY source citation (CN-4), and (d) triggers the PG-wide rescore —
// reusing the proven CASA cascade machinery, not reinventing it.
//
// Versioning note: the fundamentals tables are upsert-in-place (one row per
// (stock, period, basis)) — NOT supersede-chained like BankSupplementary. So the
// raw correction is applied IN-PLACE and the append-only history lives in the
// RawFieldEdit audit table (the citation trail), mirroring how a re-ingest would
// overwrite the same row. (RawFieldEdit requires the additive migration —
// authored, ask-before-apply. reDeriveRow itself needs no migration.)
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { reDeriveRow, NO_RESCORE_TABLES, PRICE_TABLES, type ReDeriveResult } from "./re-derive.js";
import { triggerCasaCascade, triggerFillCascade, triggerRescoreForSymbols } from "../jobs/scoring-triggers.js";
import { resolveEditedPeriod } from "../scoring/rescore/general-cascade.js";
import { bankingPgForSymbol, scoredBankingPeriods } from "../scoring/rescore/banking-cascade.js";

// RAW-fillable columns per table (ingestion-written line items + disclosed-raw).
// DERIVED columns are deliberately ABSENT — they are not directly fillable; they
// recompute from the raw inputs via reDeriveRow.
export const FILLABLE: Record<string, ReadonlySet<string>> = {
  Fundamental: new Set([
    "revenue", "otherIncome", "expenses", "employeeBenefitExpense", "financeCosts", "depreciation",
    "profitBeforeTax", "tax", "netProfit", "equityShareCapital", "otherEquity", "totalEquity",
    "equityAttributableToOwners", "borrowingsCurrent", "borrowingsNoncurrent", "cashFromOperating",
    "capex", "paidUpEquityCapital", "faceValueShare", "tradeReceivablesCurrent",
    "tradeReceivablesNoncurrent", "inventories", "totalAssets", "basicEps", "dilutedEps",
  ]),
  QuarterlyResult: new Set([
    "revenue", "otherIncome", "expenses", "depreciation", "interest", "profitBeforeTax", "tax", "netProfit", "operatingProfit",
  ]),
  BankingFundamental: new Set([
    "interestEarned", "interestExpended", "otherIncome", "expenditureExclProvisions", "ppop", "provisions",
    "profitBeforeTax", "tax", "netProfit", "capital", "reservesAndSurplus", "deposits", "borrowings",
    "investments", "advances", "totalAssets", "gnpaAbsolute", "nnpaAbsolute", "paidUpEquityCapital", "faceValueShare",
    // disclosed-raw (fill-as-is; cet1/at1 → tier1Ratio re-derives):
    "gnpaPct", "nnpaPct", "cet1Ratio", "additionalTier1Ratio", "roaDisclosed", "basicEps", "dilutedEps",
  ]),
  NbfcFundamental: new Set([
    "revenue", "interestIncome", "feeAndCommissionIncome", "netGainOnFairValueChanges", "otherIncome", "totalIncome",
    "financeCosts", "feeAndCommissionExpense", "impairmentOnFinancialInstruments", "employeeBenefitExpense", "depreciation",
    "otherExpenses", "netProfit", "totalEquity", "equityShareCapital", "otherEquity", "loans", "investments", "totalAssets",
    "debtSecurities", "borrowings", "depositsLiabilities", "subordinatedLiabilities", "paidUpEquityCapital", "faceValueShare",
  ]),
  LifeInsuranceFundamental: new Set([
    "grossPremiumIncome", "netPremiumIncome", "incomeFirstYearPremium", "totalOperatingExpenses", "totalCommission",
    "netProfit", "shareCapital", "reservesAndSurplus", "fairValueChangeAccount", "totalAssets", "paidUpEquityCapital", "faceValueShare",
    // disclosed-raw:
    "solvencyRatio", "persistencyRatio13Month", "persistencyRatio25Month", "persistencyRatio37Month", "persistencyRatio49Month", "persistencyRatio61Month",
  ]),
  GeneralInsuranceFundamental: new Set([
    "grossPremiumsWritten", "netPremiumWritten", "premiumEarned", "incurredClaims", "netCommission", "underwritingProfitOrLoss",
    "netProfit", "shareCapital", "reservesAndSurplus", "fairValueChangeAccount", "totalAssets", "paidUpEquityCapital", "faceValueShare",
    // disclosed-raw (combinedRatio → netUnderwritingMargin re-derives):
    "combinedRatio", "incurredClaimRatio", "expensesOfManagementRatio", "netRetentionRatio", "solvencyRatio",
  ]),
  BankingQuarterlyResult: new Set([
    "interestEarned", "interestExpended", "otherIncome", "expenditureExclProvisions", "ppop", "provisions",
    "profitBeforeTax", "tax", "netProfit", "gnpaAbsolute", "nnpaAbsolute",
    "gnpaPct", "nnpaPct", "cet1Ratio", "additionalTier1Ratio", "roaQuarterly",
  ]),
  NbfcQuarterlyResult: new Set([
    "revenue", "interestIncome", "otherIncome", "totalIncome", "financeCosts", "impairmentOnFinancialInstruments", "netProfit",
  ]),
  LifeInsuranceQuarterlyResult: new Set([
    "grossPremiumIncome", "netPremiumIncome", "incomeFirstYearPremium", "totalOperatingExpenses", "totalRevenuePolicyholders", "netProfit",
    "solvencyRatio", "persistencyRatio13Month", "persistencyRatio25Month", "persistencyRatio37Month", "persistencyRatio49Month", "persistencyRatio61Month",
  ]),
  GeneralInsuranceQuarterlyResult: new Set([
    "grossPremiumsWritten", "premiumEarned", "incurredClaims", "totalRevenue", "netProfit",
    "combinedRatio", "incurredClaimRatio", "expensesOfManagementRatio", "netRetentionRatio", "solvencyRatio",
  ]),
  // ── Hand-fillable non-fundamentals (Flag A). NUMERIC columns only — BigInt
  //    share-counts/volume and date/string fields are a deferred non-numeric path. ──
  ShareholdingPattern: new Set([
    "promoterPct", "publicPct", "fiiPct", "diiPct", "mutualFundPct", "insurancePct", "banksFisPct",
    "promoterPledgedPct", "promoterPledgedSharesPct", "employeeTrustPct",
  ]),
  CorporateEvent: new Set(["dividendAmount"]),
  DailyPrice: new Set(["close", "open", "high", "low", "prevClose", "tradedValue"]),
};

export interface RawFieldEditInput {
  table: string;
  rowId: string;
  field: string;
  /** New raw value (null clears the field). Numbers are stored at the column's scale. */
  newValue: number | null;
  /** CN-4: MANDATORY source attribution (e.g. "FY24 AR p.142, audited"). */
  citation: string;
  /** Who made the edit (admin id / email). */
  editedBy: string;
  note?: string;
  /** Optional sanity band for the field (reuse the ingestion guards' range sense). */
  bounds?: { min?: number; max?: number };
}

export interface RawFieldEditResult {
  ok: boolean;
  reason?: string;
  reDerived?: ReDeriveResult;
  /** Which rescore route ran: banking/general = the PG-wide PIT cascade job;
   *  prices = a current-frame PG rescore job; none = display-only (events, no
   *  rescore — the fill is complete synchronously). */
  cascade?: "banking" | "general" | "prices" | "none";
  /** Pollable job id for the rescore (null for "none"/display-only). */
  jobId?: string | null;
  rescore?: unknown;
}

function validate(input: RawFieldEditInput): string | null {
  if (!input.citation || input.citation.trim().length < 4) return "citation required (CN-4): provide a source attribution";
  const allowed = FILLABLE[input.table];
  if (!allowed) return `table "${input.table}" not enabled for raw-field fill`;
  if (!allowed.has(input.field)) return `field "${input.field}" is not a RAW-fillable column on ${input.table} (derived columns recompute automatically)`;
  if (input.newValue !== null) {
    if (!Number.isFinite(input.newValue)) return "newValue must be a finite number or null";
    if (input.bounds?.min != null && input.newValue < input.bounds.min) return `value below min ${input.bounds.min}`;
    if (input.bounds?.max != null && input.newValue > input.bounds.max) return `value above max ${input.bounds.max}`;
  }
  return null;
}

/** Is this the latest period for the stock+basis (→ current rescore) or back-dated (→ PIT cascade)? */
/** Prisma model accessor key for a model name ("BankingFundamental" → "bankingFundamental"). */
function modelKey(table: string): string {
  return table.charAt(0).toLowerCase() + table.slice(1);
}

/**
 * Apply a raw-field correction, re-derive its ratios, audit it (with citation),
 * and ENQUEUE the PG-wide rescore cascade. Returns a structured result (never
 * throws on a validation failure — returns ok:false). The POST returns
 * immediately; the full rescore runs in the worker.
 */
export async function applyRawFieldEdit(input: RawFieldEditInput): Promise<RawFieldEditResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, reason: invalid };

  let reDerived: ReDeriveResult;
  let priorRaw: string | null = null;

  try {
    ({ reDerived, priorRaw } = await prisma.$transaction(async (tx) => {
      // (a) capture the prior raw value (for the audit), then write the correction
      // IN-PLACE on the target table (dynamic model — works for all 10 tables).
      const model = (tx as unknown as Record<string, { findUniqueOrThrow: (a: unknown) => Promise<unknown>; update: (a: unknown) => Promise<unknown> }>)[modelKey(input.table)];
      const before = await model.findUniqueOrThrow({ where: { id: input.rowId }, select: { [input.field]: true } });
      const priorRaw = ((before as Record<string, Prisma.Decimal | null>)[input.field])?.toString() ?? null;
      await model.update({ where: { id: input.rowId }, data: { [input.field]: input.newValue } });

      // (b) re-derive the dependent ratios from the corrected raw (single path).
      const reDerived = await reDeriveRow(tx, input.table, input.rowId);

      // (c) append-only audit with the MANDATORY citation (CN-4).
      await (tx as Prisma.TransactionClient).rawFieldEdit.create({
        data: {
          targetTable: input.table, targetRowId: input.rowId, field: input.field,
          oldValue: priorRaw, newValue: input.newValue?.toString() ?? null,
          citation: input.citation, editedBy: input.editedBy, note: input.note ?? null,
        },
      });

      return { reDerived, priorRaw };
    }));
  } catch (e) {
    return { ok: false, reason: `write failed: ${(e as Error).message}` };
  }

  // (d) ENQUEUE the PG-wide rescore cascade — returns immediately. The worker's
  // buildCascadePlan degrades a CURRENT-period edit to a single live rescore
  // (current_live) and back-dated edits to the full [edited..current] PIT cascade,
  // so always routing through the cascade is correct for both. BANKING symbols →
  // the proven PG_CASCADE_RESCORE (runBankingCascade), UNCHANGED; everything else
  // → the general FILL_CASCADE_RESCORE.
  const triggeredBy = `fill:${input.editedBy}`;
  const reason = `raw fill ${input.table}.${input.field} (${priorRaw} → ${input.newValue}) @ ${reDerived.periodKey}`;
  let cascade: RawFieldEditResult["cascade"];
  let jobId: string | null = null;
  let rescore: unknown = null;

  if (NO_RESCORE_TABLES.has(input.table)) {
    // Display-only (events) — the raw write + re-derive is the whole job; no rescore.
    cascade = "none";
  } else if (PRICE_TABLES.has(input.table)) {
    // Prices are date-indexed (not quarterly) and feed live Market → a current-frame
    // PG rescore of the edited stock's PG(s). triggerRescoreForSymbols returns the
    // pollable PG_RESCORE job id.
    cascade = "prices";
    const out = await triggerRescoreForSymbols([reDerived.symbol], triggeredBy, reason);
    rescore = out;
    jobId = out?.jobIds[0] ?? null;
  } else {
    // Scored + period-based (10 fundamentals + shareholding) → the PG-wide PIT cascade.
    const banking = await bankingPgForSymbol(reDerived.symbol);
    if (banking) {
      cascade = "banking";
      const periods = await scoredBankingPeriods(banking.memberIds);
      const startQ = resolveEditedPeriod(reDerived.edit, periods);
      const out = startQ ? await triggerCasaCascade(reDerived.symbol, startQ, triggeredBy, reason) : null;
      rescore = out;
      jobId = out?.jobId ?? null;
    } else {
      cascade = "general";
      const out = await triggerFillCascade(reDerived.symbol, reDerived.edit, triggeredBy, reason);
      rescore = out;
      jobId = out?.jobId ?? null;
    }
  }

  return { ok: true, reDerived, cascade, jobId, rescore };
}
