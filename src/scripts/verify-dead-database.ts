// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEAD-DATABASE MODE — with the database unreachable, no answer may claim to have checked anything.
//
// ★ WHY THIS EXISTS AND WHAT IT CAUGHT. Every other gate reads SHAPE. `verify-swallowed-absence`
//   scans for a swallowing catch near a record-shaped `absent()`; `tsc` checks types; the invariants
//   read composed answers built from a HEALTHY database. All three were green over
//   `resolveRelationship`, which turned a failed read into `held: false` — rendered to the reader as
//   **"You hold it: no"**, a flat statement about their own position produced by a read that never
//   completed. No pattern gate could have seen it: the swallow fed a DATA FIELD, not an absence.
//
//   It also caught `resolveUniverse`, whose `absent()` sits ELEVEN lines below its catch — outside
//   `verify-swallowed-absence`'s nine-line window, so that gate was green while its allowlist stood
//   at zero. Behaviour finds what shape cannot.
//
// ★ THE PROPERTY, IN ONE LINE. Every absence must be about US. No count, no "we looked and found
//   nothing", no callout asserting a clean result over data never read.
//
// ⚠ A THROW IS NOT A VIOLATION OF THAT PROPERTY. An answer that never gets produced claims nothing.
//   Throws are COUNTED AND PRINTED because they are a real (lesser) defect — the reader gets an error
//   page instead of a sentence — but the assertion here is about false claims, and conflating the two
//   would make the gate fail for a reason it is not testing. §5 pins the resolvers already fixed.
//
// ── HOW THE FAILURE IS INDUCED ────────────────────────────────────────────────────────────────────
// `DATABASE_URL` is pointed at a closed port BEFORE any application import, so the real prisma client
// is built against it and every read fails with a genuine connection error through the real resolver
// path. `src/db/prisma.ts` reads the variable at module load and dotenv does not overwrite one that is
// already set — hence the dynamic imports below, which a static import would hoist above these lines.
//
// A mock that returned absences instead of throwing would test the mock. Nothing is stubbed here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
process.env.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:1/vytal_dead?connect_timeout=1";
process.env.DB_CONNECT_TIMEOUT_MS = "1500";

const { prisma } = await import("../db/prisma.js");
const { absent } = await import("../resolve/contract.js");
const { resolveFund, resolveComparison, resolveScreen, resolveUniverse } = await import("../resolve/blocks-market.js");
const { resolvePortfolio, resolveWatchlist, resolveRelationship, resolveAlerts, resolveReminders } = await import("../resolve/blocks-reader.js");
const { resolvePortfolioValueSeries, resolvePortfolioHealthSeries } = await import("../resolve/blocks-portfolio-series.js");
const S = await import("../resolve/blocks-stock.js");
const { resolveAttribution } = await import("../resolve/attribution.js");
const { resolvePatterns } = await import("../resolve/patterns.js");
const { resolvePeerGroupForStock } = await import("../resolve/peer-group.js");
const { resolveTrajectory } = await import("../resolve/trajectory.js");
const { resolveOwnership, resolvePromoterMovers } = await import("../resolve/ownership.js");
const { composeTurn } = await import("../composition/compose.js");
const { composeReaderAnswer } = await import("../composition/families/reader.js");
const { ANONYMOUS } = await import("../reader/profile.js");

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); }
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

/** The only reasons whose phrase is about us. Every other token completes "this needs …" with
 *  something the RECORD lacks — see §3.1's corollary. */
const HONEST = new Set(["read_failed", "reader_read_failed"]);

/** Sentences that assert a COMPLETED CHECK. Each was observed in a real answer during this build. */
const CLAIMS_A_CHECK = [
  /found nothing notable/i,
  /we checked [a-z ]*your holdings/i,
  /and found nothing/i,
  /nothing (?:was )?flagged/i,
  /checked and clear/i,
  /you hold it["':\s]+no/i,          // resolveRelationship's `held: false` as rendered
  // ⚠ THE GENERIC FALLBACK'S CLOSE. Not a "we checked" sentence but the same lie: a completeness
  //   claim over a read that never ran. It is what a null manifest used to produce.
  /that is everything we hold/i,
];

const U = "00000000-0000-4000-8000-000000000001";
const SYM = "TCS";
type Outcome =
  | { label: string; state: "absent"; reason: string; text: string }
  | { label: string; state: "answer"; text: string }
  | { label: string; state: "threw"; text: string };

const corpus: Outcome[] = [];
async function probe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const r = (await fn()) as { ok?: boolean; kind?: string; absent?: { reason: string } };
    const text = JSON.stringify(r);
    if (r.ok === false && r.absent) corpus.push({ label, state: "absent", reason: r.absent.reason, text });
    else corpus.push({ label, state: "answer", text });
  } catch (e) {
    corpus.push({ label, state: "threw", text: (e as Error).message.split("\n")[0].slice(0, 80) });
  }
}

async function main(): Promise<void> {
  rule("1 · ★ THE DATABASE IS GENUINELY UNREACHABLE — asserted before anything is concluded from it");
  // ⚠ WITHOUT THIS THE WHOLE MODE IS VACUOUS. If DATABASE_URL failed to take effect, every probe below
  //   would run against the LIVE database, every answer would be correct, and this gate would print a
  //   full green page while testing nothing at all. That is the exact shape §3.1 warns about: a check
  //   whose passing condition can be satisfied by the check never happening.
  let reachable = true;
  await prisma.$queryRawUnsafe("SELECT 1").catch(() => { reachable = false; });
  ok("the database really is down (a bare SELECT 1 fails)", !reachable,
     reachable ? "SELECT 1 SUCCEEDED — DATABASE_URL did not take effect; every result below is meaningless"
               : "connection refused, as required");
  if (reachable) { console.log("\n❌ ABORTING — a dead-database run against a live database proves nothing.\n"); process.exit(1); }

  rule("2 · THE CORPUS — every resolver and reader answer reachable without a live subject read");
  await probe("resolveFund", () => resolveFund("X"));
  await probe("resolveComparison", () => resolveComparison("A", "B"));
  await probe("resolveScreen", () => resolveScreen([]));
  await probe("resolveUniverse", () => resolveUniverse());
  await probe("resolvePortfolio", () => resolvePortfolio(U));
  await probe("resolveWatchlist", () => resolveWatchlist(U));
  await probe("resolveRelationship", () => resolveRelationship(U, "TCS"));
  await probe("resolveAlerts", () => resolveAlerts(U));
  await probe("resolveReminders", () => resolveReminders(U));
  await probe("resolvePortfolioValueSeries", () => resolvePortfolioValueSeries(U));
  await probe("resolvePortfolioHealthSeries", () => resolvePortfolioHealthSeries(U));
  await probe("resolvePromoterMovers", () => resolvePromoterMovers());

  // ── THE MARKET SIDE ─────────────────────────────────────────────────────────────────────────────
  // Added after the first run of this gate: all of it threw. `resolveStockCoverage` is the shared
  // envelope for seven resolvers in blocks-stock (via `envelopeFor`) and seven composition families
  // that call it directly — 24 call sites, 3 guarded — so one unguarded query took the entire market
  // side down. Measured 18 of 18 throwing before the fix; every one is in the corpus now.
  await probe("resolvePrice", () => S.resolvePrice(SYM));
  await probe("resolveQuarterSeries", () => S.resolveQuarterSeries(SYM));
  await probe("resolveCorporateEvents", () => S.resolveCorporateEvents(SYM));
  await probe("resolveOwnershipEvents", () => S.resolveOwnershipEvents(SYM));
  await probe("resolveOwnershipSeries", () => S.resolveOwnershipSeries(SYM));
  await probe("resolvePeers", () => S.resolvePeers(SYM));
  await probe("resolveNews", () => S.resolveNews(SYM));
  await probe("resolveAttribution", () => resolveAttribution(SYM));
  await probe("resolveOwnership", () => resolveOwnership(SYM, "register"));
  await probe("resolvePatterns", () => resolvePatterns(SYM));
  await probe("resolvePeerGroupForStock", () => resolvePeerGroupForStock(SYM));
  await probe("resolveTrajectory", () => resolveTrajectory(SYM));

  // The compositions end to end. The subject is pre-resolved because subject resolution needs the
  // database — so these exercise the composer's own paths: the family loop, the planner's manifest,
  // and the generic fallback whose close is "That is everything we hold on X today."
  const stockSubject = {
    kind: "stock" as const, symbol: SYM, name: "Tata Consultancy Services Ltd",
    coverage: { kind: "stock", symbol: SYM, tier: null, tierLabel: null, asOf: null, quarters: null, snapshots: null },
  };
  const stockTurn = (raw: string, operation: string, lens: string | null) =>
    ({
      raw,
      router: {
        scope: "in_scope", subjects: [{ text: SYM }], operation, lens,
        timeframe: null, confidence: "high", perspective: "market", action: null,
      },
      subjects: [stockSubject], resolvedSymbols: [SYM], subjectChoices: [],
      needsSubjectChoice: false, corrections: [], context: {},
    }) as never;
  for (const [label, raw, op, lens] of [
    ["compose · orient", "how is TCS doing", "orient", "health"],
    ["compose · decompose", "why is TCS scored that way", "decompose", "health"],
    ["compose · history", "how has TCS changed", "history", "health"],
    ["compose · list_findings", "what is flagged for TCS", "list_findings", "health"],
    ["compose · ownership", "who owns TCS", "orient", "ownership"],
    ["compose · fundamentals", "what are TCS margins", "orient", "fundamentals"],
  ] as const) {
    await probe(label, () => composeTurn(stockTurn(raw, op, lens), null));
  }

  // The composition layer, where the swallow becomes a SENTENCE. The subject is synthetic because
  // subject resolution needs the database — that is the point: it supplies a reader who demonstrably
  // HAS positions, so any "your book is empty" or "we checked and found nothing" is unambiguously false.
  const subject = (holdings: number) => ({
    kind: "reader" as const, userId: U,
    coverage: { kind: "reader" as const, asOf: null, holdings, holdingsScored: holdings },
  });
  const ctx = (raw: string) =>
    ({ turn: { raw, subjects: [], resolvedSymbols: [] }, symbol: null, reader: { userId: U } }) as never;
  for (const [label, raw] of [
    ["reader · portfolio", "how is my portfolio doing"],
    ["reader · watchlist", "what is on my watchlist"],
    ["reader · alerts", "what alerts do i have"],
    ["reader · memory", "what do you know about me"],
  ] as const) {
    await probe(label, () => composeReaderAnswer(subject(5), ctx(raw), ANONYMOUS));
  }

  const produced = corpus.filter((c) => c.state !== "threw");
  const threw = corpus.filter((c) => c.state === "threw");
  for (const c of corpus) {
    const tag = c.state === "absent" ? `absent(${c.reason})` : c.state === "answer" ? "answered" : "threw";
    console.log(`     ${tag.padEnd(30)} ${c.label}`);
  }

  rule("3 · ★ THE CORPUS IS NON-EMPTY — a dead-database run over zero answers passes trivially");
  // Gate 1's lesson, and the one most likely to repeat here: everything below quantifies over
  // `produced`, and every such assertion is vacuously true when `produced` is empty.
  ok("at least 25 answers were actually produced with the database down", produced.length >= 25,
     `${produced.length} produced · ${threw.length} threw · ${corpus.length} probed`);

  rule("4 · ★ NO PRODUCED ANSWER CLAIMS TO HAVE CHECKED ANYTHING");
  const claiming = produced.filter((c) => CLAIMS_A_CHECK.some((re) => re.test(c.text)));
  ok("no answer asserts a completed check over data never read", claiming.length === 0,
     claiming.map((c) => `${c.label}: ${CLAIMS_A_CHECK.find((re) => re.test(c.text))}`).join(" · ")
       || `${produced.length} answers scanned for ${CLAIMS_A_CHECK.length} claim shapes`);

  const absences = produced.filter((c): c is Extract<Outcome, { state: "absent" }> => c.state === "absent");
  const dishonest = absences.filter((c) => !HONEST.has(c.reason));
  ok("every absence names OUR failure, not the record's silence", dishonest.length === 0,
     dishonest.map((c) => `${c.label} -> ${c.reason}`).join(" · ")
       || `${absences.length} absences, all read_failed / reader_read_failed`);

  // ⚠ AND THE MARKET ANSWERS ARE ASSERTED POSITIVELY, NOT JUST FOR THE ABSENCE OF A BAD SENTENCE.
  //   "No forbidden phrase" is satisfied by an empty answer, by a crash-shaped stub, and by silence.
   //   What a reader needs is the sentence that IS there, so it is named.
  const market = produced.filter((c) => c.label.startsWith("compose · "));
  const spoken = market.filter((c) => /could not read what we hold/i.test(c.text));
  ok("every market composition SAYS the read failed, in words",
     market.length === 6 && spoken.length === 6,
     `${spoken.length}/${market.length} carry the sentence`);

  rule("5 · THE RESOLVERS THIS BUILD GUARDED RETURN AN ABSENCE RATHER THAN THROWING");
  // Pins the fixes rather than the general property: these are the ones whose throw was removed, and
  // a regression here is silent otherwise because §4 cannot see an answer that was never produced.
  const MUST_ANSWER = [
    "resolveFund", "resolveComparison", "resolveScreen", "resolveUniverse", "resolvePortfolio",
    "resolveWatchlist", "resolveRelationship", "resolveAlerts", "resolveReminders",
    "resolvePortfolioValueSeries", "resolvePortfolioHealthSeries", "resolvePromoterMovers",
    "resolvePrice", "resolveQuarterSeries", "resolveCorporateEvents", "resolveOwnershipEvents",
    "resolveOwnershipSeries", "resolvePeers", "resolveNews", "resolveAttribution",
    "resolveOwnership", "resolvePatterns", "resolvePeerGroupForStock", "resolveTrajectory",
    "compose · orient", "compose · decompose", "compose · history", "compose · list_findings",
    "compose · ownership", "compose · fundamentals",
  ];
  const regressed = MUST_ANSWER.filter((n) => corpus.find((c) => c.label === n)?.state === "threw");
  ok("every guarded resolver degrades to an absence with the database down", regressed.length === 0,
     regressed.join(", ") || `${MUST_ANSWER.length} resolvers, none threw`);
  if (threw.length) {
    console.log(`\n     ⚠ ${threw.length} probe(s) still throw — reported, not asserted (a throw claims nothing):`);
    for (const t of threw) console.log(`        ${t.label} — ${t.text}`);
  }

  rule("6 · NEGATIVE CONTROLS — the mode is proven to go red");
  // ⚠ A REAL SWALLOW, REINTRODUCED. Not a fabricated string: this runs the defect's exact shape
  //   against the same dead database and feeds the result to the same checker §4 uses. A control that
  //   asserts over a hand-written literal tests the literal.
  const swallowed = await (async () => {
    const rows = await prisma.$queryRawUnsafe<unknown[]>("SELECT 1").catch(() => [] as unknown[]);
    return rows.length === 0 ? absent("not_ingested", { subject: null, query: null }) : null;
  })();
  const swallowedText = JSON.stringify(swallowed);
  ok("a reintroduced swallowed throw IS caught by the absence check",
    swallowed !== null && !HONEST.has((swallowed as { absent: { reason: string } }).absent.reason),
    `absent("${(swallowed as { absent: { reason: string } }).absent.reason}") — record-shaped, from a read that failed`);
  ok("…and the claim scanner fires on the sentence the old relationship read produced",
    CLAIMS_A_CHECK.some((re) => re.test('{"held":false,"line":"You hold it: no"}')),
    "\"You hold it: no\" is rejected");
  ok("…and does NOT fire on an honest absence",
    !CLAIMS_A_CHECK.some((re) => re.test(swallowedText))
      && !CLAIMS_A_CHECK.some((re) => re.test('{"reason":"reader_read_failed","phrase":"a read of your own records that did not complete"}')),
    "an absence is not a claim");

  console.log(`\n${fail === 0 ? "✅ DEAD-DATABASE MODE PASSES" : `❌ ${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect().catch(() => {});
  process.exit(fail === 0 ? 0 : 1);
}

await main();
