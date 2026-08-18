// ═══════════════════════════════════════════════════════════════
// R1l — THE RUN WINDOW: what fires while a ~5h run would be in flight.
// READ-ONLY.
//   npx tsx src/scripts/_r1l-window.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);

async function main() {
  const [c] = await raw<any>(
    `SELECT now()::text n, trim(to_char(now() AT TIME ZONE 'UTC','Day')) dow,
            extract(dow from now() AT TIME ZONE 'UTC')::int d,
            date_part('hour', now() AT TIME ZONE 'UTC')::int h,
            date_part('minute', now() AT TIME ZONE 'UTC')::int m`);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1l — THE RUN WINDOW                                                      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  DB now: ${c.n}  ·  ${c.dow} (dow=${c.d})  ·  ${c.h}:${String(c.m).padStart(2, "0")} UTC`);
  const weekday = c.d >= 1 && c.d <= 5;
  console.log(`  weekday (Mon-Fri crons active): ${weekday ? "YES" : "NO — the 1-5 crons do not fire today"}`);

  // Which cron slots a ~5h run starting now would cross
  const start = Number(c.h) * 60 + Number(c.m);
  const end = start + 330; // 5.5h
  console.log(`\n  a run starting now and taking ~5.5h occupies ${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")} → ${Math.floor((end % 1440) / 60)}:${String(end % 60).padStart(2, "0")} UTC`);

  const SLOTS: Array<[string, number, number, boolean, string]> = [
    // name, hh, mm, weekdayOnly, note
    ["results-scan (0 */4)", 12, 0, false, "⚠ RESCORE TRIGGER SOURCE — gated, see below"],
    ["results-scan (0 */4)", 16, 0, false, "⚠ RESCORE TRIGGER SOURCE — gated, see below"],
    ["results-scan (0 */4)", 20, 0, false, "⚠ RESCORE TRIGGER SOURCE — gated, see below"],
    ["broker-poll-sync", 11, 30, true, "last of the */30 3-11 series"],
    ["daily-shareholding / EOD block", 13, 0, true, "the stated 13:00-14:10 blackout"],
    ["EOD prices chain", 13, 30, true, "13:30 · 13:35 · 13:45 · 13:50 · 13:55"],
    ["EOD tail", 14, 5, true, "end of the blackout"],
    ["daily-alerts-eval", 15, 0, true, "≈1.5h after EOD → post-rescore"],
    ["scoring-failed-job-sweep", 18, 0, false, "start of the nightly chain"],
    ["nightly chain", 18, 10, false, "18:10 · 18:20 · 18:40 · 19:00 · 19:10 · 19:30 · 19:45 · 20:00"],
    ["nightly-retention-prune", 21, 30, false, "the prune named in R2e"],
    ["job-health-check", 22, 0, false, ""],
  ];
  console.log(`\n  ${pad("slot (UTC)", 10)}${pad("job", 34)}${pad("fires today?", 14)}note`);
  for (const [name, hh, mm, wdOnly, note] of SLOTS) {
    const t = hh * 60 + mm;
    const inRun = t >= start && t <= end;
    const fires = !wdOnly || weekday;
    const mark = inRun && fires ? "⚠ INSIDE RUN" : inRun ? "  (in run, but not today)" : "";
    console.log(`  ${pad(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, 10)}${pad(name, 34)}${pad(fires ? "yes" : "no (Mon-Fri)", 14)}${note} ${mark}`);
  }

  // Has results-scan actually been firing at 12/16/20 recently? Answer from history, not the cron string.
  console.log(`\n  ── results-scan: which UTC hours has it ACTUALLY fired at, last 14 days? ──`);
  const rs = await raw<any>(
    `SELECT date_part('hour', "created_at" AT TIME ZONE 'UTC')::int h, count(*)::int n,
            max("created_at")::text last
       FROM background_jobs WHERE "type"='results_scan' AND "created_at" > now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`);
  for (const r of rs) console.log(`     ${String(r.h).padStart(2, "0")}:00 UTC × ${r.n}   last ${String(r.last).slice(0, 19)}`);
  console.log(`     ⇒ results_scan is a RESCORE TRIGGER SOURCE (maybeEnqueueRescoresForJob case arm).`);

  // Did any pg_rescore actually get enqueued recently, and by what?
  console.log(`\n  ── pg_rescore history (what a "no scoring" claim must stay clear of) ──`);
  const pr = await raw<any>(
    `SELECT "status", count(*)::int n, min("created_at")::text first, max("created_at")::text last
       FROM background_jobs WHERE "type"='pg_rescore' GROUP BY 1 ORDER BY 2 DESC`);
  if (!pr.length) console.log(`     (no pg_rescore rows in background_jobs at all)`);
  for (const r of pr) console.log(`     ${pad(r.status, 12)} ×${r.n}   ${String(r.first).slice(0, 19)} → ${String(r.last).slice(0, 19)}`);
  const recent = await raw<any>(
    `SELECT count(*)::int n FROM background_jobs WHERE "type"='pg_rescore' AND "created_at" > now() - interval '24 hours'`);
  console.log(`     pg_rescore enqueued in the last 24h: ${recent[0].n}`);

  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
