// ─────────────────────────────────────────────────────────────────────────────
// PASS 1 · Stage 1a — create the genuinely-new Nifty-500 constituents as
// DISPLAY-ONLY stocks (isActive: true, NO peer-group membership → never scored),
// auto-mapping sector ONLY where the NSE Industry label maps 1:1 onto our existing
// taxonomy (derived empirically from the 219 overlap stocks — see
// recon-industry-sector-crosstab.ts). Ambiguous NSE labels are left sectorId=NULL
// and surfaced for the architect gate (Stage 1c).
//
// FIREWALL: this script NEVER writes stock_peer_groups. A stock with no
// stock_peer_groups row is structurally never a scoring candidate (the scoring
// roster builds from peerGroup.stocks; proven by the COALINDIA/NAZARA null-PG
// precedent: 0 snapshots).
//
// IDEMPOTENT: skips any symbol already present. Re-running never duplicates.
// Source of truth: the official NSE ind_nifty500list.csv passed as arg (version-
// stamped by the caller).
//
//   npx tsx src/scripts/seed-nifty500-pass1.ts <csv-path>            # dry-run (default)
//   npx tsx src/scripts/seed-nifty500-pass1.ts <csv-path> --commit   # write
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import fs from "fs";

// ── Empirically-derived CLEAN map (NSE Industry → our sector.name) ──
// Only labels that landed on EXACTLY ONE of our sectors across all overlap
// stocks, with adequate sample size (n≥4). Single-sample "Textiles" (n=1) is
// deliberately EXCLUDED → gated. Ambiguous multi-sector labels are absent here
// by construction → they gate.
const CLEAN_SECTOR_MAP: Record<string, string> = {
  "Automobile and Auto Components": "automobile",
  "Construction Materials": "cement_construction",
  "Consumer Durables": "consumer_discretionary_retail",
  "Fast Moving Consumer Goods": "fmcg_consumer",
  "Healthcare": "pharma_healthcare",
  "Information Technology": "it_technology",
  "Metals & Mining": "metals_mining",
  "Power": "power",
  "Realty": "real_estate",
  "Telecommunication": "telecom",
};

interface NewStock { name: string; industry: string; symbol: string; series: string; isin: string; }

function parseCsv(csvPath: string): NewStock[] {
  const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const parts = line.split(",");
    const isin = parts[parts.length - 1].trim();
    const series = parts[parts.length - 2].trim();
    const symbol = parts[parts.length - 3].trim();
    const industry = parts[parts.length - 4].trim();
    const name = parts.slice(0, parts.length - 4).join(",").trim();
    return { name, industry, symbol, series, isin };
  });
}

async function main() {
  const csvPath = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!csvPath) { console.error("usage: seed-nifty500-pass1.ts <csv-path> [--commit]"); process.exit(1); }

  const all = parseCsv(csvPath);
  const existing = await prisma.stock.findMany({ select: { symbol: true } });
  const existingSet = new Set(existing.map((s) => s.symbol));
  const sectors = await prisma.sector.findMany({ select: { id: true, name: true } });
  const sectorIdByName = new Map(sectors.map((s) => [s.name, s.id]));

  // Validate the clean map references only real sectors (fail loud otherwise).
  for (const sec of Object.values(CLEAN_SECTOR_MAP)) {
    if (!sectorIdByName.has(sec)) throw new Error(`CLEAN_SECTOR_MAP references unknown sector "${sec}"`);
  }

  const toCreate = all.filter((s) => !existingSet.has(s.symbol));
  const toSkip = all.filter((s) => existingSet.has(s.symbol));

  const mapped: NewStock[] = [];
  const gated: NewStock[] = [];
  const createPayload = toCreate.map((s) => {
    const sectorName = CLEAN_SECTOR_MAP[s.industry];
    const sectorId = sectorName ? sectorIdByName.get(sectorName)! : null;
    if (sectorId) mapped.push(s); else gated.push(s);
    return {
      symbol: s.symbol,
      name: s.name,
      isin: s.isin,       // the CSV's ISIN — the dedup spine (stocks.isin is NOT NULL + UNIQUE)
      sectorId,           // null → gated (architect fills in Stage 1c)
      isActive: true,     // DISPLAY-ONLY active
      exchange: "NSE",
      // industryType left at schema default (non_financial): it drives the
      // quarterly-results TAXONOMY parser, NOT display or shareholding. These
      // stocks are never scored; financial-sector industryType is a later-pass
      // concern IF quarterly results are ever ingested. NOT guessed here.
    };
  });

  console.log(`=== PASS 1 · Stage 1a — ${commit ? "COMMIT" : "DRY-RUN"} ===`);
  console.log(`CSV rows                 : ${all.length}`);
  console.log(`already in DB (skip)     : ${toSkip.length}`);
  console.log(`to create (new)          : ${toCreate.length}`);
  console.log(`  ├─ sector auto-mapped  : ${mapped.length}`);
  console.log(`  └─ sector GATED (null) : ${gated.length}`);

  if (commit) {
    const res = await prisma.stock.createMany({ data: createPayload, skipDuplicates: true });
    console.log(`\ncreateMany inserted      : ${res.count}`);
  } else {
    console.log(`\n(dry-run — no writes. Re-run with --commit to apply.)`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
