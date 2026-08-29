// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// JSONL LEDGER — resumability, from line 1.
//
// ⚠ NOTHING IN THIS CODEBASE IS RESUMABLE BY DEFAULT. backfill-legacy.ts has no cursor and no
//   checkpoint; a universe run that dies at stock 400 restarts at stock 1. This lane cannot work
//   that way, because the ONE failure mode we know it will hit — the throttle — stops the run
//   deliberately and expects to be resumed a couple of minutes later.
//
// ⚠ WHY A FILE AND NOT result_fetch_logs: that table's unique key is [stockId, quarter, fiscalYear]
//   with NO source column, so a BSE ledger row would COLLIDE with the NSE log row for the same
//   period — silently overwriting the NSE lane's own history. A file needs no migration and cannot
//   touch anything.
//
// Append-only, one JSON object per line, fsync'd per append. A truncated final line (kill -9 mid
// write) is tolerated on load: the line is dropped and that unit is simply re-attempted, which is
// safe because every write downstream is INSERT … ON CONFLICT DO NOTHING.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

export type LedgerOutcome =
  | "written"
  /** step 6b: the row already existed and the null-only fill landed at least one cell. */
  | "columns_filled"
  | "skipped_nse_holds"
  | "listed_without_xbrl"
  | "not_listed"
  | "unresolved_scrip"
  | "period_assert_failed"
  | "parse_failed"
  | "fetch_failed"
  | "dry_run";

export interface LedgerEntry {
  /** The resume key. One unit of work = one (symbol, grain, period, basis). */
  unit: string;
  symbol: string;
  scripCode: string | null;
  grain: "quarterly" | "annual";
  period: string;
  basis: "standalone" | "consolidated";
  outcome: LedgerOutcome;
  /** Fields the ratio gate refused for this unit. */
  refusedRatios?: string[];
  note?: string;
  at: string;
}

export function unitKey(
  symbol: string,
  grain: "quarterly" | "annual",
  period: string,
  basis: "standalone" | "consolidated",
): string {
  return `${symbol}|${grain}|${period}|${basis}`;
}

export class BseLedger {
  private readonly done = new Set<string>();
  private readonly fd: number;
  /** Units recorded per outcome, for the run report. */
  readonly counts: Record<string, number> = {};

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let e: LedgerEntry;
        try {
          e = JSON.parse(t) as LedgerEntry;
        } catch {
          // A torn final line from an abrupt kill. Drop it; the unit re-runs, and every downstream
          // write is conflict-safe, so re-running cannot double-write.
          continue;
        }
        if (e.unit) {
          this.done.add(e.unit);
          this.counts[e.outcome] = (this.counts[e.outcome] ?? 0) + 1;
        }
      }
    }
    this.fd = fs.openSync(file, "a");
  }

  /** True when this unit has already been decided in a previous run. */
  has(unit: string): boolean {
    return this.done.has(unit);
  }

  get completed(): number {
    return this.done.size;
  }

  append(entry: Omit<LedgerEntry, "at">): void {
    const full: LedgerEntry = { ...entry, at: new Date().toISOString() };
    fs.writeSync(this.fd, JSON.stringify(full) + "\n");
    fs.fsyncSync(this.fd);
    this.done.add(full.unit);
    this.counts[full.outcome] = (this.counts[full.outcome] ?? 0) + 1;
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }

  get path(): string {
    return this.file;
  }
}
