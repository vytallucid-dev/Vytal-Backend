// ═══════════════════════════════════════════════════════════════
// F3 — POST-COMMIT VERIFICATION + FENCE BY ID. READ-ONLY.
//   npx tsx src/scripts/_f3-verify.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);

const EXPECT: Array<[string, string, string, string, string]> = [
  ["CANBK", "banking_quarterly_results", "2022-06-30", "standalone", "FY23Q1"],
  ["IOB", "banking_quarterly_results", "2022-09-30", "consolidated", "FY23Q2"],
  ["CEMPRO", "quarterly_results", "2018-03-31", "consolidated", "FY18Q4"],
  ["CEMPRO", "quarterly_results", "2018-03-31", "standalone", "FY18Q4"],
  ["POWERINDIA", "quarterly_results", "2021-03-31", "standalone", "FY21Q4"],
  ["DELHIVERY", "quarterly_results", "2022-09-30", "standalone", "FY23Q2"],
  ["DELHIVERY", "quarterly_results", "2022-09-30", "consolidated", "FY23Q2"],
];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F3 — POST-COMMIT VERIFICATION: are the seven rows relabelled?              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("stock", 13)}${pad("report_date", 13)}${pad("basis", 14)}${pad("expected", 10)}${pad("actual", 10)}verdict`);
  let ok = 0;
  for (const [sym, tbl, rd, rt, exp] of EXPECT) {
    const [r] = await raw(
      `SELECT q."fiscal_year"||q."quarter" lbl FROM "${tbl}" q JOIN stocks s ON s."id"=q."stock_id"
        WHERE s."symbol"=$1 AND q."report_date"=DATE '${rd}' AND q."result_type"=$2`, sym, rt);
    const got = r?.lbl ?? "(missing)";
    const good = got === exp;
    if (good) ok++;
    console.log(`  ${pad(sym, 13)}${pad(rd, 13)}${pad(rt, 14)}${pad(exp, 10)}${pad(got, 10)}${good ? "✓" : "⚠ MISMATCH"}`);
  }
  console.log(`  ⇒ ${ok}/${EXPECT.length} relabelled as planned`);

  // the OLD labels must be gone
  console.log(`\n  ── the old labels must no longer exist ──`);
  for (const [sym, tbl, old] of [["CANBK", "banking_quarterly_results", "FY22Q1"], ["IOB", "banking_quarterly_results", "FY22Q2"],
    ["CEMPRO", "quarterly_results", "FY19Q4"], ["POWERINDIA", "quarterly_results", "FY22Q4"], ["DELHIVERY", "quarterly_results", "FY22Q2"]] as any[]) {
    const rows = await raw(`SELECT q."result_type" rt, q."report_date"::text rd FROM "${tbl}" q JOIN stocks s ON s."id"=q."stock_id"
      WHERE s."symbol"=$1 AND q."fiscal_year"||q."quarter"=$2`, sym, old);
    console.log(`  ${pad(sym, 13)}${pad(old, 9)}${rows.length === 0 ? "✓ gone" : `⚠ still present: ${rows.map((r: any) => `${String(r.rd).slice(0, 10)}/${r.rt}`).join(", ")}`}`);
  }

  console.log(`\n  ── row counts (nothing deleted, nothing duplicated) ──`);
  for (const [sym, tbl, before] of [["CANBK", "banking_quarterly_results", 53], ["IOB", "banking_quarterly_results", 47],
    ["CEMPRO", "quarterly_results", 64], ["POWERINDIA", "quarterly_results", 23], ["DELHIVERY", "quarterly_results", 36]] as any[]) {
    const [c] = await raw(`SELECT count(*)::int n, count(DISTINCT (q."report_date",q."result_type"))::int d
      FROM "${tbl}" q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"=$1`, sym);
    console.log(`  ${pad(sym, 13)}${c.n} rows (was ${before}) · ${c.d} distinct (report_date,basis)  ${c.n === before && c.d === c.n ? "✓" : "⚠"}`);
  }

  // ── FENCE BY ID ──
  const base = JSON.parse(readFileSync("_r1d-v3-before.json", "utf8"));
  const ids = (base.rows as any[]).map((r) => r.id);
  const byId = new Map((base.rows as any[]).map((r) => [r.id, r]));
  const TBL = ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"];
  let breaches = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const sl = ids.slice(i, i + 500);
    for (const t of TBL)
      for (const r of await raw(`SELECT "id","source" src,"report_date"::text rd FROM "${t}" WHERE "id"=ANY($1::text[])`, sl)) {
        const b: any = byId.get(r.id);
        if (String(r.src) !== String(b.src) || String(r.rd).slice(0, 10) !== String(b.rd).slice(0, 10)) {
          breaches++;
          console.log(`      ⚠ ${b.sym} ${b.period} ${b.basis}: ${b.src}@${String(b.rd).slice(0, 10)} → ${r.src}@${String(r.rd).slice(0, 10)}`);
        }
      }
  }
  const present = new Set<string>();
  for (const t of TBL) for (const r of await raw(`SELECT "id" FROM "${t}" WHERE "id"=ANY($1::text[])`, ids)) present.add(r.id);
  const vanished = ids.filter((i: string) => !present.has(i));
  console.log(`\n  FENCE BY ID over ${ids.length} v3-era rows: ${breaches} moved · ${vanished.length} vanished  ${breaches === 0 && vanished.length === 0 ? "✓ CLEAN" : "⚠ BREACH"}`);
  for (const v of vanished.slice(0, 10)) { const b: any = byId.get(v); console.log(`      ⚠ VANISHED ${b.sym} ${b.t} ${b.period} ${b.basis}`); }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
