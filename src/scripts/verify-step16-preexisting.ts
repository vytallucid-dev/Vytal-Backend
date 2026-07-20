// STEP 16 — PROOF that verify-step9-amfi.ts's 8 failures are PRE-EXISTING, not a Step-16 regression.
// Not an argument — a measurement. Step 16 wrote ONLY mf_families/mf_family_members. If the
// catalogue is bit-for-bit what Gate 0 measured BEFORE the migration, Step 16 cannot have caused
// any assertion about it to flip.
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

console.log("Gate-0 census (measured BEFORE the migration, before any family existed):");
console.log("  stock=504 · mutual_fund=17,567 · etf=337 · gsec=170 · sgb=45 · invit=15 · reit=6  → 18,644");
console.log("Step-9 harness asserts: 18,071 (504 + 17,567) and 0 ETFs — a Step-9-era world that");
console.log("Step 13 ended by loading 337 ETFs, and Steps 14/15 by loading 573 non-fund rows.\n");

console.log("LIVE NOW:", J(await q(`SELECT asset_class, COUNT(*) AS n FROM instruments GROUP BY 1 ORDER BY 2 DESC`)));
const [t] = await q(`SELECT COUNT(*) AS n FROM instruments`);
// STEP 17 loaded 356 corporate bonds — a DELIBERATE, additive load, and the only thing that has
// touched this table since Step 16. So the Step-16 baseline is measured against the NON-BOND
// catalogue: subtract the class Step 17 added and the number must land back on Gate 0's 18,644.
// (Hardcoding `total === 18644` would now report a false regression every time a later step
// legitimately adds a class — which is exactly what it just did.)
const [bd] = await q(`SELECT COUNT(*) AS n FROM instruments WHERE asset_class = 'bond'`);
const nonBond = Number(t.n) - Number(bd.n);
const [f] = await q(`SELECT md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
  COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='mutual_fund'`);
const same = f.fp === "9a573df845df745ffe74277aff455734";
console.log(`\ncatalogue total       : ${Number(t.n)}  (= 18,644 + ${Number(bd.n)} bonds loaded by Step 17)`);
console.log(`  …minus Step-17 bonds: ${nonBond}  (Gate 0 measured 18,644 — unchanged: ${nonBond === 18644})`);
console.log(`instruments/MF md5    : ${f.fp}  (=== Gate-0 baseline: ${same})`);
console.log(`\n${same && nonBond === 18644
  ? "✅ PRE-EXISTING — the MF catalogue is byte-identical to Gate 0 and the non-bond census is unmoved.\n" +
    "   Step 16 wrote only the two family tables; Step 17 added ONLY the `bond` class. Neither can have\n" +
    "   caused any of the 8 Step-9 assertions to flip — they were red before both. (Step 9's harness\n" +
    "   asserts a Step-9-era world: 18,071 instruments and 0 ETFs. Step 13 ended that world.)"
  : "❌ REGRESSION — the catalogue moved in a way neither Step 16 nor Step 17 accounts for."}`);
await prisma.$disconnect();
