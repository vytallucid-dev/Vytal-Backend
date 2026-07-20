// GROUND TRUTH: what does mf_analytics ACTUALLY hold for the IDCW plans whose slot contains a Bonus
// plan? My recon reproduces `growthBy` by iterating members in scheme_code order — but the fold
// iterates its `computed` array, whose order I have NOT verified. So the simulation cannot be trusted
// to say WHICH twin won. The stored values can: if these plans hold NULL while a live Growth plan
// sits in the same slot, the Bonus plan won and the defect is real and shipping.
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const rows = await prisma.$queryRawUnsafe<any[]>(`
  SELECT ma.scheme_code, left(m.scheme_name, 58) AS nm,
         ma.ret_1y::float8 r1y, ma.ret_3y_cagr::float8 r3y, ma.nav_points,
         ma.omissions->>'ret_1y' AS why
  FROM mf_analytics ma
  JOIN mf_family_members m ON m.scheme_code = ma.scheme_code
  WHERE ma.scheme_code IN
    ('103048','103049','103050','103051','103052','112341',
     '109720','109723','133264',
     '118736','118737','118738',
     '134545','134546','134548',
     '111743','111748')
  ORDER BY ma.scheme_code`);

console.log("\n═══ WHAT mf_analytics ACTUALLY HOLDS (the fold's real output) ═══\n");
for (const r of rows) {
  const p = (v: number | null) => (v === null ? "   NULL" : ((v * 100).toFixed(2) + "%").padStart(7));
  console.log(`  ${r.scheme_code}  r1y=${p(r.r1y)}  r3y=${p(r.r3y)}  navpts=${String(r.nav_points).padStart(5)}` +
    `  ${r.why ? `[${r.why}]` : ""}\n        "${r.nm}"`);
}

console.log("\n  READ IT LIKE THIS:");
console.log("    Nippon Money Market — 103048 is the GROWTH plan (live). 103049 is the BONUS plan (navpts 0).");
console.log("    If 103050/103051/103052/112341 (the IDCW plans) hold 103048's number, the Growth plan won");
console.log("    the last-writer race and the defect is LATENT. If they hold NULL, the BONUS plan won and");
console.log("    the defect is SHIPPING.\n");

await prisma.$disconnect();
