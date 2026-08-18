// ═══════════════════════════════════════════════════════════════
// R4f — SCALE ANOMALIES. READ-ONLY (fetches source documents, writes nothing).
//   npx tsx src/scripts/_r4f-scale.ts [--max-probe 12]
//
// Band-check EVERY newly-written row against its same-basis neighbours: for each
// magnitude column, compare the value to the MEDIAN of that (stock, table, basis)
// series. Anything an order of magnitude away is reported with the source
// document, the unit, the decimals and the arithmetic.
//
// ⚠ Aman's ruling: KEEP genuine document defects — but PROVE the reading is
//   correct. So a flag is not a verdict. For each flagged row the probe dumps
//   every occurrence of the tag in the document (contextRef, unitRef, decimals,
//   raw value) and shows raw ÷ 1e7 = crore, which is the only arithmetic the
//   parser does. If the document says it, we keep it and say so.
//
// The median is used rather than the mean because a single 100× outlier drags a
// mean far enough to hide itself.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const DIR = process.env.R1_DIR ?? ".";
const CUT = process.env.R2_CUT ?? "2026-08-16 11:38:00";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const MAX_PROBE = Number(arg("--max-probe") ?? 12);
const RUPEES_PER_CRORE = 1e7;
const BAND = 10; // an order of magnitude
const MIN_NEIGHBOURS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

// column → the XBRL tag(s) whose reading produced it (for the probe).
// ⚠ netProfit is BASIS-DEPENDENT: for a CONSOLIDATED row the parser prefers
//   ProfitOrLossAttributableToOwnersOfParent (banking: ...MinorityInterest...) and
//   only falls back to ProfitLossForPeriod. Probing the fallback alone on a
//   consolidated row reports "stored value not found" for a value that is very much
//   in the document — which is exactly what it did for KAYNES FY23 (the filing
//   declares 58142496000000 = ₹5,814,249.60 Cr attributable to owners against
//   ₹63.51 Cr profit for the period; the FILER is wrong, our read is faithful).
const PROBE: Record<string, Record<string, string[]>> = {
  fundamentals: {
    revenue: ["RevenueFromOperations"],
    net_profit: ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossForPeriod"],
    total_assets: ["Assets"], total_equity: ["Equity"],
  },
  quarterly_results: {
    revenue: ["RevenueFromOperations"],
    net_profit: ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossForPeriod"],
    profit_before_tax: ["ProfitBeforeTax"],
  },
  banking_fundamentals: {
    interest_earned: ["InterestEarned"],
    net_profit: ["ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates", "ProfitLossForThePeriod"],
    total_assets: ["Assets"], deposits: ["Deposits"],
  },
  banking_quarterly_results: {
    interest_earned: ["InterestEarned"],
    net_profit: ["ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates", "ProfitLossForThePeriod"],
  },
};

function occurrences(xml: string, tag: string) {
  const out: { ctx: string; unit: string; decimals: string; rawValue: string }[] = [];
  const re = new RegExp(`<in-bse-fin:${tag}\\b([^>]*)>([^<]*)</in-bse-fin:${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const at = m[1];
    out.push({
      ctx: /contextRef="([^"]+)"/.exec(at)?.[1] ?? "-",
      unit: /unitRef="([^"]+)"/.exec(at)?.[1] ?? "-",
      decimals: /decimals="([^"]+)"/.exec(at)?.[1] ?? "-",
      rawValue: m[2].trim(),
    });
  }
  return out;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4f — SCALE ANOMALIES · band ${BAND}× vs the same-basis median                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  newly-written = updated_at > ${CUT} · a series needs ${MIN_NEIGHBOURS}+ neighbours to have a band\n`);

  interface Flag {
    tbl: string; sym: string; fy: string; q: string | null; rt: string; col: string;
    value: number; med: number; ratio: number; url: string; rd: string; n: number;
  }
  const flags: Flag[] = [];

  for (const [tbl, hasQ] of [["fundamentals", false], ["quarterly_results", true],
                             ["banking_fundamentals", false], ["banking_quarterly_results", true]] as [string, boolean][]) {
    const cols = Object.keys(PROBE[tbl]);
    const rows = await raw<any>(
      `SELECT x."id", st."symbol" sym, x."fiscal_year" fy, ${hasQ ? `x."quarter"` : `NULL::text`} AS q,
              x."result_type" rt, x."report_date"::text rd, x."xbrl_url" u, x."updated_at" > TIMESTAMP '${CUT}' AS fresh,
              ${cols.map((c) => `x."${c}"::float8 AS "${c}"`).join(", ")}
         FROM "${tbl}" x JOIN stocks st ON st."id"=x."stock_id"`);
    // group into (symbol, basis) series
    const g = new Map<string, any[]>();
    for (const r of rows) { const k = `${r.sym}|${r.rt}`; if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
    for (const [, series] of g) {
      for (const col of cols) {
        const vals = series.map((r) => r[col]).filter((v) => v !== null && Number.isFinite(v) && Math.abs(v) > 0);
        if (vals.length < MIN_NEIGHBOURS) continue;
        const med = median(vals.map(Math.abs));
        if (!(med > 0)) continue;
        for (const r of series) {
          if (!r.fresh) continue;                       // only rows THIS run wrote
          const v = r[col];
          if (v === null || !Number.isFinite(v) || Math.abs(v) === 0) continue;
          const ratio = Math.abs(v) / med;
          if (ratio > BAND || ratio < 1 / BAND) {
            flags.push({ tbl, sym: r.sym, fy: r.fy, q: r.q, rt: r.rt, col, value: v, med, ratio, url: r.u, rd: String(r.rd).slice(0, 10), n: vals.length });
          }
        }
      }
    }
  }

  flags.sort((a, b) => Math.abs(Math.log10(b.ratio)) - Math.abs(Math.log10(a.ratio)));
  console.log(`  flagged (value ${BAND}× away from its same-basis median): ${flags.length === 0 ? "✓ 0" : "⚠ " + flags.length}`);
  const byCol = new Map<string, number>();
  for (const f of flags) byCol.set(`${f.tbl}.${f.col}`, (byCol.get(`${f.tbl}.${f.col}`) ?? 0) + 1);
  for (const [k, n] of [...byCol.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${pad(k, 46)}${lp(n, 5)}`);

  if (flags.length) {
    console.log(`\n  ── the flagged rows (worst first) ──`);
    console.log(`  ${pad("symbol", 13)}${pad("period", 9)}${pad("basis", 13)}${pad("column", 22)}${lp("value", 14)}${lp("median", 14)}${lp("ratio", 9)}`);
    for (const f of flags.slice(0, 60)) {
      console.log(`  ${pad(f.sym, 13)}${pad(f.fy + (f.q ?? ""), 9)}${pad(f.rt, 13)}${pad(f.col, 22)}${lp(f.value.toFixed(2), 14)}${lp(f.med.toFixed(2), 14)}${lp(f.ratio.toFixed(2) + "×", 9)}`);
    }
    if (flags.length > 60) console.log(`  … ${flags.length - 60} more`);
  }

  // ── PROVE THE READING for the worst N ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ PROVING THE READING — document, unit, decimals, arithmetic                 ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const probes = flags.slice(0, MAX_PROBE);
  const verdicts: any[] = [];
  for (const f of probes) {
    console.log(`\n  ── ${f.sym} ${f.fy}${f.q ?? ""} ${f.rt} · ${f.col} = ${f.value} (median ${f.med.toFixed(2)}, ${f.ratio.toFixed(1)}×)`);
    const tags = PROBE[f.tbl][f.col];
    let xml: string;
    try { xml = await fetchXbrlFile(f.url); }
    catch (e) { console.log(`     document unreachable: ${(e as Error).message.slice(0, 70)}`); verdicts.push({ ...f, verdict: "unreachable" }); continue; }
    const occ = tags.flatMap((t) => occurrences(xml, t).map((o) => ({ ...o, tag: t })));
    console.log(`     occurrences of ${tags.map((t) => `<${t}>`).join(" / ")}: ${occ.length}`);
    let matched = false;
    for (const o of occ.slice(0, 10)) {
      const cr = parseFloat(o.rawValue) / RUPEES_PER_CRORE;
      const hit = Math.abs(cr - f.value) < Math.max(0.01, Math.abs(f.value) * 0.001);
      if (hit) matched = true;
      console.log(`       ${pad(o.tag, 46)} ctx=${pad(o.ctx, 8)} unit=${pad(o.unit, 6)} dec=${pad(o.decimals, 4)} raw=${pad(o.rawValue, 20)} → ${cr.toFixed(2)} Cr${hit ? "   ← MATCHES our stored value" : ""}`);
    }
    console.log(`     arithmetic: raw ÷ ${RUPEES_PER_CRORE} = crore (the only transform the parser applies)`);
    console.log(`     ⇒ ${matched ? "READING CORRECT — the document itself carries this magnitude (genuine document defect, KEEP)"
                                   : "⚠ NO OCCURRENCE MATCHES our stored value — investigate the read path"}`);
    console.log(`     ${f.url}`);
    verdicts.push({ ...f, verdict: matched ? "reading-correct" : "unmatched", occurrences: occ.length });
    await sleep(300);
  }

  const unmatched = verdicts.filter((v) => v.verdict === "unmatched");
  console.log(`\n  ── VERDICT ──`);
  console.log(`  probed ${probes.length} of ${flags.length} flagged`);
  console.log(`  reading proven correct (genuine document defect, keep): ${verdicts.filter((v) => v.verdict === "reading-correct").length}`);
  console.log(`  ⚠ stored value not found in the document               : ${unmatched.length}`);
  for (const u of unmatched) console.log(`      ⚠ ${u.sym} ${u.fy}${u.q ?? ""} ${u.rt} ${u.col}=${u.value}`);
  writeFileSync(`${DIR}/_r4f-scale.json`, JSON.stringify({ flags, verdicts }, null, 1));
  console.log(`  → ${DIR}/_r4f-scale.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
