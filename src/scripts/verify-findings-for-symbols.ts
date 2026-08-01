// ─────────────────────────────────────────────────────────────────────────────
// PART 3 GATE — getFindingsForSymbols. The batch read, its boundaries and its payload.
//
//   3a · cap 20 · catalogue names · descriptions · the ROW'S RENDERED VERDICT (read, not re-made)
//   3b · the SHARED head resolver, and what adopting it would change for alerts (reported, not done)
//   3c · honest-empty for unscored and for uncovered — never an empty array that reads as "clean"
//   3d · measured payload, worst case and realistic
//   3e · the boundary with getUniverseScan, written into BOTH descriptions
//   +  · §5C applies per stock too — one divergence row, not four
//
//   npx tsx src/scripts/verify-findings-for-symbols.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { toolSpecs, makeToolContext, makeToolExecutorFor, findTool } from "../chat/tools/registry.js";
import { readFindingsForSymbols, MAX_SYMBOLS, MAX_FINDINGS_PER_SYMBOL } from "../scoring/read/symbol-findings.service.js";
import { resolveHeadSnapshots, splitByStaleness } from "../scoring/read/head-snapshot.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import { renderVerdict } from "../scoring/findings/verdicts.js";
import { DIVERGENCE_SUB_TYPE_KEYS } from "../catalogue/index.js";
import { assertNoInternalIdentifiers } from "../scoring/read/universe-projection.service.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);
const tok = (s: string) => Math.ceil(s.length / 4);

const exec = makeToolExecutorFor(makeToolContext({ userId: "verify-user", sessionId: "verify-session" }));
const run = async (symbols: unknown) => {
  const r = await exec({ id: "x", name: "getFindingsForSymbols", args: { symbols } });
  const resp = r.response as { output?: string; error?: string };
  return { text: resp.output ?? "", error: resp.error };
};

const view = await getUniverseHealthView();
const freshestAsOf = view.asOfDate ? new Date(`${view.asOfDate}T00:00:00.000Z`) : null;
const busyOf = (m: (typeof view.members)[number]) =>
  m.firedFlags.length + m.firedPatterns.filter((p) => !p.patternKey.startsWith("lens_")).length;
const BUSIEST = [...view.members].sort((a, b) => busyOf(b) - busyOf(a)).slice(0, 20).map((m) => m.symbol);

// ══════════════════════════════════════════════════════════════════════════════
section("3a · registry, shape, and the VERDICT");
{
  const spec = toolSpecs().find((s) => s.name === "getFindingsForSymbols");
  ok("registered and declared", !!spec && !!findTool("getFindingsForSymbols"));
  ok("klass:read", findTool("getFindingsForSymbols")?.klass === "read");
  ok("takes an array of strings, and nothing else",
    JSON.stringify((spec!.parameters as { properties: Record<string, unknown> }).properties) ===
      JSON.stringify({ symbols: { type: "array", items: { type: "string" }, description: `NSE tickers, e.g. ["TCS","INFY","HDFCBANK"]. Up to ${MAX_SYMBOLS}; extras are dropped and reported.` } }));
  ok("★ no user/owner parameter — this reads public product data only",
    !/user|owner|account|portfolio|watchlist/i.test(JSON.stringify((spec!.parameters as { properties: object }).properties)));

  // ★ THE VERDICT IS READ, NOT RE-RENDERED. Compare the service's string with renderVerdict called
  //   directly on the same row — a second authority would show up as a mismatch.
  const res = await readFindingsForSymbols(["INFY"], { freshestAsOf });
  const row = res.rows[0];
  ok("INFY comes back scored with findings", row.status === "scored" && row.findings.total > 0, `${row.findings.total} findings`);
  const stock = await prisma.stock.findUniqueOrThrow({ where: { symbol: "INFY" }, select: { id: true } });
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { stockId: stock.id, snapshotType: "quarterly" },
    select: { id: true, stockId: true, periodKey: true, version: true, asOfDate: true },
  });
  const head = resolveHeadSnapshots(snaps).get(stock.id)!;
  const flags = await prisma.redFlag.findMany({ where: { snapshotId: head.id }, select: { flagKey: true, triggeringValues: true } });
  let matched = 0;
  for (const f of flags) {
    const expected = renderVerdict(f.flagKey, f.triggeringValues ?? null);
    if (row.findings.shown.some((x) => x.verdict === expected)) matched++;
  }
  ok("★ every red-flag verdict is BYTE-IDENTICAL to renderVerdict — one authority, not two",
    flags.length > 0 && matched === flags.length, `${matched}/${flags.length}`);
  ok("every finding carries a non-empty verdict", row.findings.shown.every((f) => f.verdict.trim().length > 10));
  ok("every finding is catalogue-NAMED (no key shape, no underscore)",
    row.findings.shown.every((f) => f.name.length > 2 && !/_/.test(f.name)));
  ok("descriptions are emitted ONCE for the call, not per row", res.definitions.length > 0 && res.definitions.every((d) => d.description.length > 20 && d.doesntMean.length > 10),
    `${res.definitions.length} definitions for ${row.findings.total} findings`);
  ok(`the symbol cap is ${MAX_SYMBOLS}`, MAX_SYMBOLS === 20);
}

// ══════════════════════════════════════════════════════════════════════════════
section("3b · the SHARED head resolver — and what alerts would change");
{
  const rows = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly" },
    select: { id: true, stockId: true, symbol: true, periodKey: true, version: true, asOfDate: true },
  });
  const head = resolveHeadSnapshots(rows);
  const byStock = new Map<string, typeof rows>();
  for (const r of rows) {
    const a = byStock.get(r.stockId) ?? [];
    a.push(r);
    byStock.set(r.stockId, a);
  }
  let differs = 0;
  let ties = 0;
  for (const [stockId, rs] of byStock) {
    // alerts/eval-pass.ts: orderBy [asOfDate desc, version desc], take the first row.
    const alertsPick = [...rs].sort((a, b) => b.asOfDate.getTime() - a.asOfDate.getTime() || b.version - a.version)[0];
    const h = head.get(stockId)!;
    const atMax = new Set(rs.filter((r) => r.asOfDate.getTime() === alertsPick.asOfDate.getTime()).map((r) => r.periodKey));
    if (atMax.size > 1) ties++;
    if (alertsPick.id !== h.id) differs++;
  }
  const { current, stale } = splitByStaleness(head.values());
  console.log(`  stocks ${byStock.size} · snapshots ${rows.length}`);
  console.log(`  ├─ rows where alerts' orderBy and resolveHeadSnapshots pick a DIFFERENT snapshot: ${differs}`);
  console.log(`  ├─ stocks carrying >1 period at their newest asOfDate (the tie case): ${ties}`);
  console.log(`  └─ staleness: ${current.length} current / ${stale.length} stale (${stale.map((s) => s.symbol).join(", ") || "none"})`);
  ok("★ the tie-break divergence is LATENT, not live — no row differs today", differs === 0 && ties === 0);
  console.log(`     ⇒ ADOPTING IT IN ALERTS WOULD STILL CHANGE TWO THINGS, so alerts is left alone:`);
  console.log(`       1. staleness — alerts would have to keep evaluating the ${stale.length} dark name(s) the universe holds out.`);
  console.log(`       2. alerts needs the PRIOR snapshot (rows[1]) for band crossings; a head resolver returns one row per stock.`);
  ok("the universe view now consumes the shared resolver (its own copy is gone)",
    !/const inForce = new Map<string, LeanSnap>\(\)/.test(
      await import("fs").then((fs) => fs.readFileSync(new URL("../scoring/read/universe-view.service.ts", import.meta.url), "utf8")),
    ));
}

// ══════════════════════════════════════════════════════════════════════════════
section("3c · honest-empty — an empty array must never read as 'clean'");
{
  const mixed = await run(["TCS", "NOTAREALTICKER", "INFY"]);
  ok("an uncovered symbol states the COVERAGE boundary", /NOT COVERED BY VYTAL/.test(mixed.text));
  ok("  …and says explicitly it is not a clean result", /not a clean result/.test(mixed.text));
  ok("  …while the covered ones still answer normally", /TCS —/.test(mixed.text) && /INFY —/.test(mixed.text));

  // An in-universe, UNSCORED name — the display-only expansion left plenty.
  const scoredIds = new Set(view.members.map((m) => m.symbol));
  const unscored = (await prisma.stock.findMany({ select: { symbol: true }, take: 400 }))
    .map((s) => s.symbol)
    .find((s) => !scoredIds.has(s) && s !== "NESTLEIND");
  if (!unscored) {
    ok("an unscored in-universe symbol exists to test with", false);
  } else {
    const r = await run([unscored, "TCS"]);
    ok(`an unscored symbol (${unscored}) states TRACKED BUT NOT SCORED`, /TRACKED BUT NOT SCORED/.test(r.text));
    ok('  …and distinguishes it from "no findings fired"', /Not the same as "no findings fired"/.test(r.text));
  }
  // A scored company with genuinely nothing firing, if one exists — the third state.
  const clean = view.members.find((m) => busyOf(m) === 0);
  if (clean) {
    const r = await run([clean.symbol]);
    ok(`a scored company with nothing firing (${clean.symbol}) says the rules RAN`, /Vytal ran its rules on this company and nothing met a trigger/.test(r.text));
  } else {
    console.log("     · no scored company currently fires zero findings — that branch is unexercised today");
  }
  // A dark name keeps its findings but is labelled.
  const darkRes = await run(["NESTLEIND"]);
  ok("a name that stopped being rescored is LABELLED, not silently served as current",
    /NO LONGER BEING RESCORED/.test(darkRes.text));
}

// ══════════════════════════════════════════════════════════════════════════════
section("§5C PER STOCK — one divergence row on the chat, one card on the page");
{
  const multiC = view.members.find(
    (m) => m.firedPatterns.filter((p) => (DIVERGENCE_SUB_TYPE_KEYS as readonly string[]).includes(p.patternKey)).length >= 2,
  );
  if (!multiC) {
    console.log("     · no company currently fires 2+ divergence sub-types — branch unexercised today");
  } else {
    const n = multiC.firedPatterns.filter((p) => (DIVERGENCE_SUB_TYPE_KEYS as readonly string[]).includes(p.patternKey)).length;
    const res = await readFindingsForSymbols([multiC.symbol], { freshestAsOf });
    const rows = res.rows[0].findings.shown.filter((f) => f.name === "Divergence");
    ok(`${multiC.symbol} fires ${n} divergence sub-types → the chat shows ONE row`, rows.length === 1);
    ok("  …and names the forms so nothing is hidden", (rows[0]?.subForms?.length ?? 0) === n, rows[0]?.subForms?.join(", "));
    const r = await run([multiC.symbol]);
    ok("  …and the render says ONE divergence, not N", /say ONE divergence, not \d/.test(r.text));
    ok("  …with no sub-type key leaked", !DIVERGENCE_SUB_TYPE_KEYS.some((k) => r.text.includes(k)));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
section("3d · MEASURED PAYLOAD");
{
  const worst = await run(BUSIEST);
  const realistic = await run(["TCS", "INFY", "HDFCBANK", "RELIANCE", "WIPRO", "ITC", "SBIN", "MARUTI"]);
  const small = await run(["TCS", "INFY", "ACC"]);
  const defsAt = worst.text.indexOf("WHAT EACH OF THESE FINDINGS MEANS");
  console.log(`  worst case · the 20 BUSIEST names   ${String(tok(worst.text)).padStart(5)} tok  (rows ${tok(worst.text.slice(0, defsAt))} + shared definitions ${tok(worst.text.slice(defsAt))})`);
  console.log(`  realistic  · 8 well-known names     ${String(tok(realistic.text)).padStart(5)} tok`);
  console.log(`  small      · 3 names                ${String(tok(small.text)).padStart(5)} tok`);
  console.log(`  counterfactual · 20 × getStockFacts (lean ~400 tok each) ≈ 8000 tok AND 20 tool rounds`);
  const maxFiring = Math.max(...view.members.map(busyOf));
  console.log(`  per-symbol ceiling ${MAX_FINDINGS_PER_SYMBOL}; busiest company fires ${maxFiring} — the ceiling does not engage today`);
  ok("the per-symbol ceiling sits ABOVE the live maximum (a ceiling, not a trim)", MAX_FINDINGS_PER_SYMBOL > maxFiring);
  ok("★ definitions are shared, so they do not scale with the number of companies",
    tok(worst.text.slice(defsAt)) < tok(worst.text.slice(0, defsAt)));

  // The symbol cap, exercised and STATED.
  const over = await run([...BUSIEST, "TCS", "SBIN", "MARUTI", "ITC", "WIPRO"]);
  ok(`★ more than ${MAX_SYMBOLS} symbols → the excess is NAMED, never silently dropped`,
    /is the limit for one call/.test(over.text) && /NOT READ:/.test(over.text),
    (over.text.match(/NOT READ: [^\n]*/) ?? [""])[0].slice(0, 90));
  ok("  …and it forbids reading the dropped ones as clean", /do not imply they came back clean/.test(over.text));

  let leaks = 0;
  for (const t of [worst.text, realistic.text, small.text]) {
    try { assertNoInternalIdentifiers(t, "batch"); } catch { leaks++; }
  }
  ok("no internal identifier in any payload", leaks === 0);
}

// ══════════════════════════════════════════════════════════════════════════════
section("3e · the boundary with getUniverseScan, in BOTH descriptions");
{
  const specs = toolSpecs();
  const scan = specs.find((s) => s.name === "getUniverseScan")!;
  const batch = specs.find((s) => s.name === "getFindingsForSymbols")!;
  ok("★ the scan points AT the batch for per-company verdicts", /getFindingsForSymbols/.test(scan.description));
  ok("  …and says what it does NOT give (a per-company verdict)", /never a per-company verdict/.test(scan.description));
  ok("★ the batch points AT the scan for counts and 'which'", /getUniverseScan/.test(batch.description));
  ok("  …naming the exact questions that belong there", /how many are firing red flags/.test(batch.description));
  ok("  …and claims the one thing only it can do (outside the scored universe)",
    /only way to ask about a stock Vytal does not score/.test(batch.description));
  ok("the batch tells the model to batch, not to loop", /do not call it once per company/.test(batch.description));
}

// ══════════════════════════════════════════════════════════════════════════════
section("fail-soft");
{
  for (const bad of [undefined, [], "", 42, {}, [""], [null]]) {
    const r = await run(bad);
    ok(`${JSON.stringify(bad)} → honest error, never a thrown turn`, !!r.error, (r.error ?? "").slice(0, 60));
  }
  const oneString = await run("TCS");
  ok("a bare string is accepted as a one-symbol call (a model will do this)", !oneString.error && /TCS —/.test(oneString.text));
  const dupes = await run(["TCS", "tcs", " TCS ", "INFY"]);
  ok("duplicates and casing collapse to one row each", (dupes.text.match(/^TCS —/gm) ?? []).length === 1);
}

// ══════════════════════════════════════════════════════════════════════════════
section("VERBATIM — a mixed set as a turn receives it");
console.log((await run(["TCS", "NOTAREAL", "NESTLEIND"])).text.split("\n").map((l) => "  │ " + l).join("\n"));

console.log(`\n${failures === 0 ? "✅ PART 3 GATE PASSED" : `❌ ${failures} FAILURE(S)`}\n`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
