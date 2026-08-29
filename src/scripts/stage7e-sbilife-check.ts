// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 7e — CHECK EVERY SUPPLIED SBILIFE LINK. Read-only. No DB writes, no ledger.
//   npx tsx src/scripts/stage7e-sbilife-check.ts [--only 2019-03-31,...]
//
// ── WHY A SEPARATE CHECK PASS ────────────────────────────────────────────────────────────────────
// These URLs came with human labels, and a human label is exactly the thing this lane must not
// trust. Filing a correct number under the wrong quarter is invisible downstream: the value is real,
// the row looks complete, and no fence or ratio gate can see it. So every document is asked what
// period IT thinks it covers, and that answer — not the label — is what gets compared.
//
// Two supplied links are explicitly uncertain and are treated as hypotheses, not facts:
//   · the Mar-2019 link is spelt "...quarter-ended-april-30-2019-results"
//   · six links were recovered from google.com/search wrappers, so their sbilife.co.in path is a
//     RECONSTRUCTION. Liferay resolves /documents/<site>/<folder>/<title>, and the title separator
//     may be "+" or "%20", so both spellings are tried before a link is called dead.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fetchRaw } from "../ingestions/quaterly-results/irdai/irdai-http.js";
import { L1, L2, L3, documentContentTest, findFormPages } from "../ingestions/quaterly-results/irdai/irdai-forms.js";
import { extractForm } from "../ingestions/quaterly-results/irdai/irdai-parse.js";
import { resolveUnit } from "../ingestions/quaterly-results/irdai/irdai-units.js";
import { readColumnLabels, readPageStatement } from "../ingestions/quaterly-results/irdai/irdai-columns.js";
const require = createRequire(import.meta.url);

const CACHE = "C:/Users/PUNCTU~1/AppData/Local/Temp/claude/c--Vytal/2ed9ba24-9e1a-498b-822d-b4e96613b3ce/scratchpad/s7e";
fs.mkdirSync(CACHE, { recursive: true });
const OUT = "_s7e-sbilife-check.json";

interface Link { period: string; url: string; fy?: string; userLabel?: string; flag?: string }
const links = JSON.parse(fs.readFileSync("_sbilife-links.json", "utf8")) as { annual: Link[]; quarterly: Link[] };

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;

/** Liferay title separators differ across vintages; a reconstructed path must try both. */
function variants(url: string): string[] {
  const out = [url];
  if (url.includes("+")) out.push(url.replace(/\+/g, "%20"));
  return out;
}

async function pagesOf(buf: Buffer): Promise<string[]> {
  const { PDFParse, VerbosityLevel } = require("pdf-parse");
  const p = await new PDFParse({ data: buf, verbosity: VerbosityLevel.ERRORS }).getText({ pageJoiner: "\n" });
  return p.pages.map((x: any) => String(x.text ?? ""));
}

const results: any[] = [];

async function check(l: Link, grain: "quarterly" | "annual"): Promise<void> {
  if (only && !only.has(l.period)) return;
  const slug = `SBILIFE_${grain}_${l.period}`.replace(/[^A-Za-z0-9_]/g, "");
  const file = `${CACHE}/${slug}.json`;
  let pages: string[] | null = null;
  let usedUrl = l.url;
  let status = "cached";
  let bytes = 0;

  if (fs.existsSync(file)) {
    pages = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    for (const u of variants(l.url)) {
      const r = await fetchRaw(u, { timeoutMs: 300_000, binary: true });
      bytes = r.buf.length;
      const magic = r.buf.subarray(0, 5).toString("latin1");
      if (r.status === 200 && magic === "%PDF-") {
        try { pages = await pagesOf(r.buf); usedUrl = u; status = `HTTP 200`; break; }
        catch (e) { status = `pdf_parse_failed: ${String(e).slice(0, 60)}`; }
      } else {
        status = `HTTP ${r.status}${magic === "%PDF-" ? "" : ` (not a pdf: "${magic.replace(/[^\x20-\x7e]/g, ".")}")`}`;
      }
    }
    if (pages) fs.writeFileSync(file, JSON.stringify(pages));
  }

  const row: any = { period: l.period, grain, url: l.url, usedUrl, status, bytes, flag: l.flag ?? null };
  if (!pages) {
    row.verdict = "UNREACHABLE";
    console.log(`  FAIL ${grain.padEnd(9)} ${l.period}  ${status}`);
    results.push(row);
    return;
  }

  row.pages = pages.length;
  const dt = documentContentTest(pages);
  row.contentTest = dt.ok ? "ok" : dt.reason;

  // ── WHAT PERIOD DOES THE DOCUMENT ITSELF CLAIM? ────────────────────────────────────────────────
  // Read every period label the L-1/L-2 pages carry, independent of the supplied label.
  const claimed = new Set<string>();
  for (const spec of [L1, L2, L3])
    for (const p of findFormPages(pages, spec)) {
      const st = readPageStatement(pages[p]);
      if (st) claimed.add(`${st.endDate}(${st.kind})`);
      for (const c of readColumnLabels(pages[p])) if (c.endDate) claimed.add(`${c.endDate}(${c.kind})`);
    }
  row.claimedPeriods = [...claimed].sort();
  row.matchesLabel = [...claimed].some((c) => c.startsWith(l.period));

  const u = resolveUnit(pages.join("\n"));
  row.unit = u.ok ? u.unit : `REFUSED:${u.reason}`;

  const role = grain === "annual" ? "ytd_current" : "quarter_current";
  const cells: Record<string, number> = {};
  const refusals: string[] = [];
  for (const spec of [L1, L2]) {
    const ex = extractForm(pages, spec, role as any, l.period, { q1Equivalent: l.period.endsWith("-06-30") });
    for (const [k, v] of ex.fields) cells[k] = v.value;
    for (const x of ex.refusals) refusals.push(`${spec.id}:${x.field ?? "(page)"}:${x.reason}`);
  }
  row.fields = Object.keys(cells).length;
  row.cells = cells;
  row.refusals = refusals.slice(0, 5);
  row.verdict = row.fields > 0 ? "USABLE" : "NO FIELDS";

  const mark = row.fields > 0 ? "OK  " : "----";
  console.log(`  ${mark} ${grain.padEnd(9)} ${l.period}  ${String(pages.length).padStart(4)}p  unit=${String(row.unit).padEnd(9)}` +
    ` fields=${String(row.fields).padStart(2)}  claims[${row.claimedPeriods.slice(0, 3).join(" ") || "none"}]` +
    `${row.matchesLabel ? "" : "  ⚠ LABEL NOT FOUND IN DOC"}`);
  if (row.fields === 0 && refusals.length) console.log(`       first refusals: ${refusals.slice(0, 3).join(" | ").slice(0, 150)}`);
  results.push(row);
}

console.log(`\n=== STAGE 7e — checking supplied SBILIFE links (read-only) ===\n`);
console.log(`-- ANNUAL --`);
for (const l of links.annual) await check(l, "annual");
console.log(`\n-- QUARTERLY --`);
for (const l of links.quarterly) await check(l, "quarterly");

fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
const usable = results.filter((r) => r.verdict === "USABLE");
const mislabelled = results.filter((r) => r.pages && !r.matchesLabel);
console.log(`\n  usable ${usable.length}/${results.length}`);
console.log(`  unreachable ${results.filter((r) => r.verdict === "UNREACHABLE").length}`);
console.log(`  no fields   ${results.filter((r) => r.verdict === "NO FIELDS").length}`);
if (mislabelled.length) {
  console.log(`  ⚠ label not found in document: ${mislabelled.length}`);
  for (const m of mislabelled) console.log(`      ${m.grain} ${m.period} claims [${(m.claimedPeriods ?? []).slice(0, 4).join(" ")}]`);
}
console.log(`\n  detail -> ${OUT}\n`);
