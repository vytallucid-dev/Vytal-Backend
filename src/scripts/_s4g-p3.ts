// ═══════════════════════════════════════════════════════════════
// S4G · PART 3 — WHAT KEYING ACTUALLY BUYS. READ-ONLY. Emits the CSV + MD.
//
// THE SIMULATION IS A COVERAGE SIMULATION, AND SAYS SO. Filling a gap can only add
// PERIODS; it cannot change a value that is already there. So:
//   · insufficient_history  → FIXABLE by keying, iff the stock had listed by then.
//   · non_positive_base     → NOT fixable. m4NetProfitYoyTtm reads the LAST 8 quarters;
//                             filling earlier gaps lengthens the tail but never moves that
//                             window, so a negative prior-year TTM base stays negative.
//   · divide_by_zero        → NOT fixable, same reason.
// Reporting a keyed stock as "scoreable" when a value-side blocker survives would be the
// exact wasted work this part exists to prevent.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const OUT = process.env.S4G_OUT ?? "c:/Vytal/Vytal/outputs";
mkdirSync(OUT, { recursive: true });
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

const WIN_START = "2018-03-31", WIN_END = "2024-12-31";
const qi = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };
const ql = (i: number) => { const y = Math.floor(i / 4), q = i % 4; return `${y}-${String(q * 3 + 3).padStart(2, "0")}-${[31, 30, 30, 31][q]}`; };
const I_START = qi(WIN_START), I_END = qi(WIN_END), I_CUT = qi("2021-12-31");

// Aman's ruled banking manual-entry set.
const BK_Q_RULED = ["interest_expended", "gnpa_pct"];
const BK_A_RULED = ["advances", "investments", "cash_and_balances_with_rbi", "balances_with_banks"];
const L3_MIN_N = 6;

interface Cell { symbol: string; industry: string; table: string; basis: string; fiscalYear: string; quarter: string; reportDate: string; type: "A" | "B" | "C"; field: string; why: string; sourceHint: string; xbrlUrl: string; momentumCritical: boolean }

async function main() {
  const cohort = await loadCohort();
  const ind = new Map(cohort.map((c) => [c.symbol, c.industryType]));
  const { cells, exclBoundary, exclPreFirst } = JSON.parse(readFileSync(`${OUT}/_s4g-cells.json`, "utf8")) as { cells: Cell[]; exclBoundary: number; exclPreFirst: number };
  const mom = JSON.parse(readFileSync("./_f5-momentum.json", "utf8"));
  const momBy = new Map<string, any>(mom.rows.map((r: any) => [r.sym, r]));

  // ── first filing per stock, IN and OUT of window ─────────────────────────
  const firsts = await raw(`
    SELECT s."symbol" sym,
      min(t.rd) FILTER (WHERE t.rd BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}')::text first_in,
      min(t.rd)::text first_any, max(t.rd)::text last_any
      FROM (SELECT "stock_id" sid,"report_date" rd FROM quarterly_results
            UNION ALL SELECT "stock_id","report_date" FROM banking_quarterly_results) t
      JOIN stocks s ON s."id"=t.sid WHERE s."is_active"=true GROUP BY s."symbol"`);
  const fBy = new Map(firsts.map((r: any) => [r.sym, r]));

  // ── standalone ordinals held today, per stock ────────────────────────────
  const held = await raw(`
    SELECT s."symbol" sym, t.rd::text rd FROM
      (SELECT "stock_id" sid,"report_date" rd FROM quarterly_results WHERE "result_type"='standalone'
       UNION ALL SELECT "stock_id","report_date" FROM banking_quarterly_results WHERE "result_type"='standalone') t
      JOIN stocks s ON s."id"=t.sid
     WHERE t.rd BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}'`);
  const saBy = new Map<string, Set<number>>();
  for (const r of held as any[]) {
    if (!saBy.has(r.sym)) saBy.set(r.sym, new Set());
    saBy.get(r.sym)!.add(qi(String(r.rd).slice(0, 10)));
  }

  // ── per-stock roll-up ────────────────────────────────────────────────────
  interface S {
    sym: string; ind: string; A: number; B: number; C: number; total: number;
    periods: Set<string>; firstIn: string | null; firstAny: string | null;
    inWindow: boolean; completeNow: boolean; completeAfter: boolean;
    momNow: boolean; momAfter: boolean; momBlocker: string; tailNow: number; tailAfter: number;
    l3AfterM1: boolean; l3AfterM3: boolean;
  }
  const S: S[] = [];
  for (const c of cohort) {
    const f = fBy.get(c.symbol) as any;
    const cs = cells.filter((x) => x.symbol === c.symbol);
    const periods = new Set(cs.map((x) => `${x.table}|${x.fiscalYear}|${x.reportDate}`));
    const A = cs.filter((x) => x.type === "A").length, B = cs.filter((x) => x.type === "B").length, Cc = cs.filter((x) => x.type === "C").length;
    const firstIn = f?.first_in ? String(f.first_in).slice(0, 10) : null;
    const inWindow = !!firstIn;
    const sa = saBy.get(c.symbol) ?? new Set<number>();
    const fi = inWindow ? qi(firstIn!) : null;

    // COMPLETE (recount definition): holds every standalone quarter from first filing → WIN_END.
    let completeNow = false;
    if (fi !== null) { completeNow = true; for (let i = fi; i <= I_END; i++) if (!sa.has(i)) { completeNow = false; break; } }
    // After keying every A/B/C cell, every slot from first filing → WIN_END is populated.
    const completeAfter = inWindow;

    // MOMENTUM at the cutoff — coverage side.
    const m = momBy.get(c.symbol);
    const isBk = c.industryType === "banking";
    const keys = isBk ? ["NIM", "PPOP", "NII", "NPyoy", "GNPAttm"] : ["M1", "M2", "M3", "M4", "M5"];
    const momNow = !!m && keys.every((k) => m.metrics[k]);
    const tailNow = m?.tail ?? 0;
    const tailAfter = fi !== null && fi <= I_CUT ? I_CUT - fi + 1 : 0;

    // Value-side blockers survive keying.
    const hardReasons = new Set(["non_positive_base", "divide_by_zero"]);
    const hard = m ? keys.filter((k) => !m.metrics[k] && hardReasons.has(m.reasons[k])) : [];
    let momAfter: boolean, blocker = "";
    if (!m) { momAfter = false; blocker = "not measured"; }
    else if (isBk) {
      // banking: M2/M3/M4 are ANNUAL (2 consecutive FYs); M1 needs 4 quarters + 2 annuals; M5 the latest quarter.
      const annualOk = keys.filter((k) => ["PPOP", "NII", "NPyoy"].includes(k)).every((k) => m.metrics[k] || m.reasons[k] === "missing_line_item");
      const covOk = tailAfter >= 4 && annualOk;
      momAfter = covOk && hard.length === 0;
      blocker = hard.length ? `value-side: ${hard.join(",")}` : !covOk ? (tailAfter < 4 ? `listed too late (tail ${tailAfter} < 4)` : "annual history < 2 FY at cutoff") : "";
    } else {
      const covOk = tailAfter >= 8;                       // M3/M4 need 8 consecutive
      momAfter = covOk && hard.length === 0;
      blocker = hard.length ? `value-side: ${hard.join(",")}` : !covOk ? `listed too late (tail ${tailAfter} < 8)` : "";
    }
    S.push({
      sym: c.symbol, ind: c.industryType, A, B, C: Cc, total: A + B + Cc, periods,
      firstIn, firstAny: f?.first_any ? String(f.first_any).slice(0, 10) : null, inWindow,
      completeNow, completeAfter, momNow, momAfter, momBlocker: blocker, tailNow, tailAfter,
      l3AfterM1: tailAfter >= 9, l3AfterM3: tailAfter >= 13,
    });
  }

  // ══ P3a ══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ P3a — TOTAL CELLS BY TYPE AND TABLE                                        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const tables = ["quarterly_results", "fundamentals", "banking_quarterly_results", "banking_fundamentals"];
  console.log(`  ${pad("table", 30)}${lp("A", 9)}${lp("B", 9)}${lp("C", 9)}${lp("total", 9)}`);
  for (const t of tables) {
    const f = cells.filter((c) => c.table === t);
    console.log(`  ${pad(t, 30)}${lp(f.filter((c) => c.type === "A").length, 9)}${lp(f.filter((c) => c.type === "B").length, 9)}${lp(f.filter((c) => c.type === "C").length, 9)}${lp(f.length, 9)}`);
  }
  const tot = (t: string) => cells.filter((c) => c.type === t).length;
  console.log(`  ${pad("TOTAL", 30)}${lp(tot("A"), 9)}${lp(tot("B"), 9)}${lp(tot("C"), 9)}${lp(cells.length, 9)}`);
  console.log(`\n  A = missing field on a row we hold (keyable from the xbrl_url we already have)`);
  console.log(`  B = missing standalone period, consolidated held ⇒ RE-INGEST, not manual entry`);
  console.log(`  C = missing period, nothing at source ⇒ company annual report / quarterly PDF`);

  // ══ P3c ══
  const compNow = S.filter((s) => s.completeNow).length, compAfter = S.filter((s) => s.completeAfter).length;
  const notComp = S.filter((s) => !s.completeAfter);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ P3c — HOW MANY OF THE 439 WOULD BE COMPLETE IF ALL OF IT WERE KEYED        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  complete now                 : ${compNow}`);
  console.log(`  complete after ALL keying    : ${compAfter}   (of ${S.length})`);
  console.log(`  still NOT complete           : ${notComp.length}`);
  console.log(`\n  ── why the remainder cannot be completed ──`);
  console.log(`  ${notComp.length} stocks have NO quarterly row inside ${WIN_START}..${WIN_END} at all.`);
  console.log(`  They listed AFTER the window closed — there is no filing to key, at any price.`);
  console.log(`  ${pad("symbol", 14)}${pad("first filing (any date)", 26)}${"rows begin"}`);
  for (const s of notComp.slice(0, 25)) console.log(`  ${pad(s.sym, 14)}${pad(s.firstAny ?? "(none)", 26)}${s.firstAny ?? ""}`);
  if (notComp.length > 25) console.log(`  … ${notComp.length - 25} more (in the CSV)`);

  // ══ P3d ══
  const nf = S.filter((s) => s.ind === "non_financial"), bk = S.filter((s) => s.ind === "banking");
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ P3d — MOMENTUM-SCOREABLE AT 2022-01-31, BEFORE AND AFTER KEYING           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("", 26)}${lp("non-financial", 16)}${lp("banking", 11)}${lp("all", 8)}`);
  console.log(`  ${pad("scoreable NOW", 26)}${lp(nf.filter((s) => s.momNow).length, 16)}${lp(bk.filter((s) => s.momNow).length, 11)}${lp(S.filter((s) => s.momNow).length, 8)}`);
  console.log(`  ${pad("scoreable AFTER keying", 26)}${lp(nf.filter((s) => s.momAfter).length, 16)}${lp(bk.filter((s) => s.momAfter).length, 11)}${lp(S.filter((s) => s.momAfter).length, 8)}`);
  console.log(`  ${pad("gained", 26)}${lp(nf.filter((s) => s.momAfter && !s.momNow).length, 16)}${lp(bk.filter((s) => s.momAfter && !s.momNow).length, 11)}${lp(S.filter((s) => s.momAfter && !s.momNow).length, 8)}`);
  const blocked = S.filter((s) => !s.momAfter);
  const byBlk = new Map<string, number>();
  for (const s of blocked) { const k = s.momBlocker.startsWith("value-side") ? "value-side (non_positive_base / divide_by_zero) — keying cannot fix" : s.momBlocker.startsWith("listed too late") ? "listed too late — no filing exists before the cutoff" : s.momBlocker || "?"; byBlk.set(k, (byBlk.get(k) ?? 0) + 1); }
  console.log(`\n  ── the ${blocked.length} that remain unscoreable even after ALL keying ──`);
  for (const [k, v] of [...byBlk].sort((a, b) => b[1] - a[1])) console.log(`  ${lp(v, 5)}  ${k}`);
  console.log(`\n  ── L3 own-history depth after keying (l3MinN = ${L3_MIN_N}) ──`);
  console.log(`  ${pad("L3 on M1 (needs 9 consecutive)", 34)}${lp(nf.filter((s) => s.l3AfterM1).length, 8)} of ${nf.length} non-financial`);
  console.log(`  ${pad("L3 on M3 (needs 13 consecutive)", 34)}${lp(nf.filter((s) => s.l3AfterM3).length, 8)} of ${nf.length} non-financial`);

  // ══ BANKING — the era gap, stated plainly ══
  const bkQ = cells.filter((c) => c.table === "banking_quarterly_results" && BK_Q_RULED.includes(c.field));
  const bkA = cells.filter((c) => c.table === "banking_fundamentals" && BK_A_RULED.includes(c.field));
  // ⚠ ANNUAL type-C rows carry NO report_date (the period does not exist), so an empty string
  //   would sort BEFORE the cutoff and silently count every FY as pre-cutoff. Annual is gated on
  //   the FY label; only quarterly is gated on report_date.
  const fyOrdOf = (fy: string) => { const m = /^FY(\d{2})$/.exec(fy); return m ? 2000 + +m[1] : NaN; };
  const bkQpre = bkQ.filter((c) => c.reportDate && c.reportDate <= "2021-12-31");
  const bkApre = bkA.filter((c) => fyOrdOf(c.fiscalYear) <= 2021);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ THE BANKING SET AMAN RULED — EXACT CELL COUNT                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  quarterly (interest_expended, gnpa_pct)                : ${bkQ.length} cells total`);
  console.log(`     of those, ≤ 2021-12-31 (the 13-quarter momentum run): ${bkQpre.length}`);
  console.log(`  annual (advances, investments, cash_rbi, bal_banks)    : ${bkA.length} cells total`);
  console.log(`     of those, ≤ 2021-12-31                              : ${bkApre.length}`);
  console.log(`  ─────────────────────────────────────────────────────────────────`);
  console.log(`  RULED SET, momentum run only (≤2021-12-31)             : ${bkQpre.length + bkApre.length}`);
  console.log(`  RULED SET, full 2018..2024 window                      : ${bkQ.length + bkA.length}`);
  const qPeriods = [...new Set(bkQpre.map((c) => c.reportDate))].sort();
  console.log(`\n  quarterly periods actually needed (${qPeriods.length}): ${qPeriods.join(" ")}`);
  const aPeriods = [...new Set(bkApre.map((c) => c.fiscalYear))].sort();
  console.log(`  annual FYs actually needed (${aPeriods.length}): ${aPeriods.join(" ")}`);

  // ══ P3b — per stock, ranked by cheapest win ══
  const gained = S.filter((s) => s.total > 0).map((s) => ({ ...s, cpc: s.completeAfter && !s.completeNow ? s.total : Infinity }));
  const wins = gained.filter((s) => s.cpc !== Infinity).sort((a, b) => a.cpc - b.cpc);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ P3b — CHEAPEST WINS FIRST (cells per stock made complete)                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("symbol", 13)}${pad("ind", 14)}${lp("cells", 7)}${lp("A", 6)}${lp("B", 6)}${lp("C", 6)}  ${pad("→complete", 11)}${pad("→momentum", 11)}blocker`);
  for (const s of wins.slice(0, 30)) console.log(`  ${pad(s.sym, 13)}${pad(s.ind, 14)}${lp(s.total, 7)}${lp(s.A, 6)}${lp(s.B, 6)}${lp(s.C, 6)}  ${pad(s.completeAfter ? "yes" : "no", 11)}${pad(s.momAfter ? "yes" : "no", 11)}${s.momBlocker}`);
  console.log(`  … ${Math.max(0, wins.length - 30)} more (full ranking in the CSV)`);

  // ══ P3e — effort ══
  // One document lookup yields every field on that (stock, period, basis) — so the unit of
  // work is the DOCUMENT, not the cell.
  const docsA = new Set(cells.filter((c) => c.type === "A").map((c) => `${c.symbol}|${c.table}|${c.fiscalYear}|${c.reportDate}`)).size;
  const docsC = new Set(cells.filter((c) => c.type === "C").map((c) => `${c.symbol}|${c.table}|${c.reportDate}`)).size;
  const docsB = new Set(cells.filter((c) => c.type === "B").map((c) => `${c.symbol}|${c.table}|${c.fiscalYear}|${c.reportDate}`)).size;
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ P3e — KEYING EFFORT                                                        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("", 34)}${lp("cells", 9)}${lp("documents", 12)}`);
  console.log(`  ${pad("A — from the XBRL we hold", 34)}${lp(tot("A"), 9)}${lp(docsA, 12)}`);
  console.log(`  ${pad("B — RE-INGEST (not keying)", 34)}${lp(tot("B"), 9)}${lp(docsB, 12)}`);
  console.log(`  ${pad("C — from company AR / PDF", 34)}${lp(tot("C"), 9)}${lp(docsC, 12)}`);
  const keyDocs = docsA + docsC, keyCells = tot("A") + tot("C");
  console.log(`  ${pad("KEYABLE (A + C)", 34)}${lp(keyCells, 9)}${lp(keyDocs, 12)}`);
  for (const [lo, hi, label] of [[4, 8, "A (URL in hand, open + read)"], [8, 15, "C (find the PDF, then read)"]] as const) void label;
  const hA = [docsA * 4 / 60, docsA * 8 / 60], hC = [docsC * 8 / 60, docsC * 15 / 60];
  console.log(`\n  rate assumption: one DOCUMENT yields every field on that (stock, period, basis).`);
  console.log(`    A — the xbrl_url is in the manifest: 4–8 min/document`);
  console.log(`    C — locate the AR/PDF on the IR site first: 8–15 min/document`);
  console.log(`  ${pad("A effort", 34)}${lp(`${hA[0].toFixed(0)}–${hA[1].toFixed(0)} h`, 12)}`);
  console.log(`  ${pad("C effort", 34)}${lp(`${hC[0].toFixed(0)}–${hC[1].toFixed(0)} h`, 12)}`);
  console.log(`  ${pad("TOTAL keying", 34)}${lp(`${(hA[0] + hC[0]).toFixed(0)}–${(hA[1] + hC[1]).toFixed(0)} h`, 12)}   (${((hA[0] + hC[0]) / 7).toFixed(0)}–${((hA[1] + hC[1]) / 7).toFixed(0)} working days at 7 h/day)`);

  // ══ EMIT ══
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const hdr = ["symbol", "industry_type", "table", "basis", "fiscal_year", "quarter", "report_date", "type", "field_name", "why_needed", "source_hint", "xbrl_url", "momentum_critical"];
  const csv = [hdr.join(",")];
  const ord = { A: 0, B: 1, C: 2 } as const;
  const sorted = [...cells].sort((a, b) => a.symbol.localeCompare(b.symbol) || ord[a.type] - ord[b.type] || a.table.localeCompare(b.table) || a.reportDate.localeCompare(b.reportDate) || a.field.localeCompare(b.field));
  for (const c of sorted) csv.push([c.symbol, c.industry, c.table, c.basis, c.fiscalYear, c.quarter, c.reportDate, c.type, c.field, c.why, c.sourceHint, c.xbrlUrl, c.momentumCritical ? "yes" : "no"].map(esc).join(","));
  writeFileSync(`${OUT}/vytal-manual-entry-manifest.csv`, csv.join("\n"), "utf8");

  const shdr = ["symbol", "industry_type", "cells_total", "cells_A", "cells_B", "cells_C", "first_filing_in_window", "first_filing_any", "complete_now", "complete_after_keying", "momentum_now", "momentum_after_keying", "tail_now", "tail_after_keying", "residual_blocker"];
  const scsv = [shdr.join(",")];
  const srt = [...S].sort((a, b) => (b.completeAfter && !b.completeNow ? 1 : 0) - (a.completeAfter && !a.completeNow ? 1 : 0) || a.total - b.total || a.sym.localeCompare(b.sym));
  for (const s of srt) scsv.push([s.sym, s.ind, s.total, s.A, s.B, s.C, s.firstIn ?? "", s.firstAny ?? "", s.completeNow ? "yes" : "no", s.completeAfter ? "yes" : "no", s.momNow ? "yes" : "no", s.momAfter ? "yes" : "no", s.tailNow, s.tailAfter, s.momBlocker].map(esc).join(","));
  writeFileSync(`${OUT}/vytal-manual-entry-by-stock.csv`, scsv.join("\n"), "utf8");

  writeFileSync(`${OUT}/_s4g-p3.json`, JSON.stringify({
    p3a: { byType: { A: tot("A"), B: tot("B"), C: tot("C") }, total: cells.length },
    p3c: { completeNow: compNow, completeAfter: compAfter, blocked: notComp.map((s) => s.sym) },
    p3d: { nfNow: nf.filter((s) => s.momNow).length, nfAfter: nf.filter((s) => s.momAfter).length, bkNow: bk.filter((s) => s.momNow).length, bkAfter: bk.filter((s) => s.momAfter).length, blockers: [...byBlk] },
    banking: { ruledQ: bkQ.length, ruledA: bkA.length, ruledQpre: bkQpre.length, ruledApre: bkApre.length, qPeriods, aPeriods },
    effort: { docsA, docsB, docsC, keyCells, keyDocs },
    excl: { exclBoundary, exclPreFirst },
  }, null, 1));

  console.log(`\n  → ${OUT}/vytal-manual-entry-manifest.csv   (${cells.length} rows)`);
  console.log(`  → ${OUT}/vytal-manual-entry-by-stock.csv    (${S.length} rows)`);
  console.log(`  → ${OUT}/_s4g-p3.json`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
