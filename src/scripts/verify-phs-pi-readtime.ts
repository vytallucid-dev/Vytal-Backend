// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 10a BATCH 3 — THE PI FAMILY. PROVEN, NOT REVIEWED.
//
// ★ §1 IS A LIVE PROOF AND IT RUNS FIRST, ON PRODUCTION DATA, BEFORE ANY FIXTURE. Batch 2 could not do
// this: six of its seven findings could not fire against the live cohort at all. PI5 can — 7985d813's
// Kotak Manufacture in India Fund carries BOTH SIDES OF THE ABSENCE/REFUSAL SEAM on one real row
// (dd5 = −22.75%, evaluable · benchmark = thematic_no_clean_index, refused). A synthetic fixture proves
// the code does what I wrote. The live row proves I understood the data I wrote it against.
//
// WHAT THIS ASSERTS:
//   1. ★ LIVE — PI5 fires on a real held fund; the benchmark stays honestly silent. (Needs the DB.)
//   2. Each of PI1–PI8 FIRES on a book built to fire it, and is SILENT where it should be.
//   3. ★ PI1's THREE STATES: same-day pair → fires · lagged → NOT-EVALUABLE WITH A REASON, never
//      silent · no pair at all → PD8, the finding about OUR schedules.
//   4. ★ PI5 REFUSES AND DOES NOT FALL BACK — the negative that is the ruling's whole point.
//   5. ★ THE NESTING RULE — the 65 live side-pocket rows cannot produce "deepest fall: 0.0%".
//   6. ★ PI5 NAMES THE SPAN IT MEASURED, never "on record" unqualified.
//   7. PD6 co-fires on a short rung; is SILENT on a refusal. Both directions.
//   8. ★ PI6 IS OFF — the flag defaults off AND the finding cannot emit.
//   9. PI2 goes not-evaluable and FABRICATES NO TWIN.
//  10. PI7 agrees with batch 2's ledger — zero occurrences, not a missing number.
//  11. Every PI has a classified doesntMean · advice-verb grep = 0 · the tone table matches doc 2.
//
//   npx tsx src/scripts/verify-phs-pi-readtime.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  fireInstrumentFindings, fireDisclosureFindings,
  type InstrumentInput, type DisclosureInput,
} from "../portfolio/phs/read-time-findings.js";
import type { HeldInstrumentFacts, HeldFundAnalytics } from "../portfolio/phs/read-time-catalog.js";
import { READ_TIME_COPY } from "../portfolio/phs/copy.js";
import { scanStringsForForwardLanguage, PORTFOLIO_ADVICE_DENY_LIST } from "../scoring/lens-patterns/no-forward-guard.js";
import * as K from "../portfolio/phs/constants.js";
import { prisma } from "../db/prisma.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

// ── Fixture builders ────────────────────────────────────────────────────────────────────────────
const F = (isin: string, assetClass: string, over: Partial<HeldInstrumentFacts> = {}): HeldInstrumentFacts => ({
  isin, name: `${assetClass.toUpperCase()} ${isin}`, assetClass, category: null, attributes: {},
  isActive: true, planType: null, amfiSchemeCode: null,
  lastPrice: null, lastPriceDate: null, currentNav: null, navDate: null, ...over,
});

/** An mf_analytics row. Defaults are the MODAL live shape: a Growth plan measured on its own series,
 *  with a nested drawdown ladder and no omissions. Every test below overrides only what it is about. */
const A = (isin: string, over: Partial<HeldFundAnalytics> = {}): HeldFundAnalytics => ({
  isin, schemeCode: `SC-${isin}`, navPoints: 1073,
  windowFrom: "2021-07-10", windowTo: "2026-07-10", asOfDate: "2026-07-10",
  seriesSchemeCode: `SC-${isin}`,
  maxDrawdown1y: -0.1165, maxDrawdown3y: -0.2275, maxDrawdown5y: -0.2275,
  trackingError1y: null, benchmarkIndex: null, benchmarkVia: null,
  rank1y: null, rank3y: null, rank5y: null,
  rankPool1y: null, rankPool3y: null, rankPool5y: null,
  rankBucket: null, rankBucketSize: null, omissions: null, ...over,
});

const fire = (over: Partial<InstrumentInput> = {}) =>
  fireInstrumentFindings({ facts: [], analytics: [], ...over });
const ids = (fs: ReturnType<typeof fire>) => fs.map((f) => f.id).sort();
const get = (fs: ReturnType<typeof fire>, id: string) => fs.find((f) => f.id === id);

const EMPTY_D: DisclosureInput = { heldNotValued: [], staleAccounts: [], oldestSyncAgeDays: null, facts: [], history: [] };
const fireD = (over: Partial<DisclosureInput> = {}) => fireDisclosureFindings({ ...EMPTY_D, ...over });

async function main() {
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · ★ THE LIVE PROOF — 7985d813's Kotak fund. Production data, before any fixture.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const kotak = await prisma.instrument.findFirst({
    where: { name: { contains: "Manufacture in India", mode: "insensitive" }, planType: "regular", isin: "INF174KA1IC1" },
    select: { isin: true, name: true, assetClass: true, category: true, attributes: true, isActive: true,
      planType: true, amfiSchemeCode: true, lastPrice: true, lastPriceDate: true, currentNav: true, navDate: true },
  });
  if (!kotak) {
    ok("★ the live Kotak fund is in the catalog", false, "INF174KA1IC1 not found — the live proof cannot run");
  } else {
    const raw = await prisma.mfAnalytics.findUnique({ where: { schemeCode: kotak.amfiSchemeCode! } });
    ok("★ the live fund has an mf_analytics row", !!raw, `scheme ${kotak.amfiSchemeCode}`);
    if (raw) {
      const facts: HeldInstrumentFacts[] = [{
        isin: kotak.isin, name: kotak.name, assetClass: String(kotak.assetClass), category: kotak.category,
        attributes: (kotak.attributes && typeof kotak.attributes === "object" && !Array.isArray(kotak.attributes)
          ? kotak.attributes : {}) as Record<string, unknown>,
        isActive: kotak.isActive, planType: kotak.planType ? String(kotak.planType) : null,
        amfiSchemeCode: kotak.amfiSchemeCode,
        lastPrice: kotak.lastPrice?.toString() ?? null, currentNav: kotak.currentNav?.toString() ?? null,
        lastPriceDate: kotak.lastPriceDate?.toISOString().slice(0, 10) ?? null,
        navDate: kotak.navDate?.toISOString().slice(0, 10) ?? null,
      }];
      const dec = (d: unknown) => (d == null ? null : Number(String(d)));
      const analytics: HeldFundAnalytics[] = [{
        isin: kotak.isin, schemeCode: raw.schemeCode, navPoints: raw.navPoints,
        windowFrom: raw.windowFrom?.toISOString().slice(0, 10) ?? null,
        windowTo: raw.windowTo?.toISOString().slice(0, 10) ?? null,
        asOfDate: raw.asOfDate.toISOString().slice(0, 10),
        seriesSchemeCode: raw.seriesSchemeCode,
        maxDrawdown1y: dec(raw.maxDrawdown1y), maxDrawdown3y: dec(raw.maxDrawdown3y), maxDrawdown5y: dec(raw.maxDrawdown5y),
        trackingError1y: dec(raw.trackingError1y), benchmarkIndex: raw.benchmarkIndex, benchmarkVia: raw.benchmarkVia,
        rank1y: raw.rank1y, rank3y: raw.rank3y, rank5y: raw.rank5y,
        rankPool1y: raw.rankPool1y, rankPool3y: raw.rankPool3y, rankPool5y: raw.rankPool5y,
        rankBucket: raw.rankBucket, rankBucketSize: raw.rankBucketSize, omissions: raw.omissions,
      }];

      const live = fire({ facts, analytics });
      const pi5 = get(live, "PI5");
      console.log(`       ${kotak.name}`);
      console.log(`       series ${analytics[0]!.windowFrom} → ${analytics[0]!.windowTo} · ${raw.navPoints} NAV points`);
      console.log(`       dd1y=${analytics[0]!.maxDrawdown1y} dd3y=${analytics[0]!.maxDrawdown3y} dd5y=${analytics[0]!.maxDrawdown5y}`);
      console.log(`       omissions: ${JSON.stringify(raw.omissions)}`);

      ok("★ PI5 FIRES on the live fund", !!pi5);
      ok("★ …and it is EVALUABLE — a real number, not a refusal", !!pi5 && !pi5.notEvaluable,
        pi5?.notEvaluable ? JSON.stringify(pi5.notEvaluable) : "evaluable");
      ok("★ …binding the briefed −22.8%", Math.abs((pi5?.bind.maxDrawdown as number) - -0.22752) < 1e-6,
        String(pi5?.bind.maxDrawdown));
      console.log(`\n       PI5 · ${pi5?.read}\n`);

      // ★ THE SEAM. The SAME row that yields an evaluable drawdown REFUSES a benchmark, and the refusal
      // is silence — not a fabricated index, not a null rendered as "unavailable". Nothing on this page
      // mentions a benchmark, because there isn't a defensible one, and we do not invent one to fill a slot.
      const om = raw.omissions as Record<string, string> | null;
      ok("★ the benchmark is REFUSED on the same row — thematic_no_clean_index",
        om?.benchmark === "thematic_no_clean_index", `benchmark omission = ${om?.benchmark}`);
      ok("★ …and the fold stored NO benchmark for it", raw.benchmarkIndex === null && raw.benchmarkVia === null);
      ok("★ …so PI4 is HONESTLY SILENT — no benchmark ⇒ no tracking claim, and no apology either",
        !get(live, "PI4"), "a thematic fund never claimed to track an index");

      // The live fund is a REGULAR plan → PI2's honest-null, on real data.
      const pi2 = get(live, "PI2");
      ok("★ PI2 fires NOT-EVALUABLE on the live regular plan", !!pi2 && !!pi2.notEvaluable,
        pi2?.notEvaluable?.reason ?? "(did not fire)");
      ok("★ …and fabricates no twin", pi2?.bind.directTwin === null);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · ★ PI5 — THE LADDER IS FOR ABSENCE, NOT FOR REFUSAL. The negative is the whole point.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── the refusal: an IDCW plan the fold declined. All three rungs carry it, and dd1 is NOT a fallback.
  const idcwOm = {
    max_drawdown_1y: "idcw_nav_not_total_return",
    max_drawdown_3y: "idcw_nav_not_total_return",
    max_drawdown_5y: "idcw_nav_not_total_return",
  };
  const idcw = fire({
    facts: [F("INF174KA1IE7", "mutual_fund", { amfiSchemeCode: "149843" })],
    analytics: [A("INF174KA1IE7", {
      maxDrawdown1y: null, maxDrawdown3y: null, maxDrawdown5y: null,
      seriesSchemeCode: null, omissions: idcwOm,
    })],
  });
  const p = get(idcw, "PI5")!;
  ok("★ an IDCW fund's PI5 is NOT EVALUABLE", !!p.notEvaluable, JSON.stringify(p.notEvaluable));
  ok("★ …and the reason is the fold's, inherited verbatim", p.notEvaluable?.reason === "idcw_nav_not_total_return");
  ok("★ …classified `refused` — NOT a gap. A number exists; we declined to ship it.",
    p.notEvaluable?.cls === "refused");
  ok("★★ IT DOES NOT FALL BACK TO 1y — the ruling's whole point", p.bind.maxDrawdown === null && p.bind.rungHorizon === null,
    `maxDrawdown=${p.bind.maxDrawdown} rung=${p.bind.rungHorizon}`);
  console.log(`       PI5 · ${p.read}`);

  // ★ THE LAUNDERING CASE — the one that would slip through a naive ladder. The fold refused 5y and 3y
  // but a 1y number SURVIVES on the row. A ladder that walks on absence alone finds it and ships it.
  const launder = fire({
    facts: [F("INFLAUNDER01", "mutual_fund")],
    analytics: [A("INFLAUNDER01", {
      maxDrawdown5y: null, maxDrawdown3y: null, maxDrawdown1y: -0.0421, // ← a real, tempting number
      omissions: { max_drawdown_5y: "idcw_nav_not_total_return", max_drawdown_3y: "idcw_nav_not_total_return" },
    })],
  });
  const l = get(launder, "PI5")!;
  ok("★★ a refusal at 5y STOPS THE WALK even though a 1y value is sitting right there",
    !!l.notEvaluable && l.bind.maxDrawdown === null,
    `would have shipped −4.21% via the 1y rung; shipped ${l.bind.maxDrawdown}`);

  // ── absence: a genuinely young fund walks the ladder and lands on a shorter rung.
  const young = fire({
    facts: [F("INFYOUNG0001", "mutual_fund")],
    analytics: [A("INFYOUNG0001", {
      navPoints: 400, windowFrom: "2024-11-01", windowTo: "2026-07-10", asOfDate: "2026-07-10",
      maxDrawdown5y: null, maxDrawdown3y: null, maxDrawdown1y: -0.0812,
      omissions: { max_drawdown_5y: "insufficient_history", max_drawdown_3y: "insufficient_history" },
    })],
  });
  const y = get(young, "PI5")!;
  ok("★ genuine short history WALKS the ladder — 5y → 3y → 1y", !y.notEvaluable && y.bind.rungHorizon === "1y",
    `rung=${y.bind.rungHorizon} dd=${y.bind.maxDrawdown}`);
  console.log(`       PI5 · ${y.read}`);

  // ── `_all: no_nav_in_window` — the row-level refusal-shaped absence. It WALKS (it is not_a_gap).
  const noNav = fire({
    facts: [F("INFNONAV0001", "mutual_fund")],
    analytics: [A("INFNONAV0001", {
      maxDrawdown1y: null, maxDrawdown3y: null, maxDrawdown5y: null,
      omissions: { _all: "no_nav_in_window" },
    })],
  });
  const nn = get(noNav, "PI5")!;
  ok("★ `_all: no_nav_in_window` is an ABSENCE (not_a_gap) — it reaches the bottom rung, honestly empty",
    !!nn.notEvaluable && nn.notEvaluable.cls === "not_a_gap" && nn.notEvaluable.reason === "no_nav_in_window",
    JSON.stringify(nn.notEvaluable));

  // ── withheld_implausible → refused.
  const wi = fire({
    facts: [F("INFWITHHELD1", "mutual_fund")],
    analytics: [A("INFWITHHELD1", {
      maxDrawdown1y: null, maxDrawdown3y: null, maxDrawdown5y: null,
      omissions: { max_drawdown_5y: "withheld_implausible", max_drawdown_3y: "withheld_implausible", max_drawdown_1y: "withheld_implausible" },
    })],
  });
  const w = get(wi, "PI5")!;
  ok("★ withheld_implausible → NOT EVALUABLE, class `refused`",
    w.notEvaluable?.cls === "refused" && w.bind.maxDrawdown === null);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · ★★ THE NESTING RULE — the 65 live side-pocket rows. 'Deepest fall: 0.0%' must never ship.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // THE EXACT LIVE SHAPE, reproduced: UTI Medium Term Fund (Segregated - 17022020). 154 NAV points over
  // 7 months, frozen at 2022-01-27. vol_1y/vol_3y/ret_1y all `withheld_implausible` → the guard cleared
  // the y1 and y3 windows. y5 was NEVER VOLATILITY-TESTED (mf-implausible.ts:103 passes `vol: null`), so
  // maxDrawdown5y = 0 survived with NO omission of its own. 65 rows are in exactly this state.
  const sidePocket = fire({
    facts: [F("INF789F1AU23", "mutual_fund", { name: "UTI Medium Term Fund ( Segregated - 17022020 ) - Direct Plan" })],
    analytics: [A("INF789F1AU23", {
      navPoints: 154, windowFrom: "2021-06-14", windowTo: "2022-01-27", asOfDate: "2022-01-27",
      maxDrawdown5y: 0,      // ← present, no omission. Doc 2's trigger says FIRE.
      maxDrawdown3y: null,
      maxDrawdown1y: null,
      omissions: {
        vol_1y: "withheld_implausible", vol_3y: "withheld_implausible", ret_1y: "withheld_implausible",
        max_drawdown_3y: "withheld_implausible", max_drawdown_1y: "withheld_implausible",
        // ⚠ NOTE WHAT IS ABSENT: no `max_drawdown_5y` key. The fold never withheld it.
      },
    })],
  });
  const sp = get(sidePocket, "PI5")!;

  ok("★★ PI5 does NOT report 'deepest fall 0.0%' on a side-pocketed defaulted-debt fund",
    sp.bind.maxDrawdown !== 0, `bind.maxDrawdown = ${sp.bind.maxDrawdown}`);
  ok("★★ …it inherits the refusal from the SHORTER rung — the 5y window contains the 3y window",
    !!sp.notEvaluable && sp.notEvaluable.cls === "refused" && sp.notEvaluable.reason === "withheld_implausible",
    JSON.stringify(sp.notEvaluable));
  ok("★ …and BINDS the inheritance: which rung was refused, and which value it contaminated",
    sp.bind.refusedAt === "max_drawdown_3y" && sp.bind.contaminates === "max_drawdown_5y",
    `refusedAt=${sp.bind.refusedAt} contaminates=${sp.bind.contaminates}`);
  console.log(`       PI5 · ${sp.read}`);

  // ★ THE NEGATIVE CONTROL — the nesting rule must not swallow a HEALTHY fund. A clean row with a full
  // ladder still fires. A gate that refuses everything is not a gate.
  const healthy = fire({ facts: [F("INFHEALTHY01", "mutual_fund")], analytics: [A("INFHEALTHY01")] });
  const h = get(healthy, "PI5")!;
  ok("negative control: a CLEAN fund still fires with a value — the rule refuses the contaminated only",
    !h.notEvaluable && h.bind.maxDrawdown === -0.2275 && h.bind.rungHorizon === "5y");

  // ★ AND THE TRUE ZERO SURVIVES. 730 live rows carry dd5 = 0 and most are honest: an overnight fund's
  // NAV really does only go up. The rule keys on the REFUSAL, not on the value — a 0 with a clean ladder
  // is a fact, and suppressing it by value would be inventing a second, unstated rule.
  const overnight = fire({
    facts: [F("INFOVERNIGHT", "mutual_fund", { name: "UTI - Overnight Fund - Regular Plan - Growth" })],
    analytics: [A("INFOVERNIGHT", { maxDrawdown5y: 0, maxDrawdown3y: 0, maxDrawdown1y: 0, navPoints: 1857 })],
  });
  const ov = get(overnight, "PI5")!;
  ok("★★ a TRUE zero still ships — an overnight fund genuinely never fell (730 live rows are 0)",
    !ov.notEvaluable && ov.bind.maxDrawdown === 0, `dd=${ov.bind.maxDrawdown}`);
  console.log(`       PI5 · ${ov.read}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("4 · ★ PI5 NAMES THE SPAN IT MEASURED — never 'on record' unqualified.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // The Kotak shape: a 5y rung on a 4.4-year series. 5,070 live rows are in this state.
  const shortSeries = fire({
    facts: [F("INF174KA1IC1", "mutual_fund")],
    analytics: [A("INF174KA1IC1", { windowFrom: "2022-03-02", windowTo: "2026-07-10", asOfDate: "2026-07-10" })],
  });
  const s = get(shortSeries, "PI5")!;
  ok("★ the RUNG is bound (5y — which column this came off)", s.bind.rungHorizon === "5y");
  ok("★★ …and the READ names the ACTUAL span, not the rung: 4 years 4 months, not '5 years'",
    s.read!.includes("4 years and 4 months"), s.read);
  ok("★★ the word 'on record' never appears unqualified — it claims a history we don't have",
    !/on record/i.test(s.read!), s.read);
  ok("★ the span's ENDPOINTS are bound, not just its length",
    s.bind.windowFrom === "2022-03-02" && s.bind.windowTo === "2026-07-10",
    `${s.bind.windowFrom} → ${s.bind.windowTo}`);
  console.log(`       PI5 · ${s.read}`);

  // A fund with a FULL 5 years: the rung and the span agree, and the sentence says five years.
  const full = fire({
    facts: [F("INFFULL00001", "mutual_fund")],
    analytics: [A("INFFULL00001", { windowFrom: "2018-01-02", windowTo: "2026-07-10", asOfDate: "2026-07-10" })],
  });
  const fl = get(full, "PI5")!;
  ok("★ a fund WITH five years says five years — the span is measured, not capped",
    fl.read!.includes("5 years"), fl.read);

  // ★ THE INTERSECTION IS THE POINT: an 8-year series on a 5y rung reports FIVE years, not eight. The
  // drawdown was measured over the rung's window, and naming the whole series would over-claim the
  // other way — a deeper fall in 2019 that this number never saw.
  ok("★ …and NOT eight — the span is the rung ∩ the series, not the series",
    !fl.read!.includes("8 years"), fl.read);
  console.log(`       PI5 · ${fl.read}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("5 · ★ PI1's THREE STATES — fires · not-evaluable-with-a-reason · PD8. Never silent.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ① SAME-DAY PAIR, over the cut → FIRES. Doc 2's own example: ₹62.40 vs ₹55.70 = a 12% premium.
  const sameDay = fire({
    facts: [F("INF204KB1AA1", "etf", {
      name: "Motilal Oswal Nasdaq 100 ETF", lastPrice: "62.40", currentNav: "55.70",
      lastPriceDate: "2026-07-13", navDate: "2026-07-13",
    })],
  });
  const p1 = get(sameDay, "PI1")!;
  ok("★ ① same-day pair over the cut → PI1 FIRES", !!p1 && !p1.notEvaluable);
  ok("★ …Caution and LOUD (doc 2 §9)", p1.tone === "Caution" && p1.loud === true);
  ok("★ …binding the premium and BOTH dates", Math.abs((p1.bind.premium as number) - 0.1203) < 0.001
    && p1.bind.lastPriceDate === "2026-07-13" && p1.bind.navDate === "2026-07-13",
    `premium=${p1.bind.premium}`);
  console.log(`       PI1 · ${p1.read}`);

  // …and under the cut → silent. This is the ONE silence PI1 is allowed: we evaluated it, and there is
  // nothing to report. The live same-day pairs are here (−0.28% and +0.44%).
  const tight = fire({
    facts: [F("INF789F1AZE6", "etf", { lastPrice: "66.00", currentNav: "66.1857", lastPriceDate: "2026-07-10", navDate: "2026-07-10" })],
  });
  ok("★ same-day pair UNDER the cut → silent (evaluated; nothing to say). The live −0.28% case.",
    !get(tight, "PI1"), `|−0.28%| ≤ ${K.PI_PREMIUM_NOTABLE * 100}%`);

  // ② LAGGED PAIR → NOT EVALUABLE, WITH A REASON. ★ NEVER SILENT — this is the re-gate (doc-2 drift #12).
  //    The live shape: price Jul 13, NAV Jul 10. 326 of 328 ETFs.
  const lagged = fire({
    facts: [F("INF247L01AP3", "etf", {
      name: "Mirae Asset Hang Seng TECH ETF", lastPrice: "22.50", currentNav: "18.77",
      lastPriceDate: "2026-07-13", navDate: "2026-07-10",
    })],
  });
  const lg = get(lagged, "PI1")!;
  ok("★★ ② lagged pair → PI1 IS PRESENT, not silent", !!lg);
  ok("★★ …NOT EVALUABLE, with a reason", !!lg.notEvaluable && lg.notEvaluable.reason === "price_nav_not_same_trading_day",
    JSON.stringify(lg.notEvaluable));
  ok("★★ …and the 19.9% premium it WOULD have shipped is NOT in the bind", lg.bind.premium === null,
    "a lagged premium is not computed 'for reference' — that is a wrong number waiting for a UI");
  ok("★ …it is NOT a Caution — we have nothing to caution about", lg.tone === "Neutral" && lg.loud === false);
  ok("★ …and the lag is bound", lg.bind.lagDays === 3, `lagDays=${lg.bind.lagDays}`);
  console.log(`       PI1 · ${lg.read}`);

  // ③ NO SAME-DAY PAIR OBTAINABLE AT ALL → PD8, the finding about OUR ingestion schedules.
  const pd = fireD({ facts: [F("INF247L01AP3", "etf", { lastPrice: "22.50", currentNav: "18.77", lastPriceDate: "2026-07-13", navDate: "2026-07-10" })] });
  const p8 = get(pd, "PD8")!;
  ok("★★ ③ no same-day pair in the whole book → PD8 FIRES — a fact about US, not silence", !!p8);
  ok("★ …it is a PD: reference-only, Neutral, quiet", p8.family === "PD" && p8.tone === "Neutral" && !p8.loud);
  ok("★ …binding sameDayPairCount = 0 and the lag", p8.bind.sameDayPairCount === 0 && (p8.bind.lagDays as number[])[0] === 3);
  console.log(`       PD8 · ${p8.read}`);

  // ★ AND PD8 IS SILENT WHERE WE *CAN* ANSWER — a book with one same-day pair does not need us
  //   apologising for the feed. The disclosure is gated on the book, not on the instrument.
  const pdOk = fireD({ facts: [F("INF789F1AZE6", "etf", { lastPrice: "66.00", currentNav: "66.19", lastPriceDate: "2026-07-10", navDate: "2026-07-10" })] });
  ok("★ PD8 SILENT when a same-day pair exists — we could answer, so there is nothing to disclose",
    !get(pdOk, "PD8"));
  ok("★ PD8 silent on a book with no ETFs at all", !get(fireD({ facts: [F("INE002A01018", "stock")] }), "PD8"));

  // A non-ETF never gets a premium question.
  ok("★ PI1 does not fire on a mutual fund — an unlisted fund has no market price to diverge",
    !get(fire({ facts: [F("INF204K01XI3", "mutual_fund", { currentNav: "55.70", navDate: "2026-07-13" })] }), "PI1"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("6 · PI2 · PI3 · PI4 · PI7 · PI8 — fire, and stay silent where they should");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── PI2 — honest-null. Fires not-evaluable; NEVER fabricates a twin.
  const reg = fire({ facts: [F("INF174KA1IC1", "mutual_fund", { planType: "regular" })] });
  const p2 = get(reg, "PI2")!;
  ok("★ PI2 fires on a regular plan — NOT EVALUABLE", !!p2 && !!p2.notEvaluable);
  ok("★★ …and BINDS NO TWIN. resolveTwins never crosses Regular↔Direct; we do not guess.",
    p2.bind.directTwin === null && p2.bind.twinResolution === "not_built");
  ok("★ PI2 silent on a DIRECT plan", !get(fire({ facts: [F("X", "mutual_fund", { planType: "direct" })] }), "PI2"));
  ok("★ PI2 silent on a NULL plan_type — Step 9 refused to guess the plan (3,955 funds); so do we",
    !get(fire({ facts: [F("X", "mutual_fund", { planType: null })] }), "PI2"));
  console.log(`       PI2 · ${p2.read}`);

  // ── PI3 — dormant. Caution, loud.
  const dormant = fire({ facts: [F("INF209K01470", "mutual_fund", { isActive: false, navDate: "2022-01-27", currentNav: "18.44" })] });
  const p3 = get(dormant, "PI3")!;
  ok("★ PI3 fires on an inactive scheme — Caution, loud", !!p3 && p3.tone === "Caution" && p3.loud);
  ok("★ PI3 silent on an active scheme", !get(fire({ facts: [F("X", "mutual_fund", { isActive: true })] }), "PI3"));
  ok("★ PI3 silent on an inactive STOCK — AMFI's daily file is the subject, not every instrument",
    !get(fire({ facts: [F("X", "stock", { isActive: false })] }), "PI3"));
  console.log(`       PI3 · ${p3.read}`);

  // ── PI4 — tracking gap. Only for funds that CLAIM to track.
  const tracker = fire({
    facts: [F("INF204KB17I5", "etf", { name: "Nippon India ETF Nifty PSU Bank BeES" })],
    analytics: [A("INF204KB17I5", { trackingError1y: 0.0576, benchmarkIndex: "Nifty PSU Bank", benchmarkVia: "name" })],
  });
  const p4 = get(tracker, "PI4")!;
  ok("★ PI4 fires above the cut on a via='name' fund", !!p4 && p4.bind.trackingError1y === 0.0576);
  ok("★ …and NAMES the benchmark — 'a beta is meaningless without the benchmark it is a beta TO'",
    p4.read!.includes("Nifty PSU Bank"), p4.read);
  console.log(`       PI4 · ${p4.read}`);

  ok(`★ PI4 silent BELOW the cut (${K.PI_TE_NOTABLE * 100}%) — tracking well is the mandate met, not a finding`,
    !get(fire({ facts: [F("X", "etf")], analytics: [A("X", { trackingError1y: 0.003, benchmarkIndex: "Nifty 50", benchmarkVia: "name" })] }), "PI4"));
  ok("★★ PI4 silent on via='category' — a Large Cap fund NEVER CLAIMED to track Nifty 100. Its deviation is active management, not infidelity.",
    !get(fire({ facts: [F("X", "mutual_fund")], analytics: [A("X", { trackingError1y: 0.19, benchmarkIndex: "Nifty 100", benchmarkVia: "category" })] }), "PI4"),
    "a 19% 'tracking error' on an active fund is a category error, not a finding");
  ok("★ PI4 silent with no benchmark at all (the live Kotak case — thematic_no_clean_index)",
    !get(fire({ facts: [F("X", "mutual_fund")], analytics: [A("X", { benchmarkIndex: null, benchmarkVia: null })] }), "PI4"));

  // ── PI7 — the two ledgers agree.
  const reit = fire({ facts: [F("INE0FDU25010", "reit", { name: "Embassy REIT", attributes: { distributionYield: 6.4 } })] });
  const p7 = get(reit, "PI7")!;
  ok("★ PI7 fires with a yield", !!p7 && p7.bind.distributionYield === 6.4);
  console.log(`       PI7 · ${p7.read}`);

  // ★★ THE LEDGERS AGREE — the live shape: the 1 REIT + 2 InvITs with no yield are exactly batch 2's
  //    `no_distributions_in_window` rows. ZERO OCCURRENCES, NOT A MISSING NUMBER.
  const newTrust = fire({
    facts: [F("INE2OVN25015", "reit", { name: "Knowledge Realty Trust", attributes: { distributionYield: null, distributionYieldNullReason: "no_distributions_in_window" } })],
  });
  const nt = get(newTrust, "PI7")!;
  ok("★★ a REIT with no distributions renders as ZERO OCCURRENCES, not a gap", !!nt && nt.notEvaluable?.cls === "not_a_gap");
  const ABSENCE = ["unavailable", "missing", "we do not have", "we don't have", "not available", "no data", "we lack", "we could not", "we cannot"];
  const bad = ABSENCE.filter((wd) => nt.read!.toLowerCase().includes(wd));
  ok("★★ …and its Read NEVER uses the vocabulary of absence — not even to deny it (batch 2's gate, kept)",
    bad.length === 0, bad.length ? `LEAKED: ${bad.join("/")}` : `"${nt.read}"`);
  ok("★ PI7 silent on a non-trust", !get(fire({ facts: [F("X", "stock", { attributes: { distributionYield: 6.4 } })] }), "PI7"));

  // ── PI8 — the maturity SPREAD, off the YEAR alone (PD1's two-resolution lesson).
  const bonds = fire({
    facts: [
      F("B1", "bond", { attributes: { maturityYear: 2027, maturityDate: null } }),
      F("B2", "gsec", { attributes: { maturityYear: 2029 } }),
      F("B3", "sgb", { attributes: { maturityYear: 2034 } }),
    ],
  });
  const p8 = get(bonds, "PI8")!;
  ok("★ PI8 fires on the YEAR alone — no maturityDate anywhere in this book (live: 2 of 356 bonds have one)",
    !!p8 && p8.bind.spreadYears === 7);
  ok("★ …the doc's own sentence: 2027, 2029 and 2034 — a spread of 7 years",
    p8.read!.includes("2027, 2029 and 2034") && p8.read!.includes("spread of 7 years"), p8.read);
  console.log(`       PI8 · ${p8.read}`);

  // ★ PI8 SPEAKS FOR A SUBSET AND SAYS SO. 232 live bonds have no parseable year; a spread computed over
  //   the ones we can place, presented as "your debt holdings", would silently exclude the rest.
  const mixed = fire({
    facts: [
      F("B1", "bond", { attributes: { maturityYear: 2027 } }),
      F("B2", "bond", { attributes: { maturityYear: null, maturityDateNullReason: "unparseable_name" } }),
    ],
  });
  const m8 = get(mixed, "PI8")!;
  ok("★ PI8 counts what it EXCLUDED and names it", m8.bind.withoutYearCount === 1 && m8.read!.includes("not included"), m8.read);
  ok("★ PI8 silent when no debt holding has a year", !get(fire({ facts: [F("B", "bond", { attributes: {} })] }), "PI8"));
  ok("★ PI8 silent on a stock-only book", !get(fire({ facts: [F("INE002A01018", "stock")] }), "PI8"));

  ok("★ an EMPTY book fires nothing", fire().length === 0);
  ok("★ a stock-only book fires NO PI", fire({ facts: [F("INE002A01018", "stock")] }).length === 0,
    ids(fire({ facts: [F("INE002A01018", "stock")] })).join(",") || "(none)");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("7 · ★ PD6 CO-FIRES ON A SHORT RUNG · IS SILENT ON A REFUSAL. Both directions.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── DIRECTION 1: a genuinely thin fund. PI5 lands on a short rung AND PD6 fires: "we'd have told you
  //    more if we had more". The two sentences are about different things and both are true.
  const thinAnalytics = A("INFTHIN00001", {
    navPoints: 200, windowFrom: "2025-09-01", windowTo: "2026-07-10", asOfDate: "2026-07-10",
    maxDrawdown5y: null, maxDrawdown3y: null, maxDrawdown1y: -0.0644,
    omissions: { max_drawdown_5y: "insufficient_history", max_drawdown_3y: "insufficient_history" },
  });
  const thinFacts = [F("INFTHIN00001", "mutual_fund")];
  const piThin = get(fire({ facts: thinFacts, analytics: [thinAnalytics] }), "PI5")!;
  const pdThin = get(fireD({ facts: thinFacts, history: [thinAnalytics] }), "PD6");
  ok("★ PI5 lands on the 1y rung — the deepest rung this fund's history supports",
    !piThin.notEvaluable && piThin.bind.rungHorizon === "1y");
  ok(`★★ …and PD6 CO-FIRES (${thinAnalytics.navPoints} < ${K.PD_THIN_HISTORY_POINTS} points)`, !!pdThin);
  console.log(`       PI5 · ${piThin.read}`);
  console.log(`       PD6 · ${pdThin!.read}`);

  // ── DIRECTION 2: ★ THE ONE THAT MATTERS. An IDCW fund has 1,073 NAV points — its window is NOT SHORT.
  //    The metric is REFUSED. Different sentence, different finding. PD6 must stay silent: firing it
  //    would blame our coverage for a refusal our quality gate made, and 3,371 live funds are here.
  const idcwAnalytics = A("INFIDCW00001", {
    navPoints: 1073, // NOT thin — four and a half years of history
    maxDrawdown1y: null, maxDrawdown3y: null, maxDrawdown5y: null, seriesSchemeCode: null,
    omissions: { max_drawdown_1y: "idcw_nav_not_total_return", max_drawdown_3y: "idcw_nav_not_total_return", max_drawdown_5y: "idcw_nav_not_total_return" },
  });
  const idcwFacts = [F("INFIDCW00001", "mutual_fund")];
  const piIdcw = get(fire({ facts: idcwFacts, analytics: [idcwAnalytics] }), "PI5")!;
  const pdIdcw = get(fireD({ facts: idcwFacts, history: [idcwAnalytics] }), "PD6");
  ok("★★ PI5 REFUSES on the IDCW fund", !!piIdcw.notEvaluable && piIdcw.notEvaluable.cls === "refused");
  ok("★★ …and PD6 DOES NOT FIRE — the window isn't short, the metric is refused. 3,371 live funds.",
    !pdIdcw, pdIdcw ? "PD6 FIRED — it is blaming our coverage for our own refusal" : "silent, correctly");

  // ── And the third state: a fat, clean fund. PI5 fires on 5y; PD6 silent. Neither has anything to add.
  const fat = A("INFFAT000001");
  ok("★ a fat clean fund: PI5 on the 5y rung, PD6 silent",
    get(fire({ facts: [F("INFFAT000001", "mutual_fund")], analytics: [fat] }), "PI5")!.bind.rungHorizon === "5y"
      && !get(fireD({ facts: [F("INFFAT000001", "mutual_fund")], history: [fat] }), "PD6"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("8 · ★★ PI6 IS OFF — the flag defaults off AND the finding cannot emit.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  ok("★★ PI6_CATEGORY_RANK_ENABLED is literally false — head-chat ratification pending (doc 2 §9)",
    K.PI6_CATEGORY_RANK_ENABLED === false, `= ${K.PI6_CATEGORY_RANK_ENABLED}`);

  // ★ AND THE FLAG IS A GATE, NOT A COMMENT. A book built to fire PI6 — full ranks, full pools, a live
  //   bucket — emits NOTHING. Asserting the constant alone would prove only that a constant is false.
  const ranked = fire({
    facts: [F("INF174KA1IC1", "mutual_fund", { name: "Kotak Manufacture in India Fund - Regular Plan Growth" })],
    analytics: [A("INF174KA1IC1", {
      rank1y: 66, rank3y: 51, rankPool1y: 395, rankPool3y: 380,
      rankBucket: "Sectoral/ Thematic|regular", rankBucketSize: 395,
    })],
  });
  ok("★★ …and a book built to fire PI6 emits NOTHING — the gate is proven to be a gate",
    !get(ranked, "PI6"), `fired: ${ids(ranked).join(",") || "(none)"}`);
  ok("★ …while the SAME book still fires PI5 — the flag gates PI6 alone, not the family",
    !!get(ranked, "PI5"));
  ok("★ PI6 has its Doesn't-mean ready for ratification — the copy is not what is pending",
    !!READ_TIME_COPY.PI6?.doesntMean && READ_TIME_COPY.PI6.job.includes("advice-block"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("9 · COPY GATES — classified doesntMean · advice-verb grep = 0 · the tone table");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const PI_IDS = ["PI1", "PI2", "PI3", "PI4", "PI5", "PI6", "PI7", "PI8"];
  for (const id of PI_IDS) {
    const c = READ_TIME_COPY[id];
    ok(`${id} has a classified doesntMean`, !!c && !!c.doesntMean && Array.isArray(c.job) && c.job.length > 0,
      c ? `job=[${c.job.join(", ")}]` : "MISSING");
  }
  // ★ THE FAMILY'S JOB IS advice-block — and unlike PD's misattribution-block, this is the PRIMARY job.
  // §11.2 lets a PI outrank a Caution-tone PC by usefulness. Prominence is bought with these sentences.
  ok("★ every PI's Doesn't-mean does advice-block — the job §11.2's prominence rule depends on",
    PI_IDS.every((id) => READ_TIME_COPY[id]!.job.includes("advice-block")));

  // ── the doc 2 §9 tone/loud table, asserted against what the code emits ──
  const everything = fire({
    facts: [
      F("E1", "etf", { name: "Premium ETF", lastPrice: "62.40", currentNav: "55.70", lastPriceDate: "2026-07-13", navDate: "2026-07-13" }),
      F("M1", "mutual_fund", { planType: "regular" }),
      F("D1", "mutual_fund", { isActive: false, navDate: "2022-01-27" }),
      F("T1", "etf", { name: "Tracker" }),
      F("R1", "reit", { attributes: { distributionYield: 6.4 } }),
      F("B1", "bond", { attributes: { maturityYear: 2027 } }),
      F("B2", "gsec", { attributes: { maturityYear: 2034 } }),
    ],
    analytics: [A("M1"), A("T1", { trackingError1y: 0.0576, benchmarkIndex: "Nifty PSU Bank", benchmarkVia: "name" })],
  });
  console.log(`\n       fired: ${ids(everything).join(", ")}\n`);
  for (const f of everything) console.log(`       ${f.id} ${f.tone.padEnd(11)} ${f.loud ? "LOUD " : "quiet"} ${f.notEvaluable ? "[not-evaluable]" : ""} ${f.label}`);

  const TONE_TABLE: Record<string, { tone: string; loud: boolean }> = {
    PI1: { tone: "Caution", loud: true },   // Trading away from NAV
    PI3: { tone: "Caution", loud: true },   // Dormant scheme
    PI4: { tone: "Neutral", loud: false },  // Tracking gap
    PI5: { tone: "Neutral", loud: false },  // Deepest fall
    PI7: { tone: "Neutral", loud: false },  // Distribution yield
    PI8: { tone: "Neutral", loud: false },  // Maturity profile
  };
  for (const [id, want] of Object.entries(TONE_TABLE)) {
    const f = get(everything, id);
    ok(`doc 2 §9 table: ${id} = ${want.tone} · ${want.loud ? "Loud" : "Quiet"}`,
      !!f && f.tone === want.tone && f.loud === want.loud, f ? `${f.tone} ${f.loud ? "Loud" : "Quiet"}` : "DID NOT FIRE");
  }
  ok("★ every PI is family PI", everything.every((f) => f.family === "PI"));

  // ── advice-verb grep = 0, across EVERY read this file produced, evaluable and not ──
  const allReads = [...everything, ...fire({
    facts: [F("L1", "etf", { lastPrice: "22.50", currentNav: "18.77", lastPriceDate: "2026-07-13", navDate: "2026-07-10" })],
  })];
  let hits = 0;
  for (const f of allReads) {
    const r = scanStringsForForwardLanguage(f.id, [f.read ?? ""], PORTFOLIO_ADVICE_DENY_LIST);
    if (r.length) { hits += r.length; console.log(`       ❌ ${f.id}: ${JSON.stringify(r)} in "${f.read}"`); }
  }
  ok("★ advice-verb grep = 0 across every PI read", hits === 0, `${allReads.length} reads scanned`);

  // ★ AND ACROSS THE REFUSAL AND NOT-EVALUABLE READS TOO — the sentences most likely to reach for a verb.
  const refusals = [
    ...fire({ facts: [F("X", "mutual_fund")], analytics: [A("X", { maxDrawdown1y: null, maxDrawdown3y: null, maxDrawdown5y: null, omissions: { max_drawdown_5y: "idcw_nav_not_total_return" } })] }),
    ...fire({ facts: [F("Y", "mutual_fund")], analytics: [A("Y", { maxDrawdown5y: 0, maxDrawdown3y: null, maxDrawdown1y: null, omissions: { max_drawdown_3y: "withheld_implausible" } })] }),
    ...fireD({ facts: [F("Z", "etf", { lastPrice: "1", currentNav: "1", lastPriceDate: "2026-07-13", navDate: "2026-07-10" })] }),
  ];
  let rhits = 0;
  for (const f of refusals) {
    const r = scanStringsForForwardLanguage(f.id, [f.read ?? ""], PORTFOLIO_ADVICE_DENY_LIST);
    if (r.length) { rhits += r.length; console.log(`       ❌ ${f.id}: ${JSON.stringify(r)}`); }
  }
  ok("★ advice-verb grep = 0 across every REFUSAL / not-evaluable read too", rhits === 0, `${refusals.length} scanned`);

  ok("negative control: the scanner DOES catch advice",
    scanStringsForForwardLanguage("CTRL", ["You should consider switching to the Direct plan."], PORTFOLIO_ADVICE_DENY_LIST).length > 0);
}

console.log("\n" + "═".repeat(96));
console.log(fail === 0 ? "  ✅ PI FAMILY — ALL PASS" : `  ❌ ${fail} FAILURE(S)`);
console.log("═".repeat(96));
await prisma.$disconnect();
process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
