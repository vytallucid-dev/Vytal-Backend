// ═══════════════════════════════════════════════════════════════
// F3d — RE-MEASURE consecutiveTail PER STOCK AFTER THE REPAIR. READ-ONLY.
//   npx tsx src/scripts/_f3d-tail.ts
// ⚠ NO SCORING. Calls the engine's own loaders/metrics as measurement only.
//   Two tails are reported per stock:
//     · LIVE  — no cutoff, the whole series (what the engine sees today)
//     · @2022 — cutoff 2022-01-31, the Stage-7 window
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { loadMomentumStandalone } from "../scoring/metrics/load.js";
import { loadBankingCtx } from "../scoring/metrics/banking-load.js";
import { consecutiveTail } from "../scoring/metrics/momentum.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const AS_OF = new Date(Date.UTC(2022, 0, 31));
const SYMS = ["CANBK", "IOB", "CEMPRO", "POWERINDIA", "DELHIVERY"];

/** consecutiveTail's own definition, applied to a banking quarter list. */
function bankTail(qs: any[]): { len: number; span: string } {
  const s = [...qs].sort((a, b) => a.qOrdinal - b.qOrdinal);
  if (!s.length) return { len: 0, span: "(none)" };
  let n = 1;
  for (let i = s.length - 2; i >= 0; i--) { if (s[i].qOrdinal === s[i + 1].qOrdinal - 1) n++; else break; }
  const f = s[s.length - n], l = s[s.length - 1];
  return { len: n, span: `${f.fiscalYear}${f.quarter}..${l.fiscalYear}${l.quarter}` };
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F3d — consecutiveTail AFTER the repair (read-only, no scoring)             ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("stock", 13)}${pad("industry", 15)}${lp("rows", 6)}${lp("tail LIVE", 11)}${lp("tail @2022", 12)}   LIVE span`);
  for (const sym of SYMS) {
    const [st] = await raw(`SELECT "id","industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    if (st.it === "banking") {
      const live = await loadBankingCtx(sym, st.id);
      const then = await loadBankingCtx(sym, st.id, AS_OF);
      const a = bankTail(live.quarterly), b = bankTail(then.quarterly);
      console.log(`  ${pad(sym, 13)}${pad(st.it, 15)}${lp(live.quarterly.length, 6)}${lp(a.len, 11)}${lp(b.len, 12)}   ${a.span}`);
    } else {
      const live = await loadMomentumStandalone(st.id);
      const then = await loadMomentumStandalone(st.id, AS_OF);
      const a = consecutiveTail(live), b = consecutiveTail(then);
      const span = a.length ? `${a[0].fiscalYear}${a[0].quarter}..${a[a.length - 1].fiscalYear}${a[a.length - 1].quarter}` : "(none)";
      console.log(`  ${pad(sym, 13)}${pad(st.it, 15)}${lp(live.length, 6)}${lp(a.length, 11)}${lp(b.length, 12)}   ${span}`);
    }
  }

  // the ordered label series around each repaired quarter — the thing that actually moved
  console.log(`\n  ── the standalone series as the loader now orders it (the repaired region) ──`);
  for (const [sym, tbl, from, to] of [
    ["CANBK", "banking_quarterly_results", "2021-12-31", "2023-06-30"],
    ["IOB", "banking_quarterly_results", "2022-03-31", "2023-06-30"],
    ["CEMPRO", "quarterly_results", "2017-09-30", "2019-03-31"],
    ["POWERINDIA", "quarterly_results", "2020-09-30", "2022-12-31"],
    ["DELHIVERY", "quarterly_results", "2022-03-31", "2023-06-30"],
  ] as any[]) {
    const rows = await raw(
      `SELECT q."report_date"::text rd, q."fiscal_year"||q."quarter" lbl FROM "${tbl}" q JOIN stocks s ON s."id"=q."stock_id"
        WHERE s."symbol"=$1 AND q."result_type"='standalone' AND q."report_date" BETWEEN DATE '${from}' AND DATE '${to}'
        ORDER BY q."report_date"`, sym);
    console.log(`  ${pad(sym, 13)}${rows.map((r: any) => `${String(r.rd).slice(0, 10)}→${r.lbl}`).join("  ")}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
