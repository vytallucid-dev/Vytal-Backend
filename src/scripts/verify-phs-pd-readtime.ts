// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 10a BATCH 2 — THE PD FAMILY. PROVEN, NOT REVIEWED.
//
// ⚠ WHY EVERY FIXTURE HERE IS SYNTHETIC. The live cohort holds 18 stocks and 2 mutual funds: ZERO bonds,
// gsecs, sgbs, reits, invits and stale accounts. SIX OF THE SEVEN PD FINDINGS CANNOT FIRE AGAINST IT.
// A guard written against that cohort would read as coverage and never execute — this project has already
// shipped six of those and caught them by measurement, not review. So every finding below is fired on a
// book built to fire it, and the negative cases are proven too.
//
// WHAT THIS ASSERTS:
//   1. Each of PD1–PD7 FIRES on a book that should fire it, and is SILENT on one that shouldn't.
//   2. ★ The six reasons produce THREE SENTENCE SHAPES and never collapse — `discount_instrument` and
//      `no_distributions_in_window` never render as "unavailable"/"missing"/"we don't have".
//   3. ★ PD1 fires on ANY bond and is STRUCTURALLY outside triage — the sort never sees it.
//   4. PD → reference only: NO PD finding carries a `storyClause`, ever.
//   5. Every PD `doesntMean` is present and classified.
//   6. Advice-verb grep = 0 across every PD `read`.
//   7. The taxonomy is EXHAUSTIVE against the ingestion guards — a seventh reason fails the build.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-phs-pd-readtime.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { globSync } from "fs";
import { fireDisclosureFindings, fireReadTimeFindings, type DisclosureInput } from "../portfolio/phs/read-time-findings.js";
import type { HeldInstrumentFacts, HeldFundAnalytics } from "../portfolio/phs/read-time-catalog.js";
import { READ_TIME_COPY, READ_TIME_IDS } from "../portfolio/phs/copy.js";
import { NULL_REASON, describeNull, classifyNullReason, OMISSION_CLASS, OMISSION_UNCLASSIFIED, type NullReason } from "../portfolio/null-reasons.js";
import { OmissionCode } from "../ingestions/amfi/mf-omissions.js";
import { reshapeSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";
import { scanStringsForForwardLanguage, PORTFOLIO_ADVICE_DENY_LIST } from "../scoring/lens-patterns/no-forward-guard.js";
import * as K from "../portfolio/phs/constants.js";
import type { HeldNotValued, StaleAccount } from "../portfolio/phs/assemble.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

// ── Fixture builders ────────────────────────────────────────────────────────────────────────────
const F = (isin: string, assetClass: string, attributes: Record<string, unknown>, name = `${assetClass.toUpperCase()} ${isin}`, category: string | null = null): HeldInstrumentFacts =>
  // (batch 3) The PI columns default to the shape a NON-fund carries: active, no plan, no price/NAV pair.
  // PD never reads them; they are here because the loader now selects them off the same row. PI's own
  // fixtures (verify-phs-pi-readtime.ts) override them.
  ({ isin, name, assetClass, category, attributes,
     isActive: true, planType: null, amfiSchemeCode: null,
     lastPrice: null, lastPriceDate: null, currentNav: null, navDate: null });

/**
 * A bond exactly as `bond-guards.ts` stamps it — and "exactly" is measured, not assumed. This is the MODAL
 * live bond: rating null + `not_sourceable` (356/356), no exact maturity date (354/356), but a
 * `maturityYear` parsed off the name (124/356). ★ 122 real bonds have the YEAR AND NOT THE DATE, and the
 * first version of this fixture carried neither — so the two-resolution case that ruling ④ exists for
 * could not fire in any test. A fixture that omits the field under test answers a question nobody asked.
 */
const BOND = (isin: string, over: Record<string, unknown> = {}) =>
  F(isin, "bond", {
    issuer: "NTPC Limited",
    issuerNullReason: null,
    coupon: 8.89,
    couponNullReason: null,
    maturityYear: 2028, // parsed from the name — the 124/356 case
    maturityDate: null, // the exact date — the 354/356 case
    maturityDateNullReason: "not_in_source",
    creditRating: null,
    creditRatingNullReason: "not_sourceable",
    yieldToMaturity: null,
    yieldNullReason: "not_sourceable",
    ...over,
  });

/** A T-BILL as `govt-guards.ts` stamps it — the `discount_instrument` case. */
const TBILL = (isin: string) =>
  F(isin, "gsec", {
    coupon: null,
    couponNullReason: "discount_instrument",
    maturityDate: null,
    maturityDateNullReason: "not_in_source",
    yieldToMaturity: null,
    yieldNullReason: "not_sourceable",
  }, "182 DAY T-BILL");

const FUND = (isin: string, category = "Open Ended Schemes(Equity Scheme - Large Cap Fund)") =>
  F(isin, "mutual_fund", {}, `Some Large Cap Fund`, category);
const GOLD = (isin: string) => F(isin, "etf", {}, "Gold ETF", "Open Ended Schemes(Other Scheme - Gold ETF)");

const HNV = (symbol: string, over: Partial<HeldNotValued> = {}): HeldNotValued => ({
  symbol, accountId: "a1", accountName: "Zerodha", source: "broker", quantity: "10",
  brokerCurrentValue: "270", stale: false, lastSyncedAt: null, unpricedReason: "no_instrument", ...over,
});
const STALE = (over: Partial<StaleAccount> = {}): StaleAccount => ({
  accountId: "a1", accountName: "Zerodha", broker: "zerodha", lastSyncedAt: "2026-07-05", ageDays: 12, positions: 4, ...over,
});
const HIST = (isin: string, navPoints: number, windowFrom = "2026-01-01", windowTo = "2026-07-16"): HeldFundAnalytics =>
  // (batch 3) `HeldFundHistory` widened to `HeldFundAnalytics` — one mf_analytics row, one load, two
  // families reading different halves of it. PD6 reads navPoints/window*; every PI field below is null
  // here because PD6 does not read them and a fixture must not imply otherwise.
  ({ isin, schemeCode: `SC${isin}`, navPoints, windowFrom, windowTo,
     asOfDate: windowTo, seriesSchemeCode: `SC${isin}`,
     maxDrawdown1y: null, maxDrawdown3y: null, maxDrawdown5y: null,
     trackingError1y: null, benchmarkIndex: null, benchmarkVia: null,
     rank1y: null, rank3y: null, rank5y: null,
     rankPool1y: null, rankPool3y: null, rankPool5y: null,
     rankBucket: null, rankBucketSize: null, omissions: null });

const EMPTY: DisclosureInput = { heldNotValued: [], staleAccounts: [], oldestSyncAgeDays: null, facts: [], history: [] };
const fire = (over: Partial<DisclosureInput> = {}) => fireDisclosureFindings({ ...EMPTY, ...over });
const ids = (fs: ReturnType<typeof fire>) => fs.map((f) => f.id).sort();
const get = (fs: ReturnType<typeof fire>, id: string) => fs.find((f) => f.id === id);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · EVERY PD FIRES — on a book built to fire it (the live cohort cannot)");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const all = fire({
    facts: [BOND("INE733E07JU4"), TBILL("IN002024X026"), FUND("INF204K01XI3")],
    heldNotValued: [HNV("FAKESTOCK")],
    staleAccounts: [STALE()],
    oldestSyncAgeDays: 12,
    history: [HIST("INF204K01XI3", 40)],
  });
  ok("all seven fire on the everything-book", ids(all).join(",") === "PD1,PD2,PD3,PD4,PD5,PD6,PD7", ids(all).join(","));
  for (const f of all) console.log(`       ${f.id} · ${f.label} — ${f.read}`);

  ok("empty book fires nothing", fire().length === 0, `${fire().length} fired`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · EACH PD IS SILENT WHERE IT SHOULD BE — the negative half");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const stocksOnly = fire({ facts: [F("INE002A01018", "stock", {})] });
  ok("a stock-only book fires NO PD", stocksOnly.length === 0, ids(stocksOnly).join(",") || "(none)");

  const gsecOnly = fire({ facts: [TBILL("IN002024X026")] });
  ok("PD1 does NOT fire without a bond (a T-bill is not a corporate bond)", !get(gsecOnly, "PD1"));
  ok("PD2 DOES fire on a gsec — YTM is missing for all debt, not just bonds", !!get(gsecOnly, "PD2"));

  const goldOnly = fire({ facts: [GOLD("INF204KB14I2")] });
  ok("PD5 does NOT fire on a gold ETF — it holds gold; there is nothing to see inside", !get(goldOnly, "PD5"),
    "nature=commodity, not basket");
  ok("PD5 DOES fire on a mutual fund", !!get(fire({ facts: [FUND("INF204K01XI3")] }), "PD5"));

  const fatHistory = fire({ facts: [FUND("INF204K01XI3")], history: [HIST("INF204K01XI3", K.PD_THIN_HISTORY_POINTS)] });
  ok(`PD6 silent at exactly ${K.PD_THIN_HISTORY_POINTS} points (the cut is < , not ≤)`, !get(fatHistory, "PD6"));
  const thinHistory = fire({ facts: [FUND("INF204K01XI3")], history: [HIST("INF204K01XI3", K.PD_THIN_HISTORY_POINTS - 1)] });
  ok(`PD6 fires at ${K.PD_THIN_HISTORY_POINTS - 1}`, !!get(thinHistory, "PD6"));

  ok("PD7 silent with no stale account", !get(fire({ facts: [BOND("INE733E07JU4")] }), "PD7"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · ★ THE SIX REASONS → THREE SHAPES. NEVER ONE BUCKET.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const REASONS = Object.keys(NULL_REASON) as NullReason[];
  ok("the taxonomy carries SIX reasons (doc 2's table names three)", REASONS.length === 6, REASONS.join(", "));

  const byClass = new Map<string, string[]>();
  for (const r of REASONS) {
    const cls = NULL_REASON[r].cls;
    byClass.set(cls, [...(byClass.get(cls) ?? []), r]);
  }
  ok("three classes", byClass.size === 3, [...byClass].map(([c, rs]) => `${c}=${rs.length}`).join(" · "));
  for (const [cls, rs] of byClass) console.log(`       ${cls.padEnd(10)} ${rs.join(", ")}`);

  // ★ THE CENTRAL ASSERTION OF THIS FILE. `discount_instrument` is `not_a_gap`: a T-bill HAS no coupon.
  // Render it in the vocabulary of absence and we tell a user we are missing a number that does not exist.
  //
  // ⚠ THIS GATE IS BLUNT ON PURPOSE, AND IT ALREADY EARNED IT. A first draft of the
  // `no_distributions_in_window` sentence read "…rather than one we are MISSING" and tripped this on a
  // word inside a clause that DENIED missingness. That has the exact shape of the false positive Stage 9
  // ruled against ("a gate that mislabels correct copy trains people to edit until it shuts up") — so the
  // reflex was to loosen it. Wrong: the rule for `not_a_gap` is stronger than "do not ASSERT absence", it
  // is DO NOT RAISE ABSENCE AT ALL, EVEN TO DENY IT, because a sentence arguing with a gap has already
  // planted one. `discount_instrument` passed on the first draft by simply saying what the instrument
  // does — which proved the positive form existed and the copy, not the gate, was the weaker half.
  const ABSENCE = ["unavailable", "missing", "we do not have", "we don't have", "not available", "no data", "we lack", "we could not", "we cannot"];
  for (const r of REASONS) {
    const d = describeNull("a coupon", r)!;
    const bad = ABSENCE.filter((w) => d.sentence.toLowerCase().includes(w));
    if (NULL_REASON[r].cls === "not_a_gap") {
      ok(`★ ${r} → NOT the vocabulary of absence`, bad.length === 0, `"${d.sentence}"${bad.length ? ` ← ${bad.join("/")}` : ""}`);
    } else {
      console.log(`       ${r.padEnd(28)} ${d.cls.padEnd(10)} "${d.sentence}"`);
    }
  }

  const sentences = REASONS.map((r) => describeNull("a coupon", r)!.sentence);
  ok("all six sentences are DISTINCT — nothing collapses", new Set(sentences).size === 6, `${new Set(sentences).size}/6 unique`);

  ok("an UNKNOWN reason is omitted, never bucketed", describeNull("a coupon", "some_new_reason_2027") === null && classifyNullReason(null) === null,
    "degrade by omission, never by mislabel");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("4 · ★ PD3 DOES NOT INHERIT `disclosuresFor`'s BLIND SPOT — a T-bill pays no coupon");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const tbillOnly = fire({ facts: [TBILL("IN002024X026")] });
  ok("★ PD3 does NOT fire on a T-bill-only book — there is no untracked coupon income", !get(tbillOnly, "PD3"),
    "disclosuresFor('gsec') says coupon_income_not_tracked; attributes say discount_instrument");

  const mixed = fire({ facts: [BOND("INE733E07JU4"), TBILL("IN002024X026")] });
  const pd3 = get(mixed, "PD3")!;
  ok("PD3 counts only the coupon-payer in a mixed book", (pd3.bind.holdingCount as number) === 1, `holdingCount=${pd3.bind.holdingCount}`);
  ok("PD3 BINDS the excluded T-bill with its reason", ((pd3.bind.excludedDiscountInstruments as unknown[]) ?? []).length === 1,
    JSON.stringify(pd3.bind.excludedDiscountInstruments));
  ok("PD3 reuses the Step 20 disclosure code, not a private copy", pd3.bind.disclosureCode === "coupon_income_not_tracked");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("5 · ★ PD1 IS MANDATORY AND STRUCTURALLY OUTSIDE TRIAGE — the sort never sees it");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  for (const n of [1, 2, 5]) {
    const facts = Array.from({ length: n }, (_, i) => BOND(`INE733E07J${i}4`));
    ok(`PD1 fires on a book with ${n} bond${n === 1 ? "" : "s"} — no threshold, no condition`, !!get(fire({ facts }), "PD1"));
  }

  // ★ THE NEGATIVE ASSERTION THE RULING ASKED FOR: TRY TO GET PD1 THROUGH THE PRODUCTION ROUTER, FAIL.
  //
  // The FIRST version of this test asserted that a smuggled PD1 was SILENTLY MIS-ROUTED INTO THE HEALTH
  // READ — it passed, and it was documenting a hazard rather than preventing one: "we can't rate your
  // bonds" rendered as a judgment about the book. The router is exhaustive now (FINDING_HOME), so the same
  // smuggle THROWS. The test is the same experiment; the system's answer to it changed.
  const pd1 = get(fire({ facts: [BOND("INE733E07JU4")] }), "PD1")!;
  const smuggle = () =>
    reshapeSnapshot(
      {
        id: "s1", totalValue: "100000", coverage: 1, recognizedUnscoredValue: "0", smallUnscoredValue: "0",
        structure: 50, quality: 70, signals: 100, composite: 70, labelBand: "Steady",
        firedFindings: [pd1 as unknown] as never, constructionData: null, constantVersion: "cv2", createdAt: new Date(),
      } as never,
      { scoredCount: 1, totalCount: 1 },
      [],
    );
  let threw: string | null = null;
  try { smuggle(); } catch (e) { threw = (e as Error).message; }
  ok("★ a PD1 smuggled into the PERSISTED set now THROWS — it cannot be filed as a judgment about the book",
    threw != null && /not routed/.test(threw), threw ? threw.slice(0, 96) + "…" : "IT DID NOT THROW");

  // …and the router still routes what it should — the throw is not a blanket refusal.
  const okReads = reshapeSnapshot(
    {
      id: "s1", totalValue: "100000", coverage: 1, recognizedUnscoredValue: "0", smallUnscoredValue: "0",
      structure: 50, quality: 70, signals: 100, composite: 70, labelBand: "Steady",
      firedFindings: [{ id: "PC1", family: "PC", label: "x", tone: "Caution", loud: false, bind: {}, doesntMean: "x" } as unknown] as never,
      constructionData: null, constantVersion: "cv2", createdAt: new Date(),
    } as never,
    { scoredCount: 1, totalCount: 1 },
    [],
  );
  ok("…and a known family still routes normally — the throw is not a blanket refusal",
    okReads.constructionRead.findings.some((f) => f.id === "PC1"));

  // And the real path: PD never enters that function at all.
  const src = readFileSync("src/portfolio/phs/portfolio-health-view.ts", "utf8");
  const passesPdToReshape = /reshapeSnapshot\([^)]*disclosureFindings/s.test(src);
  ok("★ the controller NEVER passes PD to reshapeSnapshot — the sort never sees PD1", !passesPdToReshape);
  ok("★ PD is served beside the snapshot, not inside it", /referenceFindings:\s*disclosureFindings/.test(src));
  ok("★ PD is served even with NO snapshot — its truth never depended on the book",
    /snapshot:\s*null[^}]*referenceFindings:\s*disclosureFindings/s.test(src));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("6 · PD → REFERENCE ONLY: no storyClause, ever");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const all = fire({
    facts: [BOND("INE733E07JU4"), TBILL("IN002024X026"), FUND("INF204K01XI3")],
    heldNotValued: [HNV("FAKESTOCK")], staleAccounts: [STALE()], oldestSyncAgeDays: 12,
    history: [HIST("INF204K01XI3", 40)],
  });
  // (10b) `storyClause` IS A REAL FIELD NOW — this used to cast through `Record<string, unknown>` because
  // the field did not exist yet. It does, so the check is direct and the COMPILER is part of the gate:
  // the assertion is no longer probing for a property that might be misspelled.
  const withStory = all.filter((f) => f.storyClause != null);
  ok("★ NO PD finding carries a storyClause — ineligible for the story by construction, not by a filter",
    withStory.length === 0, withStory.map((f) => f.id).join(",") || "0 of 7");
  ok("every PD is Neutral and quiet — the family's tone is not a per-finding judgment call",
    all.every((f) => f.tone === "Neutral" && f.loud === false));
  ok("every PD is family PD", all.every((f) => f.family === "PD"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("7 · COPY GATES — classified doesntMean · advice-verb grep = 0");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const PD_IDS = ["PD1", "PD2", "PD3", "PD4", "PD5", "PD6", "PD7"];
  for (const id of PD_IDS) {
    const c = READ_TIME_COPY[id];
    ok(`${id} has a classified doesntMean`, !!c && !!c.doesntMean && Array.isArray(c.job) && c.job.length > 0,
      c ? `job=[${c.job.join(", ")}]` : "MISSING");
  }
  ok("the family's job is misattribution-block — every one of them",
    PD_IDS.every((id) => READ_TIME_COPY[id]!.job.includes("misattribution-block")));

  // ⚠ (batch 3) THIS ASSERTION GREW, AND WHAT IT ASSERTS DID NOT. Its job is "READ_TIME_COPY holds
  // EXACTLY the read-time set and nothing else" — a guard against a finding acquiring copy here without
  // acquiring a home. Batch 3 added PD8 (the disclosure PI1's re-gate created) and PI1–PI8, so the
  // expected set is larger; the gate is unchanged and still fails on an id nobody declared.
  const PI_IDS = ["PI1", "PI2", "PI3", "PI4", "PI5", "PI6", "PI7", "PI8"];
  const EXPECTED = ["PE6", ...PD_IDS, "PD8", ...PI_IDS];
  ok("READ_TIME_IDS = PE6 + the eight PD + the eight PI",
    READ_TIME_IDS.sort().join(",") === EXPECTED.sort().join(","), READ_TIME_IDS.join(","));
  ok("PD8 has a classified doesntMean (batch 3 — the ingestion-schedules disclosure)",
    !!READ_TIME_COPY["PD8"]?.doesntMean && READ_TIME_COPY["PD8"]!.job.includes("misattribution-block"));

  const all = fire({
    facts: [BOND("INE733E07JU4"), TBILL("IN002024X026"), FUND("INF204K01XI3")],
    heldNotValued: [HNV("FAKESTOCK")], staleAccounts: [STALE()], oldestSyncAgeDays: 12,
    history: [HIST("INF204K01XI3", 40)],
  });
  let hits = 0;
  for (const f of all) {
    const r = scanStringsForForwardLanguage(f.id, [f.read ?? ""], PORTFOLIO_ADVICE_DENY_LIST);
    if (r.length) { hits += r.length; console.log(`       ❌ ${f.id}: ${JSON.stringify(r)}`); }
  }
  ok("advice-verb grep = 0 across every PD read", hits === 0, `${all.length} reads scanned`);

  // Negative control — the gate must be capable of failing.
  const control = scanStringsForForwardLanguage("CTRL", ["You should consider trimming this position."], PORTFOLIO_ADVICE_DENY_LIST);
  ok("negative control: the scanner DOES catch advice", control.length > 0, JSON.stringify(control));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("8 · ★ THE TAXONOMY IS EXHAUSTIVE AGAINST THE INGESTION — a seventh reason fails the build");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // The reasons are DECLARED by the ingestion guards, in TypeScript, as string literals. This scans them
  // and asserts the taxonomy and the ingestion agree — IN BOTH DIRECTIONS, and the second one is not
  // symmetry for its own sake:
  //
  //   found ⊆ known — no reason the ingestion writes goes unclassified (a seventh reason fails the build).
  //   known ⊆ found — ★ no reason in NULL_REASON is FABRICATED, or traceable only to a probe I ran once.
  //
  // ⚠ THE SECOND DIRECTION EXISTS BECAUSE THE FIRST ONE PASSED WHILE BLIND. This scan originally required
  // /NullReason/ on the line, which found 5 of 6: `no_distributions_in_window` is declared in
  // reit-distributions.ts as `reason: "no_distributions_in_window"` and assigned to
  // `distributionYieldNullReason` a file away, so the literal never shares a line with the word. The gate
  // reported "all known" and was RIGHT BY LUCK — it would have said the same had the reason been invented.
  // A one-directional check cannot tell "I classified everything" from "I only looked at what I'd already
  // classified". (Same family as the column-name grep that could not see a JSON key.)
  const files = globSync("src/ingestions/**/*.ts");
  const found = new Map<string, string[]>();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      // Both shapes the ingestion uses: `*NullReason: "x"` at the write site, and the bare `reason: "x"`
      // the guard returns before a caller renames it onto an attribute key.
      if (!/NullReason|\breason:/i.test(line)) continue;
      for (const m of line.matchAll(/"([a-z][a-z0-9_]{3,})"/g)) {
        const lit = m[1]!;
        found.set(lit, [...(found.get(lit) ?? []), file.replace(/\\/g, "/")]);
      }
    }
  }
  const known = new Set(Object.keys(NULL_REASON));
  console.log(`       scanned ${files.length} ingestion files · found ${found.size} candidate literals`);
  for (const [r, fs] of found) console.log(`       ${known.has(r) ? "✓" : "·"} ${r.padEnd(28)} ${[...new Set(fs)][0]}`);

  // Direction 1 — every literal that lands on a `*NullReason` KEY must be classified. (A bare `reason:`
  // in an ingestion is not necessarily a null-reason — `ok:false` guards use it for other things — so
  // this arm keys on the attribute-writing shape only, and stays a real constraint rather than a
  // wildcard that would flag every string in the directory.)
  const attrReasons = new Map<string, string>();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!/NullReason\s*[:=]/.test(line)) continue;
      for (const m of line.matchAll(/"([a-z][a-z0-9_]{3,})"/g)) attrReasons.set(m[1]!, file.replace(/\\/g, "/"));
    }
  }
  const unknown = [...attrReasons.keys()].filter((r) => !known.has(r));
  ok("★ every literal written to a *NullReason key is classified in null-reasons.ts", unknown.length === 0,
    unknown.length ? `UNCLASSIFIED: ${unknown.join(", ")} — add it to NULL_REASON with its CLASS` : `${attrReasons.size} write-site literals, all known`);

  // ── ★ THE OMISSIONS TAXONOMY — TRI-DIRECTIONAL. Same two arms as above, plus the one that keeps
  //    `Partial` honest: a code we DELIBERATELY left unclassified must be NAMED, or absence becomes the
  //    signal again and "forgotten" reads identically to "we looked and could not answer". ────────────
  const omCodes = Object.values(OmissionCode) as string[];
  const classified = new Set(Object.keys(OMISSION_CLASS));
  const unclassified = new Set([...OMISSION_UNCLASSIFIED.keys()] as string[]);
  console.log(`       mf-omissions declares ${omCodes.length} codes · classified=${classified.size} · deliberately unclassified=${unclassified.size}`);

  const missed = omCodes.filter((c) => !classified.has(c) && !unclassified.has(c));
  ok("★ every omission code is either CLASSIFIED or DELIBERATELY UNCLASSIFIED — none forgotten",
    missed.length === 0, missed.length ? `FORGOTTEN: ${missed.join(", ")}` : `${omCodes.length} codes accounted for`);

  const phantomOm = [...classified, ...unclassified].filter((c) => !omCodes.includes(c));
  ok("★ no phantom — nothing classified that mf-omissions.ts does not declare", phantomOm.length === 0,
    phantomOm.length ? `PHANTOM: ${phantomOm.join(", ")}` : `all traced to OmissionCode`);

  const both = [...classified].filter((c) => unclassified.has(c));
  ok("★ classified ∩ unclassified = ∅ — a code cannot be both", both.length === 0, both.join(", ") || "disjoint");

  const noReason = [...OMISSION_UNCLASSIFIED].filter(([, why]) => !why || why.length < 40);
  ok("★ every UNCLASSIFIED code carries a WRITTEN reason — 'we decided', not 'someone forgot'",
    noReason.length === 0, `${OMISSION_UNCLASSIFIED.size} entries, each with a reason`);
  for (const [c, why] of OMISSION_UNCLASSIFIED) console.log(`       · ${c}\n           ${why.slice(0, 104)}…`);

  ok("negative control: the tri-gate CATCHES a forgotten code",
    [...omCodes, "some_new_code_2027"].filter((c) => !classified.has(c) && !unclassified.has(c)).length === 1);

  // ★ Direction 2 — every reason I CLAIM exists must be findable in the ingestion that writes it.
  const fabricated = [...known].filter((r) => !found.has(r));
  ok("★ no reason in NULL_REASON is fabricated — each is traceable to the ingestion that writes it",
    fabricated.length === 0,
    fabricated.length ? `NOT FOUND IN src/ingestions: ${fabricated.join(", ")}` : `all ${known.size} traced to source`);

  // ── NEGATIVE CONTROLS — an assertion nobody has watched fail is an assertion nobody should trust, and
  //    the FIRST version of this gate passed while blind to a sixth of its subject. Both arms, proven
  //    capable of firing, against the same `found`/`attrReasons` sets the real assertions read. ────────
  ok("negative control: direction 2 CATCHES a fabricated reason",
    [...known, "reason_i_invented_2027"].filter((r) => !found.has(r)).length === 1);
  ok("negative control: direction 1 CATCHES an unclassified write-site literal",
    [...attrReasons.keys(), "brand_new_reason_2027"].filter((r) => !known.has(r)).length === 1);
  ok("★ …and direction 2 would have caught the blindness that shipped in this gate's first draft",
    // The original scan required /NullReason/ on the line. Re-run it and watch `no_distributions_in_window`
    // vanish — the exact hole, reproduced, so the reason this gate is bidirectional stays provable.
    (() => {
      const narrow = new Set<string>();
      for (const file of files) {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (!/NullReason/.test(line)) continue;
          for (const m of line.matchAll(/"([a-z][a-z0-9_]{3,})"/g)) narrow.add(m[1]!);
        }
      }
      return [...known].filter((r) => !narrow.has(r)).join(",") === "no_distributions_in_window";
    })(),
    "the narrow scan finds 5 of 6 and calls it complete");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("9 · ★ PD4 SEES WHAT PE6 STRUCTURALLY CANNOT — the valueless unpriceable holding");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // A holding we cannot price AND for which the broker gave no value: it contributes ₹0 to unvaluedValue,
  // so PE6's `value > 0` gate keeps it silent — about the LEAST known holding in the book.
  const noValue = [HNV("MYSTERY", { brokerCurrentValue: null })];
  const pe6 = fireReadTimeFindings({ unvaluedValue: "0", unvaluedShare: 0, heldNotValued: noValue });
  const pd4 = get(fire({ heldNotValued: noValue }), "PD4");
  ok("PE6 is SILENT on a holding with no broker value — it has no ₹ to name", pe6.length === 0);
  ok("★ PD4 fires anyway — it counts holdings, not rupees", !!pd4);
  ok("PD4 binds how many we have no value for at all", pd4!.bind.withoutAnyValueCount === 1);
  console.log(`       PD4 · ${pd4!.read}`);

  // Where both CAN fire they agree and both fire: different subjects (the number vs our coverage), not
  // one fact at two volumes — so the suppression model does not apply (ODL cv2-s9-suppression-model).
  const valued = [HNV("FAKESTOCK", { brokerCurrentValue: "270" })];
  const pe6b = fireReadTimeFindings({ unvaluedValue: "270", unvaluedShare: 0.004, heldNotValued: valued });
  const pd4b = get(fire({ heldNotValued: valued }), "PD4");
  ok("PE6 and PD4 CO-FIRE where both are true — different subjects, different panels", pe6b.length === 1 && !!pd4b);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("10 · ★ RULING ③ — PD1 BINDS WHAT WE HOLD; IT ASSERTS NOTHING");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // Doc 2's PD1: "what we can tell you: the issuer, the coupon, and the maturity where published."
  // Live: issuer null 46% · maturityDate null 99.4% · coupon null 7%. The sentence promises three facts
  // and we reliably carry one. So PD1 COUNTS over this user's bonds instead.
  const mixed = fire({
    facts: [
      BOND("INE733E07JU4"), // issuer + coupon, no maturity
      BOND("INE733E07JU5", { issuer: null, issuerNullReason: "not_in_our_universe" }), // no issuer
    ],
  });
  const pd1 = get(mixed, "PD1")!;
  console.log(`       ${pd1.read}`);
  ok("PD1 says 'the issuer on 1 of 2' — counted, not asserted", pd1.read!.includes("the issuer on 1 of 2"), pd1.read);
  ok("PD1 says 'the coupon on all 2'", pd1.read!.includes("the coupon on all 2"));
  // ★ RULING ④ — maturity is TWO facts, and this is the case 122 real bonds are in.
  ok("★ PD1 says we carry the maturity YEAR — the fact 124 of 356 real bonds have",
    pd1.read!.includes("the maturity year on all 2"), pd1.read);
  ok("★ …and separately that the EXACT DATE is the world's gap — never collapsed into one 'maturity'",
    pd1.read!.includes("the exact maturity date is not published by the source we read"));
  ok("PD1 binds ratedCount as a COUNT, not an assumption", pd1.bind.ratedCount === 0 && pd1.bind.bondCount === 2);
  const carried = pd1.bind.carried as Array<{ field: string; present: number; reasons: Array<{ cls: string }> }>;
  ok("PD1's bind carries per-field presence + the reason class for every absence",
    carried.length === 4 && carried.find((c) => c.field === "maturityDate")!.reasons[0]!.cls === "world_gap",
    carried.map((c) => `${c.field}:${c.present}/2`).join(" "));

  // The OTHER real shape: 232 bonds where we could not read the name at all, so neither resolution exists.
  const noName = fire({ facts: [BOND("INE733E07JU9", { maturityYear: null, maturityDate: null, maturityDateNullReason: "unparseable_name" })] });
  const nn = get(noName, "PD1")!.read!;
  ok("★ a bond whose name we could not parse claims NEITHER resolution, and calls it our gap",
    !nn.includes("the maturity year on") && nn.includes("we could not read it off the instrument's name"), nn);

  // A bond we carry NOTHING about — the consolation clause must not invent one. Every field is nulled
  // EXPLICITLY, including `maturityYear`: it defaults to present on BOND() because that is production's
  // modal shape, and a fixture claiming "we know nothing" while inheriting a known field would assert the
  // opposite of its own name.
  const bare = fire({ facts: [BOND("INE733E07JU6", { issuer: null, issuerNullReason: "not_in_our_universe", coupon: null, couponNullReason: "unparseable_name", maturityYear: null })] });
  const bareRead = get(bare, "PD1")!.read!;
  console.log(`       ${bareRead}`);
  ok("★ a bond we know almost nothing about gets NO 'what we do carry' clause", !bareRead.includes("What we do carry"));
  ok("…and its two OUR-GAP reasons are named separately, not merged",
    bareRead.includes("outside the universe we catalogue") && bareRead.includes("could not read it off the instrument's name"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("11 · ★ THE ROUTER IS EXHAUSTIVE — every family the ENGINE can emit is declared");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // The runtime throw is the backstop; THIS is the gate that should make it unreachable. It reads the
  // families `patterns.ts` can actually emit out of the source and asserts each is routed — so adding a
  // family and forgetting the router fails the BUILD, not a user's portfolio read.
  const src = readFileSync("src/portfolio/phs/patterns.ts", "utf8");
  const emitted = [...new Set([...src.matchAll(/family:\s*"(P[A-Z])"/g)].map((m) => m[1]!))].sort();
  const ctrl = readFileSync("src/portfolio/phs/portfolio-health-view.ts", "utf8");
  const declBlock = ctrl.match(/const FINDING_HOME[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  const declared = [...new Set([...declBlock.matchAll(/^\s{2}(P[A-Z]):\s*"(construction|health)"/gm)].map((m) => m[1]!))].sort();
  console.log(`       patterns.ts emits: ${emitted.join(", ")}`);
  console.log(`       FINDING_HOME declares: ${declared.join(", ")}`);
  const unrouted = emitted.filter((f) => !declared.includes(f));
  ok("★ every family the engine emits has a declared home — no catch-all", unrouted.length === 0,
    unrouted.length ? `UNROUTED: ${unrouted.join(", ")} — declare it in FINDING_HOME` : `${emitted.length} families, all declared`);
  ok("★ PD is NOT declared — it is reference-only and must never be routed into a panel",
    !declared.includes("PD"), "served beside the snapshot, not inside it");
  ok("negative control: the gate CATCHES an undeclared family",
    [...emitted, "PZ"].filter((f) => !declared.includes(f)).length === 1);
}

console.log("\n" + "═".repeat(96));
console.log(fail === 0 ? "  ✅ PD FAMILY — ALL PASS" : `  ❌ ${fail} FAILURE(S)`);
console.log("═".repeat(96));
process.exitCode = fail ? 1 : 0;
