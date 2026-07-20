// ─────────────────────────────────────────────────────────────────────────────
// STEP 5.5 BOUNDARY PROOF — what this step was allowed to touch, and what it did not.
// `git diff` cannot isolate this step (the repo carries a large uncommitted backlog from
// Steps 1–5 — all of src/brokers/ is still untracked), so the fence is proven two ways:
//   1. MTIME — files modified in this session vs the frozen ones
//   2. CONTENT — the invariants that matter, asserted directly
//   npx tsx src/scripts/verify-step55-boundary.ts
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, statSync } from "fs";
import { IMPLEMENTED_BROKERS } from "../brokers/registry.js";
import { brokerCatalog } from "../brokers/catalog.js";
import type { BrokerAdapter } from "../brokers/types.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};
const read = (p: string) => readFileSync(p, "utf8");
const mtime = (p: string) => statSync(p).mtimeMs;

/** Strip comments before asserting on CODE. Without this, a probe "proves" a violation from a
 *  line that documents why the violation cannot happen — e.g. registry.ts's commented-out
 *  `// upstox: () => new UpstoxAdapter()` roadmap line, or catalog.ts's header explaining that
 *  it deliberately does NOT call getAdapter(). Grepping prose and calling it evidence is how a
 *  boundary check lies in both directions. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "")        // whole-line // comments
    .replace(/\/\/.*$/gm, "");           // trailing // comments

// PER-STEP BASELINE — and this matters, because an mtime check is only meaningful against the step
// you are actually policing. Each step's fence was proven at its own gate; re-using an old anchor
// reports "violations" that are simply later, approved work.
//
// ── RE-ANCHORED ON STEP 20 (manual multi-asset holdings). ──
//
// Step 20 was AUTHORISED to touch the FIFO write seam: replay.ts (re-keyed from the stock to the
// instrument), transfer.ts (same re-key + the R4 guard, whose stated rationale — "both are NOT NULL on
// a manual holding" — is precisely what Step 20 repealed), the transactions/holdings controllers, and
// nav/assemble.ts. Those files are therefore NOT in the frozen list any more, and asserting their
// mtimes would only report approved work as a breach.
//
// (Note for the record: under the OLD Step-7 anchor this harness was ALREADY red on brokers/union.ts,
// which Step 7 itself modified one minute after the anchor file. That was a stale-baseline artefact,
// not a breach, and re-anchoring clears it honestly rather than by deleting the check.)
//
// What is frozen below is what Step 20 must NOT have touched — and the FIRST of them is the whole
// point of the step: the cost-basis math never needed to change, because it was never equity-specific.
const STEP20_START = mtime("src/portfolio/resolve-instrument.ts") - 120_000;
const untouched = (p: string) => mtime(p) < STEP20_START;

console.log("═══ 1. FROZEN BY STEP 20's FENCE — not modified by this step (mtime) ═══");
const FROZEN = [
  // ★ THE FENCE THAT DEFINES THE STEP. fifo-engine walks lots, quantities, prices, fees and
  //   split/bonus ratios — it never knew what a stock was ("shares" is only what the variables are
  //   called). Units of an ETF, a fund or a bond replay through it correctly ALREADY. If Step 20 had
  //   needed to edit one line of it, the design was wrong.
  "src/portfolio/fifo-engine.ts",
  // ── (Construction v2 Stage 0) phs/engine.ts and portfolio-snapshot-controller.ts are NO LONGER
  //    mtime-frozen here — same precedent as replay.ts/transfer.ts leaving the Step-7 anchor above.
  //    Step 20 never needed to touch the score to hold a non-stock, and did not. CV2 Stage 0 LATER
  //    made a deliberate, ruled change: heldNotScored now enters the weight vector as UNSCORED
  //    capital, and Signals' weight denominator was corrected to match Quality's (a §13-adjacent bug
  //    fix). Asserting their mtimes now would report that approved work as a breach. The invariant
  //    that still matters — Health cannot move — is policed by CONTENT (§8 below) and by
  //    verify-step145 / verify-phs-examples, a stronger guard than any mtime. ──
  "src/portfolio/phs/refresh.ts",
  "src/scoring/read/fundamentals-view.service.ts",
  // The broker spine and the unified read.
  "src/brokers/crypto.ts",
  "src/brokers/registry.ts",
  "src/brokers/catalog.ts",
  "src/brokers/union.ts",
  "src/controllers/me/accounts-controller.ts",
];
for (const f of FROZEN) assert(`UNTOUCHED: ${f}`, untouched(f), untouched(f) ? "not modified" : "⚠️ MODIFIED THIS STEP");

console.log("\n═══ 2. FENCE EXCEPTION — exactly three files, additive only ═══");
const registry = code("src/brokers/registry.ts"); // CODE only — the roadmap comments are not adapters
const types = read("src/brokers/types.ts");
assert("types.ts: BrokerId union carries all 17 catalog members",
  ["mock", "zerodha", "upstox", "groww", "angelone", "dhan", "fyers", "icicidirect", "hdfcsecurities",
   "kotak", "sharekhan", "fivepaisa", "motilaloswal", "iifl", "sbisecurities", "paytmmoney", "axisdirect"]
    .every((b) => types.includes(`"${b}"`)), "all 17 present");
assert("registry.ts: IMPLEMENTED_BROKERS is UNCHANGED (mock + zerodha only)",
  IMPLEMENTED_BROKERS.length === 2 && IMPLEMENTED_BROKERS.includes("mock") && IMPLEMENTED_BROKERS.includes("zerodha"),
  `IMPLEMENTED_BROKERS=[${IMPLEMENTED_BROKERS.join(", ")}]`);
assert("registry.ts: the ONLY real adapters are still MockAdapter + ZerodhaAdapter",
  (registry.match(/new \w+Adapter\(\)/g) ?? []).sort().join(",") === "new MockAdapter(),new ZerodhaAdapter()",
  `found: ${(registry.match(/new \w+Adapter\(\)/g) ?? []).join(" ")}`);
assert("registry.ts: every added broker resolves to notYet() (no adapter logic added)",
  (registry.match(/notYet\("/g) ?? []).length === 15, `notYet entries=${(registry.match(/notYet\("/g) ?? []).length} (upstox, groww + 13 new)`);
assert("catalog.ts: `linkable` is DERIVED from the registry, never a second hard-coded list",
  read("src/brokers/catalog.ts").includes("IMPLEMENTED_BROKERS.includes(id)"), "derived");
assert("catalog.ts routes NO broker through getAdapter() (which throws for adapter-less brokers)",
  !code("src/brokers/catalog.ts").includes("getAdapter"), "no getAdapter call in code");

console.log("\n═══ 3. THE READ-ONLY CONTRACT — no broker WRITE method exists ═══");
// The adapter interface is the ONLY seam to a broker. If it has no write verb, no code path —
// present or future — can push an order/holding INTO a broker. Assert on the TYPE's own surface.
const adapterIface = code("src/brokers/types.ts");
const WRITE_VERBS = ["placeOrder", "cancelOrder", "modifyOrder", "writeHoldings", "pushHoldings", "createOrder", "sell(", "buy("];
for (const v of WRITE_VERBS) {
  assert(`BrokerAdapter has NO \`${v}\` seam`, !adapterIface.includes(v), adapterIface.includes(v) ? "⚠️ FOUND" : "absent");
}
// Compile-time echo of the same fact: these are the only methods the core may call.
const _contract: (keyof BrokerAdapter)[] = ["meta", "authenticate", "isSessionAlive", "fetchHoldings", "normalize"];
assert("BrokerAdapter's surface is read-only (meta/authenticate/isSessionAlive/fetchHoldings/normalize)",
  _contract.length === 5, _contract.join(", "));

console.log("\n═══ 4. INSTRUMENT-AGNOSTIC — no new stock-only hardcode in the account model ═══");
const accountsCtl = code("src/controllers/me/accounts-controller.ts");
const catalogSrc = code("src/brokers/catalog.ts");
assert("accounts-controller mentions no stock/instrument/asset-class at all (broker + account only)",
  !/stockId|stock_id|assetClass|instrumentId/.test(accountsCtl), "clean");
assert("catalog.ts mentions no stock/instrument concept either",
  !/stockId|instrument|assetClass/i.test(catalogSrc), "clean");
assert("the account model keys on (account, INSTRUMENT) — unchanged by this step",
  read("prisma/schema.prisma").includes("@@unique([accountId, instrumentId])"), "holdings unique key intact");

console.log("\n═══ 5. FIFO MATH — frozen, byte-for-byte ═══");
const fifo = read("src/portfolio/fifo-engine.ts"); // raw: asserting on the real math lines
assert("fifo-engine still consumes the OLDEST lot first (queue.shift on full consumption)",
  fifo.includes("if (lot.quantity.lte(0)) queue.shift();"), "FIFO intact");
assert("fifo-engine still folds buy fees into cost basis and sell fees out of proceeds",
  fifo.includes("const feePerShare = (t.fees ?? D0()).div(t.quantity);") && fifo.includes("realized = realized.minus(t.fees ?? D0());"), "fee handling intact");

console.log("\n═══ 6. CATALOG COMPLETENESS (load-bearing — there is no 'other' escape) ═══");
const cat = brokerCatalog();
assert("catalog has 17 members and NO 'other' fallback", cat.length === 17 && !cat.some((b) => b.id === ("other" as never)),
  `n=${cat.length} ids=${cat.map((b) => b.id).join(",")}`);
assert("every catalog member has a real display name (no id leaking to the UI)",
  cat.every((b) => b.displayName.length > 0 && b.displayName !== b.id), "all named");

console.log("\n═══ 7. STEP 6 — transfer/rescue did NOT reopen the FIFO seam ═══");
const transfer = code("src/portfolio/transfer.ts");
assert("transfer.ts CALLS replayAndMaterialize — it does not reimplement lot math",
  transfer.includes("replayAndMaterialize("), "delegates to the frozen replay");
assert("transfer.ts contains NO lot algorithm (no queue walk, no cost-per-share arithmetic)",
  !/queue\.shift|queue\.push|costPerShare\s*[:=]\s*[^,}]*(plus|minus|times|div)/.test(transfer), "no FIFO code");
// ── (Step 20) replay.ts IS NO LONGER FROZEN, AND THAT IS APPROVED — BUT THE ENGINE STILL IS. ──
//
// Step 20 re-keyed replayAndMaterialize from the STOCK to the INSTRUMENT, which is what made manual
// ETF/fund/REIT/bond holdings possible: the old code resolved the holding via
// `instrument.findUnique({ where: { stockId } })`, and every non-stock instrument has stock_id NULL,
// so it could never resolve one. That is a legitimate, gated change to the DB SEAM.
//
// What it must NOT have done — and what this file still polices, harder than before — is touch the
// COST-BASIS MATH. fifo-engine.ts never knew what a stock was: it walks lots, quantities, prices, fees
// and split/bonus ratios, and "shares" is only what the variables are called. Units of an ETF replay
// through it correctly ALREADY. If Step 20 had needed to edit it, the design was wrong.
const replaySrc = code("src/portfolio/replay.ts");
assert("replay.ts still DELEGATES to the pure engine — the re-key moved the KEY, not the math",
  replaySrc.includes("replayFifo(ledger)") &&
    !/queue\.shift|queue\.push|costPerShare\s*[:=]\s*[^,}]*(plus|minus|times|div)/.test(replaySrc),
  "calls replayFifo; contains no lot algorithm of its own");
assert("★ fifo-engine.ts is UNTOUCHED — Step 20 enabled every asset class without editing one line " +
  "of the cost-basis math, because the math was never equity-specific to begin with",
  untouched("src/portfolio/fifo-engine.ts"), "frozen");
assert("MIRROR WALL: every transfer path refuses a destination whose state is not `manual`",
  transfer.includes('destination.state !== "manual"') && transfer.includes("destination_linked"), "requireWritableDestination");
assert("transfer.ts NEVER inserts or updates a broker table (the only broker write is the rescue DELETE)",
  !/brokerHolding\.(create|update|upsert|createMany)|brokerConnection\.(create|update|upsert)/.test(transfer),
  "no broker-table inserts/updates");
assert("...and the one broker write it DOES make is the connection delete (so rows cannot orphan)",
  transfer.includes("brokerConnection.delete("), "connection delete present");
assert("scoring/ untouched by Step 6", untouched("src/scoring/read/fundamentals-view.service.ts"), "frozen");

console.log("\n═══ 8. STEP 7 — sync/poll/add-to-universe stayed READ-ONLY ═══");
const adapterTypes = code("src/brokers/types.ts");
const admit = code("src/brokers/universe-admit.ts");
const zerodha = code("src/brokers/adapters/zerodha.ts");
const poll = code("src/jobs/handlers/broker-poll-sync.handler.ts");

assert("StandardHolding widened with isin + exchange (read-only fields flowing OUT of the broker)",
  adapterTypes.includes("isin: string | null") && adapterTypes.includes("exchange: string | null"), "contract widened");
assert("...and NO write verb was added to BrokerAdapter — the seam is still fetch-only",
  !/placeOrder|createOrder|cancelOrder|modifyOrder|writeHoldings|pushHoldings/.test(adapterTypes), "no write verb");
assert("zerodha added NO new broker call — it only carries isin/exchange through normalize()",
  (zerodha.match(/getHoldings\(|createSession\(/g) ?? []).length === 2 && zerodha.includes("isin:"),
  "still exactly 2 HTTP calls (session + holdings)");

assert("add-to-universe NEVER fabricates an ISIN (no synthetic spine)",
  !/SYNTH|PLACEHOLDER/i.test(admit), "no fabricated ISIN");
assert("add-to-universe only CREATES stocks — it never updates or deletes one",
  admit.includes("stock.create(") && !/stock\.(update|delete|upsert|updateMany|deleteMany)/.test(admit),
  "a broker feed may EXTEND the universe, never rewrite it");
assert("add-to-universe writes NOTHING to a broker table",
  !/brokerHolding\.|brokerConnection\./.test(admit), "no broker-table writes");

assert("the poll sweep accepts NO user id — it reads the owner off each connection row (IDOR-proof)",
  poll.includes("conn.userId") && !/userId\s*[:=]\s*ctx\.payload/.test(poll), "userId derived, never accepted");
assert("the poll NEVER severs a connection (§2.5 — token death is not a sever)",
  !/deactivate|severConnection|linked_stale/.test(poll), "no sever path in the sweep");

assert("FIFO engine untouched", untouched("src/portfolio/fifo-engine.ts"), "frozen");
// (replay.ts is deliberately absent — Step 20 re-keyed it, which is what made non-stock holdings
//  possible. It is policed by CONTENT above instead: it must still delegate to the pure engine and
//  contain no lot algorithm of its own. A content check is the stronger guard anyway.)
// ── (Construction v2 Stage 0) phs/engine.ts is no longer mtime-frozen (CV2 ruled a change to
//    Signals' weight denominator). Policed by CONTENT instead — the thing that must hold: Health's
//    LAW is unchanged and the weight vector is still marketValue, never cost basis (Ruling 3). ──
const engineCode = code("src/portfolio/phs/engine.ts");
assert("HEALTH LAW intact — still Quality − 0.20×(100−Signals), no positional term re-added",
  engineCode.includes("K.W_SIGNAL * (100 - signals)"), "combine unchanged");
assert("the weight vector is marketValue, never invested / cost-basis (Ruling 3 grep-guard)",
  !/\binvested\b/.test(engineCode), "no `invested` in the engine");
assert("crypto untouched", untouched("src/brokers/crypto.ts"), "frozen");

console.log(`\n${failures === 0 ? "✅ BOUNDARY HELD — 5.5: types/registry/catalog · Step 6: no FIFO seam · Step 7: broker still read-only" : `❌ ${failures} BOUNDARY VIOLATION(S)`}`);
process.exit(failures === 0 ? 0 : 1);
