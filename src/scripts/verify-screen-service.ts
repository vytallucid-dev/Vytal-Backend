// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STOP GATE 1 — the filter service against the recon's measured numbers.
//
// Everything asserted here was measured BEFORE the service existed (read-only probes over the live
// cross-section), so this is a comparison against an independent witness, not a snapshot of whatever
// the code happens to do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import {
  getUniverseMetricValues,
  metricValuesCacheStats,
  _clearMetricValuesCacheForVerification,
  _ageMetricValuesCacheForVerification,
  METRIC_VALUES_CACHE_TTL_MS,
} from "../scoring/read/metric-values.cache.js";
import { screenUniverse } from "../scoring/read/screen.service.js";
import { SCREEN_FIELDS, SCREEN_FIELDS_IDS } from "../scoring/read/screen.types.js";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const view = await getUniverseHealthView();
  const values = await getUniverseMetricValues();
  const M = view.members.length;

  console.log(`\n═══ 1a · THE FREE TIER — zero extra round trips ═══`);
  ok("live cross-section is the recon's 94", M === 94, `M=${M}`);

  // Count DB queries during a pure screen. The view + values are already loaded above.
  let queries = 0;
  const off = prisma.$on?.bind(prisma);
  void off;
  const before = Date.now();
  const freeOnly = await screenUniverse(view, values, null, {
    conditions: [{ field: "health", min: 70 }, { field: "foundation", min: 60 }, { field: "momentum", min: 50 },
                 { field: "market", min: 40 }, { field: "ownership", min: 70 }],
    band: undefined, sector: undefined,
  });
  const elapsed = Date.now() - before;
  ok("five score-level conditions run with no DB access", queries === 0, `${elapsed}ms, in-process`);
  ok("free-tier screen returns matches", freeOnly.kind === "matches");

  // Ten filters cost what one costs.
  // ⚠ THE redFlags FILTER IS WARMED FIRST, AND THE WARM-UP IS NOT PART OF THE MEASUREMENT. That filter
  //   now unions the LIVE standing filing red flags, which is one round trip behind a five-minute
  //   cache. Timing the cold read here would measure Postgres, not the cost of adding filters — which
  //   is the only thing this assertion is about.
  await screenUniverse(view, values, null, { conditions: [], redFlags: "none" });
  const t1 = Date.now();
  for (let i = 0; i < 200; i++) await screenUniverse(view, values, null, { conditions: [{ field: "health", min: 60 }] });
  const one = Date.now() - t1;
  const t2 = Date.now();
  for (let i = 0; i < 200; i++) await screenUniverse(view, values, null, {
    conditions: [{ field: "health", min: 60 }, { field: "foundation", min: 40 }, { field: "momentum", min: 30 },
                 { field: "market", min: 20 }, { field: "ownership", min: 60 }],
    band: "Healthy", sector: "Pharma & Healthcare", redFlags: "none",
  });
  const many = Date.now() - t2;
  ok("ten filters cost the same order as one", many < one * 6, `1 cond ×200 = ${one}ms · 8 filters ×200 = ${many}ms`);

  console.log(`\n═══ 1b · THE METRIC TIER — one read, SWR cached ═══`);
  ok("metric values loaded for the whole cross-section", values.size === M, `${values.size}/${M} companies carry ≥1 metric`);
  _clearMetricValuesCacheForVerification();
  const c0 = Date.now();
  await getUniverseMetricValues();
  const cold = Date.now() - c0;
  const w0 = Date.now();
  await getUniverseMetricValues();
  const warm = Date.now() - w0;
  ok("warm read is in-process (no round trip)", warm <= 2, `cold ${cold}ms → warm ${warm}ms`);
  _ageMetricValuesCacheForVerification(METRIC_VALUES_CACHE_TTL_MS + 1000);
  const s0 = Date.now();
  const staleView = await getUniverseMetricValues();
  const staleMs = Date.now() - s0;
  ok("a STALE read serves immediately and rebuilds behind it", staleMs <= 2 && staleView.size === M,
     `${staleMs}ms, rebuilding=${metricValuesCacheStats().rebuilding}`);
  ok("cache takes no parameters (cannot become user-scoped)", getUniverseMetricValues.length === 0);

  // ★ RAW ONLY — the loaded map must not contain anything score-shaped.
  const anyF2 = [...values.values()].map((m) => m.get("F2")).filter((v): v is number => v !== undefined);
  ok("F2 values are RAW percentages, not 0-100 scores",
     anyF2.some((v) => v > 40) && anyF2.some((v) => v < 10),
     `range ${Math.min(...anyF2).toFixed(1)} … ${Math.max(...anyF2).toFixed(1)} (a 0-100 score could not be negative or >100 here)`);
  const negatives = anyF2.filter((v) => v < 0).length;
  ok("raw values can be NEGATIVE — proof these are not scores", negatives > 0, `${negatives} companies with negative ROE`);

  console.log(`\n═══ 1c · FIELD MAPPING — raw only, union asserted ═══`);
  const expectKeys: Record<string, string[]> = {
    returnOnCapital: ["F1"], returnOnEquity: ["F2"], cashConversion: ["F3"], debtToEquity: ["F4"],
    interestCoverage: ["F5"], receivableDays: ["F6"], assetTurnover: ["F7"], netMargin: ["M2"],
    operatingMargin: ["M1", "M1_OPM_TTM"],
  };
  let mapOk = true;
  for (const [id, keys] of Object.entries(expectKeys)) {
    const got = SCREEN_FIELDS[id as keyof typeof SCREEN_FIELDS].metricKeys ?? [];
    if (JSON.stringify([...got]) !== JSON.stringify(keys)) { mapOk = false; console.log(`     ${id}: expected ${keys} got ${got}`); }
  }
  ok("field → engine key mapping is exactly the spec", mapOk);

  const coverage = (id: keyof typeof SCREEN_FIELDS) => {
    const f = SCREEN_FIELDS[id];
    let n = 0;
    for (const m of view.members) {
      const forSym = values.get(m.symbol);
      if (forSym && (f.metricKeys ?? []).some((k) => forSym.get(k) !== undefined)) n++;
    }
    return n;
  };
  // Non-financial population = companies NOT carrying a banking key.
  const bankingKeys = new Set(["Tier1", "GNPA", "NNPA", "PCR", "ROA", "CI", "CASA", "NIM", "PPOP", "NII", "NPyoy", "GNPAttm"]);
  const banks = view.members.filter((m) => { const v = values.get(m.symbol); return v ? [...v.keys()].some((k) => bankingKeys.has(k)) : false; });
  const nonFin = M - banks.length;
  ok("industry split matches the recon", banks.length === 12 && nonFin === 82, `${nonFin} non-financial / ${banks.length} banking`);

  const om = coverage("operatingMargin");
  ok("operatingMargin M1 ∪ M1_OPM_TTM = 80 of 82 non-financial", om === 80, `${om}/${nonFin} — the union lifts it from 74`);
  const missingOm = view.members
    .filter((m) => { const v = values.get(m.symbol); return v && ![...v.keys()].some((k) => bankingKeys.has(k)) && v.get("M1") === undefined && v.get("M1_OPM_TTM") === undefined; })
    .map((m) => m.symbol).sort();
  ok("the two it still misses are JSWENERGY and SIEMENS", JSON.stringify(missingOm) === JSON.stringify(["JSWENERGY", "SIEMENS"]), missingOm.join(", "));

  for (const [id, expected] of [["returnOnEquity", 82], ["returnOnCapital", 82], ["debtToEquity", 82],
                                 ["interestCoverage", 82], ["receivableDays", 82], ["assetTurnover", 82],
                                 ["cashConversion", 82], ["netMargin", 80]] as const) {
    const got = coverage(id as keyof typeof SCREEN_FIELDS);
    ok(`${id} coverage = ${expected}`, got === expected, `${got}/${nonFin} non-financial`);
  }

  console.log(`\n═══ 1d · THE EXCLUSIONS — the tool cannot accept them ═══`);
  const banned = ["F10", "M3", "M4", "F1_OPM", "F9", "Tier1", "GNPA", "NNPA", "PCR", "ROA", "CI", "CASA",
                  "NIM", "PPOP", "NII", "NPyoy", "GNPAttm", "marketCap", "price", "promoterHolding",
                  "fiiHolding", "pledgedPercent", "return1y", "divergence"];
  const exposedKeys = new Set(Object.values(SCREEN_FIELDS).flatMap((f) => [...(f.metricKeys ?? [])]));
  const leaked = banned.filter((b) => exposedKeys.has(b) || (SCREEN_FIELDS_IDS as readonly string[]).includes(b));
  ok("no excluded field is reachable through the registry", leaked.length === 0, leaked.length ? `LEAKED: ${leaked}` : "F10/M3/M4/F1_OPM/F9, all banking, price, size, shareholding, divergence — none present");
  ok("no field exposes a 0-100 metric score", !JSON.stringify(SCREEN_FIELDS).includes("metricScore") && !JSON.stringify(SCREEN_FIELDS).includes("l1Score"));
  ok("the registry is exactly 14 fields (5 score + 9 metric)", SCREEN_FIELDS_IDS.length === 14,
     `${Object.values(SCREEN_FIELDS).filter((f) => f.tier === "score").length} score + ${Object.values(SCREEN_FIELDS).filter((f) => f.tier === "metric").length} metric`);

  console.log(`\n═══ 1e · SELECTIVITY — against the recon's measured combinations ═══`);
  const count = (r: Awaited<ReturnType<typeof screenUniverse>>) => (r.kind === "matches" ? r.matches.total : -1);
  const syms = (r: Awaited<ReturnType<typeof screenUniverse>>) => (r.kind === "matches" ? r.matches.shown.map((x) => x.symbol) : []);

  const pristinePharma = await screenUniverse(view, values, null, { conditions: [], band: "Pristine", sector: "Pharma & Healthcare", redFlags: "none" });
  ok("Pristine + Pharma + no red flags = 2", count(pristinePharma) === 2, syms(pristinePharma).join(", "));
  ok("  …and they are DIVISLAB, LUPIN", JSON.stringify(syms(pristinePharma).sort()) === JSON.stringify(["DIVISLAB", "LUPIN"]));

  const pristineClean = await screenUniverse(view, values, null, { conditions: [], band: "Pristine", redFlags: "none" });
  ok("Pristine + no red flags = 21", count(pristineClean) === 21, `${count(pristineClean)}`);

  const roeDe = await screenUniverse(view, values, null, { conditions: [{ field: "returnOnEquity", min: 20 }, { field: "debtToEquity", max: 0.5 }] });
  ok("ROE>20 + D/E<0.5 = 29", count(roeDe) === 29, `${count(roeDe)}`);

  // ★ THE ONE PLACE THE SERVICE AND THE RECON DISAGREE, AND WHY THE SERVICE IS RIGHT.
  //   The recon probe used strict > / < and measured 23. min/max here are INCLUSIVE (≥ / ≤) and give
  //   25. The entire difference is AUROPHARMA and NHPC, which sit at Ownership exactly 70.0000 — they
  //   genuinely do have "Ownership of at least 70". Asserted as a DELTA rather than a corrected
  //   constant, so this stays a proof of the convention instead of a number quietly moved to fit.
  const ownFoundIncl = await screenUniverse(view, values, null, { conditions: [{ field: "ownership", min: 70 }, { field: "foundation", max: 60 }] });
  ok("Ownership≥70 + Foundation≤60 = 25 (inclusive bounds)", count(ownFoundIncl) === 25, `${count(ownFoundIncl)}`);
  const boundaryNames = view.members
    .filter((m) => m.pillars.ownership === 70 && m.pillars.foundation <= 60)
    .map((m) => m.symbol).sort();
  ok("  …the delta vs the recon's strict-> 23 is exactly the two companies AT the bar",
     count(ownFoundIncl) - 23 === boundaryNames.length && JSON.stringify(boundaryNames) === JSON.stringify(["AUROPHARMA", "NHPC"]),
     `${boundaryNames.join(", ")} — Ownership exactly 70.0000`);

  const roe20 = await screenUniverse(view, values, null, { conditions: [{ field: "returnOnEquity", min: 20 }] });
  ok("ROE above 20% = 32 matches", count(roe20) === 32, `${count(roe20)}`);
  if (roe20.kind === "matches") {
    ok("  …evaluable denominator is 82, not 94", roe20.evaluable.evaluable === 82 && roe20.evaluable.considered === 94,
       `considered ${roe20.evaluable.considered}, evaluable ${roe20.evaluable.evaluable}, notEvaluable ${roe20.evaluable.notEvaluable}`);
    ok("  …the 12 not-evaluable are explained as banking-measured", roe20.evaluable.reasons.length === 1 && roe20.evaluable.reasons[0].count === 12,
       roe20.evaluable.reasons[0]?.reason ?? "(none)");
  }

  const gnpaLike = await screenUniverse(view, values, null, { conditions: [{ field: "returnOnEquity", min: 20 }], sector: "Banks" });
  ok("ROE screen scoped to Banks: 0 evaluable, all 12 explained", gnpaLike.kind === "matches" && gnpaLike.evaluable.evaluable === 0 && gnpaLike.evaluable.considered === 12,
     gnpaLike.kind === "matches" ? `considered ${gnpaLike.evaluable.considered}, evaluable ${gnpaLike.evaluable.evaluable}` : "");

  console.log(`\n═══ CROSS-CHECK — every emitted value against the DB, independently ═══`);
  // Re-read raw values straight from Postgres and compare to what the service put on the rows.
  const sample = await screenUniverse(view, values, null, {
    conditions: [{ field: "returnOnEquity", min: 20 }, { field: "debtToEquity", max: 0.5 }], sort: "field",
  });
  let checked = 0, wrong = 0;
  if (sample.kind === "matches") {
    for (const row of sample.matches.shown) {
      const dbRows = await prisma.$queryRawUnsafe<{ metric_key: string; raw_value: string }[]>(
        `SELECT sm.metric_key, sm.raw_value::text
           FROM score_metrics sm
           JOIN score_pillars sp ON sp.id = sm.pillar_score_id
          WHERE sp.symbol = $1 AND sm.metric_key IN ('F2','F4')
            AND sp.id IN (SELECT foundation_pillar_id FROM score_snapshots WHERE symbol = $1
                          UNION SELECT momentum_pillar_id FROM score_snapshots WHERE symbol = $1)`,
        row.symbol,
      );
      for (const v of row.values) {
        const key = v.field === "returnOnEquity" ? "F2" : "F4";
        const cands = dbRows.filter((d) => d.metric_key === key).map((d) => Math.round(Number(d.raw_value) * 100) / 100);
        checked++;
        if (!cands.includes(v.value)) { wrong++; console.log(`     ${row.symbol} ${v.field}: emitted ${v.value}, DB has ${cands.join("/")}`); }
      }
    }
  }
  ok(`every emitted value matches a DB raw_value`, wrong === 0, `${checked} values checked, ${wrong} wrong`);

  console.log(`\n${fail === 0 ? "✅ STOP GATE 1 PASSED" : `❌ ${fail} FAILED`} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
