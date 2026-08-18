// S4.2 — list every derived column that is written UNBOUNDED into a bounded
// Decimal column, per derive module, with the precision it must respect.
import { readFileSync, readdirSync } from "node:fs";

const SCHEMA = "prisma/schema.prisma";
const D = "src/ingestions/quaterly-results/derive";
const FILE_MODEL: Record<string, string[]> = {
  "derive-indas-annual.ts": ["Fundamental"],
  "derive-indas-quarterly.ts": ["QuarterlyResult"],
  "derive-banking-annual.ts": ["BankingFundamental"],
  "derive-nbfc-annual.ts": ["NbfcFundamental"],
  "derive-li-annual.ts": ["LifeInsuranceFundamental"],
  "derive-gi-annual.ts": ["GeneralInsuranceFundamental"],
  "derive-financial-quarterly.ts": ["BankingQuarterlyResult", "NbfcQuarterlyResult", "LifeInsuranceQuarterlyResult", "GeneralInsuranceQuarterlyResult"],
};

const cols = new Map<string, { p: number; s: number }>();
let model = "";
for (const line of readFileSync(SCHEMA, "utf8").split("\n")) {
  const m = /^model\s+(\w+)\s*\{/.exec(line.trim());
  if (m) { model = m[1]; continue; }
  if (line.trim() === "}") { model = ""; continue; }
  if (!model) continue;
  const d = /^\s*(\w+)\s+Decimal\?*\s.*@db\.Decimal\((\d+),\s*(\d+)\)/.exec(line);
  if (d) cols.set(`${model}.${d[1]}`, { p: +d[2], s: +d[3] });
}

const RUN_TABLES = new Set(["Fundamental", "QuarterlyResult", "BankingFundamental", "BankingQuarterlyResult"]);
let totalHot = 0, totalCold = 0;
for (const f of readdirSync(D).filter((x) => x.endsWith(".ts"))) {
  const src = readFileSync(`${D}/${f}`, "utf8");
  const rows: Array<{ field: string; p: number; s: number; intD: number; call: string; hot: boolean }> = [];
  const seen = new Set<string>();
  for (const mdl of FILE_MODEL[f] ?? []) {
    for (const [k, v] of cols) {
      if (!k.startsWith(mdl + ".")) continue;
      const field = k.split(".")[1];
      if (seen.has(field)) continue;
      const re = new RegExp("^\\s*" + field + ":\\s*([A-Za-z]+)\\(", "m");
      const mm = re.exec(src);
      if (!mm) continue;
      seen.add(field);
      const call = mm[1];
      if (call === "boundDerived") continue;              // already guarded
      if (!/^(decimal|safeNumber)/.test(call)) continue;  // not a numeric writer
      const intD = v.p - v.s;
      if (intD > 8) continue;                             // money columns: unreachable in crore
      rows.push({ field, p: v.p, s: v.s, intD, call, hot: RUN_TABLES.has(mdl) });
    }
  }
  if (!rows.length) continue;
  const hot = rows.filter((r) => r.hot);
  totalHot += hot.length; totalCold += rows.length - hot.length;
  console.log(`\n${f}   [${FILE_MODEL[f]?.join(", ")}]   ${hot.length ? "⚠ ON A RUN-WRITTEN TABLE" : "(nbfc/li/gi — no live scoring consumer)"}`);
  for (const r of rows.sort((a, b) => a.field.localeCompare(b.field))) {
    console.log(`   ${r.field.padEnd(28)} Decimal(${r.p},${r.s})  ceiling 1e${r.intD} = ${(10 ** r.intD).toLocaleString().padStart(11)}   via ${r.call}()`);
  }
}
console.log(`\n── TOTAL unbounded: ${totalHot} on the four run-written tables · ${totalCold} on nbfc/li/gi ──`);
