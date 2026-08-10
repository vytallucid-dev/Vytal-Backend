// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE MODEL IS TOLD WHAT THE SERVICE RETURNED — the gate on the filing channel's model-facing sites.
//
// ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────────
// Three model-facing sites read the SCORE channel and stated the absence of findings, while holding a
// populated FILING section on the very same object:
//
//   ai/grounding.ts        "No composite, pillars, findings, trajectory, or peer standing exist for
//                          it" — the unscored branch, in EVERY turn's background context. Its SCORED
//                          branch iterated the score arrays only, so a scored company's filing
//                          findings never reached the model either.
//   chat/tools/boundary.ts "no composite, pillars, or findings exist for it at this time."
//   get-findings-for-symbols.ts  "there are no findings to report."
//
// Live, asked for the notable findings on 360ONE, the assistant answered "no findings or red flags to
// report" over a standing critical flag: 90% of the promoter holding pledged, FY27Q1 shareholding.
//
// ── WHAT THIS PROVES, AND WHY EACH IS THE PROPERTY THAT MATTERS ───────────────────────────────────
//   1. NO SITE STILL CLAIMS IT     — source-level, over the three files, for the exact sentences.
//   2. THE CHANNEL REACHES ALL 4   — the fired row, its verdict, its receipts, on every site, for a
//      MODEL-FACING SITES            company of each of the four shapes (unscored+fired, scored+fired,
//                                    scored+quiet-partial, scored+quiet-complete).
//   3. THREE STATES, NEVER TWO     — over the WHOLE live book: fired ⇔ no quiet note, quiet ⇔ a note,
//                                    and no stock renders a block that says nothing at all.
//   4. NO RAW EVIDENCE REACHES THE — over the whole book: no JSON, no camelCase evidence key, no
//      MODEL THROUGH THIS CHANNEL    threshold or study-statistic key name, in any rendered block.
//   5. THE SCORE CHANNEL DID NOT   — the score-finding line count still equals the score section's own
//      MOVE                          arrays, exactly, on every scored stock, and those lines still
//                                    carry their bracketed key + raw payload. The filing block is
//                                    additive; it does not add to, remove from, or edit that channel.
//
// ⚠ 3, 4 and 5 run over EVERY stock in the universe, not a fixture set. A vocabulary gap or a leaked
// key on stock 400 is exactly the failure a four-company check cannot see.
//
//   npx tsx src/scripts/verify-filing-model-facing.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { readFilingFindings } from "../filing/read.js";
import { renderFilingFacts, FILING_CHANNEL_NOTE } from "../ai/filing-facts.js";
import { groundStockHealth } from "../ai/grounding.js";
import { inUniverseButUnscored } from "../chat/tools/boundary.js";
import { readFindingsForSymbols } from "../scoring/read/symbol-findings.service.js";
import { EVIDENCE_FACTS } from "../catalogue/evidence-facts.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

/** The four shapes, named. Chosen from live data, not invented — see the probe in §2's output. */
const CORPUS = {
  unscoredFiring: "360ONE",     // unscored · 1 fired (critical) · 12 rules with no filing to run
  scoredFiring: "BEL",          // scored · 1 score pattern · 4 filing findings · 4 declined
  scoredQuietPartial: "KOTAKBANK", // scored · 0 fired · 10 clean · 8 capabilities not assessable
  scoredQuietComplete: "COLPAL",   // scored · 0 fired · all 22 ran · the only unqualified all-clear
} as const;

async function main() {
  // ── 1 · SOURCE ────────────────────────────────────────────────────────────────────────────────
  rule("1 · SOURCE — no model-facing site still claims an unscored stock has no findings");
  // ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING, AND THAT IS NOT A LOOPHOLE. Each of these files now
  // QUOTES the sentence it used to emit, in the header note explaining what was fixed — which is the
  // record of the defect and is exactly what a reviewer needs. A gate that fires on the documentation
  // of a fix is the failure verify-phs-copy.ts warns about: the only way to silence it is to delete
  // the explanation. What the check is actually about is what the model RECEIVES, so it scans code.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const SITES: [string, string][] = (
    [
      ["ai/grounding.ts", "src/ai/grounding.ts"],
      ["chat/tools/boundary.ts", "src/chat/tools/boundary.ts"],
      ["chat/tools/get-findings-for-symbols.ts", "src/chat/tools/get-findings-for-symbols.ts"],
      ["chat/tools/get-stock-facts.ts", "src/chat/tools/get-stock-facts.ts"],
    ] as const
  ).map(([label, path]) => [label, stripComments(readFileSync(path, "utf8"))]);
  // The exact sentences that shipped the defect. Matched as EMITTED STRING FRAGMENTS — each site's
  // own historical wording — so a site that reverts to one fails by name rather than by transcript.
  const OLD: [string, RegExp][] = [
    ["grounding's unscored early return", /pillars, findings, trajectory/],
    ["boundary's unscored message", /composite, pillars, or findings exist for it/],
    ["the batch tool's unscored row", /so there are no findings to report/],
    ["the lean tool's empty-finding line", /"Findings: none fired\."/],
  ];
  for (const [label, re] of OLD) {
    const hits = SITES.filter(([, src]) => re.test(src)).map(([n]) => n);
    ok(`the old sentence is gone — ${label}`, hits.length === 0, hits.join(", ") || "no site carries it");
  }
  // NEGATIVE CONTROL — the matcher is live, not a regex that can never fire.
  ok(
    "NEGATIVE CONTROL — the matcher catches the pre-fix boundary sentence",
    OLD[1][1].test("is covered by Vytal but does not have a computed health score yet — no composite, pillars, or findings exist for it at this time."),
    "caught",
  );
  for (const [name, src] of SITES) {
    ok(`${name} renders the filing channel through the ONE renderer`, /filing-facts\.js"/.test(src), "ai/filing-facts.js imported");
  }
  // …and the comment stripper has not blinded the scan: the sentences ARE still in these files, as
  // documentation, and a scan of the raw bytes still finds them. If this stops holding, the stripper
  // is over-reaching rather than the copy being clean.
  ok(
    "NEGATIVE CONTROL — the stripper removes comments only (the raw files still carry the quoted history)",
    /composite, pillars, or findings exist for it/.test(readFileSync("src/chat/tools/boundary.ts", "utf8")) &&
      /so there are no findings to report/.test(readFileSync("src/chat/tools/get-findings-for-symbols.ts", "utf8")),
    "documented in comments, emitted nowhere",
  );

  // ── 2 · THE FOUR SHAPES, ON EVERY SITE ────────────────────────────────────────────────────────
  rule("2 · RENDERED — the channel reaches the model on all four sites, for all four shapes");
  const symbols = Object.values(CORPUS);
  const batch = await readFindingsForSymbols(symbols);
  const batchRow = (s: string) => batch.rows.find((r) => r.symbol === s)!;

  for (const [shape, sym] of Object.entries(CORPUS)) {
    const g = await groundStockHealth(sym);
    if (!g) { ok(`${sym} resolves`, false, "not in universe"); continue; }
    const sec = g.data.filingFindings;
    const row = batchRow(sym);

    // Every site's model-facing text for this company.
    const texts: [string, string][] = [
      ["grounding fact block", g.factBlock],
      ["filing renderer", renderFilingFacts(sec, { subject: sym }).join("\n")],
      ["batch tool row", renderFilingFacts(row.filing, { subject: sym, indent: "  ", note: false }).join("\n")],
    ];
    if (!g.data.scored) texts.push(["boundary message", inUniverseButUnscored(sym, g.data.identity.name, sec)]);

    // ★ THE LEAN SCOPE IS CHECKED SEPARATELY, AND SEPARATELY IS THE POINT. It carries NAMES, not
    //   verdicts — so it cannot be held to the same assertion as the full block — but it is the
    //   DEFAULT getStockFacts read, so what it drops is dropped from most answers. What it must never
    //   drop: the fired names, the quiet note, and the incomplete-check-list qualification.
    const leanText = renderFilingFacts(sec, { subject: sym, scope: "lean" }).join("\n");
    const leanMissing = (sec?.fired ?? []).filter((f) => !leanText.includes(f.name)).map((f) => f.name);
    ok(`${sym}: the LEAN scope names every fired filing finding`, leanMissing.length === 0, leanMissing.join(", ") || `${sec?.fired.length ?? 0} named`);
    if (sec?.coverage.quietNote) {
      ok(`${sym}: the LEAN scope carries the quiet note verbatim`, leanText.includes(sec.coverage.quietNote), "carried");
    }
    const gap = (sec?.coverage.notEvaluable ?? 0) + (sec?.coverage.notRun ?? 0);
    ok(
      `${sym}: the LEAN scope ${gap > 0 ? "states the incomplete check-list" : "makes NO coverage claim it has not earned"}`,
      gap > 0 ? /check-list INCOMPLETE/.test(leanText) : !/INCOMPLETE/.test(leanText),
      gap > 0 ? `${gap} of 22 produced no result` : "all 22 ran — no qualifier",
    );
    if (sec?.declined.length) {
      const named = sec.declined.filter((d) => !leanText.includes(d.capability)).map((d) => d.capability);
      ok(`${sym}: the LEAN scope names the capabilities it could not assess`, named.length === 0, named.join(", ") || `${sec.declined.length} named`);
    }

    console.log(`\n  ── ${sym} (${shape}) · scored=${g.data.scored} · fired=${sec?.fired.length} · declined=${sec?.declined.length} · notRun=${sec?.coverage.notRun}`);
    for (const f of sec?.fired ?? []) {
      const missing = texts.filter(([, t]) => !t.includes(f.name) || !t.includes(f.verdict)).map(([n]) => n);
      ok(`${sym}: "${f.name}" and its verdict reach every site`, missing.length === 0, missing.join(", ") || `${texts.length} sites`);
    }
    if (sec?.coverage.quietNote) {
      const missing = texts.filter(([, t]) => !t.includes(sec.coverage.quietNote!)).map(([n]) => n);
      ok(`${sym}: the quiet note reaches every site VERBATIM`, missing.length === 0, missing.join(", ") || `"${sec.coverage.quietNote.slice(0, 60)}…"`);
    }
    for (const d of sec?.declined ?? []) {
      const missing = texts.filter(([, t]) => !t.includes(d.capability)).map(([n]) => n);
      ok(`${sym}: "${d.capability}" is named as not-assessable on every site`, missing.length === 0, missing.join(", "));
    }
  }

  // ★ THE HEADLINE CASE, ASSERTED AS ITSELF: the sentence that shipped, over the flag it hid.
  const g360 = (await groundStockHealth(CORPUS.unscoredFiring))!;
  const pledge = g360.data.filingFindings?.fired.find((f) => f.key === "ownership_R1_pledge");
  ok(
    `★ ${CORPUS.unscoredFiring} — the pledging red flag is in the background context of EVERY turn`,
    !!pledge && g360.factBlock.includes(pledge.verdict) && g360.factBlock.includes("Pledging Crisis"),
    pledge?.verdict.slice(0, 70),
  );
  ok(
    `★ ${CORPUS.unscoredFiring} — the unscored fact block no longer denies having findings`,
    !/No composite, pillars, findings/.test(g360.factBlock) && g360.factBlock.includes('NOT THE SAME AS "nothing to report"'),
    "the denial is replaced by the channel",
  );

  // ── 3 · THREE STATES, OVER THE WHOLE BOOK ─────────────────────────────────────────────────────
  rule("3 · TOTALITY — every stock in the universe renders a state, and never two of them");
  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const filing = await readFilingFindings(stocks.map((s) => s.id));
  // BOTH SCOPES, on every stock — the lean projection is the default read and gets no free pass.
  const blocks = new Map<string, string>();
  for (const s of stocks) {
    const sec = filing.get(s.id) ?? null;
    blocks.set(s.symbol, renderFilingFacts(sec, { subject: s.symbol }).join("\n"));
    blocks.set(`${s.symbol} (lean)`, renderFilingFacts(sec, { subject: s.symbol, scope: "lean" }).join("\n"));
  }

  const silent = stocks.filter((s) => (blocks.get(s.symbol) ?? "").trim().length <= FILING_CHANNEL_NOTE.length);
  ok(`no stock renders a block that says nothing (${stocks.length} stocks)`, silent.length === 0, silent.slice(0, 6).map((s) => s.symbol).join(", "));

  const bothOrNeither = stocks.filter((s) => {
    const sec = filing.get(s.id);
    if (!sec) return true;
    const fired = sec.fired.length > 0;
    const quiet = sec.coverage.quietNote !== null;
    return fired === quiet; // exactly one of the two must hold
  });
  ok("fired ⇔ no quiet note, on every stock (the two silences never collapse into one)", bothOrNeither.length === 0, bothOrNeither.slice(0, 6).map((s) => s.symbol).join(", "));

  const shapes = { fired: 0, cleanFull: 0, cleanPartial: 0, nothingHeld: 0 };
  for (const s of stocks) {
    const c = filing.get(s.id)!.coverage;
    if (c.fired > 0) shapes.fired++;
    else if (c.evaluated === 0) shapes.nothingHeld++;
    else if (c.fullyEvaluated) shapes.cleanFull++;
    else shapes.cleanPartial++;
  }
  console.log(`  live shape census: ${shapes.fired} firing · ${shapes.cleanFull} fully checked and clean · ${shapes.cleanPartial} clean but partially checked · ${shapes.nothingHeld} no filings held`);
  ok("the 'fully checked and clean' state is distinguishable from 'clean but partial'", shapes.cleanFull > 0 && shapes.cleanPartial > 0, `${shapes.cleanFull} vs ${shapes.cleanPartial}`);

  // ── 4 · NO RAW EVIDENCE ───────────────────────────────────────────────────────────────────────
  rule("4 · VOCABULARY — no raw key, threshold or study statistic leaves through this channel");
  // Every evidence key the vocabulary knows, in the form a leak would take. camelCase keys are the
  // decisive set: a reader LABEL is authored words with spaces, so a camelCase token in the rendered
  // text can only have come from a bag. Single-word keys ("deals", "years", "band") are deliberately
  // NOT matched — they are ordinary English and appear legitimately inside authored verdicts.
  const camel = Object.keys(EVIDENCE_FACTS).filter((k) => /[a-z][A-Z]/.test(k));
  const barsAndStudy = Object.entries(EVIDENCE_FACTS)
    .filter(([, f]) => f.kind === "internal" && (f.reason === "threshold" || f.reason === "study"))
    .map(([k]) => k);
  console.log(`  scanning ${blocks.size} rendered blocks against ${camel.length} camelCase keys + ${barsAndStudy.length} threshold/study keys`);

  const leaks: string[] = [];
  const jsonish: string[] = [];
  for (const [sym, text] of blocks) {
    for (const k of camel) if (text.includes(k)) leaks.push(`${sym}: "${k}"`);
    for (const k of barsAndStudy) if (new RegExp(`\\b${k}\\b`).test(text)) leaks.push(`${sym}: "${k}" (${(EVIDENCE_FACTS[k] as { reason: string }).reason})`);
    // A dumped bag is the other shape the leak takes, and it carries every key at once.
    if (/[{}]/.test(text) || /":\s*/.test(text)) jsonish.push(sym);
  }
  ok("ZERO raw evidence keys in any rendered filing block", leaks.length === 0, [...new Set(leaks)].slice(0, 8).join(" · ") || `${blocks.size} blocks clean`);
  ok("ZERO dumped evidence bags (no JSON) in any rendered filing block", jsonish.length === 0, jsonish.slice(0, 8).join(", ") || `${blocks.size} blocks clean`);
  // NEGATIVE CONTROLS — both scanners are live.
  ok(
    "NEGATIVE CONTROL — the key scanner catches a leaked pledgeRatioQ / thresholdPct",
    camel.includes("pledgeRatioQ") && barsAndStudy.includes("thresholdPct") && barsAndStudy.includes("evidencedN"),
    "the vocabulary carries all three",
  );
  ok(
    "NEGATIVE CONTROL — the JSON scanner catches a dumped bag",
    /[{}]/.test('evidence={"pledgeRatioQ":89.97,"thresholdPct":50}'),
    "caught",
  );

  // ── 5 · THE SCORE CHANNEL DID NOT MOVE ────────────────────────────────────────────────────────
  rule("5 · PARITY — the filing block is ADDITIVE; the score channel is untouched");
  // EVERY scored stock, resolved up front rather than by grounding all 504 and discarding — the read
  // is ~15 queries a stock, and "which ones are scored" is one indexed query.
  const scoredIds = new Set(
    (await prisma.scoreSnapshot.findMany({ where: { snapshotType: "quarterly" }, select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId),
  );
  const scoredSymbols = stocks.filter((s) => scoredIds.has(s.id));
  console.log(`  grounding all ${scoredSymbols.length} stocks with a quarterly snapshot — no sampling`);
  const mismatched: string[] = [];
  let checked = 0;
  for (const s of scoredSymbols) {
    const g = await groundStockHealth(s.symbol);
    if (!g || !g.data.scored) continue;
    checked++;
    const lines = g.factBlock.split("\n");
    const rendered = lines.filter((l) => l.startsWith("- RedFlag ") || l.startsWith("- Pattern ")).length;
    const expected = (g.data.findings?.redFlags.length ?? 0) + (g.data.findings?.patterns.length ?? 0);
    if (rendered !== expected) mismatched.push(`${s.symbol}: ${rendered} rendered vs ${expected} in view.findings`);
    // The filing block's own rows use a DIFFERENT prefix by construction, so the two channels cannot
    // be confused for one another by a consumer counting lines — including this gate.
    if (lines.some((l) => l.startsWith("- FILED FINDING") && (l.includes("RedFlag") || l.includes("Pattern ["))))
      mismatched.push(`${s.symbol}: a filing row is wearing a score row's shape`);
  }
  ok(
    `score-finding LINES still equal view.findings exactly, on EVERY scored stock (${checked})`,
    mismatched.length === 0,
    mismatched.slice(0, 6).join(" · ") || `${checked} stocks, 0 drift`,
  );
  const belBlock = (await groundStockHealth(CORPUS.scoredFiring))!.factBlock;
  ok(
    "the score channel still carries its bracketed key and raw payload (that path is unedited)",
    /- Pattern "Sticky Divergence" \[divergence_S2_sticky_divergence\]:/.test(belBlock) && /evidence=\{/.test(belBlock),
    "unchanged",
  );
  ok(
    "…and the filing block sits AFTER it, in its own section",
    belBlock.indexOf("[FINDINGS]") < belBlock.indexOf(FILING_CHANNEL_NOTE) &&
      belBlock.indexOf(FILING_CHANNEL_NOTE) < belBlock.indexOf("[PEER STANDING]"),
    "between [FINDINGS] and [PEER STANDING]",
  );

  console.log(`\n${fail === 0 ? "✅ FILING MODEL-FACING GATES PASS — the model is told what the service returned" : `❌ ${fail} FAILURE(S)`}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
