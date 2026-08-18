// ═══════════════════════════════════════════════════════════════
// R3 — THE FENCE CHECK. Runs FIRST, before any other post-run analysis.
// READ-ONLY.
//   npx tsx src/scripts/_r3-fence.ts
//
// R3a ⚠ DISQUALIFYING. Every row with report_date >= 2025-03-31 must carry an
//     IDENTICAL source AND updated_at to the R1d baseline. One byte of movement
//     and the run is void: stop, report, do not proceed to R4.
// R3b DB-wide: zero rows at/after 2025-03-31 may carry a *_legacy source.
//
// The comparison is by ROW ID, not by key — so a row that was deleted and
// re-created under the same key (which would preserve the key but not the id)
// is caught as a vanish, not silently accepted.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { TABLES } from "./_r1-colmap.js";

const DIR = process.env.R1_DIR ?? ".";
const BASE = `${DIR}/_r1d-v3-before.json`;
const V3_FLOOR = "2025-03-31";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

interface V3Row { t: string; sym: string; period: string; basis: string; rd: string; src: string; ua: string; id: string }

async function main() {
  if (!existsSync(BASE)) { console.error(`FATAL: baseline missing ${BASE}`); process.exit(1); }
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const rows: V3Row[] = base.rows;

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R3a — THE FENCE · ⚠ DISQUALIFYING                                          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  baseline captured ${base.capturedAt} · ${rows.length} rows at report_date >= ${V3_FLOOR}`);

  // current state of every baseline row, by id
  const cur = new Map<string, { src: string; ua: string; rd: string }>();
  const ids = rows.map((r) => r.id);
  for (const t of TABLES) {
    for (let i = 0; i < ids.length; i += 500) {
      const got = await raw<any>(
        `SELECT "id","source" src,"updated_at"::text ua,"report_date"::text rd FROM "${t}" WHERE "id" = ANY($1::text[])`,
        ids.slice(i, i + 500));
      for (const g of got) cur.set(g.id, { src: g.src, ua: g.ua, rd: g.rd });
    }
  }

  const srcMoved: string[] = [], uaMoved: string[] = [], rdMoved: string[] = [], vanished: string[] = [];
  for (const b of rows) {
    const c = cur.get(b.id);
    if (!c) { vanished.push(`${b.sym} ${b.t} ${b.period} ${b.basis} (id ${b.id})`); continue; }
    if (c.src !== b.src) srcMoved.push(`${b.sym} ${b.t} ${b.period} ${b.basis}: ${b.src} → ${c.src}`);
    if (c.ua !== b.ua) uaMoved.push(`${b.sym} ${b.t} ${b.period} ${b.basis}: ${b.ua} → ${c.ua}`);
    if (c.rd !== b.rd) rdMoved.push(`${b.sym} ${b.t} ${b.period} ${b.basis}: ${b.rd} → ${c.rd}`);
  }

  console.log(`\n  rows checked                       : ${rows.length}`);
  console.log(`  rows VANISHED                      : ${vanished.length === 0 ? "✓ 0" : "⚠ " + vanished.length}`);
  for (const v of vanished.slice(0, 30)) console.log(`      ⚠ ${v}`);
  console.log(`  rows whose SOURCE moved            : ${srcMoved.length === 0 ? "✓ 0" : "⚠ " + srcMoved.length}`);
  for (const v of srcMoved.slice(0, 30)) console.log(`      ⚠ ${v}`);
  console.log(`  rows whose UPDATED_AT moved        : ${uaMoved.length === 0 ? "✓ 0" : "⚠ " + uaMoved.length}`);
  for (const v of uaMoved.slice(0, 30)) console.log(`      ⚠ ${v}`);
  console.log(`  rows whose REPORT_DATE moved       : ${rdMoved.length === 0 ? "✓ 0" : "⚠ " + rdMoved.length}`);
  for (const v of rdMoved.slice(0, 30)) console.log(`      ⚠ ${v}`);

  // NEW rows that appeared above the fence — the other direction of the same question
  console.log(`\n  ── did anything NEW appear above the fence? ──`);
  const baseIds = new Set(ids);
  let appeared = 0;
  for (const t of TABLES) {
    const got = await raw<any>(
      `SELECT x."id", st."symbol" s, x."fiscal_year" fy, x."source" src, x."report_date"::text rd
         FROM "${t}" x JOIN stocks st ON st."id"=x."stock_id"
        WHERE x."report_date" >= DATE '${V3_FLOOR}'`);
    for (const g of got) if (!baseIds.has(g.id)) { appeared++; console.log(`      ⚠ NEW ${t} ${g.s} ${g.fy} ${g.rd} ${g.src}`); }
  }
  console.log(`  rows APPEARED above the fence      : ${appeared === 0 ? "✓ 0" : "⚠ " + appeared}`);

  // ⚠ THE VERDICT, REFINED — and the refinement is stated, not slipped in.
  //
  // The original test was "identical source AND updated_at". That was written when
  // the run was expected to hold for every cron. Aman then INVERTED THE PRIORITY:
  // the backfill runs through whatever fires, so the production pipeline keeps
  // writing v3 rows while we work. `updated_at` movement therefore no longer
  // isolates the backfill — it catches results_scan doing its job.
  //
  // What still isolates the backfill EXACTLY is the SOURCE. The legacy path stamps
  // nse_xbrl_quarterly_legacy / nse_xbrl_annual_legacy on every row it writes,
  // unconditionally. So the disqualifying set is:
  //     a legacy source above the floor · a moved report_date · a vanished row ·
  //     a row that appeared above the floor
  // and `updated_at` movement with an UNCHANGED v3 source is an OBSERVATION about
  // the pipeline, not a breach by us.
  const disqualifying = vanished.length + srcMoved.length + rdMoved.length + appeared;
  const clean = disqualifying === 0;
  console.log(`\n  ── VERDICT ──`);
  console.log(`  DISQUALIFYING signals (legacy source above the floor · moved report_date ·`);
  console.log(`  vanished row · row appeared above the floor)      : ${disqualifying === 0 ? "✓ 0" : "⚠ " + disqualifying}`);
  console.log(`  OBSERVED, not disqualifying — updated_at moved with the v3 source INTACT: ${uaMoved.length}`);
  if (uaMoved.length) {
    console.log(`    these are production-pipeline refreshes during the run (the holds were dropped`);
    console.log(`    by ruling, so results_scan and friends keep writing). Attributed in _r3b-attribute.ts.`);
  }
  console.log(`\n  ${clean ? "✓✓ R3a PASS — THE BACKFILL TOUCHED NO v3 ROW." : "✗✗ R3a FAIL — THE RUN IS DISQUALIFIED. STOP."}`);

  // ── R3b ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R3b — DB-WIDE: any *_legacy source at/after ${V3_FLOOR}?                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  let legacyAtV3 = 0;
  for (const t of TABLES) {
    const [x] = await raw<any>(
      `SELECT count(*)::int n, count(*) FILTER (WHERE "source" LIKE '%_legacy')::int legacy
         FROM "${t}" WHERE "report_date" >= DATE '${V3_FLOOR}'`);
    legacyAtV3 += x.legacy;
    console.log(`  ${pad(t, 28)} rows ${lp(x.n, 6)} · *_legacy ${x.legacy === 0 ? "✓ 0" : "⚠ " + x.legacy}`);
    if (x.legacy > 0) {
      const bad = await raw<any>(
        `SELECT st."symbol" s, x."fiscal_year" fy, x."result_type" rt, x."report_date"::text rd, x."source" src
           FROM "${t}" x JOIN stocks st ON st."id"=x."stock_id"
          WHERE x."report_date" >= DATE '${V3_FLOOR}' AND x."source" LIKE '%_legacy' ORDER BY 1 LIMIT 30`);
      for (const b of bad) console.log(`      ⚠ ${b.s} ${b.fy} ${b.rt} ${b.rd} ${b.src}`);
    }
  }
  console.log(`\n  ${legacyAtV3 === 0 ? "✓ R3b PASS — no legacy source anywhere at/after the v3 floor." : "✗ R3b FAIL — " + legacyAtV3 + " row(s)."}`);

  // the highest period the run actually wrote — the margin, measured after the fact
  console.log(`\n  ── the run's actual ceiling (highest report_date carrying a *_legacy source) ──`);
  for (const t of TABLES) {
    const [x] = await raw<any>(
      `SELECT max("report_date")::text hi, count(*)::int n FROM "${t}" WHERE "source" LIKE '%_legacy'`);
    console.log(`  ${pad(t, 28)} ${x.n ? `${x.n} legacy rows · highest report_date ${String(x.hi).slice(0, 10)}` : "(no legacy rows)"}`);
  }
  console.log(`  the v3 floor is ${V3_FLOOR} — the gap between the two is the realised margin.\n`);

  await prisma.$disconnect();
  if (!clean || legacyAtV3 > 0) process.exit(9);
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
