// ─────────────────────────────────────────────────────────────
// EXTRA STOCKS SEED DATA
//
// 19 stocks that are outside the Nifty 200 universe but are
// needed as peer benchmarks for health score sector deviation.
//
// These are created with isActive: false — they don't appear
// in the main screener or any user-facing universe list, but
// are available for peer group metric computation.
//
// Sectors these belong to must already exist in the DB
// (run seed-nifty200.ts first).
//
// verified: true  = confirmed NSE symbol, safe to seed
// verified: false = double-check on nseindia.com before going live
// ─────────────────────────────────────────────────────────────
export const EXTRA_STOCKS = [
  // ── Cement & Construction (PG12) ───────────────────────────
  {
    symbol: "DALBHARAT",
    name: "Dalmia Bharat Ltd",
    sectorKey: "cement_construction",
    verified: true,
    peerContext: "PG12 — Large-Cap Cement",
  },
  {
    symbol: "JKCEMENT",
    name: "JK Cement Ltd",
    sectorKey: "cement_construction",
    verified: true,
    peerContext: "PG12 — Large-Cap Cement",
  },
  // ── Insurance (PG14) ───────────────────────────────────────
  {
    symbol: "LICI",
    name: "Life Insurance Corporation of India",
    sectorKey: "insurance",
    verified: true,
    peerContext: "PG14 — Large-Cap Insurance",
  },
  {
    symbol: "ICICIPRULI",
    name: "ICICI Prudential Life Insurance Co Ltd",
    sectorKey: "insurance",
    verified: true,
    peerContext: "PG14 — Large-Cap Insurance",
  },
  // ── Consumer Discretionary & Retail (A3 Paints) ───────────
  {
    symbol: "KANSAINER",
    name: "Kansai Nerolac Paints Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
    peerContext: "A3 — Large-Cap Paints",
  },
  // ── Chemicals & Agrochemicals (A5 Specialty Chemicals) ─────
  {
    symbol: "DEEPAKNTR",
    name: "Deepak Nitrite Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
    peerContext: "A5 — Large-Cap Specialty Chemicals",
  },
  {
    symbol: "TATACHEM",
    name: "Tata Chemicals Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
    peerContext: "A5 — Large-Cap Specialty Chemicals",
  },
  // ── Automobile (A6 Auto Ancillaries) ──────────────────────
  {
    symbol: "EXIDEIND",
    name: "Exide Industries Ltd",
    sectorKey: "automobile",
    verified: true,
    peerContext: "A6 — Large-Cap Auto Ancillaries",
  },
  {
    symbol: "BALKRISIND",
    name: "Balkrishna Industries Ltd",
    sectorKey: "automobile",
    verified: true,
    peerContext: "A6 — Large-Cap Auto Ancillaries",
  },
  {
    symbol: "APOLLOTYRE",
    name: "Apollo Tyres Ltd",
    sectorKey: "automobile",
    verified: true,
    peerContext: "A6 — Large-Cap Auto Ancillaries",
  },
  // ── Capital Goods & Engineering (A7 Defense) ──────────────
  {
    symbol: "COCHINSHIP",
    name: "Cochin Shipyard Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
    peerContext: "A7 — Large-Cap Defense",
  },
  // ── Pharma & Healthcare (A8 Hospitals & Diagnostics) ───────
  {
    symbol: "LALPATHLAB",
    name: "Dr Lal PathLabs Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
    peerContext: "A8 — Large-Cap Hospitals & Diagnostics",
  },
  {
    symbol: "METROPOLIS",
    name: "Metropolis Healthcare Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
    peerContext: "A8 — Large-Cap Hospitals & Diagnostics",
  },
  // ── Capital Markets (A9 AMCs & Exchanges) ─────────────────
  {
    symbol: "NAM-INDIA",
    name: "Nippon Life India Asset Management Ltd",
    sectorKey: "capital_markets",
    // NOTE: NSE uses a hyphen in this ticker. Confirm on nseindia.com.
    // If your codebase does string matching on symbols, ensure hyphens
    // are handled — most Indian fintechs normalise to NAMINDIA or similar.
    verified: true,
    peerContext: "A9 — Large-Cap AMCs & Exchanges",
  },
  {
    symbol: "UTIAMC",
    name: "UTI Asset Management Company Ltd",
    sectorKey: "capital_markets",
    verified: true,
    peerContext: "A9 — Large-Cap AMCs & Exchanges",
  },
  // ── NBFC (A10 Housing Finance) ─────────────────────────────
  {
    symbol: "LICHSGFIN",
    name: "LIC Housing Finance Ltd",
    sectorKey: "nbfc",
    verified: true,
    peerContext: "A10 — Large-Cap Housing Finance",
  },
  {
    symbol: "PNBHOUSING",
    name: "PNB Housing Finance Ltd",
    sectorKey: "nbfc",
    verified: true,
    peerContext: "A10 — Large-Cap Housing Finance",
  },
  {
    symbol: "AAVAS",
    name: "Aavas Financiers Ltd",
    sectorKey: "nbfc",
    verified: true,
    peerContext: "A10 — Large-Cap Housing Finance",
  },
  {
    symbol: "CANFINHOME",
    name: "Can Fin Homes Ltd",
    sectorKey: "nbfc",
    verified: true,
    peerContext: "A10 — Large-Cap Housing Finance",
  },
];
