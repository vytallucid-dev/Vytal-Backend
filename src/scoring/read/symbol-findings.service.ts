// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FINDINGS FOR A NAMED SET OF SYMBOLS — the batch read behind getFindingsForSymbols.
//
// ── WHY IT EXISTS: THE CENSUS CANNOT CARRY A VERDICT ──────────────────────────────────────────────
// A census row is an aggregate over N companies, so it has no single company's numbers to bind a
// sentence to — which is exactly why per-stock verdicts were (correctly) refused there. But "which of
// these is firing something, and what does Vytal actually say about it" is a real question, and
// answering it one getStockFacts call at a time is N round trips and N tool rounds. This is the batch.
//
// ── THE VERDICT IS READ, NEVER RE-RENDERED ────────────────────────────────────────────────────────
// `renderVerdict` (scoring/findings/verdicts.ts) is THE authority — the same function the stock page,
// the watchlist rows and the grounding block go through, with the same precedence (authored renderer →
// the engine's own assembled sentence → generic last resort). Composing a second sentence here would
// recreate the two-verdict-authorities defect that module's header exists to describe.
//
// ── THREE STATES, AND THE THIRD IS THE ONE THAT MATTERS ───────────────────────────────────────────
//   scored      — a head snapshot exists; findings (possibly none) are real.
//   unscored    — in Vytal's universe, no score yet. "No findings" is NOT a clean bill of health.
//   not-covered — outside the universe entirely. Vytal has no opinion at all.
// ★ An empty findings array reads as "nothing wrong" to any reader. So an unscored or uncovered
// symbol NEVER produces one: it produces its state, in words. That is the whole of 3c.
//
// ── §5C APPLIES PER STOCK TOO ─────────────────────────────────────────────────────────────────────
// A company firing C1 and C2 shows ONE divergence card on its own page. If this returned two, the
// chat and the stock page would disagree about the same company in the same session — the identical
// defect the universe census had, one altitude down. The consolidated row carries the LEAD sub-type's
// verdict, exactly as the card does.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import {
  consolidateDivergence,
  doesntMean,
  findingDescription,
  findingName,
  isDivergenceSubType,
  severityWeight,
  CONSOLIDATED_DIVERGENCE_KEY,
} from "../../catalogue/index.js";
import { renderVerdict } from "../findings/verdicts.js";
import { resolveHeadSnapshots, splitByStaleness } from "./head-snapshot.js";
import { BAND_LABEL, type Capped } from "./universe-projection.types.js";
import type { LabelBand } from "./health-view.types.js";

/** The most symbols one call may name. Beyond this the payload stops being a conversation. */
export const MAX_SYMBOLS = 20;

/**
 * The most findings shown per company.
 *
 * ⚠ A CEILING, NOT A TRIM. Measured against the live book: the busiest company fires SIX, and the
 * twenty busiest fire 100 between them — so at 8 this never engages today. It exists because the
 * payload has to be bounded by construction rather than by how many rules happen to be registered
 * this quarter, and because a cap that only appears once the data grows is a cap nobody tested. When
 * it does engage it is STATED, like every other cap in this build.
 */
export const MAX_FINDINGS_PER_SYMBOL = 8;

export interface SymbolFindingRow {
  /** Catalogue name. Never a key. */
  name: string;
  kind: "red flag" | "pattern";
  /** ★ THE ROW'S OWN RENDERED VERDICT — what happened at THIS company, from renderVerdict. */
  verdict: string;
  /** Only on a consolidated divergence: the sub-forms that fired, named. */
  subForms?: string[];
}

export interface SymbolFindings {
  symbol: string;
  status: "scored" | "unscored" | "not-covered";
  /** The company's real name. null only when Vytal has never heard of the symbol. */
  name: string | null;
  score: number | null;
  band: string | null;
  asOfDate: string | null;
  /** ★ THIS company's own reported quarter. Named per company deliberately — the reader asked about
   *  these specific names, so each one's quarter is useful and no single label is implied. */
  quarter: string | null;
  /** true when this name has stopped being rescored — its findings are real but not current. */
  notRescored: boolean;
  findings: Capped<SymbolFindingRow>;
}

/** Rule-level copy, emitted ONCE per distinct finding across the whole call rather than per row. */
export interface FindingDefinition {
  name: string;
  description: string;
  doesntMean: string;
}

export interface SymbolFindingsResult {
  requested: number;
  /** Symbols dropped because the call exceeded MAX_SYMBOLS. Stated, never silently truncated. */
  droppedForCap: string[];
  rows: SymbolFindings[];
  definitions: FindingDefinition[];
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const num = (d: unknown): number =>
  d == null ? 0 : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);
const round2 = (x: number): number => Math.round(x * 100) / 100;

interface RawFinding {
  key: string;
  kind: "red flag" | "pattern";
  severity: string | null;
  evidence: unknown;
}

/** Apply §5C to ONE company's fired set, then order worst-first and render each verdict. */
function foldFindings(raw: RawFinding[]): SymbolFindingRow[] {
  const cRows = raw.filter((f) => isDivergenceSubType(f.key));
  const rest = raw.filter((f) => !isDivergenceSubType(f.key));

  const rows: SymbolFindingRow[] = rest.map((f) => ({
    name: findingName(f.key),
    kind: f.kind,
    verdict: renderVerdict(f.key, f.evidence ?? null),
  }));

  if (cRows.length) {
    // consolidateDivergence orders dominant-first and is stable, so the lead is the most severe —
    // and the lead's evidence is what the stock page's consolidated card renders. Same row, same
    // sentence, both surfaces.
    const consolidation = consolidateDivergence(cRows.map((c) => ({ key: c.key, severity: c.severity, ev: c.evidence })));
    if (consolidation) {
      const lead = consolidation.lead as RawFinding & { ev: unknown };
      rows.push({
        name: findingName(CONSOLIDATED_DIVERGENCE_KEY),
        kind: "pattern",
        verdict: renderVerdict(lead.key, lead.ev ?? null),
        subForms: consolidation.ordered.map((c) => findingName(c.key)),
      });
    }
  }

  const weightOf = (r: SymbolFindingRow): number => {
    const src = raw.find((f) => findingName(isDivergenceSubType(f.key) ? CONSOLIDATED_DIVERGENCE_KEY : f.key) === r.name);
    return severityWeight(src?.severity ?? null);
  };
  return rows.sort((a, b) => weightOf(a) - weightOf(b) || a.name.localeCompare(b.name));
}

/**
 * Read findings for a named set of symbols.
 *
 * `freshestAsOf` is the newest rescore date ANYWHERE — passed in rather than derived, because
 * staleness is relative to the batch and a one-symbol call has no batch to be behind (see
 * head-snapshot.ts). The caller supplies the universe's own date, which is already cached.
 */
export async function readFindingsForSymbols(
  symbols: readonly string[],
  opts: { freshestAsOf?: Date | null } = {},
): Promise<SymbolFindingsResult> {
  // Normalise, de-duplicate, preserve the caller's order, then cap.
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const s of symbols) {
    const sym = String(s ?? "").trim().toUpperCase();
    if (!sym || sym.length > 32 || seen.has(sym)) continue;
    seen.add(sym);
    cleaned.push(sym);
  }
  const accepted = cleaned.slice(0, MAX_SYMBOLS);
  const droppedForCap = cleaned.slice(MAX_SYMBOLS);

  if (accepted.length === 0) {
    return { requested: symbols.length, droppedForCap, rows: [], definitions: [] };
  }

  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: accepted } },
    select: { id: true, symbol: true, name: true },
  });
  const stockBySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  const stockIds = stocks.map((s) => s.id);

  const snaps = stockIds.length
    ? await prisma.scoreSnapshot.findMany({
        where: { stockId: { in: stockIds }, snapshotType: "quarterly" },
        select: { id: true, stockId: true, periodKey: true, version: true, asOfDate: true, composite: true, labelBand: true },
      })
    : [];

  const head = resolveHeadSnapshots(snaps);
  const { stale } = splitByStaleness(head.values(), opts.freshestAsOf ? { freshestAsOf: opts.freshestAsOf } : {});
  const staleIds = new Set(stale.map((s) => s.id));

  const headIds = [...head.values()].map((h) => h.id);
  const [flags, patterns] = headIds.length
    ? await Promise.all([
        prisma.redFlag.findMany({
          where: { snapshotId: { in: headIds } },
          select: { snapshotId: true, flagKey: true, severity: true, triggeringValues: true },
        }),
        prisma.scorePattern.findMany({
          where: { snapshotId: { in: headIds } },
          select: { snapshotId: true, patternKey: true, severity: true, evidence: true },
        }),
      ])
    : [[], []];

  const rawBySnap = new Map<string, RawFinding[]>();
  const push = (snapshotId: string, f: RawFinding) => {
    const arr = rawBySnap.get(snapshotId) ?? [];
    arr.push(f);
    rawBySnap.set(snapshotId, arr);
  };
  for (const f of flags) push(f.snapshotId, { key: f.flagKey, kind: "red flag", severity: f.severity, evidence: f.triggeringValues });
  for (const p of patterns) {
    // ⚠ The composed three-lens keys are excluded here for the same reason the universe census
    //   excludes them: `lens_lm3_F7` is a face id plus a RAW METRIC CODE, and no reader-safe name
    //   for the metric exists anywhere in the product today. Dropped, never guessed at.
    if (p.patternKey.startsWith("lens_")) continue;
    push(p.snapshotId, { key: p.patternKey, kind: "pattern", severity: p.severity, evidence: p.evidence });
  }

  const definitionKeys = new Set<string>();
  const rows: SymbolFindings[] = accepted.map((symbol) => {
    const stock = stockBySymbol.get(symbol);
    if (!stock) {
      return { symbol, status: "not-covered", name: null, score: null, band: null, asOfDate: null, quarter: null, notRescored: false, findings: { total: 0, shown: [] } };
    }
    const h = head.get(stock.id);
    if (!h) {
      return { symbol, status: "unscored", name: stock.name, score: null, band: null, asOfDate: null, quarter: null, notRescored: false, findings: { total: 0, shown: [] } };
    }
    const raw = rawBySnap.get(h.id) ?? [];
    for (const f of raw) definitionKeys.add(isDivergenceSubType(f.key) ? CONSOLIDATED_DIVERGENCE_KEY : f.key);
    const folded = foldFindings(raw);
    return {
      symbol,
      status: "scored",
      name: stock.name,
      score: round2(num(h.composite)),
      band: BAND_LABEL[h.labelBand as LabelBand] ?? null,
      asOfDate: ymd(h.asOfDate),
      quarter: h.periodKey,
      notRescored: staleIds.has(h.id),
      findings: { total: folded.length, shown: folded.slice(0, MAX_FINDINGS_PER_SYMBOL) },
    };
  });

  // ★ DEFINITIONS ONCE, NOT PER ROW. A description is rule-level and identical for every company
  //   firing it; repeating it twenty times would triple the payload to say the same sentence again.
  const definitions: FindingDefinition[] = [...definitionKeys]
    .map((key) => ({
      name: findingName(key),
      description: findingDescription(key) ?? "Vytal has no published description for this finding yet.",
      doesntMean: doesntMean(key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { requested: symbols.length, droppedForCap, rows, definitions };
}
