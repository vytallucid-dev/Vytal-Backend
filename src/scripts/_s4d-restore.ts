// ═══════════════════════════════════════════════════════════════
// R2b — RESTORE a v3 quarter destroyed by the T3 fence breach.
//   npx tsx src/scripts/_s4d-restore.ts --stock SIEMENS --from 2025-04-01 [--commit]
//
// The repair transaction (R2) can relabel and de-duplicate rows that EXIST; it
// cannot recreate a row that was overwritten out of existence. SIEMENS's
// 2025-06-30 quarter (both bases) was destroyed when the corrected legacy label
// collided with the old wrong v3 key. Only a fresh V3 fetch can bring it back.
//
// ⚠ V3 PATH ONLY. A legacy fetch would stamp nse_xbrl_*_legacy on a row above the
//   v3 floor (2025-03-31) — precisely the breach being repaired. scanSymbol() is
//   the v3 entry point and stamps nse_xbrl_quarterly / nse_xbrl_annual.
//
// ⚠ PRE-CHECKED: _c1b-collide.ts --only SIEMENS reports 59/59 identical, so a v3
//   rescan reproduces every stored label exactly and cannot collide.
//
// Asserts, around the scan:
//   · no row present before is absent after       (nothing lost)
//   · no *_legacy source at/after the v3 floor    (fence, DB-wide)
//   · every baseline v3 id still holds its period (fence, BY ID)
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { scanSymbol } from "../ingestions/quaterly-results/scan.js";

const DIR = process.env.R1_DIR ?? ".";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const STOCK = arg("--stock") ?? "SIEMENS";
const FROM = arg("--from") ?? "2025-04-01";
const COMMIT = process.argv.includes("--commit");
const V3_FLOOR = "2025-03-31";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);

const snapshot = async () =>
  raw(`SELECT q."id", q."fiscal_year"||q."quarter" lbl, q."result_type" rt, q."report_date"::text rd, q."source" src
         FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id"
        WHERE s."symbol"=$1 ORDER BY q."report_date", q."result_type"`, STOCK);

async function main() {
  const [clk] = await raw(`SELECT date_part('hour',now() AT TIME ZONE 'UTC')::int h, date_part('minute',now() AT TIME ZONE 'UTC')::int m`);
  const mins = Number(clk.h) * 60 + Number(clk.m);
  const prune = mins >= 21 * 60 + 25 && mins <= 21 * 60 + 55;
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R2b RESTORE · ${pad(STOCK, 12)} · V3 PATH · ${COMMIT ? "⚠ COMMIT" : "DRY RUN"}                        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  UTC ${String(clk.h).padStart(2, "0")}:${String(clk.m).padStart(2, "0")} · RETENTION_PRUNE ${prune ? "⚠ INSIDE" : `✓ clear (${21 * 60 + 30 - mins} min)`}`);
  if (COMMIT && prune) { console.log(`  ✗ refusing to run alongside RETENTION_PRUNE.`); await prisma.$disconnect(); process.exit(2); }

  const before = await snapshot();
  const key = (r: any) => `${String(r.rd).slice(0, 10)}|${r.rt}`;
  const beforeKeys = new Set(before.map(key));
  console.log(`  rows before: ${before.length}  (SA ${before.filter((r) => r.rt === "standalone").length} · CO ${before.filter((r) => r.rt === "consolidated").length})`);
  console.log(`  missing periods this restore targets (>= ${FROM}):`);
  const have = [...new Set(before.filter((r) => String(r.rd).slice(0, 10) >= FROM).map((r) => String(r.rd).slice(0, 10)))].sort();
  console.log(`    present: ${have.join(", ") || "(none)"}`);

  if (!COMMIT) { console.log(`\n  DRY RUN — pass --commit to fetch.\n`); await prisma.$disconnect(); return; }

  console.log(`\n  ── scanSymbol(${STOCK}, fromQeDate=${FROM}) · v3 path ──`);
  const res = await scanSymbol(STOCK, { fromQeDate: new Date(`${FROM}T00:00:00Z`) });
  console.log(`     filings ${res.totalFilings} · groups ${res.totalGroups} · ingested ${res.ingested} · upgraded ${res.upgraded} · refreshed ${res.refreshed} · skipped ${res.skipped} · failed ${res.failed}`);
  for (const e of res.errors.slice(0, 10)) console.log(`     ⚠ ${typeof e === "string" ? e : JSON.stringify(e)}`);

  const after = await snapshot();
  const afterKeys = new Set(after.map(key));
  console.log(`\n  rows after: ${after.length}  (SA ${after.filter((r) => r.rt === "standalone").length} · CO ${after.filter((r) => r.rt === "consolidated").length})`);
  const gained = [...afterKeys].filter((k) => !beforeKeys.has(k)).sort();
  const lost = [...beforeKeys].filter((k) => !afterKeys.has(k)).sort();
  console.log(`  periods GAINED (${gained.length}): ${gained.join(", ") || "(none)"}`);
  console.log(`  periods LOST   (${lost.length}): ${lost.join(", ") || "✓ none"}`);

  // ── assertions ──
  console.log(`\n  ── ASSERTIONS ──`);
  let fail = 0;
  if (lost.length) { console.log(`  ✗ ${lost.length} period(s) lost`); fail++; } else console.log(`  ✓ no period present before is absent after`);

  const dup = await raw(`SELECT q."report_date"::text rd, q."result_type" rt, count(*)::int n
      FROM quarterly_results q JOIN stocks s ON s."id"=q."stock_id" WHERE s."symbol"=$1
      GROUP BY 1,2 HAVING count(*)>1`, STOCK);
  if (dup.length) { console.log(`  ✗ ${dup.length} duplicated (report_date, basis)`); for (const d of dup) console.log(`      ${String(d.rd).slice(0, 10)} ${d.rt} ×${d.n}`); fail++; }
  else console.log(`  ✓ one row per (report_date, basis)`);

  const breach = after.filter((r) => String(r.rd).slice(0, 10) >= V3_FLOOR && String(r.src).includes("_legacy"));
  if (breach.length) { console.log(`  ✗ ${breach.length} row(s) legacy-sourced at/after ${V3_FLOOR}`); for (const b of breach) console.log(`      ${String(b.rd).slice(0, 10)} ${b.rt} ${b.src}`); fail++; }
  else console.log(`  ✓ no *_legacy source at/after the v3 floor (${STOCK})`);

  let dbWide = 0;
  for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
    const [c] = await raw(`SELECT count(*)::int n FROM "${t}" WHERE "report_date" >= DATE '${V3_FLOOR}' AND "source" LIKE '%_legacy'`);
    dbWide += Number(c.n);
  }
  console.log(`  ${dbWide === 0 ? "✓" : "⚠"} DB-wide legacy rows at/after the floor: ${dbWide}`);

  // fence BY ID against the Stage 4b baseline
  try {
    const base = JSON.parse(readFileSync(`${DIR}/_r1d-v3-before.json`, "utf8"));
    const mine = (base.rows as any[]).filter((r) => r.sym === STOCK);
    const cur = new Map(after.map((r) => [r.id, r]));
    let moved = 0, vanished = 0;
    for (const b of mine) {
      const c: any = cur.get(b.id);
      if (!c) { vanished++; continue; }
      if (String(c.rd).slice(0, 10) !== String(b.rd).slice(0, 10) || String(c.src) !== String(b.src)) {
        moved++;
        console.log(`      ⚠ ${b.period} ${b.basis}: ${b.src}@${String(b.rd).slice(0, 10)} → ${c.src}@${String(c.rd).slice(0, 10)}`);
      }
    }
    console.log(`  fence by id (${STOCK}, ${mine.length} baseline rows): ${moved} moved · ${vanished} vanished${moved || vanished ? "  ⚠ (T3 residue — see report)" : "  ✓"}`);
  } catch { console.log(`  (no baseline file for by-id fence)`); }

  console.log(`\n  ${fail === 0 ? "✓✓ RESTORE CLEAN" : `✗✗ ${fail} ASSERTION FAILURE(S)`}\n`);
  await prisma.$disconnect();
  if (fail) process.exit(9);
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
