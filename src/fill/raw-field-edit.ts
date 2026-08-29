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
import { invalidateBriefsForEdit } from "../insight/quarter-brief/invalidate.js";
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
    // ── S6c: added for the keyed-workbook import. All three are RAW disclosed balance-sheet /
    //    cash-flow lines, not derived columns, and nothing in this file excluded them on purpose —
    //    the set simply grew around what the scorer happened to need. `cashFromOperating` and
    //    `capex` were already here; `cashFromFinancing` is its sibling and feeds the same
    //    derived netCashFlow. Checked against the derive layer: none of the three is computed.
    "propertyPlantAndEquipment", "capitalWorkInProgress", "cashFromFinancing",
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
    // ── S6c: added for the keyed-workbook import. `operatingExpenses` is a RAW line the banking
    //    Reg-33 format discloses explicitly; costToIncomeRatio and expenditureExclProvisions are
    //    computed FROM it, so it is a source, not a derivative. Its absence was an asymmetry —
    //    BankingFundamental carries the same family of raw lines — not a deliberate exclusion.
    "operatingExpenses",
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
  // ── Step 9 (AMFI). currentNav ONLY — deliberately.
  //    `isin` is NOT fillable and must never become so: the bridge is numeric-only, and more
  //    importantly a hand-typed ISIN POISONS THE SPINE (universe-admit.ts: "a fabricated ISIN
  //    would be accepted by the unique index and would look fine — until the real security
  //    arrived"). An AMFI ISIN fault is resolutionPath=source_code — only AMFI can fix it.
  //    A NAV, by contrast, an admin CAN honestly source and cite.
  Instrument: new Set(["currentNav"]),
  // ── Steps 14 / 15 / 17. The NON-EQUITY price spine — a trust's, a G-sec's or a bond's close.
  //    The DailyPrice analogue, and it exists for the same reason: a range guard on `close` is a
  //    LANDS-AND-FLAGS guard (the row is written, then flagged), so an operator who can source and
  //    CITE the true close must be able to correct it.
  //
  //    THIS WAS A BROKEN PROMISE UNTIL NOW. The three lanes all reported their range violation as
  //    resolutionPath="admin_fill" while `InstrumentPrice` was absent from this map — so the triage
  //    UI rendered a green "Fully resolves by filling" and then offered NO FILL BUTTON, because
  //    annotateFill returns fill:null for a table the bridge does not cover. The row said "an admin
  //    can fix this" and gave the admin no way to do it.
  //
  //    `isin` is NOT here, and must never be — same reason as Instrument above: a hand-typed ISIN
  //    poisons the spine. Only the numbers are fillable.
  InstrumentPrice: new Set(["close", "open", "high", "low", "prevClose", "tradedValue"]),
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
  /**
   * ★ S6c — NULL-ONLY MODE. The UPDATE carries `AND <field> IS NULL`, so it can only ever turn a
   * blank into a value. If the column already holds anything the edit does NOT land: no write, no
   * re-derive, no audit row, and ok:false with reason "target column already holds a value".
   *
   * ⚠ WHY THIS OPTION EXISTS. This path was built as a CORRECTION path — its whole point is to
   *   overwrite a wrong value and record the prior one in the audit. That is right for an admin
   *   fixing one cell with a citation. It is WRONG for a bulk import of 6,584 hand-keyed cells,
   *   where the guarantee has to be "a blank became a value" and nothing else. Defaults to false,
   *   so every existing caller behaves exactly as before.
   */
  onlyIfNull?: boolean;
  /**
   * ★ S7 A2 — EXACT-VALUE MODE. The UPDATE carries `AND <field> = <onlyIfExactly>`, so it can
   * only ever replace THAT value. Anything else in the column and the edit does not land: no
   * write, no re-derive, no audit row, ok:false.
   *
   * ⚠ WHY THIS EXISTS, AND WHY IT IS NOT A GENERAL OVERWRITE. The legacy NSE parser divided a
   *   ratio by 1e7 (ReturnOnAssets declares unitRef="INR"), and Decimal(8,6) truncated the result
   *   to EXACTLY 0 on 241 of 243 banking_fundamentals.roa_disclosed rows. Those cells are not
   *   blanks — they are wrong numbers reading as real measurements — so onlyIfNull cannot reach
   *   them, and a plain overwrite would also flatten the rows where the filer's unit declaration
   *   was correct and the stored value is right. J&KBANK FY22 (both bases) stores a correct
   *   0.0042 from a document that declares `pure`; this predicate is what leaves it alone.
   *
   * ⚠ THE GUARANTEE IS IN THE PREDICATE, exactly as with onlyIfNull. The read below is for the
   *   audit trail only; a concurrent write between read and update cannot be clobbered.
   *
   * Mutually exclusive with onlyIfNull. Defaults to undefined, so every existing caller is
   * byte-identical.
   */
  onlyIfExactly?: number;
  /**
   * ★ S6c — suppress the PG-wide rescore cascade AND the quarter-brief invalidation. Used by the
   * bulk import, which runs in a stage that has ruled out scoring entirely. Defaults to false.
   * `cascade` comes back as "suppressed" so the caller can assert nothing was enqueued.
   */
  skipCascade?: boolean;
}

export interface RawFieldEditResult {
  ok: boolean;
  reason?: string;
  reDerived?: ReDeriveResult;
  /** Which rescore route ran: banking/general = the PG-wide PIT cascade job;
   *  prices = a current-frame PG rescore job; none = display-only (events, no
   *  rescore — the fill is complete synchronously). */
  cascade?: "banking" | "general" | "prices" | "none" | "suppressed";
  /** True when onlyIfNull refused because the column already held a value. Not an error. */
  refusedNotNull?: boolean;
  /** True when onlyIfExactly refused because the column did not hold the expected value. Not an error. */
  refusedGuard?: boolean;
  /** Pollable job id for the rescore (null for "none"/display-only). */
  jobId?: string | null;
  rescore?: unknown;
}

/** Thrown inside the transaction when onlyIfNull finds a non-null column, so the whole edit
 *  (write + re-derive + audit) rolls back as one. Distinguished from a real write failure. */
class ONLY_IF_NULL_REFUSED extends Error {}
/** Same rollback shape, for the onlyIfExactly guard. */
class ONLY_IF_EXACT_REFUSED extends Error {}

export interface RowEdit {
  field: string;
  newValue: number | null;
  citation: string;
}
export interface RowBatchResult {
  ok: boolean;
  reason?: string;
  landed: string[];
  /** Fields skipped because the column already held a value. Not an error. */
  refusedNotNull: string[];
  reDerived?: ReDeriveResult;
}

/**
 * ★ S6c — APPLY MANY NULL-ONLY EDITS TO ONE ROW, IN ONE TRANSACTION.
 *
 * Identical semantics to applyRawFieldEdit(onlyIfNull:true, skipCascade:true), batched by row:
 *   · every field's UPDATE still carries `AND <field> IS NULL` — the guarantee is unchanged
 *   · one audit row per LANDED cell, each with its own citation — the provenance is unchanged
 *   · ONE re-derive at the end instead of one per cell — and that is more correct, not less:
 *     the derived columns are a function of the row's FINAL raw state, so deriving after each
 *     individual cell just computes intermediate values on a half-filled row and throws them away
 *   · no cascade, no brief invalidation
 *
 * ⚠ WHY IT EXISTS: this database is remote and a bare round trip MEASURED 547 ms, an empty
 *   transaction 224 ms. Per-cell that is ~2 s × 6,584 cells ≈ 3.7 hours, and the cost is latency,
 *   not work. The 6,584 cells sit on 413 rows — 16 cells per row — so batching by row cuts the
 *   transaction count 16-fold without weakening a single guarantee.
 */
export async function applyRawFieldEditsForRow(
  table: string,
  rowId: string,
  edits: RowEdit[],
  editedBy: string,
): Promise<RowBatchResult> {
  const allowed = FILLABLE[table];
  if (!allowed) return { ok: false, reason: `table "${table}" not enabled for raw-field fill`, landed: [], refusedNotNull: [] };
  for (const e of edits) {
    if (!allowed.has(e.field)) return { ok: false, reason: `field "${e.field}" is not RAW-fillable on ${table}`, landed: [], refusedNotNull: [] };
    if (!e.citation || e.citation.trim().length < 4) return { ok: false, reason: `citation required (CN-4) for ${e.field}`, landed: [], refusedNotNull: [] };
    if (e.newValue !== null && !Number.isFinite(e.newValue)) return { ok: false, reason: `newValue for ${e.field} must be finite or null`, landed: [], refusedNotNull: [] };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const model = (tx as unknown as Record<string, {
        findUniqueOrThrow: (a: unknown) => Promise<unknown>;
        updateMany: (a: unknown) => Promise<{ count: number }>;
      }>)[modelKey(table)];

      const sel: Record<string, boolean> = {};
      for (const e of edits) sel[e.field] = true;
      const before = (await model.findUniqueOrThrow({ where: { id: rowId }, select: sel })) as Record<string, Prisma.Decimal | null>;

      const landed: string[] = [];
      const refusedNotNull: string[] = [];
      for (const e of edits) {
        const res = await model.updateMany({ where: { id: rowId, [e.field]: null }, data: { [e.field]: e.newValue } });
        if (res.count === 1) landed.push(e.field);
        else refusedNotNull.push(e.field);
      }

      if (landed.length) {
        const reDerived = await reDeriveRow(tx, table, rowId);
        await (tx as Prisma.TransactionClient).rawFieldEdit.createMany({
          data: landed.map((f) => {
            const e = edits.find((x) => x.field === f)!;
            return {
              targetTable: table, targetRowId: rowId, field: f,
              oldValue: before[f]?.toString() ?? null,
              newValue: e.newValue?.toString() ?? null,
              citation: e.citation, editedBy, note: null,
            };
          }),
        });
        return { ok: true, landed, refusedNotNull, reDerived };
      }
      return { ok: true, landed, refusedNotNull };
    }, { timeout: 60_000 });
  } catch (e) {
    return { ok: false, reason: `write failed: ${(e as Error).message}`, landed: [], refusedNotNull: [] };
  }
}

function validate(input: RawFieldEditInput): string | null {
  if (!input.citation || input.citation.trim().length < 4) return "citation required (CN-4): provide a source attribution";
  if (input.onlyIfNull && input.onlyIfExactly !== undefined) return "onlyIfNull and onlyIfExactly are mutually exclusive";
  if (input.onlyIfExactly !== undefined && !Number.isFinite(input.onlyIfExactly)) return "onlyIfExactly must be a finite number";
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
      const model = (tx as unknown as Record<string, {
        findUniqueOrThrow: (a: unknown) => Promise<unknown>;
        update: (a: unknown) => Promise<unknown>;
        updateMany: (a: unknown) => Promise<{ count: number }>;
      }>)[modelKey(input.table)];
      const before = await model.findUniqueOrThrow({ where: { id: input.rowId }, select: { [input.field]: true } });
      const priorRaw = ((before as Record<string, Prisma.Decimal | null>)[input.field])?.toString() ?? null;

      if (input.onlyIfNull) {
        // ⚠ THE GUARANTEE IS IN THE PREDICATE, NOT IN THE READ ABOVE. `updateMany` with
        //   `{ [field]: null }` in the WHERE compiles to `UPDATE … WHERE id = $1 AND col IS NULL`,
        //   so a concurrent write between the read and the update cannot be clobbered. A
        //   read-then-update would be a race; this cannot be. count === 0 ⇒ the column was not null.
        const res = await model.updateMany({
          where: { id: input.rowId, [input.field]: null },
          data: { [input.field]: input.newValue },
        });
        if (res.count !== 1) {
          throw new ONLY_IF_NULL_REFUSED(
            `target column ${input.table}.${input.field} already holds a value (${priorRaw}) — null-only edit refused`,
          );
        }
      } else if (input.onlyIfExactly !== undefined) {
        // The predicate, not the read above, is the guarantee - same shape as onlyIfNull.
        // Compiles to `UPDATE ... WHERE id = $1 AND col = $2`.
        const res = await model.updateMany({
          where: { id: input.rowId, [input.field]: input.onlyIfExactly },
          data: { [input.field]: input.newValue },
        });
        if (res.count !== 1) {
          throw new ONLY_IF_EXACT_REFUSED(
            `target column ${input.table}.${input.field} holds ${priorRaw}, not the expected ${input.onlyIfExactly} - guarded edit refused`,
          );
        }
      } else {
        await model.update({ where: { id: input.rowId }, data: { [input.field]: input.newValue } });
      }

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
    if (e instanceof ONLY_IF_NULL_REFUSED) return { ok: false, reason: e.message, refusedNotNull: true };
    if (e instanceof ONLY_IF_EXACT_REFUSED) return { ok: false, reason: e.message, refusedGuard: true };
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

  if (input.skipCascade) {
    // ★ S6c — no rescore job, no brief invalidation, nothing enqueued. The caller has ruled scoring
    //   out of scope for this stage and asserts afterwards that zero jobs were created.
    return { ok: true, reDerived, cascade: "suppressed", jobId: null, rescore: null };
  }

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

  // ── QUARTER IN BRIEF — withdraw any brief this correction could have falsified, and queue it back.
  // Runs for EVERY cascade branch (including "none"): a brief reads the quarterly tables directly, so
  // whether the SCORER cares about this edit is a different question from whether a READER does.
  // No-ops for the tables a brief never reads — see invalidate.ts.
  const briefs = await invalidateBriefsForEdit(
    input.table, reDerived.symbol, reDerived.periodKey, reason, triggeredBy,
  );
  if (briefs.marked > 0) {
    console.log(`[quarter-brief] ${reDerived.symbol}: ${briefs.marked} brief(s) stale, ${briefs.enqueued} queued to return (${reason})`);
  }

  return { ok: true, reDerived, cascade, jobId, rescore };
}
