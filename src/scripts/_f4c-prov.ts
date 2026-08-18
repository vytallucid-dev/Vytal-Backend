// ═══════════════════════════════════════════════════════════════
// F4c (2) — PROVENANCE + THE TAIL DISTRIBUTION. READ-ONLY.
//   npx tsx src/scripts/_f4c-prov.ts
//
// Two loose ends from F4a/F4b:
//   (1) the premise "they all had data before" rests on shareholding rows that stop
//       in 2018. Where did those come from, and do they say NSE once served these
//       companies — or that a DIFFERENT source did?
//   (2) the 210-day stale test returned zero. That is a threshold, not an answer.
//       Print the whole distribution of "newest report_date" across the 442 so the
//       tail is visible rather than thresholded away.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const SYMS = ["ABBOTINDIA", "BAYERCROP", "MCX", "RELIANCE"];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4c(2) — provenance of the 2018 rows, and the real completeness tail       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  // ── 1 · shareholding provenance ─────────────────────────────────────────
  const cols = await raw(`SELECT column_name FROM information_schema.columns WHERE table_name='shareholding_patterns' ORDER BY ordinal_position`);
  const hasSource = cols.some((c: any) => c.column_name === "source");
  console.log(`\n  shareholding_patterns columns: ${cols.map((c: any) => c.column_name).join(", ")}`);
  const sh = await raw(
    `SELECT s."symbol" sym, p."as_on_date"::text d, p."fiscal_year" fy, p."quarter" q,
            ${hasSource ? `p."source"` : `'(no source col)'`} src, p."created_at"::text created
       FROM shareholding_patterns p JOIN stocks s ON s."id"=p."stock_id"
      WHERE s."symbol" = ANY($1::text[]) ORDER BY s."symbol", p."as_on_date"`,
    SYMS,
  );
  console.log(`\n  ── shareholding rows for the three (+ control) ──`);
  console.log(`  ${pad("symbol", 13)}${pad("as_on", 12)}${pad("fy/q", 9)}${pad("source", 24)}created`);
  for (const r of sh) console.log(`  ${pad(r.sym, 13)}${pad(String(r.d).slice(0, 10), 12)}${pad(`${r.fy}${r.q}`, 9)}${pad(r.src, 24)}${String(r.created).slice(0, 19)}`);

  // when were these stock rows created, relative to the rest?
  const created = await raw(
    `SELECT date_trunc('day',"created_at")::date::text d, count(*)::int n
       FROM stocks WHERE "is_active"=true GROUP BY 1 ORDER BY 1`);
  console.log(`\n  ── stocks.created_at cohorts (active) ──`);
  for (const c of created) console.log(`  ${pad(c.d, 14)}${lp(c.n, 5)} stock(s)`);

  // original 224 membership
  let orig: Set<string> | null = null;
  try {
    orig = new Set(readFileSync("docs/original224_symbols.txt", "utf-8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    console.log(`\n  original224 list: ${orig.size} symbols`);
    for (const s of SYMS) console.log(`  ${pad(s, 13)} in original224: ${orig.has(s) ? "YES" : "no"}`);
  } catch { console.log(`  (original224_symbols.txt unreadable)`); }

  // ── 2 · the newest-report_date distribution across the whole cohort ──────
  const cohort = await loadCohort();
  const ALL_Q = ["quarterly_results", "banking_quarterly_results", "nbfc_quarterly_results",
    "life_insurance_quarterly_results", "general_insurance_quarterly_results"];
  const u = ALL_Q.map((t) => `SELECT "stock_id" sid, "report_date"::text rd FROM "${t}"`).join(" UNION ALL ");
  const mx = await raw(`SELECT sid, max(rd) rd, count(*)::int n FROM (${u}) x GROUP BY sid`);
  const byId = new Map<string, { rd: string; n: number }>();
  for (const r of mx) byId.set(r.sid, { rd: r.rd, n: r.n });

  const buckets = new Map<string, string[]>();
  for (const c of cohort) {
    const rd = byId.get(c.id)?.rd ?? "(none)";
    const k = rd === "(none)" ? "(none)" : String(rd).slice(0, 10);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(c.symbol);
  }
  console.log(`\n  ── newest report_date held, across the 442 ──`);
  console.log(`  ${pad("newest report_date", 22)}${lp("stocks", 8)}   symbols (when few)`);
  for (const [k, v] of [...buckets].sort((a, b) => (a[0] < b[0] ? 1 : -1)))
    console.log(`  ${pad(k, 22)}${lp(v.length, 8)}   ${v.length <= 12 ? v.join(", ") : ""}`);

  // ── 3 · row-count tail: who holds the fewest quarterly rows? ─────────────
  const thin = cohort
    .map((c) => ({ sym: c.symbol, ind: c.industryType, n: byId.get(c.id)?.n ?? 0, rd: byId.get(c.id)?.rd ?? null }))
    .sort((a, b) => a.n - b.n)
    .slice(0, 20);
  console.log(`\n  ── the 20 thinnest stocks by total quarterly rows held ──`);
  console.log(`  ${pad("symbol", 14)}${pad("industry", 15)}${lp("rows", 6)}   newest`);
  for (const t of thin) console.log(`  ${pad(t.sym, 14)}${pad(t.ind, 15)}${lp(t.n, 6)}   ${String(t.rd ?? "-").slice(0, 10)}`);

  writeFileSync(`${DIR}/_f4c-prov.json`, JSON.stringify({ sh, created, buckets: [...buckets].map(([k, v]) => ({ k, n: v.length, v })), thin }, null, 1));
  console.log(`\n  → ${DIR}/_f4c-prov.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
