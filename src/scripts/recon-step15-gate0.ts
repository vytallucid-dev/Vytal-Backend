// ═══════════════════════════════════════════════════════════════
// STEP 15 — GATE 0 RECON (READ-ONLY). G-secs / SGBs / T-bills identity.
//
// THE HYPOTHESIS, from the series histogram Step 14 already measured on the NSE udiff BhavCopy:
//     GS:48  ·  TB:16  ·  GB:39  ·  SG:3   (alongside RR:6 / IV:11, which Step 14 loaded)
// If those are what they look like — central G-secs, T-bills, Sovereign Gold Bonds and State
// Development Loans — then the ENTIRE source problem is already solved: the same file, the same
// shared reader (shared/udiff-bhavcopy.ts), the same ISIN spine, the same instrument_prices lane.
//
// This script does NOT assume that. It measures:
//   A. WHICH government series exist, what they are NAMED, and whether every row carries an ISIN.
//   B. WHETHER THEY PRICE — do they carry a real close and real volume, or are they listed-but-dead?
//      (An identity-only tier still owes a held SGB an honest value.)
//   C. WHAT THE NAME CARRIES — coupon and maturity are NOT columns in this file. Are they parseable
//      out of FinInstrmNm, or is that a fabrication risk? This decides the attributes mapping.
//   D. THE ENUM — does AssetClass already carry gsec/sgb? (Step 8 created it; Step 14 verified the
//      labels. If they are there, Gate 1 is a SKIP.)
//   E. OVERLAP + NAMESPACE — the ISIN prefix, and whether any of these already sit in the catalogue
//      or as bare stocks.
//   F. THE OUT-OF-SCOPE FENCE — the N*/Y*/Z* series are CORPORATE debt (a later, larger step). Prove
//      they are cleanly separable from the government ones, so this load cannot swallow them.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { fetchUdiff, parseUdiff, weekdaysBack, type UdiffRow } from "../ingestions/shared/udiff-bhavcopy.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(80) + "\n" + s + "\n" + "═".repeat(80));

// The series the histogram suggests are GOVERNMENT paper. Nothing is assumed about them below —
// they are simply the set we interrogate.
const GOVT_SERIES = ["GS", "TB", "GB", "SG"];

// ── Fetch the most recent published session ────────────────────────────────
let rows: UdiffRow[] = [];
let day = "";
for (const d of weekdaysBack(new Date(), 8)) {
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const p = parseUdiff(f.buffer);
  if (!p.ok) continue;
  rows = p.rows;
  day = d.toISOString().slice(0, 10);
  console.log(`udiff session: ${day}  (${rows.length} rows)`);
  break;
}
if (rows.length === 0) {
  console.log("!! no udiff fetched");
  await prisma.$disconnect();
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
rule("A · WHICH SERIES, WHAT ARE THEY, AND DOES EVERY ROW CARRY AN ISIN?");
// ═══════════════════════════════════════════════════════════════
const hist: Record<string, number> = {};
for (const r of rows) hist[r.series] = (hist[r.series] ?? 0) + 1;
console.log("FULL SERIES HISTOGRAM:", J(hist));

for (const s of GOVT_SERIES) {
  const hits = rows.filter((r) => r.series === s);
  const withIsin = hits.filter((r) => r.isin).length;
  const usable = hits.filter((r) => r.usable).length;
  console.log(`\n── SERIES ${s} — ${hits.length} rows · ${withIsin} with an ISIN · ${usable} usable ──`);
  for (const h of hits.slice(0, 8)) {
    console.log(
      `   ${(h.symbol || "(no symbol)").padEnd(14)} ${(h.isin || "(NO ISIN)").padEnd(14)} close=${String(h.close).padStart(10)} vol=${String(h.volume).padStart(10)}  ${h.name}`,
    );
  }
  if (hits.length > 8) console.log(`   … ${hits.length - 8} more`);
  const noIsin = hits.filter((r) => !r.isin);
  if (noIsin.length) console.log(`   ⚠ ${noIsin.length} row(s) with NO ISIN → honest gap: ${noIsin.map((r) => r.symbol).join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════
rule("B · DO THEY PRICE? (a held SGB is owed an honest value)");
// ═══════════════════════════════════════════════════════════════
for (const s of GOVT_SERIES) {
  const hits = rows.filter((r) => r.series === s && r.usable);
  if (!hits.length) continue;
  const traded = hits.filter((r) => r.volume > 0n).length;
  const closes = hits.map((r) => r.close).sort((a, b) => a - b);
  const withPrev = hits.filter((r) => r.prevClose != null).length;
  console.log(
    `   ${s}: ${hits.length} priced rows · ${traded} actually TRADED today (vol>0) · ${withPrev} carry a prev_close\n` +
      `        close range ₹${closes[0]} … ₹${closes[closes.length - 1]}  (median ₹${closes[Math.floor(closes.length / 2)]})`,
  );
}
console.log(`
   READ THIS AS: a row with a close but vol=0 is LISTED AND UNTRADED TODAY, not unpriceable. The
   Step-14 union (last N sessions, most-recent-session-wins) already handles exactly this — it is
   how NHIT keeps an honestly-dated older close. The question that matters is whether a close
   EXISTS at all, not whether it printed today.`);

// ═══════════════════════════════════════════════════════════════
rule("C · WHAT DOES THE NAME CARRY? (coupon + maturity are NOT columns in this file)");
// ═══════════════════════════════════════════════════════════════
console.log("Every distinct NAME shape, so the attribute mapping is grounded in what is actually there:\n");
for (const s of GOVT_SERIES) {
  const hits = rows.filter((r) => r.series === s);
  if (!hits.length) continue;
  console.log(`── ${s} ──`);
  for (const h of hits.slice(0, 6)) console.log(`   "${h.name}"   (symbol=${h.symbol})`);
  console.log("");
}
console.log(`   The QUESTION this settles: can coupon% and a maturity DATE be read out of these names
   without guessing? If a name is "7.26% GS 2033" the coupon is explicit and the maturity YEAR is —
   but the maturity DAY is not, and inventing one is a fabrication. Anything not explicitly present
   goes honest-null. Attributes are display-only here (no detail page), so an absent coupon costs
   nothing; a WRONG one is a lie about a government bond's cash flows.`);

// ═══════════════════════════════════════════════════════════════
rule("D · THE ENUM — does AssetClass already carry gsec / sgb?");
// ═══════════════════════════════════════════════════════════════
console.log(
  J(await q(`SELECT e.enumlabel AS label, e.enumsortorder AS ord
               FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'AssetClass' ORDER BY e.enumsortorder`)),
);
console.log(`
   If gsec AND sgb are both present, GATE 1 IS A SKIP — Step 8 created them in the original
   catalogue migration and nothing has used them since. A T-bill is a short-dated government
   security, so it classifies as 'gsec'; an SDL (state loan) is a government security too. Only
   the SOVEREIGN GOLD BOND is different enough to deserve its own label — it is a gold-linked
   instrument, not a rupee-coupon bond — and 'sgb' already exists for exactly that.`);

// ═══════════════════════════════════════════════════════════════
rule("E · OVERLAP + NAMESPACE");
// ═══════════════════════════════════════════════════════════════
const govtRows = rows.filter((r) => GOVT_SERIES.includes(r.series) && r.isin);
const prefixes: Record<string, number> = {};
for (const r of govtRows) prefixes[r.isin.slice(0, 3)] = (prefixes[r.isin.slice(0, 3)] ?? 0) + 1;
console.log(`ISIN PREFIX CENSUS across ${govtRows.length} government rows: ${J(prefixes)}`);
console.log(`   (INE = equity namespace · INF = fund namespace · IN0 = government. A distinct
    namespace means these CANNOT collide with the 504 stocks, the 17,567 MFs, the 337 ETFs or the
    21 trusts — and cannot trip the AMFI 'INF%' trespass guard either.)`);

const isins = govtRows.map((r) => r.isin);
if (isins.length) {
  console.log("\nAlready in `instruments`?");
  console.log(J(await q(`SELECT isin, symbol, asset_class::text ac FROM instruments WHERE isin = ANY($1::text[])`, isins)));
  console.log("Already a bare STOCK? (an SGB synced from a broker could have been admitted as one)");
  console.log(J(await q(`SELECT id, symbol, isin, name FROM stocks WHERE isin = ANY($1::text[])`, isins)));
  console.log("Sitting in broker_holdings unmapped?");
  console.log(J(await q(`SELECT symbol, stock_id, instrument_id FROM broker_holdings WHERE instrument_id IS NULL`)));
}

// ═══════════════════════════════════════════════════════════════
rule("F · THE OUT-OF-SCOPE FENCE — corporate debt must NOT be swallowed");
// ═══════════════════════════════════════════════════════════════
const OTHER = Object.keys(hist).filter(
  (s) => !GOVT_SERIES.includes(s) && !["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1", "RR", "IV", "MF"].includes(s),
);
console.log(`Series that are NEITHER equity/trust/fund NOR government — i.e. the corporate-debt zoo:`);
console.log(`   ${OTHER.length} series: ${OTHER.sort().join(", ")}`);
const otherRows = rows.filter((r) => OTHER.includes(r.series));
console.log(`   ${otherRows.length} rows. Sample:`);
for (const r of otherRows.slice(0, 6)) {
  console.log(`     [${r.series}] ${(r.isin || "?").padEnd(14)} ${r.name}`);
}
const otherPrefixes: Record<string, number> = {};
for (const r of otherRows) if (r.isin) otherPrefixes[r.isin.slice(0, 3)] = (otherPrefixes[r.isin.slice(0, 3)] ?? 0) + 1;
console.log(`   their ISIN prefixes: ${J(otherPrefixes)}`);
console.log(`   → A series ALLOW-LIST (GS/TB/GB/SG) excludes every one of these by construction.
     Step 15 must never key on "is it debt" — it keys on the exact government series, so the
     corporate-bond step stays a separate, later, deliberate decision.`);

// ═══════════════════════════════════════════════════════════════
rule("G · BASELINE — the fingerprints Gate 3 re-measures");
// ═══════════════════════════════════════════════════════════════
console.log(J(await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`)));
console.log(J(await q(`SELECT count(*)::int stocks FROM stocks`)));
console.log(J(await q(`SELECT count(*)::int instrument_price_rows FROM instrument_prices`)));

await prisma.$disconnect();
console.log("\n═══ GATE 0 COMPLETE — nothing was written. ═══");
