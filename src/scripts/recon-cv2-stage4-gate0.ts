// CONSTRUCTION v2 — STAGE 4 — GATE 0 RECON (read-only). Sector resolution into THREE states, and the
// gate that runs over the SECTORABLE population (not the whole book). Prototypes the classifier to
// measure the live shape; builds nothing.
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { natureOf } from "../portfolio/phs/entity.js";

const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

type SectorState = "resolved" | "unknown" | "not_applicable";
// INTERIM (§14 matcher not built): stocks + resolved-issuer bonds are `resolved`; a null-sector stock
// is `unknown`; EVERYTHING else — funds/ETFs (incl thematic), sovereign, commodity, reit/invit, and
// UNRESOLVED-issuer bonds — is `not_applicable`. `sector` here is the RESOLVED value (stock's own, or a
// bond's inherited issuer sector), else null.
function sectorStateOf(assetClass: string, sector: string | null): SectorState {
  if (assetClass === "stock") return sector != null ? "resolved" : "unknown";
  if (assetClass === "bond") return sector != null ? "resolved" : "not_applicable"; // unresolved issuer = OUR gap
  return "not_applicable"; // reit/invit/gsec/sgb/etf/mutual_fund (interim)
}

async function main() {
  // ═══ item 1 · STOCK SECTOR PATH ═══
  const stockSec = (await q<{ total: number; null_sector: number; distinct_sectors: number }>(`
    SELECT count(*)::int total, count(*) FILTER (WHERE sector_id IS NULL)::int null_sector,
           count(DISTINCT sector_id)::int distinct_sectors FROM stocks`))[0];
  console.log("═══ 1 · STOCK SECTOR ═══\n" + j(stockSec));

  // ═══ item 2 · BOND ISSUER → SECTOR (191 catalogued vs ≤191 SCORED) ═══
  const bondMatch = (await q<{ bonds_to_catalogued: number; issuers_catalogued: number; bonds_to_scored: number; issuers_scored: number }>(`
    WITH bstem AS (SELECT id, substring(isin,1,7) stem FROM instruments WHERE asset_class='bond'),
         scored AS (SELECT DISTINCT stock_id FROM score_snapshots)
    SELECT
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM stocks s WHERE substring(s.isin,1,7)=b.stem))::int bonds_to_catalogued,
      count(DISTINCT b.stem) FILTER (WHERE EXISTS (SELECT 1 FROM stocks s WHERE substring(s.isin,1,7)=b.stem))::int issuers_catalogued,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM stocks s JOIN scored sc ON sc.stock_id=s.id WHERE substring(s.isin,1,7)=b.stem))::int bonds_to_scored,
      count(DISTINCT b.stem) FILTER (WHERE EXISTS (SELECT 1 FROM stocks s JOIN scored sc ON sc.stock_id=s.id WHERE substring(s.isin,1,7)=b.stem))::int issuers_scored
    FROM bstem b`))[0];
  console.log("\n═══ 2 · BOND ISSUER → SECTOR (the decision) ═══\n" + j(bondMatch));
  // every catalogued match has a sector (504/504 populated), so bonds_to_catalogued == bonds that CAN inherit a sector.
  const catWithSector = (await q<{ n: number }>(`
    SELECT count(*)::int n FROM instruments b WHERE b.asset_class='bond'
      AND EXISTS (SELECT 1 FROM stocks s WHERE substring(s.isin,1,7)=substring(b.isin,1,7) AND s.sector_id IS NOT NULL)`))[0];
  console.log(`bonds whose catalogued issuer HAS a sector: ${catWithSector.n}`);

  // ═══ item 3 · UNRESOLVED-ISSUER BONDS → not_applicable ═══
  const unresolved = (await q<{ n: number }>(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND attributes->>'issuerNullReason'='not_in_our_universe'`))[0];
  console.log(`\n═══ 3 · UNRESOLVED-ISSUER BONDS (name-risk, sector not_applicable): ${unresolved.n}`);

  // ═══ item 4 · FUND CATEGORIES — thematic identifiable now (all not_applicable in interim) ═══
  const fundCats = await q<{ asset_class: string; category: string | null; n: number }>(`
    SELECT asset_class::text, category, count(*)::int n FROM instruments
    WHERE asset_class IN ('mutual_fund','etf') AND (category ILIKE '%sector%' OR category ILIKE '%thematic%')
    GROUP BY 1,2 ORDER BY n DESC`);
  console.log("\n═══ 4 · SECTORAL/THEMATIC fund categories (identifiable for §14; not_applicable in interim) ═══\n" + j(fundCats));

  // ═══ item 5 · not_applicable INVENTORY — nothing falls through to unknown ═══
  const inventory = await q<{ asset_class: string; n: number }>(`SELECT asset_class::text, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`);
  console.log("\n═══ 5 · not_applicable INVENTORY (interim: everything except stock + resolved-bond) ═══\n" + j(inventory));

  // ═══ items 6+7 · LIVE SHAPE — prototype the classifier over the 5 users ═══
  // stem → sector map for bond issuer inheritance (from ALL catalogued stocks).
  const stocks = await prisma.stock.findMany({ select: { isin: true, sector: { select: { name: true } } } });
  const stemSector = new Map<string, string | null>();
  for (const s of stocks) if (s.isin) stemSector.set(s.isin.slice(0, 7), s.sector?.name ?? null);

  console.log("\n═══ 6+7 · LIVE SHAPE + the gate (C3_UNKNOWN_KILL = 0.50) ═══");
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);
  for (const u of users) {
    const { holdings } = await assemblePortfolio(u.user_id);
    const r = computePhs(holdings);
    const totalValue = r.totalValue;
    let resolvedV = 0, unknownV = 0, naV = 0, resolvedN = 0, unknownN = 0, naN = 0;
    for (const h of holdings) {
      // resolve sector: stock → its own; bond → inherited issuer sector; else null.
      const sector = h.assetClass === "stock" ? (h.sector ?? null)
        : h.assetClass === "bond" ? (stemSector.get((h.isin ?? "").slice(0, 7)) ?? null) : null;
      const st = sectorStateOf(h.assetClass ?? "?", sector);
      if (st === "resolved") { resolvedV += h.marketValue; resolvedN++; }
      else if (st === "unknown") { unknownV += h.marketValue; unknownN++; }
      else { naV += h.marketValue; naN++; }
    }
    const sectorableV = resolvedV + unknownV;
    const unknownRatio = sectorableV > 0 ? unknownV / sectorableV : 0;
    const sectoredShare = totalValue > 0 ? resolvedV / totalValue : 0; // WHOLE-BOOK denominator
    const gateOpen = unknownRatio <= 0.5;
    console.log(`${u.user_id.slice(0, 8)} | resolved ${resolvedN}(₹${resolvedV.toFixed(0)}) unknown ${unknownN}(₹${unknownV.toFixed(0)}) n/a ${naN}(₹${naV.toFixed(0)}) | sectorable ₹${sectorableV.toFixed(0)} | unknownRatio ${(unknownRatio * 100).toFixed(1)}% | sectoredShare ${(sectoredShare * 100).toFixed(1)}% | gate ${gateOpen ? "OPEN" : "KILLED"}`);
  }

  // ═══ item 9 · baselines ═══
  console.log("\n═══ 9 · baselines ═══");
  for (const u of users) {
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    console.log(`${u.user_id.slice(0, 8)} | health ${r.health} | gross ${r.gross.value.toFixed(2)}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
