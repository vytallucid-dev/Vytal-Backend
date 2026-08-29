// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 14 — RESCORE ONLY WHAT THE RAW DATA TOUCHED.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage14-rescore-touched.ts --since 2026-08-26T12:00:00Z
//   npx tsx src/scripts/stage14-rescore-touched.ts --since 2026-08-26 --commit
//   npx tsx src/scripts/stage14-rescore-touched.ts --stock NESTLEIND --commit
//   npx tsx src/scripts/stage14-rescore-touched.ts --pg PG2 --commit
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// The workbook load on 2026-08-26 wrote 2,840 cells and there was no way to push them through to a
// score short of rescoring the universe. MEASURED at the time: the day's last scoring activity was
// 10:48 and the load finished at 12:00, so nothing had been recomputed — 47 stocks affected, 3 of
// them scored, and no targeted path to reach them.
//
// ⚠ A PEER'S DATA CHANGE IS A PEER-GROUP EVENT, NOT A STOCK EVENT. The L2 lens scores every member
//   against the cross-section of its peers, so one company's corrected revenue moves μ/σ and
//   therefore moves EVERY other member's metric leaves. Selecting only the touched stocks would
//   quietly leave their peers scored against a distribution that no longer exists. So the touched
//   set is expanded to whole peer groups — that is the correct unit, not an abundance of caution.
//
// Nothing here is a new scoring path: it resolves a set of peer groups and hands them to the same
// computePgScores + persistMember the nightly pass uses, so the skip-identical guard, the leaf
// check and the evaluation stamp all behave identically.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  computePgScores, ensureScaffold, finalizeRun, persistMember, requireFindingsEvaluated,
  type MemberWriteResult,
} from "../scoring/composite/score-pass.js";
import { SCORED_PGS } from "./stage10-rescore-all.js";

const argv = process.argv;
const COMMIT = argv.includes("--commit");
const arg = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const SINCE = arg("--since");
const ONLY_STOCK = arg("--stock")?.toUpperCase() ?? null;
const ONLY_PG = arg("--pg")?.toUpperCase() ?? null;

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** Every table whose rows are a scoring input. daily_prices is deliberately EXCLUDED: it moves for
 *  every stock every day, so including it would make "touched" mean "everything" and turn this back
 *  into a full rescore. Price-driven Market movement is what the nightly pass is for. */
const RAW_TABLES = [
  ["quarterly_results", "updated_at"], ["fundamentals", "updated_at"],
  ["banking_quarterly_results", "updated_at"], ["banking_fundamentals", "updated_at"],
  ["nbfc_quarterly_results", "updated_at"], ["nbfc_fundamentals", "updated_at"],
  ["life_insurance_quarterly_results", "updated_at"], ["life_insurance_fundamentals", "updated_at"],
  ["general_insurance_quarterly_results", "updated_at"], ["general_insurance_fundamentals", "updated_at"],
  ["shareholding_patterns", "created_at"],
] as const;

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 14 — targeted rescore  ${COMMIT ? "*** COMMIT ***" : "(dry — computes and reports, writes nothing)"}`);
  console.log("=".repeat(104));

  // ── resolve the touched stock set ───────────────────────────────────────────────────────────
  const touched = new Map<string, string>();   // stockId -> symbol
  if (ONLY_STOCK) {
    for (const s of await raw<{ id: string; symbol: string }>(`SELECT id, symbol FROM stocks WHERE symbol=$1`, ONLY_STOCK)) touched.set(s.id, s.symbol);
    console.log(`\n  selector: --stock ${ONLY_STOCK}`);
  } else if (ONLY_PG) {
    console.log(`\n  selector: --pg ${ONLY_PG}`);
  } else {
    if (!SINCE) { console.log(`\n  need --since <ISO>, --stock <SYM> or --pg <PGn>\n`); await prisma.$disconnect(); return; }
    console.log(`\n  selector: raw rows touched since ${SINCE}`);
    for (const [t, tsCol] of RAW_TABLES) {
      const rows = await raw<{ id: string; symbol: string; n: number }>(
        `SELECT s.id, s.symbol, count(*)::int n FROM "${t}" x JOIN stocks s ON s.id = x.stock_id
          WHERE x."${tsCol}" >= $1::timestamp GROUP BY 1,2`, SINCE);
      for (const r of rows) touched.set(r.id, r.symbol);
      if (rows.length) console.log(`     ${t.padEnd(38)} ${String(rows.reduce((a, b) => a + b.n, 0)).padStart(5)} row(s) across ${rows.length} stock(s)`);
    }
  }

  // ── expand to whole peer groups (the L2 cross-section is the unit) ──────────────────────────
  let pgNames: string[];
  if (ONLY_PG) {
    pgNames = SCORED_PGS.filter((p) => p.pgId.toUpperCase() === ONLY_PG).map((p) => p.pgName);
  } else {
    const ids = [...touched.keys()];
    pgNames = ids.length
      ? (await raw<{ name: string }>(
          `SELECT DISTINCT pg.name FROM stock_peer_groups sp JOIN peer_groups pg ON pg.id = sp.peer_group_id
            WHERE sp.stock_id = ANY($1::text[])`, ids)).map((r) => r.name)
      : [];
  }
  const refs = SCORED_PGS.filter((p) => pgNames.includes(p.pgName));
  const unscoredTouched = pgNames.filter((n) => !SCORED_PGS.some((p) => p.pgName === n));

  console.log(`\n  touched stocks ${touched.size} · peer groups containing them ${pgNames.length} · of those SCORED ${refs.length}`);
  if (unscoredTouched.length)
    console.log(`  not scored, so nothing to rescore: ${unscoredTouched.join(", ")}`);
  if (!refs.length) { console.log(`\n  nothing to do.\n`); await prisma.$disconnect(); return; }

  let scaffold: Awaited<ReturnType<typeof ensureScaffold>> | null = null;
  if (COMMIT) {
    scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as never, new Date(), { runType: "quarterly", triggerType: "manual_api" }));
    console.log(`  ScoringRun ${scaffold.runId.slice(0, 8)}…`);
  }

  // ── run them ────────────────────────────────────────────────────────────────────────────────
  let changed = 0, unchanged = 0, noSnap = 0;
  console.log(`\n  ${"peer group".padEnd(44)} ${"changed".padStart(8)} ${"unchanged".padStart(10)} ${"no-snap".padStart(8)}   members touched`);
  for (const ref of refs) {
    const pg = await computePgScores(ref, { withFindings: true });
    const inThisPg = pg.members.filter((m) => touched.has(m.stockId)).map((m) => m.symbol);
    if (!COMMIT) {
      console.log(`  ${ref.pgName.slice(0, 44).padEnd(44)} ${"(dry)".padStart(8)} ${"".padStart(10)} ${"".padStart(8)}   ${inThisPg.join(",") || "—"}`);
      continue;
    }
    const results = await prisma.$transaction(async (tx) => {
      const out: MemberWriteResult[] = [];
      for (const m of requireFindingsEvaluated(pg)) {
        if (m.composite.state !== "scored" || m.composite.composite == null || !m.own || !m.market) {
          out.push({ action: "unavailable_no_snapshot" } as MemberWriteResult); continue;
        }
        out.push(await persistMember(tx as never, m, scaffold!, pg.asOf, pg.peerGroupId, ref.pgId, pg.industry, pg.peerStats));
      }
      return out;
    }, { timeout: 180_000, maxWait: 30_000 });
    const c = results.filter((r) => r.action === "created").length;
    const u = results.filter((r) => r.action === "skipped_identical").length;
    const n = results.filter((r) => r.action === "unavailable_no_snapshot").length;
    changed += c; unchanged += u; noSnap += n;
    console.log(`  ${ref.pgName.slice(0, 44).padEnd(44)} ${String(c).padStart(8)} ${String(u).padStart(10)} ${String(n).padStart(8)}   ${inThisPg.join(",") || "—"}`);
  }

  if (COMMIT) {
    await prisma.$transaction(async (tx) => finalizeRun(tx as never, scaffold!.runId, changed, new Date()));
    console.log(`\n  ── OUTCOME, per (stock, period) ──`);
    console.log(`  recomputed-CHANGED    ${changed}   (a new version was written, superseding the old)`);
    console.log(`  recomputed-UNCHANGED  ${unchanged}   (all five fingerprints agreed; last_evaluated_at stamped)`);
    console.log(`  no snapshot           ${noSnap}   (composite unavailable — never a fabricated row)`);
    console.log(`\n  Every member above was RECOMPUTED. The skip is at persist time, not compute time,`);
    console.log(`  so "unchanged" is a measured result and not an assumption — and it is now recorded`);
    console.log(`  on the row, so a later reader can tell it from "never evaluated".`);
  } else {
    console.log(`\n  dry run — re-run with --commit.\n`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
