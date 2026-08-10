// File: src/filing/read.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING-FINDINGS READ — one batched query, keyed on STOCK, no snapshot anywhere.
//
// Steps 1 and 2 put 10,840 rows in stock_findings across all 504 stocks. None of it was visible,
// because every read service rooted its query at ScoreSnapshot and walked outward: a stock with
// filing findings and no snapshot returned nothing, silently, with the page rendering exactly as it
// had the day before. This is the read that inverts that — it starts from stock ids.
//
// ── ★ FILING FINDINGS ARE NOT MERGED INTO SCORE FINDINGS, AT ANY LAYER ───────────────────────────
// Every surface that consumes this keeps the two in separate fields. The reasons are not stylistic:
//   · a filing finding is available on all 504 stocks; a score finding only on the 95 that are scored.
//     One array holding both would have two different denominators inside it.
//   · step 5 gives them different base rates for exactly that reason. Merging now forces a re-split
//     the moment base rates arrive.
//   · a reader asking "is this common?" needs to know which population the answer is drawn from.
//
// ── ★ ALL THREE STATES SURVIVE TO THE READER ─────────────────────────────────────────────────────
// stock_findings carries fired / not_fired / not_evaluable. An empty fired list reads as "nothing
// wrong" to any reader — symbol-findings.service.ts's header has said so since it was written, and
// that risk is now live on the 409 stocks that never had findings before. So this NEVER returns a
// bare empty array: it returns the fired set, the DECLINED set in the reader's own words, and a
// coverage block that says how much was actually checked. A stock where every rule declined for
// insufficient history reads as "we could not check", never as clean.
//
// ── CURRENT ROW PER RULE ──────────────────────────────────────────────────────────────────────────
// The table is keyed (stock, rule, filing period) and accumulates periods. "What is standing now" is
// the row with the greatest `period_end` per (stock, ruleKey) — the same shape as the read layer's
// supersede-aware head resolution, reduced in memory over a small per-stock candidate set.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { renderVerdict } from "../scoring/findings/verdicts.js";
import { findingName, findingDescription, doesntMean } from "../catalogue/index.js";
import { describeDeclined, reasonPhrase } from "../relational/coverage.js";
import { parsePeriodKey, type FilingGrain } from "./period.js";
// ★ THE ONE NARROWING for both finding channels' payload columns — see that file's header for why it
//   is here and not spelled out again per consumer.
import { asEvidenceBag } from "../scoring/findings/evidence.js";
// ★ THE SHAPES LIVE IN A RUNTIME-FREE SIBLING. health-view.types.ts imports them, and a wire-contract
//   module that transitively pulls in the Prisma client puts a live DB import into every build gate
//   that reads the contract — which verify-build-gate-hygiene caught the moment it happened.
import type {
  FilingFindingView,
  FilingDeclinedView,
  FilingCoverage,
  FilingFindingsSection,
  FilingFindingDefinition,
} from "./read.types.js";
export type {
  FilingFindingView,
  FilingDeclinedView,
  FilingCoverage,
  FilingFindingsSection,
  FilingFindingDefinition,
} from "./read.types.js";
import { FILING_REGISTRY } from "./registry.js";

/** What each grain's period MEANS, in the reader's words — never a raw "A:FY26" on a surface. */
export const GRAIN_LABEL: Record<FilingGrain, string> = {
  A: "annual accounts",
  Q: "quarterly results",
  S: "shareholding filing",
  // ★ NOT A FILING (step 6). P6 and H read dated event streams over a window ending at the evaluation
  //   date, so the reader is told what the span IS rather than shown a filing label it does not have.
  W: "trailing 90 days",
};






const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const numN = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

/** Worst-first: red flags before patterns, then by the catalogue's severity ordering. */
const SEV_RANK: Record<string, number> = { critical: 0, red: 1, high: 2, amber: 3, medium: 4, low: 5, green: 6, recovery: 7 };
const sevRank = (s: string | null): number => (s === null ? 99 : SEV_RANK[s] ?? 50);

/** `stock_findings.kind` reaches Prisma as `string`. The column holds exactly two values (verified
 *  live: `pattern`, `red_flag`), so this narrows to the union rather than re-spelling either one. */
const asKind = (k: string): FilingFindingView["kind"] => (k === "red_flag" ? "red_flag" : "pattern");

/**
 * The quiet line. Composed here, once, so every surface says the same thing about the same silence.
 *
 * ⚠ THE THREE CASES ARE DIFFERENT STATEMENTS AND MUST NOT COLLAPSE:
 *   nothing evaluated at all  — we hold no filings for this company yet
 *   everything checked, clean — the strong statement, and the only one that earns it
 *   partially checked         — names how many capabilities we could not reach
 */
function quietLine(
  fired: number,
  notFired: number,
  evaluated: number,
  notRun: number,
  declined: FilingDeclinedView[],
): string | null {
  if (fired > 0) return null;
  if (evaluated === 0) {
    return "We hold no filings for this company yet, so none of these checks has been run.";
  }

  // ⚠ `notRun` IS NAMED WHENEVER IT IS NON-ZERO, in every branch. A company that files a shareholding
  // pattern but no accounts (360ONE, and 23 others) has 12 rules with no filing to read; a sentence
  // that counted only what ran would state a clean bill over half a check-list.
  const missing = notRun > 0 ? ` We hold no filings to run the other ${notRun} against.` : "";

  if (declined.length === 0) {
    const total = evaluated + notRun;
    return notRun > 0
      ? `Nothing flagged in what we could check — ${evaluated} of ${total} checks ran on the filings we hold, and none of them flagged anything.${missing}`
      : `All ${evaluated} filing checks ran on this company's own filings, and none of them flagged anything.`;
  }

  const caps = declined.map((d) => d.capability);
  const named = caps.length === 1 ? caps[0] : `${caps.slice(0, -1).join(", ")} and ${caps[caps.length - 1]}`;

  // ⚠ THE COUNT IS `notFired`, NOT `evaluated - declined.length`. `declined` is collapsed to
  // CAPABILITIES (eight of them here) while the declines themselves are per-RULE (twelve), so
  // subtracting one from the other overstated the clean count — KOTAKBANK read "14 checks ran clean"
  // against 10 that actually did. The row counts are the only things that may be counted.
  const clean = notFired > 0 ? `${notFired} check${notFired === 1 ? "" : "s"} ran clean; ` : "";

  // ⚠ ONE REASON IS ATTRIBUTED ONLY WHEN THERE IS ONE REASON. KOTAKBANK declines seven capabilities
  // as industry_not_applicable and one as opm_unavailable; a sentence ending in the first phrase
  // stated a single cause for eight different ones. With a mixed set the clause is dropped and the
  // per-capability reasons on `declined` are the only place a cause is claimed.
  const reasons = new Set(declined.map((d) => d.reason));
  const cause = reasons.size === 1 ? ` — ${declined[0].phrase}` : "";

  return `Nothing flagged in what we could check. ${clean}we could not assess ${named}${cause}.${missing}`;
}

/**
 * Read the CURRENT filing findings for a set of stocks. One indexed query over
 * (stock_id, period_end DESC); everything else is an in-memory reduction.
 *
 * Returns a Map keyed by stockId. A stock with no rows at all still gets a section — an honest
 * `evaluated: 0` with its own quiet line — because a missing key would send a consumer straight back
 * to rendering nothing, which is the defect this whole step exists to fix.
 */
export async function readFilingFindings(stockIds: readonly string[]): Promise<Map<string, FilingFindingsSection>> {
  const out = new Map<string, FilingFindingsSection>();
  if (!stockIds.length) return out;

  const rows = await prisma.stockFinding.findMany({
    where: { stockId: { in: [...stockIds] } },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: {
      stockId: true, ruleKey: true, ruleRef: true, kind: true,
      periodKey: true, periodEnd: true,
      evaluationState: true, standingState: true, notEvaluableReason: true,
      severity: true, direction: true, magnitude: true, displayState: true,
      evidence: true,
    },
  });

  // ── CURRENT ROW PER (stock, rule) ─────────────────────────────────────────────────────────────
  // Rows arrive period_end DESC, so the FIRST row seen for a (stock, rule) pair is its current one.
  // A later period for the same rule cannot overwrite it, and an older one cannot resurrect.
  const currentByStock = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    let byRule = currentByStock.get(r.stockId);
    if (!byRule) currentByStock.set(r.stockId, (byRule = new Map()));
    if (!byRule.has(r.ruleKey)) byRule.set(r.ruleKey, r);
  }

  for (const stockId of stockIds) {
    const byRule = currentByStock.get(stockId) ?? new Map();
    const current = [...byRule.values()];

    const fired: FilingFindingView[] = current
      .filter((r) => r.evaluationState === "fired")
      .map((r) => {
        const g = parsePeriodKey(r.periodKey);
        return {
          key: r.ruleKey,
          ruleRef: r.ruleRef,
          name: findingName(r.ruleKey),
          kind: asKind(r.kind),
          severity: r.severity,
          direction: r.direction,
          magnitude: numN(r.magnitude),
          displayState: r.displayState,
          period: g?.label ?? r.periodKey,
          periodEnd: ymd(r.periodEnd),
          grain: (g?.grain ?? "S") as FilingGrain,
          grainLabel: GRAIN_LABEL[(g?.grain ?? "S") as FilingGrain],
          standing: r.standingState,
          evidence: asEvidenceBag(r.evidence),
          // ★ READ, NEVER RE-RENDERED. The same renderVerdict the stock page, the watchlist rows and
          //   the grounding block go through — composing a second sentence here would recreate the
          //   two-verdict-authorities defect verdicts.ts exists to describe.
          verdict: renderVerdict(r.ruleKey, r.evidence ?? null),
        };
      })
      .sort((a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "red_flag" ? -1 : 1) ||
        sevRank(a.severity) - sevRank(b.severity) ||
        a.name.localeCompare(b.name),
      );

    // ── THE DECLINED SET, IN THE READER'S WORDS ────────────────────────────────────────────────
    // describeDeclined collapses rule refs into CAPABILITIES ("earnings quality", not "R3") and
    // drops any rule it has no phrase for rather than rendering a raw ref — a rule ref on a surface
    // would violate the never-render-a-key rule outright.
    const declinedRaw = current
      .filter((r) => r.evaluationState === "not_evaluable")
      .map((r) => ({ ruleRef: r.ruleRef, reason: r.notEvaluableReason ?? "unknown" }));
    const declined: FilingDeclinedView[] = describeDeclined(declinedRaw).map((d) => ({
      capability: d.capability,
      reason: d.reason,
      phrase: reasonPhrase(d.reason),
    }));

    const evaluated = current.length;
    const notRun = Math.max(0, FILING_REGISTRY.length - evaluated);
    const notEvaluable = declinedRaw.length;
    const notFired = current.filter((r) => r.evaluationState === "not_fired").length;
    const periods: FilingFindingsSection["periods"] = { A: null, Q: null, S: null, W: null };
    for (const r of current) {
      const g = parsePeriodKey(r.periodKey);
      if (g && !periods[g.grain]) periods[g.grain] = { period: g.label, periodEnd: ymd(r.periodEnd) };
    }

    out.set(stockId, {
      fired,
      declined,
      coverage: {
        evaluated,
        fired: fired.length,
        notFired,
        notEvaluable,
        // Off the registry itself, never a literal: a rule with no filing at its grain writes
        // no row, and "how many did not run" must move when the registry does.
        notRun,
        fullyEvaluated: evaluated > 0 && notEvaluable === 0 && notRun === 0,
        quietNote: quietLine(fired.length, notFired, evaluated, notRun, declined),
      },
      periods,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVALUATOR-FACING READS. Two of them, and they answer different questions from the display read
// above — which is why they are separate functions rather than a flag on that one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ WHICH FILING FINDINGS NEWLY APPEARED, WITH THE ROW'S OWN CLOCK — the shared substrate behind both
 * `readNewlyStandingFilingKeys` (below) and the relational layer's UD1 (relational/reader-context.ts).
 *
 * The score channel's notion of "new" is `on the latest snapshot, not on the prior one`. The filing
 * channel's exact analogue is a CURRENT row that is fired and `newly_standing` — the pass computes
 * that state by comparing against the row at the previous period (filing/pass.ts, resolveStanding).
 *
 * ⚠ AND THE THIRD CONDITION IS THE ONE THAT MATTERS: A PRIOR PERIOD MUST EXIST.
 * `resolveStanding` returns newly_standing whenever the prior row did not fire — INCLUDING when there
 * is no prior row at all, because a first observation has nothing to have been standing against. The
 * score channel already refuses that case in so many words ("With no prior snapshot we cannot
 * establish 'wasn't on the prior one' → treat as no new findings (conservative)"), and the filing
 * channel must refuse it identically or the first pass over a stock reads as 441 findings all newly
 * appearing at once. So a row counts as newly appeared only when the (stock, rule) pair has a
 * strictly-older period on record. Today that is true for a handful of pairs — the backfill ran one
 * period per grain and ingestion has since landed a second period for a few of them — which is exactly
 * the honest answer: almost nothing has newly appeared yet, and what has is real.
 *
 * ★ `createdAt` IS A SECOND, DIFFERENT CLOCK FROM EVERYTHING ELSE ON THIS ROW. `periodEnd` dates the
 * COMPANY'S filing (the fiscal period it covers); `createdAt` dates OUR pipeline (filing/pass.ts stamps
 * it once, the moment this row was written — see the model's default). This function answers an
 * OBJECT-level question — "is this a genuine transition on the record" — and that question has no
 * reader in it. A READER-scoped consumer needs a second fact this object-level answer cannot supply on
 * its own: whether the transition landed before or after THAT reader's last look. `createdAt` is what
 * makes that comparison possible; whether to make it is the caller's decision, not this function's —
 * see relational/reader-context.ts `resolveDelta` for where the two clocks are actually reconciled.
 */
export interface NewlyStandingFilingKey {
  ruleKey: string;
  /** When the transitioned row was written — the filing channel's own "landed" clock. Never the
   *  filing's period_end, which dates the company's fiscal period, not our pipeline. */
  createdAt: Date;
}

export async function readNewlyStandingFilingDetail(stockIds: readonly string[]): Promise<Map<string, NewlyStandingFilingKey[]>> {
  const out = new Map<string, NewlyStandingFilingKey[]>();
  if (!stockIds.length) return out;

  const rows = await prisma.stockFinding.findMany({
    where: { stockId: { in: [...stockIds] } },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, evaluationState: true, standingState: true, createdAt: true },
  });

  // Rows arrive period_end DESC per stock, so the first row for a (stock, rule) is its current one and
  // any further row for the same pair is a strictly-older period — the "prior exists" test, for free.
  const seen = new Set<string>();
  const newly = new Map<string, { stockId: string; createdAt: Date }>();
  for (const r of rows) {
    const pair = `${r.stockId}|${r.ruleKey}`;
    if (!seen.has(pair)) {
      seen.add(pair);
      if (r.evaluationState === "fired" && r.standingState === "newly_standing") {
        newly.set(pair, { stockId: r.stockId, createdAt: r.createdAt });
      }
      continue;
    }
    // A second row for this pair ⇒ a prior period exists ⇒ the candidate is a real transition. The
    // CURRENT row's createdAt travels with it (set on the first, not-yet-superseded branch above).
    const candidate = newly.get(pair);
    if (candidate === undefined) continue;
    newly.delete(pair);
    const ruleKey = pair.slice(pair.indexOf("|") + 1);
    const arr = out.get(candidate.stockId) ?? [];
    arr.push({ ruleKey, createdAt: candidate.createdAt });
    out.set(candidate.stockId, arr);
  }
  for (const stockId of stockIds) if (!out.has(stockId)) out.set(stockId, []);
  return out;
}

/**
 * The alert evaluator's original shape — every genuinely-transitioned key, object-level, no clock.
 * A thin projection of {@link readNewlyStandingFilingDetail}: the SAME reduction, unchanged, so a
 * consumer that only ever asked "did this transition" (the alert evaluator, the verify scripts) keeps
 * its existing contract untouched.
 */
export async function readNewlyStandingFilingKeys(stockIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const detail = await readNewlyStandingFilingDetail(stockIds);
  const out = new Map<string, Set<string>>();
  for (const [stockId, entries] of detail) out.set(stockId, new Set(entries.map((e) => e.ruleKey)));
  return out;
}

/**
 * ★ THE OTHER HALF OF THE TRANSITION — rules that STOPPED standing, per stock.
 *
 * The mirror of {@link readNewlyStandingFilingKeys}, and it needs NO "a strictly-older period exists"
 * guard, because `resolved` already carries that guarantee at write time: `resolveStanding` stamps it
 * only when `priorFired` is true (filing/pass.ts), and `priorFired` cannot be true without a prior row
 * that fired. `newly_standing` has no such property — it is stamped whenever the prior row did not
 * fire, INCLUDING when there is no prior row at all — which is the asymmetry this pair exists around.
 *
 * Returns the CURRENT row per (stock, rule) whose standing state is `resolved`.
 */
export async function readResolvedFilingKeys(stockIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!stockIds.length) return out;

  const rows = await prisma.stockFinding.findMany({
    where: { stockId: { in: [...stockIds] } },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { stockId: true, ruleKey: true, standingState: true },
  });

  // Same reduction as readNewlyStandingFilingDetail: period_end DESC, so the first row per
  // (stock, rule) is its current one and every later one is an older period to be skipped.
  const seen = new Set<string>();
  for (const r of rows) {
    const pair = `${r.stockId}|${r.ruleKey}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    if (r.standingState !== "resolved") continue;
    const set = out.get(r.stockId) ?? new Set<string>();
    set.add(r.ruleKey);
    out.set(r.stockId, set);
  }
  for (const stockId of stockIds) if (!out.has(stockId)) out.set(stockId, new Set());
  return out;
}

/**
 * ★ THE CURRENTLY-STANDING RED FLAGS PER STOCK — the portfolio's Signals input.
 *
 * PS1 ("capital under active red flags") read score_red_flags on each holding's head snapshot. Every
 * row in that table belongs to a filing rule — R1…R6 are all filing rules now, and the scoring pass
 * registers no red-flag rule at all — so after step 4 nothing writes to it and PS1's input would decay
 * to whatever happens to be frozen on each head. This is the live equivalent, and it is available for
 * a holding that was never scored: 360ONE is held, unscored, and pledging 90% of the promoter stake.
 *
 * Returns the CURRENT row per (stock, rule) that fired, carrying the severity the rule stamped and the
 * evidence the ledger names the finding from.
 */
export interface StandingRedFlag {
  id: string;
  ruleKey: string;
  severity: string | null;
  evidence: unknown;
}
export async function readStandingRedFlags(stockIds: readonly string[]): Promise<Map<string, StandingRedFlag[]>> {
  const out = new Map<string, StandingRedFlag[]>();
  if (!stockIds.length) return out;

  const rows = await prisma.stockFinding.findMany({
    where: { stockId: { in: [...stockIds] }, kind: "red_flag" },
    orderBy: [{ stockId: "asc" }, { periodEnd: "desc" }],
    select: { id: true, stockId: true, ruleKey: true, evaluationState: true, severity: true, evidence: true },
  });

  const seen = new Set<string>();
  for (const r of rows) {
    const pair = `${r.stockId}|${r.ruleKey}`;
    if (seen.has(pair)) continue; // an older period for a rule already resolved
    seen.add(pair);
    if (r.evaluationState !== "fired") continue;
    const arr = out.get(r.stockId) ?? [];
    arr.push({ id: r.id, ruleKey: r.ruleKey, severity: r.severity, evidence: r.evidence ?? null });
    out.set(r.stockId, arr);
  }
  return out;
}

/** Rule-level copy for a set of fired filing findings — emitted once per key, not per row. */
export function filingDefinitions(sections: Iterable<FilingFindingsSection>): FilingFindingDefinition[] {
  const keys = new Set<string>();
  for (const s of sections) for (const f of s.fired) keys.add(f.key);
  return [...keys]
    .map((key) => ({
      name: findingName(key),
      description: findingDescription(key) ?? "Vytal has no published description for this finding yet.",
      doesntMean: doesntMean(key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
