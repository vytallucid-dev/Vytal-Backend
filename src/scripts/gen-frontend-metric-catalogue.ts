// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE METRIC-CATALOGUE GENERATOR — reads the two manifests + the two gloss catalogues, emits the
// frontend's ratios table.
//
// ── ★ WHY GENERATED AND NOT HAND-LISTED ─────────────────────────────────────────────────────────
// The statements table's rows are hand-authored in `Vytal-Frontend/components/stock-detail/
// statement-lines.ts`, and that is exactly the drift the catalogue exists to prevent: the results
// feed and the brief card already disagreed once on whether a life insurer's top line is called
// "Net premium" or "Premiums kept", because two files each decided. Two repos cannot share a module
// without a package, and a package is a new dependency — so the frontend gets a BUILD ARTEFACT of
// the backend's manifests instead, exactly as `gen-frontend-fallback.ts` does for the findings copy.
// One authoring home; the frontend copy is a cached view of it; `--check` fails CI if it goes stale.
//
// ── ⚠⚠ WHAT IS CARRIED, AND THE ONE THING THAT IS DELIBERATELY NOT ──────────────────────────────
// CARRIED     the label and both gloss clauses · the DISPLAY UNIT · the view field to read · the
//             bounds and their reader-facing reason · lowerIsBetter · comparable + its reason.
//
// NOT CARRIED `scale`, and not the multiplier behind it. The fundamentals view is already
//             unit-canonical — see metric-view-fields.ts's header — so shipping the fraction→percent
//             factor to a surface that has already had it applied is how 1.83% becomes 183%. The
//             unit survives as a SYMBOL (%, ×, days, ₹/share) and the arithmetic does not survive at
//             all. This is the single most important line in this file.
//
// NOT CARRIED the money metrics. The statements table already renders more ₹ detail than either
//             manifest declares; this is the measures it has never had.
//
//   npx tsx src/scripts/gen-frontend-metric-catalogue.ts            # write
//   npx tsx src/scripts/gen-frontend-metric-catalogue.ts --check    # exit 1 if the committed file differs
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { annualMetricGloss, type AnnualMetricKey } from "../catalogue/annual-metrics.js";
import { metricGloss, type MetricKey } from "../catalogue/quarter-metrics.js";
import {
  ANNUAL_VIEW_FIELD,
  QUARTER_VIEW_FIELD,
  displayUnitFor,
  type DisplayUnit,
} from "../catalogue/metric-view-fields.js";
import { annualManifestFor } from "../insight/quarter-brief/annual-manifest.js";
import { manifestFor, TOP_LINE_KEY, type Family } from "../insight/quarter-brief/manifest.js";

const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "..", "Vytal-Frontend");
const OUT = resolve(FRONTEND_DIR, "lib/metrics/generated/metric-catalogue.generated.ts");

const FAMILIES: Family[] = ["non_financial", "banking", "nbfc", "life_insurance", "general_insurance"];

interface Emitted {
  key: string;
  label: string;
  meaning: string;
  doesntMean: string;
  unit: DisplayUnit;
  viewField: string;
  min: number | null;
  max: number | null;
  outOfRangeReason: string | null;
  lowerIsBetter: boolean;
  comparable: boolean;
  comparabilityReason: string | null;
}

function quarterMetrics(family: Family): Emitted[] {
  const fields = QUARTER_VIEW_FIELD[family] as Record<string, string>;
  const out: Emitted[] = [];
  for (const spec of manifestFor(family)) {
    const viewField = fields[spec.key];
    if (!viewField) continue; // money lines, and the ratios the view does not carry — see the map
    const unit = displayUnitFor(spec.scale);
    if (!unit) continue;
    const gloss = metricGloss(spec.key as MetricKey);
    out.push({
      key: spec.key,
      label: gloss.label,
      meaning: gloss.meaning,
      doesntMean: gloss.doesntMean,
      unit,
      viewField,
      min: spec.bounds?.min ?? null,
      max: spec.bounds?.max ?? null,
      outOfRangeReason: spec.outOfRangeReason,
      lowerIsBetter: spec.lowerIsBetter === true,
      comparable: true, // no quarterly metric declares itself incomparable
      comparabilityReason: null,
    });
  }
  return out;
}

function annualMetrics(family: Family): Emitted[] {
  const fields = ANNUAL_VIEW_FIELD[family] as Record<string, string>;
  const out: Emitted[] = [];
  for (const spec of annualManifestFor(family)) {
    const viewField = fields[spec.key];
    if (!viewField) continue;
    const unit = displayUnitFor(spec.scale);
    if (!unit) continue;
    const gloss = annualMetricGloss(spec.key as AnnualMetricKey);
    out.push({
      key: spec.key,
      label: gloss.label,
      meaning: gloss.meaning,
      doesntMean: gloss.doesntMean,
      unit,
      viewField,
      min: spec.bounds?.min ?? null,
      max: spec.bounds?.max ?? null,
      outOfRangeReason: spec.outOfRangeReason,
      lowerIsBetter: spec.lowerIsBetter === true,
      comparable: spec.comparable !== false,
      comparabilityReason: spec.comparabilityReason ?? null,
    });
  }
  return out;
}

const HEADER = `// ⚠⚠ GENERATED FILE — DO NOT EDIT. ⚠⚠
//
// Emitted by Vytal-Backend/src/scripts/gen-frontend-metric-catalogue.ts from the QUARTER and ANNUAL
// manifests and the two gloss catalogues. Editing it here is editing a cache: the next run overwrites
// it, and \`npm run verify:cross-repo\` in the backend FAILS while it differs.
//
// To change a label, a bound or a reason: change the backend catalogue, re-run the generator, commit
// both. That is the whole point — one authoring home for a figure's identity, so this surface and the
// Quarter in Brief card cannot word the same metric two ways.
//
// ── ★ THE UNIT IS A SYMBOL, NOT A CONVERSION ────────────────────────────────────────────────────
// Every value these rows read off the fundamentals view is ALREADY canonical: percentages in percent,
// multiples as numbers, money in ₹ crore. \`unit\` says what to PRINT after the number. There is no
// scale factor in this file and there must never be one — applying the manifest's fraction→percent
// factor to a figure the read layer has already converted renders 1.83% as 183%.
//
// ── \`bounds\` IS A MEANING CHECK, NOT AN ARITHMETIC ONE ─────────────────────────────────────────
// Outside them the figure is WITHHELD and \`outOfRangeReason\` is shown in its place. Everything it
// rejects divided correctly — SBILIFE's persistency is stored a hundredfold too small, and no bound
// on "is this a plausible percentage" catches it except this one.
`;

function render(): string {
  const body = (name: string, per: (f: Family) => Emitted[]) =>
    `export const ${name}: Record<MetricFamily, CatalogueMetric[]> = ${JSON.stringify(
      Object.fromEntries(FAMILIES.map((f) => [f, per(f)])),
      null,
      2,
    )};`;

  return [
    HEADER,
    "",
    `export type MetricFamily = ${FAMILIES.map((f) => JSON.stringify(f)).join(" | ")};`,
    "",
    `/** What to print after the number. NEVER a conversion — see the header. */`,
    `export type DisplayUnit = "%" | "×" | "days" | "₹/share";`,
    "",
    "export interface CatalogueMetric {",
    "  /** The catalogue key. Stable across both repos. */",
    "  key: string;",
    "  /** The reader's heading for this figure — the gloss catalogue's, never a column name. */",
    "  label: string;",
    "  meaning: string;",
    "  doesntMean: string;",
    "  unit: DisplayUnit;",
    "  /** The field to read off this family's fundamentals-view row. */",
    "  viewField: string;",
    "  /** DISPLAY-unit bounds. Outside them the figure is withheld with `outOfRangeReason`. */",
    "  min: number | null;",
    "  max: number | null;",
    "  outOfRangeReason: string | null;",
    "  lowerIsBetter: boolean;",
    "  /** false ⇒ show the LEVEL and never a year-on-year move. `comparabilityReason` says why. */",
    "  comparable: boolean;",
    "  comparabilityReason: string | null;",
    "}",
    "",
    body("QUARTER_METRICS", quarterMetrics),
    "",
    body("ANNUAL_METRICS", annualMetrics),
    "",
    "/**",
    " * ★ THE LINES THAT ALWAYS SHOW, WHATEVER ELSE IS COLLAPSED — every family's TOP LINE, plus net",
    " * profit. Emitted as LABELS because that is all `BriefLine` carries: the payload has no metric",
    " * key and no family, and this is the one way the card can identify them without guessing at text.",
    " *",
    " * ⚠ MEASURED, WHICH IS WHY THIS EXISTS. Ranking by anchor-then-moved alone buried NET PROFIT on",
    " * 13 of 16 stored cards: nearly every rupee line clears the 3% materiality cut, so the 'moved'",
    " * tier filled all five slots in manifest order (revenue, other income, total costs, depreciation,",
    " * interest cost) and net profit — tenth — never made it. A guaranteed slot is the only rule that",
    " * survives that.",
    " *",
    " * ⚠ THE TOP-LINE LABEL IS NOT 'Revenue' ON THREE OF THE FIVE FAMILIES. It is net interest income",
    " * on a bank (THIRD in the manifest, behind two interest lines), premiums kept on a life insurer",
    " * and premiums sold on a general one. That is precisely why this is generated from TOP_LINE_KEY",
    " * and the gloss catalogue rather than hand-listed in the frontend.",
    " */",
    `export const ALWAYS_SHOWN_LABELS: string[] = ${JSON.stringify(
      [...new Set([...FAMILIES.map((f) => metricGloss(TOP_LINE_KEY[f]).label), metricGloss("netProfit").label])].sort(),
      null,
      2,
    )};`,
    "",
  ].join("\n");
}

function main(): void {
  const check = process.argv.includes("--check");
  const next = render();

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current === next) {
      const n = FAMILIES.reduce((s, f) => s + quarterMetrics(f).length + annualMetrics(f).length, 0);
      console.log(`✅ frontend metric catalogue is FRESH — ${n} measures across ${FAMILIES.length} families`);
      return;
    }
    console.error(
      `❌ frontend metric catalogue is STALE at ${OUT}\n` +
        `   Run: npx tsx src/scripts/gen-frontend-metric-catalogue.ts`,
    );
    process.exit(1);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, next, "utf8");
  for (const f of FAMILIES) {
    console.log(`  ${f.padEnd(20)} quarter ${String(quarterMetrics(f).length).padStart(2)}  ·  annual ${String(annualMetrics(f).length).padStart(2)}`);
  }
  console.log(`\n✅ wrote ${OUT}`);
}

main();
