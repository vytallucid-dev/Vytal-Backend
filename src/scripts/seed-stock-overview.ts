// seed-stock-overview.ts
// Idempotent loader for stock_overview editorial content.
// Source: stock_overview_static.json (schemaVersion 1.1+).
// Re-runnable: re-editing the JSON and re-running syncs changes cleanly.
//
// Run:
//   npx tsx src/scripts/seed-stock-overview.ts --dry-run
//   npx tsx src/scripts/seed-stock-overview.ts
//   npx tsx src/scripts/seed-stock-overview.ts --dry-run path/to/stock_overview_static.json

import { prisma } from "../db/prisma.js";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_JSON = path.resolve(
  process.cwd(),
  "../invest-iq/docs/stock_overview_static.json",
);

interface OverviewEntry {
  industry: string;
  listedSince: number | null;
  coreBusiness: string;
  revenueModel: string;
  businessTags: string[];
}

interface OverviewJSON {
  _meta: unknown;
  stocks: Record<string, OverviewEntry>;
}

type Op = {
  symbol: string;
  stockId: string;
  entry: OverviewEntry;
  isNew: boolean;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const jsonArg = process.argv.slice(2).find((a) => a.endsWith(".json"));
  const jsonPath = jsonArg ?? DEFAULT_JSON;

  console.log("══════════════════════════════════════════════════════");
  console.log("  STOCK OVERVIEW SEED — Editorial content loader");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  JSON:    ${jsonPath}`);
  console.log(`  dry-run: ${dryRun}`);
  console.log("");

  if (!fs.existsSync(jsonPath)) {
    console.error(`JSON not found: ${jsonPath}`);
    process.exit(1);
  }

  const json: OverviewJSON = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const jsonStocks = json.stocks;
  const jsonSymbols = Object.keys(jsonStocks);
  console.log(`  JSON stocks: ${jsonSymbols.length}`);

  // ── Build symbol→stockId map from DB ──────────────────────────────────────
  const dbStocks = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const symbolToId = new Map(dbStocks.map((s) => [s.symbol, s.id]));

  // ── Load existing overview rows for change detection ───────────────────────
  const existingRows = await prisma.stockOverview.findMany({
    select: {
      stockId: true,
      industry: true,
      listedSince: true,
      coreBusiness: true,
      revenueModel: true,
      businessTags: true,
    },
  });
  const existingByStockId = new Map(existingRows.map((r) => [r.stockId, r]));

  // ── Classify each JSON entry ───────────────────────────────────────────────
  const ops: Op[] = [];
  const unresolved: string[] = [];
  const unchanged: string[] = [];

  for (const symbol of jsonSymbols) {
    const stockId = symbolToId.get(symbol);
    if (!stockId) {
      unresolved.push(symbol);
      continue;
    }

    const entry = jsonStocks[symbol];
    const ex = existingByStockId.get(stockId);

    if (ex) {
      const changed =
        ex.industry !== entry.industry ||
        ex.listedSince !== (entry.listedSince ?? null) ||
        ex.coreBusiness !== entry.coreBusiness ||
        ex.revenueModel !== entry.revenueModel ||
        JSON.stringify(ex.businessTags) !== JSON.stringify(entry.businessTags);
      if (!changed) {
        unchanged.push(symbol);
        continue;
      }
      ops.push({ symbol, stockId, entry, isNew: false });
    } else {
      ops.push({ symbol, stockId, entry, isNew: true });
    }
  }

  const toInsert = ops.filter((o) => o.isNew).length;
  const toUpdate = ops.filter((o) => !o.isNew).length;

  // ── Coverage gaps: Stock rows in DB with no JSON entry ────────────────────
  const jsonSymbolSet = new Set(jsonSymbols);
  const gaps = dbStocks
    .filter((s) => !jsonSymbolSet.has(s.symbol))
    .map((s) => s.symbol)
    .sort();

  // ── Census report ──────────────────────────────────────────────────────────
  console.log("  ── CENSUS ───────────────────────────────────────────────");
  console.log(`  Insert:    ${toInsert}`);
  console.log(`  Update:    ${toUpdate}`);
  console.log(`  Unchanged: ${unchanged.length}`);
  console.log(`  Skip/flag: ${unresolved.length}  (JSON symbol → no Stock row)`);

  if (unresolved.length > 0) {
    console.log("\n  ── FLAG: JSON symbol → no Stock row (skip-and-flag) ────");
    for (const sym of unresolved) console.log(`    ✗  ${sym}`);
  }

  if (gaps.length > 0) {
    console.log("\n  ── COVERAGE GAPS: Stock rows with no JSON overview ──────");
    for (const sym of gaps) console.log(`    ○  ${sym}`);
  }

  if (dryRun) {
    console.log("\n  [dry-run] No DB writes performed.\n");
    return;
  }

  // ── Live upserts ───────────────────────────────────────────────────────────
  let inserted = 0;
  let updated = 0;

  for (const op of ops) {
    const data = {
      industry: op.entry.industry,
      listedSince: op.entry.listedSince ?? null,
      coreBusiness: op.entry.coreBusiness,
      revenueModel: op.entry.revenueModel,
      businessTags: op.entry.businessTags,
    };
    await prisma.stockOverview.upsert({
      where: { stockId: op.stockId },
      create: { stockId: op.stockId, ...data },
      update: data,
    });
    op.isNew ? inserted++ : updated++;
  }

  // ── Load census ────────────────────────────────────────────────────────────
  console.log("\n  ── LOAD CENSUS ──────────────────────────────────────────");
  console.log(`  Inserted:  ${inserted}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Unchanged: ${unchanged.length}`);
  console.log(`  Flagged:   ${unresolved.length}`);
  if (unresolved.length > 0) {
    console.log(`  Unresolved symbols: ${unresolved.join(", ")}`);
  }
  if (gaps.length > 0) {
    console.log(`  Coverage gaps:      ${gaps.join(", ")}`);
  }
  console.log("\n  Done.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
