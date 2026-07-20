/**
 * seed-sector-class.ts
 *
 * Idempotent: reads every sector from the DB, assigns sectorClass, upserts,
 * then prints the full table and any sectors left null for manual review.
 *
 * Run: npx tsx src/scripts/seed-sector-class.ts
 */

import { prisma } from "../db/prisma.js";
import { SectorClass } from "../generated/prisma/client.js";

// ── Canonical map: sector `name` (DB key) → SectorClass ───────────────────────
// The 20-sector fine seed (src/scripts/sectors.seed.ts) is what is live in the DB.
// The coarse keys below are retained defensively for any DB still carrying them;
// the legacy seed that produced them has been removed.
const CLASS_MAP: Record<string, SectorClass> = {
  // ── Fine-grained keys (sectors.seed.ts) ────────────────────────────────────
  it_technology:                  SectorClass.Quality,
  fmcg_consumer:                  SectorClass.Quality,    // FMCG-dominant; see null list for split note
  pharma_healthcare:              SectorClass.Quality,
  chemicals_agrochemicals:        SectorClass.Quality,    // Specialty Chemicals per spec
  consumer_discretionary_retail:  SectorClass.Cyclical,   // Discretionary, not staples
  automobile:                     SectorClass.Cyclical,
  capital_goods_engineering:      SectorClass.Cyclical,
  real_estate:                    SectorClass.Cyclical,
  logistics_infrastructure:       SectorClass.Cyclical,
  hospitality_travel:             SectorClass.Cyclical,
  nbfc:                           SectorClass.Cyclical,
  capital_markets:                SectorClass.Cyclical,
  power:                          SectorClass.Defensive,
  telecom:                        SectorClass.Defensive,
  oil_gas_energy:                 SectorClass.Commodity,
  metals_mining:                  SectorClass.Commodity,
  cement_construction:            SectorClass.Commodity,
  new_economy_internet:           SectorClass.Growth,
  banks:                          SectorClass.Cyclical,   // private-vs-PSU carried by scores/PG, not sector class
  insurance:                      SectorClass.Defensive,  // cashflows defensive regardless of LIC vs private

  // ── Coarse keys (legacy taxonomy; its seed is gone, kept for back-compat) ──
  Technology:                     SectorClass.Quality,
  Healthcare:                     SectorClass.Quality,
  Consumer:                       SectorClass.Quality,    // FMCG-dominant coarse bucket
  Auto:                           SectorClass.Cyclical,
  "Industrials & Infra":          SectorClass.Cyclical,
  // "Financials" and "Energy & Materials" → null (see REPORT)
};

async function main() {
  const sectors = await prisma.sector.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, displayName: true, sectorClass: true },
  });

  const nullSectors: string[] = [];
  const updated: { name: string; displayName: string; assigned: SectorClass }[] = [];
  const skipped: { name: string; displayName: string }[] = [];

  for (const s of sectors) {
    const cls = CLASS_MAP[s.name] ?? null;

    if (cls == null) {
      nullSectors.push(s.name);
      skipped.push({ name: s.name, displayName: s.displayName });
      continue;
    }

    await prisma.sector.update({
      where: { id: s.id },
      data: { sectorClass: cls },
    });
    updated.push({ name: s.name, displayName: s.displayName, assigned: cls });
  }

  // ── Full table ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  SECTOR → SECTOR CLASS TABLE");
  console.log("══════════════════════════════════════════════════════");
  for (const u of updated) {
    console.log(`  ✓  ${u.assigned.padEnd(10)}  ${u.displayName} (${u.name})`);
  }
  for (const s of skipped) {
    console.log(`  ✗  null        ${s.displayName} (${s.name})`);
  }

  // ── Null report ─────────────────────────────────────────────────────────────
  if (nullSectors.length > 0) {
    console.log("\n══════════════════════════════════════════════════════");
    console.log("  SECTORS LEFT NULL — NEEDS YOUR CALL");
    console.log("══════════════════════════════════════════════════════");
    if (nullSectors.includes("banks") || nullSectors.includes("Financials")) {
      console.log(
        "  banks / Financials — Private banks = Cyclical; PSU banks = PSU.\n" +
        "    The DB has a single 'banks' sector covering both sub-types.\n" +
        "    Options: (a) split into banks_private + banks_psu sectors,\n" +
        "    (b) assign Cyclical (private-dominant in Nifty 200 universe),\n" +
        "    (c) assign PSU if PSU banks dominate your universe.",
      );
    }
    if (nullSectors.includes("insurance")) {
      console.log(
        "  insurance — LIC (PSU / Defensive) vs private life/general (Defensive/Quality).\n" +
        "    Suggest: Defensive (insurance cashflows are defensive by nature).",
      );
    }
    if (nullSectors.includes("Energy & Materials")) {
      console.log(
        "  Energy & Materials (coarse) — covers Oil & Gas (Commodity) + Metals (Commodity)\n" +
        "    + Chemicals (Quality). Suggest: Commodity (dominant sub-sector).",
      );
    }
    for (const n of nullSectors.filter(
      (n) => !["banks", "insurance", "Financials", "Energy & Materials"].includes(n),
    )) {
      console.log(`  ${n} — no rule matched; please assign manually.`);
    }
  }

  console.log(`\n  Done: ${updated.length} assigned, ${skipped.length} left null.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
