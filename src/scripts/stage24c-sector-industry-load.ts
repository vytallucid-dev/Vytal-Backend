// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 24c — LOAD sector AND industry FROM THE COMPLETED WORKBOOK.  ⚠ WRITES with --apply.
//
//   npx tsx src/scripts/stage24c-sector-industry-load.ts                    # validate, writes nothing
//   npx tsx src/scripts/stage24c-sector-industry-load.ts --apply
//   npx tsx src/scripts/stage24c-sector-industry-load.ts --apply --no-new-sectors
//
// ── WHY THIS IS SEPARATE FROM stage24b ───────────────────────────────────────────────────────────
// Same workbook, different kind of data. 24b writes PROSE a person authored (revenue model, tags);
// this writes TAXONOMY that other things join on — sector drives peer groups, health-score
// weightages and the comparison surfaces. A bad sentence is visible on one page; a bad sector
// silently reshapes a peer group. Keeping them apart means 24b stays a tested, unchanged script and
// this one can be re-run or reverted on its own.
//
// ── THE GUARANTEES ───────────────────────────────────────────────────────────────────────────────
//  1. NULL-ONLY, BOTH FIELDS. `sector_id` is written only where it is currently NULL; `industry`
//     only where it is currently blank. An existing classification is never overwritten — the
//     workbook shipped the CURRENT value in those columns as context, so a plain upsert would
//     rewrite 1,896 rows with what they already say and bury the ~170 that actually change.
//  2. UNKNOWN SYMBOL IS A REFUSAL, not a create.
//  3. RE-RUNNABLE. A second run reports everything as already-set.
//
// ── NEW SECTORS ──────────────────────────────────────────────────────────────────────────────────
// The workbook uses four sector keys the database does not have: business_services, education,
// media_entertainment, paper_products. They are created — but note two deliberate choices:
//
//   ⚠ DISPLAY NAMES ARE HAND-WRITTEN, NOT DERIVED. The existing convention turns an underscore into
//     "&" for compound concepts (capital_goods_engineering → "Capital Goods & Engineering"), and any
//     rule general enough to do that would render paper_products as "Paper & Products". Four names
//     are cheaper to write than a rule that is wrong once.
//
//   ⚠ sector_class IS LEFT NULL, ON PURPOSE. It is an editorial judgement (Quality / Defensive /
//     Commodity / Cyclical / Growth / PSU) that feeds grounding and relational logic. Guessing it
//     would put an invented judgement somewhere it reads as a decision someone made. Flagged for a
//     human instead.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const APPLY = argv.includes("--apply");
const NO_NEW = argv.includes("--no-new-sectors");
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const DIR = arg("--dir", "RevenueModelWorkbookCompleted");

/** Hand-written to match the existing convention. See the header note. */
const NEW_SECTOR_DISPLAY: Record<string, string> = {
  business_services: "Business Services",
  education: "Education",
  media_entertainment: "Media & Entertainment",
  paper_products: "Paper Products",
};

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 24c — sector + industry  ${APPLY ? "*** LIVE WRITE ***" : "(VALIDATE ONLY — nothing written)"}   ${DIR}`);
  console.log("=".repeat(100));
  if (!fs.existsSync(DIR)) { console.log(`\n  no workbook at ${DIR}\n`); await prisma.$disconnect(); return; }

  // ── read the workbook ───────────────────────────────────────────────────────────────────────
  interface Want { symbol: string; sector: string; industry: string; file: string }
  const wants: Want[] = [];
  const problems: string[] = [];
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".csv") && !f.startsWith("_")).sort()) {
    const rows = parseCsv(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (rows.length < 2) continue;
    const head = rows[0].map((h) => h.trim().replace(/^★/, ""));
    const iSym = head.indexOf("symbol"), iSec = head.indexOf("sector"), iInd = head.indexOf("industry");
    if (iSym < 0 || iSec < 0 || iInd < 0) { problems.push(`${file}: header missing symbol / sector / industry`); continue; }
    for (const r of rows.slice(1)) {
      const symbol = (r[iSym] ?? "").trim().toUpperCase();
      if (!symbol) continue;
      wants.push({ symbol, sector: (r[iSec] ?? "").trim(), industry: (r[iInd] ?? "").trim(), file });
    }
  }
  console.log(`\n  workbook rows: ${wants.length}`);

  // ── current state ───────────────────────────────────────────────────────────────────────────
  const stocks = new Map((await raw<{ symbol: string; id: string; sector_id: string | null }>(
    `SELECT symbol, id, sector_id FROM stocks`)).map((s) => [s.symbol, s]));
  const overviews = new Map((await raw<{ symbol: string; industry: string }>(
    `SELECT s.symbol, o.industry FROM stock_overviews o JOIN stocks s ON s.id = o.stock_id`))
    .map((o) => [o.symbol, o.industry]));
  const sectors = new Map((await raw<{ name: string; id: string }>(`SELECT name, id FROM sectors`)).map((s) => [s.name, s.id]));

  // ── plan ────────────────────────────────────────────────────────────────────────────────────
  const needSector: Want[] = [], needIndustry: Want[] = [];
  const unknownSymbol: string[] = [], noOverview: string[] = [];
  const newSectorNames = new Set<string>();
  let sectorHeld = 0, industryHeld = 0, blankInWorkbook = 0;

  for (const w of wants) {
    const st = stocks.get(w.symbol);
    if (!st) { unknownSymbol.push(w.symbol); continue; }

    if (w.sector) {
      if (st.sector_id) sectorHeld++;
      else { needSector.push(w); if (!sectors.has(w.sector)) newSectorNames.add(w.sector); }
    } else blankInWorkbook++;

    if (w.industry) {
      const held = overviews.get(w.symbol);
      if (held === undefined) noOverview.push(w.symbol);
      else if (held.trim() !== "") industryHeld++;
      else needIndustry.push(w);
    }
  }

  console.log(`\n  ── SECTOR ──`);
  console.log(`     already classified (left untouched)  ${sectorHeld}`);
  console.log(`     would be set                          ${needSector.length}`);
  console.log(`     blank in the workbook                 ${blankInWorkbook}`);
  console.log(`\n  ── INDUSTRY ──`);
  console.log(`     already set (left untouched)          ${industryHeld}`);
  console.log(`     would be set (currently blank)        ${needIndustry.length}`);
  console.log(`\n  ── NEW SECTORS (${newSectorNames.size}) ──`);
  for (const n of [...newSectorNames].sort()) {
    const disp = NEW_SECTOR_DISPLAY[n];
    const count = needSector.filter((w) => w.sector === n).length;
    console.log(`     ${n.padEnd(22)} → ${(disp ?? "⚠ NO DISPLAY NAME MAPPED").padEnd(24)} ${count} stock(s)`);
    if (!disp) problems.push(`sector "${n}" has no display name in NEW_SECTOR_DISPLAY — add one before applying`);
  }
  if (unknownSymbol.length) console.log(`\n  ⚠ ${unknownSymbol.length} symbol(s) not in the universe — REFUSED: ${unknownSymbol.slice(0, 8).join(", ")}${unknownSymbol.length > 8 ? " …" : ""}`);
  if (noOverview.length) console.log(`  ⚠ ${noOverview.length} symbol(s) have no profile row — industry skipped`);

  if (problems.length) {
    console.log(`\n  ⚠ ${problems.length} problem(s):`);
    for (const p of problems) console.log(`     ${p}`);
  }
  if (NO_NEW && newSectorNames.size) {
    console.log(`\n  --no-new-sectors set: ${needSector.filter((w) => !sectors.has(w.sector)).length} stock(s) would be skipped.`);
  }
  if (!APPLY) { console.log(`\n  validation pass — re-run with --apply to write.\n`); await prisma.$disconnect(); return; }
  if (problems.some((p) => p.includes("NEW_SECTOR_DISPLAY"))) {
    console.log(`\n  ⛔ refusing to write while a new sector has no display name.\n`); await prisma.$disconnect(); return;
  }

  // ── 1. create the new sectors ───────────────────────────────────────────────────────────────
  let created = 0;
  if (!NO_NEW) {
    for (const name of [...newSectorNames].sort()) {
      // sector_class deliberately left NULL — an editorial judgement, not something to infer here.
      await prisma.$executeRawUnsafe(
        `INSERT INTO sectors (id, name, display_name, stock_count, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, 0, now())
         ON CONFLICT (name) DO NOTHING`, name, NEW_SECTOR_DISPLAY[name]);
      created++;
    }
    for (const s of await raw<{ name: string; id: string }>(`SELECT name, id FROM sectors`)) sectors.set(s.name, s.id);
  }
  console.log(`\n  created ${created} sector(s)`);

  // ── 2. sector_id, null-only ─────────────────────────────────────────────────────────────────
  let sectorWrote = 0, sectorSkipped = 0;
  for (const w of needSector) {
    const sid = sectors.get(w.sector);
    if (!sid) { sectorSkipped++; continue; }
    sectorWrote += await prisma.$executeRawUnsafe(
      `UPDATE stocks SET sector_id = $2, updated_at = now() WHERE id = $1 AND sector_id IS NULL`,
      stocks.get(w.symbol)!.id, sid);
  }
  console.log(`  sector set on ${sectorWrote} stock(s)${sectorSkipped ? ` · ${sectorSkipped} skipped (sector not created)` : ""}`);

  // ── 3. industry, blank-only ─────────────────────────────────────────────────────────────────
  let industryWrote = 0;
  for (const w of needIndustry) {
    industryWrote += await prisma.$executeRawUnsafe(
      `UPDATE stock_overviews SET industry = $2, updated_at = now()
        WHERE stock_id = $1 AND coalesce(trim(industry), '') = ''`, stocks.get(w.symbol)!.id, w.industry);
  }
  console.log(`  industry set on ${industryWrote} profile(s)`);

  // ── 4. refresh stock_count ──────────────────────────────────────────────────────────────────
  // ⚠ It was stale before this ran — the column totalled ~200 against a 2,290-stock universe, so it
  //   had not been maintained since the expansion. Recomputing here rather than incrementing, because
  //   an increment on top of a wrong number stays wrong.
  const counted = await prisma.$executeRawUnsafe(`
    UPDATE sectors s SET stock_count = c.n
      FROM (SELECT sec.id, count(st.id)::int n FROM sectors sec
              LEFT JOIN stocks st ON st.sector_id = sec.id AND st.is_active
             GROUP BY sec.id) c
     WHERE c.id = s.id AND s.stock_count IS DISTINCT FROM c.n`);
  console.log(`  stock_count refreshed on ${counted} sector(s)`);

  const left = await raw<{ n: number }>(`SELECT count(*)::int n FROM stocks WHERE is_active AND sector_id IS NULL`);
  const blank = await raw<{ n: number }>(`SELECT count(*)::int n FROM stock_overviews WHERE coalesce(trim(industry),'') = ''`);
  console.log(`\n  active stocks still without a sector: ${left[0].n}`);
  console.log(`  profiles still without an industry:   ${blank[0].n}`);
  console.log(`\n  ⚠ the ${created} new sector(s) have sector_class = NULL — an editorial call, left for a human.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
