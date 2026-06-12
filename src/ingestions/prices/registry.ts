
// ─────────────────────────────────────────────────────────────
// Provider registry and factory.
// Controlled by PRICE_PROVIDER env var.
// Includes automatic fallback chain.
// ─────────────────────────────────────────────────────────────

import type { PriceProvider } from "./providers/provider.js";
import { NseBhavcopyCsvProvider } from "./providers/nse-bhavcopy.js";
import { BseBhavcopyCsvProvider } from "./providers/bse-bhavcopy.js";

// ── Available providers ───────────────────────────────────────

const PROVIDERS: Record<string, () => PriceProvider> = {
  "nse-bhavcopy-csv": () => new NseBhavcopyCsvProvider(),
  "bse-bhavcopy-csv": () => new BseBhavcopyCsvProvider(),
  // Future providers — uncomment when needed:
  // 'twelve-data':    () => new TwelveDataProvider(process.env.TWELVE_DATA_KEY!),
  // 'alpha-vantage':  () => new AlphaVantageProvider(process.env.ALPHA_VANTAGE_KEY!),
  // 'yfinance':       () => new YfinanceProvider(),  // dev/test only
};

// Default provider chain (primary → fallback order)
const DEFAULT_CHAIN = ["nse-bhavcopy-csv", "bse-bhavcopy-csv"];

// ── Factory ───────────────────────────────────────────────────

export function createProvider(name?: string): PriceProvider {
  const key = name ?? process.env.PRICE_PROVIDER ?? DEFAULT_CHAIN[0];
  const factory = PROVIDERS[key];
  if (!factory) {
    throw new Error(
      `Unknown price provider: "${key}". Valid options: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return factory();
}

// ── Fallback chain ─────────────────────────────────────────────
// Tries providers in order. Falls back if primary throws or
// returns 0 prices. Logs which provider succeeded.

export async function fetchWithFallback(
  date: Date,
): Promise<ReturnType<PriceProvider["fetchEod"]>> {
  const chainNames = process.env.PRICE_PROVIDER
    ? [
        process.env.PRICE_PROVIDER,
        ...DEFAULT_CHAIN.filter((n) => n !== process.env.PRICE_PROVIDER),
      ]
    : DEFAULT_CHAIN;

  const attemptErrors: string[] = [];

  for (const name of chainNames) {
    const factory = PROVIDERS[name];
    if (!factory) continue;

    const provider = factory();

    try {
      console.log(`[PriceRegistry] Trying provider: ${name}`);
      const result = await provider.fetchEod(date);

      if (result.prices.length > 0) {
        if (name !== chainNames[0]) {
          console.warn(`[PriceRegistry] Fell back to ${name} (primary failed)`);
        }
        return result;
      }

      // Provider returned 0 prices (market closed, bad data)
      // If it's explicitly a market-closed error, don't try fallbacks
      const isMarketClosed = result.errors.some((e) =>
        e.toLowerCase().includes("market likely closed"),
      );
      if (isMarketClosed) {
        console.log(
          `[PriceRegistry] Market closed on ${date.toDateString()} — no prices expected`,
        );
        return result;
      }

      attemptErrors.push(`${name}: returned 0 prices`);
    } catch (err) {
      const msg = `${name}: ${(err as Error).message}`;
      console.error(`[PriceRegistry] Provider ${name} failed:`, err);
      attemptErrors.push(msg);
    }
  }

  // All providers failed
  throw new Error(
    `All price providers failed for ${date.toDateString()}:\n${attemptErrors.join("\n")}`,
  );
}
