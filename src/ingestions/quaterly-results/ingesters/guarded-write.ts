// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE WRITER EVERY RESULT INGESTER GOES THROUGH.
//
// Before this file, all ten ingesters ended in `prisma.X.upsert({ where: key, create: data,
// update: data })` — a full-row rewrite with no guard of any kind. The only thing between a filing
// and that rewrite was picker.ts `decideIngest`, which refreshes whenever the incoming filing date
// is newer than the stored one.
//
// ⚠ THAT GATE MADE HAND-ENTERED ROWS THE MOST EXPOSED ROWS IN THE DATABASE, NOT THE LEAST.
//   The workbook loader sets `filing_date = report_date` — a hand-entered row's true filing date is
//   unknowable, and the period end is the honest reading. But it is also the EARLIEST possible
//   value: a real filing is always dated after the period it reports. MEASURED: 202 of 202 manual
//   rows have filing_date == report_date. So `decideIngest` returns "refresh" for every one of them
//   on first contact with a real filing, and "refresh" went straight to the full-row upsert.
//   This was not a latent risk. It was the default outcome of the next scan.
//
// ── THE THREE MODES ──────────────────────────────────────────────────────────────────────────────
//   fill_null_only   (DEFAULT) writes a column only where the stored value IS NULL
//   insert_if_absent           inserts the row only if the key does not exist; never touches a
//                              row that is already there
//   full_upsert                the old behaviour — and it CANNOT BE REACHED BY DEFAULT. Passing it
//                              requires `fullUpsertReason`, so every such call site is greppable
//                              and carries its own justification in the source.
//
// ── THE FENCE (independent of mode) ──────────────────────────────────────────────────────────────
// No mode, including full_upsert, may overwrite a NON-NULL value on a protected cell. A cell is
// protected when the row carries `source='manual_workbook'`, or when a raw_field_edits row exists
// for that (row, field). This is enforced HERE, in the writer, below the mode switch — a caller
// cannot pass around it because the caller never issues the statement.
//
// Note the fence applies to non-null cells only. A NULL column on a hand-entered row is still
// fillable, and should be: protecting emptiness would freeze a human's partial row forever.
//
// ⚠ FIELD NAMES IN raw_field_edits ARE NOT CONSISTENT. MEASURED: `bse_xbrl_column_fill` and
//   `human:workbook_2026_08_26` write snake_case (`gnpa_absolute`); `human:aman`,
//   `nse_legacy_reparse_s7a2` and the three `zero_block_guard_*` editors write camelCase
//   (`gnpaAbsolute`). A fence matching on the exact string would protect one convention and sail
//   past the other. Everything is canonicalised to lowercase-without-underscores before comparison.
//
// ── LAYER 3 ──────────────────────────────────────────────────────────────────────────────────────
// After EVERY write — not on request — the row is re-read and every protected non-null cell is
// compared against its pre-write value. A single moved cell throws. This is the verifyNoOverwrites
// idea from bse-column-fill.ts, applied inline so it cannot be forgotten at a call site.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../../db/prisma.js";

export type WriteMode = "fill_null_only" | "insert_if_absent" | "full_upsert";

/** What a caller passes. A bare mode string is deliberately NOT accepted for full_upsert — the
 *  only way to construct one is `fullUpsert(reason)`, so `grep -rn "fullUpsert("` enumerates every
 *  full-row rewrite in the codebase, each with its justification written at the site. */
export interface WriteDirective { readonly mode: WriteMode; readonly reason?: string }
export const FILL_NULL_ONLY: WriteDirective = { mode: "fill_null_only" };
export const INSERT_IF_ABSENT: WriteDirective = { mode: "insert_if_absent" };
export function fullUpsert(reason: string): WriteDirective {
  if (!reason.trim()) throw new ProvenanceViolation("fullUpsert() requires a reason — state why a full-row rewrite is correct here.");
  return { mode: "full_upsert", reason };
}

/** Metadata the writer manages; never a "value cell" for fence or fill purposes. */
const NON_VALUE = new Set(["id", "stockId", "symbol", "createdAt", "updatedAt"]);

export interface GuardedWriteResult {
  row: { id: string } & Record<string, unknown>;
  action: "inserted" | "filled" | "overwrote" | "unchanged" | "skipped_present";
  /** Columns actually written. */
  columnsWritten: string[];
  /** Columns the MODE declined (non-null under fill_null_only). Not a violation — the point. */
  columnsSkippedByMode: string[];
  /** Columns the FENCE refused. Non-empty means a pipeline tried to overwrite human data. */
  columnsBlockedByFence: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WritableDelegate {
  findUnique(args: any): Promise<any>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ProvenanceViolation extends Error {
  constructor(message: string) { super(message); this.name = "ProvenanceViolation"; }
}

const canon = (s: string): string => s.replace(/_/g, "").toLowerCase();

/** Minimal shape of a Prisma client OR an interactive-transaction client. Taking one lets a
 *  simulation drive the real writer inside a transaction it then rolls back — the same thing
 *  bse-column-fill.ts does with its TxClient, and the only honest way to prove a fence holds. */
export interface RawCapable { $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> }

/** Every protected cell on this row, canonicalised. `"all"` ⇒ the WHOLE row is protected. */
async function protectedCells(db: RawCapable, modelName: string, rowId: string, source: unknown): Promise<Set<string> | "all"> {
  if (source === "manual_workbook") return "all";
  const rows = await db.$queryRawUnsafe<Array<{ field: string }>>(
    `SELECT DISTINCT field FROM raw_field_edits WHERE target_table = $1 AND target_row_id = $2`,
    modelName, rowId);
  return new Set(rows.map((r) => canon(r.field)));
}

const isProtected = (p: Set<string> | "all", col: string): boolean => p === "all" || p.has(canon(col));

export interface GuardedWriteOpts {
  /** The Prisma delegate, e.g. `prisma.fundamental`.
   *  Method-signature form (not properties) so it is structurally satisfied by Prisma's overloaded
   *  delegates; `any` on the args is what lets one writer serve ten differently-typed models. */
  delegate: WritableDelegate;
  /** Prisma MODEL name as raw_field_edits records it — "Fundamental", not "fundamentals". */
  modelName: string;
  where: unknown;
  data: Record<string, unknown>;
  /** Omit for the safe default (FILL_NULL_ONLY). */
  directive?: WriteDirective;
  /** For error messages: "TCS FY25Q3 standalone". */
  label: string;
  /** Transaction client for the raw_field_edits lookup; defaults to the global client. */
  db?: RawCapable;
}

export async function guardedWrite(o: GuardedWriteOpts): Promise<GuardedWriteResult> {
  const directive = o.directive ?? FILL_NULL_ONLY;
  const mode = directive.mode;
  if (mode === "full_upsert" && !directive.reason)
    throw new ProvenanceViolation(
      `guardedWrite(${o.label}): a full_upsert directive carries no reason. Build it with ` +
      `fullUpsert("why") — the string is what makes every full-row rewrite greppable.`);

  const before = await o.delegate.findUnique({ where: o.where });

  // ── absent row: every mode inserts, and there is nothing to protect ──────────────────────────
  if (!before) {
    const row = await o.delegate.create({ data: o.data }) as { id: string } & Record<string, unknown>;
    return { row, action: "inserted", columnsWritten: Object.keys(o.data), columnsSkippedByMode: [], columnsBlockedByFence: [] };
  }
  const rowId = String(before.id);
  if (mode === "insert_if_absent")
    return { row: before as { id: string } & Record<string, unknown>, action: "skipped_present", columnsWritten: [], columnsSkippedByMode: Object.keys(o.data), columnsBlockedByFence: [] };

  const prot = await protectedCells(o.db ?? prisma, o.modelName, rowId, before.source);

  const writable: Record<string, unknown> = {};
  const skippedByMode: string[] = [];
  const blocked: string[] = [];
  for (const [col, val] of Object.entries(o.data)) {
    if (NON_VALUE.has(col)) continue;
    const cur = before[col];
    const held = cur !== null && cur !== undefined;
    // FENCE FIRST — it outranks the mode, so full_upsert cannot slip past it.
    if (held && isProtected(prot, col)) { blocked.push(col); continue; }
    if (mode === "fill_null_only" && held) { skippedByMode.push(col); continue; }
    writable[col] = val;
  }

  if (!Object.keys(writable).length)
    return { row: before as { id: string } & Record<string, unknown>, action: "unchanged", columnsWritten: [], columnsSkippedByMode: skippedByMode, columnsBlockedByFence: blocked };

  if ("updatedAt" in o.data) writable.updatedAt = o.data.updatedAt;
  const row = await o.delegate.update({ where: o.where, data: writable }) as { id: string } & Record<string, unknown>;

  // ── LAYER 3, every time ─────────────────────────────────────────────────────────────────────
  await assertProtectedCellsUnmoved(o.label, prot, before, row);

  return {
    row,
    action: mode === "full_upsert" ? "overwrote" : "filled",
    columnsWritten: Object.keys(writable).filter((c) => c !== "updatedAt"),
    columnsSkippedByMode: skippedByMode,
    columnsBlockedByFence: blocked,
  };
}

/**
 * Layer (3): independent of the mode switch above, re-derived from the row itself. If a protected
 * cell that HELD a value before the write does not hold the identical value after it, the fence
 * failed and the run stops. Never a warning — a silent provenance breach is the failure this whole
 * file exists to make impossible, and a warning in a nightly log is indistinguishable from silence.
 */
async function assertProtectedCellsUnmoved(
  label: string, prot: Set<string> | "all",
  before: Record<string, unknown>, after: Record<string, unknown>,
): Promise<void> {
  const moved: string[] = [];
  for (const [col, was] of Object.entries(before)) {
    if (NON_VALUE.has(col) || was === null || was === undefined) continue;
    if (!isProtected(prot, col)) continue;
    if (String(after[col]) !== String(was)) moved.push(`${col}: ${String(was)} -> ${String(after[col])}`);
  }
  if (moved.length)
    throw new ProvenanceViolation(
      `guardedWrite(${label}): ${moved.length} PROTECTED cell(s) moved — the fence did not hold.\n` +
      moved.map((m) => `    ${m}`).join("\n") +
      `\n  This row carries hand-entered data that no pipeline can regenerate. The write has already ` +
      `been applied; investigate before re-running.`);
}
