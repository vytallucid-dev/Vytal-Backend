// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PER-USER AI QUOTA SUB-CAP — PROVEN, NOT REVIEWED. (src/ai/quota.ts + src/ai/explain/stock-health.ts)
//
// WHAT THIS ASSERTS:
//   1. ★★ A user at their sub-cap is denied with scopeDenied "user" / reason "user_daily_limit_reached"
//      WHILE THE GLOBAL BUDGET STILL HAS HEADROOM — and NOTHING was consumed globally.
//   2. ★★ THE ROLLBACK. A GLOBAL denial leaves the user counter EXACTLY where it started. This is the
//      load-bearing assertion: it is the difference between "all-or-nothing" and "leaks a unit per
//      denied attempt", and it cannot be established by reading the code.
//   3. A system actor takes the global cap ONLY — and mints no per-user row at all.
//   4. ★★ THE REGRESSION FIX. A request that GENERATES once and is then quota-denied on the hardened
//      retry serves the deterministic FALLBACK, not "unavailable"/null.
//   5. Kill switch allows without touching the DB; a DB fault fails CLOSED.
//   6. The gate's two guarded WHEREs are SELF-REFERENTIAL — no cross-row predicate crept in.
//
// ★ IT SPENDS ZERO REAL BUDGET. Every counter assertion runs against a SYNTHETIC model scope
// ("verify-subcap-model"), so the live `gemini-3.5-flash-lite` counter is never touched — and the
// quota guard makes no network call in any case. The unknown-model fallbacks (18 global / 5 per-user)
// are exactly the shape the proofs need, and exercising them proves the conservative default too.
//
// Writes only rows it owns, and deletes them at both ends.
//   npx tsx src/scripts/verify-ai-quota-subcap.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { checkAndConsumeAiCall, userScopeOf, type QuotaDecision } from "../ai/quota.js";
import { generateGuarded, onQuotaDenied, composeDeterministicFallback, type GuardedOutcome } from "../ai/explain/stock-health.js";
import { scanExplanationText } from "../ai/guardrail.js";
import { groundStockHealth } from "../ai/grounding.js";
import type { AiProvider, TokenUsage } from "../ai/types.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

// ── The synthetic scopes. No FK anywhere on `scope`, so no real user/model has to exist. ──
const MODEL = "verify-subcap-model"; // unlisted ⇒ UNKNOWN_MODEL_BUDGET 18 / UNKNOWN_USER_BUDGET 5
const GLOBAL_LIMIT = 18;
const USER_LIMIT = 5;
const USER_A = "verify-subcap-user-a";
const USER_B = "verify-subcap-user-b";
const SCOPES = [MODEL, userScopeOf(USER_A, MODEL), userScopeOf(USER_B, MODEL)];

const wipe = () => prisma.aiUsageCounter.deleteMany({ where: { scope: { in: SCOPES } } });
const countOf = async (scope: string): Promise<number | null> =>
  (await prisma.aiUsageCounter.findFirst({ where: { scope }, select: { callCount: true } }))?.callCount ?? null;

const asUser = (userId: string) => ({ kind: "user", userId }) as const;

async function main() {
  await wipe();

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★★ THE PER-USER CEILING DENIES WHILE GLOBAL STILL HAS BUDGET — and costs global NOTHING");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const allowed: QuotaDecision[] = [];
    for (let i = 0; i < USER_LIMIT; i++) allowed.push(await checkAndConsumeAiCall(MODEL, asUser(USER_A)));
    ok(`the first ${USER_LIMIT} calls are allowed`, allowed.every((d) => d.allowed), allowed.map((d) => d.remaining).join(","));
    ok("…and `remaining` counts down the BINDING (user) ceiling", allowed.at(-1)!.remaining === 0 && allowed.at(-1)!.limit === USER_LIMIT,
      `limit=${allowed.at(-1)!.limit}, remaining=${allowed.at(-1)!.remaining}`);

    const globalBefore = await countOf(MODEL);
    const denied = await checkAndConsumeAiCall(MODEL, asUser(USER_A));
    const globalAfter = await countOf(MODEL);

    ok("★ call N+1 is DENIED", denied.allowed === false);
    ok('★★ scopeDenied === "user"', denied.scopeDenied === "user", String(denied.scopeDenied));
    ok('★★ reason === "user_daily_limit_reached" (NOT the system-wide string)',
      denied.reason === "user_daily_limit_reached", String(denied.reason));
    ok("★ the reported limit is the USER's, not the global one", denied.limit === USER_LIMIT, `limit=${denied.limit}`);
    ok("★ resetAt is still served, so the client can say when it comes back", denied.resetAt instanceof Date,
      denied.resetAt.toISOString());

    // ★★ THE POINT OF THE WHOLE FEATURE.
    ok("★★ GLOBAL STILL HAS HEADROOM — this is a personal limit, not an outage",
      globalAfter !== null && globalAfter < GLOBAL_LIMIT, `global ${globalAfter}/${GLOBAL_LIMIT}`);
    ok("★★ …and the denied call consumed NOTHING globally (user-first: global was never touched)",
      globalBefore === globalAfter, `${globalBefore} → ${globalAfter}`);

    // A DIFFERENT user is unaffected — the cap is per-user, not a shared bucket wearing a new name.
    const other = await checkAndConsumeAiCall(MODEL, asUser(USER_B));
    ok("★ a DIFFERENT user is unaffected by A's exhaustion", other.allowed === true, `remaining=${other.remaining}`);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★★ THE ROLLBACK — a GLOBAL denial leaves the user counter EXACTLY where it started");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // Drive the GLOBAL counter to its ceiling directly, and give user B a FRESH sub-counter. Now the
    // user UPDATE must succeed (0 < 5) and the global UPDATE must fail (18 < 18 is false) — which is
    // the ONLY interleaving in which a leak is possible, and therefore the only one worth proving.
    await prisma.aiUsageCounter.updateMany({ where: { scope: MODEL }, data: { callCount: GLOBAL_LIMIT } });
    await prisma.aiUsageCounter.deleteMany({ where: { scope: userScopeOf(USER_B, MODEL) } });

    const userBefore = await countOf(userScopeOf(USER_B, MODEL));
    const denied = await checkAndConsumeAiCall(MODEL, asUser(USER_B));
    const userAfter = await countOf(userScopeOf(USER_B, MODEL));
    const globalAfter = await countOf(MODEL);

    ok('★ denied with scopeDenied "global" / reason "daily_call_budget_exhausted"',
      denied.allowed === false && denied.scopeDenied === "global" && denied.reason === "daily_call_budget_exhausted",
      `${denied.scopeDenied} / ${denied.reason}`);
    ok("★ the reported limit is the GLOBAL one", denied.limit === GLOBAL_LIMIT, `limit=${denied.limit}`);
    ok("★★ THE USER COUNTER IS 0 — the throw rolled the user increment back, no unit leaked",
      userAfter === 0, `before=${userBefore} after=${userAfter} (a leak would read 1)`);
    ok("★ …and global did not overshoot its ceiling either", globalAfter === GLOBAL_LIMIT, `global=${globalAfter}`);

    // If `instanceof QuotaDenied` did NOT survive Prisma's $transaction rethrow, this would have
    // fallen through to the fail-closed catch and reported "quota_check_failed". It didn't.
    ok("★ the denial signal survives the transaction boundary (not mistaken for a DB fault)",
      denied.reason !== "quota_check_failed");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · A SYSTEM ACTOR TAKES THE GLOBAL CAP ONLY — and mints no per-user row");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    await wipe();
    const d = await checkAndConsumeAiCall(MODEL, { kind: "system", job: "verify_subcap" });
    const userRows = await prisma.aiUsageCounter.count({ where: { scope: { startsWith: "user:verify-subcap" } } });
    ok("allowed", d.allowed === true);
    ok("★ the GLOBAL counter moved by exactly 1", (await countOf(MODEL)) === 1);
    ok("★★ NO per-user row was created — there is no user to cap", userRows === 0, `${userRows} rows`);
    ok("★ and it reports the global ceiling", d.limit === GLOBAL_LIMIT && d.scopeDenied === null, `limit=${d.limit}`);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★★ THE REGRESSION FIX — generate-then-denied serves the FALLBACK, not nothing");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // A stub that ADVISES, so attempt 1 takes a HARD guardrail hit and a retry is required. This is
    // the only way to reach the mid-request denial without coaxing a live model into misbehaving.
    const usage: TokenUsage = { promptTokens: 10, outputTokens: 10, cachedTokens: 0, cacheHit: false, modelVersion: "stub" };
    let calls = 0;
    const advisingStub: AiProvider = {
      generate: async () => {
        calls++;
        return { text: "TCS looks strong. You should buy this stock now.", usage };
      },
      // Unused by this path; present because the transport contract requires them.
      generateStructured: async () => {
        throw new Error("not used by the explanation path");
      },
      ping: async () => true,
    };
    ok("control: the stub's text really does trip the guardrail (else this proves nothing)",
      scanExplanationText("TCS looks strong. You should buy this stock now.").clean === false);

    // Spend: attempt 1 allowed, attempt 2 refused by the USER ceiling — precisely the interleaving
    // the sub-cap introduced. (Injected, so no counter and no model are involved.)
    const resetAt = new Date("2026-07-24T07:00:00.000Z");
    let n = 0;
    const spend = async (): Promise<QuotaDecision> =>
      ++n === 1
        ? { allowed: true, remaining: 0, limit: 5, resetAt, scopeDenied: null }
        : { allowed: false, remaining: 0, limit: 5, resetAt, scopeDenied: "user", reason: "user_daily_limit_reached" };

    // ⚠ QUOTA OFF FOR THIS CALL ONLY, AND NOT FOR THE REASON IT LOOKS LIKE. The gate under test here
    // is the INJECTED `spend` above, which the switch cannot touch. What it stops is `generateGuarded`'s
    // unconditional `recordAiTokens(EXPLANATION_MODEL, …)` — which would post this STUB's 20 tokens to
    // the LIVE gemini-3.5-flash-lite token sum. That counter's whole claim is that it records real
    // Gemini traffic (see spendFor's "THE COUNTER'S MEANING IS THE WHOLE POINT"); a verify script that
    // quietly seasons it with fake tokens is the same corruption in miniature.
    process.env.AI_QUOTA_ENABLED = "false";
    const outcome = await generateGuarded(advisingStub, "be factual", "=== FACTS ===", spend);
    delete process.env.AI_QUOTA_ENABLED;
    ok("★ the outcome is quota_denied", outcome.kind === "quota_denied", outcome.kind);
    ok("★★ …with attempts === 1 — one generation really did happen this request",
      outcome.kind === "quota_denied" && outcome.attempts === 1, `attempts=${outcome.kind === "quota_denied" ? outcome.attempts : "n/a"}`);
    ok("the provider was called exactly once (the retry never left the process)", calls === 1, `${calls} calls`);

    const base = { symbol: "TCS", toneKey: "balanced:standard:plain", sources: { asOfDate: "2026-03-31" } };
    const denied = outcome as Extract<GuardedOutcome, { kind: "quota_denied" }>;

    const served = onQuotaDenied(base, denied, () => "TCS scores 74 — Steady.");
    ok('★★ THE FIX: state === "fallback" (was "unavailable" before this change)', served.state === "fallback", served.state);
    ok("★★ …and real deterministic prose is served, not null", served.explanation === "TCS scores 74 — Steady.", String(served.explanation));
    ok("★ the quota reason and resetAt still ride along, so the client can explain itself",
      served.reason === "user_daily_limit_reached" && served.resetAt === resetAt.toISOString(), `${served.reason} @ ${served.resetAt}`);

    // …and the OTHER branch is untouched: a first-attempt denial has nothing to fall back FROM.
    const nothingGenerated = onQuotaDenied(base, { ...denied, attempts: 0 }, () => "SHOULD NOT BE CALLED");
    ok('★ attempts === 0 still returns "unavailable" / null — correct, nothing was read or generated',
      nothingGenerated.state === "unavailable" && nothingGenerated.explanation === null,
      `${nothingGenerated.state} / ${nothingGenerated.explanation}`);

    // The prose that branch serves is the REAL composer over a REAL snapshot, and it is guard-clean.
    const scored = await prisma.stock.findFirst({
      where: { scoreSnapshots: { some: {} } }, select: { symbol: true }, orderBy: { symbol: "asc" },
    });
    if (!scored) {
      ok("SKIPPED — no scored stock in this DB to compose a live fallback from", true);
    } else {
      const g = await groundStockHealth(scored.symbol);
      const prose = g ? composeDeterministicFallback(g.data) : "";
      ok(`★ the LIVE deterministic fallback for ${scored.symbol} is non-empty`, prose.trim().length > 0, `${prose.length} chars`);
      ok("★★ …and it is guardrail-CLEAN — the fallback can never be the thing that advises",
        scanExplanationText(prose).clean === true, `"${prose.slice(0, 90)}…"`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · KILL SWITCH allows without the DB · A DB FAULT FAILS CLOSED");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    await wipe();
    process.env.AI_QUOTA_ENABLED = "false";
    const d = await checkAndConsumeAiCall(MODEL, asUser(USER_A));
    delete process.env.AI_QUOTA_ENABLED;
    ok('kill switch → allowed, reason "quota_disabled"', d.allowed === true && d.reason === "quota_disabled", String(d.reason));
    ok("★ …and it disables BOTH ceilings without touching the DB (no rows written)",
      (await prisma.aiUsageCounter.count({ where: { scope: { in: SCOPES } } })) === 0);

    // Force a real fault through the gate's own catch by breaking the first statement it runs.
    const original = prisma.aiUsageCounter.createMany;
    (prisma.aiUsageCounter as unknown as { createMany: unknown }).createMany = async () => {
      throw new Error("simulated DB fault");
    };
    const faulted = await checkAndConsumeAiCall(MODEL, asUser(USER_A));
    (prisma.aiUsageCounter as unknown as { createMany: unknown }).createMany = original;
    ok("★★ a DB fault FAILS CLOSED — denied, never allowed",
      faulted.allowed === false && faulted.reason === "quota_check_failed", `${faulted.allowed} / ${faulted.reason}`);
    ok('★ …and scopeDenied stays null — nothing was denied on its merits, so we claim no ceiling',
      faulted.scopeDenied === null, String(faulted.scopeDenied));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · THE GATE'S PREDICATES ARE SELF-REFERENTIAL — the property the race-safety rests on");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // A cross-row predicate (`(SELECT call_count FROM … WHERE scope=$other) < $limit`) is an UNLOCKED
    // snapshot read and races. This is a shape assertion, not a behaviour one: it catches the
    // "simplify the two statements into one" edit that no unit test would.
    const src = readFileSync("src/ai/quota.ts", "utf8");
    const guarded = [...src.matchAll(/updateMany\(\{\s*where:\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    ok("★ the gate has exactly TWO guarded updateMany statements", guarded.length === 2, `${guarded.length} found`);
    ok("★★ …and BOTH gate on `callCount`, a column of the row being updated",
      guarded.every((w) => /callCount:\s*\{\s*lt:/.test(w)), guarded.map((w) => w.trim().slice(0, 60)).join(" | "));
    ok("★ they run inside ONE $transaction (the rollback that makes it all-or-nothing)",
      /\$transaction\(async \(tx\) => \{[\s\S]*updateMany[\s\S]*updateMany[\s\S]*\}\)/.test(src));
    ok("★ the USER update comes FIRST (fixed lock order; benign leak if the tx is ever dropped)",
      src.indexOf("scope: userScope, windowKey") < src.indexOf("scope: globalScope, windowKey"));
    ok("★ no raw SQL crept in — the guarded-WHERE idiom stays Prisma-level and greppable",
      !/\$queryRaw|\$executeRaw/.test(src));
  }

  await wipe();
  console.log(`\n${fail === 0 ? "✅ ALL GREEN" : `❌ ${fail} FAILURE(S)`}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await wipe().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
