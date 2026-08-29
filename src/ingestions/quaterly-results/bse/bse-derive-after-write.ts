// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DERIVE THE ROW THE BSE LANE JUST WROTE. The forward half of the operating-profit fix.
//
// ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
// The NSE ingesters spread `...derived.columns` into their write, so an NSE row arrives with its
// ratios on it. The BSE lane has no such step: `bse-writer.ts` is an explicit-column INSERT and
// `bse-column-fill.ts` is a null-only UPDATE, and neither has any notion of derivation. So every row
// the BSE lane has ever produced carries raw numbers and no ratios — MEASURED 2026-08-28, all 5,222
// BSE quarterly rows had no net_margin, and 741 of 742 BSE annual rows had no ROE.
//
// Stage 25 cleaned up 7,517 rows that had accumulated. That was the sweep, not the fix: without this
// module the next BSE write starts the pile again. The lane's own convention already said what to do
// — "Key the inputs; run src/fill/re-derive.ts" — it was simply never wired in.
//
// ⚠ BEST-EFFORT, AND DELIBERATELY SO. A derivation that throws must not fail an ingest: the raw cells
//   are the ingest's product and they are already committed and correct. A missing ratio is a dash on
//   a page and is recoverable by re-running stage 25; a thrown ingest loses the filing. The caller
//   gets the error text back to log, and nothing else happens.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { reDeriveRow, type Db } from "../../../fill/re-derive.js";

/** Physical table → the RE_DERIVE registry key. Every table the BSE lane can write. */
const DERIVE_KEY: Record<string, string> = {
  quarterly_results: "QuarterlyResult",
  fundamentals: "Fundamental",
  banking_quarterly_results: "BankingQuarterlyResult",
  banking_fundamentals: "BankingFundamental",
  nbfc_quarterly_results: "NbfcQuarterlyResult",
  nbfc_fundamentals: "NbfcFundamental",
  life_insurance_quarterly_results: "LifeInsuranceQuarterlyResult",
  life_insurance_fundamentals: "LifeInsuranceFundamental",
  general_insurance_quarterly_results: "GeneralInsuranceQuarterlyResult",
  general_insurance_fundamentals: "GeneralInsuranceFundamental",
};

export interface DeriveAfterWrite {
  ran: boolean;
  changed: string[];
  error?: string;
}

/**
 * Run the derive layer over one row the BSE lane created or filled.
 * Returns what changed; never throws.
 */
export async function deriveAfterBseWrite(
  db: Db,
  table: string,
  rowId: string | null | undefined,
): Promise<DeriveAfterWrite> {
  const key = DERIVE_KEY[table];
  if (!key || !rowId) return { ran: false, changed: [] };
  try {
    const r = await reDeriveRow(db, key, rowId);
    return { ran: true, changed: Object.keys(r?.changed ?? {}) };
  } catch (e) {
    return { ran: false, changed: [], error: String(e).slice(0, 200) };
  }
}

/** The tables above, for the verifier that asserts this map covers every table the lane writes. */
export const DERIVABLE_BSE_TABLES = Object.keys(DERIVE_KEY);
