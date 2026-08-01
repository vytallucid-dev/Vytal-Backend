// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PROOF — malformed markers are stripped, well-formed ones still resolve, and the vocabulary's claim
// about what a marker BECOMES matches what the server actually builds.
//
//   §1  ★ THE CLAUSE AND THE RESOLVER AGREE            (the whole fix is a claim about labels — check it)
//   §2  MALFORMED shapes are stripped, words preserved (and can never begin a path)
//   §3  NEGATIVE CONTROLS — the well-formed cases are untouched
//   §4  ★ THE NEW DETECTION OVER THE FULL LIVE CORPUS  (the standing lesson, ninth instance)
//   §5  token cost of the context-layer addition
//
// ★ §1 IS THE ONE THAT WILL CATCH A FUTURE REGRESSION. The fix is not code — it is a sentence in the
// context layer telling the model that `{{link:stock:TCS:health}}` arrives as "the Health Score tab for
// TCS". That sentence is only true while `resolveOne` keeps building labels that way, and nothing else
// in the system would notice if it stopped. A renamed tab or a reworded label would silently turn the
// vocabulary into a lie, and the symptom would be the exact defect this build fixed, returning.
//
//   npx tsx src/scripts/verify-link-placement.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { resolveAppLinks, stripMalformedMarkers, STOCK_TABS, PORTFOLIO_TABS } from "../chat/links.js";
import { VYTAL_CONTEXT_LAYER } from "../ai/context-layer.js";
import { LINK_DEFECTS } from "./recon-link-defects.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const section = (s: string) => console.log(`\n══ ${s} ══`);

async function main() {
  const anyStock = await prisma.stock.findFirst({ where: { symbol: { notIn: [] } }, select: { symbol: true }, orderBy: { symbol: "asc" } });
  const SYM = anyStock?.symbol ?? "TCS";

  // ── §1 · THE CLAUSE AND THE RESOLVER AGREE ──────────────────────────────────────────────────
  section("1 · ★ what the vocabulary PROMISES a marker becomes is what the server BUILDS");
  const labelOf = async (marker: string): Promise<string> => (await resolveAppLinks(`x ${marker} y`)).resolved[0]?.label ?? "(unresolved)";
  const bare = await labelOf(`{{link:stock:${SYM}}}`);
  const tabbed = await labelOf(`{{link:stock:${SYM}:health}}`);
  const pf = await labelOf("{{link:portfolio:holdings}}");
  const wl = await labelOf("{{link:watchlist}}");
  const hub = await labelOf("{{link:health-hub}}");
  console.log(`     bare stock      → "${bare}"`);
  console.log(`     stock + tab     → "${tabbed}"`);
  console.log(`     portfolio + tab → "${pf}"`);
  console.log(`     watchlist       → "${wl}"   health-hub → "${hub}"`);
  // ★ THE ASYMMETRY THE CLAUSE EXISTS TO EXPLAIN: exactly one label is a bare name, the rest are noun
  //   phrases with their own article. That is the whole reason the model mis-slots the tabbed form.
  ok("★ the bare stock marker is a NAME — no article, just the ticker", bare === SYM, `"${bare}"`);
  ok("★ every OTHER form is a noun phrase carrying its own article",
    [tabbed, pf, wl, hub].every((l) => /^(?:the|your)\s/.test(l)), [tabbed, pf, wl, hub].join(" │ "));
  // …and the clause must quote them correctly, or it is teaching a shape that does not exist.
  ok(`the clause quotes the real stock-tab shape ("the ${STOCK_TABS.health} tab for …")`,
    VYTAL_CONTEXT_LAYER.includes(`the ${STOCK_TABS.health} tab for`) && tabbed.startsWith(`the ${STOCK_TABS.health} tab for`));
  ok(`the clause quotes the real portfolio-tab shape ("the ${PORTFOLIO_TABS.holdings} tab of your portfolio")`,
    VYTAL_CONTEXT_LAYER.includes(`the ${PORTFOLIO_TABS.holdings} tab of your portfolio`) && pf === `the ${PORTFOLIO_TABS.holdings} tab of your portfolio`);
  ok("the clause quotes the real watchlist + hub labels",
    VYTAL_CONTEXT_LAYER.includes(wl) && VYTAL_CONTEXT_LAYER.includes(hub), `"${wl}" · "${hub}"`);
  ok("★ the clause states the positive rule (a place to go, not a name)",
    /A MARKER IS A PLACE TO GO, NOT A NAME/.test(VYTAL_CONTEXT_LAYER));
  // ⚠ THE SALIENCE RULE, ASSERTED. This file has recorded twice that naming a forbidden shape reads as
  //   instruction, so the new clause must contain none of the broken shapes it was written against.
  ok("★★ the clause contains NO counter-example of the broken shapes (the salience lesson)",
    !/\{link:[^}]*\}(?!\})/.test(VYTAL_CONTEXT_LAYER) && !/\bthe \[the /.test(VYTAL_CONTEXT_LAYER));

  // ── §2 · MALFORMED SHAPES ARE STRIPPED, WORDS PRESERVED ─────────────────────────────────────
  section("2 · malformed markers never reach the reader, and the sentence survives");
  const MAL: [string, string, string][] = [
    // input, expected output, why
    [`Tata Consultancy Services ({link:stock:${SYM}}) distributes cash.`, `Tata Consultancy Services (${SYM}) distributes cash.`, "★ THE OBSERVED DEFECT, verbatim"],
    [`See { link : stock : ${SYM} } for more.`, `See ${SYM} for more.`, "spaced single brace"],
    [`Read {link:stock:${SYM}:health} today.`, `Read ${SYM} today.`, "single brace with a tab"],
    [`All of it is on {link:health-hub}.`, `All of it is on .`, "a subject-less kind leaves nothing (standing policy)"],
    [`Try {link:stock:/admin/retention} now.`, `Try adminretention now.`, "★ injection — inert() strips every path character"],
  ];
  for (const [input, want, why] of MAL) {
    const r = await resolveAppLinks(input);
    ok(`${why} │ "${r.text}"`, r.text === want && r.malformed.length === 1, r.text === want ? `malformed=${r.malformed.length}` : `wanted "${want}"`);
  }
  {
    const r = await resolveAppLinks(`[the read]({link:stock:${SYM}}) is here.`);
    ok("★ a malformed marker in a DESTINATION slot cannot become an in-app path",
      !/\]\(\//.test(r.text) && r.malformed.length === 1, r.text);
  }
  ok("★ the raw string is logged verbatim, so the log names the syntax the model wrote",
    (await resolveAppLinks(`x ({link:stock:${SYM}}) y`)).malformed[0] === `{link:stock:${SYM}}`);

  // ── §3 · NEGATIVE CONTROLS ──────────────────────────────────────────────────────────────────
  section("3 · the well-formed cases are untouched");
  {
    const r = await resolveAppLinks(`The full read is at {{link:stock:${SYM}:health}}.`);
    ok("★ a well-formed marker STILL resolves to a real anchor", r.resolved.length === 1 && r.malformed.length === 0 && /\]\(\/research\//.test(r.text), r.text);
  }
  {
    const r = await resolveAppLinks("Everything is on {{link:health-hub}} and {{link:watchlist}}.");
    ok("★ the parameterless kinds still resolve", r.resolved.length === 2 && r.malformed.length === 0, r.text);
  }
  {
    const r = await resolveAppLinks(`[the full read]({{link:stock:${SYM}:health}})`);
    ok("★ the WRAPPED form still resolves and keeps the model's own label", /^\[the full read\]\(\/research\//.test(r.text) && r.malformed.length === 0, r.text);
  }
  for (const [text, why] of [
    ['A payload like { "link": "https://x" } in prose is not our marker.', "quoted JSON key"],
    ["The word {link} on its own has no colon and is not our marker.", "no colon"],
  ] as [string, string][]) {
    const r = stripMalformedMarkers(text);
    ok(`untouched │ ${why}`, r.text === text && r.stripped.length === 0, r.text);
  }
  ok("★ the sweep cannot match a well-formed marker (the lookaround, asserted)",
    stripMalformedMarkers(`a {{link:stock:${SYM}:health}} b`).stripped.length === 0);
  // ★★ THE PREMISE BEHIND THE FIX TO verify-pages-live-chat.ts's TYPED-PATH CHECK, ASSERTED HERE.
  //    That check failed twice on a run whose replies were correct, because it treated every `](/…)`
  //    in delivered text as model-typed. It cannot be: stripTypedPaths removes model-authored
  //    destinations BEFORE substitution, so a path that survives is necessarily one the server built.
  //    If this assertion ever fails, that check's exemption becomes unsafe and must be revisited.
  {
    const typed = await resolveAppLinks("See [the Flags & Patterns tab](/portfolio) for that.");
    ok("★★ a model-TYPED in-app path never survives into delivered text",
      !/\]\(\//.test(typed.text) && typed.strippedPaths.length === 1, typed.text);
    const built = await resolveAppLinks(`See {{link:stock:${SYM}:health}} for that.`);
    ok("★★ …so a surviving `](/…)` is necessarily SERVER-built", /\]\(\/research\/stock-screener\//.test(built.text) && built.strippedPaths.length === 0, built.text);
  }

  // ── §4 · ★ THE NEW DETECTION OVER THE FULL LIVE CORPUS ──────────────────────────────────────
  // The standing lesson: every scan in this codebase has been wrong on first contact with real output.
  // So the new sweep is run over every delivered turn BEFORE it is trusted, and every fire is printed.
  section("4 · ★ the new sweep over the FULL live corpus — every fire, verbatim");
  const corpus: { src: string; text: string }[] = [];
  for (const m of await prisma.chatMessage.findMany({
    where: { role: "assistant", kind: "text", undelivered: false },
    select: { content: true, sessionId: true }, orderBy: { createdAt: "asc" },
  })) corpus.push({ src: `chat_messages/${m.sessionId.slice(0, 8)}`, text: m.content });
  const T = (process.env.TEMP ?? ".").split("\\").join("/");
  for (const a of ["depth-before", "depth-after"]) {
    try {
      for (const r of JSON.parse(readFileSync(`${T}/${a}.json`, "utf8")) as { id: string; reply: string }[])
        corpus.push({ src: `${a}/${r.id}`, text: r.reply });
    } catch { console.log(`     ⚠ arm file absent: ${T}/${a}.json`); }
  }
  const fires: { src: string; was: string; now: string }[] = [];
  for (const row of corpus) {
    const r = stripMalformedMarkers(row.text);
    for (const s of r.stripped) fires.push({ src: row.src, was: s, now: r.text.slice(Math.max(0, row.text.indexOf(s) - 40), row.text.indexOf(s) + 40).replace(/\s+/g, " ") });
  }
  for (const f of fires) console.log(`     ★ [${f.src}] stripped "${f.was}"  →  …${f.now}…`);
  console.log(`     corpus: ${corpus.length} delivered turns · malformed markers found: ${fires.length}`);
  ok("★★ the sweep fires ONLY on the one measured occurrence — no false positive on 100+ real turns",
    fires.length === 1 && fires[0].was.startsWith("{link:stock:"), `${fires.length} fires`);
  // The placement shapes are NOT code-fixable and are NOT asserted to be zero here — they are a
  // vocabulary change whose evidence is live, in §3c of the report. Their baseline is printed so the
  // next run can see whether the clause moved them.
  const placement = LINK_DEFECTS.filter((d) => ["link-as-ticker", "article-doubled", "noun-doubled"].includes(d.id));
  for (const d of placement) {
    const n = corpus.reduce((acc, r) => acc + (r.text.match(new RegExp(d.re.source, d.re.flags)) ?? []).length, 0);
    console.log(`     baseline (pre-clause corpus) · ${d.id.padEnd(16)} ${n}`);
  }

  // ── §5 · TOKEN COST ─────────────────────────────────────────────────────────────────────────
  section("5 · what the clause costs");
  const added = VYTAL_CONTEXT_LAYER.split("\n").filter((l) => l.startsWith("★ A MARKER")).join("\n");
  // Exact where a key is available; the chars/4 estimate, clearly labelled, where it is not.
  // ⚠ THE "BEFORE" IS MEASURED, NOT SUBTRACTED. Tokens do not add: the tokenizer merges across the
  //   join, so `layer − clause` overstates the real cost by ~100. The pre-clause layer is rebuilt by
  //   removing the two lines and counted on its own.
  const without = VYTAL_CONTEXT_LAYER.split("\n").filter((l) => !l.startsWith("★ A MARKER")).join("\n");
  let addedTok = Math.round(added.length / 4);
  let layerTok = Math.round(VYTAL_CONTEXT_LAYER.length / 4);
  let beforeTok = Math.round(without.length / 4);
  let exact = false;
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.AI_API_KEY ?? "";
  if (apiKey) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const model = process.env.AI_CHAT_MODEL ?? "gemini-3.5-flash-lite";
      addedTok = (await ai.models.countTokens({ model, contents: added })).totalTokens ?? addedTok;
      layerTok = (await ai.models.countTokens({ model, contents: VYTAL_CONTEXT_LAYER })).totalTokens ?? layerTok;
      beforeTok = (await ai.models.countTokens({ model, contents: without })).totalTokens ?? beforeTok;
      exact = true;
    } catch { /* fall back to the estimate */ }
  }
  console.log(`     ${exact ? "EXACT (countTokens)" : "ESTIMATED (chars/4)"} · the clause is ${addedTok} tokens`);
  console.log(`     VYTAL_CONTEXT_LAYER: ${beforeTok} → ${layerTok} tokens — a REAL cost of +${layerTok - beforeTok} (+${(((layerTok - beforeTok) / beforeTok) * 100).toFixed(1)}%)`);
  console.log(`     (the clause alone counts ${addedTok}${addedTok === layerTok - beforeTok ? " — the join costs nothing extra" : "; the rest is the tokenizer merging across the join"})`);
  ok("the addition is two lines, both positive rules", added.split("\n").length === 2, `${added.split("\n").length} lines`);

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
