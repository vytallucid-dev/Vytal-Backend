// ═══════════════════════════════════════════════════════════════
// STAGE 2 VERIFY — the before/after record for the BSE shareholding backfill.
//
//   BASELINE (run BEFORE --apply):  npx tsx src/scripts/stage2-verify.ts --baseline
//   COMPARE  (run AFTER):           npx tsx src/scripts/stage2-verify.ts
//
// Read-only in both modes. Answers the questions the plan actually asked:
//   · does every stock now reach FY2019 (or its listing date)?
//   · how many gained the 8 consecutive quarters the Ownership pillar wants?
//   · does NESTLEIND finally have a row before its 2023-01-31 snapshot?
//   · did anything NSE-sourced get overwritten? (must be zero — BSE only ADDS)
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const BASELINE = process.argv.includes("--baseline");
const SNAP = "_s2-verify-baseline.json";

const qIndex = (iso: string): number => {
  const [y, m] = iso.split("-").map(Number);
  return y * 4 + Math.floor((m - 1) / 3);
};
const qLabel = (i: number): string =>
  `${Math.floor(i / 4)}-${["Mar", "Jun", "Sep", "Dec"][i % 4]}`;
const MAR2019 = qIndex("2019-03-31");
const MAR2023 = qIndex("2023-03-31");

interface Snapshot {
  takenAt: string;
  totals: Record<string, number>;
  /** symbol -> sorted quarter indices (quarter-end rows only) */
  perStock: Record<string, number[]>;
  /** symbol -> id of every NSE-sourced row, to prove none were overwritten */
  nseRowFingerprint: Record<string, string>;
}

const n = (v: unknown): number => Number(v ?? 0);

async function snapshot(): Promise<Snapshot> {
  const [t] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) rows_total,
            count(*) FILTER (WHERE xbrl_url LIKE '%bseindia%') bse_rows,
            count(*) FILTER (WHERE xbrl_url NOT LIKE '%bseindia%' OR xbrl_url IS NULL) nse_rows,
            count(*) FILTER (WHERE fii_pct IS NULL) fii_null,
            count(DISTINCT stock_id) stocks,
            min(as_on_date)::text mn, max(as_on_date)::text mx
     FROM shareholding_patterns`,
  );
  const totals: Record<string, number> = {};
  for (const [k, v] of Object.entries(t)) if (k !== "mn" && k !== "mx") totals[k] = n(v);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, p.as_on_date::text q FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id
     WHERE (extract(month from p.as_on_date), extract(day from p.as_on_date)) IN ((3,31),(6,30),(9,30),(12,31))
     ORDER BY s.symbol, p.as_on_date`,
  );
  const perStock: Record<string, number[]> = {};
  for (const r of rows) (perStock[String(r.symbol)] ??= []).push(qIndex(String(r.q)));

  // A digest of every NSE-sourced row's scoring columns. If the BSE lane ever
  // updated instead of inserted, this changes — which is the one thing that must
  // never happen, since NSE rows are the validated series.
  const nse = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol,
            md5(string_agg(p.as_on_date::text || ':' || coalesce(p.promoter_pct::text,'-') || ':' ||
                           coalesce(p.fii_pct::text,'-') || ':' || coalesce(p.dii_pct::text,'-') || ':' ||
                           coalesce(p.total_shares::text,'-'), '|' ORDER BY p.as_on_date)) fp
     FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id
     WHERE p.xbrl_url NOT LIKE '%bseindia%' OR p.xbrl_url IS NULL
     GROUP BY s.symbol`,
  );
  const nseRowFingerprint: Record<string, string> = {};
  for (const r of nse) nseRowFingerprint[String(r.symbol)] = String(r.fp);

  return { takenAt: new Date().toISOString(), totals, perStock, nseRowFingerprint };
}

const longestRun = (idxRaw: number[]): number => {
  const idx = [...new Set(idxRaw)].sort((a, b) => a - b);
  if (!idx.length) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < idx.length; i++) {
    cur = idx[i] === idx[i - 1] + 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
};
const hist = (vals: number[]): string =>
  [1, 4, 8, 12, 20, 28].map((lo, i, a) => {
    const hi = a[i + 1] ?? Infinity;
    return `${lo}${hi === Infinity ? "+" : `-${hi - 1}`}:${vals.filter((v) => v >= lo && v < hi).length}`;
  }).join("  ");

async function main(): Promise<void> {
  const snap = await snapshot();

  if (BASELINE) {
    writeFileSync(SNAP, JSON.stringify(snap, null, 2));
    console.log(`\n=== STAGE 2 BASELINE -> ${SNAP} ===`);
    console.log(`  ${JSON.stringify(snap.totals)}`);
    const runs = Object.values(snap.perStock).map(longestRun);
    console.log(`  stocks reaching Mar-2019: ${Object.values(snap.perStock).filter((v) => Math.min(...v) <= MAR2019).length}`);
    console.log(`  longest-run histogram: ${hist(runs)}\n`);
    await prisma.$disconnect();
    return;
  }

  if (!existsSync(SNAP)) {
    console.error(`\nNo baseline at ${SNAP} — run with --baseline BEFORE applying.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(SNAP, "utf8")) as Snapshot;

  console.log(`\n=== STAGE 2 VERIFY — baseline ${base.takenAt} vs now ===\n`);
  console.log(`  ${"metric".padEnd(14)} ${"before".padStart(10)} ${"after".padStart(10)} ${"delta".padStart(10)}`);
  for (const k of Object.keys(base.totals)) {
    const b = base.totals[k], a = snap.totals[k] ?? 0;
    console.log(`  ${k.padEnd(14)} ${String(b).padStart(10)} ${String(a).padStart(10)} ${String(a - b).padStart(10)}`);
  }

  // ── THE INVARIANT THAT MATTERS MOST ──
  const changed = Object.keys(base.nseRowFingerprint).filter(
    (s) => base.nseRowFingerprint[s] !== snap.nseRowFingerprint[s],
  );
  console.log(`\n  -- NSE ROWS UNTOUCHED (the one thing that must hold) --`);
  console.log(`  ${changed.length === 0 ? "OK  " : "FAIL"} stocks whose NSE-sourced rows changed: ${changed.length} (must be 0)`);
  if (changed.length) console.log(`     ${changed.slice(0, 20).join(", ")}`);

  // ── coverage ──
  const beforeReach = Object.entries(base.perStock).filter(([, v]) => Math.min(...v) <= MAR2019).length;
  const afterReach = Object.entries(snap.perStock).filter(([, v]) => Math.min(...v) <= MAR2019).length;
  console.log(`\n  -- COVERAGE --`);
  console.log(`  stocks reaching Mar-2019      ${beforeReach} -> ${afterReach}  (+${afterReach - beforeReach})`);

  const bRuns = Object.values(base.perStock).map(longestRun);
  const aRuns = Object.values(snap.perStock).map(longestRun);
  console.log(`  stocks with >=8 consecutive   ${bRuns.filter((v) => v >= 8).length} -> ${aRuns.filter((v) => v >= 8).length}`);
  console.log(`  stocks with >=20 consecutive  ${bRuns.filter((v) => v >= 20).length} -> ${aRuns.filter((v) => v >= 20).length}`);
  console.log(`  before histogram: ${hist(bRuns)}`);
  console.log(`  after  histogram: ${hist(aRuns)}`);

  const gained = Object.keys(snap.perStock)
    .map((s) => ({ s, g: (snap.perStock[s]?.length ?? 0) - (base.perStock[s]?.length ?? 0) }))
    .filter((x) => x.g > 0).sort((a, b) => b.g - a.g);
  console.log(`\n  stocks that gained quarters: ${gained.length}`);
  console.log(`  biggest gains: ${gained.slice(0, 12).map((x) => `${x.s}+${x.g}`).join("  ")}`);

  // ── the plan's named case ──
  const nb = base.perStock.NESTLEIND ?? [], na = snap.perStock.NESTLEIND ?? [];
  console.log(`\n  -- NESTLEIND (the plan's named unlock) --`);
  console.log(`  quarters: ${nb.length} -> ${na.length}`);
  console.log(`  earliest: ${nb.length ? qLabel(Math.min(...nb)) : "-"} -> ${na.length ? qLabel(Math.min(...na)) : "-"}`);
  console.log(`  rows before Mar-2023: ${nb.filter((i) => i < MAR2023).length} -> ${na.filter((i) => i < MAR2023).length}`);

  // ── invariants over the whole table ──
  const [inv] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) FILTER (WHERE fii_pct < 0 OR fii_pct > 100) fii_oob,
            count(*) FILTER (WHERE dii_pct < 0 OR dii_pct > 100) dii_oob,
            count(*) FILTER (WHERE promoter_pct + public_pct < 50) partition_broken,
            count(*) FILTER (WHERE fii_pct IS NOT NULL AND dii_pct IS NOT NULL
                             AND fii_pct + dii_pct > public_pct + 0.05) inst_exceeds_public,
            count(*) FILTER (WHERE total_shares = 0) zero_total_shares,
            count(*) FILTER (WHERE promoter_shares > total_shares) promoter_gt_total
     FROM shareholding_patterns`,
  );
  console.log(`\n  -- INVARIANTS (all must be 0) --`);
  for (const [k, v] of Object.entries(inv)) console.log(`  ${n(v) === 0 ? "OK  " : "FAIL"} ${k.padEnd(22)} ${n(v)}`);

  console.log(
    `\n  NOTE fiiPct/diiPct/retailPct are SCORING INPUTS. No rescore was triggered\n` +
      `  by this backfill; it lands data only.\n`,
  );
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
