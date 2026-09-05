// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — PT · PATTERNS. What code has flagged on a company, and what each of those does not mean.
//
// ── ★ IT CONSUMES `readFindingsForSymbols`, IT DOES NOT REBUILD IT ────────────────────────────────
// That service already folds the §5C divergence consolidation, orders worst-first, renders each
// verdict from the evidence, and emits rule-level copy ONCE per distinct finding rather than per row.
// Re-deriving any of that here would be a second opinion on a settled question (N-3) — and the second
// opinion is the wrong one, because the consolidation rules live beside the rules that fire.
//
// What this adds is the half that service has no reason to carry: **the witness**.
//
// ── ⚠ FOUR STATES, NOT THREE, AND THE PLAN RECORDS THREE ──────────────────────────────────────────
// Measured across the 1,329 in-force periods (Phase 2 · Batch 1, re-confirmed here):
//
//   1,125  witnessed AND carrying rows      the rules ran and something fired
//      93  witnessed and carrying none      ★ THE HONEST EMPTY — a result, not a gap
//     106  rows but NO witness stamp        ⚠ evidence they ran; no proof they ran COMPLETELY
//       5  neither                          genuinely unknown
//
// The plan folds the third into "carries pattern rows". It is not the same claim, and the brief is
// explicit: **claim nothing about the third.** So this resolver counts all four, renders the second
// and the fourth in words, and says nothing at all about the third — its periods are simply not
// described as clean.
//
// ── ⚠ AND IT RENDERS THE ROWS, NEVER `findings_fired_count` ───────────────────────────────────────
// Measured: the stored count disagrees with the actual row count on 353 of 1,218 witnessed periods —
// 29%. One period claims MORE than it can produce; 352 carry more rows than the count knows about
// (`score_red_flags` was dropped 2026-08-11 and the count predates it). The count is a claim about the
// rows; the rows are the evidence. The count is read for exactly ONE purpose — telling a witnessed
// empty from a witnessed non-empty — and is never shown.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { readFindingsForSymbols, type SymbolFindings, type FindingDefinition } from "../scoring/read/symbol-findings.service.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { absent, coverageReadFailed, resolved, type Coverage, type Resolved } from "./contract.js";

/** One flagged thing, with its claim and its boundary side by side. */
export interface PatternRow {
  readonly name: string;
  readonly kind: "red flag" | "pattern";
  /** What happened at THIS company — the rendered verdict, not the rule's static description. */
  readonly verdict: string;
  /** The rule-level description. Empty only where the registry carries none (the PHS variant). */
  readonly description: string;
  /**
   * ★ THE LOAD-BEARING HALF. `EntryBase` makes this the ONE universal requirement across all four
   *   registries — 132 of 132 entries carry it while only 74 carry a description.
   */
  readonly doesntMean: string;
  /** The consolidated divergence's constituent forms, where there are any. */
  readonly subForms: readonly string[];
}

/** The witness census, over this company's own scored history. */
export interface WitnessCensus {
  readonly periods: number;
  readonly fired: number;
  /** ★ The rules ran and raised nothing. A RESULT, rendered as one. */
  readonly witnessedEmpty: number;
  /** ⚠ Rows without a witness stamp. Counted, and NOTHING is claimed about it. */
  readonly rowsUnwitnessed: number;
  /** Neither rows nor a stamp. */
  readonly unknown: number;
  /** Authored, and `null` when every period is accounted for by the first two. */
  readonly sentence: string | null;
}

export interface PatternsRead {
  readonly symbol: string;
  readonly status: SymbolFindings["status"];
  readonly companyName: string | null;
  readonly quarter: string | null;
  readonly band: string | null;
  readonly notRescored: boolean;
  readonly rows: readonly PatternRow[];
  /** How many fired in total, when the list shown is capped. */
  readonly total: number;
  /** ⚠ FILING findings are a SEPARATE CHANNEL and present for every symbol we know, scored or not. */
  readonly filingRows: readonly PatternRow[];
  /** What the filing channel could not check, in words. Never a rule ref. */
  readonly filingDeclined: readonly string[];
  /** The sentence that stops an empty filing set reading as a clean bill of health. */
  readonly quietNote: string | null;
  readonly witness: WitnessCensus;
}

const WITNESS_SQL = `
WITH st AS (SELECT id FROM stocks WHERE symbol = $1),
inforce AS (
  SELECT DISTINCT ON (period_key) id, period_key, findings_evaluated_at, findings_fired_count
  FROM score_snapshots
  WHERE stock_id = (SELECT id FROM st) AND snapshot_type = 'quarterly'
  ORDER BY period_key, version DESC, as_of_date DESC
)
SELECT i.period_key,
       (i.findings_evaluated_at IS NOT NULL) AS witnessed,
       COALESCE(i.findings_fired_count, 0)   AS claimed,
       (SELECT COUNT(*)::int FROM score_patterns sp WHERE sp.snapshot_id = i.id) AS rows_held
FROM inforce i ORDER BY i.period_key`;

interface WitnessRow { period_key: string; witnessed: boolean; claimed: number; rows_held: number }

/**
 * ★ THE WITNESS SENTENCE. One home, authored here, and it never quotes the stored count.
 *
 * ⚠ THE THIRD STATE GETS NO SENTENCE AT ALL. It is counted so that the arithmetic on screen closes,
 *   and it is deliberately not described — "we hold rows for it but cannot say the checks completed"
 *   is true and is not something a reader can use, and any shorter phrasing tips into claiming one of
 *   the other two. The brief's instruction is exact: claim nothing about it.
 */
function witnessSentenceFor(c: Omit<WitnessCensus, "sentence">): string | null {
  const parts: string[] = [];
  if (c.witnessedEmpty > 0) {
    parts.push(
      `In ${c.witnessedEmpty} of the ${c.periods} quarters we have scored it, the checks ran and raised `
      + `nothing. That is a result rather than a gap: those quarters were examined and came back clean.`,
    );
  }
  if (c.unknown > 0) {
    parts.push(
      `For ${c.unknown} we cannot say whether the checks ran at all, so we do not claim they came back clean.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

function toRow(r: SymbolFindings["findings"]["shown"][number], defs: readonly FindingDefinition[]): PatternRow {
  const d = defs.find((x) => x.name === r.name);
  return {
    name: r.name,
    kind: r.kind,
    verdict: r.verdict,
    description: d?.description ?? "",
    // ⚠ NEVER A DEFAULT SENTENCE. A fabricated boundary is worse than a missing one: it reads as
    //   authored copy and is not. Empty is handled by the section, which drops the field rather than
    //   inventing it.
    doesntMean: d?.doesntMean ?? "",
    subForms: r.subForms ?? [],
  };
}

export async function resolvePatterns(symbol: string): Promise<Resolved<PatternsRead>> {
  const cov = await resolveStockCoverage(symbol);
  if (coverageReadFailed(cov)) return absent<PatternsRead>("read_failed", { subject: null, query: null });
  const coverage: Coverage = cov.coverage;

  // ⚠ F-3. A findings read that FAILS and a company with no findings are opposite facts, and the
  //   census sentence below states the second. `findingsRead` keeps them apart.
  let findingsRead = true;
  const [result, witnessRows] = await Promise.all([
    readFindingsForSymbols([symbol]).catch(() => { findingsRead = false; return null; }),
    prisma.$queryRawUnsafe<WitnessRow[]>(WITNESS_SQL, symbol).catch(() => [] as WitnessRow[]),
  ]);

  // ⚠ AND THE FAILURE IS ANSWERED BEFORE THE ABSENCE — F-3. `not_in_universe` says "no such company
  //   in Vytal's coverage at all", which is the strongest coverage claim in the union; a read that
  //   threw must never reach it.
  if (!findingsRead) return absent<PatternsRead>("read_failed", coverage);
  const row = result?.rows?.[0];
  if (!row || row.status === "not-covered") return absent<PatternsRead>("not_in_universe", coverage);

  const census: Omit<WitnessCensus, "sentence"> = {
    periods: witnessRows.length,
    fired: witnessRows.filter((w) => w.witnessed && w.rows_held > 0).length,
    witnessedEmpty: witnessRows.filter((w) => w.witnessed && w.rows_held === 0).length,
    rowsUnwitnessed: witnessRows.filter((w) => !w.witnessed && w.rows_held > 0).length,
    unknown: witnessRows.filter((w) => !w.witnessed && w.rows_held === 0).length,
  };

  const filing = row.filing;
  const filingRows: PatternRow[] = (filing?.fired ?? []).map((f) => {
    const d = (result?.filingDefinitions ?? []).find((x) => x.name === f.name);
    return {
      name: f.name,
      kind: "pattern" as const,
      verdict: f.verdict ?? "",
      description: d?.description ?? "",
      doesntMean: d?.doesntMean ?? "",
      subForms: [],
    };
  });

  return resolved<PatternsRead>({
    symbol,
    status: row.status,
    companyName: row.name,
    quarter: row.quarter,
    band: row.band,
    notRescored: row.notRescored,
    rows: row.findings.shown.map((r) => toRow(r, result?.definitions ?? [])),
    total: row.findings.total,
    filingRows,
    filingDeclined: (filing?.declined ?? []).map((d) => (typeof d === "string" ? d : String((d as { capability?: string }).capability ?? ""))).filter(Boolean),
    quietNote: filing?.coverage?.quietNote ?? null,
    witness: { ...census, sentence: witnessSentenceFor(census) },
  }, coverage, ["score_snapshots"]);
}
