// ═══════════════════════════════════════════════════════════════
// UNIVERSE SHAREHOLDING COMPLETENESS — does every stock now have complete
// shareholding data back to the Mar-2019 target, or to its listing date?
//
//   npx tsx src/scripts/stage2-completeness-report.ts
//
// Read-only. Classifies EVERY active stock by EVIDENCE, not assumption:
// the BSE backfill ledger records, per stock-quarter, whether BSE actually held
// the data. So a stock that stops short of Mar-2019 can be separated into
//   · "complete from listing"  — we PROBED earlier quarters and BSE confirmed
//                                 they do not exist (absent / below_coverage), or
//   · "genuinely short"        — we never established that, so it is a real gap.
// That distinction is the whole point of the report; without the ledger it would
// be a guess.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const LEDGER = "_s2-bse-ledger.jsonl";
const OUT = "_s2-completeness.json";
const TARGET = "2019-03-31";

const qIndex = (iso: string): number => {
  const [y, m] = iso.split("-").map(Number);
  return y * 4 + Math.floor((m - 1) / 3);
};
const qLabel = (i: number): string =>
  `${Math.floor(i / 4)}-${["Mar", "Jun", "Sep", "Dec"][i % 4]}`;
const TARGET_Q = qIndex(TARGET);

type Status =
  | "complete_to_target"
  | "complete_from_listing"
  | "has_internal_gaps"
  | "short_unexplained"
  | "no_data";

interface Row {
  symbol: string; status: Status;
  quarters: number; earliest: string | null; latest: string | null;
  gaps: string[]; longestRun: number;
  bseRows: number; nseRows: number;
  evidence: string;
}

async function main(): Promise<void> {
  // ── what we hold ──
  const held = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, p.as_on_date::text q,
            (p.xbrl_url LIKE '%bseindia%') AS from_bse
     FROM stocks s
     LEFT JOIN shareholding_patterns p ON p.stock_id = s.id
       AND (extract(month from p.as_on_date), extract(day from p.as_on_date)) IN ((3,31),(6,30),(9,30),(12,31))
     WHERE s.is_active = true
     ORDER BY s.symbol, p.as_on_date`,
  );
  const bySym = new Map<string, { idx: number[]; bse: number; nse: number }>();
  for (const r of held) {
    const s = String(r.symbol);
    const e = bySym.get(s) ?? { idx: [], bse: 0, nse: 0 };
    if (r.q) {
      e.idx.push(qIndex(String(r.q)));
      if (r.from_bse) e.bse++; else e.nse++;
    }
    bySym.set(s, e);
  }

  // ── what we PROVED does not exist (the BSE probe ledger) ──
  const proven = new Map<string, Set<number>>(); // symbol -> quarter indices confirmed empty
  const rejected = new Map<string, string>();
  if (existsSync(LEDGER)) {
    for (const line of readFileSync(LEDGER, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>;
      try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const sym = String(e.symbol);
      if (e.verdict === "stock_rejected") { rejected.set(sym, String(e.reason)); continue; }
      // absent = BSE answered and held nothing. below_coverage = the descending
      // walk already hit this stock's floor, so everything older is empty too.
      if (e.verdict === "absent" || e.verdict === "below_coverage") {
        if (!proven.has(sym)) proven.set(sym, new Set());
        // Key on the ledger's DATE, not its qid: qid is BSE's own running quarter
        // number (101..131) while everything here uses year*4+quarter. Comparing
        // the two silently never matches, which made every short stock look
        // unexplained.
        proven.get(sym)!.add(qIndex(String(e.date)));
      }
    }
  }

  const rows: Row[] = [];
  for (const [symbol, e] of [...bySym].sort((a, b) => a[0].localeCompare(b[0]))) {
    const idx = [...new Set(e.idx)].sort((a, b) => a - b);
    if (!idx.length) {
      rows.push({ symbol, status: "no_data", quarters: 0, earliest: null, latest: null,
        gaps: [], longestRun: 0, bseRows: 0, nseRows: 0,
        evidence: rejected.get(symbol) ?? "no shareholding rows at all" });
      continue;
    }
    const gapsIdx: number[] = [];
    for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (!idx.includes(i)) gapsIdx.push(i);
    let best = 1, cur = 1;
    for (let i = 1; i < idx.length; i++) { cur = idx[i] === idx[i - 1] + 1 ? cur + 1 : 1; best = Math.max(best, cur); }

    const reachesTarget = idx[0] <= TARGET_Q;
    // Every quarter between the target and this stock's first row — were they all
    // PROVED empty at BSE?
    const missingBelow: number[] = [];
    for (let q = TARGET_Q; q < idx[0]; q++) missingBelow.push(q);
    const provenSet = proven.get(symbol) ?? new Set<number>();
    const allProven = missingBelow.every((q) => provenSet.has(q));

    let status: Status;
    let evidence: string;
    if (gapsIdx.length > 0) {
      status = "has_internal_gaps";
      evidence = `${gapsIdx.length} hole(s) inside its own span`;
    } else if (reachesTarget) {
      status = "complete_to_target";
      evidence = `reaches ${qLabel(idx[0])}, no gaps`;
    } else if (allProven && missingBelow.length > 0) {
      status = "complete_from_listing";
      evidence = `probed ${missingBelow.length} earlier quarter(s); BSE confirmed none exist`;
    } else {
      status = "short_unexplained";
      const unproven = missingBelow.filter((q) => !provenSet.has(q));
      evidence = rejected.get(symbol)
        ? `stock rejected at the overlap gate: ${rejected.get(symbol)}`
        : `${unproven.length} of ${missingBelow.length} earlier quarters never established as empty`;
    }

    rows.push({
      symbol, status, quarters: idx.length,
      earliest: qLabel(idx[0]), latest: qLabel(idx[idx.length - 1]),
      gaps: gapsIdx.map(qLabel), longestRun: best,
      bseRows: e.bse, nseRows: e.nse, evidence,
    });
  }

  // ── report ──
  const by = (s: Status) => rows.filter((r) => r.status === s);
  const pct = (n: number) => ((n / rows.length) * 100).toFixed(1);
  console.log(`\n${"=".repeat(78)}`);
  console.log(` UNIVERSE SHAREHOLDING COMPLETENESS — target ${TARGET} or listing date`);
  console.log(`${"=".repeat(78)}\n`);
  console.log(`  active stocks                      ${rows.length}`);
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  COMPLETE to Mar-2019               ${String(by("complete_to_target").length).padStart(4)}  (${pct(by("complete_to_target").length)}%)`);
  console.log(`  COMPLETE from listing date         ${String(by("complete_from_listing").length).padStart(4)}  (${pct(by("complete_from_listing").length)}%)  [probed, BSE confirmed empty]`);
  const done = by("complete_to_target").length + by("complete_from_listing").length;
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  => COMPLETE by the plan's definition ${String(done).padStart(3)}  (${pct(done)}%)`);
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  has internal gaps                  ${String(by("has_internal_gaps").length).padStart(4)}  (${pct(by("has_internal_gaps").length)}%)`);
  console.log(`  short, not explained               ${String(by("short_unexplained").length).padStart(4)}  (${pct(by("short_unexplained").length)}%)`);
  console.log(`  no data at all                     ${String(by("no_data").length).padStart(4)}`);

  for (const st of ["has_internal_gaps", "short_unexplained", "no_data"] as Status[]) {
    const list = by(st);
    if (!list.length) continue;
    console.log(`\n  ── ${st.toUpperCase().replace(/_/g, " ")} (${list.length}) ──`);
    for (const r of list.slice(0, 40))
      console.log(`     ${r.symbol.padEnd(13)} ${String(r.quarters).padStart(2)}q  ${(r.earliest ?? "-").padEnd(9)}..${(r.latest ?? "-").padEnd(9)}  ${r.evidence}${r.gaps.length ? ` [${r.gaps.slice(0, 8).join(" ")}]` : ""}`);
    if (list.length > 40) console.log(`     ... and ${list.length - 40} more (see ${OUT})`);
  }

  const bseTotal = rows.reduce((s, r) => s + r.bseRows, 0);
  const nseTotal = rows.reduce((s, r) => s + r.nseRows, 0);
  console.log(`\n  ── SOURCE MIX (quarter-end rows) ──`);
  console.log(`     NSE ${nseTotal}   BSE ${bseTotal}   total ${nseTotal + bseTotal}`);
  console.log(`     stocks with at least one BSE-sourced quarter: ${rows.filter((r) => r.bseRows > 0).length}`);

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), target: TARGET, rows }, null, 2));
  console.log(`\n  full per-stock detail -> ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
