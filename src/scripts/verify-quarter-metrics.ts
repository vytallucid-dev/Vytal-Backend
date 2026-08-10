// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BUILD GATE — the metric manifest and its gloss catalogue.
//
// ── WHAT THE COMPILER ALREADY HOLDS, AND WHY THIS STILL EXISTS ────────────────────────────────────
// Two of the strongest rules are enforced by TYPES, not here:
//   · a manifest metric with no gloss    — `key: MetricKey` is keyof the gloss record ⇒ compile error
//   · a fetcher that drops a metric      — `values: Record<MetricKeyOf<F>, …>` ⇒ compile error
// This gate covers what types cannot see: the REVERSE direction (a gloss nothing uses), the CONTENT of
// the copy, and the per-metric invariants that the Stage-0 measurements bought and that a later edit
// could quietly undo.
//
// ⚠ THE POINT IS THE UNDOABLE ONES. "operatingProfit is ineligible for every bridge" is a fact someone
// will be tempted to reverse in six months because the column looks like it should work. It closed no
// identity (4% / 1% / 1%) and the gate is what makes reversing it loud.
//
// PURE. No database. Reads the two modules and asserts. Runs in `npm run verify:copy`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { QUARTER_METRIC_GLOSSES, METRIC_KEYS, type MetricKey } from "../catalogue/quarter-metrics.js";
import { FAMILY_MANIFEST, TOP_LINE_KEY, type Family, type MetricSpec } from "../insight/quarter-brief/manifest.js";

let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
};
const section = (s: string) => console.log(`\n${s}`);

const FAMILIES = Object.keys(FAMILY_MANIFEST) as Family[];
const specs = (f: Family): readonly MetricSpec[] => FAMILY_MANIFEST[f] as readonly MetricSpec[];
const allSpecs: { family: Family; spec: MetricSpec }[] = FAMILIES.flatMap((family) =>
  specs(family).map((spec) => ({ family, spec })),
);

function main(): void {
  // ── §1 · COVERAGE, BOTH DIRECTIONS ──────────────────────────────────────────────────────────────
  section("§1 · Coverage");
  const used = new Set<MetricKey>(allSpecs.map(({ spec }) => spec.key));
  const orphans = METRIC_KEYS.filter((k) => !used.has(k));
  ok(
    "every gloss is used by at least one manifest (no orphan copy)",
    orphans.length === 0,
    orphans.length ? `orphans: ${orphans.join(", ")}` : `${used.size} glosses, all used`,
  );
  ok(
    "every manifest metric resolves to a gloss (compiler-enforced; re-asserted at runtime)",
    allSpecs.every(({ spec }) => spec.key in QUARTER_METRIC_GLOSSES),
    `${allSpecs.length} manifest slots across ${FAMILIES.length} families`,
  );
  for (const f of FAMILIES) {
    const keys = specs(f).map((s) => s.key);
    ok(`${f}: no duplicate metric within the family`, new Set(keys).size === keys.length);
  }

  // ── §2 · COPY CONTENT ───────────────────────────────────────────────────────────────────────────
  section("§2 · Copy content");
  for (const key of METRIC_KEYS) {
    const g = QUARTER_METRIC_GLOSSES[key];
    if (!g.label.trim() || !g.meaning.trim() || !g.doesntMean.trim()) {
      ok(`${key}: label, meaning and doesntMean all present`, false, "empty field");
      continue;
    }
    // A doesntMean is REQUIRED on every entry — the house rule the PHS library set and the catalogue
    // adopted for all four registries. It is inherited here rather than re-decided.
    if (g.doesntMean.length < 40) ok(`${key}: doesntMean is a sentence, not a stub`, false, `${g.doesntMean.length} chars`);
    // ⚠ PROSE, NOT "≠". A screen reader announces the glyph as "not equal to", and this copy renders
    // inside a card with no italics or left border to carry its meaning. See the module header.
    if (/≠/.test(g.meaning) || /≠/.test(g.doesntMean)) ok(`${key}: no "≠" glyph`, false, "uses ≠");
    // ONE sentence. A meaning that runs to two has stopped being a gloss and started being a paragraph.
    if (/\.\s+[A-Z]/.test(g.meaning)) ok(`${key}: meaning is one sentence`, false, g.meaning.slice(0, 60));
    if (!g.label.trim() || g.label.length > 48) ok(`${key}: label is short enough to be a heading`, false, g.label);
  }
  ok(
    "all glosses: three fields present, prose not glyphs, meaning is one sentence",
    fail === 0,
    `${METRIC_KEYS.length} entries checked`,
  );
  // NEGATIVE CONTROL — a gate nobody can see fail is not evidence. Prove the ≠ scan actually fires.
  ok("negative control: the ≠ scan detects a glyph when one is present", /≠/.test("≠ this is the PHS form"));
  ok("negative control: the one-sentence scan detects a second sentence", /\.\s+[A-Z]/.test("One thing. Another thing."));

  // ── §3 · SCALE AND BOUNDS ───────────────────────────────────────────────────────────────────────
  section("§3 · Scale and bounds");
  for (const { family, spec } of allSpecs) {
    const at = `${family}.${spec.key}`;
    if (!spec.source.trim()) ok(`${at}: declares a source column or derivation`, false);
    // Bounds and their reason travel together. A bound with no reader-facing reason suppresses a metric
    // and cannot say why — which is the silent-absence failure the gaps copy exists to prevent.
    ok(
      `${at}: bounds and outOfRangeReason are both set or both absent`,
      (spec.bounds === null) === (spec.outOfRangeReason === null),
      spec.bounds === null ? "unbounded" : "bounded",
    );
    if (spec.scale === "money") {
      // Money lines use the shared MONEY_STEADY_PCT (= the verdict's own LINE_MATERIAL_PCT), so a
      // per-metric band here would be a SECOND threshold and could contradict the badge.
      ok(`${at}: money line carries no per-metric steady band`, spec.steadyBand === null);
    } else {
      ok(`${at}: ratio/multiple has a steady band`, spec.steadyBand !== null && spec.steadyBand > 0);
      ok(`${at}: steady band records what it was fitted on`, Boolean(spec.steadyBandBasis?.trim()));
      ok(`${at}: ratio/multiple is bounded`, spec.bounds !== null);
    }
  }
  // A gloss shared across families must mean the same thing in each — including its unit. A shared
  // entry whose scale differed between two families would render the same words at two magnitudes.
  const scaleByKey = new Map<MetricKey, { family: Family; scale: string }>();
  for (const { family, spec } of allSpecs) {
    const seen = scaleByKey.get(spec.key);
    if (seen && seen.scale !== spec.scale) {
      ok(`${spec.key}: same scale in every family that reports it`, false, `${seen.family}=${seen.scale} vs ${family}=${spec.scale}`);
    }
    if (!seen) scaleByKey.set(spec.key, { family, scale: spec.scale });
  }
  ok("shared glosses carry one scale across every family that reports them", true, `${scaleByKey.size} distinct keys`);

  // ── §4 · THE STAGE-0 RULINGS. These are the undoable ones. ──────────────────────────────────────
  section("§4 · Stage-0 rulings (C15 / C17 / C18 / C19)");

  // C15 — operatingProfit closes NO identity and may never enter a bridge.
  for (const { family, spec } of allSpecs) {
    if (spec.key === "operatingProfit") {
      ok(`C15 · ${family}.operatingProfit is driver-ineligible, permanently`, spec.driver === "ineligible", spec.driver);
      ok(`C15 · ${family}.operatingProfit records WHY (the trap someone rebuilds)`, /closes NO identity/i.test(spec.note ?? ""));
    }
  }

  // C18 — the top line and the residual bucket are reported, never named.
  for (const f of FAMILIES) {
    const topKey = TOP_LINE_KEY[f];
    const top = specs(f).find((s) => s.key === topKey);
    ok(`C18 · ${f}: reports its top line (${topKey})`, Boolean(top));
    if (top) ok(`C18 · ${f}.${topKey} is never named as the driver`, top.driver !== "eligible", top.driver);
  }
  const residual = allSpecs.find(({ spec }) => spec.key === "otherOperatingCosts");
  ok("C18 · otherOperatingCosts (the residual bucket) is context, never eligible", residual?.spec.driver === "context");

  // C17 — per-family driver scope.
  const eligible = (f: Family) => specs(f).filter((s) => s.driver === "eligible").map((s) => s.key);
  ok("C17 · life_insurance has NO driver-eligible metric", eligible("life_insurance").length === 0, "0 eligible, by design");
  const lifeTax = specs("life_insurance").find((s) => s.key === "tax");
  ok(
    "C17 · life_insurance.tax records why the bridge cannot close (so nobody retries it)",
    /policyholder tax/i.test(lifeTax?.note ?? "") && /6%/.test(lifeTax?.note ?? ""),
  );
  ok("C17 · banking has driver-eligible metrics", eligible("banking").length >= 3, eligible("banking").join(", "));
  ok("C17 · non_financial has driver-eligible metrics", eligible("non_financial").length >= 3, eligible("non_financial").join(", "));
  ok(
    "C17 · nbfc names total costs as ONE line, not its components",
    eligible("nbfc").includes("totalExpenses") &&
      !eligible("nbfc").includes("impairmentOnFinancialInstruments") &&
      !eligible("nbfc").includes("financeCosts"),
    eligible("nbfc").join(", "),
  );
  ok(
    "C17 · general_insurance's eligible set is the UNDERWRITING bridge only (never net profit)",
    eligible("general_insurance").every((k) => ["incurredClaims", "netCommission", "insuranceRunningCosts"].includes(k)),
    eligible("general_insurance").join(", "),
  );
  const giPbt = specs("general_insurance").find((s) => s.key === "profitBeforeTax");
  ok("C17 · general_insurance.profitBeforeTax is marked unreachable from the bridge", spec_has(giPbt, /NOT REACHABLE/i));

  // C19 — banking's opex term is the subtraction, and the wrong form is named as wrong.
  const bankOpex = specs("banking").find((s) => s.key === "operatingExpenses");
  ok("C19 · banking.operatingExpenses is derived by subtraction", /expenditure_excl_provisions − interest_expended/.test(bankOpex?.source ?? ""));
  ok("C19 · banking.operatingExpenses records why the additive form is wrong", /0 of 231/.test(bankOpex?.note ?? ""));

  // A ratio can never be a rupee driver — a share-of-move figure is measured in money.
  ok(
    "no ratio or multiple is driver-eligible (a share-of-move figure is measured in rupees)",
    allSpecs.every(({ spec }) => spec.scale === "money" || spec.driver !== "eligible"),
  );

  // ── §5 · WHAT WE PROMISE NOT TO PROMISE (1e) ────────────────────────────────────────────────────
  section("§5 · Not quarterly-computable");
  // NIM, credit cost, AUM, spread and leverage all need annual-only inputs (average assets, advances,
  // loan book, borrowings). Promising them on a quarterly card would be inventing a metric.
  const FORBIDDEN = /^(nim|netInterestMargin|creditCost|creditCostPct|aum|loans|spread|leverage|borrowingsToEquity|capitalToAssetsRatio)$/i;
  const promised = METRIC_KEYS.filter((k) => FORBIDDEN.test(k));
  ok("no annual-only metric is in the gloss catalogue", promised.length === 0, promised.join(", ") || "none");

  console.log(
    `\n${fail === 0 ? `✅ QUARTER-METRIC GATES PASS — ${METRIC_KEYS.length} glosses, ${allSpecs.length} manifest slots, every Stage-0 ruling held` : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

function spec_has(s: MetricSpec | undefined, re: RegExp): boolean {
  return re.test(s?.note ?? "");
}

main();
