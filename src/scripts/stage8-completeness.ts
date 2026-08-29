// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 8 — UNIVERSE COMPLETENESS, the final accounting. Read-only.
//
//   npx tsx src/scripts/stage8-completeness.ts
//
// ── WHAT "COMPLETE" MEANS HERE, AND WHY EACH CHOICE ───────────────────────────────────────────────
// A stock is COMPLETE on a grain when it has no missing period between its FLOOR and the HORIZON.
//
//   FLOOR   = max(2019-03-31, first quarter-end on/after its first traded price).
//             The sweet spot OR the listing date, whichever is later. Demanding FY2019 of a company
//             that listed in 2024 manufactures gaps no source can ever fill, and every later report
//             would carry them forever.
//
//   HORIZON = DERIVED, not assumed: the most recent period for which a majority of the universe
//             already holds data. Assuming "the latest quarter" invents a gap for every company that
//             has simply not filed yet, which would make the report say the data got worse each time
//             a quarter turns over.
//
//   SERVED  = at least one row for (stock, period) in that stock's industry table, ANY result_type.
//             Standalone and consolidated are different rows keyed by result_type; for "do we have
//             this period at all", either answers yes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { fyq as fyqShared, fyLabel } from "./fy-label.js";

const SWEET = "2019-03-31";
const OUT = "_s8-completeness.json";
const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

const QT: Record<string, string> = {
  non_financial: "quarterly_results", banking: "banking_quarterly_results", nbfc: "nbfc_quarterly_results",
  life_insurance: "life_insurance_quarterly_results", general_insurance: "general_insurance_quarterly_results",
};
const AT: Record<string, string> = {
  non_financial: "fundamentals", banking: "banking_fundamentals", nbfc: "nbfc_fundamentals",
  life_insurance: "life_insurance_fundamentals", general_insurance: "general_insurance_fundamentals",
};

function quarterEnds(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++)
    for (const e of ["-03-31", "-06-30", "-09-30", "-12-31"]) {
      const d = `${y}${e}`;
      if (d >= from && d <= to) out.push(d);
    }
  return out.sort();
}
export const fyOf = fyqShared;

export interface StockGap {
  symbol: string; ind: string; firstpx: string | null; floor: string;
  qTable: string; aTable: string;
  missQ: string[]; missA: string[]; missS: string[];
  demandQ: number; demandA: number; demandS: number;
}

export async function analyse(): Promise<{ horizonQ: string; horizonA: string; horizonS: string; stocks: StockGap[] }> {
  const stocks = await raw<{ id: string; symbol: string; ind: string; firstpx: string | null }>(`
    SELECT s.id, s.symbol, s."industryType"::text ind,
           (SELECT min(date)::date::text FROM daily_prices p WHERE p.stock_id = s.id) firstpx
      FROM stocks s ORDER BY s.symbol`);
  const N = stocks.length;

  // ── held sets ────────────────────────────────────────────────────────────────────────────────
  const heldQ = new Set<string>(), heldA = new Set<string>(), heldS = new Set<string>();
  for (const t of new Set(Object.values(QT)))
    for (const r of await raw<{ sid: string; d: string }>(`SELECT stock_id sid, report_date::date::text d FROM "${t}"`))
      heldQ.add(`${r.sid}|${r.d}`);
  for (const t of new Set(Object.values(AT)))
    for (const r of await raw<{ sid: string; d: string }>(`SELECT stock_id sid, report_date::date::text d FROM "${t}"`))
      heldA.add(`${r.sid}|${r.d}`);
  for (const r of await raw<{ sid: string; d: string }>(
    `SELECT stock_id sid, as_on_date::date::text d FROM shareholding_patterns WHERE as_on_date IS NOT NULL`))
    heldS.add(`${r.sid}|${r.d}`);

  // ── DERIVE the horizons: latest period a majority of the universe already holds ───────────────
  const derive = (held: Set<string>, isAnnual: boolean): string => {
    const count = new Map<string, number>();
    for (const k of held) {
      const d = k.split("|")[1];
      if (isAnnual && !d.endsWith("-03-31")) continue;
      count.set(d, (count.get(d) ?? 0) + 1);
    }
    const ok = [...count.entries()].filter(([, n]) => n >= N * 0.5).map(([d]) => d).sort();
    return ok.length ? ok[ok.length - 1] : SWEET;
  };
  const horizonQ = derive(heldQ, false);
  const horizonA = derive(heldA, true);
  const horizonS = derive(heldS, false);

  // ⚠⚠ NOT EVERY COMPANY'S YEAR ENDS IN MARCH, and demanding a 31-March row from one whose year
  //    ends in December invents a gap for every year it has ever existed. MEASURED in this universe:
  //    VBL, SCHAEFFLER, CRISIL, CASTROLIND, CIEINDIA end in DECEMBER; GILLETTE ended in JUNE through
  //    2024 and then MOVED to March — so the year-end is not even constant per company.
  //    So annual demand is counted by FISCAL-YEAR WINDOW, not by date: FY<Y> is served if the stock
  //    holds ANY annual row falling in [Y-1-04-01 .. Y-03-31]. That is correct for a March, June,
  //    or December year-end, and it survives a company changing its mind.
  const annualHeldByStock = new Map<string, string[]>();
  for (const k of heldA) {
    const [sid, d] = k.split("|");
    if (!annualHeldByStock.has(sid)) annualHeldByStock.set(sid, []);
    annualHeldByStock.get(sid)!.push(d);
  }
  const fyOfDate = (d: string): number => (Number(d.slice(5, 7)) <= 3 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) + 1);

  const out: StockGap[] = [];
  for (const s of stocks) {
    const qt = QT[s.ind] ?? QT.non_financial;
    const at = AT[s.ind] ?? AT.non_financial;
    const listFloor = s.firstpx ? quarterEnds(s.firstpx, "2100-01-01")[0] : SWEET;
    const floor = listFloor > SWEET ? listFloor : SWEET;
    const wantQ = quarterEnds(floor, horizonQ);
    const wantS = quarterEnds(floor, horizonS);

    const heldFy = new Set((annualHeldByStock.get(s.id) ?? []).map(fyOfDate));
    // the stock's own year-end month, so the workbook can ask for the RIGHT date
    const months = (annualHeldByStock.get(s.id) ?? []).map((d) => d.slice(5, 7));
    const mode = months.length
      ? [...months.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0]
      : "03";
    const lastDay: Record<string, string> = { "03": "31", "06": "30", "09": "30", "12": "31" };
    const missA: string[] = [];
    for (let fy = fyOfDate(floor); fy <= fyOfDate(horizonA); fy++)
      if (!heldFy.has(fy)) {
        // express the missing year at the date THIS stock actually reports
        const cy = mode === "03" ? fy : fy - 1;
        missA.push(`${cy}-${mode}-${lastDay[mode] ?? "31"}`);
      }

    out.push({
      symbol: s.symbol, ind: s.ind, firstpx: s.firstpx, floor, qTable: qt, aTable: at,
      missQ: wantQ.filter((p) => !heldQ.has(`${s.id}|${p}`)),
      missA,
      missS: wantS.filter((p) => !heldS.has(`${s.id}|${p}`)),
      demandQ: wantQ.length, demandA: fyOfDate(horizonA) - fyOfDate(floor) + 1, demandS: wantS.length,
    });
  }
  return { horizonQ, horizonA, horizonS, stocks: out };
}

async function main(): Promise<void> {
  const { horizonQ, horizonA, horizonS, stocks } = await analyse();
  const N = stocks.length;
  const pc = (n: number): string => `${((n / N) * 100).toFixed(1)}%`;

  console.log(`\n${"═".repeat(96)}`);
  console.log(`  STAGE 8 — UNIVERSE COMPLETENESS`);
  console.log(`${"═".repeat(96)}`);
  console.log(`  universe            ${N} stocks`);
  console.log(`  sweet spot          ${SWEET}  (or listing date, whichever is later)`);
  console.log(`  horizon quarterly   ${horizonQ}   annual ${horizonA}   shareholding ${horizonS}`);
  console.log(`  (horizons DERIVED: the latest period a majority of the universe already holds)`);

  const cq = stocks.filter((s) => !s.missQ.length);
  const ca = stocks.filter((s) => !s.missA.length);
  const cs = stocks.filter((s) => !s.missS.length);
  const both = stocks.filter((s) => !s.missQ.length && !s.missA.length);
  const all3 = stocks.filter((s) => !s.missQ.length && !s.missA.length && !s.missS.length);

  console.log(`\n  ── HEADLINE ──`);
  console.log(`  complete quarterly            ${String(cq.length).padStart(4)} / ${N}   ${pc(cq.length)}`);
  console.log(`  complete annual               ${String(ca.length).padStart(4)} / ${N}   ${pc(ca.length)}`);
  console.log(`  complete BOTH (results)       ${String(both.length).padStart(4)} / ${N}   ${pc(both.length)}`);
  console.log(`  complete shareholding         ${String(cs.length).padStart(4)} / ${N}   ${pc(cs.length)}`);
  console.log(`  complete ALL THREE            ${String(all3.length).padStart(4)} / ${N}   ${pc(all3.length)}`);

  console.log(`\n  ── BY INDUSTRY ──`);
  console.log(`  ${"industry".padEnd(20)} ${"n".padStart(4)} ${"Qok".padStart(5)} ${"Aok".padStart(5)} ${"both".padStart(5)} ${"SHok".padStart(5)} ${"all3".padStart(5)}   ${"missQ".padStart(6)} ${"missA".padStart(6)} ${"missSH".padStart(6)}`);
  for (const ind of ["non_financial", "nbfc", "banking", "general_insurance", "life_insurance"]) {
    const g = stocks.filter((s) => s.ind === ind);
    if (!g.length) continue;
    const f = (p: (x: StockGap) => boolean): number => g.filter(p).length;
    console.log(`  ${ind.padEnd(20)} ${String(g.length).padStart(4)} ` +
      `${String(f((s) => !s.missQ.length)).padStart(5)} ${String(f((s) => !s.missA.length)).padStart(5)} ` +
      `${String(f((s) => !s.missQ.length && !s.missA.length)).padStart(5)} ${String(f((s) => !s.missS.length)).padStart(5)} ` +
      `${String(f((s) => !s.missQ.length && !s.missA.length && !s.missS.length)).padStart(5)}   ` +
      `${String(g.reduce((n, s) => n + s.missQ.length, 0)).padStart(6)} ${String(g.reduce((n, s) => n + s.missA.length, 0)).padStart(6)} ` +
      `${String(g.reduce((n, s) => n + s.missS.length, 0)).padStart(6)}`);
  }

  const totQ = stocks.reduce((n, s) => n + s.missQ.length, 0);
  const totA = stocks.reduce((n, s) => n + s.missA.length, 0);
  const totS = stocks.reduce((n, s) => n + s.missS.length, 0);
  const demQ = stocks.reduce((n, s) => n + s.demandQ, 0);
  const demA = stocks.reduce((n, s) => n + s.demandA, 0);
  const demS = stocks.reduce((n, s) => n + s.demandS, 0);
  console.log(`\n  ── CELL-LEVEL (periods, not stocks) ──`);
  console.log(`  quarterly     ${String(demQ - totQ).padStart(6)} / ${String(demQ).padStart(6)} served   ${((1 - totQ / demQ) * 100).toFixed(2)}%   missing ${totQ}`);
  console.log(`  annual        ${String(demA - totA).padStart(6)} / ${String(demA).padStart(6)} served   ${((1 - totA / demA) * 100).toFixed(2)}%   missing ${totA}`);
  console.log(`  shareholding  ${String(demS - totS).padStart(6)} / ${String(demS).padStart(6)} served   ${((1 - totS / demS) * 100).toFixed(2)}%   missing ${totS}`);

  // how bad are the incomplete ones?
  const inc = stocks.filter((s) => s.missQ.length || s.missA.length).sort((a, b) => (b.missQ.length + b.missA.length) - (a.missQ.length + a.missA.length));
  console.log(`\n  ── THE ${inc.length} STOCKS NOT COMPLETE ON RESULTS — gap size distribution ──`);
  const buckets: Record<string, number> = { "1": 0, "2-3": 0, "4-8": 0, "9-20": 0, "21+": 0 };
  for (const s of inc) {
    const n = s.missQ.length + s.missA.length;
    buckets[n === 1 ? "1" : n <= 3 ? "2-3" : n <= 8 ? "4-8" : n <= 20 ? "9-20" : "21+"]++;
  }
  for (const [k, v] of Object.entries(buckets)) console.log(`     ${k.padEnd(6)} missing units : ${v} stocks`);
  console.log(`\n  worst 20:`);
  for (const s of inc.slice(0, 20))
    console.log(`     ${s.symbol.padEnd(14)} ${s.ind.padEnd(18)} floor ${s.floor}  missQ ${String(s.missQ.length).padStart(2)}/${String(s.demandQ).padStart(2)}  missA ${String(s.missA.length).padStart(2)}/${String(s.demandA).padStart(2)}`);

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), horizonQ, horizonA, horizonS, stocks }, null, 1));
  console.log(`\n  detail -> ${OUT}\n`);
  await prisma.$disconnect();
}
if (process.argv[1]?.includes("stage8-completeness")) main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
