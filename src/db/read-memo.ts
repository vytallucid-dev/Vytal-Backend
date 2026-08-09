// File: src/db/read-memo.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE REQUEST-SCOPED READ MEMO — one question, asked once, for the life of one read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── ★ WHY THIS IS SAFE WHERE A CROSS-REQUEST CACHE IS NOT ────────────────────────────────────────
// A cache has an invalidation problem: something changes, and the cache must find out. This has none,
// because its lifetime is one read. Two call sites inside one health view asking the same question
// cannot disagree about the answer — there is no window in which the row could change between them
// that is not already a window inside a single database transaction's worth of wall clock. Nothing is
// held after the read returns; the store is garbage the moment `withReadMemo` resolves.
//
// ── ★ WHAT IT IS KEYED ON, AND WHAT THAT DEMANDS OF CALLERS ─────────────────────────────────────
// The key is the QUESTION — the loader's own arguments, stringified by the caller. That is the whole
// contract: two callers share a round-trip exactly when they would have sent the same SQL. It follows
// that a caller must not key on a projection it then narrows differently, and must not key on
// anything the loader does not actually read.
//
// ⚠ THE RESULT IS SHARED, SO IT IS READ-ONLY BY CONTRACT. Every memoised loader returns the SAME
//   array/object to its second caller. A consumer that sorts, splices or otherwise mutates the value
//   in place would be editing another consumer's data from across the file. Every current consumer
//   maps or reduces into a fresh structure first (see `snapshotRowsForStock`'s own note, which lists
//   its three callers and what each does with the rows). A new consumer that needs to mutate must
//   copy first — `[...rows]` — and that is cheaper than the round-trip it just skipped.
//
// ⚠ THE PROMISE IS MEMOISED, NOT THE VALUE, AND THAT IS LOAD-BEARING. The duplicate callers here are
//   not sequential: two of the three snapshot readers sit in the same `Promise.all`. Caching the
//   resolved value would let both miss, both issue, and both then store — the round-trip we are
//   removing. Caching the in-flight promise makes the second caller await the first one's query.
//
// ⚠ A REJECTION IS NOT MEMOISED. A failed query evicts its own key, so a retry inside the same read
//   re-issues rather than replaying the error forever. (Nothing retries inside a read today; the
//   eviction is here so that a caller which starts to cannot be surprised by a cached failure.)
//
// ── ★ OUTSIDE A SCOPE IT IS A PASS-THROUGH ──────────────────────────────────────────────────────
// A loader called from a job, a script or an un-wrapped service simply runs. That is what lets the
// three snapshot readers stay independently callable — `resolveFindingLifecycles` is used standalone
// and must not require a ceremony to work.
//
// ── ★ WHY NOT A PRISMA `$extends` HOOK OVER EVERY QUERY ─────────────────────────────────────────
// Measured first: instrumented at the pg driver, one health read issues 33 statements and ZERO of
// them are exact duplicates — same SQL text AND same bound values. The repeats reported by table name
// are the same ROWS under different PROJECTIONS (`score_snapshots` is read three times for one stock,
// selecting 7, 10 and 13 columns). A blanket args-keyed hook would therefore have hit nothing at all.
// The dedup has to happen where the question is asked, which is what this primitive is for: it lets
// three callers keep their own narrow views of one shared read instead of each sending its own.
// A blanket hook would also inherit two hazards this does not: it would sit in the write path (a
// read-after-write inside one request would go stale) and it would memoise queries nobody audited for
// the read-only contract above.

import { AsyncLocalStorage } from "node:async_hooks";

type Store = Map<string, Promise<unknown>>;

const storage = new AsyncLocalStorage<Store>();

let hits = 0;
let misses = 0;
let passthroughs = 0;

/**
 * Run `fn` with a fresh memo scope. Every `memoRead` inside it — including inside anything it
 * awaits — shares one store. Nested scopes are legal and simply shadow; the inner one is its own
 * lifetime, which is the honest reading of "a read inside a read".
 */
export function withReadMemo<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(new Map(), fn);
}

/**
 * The question, asked once. `key` must identify the loader AND every argument that changes its
 * result — see the contract in this file's header.
 */
export function memoRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) {
    passthroughs++;
    return load();
  }
  const inFlight = store.get(key);
  if (inFlight) {
    hits++;
    return inFlight as Promise<T>;
  }
  misses++;
  const p = load();
  store.set(key, p);
  // ⚠ The handler is attached to a DERIVED promise, so `p` itself still rejects to the real caller
  //   with the original error — this only evicts, it never swallows.
  void p.then(undefined, () => {
    if (store.get(key) === p) store.delete(key);
  });
  return p;
}

/** Observability, for the measurement scripts and the parity gate. Never read in the request path. */
export function readMemoStats(): { hits: number; misses: number; passthroughs: number } {
  return { hits, misses, passthroughs };
}

/** Zero the counters. Scripts only. */
export function resetReadMemoStats(): void {
  hits = 0;
  misses = 0;
  passthroughs = 0;
}
