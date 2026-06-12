// ─────────────────────────────────────────────────────────────
// PEER GROUP SEED DATA
// 14 core (PG1–PG14) + 10 alternate (A1–A10) = 24 total
//
// All symbols in this file must already exist in the stocks
// table before seed-peer-groups.ts is run.
//
// buildOrder:
//   1–14   core groups (health score priority)
//   101–110 alternate groups (post-launch)
// ─────────────────────────────────────────────────────────────

export interface PeerGroupSeed {
  key: string;
  name: string;
  displayName: string;
  sectorKey: string; // → Sector.name
  buildOrder: number;
  stocks: string[]; // NSE symbols
}

export const PEER_GROUPS: PeerGroupSeed[] = [

  // ── Core Groups ────────────────────────────────────────────

  {
    key: "pg1_it_services",
    name: "Large-Cap IT Services",
    displayName: "Large-Cap IT Services",
    sectorKey: "it_technology",
    buildOrder: 1,
    stocks: ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM"],
  },
  {
    key: "pg2_fmcg",
    name: "Large-Cap FMCG",
    displayName: "Large-Cap FMCG",
    sectorKey: "fmcg_consumer",
    buildOrder: 2,
    stocks: [
      "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA",
      "DABUR", "GODREJCP", "TATACONSUM", "MARICO", "COLPAL",
    ],
  },
  {
    key: "pg3_pharma",
    name: "Large-Cap Pharma",
    displayName: "Large-Cap Pharma",
    sectorKey: "pharma_healthcare",
    buildOrder: 3,
    stocks: [
      "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB",
      "TORNTPHARM", "MANKIND", "ZYDUSLIFE", "LUPIN",
      "AUROPHARMA", "ALKEM",
    ],
  },
  {
    key: "pg4_auto_oem",
    name: "Large-Cap Auto OEMs",
    displayName: "Large-Cap Auto OEMs",
    sectorKey: "automobile",
    buildOrder: 4,
    stocks: [
      "MARUTI", "M&M", "TATAMOTORS", "BAJAJ-AUTO",
      "HEROMOTOCO", "TVSMOTOR", "EICHERMOT", "ASHOKLEY",
    ],
  },
  {
    key: "pg5_private_banks",
    name: "Large-Cap Private Banks",
    displayName: "Large-Cap Private Banks",
    sectorKey: "banks",
    buildOrder: 5,
    stocks: [
      "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK",
      "INDUSINDBK", "IDFCFIRSTB", "YESBANK",
    ],
  },
  {
    key: "pg6_psu_banks",
    name: "Large-Cap PSU Banks",
    displayName: "Large-Cap PSU Banks",
    sectorKey: "banks",
    buildOrder: 6,
    stocks: [
      "SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "INDIANB",
    ],
  },
  {
    key: "pg7_nbfc",
    name: "Large-Cap NBFCs",
    displayName: "Large-Cap NBFCs",
    sectorKey: "nbfc",
    buildOrder: 7,
    stocks: [
      "BAJFINANCE", "BAJAJFINSV", "SHRIRAMFIN", "CHOLAFIN",
      "MUTHOOTFIN", "JIOFIN", "PFC", "RECLTD",
    ],
  },
  {
    key: "pg8_power",
    name: "Large-Cap Power & Utilities",
    displayName: "Large-Cap Power & Utilities",
    sectorKey: "power",
    buildOrder: 8,
    stocks: [
      "NTPC", "POWERGRID", "ADANIPOWER", "TATAPOWER",
      "JSWENERGY", "ADANIGREEN", "NHPC",
    ],
  },
  {
    key: "pg9_metals",
    name: "Large-Cap Metals & Mining",
    displayName: "Large-Cap Metals & Mining",
    sectorKey: "metals_mining",
    buildOrder: 9,
    stocks: [
      "TATASTEEL", "JSWSTEEL", "JINDALSTEL", "HINDALCO",
      "VEDL", "COALINDIA", "NMDC", "APLAPOLLO",
    ],
  },
  {
    key: "pg10_oil_gas",
    name: "Large-Cap Oil & Gas",
    displayName: "Large-Cap Oil & Gas",
    sectorKey: "oil_gas_energy",
    buildOrder: 10,
    stocks: ["RELIANCE", "ONGC", "IOC", "BPCL", "HINDPETRO", "GAIL"],
  },
  {
    key: "pg11_capital_goods",
    name: "Large-Cap Capital Goods & Industrial",
    displayName: "Large-Cap Capital Goods & Industrial",
    sectorKey: "capital_goods_engineering",
    buildOrder: 11,
    // Bosch placed here, not in A6 (per "if not in Auto Ancillary" note)
    stocks: [
      "LT", "SIEMENS", "ABB", "BEL", "HAL",
      "CUMMINSIND", "THERMAX", "BOSCHLTD",
    ],
  },
  {
    key: "pg12_cement",
    name: "Large-Cap Cement",
    displayName: "Large-Cap Cement",
    sectorKey: "cement_construction",
    buildOrder: 12,
    stocks: [
      "ULTRACEMCO", "GRASIM", "SHREECEM",
      "AMBUJACEM", "ACC", "DALBHARAT", "JKCEMENT",
    ],
  },
  {
    key: "pg13_consumer_durables",
    name: "Large-Cap Consumer Durables & Electrical",
    displayName: "Large-Cap Consumer Durables & Electrical",
    sectorKey: "consumer_discretionary_retail",
    buildOrder: 13,
    stocks: [
      "HAVELLS", "VOLTAS", "WHIRLPOOL",
      "BLUESTARCO", "CROMPTON", "POLYCAB",
    ],
  },
  {
    key: "pg14_insurance",
    name: "Large-Cap Insurance",
    displayName: "Large-Cap Insurance",
    sectorKey: "insurance",
    buildOrder: 14,
    stocks: [
      "HDFCLIFE", "SBILIFE", "ICICIGI",
      "MFSL", "LICI", "ICICIPRULI",
    ],
  },

  // ── Alternate Groups ───────────────────────────────────────

  {
    key: "a1_retail_apparel",
    name: "Large-Cap Retail & Apparel",
    displayName: "Large-Cap Retail & Apparel",
    sectorKey: "consumer_discretionary_retail",
    buildOrder: 101,
    stocks: ["DMART", "TRENT", "TITAN", "ETERNAL", "PAGEIND"],
  },
  {
    key: "a2_real_estate",
    name: "Large-Cap Real Estate",
    displayName: "Large-Cap Real Estate",
    sectorKey: "real_estate",
    buildOrder: 102,
    stocks: ["DLF", "GODREJPROP", "LODHA", "OBEROIRLTY", "PRESTIGE"],
  },
  {
    key: "a3_paints",
    name: "Large-Cap Paints",
    displayName: "Large-Cap Paints",
    sectorKey: "consumer_discretionary_retail",
    buildOrder: 103,
    // Pidilite is in A5 Specialty Chemicals — better peer fit there
    stocks: ["ASIANPAINT", "BERGEPAINT", "KANSAINER"],
  },
  {
    key: "a4_telecom",
    name: "Large-Cap Telecom & Towers",
    displayName: "Large-Cap Telecom & Towers",
    sectorKey: "telecom",
    buildOrder: 104,
    stocks: ["BHARTIARTL", "INDUSTOWER", "IDEA", "TATACOMM"],
  },
  {
    key: "a5_specialty_chemicals",
    name: "Large-Cap Specialty Chemicals",
    displayName: "Large-Cap Specialty Chemicals",
    sectorKey: "chemicals_agrochemicals",
    buildOrder: 105,
    stocks: [
      "PIDILITIND", "SRF", "PIIND", "AARTIIND",
      "UPL", "DEEPAKNTR", "TATACHEM",
    ],
  },
  {
    key: "a6_auto_ancillary",
    name: "Large-Cap Auto Ancillaries",
    displayName: "Large-Cap Auto Ancillaries",
    sectorKey: "automobile",
    buildOrder: 106,
    // Bosch excluded (in PG11). TIINDIA added as ancillary.
    stocks: [
      "MOTHERSON", "BHARATFORG", "MRF", "TIINDIA",
      "EXIDEIND", "BALKRISIND", "APOLLOTYRE",
    ],
  },
  {
    key: "a7_defense",
    name: "Large-Cap Defense",
    displayName: "Large-Cap Defense",
    sectorKey: "capital_goods_engineering",
    buildOrder: 107,
    // HAL + BEL intentionally in both PG11 and A7 — schema supports M2M
    stocks: ["HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP"],
  },
  {
    key: "a8_hospitals",
    name: "Large-Cap Hospitals & Diagnostics",
    displayName: "Large-Cap Hospitals & Diagnostics",
    sectorKey: "pharma_healthcare",
    buildOrder: 108,
    stocks: ["APOLLOHOSP", "MAXHEALTH", "FORTIS", "LALPATHLAB", "METROPOLIS"],
  },
  {
    key: "a9_amc_exchanges",
    name: "Large-Cap AMCs & Exchanges",
    displayName: "Large-Cap AMCs & Exchanges",
    sectorKey: "capital_markets",
    buildOrder: 109,
    stocks: ["HDFCAMC", "BSE", "ANGELONE", "MCX", "NAM-INDIA", "UTIAMC"],
  },
  {
    key: "a10_housing_finance",
    name: "Large-Cap Housing Finance",
    displayName: "Large-Cap Housing Finance",
    sectorKey: "nbfc",
    buildOrder: 110,
    stocks: ["LICHSGFIN", "PNBHOUSING", "AAVAS", "CANFINHOME"],
  },
];
