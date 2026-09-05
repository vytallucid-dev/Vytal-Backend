// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — the READ-ONLY quota peek: it reports what the gate would decide, and changes nothing.
//
// The failure this exists to catch is the expensive one: a monitoring read that CONSUMES. It would look
// perfectly healthy — every conversation fetch would silently burn a call, the reader's daily allowance
// would drain while they read old messages, and nothing anywhere would throw. So the count is read
// before and after, and the CONSUMING gate is run against the same fixture as a control, to prove the
// test can actually see an increment.
//
// Everything runs against a SYNTHETIC model scope ("verify-quota-peek-model"), so no real counter row —
// nobody's real allowance, and not the shared budget — is touched. Rows are deleted at the end.
//
//   npx tsx src/scripts/verify-chat-quota-peek.ts             (run from the backend root — needs .env)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { peekAiCallQuota, checkAndConsumeAiCall, userScopeOf, type Actor } from "../ai/core/quota.js";
import { quotaStateFrom } from "../chat/unavailable.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};

// An unlisted model → the conservative fallbacks: global 18/day, per-user 5/day (see quota.ts).
const MODEL = "verify-quota-peek-model";
const GLOBAL_LIMIT = 18;
const USER_LIMIT = 5;
const USER_ID = "00000000-0000-4000-8000-00000000feed"; // synthetic; counters are free text, no FK
const actor: Actor = { kind: "user", userId: USER_ID };
const USER_SCOPE = userScopeOf(USER_ID, MODEL);

/** The window key the gate itself uses — Pacific calendar date. */
const windowKeyNow = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.AI_QUOTA_TIMEZONE || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const setCount = async (scope: string, callCount: number) => {
  const windowKey = windowKeyNow();
  await prisma.aiUsageCounter.upsert({
    where: { scope_windowKey: { scope, windowKey } },
    create: { scope, windowKey, windowStart: new Date(), callCount },
    update: { callCount },
  });
};
const getCount = async (scope: string): Promise<number | null> =>
  (await prisma.aiUsageCounter.findUnique({ where: { scope_windowKey: { scope, windowKey: windowKeyNow() } }, select: { callCount: true } }))?.callCount ?? null;

const cleanup = () => prisma.aiUsageCounter.deleteMany({ where: { scope: { in: [MODEL, USER_SCOPE] } } });

async function main() {
  if (process.env.AI_QUOTA_ENABLED === "false") throw new Error("AI_QUOTA_ENABLED=false — the gate is disabled; this proof needs it on");
  await cleanup();

  // ── 1. IT DOES NOT CONSUME ───────────────────────────────────────────────────────────────────────
  await setCount(USER_SCOPE, 2);
  await setCount(MODEL, 7);
  const before = { user: await getCount(USER_SCOPE), global: await getCount(MODEL) };
  for (let i = 0; i < 5; i++) await peekAiCallQuota(MODEL, actor);
  const after = { user: await getCount(USER_SCOPE), global: await getCount(MODEL) };
  ok(
    "5 peeks incremented NOTHING",
    before.user === after.user && before.global === after.global,
    `user ${before.user}→${after.user} · global ${before.global}→${after.global}`,
  );

  // The control: the CONSUMING gate on the same fixture must move both counters, or the check above
  // proves nothing (a test that cannot see an increment cannot testify to its absence).
  const decision = await checkAndConsumeAiCall(MODEL, actor);
  const consumed = { user: await getCount(USER_SCOPE), global: await getCount(MODEL) };
  ok(
    "CONTROL: the consuming gate DOES increment both ceilings (so the test can see one)",
    decision.allowed && consumed.user === after.user! + 1 && consumed.global === after.global! + 1,
    `user ${after.user}→${consumed.user} · global ${after.global}→${consumed.global}`,
  );

  // ── 2. IT CREATES NO ROWS ────────────────────────────────────────────────────────────────────────
  await cleanup();
  const peekFresh = await peekAiCallQuota(MODEL, actor);
  ok("a peek at a window with no rows says YES (0 used, not exhausted)", peekFresh.allowed, JSON.stringify(peekFresh));
  ok("…and wrote no counter row", (await getCount(MODEL)) === null && (await getCount(USER_SCOPE)) === null);

  // ── 3. BOTH CEILINGS, AND WHICH ONE BINDS ────────────────────────────────────────────────────────
  await setCount(USER_SCOPE, USER_LIMIT); // personal allowance spent, shared budget fine
  await setCount(MODEL, 0);
  const userDenied = await peekAiCallQuota(MODEL, actor);
  ok("personal cap exhausted → denied, scope 'user'", !userDenied.allowed && userDenied.scopeDenied === "user", userDenied.reason);

  await setCount(USER_SCOPE, 0); // personal allowance untouched, shared budget gone
  await setCount(MODEL, GLOBAL_LIMIT);
  const globalDenied = await peekAiCallQuota(MODEL, actor);
  ok(
    "shared budget exhausted → denied, scope 'global' (never blamed on the reader)",
    !globalDenied.allowed && globalDenied.scopeDenied === "global",
    globalDenied.reason,
  );

  await setCount(USER_SCOPE, USER_LIMIT);
  await setCount(MODEL, GLOBAL_LIMIT);
  const both = await peekAiCallQuota(MODEL, actor);
  ok("both exhausted → 'user' first, the same order the gate denies in", both.scopeDenied === "user");

  await setCount(USER_SCOPE, 1);
  await setCount(MODEL, 1);
  const allowed = await peekAiCallQuota(MODEL, actor);
  ok(
    "room on both → allowed, remaining is the BINDING ceiling's headroom",
    allowed.allowed && allowed.remaining === USER_LIMIT - 1 && allowed.scopeDenied === null,
    `remaining=${allowed.remaining} limit=${allowed.limit}`,
  );

  // ── 4. THE WIRE SHAPE THE COMPOSER CONSUMES ──────────────────────────────────────────────────────
  const okState = quotaStateFrom(allowed);
  ok("allowed → canSend, nothing to explain, nothing to wait for", okState.canSend && okState.unavailable === null && okState.resetAt === null);

  await setCount(MODEL, GLOBAL_LIMIT);
  await setCount(USER_SCOPE, 0);
  const blockedState = quotaStateFrom(await peekAiCallQuota(MODEL, actor));
  ok("denied → canSend false, binding scope, resetAt", !blockedState.canSend && blockedState.scopeDenied === "global" && !!blockedState.resetAt);
  ok(
    "…carrying the SYSTEM wording, not the reader's-own-limit wording",
    /Vytal's assistant is at its daily limit/i.test(blockedState.unavailable?.message ?? ""),
    blockedState.unavailable?.message,
  );
  ok("…and resetAt is in the future (next Pacific midnight)", new Date(blockedState.resetAt!).getTime() > Date.now(), blockedState.resetAt!);

  await setCount(USER_SCOPE, USER_LIMIT);
  await setCount(MODEL, 0);
  const ownState = quotaStateFrom(await peekAiCallQuota(MODEL, actor));
  ok(
    "a PERSONAL cap is described as the reader's own",
    /You've reached your daily limit/i.test(ownState.unavailable?.message ?? ""),
    ownState.unavailable?.message,
  );

  // ── 5. IT DEGRADES TO ALLOWING ───────────────────────────────────────────────────────────────────
  // The read is made to fail at the source; a locked-out reader would be the wrong answer.
  const real = prisma.aiUsageCounter.findMany;
  (prisma.aiUsageCounter as unknown as { findMany: () => Promise<never> }).findMany = async () => {
    throw new Error("simulated DB fault");
  };
  const degraded = await peekAiCallQuota(MODEL, actor);
  (prisma.aiUsageCounter as unknown as { findMany: typeof real }).findMany = real;
  ok(
    "a failed read ALLOWS (fail-open) — the opposite posture to the spend gate",
    degraded.allowed && degraded.reason === "quota_peek_failed" && degraded.scopeDenied === null,
    JSON.stringify(degraded),
  );
  ok("…and the state it yields unlocks the composer", quotaStateFrom(degraded).canSend);
  // Sanity: the fixture still says denied once the read works again — the peek was not left broken.
  ok("…the peek is not left in a degraded state", !(await peekAiCallQuota(MODEL, actor)).allowed);

  // ── 6. WHAT IT COSTS ON THE HOT PATH ─────────────────────────────────────────────────────────────
  const size = await prisma.$queryRaw<{ rows: number; bytes: string }[]>`
    SELECT (SELECT count(*)::int FROM ai_usage_counters) AS rows,
           pg_size_pretty(pg_total_relation_size('ai_usage_counters')) AS bytes
  `;
  const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT scope, call_count FROM ai_usage_counters WHERE window_key = $1 AND scope IN ($2, $3)`,
    windowKeyNow(),
    MODEL,
    USER_SCOPE,
  );
  const planText = plan.map((r) => r["QUERY PLAN"]).join("\n");
  const ms = Number(/Execution Time: ([\d.]+) ms/.exec(planText)?.[1] ?? NaN);
  const buffers = Number(/Buffers: shared hit=(\d+)/.exec(planText)?.[1] ?? NaN);
  console.log(`\n   ai_usage_counters: ${size[0].rows} rows, ${size[0].bytes}`);
  console.log(planText.split("\n").map((l) => `   ${l}`).join("\n"));
  // ⚠ A SEQ SCAN HERE IS THE RIGHT PLAN, NOT A MISS. The whole table is one page; reading it costs less
  //   than descending an index. What matters on a hot path is pages touched and time, so that is what is
  //   asserted — and the index-availability check below is what keeps it true as the table grows.
  ok("the added read touches at most a couple of pages", Number.isFinite(buffers) && buffers <= 4, `${buffers} buffer(s)`);
  ok("…and executes in well under a millisecond", Number.isFinite(ms) && ms < 1, `${ms} ms`);

  const forced = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    const p = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN (FORMAT TEXT) SELECT scope, call_count FROM ai_usage_counters WHERE window_key = $1 AND scope IN ($2, $3)`,
      windowKeyNow(),
      MODEL,
      USER_SCOPE,
    );
    return p.map((r) => r["QUERY PLAN"]).join("\n");
  });
  ok(
    "the PK (scope, window_key) covers the predicate, so it stays keyed as the table grows",
    /Index (Scan|Only Scan)/.test(forced) && /ai_usage_counters_pkey/.test(forced),
    forced.split("\n")[0].trim(),
  );
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
