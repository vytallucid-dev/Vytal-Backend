// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 18 — SET industryType FROM WHAT THE FILINGS THEMSELVES SAID.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage18-industry-correction.ts            # dry
//   npx tsx src/scripts/stage18-industry-correction.ts --commit
//
// ── WHY THIS IS A HARVEST AND NOT A GUESS ────────────────────────────────────────────────────────
// All 1,787 seeded stocks start `non_financial`, because guessing a bank from its name is a coin
// flip that would route its results into the Ind-AS tables. It never needed guessing: scan.ts
// detects the taxonomy FROM THE FILING, refuses to ingest on a mismatch, and writes the right answer
// into result_fetch_logs.error as
//     Industry mismatch (standalone): stock=non_financial, xbrl=banking
// MEASURED after the stage-17 campaign: 305 such rows across 106 stocks — 92 nbfc, 14 banking.
// Not one of them had a bank's numbers written into the wrong table; the gate refused instead.
//
// ── THE ONE THING THIS REFUSES TO DO ─────────────────────────────────────────────────────────────
// If a stock's logs disagree with themselves — one filing saying `nbfc`, another `banking` — this
// does NOT pick a winner. A company files under one taxonomy; disagreement means either a parser
// misread or a genuinely odd filer, and both deserve a human. Reported and skipped.
//
// ── AND IT PURGES THE LEDGER, WHICH IS THE POINT ─────────────────────────────────────────────────
// Correcting industryType changes nothing on its own: the filings were SKIPPED, so those stocks
// still hold no results. They must be re-scanned — and stage 17 will not revisit a symbol its
// ledger calls done. So the corrected symbols are removed from every _s17-ledger*.json, which puts
// them straight back into the work queue for the next stage-17 run. Without this step the
// correction is inert and the 106 stocks stay empty forever.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const VALID = new Set(["banking", "nbfc", "life_insurance", "general_insurance", "non_financial"]);

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 18 — industryType from the filings  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const rows = await raw<{ symbol: string; detected: string; n: number }>(`
    SELECT symbol,
           split_part(split_part(error, 'xbrl=', 2), ' ', 1) AS detected,
           count(*)::int AS n
      FROM result_fetch_logs
     WHERE error LIKE 'Industry mismatch%' AND fetched_at::date >= '2026-08-26'
     GROUP BY 1, 2`);

  const bySym = new Map<string, Array<{ detected: string; n: number }>>();
  for (const r of rows) {
    if (!bySym.has(r.symbol)) bySym.set(r.symbol, []);
    bySym.get(r.symbol)!.push({ detected: r.detected, n: r.n });
  }

  const plan: Array<{ symbol: string; to: string; n: number }> = [];
  const conflicted: string[] = [];
  const invalid: string[] = [];
  for (const [symbol, hits] of bySym) {
    const kinds = [...new Set(hits.map((h) => h.detected))];
    if (kinds.length > 1) { conflicted.push(`${symbol}: ${kinds.join(" vs ")}`); continue; }
    if (!VALID.has(kinds[0])) { invalid.push(`${symbol}: "${kinds[0]}"`); continue; }
    plan.push({ symbol, to: kinds[0], n: hits.reduce((a, h) => a + h.n, 0) });
  }
  plan.sort((a, b) => a.to.localeCompare(b.to) || a.symbol.localeCompare(b.symbol));

  const byKind: Record<string, number> = {};
  for (const p of plan) byKind[p.to] = (byKind[p.to] ?? 0) + 1;
  console.log(`\n  mismatch logs        ${rows.reduce((a, r) => a + r.n, 0)}`);
  console.log(`  stocks to correct    ${plan.length}   ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (conflicted.length) { console.log(`\n  ⚠ ${conflicted.length} stock(s) whose logs disagree — SKIPPED, not guessed:`); for (const c of conflicted) console.log(`     ${c}`); }
  if (invalid.length) { console.log(`\n  ⚠ ${invalid.length} unparseable detection(s) — skipped:`); for (const c of invalid.slice(0, 10)) console.log(`     ${c}`); }

  if (!COMMIT) {
    console.log(`\n  sample: ${plan.slice(0, 12).map((p) => `${p.symbol}->${p.to}`).join(", ")}`);
    console.log(`\n  dry — re-run with --commit.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── 1. correct the classification ────────────────────────────────────────────────────────────
  let changed = 0;
  for (const p of plan) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE stocks SET "industryType" = $2::"IndustryType", updated_at = now()
        WHERE symbol = $1 AND "industryType"::text <> $2`, p.symbol, p.to);
    changed += n;
  }
  console.log(`\n  industryType updated on ${changed} stock(s)`);

  // ── 2. put them back in the queue (see the header — without this the fix is inert) ───────────
  const syms = new Set(plan.map((p) => p.symbol));
  let purged = 0;
  for (const f of fs.readdirSync(".").filter((x) => /^_s17-ledger.*\.json$/.test(x))) {
    const led = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, unknown>;
    let hit = 0;
    for (const s of Object.keys(led)) if (syms.has(s)) { delete led[s]; hit++; }
    if (hit) { fs.writeFileSync(f, JSON.stringify(led, null, 1)); purged += hit; console.log(`     ${f}: removed ${hit}`);}
  }
  console.log(`  ledger entries purged: ${purged} — these symbols are now un-done and will be re-scanned`);
  console.log(`\n  next: relaunch the stage-17 workers; they will pick up exactly these ${plan.length} stocks.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
