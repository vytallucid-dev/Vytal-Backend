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

// An explicit, VISIBLE gated state for a PG whose CORRECTED roster cannot be applied
// yet because one or more confirmed peers are not in the Stock table. Analogous to the
// dispatch layer's BANK_DATA_PIPELINE_PENDING — never a silent absence. A gated PG keeps
// its OLD stocks[] (do NOT seed a partial/wrong corrected roster); the reconcile + seed
// scripts SKIP it, and roster-status.ts surfaces it. `intendedRoster` is the confirmed
// corrected set to apply once `missingStocks` land in the DB (a later milestone).
export const ROSTER_PENDING_STOCK_DATA = "pending_stock_data_ingestion";

export interface RosterGate {
  status: typeof ROSTER_PENDING_STOCK_DATA;
  missingStocks: string[]; // confirmed peers NOT yet in the Stock table — block correction
  intendedRoster: string[]; // the spec-confirmed corrected roster (apply once stocks land)
  note?: string;
}

export interface PeerGroupSeed {
  key: string;
  name: string;
  displayName: string;
  sectorKey: string; // → Sector.name
  buildOrder: number;
  stocks: string[]; // NSE symbols
  gated?: RosterGate; // present ⇒ roster correction is BLOCKED on stock-data ingestion
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
    // ROSTER FIX 2026-06-18: −ALKEM +GLENMARK. ALKEM was a Layer-A derivation-pool
    // member wrongly seeded as a scored peer; GLENMARK is the confirmed §B.9 peer.
    stocks: [
      "SUNPHARMA", "CIPLA", "DRREDDY", "LUPIN", "AUROPHARMA",
      "TORNTPHARM", "ZYDUSLIFE", "DIVISLAB", "GLENMARK", "MANKIND",
    ],
  },
  {
    key: "pg4_auto_oem",
    name: "Large-Cap Auto OEMs",
    displayName: "Large-Cap Auto OEMs",
    sectorKey: "automobile",
    buildOrder: 4,
    // ROSTER FIX 2026-06-18: −TATAMOTORS. Tata Motors was a Layer-A derivation-pool
    // member, not a scored OEM peer in §B.9. Confirmed roster = 7.
    stocks: [
      "MARUTI", "M&M", "BAJAJ-AUTO", "HEROMOTOCO",
      "EICHERMOT", "TVSMOTOR", "ASHOKLEY",
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
    // 7 derivation peers per the locked PG8 Rev4 cohort. ADANIGREEN was a
    // sector-adjacent BENCHMARK constituent (12-constituent benchmark = 7 peers + 5
    // adjacent incl AGEL), not a peer — it was wrongly seeded as a member. TORNTPOWER
    // is the real 7th peer (in the LB per-stock means / §B.9 7-col Foundation table,
    // and an SSCU Pool-1 stock with TataPower). Bars were derived WITH TorrentPower, so
    // this matches roster→bars (CN-8 clean — not a cohort change).
    stocks: [
      "NTPC", "POWERGRID", "ADANIPOWER", "TATAPOWER",
      "JSWENERGY", "NHPC", "TORNTPOWER",
    ],
  },
  {
    key: "pg9_metals",
    name: "Large-Cap Metals & Mining",
    displayName: "Large-Cap Metals & Mining",
    sectorKey: "metals_mining",
    buildOrder: 9,
    // ROSTER FIX 2026-06-18: −COALINDIA,NMDC,APLAPOLLO +SAIL,NATIONALUM,HINDZINC.
    // The removed three (coal miner, iron-ore miner, steel-tube maker) were Layer-A
    // derivation-pool members polluting the peer mean; SAIL/NATIONALUM/HINDZINC are the
    // confirmed §B.9 integrated metals peers. Confirmed roster = 8.
    stocks: [
      "TATASTEEL", "JSWSTEEL", "JINDALSTEL", "SAIL",
      "HINDALCO", "VEDL", "NATIONALUM", "HINDZINC",
    ],
  },
  {
    key: "pg10_oil_gas",
    name: "Large-Cap Oil & Gas",
    displayName: "Large-Cap Oil & Gas",
    sectorKey: "oil_gas_energy",
    buildOrder: 10,
    // ROSTER UNBLOCKED 2026-06-19: +OIL +PETRONET (PETRONET ingested). Confirmed roster = 8.
    // (OIL was already in the DB; PETRONET — Petronet LNG — now is.)
    stocks: ["RELIANCE", "ONGC", "OIL", "IOC", "BPCL", "HINDPETRO", "GAIL", "PETRONET"],
  },
  {
    key: "pg11_capital_goods",
    name: "Large-Cap Capital Goods & Industrial",
    displayName: "Large-Cap Capital Goods & Industrial",
    sectorKey: "capital_goods_engineering",
    buildOrder: 11,
    // ROSTER UNBLOCKED 2026-06-19: −BEL −HAL −BOSCHLTD +BHEL +POWERINDIA +HONAUT → 8.
    // (HONAUT ingested; BHEL/POWERINDIA already in DB. BEL/HAL move to PG14 Defense;
    // BOSCHLTD belongs in A6 Auto Ancillaries.)
    stocks: [
      "ABB", "SIEMENS", "CUMMINSIND", "THERMAX",
      "LT", "BHEL", "POWERINDIA", "HONAUT",
    ],
  },
  {
    key: "pg12_cement",
    name: "Large-Cap Cement",
    displayName: "Large-Cap Cement",
    sectorKey: "cement_construction",
    buildOrder: 12,
    // ROSTER UNBLOCKED 2026-06-19: −GRASIM +RAMCOCEM → 7 (RAMCOCEM ingested).
    // (GRASIM is a diversified conglomerate, not a pure-play cement peer.)
    stocks: [
      "ULTRACEMCO", "AMBUJACEM", "ACC", "SHREECEM",
      "DALBHARAT", "JKCEMENT", "RAMCOCEM",
    ],
  },
  {
    key: "pg13_consumer_durables",
    name: "Large-Cap Consumer Durables & Electrical",
    displayName: "Large-Cap Consumer Durables & Electrical",
    sectorKey: "consumer_discretionary_retail",
    buildOrder: 13,
    // ROSTER FIX 2026-06-18: −WHIRLPOOL +DIXON. Whirlpool was a Layer-A derivation-pool
    // member; DIXON is the confirmed §B.9 consumer-durables/electronics peer.
    stocks: [
      "HAVELLS", "POLYCAB", "VOLTAS",
      "CROMPTON", "BLUESTARCO", "DIXON",
    ],
  },
  {
    // STRUCTURAL RE-KEY 2026-06-19 (Insurance→Defense): the spec's PG14 is DEFENSE, not
    // Insurance. GRSE now ingested → unblocked. This slot is now the canonical Large-Cap
    // Defense group. The DB-side reconcile PROMOTES the existing a7_defense row (which
    // already holds (capital_goods_engineering, "Large-Cap Defense") + 5 of these 7) to
    // buildOrder 14, adds GRSE+SOLARINDS, and RETIRES the old Insurance row. The separate
    // a7_defense seed entry is removed (its identity is subsumed here) to avoid the
    // @@unique([sectorId,name]) collision. (BEL/HAL arrive from PG11.)
    key: "pg14_defense",
    name: "Large-Cap Defense",
    displayName: "Large-Cap Defense",
    sectorKey: "capital_goods_engineering",
    buildOrder: 14,
    stocks: [
      "HAL", "BEL", "BDL", "MAZDOCK",
      "COCHINSHIP", "GRSE", "SOLARINDS",
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
  // a7_defense REMOVED 2026-06-19 — promoted to the core Large-Cap Defense group
  // (pg14_defense, buildOrder 14) when PG14 was re-keyed Insurance→Defense. Keeping a
  // separate alternate entry with the same (sectorKey,name) would violate
  // @@unique([sectorId,name]).
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
