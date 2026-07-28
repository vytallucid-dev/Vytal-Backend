// ─────────────────────────────────────────────────────────────────────────────
// AUDIT (READ-ONLY): the universe boundary across the WHOLE tool fleet.
//
// Changes nothing. Calls every registry tool that takes a symbol/identifier with a value that is NOT in
// Vytal's universe, and reports whether each one:
//   · handles not-found at all,
//   · returns ok:true (a boundary ANSWER) rather than ok:false (a failure the model would apologise for),
//   · uses the SHARED notInUniverse wording rather than a local copy that can drift,
//   · never claims the company does not exist.
//
// Also checks the partial-data (non-stock) renderings and the searchStocks/instrument/fund miss states,
// which are legitimately DIFFERENT miss-kinds and so carry their own honest wording.
//
//   npx tsx src/scripts/audit-universe-boundary.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { CHAT_TOOLS, findTool, makeToolContext } from "../chat/tools/registry.js";
import { notInUniverse } from "../chat/tools/boundary.js";
import type { ToolResult } from "../chat/tools/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);

/** A real-looking ticker that is NOT in the universe (asserted below before use). */
const UNCOVERED = "ZENITHSTL";

/** Phrases that would be WRONG in a boundary message — a claim the company isn't real. */
const NONEXISTENCE_CLAIMS = [
  "does not exist", "doesn't exist", "no such company", "not a real", "invalid company", "fictional",
];

function text(r: ToolResult): string {
  return r.ok ? r.content : r.error;
}

async function main() {
  // Guard: the audit is meaningless if the "uncovered" symbol is actually covered.
  const present = await prisma.stock.findUnique({ where: { symbol: UNCOVERED }, select: { id: true } });
  if (present) throw new Error(`${UNCOVERED} IS in the universe — pick another symbol for this audit`);
  console.log(`Uncovered probe symbol: ${UNCOVERED} (confirmed absent from the stocks table)`);

  const ctx = makeToolContext({ userId: "audit-no-such-user", sessionId: "audit" });
  const SHARED = notInUniverse(UNCOVERED);

  // ── 1. Which tools take a symbol/identifier at all? Read it off the SCHEMAS, not a hand list. ──
  section("1 · Coverage of the check (every symbol/identifier-taking tool)");
  const symbolTools: string[] = [];
  const identifierTools: string[] = [];
  const noLookupTools: string[] = [];
  for (const t of CHAT_TOOLS) {
    const props = ((t.parameters as any)?.properties ?? {}) as Record<string, unknown>;
    if ("symbol" in props) symbolTools.push(t.name);
    else if ("identifier" in props || "schemeCode" in props) identifierTools.push(t.name);
    else noLookupTools.push(t.name);
  }
  console.log(`  symbol-taking (${symbolTools.length}): ${symbolTools.join(", ")}`);
  console.log(`  identifier/scheme-taking (${identifierTools.length}): ${identifierTools.join(", ")}`);
  console.log(`  no lookup key (${noLookupTools.length}): ${noLookupTools.join(", ")}`);
  console.log("");
  console.log("  " + "tool".padEnd(26) + "handles".padEnd(9) + "ok:true".padEnd(9) + "shared msg".padEnd(12) + "no-nonexistence-claim");
  console.log("  " + "-".repeat(76));

  for (const name of symbolTools) {
    const r = await findTool(name)!.handler({ symbol: UNCOVERED }, ctx);
    const body = text(r);
    const handles = body.includes("NOT COVERED");
    const isOk = r.ok === true;
    const shared = body === SHARED; // byte-identical to the single source
    const clean = !NONEXISTENCE_CLAIMS.some((p) => body.toLowerCase().includes(p));
    console.log(
      "  " + name.padEnd(26) +
        (handles ? "yes" : "NO").padEnd(9) +
        (isOk ? "yes" : "NO").padEnd(9) +
        (shared ? "verbatim" : "LOCAL").padEnd(12) +
        (clean ? "clean" : "CLAIMS NONEXISTENCE"),
    );
    if (!handles || !isOk || !shared || !clean) failures++;
  }

  section("2 · Message consistency");
  {
    const r = await findTool("getStockFacts")!.handler({ symbol: UNCOVERED }, ctx);
    const body = text(r);
    ok("boundary body is byte-identical to the shared helper", body === SHARED);
    ok("states it IS a coverage boundary", body.includes("coverage boundary"));
    ok("explicitly does NOT claim the company is unreal", body.includes("not a claim about whether the company exists"));
    ok("instructs: no apology", body.includes("do not apologise"));
    ok("instructs: state no numbers about it", body.includes("do not state any number or fact"));
    ok("names the reason (only vetted names are shown)", body.includes("only shows data for the names it has vetted"));
  }

  section("3 · searchStocks — the miss it CANNOT distinguish");
  {
    const r = await findTool("searchStocks")!.handler({ query: "zenith steel pipes" }, ctx);
    const body = text(r);
    ok("returns ok:true (an answer, not a failure)", r.ok === true);
    ok("says NO MATCH", body.includes("NO MATCH"));
    ok("explicitly allows the company may be real but uncovered", body.includes("rather than nonexistent"));
    ok("does not claim nonexistence", !NONEXISTENCE_CLAIMS.some((p) => body.toLowerCase().includes(p)));
    ok("forbids guessing a ticker", body.includes("do NOT guess a ticker"));
    console.log(`     ${body.split("\n")[0]}`);
  }

  section("4 · Non-stock instruments");
  {
    // (a) unknown identifier
    const r = await findTool("getInstrumentDetails")!.handler({ identifier: "NOTANINSTRUMENT123" }, ctx);
    const body = text(r);
    ok("unknown identifier → ok:true, honest NOT FOUND (not an error)", r.ok === true && body.includes("NOT FOUND"));
    ok("frames it as a coverage boundary, not nonexistence", body.includes("not a claim the instrument does not exist"));

    // (b) unknown scheme code
    const f = await findTool("getFundAnalytics")!.handler({ schemeCode: "999999999" }, ctx);
    const fb = text(f);
    ok("unknown scheme → ok:true, honest NO ANALYTICS (not an error)", f.ok === true && fb.includes("NO ANALYTICS"));
    ok("explains it is expected for a new fund, not a failure", fb.includes("not an error"));

    // (c) PARTIAL DATA — a thin asset class must state the gap in words, not omit it
    const thin = await prisma.instrument.findFirst({
      where: { assetClass: { in: ["bond", "gsec", "sgb", "reit", "invit"] } },
      select: { isin: true, symbol: true, assetClass: true },
    });
    if (thin) {
      const t = await findTool("getInstrumentDetails")!.handler({ identifier: thin.isin }, ctx);
      const tb = text(t);
      ok(`thin class (${thin.assetClass}) states the depth gap explicitly`, t.ok === true && tb.includes("Depth note:"));
      ok("thin class says the missing data is 'not available' rather than omitting it", tb.includes("not available"));
      console.log(`     ${tb.split("\n").find((l) => l.startsWith("Depth note:"))?.slice(0, 150) ?? "(no depth note)"}…`);
    } else {
      console.log("  ⏭  no bond/gsec/sgb/reit/invit instrument on file to probe");
    }

    // (d) fund holdings + expense ratio — must be declared absent, not silently missing
    const fund = await prisma.mfAnalytics.findFirst({ select: { schemeCode: true } });
    if (fund) {
      const fa = await findTool("getFundAnalytics")!.handler({ schemeCode: fund.schemeCode }, ctx);
      const fab = text(fa);
      ok("fund output DECLARES holdings + expense ratio as not carried", fab.includes("[NOT CARRIED BY VYTAL]") && fab.includes("expense ratio"));
      ok("fund output carries the per-figure omission reasons", fab.includes("[WHY ANY FIGURE ABOVE IS UNAVAILABLE]"));
      console.log(`     ${fab.split("\n").find((l) => l.startsWith("[NOT CARRIED BY VYTAL]"))?.slice(0, 160) ?? ""}…`);
    }
  }

  section("5 · Web tools");
  {
    const hasNews = CHAT_TOOLS.some((t) => /news/i.test(t.name));
    const hasWebSearch = CHAT_TOOLS.some((t) => /searchweb|websearch/i.test(t.name));
    console.log(`  getStockNews registered? ${hasNews ? "yes" : "NO — not built (Stage 4)"}`);
    console.log(`  searchWeb registered?    ${hasWebSearch ? "yes" : "NO — not built (Stage 4, net-new; no backend exists)"}`);
    ok("no web/klass tool is registered yet (fleet is read/Vytal only)", CHAT_TOOLS.every((t) => t.klass === "read"));
  }

  console.log(`\n${failures === 0 ? "✅ BOUNDARY CONSISTENT ACROSS THE FLEET" : `❌ ${failures} GAP(S) FOUND`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
