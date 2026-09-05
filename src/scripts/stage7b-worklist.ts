// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7b — BUILD THE FETCH WORKLIST.  Read-only: DB reads + the on-disk index.
//
//   npx tsx src/scripts/stage7b-worklist.ts
//
// The index holds 2,013 in-target documents. Fetching all of them at the 5.2s
// courtesy spacing is ~3 hours of somebody else's bandwidth to re-derive rows we
// already hold. So demand is computed FIRST and only unserved units are fetched.
//
// ── DEMAND IS BOUNDED BY LISTING, NOT BY THE TARGET DATE ─────────────────────
// GODIGIT listed 2024-05 and CANHLIFE 2025-10. Demanding FY2019 of either would
// manufacture ~20 permanent "gaps" that no source can ever fill and that every
// completeness report would then carry forever. Same rule the rest of the
// universe uses: demand starts at the later of the target and the listing.
//
// ── ONE UNIT CAN NEED SEVERAL PDFs ───────────────────────────────────────────
// ICICIPRULI and HDFCLIFE publish one BUNDLE per quarter containing every form.
// GODIGIT publishes one FILE PER FORM (nl-1.pdf, nl-2.pdf, nl-3.pdf …). A
// worklist keyed one-URL-per-unit silently drops two thirds of GODIGIT's fields,
// so a unit carries a LIST of URLs and the runner extracts across all of them.
// ═══════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { fyq as fyqShared, fyLabel } from "./fy-label.js";

const INDEX = "_s7b-index.json";
const OUT = "_s7b-worklist.json";
const TARGET = "2019-03-31";
/** The newest period any of these sites publishes. Beyond it there is nothing to want. */
const HORIZON = "2026-06-30";

type Grain = "quarterly" | "annual";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** Quarter ends, ascending, inclusive. */
function quarterEnds(from: string, to: string): string[] {
  const out: string[] = [];
  const ENDS = ["-03-31", "-06-30", "-09-30", "-12-31"];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++)
    for (const e of ENDS) { const d = `${y}${e}`; if (d >= from && d <= to) out.push(d); }
  return out.sort();
}
/** Indian FY: the year the fiscal year ENDS. FY2026 = Apr-2025..Mar-2026. */
const fyOf = (p: string): { fy: string; q: string | null } => fyqShared(p);

// ── WHICH OF A UNIT'S FILES ARE ACTUALLY WANTED ──────────────────────────────
// ICICIPRULI's older quarters publish ONE FILE PER FORM: L1_Consolidated.pdf …
// L44_Consolidated.pdf. Only L-1/L-2/L-3 (life) and NL-1/NL-2/NL-3 (general)
// carry the columns these tables hold, so 44 fetches become 3.
//
// ⚠ THE MATCH MUST BE ANCHORED AND MUST NOT SWALLOW THE NEXT DIGIT. A substring
//   test for "L1" also matches L10, L11, L12, L13 and L14 — five extra fetches
//   per unit whose forms would then refuse to parse. `(?![0-9])` is the whole
//   defence, and `_` cannot be used as the boundary because \b treats it as a
//   word character, so `L1_Consolidated` would not terminate.
const FORM_CODE = /^(n?l)[\s._-]*0*(\d{1,2})(?![0-9])/i;
export function wantedCode(filename: string, fam: "life" | "general"): number | null {
  const base = decodeURIComponent(filename).replace(/\.pdf$/i, "").trim();
  const m = FORM_CODE.exec(base);
  if (!m) return null;
  const isGeneral = m[1].toLowerCase() === "nl";
  if (isGeneral !== (fam === "general")) return null; // L-2 is not NL-2
  const n = Number(m[2]);
  return n >= 1 && n <= 3 ? n : null;
}
/**
 * A unit is either a BUNDLE (one PDF holding every form — no code in the name)
 * or a PER-FORM set. Told apart by whether ANY candidate names a form at all;
 * a bundle is kept whole because its filename cannot say what is inside.
 */
export function selectUrls(urls: string[], fam: "life" | "general"): { urls: string[]; mode: string } {
  const coded = urls.filter((u) => FORM_CODE.test(decodeURIComponent(u.split("/").pop() ?? "")));
  if (coded.length === 0) return { urls, mode: "bundle" };
  const want = urls.filter((u) => wantedCode(u.split("/").pop() ?? "", fam) !== null);
  return want.length ? { urls: want, mode: "per-form" } : { urls: [], mode: "per-form-none" };
}

interface Unit {
  sym: string; fam: "life" | "general"; grain: Grain; basis: string;
  target: string; fy: string; q: string | null; mode: string; urls: string[]; labels: string[];
}

async function main(): Promise<void> {
  const idx = JSON.parse(fs.readFileSync(INDEX, "utf8"));
  const docs: any[] = idx.results.flatMap((r: any) => r.docs);

  const meta = await raw(`
    SELECT s.symbol, s.id, s."industryType"::text ind,
           (SELECT min(date)::date::text FROM daily_prices p WHERE p.stock_id = s.id) firstpx
      FROM stocks s
     WHERE s."industryType"::text IN ('life_insurance','general_insurance')`);
  const bySym = new Map(meta.map((m) => [m.symbol, m]));

  // held, per (symbol, grain, result_type)
  const held = new Set<string>();
  const H = [
    ["life_insurance_quarterly_results", "quarterly"],
    ["life_insurance_fundamentals", "annual"],
    ["general_insurance_quarterly_results", "quarterly"],
    ["general_insurance_fundamentals", "annual"],
  ] as const;
  for (const [tbl, grain] of H)
    for (const r of await raw(
      `SELECT s.symbol, t.result_type::text rt, t.report_date::date::text d
         FROM "${tbl}" t JOIN stocks s ON s.id = t.stock_id`))
      held.add(`${r.symbol}|${grain}|${r.rt}|${r.d}`);

  const units: Unit[] = [];
  const perSym: Record<string, any> = {};

  for (const sym of [...new Set(docs.map((d) => d.symbol))].sort()) {
    const m = bySym.get(sym);
    if (!m) { console.log(`  ${sym}: not an insurance stock in DB — skipped`); continue; }
    const fam: "life" | "general" = m.ind === "life_insurance" ? "life" : "general";

    // ⚠ the listing floor. Demand cannot begin before the company existed on the market.
    const floor = m.firstpx && m.firstpx > TARGET ? quarterEnds(m.firstpx, HORIZON)[0] : TARGET;
    const wantQ = quarterEnds(floor, HORIZON);
    const wantA = wantQ.filter((d) => d.endsWith("-03-31"));

    // which bases this site actually publishes — never demand one it does not
    const bases = [...new Set(docs.filter((d) => d.symbol === sym).map((d) => d.basis))];

    const rows: any[] = [];
    for (const basis of bases) {
      for (const [grain, want] of [["quarterly", wantQ], ["annual", wantA]] as [Grain, string[]][]) {
        for (const target of want) {
          if (held.has(`${sym}|${grain}|${basis}|${target}`)) continue;
          const cand = docs.filter(
            (d) => d.symbol === sym && d.grain === grain && d.basis === basis && d.periodEnd === target);
          const { fy, q } = fyOf(target);
          rows.push({ target, grain, basis, n: cand.length });
          if (!cand.length) continue;
          const sel = selectUrls(cand.map((c) => c.url), fam);
          if (!sel.urls.length) { rows[rows.length - 1].n = 0; continue; }
          units.push({ sym, fam, grain, basis, target, fy, q: grain === "annual" ? null : q,
            mode: sel.mode, urls: sel.urls, labels: cand.map((c) => c.label).slice(0, 4) });
        }
      }
    }
    const servable = rows.filter((r) => r.n > 0);
    perSym[sym] = { fam, listing: m.firstpx, floor, bases,
      unserved: rows.length, servable: servable.length, noDoc: rows.length - servable.length };
    console.log(`  ${sym.padEnd(12)} ${fam.padEnd(8)} listed ${m.firstpx}  floor ${floor}  bases[${bases.join(",")}]`);
    console.log(`     unserved units ${String(rows.length).padStart(3)}   the index can serve ${String(servable.length).padStart(3)}` +
      `   no document ${rows.length - servable.length}`);
    const noDoc = rows.filter((r) => r.n === 0);
    if (noDoc.length) console.log(`     no doc: ${noDoc.slice(0, 8).map((r) => `${r.target}/${r.grain[0]}/${r.basis[0]}`).join(" ")}${noDoc.length > 8 ? " …" : ""}`);
  }

  const pdfs = new Set(units.flatMap((u) => u.urls));
  console.log(`\n  -- WORKLIST --`);
  console.log(`  units          ${units.length}`);
  console.log(`  distinct PDFs  ${pdfs.size}   (index held ${docs.filter((d) => d.periodEnd >= TARGET).length} in-target)`);
  console.log(`  multi-PDF units ${units.filter((u) => u.urls.length > 1).length}  ` +
    `max PDFs in one unit ${Math.max(0, ...units.map((u) => u.urls.length))}`);
  const est = (pdfs.size * 5.2) / 60;
  console.log(`  fetch estimate ${est.toFixed(0)} min at the 5.2s courtesy spacing`);
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), target: TARGET, perSym, units }, null, 2));
  console.log(`\n  worklist -> ${OUT}\n`);
  await prisma.$disconnect();
}
if (process.argv[1]?.includes("stage7b-worklist")) main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
