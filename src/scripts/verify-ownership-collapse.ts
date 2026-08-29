// Gate for collapse-quarters.ts. Offline where it can be, live for the case that motivated it.
//   npx tsx src/scripts/verify-ownership-collapse.ts
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { collapseToOneRowPerQuarter } from "../scoring/ownership/collapse-quarters.js";

let fails = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) fails++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};
const row = (d: string, fy: string, q: string) => ({ asOnDate: new Date(d), fiscalYear: fy, quarter: q });

console.log("\n=== ownership collapse gate ===\n");
console.log("-- offline properties --");
const clean = [row("2024-03-31","FY24","Q4"), row("2024-06-30","FY25","Q1"), row("2024-09-30","FY25","Q2")];
check("a series already one-per-quarter is unchanged", collapseToOneRowPerQuarter(clean).length === 3);
check("  and keeps its order", collapseToOneRowPerQuarter(clean).map(r=>r.quarter).join(",") === "Q4,Q1,Q2");
check("empty in, empty out", collapseToOneRowPerQuarter([]).length === 0);

const dup = [row("2022-07-11","FY23","Q2"), row("2022-08-08","FY23","Q2"), row("2022-09-03","FY23","Q2"), row("2022-09-30","FY23","Q2")];
const c = collapseToOneRowPerQuarter(dup);
check("four filings in one quarter collapse to one", c.length === 1);
check("  and the survivor is the LATEST as_on_date", c[0].asOnDate.toISOString().slice(0,10) === "2022-09-30",
  `kept ${c[0].asOnDate.toISOString().slice(0,10)}`);

const mixed = [row("2024-03-31","FY24","Q4"), row("2024-05-27","FY25","Q1"), row("2024-06-30","FY25","Q1"), row("2024-09-30","FY25","Q2")];
const m = collapseToOneRowPerQuarter(mixed);
check("mixed series keeps one per quarter, chronological", m.length === 3 && m.map(r=>r.quarter).join(",") === "Q4,Q1,Q2");
check("  and Q1 resolves to the quarter-end, not the intra-quarter filing",
  m[1].asOnDate.toISOString().slice(0,10) === "2024-06-30", `kept ${m[1].asOnDate.toISOString().slice(0,10)}`);
// same quarter label in a DIFFERENT fiscal year must not merge
const across = [row("2023-06-30","FY24","Q1"), row("2024-06-30","FY25","Q1")];
check("same quarter in different fiscal years stays separate", collapseToOneRowPerQuarter(across).length === 2);

console.log("\n-- live: the case that motivated this --");
const sh = await prisma.shareholdingPattern.findMany({
  where: { stock: { symbol: "UNOMINDA" }, fiscalYear: "FY23", quarter: "Q2" },
  orderBy: { asOnDate: "asc" },
  select: { asOnDate: true, quarter: true, fiscalYear: true, promoterPct: true },
});
console.log(`  UNOMINDA FY23 Q2 rows in DB: ${sh.length}  [${sh.map(r=>`${r.asOnDate.toISOString().slice(0,10)}=${r.promoterPct}`).join(" ")}]`);
if (sh.length > 1) {
  const k = collapseToOneRowPerQuarter(sh);
  check("collapses to exactly one", k.length === 1);
  check("  survivor is the quarter-end 2022-09-30", k[0].asOnDate.toISOString().slice(0,10) === "2022-09-30",
    `kept ${k[0].asOnDate.toISOString().slice(0,10)} promoter=${k[0].promoterPct}`);
} else check("UNOMINDA still has its multi-filing quarter (fixture check)", false, "expected >1 row");

console.log("\n-- live: no stock loses a QUARTER, only duplicate filings --");
const all = await prisma.shareholdingPattern.findMany({
  orderBy: [{ stockId: "asc" }, { asOnDate: "asc" }],
  select: { stockId: true, asOnDate: true, quarter: true, fiscalYear: true },
});
const byStock = new Map<string, typeof all>();
for (const r of all) { if (!byStock.has(r.stockId)) byStock.set(r.stockId, [] as never); byStock.get(r.stockId)!.push(r); }
let droppedRows = 0, lostQuarters = 0;
for (const [, rows] of byStock) {
  const before = new Set(rows.map(r => `${r.fiscalYear}|${r.quarter}`));
  const after = collapseToOneRowPerQuarter(rows);
  droppedRows += rows.length - after.length;
  if (new Set(after.map(r => `${r.fiscalYear}|${r.quarter}`)).size !== before.size) lostQuarters++;
}
check(`collapse drops ${droppedRows} duplicate filings`, droppedRows > 0, `${all.length} rows -> ${all.length - droppedRows}`);
check("NO stock loses a distinct quarter", lostQuarters === 0, `${lostQuarters} stock(s) would`);

console.log(`\n=== ${fails === 0 ? "GATE PASSED" : `GATE FAILED — ${fails}`} ===\n`);
await prisma.$disconnect();
process.exit(fails ? 1 : 0);
