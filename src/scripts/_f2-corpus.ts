// ═══════════════════════════════════════════════════════════════
// F2 — BUILD THE DECLARED-WINDOW CORPUS. READ-ONLY (network + DB reads).
//   npx tsx src/scripts/_f2-corpus.ts
//
// ⚠ THE DECLARED WINDOW IS NOT STORED ANYWHERE. quarterly_results keeps
//   (report_date, quarter, fiscal_year) but never DateOfStartOfFinancialYear.
//   The S4.3 deriver reconstructs the year BACKWARDS from fyEnd and deliberately
//   never consults fyStart — which is exactly why an impossible fyStart has been
//   invisible. So the declared fyEnd IS recoverable from stored data
//   (fyEndMonth ≡ reportMonth − 3·Q mod 12), but fyStart is NOT. Measuring the
//   distribution of window LENGTHS therefore requires the documents themselves.
//
// This builds a compact, RESUMABLE corpus — four dates per filing, not the XML —
// so F2a (the histogram), F2b (the rule) and F2d (the exhaustive regression proof)
// all read the same measured facts instead of re-fetching 23,640 documents each.
//
// Output: _f2-corpus.jsonl, one JSON object per xbrl_url, appended as it goes.
// Re-running skips every URL already in the file.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import https from "node:https";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const OUT = `${DIR}/_f2-corpus.jsonl`;
const CONC = Number(process.env.F2_CONC ?? 6);
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const TABLES: Array<{ t: string; kind: "quarterly" | "annual" }> = [
  { t: "quarterly_results", kind: "quarterly" },
  { t: "banking_quarterly_results", kind: "quarterly" },
  { t: "nbfc_quarterly_results", kind: "quarterly" },
  { t: "life_insurance_quarterly_results", kind: "quarterly" },
  { t: "general_insurance_quarterly_results", kind: "quarterly" },
  { t: "fundamentals", kind: "annual" },
  { t: "banking_fundamentals", kind: "annual" },
  { t: "nbfc_fundamentals", kind: "annual" },
  { t: "life_insurance_fundamentals", kind: "annual" },
  { t: "general_insurance_fundamentals", kind: "annual" },
];

const XBRL_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/xml,text/xml,*/*;q=0.9",
  Referer: "https://www.nseindia.com/",
};

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: XBRL_HEADERS, agent: new https.Agent({ keepAlive: false, maxSockets: 1 }) }, (res) => {
      if (!res.statusCode || res.statusCode >= 400) { res.resume(); req.destroy(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => { req.destroy(); resolve(Buffer.concat(chunks).toString("utf-8")); });
      res.on("error", (e) => { req.destroy(); reject(e); });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
  });
}

/** Same shape as xbrl/extract.ts `extractString`, but tolerant of BOTH namespace
 *  prefixes seen in the corpus (v3 SEBI `in-capmkt`, legacy BSE `in-bse-fin`). */
function grab(xml: string, tag: string, ctx: string): { v: string | null; ns: string | null } {
  for (const ns of ["in-capmkt", "in-bse-fin"]) {
    const re = new RegExp(`<${ns}:${tag}\\s+[^>]*contextRef="${ctx}"[^>]*>([\\s\\S]*?)</${ns}:${tag}>`, "i");
    const m = re.exec(xml);
    if (m) {
      const s = m[1].trim();
      return { v: /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null, ns };
    }
  }
  return { v: null, ns: null };
}

async function main() {
  // ── the work list: every distinct xbrl_url with the row facts that describe it
  const parts = TABLES.map(({ t, kind }) =>
    `SELECT "xbrl_url" u, '${t}' tbl, '${kind}' kind, "stock_id" sid, "fiscal_year" fy,
            ${kind === "quarterly" ? `"quarter"` : `'Y'`} q, "result_type" rt,
            ${kind === "quarterly" ? `"report_date"::text` : `NULL::text`} rd, "source" src
       FROM "${t}"`).join(" UNION ALL ");
  const rows = await raw(`SELECT x.*, s."symbol" sym, s."industryType"::text ind FROM (${parts}) x JOIN stocks s ON s."id"=x.sid`);

  // one entry per URL; a URL can back BOTH an annual and a Q4 quarterly row
  const byUrl = new Map<string, any[]>();
  for (const r of rows) {
    if (!r.u || !String(r.u).startsWith("http")) continue;
    if (!byUrl.has(r.u)) byUrl.set(r.u, []);
    byUrl.get(r.u)!.push(r);
  }

  const done = new Set<string>();
  if (existsSync(OUT)) {
    for (const line of readFileSync(OUT, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).u); } catch { /* partial last line */ }
    }
  }
  const todo = [...byUrl.keys()].filter((u) => !done.has(u));
  console.log(`corpus: ${byUrl.size} distinct xbrl_url · ${done.size} already captured · ${todo.length} to fetch · conc=${CONC}`);

  let ok = 0, fail = 0, i = 0;
  const t0 = Date.now();
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= todo.length) return;
      const url = todo[idx];
      const meta = byUrl.get(url)!;
      const base = {
        u: url,
        sym: meta[0].sym, ind: meta[0].ind, src: meta[0].src,
        rows: meta.map((m: any) => ({ tbl: m.tbl, fy: m.fy, q: m.q, rt: m.rt, rd: m.rd ? String(m.rd).slice(0, 10) : null })),
      };
      try {
        const xml = await fetchText(url);
        const fys = grab(xml, "DateOfStartOfFinancialYear", "OneD");
        const fye = grab(xml, "DateOfEndOfFinancialYear", "OneD");
        const rs1 = grab(xml, "DateOfStartOfReportingPeriod", "OneD");
        const re1 = grab(xml, "DateOfEndOfReportingPeriod", "OneD");
        const rs4 = grab(xml, "DateOfStartOfReportingPeriod", "FourD");
        const re4 = grab(xml, "DateOfEndOfReportingPeriod", "FourD");
        appendFileSync(OUT, JSON.stringify({ ...base, ns: fye.ns, fys: fys.v, fye: fye.v, rs1: rs1.v, re1: re1.v, rs4: rs4.v, re4: re4.v }) + "\n");
        ok++;
      } catch (e) {
        appendFileSync(OUT, JSON.stringify({ ...base, err: (e as Error).message.slice(0, 80) }) + "\n");
        fail++;
      }
      const n = ok + fail;
      if (n % 100 === 0) {
        const rate = n / ((Date.now() - t0) / 1000);
        const left = Math.round((todo.length - n) / Math.max(rate, 0.01));
        process.stdout.write(`\r  ${n}/${todo.length}  ok=${ok} fail=${fail}  ${rate.toFixed(1)}/s  eta ${Math.floor(left / 60)}m${String(left % 60).padStart(2, "0")}s   `);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`\ndone: ok=${ok} fail=${fail} → ${OUT}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
