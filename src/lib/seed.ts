// lib/seed.ts
// ─────────────────────────────────────────────────────────────
// One-shot seed script for InvestIQ universe.
// Seeds in order: Sectors → Stocks → Peer Groups
//
// Run: npx ts-node prisma/seed.ts
// Or:  npx tsx prisma/seed.ts
//
// Idempotent: safe to re-run — uses upsert throughout.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";

// ── 1. SECTORS ────────────────────────────────────────────────
// 7 sectors from the universe file.
// healthScoreWeightages and thresholds are populated later
// when the health score engine is built.

const SECTORS: Array<{
  name: string;
  displayName: string;
}> = [
  { name: "Financials", displayName: "Financials" },
  { name: "Technology", displayName: "Technology" },
  { name: "Consumer", displayName: "Consumer" },
  { name: "Auto", displayName: "Auto" },
  { name: "Healthcare", displayName: "Healthcare" },
  { name: "Energy & Materials", displayName: "Energy & Materials" },
  { name: "Industrials & Infra", displayName: "Industrials & Infra" },
];

// ── 2. PEER GROUPS ────────────────────────────────────────────
// 27 peer groups across 7 sectors.
// buildOrder matches the Excel "Build Order" column —
// use it to sequence your peer-group analysis chats.

const PEER_GROUPS: Array<{
  name: string;
  displayName: string;
  sectorName: string;
  buildOrder: number;
}> = [
  // Financials
  {
    name: "Large-Cap Private Banks",
    displayName: "Large-Cap Private Banks",
    sectorName: "Financials",
    buildOrder: 7,
  },
  {
    name: "PSU Banks",
    displayName: "PSU Banks",
    sectorName: "Financials",
    buildOrder: 8,
  },
  {
    name: "NBFCs — Lending",
    displayName: "NBFCs — Lending",
    sectorName: "Financials",
    buildOrder: 9,
  },
  {
    name: "Housing Finance",
    displayName: "Housing Finance",
    sectorName: "Financials",
    buildOrder: 10,
  },
  {
    name: "Life Insurance",
    displayName: "Life Insurance",
    sectorName: "Financials",
    buildOrder: 11,
  },
  {
    name: "AMCs & Exchanges",
    displayName: "AMCs & Exchanges",
    sectorName: "Financials",
    buildOrder: 12,
  },
  // Technology
  {
    name: "Large-Cap IT Services",
    displayName: "Large-Cap IT Services",
    sectorName: "Technology",
    buildOrder: 1,
  },
  {
    name: "Mid-Cap IT Services",
    displayName: "Mid-Cap IT Services",
    sectorName: "Technology",
    buildOrder: 2,
  },
  // Consumer
  {
    name: "Large-Cap FMCG",
    displayName: "Large-Cap FMCG",
    sectorName: "Consumer",
    buildOrder: 3,
  },
  {
    name: "Food & Beverages",
    displayName: "Food & Beverages",
    sectorName: "Consumer",
    buildOrder: 4,
  },
  {
    name: "Paints",
    displayName: "Paints",
    sectorName: "Consumer",
    buildOrder: 5,
  },
  {
    name: "Consumer Durables",
    displayName: "Consumer Durables",
    sectorName: "Consumer",
    buildOrder: 6,
  },
  {
    name: "Retail & Apparel",
    displayName: "Retail & Apparel",
    sectorName: "Consumer",
    buildOrder: 13,
  },
  // Auto
  {
    name: "Auto OEMs — 4W & CV",
    displayName: "Auto OEMs — 4W & CV",
    sectorName: "Auto",
    buildOrder: 14,
  },
  {
    name: "Auto OEMs — 2W",
    displayName: "Auto OEMs — 2W",
    sectorName: "Auto",
    buildOrder: 15,
  },
  {
    name: "Auto Ancillaries",
    displayName: "Auto Ancillaries",
    sectorName: "Auto",
    buildOrder: 16,
  },
  // Healthcare
  {
    name: "Large-Cap Pharma",
    displayName: "Large-Cap Pharma",
    sectorName: "Healthcare",
    buildOrder: 17,
  },
  {
    name: "Mid-Cap Pharma",
    displayName: "Mid-Cap Pharma",
    sectorName: "Healthcare",
    buildOrder: 18,
  },
  {
    name: "Hospitals & Diagnostics",
    displayName: "Hospitals & Diagnostics",
    sectorName: "Healthcare",
    buildOrder: 19,
  },
  // Energy & Materials
  {
    name: "O&G — Integrated",
    displayName: "O&G — Integrated",
    sectorName: "Energy & Materials",
    buildOrder: 20,
  },
  {
    name: "Power",
    displayName: "Power",
    sectorName: "Energy & Materials",
    buildOrder: 21,
  },
  {
    name: "Ferrous Metals",
    displayName: "Ferrous Metals",
    sectorName: "Energy & Materials",
    buildOrder: 22,
  },
  {
    name: "Non-Ferrous & Mining",
    displayName: "Non-Ferrous & Mining",
    sectorName: "Energy & Materials",
    buildOrder: 23,
  },
  {
    name: "Cement",
    displayName: "Cement",
    sectorName: "Energy & Materials",
    buildOrder: 24,
  },
  // Industrials & Infra
  {
    name: "Capital Goods",
    displayName: "Capital Goods",
    sectorName: "Industrials & Infra",
    buildOrder: 25,
  },
  {
    name: "Defense",
    displayName: "Defense",
    sectorName: "Industrials & Infra",
    buildOrder: 26,
  },
  {
    name: "Real Estate",
    displayName: "Real Estate",
    sectorName: "Industrials & Infra",
    buildOrder: 27,
  },
];

// ── 3. STOCKS ─────────────────────────────────────────────────
// 150 stocks with NSE symbols, display names, sector,
// peer group, and market cap category.

const STOCKS: Array<{
  symbol: string;
  name: string;
  sectorName: string;
  peerGroupName: string;
  marketCapCategory: "large_cap" | "mid_cap" | "small_cap";
  buildOrder: number;
}> = [
  // ── Technology — Large-Cap IT Services (buildOrder: 1) ──
  {
    symbol: "TCS",
    name: "Tata Consultancy Services Limited",
    sectorName: "Technology",
    peerGroupName: "Large-Cap IT Services",
    marketCapCategory: "large_cap",
    buildOrder: 1,
  },
  {
    symbol: "INFY",
    name: "Infosys Limited",
    sectorName: "Technology",
    peerGroupName: "Large-Cap IT Services",
    marketCapCategory: "large_cap",
    buildOrder: 1,
  },
  {
    symbol: "WIPRO",
    name: "Wipro Limited",
    sectorName: "Technology",
    peerGroupName: "Large-Cap IT Services",
    marketCapCategory: "large_cap",
    buildOrder: 1,
  },
  {
    symbol: "HCLTECH",
    name: "HCL Technologies Limited",
    sectorName: "Technology",
    peerGroupName: "Large-Cap IT Services",
    marketCapCategory: "large_cap",
    buildOrder: 1,
  },
  {
    symbol: "TECHM",
    name: "Tech Mahindra Limited",
    sectorName: "Technology",
    peerGroupName: "Large-Cap IT Services",
    marketCapCategory: "large_cap",
    buildOrder: 1,
  },
  {
    symbol: "LTIM",
    name: "LTIMindtree Limited",
    sectorName: "Technology",
    peerGroupName: "Large-Cap IT Services",
    marketCapCategory: "large_cap",
    buildOrder: 1,
  },
  // ── Technology — Mid-Cap IT Services (buildOrder: 2) ──
  {
    symbol: "PERSISTENT",
    name: "Persistent Systems Limited",
    sectorName: "Technology",
    peerGroupName: "Mid-Cap IT Services",
    marketCapCategory: "mid_cap",
    buildOrder: 2,
  },
  {
    symbol: "COFORGE",
    name: "Coforge Limited",
    sectorName: "Technology",
    peerGroupName: "Mid-Cap IT Services",
    marketCapCategory: "mid_cap",
    buildOrder: 2,
  },
  {
    symbol: "MPHASIS",
    name: "Mphasis Limited",
    sectorName: "Technology",
    peerGroupName: "Mid-Cap IT Services",
    marketCapCategory: "mid_cap",
    buildOrder: 2,
  },
  {
    symbol: "LTTS",
    name: "L&T Technology Services Limited",
    sectorName: "Technology",
    peerGroupName: "Mid-Cap IT Services",
    marketCapCategory: "mid_cap",
    buildOrder: 2,
  },
  {
    symbol: "KPITTECH",
    name: "KPIT Technologies Limited",
    sectorName: "Technology",
    peerGroupName: "Mid-Cap IT Services",
    marketCapCategory: "mid_cap",
    buildOrder: 2,
  },
  // ── Consumer — Large-Cap FMCG (buildOrder: 3) ──
  {
    symbol: "HINDUNILVR",
    name: "Hindustan Unilever Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "large_cap",
    buildOrder: 3,
  },
  {
    symbol: "NESTLEIND",
    name: "Nestle India Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "large_cap",
    buildOrder: 3,
  },
  {
    symbol: "ITC",
    name: "ITC Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "large_cap",
    buildOrder: 3,
  },
  {
    symbol: "BRITANNIA",
    name: "Britannia Industries Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "large_cap",
    buildOrder: 3,
  },
  {
    symbol: "DABUR",
    name: "Dabur India Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "large_cap",
    buildOrder: 3,
  },
  {
    symbol: "MARICO",
    name: "Marico Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "mid_cap",
    buildOrder: 3,
  },
  {
    symbol: "COLPAL",
    name: "Colgate-Palmolive (India) Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "mid_cap",
    buildOrder: 3,
  },
  {
    symbol: "GODREJCP",
    name: "Godrej Consumer Products Limited",
    sectorName: "Consumer",
    peerGroupName: "Large-Cap FMCG",
    marketCapCategory: "large_cap",
    buildOrder: 3,
  },
  // ── Consumer — Food & Beverages (buildOrder: 4) ──
  {
    symbol: "TATACONSUM",
    name: "Tata Consumer Products Limited",
    sectorName: "Consumer",
    peerGroupName: "Food & Beverages",
    marketCapCategory: "large_cap",
    buildOrder: 4,
  },
  {
    symbol: "VBL",
    name: "Varun Beverages Limited",
    sectorName: "Consumer",
    peerGroupName: "Food & Beverages",
    marketCapCategory: "large_cap",
    buildOrder: 4,
  },
  {
    symbol: "UBL",
    name: "United Breweries Limited",
    sectorName: "Consumer",
    peerGroupName: "Food & Beverages",
    marketCapCategory: "mid_cap",
    buildOrder: 4,
  },
  {
    symbol: "MCDOWELL-N",
    name: "United Spirits Limited",
    sectorName: "Consumer",
    peerGroupName: "Food & Beverages",
    marketCapCategory: "mid_cap",
    buildOrder: 4,
  },
  // ── Consumer — Paints (buildOrder: 5) ──
  {
    symbol: "ASIANPAINT",
    name: "Asian Paints Limited",
    sectorName: "Consumer",
    peerGroupName: "Paints",
    marketCapCategory: "large_cap",
    buildOrder: 5,
  },
  {
    symbol: "BERGEPAINT",
    name: "Berger Paints India Limited",
    sectorName: "Consumer",
    peerGroupName: "Paints",
    marketCapCategory: "mid_cap",
    buildOrder: 5,
  },
  {
    symbol: "KANSAINER",
    name: "Kansai Nerolac Paints Limited",
    sectorName: "Consumer",
    peerGroupName: "Paints",
    marketCapCategory: "mid_cap",
    buildOrder: 5,
  },
  {
    symbol: "INDIGOPNTS",
    name: "Indigo Paints Limited",
    sectorName: "Consumer",
    peerGroupName: "Paints",
    marketCapCategory: "small_cap",
    buildOrder: 5,
  },
  {
    symbol: "AKZOINDIA",
    name: "Akzo Nobel India Limited",
    sectorName: "Consumer",
    peerGroupName: "Paints",
    marketCapCategory: "small_cap",
    buildOrder: 5,
  },
  // ── Consumer — Consumer Durables (buildOrder: 6) ──
  {
    symbol: "HAVELLS",
    name: "Havells India Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "large_cap",
    buildOrder: 6,
  },
  {
    symbol: "VOLTAS",
    name: "Voltas Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "mid_cap",
    buildOrder: 6,
  },
  {
    symbol: "WHIRLPOOL",
    name: "Whirlpool of India Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "mid_cap",
    buildOrder: 6,
  },
  {
    symbol: "BLUESTAR",
    name: "Blue Star Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "mid_cap",
    buildOrder: 6,
  },
  {
    symbol: "CROMPTON",
    name: "Crompton Greaves Consumer Electricals Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "mid_cap",
    buildOrder: 6,
  },
  {
    symbol: "ORIENTELEC",
    name: "Orient Electric Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "small_cap",
    buildOrder: 6,
  },
  {
    symbol: "SYMPHONY",
    name: "Symphony Limited",
    sectorName: "Consumer",
    peerGroupName: "Consumer Durables",
    marketCapCategory: "small_cap",
    buildOrder: 6,
  },
  // ── Financials — Large-Cap Private Banks (buildOrder: 7) ──
  {
    symbol: "HDFCBANK",
    name: "HDFC Bank Limited",
    sectorName: "Financials",
    peerGroupName: "Large-Cap Private Banks",
    marketCapCategory: "large_cap",
    buildOrder: 7,
  },
  {
    symbol: "ICICIBANK",
    name: "ICICI Bank Limited",
    sectorName: "Financials",
    peerGroupName: "Large-Cap Private Banks",
    marketCapCategory: "large_cap",
    buildOrder: 7,
  },
  {
    symbol: "AXISBANK",
    name: "Axis Bank Limited",
    sectorName: "Financials",
    peerGroupName: "Large-Cap Private Banks",
    marketCapCategory: "large_cap",
    buildOrder: 7,
  },
  {
    symbol: "KOTAKBANK",
    name: "Kotak Mahindra Bank Limited",
    sectorName: "Financials",
    peerGroupName: "Large-Cap Private Banks",
    marketCapCategory: "large_cap",
    buildOrder: 7,
  },
  {
    symbol: "INDUSINDBK",
    name: "IndusInd Bank Limited",
    sectorName: "Financials",
    peerGroupName: "Large-Cap Private Banks",
    marketCapCategory: "large_cap",
    buildOrder: 7,
  },
  {
    symbol: "FEDERALBNK",
    name: "The Federal Bank Limited",
    sectorName: "Financials",
    peerGroupName: "Large-Cap Private Banks",
    marketCapCategory: "mid_cap",
    buildOrder: 7,
  },
  // ── Financials — PSU Banks (buildOrder: 8) ──
  {
    symbol: "SBIN",
    name: "State Bank of India",
    sectorName: "Financials",
    peerGroupName: "PSU Banks",
    marketCapCategory: "large_cap",
    buildOrder: 8,
  },
  {
    symbol: "BANKBARODA",
    name: "Bank of Baroda",
    sectorName: "Financials",
    peerGroupName: "PSU Banks",
    marketCapCategory: "large_cap",
    buildOrder: 8,
  },
  {
    symbol: "PNB",
    name: "Punjab National Bank",
    sectorName: "Financials",
    peerGroupName: "PSU Banks",
    marketCapCategory: "mid_cap",
    buildOrder: 8,
  },
  {
    symbol: "CANBK",
    name: "Canara Bank",
    sectorName: "Financials",
    peerGroupName: "PSU Banks",
    marketCapCategory: "mid_cap",
    buildOrder: 8,
  },
  {
    symbol: "UNIONBANK",
    name: "Union Bank of India",
    sectorName: "Financials",
    peerGroupName: "PSU Banks",
    marketCapCategory: "mid_cap",
    buildOrder: 8,
  },
  {
    symbol: "INDIANB",
    name: "Indian Bank",
    sectorName: "Financials",
    peerGroupName: "PSU Banks",
    marketCapCategory: "mid_cap",
    buildOrder: 8,
  },
  // ── Financials — NBFCs — Lending (buildOrder: 9) ──
  {
    symbol: "BAJFINANCE",
    name: "Bajaj Finance Limited",
    sectorName: "Financials",
    peerGroupName: "NBFCs — Lending",
    marketCapCategory: "large_cap",
    buildOrder: 9,
  },
  {
    symbol: "SHRIRAMFIN",
    name: "Shriram Finance Limited",
    sectorName: "Financials",
    peerGroupName: "NBFCs — Lending",
    marketCapCategory: "large_cap",
    buildOrder: 9,
  },
  {
    symbol: "CHOLAFIN",
    name: "Cholamandalam Investment and Finance Company Limited",
    sectorName: "Financials",
    peerGroupName: "NBFCs — Lending",
    marketCapCategory: "large_cap",
    buildOrder: 9,
  },
  {
    symbol: "M&MFIN",
    name: "Mahindra & Mahindra Financial Services Limited",
    sectorName: "Financials",
    peerGroupName: "NBFCs — Lending",
    marketCapCategory: "mid_cap",
    buildOrder: 9,
  },
  {
    symbol: "MUTHOOTFIN",
    name: "Muthoot Finance Limited",
    sectorName: "Financials",
    peerGroupName: "NBFCs — Lending",
    marketCapCategory: "mid_cap",
    buildOrder: 9,
  },
  {
    symbol: "SUNDARMFIN",
    name: "Sundaram Finance Limited",
    sectorName: "Financials",
    peerGroupName: "NBFCs — Lending",
    marketCapCategory: "mid_cap",
    buildOrder: 9,
  },
  // ── Financials — Housing Finance (buildOrder: 10) ──
  {
    symbol: "LICHSGFIN",
    name: "LIC Housing Finance Limited",
    sectorName: "Financials",
    peerGroupName: "Housing Finance",
    marketCapCategory: "mid_cap",
    buildOrder: 10,
  },
  {
    symbol: "PNBHOUSING",
    name: "PNB Housing Finance Limited",
    sectorName: "Financials",
    peerGroupName: "Housing Finance",
    marketCapCategory: "mid_cap",
    buildOrder: 10,
  },
  {
    symbol: "AAVAS",
    name: "Aavas Financiers Limited",
    sectorName: "Financials",
    peerGroupName: "Housing Finance",
    marketCapCategory: "small_cap",
    buildOrder: 10,
  },
  {
    symbol: "CANFINHOME",
    name: "Can Fin Homes Limited",
    sectorName: "Financials",
    peerGroupName: "Housing Finance",
    marketCapCategory: "small_cap",
    buildOrder: 10,
  },
  // ── Financials — Life Insurance (buildOrder: 11) ──
  {
    symbol: "HDFCLIFE",
    name: "HDFC Life Insurance Company Limited",
    sectorName: "Financials",
    peerGroupName: "Life Insurance",
    marketCapCategory: "large_cap",
    buildOrder: 11,
  },
  {
    symbol: "SBILIFE",
    name: "SBI Life Insurance Company Limited",
    sectorName: "Financials",
    peerGroupName: "Life Insurance",
    marketCapCategory: "large_cap",
    buildOrder: 11,
  },
  {
    symbol: "ICICIPRULI",
    name: "ICICI Prudential Life Insurance Company Limited",
    sectorName: "Financials",
    peerGroupName: "Life Insurance",
    marketCapCategory: "large_cap",
    buildOrder: 11,
  },
  {
    symbol: "LICI",
    name: "Life Insurance Corporation of India",
    sectorName: "Financials",
    peerGroupName: "Life Insurance",
    marketCapCategory: "large_cap",
    buildOrder: 11,
  },
  // ── Financials — AMCs & Exchanges (buildOrder: 12) ──
  {
    symbol: "HDFCAMC",
    name: "HDFC Asset Management Company Limited",
    sectorName: "Financials",
    peerGroupName: "AMCs & Exchanges",
    marketCapCategory: "mid_cap",
    buildOrder: 12,
  },
  {
    symbol: "NAM-INDIA",
    name: "Nippon Life India Asset Management Limited",
    sectorName: "Financials",
    peerGroupName: "AMCs & Exchanges",
    marketCapCategory: "mid_cap",
    buildOrder: 12,
  },
  {
    symbol: "UTIAMC",
    name: "UTI Asset Management Company Limited",
    sectorName: "Financials",
    peerGroupName: "AMCs & Exchanges",
    marketCapCategory: "mid_cap",
    buildOrder: 12,
  },
  {
    symbol: "BSE",
    name: "BSE Limited",
    sectorName: "Financials",
    peerGroupName: "AMCs & Exchanges",
    marketCapCategory: "mid_cap",
    buildOrder: 12,
  },
  {
    symbol: "ANGELONE",
    name: "Angel One Limited",
    sectorName: "Financials",
    peerGroupName: "AMCs & Exchanges",
    marketCapCategory: "mid_cap",
    buildOrder: 12,
  },
  {
    symbol: "MOTILALOFS",
    name: "Motilal Oswal Financial Services Limited",
    sectorName: "Financials",
    peerGroupName: "AMCs & Exchanges",
    marketCapCategory: "mid_cap",
    buildOrder: 12,
  },
  // ── Consumer — Retail & Apparel (buildOrder: 13) ──
  {
    symbol: "DMART",
    name: "Avenue Supermarts Limited",
    sectorName: "Consumer",
    peerGroupName: "Retail & Apparel",
    marketCapCategory: "large_cap",
    buildOrder: 13,
  },
  {
    symbol: "TRENT",
    name: "Trent Limited",
    sectorName: "Consumer",
    peerGroupName: "Retail & Apparel",
    marketCapCategory: "large_cap",
    buildOrder: 13,
  },
  {
    symbol: "TITAN",
    name: "Titan Company Limited",
    sectorName: "Consumer",
    peerGroupName: "Retail & Apparel",
    marketCapCategory: "large_cap",
    buildOrder: 13,
  },
  {
    symbol: "PAGEIND",
    name: "Page Industries Limited",
    sectorName: "Consumer",
    peerGroupName: "Retail & Apparel",
    marketCapCategory: "mid_cap",
    buildOrder: 13,
  },
  // ── Auto — 4W & CV (buildOrder: 14) ──
  {
    symbol: "MARUTI",
    name: "Maruti Suzuki India Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 4W & CV",
    marketCapCategory: "large_cap",
    buildOrder: 14,
  },
  {
    symbol: "M&M",
    name: "Mahindra and Mahindra Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 4W & CV",
    marketCapCategory: "large_cap",
    buildOrder: 14,
  },
  {
    symbol: "TATAMOTORS",
    name: "Tata Motors Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 4W & CV",
    marketCapCategory: "large_cap",
    buildOrder: 14,
  },
  {
    symbol: "ASHOKLEY",
    name: "Ashok Leyland Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 4W & CV",
    marketCapCategory: "mid_cap",
    buildOrder: 14,
  },
  // ── Auto — 2W (buildOrder: 15) ──
  {
    symbol: "BAJAJ-AUTO",
    name: "Bajaj Auto Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 2W",
    marketCapCategory: "large_cap",
    buildOrder: 15,
  },
  {
    symbol: "HEROMOTOCO",
    name: "Hero MotoCorp Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 2W",
    marketCapCategory: "large_cap",
    buildOrder: 15,
  },
  {
    symbol: "TVSMOTOR",
    name: "TVS Motor Company Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 2W",
    marketCapCategory: "large_cap",
    buildOrder: 15,
  },
  {
    symbol: "EICHERMOT",
    name: "Eicher Motors Limited",
    sectorName: "Auto",
    peerGroupName: "Auto OEMs — 2W",
    marketCapCategory: "large_cap",
    buildOrder: 15,
  },
  // ── Auto — Ancillaries (buildOrder: 16) ──
  {
    symbol: "BOSCHLTD",
    name: "Bosch Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  {
    symbol: "MOTHERSON",
    name: "Samvardhana Motherson International Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "large_cap",
    buildOrder: 16,
  },
  {
    symbol: "BHARATFORG",
    name: "Bharat Forge Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  {
    symbol: "EXIDEIND",
    name: "Exide Industries Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  {
    symbol: "MRF",
    name: "MRF Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  {
    symbol: "APOLLOTYRE",
    name: "Apollo Tyres Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  {
    symbol: "BALKRISIND",
    name: "Balkrishna Industries Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  {
    symbol: "SUNDRMFAST",
    name: "Sundram Fasteners Limited",
    sectorName: "Auto",
    peerGroupName: "Auto Ancillaries",
    marketCapCategory: "mid_cap",
    buildOrder: 16,
  },
  // ── Healthcare — Large-Cap Pharma (buildOrder: 17) ──
  {
    symbol: "SUNPHARMA",
    name: "Sun Pharmaceutical Industries Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "large_cap",
    buildOrder: 17,
  },
  {
    symbol: "DRREDDY",
    name: "Dr. Reddy's Laboratories Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "large_cap",
    buildOrder: 17,
  },
  {
    symbol: "CIPLA",
    name: "Cipla Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "large_cap",
    buildOrder: 17,
  },
  {
    symbol: "DIVISLAB",
    name: "Divi's Laboratories Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "large_cap",
    buildOrder: 17,
  },
  {
    symbol: "LUPIN",
    name: "Lupin Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "large_cap",
    buildOrder: 17,
  },
  {
    symbol: "AUROPHARMA",
    name: "Aurobindo Pharma Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 17,
  },
  {
    symbol: "TORNTPHARM",
    name: "Torrent Pharmaceuticals Limited",
    sectorName: "Healthcare",
    peerGroupName: "Large-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 17,
  },
  // ── Healthcare — Mid-Cap Pharma (buildOrder: 18) ──
  {
    symbol: "GLENMARK",
    name: "Glenmark Pharmaceuticals Limited",
    sectorName: "Healthcare",
    peerGroupName: "Mid-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 18,
  },
  {
    symbol: "IPCALAB",
    name: "Ipca Laboratories Limited",
    sectorName: "Healthcare",
    peerGroupName: "Mid-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 18,
  },
  {
    symbol: "MANKIND",
    name: "Mankind Pharma Limited",
    sectorName: "Healthcare",
    peerGroupName: "Mid-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 18,
  },
  {
    symbol: "ALKEM",
    name: "Alkem Laboratories Limited",
    sectorName: "Healthcare",
    peerGroupName: "Mid-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 18,
  },
  {
    symbol: "ZYDUSLIFE",
    name: "Zydus Lifesciences Limited",
    sectorName: "Healthcare",
    peerGroupName: "Mid-Cap Pharma",
    marketCapCategory: "mid_cap",
    buildOrder: 18,
  },
  // ── Healthcare — Hospitals & Diagnostics (buildOrder: 19) ──
  {
    symbol: "APOLLOHOSP",
    name: "Apollo Hospitals Enterprise Limited",
    sectorName: "Healthcare",
    peerGroupName: "Hospitals & Diagnostics",
    marketCapCategory: "large_cap",
    buildOrder: 19,
  },
  {
    symbol: "MAXHEALTH",
    name: "Max Healthcare Institute Limited",
    sectorName: "Healthcare",
    peerGroupName: "Hospitals & Diagnostics",
    marketCapCategory: "mid_cap",
    buildOrder: 19,
  },
  {
    symbol: "FORTIS",
    name: "Fortis Healthcare Limited",
    sectorName: "Healthcare",
    peerGroupName: "Hospitals & Diagnostics",
    marketCapCategory: "mid_cap",
    buildOrder: 19,
  },
  {
    symbol: "LALPATHLAB",
    name: "Dr. Lal Pathlabs Limited",
    sectorName: "Healthcare",
    peerGroupName: "Hospitals & Diagnostics",
    marketCapCategory: "mid_cap",
    buildOrder: 19,
  },
  {
    symbol: "METROPOLIS",
    name: "Metropolis Healthcare Limited",
    sectorName: "Healthcare",
    peerGroupName: "Hospitals & Diagnostics",
    marketCapCategory: "mid_cap",
    buildOrder: 19,
  },
  // ── Energy & Materials — O&G Integrated (buildOrder: 20) ──
  {
    symbol: "RELIANCE",
    name: "Reliance Industries Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "O&G — Integrated",
    marketCapCategory: "large_cap",
    buildOrder: 20,
  },
  {
    symbol: "ONGC",
    name: "Oil and Natural Gas Corporation Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "O&G — Integrated",
    marketCapCategory: "large_cap",
    buildOrder: 20,
  },
  {
    symbol: "IOC",
    name: "Indian Oil Corporation Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "O&G — Integrated",
    marketCapCategory: "large_cap",
    buildOrder: 20,
  },
  {
    symbol: "BPCL",
    name: "Bharat Petroleum Corporation Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "O&G — Integrated",
    marketCapCategory: "large_cap",
    buildOrder: 20,
  },
  {
    symbol: "HINDPETRO",
    name: "Hindustan Petroleum Corporation Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "O&G — Integrated",
    marketCapCategory: "large_cap",
    buildOrder: 20,
  },
  // ── Energy & Materials — Power (buildOrder: 21) ──
  {
    symbol: "NTPC",
    name: "NTPC Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Power",
    marketCapCategory: "large_cap",
    buildOrder: 21,
  },
  {
    symbol: "POWERGRID",
    name: "Power Grid Corporation of India Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Power",
    marketCapCategory: "large_cap",
    buildOrder: 21,
  },
  {
    symbol: "TATAPOWER",
    name: "Tata Power Company Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Power",
    marketCapCategory: "mid_cap",
    buildOrder: 21,
  },
  {
    symbol: "ADANIPOWER",
    name: "Adani Power Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Power",
    marketCapCategory: "large_cap",
    buildOrder: 21,
  },
  {
    symbol: "JSWENERGY",
    name: "JSW Energy Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Power",
    marketCapCategory: "mid_cap",
    buildOrder: 21,
  },
  {
    symbol: "NHPC",
    name: "NHPC Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Power",
    marketCapCategory: "mid_cap",
    buildOrder: 21,
  },
  // ── Energy & Materials — Ferrous Metals (buildOrder: 22) ──
  {
    symbol: "TATASTEEL",
    name: "Tata Steel Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Ferrous Metals",
    marketCapCategory: "large_cap",
    buildOrder: 22,
  },
  {
    symbol: "JSWSTEEL",
    name: "JSW Steel Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Ferrous Metals",
    marketCapCategory: "large_cap",
    buildOrder: 22,
  },
  {
    symbol: "SAIL",
    name: "Steel Authority of India Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Ferrous Metals",
    marketCapCategory: "mid_cap",
    buildOrder: 22,
  },
  {
    symbol: "JINDALSTEL",
    name: "Jindal Steel & Power Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Ferrous Metals",
    marketCapCategory: "mid_cap",
    buildOrder: 22,
  },
  {
    symbol: "APLAPOLLO",
    name: "APL Apollo Tubes Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Ferrous Metals",
    marketCapCategory: "mid_cap",
    buildOrder: 22,
  },
  // ── Energy & Materials — Non-Ferrous & Mining (buildOrder: 23) ──
  {
    symbol: "HINDALCO",
    name: "Hindalco Industries Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Non-Ferrous & Mining",
    marketCapCategory: "large_cap",
    buildOrder: 23,
  },
  {
    symbol: "VEDL",
    name: "Vedanta Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Non-Ferrous & Mining",
    marketCapCategory: "large_cap",
    buildOrder: 23,
  },
  {
    symbol: "NMDC",
    name: "NMDC Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Non-Ferrous & Mining",
    marketCapCategory: "mid_cap",
    buildOrder: 23,
  },
  {
    symbol: "COALINDIA",
    name: "Coal India Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Non-Ferrous & Mining",
    marketCapCategory: "large_cap",
    buildOrder: 23,
  },
  {
    symbol: "NATIONALUM",
    name: "National Aluminium Company Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Non-Ferrous & Mining",
    marketCapCategory: "mid_cap",
    buildOrder: 23,
  },
  // ── Energy & Materials — Cement (buildOrder: 24) ──
  {
    symbol: "ULTRACEMCO",
    name: "UltraTech Cement Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "large_cap",
    buildOrder: 24,
  },
  {
    symbol: "SHREECEM",
    name: "Shree Cement Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "large_cap",
    buildOrder: 24,
  },
  {
    symbol: "AMBUJACEM",
    name: "Ambuja Cements Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "large_cap",
    buildOrder: 24,
  },
  {
    symbol: "ACC",
    name: "ACC Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "mid_cap",
    buildOrder: 24,
  },
  {
    symbol: "DALBHARAT",
    name: "Dalmia Bharat Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "mid_cap",
    buildOrder: 24,
  },
  {
    symbol: "JKCEMENT",
    name: "JK Cement Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "mid_cap",
    buildOrder: 24,
  },
  {
    symbol: "RAMCOCEM",
    name: "The Ramco Cements Limited",
    sectorName: "Energy & Materials",
    peerGroupName: "Cement",
    marketCapCategory: "mid_cap",
    buildOrder: 24,
  },
  // ── Industrials & Infra — Capital Goods (buildOrder: 25) ──
  {
    symbol: "LT",
    name: "Larsen & Toubro Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Capital Goods",
    marketCapCategory: "large_cap",
    buildOrder: 25,
  },
  {
    symbol: "SIEMENS",
    name: "Siemens Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Capital Goods",
    marketCapCategory: "large_cap",
    buildOrder: 25,
  },
  {
    symbol: "ABB",
    name: "ABB India Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Capital Goods",
    marketCapCategory: "large_cap",
    buildOrder: 25,
  },
  {
    symbol: "CUMMINSIND",
    name: "Cummins India Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Capital Goods",
    marketCapCategory: "mid_cap",
    buildOrder: 25,
  },
  {
    symbol: "THERMAX",
    name: "Thermax Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Capital Goods",
    marketCapCategory: "mid_cap",
    buildOrder: 25,
  },
  {
    symbol: "HONAUT",
    name: "Honeywell Automation India Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Capital Goods",
    marketCapCategory: "mid_cap",
    buildOrder: 25,
  },
  // ── Industrials & Infra — Defense (buildOrder: 26) ──
  {
    symbol: "HAL",
    name: "Hindustan Aeronautics Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Defense",
    marketCapCategory: "large_cap",
    buildOrder: 26,
  },
  {
    symbol: "BEL",
    name: "Bharat Electronics Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Defense",
    marketCapCategory: "large_cap",
    buildOrder: 26,
  },
  {
    symbol: "BEML",
    name: "BEML Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Defense",
    marketCapCategory: "mid_cap",
    buildOrder: 26,
  },
  {
    symbol: "MAZDOCK",
    name: "Mazagon Dock Shipbuilders Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Defense",
    marketCapCategory: "mid_cap",
    buildOrder: 26,
  },
  {
    symbol: "BDL",
    name: "Bharat Dynamics Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Defense",
    marketCapCategory: "mid_cap",
    buildOrder: 26,
  },
  // ── Industrials & Infra — Real Estate (buildOrder: 27) ──
  {
    symbol: "DLF",
    name: "DLF Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "large_cap",
    buildOrder: 27,
  },
  {
    symbol: "GODREJPROP",
    name: "Godrej Properties Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "large_cap",
    buildOrder: 27,
  },
  {
    symbol: "OBEROIRLTY",
    name: "Oberoi Realty Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "mid_cap",
    buildOrder: 27,
  },
  {
    symbol: "LODHA",
    name: "Macrotech Developers Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "large_cap",
    buildOrder: 27,
  },
  {
    symbol: "PRESTIGE",
    name: "Prestige Estates Projects Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "mid_cap",
    buildOrder: 27,
  },
  {
    symbol: "SOBHA",
    name: "Sobha Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "mid_cap",
    buildOrder: 27,
  },
  {
    symbol: "BRIGADE",
    name: "Brigade Enterprises Limited",
    sectorName: "Industrials & Infra",
    peerGroupName: "Real Estate",
    marketCapCategory: "mid_cap",
    buildOrder: 27,
  },
];

// ── Seed function ──────────────────────────────────────────────

async function seed() {
  console.log("🌱 Starting InvestIQ universe seed...");
  console.log(
    `   Sectors: ${SECTORS.length} | Peer Groups: ${PEER_GROUPS.length} | Stocks: ${STOCKS.length}`,
  );
  console.log();

  // ── Step 1: Seed Sectors ─────────────────────────────────
  console.log("📁 Step 1: Seeding sectors...");

  const sectorMap = new Map<string, string>(); // name → id

  for (const sector of SECTORS) {
    const result = await prisma.sector.upsert({
      where: { name: sector.name },
      create: {
        name: sector.name,
        displayName: sector.displayName,
        stockCount: 0,
      },
      update: {
        displayName: sector.displayName,
      },
    });
    sectorMap.set(sector.name, result.id);
    console.log(`   ✓ ${sector.displayName} (${result.id.slice(0, 8)}…)`);
  }

  console.log(`   ✅ ${SECTORS.length} sectors seeded\n`);

  // ── Step 2: Seed Peer Groups ─────────────────────────────
  console.log("📂 Step 2: Seeding peer groups...");

  const peerGroupMap = new Map<string, string>(); // name → id

  for (const pg of PEER_GROUPS) {
    const sectorId = sectorMap.get(pg.sectorName);
    if (!sectorId) throw new Error(`Sector not found: ${pg.sectorName}`);

    const result = await prisma.peerGroup.upsert({
      where: { sectorId_name: { sectorId, name: pg.name } },
      create: {
        name: pg.name,
        displayName: pg.displayName,
        sectorId,
        buildOrder: pg.buildOrder,
        stockCount: 0,
      },
      update: {
        displayName: pg.displayName,
        buildOrder: pg.buildOrder,
      },
    });
    peerGroupMap.set(pg.name, result.id);
    console.log(`   ✓ ${pg.displayName} → ${pg.sectorName}`);
  }

  console.log(`   ✅ ${PEER_GROUPS.length} peer groups seeded\n`);

  // ── Step 3: Seed Stocks ──────────────────────────────────
  console.log("📈 Step 3: Seeding stocks...");

  const stockMap = new Map<string, string>(); // symbol → id

  for (const stock of STOCKS) {
    const sectorId = sectorMap.get(stock.sectorName);
    if (!sectorId) throw new Error(`Sector not found: ${stock.sectorName}`);

    const result = await prisma.stock.upsert({
      where: { symbol: stock.symbol },
      create: {
        symbol: stock.symbol,
        name: stock.name,
        sectorId,
        exchange: "NSE",
        marketCapCategory: stock.marketCapCategory,
        isActive: true,
      },
      update: {
        name: stock.name,
        sectorId,
        marketCapCategory: stock.marketCapCategory,
        isActive: true,
      },
    });
    stockMap.set(stock.symbol, result.id);
  }

  console.log(`   ✅ ${STOCKS.length} stocks seeded\n`);

  // ── Step 4: Link stocks to peer groups ───────────────────
  console.log("🔗 Step 4: Linking stocks to peer groups...");

  for (const stock of STOCKS) {
    const stockId = stockMap.get(stock.symbol);
    const peerGroupId = peerGroupMap.get(stock.peerGroupName);

    if (!stockId || !peerGroupId) {
      throw new Error(
        `Missing ID for ${stock.symbol} or peer group ${stock.peerGroupName}`,
      );
    }

    await prisma.stockPeerGroup.upsert({
      where: { stockId_peerGroupId: { stockId, peerGroupId } },
      create: { stockId, peerGroupId },
      update: {},
    });
  }

  console.log(`   ✅ ${STOCKS.length} stock-peer group links created\n`);

  // ── Step 5: Update stock counts ──────────────────────────
  console.log("🔢 Step 5: Updating stock counts...");

  for (const [name, sectorId] of sectorMap) {
    const count = await prisma.stock.count({ where: { sectorId } });
    await prisma.sector.update({
      where: { id: sectorId },
      data: { stockCount: count },
    });
  }

  for (const [name, peerGroupId] of peerGroupMap) {
    const count = await prisma.stockPeerGroup.count({ where: { peerGroupId } });
    await prisma.peerGroup.update({
      where: { id: peerGroupId },
      data: { stockCount: count },
    });
  }

  console.log("   ✅ Stock counts updated\n");

  // ── Summary ───────────────────────────────────────────────
  console.log("═══════════════════════════════════════");
  console.log("✅ Seed complete!");
  console.log();

  // Print final breakdown
  const sectors = await prisma.sector.findMany({
    include: {
      peerGroups: {
        include: { _count: { select: { stocks: true } } },
      },
      _count: { select: { stocks: true } },
    },
    orderBy: { name: "asc" },
  });

  for (const sector of sectors) {
    console.log(`${sector.displayName} (${sector._count.stocks} stocks)`);
    for (const pg of sector.peerGroups) {
      console.log(`  └─ ${pg.displayName}: ${pg._count.stocks} stocks`);
    }
  }

  console.log();
  console.log("═══════════════════════════════════════");
  console.log();
  console.log("📋 Build order for peer-group analysis:");
  const peerGroupsByOrder = await prisma.peerGroup.findMany({
    where: { buildOrder: { not: null } },
    orderBy: { buildOrder: "asc" },
    include: {
      sector: { select: { displayName: true } },
      stocks: { include: { stock: { select: { symbol: true } } } },
    },
  });

  for (const pg of peerGroupsByOrder) {
    const symbols = pg.stocks.map((s) => s.stock.symbol).join(", ");
    console.log(
      `  #${pg.buildOrder?.toString().padStart(2, "0")} ${pg.displayName} (${pg.sector.displayName})`,
    );
    console.log(`       Symbols: ${symbols}`);
  }
}

seed()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
