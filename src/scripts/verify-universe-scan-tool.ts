// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3 GATE — THE TOOL. Registry coherence, dispatch, fail-soft, cost.
//
// Everything here runs through the REAL registry executor (makeToolExecutorFor) with a REAL
// ToolContext — the same path a chat turn takes — but with no provider and no HTTP. Whether the model
// CHOOSES it correctly is not testable here and is Stage 5's job; the registry header is explicit that
// a description is only testable live.
//
//   npx tsx src/scripts/verify-universe-scan-tool.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { addTransaction } from "../portfolio/transactions-service.js";
import { CHAT_TOOLS, toolSpecs, findTool, makeToolContext, makeToolExecutorFor } from "../chat/tools/registry.js";
import { UNIVERSE_SLICES } from "../scoring/read/universe-projection.types.js";
import { assertNoInternalIdentifiers, projectUniverse } from "../scoring/read/universe-projection.service.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import { findingName as catFindingName } from "../catalogue/index.js";
import { _clearUniverseCacheForVerification } from "../scoring/read/universe-view.cache.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);
const tok = (s: string) => Math.ceil(s.length / 4);

const ctx = makeToolContext({ userId: "verify-user", sessionId: "verify-session" });
const exec = makeToolExecutorFor(ctx);
const call = (args: Record<string, unknown>) => exec({ id: "t1", name: "getUniverseScan", args });

// ══════════════════════════════════════════════════════════════════════════════
section("3a · registry coherence + the one-tool-with-an-enum decision");
{
  const specs = toolSpecs();
  const spec = specs.find((s) => s.name === "getUniverseScan");
  ok("registered exactly once", CHAT_TOOLS.filter((t) => t.name === "getUniverseScan").length === 1);
  ok("declared to the provider", !!spec);
  ok("resolves through findTool", !!findTool("getUniverseScan"));
  ok("is klass:read (it reads; it writes and navigates nothing)", findTool("getUniverseScan")?.klass === "read");
  const enumVals = (spec!.parameters as { properties: { slice: { enum: string[] } } }).properties.slice.enum;
  ok("the slice enum is exactly the seven slices", JSON.stringify(enumVals) === JSON.stringify([...UNIVERSE_SLICES]),
    enumVals.join(","));
  ok("slice is the only required argument", JSON.stringify((spec!.parameters as { required: string[] }).required) === '["slice"]');
  ok("no user/owner parameter exists in the schema (4b, ahead of Stage 4)",
    !/user|owner|account|reader/i.test(JSON.stringify(Object.keys((spec!.parameters as { properties: object }).properties))));
}

// ══════════════════════════════════════════════════════════════════════════════
section("3d · MEASURED COST against the 10,206-token baseline");
{
  const specs = toolSpecs();
  const spec = specs.find((s) => s.name === "getUniverseScan")!;
  const total = specs.reduce((n, s) => n + tok(JSON.stringify(s)), 0);
  const mine = tok(JSON.stringify(spec));
  console.log(`  registry: ${specs.length} tools · ${total} tok on every message`);
  console.log(`  ├─ baseline without this tool  ${total - mine} tok`);
  console.log(`  └─ getUniverseScan             ${mine} tok  (description ${tok(spec.description)} · parameters ${tok(JSON.stringify(spec.parameters))})`);
  // The counterfactual, computed rather than asserted: seven tools each need the SAME trigger
  // phrasings, period framing and boundary, because each would be picked independently.
  const perTool = tok(JSON.stringify({ name: "getUniverseXxxxx", description: spec.description, parameters: { type: "object", properties: {}, additionalProperties: false } }));
  console.log(`  counterfactual · seven separate tools ≈ ${perTool * 7} tok  (${(perTool * 7 / mine).toFixed(1)}× this)`);
  ok("the enum form costs less than a third of seven separate tools", mine * 3 < perTool * 7);
}

// ══════════════════════════════════════════════════════════════════════════════
section("3 · every slice dispatches through the real executor");
const outputs = new Map<string, string>();
for (const slice of UNIVERSE_SLICES) {
  const args: Record<string, unknown> = { slice };
  if (slice === "band") args.band = "Pristine";
  if (slice === "finding") args.finding = "Pledging Crisis";
  const r = await call(args);
  const out = (r.response as { output?: string }).output ?? "";
  outputs.set(slice, out);
  ok(`slice=${slice} → ok`, !!out && !("error" in r.response), `${tok(out)} tok`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("3c · the period framing is carried on every result");
{
  ok("every result states the legal phrasing",
    [...outputs.values()].every((t) => /each at its most recent reported quarter/.test(t)));
  ok("every result states the forbidden sentence form",
    [...outputs.values()].every((t) => /NEVER name one quarter/.test(t)));
  ok("no result names a quarter as a scope claim",
    ![...outputs.values()].some((t) => /as of FY\d{2}Q\d/i.test(t)));
  const spec = toolSpecs().find((s) => s.name === "getUniverseScan")!;
  ok("★ the DESCRIPTION carries it too — it shapes the sentence before the result arrives",
    /most recent reported quarter/.test(spec.description) && /NEVER name a single quarter/.test(spec.description));
}

// ══════════════════════════════════════════════════════════════════════════════
section("3 · no internal identifier in any tool output");
{
  let leaks = 0;
  for (const [slice, out] of outputs) {
    try {
      assertNoInternalIdentifiers(out, slice);
    } catch (e) {
      leaks++;
      console.log(`     ↳ ${(e as Error).message}`);
    }
  }
  ok("clean across all seven", leaks === 0);
  ok("the finding slice named a red flag by its product name",
    /Pledging Crisis/.test(outputs.get("finding")!) && !/ownership_R1/.test(outputs.get("finding")!));
}

// ══════════════════════════════════════════════════════════════════════════════
section("3 · fail-soft — a bad call is an error handed to the model, never a thrown turn");
{
  for (const bad of [{}, { slice: "" }, { slice: "everything" }, { slice: 42 }, { slice: null }]) {
    const r = await call(bad as Record<string, unknown>);
    const isErr = "error" in r.response;
    ok(`${JSON.stringify(bad)} → honest error`, isErr, isErr ? String((r.response as { error: string }).error).slice(0, 70) : "returned output!");
  }
  // A well-formed slice with a nonsense argument must still be a REAL answer, not an error.
  const b = await call({ slice: "band", band: "excellent" });
  ok("an unknown band is an honest ANSWER, not an error",
    !("error" in b.response) && /not one of Vytal's five bands/.test((b.response as { output: string }).output));
  const f = await call({ slice: "finding", finding: "return on equity above 20%" });
  ok("★ an uncoverable question is an honest cannot-do, with no invented list",
    !("error" in f.response) && /is not a finding Vytal computes/.test((f.response as { output: string }).output));
  ok("  …and it forbids explaining the absence (the §THE PAGES failure)",
    /do NOT describe it as something Vytal chose not to build/.test((f.response as { output: string }).output));
}

// ══════════════════════════════════════════════════════════════════════════════
section("3 · the per-turn memo is actually wired (one turn, one read)");
{
  _clearUniverseCacheForVerification();
  const fresh = makeToolExecutorFor(makeToolContext({ userId: "u", sessionId: "s" }));
  const t = Date.now();
  const rs = await Promise.all([
    fresh({ id: "a", name: "getUniverseScan", args: { slice: "overview" } }),
    fresh({ id: "b", name: "getUniverseScan", args: { slice: "census" } }),
    fresh({ id: "c", name: "getUniverseScan", args: { slice: "movers" } }),
    fresh({ id: "d", name: "getUniverseScan", args: { slice: "divergence" } }),
  ]);
  const elapsed = Date.now() - t;
  ok("four slices in ONE round all succeed", rs.every((r) => !("error" in r.response)));
  ok("★ and cost about one build, not four", elapsed < 3000, `${elapsed} ms cold for 4 concurrent slices`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("P2 · THE RED-FLAG FAMILY SELECTOR");
{
  const view = await getUniverseHealthView();
  const scan = async (args: Record<string, unknown>) => {
    const r = await call(args);
    return (r.response as { output?: string; error?: string });
  };
  const fam = await scan({ slice: "finding", finding: "red flags" });
  const out = fam.output ?? "";
  ok("'red flags' resolves to the FAMILY row", /Red Flags/.test(out) && !/is not a finding Vytal computes/.test(out));
  ok("★ it names the COMPANIES, which is the question census cannot answer",
    ["ASHOKLEY", "DIXON", "GLENMARK", "INFY", "NHPC", "SBIN"].every((s) => out.includes(s)));
  ok("★ the count is the DISTINCT UNION (6), not the sum of the four flags (6 here; a double-firer would collapse)",
    /Firing on 6 of 94 companies/.test(out));
  // ★ THE JOIN, ASSERTED AGAINST THE VIEW ITSELF. Live, the model paired the counts with the company
  //   union and got five of six attributions wrong. The mapping must be present AND right.
  {
    const truth = new Map<string, string[]>();
    for (const m of view.members) for (const f of m.firedFlags) {
      const n = catFindingName(f.flagKey);
      truth.set(n, [...(truth.get(n) ?? []), m.symbol].sort());
    }
    const p = projectUniverse(view, null, { slice: "finding", finding: "red flags" }) as { finding: { subTypesShown?: { name: string; members?: { shown: { symbol: string }[] } }[] } | null };
    const shown = p.finding?.subTypesShown ?? [];
    ok("★ every red flag carries ITS OWN companies — the join is supplied, not left to be guessed",
      shown.length > 0 && shown.every((t) => (t.members?.shown.length ?? 0) > 0));
    const wrong = shown.filter((t) => JSON.stringify(t.members?.shown.map((m) => m.symbol) ?? []) !== JSON.stringify(truth.get(t.name) ?? []));
    ok("★ and every mapping matches the view exactly", wrong.length === 0,
      wrong.map((t) => `${t.name}: got ${t.members?.shown.map((m) => m.symbol)} want ${truth.get(t.name)}`).join(" | "));
    for (const [n, syms] of truth) console.log(`     ground truth · ${n} → ${syms.join(", ")}`);
    ok("the census — which CANNOT carry the mapping — says so instead of leaving the gap open",
      /DO NOT PAIR THE TWO LISTS ABOVE/.test(outputs.get("census")!));
  }
  ok("the four constituent flags are NAMED through the catalogue, each with its count AND its companies",
    /Distribution Pattern — 3 companies: /.test(out) && /Pledging Crisis — 1 company: ASHOKLEY/.test(out) &&
      /Promoter Exit — 1 company: NHPC/.test(out) && /Interest Coverage Collapse — 1 company: GLENMARK/.test(out));
  ok("★ they are framed as DISTINCT risks, not as sub-forms of one (the §5C copy is divergence-only)",
    /DISTINCT risks, not variants of one/.test(out) && !/say one, never one per form/.test(out));
  ok("it carries family A's catalogue boundary line, not a re-authored one",
    /not a prediction the stock will fall/.test(out));
  ok("no internal identifier", (() => { try { assertNoInternalIdentifiers(out, "family"); return true; } catch { return false; } })());
  console.log(`     → ${tok(out)} tok`);

  // 2b · what resolves and what does not — the whole surface, stated.
  const RESOLVE = ["red flags", "Red Flags", "red flag", "any red flag", "ANY RED FLAGS", "all red flags",
    "the red flags", "red-flags", "critical findings", "critical red flags", "stocks firing red flags", "flags", "any flag"];
  const REDIRECT = ["patterns", "pattern", "all patterns", "any pattern"];
  const MISS = ["warnings", "risks", "alerts", "red", "concerns", "signals", "return on equity above 20%"];
  for (const q of RESOLVE) {
    const t = (await scan({ slice: "finding", finding: q })).output ?? "";
    ok(`resolves: ${JSON.stringify(q)}`, /Red Flags — red flag/.test(t));
  }
  for (const q of REDIRECT) {
    const t = (await scan({ slice: "finding", finding: q })).output ?? "";
    ok(`redirects (a REAL family, never denied): ${JSON.stringify(q)}`,
      /names a whole FAMILY of findings/.test(t) && /real Vytal vocabulary and you must not say otherwise/.test(t) &&
        !/is not a finding Vytal computes/.test(t), t.slice(0, 80));
  }
  for (const q of MISS) {
    const t = (await scan({ slice: "finding", finding: q })).output ?? "";
    ok(`honest miss (never an empty list): ${JSON.stringify(q)}`,
      /is not a finding Vytal computes/.test(t) && /Findings actually firing right now:/.test(t));
  }
  // A single named finding still works — the selector must not have swallowed the name path.
  const one = (await scan({ slice: "finding", finding: "Pledging Crisis" })).output ?? "";
  ok("a single finding NAME still resolves to that one finding", /Pledging Crisis — red flag/.test(one) && /Firing on 1 of 94/.test(one));
  const div = (await scan({ slice: "finding", finding: "divergence" })).output ?? "";
  ok("…and divergence still consolidates to ONE with its sub-forms", /Divergence — pattern/.test(div) && /say one, never one per form/.test(div));
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 4 — SCOPE. Two REAL users, real holdings, real watchlists, adversarial arguments.
// ══════════════════════════════════════════════════════════════════════════════
const A_HOLDS = ["TCS", "INFY"];
const B_HOLDS = ["RELIANCE"];
const A_WATCHES = ["HDFCBANK"];
const B_WATCHES = ["WIPRO"];

async function seed(tag: string, holds: string[], watches: string[]) {
  const { authId } = await createThrowawayUser(`uscan-${tag}`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  if (holds.length) {
    // A manual write needs an account to land in (portfolio accounts are the first-class unit).
    await prisma.portfolioAccount.create({ data: { userId: u.id, name: "My Holdings", broker: "zerodha", state: "manual" } });
  }
  for (const symbol of holds) {
    await addTransaction({ symbol, type: "buy", quantity: 10, price: 100, tradeDate: "2026-01-15" }, u.id);
  }
  for (const symbol of watches) {
    const s = await prisma.stock.findUniqueOrThrow({ where: { symbol }, select: { id: true } });
    await prisma.watchlist.create({ data: { userId: u.id, stockId: s.id } });
  }
  return { authId, userId: u.id };
}

const seeded: string[] = [];
try {
  section("4 · SETUP — two readers with disjoint books");
  const A = await seed("a", A_HOLDS, A_WATCHES);
  const B = await seed("b", B_HOLDS, B_WATCHES);
  seeded.push(A.authId, B.authId);
  console.log(`  A holds ${A_HOLDS.join("+")}, watches ${A_WATCHES.join("+")} · B holds ${B_HOLDS.join("+")}, watches ${B_WATCHES.join("+")}`);

  const asUser = (userId: string) => makeToolExecutorFor(makeToolContext({ userId, sessionId: `s-${userId}` }));
  const scan = async (userId: string, args: Record<string, unknown>) => {
    const r = await asUser(userId)({ id: "x", name: "getUniverseScan", args });
    return r.response as { output?: string; error?: string };
  };

  // ── 4a · the intersection actually happens, SERVER-SIDE ──
  section("4a · server-side intersection");
  {
    const a = await scan(A.userId, { slice: "overview", scope: "portfolio" });
    console.log(a.output!.split("\n").slice(0, 3).map((l) => "     │ " + l.slice(0, 130)).join("\n"));
    ok("A's portfolio scope reads only A's scored holdings",
      /Companies carrying a Vytal health score: 2\b/.test(a.output ?? ""), (a.output ?? "").match(/health score: \d+/)?.[0]);
    const aBand = await scan(A.userId, { slice: "band", scope: "portfolio" });
    ok("and the band counts sum to 2, not 94", (aBand.output ?? "").includes("out of 2 scored companies"));
    const aw = await scan(A.userId, { slice: "census", scope: "watchlist" });
    ok("A's watchlist scope reads only A's watched name", /across these 1 companies/.test(aw.output ?? ""));
    const uni = await scan(A.userId, { slice: "overview" });
    ok("no scope ⇒ the full public universe, unchanged", /health score: 94\b/.test(uni.output ?? ""));
    ok("a scoped result SAYS it is scoped, so it can never be relayed as market-wide",
      /never relay these as market-wide numbers/.test(a.output ?? ""));
  }

  // ── 4d · cross-user isolation, adversarially ──
  section("4d · cross-user isolation — a bogus scope argument is INERT");
  {
    const aPf = (await scan(A.userId, { slice: "band", scope: "portfolio", band: "Steady" })).output ?? "";
    const bPf = (await scan(B.userId, { slice: "band", scope: "portfolio", band: "Steady" })).output ?? "";
    ok("A never sees a symbol only B holds", !B_HOLDS.some((s) => aPf.includes(s)));
    ok("B never sees a symbol only A holds", !A_HOLDS.some((s) => bPf.includes(s)));

    // Every shape a model could use to try to name someone else. None reaches a query.
    const crafted: unknown[] = [
      `portfolio:${B.userId}`,
      { scope: "portfolio", userId: B.userId },
      ["portfolio"],
      "universe' OR 1=1 --",
      "PORTFOLIO;DROP TABLE holdings",
      B.userId,
      "",
      42,
      true,
    ];
    for (const bad of crafted) {
      const r = await scan(A.userId, { slice: "overview", scope: bad });
      const refused = typeof r.error === "string" && /must be one of/.test(r.error);
      ok(`scope=${JSON.stringify(bad)} → refused before any read`, refused, refused ? "" : `LEAKED: ${(r.output ?? "").slice(0, 80)}`);
    }
    // The two harmless normalisations that SHOULD work — casing and whitespace, not identity.
    for (const good of ["PORTFOLIO", " portfolio ", "Watchlist"]) {
      const r = await scan(A.userId, { slice: "overview", scope: good });
      ok(`scope=${JSON.stringify(good)} → accepted (case/space only)`, !r.error);
    }
    // ★ THE STRUCTURAL CLAIM: there is nowhere for a user to be named.
    const spec = toolSpecs().find((s) => s.name === "getUniverseScan")!;
    const props = Object.keys((spec.parameters as { properties: Record<string, unknown> }).properties);
    ok("★ the JSON schema has no user/owner/account property, and never will", JSON.stringify(props) === '["slice","band","finding","scope"]', props.join(","));
    ok("★ `scope` is a closed 3-value enum — it carries WHICH list, never WHOSE",
      JSON.stringify((spec.parameters as { properties: { scope: { enum: string[] } } }).properties.scope.enum) === '["universe","portfolio","watchlist"]');
    const src = readFileSync(new URL("../chat/tools/get-universe-scan.ts", import.meta.url), "utf8");
    ok("the handler reads ctx.userId and never args for identity", /ctx\.userId/.test(src) && !/args\.(userId|user|owner)/.test(src));
  }

  // ── an empty scope is an honest state, not an error ──
  section("4 · an empty scope");
  {
    const { authId } = await createThrowawayUser("uscan-empty");
    seeded.push(authId);
    const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
    const r = await scan(u.id, { slice: "overview", scope: "portfolio" });
    ok("a reader who holds nothing scored gets an honest empty ANSWER, not an error",
      !r.error && /nothing that Vytal scores/.test(r.output ?? ""));
    ok("  …and it is not framed as a gap in Vytal", /not an error and not a gap in Vytal/.test(r.output ?? ""));
  }

  // ── 4c · the public route stays unauthenticated, and scoped reads cannot reach it ──
  section("4c · the public universe route");
  {
    const appSrc = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const mount = appSrc.split("\n").find((l) => l.includes("universeHealthRouter") && l.includes("app.use")) ?? "";
    console.log(`     mount: ${mount.trim()}`);
    ok("★ /api/universe is still mounted with NO auth middleware", /app\.use\("\/api\/universe", universeHealthRouter\)/.test(mount));
    ok("the chat (the only scoped caller) is mounted behind requireAuth",
      /app\.use\("\/api\/v1\/me", requireAuth, meChatRouter\)/.test(appSrc));
    const ctrl = readFileSync(new URL("../controllers/universe-health-controller.ts", import.meta.url), "utf8");
    ok("the public controller names no user and passes no scope", !/userId|authUser|scope/.test(ctrl.replace(/\/\/.*$/gm, "")));
    ok("it serves the UNSCOPED view — projectUniverse is never called there", !/projectUniverse|renderUniverseSlice/.test(ctrl));
    // And the scoped reads did not disturb what the public route serves.
    const uni = (await scan(A.userId, { slice: "overview" })).output ?? "";
    ok("★ after every scoped read above, the public universe still reads 94", /health score: 94\b/.test(uni));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  section("VERBATIM — the census result as a turn receives it");
  console.log(outputs.get("census")!.split("\n").map((l) => "  │ " + l).join("\n").slice(0, 2400));
} finally {
  if (seeded.length) await cleanupThrowawayUsers();
}

console.log(`\n${failures === 0 ? "✅ STAGE 3+4 GATE PASSED" : `❌ ${failures} FAILURE(S)`}\n`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
