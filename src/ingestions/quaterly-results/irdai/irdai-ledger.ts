// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// JSONL LEDGER — resumability, from line 1.
//
// ⚠ NOTHING IN THIS CODEBASE IS RESUMABLE BY DEFAULT. A run that dies at insurer 7 must not restart
//   at insurer 1 and re-fetch everything: the insurer sites are small and we are a guest on them.
//
// ⚠ WHY A FILE AND NOT result_fetch_logs: that table's unique key is [stockId, quarter, fiscalYear]
//   with NO source column, so an IRDAI ledger row would COLLIDE with the NSE log row for the same
//   period and silently overwrite the NSE lane's own history. Same ruling as bse-ledger.ts. A file
//   needs no migration and cannot touch anything.
//
// Append-only, one JSON object per line, fsync'd per append. A truncated final line (kill -9
// mid-write) is dropped on load and that unit is simply re-attempted, which is safe because every
// write downstream is INSERT … ON CONFLICT DO NOTHING.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

export type LedgerOutcome =
  | "written"
  | "skipped_existing_row"
  | "content_test_failed"
  | "unit_refused"
  | "period_refused"
  | "geometry_refused"
  | "no_fields_extracted"
  | "fetch_failed"
  | "dry_run";

export interface LedgerEntry {
  /** The resume key. One unit of work = one (symbol, grain, period, basis). */
  unit: string;
  symbol: string;
  grain: "quarterly" | "annual";
  period: string;
  basis: "standalone" | "consolidated";
  outcome: LedgerOutcome;
  cells?: number;
  refusals?: string[];
  /** ⚠ recorded per unit: was the chosen column identical to its grain sibling (Q1)? */
  q1Ambiguous?: boolean;
  url?: string;
  note?: string;
  ms?: number;
  at: string;
}

export function unitKey(symbol: string, grain: string, period: string, basis: string): string {
  return `${symbol}|${grain}|${period}|${basis}`;
}

export class IrdaiLedger {
  private readonly done = new Map<string, LedgerEntry>();
  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const l of lines) {
      const t = l.trim();
      if (!t) continue;
      try {
        const e = JSON.parse(t) as LedgerEntry;
        this.done.set(e.unit, e);
      } catch {
        // ⚠ a truncated final line is EXPECTED after a kill -9. Drop it; the unit re-attempts.
      }
    }
  }
  has(unit: string): boolean {
    const e = this.done.get(unit);
    // Re-attempt anything that did not reach a terminal state.
    return !!e && (e.outcome === "written" || e.outcome === "skipped_existing_row");
  }
  get(unit: string): LedgerEntry | undefined {
    return this.done.get(unit);
  }
  append(e: LedgerEntry): void {
    const fd = fs.openSync(this.file, "a");
    try {
      fs.writeSync(fd, JSON.stringify(e) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.done.set(e.unit, e);
  }
  all(): LedgerEntry[] {
    return [...this.done.values()];
  }
}
