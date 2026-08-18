
// ─────────────────────────────────────────────────────────────
// FALLBACK provider. Uses BSE's official EOD bhavcopy.
// Only used when NSE bhavcopy fails.
//
// BSE URL: https://www.bseindia.com/download/BhavCopy/Equity/
//          EQ_ISINCODE_DDMMYY.zip (contains a CSV)
//
// BSE bhavcopy uses a ZIP — we need to unzip in memory.
// Slightly more complex but still official and free.
//
// Dependencies: npm install adm-zip
// ─────────────────────────────────────────────────────────────

import https from "https";
import AdmZip from "adm-zip";
import { parse as parseCsv } from "csv-parse/sync";
import type {
  PriceProvider,
  PriceProviderResult,
  EodPrice,
} from "./provider.js";

function bseBhavUrl(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(date.getUTCFullYear()).slice(-2);
  if (date < new Date("2024-07-01")) {
    // use "EQ_ISINCODE_DDMMYY.zip"
    return `https://www.bseindia.com/download/BhavCopy/Equity/EQ_ISINCODE_${dd}${mm}${yy}.zip`;
  } else {
    // use "EQDDMMYY_CSV.ZIP"
    return `https://www.bseindia.com/download/BhavCopy/Equity/EQ${dd}${mm}${yy}_CSV.ZIP`;
  }
  
}

function httpsGetBuffer(
  url: string,
): Promise<{ buffer: Buffer; status: number }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://www.bseindia.com/",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            buffer: Buffer.concat(chunks),
            status: res.statusCode ?? 0,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () =>
      req.destroy(new Error("BSE bhavcopy timed out")),
    );
  });
}

// ⚠ THIS PROVIDER IS **NOT** SESSION-DATE VALIDATED, AND CANNOT BE AS IT STANDS.
//   Every sibling lane (equity sec_bhavdata_full, indices ind_close_all, udiff
//   BhavCopy_NSE_CM) now proves a file IS the day it was requested for, by reading
//   the file's own trading-date column — see ingestions/shared/session-date.ts.
//   This file declares NO date column at all: the row below is the complete set.
//   So there is nothing to compare against, and `parseBseCsv` stamps the requested
//   `date` onto every row exactly the way the equity parser used to.
//
//   IT IS LEFT THAT WAY DELIBERATELY, for now:
//     · It is a FALLBACK that has never run. MEASURED 2026-08-15 — daily_prices
//       carries exactly two providers, "yahoo-finance" (445,009 rows) and
//       "nse-bhavcopy-csv" (18,920). Zero rows have ever come from BSE.
//     · Whether the real CSV carries a trading-date column the interface simply
//       omits is UNKNOWN and was deliberately NOT probed — cf. BhavRow.ISIN in
//       nse-bhavcopy.ts, which declares a column the file does not have.
//
//   ⚠ BEFORE THIS FALLBACK IS EVER RELIED ON, fetch one real BSE file and check for
//   a trading-date column. If one exists, wire it through checkSessionDate with its
//   own parser (the three NSE lanes already use three DIFFERENT date formats — do
//   not assume a fourth matches any of them). If none exists, this provider cannot
//   distinguish a holiday from a session and must not be used for archive backfill.
interface BseBhavRow {
  CODE: string; // BSE code (not NSE symbol)
  NAME: string;
  ISIN_CODE: string;
  OPEN: string;
  HIGH: string;
  LOW: string;
  CLOSE: string;
  NET_TURNOV: string; // traded value
  NO_OF_SHRS: string; // volume
  PREVCLOSE: string;
}

// BSE uses its own numeric codes, not NSE symbols.
// We map via ISIN — the caller can join on ISIN if needed.
function parseBseCsv(csvText: string, date: Date): EodPrice[] {
  const rows: BseBhavRow[] = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return rows
    .filter((r) => r.ISIN_CODE && r.CLOSE)
    .map((r) => {
      const close = parseFloat(r.CLOSE);
      const open = parseFloat(r.OPEN);
      if (isNaN(close) || close <= 0) return null;

      return {
        symbol: r.NAME?.trim() ?? "", // BSE has no NSE symbol — use ISIN for matching
        isin: r.ISIN_CODE?.trim() ?? null,
        date,
        open: isNaN(open) ? close : open,
        high: parseFloat(r.HIGH) || close,
        low: parseFloat(r.LOW) || close,
        close,
        prevClose: parseFloat(r.PREVCLOSE) || null,
        volume: BigInt(parseInt(r.NO_OF_SHRS?.replace(/,/g, "") ?? "0") || 0),
        tradedValue: parseFloat(r.NET_TURNOV) / 1e5 || null, // BSE value in lakhs → Cr
      } as EodPrice;
    })
    .filter((r): r is EodPrice => r !== null);
}

export class BseBhavcopyCsvProvider implements PriceProvider {
  readonly name = "bse-bhavcopy-csv";

  async fetchEod(date: Date): Promise<PriceProviderResult> {
    const fetchedAt = new Date();
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);

    const url = bseBhavUrl(d);
    console.log(`[BseBhavcopy] Fetching: ${url}`);

    const res = await httpsGetBuffer(url);

    if (res.status === 404) {
      return {
        prices: [],
        provider: this.name,
        fetchedAt,
        errors: [
          `No BSE bhavcopy for ${d.toDateString()} — market likely closed`,
        ],
      };
    }

    if (res.status !== 200) {
      throw new Error(`BSE bhavcopy returned HTTP ${res.status}`);
    }

    // Unzip in memory
    const zip = new AdmZip(res.buffer);
    const entries = zip.getEntries();
    const csvEntry = entries.find(
      (e) => e.name.endsWith(".CSV") || e.name.endsWith(".csv"),
    );

    if (!csvEntry) {
      throw new Error("No CSV found in BSE bhavcopy ZIP");
    }

    const csvText = csvEntry.getData().toString("utf-8");
    const prices = parseBseCsv(csvText, d);

    console.log(
      `[BseBhavcopy] Parsed ${prices.length} prices for ${d.toDateString()}`,
    );

    return { prices, provider: this.name, fetchedAt, errors: [] };
  }

  async ping(): Promise<boolean> {
    try {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const { status } = await httpsGetBuffer(bseBhavUrl(yesterday));
      return status === 200 || status === 404;
    } catch {
      return false;
    }
  }
}
