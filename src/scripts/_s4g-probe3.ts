import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

// FY label → ordinal. "FY18" = fiscal year ending 31-Mar-2018.
const fyOrd = (fy: string) => { const m = /^FY(\d{2})$/.exec(fy); return m ? 2000 + +m[1] : NaN; };

async function main() {
  const cohort = await loadCohort();
  const nf = cohort.filter((c) => c.industryType === "non_financial");
  const bk = cohort.filter((c) => c.industryType === "banking");

  for (const [tbl, list, label] of [["fundamentals", nf, "non-financial"], ["banking_fundamentals", bk, "banking"]] as const) {
    const rows = await raw(`
      SELECT s."symbol" sym, t."fiscal_year" fy, t."result_type" rt, t."report_date"::text rd
        FROM ${tbl} t JOIN stocks s ON s."id"=t."stock_id"
       WHERE s."is_active"=true AND t."report_date" BETWEEN DATE '2018-03-31' AND DATE '2024-12-31'`);
    const sa = new Map<string, Set<number>>(), co = new Map<string, Set<number>>();
    for (const r of rows as any[]) {
      const o = fyOrd(r.fy); if (!Number.isFinite(o)) continue;
      const m = r.rt === "standalone" ? sa : co;
      if (!m.has(r.sym)) m.set(r.sym, new Set()); m.get(r.sym)!.add(o);
    }
    let missSa = 0, missBoth = 0, stocksWithGap = 0, noRows = 0;
    const detail: any[] = [];
    for (const c of list) {
      const S = sa.get(c.symbol) ?? new Set<number>(), Co = co.get(c.symbol) ?? new Set<number>();
      const any = new Set<number>([...S, ...Co]);
      if (!any.size) { noRows++; continue; }
      const first = Math.min(...any), last = 2024;
      const gapSa: number[] = [], gapBoth: number[] = [];
      for (let f = first; f <= last; f++) { if (!S.has(f)) { gapSa.push(f); if (!Co.has(f)) gapBoth.push(f); } }
      missSa += gapSa.length; missBoth += gapBoth.length;
      if (gapSa.length) { stocksWithGap++; detail.push({ sym: c.symbol, first: `FY${String(first).slice(2)}`, gapSa: gapSa.length, gapBoth: gapBoth.length }); }
    }
    console.log(`\n── ${tbl} (${label}, ${list.length}) · ANNUAL period gaps, first-filed FY → FY24 ──`);
    console.log(`  stocks with NO annual row in window          : ${noRows}`);
    console.log(`  stocks missing ≥1 standalone annual FY       : ${stocksWithGap}`);
    console.log(`  missing standalone annual FYs (total)        : ${missSa}`);
    console.log(`     of which consolidated held (RE-INGEST, B) : ${missSa - missBoth}`);
    console.log(`     of which nothing either basis (TYPE C)    : ${missBoth}`);
    detail.sort((a, b) => b.gapSa - a.gapSa);
    console.log(`  ${pad("symbol", 14)}${pad("first FY", 10)}${lp("gapSA", 7)}${lp("gapBOTH", 9)}`);
    for (const d of detail.slice(0, 12)) console.log(`  ${pad(d.sym, 14)}${pad(d.first, 10)}${lp(d.gapSa, 7)}${lp(d.gapBoth, 9)}`);
    if (detail.length > 12) console.log(`  … ${detail.length - 12} more`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
