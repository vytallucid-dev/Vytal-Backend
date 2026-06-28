// File: src/ingestions/bank-supplementary/inject-casa.ts
//
// LIVE CASA INJECTION — the operator tool to add/update a bank's CASA value as it's
// released (quarterly results), feeding live banking F7 scoring. CASA-ONLY by design:
// Tier-1 is XBRL-primary (cet1+at1 resolve 12/12) and needs NO manual injection — any
// metricKey ≠ casa_pct is REJECTED here.
//
// REUSE (not a parallel store): writes the SAME BankSupplementary model + the SAME
// append-only supersede chain (version / supersedesId) the bulk load uses. The write
// is tx-INJECTABLE (pass a Prisma.TransactionClient) so it can be proven in a
// rolled-back transaction without durable writes.
//
// THE GATES (in order; ALL must pass or the inject is REJECTED with reasons):
//   1. metricKey            — must be "casa_pct" (CASA-only; Tier-1 is XBRL).
//   2. symbol               — must be one of the 12 PG5/PG6 banking-PG banks.
//   3. fiscalYear           — "FYxx" (a real FY; "LIVE" not accepted — quarterly model).
//   3b. quarter             — REQUIRED "Q1".."Q4" (what makes the row quarter-keyed).
//   4. value (UNIT gate)    — CASA percent in the sanity band [15, 60]. Rejects the
//                             0.34-vs-34 fraction trap and out-of-band typos.
//   5. sourceCitation (CN-4)— REQUIRED, non-empty. A found value with no attribution is
//                             REJECTED. This is the core correctness rule.
//   6. confidence           — "A"|"B"|"C". "C" is ACCEPTED but WARNED (operator verify).
//   7. sourceDate/periodEnd — a disclosure date is required to stamp the found row.
//
// SUPERSEDE: injecting a CASA for an existing (symbol, casa_pct, fiscalYear, quarter)
// cell creates a NEW version (version+1, supersedesId → prior); the prior row is retained
// (audit). A new quarter is a fresh row (version 1). The live read uses the highest-version
// row per cell. Legacy quarter=null rows (LIVE/annual) are never matched here (distinct cell).

import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export const CASA_BAND = { lo: 15, hi: 60 } as const;
const VALID_CONFIDENCE = new Set(["A", "B", "C"]);
const FY_RE = /^FY\d{2}$/; // quarterly model: a quarter-keyed CASA uses a real FY (not "LIVE")
const QUARTER_RE = /^Q[1-4]$/; // "Q1".."Q4"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** DB client OR a transaction client — the write is tx-injectable for rolled-back proofs. */
type Db = Prisma.TransactionClient | typeof prisma;

export interface LiveCasaInput {
  symbol: string;
  fiscalYear: string; // "FY26" (a real FY — the quarterly model)
  quarter: string; // "Q1".."Q4" — REQUIRED (the quarterly model)
  periodEnd?: string | null; // "DD-Mon-YYYY" or "YYYY-MM-DD" — dates the disclosure
  value: number; // CASA PERCENT (e.g. 38.4, NOT 0.384)
  sourceCitation: string; // REQUIRED (CN-4)
  confidence: string; // "A"|"B"|"C"
  notes?: string | null;
  metricKey?: string; // optional; if present MUST be "casa_pct"
  enteredBy: string;
}

export interface LiveCasaResult {
  ok: boolean;
  action?: "inserted" | "superseded" | "unchanged";
  version?: number;
  rowId?: string;
  symbol?: string;
  fiscalYear?: string;
  quarter?: string;
  value?: number;
  supersededId?: string | null;
  warnings: string[];
  errors: string[];
}

function parsePeriodEnd(raw: string): string | null {
  if (DATE_RE.test(raw)) return raw; // already YYYY-MM-DD
  const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTH[m[2]];
  return mon ? `${m[3]}-${mon}-${m[1]}` : null;
}

/** The 12 banking-PG banks (PG5 Private + PG6 PSU), resolved from the DB rosters. */
export async function bankingPgSymbols(db: Db = prisma): Promise<Set<string>> {
  const pgs = await db.peerGroup.findMany({
    where: { name: { in: ["Large-Cap Private Banks", "Large-Cap PSU Banks"] } },
    include: { stocks: { include: { stock: { select: { symbol: true } } } } },
  });
  const set = new Set<string>();
  for (const pg of pgs) for (const s of pg.stocks) set.add(s.stock.symbol);
  return set;
}

/**
 * Validate + inject ONE live CASA value. ALL gates must pass or it's REJECTED (ok:false,
 * errors[]). On accept, performs the append-only supersede write on the passed db client.
 */
export async function injectLiveCasa(input: LiveCasaInput, db: Db = prisma): Promise<LiveCasaResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. metricKey — CASA-ONLY.
  const metricKey = input.metricKey ?? "casa_pct";
  if (metricKey !== "casa_pct") {
    errors.push(`metricKey must be "casa_pct" — this pipeline is CASA-ONLY. Tier-1 is XBRL-primary (cet1+at1 resolve 12/12) and has NO manual injection. Got ${JSON.stringify(input.metricKey)}.`);
  }

  // 2. symbol — must be one of the 12 PG5/PG6 banking-PG banks.
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  let stockId = "";
  const banks = await bankingPgSymbols(db);
  if (!symbol) {
    errors.push("symbol is required.");
  } else if (!banks.has(symbol)) {
    errors.push(`symbol "${symbol}" is not one of the 12 PG5/PG6 banking-PG banks [${[...banks].sort().join(", ")}].`);
  } else {
    const st = await db.stock.findFirst({ where: { symbol }, select: { id: true, industryType: true } });
    if (!st) errors.push(`symbol "${symbol}" has no Stock row.`);
    else if (st.industryType !== "banking") errors.push(`symbol "${symbol}" is not a bank (industryType=${st.industryType}).`);
    else stockId = st.id;
  }

  // 3. fiscalYear — a real FY ("FYxx"). The quarterly model keys CASA per (FY, quarter);
  //    "LIVE" is no longer accepted here (legacy LIVE rows stay as a read-fallback tier).
  const fiscalYear = typeof input.fiscalYear === "string" ? input.fiscalYear.trim() : "";
  if (!FY_RE.test(fiscalYear)) errors.push(`fiscalYear must be "FYxx" (e.g. "FY26"), got ${JSON.stringify(input.fiscalYear)}. The quarterly CASA model uses a real fiscal year + quarter; "LIVE" is not accepted (legacy LIVE rows are preserved as a read-fallback, not re-written here).`);

  // 3b. quarter — REQUIRED, "Q1".."Q4" (the quarterly model). This is what makes the row
  //     quarter-keyed (tier-1 read). A row's cell is (stockId, casa_pct, fiscalYear, quarter).
  const quarter = typeof input.quarter === "string" ? input.quarter.trim().toUpperCase() : "";
  if (!QUARTER_RE.test(quarter)) errors.push(`quarter must be "Q1", "Q2", "Q3", or "Q4", got ${JSON.stringify(input.quarter)}.`);

  // 4. value — UNIT gate: CASA percent in [15, 60] (catches the 0.34-vs-34 fraction trap).
  const value = input.value;
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push(`value must be a number (CASA percent), got ${JSON.stringify(value)}.`);
  } else if (value < CASA_BAND.lo || value > CASA_BAND.hi) {
    errors.push(`CASA value ${value} is OUTSIDE the sanity band [${CASA_BAND.lo}, ${CASA_BAND.hi}]%. CASA is a PERCENT (e.g. 34.0, not 0.34). Rejected — likely a fraction entered for a percent, or a typo.`);
  }

  // 5. sourceCitation — CN-4 HARD GATE: a found value MUST carry its attribution.
  const sourceCitation = typeof input.sourceCitation === "string" ? input.sourceCitation.trim() : "";
  if (!sourceCitation) {
    errors.push(`sourceCitation is REQUIRED (CN-4) — a live CASA value enters scoring as a "found" row, and a found value MUST be attributed. No source ⇒ REJECTED. No live CASA enters scoring without a citation.`);
  }

  // 6. confidence — A/B/C; C accepted but warned.
  const confidence = typeof input.confidence === "string" ? input.confidence.trim().toUpperCase() : "";
  if (!VALID_CONFIDENCE.has(confidence)) {
    errors.push(`confidence must be "A", "B", or "C", got ${JSON.stringify(input.confidence)}.`);
  } else if (confidence === "C") {
    warnings.push(`confidence=C (secondary source) — ACCEPTED but the operator should VERIFY this value before trusting the score it feeds (same handling as the loaded C-cells).`);
  }

  // 7. sourceDate — from periodEnd (or already-YYYY-MM-DD); required to stamp the found row.
  let sourceDate: Date | null = null;
  if (input.periodEnd && typeof input.periodEnd === "string") {
    const iso = parsePeriodEnd(input.periodEnd.trim());
    if (!iso) errors.push(`periodEnd must be "DD-Mon-YYYY" or "YYYY-MM-DD", got ${JSON.stringify(input.periodEnd)}.`);
    else {
      const d = new Date(`${iso}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) errors.push(`periodEnd is not a valid date: ${input.periodEnd}.`);
      else sourceDate = d;
    }
  } else {
    errors.push(`periodEnd is required (DD-Mon-YYYY or YYYY-MM-DD) — the found CASA row must be dated to its disclosure.`);
  }

  if (errors.length > 0) {
    return { ok: false, warnings, errors };
  }

  // ── APPEND-ONLY SUPERSEDE WRITE (mirrors the BankSupplementary supersede chain) ──
  // Read-before-write: the latest version for this exact (stock, casa_pct, fiscalYear,
  // quarter) cell. Re-submitting FY26/Q2 ⇒ version+1 with supersedesId → prior; a new
  // quarter (FY26/Q3) finds nothing ⇒ version 1 (a new row). Legacy quarter=null rows
  // (LIVE / annual) are DISTINCT from any FYxx/Qn cell and are never matched/mutated here.
  // Identical value+source ⇒ no-op (unchanged).
  const latest = await db.bankSupplementary.findFirst({
    where: { stockId, metric: "casa_pct", fiscalYear, quarter },
    orderBy: { version: "desc" },
    select: { id: true, version: true, value: true, sourceCitation: true },
  });

  if (latest && latest.value !== null && latest.value.equals(value) && latest.sourceCitation === sourceCitation) {
    return { ok: true, action: "unchanged", version: latest.version, rowId: latest.id, symbol, fiscalYear, quarter, value, supersededId: null, warnings, errors: [] };
  }

  const row = await db.bankSupplementary.create({
    data: {
      stockId, symbol, metric: "casa_pct", fiscalYear, quarter,
      value, sourceCitation, sourceDate, confidence, status: "found", notes: input.notes ?? null,
      version: latest ? latest.version + 1 : 1,
      supersedesId: latest ? latest.id : null,
      enteredBy: input.enteredBy,
    },
    select: { id: true, version: true },
  });

  return {
    ok: true,
    action: latest ? "superseded" : "inserted",
    version: row.version,
    rowId: row.id,
    symbol, fiscalYear, quarter, value,
    supersededId: latest?.id ?? null,
    warnings, errors: [],
  };
}
