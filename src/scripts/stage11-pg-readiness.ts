// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 11 — COULD THE 10 UNSCORED PEER GROUPS BE SCORED TODAY? Read-only. Enables nothing.
//
//   npx tsx src/scripts/stage11-pg-readiness.ts
//
// ── HOW IT ANSWERS ───────────────────────────────────────────────────────────────────────────────
// By RUNNING THE SCORER, not by checking proxies for it. computePgScores is pure up to persist — it
// reads, computes every pillar, assembles the composite, and returns. Nothing is written. Any
// data-shaped answer ("do they have quarterly rows? do they have shareholding?") would be a guess at
// what the engine needs; this is the engine's own verdict.
//
// ⚠ A PG IS NOT "READY" BECAUSE IT PRODUCES NUMBERS. It is ready when every member reaches
//   `scored` — one unavailable member is a hole in the peer statistics that every OTHER member's
//   percentile is computed against, so a PG scored with a member missing is not the same PG.
//   Both are reported: members scored, and which ones are not, with the pillar that blocked them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";

const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

/** seedKey is only carried for PgRef completeness; the roster resolves by pgName. */
const slug = (name: string): string =>
  name.toLowerCase().replace(/^large-cap\s+/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(108)}`);
  console.log(`STAGE 11 — READINESS OF THE UNSCORED PEER GROUPS (read-only; nothing is enabled)`);
  console.log("=".repeat(108));

  const unscored = await raw<{ name: string; build_order: number; members: number }>(`
    SELECT pg.name, pg.build_order, count(DISTINCT sp.stock_id)::int members
      FROM peer_groups pg
      LEFT JOIN stock_peer_groups sp ON sp.peer_group_id = pg.id
      LEFT JOIN score_snapshots ss ON ss.stock_id = sp.stock_id
     GROUP BY 1,2 HAVING count(DISTINCT ss.stock_id) = 0
     ORDER BY pg.build_order NULLS LAST, pg.name`);
  console.log(`\n  ${unscored.length} peer group(s) have never been scored\n`);

  const rows: Array<{ pg: string; members: number; scored: number; blocked: string[]; err: string | null }> = [];

  for (const u of unscored) {
    const ref: PgRef = { pgId: `?${u.build_order ?? "-"}`, seedKey: slug(u.name), pgName: u.name };
    process.stdout.write(`  ${u.name.padEnd(44)} `);
    try {
      const pg = await computePgScores(ref, { withFindings: true });
      const scored = pg.members.filter((m) => m.composite.state === "scored" && m.composite.composite != null);
      const blocked: string[] = [];
      for (const m of pg.members) {
        if (m.composite.state === "scored" && m.composite.composite != null) continue;
        const mm = m as unknown as { fPillar?: { subtotal?: number | null }; mPillar?: { subtotal?: number | null }; market?: unknown; own?: unknown };
        const missing: string[] = [];
        if (mm.fPillar?.subtotal == null) missing.push("foundation");
        if (mm.mPillar?.subtotal == null) missing.push("momentum");
        if (!mm.market) missing.push("market");
        if (!mm.own) missing.push("ownership");
        blocked.push(`${m.symbol}(${missing.join("+") || "composite"})`);
      }
      rows.push({ pg: u.name, members: pg.members.length, scored: scored.length, blocked, err: null });
      console.log(`${scored.length}/${pg.members.length} members scored${blocked.length ? `   blocked: ${blocked.join(" ")}` : "   READY"}`);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 120);
      rows.push({ pg: u.name, members: u.members, scored: 0, blocked: [], err: msg });
      console.log(`COMPUTE FAILED — ${msg}`);
    }
  }

  const ready = rows.filter((r) => !r.err && r.scored === r.members && r.members > 0);
  const partial = rows.filter((r) => !r.err && r.scored > 0 && r.scored < r.members);
  const none = rows.filter((r) => r.err || r.scored === 0);

  console.log(`\n  ── VERDICT ──`);
  console.log(`  ${"peer group".padEnd(44)} ${"members".padStart(7)} ${"scored".padStart(6)}  verdict`);
  console.log(`  ${"-".repeat(44)} ${"-".repeat(7)} ${"-".repeat(6)}  ${"-".repeat(40)}`);
  for (const r of rows) {
    const verdict = r.err ? `ERROR: ${r.err.slice(0, 40)}`
      : r.members === 0 ? "no members"
      : r.scored === r.members ? "READY — every member scores"
      : r.scored === 0 ? "NOT READY — no member scores"
      : `PARTIAL — ${r.members - r.scored} member(s) blocked`;
    console.log(`  ${r.pg.slice(0, 44).padEnd(44)} ${String(r.members).padStart(7)} ${String(r.scored).padStart(6)}  ${verdict}`);
  }
  console.log(`\n  ready ${ready.length} · partial ${partial.length} · not ready ${none.length}`);
  if (partial.length) {
    console.log(`\n  ── WHAT BLOCKS THE PARTIAL ONES ──`);
    for (const r of partial) console.log(`     ${r.pg}\n        ${r.blocked.join("  ")}`);
  }

  fs.writeFileSync("_PG_READINESS.json", JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1));
  console.log(`\n  detail -> _PG_READINESS.json`);
  console.log(`  Nothing was enabled and nothing was written.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
