// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STOP GATE 2 + 3 — the RESULT SHAPE and the SPREAD RESPONSE, asserted on the finished text.
//
// These assert the STRING the model reads, not the object behind it. Every lesson encoded here was
// learned live on a previous build, so each check names the failure it prevents.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import { getUniverseMetricValues } from "../scoring/read/metric-values.cache.js";
import { screenUniverse } from "../scoring/read/screen.service.js";
import { renderScreen, assertNoMetricCodes } from "../chat/screen-brief.js";
import { SCREEN_FIELDS_IDS } from "../scoring/read/screen.types.js";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const view = await getUniverseHealthView();
  const values = await getUniverseMetricValues();
  const R = async (req: Parameters<typeof screenUniverse>[3]) =>
    renderScreen(await screenUniverse(view, values, null, req));

  const roe20 = await R({ conditions: [{ field: "returnOnEquity", min: 20 }] });
  const pristinePharma = await R({ conditions: [], band: "Pristine", sector: "Pharma & Healthcare", redFlags: "none" });
  const spreadRoe = await R({ conditions: [{ field: "returnOnEquity" }] });
  const spreadFoundation = await R({ conditions: [{ field: "foundation" }] });
  const noMatch = await R({ conditions: [{ field: "returnOnEquity", min: 200 }] });
  const twoMetric = await R({ conditions: [{ field: "returnOnEquity", min: 20 }, { field: "debtToEquity", max: 0.5 }] });

  console.log(`\n═══ 2a/2b · CAPPED + EVALUABLE ═══`);
  ok("cap is 12 and the bound is stated as a sentence", /SAY "12 of 32"/.test(roe20));
  ok("the evaluable denominator appears with both numbers", /82 could be tested/.test(roe20) && /not 94/.test(roe20));
  ok("the spec's exact claim is renderable", /Of the 94 companies in this read, 82 could be tested on return on equity/.test(roe20));
  ok("banks explained as measured-on-banking, not as missing data", /measured on banking metrics instead/.test(roe20));
  ok("not-evaluable is explicitly NOT a failure", /NOT COMPANIES THAT FAILED THE TEST/.test(roe20) && /not missing data/.test(roe20));
  ok("evaluable block present even when nothing was excluded", /EVALUABLE: all 2 companies/.test(pristinePharma),
     "the rule must not be one the model learns only sometimes");

  console.log(`\n═══ 2c · COUNTS LEAD AND NAME THE SENTENCE ═══`);
  const denomIdx = roe20.indexOf("THE DENOMINATOR");
  const firstRow = roe20.indexOf("  · CUMMINSIND");
  ok("the denominator precedes the first company row", denomIdx > -1 && firstRow > denomIdx, `denominator@${denomIdx} < row@${firstRow}`);
  const matchIdx = roe20.indexOf("MATCHES: 32");
  ok("the match count precedes the first company row", matchIdx > -1 && firstRow > matchIdx);
  ok("the cap instruction says what to SAY, not just the number", /do not imply this is all of them/.test(roe20));
  ok("no trailing-parenthetical bound (the skipped-footnote failure)", !/\(showing 12 of 32/.test(roe20));

  console.log(`\n═══ 2d · PERIOD CONTRACT, UNCHANGED ═══`);
  for (const [name, text] of [["matches", roe20], ["spread", spreadRoe], ["no-match", noMatch]] as const) {
    ok(`${name} carries the period block`, /HOW TO SAY THE DATE/.test(text) && /Quarters actually represented/.test(text));
  }
  ok("the forbidden sentence-shape is shown as forbidden", /NEVER name one quarter as though it covered them all/.test(roe20));

  // ── The period mix drifts every time a stock rescores onto a newer quarter — "64 at FY27Q1, 30 at
  //    FY26Q4" was true the day this was written and false a rescore later. That's not a fact worth
  //    pinning; what has to hold on ANY day is the RELATIONSHIP: the rendered breakdown is exactly the
  //    live period contract (not stale, not invented), the per-period counts foot to the stated total,
  //    and the "mixed" sentence appears if and only if more than one period is actually represented.
  const roe20Proj = await screenUniverse(view, values, null, { conditions: [{ field: "returnOnEquity", min: 20 }] });
  if (roe20Proj.kind !== "matches") throw new Error("expected a matches projection for the period-mix assertions");
  const period = roe20Proj.period;
  const spreadPhrase = period.spread.map((s) => `${s.count} at ${s.period}`).join(", ");
  ok("the rendered quarter breakdown is exactly the live period contract, not a fixed snapshot",
     spreadPhrase.length > 0 && roe20.includes(spreadPhrase), spreadPhrase);
  ok("the per-period counts foot to the stated companies-read total",
     period.spread.reduce((sum, s) => sum + s.count, 0) === period.companiesRead,
     `${period.spread.map((s) => s.count).join("+")} = ${period.companiesRead}`);
  ok(`the "mixed" sentence appears iff more than one period is actually represented (currently ${period.mixed})`,
     period.mixed === /more than one, which is why no single label fits/.test(roe20));
  ok("no single-quarter scope claim is constructible from the text", !/as of FY\d\dQ\d, \d+ companies/i.test(roe20));

  console.log(`\n═══ 2e · EVERY ROW CARRIES ITS VALUES ═══`);
  const rows = twoMetric.split("\n").filter((l) => /^  · [A-Z]/.test(l));
  const allHaveBoth = rows.every((l) => /return on equity [\d.]+%/.test(l) && /debt to equity [\d.]+/.test(l));
  ok("both condition values appear on EVERY row", rows.length > 0 && allHaveBoth, `${rows.length} rows`);
  ok("values carry their unit, never bare", /return on equity 29\.5%/.test(roe20));
  ok("the anti-join instruction is present", /Quote them from that line and nowhere else/.test(twoMetric),
     "the measured five-of-six mis-attribution");
  ok("there is no second list to mis-join against", !/companies firing/i.test(twoMetric));

  console.log(`\n═══ 2f · SORT ═══`);
  ok("default sort is health, stated", /ordered by health score, highest first|by health score, highest first/.test(roe20));
  const byField = await R({ conditions: [{ field: "debtToEquity", max: 1 }], sort: "field" });
  ok("sort=field uses the first condition and its direction", /debt to equity, lowest first/.test(byField),
     "lower-is-better fields sort ascending");
  const twoSorted = await R({ conditions: [{ field: "returnOnEquity", min: 20 }, { field: "debtToEquity", max: 0.5 }], sort: "field" });
  ok("sort=field with two conditions names only the FIRST", /return on equity, highest first/.test(twoSorted) && !/debt to equity, /.test(twoSorted.split("MATCHES")[0].split("CONDITIONS")[1] ?? ""));

  console.log(`\n═══ 3a · A FIELD WITH NO BOUNDS RETURNS THE SPREAD ═══`);
  ok("spread result is produced, not an error", /what the numbers actually look like/.test(spreadRoe));
  ok("all five statistics present", /Lowest -7\.66%/.test(spreadRoe) && /a quarter are below/.test(spreadRoe) && /the middle is/.test(spreadRoe) && /a quarter are above/.test(spreadRoe) && /highest 83\.66%/.test(spreadRoe));
  ok("the spread carries its own evaluable denominator", /82 could be tested on return on equity/.test(spreadRoe));
  ok("spread returns NO company list", !/^  · [A-Z]{3,}/m.test(spreadRoe.split("RETURN ON EQUITY")[1] ?? ""));
  // A MIXED request — one bounded, one unbounded — must still refuse to invent the missing one.
  const mixed = await R({ conditions: [{ field: "returnOnEquity" }, { field: "debtToEquity", max: 1 }] });
  ok("a MIXED request still refuses to invent the missing threshold", /DO NOT PICK A THRESHOLD/.test(mixed) && !/MATCHES:/.test(mixed),
     "answering half with a guessed bar for the other half is the failure this prevents");

  console.log(`\n═══ 3b · IT NAMES THE SENTENCE ═══`);
  ok("says Vytal has no such line", /VYTAL HAS NO SUCH LINE/.test(spreadRoe));
  ok("says the judgement is the reader's", /that judgement is the reader's and Vytal does not make it/.test(spreadRoe));
  ok("forbids taking a threshold from the model's own knowledge", /do not take one from your own knowledge/.test(spreadRoe));
  ok("forbids the median being read as a pass mark", /do not treat the median below as a pass mark/.test(spreadRoe));
  ok("asks for a figure and says what to do next", /ask for a figure|ask which figure they want/.test(spreadRoe) && /call this tool again with that number/.test(spreadRoe));
  ok("the five statistics are labelled as descriptions, not grades", /they are not grades, and none of them is a recommended cut-off/.test(spreadRoe));

  console.log(`\n═══ 3c · PILLAR ADJECTIVES TAKE THE SAME PATH ═══`);
  ok('"strong Foundation" resolves to the Foundation spread', /FOUNDATION — across the companies/.test(spreadFoundation));
  ok("Foundation is 100% evaluable (no false gap)", /EVALUABLE: all 94 companies/.test(spreadFoundation));
  ok("the spread text never calls a company strong or weak", !/\b(strong|weak)\b/i.test(spreadFoundation.replace(/"strong", "high", "low", "solid"/g, "")),
     "‘Strong’ is a portfolio-ladder word the context layer forbids for a stock");
  ok("no borrowed pond vocabulary (PG_STRONG / share-clearing-bar)", !/PG_STRONG|PG_WEAK|clearing/i.test(spreadFoundation));

  console.log(`\n═══ 3d · A THRESHOLD CANNOT BE RECEIVED THAT WAS NOT SUPPLIED ═══`);
  // ── Structural proof, built from the OBJECT rather than from hand-listed constants ──────────────
  //    Every number in the spread body must be one the data produced: an order statistic, a count, or
  //    a companies-read figure. The period block is excluded because it legitimately carries dates and
  //    fiscal-quarter labels ("2026-07-31", "64 at FY27Q1"), which are not thresholds.
  const proj = await screenUniverse(view, values, null, { conditions: [{ field: "returnOnEquity" }] });
  if (proj.kind !== "spread") throw new Error("expected a spread projection");
  const f = proj.spreads[0];
  const legal = new Set<number>([
    f.min, f.p25, f.median, f.p75, f.max,
    f.evaluable.considered, f.evaluable.evaluable, f.evaluable.notEvaluable,
    proj.period.companiesRead,
    // rounding/《about N》 guidance the period block generates from the count itself
    Math.round(proj.period.companiesRead / 10) * 10, Math.ceil(proj.period.companiesRead / 50) * 50,
    // the capped not-evaluable list renders "N names, and R more" — both derived from the data
    ...f.evaluable.reasons.flatMap((r) => [r.count, r.companies.shown.length, r.companies.total - r.companies.shown.length]),
  ]);
  const body = spreadRoe.slice(spreadRoe.indexOf("★ THE READER DESCRIBED A LEVEL"));
  const strays = [...new Set((body.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number))].filter((n) => !legal.has(n));
  ok("every number in the spread body is a statistic or a count from the data",
     strays.length === 0, strays.length ? `unexplained: ${strays.join(", ")}` : `all of {${[...legal].join(", ")}}`);
  ok("the SpreadResult type has no field that could carry a threshold",
     !("threshold" in f) && !("suggested" in f) && !("cutoff" in f) && Object.keys(f).length === 10,
     `keys: ${Object.keys(f).join(", ")}`);

  // ── "recommend" appears exactly once, INSIDE a negation. Asserting the property, not the word. ───
  const recommends = [...spreadRoe.matchAll(/[^.\n]*\brecommend\w*[^.\n]*/g)].map((m) => m[0].trim());
  ok("every use of 'recommend' is a negation, never a recommendation",
     recommends.length > 0 && recommends.every((s) => /\b(none|not|never|no)\b/i.test(s)),
     recommends.map((s) => `"…${s.slice(-46)}"`).join(" | ") || "(absent)");
  ok("no directive verb aimed at the READER's decision", !/\byou should (buy|hold|sell|pick|choose a)\b/i.test(spreadRoe));

  console.log(`\n═══ NO INTERNAL IDENTIFIERS (5i, asserted early) ═══`);
  let codeLeak = 0;
  for (const id of SCREEN_FIELDS_IDS) {
    for (const t of [await R({ conditions: [{ field: id, min: 1 }] }), await R({ conditions: [{ field: id }] })]) {
      try { assertNoMetricCodes(t); } catch (e) { codeLeak++; console.log(`     ${id}: ${(e as Error).message}`); }
    }
  }
  ok("no engine metric code in any of the 28 rendered results", codeLeak === 0, `all ${SCREEN_FIELDS_IDS.length} fields × both modes`);
  ok("the code detector actually works", (() => { try { assertNoMetricCodes("metric F2 is 20"); return false; } catch { return true; } })(),
     "negative control");
  ok("raw band enum never rendered", !/below_par/.test(roe20 + spreadRoe + noMatch + pristinePharma));

  console.log(`\n═══ SIZE ═══`);
  for (const [n, t] of [["ROE≥20 matches", roe20], ["Pristine pharma", pristinePharma], ["ROE spread", spreadRoe], ["no match", noMatch]] as const) {
    console.log(`  ${n.padEnd(18)} ${String(t.length).padStart(5)} chars ≈ ${String(Math.round(t.length / 4)).padStart(4)} tokens`);
  }

  console.log(`\n${fail === 0 ? "✅ STOP GATE 2 + 3 PASSED" : `❌ ${fail} FAILED`} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
