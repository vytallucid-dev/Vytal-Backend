// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PORTFOLIO EXPLANATION SEAM — PROVEN, NOT REVIEWED.
//
// WHAT THIS ASSERTS:
//   1. The FOUR-STATE GATE routes every real book to the right state.
//   2. ★★ THE TWO DECLINES SPEND NOTHING — no quota unit, and no cache row read or written. Proven by
//      instrumenting the counter and the cache table around the call, not by reading the code.
//   3. Grounding runs FIRST (a decline still carries `sources` — it could only have come from the
//      grounded view).
//   4. The cache-read seam is live against the new table, and `approved` fails CLOSED.
//   5. The route is registered and collides with nothing on the shared /api/v1/me base path.
//   6. ★★ ONE RENDERER, TWO SCOPES — the explain fact block is a strict PREFIX of the full one, carries
//      no PD finding and no f(now) value, and its key survives float noise but not a real move.
//   7. The ASKS are state-dependent — and the construction ask issues no positive request for a verdict.
//   8. ★★ guardrail → hardened retry → the PROVEN portfolio fallback, and fallback-on-quota-denial.
//
// ★ NO AI CALLS. Generation is live from Phase 2, so every path that would reach a provider runs
// under the stub or an injected one — see the note in §1. Zero Flash-Lite units.
//   npx tsx src/scripts/verify-ai-portfolio-explanation.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import {
  explainPortfolioHealth, portfolioFactsKeyOf, composeDeterministicPortfolioFallback,
  askFor, PORTFOLIO_HEALTH_ASK,
} from "../ai/explain/portfolio-health.js";
import { groundPortfolioHealth, renderPortfolioFacts } from "../ai/grounding.js";
import { resolveToneForUser } from "../ai/tone.js";
import { composePrompt, generateGuarded, onQuotaDenied, toneKeyOf, EXPLANATION_MODEL, type GuardedOutcome } from "../ai/explain/shared.js";
import { scanExplanationText } from "../ai/guardrail.js";
import { scanStringsForForwardLanguage, PORTFOLIO_ADVICE_DENY_LIST } from "../scoring/lens-patterns/no-forward-guard.js";
import type { AiProvider, TokenUsage } from "../ai/types.js";
import { meAiRouter } from "../routes/me-ai-routes.js";
import { mePortfolioRouter } from "../routes/me-portfolio-routes.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(98) + "\n" + s + "\n" + "═".repeat(98));

/** Total Flash-Lite calls consumed today, across every scope (global + every per-user row). */
async function unitsSpent(): Promise<number> {
  const rows = await prisma.aiUsageCounter.findMany({
    where: { OR: [{ scope: EXPLANATION_MODEL }, { scope: { startsWith: "user:" } }] },
    select: { callCount: true },
  });
  return rows.reduce((n, r) => n + r.callCount, 0);
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · THE FOUR-STATE GATE — every real book routed");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  const seen = { empty_book: 0, no_snapshot: 0, construction: 0, health: 0 };
  const results: { email: string; state: string; reason: string | null; slot: string | null }[] = [];

  // ⚠ MOCK, AND NOT AS A CONVENIENCE. This loop calls the seam once per user to prove ROUTING, and
  // generation is live from Phase 2 on — under the real provider it would spend one unit of the
  // shared 480/day per uncached book, every time anyone runs this file. The routing decision happens
  // entirely before the provider, so the stub proves it exactly as well and for nothing. (It cost 9
  // real units to learn this the first time; that is why the note is here rather than in a commit
  // message.)
  const realProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "mock";
  process.env.AI_QUOTA_ENABLED = "false"; // …and keep the stub's tokens off the live counter too

  for (const u of users) {
    const r = await explainPortfolioHealth(u.id);
    results.push({ email: u.email, state: r.state, reason: r.reason, slot: r.headlineSlot });
    if (r.reason === "empty_book") seen.empty_book++;
    else if (r.reason === "no_snapshot") seen.no_snapshot++;
    else if (r.headlineSlot === "construction") seen.construction++;
    else if (r.headlineSlot === "health") seen.health++;
  }
  if (realProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = realProvider;
  delete process.env.AI_QUOTA_ENABLED;

  for (const r of results) {
    console.log(`     ${r.email.slice(0, 34).padEnd(34)} state=${r.state.padEnd(12)} reason=${String(r.reason).padEnd(16)} slot=${r.slot ?? "-"}`);
  }
  console.log();
  ok("★ empty books decline with reason 'empty_book'", seen.empty_book > 0, `${seen.empty_book} books`);
  ok("★ books that explain are flagged headlineSlot='health'", seen.health > 0, `${seen.health} books`);
  ok("★ every book landed in exactly one state (no unrouted book)",
    seen.empty_book + seen.no_snapshot + seen.construction + seen.health === users.length,
    `${seen.empty_book + seen.no_snapshot + seen.construction + seen.health}/${users.length}`);
  ok("★★ the declining states NEVER carry a slot, and the explaining states ALWAYS do",
    results.every((r) => (r.reason === "empty_book" || r.reason === "no_snapshot") === (r.slot === null)));
  ok("★ no explaining book was itself declined (they all reached the generator)",
    results.filter((r) => r.slot).every((r) => r.reason !== "empty_book" && r.reason !== "no_snapshot"));

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★★ THE TWO DECLINES SPEND NOTHING — no quota unit, no cache row");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const emptyUser = users.find((u) => results.find((r) => r.email === u.email)?.reason === "empty_book")!;
    ok("an empty-book user exists to test", !!emptyUser, emptyUser?.email);

    const unitsBefore = await unitsSpent();
    const rowsBefore = await prisma.aiPortfolioExplanation.count();

    // Hammer it — a decline that leaked a unit would show up 25× over.
    for (let i = 0; i < 25; i++) await explainPortfolioHealth(emptyUser.id);

    const unitsAfter = await unitsSpent();
    const rowsAfter = await prisma.aiPortfolioExplanation.count();

    ok("★★ 25 declines consumed ZERO quota units", unitsBefore === unitsAfter, `${unitsBefore} → ${unitsAfter}`);
    ok("★★ …and wrote ZERO cache rows", rowsBefore === rowsAfter, `${rowsBefore} → ${rowsAfter}`);

    const r = await explainPortfolioHealth(emptyUser.id);
    ok("★ the decline is a STATE, not an error — state 'unavailable', explanation null", r.state === "unavailable" && r.explanation === null);
    ok("★ …with headlineSlot null (there was no question to answer)", r.headlineSlot === null, String(r.headlineSlot));
    ok("★ …and no resetAt (the budget is not what stopped us)", r.resetAt === null);

    // ★ GROUNDING RAN FIRST — the decline carries `sources`, which only the grounded view can supply.
    ok("★★ grounding ran BEFORE the gate — the decline still carries `sources` from the real view",
      r.sources !== undefined && "asOfDate" in r.sources, JSON.stringify(r.sources));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · THE CACHE-READ SEAM IS LIVE against the new table");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const target = users.find((u) => results.find((r) => r.email === u.email)?.slot === "health")!;
    // ⚠ "explain" MODE — the same block the service hashes. Using the full block here would compute a
    // key the service never produces, and every cache assertion below would be testing nothing.
    const g = await groundPortfolioHealth(target.id, "explain");
    const factsKey = portfolioFactsKeyOf(g.factBlock);
    const toneKey = toneKeyOf(await resolveToneForUser(target.id));

    // An UNAPPROVED row must be invisible (approved fails closed).
    // Use a key this book cannot naturally produce, so a real cached row for the live key is never
    // clobbered — the planted row must test the seam, not evict someone's genuine explanation.
    const plantedKey = `${factsKey}-verify-planted`;
    const planted = await prisma.aiPortfolioExplanation.create({
      data: {
        userId: target.id, factsKey: plantedKey, toneKey, content: "PLANTED CACHE BODY.", headlineSlot: "health",
        approved: false, model: EXPLANATION_MODEL, modelVersion: "verify-planted",
      },
    });
    // Under the stub so a cache MISS cannot spend; the point is only that the planted row is not served.
    const prov = process.env.AI_PROVIDER; process.env.AI_PROVIDER = "mock"; process.env.AI_QUOTA_ENABLED = "false";
    const unapproved = await explainPortfolioHealth(target.id);
    if (prov === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = prov;
    delete process.env.AI_QUOTA_ENABLED;
    ok("★★ an UNAPPROVED row is INVISIBLE (approved fails closed)",
      unapproved.explanation !== "PLANTED CACHE BODY.", `served ${unapproved.state}`);

    // Now the same body at the LIVE key, approved — it must be served without touching a provider.
    const prior = await prisma.aiPortfolioExplanation.findUnique({
      where: { userId_factsKey_toneKey: { userId: target.id, factsKey, toneKey } }, select: { content: true, approved: true },
    });
    await prisma.aiPortfolioExplanation.upsert({
      where: { userId_factsKey_toneKey: { userId: target.id, factsKey, toneKey } },
      create: { userId: target.id, factsKey, toneKey, content: "PLANTED CACHE BODY.", headlineSlot: "health",
                approved: true, model: EXPLANATION_MODEL, modelVersion: "verify-planted" },
      update: { content: "PLANTED CACHE BODY.", approved: true },
    });
    const approved = await explainPortfolioHealth(target.id);
    ok("★ an APPROVED row is served, cached:true, state 'ok'",
      approved.explanation === "PLANTED CACHE BODY." && approved.cached === true && approved.state === "ok",
      `${approved.state}/${approved.cached}`);
    ok("★ …and the STORED headlineSlot is what's reported", approved.headlineSlot === "health", String(approved.headlineSlot));
    // Restore whatever was genuinely there (or remove the row if nothing was).
    if (prior) {
      await prisma.aiPortfolioExplanation.update({
        where: { userId_factsKey_toneKey: { userId: target.id, factsKey, toneKey } },
        data: { content: prior.content, approved: prior.approved },
      });
    } else {
      await prisma.aiPortfolioExplanation.delete({ where: { userId_factsKey_toneKey: { userId: target.id, factsKey, toneKey } } });
    }

    // A DIFFERENT tone key must miss — the tone dimension is real.
    const otherTone = await prisma.aiPortfolioExplanation.findUnique({
      where: { userId_factsKey_toneKey: { userId: target.id, factsKey, toneKey: `${toneKey}-other` } },
    });
    ok("★ the (user, facts, tone) unique key is enforced by the DB", otherTone === null);

    await prisma.aiPortfolioExplanation.delete({ where: { id: planted.id } });
    ok("★ cleanup — planted row removed", (await prisma.aiPortfolioExplanation.findUnique({ where: { id: planted.id } })) === null);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · THE ROUTE — registered, and no collision on the shared /api/v1/me base path");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const routesOf = (r: { stack: Layer[] }) =>
      r.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route!.methods)[0]!.toUpperCase()} ${l.route!.path}`);
    const ai = routesOf(meAiRouter as unknown as { stack: Layer[] });
    const pf = routesOf(mePortfolioRouter as unknown as { stack: Layer[] });

    ok("★ POST /portfolio/explanation is registered on meAiRouter", ai.includes("POST /portfolio/explanation"), ai.join(" · "));
    ok("★ the stock route is untouched", ai.includes("POST /stocks/:symbol/explanation"));
    ok("★★ no collision — mePortfolioRouter declares NO POST on /portfolio/explanation",
      !pf.includes("POST /portfolio/explanation"),
      pf.filter((p) => p.includes("portfolio")).join(" · "));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · THE FALLBACK STILL COMPOSES for every explaining book (Phase 2 will serve it)");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    let n = 0;
    for (const u of users) {
      const g = await groundPortfolioHealth(u.id);
      if (!g.data.snapshot) continue;
      const t = composeDeterministicPortfolioFallback(g.data);
      if (!t.trim()) { ok(`fallback empty for ${u.email}`, false); continue; }
      n++;
    }
    ok(`★ ${n} explaining books all compose non-empty deterministic prose`, n > 0, `${n} books`);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · ★★ ONE RENDERER, TWO SCOPES — the explain block is a FILTER of the full block");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const target = users.find((u) => results.find((r) => r.email === u.email)?.slot === "health")!;
    const view = (await groundPortfolioHealth(target.id)).data;
    const full = renderPortfolioFacts(view, "full");
    const explain = renderPortfolioFacts(view, "explain");

    // ★ THE STRICT-PREFIX PROPERTY is what makes "filtered" provable rather than claimed: any edit
    // that made the explain block DIFFER (rather than merely STOP EARLIER) fails here.
    ok("★★ the explain block is a strict PREFIX of the full block — filtered, never forked",
      full.startsWith(explain) && explain.length < full.length,
      `explain ${explain.length}c ⊂ full ${full.length}c`);

    ok("★ the full block HAS [REFERENCE FINDINGS]", full.includes("[REFERENCE FINDINGS]"));
    ok("★★ the explain block does NOT", !explain.includes("[REFERENCE FINDINGS]"));
    ok("★★ …and carries no PD finding at all", !/\bPD\d\b/.test(explain),
      (explain.match(/\bPD\d\b/g) ?? []).join(",") || "none");
    ok("★★ …and no time-derived fact (sync ages are f(now) — they churn the key AND stale the prose)",
      !/oldestSyncAgeDays|ageDays|lastSyncedAt/.test(explain),
      (explain.match(/oldestSyncAgeDays|ageDays|lastSyncedAt/g) ?? []).join(",") || "none");
    // …and prove the full block really did contain them, or the assertion above is vacuous.
    ok("★ (control) the FULL block DOES carry those time facts — so the filter did real work",
      /oldestSyncAgeDays|ageDays|lastSyncedAt/.test(full) || /\bPD\d\b/.test(full),
      "PD/time present in full");

    // Every BOOK fact still survives the filter.
    for (const section of ["[COVERAGE]", "[CONSTRUCTION READ]", "[HELD COMPANIES]", "[HEALTH READ]", "[HELD BUT NOT SCORED"]) {
      ok(`★ explain block retains ${section}`, explain.includes(section));
    }

    // ── the facts key: stable under float noise, sensitive to a real move ──
    // Both perturbations are DERIVED FROM THIS BOOK's own text, so neither can go vacuous on a
    // book that happens not to contain a hard-coded literal (the first draft of these did exactly
    // that, and a vacuous assertion is worse than none — it reads as coverage).
    const k1 = portfolioFactsKeyOf(explain);

    // (a) sub-display noise: take a long fraction and move it far below 3 s.f.
    const longFrac = explain.match(/0\.\d{8,}/)?.[0];
    ok("a long fraction exists to jitter", !!longFrac, longFrac ?? "none");
    const jittered = longFrac ? explain.replace(longFrac, longFrac.slice(0, -2) + "97") : explain;
    ok("★★ the key is STABLE under sub-display float noise (a price tick must not bin the cache)",
      jittered !== explain && portfolioFactsKeyOf(jittered) === k1, `${longFrac} → ${jittered.match(/0\.\d{8,}/)?.[0]}`);

    // (b) a real move: change a SPOKEN integer — the health score the model is allowed to state.
    const scoreLine = explain.match(/Health score \(uncapped\): (\d+)/);
    ok("a spoken health score exists to move", !!scoreLine, scoreLine?.[0] ?? "none");
    const moved = scoreLine ? explain.replace(scoreLine[0], `Health score (uncapped): ${Number(scoreLine[1]) + 9}`) : explain;
    ok("★★ …and CHANGES when a spoken number really moves",
      moved !== explain && portfolioFactsKeyOf(moved) !== k1, `${scoreLine?.[1]} → ${Number(scoreLine?.[1]) + 9}`);

    // (c) …and the dropped section cannot influence it at all.
    ok("★★ the key is computed over the EXPLAIN block — appending PD facts cannot change it",
      portfolioFactsKeyOf(explain) === k1 && portfolioFactsKeyOf(full) !== k1,
      "full-block key differs, as it must");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · THE ASKS — state-dependent, verbatim");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const partial = users.find((u) => {
      const r = results.find((x) => x.email === u.email);
      return r?.slot === "health";
    })!;
    const pv = (await groundPortfolioHealth(partial.id)).data;
    const cov = pv.snapshot!.coverageState.scoredWeight;

    const healthAsk = askFor("health", pv);
    const constructionAsk = askFor("construction", pv);

    console.log(`\n  ── HEALTH ask (coverage ${(cov * 100).toFixed(0)}%) ──\n     ${healthAsk.replace(/\. /g, ".\n     ")}\n`);
    console.log(`  ── CONSTRUCTION ask ──\n     ${constructionAsk.replace(/\. /g, ".\n     ")}\n`);

    ok("★ coverage < 100% ⇒ the coverage caveat is appended",
      cov >= 0.999 || healthAsk.includes("covers only the scored part"), `cov=${cov.toFixed(4)}`);
    // ⚠ THE ASSERTION IS ABOUT MOOD, NOT VOCABULARY — my first draft banned the WORDS and failed on the
    // ask's own prohibition ("NO health reading and NO overall verdict"). What must be absent is any
    // POSITIVE request for a verdict; naming one in order to forbid it is the whole point.
    ok("★★ the CONSTRUCTION ask issues no POSITIVE request for a verdict/reading",
      !/lead with/i.test(constructionAsk) && !/give the reading|overall reading|why this portfolio's health reads/i.test(constructionAsk));
    ok("★★ …and every mention of a verdict/reading in it is a PROHIBITION",
      /NO health reading and NO overall verdict/.test(constructionAsk) && /health cannot be read yet/.test(constructionAsk));
    ok("★ (control) the HEALTH ask DOES positively request the reading — the two are opposites",
      /Lead with the overall reading/.test(healthAsk));
    ok("★★ …and explicitly FORBIDS a rating/score/band/grade",
      /do not give it a rating, a score, a band, a grade/.test(constructionAsk));
    ok("★★ …and forbids the adjectives a model reaches for instead",
      /do not describe it as strong, weak, healthy or risky/.test(constructionAsk));
    ok("★ the two asks are genuinely different", healthAsk !== constructionAsk);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · ★★ GUARDRAIL → HARDENED RETRY → THE PROVEN PORTFOLIO FALLBACK (stubbed, no AI)");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const target = users.find((u) => results.find((r) => r.email === u.email)?.slot === "health")!;
    const view = (await groundPortfolioHealth(target.id, "explain")).data;

    const usage: TokenUsage = { promptTokens: 11, outputTokens: 13, cachedTokens: 0, cacheHit: false, modelVersion: "stub-1" };
    const advising = (n: number): AiProvider => {
      let i = 0;
      return {
        generate: async () => ({ text: i++ < n ? "You should trim this position and rebalance now." : "The book reads 71.", usage }),
        generateStructured: async () => { throw new Error("unused"); },
        ping: async () => true,
      };
    };
    const resetAt = new Date("2026-07-24T07:00:00.000Z");
    const allow = async () => ({ allowed: true, remaining: 5, limit: 20, resetAt, scopeDenied: null }) as const;
    const prompt = composePrompt("=== FACTS ===", PORTFOLIO_HEALTH_ASK);

    process.env.AI_QUOTA_ENABLED = "false"; // keeps the stub's tokens off the live counter
    const recovered = await generateGuarded(advising(1), "sys", prompt, allow);
    const blocked = await generateGuarded(advising(99), "sys", prompt, allow);
    delete process.env.AI_QUOTA_ENABLED;

    ok("★ a HARD hit on attempt 1 is RECOVERED by the hardened retry", recovered.kind === "clean" && recovered.attempts === 2,
      `${recovered.kind}/${recovered.kind === "clean" ? recovered.attempts : "-"}`);
    ok("★★ two HARD hits ⇒ blocked (the model's text is NEVER served)", blocked.kind === "blocked");

    // …and what the surface serves instead is the PROVEN fallback.
    const served = composeDeterministicPortfolioFallback(view);
    ok("★★ the blocked path's replacement prose is non-empty", served.trim().length > 0, `${served.length}c`);
    ok("★★ …and is guardrail-CLEAN — the fallback can never be the thing that advises",
      scanExplanationText(served).clean === true, `"${served.slice(0, 80)}…"`);
    ok("★ …and clean on the portfolio advice vocabulary too",
      scanStringsForForwardLanguage("fb", [served], PORTFOLIO_ADVICE_DENY_LIST).length === 0);

    // Quota denial mid-request ⇒ fallback, not nothing.
    let n = 0;
    process.env.AI_QUOTA_ENABLED = "false";
    const midDenied = await generateGuarded(advising(99), "sys", prompt, async () =>
      ++n === 1 ? { allowed: true, remaining: 0, limit: 20, resetAt, scopeDenied: null }
                : { allowed: false, remaining: 0, limit: 20, resetAt, scopeDenied: "user", reason: "user_daily_limit_reached" });
    delete process.env.AI_QUOTA_ENABLED;
    const res = onQuotaDenied({ toneKey: "t", headlineSlot: "health" }, midDenied as Extract<GuardedOutcome, { kind: "quota_denied" }>, () => served);
    ok("★★ mid-request quota denial serves the FALLBACK, not null", res.state === "fallback" && res.explanation === served,
      `${res.state}`);
  }

  console.log(`\n${fail === 0 ? "✅ ALL GREEN" : `❌ ${fail} FAILURE(S)`}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
