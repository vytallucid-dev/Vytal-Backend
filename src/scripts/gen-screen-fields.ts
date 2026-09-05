// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GENERATOR — the screen's filterable vocabulary, DERIVED from the data model.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ WHY THIS IS GENERATED AND NOT AUTHORED.
//
// The screen filtered on THIRTEEN fields — `SCREEN_FIELDS_IDS`, a hand-kept list — and every reader
// who asked for a fourteenth got a definition card. Measured live:
//
//     "give me a list of stocks whose revenue in its latest quarter is greater than 100cr"
//         → meta.define, "This is a line item companies file, defined as we read it."
//
// Revenue. The most basic screen anybody will ask for, and it is not a SCORED metric, so the list did
// not have it. A hand-kept list of filterable fields will always lag what we hold, and every gap
// reads as a bug to whoever hits it.
//
// ★ SO THE VOCABULARY IS AN INTERSECTION OF TWO THINGS WE ALREADY MAINTAIN FOR OTHER REASONS:
//
//     WHAT EXISTS       prisma/schema.prisma — the data model itself. A column is a fact.
//     WHAT IT IS CALLED the 109 metric glosses, with the aliases authored onto them, so `ROE`,
//                       `return on equity` and `return on shareholders' money` reach one field.
//
//   A field is screenable when a reader has a name for it AND we have somewhere to read it from.
//   Adding a column and its gloss makes it screenable with nobody remembering to do anything, and
//   `--check` fails the build if the two drift apart.
//
// ⚠ WHY A GENERATED FILE RATHER THAN PARSING THE SCHEMA AT RUNTIME. `prisma-client` (the new
//   generator this repo uses) emits TYPES, not a runtime DMMF — there is no `Prisma.dmmf` to read. The
//   alternative is reading `schema.prisma` off disk in the server process, which puts file I/O and a
//   parser on a read path and fails differently on a deploy box. The repo already has the answer:
//   `gen-frontend-fallback.ts`, `gen-frontend-metric-catalogue.ts` and `gen-frontend-section-types.ts`
//   all generate-and-check. This is the fourth of that family.
//
// ⚠ BUT IT IS WIRED INTO `build`, WHERE THOSE THREE DELIBERATELY ARE NOT — and the difference is the
//   rule `verify-build-gate-hygiene.ts` enforces. Those three write into the SIBLING REPO, which does
//   not exist on the deploy box, so they belong to `verify:cross-repo`. This one reads
//   prisma/schema.prisma and writes into src/, both inside this checkout, so it is build-legal — and
//   it HAS to be in `build`, because the whole claim is that adding a column without regenerating
//   fails. The hygiene gate caught this file claiming build-time enforcement from a chain `build`
//   never runs, which is exactly the "promised gate that never runs" class it exists for.
//
// ── ★ THE UNIT IS DERIVED TOO, AND IT IS NOT COSMETIC ────────────────────────────────────────────
// `cet1Ratio` is stored as a FRACTION (0.8907 = 89.07%) and the schema says so in a comment beside the
// column. A reader typing "core capital above 15%" means 0.15 in that column and 15 in a PERCENT one.
// A screen that ignored the unit would return everything or nothing, silently. So the `UNIT:` comments
// the schema already carries are read, and a column with none is CURRENCY (₹ Cr) when it is
// Decimal(18,2) — the convention every money column in this schema follows — and refused otherwise
// rather than guessed at.
//
//   npx tsx src/scripts/gen-screen-fields.ts          — write
//   npx tsx src/scripts/gen-screen-fields.ts --check  — fail if stale
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { QUARTER_METRIC_GLOSSES } from "../catalogue/quarter-metrics.js";
import { ANNUAL_METRIC_GLOSSES } from "../catalogue/annual-metrics.js";

const ROOT = process.cwd();
const SCHEMA = resolve(ROOT, "prisma/schema.prisma");
const OUT = resolve(ROOT, "src/scoring/read/screen-fields.generated.ts");

/**
 * ★ THE FINANCIAL TABLES, BY INDUSTRY AND GRAIN — the one hand-written thing in this generator, and
 *   it is a statement about which models are FINANCIAL STATEMENTS rather than a list of fields.
 *
 * ⚠ IT IS RECONCILED AGAINST `IndustryType`, so a sixth industry cannot be added to the enum without
 *   this failing. That is the drift this generator exists to prevent, one level up.
 */
const FINANCIAL_MODELS: readonly {
  model: string; grain: "quarterly" | "annual"; industry: string;
}[] = [
  { model: "QuarterlyResult", grain: "quarterly", industry: "non_financial" },
  { model: "BankingQuarterlyResult", grain: "quarterly", industry: "banking" },
  { model: "NbfcQuarterlyResult", grain: "quarterly", industry: "nbfc" },
  { model: "LifeInsuranceQuarterlyResult", grain: "quarterly", industry: "life_insurance" },
  { model: "GeneralInsuranceQuarterlyResult", grain: "quarterly", industry: "general_insurance" },
  { model: "Fundamental", grain: "annual", industry: "non_financial" },
  { model: "BankingFundamental", grain: "annual", industry: "banking" },
  { model: "NbfcFundamental", grain: "annual", industry: "nbfc" },
  { model: "LifeInsuranceFundamental", grain: "annual", industry: "life_insurance" },
  { model: "GeneralInsuranceFundamental", grain: "annual", industry: "general_insurance" },
];

interface ParsedField { field: string; column: string; unit: string | null; decimal: [number, number] | null }
interface ParsedModel { name: string; table: string; fields: ParsedField[] }

function parseSchema(src: string): Map<string, ParsedModel> {
  const out = new Map<string, ParsedModel>();
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const name = m[1]!;
    const body = m[2]!;
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name;
    const fields: ParsedField[] = [];
    for (const line of body.split("\n")) {
      // Numeric scalars only. A screen filters on numbers; a `String` column is a different feature.
      const f = /^\s{2}(\w+)\s+(Decimal|Float|Int|BigInt)\??\s*(.*)$/.exec(line);
      if (!f) continue;
      const rest = f[3] ?? "";
      const dec = /@db\.Decimal\((\d+),\s*(\d+)\)/.exec(rest);
      fields.push({
        field: f[1]!,
        column: /@map\("([^"]+)"\)/.exec(rest)?.[1] ?? f[1]!,
        unit: (/UNIT:\s*(\w+)/i.exec(rest)?.[1] ?? null)?.toUpperCase() ?? null,
        decimal: dec ? [Number(dec[1]), Number(dec[2])] : null,
      });
    }
    out.set(name, { name, table, fields });
  }
  return out;
}

/**
 * How a reader's number maps onto the stored one. See the header for why this cannot be skipped.
 *
 * ★ THE SET IS THE SCHEMA'S OWN, COUNTED RATHER THAN INVENTED. Every `// UNIT:` annotation in
 *   schema.prisma, by frequency: PERCENT 42 · FRACTION 39 · "RUPEES per share" 20 · TIMES 3 ·
 *   MULTIPLE 3. The first draft of this generator handled three of those five and silently refused
 *   `basicEps`, `dilutedEps`, `bookValuePerShare` and `interestCoverage` — twenty-six columns a
 *   reader would obviously want to screen on, dropped because the generator's vocabulary was
 *   narrower than the schema's.
 */
type Unit = "currency" | "percent" | "fraction" | "perShare" | "times";

function unitOf(f: ParsedField): Unit | null {
  switch (f.unit) {
    case "PERCENT": return "percent";      // 15.3 means 15.3%
    case "FRACTION": return "fraction";    // 0.153 means 15.3%
    case "RUPEES": return "perShare";      // "RUPEES per share"
    case "TIMES": case "MULTIPLE": return "times";
    default: break;
  }
  // ⚠ THE CONVENTION, NOT A GUESS: every money column in this schema is Decimal(18,2), in ₹ crore.
  //   333 columns follow it and none of them carries a UNIT comment, because it is the default.
  if (f.decimal && f.decimal[0] === 18 && f.decimal[1] === 2) return "currency";
  // ⚠ ANYTHING ELSE IS REFUSED RATHER THAN ASSUMED. Decimal(10,2) with no annotation is
  //   `receivablesDays` — days, not rupees — and guessing currency there would filter a day count
  //   against a crore threshold and return nothing, with no way for the reader to see why. A field
  //   refused here is still reachable through the SCORED metric path where it has one.
  return null;
}

function main(): void {
  const check = process.argv.includes("--check");
  const models = parseSchema(readFileSync(SCHEMA, "utf8"));

  const missing = FINANCIAL_MODELS.filter((f) => !models.has(f.model));
  if (missing.length) {
    console.error(`❌ these financial models are not in the schema: ${missing.map((m) => m.model).join(", ")}`);
    process.exit(1);
  }

  // ⚠ RECONCILE AGAINST THE ENUM. A sixth industry added to `IndustryType` with no tables named here
  //   would silently be unscreenable, which is the drift this whole generator exists to stop.
  const enumBody = /enum\s+IndustryType\s*\{([\s\S]*?)\}/.exec(readFileSync(SCHEMA, "utf8"))?.[1] ?? "";
  const industries = new Set(enumBody.split("\n").map((l) => l.trim()).filter((l) => /^\w+$/.test(l)));
  const covered = new Set(FINANCIAL_MODELS.map((f) => f.industry));
  const uncovered = [...industries].filter((i) => !covered.has(i));
  if (uncovered.length) {
    console.error(`❌ IndustryType has ${uncovered.join(", ")} with no financial table named in this generator`);
    process.exit(1);
  }

  const glosses = { ...QUARTER_METRIC_GLOSSES, ...ANNUAL_METRIC_GLOSSES } as Record<
    string, { label: string; aliases?: readonly string[] }
  >;

  interface Source { table: string; column: string; grain: string; industry: string }
  interface Field { key: string; label: string; aliases: string[]; unit: Unit; sources: Source[] }

  const fields: Field[] = [];
  const noUnit: string[] = [];
  for (const key of Object.keys(glosses).sort()) {
    const sources: Source[] = [];
    let unit: Unit | null = null;
    for (const fm of FINANCIAL_MODELS) {
      const pf = models.get(fm.model)!.fields.find((x) => x.field === key);
      if (!pf) continue;
      const u = unitOf(pf);
      if (u === null) continue;
      // ⚠ ONE UNIT PER FIELD. If two tables store the same reader-name in different units, the reader's
      //   number would mean two things in one screen — so the field is dropped and reported, never
      //   half-registered.
      if (unit !== null && unit !== u) { unit = null; sources.length = 0; break; }
      unit = u;
      sources.push({ table: models.get(fm.model)!.table, column: pf.column, grain: fm.grain, industry: fm.industry });
    }
    if (!sources.length || unit === null) {
      if (Object.keys(glosses).includes(key)) noUnit.push(key);
      continue;
    }
    const g = glosses[key]!;
    fields.push({ key, label: g.label, aliases: [...(g.aliases ?? [])], unit, sources });
  }

  const body = `// ⚠⚠ GENERATED — DO NOT EDIT. Run \`npx tsx src/scripts/gen-screen-fields.ts\`.
//
// The screen's filterable vocabulary, derived from prisma/schema.prisma (what exists) and the metric
// gloss registries (what a reader calls it). See src/scripts/gen-screen-fields.ts for why.
//
// ${fields.length} fields, from ${new Set(fields.flatMap((f) => f.sources.map((s) => s.table))).size} tables.

/** How a reader's number maps onto the stored one — a percent typed against a fraction column is a
 *  screen that silently returns everything or nothing. */
export type ScreenFieldUnit = "currency" | "percent" | "fraction" | "perShare" | "times";

export interface ScreenFieldSource {
  readonly table: string;
  readonly column: string;
  readonly grain: "quarterly" | "annual";
  readonly industry: string;
}

export interface DerivedScreenField {
  /** The gloss key, which is also the Prisma field name. Never rendered. */
  readonly key: string;
  /** The reader-facing name, from the gloss. */
  readonly label: string;
  /** Everything else a reader might type for it, authored on the gloss. */
  readonly aliases: readonly string[];
  readonly unit: ScreenFieldUnit;
  /** Every table that stores it, by industry and grain. */
  readonly sources: readonly ScreenFieldSource[];
}

export const DERIVED_SCREEN_FIELDS: readonly DerivedScreenField[] = Object.freeze([
${fields.map((f) => `  { key: ${JSON.stringify(f.key)}, label: ${JSON.stringify(f.label)}, aliases: ${JSON.stringify(f.aliases)}, unit: ${JSON.stringify(f.unit)},
    sources: [${f.sources.map((s) => `{ table: ${JSON.stringify(s.table)}, column: ${JSON.stringify(s.column)}, grain: ${JSON.stringify(s.grain)}, industry: ${JSON.stringify(s.industry)} }`).join(", ")}] },`).join("\n")}
]);
`;

  if (check) {
    const have = (() => { try { return readFileSync(OUT, "utf8"); } catch { return ""; } })();
    if (have !== body) {
      console.error("❌ screen fields are STALE — a column or a gloss moved and the registry was not regenerated.");
      console.error("   npx tsx src/scripts/gen-screen-fields.ts");
      process.exit(1);
    }
    console.log(`✅ screen fields FRESH — ${fields.length} filterable fields`);
    return;
  }

  writeFileSync(OUT, body, "utf8");
  console.log(`✅ wrote ${OUT}`);
  console.log(`   ${fields.length} filterable fields · ${noUnit.length} gloss keys with no stored column or no derivable unit`);
  const byUnit = new Map<string, number>();
  for (const f of fields) byUnit.set(f.unit, (byUnit.get(f.unit) ?? 0) + 1);
  console.log(`   by unit: ${[...byUnit].map(([u, n]) => `${u}=${n}`).join(" ")}`);
  console.log(`   not screenable (computed at read time, or no unit): ${noUnit.slice(0, 12).join(", ")}${noUnit.length > 12 ? ` … +${noUnit.length - 12}` : ""}`);
}

main();
