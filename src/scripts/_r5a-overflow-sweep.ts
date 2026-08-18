// ═══════════════════════════════════════════════════════════════
// R5-A — THE OVERFLOW SWEEP. Static analysis + MEASURED headroom.
//   npx tsx src/scripts/_r5a-overflow-sweep.ts
//
// The ADANIENSOL/BHARATFORG losses came from a derived percentage exceeding a
// narrow Decimal(p,s) column and failing the WHOLE upsert. The guard on that
// division is `denominator !== 0` — which a NEAR-zero denominator passes.
//
// This finds every OTHER place with the same shape, and then MEASURES how close
// the live data already sits to each ceiling, so "latent risk" becomes a number.
//
// ⚠ ATTRIBUTION. A derive module owns ONE model. Grouping by field NAME across
//   models is wrong and was wrong in the first cut of this script: banking's
//   roe/pcr/netInterestMargin are Decimal(8,6) FRACTIONS (ceiling ~100 is
//   generous for a fraction), while Ind-AS roe/operatingMargin are Decimal(8,4)
//   PERCENTS (ceiling 9999.9999). Conflating them reports a false alarm.
//   Each finding is therefore attributed to its module's own model.
//
// ⚠ REPORT ONLY. Nothing here changes the write path.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const SCHEMA = "prisma/schema.prisma";
const DERIVE_DIR = "src/ingestions/quaterly-results/derive";
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];

// each derive module owns exactly one model (financial-quarterly owns four)
const FILE_MODEL: Record<string, string[]> = {
  "derive-indas-annual.ts": ["Fundamental"],
  "derive-indas-quarterly.ts": ["QuarterlyResult"],
  "derive-banking-annual.ts": ["BankingFundamental"],
  "derive-nbfc-annual.ts": ["NbfcFundamental"],
  "derive-li-annual.ts": ["LifeInsuranceFundamental"],
  "derive-gi-annual.ts": ["GeneralInsuranceFundamental"],
  "derive-financial-quarterly.ts": ["BankingQuarterlyResult", "NbfcQuarterlyResult", "LifeInsuranceQuarterlyResult", "GeneralInsuranceQuarterlyResult"],
};
const MODEL_TABLE: Record<string, string> = {
  Fundamental: "fundamentals", QuarterlyResult: "quarterly_results",
  BankingFundamental: "banking_fundamentals", BankingQuarterlyResult: "banking_quarterly_results",
  NbfcFundamental: "nbfc_fundamentals", NbfcQuarterlyResult: "nbfc_quarterly_results",
  LifeInsuranceFundamental: "li_fundamentals", LifeInsuranceQuarterlyResult: "li_quarterly_results",
  GeneralInsuranceFundamental: "gi_fundamentals", GeneralInsuranceQuarterlyResult: "gi_quarterly_results",
};
const RUN_TABLES = new Set(["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]);
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

// ── 1. Decimal columns per model, with unit hint from the schema comment ──
interface Col { model: string; field: string; p: number; s: number; ceiling: number; unit: string }
const schema = readFileSync(SCHEMA, "utf8");
const colMap = new Map<string, Col>();
let model = "";
for (const line of schema.split("\n")) {
  const m = /^model\s+(\w+)\s*\{/.exec(line.trim());
  if (m) { model = m[1]; continue; }
  if (line.trim() === "}") { model = ""; continue; }
  if (!model) continue;
  const d = /^\s*(\w+)\s+Decimal\?*\s.*@db\.Decimal\((\d+),\s*(\d+)\)(.*)$/.exec(line);
  if (!d) continue;
  const p = +d[2], s = +d[3], tail = d[4] ?? "";
  const unit = /percent|%/i.test(tail) ? "percent" : /ratio|fraction/i.test(tail) ? "ratio" : "unmarked";
  colMap.set(`${model}.${d[1]}`, { model, field: d[1], p, s, ceiling: 10 ** (p - s), unit });
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5-A — OVERFLOW SWEEP · unbounded narrow derived ratios + MEASURED headroom║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  interface F { file: string; model: string; table: string; field: string; ceiling: number; unit: string; bounded: boolean; guard: string }
  const findings: F[] = [];
  for (const file of readdirSync(DERIVE_DIR).filter((f) => f.endsWith(".ts"))) {
    const lines = readFileSync(`${DERIVE_DIR}/${file}`, "utf8").split("\n");
    for (const mdl of FILE_MODEL[file] ?? []) {
      for (const [key, col] of colMap) {
        if (col.model !== mdl) continue;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          if (ln.trim().startsWith("//")) continue;
          if (!new RegExp(`(const\\s+${col.field}\\s*=|^\\s*${col.field}\\s*:)`).test(ln)) continue;
          const expr = lines.slice(i, i + 4).join(" ").replace(/\s+/g, " ");
          if (!/\//.test(expr)) continue;
          const bounded = /boundDerived/.test(expr);
          const guard = /!==\s*0/.test(expr) ? "divide-by-zero only"
                      : /Math\.min|Math\.max|clamp/i.test(expr) ? "clamped" : "none visible";
          findings.push({ file, model: mdl, table: MODEL_TABLE[mdl], field: col.field, ceiling: col.ceiling, unit: col.unit, bounded, guard });
          void key;
          break;
        }
      }
    }
  }

  const exposed = findings.filter((f) => !f.bounded);
  const bounded = findings.filter((f) => f.bounded);
  console.log(`  derived ratios that DIVIDE into a bounded-precision column : ${findings.length}`);
  console.log(`    ✓ passed through boundDerived() : ${bounded.length}`);
  console.log(`    ⚠ UNBOUNDED                     : ${exposed.length}`);
  console.log(`\n  ⚠ ONLY ${bounded.length} ratio in the whole derive layer is bounded: ${bounded.map((b) => `${b.model}.${b.field}`).join(", ") || "(none)"}`);

  // ── 2. MEASURED headroom, live ──
  console.log(`\n  ── measured headroom: how close the live data already sits to each ceiling ──`);
  console.log(`  ${pad("table", 27)}${pad("field", 22)}${pad("unit", 9)}${lp("ceiling", 11)}${lp("max |stored|", 14)}${lp("headroom", 11)}`);
  const hot: Array<F & { maxAbs: number | null; pct: number | null }> = [];
  for (const f of exposed.sort((a, b) => a.table.localeCompare(b.table) || a.field.localeCompare(b.field))) {
    let maxAbs: number | null = null;
    try {
      const [x] = await raw<any>(`SELECT max(abs("${snake(f.field)}"))::float8 m FROM "${f.table}"`);
      maxAbs = x?.m ?? null;
    } catch { maxAbs = null; }
    const pct = maxAbs !== null && f.ceiling > 0 ? (100 * maxAbs) / f.ceiling : null;
    hot.push({ ...f, maxAbs, pct });
    const flag = pct === null ? "" : pct > 50 ? "  ⚠⚠ within 2× of overflow" : pct > 10 ? "  ⚠ same order of magnitude" : "";
    console.log(`  ${pad(f.table, 27)}${pad(f.field, 22)}${pad(f.unit, 9)}${lp(f.ceiling.toLocaleString(), 11)}${lp(maxAbs === null ? "—" : maxAbs.toFixed(2), 14)}${lp(pct === null ? "—" : pct.toFixed(1) + "%", 11)}${flag}`);
  }

  // ── 3. the ones this run can actually hit ──
  console.log(`\n  ── reachable by THIS run's write path (the four tables) ──`);
  const reach = hot.filter((h) => RUN_TABLES.has(h.table));
  for (const h of reach) {
    console.log(`    ⚠ ${pad(h.table + "." + h.field, 48)} ceiling ${lp(h.ceiling.toLocaleString(), 10)} (${h.unit}) · guard: ${h.guard}`);
  }
  console.log(`\n  ── latent on paths this run does NOT write (nbfc / li / gi) ──`);
  for (const h of hot.filter((x) => !RUN_TABLES.has(x.table))) {
    console.log(`    · ${pad(h.table + "." + h.field, 48)} ceiling ${lp(h.ceiling.toLocaleString(), 10)} (${h.unit})`);
  }

  console.log(`\n  ⚠ REPORT ONLY — no write-path change was made.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
