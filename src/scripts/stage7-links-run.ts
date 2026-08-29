// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 7 — WRITE FROM SUPPLIED LINKS.  ⚠ WRITES only with --apply. Dry by default.
//
//   npx tsx src/scripts/stage7-links-run.ts <manifest.json> [--apply] [--only SYM]
//
// One runner for every insurer whose links arrive by hand, because the differences between them are
// all in DISCOVERY — which is the part a human just did. Once a (symbol, grain, period, urls) tuple
// exists, NIACL and SBILIFE and LICI are the same problem.
//
// ── THE ONE RULE THAT MATTERS FOR HUMAN-SUPPLIED LINKS ────────────────────────────────────────────
// The label is a HYPOTHESIS. A correct number filed under the wrong quarter is invisible: the value
// is real, the row looks complete, and neither the fence nor the ratio gate can see it. So the
// document is asked what period it covers and the answer must contain the target — extractForm
// already asserts each column label against targetEndDate, and a mismatch REFUSES rather than
// falling back to position. This runner additionally records every period the document claimed, so
// a refusal can be read afterwards without re-fetching.
//
// Everything else is inherited from the proven path: pages of all a unit's PDFs concatenated,
// ytd_current for annual and quarter_current for quarterly, an empty row NEVER written, per-chunk
// fence by name, per-chunk retention depth, ledgered and resumable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { prisma } from "../db/prisma.js";
import { fetchRaw } from "../ingestions/quaterly-results/irdai/irdai-http.js";
import { documentContentTest, L1, L2, L3, NL1, NL2, NL3, findFormPages, type FormSpec } from "../ingestions/quaterly-results/irdai/irdai-forms.js";
import { extractForm } from "../ingestions/quaterly-results/irdai/irdai-parse.js";
import { readColumnLabels, readPageStatement, type PeriodRole } from "../ingestions/quaterly-results/irdai/irdai-columns.js";
import { writeRow } from "../ingestions/quaterly-results/irdai/irdai-writer.js";
import { captureBaseline, verifyFence } from "../ingestions/quaterly-results/irdai/irdai-fence.js";
import { IrdaiLedger, unitKey } from "../ingestions/quaterly-results/irdai/irdai-ledger.js";
import { fyq as fyqShared, fyLabel } from "./fy-label.js";

const require = createRequire(import.meta.url);
const SCRATCH = "C:/Users/PUNCTU~1/AppData/Local/Temp/claude/c--Vytal/2ed9ba24-9e1a-498b-822d-b4e96613b3ce/scratchpad/s7links";
fs.mkdirSync(SCRATCH, { recursive: true });
const CACHE = `${SCRATCH}/pages`;
fs.mkdirSync(CACHE, { recursive: true });
const LOCK = `${SCRATCH}/.run.lock`;

const MANIFEST = process.argv[2];
const DRY = !process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1].toUpperCase() : null;
const CHUNK = 10;

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number): string => String(s).padEnd(n);

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

interface Unit { symbol: string; fam: "life" | "general"; grain: "quarterly" | "annual"; period: string; urls: string[]; note?: string }

async function pagesOf(buf: Buffer): Promise<string[]> {
  const { PDFParse, VerbosityLevel } = require("pdf-parse");
  const p = await new PDFParse({ data: buf, verbosity: VerbosityLevel.ERRORS }).getText({ pageJoiner: "\n" });
  return p.pages.map((x: { text?: string }) => String(x.text ?? ""));
}
/** Liferay title separators differ by vintage; a reconstructed path must try both. */
const variants = (u: string): string[] => (u.includes("+") ? [u, u.replace(/\+/g, "%20")] : [u]);
const median = (a: number[]): number => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

async function main(): Promise<void> {
  if (!MANIFEST || !fs.existsSync(MANIFEST)) { console.log(`usage: stage7-links-run.ts <manifest.json> [--apply] [--only SYM]`); return; }
  if (fs.existsSync(LOCK)) { console.log(`ABORT — lock held: ${fs.readFileSync(LOCK, "utf8")}`); return; }
  fs.writeFileSync(LOCK, `pid ${process.pid} ${new Date().toISOString()}`);
  try {
    let units: Unit[] = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).units;
    if (ONLY) units = units.filter((u) => u.symbol.toUpperCase() === ONLY);
    console.log(`\n${"=".repeat(112)}`);
    console.log(`SUPPLIED-LINKS RUN ${DRY ? "(DRY)" : "*** LIVE WRITE ***"}  ${units.length} units · ${new Set(units.flatMap((u) => u.urls)).size} PDFs`);
    console.log("=".repeat(112));

    const jobs = await raw<{ n: number }>(`SELECT count(*)::int n FROM background_jobs WHERE status IN ('running','pending','queued','in_progress')`);
    if (jobs[0].n > 0) { console.log(`  ⚠ ABORT — ${jobs[0].n} job(s) active inside the fence window.`); return; }

    let base = await captureBaseline(prisma as never);
    console.log(`  fence baseline: ${Object.values(base.totals).reduce((a: number, b: any) => a + Number(b), 0)} insurance rows named`);
    const ledger = new IrdaiLedger(`${SCRATCH}/links-ledger.jsonl`);
    const stockId = new Map<string, string>();
    for (const s of await raw<{ id: string; symbol: string }>(
      `SELECT id, symbol FROM stocks WHERE "industryType" IN ('life_insurance','general_insurance')`)) stockId.set(s.symbol, s.id);

    const written: any[] = [];
    const chunks: Unit[][] = [];
    for (let i = 0; i < units.length; i += CHUNK) chunks.push(units.slice(i, i + CHUNK));

    for (let ci = 0; ci < chunks.length; ci++) {
      const lat: number[] = [];
      const mix = new Map<string, number>();
      console.log(`\n── chunk ${ci + 1}/${chunks.length} ${"─".repeat(64)}`);
      for (const u of chunks[ci]) {
        // ⚠ via the shared helper — a local `FY${y}` here once put 28 rows into the database with
        //   a 4-digit label where the whole corpus uses 2, and the natural key includes this field.
        const { fy, q } = fyqShared(u.period);
        const period = u.grain === "annual" ? fy : `${fy} ${q}`;
        const key = unitKey(u.symbol, u.grain, period, "standalone");
        const bump = (k: string): void => { mix.set(k, (mix.get(k) ?? 0) + 1); };
        if (ledger.has(key)) { bump("already_done"); continue; }
        const t = Date.now();
        const lb = { unit: key, symbol: u.symbol, grain: u.grain, period, basis: "standalone" as const, url: u.urls[0] };

        // ── fetch every PDF of the unit, concatenate pages ──────────────────────────────────────
        const slug = `${u.symbol}_${u.grain}_${u.period}`.replace(/[^A-Za-z0-9_]/g, "");
        const cf = `${CACHE}/${slug}.json`;
        let pages: string[] = [];
        const fails: string[] = [];
        if (fs.existsSync(cf)) pages = JSON.parse(fs.readFileSync(cf, "utf8"));
        else {
          for (const url of u.urls) {
            let got = false;
            for (const v of variants(url)) {
              const r = await fetchRaw(v, { timeoutMs: 300_000, binary: true });
              if (r.status === 200 && r.buf.subarray(0, 5).toString("latin1") === "%PDF-") {
                try { pages.push(...(await pagesOf(r.buf))); got = true; break; }
                catch (e) { fails.push(`${v.slice(-40)}:pdf_parse`); }
              }
            }
            if (!got) fails.push(`${url.slice(-46)}:unreachable`);
          }
          if (pages.length) fs.writeFileSync(cf, JSON.stringify(pages));
        }
        lat.push(Date.now() - t);
        if (!pages.length) {
          bump("fetch_failed");
          ledger.append({ ...lb, outcome: "fetch_failed", note: fails.join(" | ").slice(0, 200), ms: Date.now() - t, at: new Date().toISOString() });
          continue;
        }

        const dt = documentContentTest(pages);
        if (!dt.ok) {
          bump(`doc_${dt.reason}`);
          ledger.append({ ...lb, outcome: "content_test_failed", note: dt.reason, ms: Date.now() - t, at: new Date().toISOString() });
          continue;
        }

        const forms: FormSpec[] = u.fam === "life" ? [L1, L2, L3] : [NL1, NL2, NL3];
        // ⚠ record what the document CLAIMS, so a refusal is readable without re-fetching.
        const claimed = new Set<string>();
        for (const spec of forms)
          for (const p of findFormPages(pages, spec)) {
            const st = readPageStatement(pages[p]);
            if (st) claimed.add(st.endDate);
            for (const c of readColumnLabels(pages[p])) if (c.endDate) claimed.add(c.endDate);
          }
        const claims = [...claimed].sort();
        if (claims.length && !claims.includes(u.period)) {
          // The supplied label is not a period this document reports. REFUSE — do not guess which
          // of its columns was meant.
          bump("period_not_in_document");
          ledger.append({ ...lb, outcome: "period_refused", note: `label ${u.period} absent; document claims ${claims.join(",")}`.slice(0, 200), ms: Date.now() - t, at: new Date().toISOString() });
          console.log(`   ⚠ ${u.symbol} ${u.period} ${u.grain}: document claims [${claims.join(" ")}] — REFUSED`);
          continue;
        }

        const role: PeriodRole = u.grain === "annual" ? "ytd_current" : "quarter_current";
        const map = u.fam === "life" ? MAP_LIFE : MAP_GI;
        const cells: Record<string, number | null> = {};
        const refusals: string[] = [];
        let q1amb = false;
        for (const spec of forms.slice(0, 2)) {
          const ex = extractForm(pages, spec, role, u.period, { q1Equivalent: q === "Q1" });
          for (const x of ex.refusals) refusals.push(`${spec.id}:${x.field ?? "(page)"}:${x.reason}`);
          for (const [f, v] of ex.fields) {
            const col = map[f];
            if (!col) continue;
            cells[col] = STORED_AS_MAGNITUDE.has(col) ? Math.abs(v.value) : v.value;
            if (v.ambiguousWithSibling) q1amb = true;
          }
        }
        const n = Object.keys(cells).length;
        if (n === 0) {
          bump("no_fields");
          ledger.append({ ...lb, outcome: "no_fields_extracted", refusals: refusals.slice(0, 8), note: `claims ${claims.join(",")}`.slice(0, 150), ms: Date.now() - t, at: new Date().toISOString() });
          continue;
        }
        const sid = stockId.get(u.symbol);
        if (!sid) { bump("unknown_stock"); continue; }
        const out = await writeRow(prisma as never, {
          family: u.fam, grain: u.grain, stockId: sid, symbol: u.symbol, fiscalYear: fy,
          quarter: u.grain === "annual" ? null : q, reportDate: new Date(u.period), filingDate: new Date(u.period),
          basis: "standalone", sourceUrl: u.urls[0],
        }, cells, { dryRun: DRY });
        bump(out.written ? "written" : out.reason);
        ledger.append({
          ...lb, outcome: out.written ? "written" : out.reason === "existing_row_present" ? "skipped_existing_row" : "dry_run",
          cells: n, refusals: refusals.slice(0, 5), q1Ambiguous: q1amb, ms: Date.now() - t, at: new Date().toISOString(),
        });
        if (out.written || DRY) written.push({ symbol: u.symbol, grain: u.grain, period: u.period, fy, q, n, cells });
      }
      console.log(`   median ${median(lat)}ms n=${lat.length}  MIX: ${[...mix.entries()].map(([k, v]) => `${k} x${v}`).join(" · ") || "(all cached)"}`);
      const f = await verifyFence(prisma as never, base);
      if (f.violations.length) {
        console.log(`   ⚠⚠ FENCE MOVED — HALTING AFTER CHUNK ${ci + 1}`);
        for (const v of f.violations) console.log(`      ${pad(v.kind, 16)} ${pad(v.name, 52)} ${v.detail}`);
        break;
      }
      console.log(`   fence: 0 violations · rows added this chunk ${f.added.length}`);
      base = await captureBaseline(prisma as never);

      const pol = await raw<any>(`SELECT table_name, keep, key_cols FROM retention_policy WHERE table_name LIKE '%insurance%'`);
      let over = false;
      for (const p of pol) {
        const d = await raw<{ n: number }>(`SELECT count(*)::int n FROM "${p.table_name}" GROUP BY ${(p.key_cols as string[]).map((k) => `"${k}"`).join(",")} ORDER BY n DESC LIMIT 1`);
        if ((d[0]?.n ?? 0) > Number(p.keep)) { over = true; console.log(`   ⚠⚠ ${p.table_name} depth ${d[0].n} EXCEEDS keep=${p.keep} — HALTING`); }
      }
      if (over) break;
    }

    fs.writeFileSync(`${SCRATCH}/written.json`, JSON.stringify(written, null, 2));
    console.log(`\n  units ${units.length} · rows ${DRY ? "would write" : "WRITTEN"} ${written.length}`);
    const bySym = new Map<string, number>();
    for (const w of written) bySym.set(`${w.symbol}|${w.grain}`, (bySym.get(`${w.symbol}|${w.grain}`) ?? 0) + 1);
    for (const [k, v] of [...bySym].sort()) console.log(`     ${pad(k, 30)} ${v}`);
    if (written.length) {
      const cn = written.map((w) => w.n);
      console.log(`     cells per row: min ${Math.min(...cn)} median ${median(cn)} max ${Math.max(...cn)}`);
    }
  } finally {
    fs.rmSync(LOCK, { force: true });
    await prisma.$disconnect();
  }
}
main().catch(async (e) => { fs.rmSync(LOCK, { force: true }); console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
