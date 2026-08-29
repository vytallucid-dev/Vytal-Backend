// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 7b — THE RUN.  ⚠ WRITES when given --apply.  Default is a dry run.
//   Chunked · ledgered · resumable · fence by name per chunk · retention checked per chunk.
//   Halts on ANY fence movement. Failure MIX and median latency per chunk, never a bare count.
//
// This is _r2-run.ts's body with three differences that Stage 7b forced:
//
//   1. A UNIT CAN SPAN SEVERAL PDFs. ICICIPRULI's older quarters publish one file per form
//      (L1_Consolidated.pdf, L2_…, L3_…) while its newer ones and HDFCLIFE's publish a single
//      bundle. The pages of every PDF in a unit are CONCATENATED and the forms located across the
//      combined set, so both shapes take the identical path and neither is special-cased
//      downstream. The content test likewise runs on the combined set — a single per-form PDF
//      holds one form and would fail a test that expects a whole disclosure bundle.
//
//   2. ANNUAL UNITS READ A DIFFERENT COLUMN. _r2 hardcoded role="quarter_current" because it only
//      ever ran quarterly. An annual row must take ytd_current; taking the quarter column would
//      file Q4 alone as the full year — a wrong number that looks entirely plausible.
//
//   3. BASIS COMES FROM THE UNIT. `basis` is the writer's `result_type`, which is part of the
//      dedup key, so standalone and consolidated are genuinely different rows. ICICIPRULI
//      publishes both; hardcoding standalone would discard half of what was discovered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { prisma } from "../db/prisma.js";
import { fetchDocument, FETCH_LOG } from "../ingestions/quaterly-results/irdai/irdai-http.js";
import { documentContentTest, L1, L2, L3, NL1, NL2, NL3, type FormSpec } from "../ingestions/quaterly-results/irdai/irdai-forms.js";
import { extractForm } from "../ingestions/quaterly-results/irdai/irdai-parse.js";
import { writeRow } from "../ingestions/quaterly-results/irdai/irdai-writer.js";
import { captureBaseline, verifyFence } from "../ingestions/quaterly-results/irdai/irdai-fence.js";
import { IrdaiLedger, unitKey } from "../ingestions/quaterly-results/irdai/irdai-ledger.js";
import type { PeriodRole } from "../ingestions/quaterly-results/irdai/irdai-columns.js";

const require = createRequire(import.meta.url);
const OUT = "C:/Users/PUNCTU~1/AppData/Local/Temp/claude/c--Vytal/2ed9ba24-9e1a-498b-822d-b4e96613b3ce/scratchpad/s7b";
const LOCK = OUT + "/.stage7b-run.lock";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const DRY = !process.argv.includes("--apply");
const CHUNK = 10;

const MAP_LIFE: Record<string, string> = {
  gross_premium_income: "gross_premium_income", reinsurance_ceded: "reinsurance_ceded",
  total_commission: "total_commission", total_operating_expenses: "total_operating_expenses",
  profit_before_tax: "profit_before_tax", net_profit: "net_profit",
};
const MAP_GI: Record<string, string> = {
  premium_earned: "premium_earned", total_revenue: "total_revenue", incurred_claims: "incurred_claims",
  net_commission: "net_commission", total_operating_expenses_related_to_insurance: "total_operating_expenses_related_to_insurance",
};
const STORED_AS_MAGNITUDE = new Set(["reinsurance_ceded"]);

interface W {
  sym: string; fam: "life" | "general"; grain: "quarterly" | "annual"; basis: "standalone" | "consolidated";
  target: string; fy: string; q: string | null; mode: string; urls: string[];
}

async function pagesOf(buf: Buffer): Promise<string[]> {
  const { PDFParse, VerbosityLevel } = require("pdf-parse");
  const r = await new PDFParse({ data: buf, verbosity: VerbosityLevel.ERRORS }).getText({ pageJoiner: "\n" });
  return r.pages.map((x: { text?: string }) => String(x.text ?? ""));
}
const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

async function main(): Promise<void> {
  // ⚠ a stale background run once interleaved with a fresh one; shell job tables do not survive.
  if (fs.existsSync(LOCK)) { console.log("ABORT — lock held: " + fs.readFileSync(LOCK, "utf8")); return; }
  fs.writeFileSync(LOCK, "pid " + process.pid + " started " + new Date().toISOString());
  try {
    const t0 = new Date();
    const work: W[] = JSON.parse(fs.readFileSync("_s7b-worklist.json", "utf8")).units;
    const pdfCount = new Set(work.flatMap((w) => w.urls)).size;
    console.log("\n" + "=".repeat(120));
    console.log(`STAGE 7b RUN ${DRY ? "(DRY)" : "*** LIVE WRITE ***"}   ${work.length} units · ${pdfCount} PDFs   opened ${t0.toISOString()}`);
    console.log("=".repeat(120));

    const jobs = await raw(`SELECT count(*)::int n FROM background_jobs WHERE status IN ('running','pending','queued','in_progress')`);
    const clock = (await raw(`SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') t`))[0].t;
    console.log(`   DB clock (IST) ${clock} · background_jobs running/pending ${jobs[0].n}`);
    if (jobs[0].n > 0) { console.log("   ⚠ ABORT — a job is active inside the fence window."); return; }

    let base = await captureBaseline(prisma as never);
    const baseTotal = Object.values(base.totals).reduce((a: number, b: unknown) => a + Number(b), 0);
    console.log(`   fence baseline: ${baseTotal} insurance rows named`);

    const ledger = new IrdaiLedger(OUT + "/s7b-ledger.jsonl");
    const stockId = new Map<string, string>();
    for (const s of await raw(`SELECT id, symbol FROM stocks WHERE "industryType" IN ('life_insurance','general_insurance')`))
      stockId.set(s.symbol, s.id);

    const written: any[] = [];
    const chunks: W[][] = [];
    for (let i = 0; i < work.length; i += CHUNK) chunks.push(work.slice(i, i + CHUNK));

    for (let ci = 0; ci < chunks.length; ci++) {
      const lat: number[] = [];
      const mix = new Map<string, number>();
      console.log(`\n── chunk ${ci + 1}/${chunks.length} ` + "─".repeat(70));
      for (const w of chunks[ci]) {
        const period = (w.fy + " " + (w.q ?? "")).trim();
        const key = unitKey(w.sym, w.grain, period, w.basis);
        const bump = (k: string): void => { mix.set(k, (mix.get(k) ?? 0) + 1); };
        if (ledger.has(key)) { bump("already_done"); continue; }
        const t = Date.now();
        const lb = { unit: key, symbol: w.sym, grain: w.grain, period, basis: w.basis, url: w.urls[0] };

        // ── fetch every PDF of the unit, concatenate their pages ────────────────────────────────
        const pages: string[] = [];
        const fetchFail: string[] = [];
        for (const u of w.urls) {
          const r = await fetchDocument(u, { timeoutMs: 60000 });
          if (!r.ok) { fetchFail.push(`${u.split("/").pop()}:${r.reason}`); continue; }
          try { pages.push(...(await pagesOf(r.buf))); }
          catch (e) { fetchFail.push(`${u.split("/").pop()}:pdf_parse:${String(e).slice(0, 60)}`); }
        }
        lat.push(Date.now() - t);
        if (pages.length === 0) {
          bump("fetch_failed");
          ledger.append({ ...lb, outcome: "fetch_failed", note: fetchFail.join(" | ").slice(0, 200), ms: Date.now() - t, at: new Date().toISOString() });
          continue;
        }
        if (fetchFail.length) bump("partial_fetch");

        const dt = documentContentTest(pages);
        if (!dt.ok) {
          bump("doc_" + dt.reason);
          ledger.append({ ...lb, outcome: "content_test_failed", note: dt.reason, ms: Date.now() - t, at: new Date().toISOString() });
          continue;
        }

        // ⚠ annual takes the YEAR-TO-DATE column, not the quarter column.
        const role: PeriodRole = w.grain === "annual" ? "ytd_current" : "quarter_current";
        const forms: FormSpec[] = w.fam === "life" ? [L1, L2, L3] : [NL1, NL2, NL3];
        const map = w.fam === "life" ? MAP_LIFE : MAP_GI;
        const cells: Record<string, number | null> = {};
        const refusals: string[] = [];
        let unitName = "";
        let q1amb = false;
        for (const spec of forms) {
          const ex = extractForm(pages, spec, role, w.target, { q1Equivalent: w.q === "Q1" });
          for (const x of ex.refusals) refusals.push(`${spec.id}:${x.field ?? "(page)"}:${x.reason}`);
          for (const [f, v] of ex.fields) {
            const col = map[f];
            if (!col) continue;
            cells[col] = STORED_AS_MAGNITUDE.has(col) ? Math.abs(v.value) : v.value;
            unitName = v.unit;
            if (v.ambiguousWithSibling) q1amb = true;
          }
        }
        const n = Object.keys(cells).length;
        if (n === 0) {
          // ⚠ R1 RULING: an empty row is NEVER written — it reads as a gap yet consumes a
          //   retention slot and asserts the period was ingested. The ledger takes it instead.
          bump("no_fields");
          ledger.append({ ...lb, outcome: "no_fields_extracted", refusals: refusals.slice(0, 8), ms: Date.now() - t, at: new Date().toISOString() });
          continue;
        }
        const sid = stockId.get(w.sym);
        if (!sid) { bump("unknown_stock"); continue; }
        const out = await writeRow(prisma as never, {
          family: w.fam, grain: w.grain, stockId: sid, symbol: w.sym, fiscalYear: w.fy, quarter: w.q,
          reportDate: new Date(w.target), filingDate: new Date(w.target),
          basis: w.basis, sourceUrl: w.urls[0],
        }, cells, { dryRun: DRY });
        bump(out.written ? "written" : out.reason);
        ledger.append({
          ...lb,
          outcome: out.written ? "written" : out.reason === "existing_row_present" ? "skipped_existing_row" : "dry_run",
          cells: n, refusals: refusals.slice(0, 6), q1Ambiguous: q1amb, note: `${w.mode} ${w.urls.length}pdf`,
          ms: Date.now() - t, at: new Date().toISOString(),
        });
        if (out.written || DRY) written.push({ sym: w.sym, fy: w.fy, q: w.q, grain: w.grain, basis: w.basis, target: w.target, n, unitName, cells, pdfs: w.urls.length });
      }
      console.log(`   latency median ${lp(median(lat), 6)}ms  n=${lat.length}   MIX: ${[...mix.entries()].map(([k, v]) => k + " x" + v).join(" · ") || "(all cached)"}`);

      // ⚠ FENCE BY NAME, PER CHUNK. Halt on any movement.
      const f = await verifyFence(prisma as never, base);
      if (f.violations.length) {
        console.log(`   ⚠⚠ FENCE MOVED — HALTING AFTER CHUNK ${ci + 1}`);
        for (const v of f.violations) console.log("      " + pad(v.kind, 16) + " " + pad(v.name, 56) + " " + v.detail);
        break;
      }
      console.log(`   fence: 0 violations · rows added this chunk ${f.added.length}`);
      base = await captureBaseline(prisma as never);

      // ⚠ RETENTION, DURING the run — not as a post-hoc apology.
      const pol = await raw(`SELECT * FROM retention_policy`);
      if (pol.length) {
        const tcol = Object.keys(pol[0]).find((k) => /table/i.test(k))!;
        const kcol = Object.keys(pol[0]).find((k) => /key/i.test(k))!;
        let over = false;
        for (const p of (pol as any[]).filter((x) => String(x[tcol]).includes("insurance"))) {
          const tbl = String(p[tcol]);
          const keys = p[kcol] as string[];
          const d = await raw(`SELECT count(*)::int n FROM "${tbl}" GROUP BY ${keys.map((k) => `"${k}"`).join(",")} ORDER BY n DESC LIMIT 1`);
          const mx = (d as any[])[0]?.n ?? 0;
          if (mx > Number(p.keep)) { over = true; console.log(`   ⚠⚠ ${tbl} deepest key ${mx} EXCEEDS keep=${p.keep} — HALTING`); }
        }
        if (over) break;
      }
    }

    fs.writeFileSync(OUT + "/s7b-written.json", JSON.stringify(written, null, 2));
    fs.writeFileSync(OUT + "/s7b-fetchlog.json", JSON.stringify(FETCH_LOG, null, 2));
    console.log(`\n   closed ${new Date().toISOString()}   units attempted ${work.length}   rows ${DRY ? "would write" : "WRITTEN"} ${written.length}`);
    if (written.length) {
      const bySym = new Map<string, number>();
      for (const x of written) {
        const k = `${x.sym}|${x.grain}|${x.basis}`;
        bySym.set(k, (bySym.get(k) ?? 0) + 1);
      }
      for (const [k, v] of [...bySym].sort()) console.log("      " + pad(k, 36) + " " + v);
      const cellN = written.map((x) => x.n);
      console.log(`      cells per row: min ${Math.min(...cellN)} median ${median(cellN)} max ${Math.max(...cellN)}`);
    }
  } finally {
    fs.rmSync(LOCK, { force: true });
    await prisma.$disconnect();
  }
}
main().catch(async (e) => {
  fs.rmSync(LOCK, { force: true });
  console.error(String(e).slice(0, 3000));
  await prisma.$disconnect();
  process.exit(1);
});
