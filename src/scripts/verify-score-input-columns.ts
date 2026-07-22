// ═══════════════════════════════════════════════════════════════
// BUILD GATE — every column of every scoring-input table must be CLASSIFIED.
//
// The rescore trigger fires only when a SCORE-RELEVANT column moves. That makes the manifest in
// src/scoring/inputs/score-input-columns.ts load-bearing for CORRECTNESS, not just tidiness: a
// column that is score-relevant but missing from the manifest is a change the trigger will never
// see — a permanently stale score, failing silently and looking healthy.
//
// The dangerous default is "unclassified ⇒ cosmetic". This gate removes that default: it reads
// the field list straight out of prisma/schema.prisma and fails if ANY field is missing from both
// lists, or listed twice, or listed but no longer on the model. Add a column to one of these five
// tables and the build stops until you have said, explicitly, whether the scorer reads it.
//
// Run: npx tsx src/scripts/verify-score-input-columns.ts
// (Sibling of verify-t5-omission-keys.ts — same key-side-gate discipline.)
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { SCORE_INPUT_COLUMNS, type ScoreInputTable } from "../scoring/inputs/score-input-columns.js";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(here, "../../prisma/schema.prisma");

/** Scalar + relation field names declared on a Prisma model, in declaration order. */
function modelFields(schema: string, model: string): string[] {
  const m = schema.match(new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`verify-score-input-columns: model "${model}" not found in schema.prisma`);
  const out: string[] = [];
  for (const raw of m[1]!.split("\n")) {
    const line = raw.trim();
    // Skip blanks, comments, block attributes (@@index / @@map / @@unique).
    if (!line || line.startsWith("//") || line.startsWith("///") || line.startsWith("@@")) continue;
    const f = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s+\S/);
    if (f) out.push(f[1]!);
  }
  return out;
}

const schema = readFileSync(SCHEMA, "utf8");
let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  FAIL  ${msg}`); };

console.log("\n═══ SCORE-INPUT COLUMN CLASSIFICATION GATE ═══\n");

for (const table of Object.keys(SCORE_INPUT_COLUMNS) as ScoreInputTable[]) {
  const spec = SCORE_INPUT_COLUMNS[table];
  const declared = modelFields(schema, spec.model);
  const classified = [...spec.relevant, ...spec.cosmetic, ...spec.relations];

  const seen = new Set<string>();
  const dupes = classified.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
  const missing = declared.filter((d) => !seen.has(d));
  const stale = classified.filter((c) => !declared.includes(c));

  console.log(
    `${table} (${spec.model}) — ${declared.length} fields: ` +
      `${spec.relevant.length} relevant / ${spec.cosmetic.length} cosmetic / ${spec.relations.length} relation`,
  );
  console.log(`  ↳ derived from ${spec.derivedFrom}`);

  if (missing.length)
    fail(
      `${table}: ${missing.length} field(s) NOT CLASSIFIED — ${missing.join(", ")}. ` +
        `Classify each as relevant or cosmetic against ${spec.derivedFrom}. ` +
        `An unclassified column must never default to cosmetic.`,
    );
  if (dupes.length) fail(`${table}: field(s) classified more than once — ${dupes.join(", ")}`);
  if (stale.length)
    fail(`${table}: classified field(s) no longer on the model — ${stale.join(", ")} (remove them)`);
  if (!missing.length && !dupes.length && !stale.length) console.log("  PASS  every field classified exactly once");
  console.log("");
}

// The asymmetries this gate exists to protect. Hard-asserted so a "tidy-up" that unifies them
// across tables fails loudly rather than silently dropping Foundation / banking-annual changes.
console.log("── per-table asymmetry assertions ──");
const asym: [ScoreInputTable, string, "relevant" | "cosmetic"][] = [
  ["quarterly_results", "operatingMargin", "cosmetic"],
  ["fundamentals", "operatingMargin", "relevant"],
  ["banking_quarterly_results", "pcr", "cosmetic"],
  ["banking_fundamentals", "pcr", "relevant"],
  ["banking_quarterly_results", "nii", "cosmetic"],
  ["banking_fundamentals", "nii", "relevant"],
  ["shareholding_patterns", "promoterPledgedPct", "cosmetic"],
  ["shareholding_patterns", "pledgedShares", "relevant"],
];
for (const [table, col, expect] of asym) {
  const spec = SCORE_INPUT_COLUMNS[table];
  const actual = spec.relevant.includes(col) ? "relevant" : spec.cosmetic.includes(col) ? "cosmetic" : "MISSING";
  if (actual === expect) console.log(`  PASS  ${table}.${col} is ${expect}`);
  else fail(`${table}.${col} must be ${expect}, found ${actual} — the per-table split is load-bearing`);
}

console.log(
  failures === 0
    ? "\n✅ ALL CLASSIFIED — no column can silently default to cosmetic.\n"
    : `\n❌ ${failures} FAILURE(S) — fix the manifest before shipping.\n`,
);
process.exit(failures === 0 ? 0 : 1);
