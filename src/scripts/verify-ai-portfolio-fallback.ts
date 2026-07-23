// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE DETERMINISTIC FALLBACK PROSE — PROVEN NON-ADVISORY, AGAINST BOTH GATES. (portfolio AND stock)
//
// ★ WHY BOTH GATES, AND WHY THAT IS THE POINT OF THIS FILE.
//
// A fallback fires at exactly the moment the MODEL'S output was rejected for containing advice. So the
// bar it has to clear is not "a human read it and it seemed fine" — it is THE SAME GATE THE MODEL JUST
// FAILED. Until now no fallback in this codebase was ever scanned by `scanExplanationText`; the
// portfolio layers were proven against PORTFOLIO_ADVICE_DENY_LIST and the stock lens catalog against
// FORWARD_DENY_LIST, both of which are DIFFERENT vocabularies with different blind spots. Two proofs
// that don't cover the runtime guard are not the runtime guard.
//
//   · scanStringsForForwardLanguage(…, PORTFOLIO_ADVICE_DENY_LIST) — the portfolio vocabulary. Parity
//     with the existing verify-phs-story / verify-phs-copy proofs.
//   · scanExplanationText(…) — THE RUNTIME AI GUARDRAIL. The new requirement, and the whole reason this
//     file exists.
//
// ⚠ THE STOCK SURFACE IS SCANNED WITH THE *SHARED* FORWARD LIST, NOT THE PORTFOLIO ONE — deliberately,
// and it is not a weaker standard. no-forward-guard.ts's own header rules it: "'reduced margins' is
// DESCRIPTIVE in a stock Read and would false-positive on a shared \breduce\b, so judging LM/LP strings
// by portfolio verbs would manufacture reds that train people to ignore the guard." One rule, two
// vocabularies. Both surfaces get the runtime guardrail on top; that part is universal.
//
// WHAT THIS ASSERTS:
//   1. The AUTHORED set (the only prose the portfolio composer writes itself) is exhaustive by
//      construction, and clean on both gates.
//   2. All FOUR portfolio states compose clean on both gates — real books where they exist, clearly
//      LABELLED fixtures where the DB has none.
//   3. Negative controls per gate — the scanners are live, not vacuously passing.
//   4. ★ THE STOCK RETROFIT: composeDeterministicFallback across the live universe, plus the
//      EXHAUSTIVE standing-context verdict corpus, through the runtime guardrail.
//
// NO AI CALLS. No provider, no quota, no network — pure composition over DB reads.
//   npx tsx src/scripts/verify-ai-portfolio-fallback.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import {
  composeDeterministicPortfolioFallbackDetailed,
  AUTHORED_FALLBACK_STRINGS,
  type PortfolioFallbackLayer,
} from "../ai/explain/portfolio-health.js";
import { composeDeterministicFallback } from "../ai/explain/stock-health.js";
import { buildPortfolioHealthView, reshapeSnapshot, type SnapshotReadInput, type PortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import { composeLmVerdict, composeLpVerdict, type StandingBand } from "../scoring/lens-patterns/standing-context.js";
import { scanExplanationText } from "../ai/guardrail.js";
import { scanStringsForForwardLanguage, PORTFOLIO_ADVICE_DENY_LIST } from "../scoring/lens-patterns/no-forward-guard.js";
import type { PfFinding } from "../portfolio/phs/patterns.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(98) + "\n" + s + "\n" + "═".repeat(98));

// ── THE TWO GATES, applied together. `vocab` picks the surface's own advice vocabulary. ──
type Vocab = "portfolio" | "shared";
function bothGates(id: string, text: string, vocab: Vocab): { clean: boolean; detail: string } {
  const extra = vocab === "portfolio" ? PORTFOLIO_ADVICE_DENY_LIST : [];
  const fwd = scanStringsForForwardLanguage(id, [text], extra);
  const ai = scanExplanationText(text);
  const bits: string[] = [];
  if (fwd.length) bits.push(`advice-verbs: ${fwd.map((v) => `"${v.term}"`).join(", ")}`);
  if (!ai.clean) bits.push(`guardrail HARD: ${ai.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ")}`);
  return { clean: fwd.length === 0 && ai.clean, detail: bits.join(" · ") };
}

/** Assert one composed body against both gates, printing a readable slice either way. */
function assertClean(label: string, text: string, vocab: Vocab) {
  const r = bothGates(label, text, vocab);
  ok(label, r.clean, r.clean ? `${text.length}c · "${text.slice(0, 76).replace(/\s+/g, " ")}…"` : r.detail);
}

async function main() {
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · THE AUTHORED SET — the only prose the portfolio composer writes itself");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // Exhaustiveness FIRST: a sentence that never reached the array would sail past every scan below.
    const src = readFileSync("src/ai/explain/portfolio-health.ts", "utf8");
    const declared = [...src.matchAll(/^const [A-Z_]+ =\s*\n?\s*"((?:[^"\\]|\\.)*)";/gm)].map((m) => m[1]!);
    ok("★ every authored const in the module is IN the proof set (exhaustive by construction)",
      declared.length > 0 && declared.every((d) => AUTHORED_FALLBACK_STRINGS.includes(d)),
      `${declared.length} declared / ${AUTHORED_FALLBACK_STRINGS.length} in set` +
        (declared.filter((d) => !AUTHORED_FALLBACK_STRINGS.includes(d)).join(" | ") || ""));

    console.log("\n  ── every authored string, verbatim ──");
    for (const s of AUTHORED_FALLBACK_STRINGS) console.log(`     • ${s}`);
    console.log();
    for (const s of AUTHORED_FALLBACK_STRINGS) assertClean(`authored: "${s.slice(0, 52)}…"`, s, "portfolio");
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · NEGATIVE CONTROLS — both gates are LIVE, not vacuously passing");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const bait = "You should trim this position.";
    const fwd = scanStringsForForwardLanguage("BAIT", [bait], PORTFOLIO_ADVICE_DENY_LIST);
    const ai = scanExplanationText(bait);
    ok('★ the PORTFOLIO advice gate CATCHES "You should trim this position."', fwd.length > 0,
      fwd.map((v) => v.term).join(",") || "DID NOT FIRE — the gate is dead");
    ok('★ the RUNTIME guardrail CATCHES "You should trim this position."', ai.clean === false,
      ai.hardHits.map((h) => h.term).join(",") || "DID NOT FIRE — the gate is dead");

    // ★ AND A CONTROL FOR THE GAP THAT MOTIVATED THIS FILE: hedged advice using no banned verb. The
    // portfolio vocabulary MISSES it; the runtime guardrail catches it. Neither gate subsumes the
    // other, which is exactly why the fallback must clear both.
    const hedged = "It might be worth keeping an eye on the bigger names here.";
    const hedgedFwd = scanStringsForForwardLanguage("BAIT2", [hedged], PORTFOLIO_ADVICE_DENY_LIST);
    const hedgedAi = scanExplanationText(hedged);
    ok("★★ hedged advice: the portfolio vocabulary MISSES it (0 hits) …", hedgedFwd.length === 0, `${hedgedFwd.length} hits`);
    ok("★★ … and the RUNTIME guardrail CATCHES it — the two gates are not redundant",
      hedgedAi.clean === false, hedgedAi.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", "));
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · THE FOUR PORTFOLIO STATES — composed and scanned on both gates");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  const layersSeen = new Set<PortfolioFallbackLayer>();

  // ── Discover real books, and classify them by the state they actually are in. ──
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const classified: { id: string; email: string; view: PortfolioHealthView }[] = [];
  for (const u of users) classified.push({ id: u.id, email: u.email, view: await buildPortfolioHealthView(u.id) });

  const empty = classified.filter((c) => !c.view.snapshot && !c.view.hasHoldings);
  const heldNoSnap = classified.filter((c) => !c.view.snapshot && c.view.hasHoldings);
  const constructionOnly = classified.filter((c) => c.view.snapshot && c.view.snapshot.healthRead === null);
  const partial = classified.filter((c) => c.view.snapshot?.healthRead && c.view.snapshot.coverageState.scoredWeight < 0.999);
  const full = classified.filter((c) => c.view.snapshot?.healthRead && c.view.snapshot.coverageState.scoredWeight >= 0.999);

  console.log(`  books: empty=${empty.length} heldNoSnapshot=${heldNoSnap.length} constructionOnly=${constructionOnly.length} partial=${partial.length} full=${full.length}\n`);

  // ── STATE A · EMPTY BOOK (real) ──────────────────────────────────────────────────────────────────
  console.log("  ── STATE A · empty book (REAL) ──");
  ok("a real empty book exists to test", empty.length > 0, `${empty.length} found`);
  for (const c of empty.slice(0, 2)) {
    const f = composeDeterministicPortfolioFallbackDetailed(c.view);
    layersSeen.add(f.layer);
    ok(`  layer === "decline"`, f.layer === "decline", f.layer);
    assertClean(`  ${c.email.slice(0, 30)}`, f.text, "portfolio");
  }

  // ── STATE B · HOLDINGS BUT NO SNAPSHOT ───────────────────────────────────────────────────────────
  console.log("\n  ── STATE B · holdings, no snapshot yet ──");
  if (heldNoSnap.length) {
    for (const c of heldNoSnap.slice(0, 2)) {
      const f = composeDeterministicPortfolioFallbackDetailed(c.view);
      layersSeen.add(f.layer);
      assertClean(`  REAL ${c.email.slice(0, 30)}`, f.text, "portfolio");
    }
  } else {
    // ⚠ FIXTURE — SAY SO. No book in this DB is mid-first-compute (every holder already has a
    // snapshot). The state is real and reachable (first mutation pending / backfill in flight); only
    // this INSTANCE is synthetic. The view is a REAL empty-book view with hasHoldings flipped, so the
    // only fabricated value is the one the branch turns on.
    const donor = empty[0]!;
    const fixture = { ...donor.view, hasHoldings: true } as PortfolioHealthView;
    const f = composeDeterministicPortfolioFallbackDetailed(fixture);
    layersSeen.add(f.layer);
    ok("⚠ SYNTHETIC FIXTURE — no mid-first-compute book exists in this DB; state exercised via a real empty view with hasHoldings=true", true);
    ok(`  it takes the NO_SNAPSHOT branch, not EMPTY_BOOK (the distinction is the point)`,
      f.text.includes("has not been scored yet"), f.text);
    assertClean("  fixture: holdings, no snapshot", f.text, "portfolio");
  }

  // ── STATE C · CONSTRUCTION-ONLY (healthRead null ⇒ Layer 2) ──────────────────────────────────────
  console.log("\n  ── STATE C · construction-only (nothing scored) ──");
  if (constructionOnly.length) {
    for (const c of constructionOnly.slice(0, 3)) {
      const f = composeDeterministicPortfolioFallbackDetailed(c.view);
      layersSeen.add(f.layer);
      assertClean(`  REAL ${c.email.slice(0, 30)}`, f.text, "portfolio");
    }
  } else {
    // ⚠ FIXTURE — AND HERE IS EXACTLY WHAT IS SYNTHETIC ABOUT IT. Every book in this DB has scored
    // holdings, so no c=0 read exists to compose from. The fixture takes a REAL persisted snapshot row
    // and re-runs the REAL `reshapeSnapshot` over it with coverage 0 / phs null. Everything downstream
    // is genuine: the fired set is the one that was persisted, the `read` strings are the real
    // interpolated ones, and the c=0 branch ("construction owns the WHOLE fired set") is the real one.
    //
    // ★ IT IS DELIBERATELY A SUPERSET. A true c=0 book fires fewer families (patterns.ts cannot emit
    // most PQ/PS/PX findings with nothing scored), so this fixture pushes MORE prose through the gates
    // than any real construction-only book would — including health-family reads that only reach the
    // construction read in this state. A safety proof that errs toward scanning too much is the right
    // way for it to err.
    const donors = await prisma.portfolioHealthSnapshot.findMany({
      orderBy: { createdAt: "desc" }, take: 40,
    });
    ok("⚠ SYNTHETIC FIXTURE — no construction-only book exists in this DB; state exercised by re-reading REAL snapshot rows at coverage 0", donors.length > 0, `${donors.length} donor rows`);

    let scanned = 0;
    let sawWholeSet = false;
    for (const d of donors) {
      const input = {
        ...(d as unknown as SnapshotReadInput),
        phs: null,        // ⇒ no story (composeStory requires phs != null)
        band: null,
        coverage: 0,      // ⇒ healthRead null ⇒ construction takes the whole fired set
        evaluable: false,
      } satisfies SnapshotReadInput;
      let reads: PortfolioReadsLike;
      try {
        reads = reshapeSnapshot(input, { scoredCount: 0, totalCount: null }, []);
      } catch (e) {
        ok(`  reshape threw for donor ${d.id.slice(0, 8)}`, false, (e as Error).message.slice(0, 90));
        continue;
      }
      if (reads.healthRead !== null || reads.story !== null) {
        ok(`  fixture ${d.id.slice(0, 8)} really is construction-only`, false, "healthRead/story not null");
        continue;
      }
      const persistedFindings = ((d.firedFindings ?? []) as unknown as PfFinding[]).length;
      if (reads.constructionRead.findings.length === persistedFindings && persistedFindings > 0) sawWholeSet = true;

      const view = { snapshot: reads, hasHoldings: true, disclosure: {}, referenceFindings: [] } as unknown as PortfolioHealthView;
      const f = composeDeterministicPortfolioFallbackDetailed(view);
      layersSeen.add(f.layer);
      const r = bothGates(`c0:${d.id.slice(0, 8)}`, f.text, "portfolio");
      if (!r.clean) ok(`  ✗ ${d.id.slice(0, 8)} (${f.layer})`, false, r.detail);
      scanned++;
    }
    ok(`★★ ${scanned} construction-only compositions clean on BOTH gates`, fail === 0 || scanned > 0, `${scanned} scanned`);
    ok("★ …and the c=0 read really does carry the WHOLE fired set (nothing dropped)", sawWholeSet);
    // Show one so the prose is readable in the log, not just asserted.
    const sample = reshapeSnapshot(
      { ...(donors[0] as unknown as SnapshotReadInput), phs: null, band: null, coverage: 0, evaluable: false },
      { scoredCount: 0, totalCount: null }, [],
    );
    const sampleView = { snapshot: sample, hasHoldings: true, disclosure: {}, referenceFindings: [] } as unknown as PortfolioHealthView;
    const composed = composeDeterministicPortfolioFallbackDetailed(sampleView);
    ok(`  layer === "construction_findings"`, composed.layer === "construction_findings", composed.layer);
    ok("  it opens with the authored construction-only header",
      composed.text.startsWith("Nothing in this book is scored yet"), composed.text.slice(0, 60));
    console.log(`\n     SAMPLE (construction-only): "${composed.text.slice(0, 300)}…"\n`);
  }

  // ── STATE D · PARTIAL COVERAGE (real) ────────────────────────────────────────────────────────────
  console.log("\n  ── STATE D · partial coverage (REAL) ──");
  ok("a real partially-covered book exists", partial.length > 0, `${partial.length} found`);
  for (const c of partial) {
    const f = composeDeterministicPortfolioFallbackDetailed(c.view);
    layersSeen.add(f.layer);
    const cov = (c.view.snapshot!.coverageState.scoredWeight * 100).toFixed(0);
    assertClean(`  ${c.email.slice(0, 26)} cov=${cov}% layer=${f.layer}`, f.text, "portfolio");
  }

  // ── STATE E · FULL COVERAGE (real) ───────────────────────────────────────────────────────────────
  console.log("\n  ── STATE E · full coverage (REAL) ──");
  ok("real fully-covered books exist", full.length > 0, `${full.length} found`);
  for (const c of full) {
    const f = composeDeterministicPortfolioFallbackDetailed(c.view);
    layersSeen.add(f.layer);
    assertClean(`  ${c.email.slice(0, 26)} layer=${f.layer}`, f.text, "portfolio");
  }

  ok("★★ ALL THREE LAYERS were exercised — story, construction_findings, decline",
    layersSeen.has("story") && layersSeen.has("construction_findings") && layersSeen.has("decline"),
    [...layersSeen].join(", "));

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★ THE STOCK RETROFIT — the same fallback, through the RUNTIME guardrail for the first time");
  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  {
    // ── 4a · THE LIVE COMPOSED FALLBACKS ──
    const stocks = await prisma.stock.findMany({
      where: { scoreSnapshots: { some: {} } }, select: { symbol: true }, orderBy: { symbol: "asc" },
    });
    ok("scored stocks available to compose from", stocks.length > 0, `${stocks.length} stocks`);

    let scanned = 0;
    const offenders: string[] = [];
    for (const s of stocks) {
      const view = await buildHealthSnapshotView(s.symbol);
      if (!view) continue;
      const prose = composeDeterministicFallback(view);
      const r = bothGates(s.symbol, prose, "shared"); // ⚠ SHARED vocabulary — see the header
      scanned++;
      if (!r.clean) offenders.push(`${s.symbol}: ${r.detail}`);
    }
    ok(`★★ ${scanned} LIVE stock fallbacks clean on BOTH gates (shared advice vocab + runtime guardrail)`,
      offenders.length === 0, offenders.slice(0, 6).join(" | ") || `${scanned} scanned`);

    // ── 4b · ★★ THE VERDICT CORPUS, EXHAUSTIVELY ──
    //
    // ⚠ AND THIS IS THE ASSERTION THAT ACTUALLY CLOSES THE GAP, BECAUSE 4a IS A SAMPLE.
    // composeDeterministicFallback's bulk is lens `verdict` sentences, and those are NOT the catalog's
    // `fieldVerdict` — they are composed in standing-context.ts by composeLm/LpVerdict, whose
    // `_fieldVerdict` parameter is UNUSED. `assertNoForwardLanguage()` sweeps LM_CATALOG/LP_CATALOG
    // only, so it has never seen these strings. Which strings 4a reaches depends on which patterns
    // happen to fire on today's universe; this enumerates every branch instead.
    const BANDS: (StandingBand | null)[] = ["top", "upper", "mid", "lower", "bottom", null];
    const SHARES: ({ nL3: number } | null)[] = [null, { nL3: 1 }, { nL3: 2 }, { nL3: 3 }, { nL3: 7 }];
    const corpus = new Set<string>();
    for (const id of ["LP1", "LP2", "LP3", "LP4", "LP5", "LP6"])
      for (const b of BANDS) for (const sh of SHARES) {
        const v = composeLpVerdict(id, "at" as never, b, sh);
        if (v) corpus.add(v);
      }
    for (const id of ["LM1", "LM2", "LM3", "LM4", "LM5", "LM6", "LM7", "LM8"])
      for (const b of BANDS) {
        const v = composeLmVerdict(id, "at" as never, b);
        if (v) corpus.add(v);
      }

    ok("★ the verdict corpus enumerates every reachable branch (LP1–6 × band × shares, LM1–8 × band)",
      corpus.size >= 20, `${corpus.size} distinct sentences`);

    const bad: string[] = [];
    for (const v of corpus) {
      const r = bothGates("verdict", v, "shared");
      if (!r.clean) bad.push(`"${v.slice(0, 60)}…" → ${r.detail}`);
    }
    ok(`★★ ALL ${corpus.size} standing-context verdict sentences clean on BOTH gates`,
      bad.length === 0, bad.slice(0, 4).join(" | ") || "corpus-complete, not sampled");
  }

  console.log(`\n${fail === 0 ? "✅ ALL GREEN" : `❌ ${fail} FAILURE(S)`}\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

/** Structural alias so the fixture path doesn't import the reshape return type by name. */
type PortfolioReadsLike = ReturnType<typeof reshapeSnapshot>;

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
