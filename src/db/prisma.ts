import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = `${process.env.DATABASE_URL}`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ T-6 · A BUILD THAT STALLS MUST FAIL, AND SAY WHY. THE ROOT CAUSE IS ONE MISSING OPTION.
//
// `pg`'s `connectionTimeoutMillis` defaults to **0, which means wait forever**. With the pool capped at five connections below,
// a dev server holding all five connections makes every DB-touching build gate block indefinitely —
// no error, no output, a build frozen mid-line. Stage 11 lost minutes to exactly this and the cure
// was killing a stray dev server, which is not something the stalled build gave any hint of.
//
// The harness got a guard at stage 10 (`matrix.ts#withTimeout`, per composition, 90 s) and its header
// states the principle this inherits: *a gate that hangs is worse than one that fails — a failure
// names the problem, a hang gets attributed to "the suite is slow" and then to "not worth running".*
// `verify:copy` had no equivalent, so the same starvation produced a silent stall there instead.
//
// ── ★ WHY HERE AND NOT IN EACH GATE ──────────────────────────────────────────────────────────────
// Wrapping every DB-touching gate would be a change per gate, an ongoing obligation on every gate
// added afterwards, and it would still miss `tsx` scripts, jobs and the server. The stall is not a
// property of the gates; it is a property of the pool they all share. One option here covers
// `verify:copy`, `verify:live`, every script, every job, and the API.
//
// ── ⚠ THIS ALSO APPLIES IN PRODUCTION, DELIBERATELY ──────────────────────────────────────────────
// A request that cannot obtain a connection within the window now fails instead of queueing. That is
// the intended behaviour, not a side effect: on a single-threaded worker with five slots, a 30-second
// wait for a pool slot already means something is badly wrong, and a fast honest error beats a
// request that hangs until the client gives up. `DB_CONNECT_TIMEOUT_MS` tunes it without a code
// change if a deployment ever needs more room.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const CONNECT_TIMEOUT_MS = Number(process.env.DB_CONNECT_TIMEOUT_MS ?? "") || 30_000;

const pool = new Pool({
  connectionString,
  // Keep TCP connections alive so the OS/network doesn't silently drop them.
  keepAlive: true,
  // Discard idle connections after 30 s — must be shorter than the server's
  // idle_in_transaction_session_timeout / any proxy timeout (often 60 s).
  idleTimeoutMillis: 30_000,
  // Limit pool size; the worker is single-threaded so 5 is plenty.
  // ⚠ MIRRORED in src/harness/matrix.ts (`DB_POOL_MAX`), which reads this line with
  //   /max:\s*(\d+)/ and fails the harness if the two disagree. Keep it the first `max:` in the file.
  max: 5,
  // ★ See the block above. 0 (the pg default) means wait forever, and forever is what we got.
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
});

/**
 * ★ THE DIAGNOSIS TRAVELS WITH THE FAILURE.
 *
 * `connectionTimeoutMillis` alone converts a stall into `Error: timeout exceeded when trying to
 * connect` — better than hanging, and it still leaves the reader to guess. Half the value of the
 * stage-10 guard is that its message names the actual cause and the actual remedy.
 *
 * ⚠ IT MUST DECORATE THE CALLBACK FORM, WHICH IS THE ONE THAT ACTUALLY FIRES. The first version here
 *   wrapped only the promise form and proved nothing: `pg`'s own `Pool.prototype.query` — the path
 *   the Prisma adapter uses for every query — calls `this.connect(cb)`, so a live starvation test
 *   came back with the bare pg message and the decoration never ran. Measured, not assumed.
 *
 * ⚠ THE ERROR IS AUGMENTED, NEVER REPLACED. Throwing a new Error would discard the class, `code` and
 *   stack that `pg` sets and may itself inspect during cleanup. Appending to `message` keeps the same
 *   object identity and adds only the sentence a reader needs.
 */
const CONNECT_HELP =
  `
  → Database connection was not granted within ${CONNECT_TIMEOUT_MS / 1000}s.` +
  `
    The pool in src/db/prisma.ts is capped at 5. The usual cause is a dev server (npm run dev)` +
  `
    holding connections alongside this run — stop it and retry, or raise DB_CONNECT_TIMEOUT_MS` +
  `
    if the database itself is genuinely slow to accept.`;

const DECORATED = Symbol("vytal.connectTimeoutDecorated");

function decorateConnectError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  const marked = e as Error & { [DECORATED]?: true };
  if (marked[DECORATED]) return e;
  if (!/timeout exceeded when trying to connect/i.test(e.message)) return e;
  marked[DECORATED] = true;
  e.message = `${e.message}${CONNECT_HELP}`;
  return e;
}

type ConnectCb = (err: unknown, client: unknown, done: unknown) => void;
const nativeConnect = pool.connect.bind(pool);
pool.connect = ((cb?: unknown) => {
  // The callback form — what Pool.prototype.query uses, and therefore every Prisma query.
  if (typeof cb === "function") {
    return (nativeConnect as (c: ConnectCb) => unknown)((err, client, done) =>
      (cb as ConnectCb)(err ? decorateConnectError(err) : err, client, done));
  }
  // The promise form — direct pool.connect() callers, e.g. scripts holding a client.
  return (nativeConnect as () => Promise<unknown>)()
    .catch((e: unknown) => { throw decorateConnectError(e); });
}) as typeof pool.connect;

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export { prisma };
