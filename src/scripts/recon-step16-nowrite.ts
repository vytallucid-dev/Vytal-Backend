// STEP 16 — GATE 0 PROOF: the recon wrote NOTHING. No family table, no family column, and the
// two baseline fingerprints are unchanged from the values Gate 3 will re-assert.
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

const t = await q(`SELECT table_name FROM information_schema.tables
                   WHERE table_schema='public' AND table_name ILIKE '%famil%'`);
const c = await q(`SELECT column_name FROM information_schema.columns
                   WHERE table_name='instruments' AND column_name ILIKE '%famil%'`);
console.log("family TABLES in DB          :", t.length ? J(t) : "(none — Gate 0 wrote nothing ✓)");
console.log("family COLUMNS on instruments:", c.length ? J(c) : "(none — Gate 0 wrote nothing ✓)");

console.log("\nBASELINE (to be re-asserted byte-identical at Gate 3):");
console.log("  instruments/MF :", J(await q(`
  SELECT COUNT(*) AS mf_rows, COUNT(DISTINCT amfi_scheme_code) AS codes,
    md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
        COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fingerprint
  FROM instruments WHERE asset_class='mutual_fund'`)));
console.log("  mf_analytics   :", J(await q(`SELECT COUNT(*) AS rows,
  md5(string_agg(scheme_code||'|'||COALESCE(ret_1y::text,''),'~' ORDER BY scheme_code)) AS fingerprint FROM mf_analytics`)));
await prisma.$disconnect();
