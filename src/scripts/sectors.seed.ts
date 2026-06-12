// ─────────────────────────────────────────────────────────────
// SECTOR SEED DATA
//
// 20 sectors derived from the Nifty 200 categorisation.
// `name` is the canonical key (used for lookups, never shown to users).
// `displayName` is what the UI renders.
//
// Health score config (weightages, thresholds) is left null — populate
// per sector via a separate config tool. See health-score chat for that.
// ─────────────────────────────────────────────────────────────

export interface SectorSeed {
  name: string;
  displayName: string;
}

export const SECTORS: SectorSeed[] = [
  { name: "banks", displayName: "Banks" },
  { name: "nbfc", displayName: "NBFC & Others" },
  { name: "insurance", displayName: "Insurance" },
  { name: "capital_markets", displayName: "Capital Markets" },
  { name: "it_technology", displayName: "IT & Technology" },
  { name: "oil_gas_energy", displayName: "Oil, Gas & Energy" },
  { name: "power", displayName: "Power" },
  { name: "automobile", displayName: "Automobile" },
  { name: "fmcg_consumer", displayName: "FMCG & Consumer" },
  { name: "pharma_healthcare", displayName: "Pharma & Healthcare" },
  { name: "capital_goods_engineering", displayName: "Capital Goods & Engineering" },
  { name: "metals_mining", displayName: "Metals & Mining" },
  { name: "cement_construction", displayName: "Cement & Construction" },
  { name: "telecom", displayName: "Telecom" },
  { name: "real_estate", displayName: "Real Estate" },
  { name: "consumer_discretionary_retail", displayName: "Consumer Discretionary & Retail" },
  { name: "logistics_infrastructure", displayName: "Logistics & Infrastructure" },
  { name: "hospitality_travel", displayName: "Hospitality & Travel" },
  { name: "new_economy_internet", displayName: "New Economy & Internet" },
  { name: "chemicals_agrochemicals", displayName: "Chemicals & Agrochemicals" },
];

/** Map from spreadsheet sector label → canonical sector key */
export const SPREADSHEET_SECTOR_MAP: Record<string, string> = {
  "Financial Services - Banks": "banks",
  "Financial Services - NBFC & Others": "nbfc",
  "Financial Services - Insurance": "insurance",
  "Financial Services - Capital Markets": "capital_markets",
  "IT & Technology": "it_technology",
  "Oil, Gas & Energy": "oil_gas_energy",
  "Power": "power",
  "Automobile": "automobile",
  "FMCG & Consumer": "fmcg_consumer",
  "Pharma & Healthcare": "pharma_healthcare",
  "Capital Goods & Engineering": "capital_goods_engineering",
  "Metals & Mining": "metals_mining",
  "Cement & Construction": "cement_construction",
  "Telecom": "telecom",
  "Real Estate": "real_estate",
  "Consumer Discretionary & Retail": "consumer_discretionary_retail",
  "Logistics & Infrastructure": "logistics_infrastructure",
  "Hospitality & Travel": "hospitality_travel",
  "New Economy & Internet": "new_economy_internet",
  "Chemicals & Agrochemicals": "chemicals_agrochemicals",
};
