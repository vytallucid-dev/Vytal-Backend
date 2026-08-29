// ═══════════════════════════════════════════════════════════════
// STAGE 1 BACKFILL — fills fii_pct / dii_pct on the shareholding_patterns rows
// the 2020-09-30 XBRL vintage left NULL. Surgical, NOT a re-ingest: it refetches
// only each row's already-stored xbrl_url and re-parses it with the third-vintage
// parser. Nothing else about the row is touched, and no NSE index call is made.
//
// TWO PHASES, ONE FETCH PASS
//   PASS 1 (default)  fetch + parse + guard every target row, append a JSONL
//                     ledger of proposed changes. Writes NOTHING to the DB.
//                       npx tsx src/scripts/stage1-fii-dii-backfill.ts
//   PASS 2 (--apply)  read the ledger, apply the accepted rows, re-read and verify.
//                       npx tsx src/scripts/stage1-fii-dii-backfill.ts --apply
//
// Pass 1 is RESUMABLE: it skips rows already in the ledger, so a crash or a
// killed run continues where it stopped. Re-running after a full pass is a no-op.
//
// ⚠️ SCORE-RELEVANT. fiiPct / diiPct / retailPct are scoring inputs
//    (scoring/inputs/score-input-columns.ts). This script deliberately does NOT
//    trigger a rescore — it lands the data only, and prints the blast radius so
//    the rescore can be a separate, deliberate decision.
//
// ⚠️ othersPct / retailPct are OVERWRITTEN, not filled. Every target row already
//    carries a value for them, taken from the NonInstitutions XBRL context — the
//    fallback deriveOthersPct() uses precisely WHEN fii/dii are missing. With
//    fii/dii now resolved, the correct value is the residual public - fii - dii,
//    and leaving the old one would make the row internally inconsistent. The
//    ledger records both so the size of that correction is reviewable.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { parseXbrlShareholding } from "../ingestions/shareholdings/xbrl-parser.js";
import {
  PARTITION_MIN,
  checkPctRange,
} from "../ingestions/shareholdings/shareholding-guards.js";

const APPLY = process.argv.includes("--apply");
const LEDGER = "_s1-backfill-ledger.jsonl";
const PROGRESS = "_s1-backfill-progress.log";
const LOCK = "_s1-backfill.lock";
const FETCH_SLEEP_MS = 800; // matches ingest-shareholding NSE pacing
const REPORT_EVERY_MS = 5 * 60 * 1000;
const TOL_PP = 0.05; // source rounding budget (see the gate script)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface LedgerEntry {
  id: string;
  symbol: string;
  asOn: string;
  taxonomy: string;
  /** "accept" = will be written; anything else = skipped, with reason. */
  verdict: "accept" | "unresolved" | "guard_failed" | "fetch_failed";
  reason?: string;
  derived?: boolean;
  before: { fii: number | null; dii: number | null; others: number | null; retail: number | null; banks: number | null };
  after?: { fii: number | null; dii: number | null; others: number | null; retail: number | null; banks: number | null };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const taxonomyOf = (xml: string): string =>
  xml.match(/xmlns:in-[a-zA-Z0-9_-]+="[^"]*\/shp\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? "unknown";

// ── PASS 1 ─────────────────────────────────────────────────────

/**
 * Single-writer lock. Both passes append to shared files, and a background run
 * survives the shell that started it — so a "killed" earlier run can still be
 * alive and interleaving its rows with a new one. That happened once here and
 * produced a ledger with two parsers' verdicts mixed together. A stale lock left
 * by a crash is reported, not silently stolen.
 */
function acquireLock(phase: string): void {
  if (existsSync(LOCK)) {
    const held = readFileSync(LOCK, "utf8").trim();
    console.error(
      `\nREFUSING TO START — ${LOCK} exists (held by: ${held}).\n` +
        `Another pass is running, or a previous one crashed. Confirm no node process\n` +
        `is still running this script, then delete ${LOCK} and re-run.\n`,
    );
    process.exit(1);
  }
  writeFileSync(LOCK, `pid=${process.pid} phase=${phase} started=${new Date().toISOString()}\n`);
  const release = (): void => {
    try {
      if (existsSync(LOCK)) unlinkSync(LOCK);
    } catch {
      /* best effort */
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(143);
  });
}

async function pass1(): Promise<void> {
  const targets = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT id, symbol, as_on_date::text AS as_on, xbrl_url,
            fii_pct, dii_pct, others_pct, retail_pct, banks_fis_pct
     FROM shareholding_patterns
     WHERE fii_pct IS NULL AND xbrl_url IS NOT NULL
     ORDER BY as_on_date, symbol`,
  );

  const done = new Set<string>();
  if (existsSync(LEDGER)) {
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        done.add((JSON.parse(line) as LedgerEntry).id);
      } catch {
        /* a torn final line from a killed run — ignore it, the row just refetches */
      }
    }
  }
  const todo = targets.filter((t) => !done.has(String(t.id)));

  const banner =
    `\n=== STAGE 1 BACKFILL · PASS 1 (READ-ONLY) ===\n` +
    `  target rows: ${targets.length}   already in ledger: ${done.size}   to fetch: ${todo.length}\n` +
    `  pacing ${FETCH_SLEEP_MS}ms  ->  est ${Math.ceil((todo.length * FETCH_SLEEP_MS) / 60000)} min\n`;
  console.log(banner);
  appendFileSync(PROGRESS, `${new Date().toISOString()} ${banner.replace(/\n/g, " | ")}\n`);

  const tally = { accept: 0, unresolved: 0, guard_failed: 0, fetch_failed: 0 };
  const started = Date.now();
  let lastReport = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    const before = {
      fii: num(t.fii_pct), dii: num(t.dii_pct), others: num(t.others_pct),
      retail: num(t.retail_pct), banks: num(t.banks_fis_pct),
    };
    const base = { id: String(t.id), symbol: String(t.symbol), asOn: String(t.as_on), before };
    let entry: LedgerEntry;

    try {
      const xml = await fetchXbrlXml(String(t.xbrl_url));
      const p = parseXbrlShareholding(xml);
      const tax = taxonomyOf(xml);

      if (p.fiiPct === null || p.diiPct === null) {
        entry = { ...base, taxonomy: tax, verdict: "unresolved", reason: "fii/dii still null after parse" };
      } else {
        // Guards — a row failing ANY of these is skipped, never written.
        const reasons: string[] = [];
        // NOTE checkPctRange is a VIOLATION predicate — it returns true when the
        // value is OUTSIDE [0,100]. Same polarity as its caller in
        // ingest-shareholding.ts (`.filter(([, v]) => checkPctRange(v))`).
        if (checkPctRange(p.fiiPct)) reasons.push(`fii ${p.fiiPct} out of 0-100`);
        if (checkPctRange(p.diiPct)) reasons.push(`dii ${p.diiPct} out of 0-100`);
        if (p.promoterPct + p.publicPct < PARTITION_MIN)
          reasons.push(`partition ${p.promoterPct}+${p.publicPct} < ${PARTITION_MIN}`);
        if (p.fiiPct + p.diiPct > p.publicPct + TOL_PP)
          reasons.push(`fii+dii ${p.fiiPct + p.diiPct} exceeds public ${p.publicPct}`);
        // SAME-FILING CHECK — the URL must still resolve to the filing that made
        // this row. Compare SHARE COUNTS, not percentages.
        //
        // Percentages would be the wrong instrument: ingest-shareholding.ts:257
        // deliberately stores promoter_pct/public_pct from the NSE master API
        // ("more reliable than XBRL for top-level percentages"), which reports on
        // the SCRR (A+B+C2) basis, while the XBRL reports on total shares. For a
        // company where those bases diverge the two legitimately disagree — BBTC
        // 2020-09-30 stores 74.05/25.95 against an XBRL 65.93/34.07, and the XBRL
        // is exactly consistent with the share counts (46,002,345 / 69,771,900 =
        // 65.9325%). Neither is wrong; they are different denominators.
        //
        // total_shares / promoter_shares, by contrast, ARE stored straight from
        // this parser (recordData in ingest-shareholding.ts), so a re-parse of the
        // same file must reproduce them EXACTLY. A mismatch means a different
        // filing, which is the thing this check exists to catch.
        const storedCounts = await prisma.shareholdingPattern.findUnique({
          where: { id: String(t.id) },
          select: { totalShares: true, promoterShares: true },
        });
        const storedTotal = storedCounts?.totalShares == null ? null : Number(storedCounts.totalShares);
        const storedPromoter = storedCounts?.promoterShares == null ? null : Number(storedCounts.promoterShares);
        // 0 is the ingest sentinel for "absent", not a real count — skip the
        // comparison rather than reading it as a genuine disagreement.
        if (storedTotal && p.totalShares !== null && storedTotal !== p.totalShares)
          reasons.push(`totalShares mismatch stored=${storedTotal} reparsed=${p.totalShares} (different filing?)`);
        if (storedPromoter && p.promoterShares !== null && storedPromoter !== p.promoterShares)
          reasons.push(`promoterShares mismatch stored=${storedPromoter} reparsed=${p.promoterShares} (different filing?)`);

        entry = reasons.length
          ? { ...base, taxonomy: tax, verdict: "guard_failed", reason: reasons.join("; "), derived: p.legacyInstitutionsDerived }
          : {
              ...base, taxonomy: tax, verdict: "accept", derived: p.legacyInstitutionsDerived,
              after: { fii: p.fiiPct, dii: p.diiPct, others: p.othersPct, retail: p.retailPct, banks: p.banksFisPct },
            };
      }
    } catch (e) {
      entry = { ...base, taxonomy: "n/a", verdict: "fetch_failed", reason: (e as Error).message };
    }

    tally[entry.verdict]++;
    appendFileSync(LEDGER, `${JSON.stringify(entry)}\n`);

    if (Date.now() - lastReport >= REPORT_EVERY_MS || i === todo.length - 1) {
      lastReport = Date.now();
      const doneN = i + 1;
      const rate = doneN / ((Date.now() - started) / 1000);
      const eta = Math.ceil((todo.length - doneN) / rate / 60);
      const line =
        `${new Date().toISOString()} PASS1 ${doneN}/${todo.length} (${((doneN / todo.length) * 100).toFixed(1)}%) ` +
        `accept=${tally.accept} unresolved=${tally.unresolved} guard=${tally.guard_failed} fetchfail=${tally.fetch_failed} ` +
        `eta=${eta}min`;
      console.log(line);
      appendFileSync(PROGRESS, `${line}\n`);
    }
    await sleep(FETCH_SLEEP_MS);
  }

  summarise();
}

// ── LEDGER SUMMARY ─────────────────────────────────────────────

function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LedgerEntry);
    } catch {
      /* torn line */
    }
  }
  return out;
}

function summarise(): LedgerEntry[] {
  const all = readLedger();
  const accepted = all.filter((e) => e.verdict === "accept");
  const by = (v: string) => all.filter((e) => e.verdict === v);

  console.log(`\n-- LEDGER SUMMARY (${LEDGER}) --`);
  console.log(`  total entries      ${all.length}`);
  console.log(`  accept             ${accepted.length}`);
  console.log(`  unresolved         ${by("unresolved").length}`);
  console.log(`  guard_failed       ${by("guard_failed").length}`);
  console.log(`  fetch_failed       ${by("fetch_failed").length}`);
  console.log(`  derived (2020 vintage) ${accepted.filter((e) => e.derived).length} of ${accepted.length}`);

  const taxa = new Map<string, number>();
  for (const e of all) taxa.set(e.taxonomy, (taxa.get(e.taxonomy) ?? 0) + 1);
  console.log(`  taxonomies seen    ${[...taxa].map(([k, v]) => `${k}:${v}`).join("  ")}`);

  // The overwrite blast radius on others/retail (score-relevant retailPct).
  const deltas = accepted
    .filter((e) => e.before.others !== null && e.after?.others != null)
    .map((e) => Math.abs((e.after!.others as number) - (e.before.others as number)))
    .sort((a, b) => b - a);
  if (deltas.length) {
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    console.log(
      `\n  othersPct/retailPct OVERWRITE (nonInstitutions context -> public-fii-dii residual):\n` +
        `    rows=${deltas.length}  max=${deltas[0].toFixed(4)}pp  mean=${mean.toFixed(4)}pp  ` +
        `p50=${deltas[Math.floor(deltas.length / 2)].toFixed(4)}pp  >1pp=${deltas.filter((d) => d > 1).length}`,
    );
  }

  for (const v of ["unresolved", "guard_failed", "fetch_failed"] as const) {
    const rows = by(v);
    if (!rows.length) continue;
    console.log(`\n  -- ${v} (${rows.length}) --`);
    for (const e of rows.slice(0, 15)) console.log(`     ${e.symbol.padEnd(12)} ${e.asOn}  tax=${e.taxonomy}  ${e.reason ?? ""}`);
    if (rows.length > 15) console.log(`     ... and ${rows.length - 15} more (see ${LEDGER})`);
  }
  return accepted;
}

// ── PASS 2 ─────────────────────────────────────────────────────

async function pass2(): Promise<void> {
  console.log(`\n=== STAGE 1 BACKFILL · PASS 2 (--apply · LIVE WRITE) ===`);
  const accepted = summarise();
  if (!accepted.length) {
    console.log("\nNothing accepted in the ledger — run pass 1 first.\n");
    return;
  }

  const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
  let written = 0, skippedNotNull = 0, failed = 0;
  const started = Date.now();
  let lastReport = Date.now();

  for (let i = 0; i < accepted.length; i++) {
    const e = accepted[i];
    try {
      // updateMany with a fii_pct IS NULL predicate: a belt-and-braces guarantee
      // that a row which acquired a value since pass 1 is never overwritten.
      const r = await prisma.shareholdingPattern.updateMany({
        where: { id: e.id, fiiPct: null },
        data: {
          fiiPct: dec(e.after!.fii),
          diiPct: dec(e.after!.dii),
          othersPct: dec(e.after!.others),
          retailPct: dec(e.after!.retail),
          banksFisPct: dec(e.after!.banks),
        },
      });
      if (r.count === 1) written++;
      else skippedNotNull++;
    } catch (err) {
      failed++;
      console.log(`  WRITE FAILED ${e.symbol} ${e.asOn}: ${(err as Error).message}`);
    }
    if (Date.now() - lastReport >= REPORT_EVERY_MS || i === accepted.length - 1) {
      lastReport = Date.now();
      const line =
        `${new Date().toISOString()} PASS2 ${i + 1}/${accepted.length} written=${written} ` +
        `skipped(now-non-null)=${skippedNotNull} failed=${failed} ` +
        `elapsed=${Math.round((Date.now() - started) / 1000)}s`;
      console.log(line);
      appendFileSync(PROGRESS, `${line}\n`);
    }
  }

  // ── VERIFY: re-read the live table ──
  const [after] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) rows_total,
            count(*) FILTER (WHERE fii_pct IS NULL) fii_null,
            count(*) FILTER (WHERE dii_pct IS NULL) dii_null,
            count(*) FILTER (WHERE banks_fis_pct IS NULL) banks_null,
            count(DISTINCT stock_id) FILTER (WHERE fii_pct IS NULL) stocks_fii_null
     FROM shareholding_patterns`,
  );
  console.log(`\n-- POST-WRITE LIVE STATE --`);
  console.log(`  ${JSON.stringify(after, (_, v) => (typeof v === "bigint" ? Number(v) : v))}`);

  // Invariant sweep over everything just written: fii+dii must never exceed public.
  const [bad] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) n FROM shareholding_patterns
     WHERE fii_pct IS NOT NULL AND dii_pct IS NOT NULL
       AND (fii_pct + dii_pct) > public_pct + ${TOL_PP}`,
  );
  console.log(`  rows violating fii+dii <= public : ${Number(bad.n)} (must be 0)`);

  console.log(
    `\n=== PASS 2 DONE — written=${written} skipped=${skippedNotNull} failed=${failed} ===\n`,
  );
}

async function main(): Promise<void> {
  acquireLock(APPLY ? "pass2-apply" : "pass1-readonly");
  if (APPLY) await pass2();
  else await pass1();
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error("ERR", e);
  await prisma.$disconnect();
  process.exit(1);
});
