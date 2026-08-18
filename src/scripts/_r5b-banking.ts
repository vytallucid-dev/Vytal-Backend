// ═══════════════════════════════════════════════════════════════
// R5-B — BANKING SCOPE: can the 26 banks be scored at a Jan-2022 date?
// READ-ONLY.
//   npx tsx src/scripts/_r5b-banking.ts
//
// THE QUESTION, precisely. The legacy adapter (adapter.ts adaptToBankingQuarterly)
// passes null for interestExpended, operatingExpenses and EVERY asset-quality /
// capital field, so 9 of the 13 scorer-read banking_quarterly_results columns can
// never be filled from this source at ANY depth. That is a fact about columns.
// The question that matters is a fact about METRICS: which of the five banking
// Momentum metrics can actually be computed at a point-in-time Jan-2022 date?
//
// From src/scoring/metrics/banking.ts, Momentum is 5 equal-weighted metrics:
//   M1 NIM     TTM_NII / avg earning assets   — QUARTERLY NII = intEarned − intExpended
//   M2 PPOP    ppop_FY_t / ppop_FY_{t-1}      — ANNUAL
//   M3 NII     nii_FY_t / nii_FY_{t-1}        — ANNUAL (intEarned − intExpended)
//   M4 NPyoy   netProfit_FY_t / _{t-1}        — ANNUAL
//   M5 GNPAttm latest quarter gnpaPct         — QUARTERLY
// M1 and M5 read QUARTERLY columns the legacy path nulls. M2/M3/M4 read ANNUAL
// columns the legacy ANNUAL parser DOES extract. So the answer is not "none" and
// not "all" — it is measured here, per bank.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const PIT = process.env.R5_PIT ?? "2022-01-31";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const ok = (b: boolean) => (b ? " ✓ " : " ✗ ");

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5-B — BANKING MOMENTUM AVAILABILITY AT A ${PIT} DATE               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  // ── column-level fact first: what the legacy source can and cannot carry ──
  console.log(`\n  ── column-level: banking_quarterly_results fill, BY SOURCE ──`);
  const bySrc = await raw<any>(
    `SELECT "source", count(*)::int n,
            count("interest_earned")::int ie, count("interest_expended")::int iex,
            count("other_income")::int oi, count("operating_expenses")::int oe,
            count("ppop")::int ppop, count("net_profit")::int np,
            count("gnpa_pct")::int gnpapct, count("cet1_ratio")::int cet1,
            count("roa_quarterly")::int roa
       FROM banking_quarterly_results GROUP BY 1 ORDER BY 1`);
  console.log(`  ${pad("source", 30)}${lp("rows", 6)}${lp("intEarn", 9)}${lp("intExp", 8)}${lp("othInc", 8)}${lp("opEx", 7)}${lp("ppop", 7)}${lp("netPft", 8)}${lp("gnpaPct", 9)}${lp("cet1", 6)}${lp("roaQ", 6)}`);
  for (const r of bySrc) {
    console.log(`  ${pad(r.source, 30)}${lp(r.n, 6)}${lp(r.ie, 9)}${lp(r.iex, 8)}${lp(r.oi, 8)}${lp(r.oe, 7)}${lp(r.ppop, 7)}${lp(r.np, 8)}${lp(r.gnpapct, 9)}${lp(r.cet1, 6)}${lp(r.roa, 6)}`);
  }
  console.log(`  ⇒ on *_legacy rows the zeroes are STRUCTURAL: adapter.ts passes null, at any depth.`);

  console.log(`\n  ── and banking_fundamentals (the ANNUAL leg), BY SOURCE ──`);
  const bySrcA = await raw<any>(
    `SELECT "source", count(*)::int n,
            count("interest_earned")::int ie, count("interest_expended")::int iex,
            count("ppop")::int ppop, count("net_profit")::int np,
            count("advances")::int adv, count("investments")::int inv,
            count("cash_and_balances_with_rbi")::int rbi, count("balances_with_banks")::int bwb,
            count("gnpa_pct")::int gnpapct
       FROM banking_fundamentals GROUP BY 1 ORDER BY 1`);
  console.log(`  ${pad("source", 30)}${lp("rows", 6)}${lp("intEarn", 9)}${lp("intExp", 8)}${lp("ppop", 7)}${lp("netPft", 8)}${lp("adv", 6)}${lp("inv", 6)}${lp("rbi", 6)}${lp("bwb", 6)}${lp("gnpaPct", 9)}`);
  for (const r of bySrcA) {
    console.log(`  ${pad(r.source, 30)}${lp(r.n, 6)}${lp(r.ie, 9)}${lp(r.iex, 8)}${lp(r.ppop, 7)}${lp(r.np, 8)}${lp(r.adv, 6)}${lp(r.inv, 6)}${lp(r.rbi, 6)}${lp(r.bwb, 6)}${lp(r.gnpapct, 9)}`);
  }
  console.log(`  ⇒ the ANNUAL legacy parser DOES extract interestExpended and ppop — so M2/M3/M4 are reachable.`);

  // ── per-bank metric availability at the PIT date ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ PER-BANK: which Momentum metrics are computable at ${PIT}          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const banks = await raw<any>(
    `SELECT "id","symbol" FROM stocks WHERE "industryType"::text='banking' AND "is_active" ORDER BY "symbol"`);

  console.log(`  ${pad("bank", 14)}${lp("ann SA", 8)}${lp("qtr SA", 8)}  M1 NIM  M2 PPOP  M3 NII  M4 NP  M5 GNPA   momentum`);
  let anyM1 = 0, anyM5 = 0, allAnnual = 0, none = 0;
  const rows: any[] = [];
  for (const b of banks) {
    // ANNUAL standalone at/below the PIT date
    const ann = await raw<any>(
      `SELECT "fiscal_year" fy, "report_date"::text rd,
              "ppop" IS NOT NULL p, "net_profit" IS NOT NULL np,
              ("interest_earned" IS NOT NULL AND "interest_expended" IS NOT NULL) nii,
              ("advances" IS NOT NULL AND "investments" IS NOT NULL AND "cash_and_balances_with_rbi" IS NOT NULL AND "balances_with_banks" IS NOT NULL) ea
         FROM banking_fundamentals WHERE "stock_id"=$1 AND "result_type"='standalone' AND "report_date" <= DATE '${PIT}'
        ORDER BY "report_date"`, b.id);
    // QUARTERLY standalone at/below the PIT date
    const qtr = await raw<any>(
      `SELECT "fiscal_year" fy, "quarter" q, "report_date"::text rd,
              ("interest_earned" IS NOT NULL AND "interest_expended" IS NOT NULL) nii,
              "gnpa_pct" IS NOT NULL gp
         FROM banking_quarterly_results WHERE "stock_id"=$1 AND "result_type"='standalone' AND "report_date" <= DATE '${PIT}'
        ORDER BY "report_date"`, b.id);

    // M2/M3/M4 need the latest annual AND its immediate predecessor
    const fyOrd = (f: string) => parseInt(f.slice(2), 10);
    const last = ann.at(-1), prev = last ? ann.find((a: any) => fyOrd(a.fy) === fyOrd(last.fy) - 1) : undefined;
    const M2 = !!(last?.p && prev?.p);
    const M3 = !!(last?.nii && prev?.nii);
    const M4 = !!(last?.np && prev?.np);
    // M1 needs 4 consecutive quarters with NII, plus earning assets from the latest annual
    const niiQs = qtr.filter((x: any) => x.nii);
    const M1 = niiQs.length >= 4 && !!last?.ea;
    // M5 needs the latest quarter to carry gnpaPct
    const M5 = !!qtr.at(-1)?.gp;

    const n = [M1, M2, M3, M4, M5].filter(Boolean).length;
    if (M1) anyM1++; if (M5) anyM5++;
    if (M2 && M3 && M4) allAnnual++;
    if (n === 0) none++;
    rows.push({ sym: b.symbol, ann: ann.length, qtr: qtr.length, M1, M2, M3, M4, M5, n });
    console.log(`  ${pad(b.symbol, 14)}${lp(ann.length, 8)}${lp(qtr.length, 8)}  ${ok(M1)}    ${ok(M2)}     ${ok(M3)}   ${ok(M4)}  ${ok(M5)}      ${n}/5`);
  }

  console.log(`\n  ── VERDICT ──`);
  console.log(`  banks with M1 (NIM, needs quarterly interestExpended)   : ${anyM1}/26  ${anyM1 === 0 ? "⚠ NONE" : ""}`);
  console.log(`  banks with M5 (GNPA ttm, needs quarterly gnpaPct)       : ${anyM5}/26  ${anyM5 === 0 ? "⚠ NONE" : ""}`);
  console.log(`  banks with the full ANNUAL trio M2+M3+M4               : ${allAnnual}/26`);
  console.log(`  banks with ZERO computable Momentum metrics             : ${none}/26`);
  const dist = new Map<number, number>();
  for (const r of rows) dist.set(r.n, (dist.get(r.n) ?? 0) + 1);
  console.log(`  distribution of computable metrics: ${[...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}/5 → ${v} bank(s)`).join(" · ")}`);
  console.log(`\n  ⇒ Momentum is 5 EQUAL-weighted metrics. A bank with ${allAnnual ? "3/5" : "0/5"} has the annual trio but`);
  console.log(`    NEITHER quarterly metric, and no re-run of this backfill can change that —`);
  console.log(`    the v2 taxonomy does not carry quarterly interestExpended or gnpaPct at all.`);
  console.log(`    Recovering M1/M5 pre-2025 requires a DIFFERENT SOURCE, not more depth.`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
