// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 GATE — CACHING. Latency, measured cold and warm, plus the two structural properties.
//
//   2a · the request-scoped memo (ctx.once) collapses concurrent slices in ONE turn
//   2b · the TTL cache collapses turns onto one build
//   2c · measured latency before and after, cold and warm
//   2d · the cache is NOT user-scoped and CANNOT become so
//
//   npx tsx src/scripts/verify-universe-cache.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { buildUniverseHealthView } from "../scoring/read/universe-view.service.js";
import {
  getUniverseHealthView,
  universeCacheStats,
  _clearUniverseCacheForVerification,
  _ageUniverseCacheForVerification,
  UNIVERSE_CACHE_TTL_MS,
} from "../scoring/read/universe-view.cache.js";
import { makeToolContext } from "../chat/tools/registry.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);
const ms = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const v = await fn();
  return [v, Date.now() - t];
};

// ══════════════════════════════════════════════════════════════════════════════
section("2c · BEFORE — the uncached builder, called the way a two-round turn would");
{
  const [, a] = await ms(() => buildUniverseHealthView()); // cold process + cold connection
  const [, b] = await ms(() => buildUniverseHealthView());
  const [, c] = await ms(() => buildUniverseHealthView());
  console.log(`  buildUniverseHealthView direct: ${a} ms · ${b} ms · ${c} ms`);
  console.log(`  → a turn that calls two slices pays ${b + c} ms of DB before a single token is generated.`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("2c · AFTER — through the cache");
let coldMs = 0;
let warmMs = 0;
{
  _clearUniverseCacheForVerification();
  ok("starts cold", universeCacheStats().warm === false);
  const [v1, t1] = await ms(() => getUniverseHealthView());
  coldMs = t1;
  const [v2, t2] = await ms(() => getUniverseHealthView());
  const [v3, t3] = await ms(() => getUniverseHealthView());
  warmMs = Math.max(t2, t3);
  console.log(`  cold ${t1} ms · warm ${t2} ms · warm ${t3} ms`);
  ok("cold builds a real view", v1.scored && v1.members.length > 0, `${v1.members.length} members`);
  ok("★ a warm read is effectively free (<5 ms)", t2 < 5 && t3 < 5, `${t2}/${t3} ms`);
  ok("warm returns the SAME object — no re-projection, no re-copy", v1 === v2 && v2 === v3);
  console.log(`  → the same two-slice turn now pays ${t2 + t3} ms.`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("2b · a burst of cold callers shares ONE build (no stampede)");
{
  _clearUniverseCacheForVerification();
  const t = Date.now();
  const views = await Promise.all([
    getUniverseHealthView(),
    getUniverseHealthView(),
    getUniverseHealthView(),
    getUniverseHealthView(),
    getUniverseHealthView(),
  ]);
  const elapsed = Date.now() - t;
  ok("five concurrent cold callers all get the same view object", new Set(views).size === 1);
  ok("and it took about ONE build, not five", elapsed < coldMs * 2, `${elapsed} ms for 5 (one cold build was ${coldMs} ms)`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("2b · TTL + stale-while-revalidate");
{
  console.log(`  TTL = ${UNIVERSE_CACHE_TTL_MS / 1000}s (rescore cadence is a few times a day; a turn is seconds)`);
  const s = universeCacheStats();
  ok("stats report a warm, non-rebuilding slot", s.warm && !s.rebuilding, `age ${s.ageMs} ms`);
  ok("a warm read never awaits the DB", warmMs < 5, `${warmMs} ms`);

  // ── ★ THE STALE PATH, ACTUALLY CROSSED. Backdate past the TTL and read. ──
  const stale = await getUniverseHealthView(); // the object that is about to go stale
  _ageUniverseCacheForVerification(UNIVERSE_CACHE_TTL_MS + 1000);
  ok("the slot now reads as older than the TTL", (universeCacheStats().ageMs ?? 0) > UNIVERSE_CACHE_TTL_MS);
  const [served, tStale] = await ms(() => getUniverseHealthView());
  ok("★ a STALE read returns immediately — it does NOT block on the rebuild", tStale < 5, `${tStale} ms`);
  ok("★ and it serves the LAST GOOD view, not a null or a wait", served === stale);
  ok("a rebuild was kicked off behind it", universeCacheStats().rebuilding === true);
  // Let the background rebuild land, then confirm the slot is fresh and swapped.
  await new Promise((r) => setTimeout(r, 4000));
  const st = universeCacheStats();
  ok("the background rebuild landed and the slot is fresh again", !st.rebuilding && (st.ageMs ?? 1e9) < UNIVERSE_CACHE_TTL_MS,
    `age ${st.ageMs} ms`);
  const after = await getUniverseHealthView();
  ok("the next read gets the REBUILT view, not the stale one", after !== stale && after.members.length === stale.members.length,
    `${after.members.length} members`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("2a · the request-scoped memo (ctx.once) — one turn, one read");
{
  _clearUniverseCacheForVerification();
  const ctx = makeToolContext({ userId: "verify-user", sessionId: "verify-session" });
  let builds = 0;
  const read = () =>
    ctx.once("universeView", async () => {
      builds++;
      return getUniverseHealthView();
    });
  // Four slices in ONE tool round execute through Promise.all — the memo must collapse them.
  const [rs, t] = await ms(() => Promise.all([read(), read(), read(), read()]));
  ok("four concurrent slices in one turn ran ONE read", builds === 1, `${builds} build(s), ${t} ms`);
  ok("all four got the same view", new Set(rs).size === 1);

  // A SECOND turn gets a FRESH context (registry.ts creates one per request) — and lands on the cache.
  const ctx2 = makeToolContext({ userId: "verify-user", sessionId: "verify-session" });
  let builds2 = 0;
  const [, t2] = await ms(() =>
    ctx2.once("universeView", async () => {
      builds2++;
      return getUniverseHealthView();
    }),
  );
  ok("a second turn's fresh memo misses, and the TTL cache catches it", builds2 === 1 && t2 < 5, `${t2} ms`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("2d · NOT user-scoped, and cannot become so");
{
  ok("★ getUniverseHealthView takes ZERO parameters — there is no key a userId could enter through",
    getUniverseHealthView.length === 0);
  const src = readFileSync(new URL("../scoring/read/universe-view.cache.ts", import.meta.url), "utf8");
  ok("the module names no user concept at all", !/userId|authUser|\buser\b/i.test(src.replace(/^\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("the cached slot is a single value, not a Map/Record keyed by anything",
    /let cache: \{ view: UniverseHealthView; builtAt: number \} \| null/.test(src));
  ok("what it caches is exactly the UNAUTHENTICATED public route's payload",
    /universe-view\.cache\.js/.test(readFileSync(new URL("../controllers/universe-health-controller.ts", import.meta.url), "utf8")));
  // The scoped path is applied AFTER the cache, on a copy — so nothing user-shaped is ever stored.
  const before = await getUniverseHealthView();
  const { projectUniverse } = await import("../scoring/read/universe-projection.service.js");
  projectUniverse(before, new Set(["TCS"]), { slice: "overview", scope: "portfolio" });
  const after = await getUniverseHealthView();
  ok("★ projecting a USER-SCOPED slice does not mutate or replace what is cached", before === after && after.members.length === before.members.length,
    `${after.members.length} members still`);
}

console.log(`\n${failures === 0 ? "✅ STAGE 2 GATE PASSED" : `❌ ${failures} FAILURE(S)`}\n`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
