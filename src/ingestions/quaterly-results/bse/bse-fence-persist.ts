// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERSISTED FENCE — the baseline written to disk, so a movement can be NAMED after the fact.
//
// ── WHY THIS EXISTS, MEASURED ─────────────────────────────────────────────────────────────────────
// The pilot saw its NSE row count in `quarterly_results` fall 21011 → 21010 and could not say which
// row. The in-memory fence (bse-fence.ts) captures the baseline in the process that is doing the
// writing; when that process exits, the evidence exits with it. The next run has nothing to compare
// against, so a movement between runs is invisible, and a movement inside a run is a uuid.
//
//   THE ROW TURNED OUT TO BE: quarterly_results / ACC / 2018-06-30 / standalone / nse_xbrl_quarterly_legacy,
//   deleted by the nightly `retention_prune` at 2026-08-21T21:30:00.101Z while quarterly_results still
//   had keep=32. The pilot's single pre-prune write (ACC 2021-12-31) took that partition 32 → 33; the
//   cron evicted the oldest row to bring it back to 32. Recovered only because ACC's CONSOLIDATED twin
//   was untouched and still starts at 2018-06-30 — a control that happened to exist. At cohort scale
//   that reconstruction is not available, which is the whole argument for this file.
//
// ── ★ A UUID IS NOT A NAME ────────────────────────────────────────────────────────────────────────
// The in-memory fence WOULD have reported `disappeared <uuid>`. That is not usable: the row is gone,
// so the uuid cannot be resolved to anything afterwards. The baseline therefore persists the human
// identity ALONGSIDE the id — symbol, period, basis, source — captured while the row still existed.
// That is the difference between "a row vanished" and "ACC lost its June-2018 standalone quarter".
//
// ── ★ AND IT WATCHES EVERY SOURCE, NOT JUST NSE ───────────────────────────────────────────────────
// bse-fence.ts filters `source LIKE 'nse\_%'`. The T3 guarantee is about NSE rows, so that is the
// right scope for the ASSERTION — but it is the wrong scope for the OBSERVATION. A `bse_xbrl` or
// hand-filled row evicted by the same retention cron would be equally lost and equally silent. This
// captures every row in the four tables (28,385 today vs 28,362 NSE-only — the cost of the wider net
// is 23 rows) and classifies afterwards.
//
//   VIOLATION (hard)  — an NSE row disappeared, or its updated_at moved.
//   NOTICE   (soft)   — a non-NSE row disappeared, or an unexpected row appeared. Reported, not fatal:
//                       a `bse_xbrl` row appearing IS the lane working.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { FENCED_TABLES, type FencedTable } from "./bse-fence.js";

/** The minimum surface this needs — so the verify can run inside a $transaction client. */
export interface RawClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
}

/** One captured row. Short keys: this file holds ~28k of them. */
export interface BaselineRow {
  /** table */ t: string;
  /** row id */ id: string;
  /** source (null is a real value here — some legacy rows carry none) */ src: string | null;
  /** updated_at, epoch ms */ ua: number;
  /** stock symbol — THE NAME. Captured while the row exists, because afterwards it cannot be. */ sym: string;
  /** report_date (YYYY-MM-DD) for quarterly, fiscal_year for annual */ per: string;
  /** result_type */ basis: string;
}

export interface BaselineHeader {
  __baseline: 1;
  capturedAt: string;
  /** per table: total rows captured */ totals: Record<string, number>;
  /** per table: NSE-sourced rows — the subset the hard assertion covers */ nseTotals: Record<string, number>;
}

/** The period column each table keys its identity on. */
const PERIOD_COL: Record<FencedTable, string> = {
  quarterly_results: "report_date",
  fundamentals: "fiscal_year",
  banking_quarterly_results: "report_date",
  banking_fundamentals: "fiscal_year",
  nbfc_quarterly_results: "report_date",
  nbfc_fundamentals: "fiscal_year",
  life_insurance_quarterly_results: "report_date",
  life_insurance_fundamentals: "fiscal_year",
  general_insurance_quarterly_results: "report_date",
  general_insurance_fundamentals: "fiscal_year",
};

const isNse = (src: string | null): boolean => src != null && src.startsWith("nse_");

// ── CAPTURE ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Snapshot all four tables to `filePath` as JSONL: one header line, then one line per row.
 * fsync'd before returning — a baseline that is still in the OS page cache when the machine
 * dies is a baseline that was never taken.
 */
export async function persistBaseline(db: RawClient, filePath: string): Promise<BaselineHeader> {
  const totals: Record<string, number> = {};
  const nseTotals: Record<string, number> = {};
  const chunks: string[] = [];

  for (const t of FENCED_TABLES) {
    const per = PERIOD_COL[t];
    // ⚠ Table/column names come from the FENCED_TABLES literal union and PERIOD_COL only — never input.
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; source: string | null; updated_at: Date; symbol: string; per: string; result_type: string }>
    >(
      `SELECT x.id, x.source, x.updated_at, s.symbol, x."${per}"::text AS per, x.result_type
         FROM ${t} x JOIN stocks s ON s.id = x.stock_id`,
    );
    totals[t] = rows.length;
    nseTotals[t] = rows.filter((r) => isNse(r.source)).length;
    for (const r of rows) {
      const row: BaselineRow = {
        t,
        id: r.id,
        src: r.source,
        ua: new Date(r.updated_at).getTime(),
        sym: r.symbol,
        per: (r.per ?? "").slice(0, 10),
        basis: r.result_type,
      };
      chunks.push(JSON.stringify(row));
    }
  }

  const header: BaselineHeader = {
    __baseline: 1,
    capturedAt: new Date().toISOString(),
    totals,
    nseTotals,
  };

  const fd = openSync(filePath, "w");
  try {
    writeSync(fd, JSON.stringify(header) + "\n");
    // Write in blocks rather than 28k syscalls.
    for (let i = 0; i < chunks.length; i += 2000) {
      writeSync(fd, chunks.slice(i, i + 2000).join("\n") + "\n");
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return header;
}

// ── LOAD ──────────────────────────────────────────────────────────────────────────────────────────

export interface LoadedBaseline {
  header: BaselineHeader;
  /** table -> id -> row */
  byTable: Record<string, Map<string, BaselineRow>>;
}

/** Tolerates a torn final line, the same way bse-ledger.ts does — a half-written row is not a crash. */
export function loadBaseline(filePath: string): LoadedBaseline {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  let header: BaselineHeader | null = null;
  const byTable: Record<string, Map<string, BaselineRow>> = {};
  for (const t of FENCED_TABLES) byTable[t] = new Map();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (i === lines.length - 1) continue; // torn tail
      throw new Error(`baseline ${filePath} line ${i + 1} is not JSON and is not the final line`);
    }
    if ((parsed as BaselineHeader).__baseline === 1) {
      header = parsed as BaselineHeader;
      continue;
    }
    const r = parsed as BaselineRow;
    byTable[r.t]?.set(r.id, r);
  }
  if (!header) throw new Error(`baseline ${filePath} has no header line`);
  return { header, byTable };
}

// ── VERIFY ────────────────────────────────────────────────────────────────────────────────────────

export interface NamedMovement {
  severity: "violation" | "notice";
  table: string;
  kind: "disappeared" | "updated" | "appeared";
  rowId: string;
  /** The whole point of this file: a sentence a person can act on. */
  name: string;
  detail: string;
}

export interface PersistedFenceReport {
  ok: boolean;
  capturedAt: string;
  movements: NamedMovement[];
  violations: number;
  notices: number;
  /** Layer (3), unchanged: NSE rows whose updated_at moved after the run started. */
  touchedSinceStart: Record<string, number>;
  beforeTotals: Record<string, number>;
  afterTotals: Record<string, number>;
  beforeNse: Record<string, number>;
  afterNse: Record<string, number>;
}

/**
 * Diff the live tables against a persisted baseline. Every movement is NAMED.
 * `runStart` may be null to skip layer (3) (a between-runs check has no run to bound).
 *
 * ── ★ `targeted` — WHY THE INVARIANT HAD TO CHANGE ────────────────────────────────────────────────
 * The original fence asserted "no NSE row's updated_at may move". The null-only column fill
 * (bse-column-fill.ts) moves it ON PURPOSE — filling a null on an NSE row is the whole point of that
 * path. Left unchanged, the fence would fail every correct column-fill run, and a guard that cries on
 * correct behaviour gets switched off, which is strictly worse than not having one.
 *
 * So the invariant becomes the one the workbook import already used:
 *   · an UNTARGETED NSE row that moves        → VIOLATION (unchanged, this is the T3 guarantee)
 *   · a TARGETED NSE row that moves           → notice; it was supposed to
 *   · ANY NSE row that DISAPPEARS              → VIOLATION, targeted or not. Nothing licenses a delete.
 *
 * Pass the ids the run deliberately wrote to. Omit it and the old, stricter invariant applies —
 * which is what an INSERT-only run should do, because it targets no existing row at all.
 */
export async function verifyAgainstPersisted(
  db: RawClient,
  baseline: LoadedBaseline,
  runStart: Date | null,
  targeted?: ReadonlySet<string>,
): Promise<PersistedFenceReport> {
  const movements: NamedMovement[] = [];
  const touchedSinceStart: Record<string, number> = {};
  const afterTotals: Record<string, number> = {};
  const afterNse: Record<string, number> = {};
  const beforeTotals: Record<string, number> = {};
  const beforeNse: Record<string, number> = {};

  for (const t of FENCED_TABLES) {
    const per = PERIOD_COL[t];
    const after = await db.$queryRawUnsafe<
      Array<{ id: string; source: string | null; updated_at: Date; symbol: string; per: string; result_type: string }>
    >(
      `SELECT x.id, x.source, x.updated_at, s.symbol, x."${per}"::text AS per, x.result_type
         FROM ${t} x JOIN stocks s ON s.id = x.stock_id`,
    );
    const seen = new Map<string, BaselineRow>();
    for (const r of after) {
      seen.set(r.id, {
        t, id: r.id, src: r.source, ua: new Date(r.updated_at).getTime(),
        sym: r.symbol, per: (r.per ?? "").slice(0, 10), basis: r.result_type,
      });
    }
    afterTotals[t] = seen.size;
    afterNse[t] = [...seen.values()].filter((r) => isNse(r.src)).length;

    const base = baseline.byTable[t] ?? new Map<string, BaselineRow>();
    beforeTotals[t] = base.size;
    beforeNse[t] = [...base.values()].filter((r) => isNse(r.src)).length;

    // ── gone / moved ──────────────────────────────────────────────────────────
    for (const [id, was] of base) {
      const now = seen.get(id);
      const label = `${was.sym} ${was.per} ${was.basis} (${was.src ?? "no source"})`;
      if (now === undefined) {
        movements.push({
          severity: isNse(was.src) ? "violation" : "notice",
          table: t, kind: "disappeared", rowId: id, name: label,
          detail: `present at baseline, gone now — last updated_at ${new Date(was.ua).toISOString()}`,
        });
      } else if (now.ua !== was.ua) {
        const wasTargeted = targeted?.has(id) ?? false;
        movements.push({
          // A targeted row moving is the run doing its job. An untargeted NSE row moving is the breach.
          severity: isNse(was.src) && !wasTargeted ? "violation" : "notice",
          table: t, kind: "updated", rowId: id, name: label,
          detail: `updated_at ${new Date(was.ua).toISOString()} → ${new Date(now.ua).toISOString()}${wasTargeted ? " (TARGETED — expected)" : ""}`,
        });
      }
    }

    // ── appeared ──────────────────────────────────────────────────────────────
    // A bse_xbrl row appearing is the lane working. Anything else is worth a look.
    for (const [id, now] of seen) {
      if (base.has(id)) continue;
      const expected = now.src === "bse_xbrl";
      movements.push({
        severity: expected ? "notice" : "notice",
        table: t, kind: "appeared", rowId: id,
        name: `${now.sym} ${now.per} ${now.basis} (${now.src ?? "no source"})`,
        detail: expected ? "new bse_xbrl row — expected" : `NEW ROW from an unexpected source: ${now.src ?? "null"}`,
      });
    }

    // ── layer (3): independent, source-based ──────────────────────────────────
    if (runStart) {
      // Targeted rows are excluded HERE too, or layer (3) would contradict layer (2) on a correct
      // column-fill run — the same reason the `updated` severity is downgraded above.
      const cnt = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM ${t}
          WHERE source LIKE 'nse\\_%' AND updated_at > $1 AND id <> ALL($2::text[])`,
        runStart,
        targeted ? [...targeted] : [],
      );
      touchedSinceStart[t] = Number(cnt[0]?.n ?? 0n);
    } else {
      touchedSinceStart[t] = 0;
    }
  }

  const violations = movements.filter((m) => m.severity === "violation").length;
  const anyTouched = Object.values(touchedSinceStart).some((n) => n > 0);
  return {
    ok: violations === 0 && !anyTouched,
    capturedAt: baseline.header.capturedAt,
    movements,
    violations,
    notices: movements.length - violations,
    touchedSinceStart,
    beforeTotals,
    afterTotals,
    beforeNse,
    afterNse,
  };
}
