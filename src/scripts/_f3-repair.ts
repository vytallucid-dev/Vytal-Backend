// ═══════════════════════════════════════════════════════════════
// F3 — THE FIVE REMAINING MISLABELS. Plan by default; --commit to write.
//   npx tsx src/scripts/_f3-repair.ts [--stock SYM] [--commit]
//
// CANBK · IOB · CEMPRO · POWERINDIA · DELHIVERY
// (IOB was NOT in the original list of four — it carries the identical CANBK defect
//  and was surfaced independently by the C1a screen and the corpus re-derivation.)
//
// ⚠ F2 CHANGED WHAT THE DERIVER PRODUCES, AND THAT IS THE POINT OF RE-SCREENING.
//   All five mislabels are rows where the deriver now REFUSES: their documents
//   declare an impossible fiscal year, which is exactly why the labels are wrong.
//   So "re-derive from the document" cannot repair them — the document is the
//   problem. A second rule is needed, and it must be argued rather than assumed.
//
// THE TWO-RULE REPAIR, in strict precedence:
//   1. DOCUMENT — where deriveFiscalPeriod succeeds, its answer wins. This
//      preserves every currently-correct label by construction, including the
//      genuine non-March calendars (a September or June filer keeps its own).
//   2. CONVENTION — where the deriver REFUSES, fall back to the Apr–Mar convention
//      applied to the row's own report_date.
//
//   ⚠ RULE 2 IS GATED ON A PRECONDITION THAT IS ASSERTED PER STOCK, NOT ASSUMED:
//      every readable document this stock has ever filed must declare a MARCH
//      fiscal-year end. If a stock has ever declared September/June/December, the
//      Apr–Mar convention is not its calendar and the fallback is refused — the row
//      is left alone and reported. This is the guard that stops this tool from doing
//      to SIEMENS what S4.3 was built to undo.
//
// Per stock, one transaction: FOR UPDATE · resolve on (report_date, resultType) ·
// v3 wins · assert |inserted| == |distinct (report_date,resultType)| · assert no
// real quarter present before is absent after · fence by ID after commit.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

const DIR = process.env.R1_DIR ?? ".";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const ONLY = arg("--stock");
const COMMIT = process.argv.includes("--commit");
const TARGETS = ONLY ? [ONLY] : ["CANBK", "IOB", "CEMPRO", "POWERINDIA", "DELHIVERY"];

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const rdOf = (d: Date) => d.toISOString().slice(0, 10);
const isV3 = (src: string) => !String(src).includes("_legacy");
const grab = (xml: string, tag: string) => {
  for (const ns of ["in-capmkt", "in-bse-fin"]) {
    const m = new RegExp(`<${ns}:${tag}\\b[^>]*>([^<]*)</${ns}:${tag}>`, "i").exec(xml);
    if (m) { const s = m[1].trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  }
  return null;
};
/** The Apr–Mar convention on a period's own end date — what (fiscalYear, quarter)
 *  MEANS to loadMomentumStandalone's ordering and to consecutiveTail. */
const convention = (pe: Date) => {
  const m = pe.getUTCMonth() + 1, y = pe.getUTCFullYear();
  const q = m <= 3 ? 4 : m <= 6 ? 1 : m <= 9 ? 2 : 3;
  return { fiscalYear: `FY${String(m <= 3 ? y : y + 1).slice(-2)}`, quarter: `Q${q}` };
};

interface Plan { row: any; newFy: string; newQ: string; via: "document" | "convention" | "stored"; changed: boolean }

async function repairOne(sym: string, summary: any[]): Promise<void> {
  const [st] = await raw(`SELECT "id","industryType"::text it,"fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, sym);
  if (!st) { console.log(`  ✗ unknown stock ${sym}`); return; }
  const banking = st.it === "banking";
  const table = banking ? "banking_quarterly_results" : "quarterly_results";
  const model: any = banking ? prisma.bankingQuarterlyResult : prisma.quarterlyResult;

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F3 · ${pad(sym, 12)} · ${pad(st.it, 14)} · ${pad(table, 26)}${COMMIT ? "⚠ COMMIT" : "PLAN   "} ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const rows = await model.findMany({ where: { stockId: st.id }, orderBy: { reportDate: "asc" } });
  console.log(`  rows held: ${rows.length}  (SA ${rows.filter((r: any) => r.resultType === "standalone").length} · CO ${rows.filter((r: any) => r.resultType === "consolidated").length})`);

  // ── read every document once, and derive ──────────────────────────────
  const cache = new Map<string, string | null>();
  const acceptedMonths = new Set<number>();   // fyEnd months of documents the deriver ACCEPTS
  const refusedMonths = new Set<number>();    // fyEnd months of documents it REFUSES
  const MN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  interface Raw { r: any; fyEndMonth: number | null; derived: { fiscalYear: string; quarter: string } | null }
  const rawPlan: Raw[] = [];
  for (const r of rows) {
    let xml: string | null = null;
    if (r.xbrlUrl) {
      if (!cache.has(r.xbrlUrl)) {
        try { cache.set(r.xbrlUrl, await fetchXbrlFile(r.xbrlUrl)); } catch { cache.set(r.xbrlUrl, null); }
        await sleep(200);
      }
      xml = cache.get(r.xbrlUrl) ?? null;
    }
    let fyEndMonth: number | null = null;
    let derived: { fiscalYear: string; quarter: string } | null = null;
    if (xml) {
      const s = grab(xml, "DateOfStartOfFinancialYear"), e = grab(xml, "DateOfEndOfFinancialYear");
      const pe = grab(xml, "DateOfEndOfReportingPeriod") ?? rdOf(r.reportDate);
      if (e) fyEndMonth = +e.slice(5, 7);
      if (s && e) {
        try { derived = deriveFiscalPeriod(D(pe), D(s), D(e), "quarterly"); } catch { derived = null; }
      }
    }
    if (fyEndMonth !== null) (derived ? acceptedMonths : refusedMonths).add(fyEndMonth);
    rawPlan.push({ r, fyEndMonth, derived });
  }
  const refused = rawPlan.filter((p) => p.fyEndMonth !== null && !p.derived).length;

  // ── ★ WHICH CALENDAR APPLIES WHEN THE DOCUMENT IS REFUSED ──────────────
  //
  // A refused document has told us its fiscal year is impossible. Something must
  // still decide the label, and guessing is what F2c refused to do — so the fallback
  // is permitted ONLY on evidence, by one of two independent tests:
  //
  //   (a) THE DOCUMENT'S OWN YEAR-END IS MARCH. The window is impossible but the END
  //       — the half that actually sources the label — is credible. POWERINDIA's
  //       2021-03-31 row sits in a 15-month window ending 2022-03-31: only the START
  //       is wrong. CEMPRO, CANBK and IOB are the same shape.
  //
  //   (b) EVERY ACCEPTED DOCUMENT THIS STOCK HAS DECLARES MARCH. Then the stock is a
  //       March filer and the refused document's year-end is the thing that is not
  //       credible. DELHIVERY is exactly this: 34 of its 36 documents declare
  //       2022-04-01..2023-03-31 and its immediate neighbours either side of the gap
  //       are FY23Q1 and FY23Q3 — the September year-end exists in the two corrupt
  //       documents and nowhere else. It is a fabrication, not a calendar.
  //
  // ⚠ THE ACCEPTED/REFUSED SPLIT IS LOAD-BEARING. A first cut censused ALL declared
  //   year-ends and refused the fallback whenever a non-March one appeared. That let
  //   DELHIVERY's fabricated September VETO its own repair — the corrupt document
  //   voting on whether it should be trusted. Only ACCEPTED documents get a vote.
  //
  // ⚠ AND IT CANNOT REACH A GENUINE NON-MARCH FILER. The fallback engages only on a
  //   REFUSED document, and SIEMENS (Sep), GILLETTE (Jun) and ENRIN (Sep) have none —
  //   their windows all pass the F2 guard. There is no path from here to relabelling
  //   a real September or June calendar onto Apr–Mar.
  const acceptedAllMarch = acceptedMonths.size > 0 && [...acceptedMonths].every((m) => m === 3);
  const fmt = (s: Set<number>) => [...s].sort((a, b) => a - b).map((m) => MN[m]).join(", ") || "(none)";
  console.log(`  fyEnd months declared by ACCEPTED documents : ${fmt(acceptedMonths)}`);
  console.log(`  fyEnd months declared by REFUSED documents  : ${fmt(refusedMonths)}`);
  console.log(`  documents where the deriver REFUSES        : ${refused}`);
  console.log(`  ⇒ test (b) "every accepted document says March": ${acceptedAllMarch ? "✓ PASSES" : "✗ fails"}`);

  // ⚠ UNREADABLE ≠ REFUSED, AND CONFLATING THEM IS A SILENT GUESS.
  //   A document we could not fetch has told us NOTHING. A document the deriver
  //   refused has told us its own fiscal year is impossible. Only the second is
  //   evidence, and only the second may reach the convention fallback. A first cut
  //   routed both down the same path: on DELHIVERY that fired the fallback on five
  //   2025–26 rows whose windows are ordinary 12-month Apr–Mar ones, purely because
  //   the fetch failed. It produced identical labels and so changed nothing — which
  //   is exactly how this class of thing survives. An unreadable document keeps the
  //   stored label and is COUNTED, so "we could not check" never reads as "we checked".
  const plan: Plan[] = [];
  let unreadable = 0;
  for (const { r, fyEndMonth, derived } of rawPlan) {
    let newFy = r.fiscalYear, newQ = r.quarter, via: Plan["via"] = "stored";
    if (derived) {
      newFy = derived.fiscalYear; newQ = derived.quarter; via = "document";
    } else if (fyEndMonth === null) {
      unreadable++;                                   // no evidence → keep stored, say so
    } else if (fyEndMonth === 3 || acceptedAllMarch) {
      const c = convention(r.reportDate);
      newFy = c.fiscalYear; newQ = c.quarter; via = "convention";
    }
    plan.push({ row: r, newFy, newQ, via, changed: newFy !== r.fiscalYear || newQ !== r.quarter });
  }
  console.log(`  documents UNREADABLE (fetch failed) — stored label kept, no fallback: ${unreadable}`);
  for (const p of plan.filter((x) => x.via === "convention"))
    console.log(`     fallback used for ${rdOf(p.row.reportDate)}/${p.row.resultType} — via test ${(rawPlan.find((z) => z.r.id === p.row.id)!.fyEndMonth === 3) ? "(a) document year-end is March" : "(b) stock is a March-only filer"}`);

  // ── resolve on (report_date, resultType); v3 wins ──────────────────────
  const byQuarter = new Map<string, Plan[]>();
  for (const p of plan) {
    const k = `${rdOf(p.row.reportDate)}|${p.row.resultType}`;
    if (!byQuarter.has(k)) byQuarter.set(k, []);
    byQuarter.get(k)!.push(p);
  }
  const keep: Plan[] = [], drop: Plan[] = [];
  for (const [, group] of byQuarter) {
    if (group.length === 1) { keep.push(group[0]); continue; }
    const v3 = group.filter((g) => isV3(g.row.source));
    const pool = v3.length ? v3 : group;
    const winner = pool.slice().sort((a, b) => b.row.updatedAt.getTime() - a.row.updatedAt.getTime())[0];
    keep.push(winner);
    for (const g of group) if (g !== winner) drop.push(g);
  }

  // ── F3c · SHOW THE ROW SETS ───────────────────────────────────────────
  console.log(`\n  ── DELETE LIST (${drop.length}) — a duplicate of a quarter already represented ──`);
  if (!drop.length) console.log(`  (none)`);
  for (const d of drop.sort((a, b) => rdOf(a.row.reportDate).localeCompare(rdOf(b.row.reportDate))))
    console.log(`  ${pad(rdOf(d.row.reportDate), 13)}${pad(d.row.resultType, 14)}${pad(d.row.fiscalYear + d.row.quarter, 8)}${pad(d.row.source, 30)}${d.row.updatedAt.toISOString().slice(0, 19)}`);

  const relabels = keep.filter((k) => k.changed);
  console.log(`\n  ── INSERT LIST · the rows whose LABEL CHANGES (${relabels.length}) ──`);
  if (!relabels.length) console.log(`  (none — nothing to repair)`);
  console.log(`  ${pad("report_date", 13)}${pad("basis", 14)}${pad("old", 8)}→ ${pad("new", 9)}${pad("via", 12)}${pad("source", 30)}`);
  for (const k of relabels.sort((a, b) => rdOf(a.row.reportDate).localeCompare(rdOf(b.row.reportDate))))
    console.log(`  ${pad(rdOf(k.row.reportDate), 13)}${pad(k.row.resultType, 14)}${pad(k.row.fiscalYear + k.row.quarter, 8)}→ ${pad(k.newFy + k.newQ, 9)}${pad(k.via, 12)}${pad(k.row.source, 30)}`);
  console.log(`  (the other ${keep.length - relabels.length} kept rows re-derive to exactly their stored label — unchanged)`);

  // ── assertions BEFORE any write ───────────────────────────────────────
  const newKeys = new Map<string, number>();
  for (const k of keep) { const key = `${k.newFy}${k.newQ}|${k.row.resultType}`; newKeys.set(key, (newKeys.get(key) ?? 0) + 1); }
  const clash = [...newKeys.entries()].filter(([, n]) => n > 1);
  console.log(`\n  ── ARITHMETIC ──`);
  console.log(`  total ${lp(rows.length, 3)} → ${lp(keep.length, 3)}   relabelled ${relabels.length} · unchanged ${keep.length - relabels.length} · dropped ${drop.length}`);
  console.log(`  distinct real quarters (report_date, basis): ${byQuarter.size}  ${byQuarter.size === keep.length ? "✓ one row each" : "⚠ MISMATCH"}`);
  console.log(`  target (label, basis) keys unique          : ${clash.length === 0 ? "✓ yes — no unique-key collision" : "⚠ " + clash.map(([k, n]) => `${k}×${n}`).join(", ")}`);

  summary.push({ sym, table, before: rows.length, after: keep.length, relabels: relabels.length, dropped: drop.length,
    changes: relabels.map((k) => ({ rd: rdOf(k.row.reportDate), basis: k.row.resultType, from: k.row.fiscalYear + k.row.quarter, to: k.newFy + k.newQ, via: k.via })) });

  if (clash.length || byQuarter.size !== keep.length) { console.log(`\n  ✗ PLAN UNSAFE — not committing.`); return; }
  if (!relabels.length && !drop.length) { console.log(`\n  (nothing to do)`); return; }
  if (!COMMIT) { console.log(`\n  (plan only — nothing written)`); return; }

  // ── THE TRANSACTION ───────────────────────────────────────────────────
  const quartersBefore = new Set([...byQuarter.keys()]);
  await prisma.$transaction(async (tx) => {
    const txModel: any = banking ? tx.bankingQuarterlyResult : tx.quarterlyResult;
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "stock_id"=$1 FOR UPDATE`, st.id);
    const del = await txModel.deleteMany({ where: { stockId: st.id } });
    const data = keep.map((k) => ({ ...k.row, fiscalYear: k.newFy, quarter: k.newQ }));
    const ins = await txModel.createMany({ data: data as any });
    console.log(`\n  deleted ${del.count} · inserted ${ins.count}`);
    if (ins.count !== keep.length) throw new Error(`inserted ${ins.count} != planned ${keep.length} — ROLLBACK`);
    const after = await txModel.findMany({ where: { stockId: st.id }, select: { reportDate: true, resultType: true, fiscalYear: true, quarter: true } });
    const qAfter = new Set(after.map((a: any) => `${rdOf(a.reportDate)}|${a.resultType}`));
    if (qAfter.size !== after.length) throw new Error(`after: ${after.length} rows but ${qAfter.size} distinct quarters — ROLLBACK`);
    const lost = [...quartersBefore].filter((q) => !qAfter.has(q));
    if (lost.length) throw new Error(`REAL QUARTERS LOST: ${lost.join(", ")} — ROLLBACK`);
    console.log(`  ✓ assertions: ${after.length} rows · ${qAfter.size} distinct quarters · 0 lost`);
  });
  console.log(`  ✓ COMMITTED`);
}

async function fenceById(): Promise<void> {
  const base = JSON.parse(readFileSync(`${DIR}/_r1d-v3-before.json`, "utf8"));
  const ids = (base.rows as any[]).map((r) => r.id);
  const byId = new Map((base.rows as any[]).map((r) => [r.id, r]));
  const TBL = ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"];
  let breaches = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    for (const t of TBL)
      for (const r of await raw(`SELECT "id","source" src,"report_date"::text rd FROM "${t}" WHERE "id"=ANY($1::text[])`, slice)) {
        const b: any = byId.get(r.id);
        if (String(r.src) !== String(b.src) || String(r.rd).slice(0, 10) !== String(b.rd).slice(0, 10)) {
          breaches++; console.log(`      ⚠ ${b.sym} ${b.period} ${b.basis}: ${b.src}@${String(b.rd).slice(0, 10)} → ${r.src}@${String(r.rd).slice(0, 10)}`);
        }
      }
  }
  const present = new Set<string>();
  for (const t of TBL) for (const r of await raw(`SELECT "id" FROM "${t}" WHERE "id"=ANY($1::text[])`, ids)) present.add(r.id);
  const vanished = ids.filter((i) => !present.has(i));
  console.log(`\n  FENCE BY ID over ${ids.length} v3 rows: ${breaches} moved · ${vanished.length} vanished  ${breaches === 0 && vanished.length === 0 ? "✓ CLEAN" : "⚠ BREACH"}`);
  for (const v of vanished.slice(0, 10)) { const b: any = byId.get(v); console.log(`      ⚠ VANISHED ${b.sym} ${b.t} ${b.period} ${b.basis}`); }
}

async function main() {
  const summary: any[] = [];
  for (const s of TARGETS) await repairOne(s, summary);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F3 SUMMARY                                                                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("stock", 13)}${pad("table", 28)}${lp("before", 8)}${lp("after", 7)}${lp("relabel", 9)}${lp("drop", 6)}`);
  for (const s of summary) console.log(`  ${pad(s.sym, 13)}${pad(s.table, 28)}${lp(s.before, 8)}${lp(s.after, 7)}${lp(s.relabels, 9)}${lp(s.dropped, 6)}`);
  if (COMMIT) await fenceById();
  writeFileSync(`${DIR}/_f3-repair${COMMIT ? "-committed" : "-plan"}.json`, JSON.stringify(summary, null, 1));
  console.log(`\n  → ${DIR}/_f3-repair${COMMIT ? "-committed" : "-plan"}.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", (e as Error).message); await prisma.$disconnect(); process.exit(1); });
