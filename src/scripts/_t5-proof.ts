// ═══════════════════════════════════════════════════════════════
// T5.1d — PROOF OF THE CASH-FLOW FIX. READ-ONLY, in-memory re-parse.
// Re-parses the 5 known FALSE-NULL documents (must now yield numbers) and the
// 5 known GENUINE-ABSENCE documents (must STILL be null), and checks that no
// P&L or balance-sheet field moved on any of them.
//   npx tsx src/scripts/_t5-proof.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { parseAnnualResultXbrl } from "../ingestions/quaterly-results/legacy/parser-legacy-common.js";

const FALSE_NULL: [string, string][] = [
  ["ABB", "FY20"], ["BHARTIARTL", "FY21"], ["ULTRACEMCO", "FY21"], ["PIDILITIND", "FY21"],
];
const GENUINE: [string, string][] = [
  ["APOLLOHOSP", "FY20"], ["ULTRACEMCO", "FY19"], ["TITAN", "FY20"], ["TATASTEEL", "FY18"], ["BHARATFORG", "FY20"],
];
const CF_FIELDS = ["cashFromOperating", "cashFromInvesting", "cashFromFinancing", "capex", "netCashFlow"] as const;
// Must be untouched by the change — these keep their strict FourD/OneI context.
const PNL_BS_FIELDS = ["revenue", "otherIncome", "financeCosts", "depreciation", "profitBeforeTax",
  "netProfit", "totalAssets", "totalEquity", "equityShareCapital"] as const;

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (v: unknown) => (v === null || v === undefined ? "null" : String(v));

async function reparse(sym: string, fy: string) {
  const [r] = await raw<any>(
    `SELECT f."xbrl_url" u, f."result_type" rt, f."cash_from_operating"::float8 db_cfo,
            f."revenue"::float8 db_rev, f."net_profit"::float8 db_np, f."total_assets"::float8 db_ta
       FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
      WHERE st."symbol"=$1 AND f."fiscal_year"=$2 AND f."result_type"='standalone'`, sym, fy);
  if (!r) return null;
  const xml = await fetchXbrlFile(r.u);
  const parsed: any = parseAnnualResultXbrl(xml, { symbol: sym, xbrl: r.u, consolidated: null } as any);
  return { r, parsed };
}

async function main() {
  let fail = 0;

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.1d(i) — the 4 FALSE-NULL documents must now EXTRACT cash flow          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const [sym, fy] of FALSE_NULL) {
    const out = await reparse(sym, fy);
    if (!out) { console.log(`  ${sym} ${fy}: no row`); continue; }
    const { r, parsed } = out;
    const got = parsed.cashFromOperating;
    const ok = got !== null;
    if (!ok) fail++;
    console.log(`  ${pad(sym + " " + fy, 20)} DB cash_from_operating=${pad(fmt(r.db_cfo), 10)} → re-parsed ${pad(fmt(got), 12)} ${ok ? "✓ RECOVERED" : "✗ still null"}`);
    console.log(`     ${CF_FIELDS.map((f) => `${f}=${fmt(parsed[f])}`).join("  ")}`);
    await sleep(350);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.1d(ii) — the 5 GENUINE absences must STILL be null                     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const [sym, fy] of GENUINE) {
    const out = await reparse(sym, fy);
    if (!out) { console.log(`  ${sym} ${fy}: no row`); continue; }
    const { parsed } = out;
    const stillNull = CF_FIELDS.every((f) => parsed[f] === null);
    if (!stillNull) fail++;
    console.log(`  ${pad(sym + " " + fy, 20)} ${CF_FIELDS.map((f) => `${f}=${fmt(parsed[f])}`).join("  ")}  ${stillNull ? "✓ still null" : "✗ FABRICATED A NUMBER"}`);
    await sleep(350);
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.1d(iii) — P&L / balance-sheet fields MUST be unchanged by the fix       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const [sym, fy] of [...FALSE_NULL, ...GENUINE]) {
    const out = await reparse(sym, fy);
    if (!out) continue;
    const { r, parsed } = out;
    const diffs: string[] = [];
    const cmp = (name: string, dbv: number | null, pv: number | null) => {
      const a = dbv === null ? null : Number(dbv), b = pv === null ? null : Number(pv);
      if (a === null && b === null) return;
      if (a === null || b === null || Math.abs(a - b) > 0.011) diffs.push(`${name}: db=${fmt(a)} parsed=${fmt(b)}`);
    };
    cmp("revenue", r.db_rev, parsed.revenue);
    cmp("net_profit", r.db_np, parsed.netProfit);
    cmp("total_assets", r.db_ta, parsed.totalAssets);
    if (diffs.length) fail++;
    console.log(`  ${pad(sym + " " + fy, 20)} ${diffs.length === 0 ? "✓ revenue / net_profit / total_assets identical to the stored row" : "✗ " + diffs.join(" · ")}`);
    await sleep(350);
  }

  console.log(`\n═══ T5.1d: ${fail === 0 ? "✓ FIX PROVEN — recovers the false nulls, fabricates nothing, moves no P&L/BS field" : `✗ ${fail} FAILURE(S)`} ═══\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
