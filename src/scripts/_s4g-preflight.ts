// S4G PREFLIGHT — READ ONLY. Cron window + P1 facts + P1c sweep.
// Writes nothing. Run before any transaction.
import { prisma } from "../db/prisma.js";
import { scheduledJobRegistry, resultsScanShouldEnqueue } from "../lib/scheduler.js";
import { expectedFirings } from "../lib/cron-expr.js";

const PG_NAME = "Large-Cap AMCs & Exchanges";
const now = new Date();
const iso = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + "Z";

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║ S4G PREFLIGHT — read only                                                 ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════╝");
  console.log(`  now (UTC): ${iso(now)}  dow=${now.getUTCDay()}`);

  // ── CRON WINDOW ────────────────────────────────────────────────────────────
  // Which jobs fire in the next 8h, and which of them can touch the roster.
  const horizon = new Date(now.getTime() + 8 * 3600_000);
  const ROSTER_TOUCHING = new Set([
    "monthly-peer-metrics", // reads stockPeerGroup (peer-metrics.service.ts:126)
    "results-scan",         // ingest -> rescore -> computePgScores reads roster
    "daily-filing-rolling-window", // filing ingest -> can enqueue rescore
  ]);

  console.log("\n── CRON FIRINGS, now → +8h (UTC) ──");
  const rows: { at: Date; name: string; roster: boolean }[] = [];
  for (const j of scheduledJobRegistry()) {
    const gate = j.name === "results-scan" ? resultsScanShouldEnqueue : j.gate;
    const fires = expectedFirings(j.schedule, now, horizon, gate);
    for (const at of fires) rows.push({ at, name: j.name, roster: ROSTER_TOUCHING.has(j.name) });
  }
  rows.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Collapse the every-2-min reaper so the table stays readable.
  const reaper = rows.filter((r) => r.name === "job-reaper");
  const rest = rows.filter((r) => r.name !== "job-reaper");
  console.log(`  job-reaper           ×${reaper.length} (every 2 min, inline, background_jobs only — never reads the roster)`);
  for (const r of rest) {
    console.log(`  ${iso(r.at)}  ${r.name.padEnd(32)} ${r.roster ? "⚠ ROSTER-TOUCHING" : ""}`);
  }

  const nextRoster = rest.find((r) => r.roster);
  console.log(`\n  → next roster-touching firing: ${nextRoster ? `${iso(nextRoster.at)} ${nextRoster.name}` : "NONE in +8h"}`);
  const nextAny = rest[0];
  console.log(`  → next non-reaper firing of ANY kind: ${nextAny ? `${iso(nextAny.at)} ${nextAny.name}` : "NONE in +8h"}`);

  // ── LIVE QUEUE — is anything already running that could read the roster? ────
  const jobs = await prisma.backgroundJob.groupBy({
    by: ["status", "type"],
    _count: { _all: true },
    where: { status: { in: ["pending", "running"] } },
  });
  console.log("\n── background_jobs pending/running ──");
  if (!jobs.length) console.log("  (none)");
  for (const j of jobs) console.log(`  ${j.status.padEnd(9)} ${String(j.type).padEnd(28)} ${j._count._all}`);

  // Most recent job activity of ANY kind — is a scheduler actually live against this DB?
  const recent = await prisma.backgroundJob.findMany({
    orderBy: { createdAt: "desc" }, take: 5,
    select: { type: true, status: true, createdAt: true, finishedAt: true },
  });
  console.log("\n── 5 most recent background_jobs (is a scheduler live on this DB?) ──");
  for (const r of recent) console.log(`  ${iso(r.createdAt)}  ${r.type.padEnd(26)} ${r.status}`);

  // ── P1 FACTS ───────────────────────────────────────────────────────────────
  console.log("\n── P1 · MCX peer-group seat ──");
  const pg = await prisma.peerGroup.findFirst({
    where: { name: PG_NAME },
    include: { stocks: { include: { stock: { select: { id: true, symbol: true, isActive: true } } } } },
  });
  if (!pg) throw new Error("PG not found");
  console.log(`  pg.id           ${pg.id}`);
  console.log(`  pg.stockCount   ${pg.stockCount}`);
  console.log(`  roster rows     ${pg.stocks.length}`);
  console.log(`  active members  ${pg.stocks.filter((s) => s.stock.isActive).length}`);
  for (const s of pg.stocks) {
    console.log(`    ${s.stock.symbol.padEnd(12)} active=${String(s.stock.isActive).padEnd(5)} spg.id=${s.id}`);
  }
  const mcx = pg.stocks.find((s) => s.stock.symbol === "MCX");
  console.log(`  → MCX roster row: ${mcx ? mcx.id : "ABSENT"}`);

  // ── P1c SWEEP — any OTHER inactive stock holding a roster row? ─────────────
  console.log("\n── P1c · sweep: inactive stocks holding a roster row (ALL groups) ──");
  const inactiveWithSeat = await prisma.stockPeerGroup.findMany({
    where: { stock: { isActive: false } },
    include: { stock: { select: { symbol: true, isActive: true, industryType: true } }, peerGroup: { select: { name: true, stockCount: true } } },
  });
  if (!inactiveWithSeat.length) console.log("  (none)");
  for (const r of inactiveWithSeat) {
    console.log(`  ${r.stock.symbol.padEnd(12)} ${r.peerGroup.name.padEnd(38)} stored=${r.peerGroup.stockCount}`);
  }
  console.log(`  count = ${inactiveWithSeat.length}`);

  // ── stock_count drift across EVERY group (stored vs roster vs active) ──────
  console.log("\n── stored vs roster vs active, all groups (drift only) ──");
  const all = await prisma.peerGroup.findMany({
    include: { stocks: { include: { stock: { select: { isActive: true } } } } },
    orderBy: { name: "asc" },
  });
  let drift = 0;
  for (const g of all) {
    const roster = g.stocks.length;
    const active = g.stocks.filter((s) => s.stock.isActive).length;
    if (g.stockCount !== roster || roster !== active) {
      console.log(`  ${g.name.padEnd(42)} stored=${g.stockCount} roster=${roster} active=${active}`);
      drift++;
    }
  }
  console.log(`  groups with any drift: ${drift} / ${all.length}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
