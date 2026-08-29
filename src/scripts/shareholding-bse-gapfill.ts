// ═══════════════════════════════════════════════════════════════
// NSE→BSE SHAREHOLDING GAP-FILL — the fallback sweep, runnable on demand.
//
//   PREVIEW:  npx tsx src/scripts/shareholding-bse-gapfill.ts
//   EXECUTE:  npx tsx src/scripts/shareholding-bse-gapfill.ts --confirm
//   OPTIONS:  --quarters N        how many past-deadline quarters to reconcile (default 8)
//             --symbols A,B,C     restrict to named stocks
//
// Finds quarters the NSE pipeline missed and fills them from BSE. Inserts only —
// an existing NSE row is never overwritten.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  fillShareholdingGapsFromBse, reconcilableQuarters, FILING_WINDOW_DAYS,
} from "../ingestions/shareholdings/bse/bse-shp-gapfill.js";

const argVal = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const CONFIRM = process.argv.includes("--confirm");
const QUARTERS = Number(argVal("--quarters") ?? 8);
const SYMBOLS = argVal("--symbols")?.split(",").map((s) => s.trim().toUpperCase());

async function main(): Promise<void> {
  const qs = reconcilableQuarters(QUARTERS);
  console.log(`\n=== SHAREHOLDING GAP-FILL (NSE -> BSE fallback) ===`);
  console.log(`  mode: ${CONFIRM ? "--confirm (LIVE WRITE)" : "PREVIEW"}`);
  console.log(`  reconciling ${qs.length} past-deadline quarters (SEBI window ${FILING_WINDOW_DAYS}d)`);
  console.log(`  ${qs.join("  ")}`);
  if (SYMBOLS) console.log(`  restricted to: ${SYMBOLS.join(", ")}`);
  console.log("");

  const r = await fillShareholdingGapsFromBse({
    lookbackQuarters: QUARTERS,
    dryRun: !CONFIRM,
    symbols: SYMBOLS,
    onProgress: (done, total, label) => {
      if (done % 25 === 0 || done === total) console.log(`  ... ${done}/${total}  ${label}`);
      return true;
    },
  });

  console.log(`\n-- RESULT --`);
  console.log(`  stocks scanned        ${r.scanned}`);
  console.log(`  gaps found            ${r.gaps}`);
  console.log(`  ${CONFIRM ? "filled from BSE     " : "would fill from BSE "}  ${r.filled}`);
  console.log(`  BSE also lacks it     ${r.unavailable}`);
  console.log(`  guard rejected        ${r.guardFailed}`);
  console.log(`  no BSE scrip code     ${r.noScripCode}`);

  if (r.details.length) {
    console.log(`\n-- DETAIL --`);
    for (const d of r.details) console.log(`  ${d.symbol.padEnd(13)} ${d.quarter}  ${d.outcome}`);
  }
  if (!CONFIRM && r.filled > 0) console.log(`\n  Re-run with --confirm to write.\n`);
  else console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
