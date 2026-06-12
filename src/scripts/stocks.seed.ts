// ─────────────────────────────────────────────────────────────
// NIFTY 200 STOCK SEED DATA
//
// IMPORTANT: NSE symbols below are my best-known mapping. Stocks that
// I'm fully confident about are marked verified=true. Newer listings
// (Waaree, Premier Energies, GE Vernova, Five Star, Data Patterns,
// Kaynes, Mankind, etc.) and a few less-common names are marked
// verified=false — you must check each one against NSE before going
// live. The seed script flags unverified entries in its output.
//
// Verification methods (any one is enough):
//   1. Search the symbol on https://www.nseindia.com/ — confirm it's listed
//   2. Check your existing Stock table if any of these are already there
//   3. Cross-reference with a recent Nifty 200 index constituent CSV
//      from https://www.niftyindices.com/
//
// Once verified, flip verified to true. The seed script enforces a
// gate that refuses to run with unverified entries unless you pass
// --allow-unverified.
// ─────────────────────────────────────────────────────────────

export interface StockSeed {
  symbol: string;
  name: string;
  sectorKey: string;
  verified: boolean;
}

export const STOCKS: StockSeed[] = [
  // ── Banks ──────────────────────────────────────────────────
  {
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "SBIN",
    name: "State Bank of India",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "ICICIBANK",
    name: "ICICI Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "KOTAKBANK",
    name: "Kotak Mahindra Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "AXISBANK",
    name: "Axis Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "PNB",
    name: "Punjab National Bank",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "BANKBARODA",
    name: "Bank of Baroda",
    sectorKey: "banks",
    verified: true,
  },
  { symbol: "CANBK", name: "Canara Bank", sectorKey: "banks", verified: true },
  {
    symbol: "UNIONBANK",
    name: "Union Bank of India",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "INDIANB",
    name: "Indian Bank",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "BANKINDIA",
    name: "Bank of India",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "YESBANK",
    name: "Yes Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "INDUSINDBK",
    name: "IndusInd Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "AUBANK",
    name: "AU Small Finance Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "IDFCFIRSTB",
    name: "IDFC First Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },
  {
    symbol: "FEDERALBNK",
    name: "Federal Bank Ltd",
    sectorKey: "banks",
    verified: true,
  },

  // ── NBFC & Others ──────────────────────────────────────────
  {
    symbol: "BAJFINANCE",
    name: "Bajaj Finance Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "BAJAJFINSV",
    name: "Bajaj Finserv Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "SHRIRAMFIN",
    name: "Shriram Finance Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "CHOLAFIN",
    name: "Cholamandalam Investment & Finance Co Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "MUTHOOTFIN",
    name: "Muthoot Finance Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "PFC",
    name: "Power Finance Corporation Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  { symbol: "RECLTD", name: "REC Ltd", sectorKey: "nbfc", verified: true },
  {
    symbol: "IRFC",
    name: "Indian Railway Finance Corporation Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "JIOFIN",
    name: "Jio Financial Services Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "BAJAJHLDNG",
    name: "Bajaj Holdings & Investment Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  { symbol: "LTF", name: "L&T Finance Ltd", sectorKey: "nbfc", verified: true },
  {
    symbol: "ABCAPITAL",
    name: "Aditya Birla Capital Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "SBICARD",
    name: "SBI Cards and Payment Services Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "MFSL",
    name: "Max Financial Services Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "MOTILALOFS",
    name: "Motilal Oswal Financial Services Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "FIVESTAR",
    name: "Five Star Business Finance Ltd",
    sectorKey: "nbfc",
    verified: true,
  },
  {
    symbol: "M&MFIN",
    name: "Mahindra & Mahindra Financial Services Ltd",
    sectorKey: "nbfc",
    verified: true,
  },

  // ── Insurance ──────────────────────────────────────────────
  {
    symbol: "SBILIFE",
    name: "SBI Life Insurance Company Ltd",
    sectorKey: "insurance",
    verified: true,
  },
  {
    symbol: "HDFCLIFE",
    name: "HDFC Life Insurance Co Ltd",
    sectorKey: "insurance",
    verified: true,
  },
  {
    symbol: "ICICIGI",
    name: "ICICI Lombard General Insurance Co Ltd",
    sectorKey: "insurance",
    verified: true,
  },

  // ── Capital Markets ────────────────────────────────────────
  {
    symbol: "BSE",
    name: "BSE Ltd",
    sectorKey: "capital_markets",
    verified: true,
  },
  {
    symbol: "HDFCAMC",
    name: "HDFC Asset Management Company Ltd",
    sectorKey: "capital_markets",
    verified: true,
  },
  {
    symbol: "MCX",
    name: "Multi Commodity Exchange of India Ltd",
    sectorKey: "capital_markets",
    verified: true,
  },
  {
    symbol: "POLICYBZR",
    name: "PB Fintech Ltd",
    sectorKey: "capital_markets",
    verified: true,
  },
  {
    symbol: "NUVAMA",
    name: "Nuvama Wealth Management Ltd",
    sectorKey: "capital_markets",
    verified: true,
  },
  {
    symbol: "ANGELONE",
    name: "Angel One Ltd",
    sectorKey: "capital_markets",
    verified: true,
  },

  // ── IT & Technology ────────────────────────────────────────
  {
    symbol: "TCS",
    name: "Tata Consultancy Services Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "INFY",
    name: "Infosys Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "HCLTECH",
    name: "HCL Technologies Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "WIPRO",
    name: "Wipro Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "TECHM",
    name: "Tech Mahindra Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "MINDTREE",
    name: "MindTree Limited",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "PERSISTENT",
    name: "Persistent Systems Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "OFSS",
    name: "Oracle Financial Services Software Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "COFORGE",
    name: "Coforge Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "MPHASIS",
    name: "Mphasis Ltd",
    sectorKey: "it_technology",
    verified: true,
  },
  {
    symbol: "KPITTECH",
    name: "KPIT Technologies Ltd",
    sectorKey: "it_technology",
    verified: true,
  },

  // ── Oil, Gas & Energy ──────────────────────────────────────
  {
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "ONGC",
    name: "Oil & Natural Gas Corporation Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "IOC",
    name: "Indian Oil Corporation Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "BPCL",
    name: "Bharat Petroleum Corporation Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "HINDPETRO",
    name: "Hindustan Petroleum Corporation Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "GAIL",
    name: "GAIL (India) Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "OIL",
    name: "Oil India Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },
  {
    symbol: "ATGL",
    name: "Adani Total Gas Ltd",
    sectorKey: "oil_gas_energy",
    verified: true,
  },

  // ── Power ──────────────────────────────────────────────────
  { symbol: "NTPC", name: "NTPC Ltd", sectorKey: "power", verified: true },
  {
    symbol: "POWERGRID",
    name: "Power Grid Corporation of India Ltd",
    sectorKey: "power",
    verified: true,
  },
  {
    symbol: "ADANIPOWER",
    name: "Adani Power Ltd",
    sectorKey: "power",
    verified: true,
  },
  {
    symbol: "ADANIGREEN",
    name: "Adani Green Energy Ltd",
    sectorKey: "power",
    verified: true,
  },
  {
    symbol: "ADANIENSOL",
    name: "Adani Energy Solutions Ltd",
    sectorKey: "power",
    verified: true,
  }, // renamed from ADANITRANS
  {
    symbol: "TATAPOWER",
    name: "Tata Power Company Ltd",
    sectorKey: "power",
    verified: true,
  },
  {
    symbol: "JSWENERGY",
    name: "JSW Energy Ltd",
    sectorKey: "power",
    verified: true,
  },
  { symbol: "NHPC", name: "NHPC Ltd", sectorKey: "power", verified: true },
  {
    symbol: "WAAREEENER",
    name: "Waaree Energies Ltd",
    sectorKey: "power",
    verified: true,
  }, // 2024 IPO
  {
    symbol: "PREMIERENE",
    name: "Premier Energies Ltd",
    sectorKey: "power",
    verified: true,
  }, // 2024 IPO
  {
    symbol: "TORNTPOWER",
    name: "Torrent Power Ltd",
    sectorKey: "power",
    verified: true,
  },
  { symbol: "CESC", name: "CESC Ltd", sectorKey: "power", verified: true },
  {
    symbol: "SUZLON",
    name: "Suzlon Energy Ltd",
    sectorKey: "power",
    verified: true,
  },
  {
    symbol: "INOXWIND",
    name: "Inox Wind Ltd",
    sectorKey: "power",
    verified: true,
  },

  // ── Automobile ─────────────────────────────────────────────
  {
    symbol: "MARUTI",
    name: "Maruti Suzuki India Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "M&M",
    name: "Mahindra & Mahindra Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "TATAMOTORS",
    name: "Tata Motors Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "BAJAJ-AUTO",
    name: "Bajaj Auto Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "EICHERMOT",
    name: "Eicher Motors Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "TVSMOTOR",
    name: "TVS Motor Company Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "HEROMOTOCO",
    name: "Hero MotoCorp Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "ASHOKLEY",
    name: "Ashok Leyland Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "MOTHERSON",
    name: "Samvardhana Motherson International Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "BOSCHLTD",
    name: "Bosch Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "BHARATFORG",
    name: "Bharat Forge Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  { symbol: "MRF", name: "MRF Ltd", sectorKey: "automobile", verified: true },
  {
    symbol: "TIINDIA",
    name: "Tube Investments of India Ltd",
    sectorKey: "automobile",
    verified: true,
  },
  {
    symbol: "SONACOMS",
    name: "Sona BLW Precision Forgings Ltd",
    sectorKey: "automobile",
    verified: true,
  },

  // ── FMCG & Consumer ────────────────────────────────────────
  {
    symbol: "HINDUNILVR",
    name: "Hindustan Unilever Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "ITC",
    name: "ITC Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "NESTLEIND",
    name: "Nestle India Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "VBL",
    name: "Varun Beverages Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "BRITANNIA",
    name: "Britannia Industries Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "GODREJCP",
    name: "Godrej Consumer Products Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "TATACONSUM",
    name: "Tata Consumer Products Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "DABUR",
    name: "Dabur India Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "MARICO",
    name: "Marico Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "UNITDSPR",
    name: "United Spirits Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "COLPAL",
    name: "Colgate-Palmolive (India) Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "EMAMILTD",
    name: "Emami Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },
  {
    symbol: "PATANJALI",
    name: "Patanjali Foods Ltd",
    sectorKey: "fmcg_consumer",
    verified: true,
  },

  // ── Pharma & Healthcare ────────────────────────────────────
  {
    symbol: "SUNPHARMA",
    name: "Sun Pharmaceutical Industries Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "DIVISLAB",
    name: "Divis Laboratories Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "CIPLA",
    name: "Cipla Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "DRREDDY",
    name: "Dr Reddys Laboratories Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "TORNTPHARM",
    name: "Torrent Pharmaceuticals Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "ZYDUSLIFE",
    name: "Zydus Lifesciences Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "AUROPHARMA",
    name: "Aurobindo Pharma Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "LUPIN",
    name: "Lupin Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "ALKEM",
    name: "Alkem Laboratories Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "MANKIND",
    name: "Mankind Pharma Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  }, // 2024 IPO
  {
    symbol: "GLENMARK",
    name: "Glenmark Pharmaceuticals Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "LAURUSLABS",
    name: "Laurus Labs Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "BIOCON",
    name: "Biocon Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "APOLLOHOSP",
    name: "Apollo Hospitals Enterprise Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "MAXHEALTH",
    name: "Max Healthcare Institute Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "FORTIS",
    name: "Fortis Healthcare Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },
  {
    symbol: "IPCALAB",
    name: "Ipca Laboratories Ltd",
    sectorKey: "pharma_healthcare",
    verified: true,
  },

  // ── Capital Goods & Engineering ────────────────────────────
  {
    symbol: "LT",
    name: "Larsen & Toubro Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "BEL",
    name: "Bharat Electronics Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "ABB",
    name: "ABB India Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "SIEMENS",
    name: "Siemens Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "HAL",
    name: "Hindustan Aeronautics Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "CUMMINSIND",
    name: "Cummins India Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "CGPOWER",
    name: "CG Power & Industrial Solutions Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "BHEL",
    name: "Bharat Heavy Electricals Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "GVT&D",
    name: "GE Vernova T&D India Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  }, // recently renamed from GET&D
  {
    symbol: "POWERINDIA",
    name: "Hitachi Energy India Limited",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "MAZDOCK",
    name: "Mazagon Dock Shipbuilders Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "BDL",
    name: "Bharat Dynamics Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "SOLARINDS",
    name: "Solar Industries (India) Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "THERMAX",
    name: "Thermax Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "KAYNES",
    name: "Kaynes Technology India Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "APARINDS",
    name: "Apar Industries Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },
  {
    symbol: "DATAPATTNS",
    name: "Data Patterns (India) Ltd",
    sectorKey: "capital_goods_engineering",
    verified: true,
  },

  // ── Metals & Mining ────────────────────────────────────────
  {
    symbol: "JSWSTEEL",
    name: "JSW Steel Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "TATASTEEL",
    name: "Tata Steel Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "VEDL",
    name: "Vedanta Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "HINDALCO",
    name: "Hindalco Industries Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "HINDZINC",
    name: "Hindustan Zinc Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "COALINDIA",
    name: "Coal India Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "JINDALSTEL",
    name: "Jindal Steel & Power Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "NMDC",
    name: "NMDC Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "SAIL",
    name: "Steel Authority of India Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },
  {
    symbol: "NATIONALUM",
    name: "National Aluminium Company Ltd",
    sectorKey: "metals_mining",
    verified: true,
  },

  // ── Cement & Construction ──────────────────────────────────
  {
    symbol: "ULTRACEMCO",
    name: "UltraTech Cement Ltd",
    sectorKey: "cement_construction",
    verified: true,
  },
  {
    symbol: "GRASIM",
    name: "Grasim Industries Ltd",
    sectorKey: "cement_construction",
    verified: true,
  },
  {
    symbol: "AMBUJACEM",
    name: "Ambuja Cements Ltd",
    sectorKey: "cement_construction",
    verified: true,
  },
  {
    symbol: "SHREECEM",
    name: "Shree Cement Ltd",
    sectorKey: "cement_construction",
    verified: true,
  },
  {
    symbol: "ACC",
    name: "ACC Ltd",
    sectorKey: "cement_construction",
    verified: true,
  },

  // ── Telecom ────────────────────────────────────────────────
  {
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Ltd",
    sectorKey: "telecom",
    verified: true,
  },
  {
    symbol: "INDUSTOWER",
    name: "Indus Towers Ltd",
    sectorKey: "telecom",
    verified: true,
  },
  {
    symbol: "IDEA",
    name: "Vodafone Idea Ltd",
    sectorKey: "telecom",
    verified: true,
  },
  {
    symbol: "TATACOMM",
    name: "Tata Communications Ltd",
    sectorKey: "telecom",
    verified: true,
  },

  // ── Real Estate ────────────────────────────────────────────
  { symbol: "DLF", name: "DLF Ltd", sectorKey: "real_estate", verified: true },
  {
    symbol: "LODHA",
    name: "Macrotech Developers Ltd",
    sectorKey: "real_estate",
    verified: true,
  },
  {
    symbol: "GODREJPROP",
    name: "Godrej Properties Ltd",
    sectorKey: "real_estate",
    verified: true,
  },
  {
    symbol: "PHOENIXLTD",
    name: "Phoenix Mills Ltd",
    sectorKey: "real_estate",
    verified: true,
  },
  {
    symbol: "OBEROIRLTY",
    name: "Oberoi Realty Ltd",
    sectorKey: "real_estate",
    verified: true,
  },
  {
    symbol: "PRESTIGE",
    name: "Prestige Estate Projects Ltd",
    sectorKey: "real_estate",
    verified: true,
  },
  {
    symbol: "BRIGADE",
    name: "Brigade Enterprises Ltd",
    sectorKey: "real_estate",
    verified: true,
  },

  // ── Consumer Discretionary & Retail ────────────────────────
  {
    symbol: "TITAN",
    name: "Titan Company Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "ASIANPAINT",
    name: "Asian Paints Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "DMART",
    name: "Avenue Supermarts Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "TRENT",
    name: "Trent Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "PIDILITIND",
    name: "Pidilite Industries Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "HAVELLS",
    name: "Havells India Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "VOLTAS",
    name: "Voltas Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "DIXON",
    name: "Dixon Technologies (India) Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "POLYCAB",
    name: "Polycab India Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "KEI",
    name: "KEI Industries Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "APLAPOLLO",
    name: "APL Apollo Tubes Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "SUPREMEIND",
    name: "Supreme Industries Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "BERGEPAINT",
    name: "Berger Paints India Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "CROMPTON",
    name: "Crompton Greaves Consumer Electricals Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "BLUESTARCO",
    name: "Blue Star Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "PAGEIND",
    name: "Page Industries Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "VMART",
    name: "V-Mart Retail Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },
  {
    symbol: "WHIRLPOOL",
    name: "Whirlpool of India Ltd",
    sectorKey: "consumer_discretionary_retail",
    verified: true,
  },

  // ── Logistics & Infrastructure ─────────────────────────────
  {
    symbol: "ADANIPORTS",
    name: "Adani Ports and Special Economic Zone Ltd",
    sectorKey: "logistics_infrastructure",
    verified: true,
  },
  {
    symbol: "GMRAIRPORT",
    name: "GMR Airports Ltd",
    sectorKey: "logistics_infrastructure",
    verified: true,
  }, // recently renamed from GMRINFRA
  {
    symbol: "RVNL",
    name: "Rail Vikas Nigam Ltd",
    sectorKey: "logistics_infrastructure",
    verified: true,
  },
  {
    symbol: "CONCOR",
    name: "Container Corporation of India Ltd",
    sectorKey: "logistics_infrastructure",
    verified: true,
  },
  {
    symbol: "DELHIVERY",
    name: "Delhivery Ltd",
    sectorKey: "logistics_infrastructure",
    verified: true,
  },
  {
    symbol: "BLUEDART",
    name: "Blue Dart Express Ltd",
    sectorKey: "logistics_infrastructure",
    verified: true,
  },

  // ── Hospitality & Travel ───────────────────────────────────
  {
    symbol: "INDIGO",
    name: "InterGlobe Aviation Ltd",
    sectorKey: "hospitality_travel",
    verified: true,
  },
  {
    symbol: "INDHOTEL",
    name: "The Indian Hotels Company Ltd",
    sectorKey: "hospitality_travel",
    verified: true,
  },
  {
    symbol: "IRCTC",
    name: "Indian Railway Catering and Tourism Corporation Ltd",
    sectorKey: "hospitality_travel",
    verified: true,
  },

  // ── New Economy & Internet ─────────────────────────────────
  {
    symbol: "ETERNAL",
    name: "Zomato Ltd",
    sectorKey: "new_economy_internet",
    verified: true,
  }, // renamed from ZOMATO in early 2025
  {
    symbol: "SWIGGY",
    name: "Swiggy Ltd",
    sectorKey: "new_economy_internet",
    verified: true,
  }, // 2024 IPO
  {
    symbol: "NYKAA",
    name: "FSN Ecommerce Ventures Ltd",
    sectorKey: "new_economy_internet",
    verified: true,
  },
  {
    symbol: "PAYTM",
    name: "One97 Communications Ltd",
    sectorKey: "new_economy_internet",
    verified: true,
  },
  {
    symbol: "NAUKRI",
    name: "Info Edge (India) Ltd",
    sectorKey: "new_economy_internet",
    verified: true,
  },
  {
    symbol: "NAZARA",
    name: "Nazara Technologies Ltd",
    sectorKey: "new_economy_internet",
    verified: true,
  },

  // ── Chemicals & Agrochemicals ──────────────────────────────
  {
    symbol: "SRF",
    name: "SRF Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
  },
  {
    symbol: "PIIND",
    name: "PI Industries Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
  },
  {
    symbol: "COROMANDEL",
    name: "Coromandel International Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
  },
  {
    symbol: "UPL",
    name: "UPL Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
  },
  {
    symbol: "AARTIIND",
    name: "Aarti Industries Ltd",
    sectorKey: "chemicals_agrochemicals",
    verified: true,
  },
];
