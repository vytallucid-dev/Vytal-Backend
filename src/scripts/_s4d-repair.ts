// ═══════════════════════════════════════════════════════════════
// STAGE 4d — THE RELABEL REPAIR. Plan by default; --commit to write.
//   npx tsx src/scripts/_s4d-repair.ts --stock SIEMENS [--commit]
//
// One stock, one transaction:
//   1. SELECT … FOR UPDATE the stock's whole quarterly row set (blocks a
//      concurrent writer — not optional)
//   2. derive each row's CORRECT label from its own document's declared window
//   3. resolve on (report_date, resultType) — the REAL QUARTER, which is the
//      identity that must survive. Where two rows describe the same quarter,
//      ⚠ v3 WINS: the collision is an artefact of the key, not two claims about
//      one fact, and the v2 adapter nulls 9 of 13 banking columns while legacy
//      carries no balance sheet pre-2022-11-25.
//   4. DELETE all, INSERT all — ids PRESERVED so the fence-by-id test still
//      tracks the same rows
//   5. ASSERT |inserted| == |distinct (report_date, resultType)| and that no real
//      quarter present before is absent after. Anything else → ROLLBACK.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

const DIR = process.env.R1_DIR ?? ".";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const STOCK = arg("--stock");
const COMMIT = process.argv.includes("--commit");
if (!STOCK) { console.error("need --stock"); process.exit(1); }

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const grab = (xml: string, tag: string) => {
  for (const ns of ["in-bse-fin", "in-capmkt"]) {
    const m = new RegExp(`<${ns}:${tag}\\b[^>]*>([^<]*)</${ns}:${tag}>`, "i").exec(xml);
    if (m) return m[1].trim();
  }
  return null;
};
const isV3 = (src: string) => !String(src).includes("_legacy");
const rdOf = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const [st] = await raw<any>(`SELECT "id","industryType"::text it FROM stocks WHERE "symbol"=$1`, STOCK);
  if (!st) { console.error(`unknown stock ${STOCK}`); process.exit(1); }
  if (st.it === "banking") { console.error(`${STOCK} is banking — this tool targets quarterly_results only`); process.exit(1); }

  // window guard
  const [clk] = await raw<any>(`SELECT date_part('hour',now() AT TIME ZONE 'UTC')::int h, date_part('minute',now() AT TIME ZONE 'UTC')::int m`);
  const mins = Number(clk.h) * 60 + Number(clk.m);
  // Stage 4d ruling: the "outside 16:00 / outside the nightly window" constraint is LIFTED.
  // The ONE exception that stands: never transact concurrently with RETENTION_PRUNE (21:30 UTC),
  // an armed destructive delete — and these are delete-then-insert transactions.
  const bad = mins >= 21 * 60 + 25 && mins <= 21 * 60 + 55;
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4d REPAIR · ${pad(STOCK, 12)} · ${COMMIT ? "⚠ COMMIT MODE" : "PLAN ONLY (no write)"}                       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  UTC ${String(clk.h).padStart(2, "0")}:${String(clk.m).padStart(2, "0")} · RETENTION_PRUNE boundary ${bad ? "⚠ INSIDE 21:25–21:55" : `✓ clear (${21 * 60 + 30 - mins} min to 21:30)`}`);
  if (COMMIT && bad) { console.log(`  ✗ refusing to transact alongside RETENTION_PRUNE.`); await prisma.$disconnect(); process.exit(2); }

  const rows = await prisma.quarterlyResult.findMany({ where: { stockId: st.id }, orderBy: { reportDate: "asc" } });
  console.log(`  rows held: ${rows.length}  (SA ${rows.filter((r) => r.resultType === "standalone").length} · CO ${rows.filter((r) => r.resultType === "consolidated").length})`);

  // ── derive the correct label for each row, from its OWN document ──
  const plan: Array<{ row: any; newFy: string; newQ: string; changed: boolean; readable: boolean }> = [];
  const cache = new Map<string, string | null>();
  for (const r of rows) {
    let newFy = r.fiscalYear, newQ = r.quarter, readable = false;
    if (r.xbrlUrl) {
      if (!cache.has(r.xbrlUrl)) { try { cache.set(r.xbrlUrl, await fetchXbrlFile(r.xbrlUrl)); } catch { cache.set(r.xbrlUrl, null); } await sleep(220); }
      const xml = cache.get(r.xbrlUrl);
      if (xml) {
        const s = grab(xml, "DateOfStartOfFinancialYear"), e = grab(xml, "DateOfEndOfFinancialYear");
        const pe = grab(xml, "DateOfEndOfReportingPeriod") ?? rdOf(r.reportDate);
        if (s && e) { try { const x = deriveFiscalPeriod(D(pe), D(s), D(e), "quarterly"); newFy = x.fiscalYear; newQ = x.quarter; readable = true; } catch { /* keep stored */ } }
      }
    }
    plan.push({ row: r, newFy, newQ, changed: newFy !== r.fiscalYear || newQ !== r.quarter, readable });
  }

  // ── resolve on (report_date, resultType); v3 wins ──
  const byQuarter = new Map<string, typeof plan>();
  for (const p of plan) {
    const k = `${rdOf(p.row.reportDate)}|${p.row.resultType}`;
    if (!byQuarter.has(k)) byQuarter.set(k, []);
    byQuarter.get(k)!.push(p);
  }
  const keep: typeof plan = [], drop: typeof plan = [];
  for (const [, group] of byQuarter) {
    if (group.length === 1) { keep.push(group[0]); continue; }
    const v3 = group.filter((g) => isV3(g.row.source));
    const pool = v3.length ? v3 : group;
    const winner = pool.slice().sort((a, b) => b.row.updatedAt.getTime() - a.row.updatedAt.getTime())[0];
    keep.push(winner);
    for (const g of group) if (g !== winner) drop.push(g);
  }

  // ── the two lists, side by side ──
  console.log(`\n  ── DELETE LIST (${drop.length}) — duplicate rows for a quarter already represented ──`);
  console.log(`  ${pad("report_date", 13)}${pad("basis", 14)}${pad("label", 8)}${pad("source", 27)}${pad("updated_at", 21)}why`);
  for (const d of drop.sort((a, b) => rdOf(a.row.reportDate).localeCompare(rdOf(b.row.reportDate)))) {
    console.log(`  ${pad(rdOf(d.row.reportDate), 13)}${pad(d.row.resultType, 14)}${pad(d.row.fiscalYear + d.row.quarter, 8)}${pad(d.row.source, 27)}${pad(d.row.updatedAt.toISOString().slice(0, 19), 21)}duplicate of the same real quarter`);
  }
  const relabels = keep.filter((k) => k.changed);
  console.log(`\n  ── RELABEL LIST (${relabels.length}) — kept rows whose label changes ──`);
  console.log(`  ${pad("report_date", 13)}${pad("basis", 14)}${pad("old", 8)}→ ${pad("new", 8)}${pad("source", 27)}doc window read?`);
  for (const k of relabels.sort((a, b) => rdOf(a.row.reportDate).localeCompare(rdOf(b.row.reportDate)))) {
    console.log(`  ${pad(rdOf(k.row.reportDate), 13)}${pad(k.row.resultType, 14)}${pad(k.row.fiscalYear + k.row.quarter, 8)}→ ${pad(k.newFy + k.newQ, 8)}${pad(k.row.source, 27)}${k.readable ? "✓" : "⚠ kept stored"}`);
  }
  const unchanged = keep.length - relabels.length;
  console.log(`\n  ── ARITHMETIC ──`);
  const saBefore = rows.filter((r) => r.resultType === "standalone").length;
  const coBefore = rows.filter((r) => r.resultType === "consolidated").length;
  const saAfter = keep.filter((k) => k.row.resultType === "standalone").length;
  const coAfter = keep.filter((k) => k.row.resultType === "consolidated").length;
  console.log(`  standalone   ${lp(saBefore, 3)} → ${lp(saAfter, 3)}   (${saBefore - saAfter} duplicate(s) dropped)`);
  console.log(`  consolidated ${lp(coBefore, 3)} → ${lp(coAfter, 3)}   (${coBefore - coAfter} duplicate(s) dropped)`);
  console.log(`  total        ${lp(rows.length, 3)} → ${lp(keep.length, 3)}   · relabelled ${relabels.length} · unchanged ${unchanged}`);
  console.log(`  distinct real quarters (report_date, basis): ${byQuarter.size}  ${byQuarter.size === keep.length ? "✓ one row each" : "⚠ MISMATCH"}`);

  // duplicate labels within the target set would violate the unique key
  const newKeys = new Map<string, number>();
  for (const k of keep) { const key = `${k.newFy}${k.newQ}|${k.row.resultType}`; newKeys.set(key, (newKeys.get(key) ?? 0) + 1); }
  const clash = [...newKeys.entries()].filter(([, n]) => n > 1);
  console.log(`  target keys unique: ${clash.length === 0 ? "✓ yes" : "⚠ " + clash.map(([k, n]) => `${k}×${n}`).join(", ") + " — WOULD VIOLATE THE UNIQUE KEY"}`);

  writeFileSync(`${DIR}/_s4d-${STOCK}-plan.json`, JSON.stringify({
    stock: STOCK, before: rows.length, after: keep.length,
    drop: drop.map((d) => ({ id: d.row.id, rd: rdOf(d.row.reportDate), basis: d.row.resultType, label: d.row.fiscalYear + d.row.quarter, src: d.row.source })),
    relabel: relabels.map((k) => ({ id: k.row.id, rd: rdOf(k.row.reportDate), basis: k.row.resultType, from: k.row.fiscalYear + k.row.quarter, to: k.newFy + k.newQ })),
  }, null, 1));

  if (clash.length || byQuarter.size !== keep.length) { console.log(`\n  ✗ PLAN IS UNSAFE — not committing.\n`); await prisma.$disconnect(); process.exit(3); }
  if (!COMMIT) { console.log(`\n  (plan only — nothing written. add --commit)\n`); await prisma.$disconnect(); return; }

  // ── THE TRANSACTION ──
  const quartersBefore = new Set([...byQuarter.keys()]);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM quarterly_results WHERE "stock_id"=$1 FOR UPDATE`, st.id);
    const del = await tx.quarterlyResult.deleteMany({ where: { stockId: st.id } });
    const data = keep.map((k) => ({ ...k.row, fiscalYear: k.newFy, quarter: k.newQ }));
    const ins = await tx.quarterlyResult.createMany({ data: data as any });
    console.log(`\n  deleted ${del.count} · inserted ${ins.count}`);
    if (ins.count !== keep.length) throw new Error(`inserted ${ins.count} != planned ${keep.length} — ROLLBACK`);
    const after = await tx.quarterlyResult.findMany({ where: { stockId: st.id }, select: { reportDate: true, resultType: true, fiscalYear: true, quarter: true } });
    const qAfter = new Set(after.map((a) => `${rdOf(a.reportDate)}|${a.resultType}`));
    if (qAfter.size !== after.length) throw new Error(`after: ${after.length} rows but ${qAfter.size} distinct quarters — ROLLBACK`);
    const lost = [...quartersBefore].filter((q) => !qAfter.has(q));
    if (lost.length) throw new Error(`quarters lost: ${lost.join(", ")} — ROLLBACK`);
    console.log(`  ✓ assertions passed: ${after.length} rows, ${qAfter.size} distinct quarters, 0 lost`);
  });
  console.log(`  ✓ COMMITTED`);

  // ── fence by id, immediately ──
  const base = JSON.parse((await import("node:fs")).readFileSync(`${DIR}/_r1d-v3-before.json`, "utf8"));
  const ids = (base.rows as any[]).map((r) => r.id);
  const byId = new Map((base.rows as any[]).map((r) => [r.id, r]));
  let breaches = 0;
  for (let i = 0; i < ids.length; i += 500) {
    for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
      for (const r of await raw<any>(`SELECT "id","source" src,"report_date"::text rd FROM "${t}" WHERE "id"=ANY($1::text[])`, ids.slice(i, i + 500))) {
        const b: any = byId.get(r.id);
        if (String(r.src) !== String(b.src) || String(r.rd).slice(0, 10) !== String(b.rd).slice(0, 10)) {
          breaches++; console.log(`      ⚠ ${b.sym} ${b.period} ${b.basis}: ${b.src}@${String(b.rd).slice(0, 10)} → ${r.src}@${String(r.rd).slice(0, 10)}`);
        }
      }
    }
  }
  const present = new Set<string>();
  for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"])
    for (const r of await raw<any>(`SELECT "id" FROM "${t}" WHERE "id"=ANY($1::text[])`, ids)) present.add(r.id);
  const vanished = ids.filter((i) => !present.has(i));
  console.log(`  fence by id: ${breaches} moved · ${vanished.length} vanished  ${breaches === 0 && vanished.length === 0 ? "✓ CLEAN" : "⚠ BREACH"}`);
  for (const v of vanished.slice(0, 10)) { const b: any = byId.get(v); console.log(`      ⚠ VANISHED ${b.sym} ${b.t} ${b.period} ${b.basis}`); }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", (e as Error).message); await prisma.$disconnect(); process.exit(1); });
