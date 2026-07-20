// ─────────────────────────────────────────────────────────────
// STEP 14 — GATE 0c RECON (READ-ONLY). THE DISTRIBUTION-YIELD QUESTION.
//
// The thin tier wants a distribution yield. Yield = (trailing 12m distributions per unit) / price.
// Price we have (udiff bhavcopy, Gate 0b). The DISTRIBUTIONS are the open question.
//
// Probe the ONE feed the repo already ingests that could plausibly carry them:
// NSE /api/corporates-corporateActions (src/ingestions/corporate-events/events.ts:348).
// Today that ingest hard-drops anything whose series !== "EQ" (events.ts:357), so even if
// the API returns REIT distributions, none reach us. Question: does the API return them AT ALL?
//
// Writes NOTHING. Answers exactly one thing: is a distribution yield SOURCEABLE, or is it an
// honest-empty null? Never fabricate a yield.
// ─────────────────────────────────────────────────────────────
import { nseClient } from "../lib/client.js";

const rule = (s: string) => console.log("\n" + "═".repeat(78) + "\n" + s + "\n" + "═".repeat(78));

// A REIT, an InvIT, and one of the "no-ISIN on BSE" trio — a representative spread.
const PROBE = [
  { symbol: "EMBASSY", series: "RR", close: 450.03 },
  { symbol: "MINDSPACE", series: "RR", close: 488.47 },
  { symbol: "INDIGRID", series: "IV", close: 179.49 },
  { symbol: "PGINVIT", series: "IV", close: 96.75 },
  { symbol: "NHIT", series: "IV", close: 166.0 },
];

interface CaRaw {
  symbol?: string;
  series?: string;
  subject?: string;
  exDate?: string;
  recDate?: string;
  comp?: string;
}

rule("D1 · NSE corporate-actions API — does it return REIT/InvIT distributions?");

for (const p of PROBE) {
  const path = `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(p.symbol)}`;
  try {
    const data = await nseClient.get<CaRaw[]>(path);
    if (!Array.isArray(data)) {
      console.log(`\n${p.symbol}: non-array response → ${JSON.stringify(data).slice(0, 160)}`);
      continue;
    }
    console.log(`\n── ${p.symbol} (${p.series}, close=${p.close}) — ${data.length} corporate-action records ──`);
    const seriesSeen = new Set(data.map((d) => (d.series ?? "").trim()));
    console.log(`   series values present: ${JSON.stringify([...seriesSeen])}  ← events.ts:357 keeps ONLY "EQ"`);
    for (const r of data.slice(0, 12)) {
      console.log(`   [${(r.series ?? "?").padEnd(3)}] ex=${(r.exDate ?? "?").padEnd(12)} ${r.subject ?? ""}`);
    }
    if (data.length > 12) console.log(`   … ${data.length - 12} more`);

    // Can a trailing-12m distribution-per-unit be PARSED out of `subject`?
    const dist = data.filter((r) => /distribution|dividend|interest|repayment|capital/i.test(r.subject ?? ""));
    console.log(`   distribution-ish records: ${dist.length}`);
    let parsed = 0;
    for (const r of dist.slice(0, 8)) {
      const m = (r.subject ?? "").match(/(?:rs\.?|inr|₹)\s*([\d.]+)/i);
      if (m) parsed++;
      console.log(`      ex=${(r.exDate ?? "?").padEnd(12)} amt=${m ? m[1] : "(UNPARSEABLE)"}  ← "${r.subject}"`);
    }
    console.log(`   → per-unit amount parseable from subject in ${parsed}/${Math.min(dist.length, 8)} sampled`);
  } catch (err) {
    console.log(`\n${p.symbol}: FETCH FAILED — ${(err as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 900)); // be polite to NSE
}

rule("D2 · VERDICT INPUTS");
console.log("If D1 returns records with series RR/IV and a parseable per-unit amount → yield is");
console.log("SOURCEABLE, but only by building a distribution-history ingest (a NEW fold — explicitly");
console.log("OUT of Step 14's thin scope).");
console.log("If D1 returns nothing / unparseable → yield is an HONEST-EMPTY null. Price-chart only.");

console.log("\n═══ GATE 0c COMPLETE — nothing was written. ═══");
process.exit(0);
