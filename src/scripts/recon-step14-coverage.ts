// STEP 14 — coverage diagnostic (READ-ONLY). Which trusts landed, and is any of the 17 missing?
// A trust absent from ONE day's BhavCopy is not delisted — it simply did not trade. This script
// exists to tell those two apart before deciding how the ingest should look back.
import { prisma } from "../db/prisma.js";
import { fetchUdiff, parseUdiff } from "../ingestions/reits/reit-source.js";

const rows = await prisma.$queryRawUnsafe<any[]>(
  `SELECT symbol, asset_class::text ac, isin, last_price, last_price_date
     FROM instruments WHERE asset_class IN ('reit','invit') ORDER BY asset_class, symbol`,
);
console.log(`loaded: ${rows.length}`);
for (const r of rows) {
  console.log(
    `   ${String(r.symbol).padEnd(12)} ${r.ac.padEnd(6)} ${r.isin}  ₹${String(r.last_price).padStart(8)}  ${r.last_price_date?.toISOString().slice(0, 10)}`,
  );
}

const KNOWN = ["BAGMANE","BIRET","EMBASSY","KRT","MINDSPACE","NXST","ANANTAM","ANZEN","CAPINVIT","CITIUSINVT","INDIGRID","INDUSINVIT","IRBINVIT","NHIT","PGINVIT","RIIT","VERTIS"];
const got = new Set(rows.map((r) => r.symbol));
const missing = KNOWN.filter((s) => !got.has(s));
console.log(`\nMISSING vs the 17 seen on 2026-07-10: ${missing.length ? missing.join(", ") : "(none)"}`);

// Is the missing one ABSENT FROM THE FILE (did not trade) or did our parser drop it?
console.log("\n── per-day RR/IV presence in the udiff BhavCopy (the ground truth) ──");
for (let i = 0; i < 6; i++) {
  const d = new Date(Date.UTC(2026, 6, 13 - i));
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) continue;
  const f = await fetchUdiff(d);
  if (f.status !== 200) {
    console.log(`   ${d.toISOString().slice(0, 10)}: HTTP ${f.status} (no session)`);
    continue;
  }
  const p = parseUdiff(f.buffer);
  if (!p.ok) {
    console.log(`   ${d.toISOString().slice(0, 10)}: parse failed (${p.reason})`);
    continue;
  }
  const syms = p.rows.map((r) => r.symbol).sort();
  const absent = KNOWN.filter((s) => !syms.includes(s));
  console.log(
    `   ${d.toISOString().slice(0, 10)}: ${p.rows.length} RR/IV rows · absent: ${absent.length ? absent.join(", ") : "(none)"} · malformed: ${p.malformed.length}`,
  );
}

await prisma.$disconnect();
