// File: src/scoring/findings/section2/class-group.ts
//
// The ratified sector→class map (Aman, LOCKED) + the §2-Line-2 6→3 class-group collapse.
// SectorClass (6) is the stored Sector.sectorClass; §2 Line 2 interprets via 3 GROUPS:
//   A = Quality + Defensive   (a strong floor historically means a calmer ride)
//   B = Commodity + Cyclical + PSU (solvent THROUGH the cycle, not calm)
//   C = Growth                (the story drives the ride; the floor caps structural risk)

import type { SectorClass } from "../types.js";

export type ClassGroup = "A" | "B" | "C";

/** RATIFIED sector(name) → SectorClass map. Used by the idempotent seed. PSU has zero
 *  sectors (inert). Any DB sector NOT here would seed null → §2 Line2/F1 null (flagged). */
export const RATIFIED_SECTOR_CLASS: Record<string, SectorClass> = {
  it_technology: "Quality", fmcg_consumer: "Quality", pharma_healthcare: "Quality", chemicals_agrochemicals: "Quality",
  power: "Defensive", telecom: "Defensive", insurance: "Defensive",
  cement_construction: "Commodity", metals_mining: "Commodity", oil_gas_energy: "Commodity",
  automobile: "Cyclical", banks: "Cyclical", capital_goods_engineering: "Cyclical", capital_markets: "Cyclical",
  consumer_discretionary_retail: "Cyclical", hospitality_travel: "Cyclical", logistics_infrastructure: "Cyclical",
  nbfc: "Cyclical", real_estate: "Cyclical",
  new_economy_internet: "Growth",
};

/** §2-Line-2 collapse: 6 classes → 3 interpretation groups. */
export function classGroupOf(sectorClass: SectorClass | null): ClassGroup | null {
  switch (sectorClass) {
    case "Quality":
    case "Defensive":
      return "A";
    case "Commodity":
    case "Cyclical":
    case "PSU":
      return "B";
    case "Growth":
      return "C";
    default:
      return null; // unmapped sector → §2 Line 2 cannot interpret (flagged upstream)
  }
}
