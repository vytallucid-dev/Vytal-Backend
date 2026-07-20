// CONSTRUCTION v2 — STAGE 2 — GATE 0 RECON (read-only). Confirms the sectoredShare ordering premise:
// today ONLY stocks carry a sector; every non-stock is sector:null (Stage 4 resolves them). So a
// sectoredShare computed now would be a partial value that Stage 4 silently changes → defer.
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { natureOf } from "../portfolio/phs/entity.js";

(async () => {
  const users = await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id FROM transactions`);
  for (const u of users) {
    const { holdings } = await assemblePortfolio(u.user_id);
    const r = computePhs(holdings);
    const withSector = holdings.filter((h) => h.sector != null).length;
    const nonStockWithSector = holdings.filter((h) => h.sector != null && h.assetClass !== "stock").length;
    const natures: Record<string, number> = {};
    for (const h of holdings) { const n = natureOf(h.assetClass ?? "?", h.category ?? null); natures[n] = (natures[n] ?? 0) + 1; }
    console.log(`${u.user_id.slice(0, 8)} | health ${r.health} | holdings ${holdings.length} | withSector ${withSector} | nonStockWithSector ${nonStockWithSector} | natures ${JSON.stringify(natures)}`);
  }
  await prisma.$disconnect();
})();
