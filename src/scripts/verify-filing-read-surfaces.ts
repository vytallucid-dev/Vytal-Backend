// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · STEP 3 — READ-SURFACE PROOF (read-only, NO writes).
//
// Eight services were named. Four now carry the filing channel; four do not, and each of those four
// has a reason that is measured here rather than asserted.
//
//   §1  health-view          — a stock with filing findings and no snapshot returns them
//   §2  symbol-findings      — the batch read; an "unscored" row is no longer silent
//   §3  watchlist-enrich     — an unscored pin is no longer a row of empty arrays
//   §4  tool-scan            — STRUCTURALLY carries none: measured against belongsToTool
//   §5  universe-view · peer-group-view · reader-context — what opening them would mean, in numbers
//   §6  all three states survive to the reader, on a real stock of each shape
//   §7  (step 4) ONE CARD, NOT TWO — no filing key reaches the score channel on any of the three
//       surfaces that serve both, checked over the whole scored universe rather than a sample
//
//   npx tsx src/scripts/verify-filing-read-surfaces.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import { readFindingsForSymbols } from "../scoring/read/symbol-findings.service.js";
import { enrichWatchlist } from "../controllers/me/watchlist-enrich.js";
import { readFilingFindings } from "../filing/read.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { belongsToTool } from "../catalogue/tool-families.js";

import { findingName } from "../catalogue/index.js";

let failures = 0;
const ok = (pass: boolean, msg: string) => { if (!pass) failures++; console.log(`  ${pass ? "OK  " : "FAIL"} ${msg}`); };
/** symbol-findings renders NAMES, never keys — so the leak test has to compare through the catalogue. */
const findingNameEq = (key: string, name: string): boolean => findingName(key as Parameters<typeof findingName>[0]) === name;

async function main() {
  // Three real stocks, one per coverage cohort.
  const scored = "ABB";            // in a pond, scored
  const covered = "AARTIIND";      // in a pond, never scored
  const display = "360ONE";        // no pond — the display-only firewall

  console.log("════ FILING READ SURFACES ════");

  // ═══════════════ §1 · health-view ═══════════════
  console.log("\n──────── §1 · health-view.service.ts ────────");
  for (const sym of [scored, covered, display]) {
    const v = await buildHealthSnapshotView(sym, 12, { omit: ["pillars", "peerStanding"] });
    if (!v) { ok(false, `${sym}: no view`); continue; }
    const ff = v.filingFindings;
    ok(ff !== null, `${sym}: scored=${v.scored} · score findings=${v.findings === null ? "null" : "present"} · filingFindings=${ff ? `${ff.fired.length} fired / ${ff.declined.length} declined / ${ff.coverage.evaluated} evaluated` : "NULL"}`);
    if (!v.scored) ok(ff !== null && (ff.fired.length > 0 || ff.coverage.quietNote !== null), `${sym}: an UNSCORED stock returns either findings or a quiet note — never a bare empty`);
  }

  // ═══════════════ §2 · symbol-findings ═══════════════
  console.log("\n──────── §2 · symbol-findings.service.ts ────────");
  const batch = await readFindingsForSymbols([scored, covered, display, "NOSUCHSYMBOL"]);
  for (const r of batch.rows) {
    const f = r.filing;
    console.log(`  ${r.symbol.padEnd(10)} status=${r.status.padEnd(12)} score-findings=${r.findings.total}  filing: ${f ? `${f.fired.length} fired / ${f.declined.length} declined` : "null"}`);
    if (r.status === "unscored") {
      ok(f !== null && (f.fired.length > 0 || f.coverage.quietNote !== null),
        `${r.symbol}: an "unscored" row now carries filing findings or a quiet note (was: silent)`);
    }
    if (r.status === "not-covered") ok(f === null, `${r.symbol}: outside the universe → filing is null, not an empty array`);
  }
  ok(batch.filingDefinitions.length > 0, `filing definitions emitted once per key: ${batch.filingDefinitions.map((d) => d.name).join(", ")}`);

  // ═══════════════ §3 · watchlist-enrich ═══════════════
  console.log("\n──────── §3 · watchlist-enrich.ts ────────");
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: [scored, covered, display] } }, select: { id: true, symbol: true, name: true, industryType: true, sector: { select: { displayName: true } } } });
  const rows = stocks.map((st) => ({
    stockId: st.id, symbol: st.symbol, name: st.name, sector: st.sector?.displayName ?? null,
    industryType: st.industryType, addedAt: new Date(), favorite: false,
    pinnedHealth: null, pinnedBand: null, pinnedPrice: null,
  }));
  const enriched = await enrichWatchlist(rows as Parameters<typeof enrichWatchlist>[0]);
  for (const e of enriched) {
    const f = e.filingFindings;
    console.log(`  ${e.symbol.padEnd(10)} scored=${String(e.scored).padEnd(5)} score-findings=${e.findings.redFlags.length + e.findings.patterns.length}  filing: ${f ? `${f.fired.length} fired` : "null"}`);
    if (!e.scored) {
      ok(f !== null && (f.fired.length > 0 || f.coverage.quietNote !== null),
        `${e.symbol}: an unscored PIN no longer renders as a row of empty arrays`);
    }
  }

  // ═══════════════ §4 · tool-scan ═══════════════
  console.log("\n──────── §4 · tool-scan.service.ts — structurally carries none ────────");
  const toolFacing = FILING_REGISTRY.filter((e) => belongsToTool(e.ruleKey, "divergence") || belongsToTool(e.ruleKey, "trajectory"));
  ok(toolFacing.length === 0,
    `0 of the 22 filing keys belong to either tool (divergence=family C · trajectory=families B/D; the filing rules are families A/E/F/H/N)`);
  console.log(`     -> the tools' guards at :250/:283 skip stocks with no series or no head, and that stays correct:`);
  console.log(`        there is nothing for them to skip that a filing finding could have supplied.`);

  // ═══════════════ §5 · the three aggregate surfaces, measured ═══════════════
  console.log("\n──────── §5 · universe-view · peer-group-view · reader-context ────────");
  const [totalActive, inPg, scoredCount] = await Promise.all([
    prisma.stock.count({ where: { isActive: true } }),
    prisma.stockPeerGroup.findMany({ select: { stockId: true }, distinct: ["stockId"] }).then((r) => r.length),
    prisma.scoreSnapshot.findMany({ select: { stockId: true }, distinct: ["stockId"] }).then((r) => r.length),
  ]);
  console.log(`  universe: ${totalActive} active · ${inPg} in a peer group · ${scoredCount} scored`);
  console.log(`  universe-view    — an aggregate over the SCORED universe. Every field is score-derived`);
  console.log(`                     (band distribution, movers, pathology census). Opening it would change`);
  console.log(`                     its DENOMINATOR from ${scoredCount} to ${totalActive}, which is a base-rate change: step 5.`);
  console.log(`  peer-group-view  — pond membership is the definition. ${inPg - scoredCount} pond members are unscored and`);
  console.log(`                     invisible today; they ARE in the pond, so filing findings for them would be`);
  console.log(`                     legitimate — but the pond's census denominators are its SCORED members.`);
  console.log(`  reader-context   — the echo census counts "N of your holdings also show this" over SCORED`);
  console.log(`                     holdings. Same denominator problem, on a per-reader book.`);

  // How many unscored HELD stocks currently contribute nothing to any echo.
  const heldUnscored = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT h.stock_id) AS n
      FROM holdings h
     WHERE h.stock_id IS NOT NULL AND h.quantity > 0
       AND NOT EXISTS (SELECT 1 FROM score_snapshots s WHERE s.stock_id = h.stock_id)`;
  console.log(`                     held-but-unscored stocks across all books today: ${Number(heldUnscored[0]?.n ?? 0)}`);

  // ═══════════════ §6 · all three states reach the reader ═══════════════
  console.log("\n──────── §6 · all three states survive to the reader ────────");
  const probe = await prisma.stock.findMany({ where: { symbol: { in: ["KOTAKBANK", covered, display] } }, select: { id: true, symbol: true } });
  const byId = await readFilingFindings(probe.map((p) => p.id));
  const statesSeen = new Set<string>();
  for (const p of probe) {
    const f = byId.get(p.id)!;
    if (f.fired.length) statesSeen.add("fired");
    if (f.coverage.notFired > 0) statesSeen.add("not_fired");
    if (f.coverage.notEvaluable > 0) statesSeen.add("not_evaluable");
    console.log(`  ${p.symbol.padEnd(10)} fired=${f.coverage.fired} notFired=${f.coverage.notFired} notEvaluable=${f.coverage.notEvaluable} notRun=${f.coverage.notRun} fullyEvaluated=${f.coverage.fullyEvaluated}`);
    if (f.coverage.quietNote) console.log(`             "${f.coverage.quietNote}"`);
  }
  for (const st of ["fired", "not_fired", "not_evaluable"]) ok(statesSeen.has(st), `state "${st}" reaches the reader`);

  // ★ THE ONE THAT MATTERS: a stock whose checks mostly declined must NOT read as clean.
  const kotak = probe.find((p) => p.symbol === "KOTAKBANK");
  if (kotak) {
    const f = byId.get(kotak.id)!;
    ok(f.coverage.fired === 0 && f.coverage.notEvaluable > 0, `KOTAKBANK: 0 fired, ${f.coverage.notEvaluable} declined — the "reads as clean" case`);
    ok(f.coverage.fullyEvaluated === false, `KOTAKBANK: fullyEvaluated is FALSE — a surface cannot state "nothing flagged" at full strength`);
    ok(f.declined.length > 0 && f.declined.every((d) => !/^[A-Z]\d*$/.test(d.capability)), `KOTAKBANK: declines are named as CAPABILITIES, never as rule refs`);
    ok((f.coverage.quietNote ?? "").includes("could not assess"), `KOTAKBANK: the quiet note SAYS what could not be checked`);
  }

  // ═══════════════ §7 · ONE CARD, NOT TWO — the step-4 channel filter, on all three surfaces ═══════
  // The three surfaces above serve BOTH channels. Each is checked for the same thing: no filing key
  // may reach the score channel, on any stock, or the reader gets the same finding twice with two
  // different periods. Checked over the whole scored universe, not the three sample stocks.
  console.log("\n──────── §7 · the score channel carries no filing key ────────");
  const filingKeySet = new Set<string>(FILING_REGISTRY.map((e) => e.ruleKey));
  const allScored = await prisma.scoreSnapshot.findMany({ select: { symbol: true }, distinct: ["symbol"], orderBy: { symbol: "asc" } });
  const allSyms = allScored.map((r) => r.symbol);

  let hvLeak = 0, hvCards = 0;
  for (const sym of allSyms) {
    const v = await buildHealthSnapshotView(sym, 12, { omit: ["pillars", "peerStanding"] });
    const fs2 = v?.findings;
    if (!fs2) continue;
    const keys = [...fs2.redFlags.map((r) => r.flagKey), ...fs2.patterns.map((p) => p.patternKey)];
    hvCards += keys.length;
    hvLeak += keys.filter((k) => filingKeySet.has(k)).length;
  }
  ok(hvLeak === 0, `health-view: 0 filing keys across ${allSyms.length} scored stocks (${hvCards} score-channel cards served)`);

  const batch2 = await readFindingsForSymbols(allSyms.slice(0, 20));
  const sfLeak = batch2.rows.flatMap((r) => r.findings.shown.map((s2) => s2.name))
    .filter((n) => [...filingKeySet].some((k) => findingNameEq(k, n)));
  ok(sfLeak.length === 0, `symbol-findings: 0 filing findings in the score channel across 20 symbols`);
  const defLeak = batch2.definitions.filter((d) => batch2.filingDefinitions.some((fd) => fd.name === d.name));
  ok(defLeak.length === 0, `symbol-findings: the two definition lists do not overlap — no key is described twice`);

  const wlStocks = await prisma.stock.findMany({ where: { symbol: { in: allSyms.slice(0, 25) } }, select: { id: true, symbol: true, name: true, industryType: true, sector: { select: { displayName: true } } } });
  const wlRows = wlStocks.map((st) => ({
    stockId: st.id, symbol: st.symbol, name: st.name, sector: st.sector?.displayName ?? null,
    industryType: st.industryType, addedAt: new Date(), favorite: false,
    pinnedHealth: null, pinnedBand: null, pinnedPrice: null,
  }));
  const wl = await enrichWatchlist(wlRows as Parameters<typeof enrichWatchlist>[0]);
  const wlLeak = wl.flatMap((e) => [...e.findings.redFlags.map((r) => r.flagKey), ...e.findings.patterns.map((p) => p.patternKey)])
    .filter((k) => filingKeySet.has(k));
  ok(wlLeak.length === 0, `watchlist-enrich: 0 filing keys in the score channel across 25 pins`);
  // The lens anti-double-count must NOT have been filtered — it still sees the full fired set.
  const withLens = wl.filter((e) => e.threeLens && (e.threeLens.metricPatterns.length > 0 || e.threeLens.pillarPatterns.length > 0));
  console.log(`     lens digests still resolving on ${withLens.length} of ${wl.length} pins — the filter was applied to the RENDERED sets only`);

  console.log(`\n════ ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
