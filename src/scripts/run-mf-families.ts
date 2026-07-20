// Derive the MF/ETF family grouping (Step 16). Re-runnable: full replace, one transaction.
// Reads the catalogue; writes ONLY mf_families + mf_family_members. Never touches `instruments`.
//
//   npx tsx src/scripts/run-mf-families.ts
import { prisma } from "../db/prisma.js";
import { deriveFamilies } from "../ingestions/amfi/derive-families.js";

console.log("── deriving MF families ──");
const t0 = Date.now();
const report = await deriveFamilies();
console.log(`── done in ${((Date.now() - t0) / 1000).toFixed(1)}s ──`);
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
