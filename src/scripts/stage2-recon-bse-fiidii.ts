// ═══════════════════════════════════════════════════════════════
// STAGE 2 RECON (2/3) — can BSE deliver CORRECT FII/DII?
//
// This is the plan's Stage 2 gate: promoter %, public % and promoterShares already
// match NSE exactly; FII/DII must match too before any write. Read-only — hits BSE
// and compares against NSE-stored rows. Writes nothing.
//
//   npx tsx src/scripts/stage2-recon-bse-fiidii.ts
//
// ── THE TRAP THIS SCRIPT EXISTS TO PIN DOWN ────────────────────
// The BSE public-shareholding payload changed shape, and the change is NOT the
// documented "Fld_Code before qtr 117, Fld_Level after". It is worse:
//
//   OLD (<=116): Institutions are ONE block. "Sub Total B1" = domestic + foreign
//                together, with FPI as the B1e line inside it.
//                  FII = B1e            DII = SubTotalB1 - B1e
//   NEW (>=117): Institutions are SPLIT, mirroring the 2022+ SEBI form.
//                  "Sub Total B1" = DOMESTIC institutions
//                  "Sub Total B2" = FOREIGN institutions (FDI + FPI I + FPI II + other)
//                  "Sub Total B3" = Governments      "Sub Total B4" = non-institutions
//                  FII = SubTotalB2     DII = SubTotalB1   (both direct)
//
// TWO WAYS TO GET THIS SILENTLY WRONG:
//  1. Fld_Code is not merely absent in the new vintage — on the subtotal rows it is
//     STALE. The row whose Fld_Level is "Sub Total B3" carries Fld_Code="STB2", and
//     "Sub Total B4" carries Fld_Code="STB3". Keying on Fld_Code==="STB2" in the new
//     vintage returns the GOVERNMENTS subtotal (0.10 for RELIANCE) while you believe
//     you hold FOREIGN INSTITUTIONS (17.20). Plausible number, completely wrong.
//  2. Keying on Fld_Level alone is ALSO wrong, because "Sub Total B2" means Central
//     Government in the old vintage and Foreign Institutions in the new one.
//
// So the vintage must be DETECTED from the payload shape, never assumed from the
// quarter id, and then the matching map applied.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { BsePacer, BSE_API } from "../ingestions/quaterly-results/bse/bse-http.js";

const OUT = "_s2-recon-fiidii.json";
const pacer = new BsePacer({ minSpacingMs: 2500, throttleStopMs: 90000, slowMs: 12000, maxSpacingMs: 60000 });

const resolved = JSON.parse(readFileSync("_s10-bse-resolved.json", "utf8")) as {
  symbol: string; scripCode: string;
}[];
const scrip = new Map(resolved.map((r) => [r.symbol, r.scripCode]));

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** BSE pads labels with stray double spaces ("Financial  Institutions"). */
const norm = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

interface Row { code: string; level: string; holder: string; pct: number | null; shares: number | null }

function rowsOf(body: string): Row[] {
  const t1 = (JSON.parse(body).Table1 ?? []) as Record<string, unknown>[];
  return t1.map((r) => ({
    code: String(r.Fld_Code ?? "").trim(),
    level: norm(r.Fld_Level),
    holder: String(r.Fld_ShareHolderName ?? "").trim(),
    pct: num(r.Fld_TotalPercentageOf_A_B_C2),
    shares: num(r.Fld_TotalNoOfShares),
  }));
}

type Vintage = "split" | "combined" | "unknown";

/**
 * Detect the payload shape from its CONTENT, never from the quarter id.
 * The new form is the only one that carries a "sub total b4" row and splits FPI
 * into Category I / Category II; the old one has a single "foreign portfolio
 * investors" line inside Sub Total B1.
 */
function detectVintage(rows: Row[]): Vintage {
  const levels = new Set(rows.map((r) => r.level));
  if (levels.has("sub total b4") || [...levels].some((l) => l.startsWith("foreign portfolio investors category")))
    return "split";
  if (levels.has("sub total b1") && [...levels].some((l) => l === "foreign portfolio investors"))
    return "combined";
  return "unknown";
}

/** Aggregate (non-shareholder-name) row whose Fld_Level matches exactly. */
const agg = (rows: Row[], level: string): Row | undefined =>
  rows.find((r) => !r.holder && r.level === level);

interface Extract { vintage: Vintage; fii: number | null; dii: number | null; publicTotal: number | null; note: string }

function extract(rows: Row[]): Extract {
  const vintage = detectVintage(rows);
  // The public grand total keeps a stable Fld_Code across both vintages.
  const pubRow = rows.find((r) => !r.holder && r.code === "STB1B2B3");
  const publicTotal = pubRow?.pct ?? null;

  if (vintage === "split") {
    const dom = agg(rows, "sub total b1");
    const forn = agg(rows, "sub total b2");
    return {
      vintage, publicTotal,
      fii: forn?.pct ?? null,
      dii: dom?.pct ?? null,
      note: "split form: FII=SubTotalB2 (foreign), DII=SubTotalB1 (domestic), both direct",
    };
  }
  if (vintage === "combined") {
    const instTot = agg(rows, "sub total b1");
    const fpi = agg(rows, "foreign portfolio investors");
    const fii = fpi?.pct ?? null;
    const inst = instTot?.pct ?? null;
    return {
      vintage, publicTotal, fii,
      dii: inst !== null && fii !== null ? +(inst - fii).toFixed(4) : null,
      note: "combined form: FII=B1e(FPI), DII=SubTotalB1-FPI",
    };
  }
  return { vintage, publicTotal, fii: null, dii: null, note: "UNKNOWN payload shape - refused to guess" };
}

async function fetchPublic(code: string, qtr: string): Promise<Row[]> {
  const res = await pacer.get(`${BSE_API}/Corp_shpSec_SHPPubShold_ng/w?SCRIPCODE=${code}&QtrCode=${qtr}`);
  return rowsOf(res.body);
}

// Quarter-id anchor: 117 = Mar-2023 (verified against fld_quartername in _bse_qtrinfo.json,
// where 130 = June 2026). qtrId(y, q) with q as 0=Mar 1=Jun 2=Sep 3=Dec.
const QID_MAR2023 = 117;
const qtrId = (year: number, q: number): string =>
  (QID_MAR2023 + (year - 2023) * 4 + q).toFixed(2);

async function main(): Promise<void> {
  // Overlapping quarters: BSE fetched, NSE already stored -> a true comparison.
  const CASES: { symbol: string; year: number; q: number; date: string }[] = [
    { symbol: "TCS", year: 2023, q: 1, date: "2023-06-30" },
    { symbol: "NESTLEIND", year: 2023, q: 1, date: "2023-06-30" },
    { symbol: "HDFCBANK", year: 2023, q: 2, date: "2023-09-30" },
    { symbol: "RELIANCE", year: 2025, q: 3, date: "2025-12-31" },
    { symbol: "BBTC", year: 2024, q: 0, date: "2024-03-31" }, // A+B+C2 != total basis case
    { symbol: "HINDZINC", year: 2024, q: 0, date: "2024-03-31" }, // heavy government stake
    { symbol: "TCS", year: 2021, q: 3, date: "2021-12-31" }, // OLD vintage (qtr 113)
    { symbol: "RELIANCE", year: 2021, q: 3, date: "2021-12-31" }, // OLD vintage
  ];

  const out: Record<string, unknown>[] = [];
  console.log(`\n=== STAGE 2 RECON 2/3 — BSE FII/DII vs NSE-stored ===\n`);
  console.log(`  ${"symbol".padEnd(11)} ${"date".padEnd(11)} ${"qtr".padEnd(7)} ${"form".padEnd(9)} ` +
    `${"fii bse".padStart(8)} ${"fii nse".padStart(8)} ${"dii bse".padStart(8)} ${"dii nse".padStart(8)}  verdict`);

  for (const c of CASES) {
    const code = scrip.get(c.symbol);
    if (!code) { console.log(`  ${c.symbol}: no BSE scrip code`); continue; }
    const qid = qtrId(c.year, c.q);
    let ex: Extract;
    try {
      ex = extract(await fetchPublic(code, qid));
    } catch (e) {
      console.log(`  ${c.symbol.padEnd(11)} ${c.date} qtr=${qid} FETCH FAILED: ${(e as Error).message}`);
      continue;
    }
    const nse = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT p.fii_pct, p.dii_pct, p.public_pct, p.promoter_pct
       FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id
       WHERE s.symbol = $1 AND p.as_on_date = $2::date`,
      c.symbol, c.date,
    );
    const n = nse[0];
    const nf = n?.fii_pct == null ? null : Number(n.fii_pct);
    const nd = n?.dii_pct == null ? null : Number(n.dii_pct);
    const dFii = ex.fii !== null && nf !== null ? Math.abs(ex.fii - nf) : null;
    const dDii = ex.dii !== null && nd !== null ? Math.abs(ex.dii - nd) : null;
    const verdict =
      ex.vintage === "unknown" ? "UNKNOWN FORM"
      : ex.fii === null || ex.dii === null ? "BSE NULL"
      : n === undefined ? "no NSE row"
      : dFii !== null && dDii !== null && dFii <= 0.15 && dDii <= 0.15 ? "MATCH"
      : `DIFF fii=${dFii?.toFixed(2)}pp dii=${dDii?.toFixed(2)}pp`;

    console.log(
      `  ${c.symbol.padEnd(11)} ${c.date} ${qid.padEnd(7)} ${ex.vintage.padEnd(9)} ` +
      `${String(ex.fii).padStart(8)} ${String(nf).padStart(8)} ${String(ex.dii).padStart(8)} ${String(nd).padStart(8)}  ${verdict}`,
    );
    out.push({ ...c, qid, ...ex, nseFii: nf, nseDii: nd, nsePublic: n?.public_pct ?? null, verdict });
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n  -> ${OUT}`);
  console.log(`  BSE latencies (ms): ${pacer.latencies.join(", ")}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
