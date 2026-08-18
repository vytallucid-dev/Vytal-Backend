// ═══════════════════════════════════════════════════════════════
// F4b — WHY does NSE serve nothing for ABBOTINDIA / BAYERCROP / MCX?
// READ-ONLY (network reads + DB reads; writes NOTHING).
//   npx tsx src/scripts/_f4b-probe.ts
//
// The "0 filings discovered" log cannot distinguish these causes:
//   (a) the SYMBOL we ask about is not the symbol NSE files under (rename)
//   (b) the stock is not on the `equities` index we query
//   (c) NSE genuinely serves no INTEGRATED filing for it (regime/segment)
//   (d) a transient session/rate-limit failure that returned an empty array
//
// So probe every one of them, with RELIANCE as the control on EVERY probe:
//   P1  v3 integrated-filing-results, index=equities&symbol=…      (the prod path)
//   P2  v3 integrated-filing-results, RANGED (no symbol) — is the symbol the filter
//       that kills it, or the endpoint?
//   P3  v2 legacy corporates-financial-results (the backfill path, toDate=2025-01-31)
//   P4  /api/quote-equity — does NSE know this symbol at all, and under what
//       series / date-of-listing / ISIN?
//   P5  /api/equity-master + /api/search/autocomplete — the symbol master
//   P6  ISIN cross-check against stocks.isin
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { fetchFilingsList as v3List } from "../ingestions/quaterly-results/results/discovery.js";
import { fetchFilingsList as v2List } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { TO_DATE } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUBJECTS = ["ABBOTINDIA", "BAYERCROP", "MCX"];
const CONTROL = "RELIANCE";
const ALL = [...SUBJECTS, CONTROL];

const out: any = { probes: {} };

async function get<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; err: string }> {
  try {
    return { ok: true, data: await nseClient.get<T>(path) };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 180) };
  }
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4b — why does NSE serve nothing? (RELIANCE = control on every probe)      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const meta = new Map<string, any>();
  for (const s of ALL) {
    const [r] = await raw(`SELECT "isin","name","fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, s);
    meta.set(s, r);
  }

  // ── P1 — the production v3 path, exactly as scanSymbol calls it ──────────
  console.log(`\n  ── P1 · v3 /api/integrated-filing-results?index=equities&symbol=… (PROD PATH) ──`);
  out.probes.p1 = {};
  for (const s of ALL) {
    const fye = (meta.get(s)?.fye === "december" ? "december" : "march") as "march" | "december";
    process.stdout.write(`  ${pad(s, 13)} … `);
    const t0 = Date.now();
    try {
      const rows = await v3List(s, fye);
      console.log(`${rows.length} filing(s)  ${Date.now() - t0}ms`);
      out.probes.p1[s] = { n: rows.length, sample: rows.slice(0, 3).map((r: any) => ({ qe: r.qeDate, t: r.filingType, c: r.consolidated })) };
      for (const r of rows.slice(0, 3) as any[])
        console.log(`       ${pad(r.qeDate, 14)}${pad(r.filingType, 11)}${pad(r.consolidated ?? "-", 13)}${String(r.xbrl).slice(-40)}`);
    } catch (e) {
      console.log(`THREW: ${(e as Error).message.slice(0, 120)}`);
      out.probes.p1[s] = { error: (e as Error).message };
    }
    await sleep(1600);
  }

  // ── P1b — the RAW envelope, unfiltered. `normalizeFinancials` drops Governance
  //          rows and malformed ones; a symbol with ONLY Governance rows would look
  //          identical to a symbol with nothing at all.
  console.log(`\n  ── P1b · the RAW envelope (totalCount + row types, BEFORE the Financials filter) ──`);
  out.probes.p1b = {};
  for (const s of ALL) {
    const r = await get<any>(`/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(s)}&size=100&page=1`);
    if (!r.ok) { console.log(`  ${pad(s, 13)} ERR ${r.err}`); out.probes.p1b[s] = { error: r.err }; continue; }
    const d = r.data;
    const types = new Map<string, number>();
    for (const row of d.data ?? []) types.set(row.type, (types.get(row.type) ?? 0) + 1);
    console.log(`  ${pad(s, 13)} totalCount=${pad(d.totalCount ?? "?", 6)} rows=${pad((d.data ?? []).length, 5)} types=${[...types].map(([k, v]) => `${k}:${v}`).join(" ") || "(none)"}`);
    out.probes.p1b[s] = { totalCount: d.totalCount ?? null, rows: (d.data ?? []).length, types: [...types] };
    await sleep(1600);
  }

  // ── P2 — ranged, no symbol. Does the endpoint work at all right now? ─────
  console.log(`\n  ── P2 · v3 ranged window (no symbol) — is the ENDPOINT alive? ──`);
  const rng = await get<any>(`/api/integrated-filing-results?index=equities&from_date=01-08-2026&to_date=17-08-2026&size=100&page=1`);
  if (rng.ok) {
    const rows = rng.data.data ?? [];
    const syms = new Set(rows.map((r: any) => r.symbol));
    console.log(`     totalCount=${rng.data.totalCount} rows=${rows.length} distinct symbols=${syms.size}`);
    for (const s of SUBJECTS) console.log(`     ${pad(s, 13)} present in window: ${syms.has(s) ? "YES" : "no"}`);
    out.probes.p2 = { totalCount: rng.data.totalCount, rows: rows.length, symbols: syms.size, subjectsPresent: SUBJECTS.filter((s) => syms.has(s)) };
  } else {
    console.log(`     ERR ${rng.err}`);
    out.probes.p2 = { error: rng.err };
  }
  await sleep(1600);

  // ── P3 — the v2 legacy path, the one the backfill uses ──────────────────
  console.log(`\n  ── P3 · v2 /api/corporates-financial-results (LEGACY BACKFILL PATH, toDate=${TO_DATE}) ──`);
  out.probes.p3 = {};
  for (const s of ALL) {
    process.stdout.write(`  ${pad(s, 13)} … `);
    try {
      const rows = await v2List(s, "Quarterly", { fromDate: "2017-04-01", toDate: TO_DATE });
      console.log(`${rows.length} quarterly filing(s)`);
      out.probes.p3[s] = { n: rows.length, sample: rows.slice(0, 3).map((r: any) => ({ from: r.fromDate, to: r.toDate, cons: r.consolidated, isin: r.isin })) };
      for (const r of rows.slice(0, 3) as any[])
        console.log(`       ${pad(r.fromDate, 13)}${pad(r.toDate, 13)}${pad(r.consolidated ?? "-", 14)}isin=${r.isin ?? "-"}`);
    } catch (e) {
      console.log(`THREW: ${(e as Error).message.slice(0, 120)}`);
      out.probes.p3[s] = { error: (e as Error).message };
    }
    await sleep(1600);
  }

  // ── P4 — does NSE know the symbol at all? series / listing / ISIN ────────
  console.log(`\n  ── P4 · /api/quote-equity — is the SYMBOL right, and on which series? ──`);
  out.probes.p4 = {};
  for (const s of ALL) {
    const r = await get<any>(`/api/quote-equity?symbol=${encodeURIComponent(s)}`);
    if (!r.ok) { console.log(`  ${pad(s, 13)} ERR ${r.err}`); out.probes.p4[s] = { error: r.err }; continue; }
    const i = r.data?.info ?? {};
    const m = r.data?.metadata ?? {};
    const sec = r.data?.securityInfo ?? {};
    const rec = {
      symbol: i.symbol, company: i.companyName, isin: i.isin,
      series: m.series, listingDate: m.listingDate, status: m.status,
      industry: m.industry, activeSeries: i.activeSeries, debtSeries: i.debtSeries,
      surveillance: sec.surveillance?.surv ?? null, boardStatus: sec.boardStatus ?? null,
      tradingStatus: sec.tradingStatus ?? null, faceValue: sec.faceValue ?? null,
      isFNOSec: i.isFNOSec, isCASec: i.isCASec, isSLBSec: i.isSLBSec,
    };
    console.log(`  ${pad(s, 13)} isin=${pad(rec.isin ?? "-", 14)} series=${pad(JSON.stringify(rec.activeSeries ?? rec.series), 12)} listed=${pad(rec.listingDate ?? "-", 12)} status=${rec.status ?? "-"} trading=${rec.tradingStatus ?? "-"}`);
    console.log(`  ${pad("", 13)} db.isin=${pad(meta.get(s)?.isin ?? "-", 14)} ${rec.isin === meta.get(s)?.isin ? "✓ ISIN MATCHES" : "⚠ ISIN DIFFERS"}   name(nse)=${rec.company}`);
    out.probes.p4[s] = { ...rec, dbIsin: meta.get(s)?.isin ?? null, isinMatch: rec.isin === meta.get(s)?.isin };
    await sleep(1600);
  }

  // ── P5 — the symbol master / autocomplete: is there a DIFFERENT symbol for the ISIN? ──
  console.log(`\n  ── P5 · /api/search/autocomplete — what symbol does NSE offer for this name? ──`);
  out.probes.p5 = {};
  for (const s of ALL) {
    const q = (meta.get(s)?.name ?? s).split(" ")[0];
    const r = await get<any>(`/api/search/autocomplete?q=${encodeURIComponent(q)}`);
    if (!r.ok) { console.log(`  ${pad(s, 13)} q="${q}" ERR ${r.err}`); out.probes.p5[s] = { q, error: r.err }; continue; }
    const syms = (r.data?.symbols ?? []).map((x: any) => `${x.symbol}(${x.result_sub_type ?? x.result_type ?? "?"})`);
    console.log(`  ${pad(s, 13)} q="${pad(q, 10)}" → ${syms.slice(0, 6).join("  ") || "(none)"}`);
    out.probes.p5[s] = { q, symbols: (r.data?.symbols ?? []).slice(0, 8) };
    await sleep(1600);
  }

  // ── P6 — corporate_events "Financial Results" board meetings: does the stock
  //         still ANNOUNCE results? If it does, filings exist somewhere.
  console.log(`\n  ── P6 · do these stocks still announce RESULTS board meetings in our own events table? ──`);
  out.probes.p6 = {};
  for (const s of ALL) {
    const evs = await raw(
      `SELECT ce."event_type" et, ce."event_date"::text ed, left(coalesce(ce."purpose",ce."description",''),70) p
         FROM corporate_events ce JOIN stocks st ON st."id"=ce."stock_id"
        WHERE st."symbol"=$1 AND (ce."event_type"='earnings' OR coalesce(ce."purpose",'') ILIKE '%result%')
        ORDER BY ce."event_date" DESC LIMIT 5`, s);
    console.log(`  ${pad(s, 13)} ${evs.length} results-event(s): ${evs.map((e: any) => String(e.ed).slice(0, 10)).join(", ") || "(none)"}`);
    out.probes.p6[s] = evs;
  }

  writeFileSync(`${DIR}/_f4b-probe.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_f4b-probe.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
