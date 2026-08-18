// ═══════════════════════════════════════════════════════════════
// G2 — ASK THE SOURCE. READ-ONLY, listings only, no ingest.
// Calls the RAW legacy endpoint (not fetchFilingsList, which silently drops
// entries whose xbrl is "-" or ends "/-") so a PLACEHOLDER is distinguishable
// from a genuine ABSENCE — the (a) vs (b) question.
//   npx tsx src/scripts/_g2-listing.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";

// three affected (hold NO FY23Q1 row at all) + one control that HAS it
const TARGETS = [
  { symbol: "HAVELLS", why: "affected — no FY23Q1 row of either basis" },
  { symbol: "ULTRACEMCO", why: "affected — no FY23Q1 row of either basis" },
  { symbol: "SBIN", why: "affected — no FY23Q1 row of either basis (banking)" },
  { symbol: "TCS", why: "CONTROL — holds FY23Q1 standalone" },
];
const SPACING_MS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main() {
  const [clk] = await raw<any>(
    `SELECT now()::text n, date_part('hour', now() AT TIME ZONE 'UTC')::int h, date_part('minute', now() AT TIME ZONE 'UTC')::int m`);
  const [jobs] = await raw<any>(`SELECT count(*)::int n FROM background_jobs WHERE "status" IN ('pending','running')`);
  const blackout = Number(clk.h) === 13 || (Number(clk.h) === 14 && Number(clk.m) <= 10);
  console.log(`\n  DB clock ${clk.n} · jobs running/pending ${jobs.n} · blackout ${blackout ? "INSIDE ✗" : "outside ✓"}`);
  if (blackout || Number(jobs.n) > 0) { console.log(`  ✗ HOLD.`); await prisma.$disconnect(); process.exit(2); }
  console.log(`  ${TARGETS.length} listing calls, ${SPACING_MS}ms apart, no XBRL fetched\n`);

  let calls = 0;
  for (const [i, t] of TARGETS.entries()) {
    if (i > 0) await sleep(SPACING_MS);
    const path = `/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(t.symbol)}&period=Quarterly`;
    let list: any[];
    try { list = await nseClient.get<any[]>(path); calls++; }
    catch (e) { console.log(`  ${t.symbol}: listing failed — ${(e as Error).message}`); continue; }
    if (!Array.isArray(list)) { console.log(`  ${t.symbol}: non-array response`); continue; }

    // The FY23Q1 period for a March filer = 01-Apr-2022 .. 30-Jun-2022
    const hits = list.filter((r) => r.toDate === "30-Jun-2022");
    console.log(`  ── ${pad(t.symbol, 12)} ${t.why}`);
    console.log(`     listing returned ${list.length} quarterly entries · entries with toDate=30-Jun-2022: ${hits.length}`);
    if (hits.length === 0) {
      const nearby = [...new Set(list.map((r) => r.toDate))].filter((d) => String(d).includes("2022")).sort();
      console.log(`     ⇒ (a) SOURCE GAP — the period is ABSENT from the listing entirely`);
      console.log(`     2022 period-ends the listing DOES carry: ${nearby.join(", ") || "(none)"}`);
    } else {
      for (const h of hits) {
        const url = String(h.xbrl ?? "");
        const placeholder = !url || url === "-" || url.endsWith("/-");
        console.log(`     basis=${pad(h.consolidated ?? "null", 14)} filed=${pad(h.filingDate, 20)} xbrl=${placeholder ? `PLACEHOLDER (${JSON.stringify(h.xbrl)})` : url.split("/").pop()}`);
        console.log(`       ⇒ ${placeholder ? "(b) LISTED BUT NO DOCUMENT — fetchFilingsList drops this silently" : "listed WITH a real document URL"}`);
      }
      const bases = hits.map((h) => (h.consolidated === "Consolidated" ? "consolidated" : "standalone"));
      console.log(`     bases present in the listing: ${[...new Set(bases)].join(" + ")}`);
    }
  }
  console.log(`\n  NSE calls used: ${calls} listings · 0 XBRL fetches · nothing ingested\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
