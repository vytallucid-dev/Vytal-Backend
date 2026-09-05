// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE MISS-LOG — §6.4. The generic composition's real output.
//
// ★ THE FALLBACK IS THE DISCOVERY MECHANISM, NOT A PATCH. Every generic run records the raw question,
// the slots extracted from it, and the sections it assembled. That log is what writes composition
// #199 — with evidence attached rather than a guess about what readers ask.
//
// ── ★ PERSISTED AT T-0, AND THE HEADER THIS REPLACES WAS TOO KIND TO ITSELF ───────────────────────
// What stood here said the log was "IN-PROCESS AND UNBOUNDED-BY-DESIGN-DECISION, NOT BY OVERSIGHT",
// that persisting it needed a table and a migration, and that "swapping the sink is a one-function
// edit". The first claim was true and the third turned out to be true. The part it did not say is
// the part that mattered: `missLog()`, `missLogSummary()` and `clearMissLog()` had ZERO call sites
// anywhere in src/. The log was not merely unpersisted — it was unread, by anything, ever. So the
// four stages of "we will decide what to build from the miss-log" were decided from an empty set
// that no code path could have printed.
//
// It now writes to `composition_misses` (migration 20260831120000). The in-memory array SURVIVES
// beside it, and deliberately — see `ROWS` below.
//
// ── ★ THE INTERFACE PROMISE, KEPT ────────────────────────────────────────────────────────────────
// `recordMiss(row)` is still one call, still synchronous, still returns void, and still cannot fail a
// turn. A composition that dropped an answer because a log write timed out would be trading the
// product for its own telemetry. The persist is fire-and-forget with an owned catch; `missLogFlush()`
// exists so a TEST can await what production never waits for.
//
// ★ NEVER READ BY THE COMPOSER. Appended on the way out of a turn; read only by
// `src/scripts/miss-log-report.ts` and `/api/v1/admin/miss-log`. A composer reading this would be
// routing on its own past failures.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { classificationKey } from "../router/classification-cache.js";
import type { RouterOutput } from "../router/contract.js";

/**
 * ★ WHO PRODUCED THE TURN. Added at T-0b, on the evidence of T-0's own first day.
 *
 * Seven rows landed in `composition_misses` on day one and FOUR were `verify:harness` driving the
 * matrix — the same question the model path had recorded once, so "TCS" read as five asks. Two guards
 * already caught it (the report's `modelOnly` default, and a ranking that sorts on distinct readers
 * and counts an anonymous row as zero), but both worked by accident of the ranking rather than by the
 * row saying what it was. A harness run that happened to route through the MODEL classifier, or to run
 * authenticated, would have passed through both and landed in the evidence as demand.
 *
 * ⚠ THE ROWS ARE KEPT, NOT SKIPPED. Not writing under NODE_ENV=test would make the table silently
 *   incomplete in exactly the environment where someone is checking that it works — a log that
 *   behaves differently under test is a log that lies. The READ excludes them instead, by default,
 *   and always prints how many it excluded.
 */
export type MissOrigin = "reader" | "harness";

/**
 * Resolved ONCE, here, so no composition has to know. `MISS_LOG_ORIGIN=harness` covers any script
 * without a code change; `setMissLogOrigin` covers an in-process harness that builds the matrix
 * directly. Default `reader`, because a turn that nobody marked is a turn a person asked for.
 *
 * ⚠ KNOWN GAP, STATED SO IT IS NOT MISTAKEN FOR COVERAGE. `verify:browser` and `verify:ux` drive the
 *   RUNNING SERVER over HTTP as an authenticated account. At the server those requests are
 *   indistinguishable from a reader's and record `reader`. Closing that would mean trusting a
 *   client-supplied header (a hole) or hard-coding a test account id (a lie the day a person uses it).
 *   In-process runs are where all four observed contaminating rows came from, and those are covered.
 */
let currentOrigin: MissOrigin = process.env.MISS_LOG_ORIGIN === "harness" ? "harness" : "reader";
export const setMissLogOrigin = (o: MissOrigin): void => { currentOrigin = o; };
export const missLogOrigin = (): MissOrigin => currentOrigin;

export interface MissLogRow {
  readonly at: string;
  /** Resolved by `recordMiss`, never passed by a composition. See `MissOrigin`. */
  readonly origin: MissOrigin;
  readonly raw: string;
  /**
   * ★ WHICH OUTCOME THIS ROW RECORDS — ADDED AT STAGE 5b, AND THE GAP IT CLOSES WAS LARGE.
   *
   * The log recorded the generic branch and nothing else. In the stage-5a probe that was 1 turn in
   * 41, while `clarify_operation` — the reader being asked what they meant — was 10 in 41 and wrote
   * NOTHING. So the mechanism that decides which family gets built next was blind to the
   * second-commonest outcome, and the outcome it was blind to is the one that tells you a question
   * shape has no home at all. A generic row says "we answered, but not well"; a clarify row says
   * "we did not answer".
   */
  readonly branch: "generic" | "clarify_operation";
  /** Includes `slots.source` and `slots.degradedReason` — see RouterOutput. A clarify row from a
   *  LEXICAL router is a statement about our budget, not about the question, and the two must never
   *  be counted together when this log is read to prioritise work. */
  readonly slots: RouterOutput;
  readonly resolvedSymbols: readonly string[];
  /** What the generic path decided it could show. The most useful column: it says what the reader
   *  ALMOST got, which is what a purpose-built family would have to beat. Empty on a clarify row —
   *  nothing was composed. */
  readonly sectionsChosen: readonly string[];
  /** Named data the question asked for that we do not hold. Empty is meaningful — it says the miss
   *  was a MISSING FAMILY, not missing data, which is the cheaper of the two to fix. */
  readonly missingData: readonly string[];
  /**
   * ★ WHO ASKED — OPTIONAL, AND THE REASONING IS IN THE MIGRATION HEADER.
   *
   * Absent on a turn with no authenticated reader (the harness, a script, the matrix). Persisted as
   * `user_id` with ON DELETE SET NULL: it lets a deletion request be honoured and lets fifty rows
   * from fifty readers be told from fifty rows from one, without deleting the question shape when an
   * account goes away.
   *
   * ⚠ THIS IS THE OPPOSITE OF §6.5 RULE 2 AND THAT IS CORRECT. The classification CACHE must never
   *   key on a user — classification is a pure function of the sentence, so a user in the key would
   *   fragment the cache and leak turn state into a shared store. That is a correctness rule about a
   *   cache. This is an evidence table, where not knowing who asked is the defect.
   */
  readonly userId?: string | null;
}

/**
 * ★ THE IN-MEMORY MIRROR SURVIVES PERSISTENCE, FOR TWO REASONS THAT ARE NOT NOSTALGIA.
 *
 *   1. The persist is asynchronous and a turn does not wait for it. A same-process caller that wants
 *      "what did THIS run record" — the eval, a probe, a self-test — cannot get that from the table
 *      without awaiting a write it deliberately did not await.
 *   2. It is the fallback when the database is the thing that is broken. A row lost to a DB outage is
 *      a row lost; a row still in `ROWS` is one an operator can still read out of the process.
 *
 * It stays BOUNDED here, which the old one was not: this array is a mirror, not the store, and an
 * unbounded mirror in a long-lived process is a leak. The table is the thing with no ceiling.
 */
const ROWS: MissLogRow[] = [];
const MIRROR_MAX = 500;

/** In-flight persists, so `missLogFlush()` can await what production fires and forgets. */
const inFlight = new Set<Promise<void>>();

/**
 * Append one miss. ★ SYNCHRONOUS, VOID, AND UNABLE TO FAIL A TURN — see the header. The DB write is
 * started here and never awaited by the caller; its rejection is caught and logged, never thrown.
 */
export function recordMiss(row: Omit<MissLogRow, "at" | "origin">): void {
  const full: MissLogRow = { at: new Date().toISOString(), origin: currentOrigin, ...row };
  ROWS.push(full);
  if (ROWS.length > MIRROR_MAX) ROWS.splice(0, ROWS.length - MIRROR_MAX);

  const p = persist(full)
    .catch((e: unknown) => {
      // ⚠ A LOG THAT CANNOT WRITE MUST STILL NOT BREAK AN ANSWER. Loud in the server log, invisible
      //   to the reader, and the in-memory mirror above still holds the row.
      console.error("[miss-log] persist failed (row kept in-process only):", e);
    })
    .finally(() => { inFlight.delete(p); });
  inFlight.add(p);
}

async function persist(r: MissLogRow): Promise<void> {
  const s = r.slots;
  await prisma.compositionMiss.create({
    data: {
      createdAt: new Date(r.at),
      branch: r.branch,
      raw: r.raw,
      // The ROUTER'S OWN normaliser, reused rather than re-invented — so "the same question" means
      // the same thing to the log as it does to the classification cache (§6.5).
      questionKey: classificationKey(r.raw),
      origin: r.origin,
      userId: r.userId ?? null,
      scope: s.scope,
      operation: s.operation,
      lens: s.lens,
      perspective: s.perspective,
      action: s.action,
      confidence: s.confidence,
      source: s.source,
      degradedReason: s.degradedReason,
      timeframeKind: s.timeframe?.kind ?? null,
      timeframeN: s.timeframe?.n ?? null,
      subjectMentions: s.subjects.map((m) => m.text),
      resolvedSymbols: [...r.resolvedSymbols],
      sectionsChosen: [...r.sectionsChosen],
      missingData: [...r.missingData],
      slots: s as unknown as object,
    },
  });
}

/**
 * Await every persist started so far. ★ FOR TESTS AND SCRIPTS ONLY — production never calls this,
 * because a turn that waited for its own telemetry would be paying the reader's latency for it.
 */
export async function missLogFlush(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}

/** The in-process mirror. For a same-run read; the TABLE is the log. */
export const missLog = (): readonly MissLogRow[] => ROWS;
export const clearMissLog = (): void => { ROWS.length = 0; };

/**
 * ★ THE SPLIT THIS LOG EXISTS TO SUPPORT, AND THE ONE READING THAT IS ALWAYS WRONG.
 *
 * Counting misses without splitting on `slots.source` attributes our own budget to the reader's
 * question: a denied turn produces `operation: "unresolved"` from the lexical classifier and lands
 * in `clarify_operation` regardless of how clear the question was. Read undivided, a week of quota
 * denials looks exactly like a week of question shapes we cannot classify — and the second reading
 * is the one that gets someone to build a family nobody needed.
 *
 * After the switchover there is no old path to compare against, so the comparison has to live here.
 */
export interface MissSummary {
  readonly total: number;
  readonly byBranch: Record<MissLogRow["branch"], number>;
  readonly bySource: Record<"model" | "lexical", number>;
  /** ★ ALWAYS PRESENT, even when the read excluded harness rows — see `readerFilter`. */
  readonly byOrigin: Record<MissOrigin, number>;
  /** Clarify rows that came from the MODEL — the only ones that are evidence about a question. */
  readonly genuineClarifies: number;
  readonly degradedReasons: readonly string[];
}

/** The mirror's summary — this run only. `summariseMisses()` is the one that reads the log. */
export function missLogSummary(): MissSummary {
  const byBranch = { generic: 0, clarify_operation: 0 };
  const bySource = { model: 0, lexical: 0 };
  const byOrigin = { reader: 0, harness: 0 };
  const reasons = new Set<string>();
  let genuineClarifies = 0;
  for (const r of ROWS) {
    byBranch[r.branch]++;
    bySource[r.slots.source]++;
    byOrigin[r.origin]++;
    if (r.slots.degradedReason) reasons.add(r.slots.degradedReason);
    if (r.branch === "clarify_operation" && r.slots.source === "model") genuineClarifies++;
  }
  return { total: ROWS.length, byBranch, bySource, byOrigin, genuineClarifies, degradedReasons: [...reasons] };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// READING THE LOG — the half that did not exist. T-22 is why.
//
// A persisted log nobody reads is the in-memory version with extra steps, so these are the queries
// the report and the admin endpoint both run. Both are UNBOUNDED by default and windowed only by an
// explicit `days`: the tail is the signal, and a default window would hide it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const since = (days?: number) =>
  days && days > 0 ? { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } } : {};

/**
 * ★ THE DEFAULT EXCLUSION. `readerOnly` is TRUE everywhere it is optional, because a harness turn is
 * not demand. It is a filter on the READ and never on the write — the rows stay, and every summary
 * carries `byOrigin` so the number excluded is always on screen. An exclusion you cannot see is
 * indistinguishable from data that was never collected, which is the whole lesson of this table.
 */
const readerFilter = (readerOnly: boolean) => (readerOnly ? { origin: "reader" } : {});

/** The §6.5 split, over the TABLE. The headline read. */
export async function summariseMisses(
  days?: number,
  readerOnly = true,
): Promise<MissSummary & { readonly firstAt: string | null; readonly lastAt: string | null }> {
  // ★ `where` IS SCOPED BY readerOnly; `byOrigin` DELIBERATELY IS NOT. Every other number describes
  //   the rows this read counted; byOrigin describes what the window HELD, so the harness volume is
  //   visible even in the reader-only view that excluded it.
  const win = since(days);
  const where = { ...win, ...readerFilter(readerOnly) };
  const [total, generic, clarify, model, lexical, genuineClarifies, reasons, first, last, reader, harness] = await Promise.all([
    prisma.compositionMiss.count({ where }),
    prisma.compositionMiss.count({ where: { ...where, branch: "generic" } }),
    prisma.compositionMiss.count({ where: { ...where, branch: "clarify_operation" } }),
    prisma.compositionMiss.count({ where: { ...where, source: "model" } }),
    prisma.compositionMiss.count({ where: { ...where, source: "lexical" } }),
    prisma.compositionMiss.count({ where: { ...where, branch: "clarify_operation", source: "model" } }),
    prisma.compositionMiss.findMany({
      where: { ...where, degradedReason: { not: null } },
      select: { degradedReason: true }, distinct: ["degradedReason"],
    }),
    prisma.compositionMiss.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.compositionMiss.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.compositionMiss.count({ where: { ...win, origin: "reader" } }),
    prisma.compositionMiss.count({ where: { ...win, origin: "harness" } }),
  ]);
  return {
    total,
    byBranch: { generic, clarify_operation: clarify },
    bySource: { model, lexical },
    byOrigin: { reader, harness },
    genuineClarifies,
    degradedReasons: reasons.map((r) => r.degradedReason!).filter(Boolean),
    firstAt: first?.createdAt.toISOString() ?? null,
    lastAt: last?.createdAt.toISOString() ?? null,
  };
}

export interface MissQuestion {
  readonly questionKey: string;
  readonly sample: string;
  readonly asks: number;
  /** ★ DISTINCT READERS, NOT ASKS. Fifty asks from one person is one person — see the migration. */
  readonly readers: number;
  readonly branches: readonly string[];
  readonly sources: readonly string[];
  readonly lastAt: string;
}

/**
 * ★ THE QUESTION RANKING — what T-22 re-orders on.
 *
 * Grouped on `question_key`, which is the router's own normalisation, so "How is TCS doing?" and
 * "how is tcs doing" are one question here exactly as they are one entry in the cache.
 *
 * `modelOnly` defaults TRUE and that default is the §6.5 ruling expressed as a parameter: a lexical
 * row is our quota talking, not the reader, and the ranking that decides what gets BUILT must not
 * count it. Pass false to see the whole log including denials.
 */
export async function topMissedQuestions(
  opts: { days?: number; limit?: number; modelOnly?: boolean; readerOnly?: boolean } = {},
): Promise<readonly MissQuestion[]> {
  const { days, limit = 25, modelOnly = true, readerOnly = true } = opts;
  const rows = await prisma.compositionMiss.findMany({
    where: { ...since(days), ...(modelOnly ? { source: "model" } : {}), ...readerFilter(readerOnly) },
    select: { questionKey: true, raw: true, branch: true, source: true, userId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const byKey = new Map<string, { sample: string; asks: number; readers: Set<string>; branches: Set<string>; sources: Set<string>; lastAt: Date }>();
  for (const r of rows) {
    let g = byKey.get(r.questionKey);
    if (!g) { g = { sample: r.raw, asks: 0, readers: new Set(), branches: new Set(), sources: new Set(), lastAt: r.createdAt }; byKey.set(r.questionKey, g); }
    g.asks++;
    if (r.userId) g.readers.add(r.userId);
    g.branches.add(r.branch);
    g.sources.add(r.source);
    if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
  }
  return [...byKey.entries()]
    .map(([questionKey, g]) => ({
      questionKey, sample: g.sample, asks: g.asks, readers: g.readers.size,
      branches: [...g.branches], sources: [...g.sources], lastAt: g.lastAt.toISOString(),
    }))
    // Distinct readers first, then asks: demand from many beats volume from one.
    .sort((a, b) => b.readers - a.readers || b.asks - a.asks)
    .slice(0, limit);
}

export interface MissShape {
  readonly operation: string;
  readonly lens: string | null;
  readonly n: number;
}

/** Which (operation, lens) pairs keep landing here — a family-shaped question with no family. */
export async function missShapes(days?: number, modelOnly = true, readerOnly = true): Promise<readonly MissShape[]> {
  const grouped = await prisma.compositionMiss.groupBy({
    by: ["operation", "lens"],
    where: { ...since(days), ...(modelOnly ? { source: "model" } : {}), ...readerFilter(readerOnly) },
    _count: { _all: true },
  });
  return grouped
    .map((g) => ({ operation: g.operation, lens: g.lens, n: g._count._all }))
    .sort((a, b) => b.n - a.n);
}

/**
 * ★ THE MISSING-FAMILY / MISSING-DATA SPLIT, COUNTED.
 *
 * A generic row with EMPTY `missingData` says we held everything the question wanted and still had
 * no purpose-built view for it — a missing FAMILY, which is one composition file. A row with named
 * lines says we do not hold the data — which is an ingest project. They are not the same size and
 * the log is the only place that distinguishes them.
 */
export async function missingDataCensus(days?: number, readerOnly = true): Promise<{
  readonly genericRows: number;
  readonly missingFamilyOnly: number;
  readonly namedMissingData: { readonly line: string; readonly n: number }[];
}> {
  const rows = await prisma.compositionMiss.findMany({
    where: { ...since(days), branch: "generic", ...readerFilter(readerOnly) },
    select: { missingData: true },
  });
  const tally = new Map<string, number>();
  let familyOnly = 0;
  for (const r of rows) {
    if (r.missingData.length === 0) familyOnly++;
    for (const line of r.missingData) tally.set(line, (tally.get(line) ?? 0) + 1);
  }
  return {
    genericRows: rows.length,
    missingFamilyOnly: familyOnly,
    namedMissingData: [...tally.entries()].map(([line, n]) => ({ line, n })).sort((a, b) => b.n - a.n),
  };
}

/** What the generic path assembled — what a purpose-built family would have to beat. */
export async function sectionsAlmostServed(days?: number, readerOnly = true): Promise<{ readonly combo: string; readonly n: number }[]> {
  const rows = await prisma.compositionMiss.findMany({
    where: { ...since(days), branch: "generic", ...readerFilter(readerOnly) },
    select: { sectionsChosen: true },
  });
  const tally = new Map<string, number>();
  for (const r of rows) {
    if (!r.sectionsChosen.length) continue;
    const combo = r.sectionsChosen.join(" + ");
    tally.set(combo, (tally.get(combo) ?? 0) + 1);
  }
  return [...tally.entries()].map(([combo, n]) => ({ combo, n })).sort((a, b) => b.n - a.n);
}
