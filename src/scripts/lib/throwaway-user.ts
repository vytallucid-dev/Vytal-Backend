// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THROWAWAY TEST USERS — one convention, one allowlist, one place.
//
// Every verify/measure harness that needs a user creates a real `auth.users` row (the `handle_new_user`
// trigger mints `public.users`) and tears it down afterwards. That teardown is BEST-EFFORT and always
// will be: a Ctrl-C, a timeout, a crash, or a throw inside the `finally` skips it. Fifteen synthetic
// accounts accumulated that way over three weeks — carrying 80 portfolio-health snapshots, 26 score-
// history rows, 12 broker holdings, 9 accounts, 8 holdings and 2 chat sessions — and every one of them
// came from a harness whose cleanup code was CORRECT. Correct cleanup is not the problem.
//
// ★ THE FIX IS THAT THE SWEEP RUNS AT STARTUP, NOT AT SHUTDOWN. Startup always happens; shutdown does
// not. So `createThrowawayUser` sweeps leftovers BEFORE it creates anything, once per process. That
// makes the population self-limiting — bounded by "whatever the last interrupted run left behind"
// instead of growing forever — and it makes the invariant structural rather than remembered: you cannot
// create a throwaway user without first clearing the previous ones. `cleanupThrowawayUsers()` still
// exists for the happy path, because deleting at the end is still better than waiting for the next run.
//
// The sweep is GLOBAL to the convention, so a single converted harness cleans up after every harness,
// converted or not. That is what makes a partial rollout still worth having.
//
// ── ⚠ THE GUARD, HONESTLY ─────────────────────────────────────────────────────────────────────────
// A "refuse to run outside dev" check cannot be based on the connection string here, because this
// project has ONE database: the `DATABASE_URL` a developer runs harnesses against is the same Supabase
// project that holds the real users. Pretending otherwise would be a guard that reads as protection and
// provides none. What actually constrains the blast radius:
//
//   1. NODE_ENV must not be "production" (cheap, catches the obvious mistake).
//   2. ★ EVERY CANDIDATE IS RE-MATCHED AGAINST THE STRICT CONVENTION IN JS, ROW BY ROW — not merely
//      selected by a SQL `LIKE`. A `LIKE '%@test.local'` is the shape that deleted the real quota
//      counters (see verify-chat.ts §5b): a wildcard that looked specific enough. Anything that does
//      not match `<tag>-<uuid>@test.local` exactly is SKIPPED AND LOGGED, never deleted.
//   3. PROTECTED_ADDRESSES is checked independently of the pattern, so the deliberate fixture is safe
//      even if someone later widens the convention.
//   4. A hard cap: a sweep that wants to delete more than MAX_SWEEP rows refuses and reports, because
//      at that point the pattern is wrong, not the data.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { randomUUID } from "crypto";
import { prisma } from "../../db/prisma.js";

/** THE convention. One suffix, everywhere. Reserved TLD, so it can never collide with a real address. */
export const THROWAWAY_DOMAIN = "test.local";

/** A short, readable label for which harness/role a user plays ("fleet-http", "wtool-main", "stl-u"). */
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * The FULL address shape, anchored at both ends: `<tag>-<uuid>@test.local`. The uuid is what makes an
 * address unforgeable-by-accident and lets the sweep be confident a row is machine-made.
 * ⚠ This is the only thing authorised to delete a user. Widening it is a security-relevant change.
 */
const THROWAWAY_EMAIL_RE = new RegExp(
  `^[a-z0-9][a-z0-9-]{0,31}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@${THROWAWAY_DOMAIN.replace(".", "\\.")}$`,
);

/**
 * Addresses that look synthetic but are DELIBERATE and PERSISTENT. Checked independently of the
 * pattern above — belt and braces, because "it's a different suffix so it can't match" is exactly the
 * implicit assumption that let the quota-counter cleanup delete real rows.
 *
 * · `__multiasset_book@test.invalid` — the multi-asset fixture book (13 holdings / 13 transactions),
 *   seeded by seed-multiasset-book.ts and READ by read-multiasset-book.ts and verify-disclosure-notes.ts.
 *   Deleting it silently breaks those three. It is not a leak; it is a fixture.
 */
export const PROTECTED_ADDRESSES: ReadonlySet<string> = new Set([
  "__multiasset_book@test.invalid",
]);

/** A sweep wanting to remove more than this is a bug in the pattern, not a big backlog. */
const MAX_SWEEP = 200;

/** ★ THE ONE-LINE EXCLUSION FOR CROSS-USER CONSUMERS (Stage 5's chat-profile distiller, the behaviour
 *  reconcile, any metrics aggregate). `public.users.email` is populated, so this is a plain filter:
 *
 *    prisma.user.findMany({ where: { ...NON_SYNTHETIC_USERS } })
 *
 *  Use it anywhere that iterates users and spends something per user. Synthetic accounts have
 *  outnumbered real ones 15:2 in this database; an unfiltered iteration would spend most of its budget
 *  on accounts that do not exist. */
export const NON_SYNTHETIC_USERS = {
  email: { not: { endsWith: `@${THROWAWAY_DOMAIN}` } },
} as const;

// ── Process-local bookkeeping ───────────────────────────────────────────────────────────────────────
const created: string[] = []; // auth ids minted by THIS process
let sweptThisProcess = false;

function assertNotProduction(): void {
  if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error(
      "throwaway-user: refusing to run with NODE_ENV=production. These helpers create and delete real " +
        "auth.users rows and belong to the harnesses only.",
    );
  }
}

/**
 * Delete every leftover throwaway user, from any harness, from any previous run. Idempotent and safe to
 * call repeatedly. Returns what it removed so the caller can log it — a silent sweep is how you stop
 * noticing that your harnesses keep dying halfway.
 *
 * Cascades do the rest: auth.users → public.users → all 20 user-keyed tables (all ON DELETE CASCADE,
 * verified), and their own dependents (chat_messages, holding_lots, alert_events, event_reminder_events,
 * broker_holdings). Nothing needs explicit deletion.
 */
export async function sweepThrowawayUsers(): Promise<{ deleted: number; emails: string[]; skipped: string[] }> {
  assertNotProduction();

  // SELECT wide, then FILTER strictly in JS. The SQL predicate is a coarse pre-filter for efficiency;
  // the regex below is what actually authorises a deletion.
  const candidates = await prisma.user.findMany({
    where: { email: { endsWith: `@${THROWAWAY_DOMAIN}` } },
    select: { authUserId: true, email: true },
  });

  const doomed: { authUserId: string; email: string }[] = [];
  const skipped: string[] = [];
  for (const cand of candidates) {
    if (PROTECTED_ADDRESSES.has(cand.email)) { skipped.push(`${cand.email} (protected)`); continue; }
    if (!THROWAWAY_EMAIL_RE.test(cand.email)) { skipped.push(`${cand.email} (off-convention)`); continue; }
    doomed.push(cand);
  }

  if (doomed.length > MAX_SWEEP) {
    throw new Error(
      `throwaway-user: refusing to sweep ${doomed.length} users (cap ${MAX_SWEEP}). That many matches means ` +
        `the convention is wrong, not that there is a backlog. Inspect them by hand first.`,
    );
  }
  if (skipped.length) console.log(`  [throwaway] skipped (never deleted): ${skipped.join(", ")}`);
  if (doomed.length === 0) return { deleted: 0, emails: [], skipped };

  // Explicit id array — never a pattern in the DELETE itself.
  await prisma.$executeRawUnsafe(
    `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`,
    doomed.map((d) => d.authUserId),
  );
  const emails = doomed.map((d) => d.email);
  console.log(`  [throwaway] swept ${emails.length} leftover user(s) from a previous run: ${emails.join(", ")}`);
  return { deleted: emails.length, emails, skipped };
}

/**
 * Create one throwaway user and return both ids. Sweeps leftovers on the FIRST call in the process, so
 * the startup sweep cannot be forgotten — it is a precondition of creating a user, not a separate step
 * a harness has to remember.
 *
 * `tag` is a short label for the user's role in the test ("fleet-http", "stl-u", "unavail").
 */
export async function createThrowawayUser(tag: string): Promise<{ authId: string; userId: string; email: string }> {
  assertNotProduction();
  if (!TAG_RE.test(tag)) {
    throw new Error(`throwaway-user: invalid tag "${tag}" — use lowercase letters, digits and hyphens (max 32).`);
  }
  if (!sweptThisProcess) {
    sweptThisProcess = true; // set BEFORE awaiting, so concurrent first calls sweep once
    await sweepThrowawayUsers();
  }

  const authId = randomUUID();
  const email = `${tag}-${authId}@${THROWAWAY_DOMAIN}`;
  // Belt: the address we just built must satisfy the very pattern the sweep will use to reclaim it.
  // If it does not, this user would be UNSWEEPABLE — fail now rather than leak forever.
  if (!THROWAWAY_EMAIL_RE.test(email)) {
    throw new Error(`throwaway-user: generated address "${email}" does not match the sweep pattern — it would leak.`);
  }

  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, email);
  created.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`throwaway-user: the handle_new_user trigger did not seed public.users for ${email}`);
  return { authId, userId: u.id, email };
}

/** Tear down the users THIS process created. Best-effort by nature — the startup sweep is the real
 *  guarantee — but still worth doing: it keeps a clean run from leaving anything at all. */
export async function cleanupThrowawayUsers(): Promise<number> {
  if (!created.length) return 0;
  const ids = [...created];
  created.length = 0;
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, ids);
  return ids.length;
}

/** The auth ids this process created — for a harness that wants to log or assert on them. */
export const throwawayAuthIds = (): readonly string[] => created;
