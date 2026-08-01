// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NAVIGATION MAP — `{{link:kind:param}}` → a validated, server-built in-app path.
//
// No model, no credits — the DB answers everything here. What it pins:
//   · ★ THE MODEL NEVER COMPOSES A PATH. A marker naming a ticker that is not in the universe produces
//     NO LINK — not a broken one — and a marker carrying path characters cannot smuggle one out.
//   · the five kinds resolve: stock (+ tab), portfolio (+ tab), watchlist, peer-group (ticker → UUID),
//     health-hub (parameterless — its tabs are React state, not routes, so there is nothing to link to).
//   · ★ THE TYPED-PATH GUARD. A link destination the MODEL wrote is deleted before the reader sees it,
//     keeping the words. Measured 3–4 times per live run: [Flags & Patterns tab](/portfolio) is a
//     WORKING link to the WRONG page, which reports nothing and teaches the reader we are lost.
//   · ★ SECTIONS ARE NOT ADDRESSABLE. There is no kind that can produce a "#" or a "?section=" — the
//     recon found ZERO anchors on the stock Health tab, so a section can only ever be described.
//   · ★ THE ENCODING. Every live "&" symbol survives BOTH legs: the shipped remark pipeline (which
//     decodes character references in a link destination) and Next's decode of the dynamic segment.
//   · raw `{{link…}}` debris never reaches a reader, even when the model malforms it.
//   · the resolver composes with the existing footer: an inline link suppresses a duplicate footer link.
//
//   npx tsx src/scripts/verify-app-links.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  resolveAppLinks, stockPath, comparisonPath, portfolioPath, peerGroupPath, encodeSegment,
  STOCK_TABS, PORTFOLIO_TABS,
} from "../chat/links.js";
import { withAppLinks } from "../chat/voice.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const show = (s: string) => console.log(s.split("\n").map((l) => `     │ ${l}`).join("\n"));

/** A live ticker with no awkward characters, resolved from the universe so the script is not pinned to
 *  a symbol that could be delisted. */
async function pickPlainSymbol(): Promise<string> {
  const row = await prisma.stock.findFirst({ where: { symbol: "TCS" }, select: { symbol: true } });
  return row?.symbol ?? (await prisma.stock.findFirst({ select: { symbol: true } }))!.symbol;
}

async function main() {
  console.log("\n★ chat/links.ts — the navigation map (server-built paths, model-named kinds)");
  const PLAIN = await pickPlainSymbol();

  rule("1 — THE FIVE KINDS RESOLVE");
  const r1 = await resolveAppLinks(`See {{link:stock:${PLAIN}}} for the read.`);
  ok("stock, no tab", r1.text.includes(`](/research/stock-screener/${PLAIN})`), r1.text);
  const r2 = await resolveAppLinks(`See {{link:stock:${PLAIN}:health}}.`);
  ok("stock + tab", r2.text.includes(`](/research/stock-screener/${PLAIN}?tab=health)`), r2.text);
  ok("…and the label reads as prose", r2.text.includes(`[the Health Score tab for ${PLAIN}]`), r2.text);
  const r3 = await resolveAppLinks("Look at {{link:portfolio:health}}.");
  ok("portfolio + tab", r3.text.includes("](/portfolio?tab=health)"), r3.text);
  const r4 = await resolveAppLinks("Check {{link:portfolio}} and {{link:watchlist}}.");
  ok("portfolio bare + watchlist", r4.text.includes("](/portfolio)") && r4.text.includes("](/watchlist)"), r4.text);
  const r4b = await resolveAppLinks("It is all on {{link:health-hub}}.");
  ok("★ health-hub → /health-score (the ROUTE, which is not the product name)", r4b.text.includes("](/health-score)"), r4b.text);
  ok("…labelled 'the Health Hub'", r4b.text.includes("[the Health Hub]"), r4b.text);
  // A tab the model tacks on is IGNORED, not honoured — landing on Briefing while promising Flags is
  // the wrong-page failure rebuilt. The Hub's tabs are useState, so no path can carry one.
  for (const t of ["flags", "screen", "briefing", "flags-and-patterns"]) {
    const rt = await resolveAppLinks(`See {{link:health-hub:${t}}}.`);
    ok(`health-hub:${t} still resolves to the bare page — no invented tab address`,
      rt.text.includes("](/health-score)") && !rt.text.includes("?tab=") && !rt.text.includes("#"), rt.text);
  }

  rule("2 — ★ THE PEER GROUP: THE MODEL NAMES A TICKER, THE SERVER PRODUCES A UUID");
  const pgRow = await prisma.stockPeerGroup.findFirst({ select: { stock: { select: { symbol: true } }, peerGroup: { select: { id: true, displayName: true } } } });
  if (!pgRow) {
    ok("a peer-group membership exists to test against", false, "no stock_peer_groups row");
  } else {
    const r5 = await resolveAppLinks(`Its rivals sit in {{link:peer-group:${pgRow.stock.symbol}}}.`);
    ok(`peer-group for ${pgRow.stock.symbol} → the pond's UUID`, r5.text.includes(`](/research/peer-groups/${pgRow.peerGroup.id})`), r5.text);
    ok("…labelled with the pond's display name", r5.text.includes(pgRow.peerGroup.displayName), r5.text);
    ok("★ the UUID appears in the OUTPUT but was never in the INPUT", !`{{link:peer-group:${pgRow.stock.symbol}}}`.includes(pgRow.peerGroup.id));
  }

  rule("3 — ★ THE UNIVERSE BOUNDARY: A GUESS COSTS THE LINK, IT DOES NOT BREAK ONE");
  const bad = await resolveAppLinks("Try {{link:stock:NOTAREALTICKER:health}} for that.");
  ok("an uncovered ticker produces NO anchor", !bad.text.includes("]("), bad.text);
  ok("…and no path at all", !bad.text.includes("/research/"), bad.text);
  ok("…and is reported as unresolved (the signal the vocabulary is drifting)", bad.unresolved.length === 1, JSON.stringify(bad.unresolved));
  const nameNotTicker = await resolveAppLinks("See {{link:stock:INFOSYS}}.");
  ok("★ a COMPANY NAME where a ticker belongs produces no link", !nameNotTicker.text.includes("]("), nameNotTicker.text);
  const badKind = await resolveAppLinks("Open {{link:sector-analysis:AUTO}}.");
  ok("an unknown KIND produces no link", !badKind.text.includes("]("), badKind.text);

  rule("4 — ★ NO PATH CAN BE SMUGGLED THROUGH A MARKER");
  const inj = await resolveAppLinks("Look at [this]({{link:stock:/admin/retention}}).");
  ok("a path in the subject never becomes a live in-app link", !inj.text.includes("(/admin/retention)"), inj.text);
  ok("…the leading slash is stripped, so safeHref refuses what is left", !inj.text.includes("](/"), inj.text);
  const inj2 = await resolveAppLinks("See {{link:stock:../../etc/passwd}}.");
  ok("traversal in the subject cannot produce a path", !inj2.text.includes("](") && !inj2.text.includes("/"), inj2.text);

  rule("5 — ★ SECTIONS ARE NOT ADDRESSABLE (recon: ZERO anchors on the Health tab)");
  const secTries = [
    "{{link:stock:" + PLAIN + ":findings}}",
    "{{link:stock:" + PLAIN + ":verdict}}",
    "{{link:stock:" + PLAIN + ":health#findings}}",
    "{{link:section:notable-findings}}",
  ];
  for (const t of secTries) {
    const r = await resolveAppLinks(`x ${t} y`);
    const emitted = r.text;
    ok(`${t} yields no anchor and no fragment`, !emitted.includes("#") && !emitted.includes("?section="), emitted);
  }
  const unknownTab = await resolveAppLinks(`{{link:stock:${PLAIN}:findings}}`);
  ok("★ an unknown tab falls back to the PAGE, never an invented address",
    unknownTab.text.includes(`](/research/stock-screener/${PLAIN})`), unknownTab.text);

  rule("6 — ★ THE ENCODING, AGAINST THE REAL UNIVERSE");
  const awkward = (await prisma.stock.findMany({ select: { symbol: true } }))
    .map((r) => r.symbol).filter((s) => /[^A-Z0-9]/.test(s)).sort();
  console.log(`     awkward live symbols (${awkward.length}): ${awkward.join(", ")}`);
  ok("M&M and M&MFIN are both in the universe", awkward.includes("M&M") && awkward.includes("M&MFIN"));
  for (const s of awkward) {
    const p = stockPath(s, "health");
    // Next decodes the dynamic segment; the page then uppercases it. That is the whole route.
    const back = decodeURIComponent(p.replace("/research/stock-screener/", "").replace("?tab=health", ""));
    ok(`stock link ${s} → ${p} round-trips`, back === s, back);
  }
  for (const s of awkward) {
    ok(`${s} carries no bare "&" a markdown parser could reinterpret`, !stockPath(s, "health").includes("&"), stockPath(s, "health"));
  }
  const cmp = comparisonPath("M&M", "M&MFIN");
  ok(`★ M&M vs M&MFIN → ${cmp}`, cmp === "/comparison/M%26M-vs-M%26MFIN", cmp);
  const parts = decodeURIComponent(cmp.replace("/comparison/", "")).split("-vs-");
  ok("…and splits back into exactly the two symbols", parts.length === 2 && parts[0] === "M&M" && parts[1] === "M&MFIN", JSON.stringify(parts));
  ok("hyphenated symbols are left untouched (encodeURIComponent keeps '-')", comparisonPath("BAJAJ-AUTO", "TCS") === "/comparison/BAJAJ-AUTO-vs-TCS", comparisonPath("BAJAJ-AUTO", "TCS"));
  ok("a resolved M&M marker emits the escaped path", (await resolveAppLinks("{{link:stock:M&M:health}}")).text.includes("/research/stock-screener/M%26M?tab=health"));

  rule("7 — BOTH PLACEHOLDER SHAPES");
  const wrapped = await resolveAppLinks(`Read [the full health page]({{link:stock:${PLAIN}:health}}) when you like.`);
  ok("wrapped: only the destination is swapped, the model keeps its own words",
    wrapped.text === `Read [the full health page](/research/stock-screener/${PLAIN}?tab=health) when you like.`, wrapped.text);
  const twice = await resolveAppLinks(`{{link:stock:${PLAIN}}} and again {{link:stock:${PLAIN}}}`);
  ok("the same subject twice resolves twice (one read, memoised)", (twice.text.match(/\/research\/stock-screener\//g) ?? []).length === 2);

  rule("8 — DEBRIS NEVER REACHES A READER");
  for (const junk of ["{{link:stock", "{{link:}}", "{{link:stock:}}", "{{ link : stock : X }}", "{{link:" + "x".repeat(200) + "}}"]) {
    const r = await resolveAppLinks(`before ${junk} after`);
    ok(`malformed ${JSON.stringify(junk.slice(0, 28))} leaves no braces`, !r.text.includes("{{"), r.text);
  }
  const clean = await resolveAppLinks("A reply with no markers at all.");
  ok("text with no markers is returned untouched", clean.text === "A reply with no markers at all." && clean.resolved.length === 0);

  rule("9 — COMPOSITION WITH THE EXISTING FOOTER (chat/voice.ts)");
  const inline = (await resolveAppLinks(`Compare them at [the comparison]({{link:stock:${PLAIN}}}).`)).text;
  const footered = withAppLinks(inline, [{ label: "x", path: `/research/stock-screener/${PLAIN}` }]);
  ok("★ a path already inline is NOT repeated in the footer", footered === inline, footered);
  const other = withAppLinks(inline, [{ label: "Compare A and B", path: "/comparison/TCS-vs-INFY" }]);
  ok("…but a different path still gets its footer", other.includes("→ [Compare A and B](/comparison/TCS-vs-INFY)"));
  show(other);

  rule("10 — THE VOCABULARY AND THE RESOLVER AGREE");
  const { VYTAL_CONTEXT_LAYER } = await import("../ai/context-layer.js");
  for (const k of ["stock", "portfolio", "watchlist", "peer-group", "health-hub"]) {
    ok(`context layer teaches kind "${k}"`, VYTAL_CONTEXT_LAYER.includes(`{{link:${k}`));
  }
  for (const t of Object.keys(STOCK_TABS)) {
    ok(`stock tab "${t}" is named in the vocabulary`, new RegExp(`\\b${t}\\b`).test(VYTAL_CONTEXT_LAYER));
  }
  for (const t of Object.keys(PORTFOLIO_TABS)) {
    ok(`portfolio tab "${t}" is named in the vocabulary`, new RegExp(`\\b${t}\\b`).test(VYTAL_CONTEXT_LAYER));
  }
  ok("★ the clause states plainly that sections have no address", /NO ADDRESS/.test(VYTAL_CONTEXT_LAYER));
  ok("the clause forbids writing a path", /NEVER WRITE A PATH/.test(VYTAL_CONTEXT_LAYER));
  ok("no kind the resolver cannot handle is advertised",
    !/\{\{link:(?!stock|portfolio|watchlist|peer-group|health-hub)[a-z-]+/.test(VYTAL_CONTEXT_LAYER));
  ok("★ the clause forbids a typed link DESTINATION, not just a bare URL",
    /LINK DESTINATION IN YOUR OWN MARKDOWN/.test(VYTAL_CONTEXT_LAYER));
  // ★ THE TWO HALVES MUST MOVE TOGETHER. Adding the kind while leaving the Hub on the "has NO marker"
  //   list would teach the model both that it can link the Hub and that it cannot — and the second
  //   half is the one it obeyed for five live runs.
  const noMarkerLine = (VYTAL_CONTEXT_LAYER.match(/⚠ FIVE KINDS[^\n]*/) ?? [""])[0];
  ok("the ⚠ line says FIVE", /FIVE KINDS, AND ONLY FIVE/.test(noMarkerLine));
  ok("★ the Health Hub is no longer named as having no marker", !/Health Hub/.test(noMarkerLine.split("have NO marker")[0]), noMarkerLine.slice(0, 140));

  rule("10b — ★ THE TYPED-PATH GUARD (the wrong-page shape, measured live 3–4× per run)");
  const typed = [
    "Explore it on the [Health Hub's Flags & Patterns tab](/portfolio).",
    "See the [Screen tab](/health-score) for the table.",
    "Read more at [Market pillar](https://vytal.in).",
    "Try [this](www.example.com) instead.",
    `Look at [ACC](/research/stock-screener/ACC) and [TCS](/research/stock-screener/TCS).`,
  ];
  for (const t of typed) {
    const r = await resolveAppLinks(t);
    ok(`stripped: ${JSON.stringify(t.slice(0, 46))}…`, !r.text.includes("](") && r.strippedPaths.length > 0, r.text);
  }
  const keepsWords = await resolveAppLinks("Explore it on the [Health Hub's Flags & Patterns tab](/portfolio).");
  ok("★ the WORDS survive — only the destination is removed",
    keepsWords.text === "Explore it on the Health Hub's Flags & Patterns tab.", keepsWords.text);
  const bothShapes = await resolveAppLinks(`A [typed](/portfolio) one and a marker {{link:health-hub}}.`);
  ok("★ a typed destination is stripped while a MARKER in the same reply still resolves",
    !bothShapes.text.includes("](/portfolio)") && bothShapes.text.includes("](/health-score)"), bothShapes.text);
  const wrappedMarker = await resolveAppLinks(`Read [the read]({{link:stock:${PLAIN}}}).`);
  ok("★ a placeholder in a destination slot is NOT mistaken for a typed path",
    wrappedMarker.text === `Read [the read](/research/stock-screener/${PLAIN}).`, wrappedMarker.text);
  const nothing = await resolveAppLinks("Plain prose with no links and no markers.");
  ok("prose with no destinations is untouched and reports nothing stripped",
    nothing.text === "Plain prose with no links and no markers." && nothing.strippedPaths.length === 0);

  rule("11 — THE BUILDERS ARE THE ONLY PATH SOURCE");
  ok("encodeSegment leaves unreserved characters alone", encodeSegment("BAJAJ-AUTO") === "BAJAJ-AUTO");
  ok("encodeSegment escapes '&'", encodeSegment("M&M") === "M%26M");
  ok("portfolioPath rejects nothing but emits no tab when absent", portfolioPath() === "/portfolio" && portfolioPath("holdings") === "/portfolio?tab=holdings");
  ok("peerGroupPath is root-relative", peerGroupPath("abc-123").startsWith("/research/peer-groups/"));
  ok("every builder emits a root-relative path safeHref will render",
    [stockPath("TCS"), comparisonPath("A", "B"), portfolioPath(), peerGroupPath("x")].every((p) => p.startsWith("/")));

  rule(fail === 0 ? "✅ ALL PASS" : `❌ ${fail} FAILURE(S)`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
