
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
