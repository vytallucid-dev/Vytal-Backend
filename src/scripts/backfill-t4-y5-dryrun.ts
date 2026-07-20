// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// T-4 BACKFILL — DRY-RUN ONLY. READS. NEVER WRITES. Reports the projected write/skip, then STOPS.
//
// ⚠ THE MASS WRITE IS AMAN'S. This script writes NOTHING. It projects what a re-fold under the T-4 fix
// (y5 volatility now tested) would change, so the mass write can be reviewed before it runs.
//
// ── WHY THIS IS A DB PROJECTION, NOT A FOLD ──────────────────────────────────────────────────────
// The real fold streams AMFI's raw NAV over the network (hours) and RAW NAV NEVER PERSISTS, so there is
// no cached series to re-fold cheaply. `vol_5y` itself is not stored. So this projects from what the DB
// DOES hold: a row flips IFF its y5 volatility exceeds VOL_MAX — and a series contaminated enough for
// that shows in its stored `vol_1y`/`vol_3y` omission (the 1y/3y windows sit INSIDE the ≤5y series the
// 65 side pockets carry). This is the DB-derivable set; ★ AMAN'S REAL FOLD IS AUTHORITATIVE and may
// additionally catch a row contaminated ONLY in years 4–5 (invisible to the stored columns) — reported
// as the residual below so the number is honest about its own floor.
//
//   npx tsx src/scripts/backfill-t4-y5-dryrun.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
const q = <T = any>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
const n = (x: any) => Number(x);
const line = () => console.log("─".repeat(96));

async function main() {
  console.log("\n════ T-4 BACKFILL DRY-RUN — y5 volatility hole. NO WRITES. ════\n");

  const [tot] = await q(`SELECT count(*) AS rows,
      count(*) FILTER (WHERE max_drawdown_5y IS NOT NULL) AS dd5_present,
      count(*) FILTER (WHERE max_drawdown_5y = 0) AS dd5_zero FROM mf_analytics`);
  console.log(`catalog: ${n(tot.rows)} rows · dd5 present on ${n(tot.dd5_present)} · dd5 == 0 on ${n(tot.dd5_zero)}`);
  line();

  // ── PROJECTED WRITE — rows whose y5 window will now be WITHHELD (dd5 present + series contaminated) ──
  const [flip] = await q(`
    SELECT count(*) AS n,
      count(*) FILTER (WHERE max_drawdown_5y = 0) AS dd5_zero,
      count(*) FILTER (WHERE max_drawdown_5y <> 0) AS dd5_nonzero,
      count(*) FILTER (WHERE max_drawdown_3y IS NULL) AS dd3_also_withheld
    FROM mf_analytics
    WHERE max_drawdown_5y IS NOT NULL
      AND ( omissions::jsonb->>'vol_3y' = 'withheld_implausible'
         OR omissions::jsonb->>'vol_1y' = 'withheld_implausible' )`);
  console.log(`★ PROJECTED WRITE — dd5 present + series impossible → dd5 becomes withheld_implausible:`);
  console.log(`    ${n(flip.n)} rows  (dd5==0: ${n(flip.dd5_zero)} · dd5<>0: ${n(flip.dd5_nonzero)} · dd3 also withheld: ${n(flip.dd3_also_withheld)})`);
  const sample = await q(`
    SELECT a.scheme_code, a.max_drawdown_5y AS dd5, i.name
    FROM mf_analytics a LEFT JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
    WHERE a.max_drawdown_5y IS NOT NULL
      AND ( a.omissions::jsonb->>'vol_3y' = 'withheld_implausible' OR a.omissions::jsonb->>'vol_1y' = 'withheld_implausible' )
    ORDER BY a.scheme_code LIMIT 5`);
  for (const s of sample) console.log(`      ${s.scheme_code}  dd5=${s.dd5} → null  ${String(s.name ?? "").slice(0, 58)}`);
  line();

  // ── PROJECTED SKIP — the TRUE zeros that must SURVIVE (dd5 == 0, no contamination) ──
  const [survive] = await q(`
    SELECT count(*) AS n FROM mf_analytics
    WHERE max_drawdown_5y = 0
      AND coalesce(omissions::jsonb->>'vol_3y','') <> 'withheld_implausible'
      AND coalesce(omissions::jsonb->>'vol_1y','') <> 'withheld_implausible'`);
  console.log(`★ PROJECTED SKIP — true 0% drawdowns (overnight/liquid funds, no contamination) MUST survive:`);
  console.log(`    ${n(survive.n)} rows  (and ${n(flip.dd5_zero)} contaminated + ${n(survive.n)} true = ${n(flip.dd5_zero) + n(survive.n)} total dd5==0 → ${n(flip.dd5_zero) + n(survive.n) === n(tot.dd5_zero) ? "MATCHES" : "MISMATCH"} the ${n(tot.dd5_zero)} zeros)`);
  line();

  // ── NESTING — a flip only REMOVES dd5, never reorders, so |dd5| ≥ |dd3| cannot be newly violated ──
  const [nest] = await q(`
    SELECT count(*) AS both,
      count(*) FILTER (WHERE abs(max_drawdown_5y) < abs(max_drawdown_3y)) AS violations
    FROM mf_analytics WHERE max_drawdown_5y IS NOT NULL AND max_drawdown_3y IS NOT NULL`);
  console.log(`★ NESTING now: ${n(nest.both)} rows carry both dd5 & dd3 · violations |dd5|<|dd3|: ${n(nest.violations)}`);
  console.log(`    a flip removes dd5, never reorders — nesting cannot be newly violated by this backfill.`);
  line();

  console.log(`\n⚠ RESIDUAL (honesty about the floor): this DB projection catches rows contaminated in the`);
  console.log(`  1y/3y windows (the ${n(flip.n)} above). A row contaminated ONLY in years 4–5 has fine`);
  console.log(`  stored vols and is invisible here — AMAN'S REAL FOLD will catch any such row. The ${n(flip.n)} is the floor.`);
  console.log(`\n════ DRY-RUN COMPLETE — NOTHING WRITTEN. Aman runs the mass write (stop the 20:00 UTC fold first). ════\n`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
