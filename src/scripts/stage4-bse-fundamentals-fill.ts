// ═══════════════════════════════════════════════════════════════
// STAGE 4 — annual + quarterly fundamentals to FY2019, WHOLE UNIVERSE, via BSE.
//
//   PREVIEW:  npx tsx src/scripts/stage4-bse-fundamentals-fill.ts
//   EXECUTE:  npx tsx src/scripts/stage4-bse-fundamentals-fill.ts --confirm
//   OPTIONS:  --symbols A,B,C   --limit N   --grain annual|quarterly
//
// Targets come from _s4-targets.json (written by stage4-fundamentals-audit.ts),
// which classifies gaps by EVIDENCE: a stock counts as having a gap only if it was
// TRADING before its first filing, or is missing a period INSIDE its own span.
// That distinction is what separates 107 stocks needing work from the 501 a naive
// "short of FY19" count reports.
//
// ⚠️ WHY runBseBackfill AND NOT backfillLegacySymbol.
//    The plan warns never to run backfillLegacySymbol on a column-filled stock:
//    it upserts the whole annual row and NULLS BSE-filled balance-sheet columns
//    while reporting refreshed=0. It destroyed 133 cells in an earlier session.
//    Worse, its only options are fromDate/toDate — it ALWAYS runs both the
//    Quarterly and the Annual leg, so the plan's suggested mitigation ("run the
//    quarterly leg only") is not reachable through that function at all.
//
//    runBseBackfill is the opposite by construction: dryRun defaults true, every
//    write is INSERT … ON CONFLICT DO NOTHING, and when a row already exists it
//    fills that row's NULLS ONLY (step 6b). It cannot null a populated cell.
//
// AFTER a live run this asserts the Layer-3 guarantee with verifyNoOverwrites():
// every BSE fill writes an audit row, and any row carrying a non-null old_value
// would mean an existing value was replaced. That must be zero.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import {
  runBseBackfill, BSE_FILL_EDITOR, type BseTarget,
} from "../ingestions/quaterly-results/bse/backfill-bse.js";
import { verifyNoOverwrites, type TxClient } from "../ingestions/quaterly-results/bse/bse-column-fill.js";

const argVal = (f: string): string | null => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const CONFIRM = process.argv.includes("--confirm");
const SYMBOLS = argVal("--symbols")?.split(",").map((s) => s.trim().toUpperCase());
const LIMIT = Number(argVal("--limit") ?? 0);
const GRAIN = argVal("--grain"); // annual | quarterly | null = both
const LEDGER = "_s4-bse-ledger.jsonl";

interface TargetSpec {
  symbol: string; industry: string; units: number;
  annualFrom: number | null; annualHoles: number[]; annualExtendTo: number | null;
  quarterlyMissing: string[]; listedFy: number | null; firstPriceBar: string | null;
}

/** FY label (19 = FY2019) -> that year's END date, honouring a December filer. */
function fyEndDate(fy: number, fye: string): Date {
  const year = 2000 + fy;
  // March filer: FY19 ends 2019-03-31. December filer: the FY LABEL for a Dec-2018
  // year-end is FY19 in this codebase, so the end date is 2018-12-31.
  return fye === "december" ? new Date(Date.UTC(year - 1, 11, 31)) : new Date(Date.UTC(year, 2, 31));
}

async function main(): Promise<void> {
  const spec = JSON.parse(fs.readFileSync("_s4-targets.json", "utf8")) as { targets: TargetSpec[] };
  const resolved = JSON.parse(fs.readFileSync("_s10-bse-resolved.json", "utf8")) as
    { symbol: string; scripCode: string }[];
  const scrip = new Map(resolved.map((r) => [r.symbol, r.scripCode]));

  let specs = spec.targets;
  if (SYMBOLS) specs = specs.filter((t) => SYMBOLS.includes(t.symbol));
  if (LIMIT > 0) specs = specs.slice(0, LIMIT);

  const stocks = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT symbol, id, "industryType"::text it, "fiscalYearEnd"::text fye FROM stocks WHERE is_active = true`,
  );
  const bySym = new Map(stocks.map((s) => [String(s.symbol), s]));

  const targets: BseTarget[] = [];
  const noScrip: string[] = [];
  for (const t of specs) {
    const st = bySym.get(t.symbol);
    const code = scrip.get(t.symbol);
    if (!st) continue;
    if (!code) { noScrip.push(t.symbol); continue; }
    const fye = String(st.fye ?? "march");
    const base = {
      symbol: t.symbol, stockId: String(st.id), scripCode: code,
      basis: "standalone" as const, industryType: String(st.it ?? "non_financial"),
    };

    if (GRAIN !== "quarterly") {
      // Extension years: from the bound (target or listing) up to the first FY held.
      if (t.annualExtendTo !== null && t.annualFrom !== null)
        for (let fy = t.annualExtendTo; fy < t.annualFrom; fy++)
          targets.push({ ...base, grain: "annual", periodEnd: fyEndDate(fy, fye) });
      // Internal holes.
      for (const fy of t.annualHoles)
        targets.push({ ...base, grain: "annual", periodEnd: fyEndDate(fy, fye) });
    }
    if (GRAIN !== "annual") {
      for (const d of t.quarterlyMissing)
        targets.push({ ...base, grain: "quarterly", periodEnd: new Date(`${d}T00:00:00.000Z`) });
    }
  }

  const annualN = targets.filter((t) => t.grain === "annual").length;
  const quarterN = targets.length - annualN;
  console.log(`\n=== STAGE 4 — BSE fundamentals fill (whole universe) ===`);
  console.log(`  mode: ${CONFIRM ? "--confirm (LIVE)" : "DRY RUN"}`);
  console.log(`  stocks in scope: ${specs.length}   targets: ${targets.length}  (annual ${annualN} · quarterly ${quarterN})`);
  if (noScrip.length) console.log(`  ⚠ no BSE scrip code, skipped: ${noScrip.join(", ")}`);
  const byInd = new Map<string, number>();
  for (const t of targets) byInd.set(t.industryType, (byInd.get(t.industryType) ?? 0) + 1);
  console.log(`  by industryType: ${[...byInd].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  if (!targets.length) { console.log("\n  nothing to do\n"); await prisma.$disconnect(); return; }

  const SINCE = new Date();
  const summary = await runBseBackfill(prisma as never, targets, {
    dryRun: !CONFIRM,
    ledgerFile: LEDGER,
    chunkSize: 20,
    pacer: new BsePacer({ minSpacingMs: 1500, slowMs: 12000, throttleStopMs: 90000, maxSpacingMs: 60000 }),
    log: (l: string) => console.log("   " + l),
  });

  console.log(`\n-- OUTCOMES --`);
  for (const [k, v] of Object.entries(summary.outcomes).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(28)} ${v}`);
  console.log(`  stopped: ${JSON.stringify(summary.stopped)}`);
  console.log(`  ratio refusals: ${summary.ratioRefusals}`);
  const cells = Object.values(summary.cellsFilled).reduce((a, b) => a + b, 0);
  console.log(`  cells filled into existing rows: ${cells}`);
  console.log(`  cells offered but HELD (already non-null): ${summary.cellsHeldNotNull}`);
  if (cells) {
    console.log(`\n  -- cells by column (top 20) --`);
    for (const [k, v] of Object.entries(summary.cellsFilled).sort((a, b) => b[1] - a[1]).slice(0, 20))
      console.log(`     ${k.padEnd(46)} ${v}`);
  }

  if (CONFIRM) {
    // ── LAYER 3: the no-overwrite guarantee, asserted rather than assumed ──
    const v = await verifyNoOverwrites(prisma as unknown as TxClient, BSE_FILL_EDITOR, SINCE);
    console.log(`\n-- LAYER-3 FENCE --`);
    console.log(`  ${v.total} audit rows · ${v.withOldValue} with a non-null old_value -> ${v.ok ? "CLEAN" : "❌ BREACH"}`);
    if (!v.ok) console.log(`  ❌ an existing value was overwritten — investigate before continuing`);
  } else {
    console.log(`\n  DRY RUN — nothing written. Re-run with --confirm.\n`);
  }
  const lat = [...summary.latencies].sort((a, b) => a - b);
  if (lat.length) console.log(`  BSE latency: n=${lat.length} p50=${lat[Math.floor(lat.length / 2)]}ms max=${lat[lat.length - 1]}ms`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
