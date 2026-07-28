// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// openComparison — THE VERDICT, THE BOUNDARY, AND THE SERVER-BUILT LINK.
//
// No model, no credits — the DB answers everything here. What it pins:
//   · the comparability verdict is REUSED from buildComparisonView, not re-derived
//   · the universe boundary names the RIGHT symbol (buildComparisonView alone cannot — it nulls for
//     either side, so the tool checks each symbol first)
//   · a self-pair is refused rather than quietly linked
//   · ★ THE PATH IS BUILT FROM UNIVERSE ROWS, not from the model's arguments — proven by handing the
//     tool lowercase junk and getting the canonical path back
//   · the footer renders as a real in-app markdown link, and the external-source disclaimer still sits
//     LAST when a turn carries both kinds
//
//   npx tsx src/scripts/verify-open-comparison.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { openComparisonTool, comparisonPath } from "../chat/tools/open-comparison.js";
import { makeToolContext } from "../chat/tools/registry.js";
import { withAppLinks, withExternalSources, buildAppLinksBlock, EXTERNAL_SOURCE_DISCLAIMER } from "../chat/voice.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const ctx = () => makeToolContext({ userId: "verify-cmp", sessionId: "verify-cmp" });
const show = (s: string) => console.log(s.split("\n").map((l) => `     │ ${l}`).join("\n"));

async function main() {
  console.log("\n★ openComparison — klass:\"action\" (validates + returns a link; navigates nothing)");

  rule("1 — REFUSALS (ok:false ⇒ the model must take corrective action)");
  const same = await openComparisonTool.handler({ symbolA: "TCS", symbolB: "tcs" }, ctx());
  ok("the same stock twice is REFUSED", !same.ok, same.ok ? "returned a result" : same.error.slice(0, 110));
  ok("…and the refusal tells the model what to do about it", !same.ok && /ask the reader/i.test(same.error));
  const empty = await openComparisonTool.handler({ symbolA: "TCS" }, ctx());
  ok("a missing second symbol is refused", !empty.ok, empty.ok ? "" : empty.error.slice(0, 80));

  rule("2 — THE UNIVERSE BOUNDARY, NAMING THE RIGHT SYMBOL");
  const missA = await openComparisonTool.handler({ symbolA: "NOTAREALTICKER", symbolB: "TCS" }, ctx());
  ok("A missing ⇒ boundary message names A", missA.ok && missA.content.startsWith("NOT COVERED: NOTAREALTICKER"), missA.ok ? missA.content.slice(0, 70) : "");
  const missB = await openComparisonTool.handler({ symbolA: "TCS", symbolB: "CYIENTDLM" }, ctx());
  ok("★ B missing ⇒ boundary names B, not A", missB.ok && missB.content.startsWith("NOT COVERED: CYIENTDLM"), missB.ok ? missB.content.slice(0, 70) : "");
  const c0 = ctx();
  await openComparisonTool.handler({ symbolA: "TCS", symbolB: "CYIENTDLM" }, c0);
  ok("…and NO link is offered for an uncovered pair", c0.appLinks.length === 0);

  rule("3 — SAME-FAMILY PAIR (TCS vs INFY) — the verdict comes from buildComparisonView");
  const cSame = ctx();
  const same2 = await openComparisonTool.handler({ symbolA: "TCS", symbolB: "INFY" }, cSame);
  if (!same2.ok) ok("TCS vs INFY resolves", false, same2.error);
  else {
    show(same2.content);
    ok("verdict is SAME FAMILY", same2.content.includes("Comparability: SAME FAMILY"));
    ok("peer-group standing is stated either way", /Peer-group standing: (COMPARABLE|NOT COMPARABLE)/.test(same2.content));
    ok("the warnings line is present (even when empty)", /Comparability warnings/.test(same2.content));
    ok("the model is told NOT to write the path", /Do NOT write that path/.test(same2.content));
    ok("★ exactly one link was recorded on the context", cSame.appLinks.length === 1, JSON.stringify(cSame.appLinks));
    ok("★ the path is the canonical in-app one", cSame.appLinks[0]?.path === "/comparison/TCS-vs-INFY", cSame.appLinks[0]?.path);
  }

  rule("4 — CROSS-FAMILY PAIR (a bank vs a manufacturer) — the warning must surface");
  const cCross = ctx();
  const cross = await openComparisonTool.handler({ symbolA: "HDFCBANK", symbolB: "MARUTI" }, cCross);
  if (!cross.ok) ok("HDFCBANK vs MARUTI resolves", false, cross.error);
  else {
    show(cross.content);
    ok("★ verdict is CROSS FAMILY", cross.content.includes("Comparability: CROSS FAMILY"));
    ok("★ it says only universal measures line up directly", /ONLY the universal measures line up directly/.test(cross.content));
    ok("the service's own authored warning is passed through verbatim", /different families/i.test(cross.content));
    ok("a link is still offered (cross-family is comparable, with caveats)", cCross.appLinks.length === 1, cCross.appLinks[0]?.path);
  }

  rule("5 — ★ THE PATH IS BUILT FROM UNIVERSE ROWS, NOT FROM THE MODEL'S ARGUMENTS");
  const cJunk = ctx();
  const junk = await openComparisonTool.handler({ symbolA: "  tcs  ", symbolB: "infy" }, cJunk);
  ok("lowercase, padded input still yields the canonical path", junk.ok && cJunk.appLinks[0]?.path === "/comparison/TCS-vs-INFY", cJunk.appLinks[0]?.path);
  ok("the path helper matches the app's own picker convention", comparisonPath("tcs", "infy") === "/comparison/TCS-vs-INFY", comparisonPath("tcs", "infy"));
  ok("the path is root-relative ⇒ safeHref renders it as an in-app anchor", (cJunk.appLinks[0]?.path ?? "").startsWith("/"));

  // ★ AWKWARD REAL SYMBOLS. Five live universe names contain "&" (ARE&M, GVT&D, J&KBANK, M&M, M&MFIN)
  //   and two contain a hyphen inside a hyphen-delimited slug (BAJAJ-AUTO, NAM-INDIA).
  //
  //   ⚠ THIS MODEL OF THE ROUTE WAS INCOMPLETE AND IS NOW CORRECT. It used to split the emitted path
  //   directly, which silently assumed the path is never escaped. The real pipeline has TWO steps: Next
  //   DECODES the dynamic segment into `params.slug`, and only then does the page's own parseSlug split
  //   it on the literal "-vs-". Now that comparisonPath percent-encodes each symbol (chat/links.ts —
  //   "&" is legal in a path but remark decodes character references in a link destination), the decode
  //   step is what makes the round trip work, so the test has to contain it or it is testing a route
  //   that does not exist.
  const parseSlug = (slug: string) => { const p = slug.split("-vs-"); return p.length === 2 ? { a: p[0], b: p[1] } : null; };
  /** The route as it actually behaves: Next decodes the segment, THEN the page splits it. */
  const throughRoute = (path: string) => parseSlug(decodeURIComponent(path.replace("/comparison/", "")));
  const AWKWARD: [string, string][] = [
    ["M&M", "TCS"], ["TCS", "M&M"], ["M&MFIN", "M&M"], ["ARE&M", "GVT&D"], ["J&KBANK", "TCS"],
    ["BAJAJ-AUTO", "TCS"], ["TCS", "BAJAJ-AUTO"], ["NAM-INDIA", "M&M"],
  ];
  for (const [x, y] of AWKWARD) {
    const path = comparisonPath(x, y);
    const back = throughRoute(path);
    ok(`"${x}" vs "${y}" → ${path} round-trips through Next's decode + the route's parseSlug`, back?.a === x && back?.b === y, JSON.stringify(back));
  }
  ok("★ every '&' symbol is escaped in the emitted path (nothing for a markdown parser to reinterpret)",
    AWKWARD.filter(([x, y]) => x.includes("&") || y.includes("&")).every(([x, y]) => !comparisonPath(x, y).includes("&")),
    comparisonPath("M&M", "TCS"));

  rule("6 — THE FOOTER (chat/voice.ts)");
  const links = [{ label: "Compare TCS and INFY side by side", path: "/comparison/TCS-vs-INFY" }];
  const block = buildAppLinksBlock(links);
  console.log(`     rendered: ${block}`);
  ok("renders as a markdown link to a relative path", block === "→ [Compare TCS and INFY side by side](/comparison/TCS-vs-INFY)");
  ok("carries NO external-source disclaimer (it is Vytal's own page)", !block.includes(EXTERNAL_SOURCE_DISCLAIMER));
  const once = withAppLinks("Here is how they line up.", links);
  ok("appended to a reply", once.includes("(/comparison/TCS-vs-INFY)"));
  ok("idempotent — a path already in the text is not appended twice", withAppLinks(once, links) === once);
  ok("a blank reply is left alone", withAppLinks("", links) === "");
  ok("a non-relative path is refused by the renderer", buildAppLinksBlock([{ label: "x", path: "https://evil.example.com" }]) === "");

  rule("7 — ORDERING WHEN A TURN CARRIES BOTH (news + a comparison link)");
  const both = withExternalSources(
    withAppLinks("Answer.", links),
    [{ title: "T", source: "S", date: "2 hours ago", url: "https://example.com/a" }],
  );
  show(both);
  ok("★ the external disclaimer sits AFTER the in-app link", both.indexOf("/comparison/TCS-vs-INFY") < both.indexOf(EXTERNAL_SOURCE_DISCLAIMER));

  rule(fail === 0 ? "✅ ALL PASS" : `❌ ${fail} FAILURE(S)`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
