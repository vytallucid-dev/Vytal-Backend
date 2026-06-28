// ─────────────────────────────────────────────────────────────
// DENOM-AWARE GATE — Stage 1g (4 financial quarterly siblings). READ-ONLY.
// Run:  npx tsx src/scripts/verify-derive-financial-quarterly.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { getPriorQuarter, decrementFY } from "../ingestions/quaterly-results/ingester-utils.js";
import {
  deriveBankingQuarterly, deriveNbfcQuarterly, deriveLiQuarterly, deriveGiQuarterly,
} from "../ingestions/quaterly-results/derive/derive-financial-quarterly.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
function withinTol(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  const abs = a.minus(b).abs();
  if (abs.lessThanOrEqualTo(0.01)) return true;
  if (a.abs().greaterThan(0)) return abs.div(a.abs()).lessThanOrEqualTo(0.005);
  return false;
}

function unit() {
  console.log("\n[A] Synthetic unit-checks (1 per industry)");
  const b = deriveBankingQuarterly({ interestEarned: 200, interestExpended: 120, otherIncome: 30, expenditureExclProvisions: 60, netProfit: 40, gnpaAbsolute: 50, nnpaAbsolute: 20, cet1Ratio: 0.13, additionalTier1Ratio: 0.02, auditPending: false }, { nii: 70, netProfit: 35 }, { nii: 60, netProfit: 30 }).columns;
  check("bank nii=80 totalIncome=230 netMargin=17.3913 pcr=0.6 tier1=0.15", num(b.nii) === 80 && num(b.totalIncome) === 230 && num(b.netMargin) === 17.3913 && num(b.pcr) === 0.6 && num(b.tier1Ratio) === 0.15);
  check("bank costToIncome=60/230=0.26087 niiYoy=33.3333", num(b.costToIncomeRatio) === 0.26087 && num(b.niiYoy) === 33.3333);
  const bAudit = deriveBankingQuarterly({ interestEarned: 200, interestExpended: 120, otherIncome: 30, expenditureExclProvisions: 60, netProfit: 40, gnpaAbsolute: 50, nnpaAbsolute: 20, cet1Ratio: 0.13, additionalTier1Ratio: 0.02, auditPending: true }, null, null).columns;
  check("bank auditPending → pcr null + tier1 null", bAudit.pcr === null && bAudit.tier1Ratio === null);
  const n = deriveNbfcQuarterly({ interestIncome: 100, financeCosts: 60, netProfit: 30, totalIncome: 200, revenue: 200 }, { revenue: 180, netProfit: 25 }, { revenue: 150, netProfit: 20 }).columns;
  check("nbfc nii=40 netMargin=15 revenueQoq=11.1111 patYoy=50", num(n.nii) === 40 && num(n.netMargin) === 15 && num(n.revenueQoq) === 11.1111 && num(n.patYoy) === 50);
  const l = deriveLiQuarterly({ incomeFirstYearPremium: 50, grossPremiumIncome: 200, totalOperatingExpenses: 40, netProfit: 20, totalRevenuePolicyholders: 250 }, { grossPremiumIncome: 180, netProfit: 15 }, { grossPremiumIncome: 160, netProfit: 10 }).columns;
  check("li nbp%=0.25 expense=0.2 netMargin=8 premiumYoy=25 patYoy=100", num(l.newBusinessPremiumPct) === 0.25 && num(l.expenseRatioPolicyholders) === 0.2 && num(l.netMargin) === 8 && num(l.premiumYoy) === 25 && num(l.patYoy) === 100);
  const g = deriveGiQuarterly({ combinedRatio: 0.92, netProfit: 25, totalRevenue: 300, grossPremiumsWritten: 400 }, { grossPremiumsWritten: 380, netProfit: 20 }, { grossPremiumsWritten: 320, netProfit: 15 }).columns;
  check("gi netUWM=0.08 netMargin=8.3333 gpwQoq=5.2632 gpwYoy=25", num(g.netUnderwritingMargin) === 0.08 && num(g.netMargin) === 8.3333 && num(g.gpwQoq) === 5.2632 && num(g.gpwYoy) === 25);
  check("gi netUWM null when combinedRatio null", deriveGiQuarterly({ combinedRatio: null, netProfit: 25, totalRevenue: 300, grossPremiumsWritten: 400 }, null, null).columns.netUnderwritingMargin === null);
}

interface QRow { id: string; stockId: string; quarter: string; fiscalYear: string; resultType: string; [k: string]: unknown }
async function runTable(
  label: string, rows: QRow[],
  rawOf: (r: QRow) => unknown, priorOf: (r: QRow) => unknown,
  derive: (raw: unknown, pq: unknown, ya: unknown) => { columns: Record<string, Prisma.Decimal | null> },
  nonPrior: string[], priorDep: string[],
) {
  const byKey = new Map<string, QRow>();
  for (const r of rows) byKey.set(`${r.stockId}|${r.quarter}|${r.fiscalYear}|${r.resultType}`, r);
  const tol: Record<string, { ok: number; bothNull: number; breach: number; maxAbs: Prisma.Decimal }> =
    Object.fromEntries(nonPrior.map((c) => [c, { ok: 0, bothNull: 0, breach: 0, maxAbs: new Prisma.Decimal(0) }])) as never;
  let breaches = 0, stale = 0;
  for (const r of rows) {
    const pq = getPriorQuarter(r.quarter, r.fiscalYear);
    const priorRow = pq ? byKey.get(`${r.stockId}|${pq.quarter}|${pq.fiscalYear}|${r.resultType}`) ?? null : null;
    const yearAgo = byKey.get(`${r.stockId}|${r.quarter}|${decrementFY(r.fiscalYear)}|${r.resultType}`) ?? null;
    const d = derive(rawOf(r), priorRow ? priorOf(priorRow) : null, yearAgo ? priorOf(yearAgo) : null).columns;
    for (const c of nonPrior) {
      const stored = (r as Record<string, Prisma.Decimal | null>)[c]; const got = d[c]; const t = tol[c];
      if (stored == null && got == null) { t.bothNull++; continue; }
      if (stored != null && got != null && (stored.equals(got) || withinTol(stored, got))) { t.ok++; const ad = stored != null && got != null ? stored.minus(got).abs() : new Prisma.Decimal(0); if (ad.greaterThan(t.maxAbs)) t.maxAbs = ad; continue; }
      t.breach++; breaches++; console.log(`     [breach:${label}.${c}] ${r.stockId.slice(0,6)}|${r.quarter}-${r.fiscalYear}|${r.resultType} stored=${stored} derived=${got}`);
    }
    for (const c of priorDep) {
      const stored = (r as Record<string, Prisma.Decimal | null>)[c]; const got = d[c];
      if (stored == null && got == null) continue;
      if (stored == null || got == null || !stored.equals(got)) stale++;
    }
  }
  console.log(`\n[B] ${label}: rows=${rows.length}  non-prior: ${nonPrior.map((c) => `${c}(ok ${tol[c].ok}/null ${tol[c].bothNull}/brk ${tol[c].breach}, maxΔ ${tol[c].maxAbs})`).join("  ")}`);
  console.log(`   prior-dep stale (exempt): ${stale}`);
  check(`${label}: 0 non-prior breaches (gate)`, breaches === 0, breaches);
  return { breaches, stale };
}

async function main() {
  unit();
  let totalStale = 0, totalBreach = 0;

  const bankSel = { id: true, stockId: true, quarter: true, fiscalYear: true, resultType: true, interestEarned: true, interestExpended: true, otherIncome: true, expenditureExclProvisions: true, netProfit: true, gnpaAbsolute: true, nnpaAbsolute: true, cet1Ratio: true, additionalTier1Ratio: true, auditPending: true, nii: true, totalIncome: true, costToIncomeRatio: true, netMargin: true, pcr: true, tier1Ratio: true, niiQoq: true, niiYoy: true, patQoq: true, patYoy: true } as const;
  const bank = (await prisma.bankingQuarterlyResult.findMany({ select: bankSel })) as unknown as QRow[];
  const rb = await runTable("BankingQ", bank,
    (r) => ({ interestEarned: num(r.interestEarned as Prisma.Decimal | null), interestExpended: num(r.interestExpended as Prisma.Decimal | null), otherIncome: num(r.otherIncome as Prisma.Decimal | null), expenditureExclProvisions: num(r.expenditureExclProvisions as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null), gnpaAbsolute: num(r.gnpaAbsolute as Prisma.Decimal | null), nnpaAbsolute: num(r.nnpaAbsolute as Prisma.Decimal | null), cet1Ratio: num(r.cet1Ratio as Prisma.Decimal | null), additionalTier1Ratio: num(r.additionalTier1Ratio as Prisma.Decimal | null), auditPending: r.auditPending as boolean }),
    (r) => ({ nii: num(r.nii as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null) }),
    (raw, pq, ya) => deriveBankingQuarterly(raw as never, pq as never, ya as never) as unknown as { columns: Record<string, Prisma.Decimal | null> },
    ["nii", "totalIncome", "costToIncomeRatio", "netMargin", "pcr", "tier1Ratio"], ["niiQoq", "niiYoy", "patQoq", "patYoy"]);

  const nbfcSel = { id: true, stockId: true, quarter: true, fiscalYear: true, resultType: true, interestIncome: true, financeCosts: true, netProfit: true, totalIncome: true, revenue: true, nii: true, netMargin: true, revenueQoq: true, revenueYoy: true, patQoq: true, patYoy: true } as const;
  const nbfc = (await prisma.nbfcQuarterlyResult.findMany({ select: nbfcSel })) as unknown as QRow[];
  const rn = await runTable("NbfcQ", nbfc,
    (r) => ({ interestIncome: num(r.interestIncome as Prisma.Decimal | null), financeCosts: num(r.financeCosts as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null), totalIncome: num(r.totalIncome as Prisma.Decimal | null), revenue: num(r.revenue as Prisma.Decimal | null) }),
    (r) => ({ revenue: num(r.revenue as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null) }),
    (raw, pq, ya) => deriveNbfcQuarterly(raw as never, pq as never, ya as never) as unknown as { columns: Record<string, Prisma.Decimal | null> },
    ["nii", "netMargin"], ["revenueQoq", "revenueYoy", "patQoq", "patYoy"]);

  const liSel = { id: true, stockId: true, quarter: true, fiscalYear: true, resultType: true, incomeFirstYearPremium: true, grossPremiumIncome: true, totalOperatingExpenses: true, netProfit: true, totalRevenuePolicyholders: true, newBusinessPremiumPct: true, expenseRatioPolicyholders: true, netMargin: true, premiumQoq: true, premiumYoy: true, patQoq: true, patYoy: true } as const;
  const li = (await prisma.lifeInsuranceQuarterlyResult.findMany({ select: liSel })) as unknown as QRow[];
  const rl = await runTable("LifeInsuranceQ", li,
    (r) => ({ incomeFirstYearPremium: num(r.incomeFirstYearPremium as Prisma.Decimal | null), grossPremiumIncome: num(r.grossPremiumIncome as Prisma.Decimal | null), totalOperatingExpenses: num(r.totalOperatingExpenses as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null), totalRevenuePolicyholders: num(r.totalRevenuePolicyholders as Prisma.Decimal | null) }),
    (r) => ({ grossPremiumIncome: num(r.grossPremiumIncome as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null) }),
    (raw, pq, ya) => deriveLiQuarterly(raw as never, pq as never, ya as never) as unknown as { columns: Record<string, Prisma.Decimal | null> },
    ["newBusinessPremiumPct", "expenseRatioPolicyholders", "netMargin"], ["premiumQoq", "premiumYoy", "patQoq", "patYoy"]);

  const giSel = { id: true, stockId: true, quarter: true, fiscalYear: true, resultType: true, combinedRatio: true, netProfit: true, totalRevenue: true, grossPremiumsWritten: true, netUnderwritingMargin: true, netMargin: true, gpwQoq: true, gpwYoy: true, patQoq: true, patYoy: true } as const;
  const gi = (await prisma.generalInsuranceQuarterlyResult.findMany({ select: giSel })) as unknown as QRow[];
  const rg = await runTable("GeneralInsuranceQ", gi,
    (r) => ({ combinedRatio: num(r.combinedRatio as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null), totalRevenue: num(r.totalRevenue as Prisma.Decimal | null), grossPremiumsWritten: num(r.grossPremiumsWritten as Prisma.Decimal | null) }),
    (r) => ({ grossPremiumsWritten: num(r.grossPremiumsWritten as Prisma.Decimal | null), netProfit: num(r.netProfit as Prisma.Decimal | null) }),
    (raw, pq, ya) => deriveGiQuarterly(raw as never, pq as never, ya as never) as unknown as { columns: Record<string, Prisma.Decimal | null> },
    ["netUnderwritingMargin", "netMargin"], ["gpwQoq", "gpwYoy", "patQoq", "patYoy"]);

  totalBreach = rb.breaches + rn.breaches + rl.breaches + rg.breaches;
  totalStale = rb.stale + rn.stale + rl.stale + rg.stale;
  console.log(`\n=== unit ${pass}/${pass + fail} | total non-prior breaches ${totalBreach} | prior-dep stale ${totalStale} (exempt) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
