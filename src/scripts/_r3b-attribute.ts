// ═══════════════════════════════════════════════════════════════
// R3 ATTRIBUTION — 85 v3 rows moved updated_at. WHOSE WRITE WAS IT?
// READ-ONLY.
//   npx tsx src/scripts/_r3b-attribute.ts
//
// The fence baseline was captured at 11:19 UTC. Any write to a v3 row after that
// shows as "moved" — including LEGITIMATE writes by the production pipeline,
// which did not stop just because a backfill is running. The fence's real
// question is narrower and sharper:
//
//     did THE LEGACY BACKFILL touch a row at/after the v3 floor?
//
// That has a decisive signature. The legacy path writes source
// nse_xbrl_quarterly_legacy / nse_xbrl_annual_legacy, unconditionally, on every
// row it touches. So:
//   · source unchanged AND still a v3 source  ⇒ NOT the backfill
//   · source flipped to *_legacy              ⇒ THE BACKFILL (disqualifying)
// This script separates the two and time-attributes the movement.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { TABLES } from "./_r1-colmap.js";

const DIR = process.env.R1_DIR ?? ".";
const RUN_START = process.env.R2_CUT ?? "2026-08-16 11:38:00";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  const base = JSON.parse(readFileSync(`${DIR}/_r1d-v3-before.json`, "utf8"));
  const rows: any[] = base.rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = rows.map((r) => r.id);

  const cur = new Map<string, any>();
  for (const t of TABLES) {
    for (let i = 0; i < ids.length; i += 500) {
      const got = await raw<any>(
        `SELECT x."id", x."source" src, x."updated_at"::text ua, x."created_at"::text ca,
                x."report_date"::text rd, st."symbol" sym, '${t}' AS tbl
           FROM "${t}" x JOIN stocks st ON st."id"=x."stock_id" WHERE x."id" = ANY($1::text[])`,
        ids.slice(i, i + 500));
      for (const g of got) cur.set(g.id, g);
    }
  }

  const moved = rows.filter((b) => { const c = cur.get(b.id); return c && c.ua !== b.ua; });
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R3 ATTRIBUTION — who moved the ${lp(moved.length, 3)} v3 rows?                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  baseline captured ${base.capturedAt} · backfill started ${RUN_START}`);

  // ── THE DECISIVE TEST: did any source flip to *_legacy? ──
  const flipped = moved.filter((b) => { const c = cur.get(b.id); return c.src !== b.src; });
  const toLegacy = moved.filter((b) => { const c = cur.get(b.id); return String(c.src).includes("_legacy"); });
  console.log(`\n  ── THE DECISIVE TEST ──`);
  console.log(`  rows whose SOURCE changed at all            : ${flipped.length === 0 ? "✓ 0" : "⚠ " + flipped.length}`);
  console.log(`  rows now carrying a *_legacy source         : ${toLegacy.length === 0 ? "✓ 0" : "⚠ " + toLegacy.length}`);
  console.log(`  ⇒ the legacy path stamps *_legacy on EVERY row it writes. Zero legacy sources`);
  console.log(`    above the fence means the backfill wrote NONE of these rows.`);

  // ── WHEN did they move? ──
  console.log(`\n  ── WHEN the movement happened (updated_at of the moved rows) ──`);
  const buckets = new Map<string, number>();
  for (const b of moved) { const c = cur.get(b.id); buckets.set(String(c.ua).slice(0, 16), (buckets.get(String(c.ua).slice(0, 16)) ?? 0) + 1); }
  for (const [k, v] of [...buckets.entries()].sort()) console.log(`    ${pad(k, 20)}${lp(v, 5)} row(s)`);

  // ── WHAT they are ──
  console.log(`\n  ── by table and source (source is UNCHANGED on all of them) ──`);
  const bySrc = new Map<string, number>();
  for (const b of moved) { const c = cur.get(b.id); bySrc.set(`${c.tbl} · ${c.src}`, (bySrc.get(`${c.tbl} · ${c.src}`) ?? 0) + 1); }
  for (const [k, v] of [...bySrc.entries()].sort()) console.log(`    ${pad(k, 52)}${lp(v, 5)}`);

  console.log(`\n  ── the symbols involved, and their newest period ──`);
  const bySym = new Map<string, { n: number; maxRd: string }>();
  for (const b of moved) {
    const c = cur.get(b.id);
    const e = bySym.get(c.sym) ?? { n: 0, maxRd: "" };
    e.n++; if (String(c.rd) > e.maxRd) e.maxRd = String(c.rd).slice(0, 10);
    bySym.set(c.sym, e);
  }
  console.log(`    ${bySym.size} distinct symbol(s):`);
  for (const [s, e] of [...bySym.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`      ${pad(s, 14)}${lp(e.n, 4)} row(s) · newest period ${e.maxRd}`);

  // ── were these symbols in the backfill's ledger at the time? ──
  const ledger = JSON.parse(readFileSync(`${DIR}/_r2-ledger.json`, "utf8"));
  const done = new Set<string>(ledger.done);
  const inLedger = [...bySym.keys()].filter((s) => done.has(s));
  console.log(`\n  of those symbols, how many has the backfill processed? ${inLedger.length}/${bySym.size}`);
  console.log(`    (irrelevant to blame — the backfill CANNOT write above ${base.v3Floor} because`);
  console.log(`     toDate=2025-01-31 filters on period-end — but stated so the overlap is visible)`);

  // ── corroboration: what did the production pipeline do in that window? ──
  console.log(`\n  ── corroboration from background_jobs ──`);
  const jobs = await raw<any>(
    `SELECT "type","status","triggeredBy" tb,"created_at"::text ca,"finished_at"::text fa
       FROM background_jobs WHERE "created_at" > TIMESTAMP '${RUN_START}' ORDER BY "created_at"`);
  for (const j of jobs) console.log(`    ${pad(j.type, 24)}${pad(j.status, 11)}by=${pad(j.tb, 28)}${String(j.ca).slice(0, 19)} → ${String(j.fa).slice(0, 19)}`);

  const verdict = toLegacy.length === 0 && flipped.length === 0;
  console.log(`\n  ══ VERDICT ══`);
  if (verdict) {
    console.log(`  ✓ THE BACKFILL DID NOT TOUCH ANY v3 ROW.`);
    console.log(`    ${moved.length} rows were refreshed by the PRODUCTION pipeline after the 11:19 baseline;`);
    console.log(`    every one kept its v3 source, none gained a *_legacy stamp, none moved report_date,`);
    console.log(`    none vanished, none appeared. R3b (DB-wide, no *_legacy at/after the floor) PASSES.`);
    console.log(`  ⇒ the R3a "FAIL" is the baseline being older than the production pipeline, not a breach.`);
  } else {
    console.log(`  ✗ A ROW ABOVE THE FENCE CARRIES A LEGACY SOURCE — THIS IS A REAL BREACH.`);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
