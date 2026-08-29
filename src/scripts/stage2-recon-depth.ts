// ═══════════════════════════════════════════════════════════════
// STAGE 2 RECON (3/3) — HOW DEEP does BSE go, and what would it ADD on top of
// NSE post-Stage-1? Read-only. Writes nothing to the DB.
//
//   npx tsx src/scripts/stage2-recon-depth.ts [SYMBOL,SYMBOL,...] [fromQid] [toQid]
//
// ⚠️ THERE IS NO QUARTER REGISTER. The plan lists `shpDecleraction` as one, but it
//    is not: it returns a bare JSON ARRAY (no Table wrapper) with exactly ONE row,
//    the LATEST quarter for that scrip —
//      [{"qtr_id":"130.00","qtr_name":"June 2026","CompName":"Reliance Industries
//        Ltd","Mid":"390581","IsBeneficialOwner":"True"}]
//    So availability per quarter can only be discovered by PROBING each quarter id.
//    That removes the cheap sizing shortcut and is the single biggest cost driver
//    for the lane: depth must be walked, not looked up.
//
// A quarter counts as PRESENT only if the security payload carries a real
// promoter/public partition — BSE answers HTTP 200 with an empty or all-zero body
// for a quarter it does not hold, which is the documented "200 with every number
// zeroed" failure and must never be mistaken for a genuine 0% promoter holding.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { BsePacer, BSE_API } from "../ingestions/quaterly-results/bse/bse-http.js";

const OUT = "_s2-recon-depth.json";
const pacer = new BsePacer({ minSpacingMs: 2500, throttleStopMs: 120000, slowMs: 15000, maxSpacingMs: 60000 });

const resolved = JSON.parse(readFileSync("_s10-bse-resolved.json", "utf8")) as {
  symbol: string; scripCode: string;
}[];
const scrip = new Map(resolved.map((r) => [r.symbol, r.scripCode]));

/** 117 = Mar-2023, anchored on _bse_qtrinfo.json where 130 = June 2026. */
const QID_MAR2023 = 117;
const qidToDate = (qid: number): string => {
  const off = qid - QID_MAR2023;
  const y = 2023 + Math.floor(off / 4);
  const q = ((off % 4) + 4) % 4;
  return `${y}-${["03-31", "06-30", "09-30", "12-31"][q]}`;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface Probe { qid: number; date: string; present: boolean; promoter: number | null; public: number | null; totalShares: number | null }

async function probeQuarter(code: string, qid: number): Promise<Probe> {
  const qs = qid.toFixed(2);
  const res = await pacer.get(`${BSE_API}/CorporatesSHPSecuritybeta/w?scripcode=${code}&qtrid=${qs}`);
  let t1: Record<string, unknown>[] = [];
  try {
    t1 = (JSON.parse(res.body).Table1 ?? []) as Record<string, unknown>[];
  } catch {
    t1 = [];
  }
  const byCode = (c: string) =>
    t1.find((x) => String(x.Fld_Code) === c && !x.Fld_ShareHolderName);
  const prom = t1.find((x) => String(x.Fld_ShortCatg ?? x.Fld_Code) === "STA1A2") ?? byCode("STA1A2");
  const pub = byCode("STB1B2B3");
  const grand = byCode("STABC");
  const promoter = num(prom?.Fld_TotalPercentageOf_A_B_C2);
  const publicPct = num(pub?.Fld_TotalPercentageOf_A_B_C2);
  const totalShares = num(grand?.Fld_TotalNoOfShares);
  // PRESENT = a real partition, not a 200-with-zeros. A genuinely 0%-promoter
  // company (post-merger HDFCBANK) still reports public ~100 and a share count.
  const present =
    t1.length > 0 &&
    totalShares !== null && totalShares > 0 &&
    publicPct !== null &&
    (promoter ?? 0) + publicPct > 50;
  return { qid, date: qidToDate(qid), present, promoter, public: publicPct, totalShares };
}

async function main(): Promise<void> {
  const symbols = (process.argv[2] ?? "NESTLEIND,TCS,RELIANCE,HINDZINC").split(",").map((s) => s.trim());
  const fromQid = Number(process.argv[3] ?? 101); // 101 = Mar-2019
  const toQid = Number(process.argv[4] ?? 117); // 117 = Mar-2023

  const nseRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, p.as_on_date::text q FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id
     WHERE (extract(month from p.as_on_date), extract(day from p.as_on_date)) IN ((3,31),(6,30),(9,30),(12,31))`,
  );
  const nseHave = new Map<string, Set<string>>();
  for (const r of nseRows) {
    const s = String(r.symbol);
    if (!nseHave.has(s)) nseHave.set(s, new Set());
    nseHave.get(s)!.add(String(r.q));
  }

  console.log(`\n=== STAGE 2 RECON 3/3 — BSE depth probe ===`);
  console.log(`  probing qtr ${fromQid} (${qidToDate(fromQid)}) .. ${toQid} (${qidToDate(toQid)})`);
  console.log(`  ${(toQid - fromQid + 1) * symbols.length} requests at ~2.5s pacing\n`);

  const out: Record<string, unknown>[] = [];
  for (const sym of symbols) {
    const code = scrip.get(sym);
    if (!code) { console.log(`  ${sym}: no BSE scrip code — skipped`); continue; }
    const have = nseHave.get(sym) ?? new Set<string>();
    const probes: Probe[] = [];
    for (let qid = fromQid; qid <= toQid; qid++) {
      try {
        probes.push(await probeQuarter(code, qid));
      } catch (e) {
        console.log(`     ${sym} qtr ${qid}: ${(e as Error).message}`);
      }
    }
    const present = probes.filter((p) => p.present);
    const adds = present.filter((p) => !have.has(p.date));
    const nseFrom = [...have].sort()[0] ?? null;

    console.log(`  ${sym}  (scrip ${code})  NSE earliest=${nseFrom ?? "-"}  NSE quarters=${have.size}`);
    console.log(`     BSE present in probed window : ${present.length} of ${probes.length}`);
    console.log(`     BSE quarters NSE LACKS       : ${adds.length}`);
    if (present.length)
      console.log(`     earliest BSE in window       : ${present[0].date} (promoter ${present[0].promoter}%, public ${present[0].public}%)`);
    const miss = probes.filter((p) => !p.present).map((p) => p.date);
    if (miss.length) console.log(`     absent/zeroed                : ${miss.join(" ")}`);
    console.log("");
    out.push({ symbol: sym, scripCode: code, nseEarliest: nseFrom, nseQuarters: have.size, probes, addsCount: adds.length, addDates: adds.map((a) => a.date) });
  }

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), fromQid, toQid, out }, null, 2));
  const lat = [...pacer.latencies].sort((a, b) => a - b);
  console.log(`  -> ${OUT}`);
  if (lat.length)
    console.log(`  BSE latency: n=${lat.length} p50=${lat[Math.floor(lat.length / 2)]}ms p90=${lat[Math.floor(lat.length * 0.9)]}ms max=${lat[lat.length - 1]}ms\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
