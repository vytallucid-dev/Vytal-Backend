// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 24b — LOAD THE FILLED how-it-earns WORKBOOK.  ⚠ WRITES with --apply.
//
//   npx tsx src/scripts/stage24b-revenue-model-load.ts            # validate only — writes NOTHING
//   npx tsx src/scripts/stage24b-revenue-model-load.ts --apply
//   npx tsx src/scripts/stage24b-revenue-model-load.ts --dir X --only 01_large_cap.csv
//
// ── THE GUARANTEES, INHERITED FROM stage8-workbook-load.ts ───────────────────────────────────────
//  1. IT NEVER OVERWRITES a non-blank `revenue_model`. The 224 authored rows, and anything loaded on
//     an earlier pass, are safe from a re-run. Hand-written analysis outranks a later hand-written
//     analysis nobody asked for.
//  2. IT NEVER WRITES AN EMPTY ROW. A row with neither field filled is skipped, not written as "".
//  3. IT VALIDATES BEFORE IT WRITES — unknown symbol, a tag list outside 3–5, prose far outside the
//     measured 144–323 character band, or text copied verbatim from the `what_it_does` column: each
//     is REPORTED BY NAME. Length and tag-count are WARNINGS (a good short answer is still good);
//     an unknown symbol and a duplicated what-it-does are REFUSALS.
//  4. IT IS RE-RUNNABLE. Rows already loaded report `unchanged`.
//
// ⚠ UNDERSCORE FILES ARE SKIPPED. `_EXAMPLES.csv` holds real authored rows for reference; loading it
//   would copy Reliance's revenue model onto whatever symbols the reader left in it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const APPLY = argv.includes("--apply");
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const DIR = arg("--dir", "RevenueModelWorkbook");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

/** From the authored corpus: 144–323 chars, 3–5 tags. Warned on, never enforced. */
const LEN_LO = 110, LEN_HI = 420, TAGS_LO = 2, TAGS_HI = 6;

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

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`REVENUE-MODEL LOAD ${APPLY ? "*** LIVE WRITE ***" : "(VALIDATE ONLY — nothing will be written)"}   ${DIR}`);
  console.log("=".repeat(100));
  if (!fs.existsSync(DIR)) { console.log(`\n  no workbook at ${DIR}\n`); return; }

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".csv") && !f.startsWith("_")).sort();
  const problems: string[] = [], warnings: string[] = [];
  let read = 0, blank = 0, invalid = 0, wrote = 0, unchanged = 0;

  for (const file of files) {
    if (ONLY && file !== ONLY) continue;
    const rows = parseCsv(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (rows.length < 2) continue;
    const head = rows[0].map((h) => h.trim().replace(/^★/, ""));
    const iSym = head.indexOf("symbol");
    const iWhat = head.indexOf("what_it_does");
    const iEarn = head.findIndex((h) => h.toUpperCase() === "HOW_IT_EARNS");
    const iTags = head.findIndex((h) => h.toUpperCase().startsWith("TAGS"));
    if (iSym < 0 || iEarn < 0 || iTags < 0) { problems.push(`${file}: header missing symbol / HOW_IT_EARNS / TAGS`); continue; }

    let fWrote = 0, fBlank = 0;
    for (const r of rows.slice(1)) {
      read++;
      const symbol = (r[iSym] ?? "").trim().toUpperCase();
      const earns = (r[iEarn] ?? "").trim();
      const tags = (r[iTags] ?? "").split("|").map((t) => t.trim()).filter(Boolean);
      if (!earns && !tags.length) { blank++; fBlank++; continue; }   // GUARANTEE 2

      const target = await prisma.$queryRawUnsafe<Array<{ id: string; rm: string; tags: string[] }>>(
        `SELECT o.id, o.revenue_model rm, o.business_tags tags
           FROM stock_overviews o JOIN stocks s ON s.id = o.stock_id WHERE s.symbol = $1`, symbol);
      if (!target.length) { invalid++; problems.push(`${file} ${symbol}: no profile row for this symbol`); continue; }

      // ⚠ A REFUSAL, NOT A WARNING. Pasting the what-it-does text into how-it-earns makes the panel
      //   print the same paragraph twice under two different headings — which reads as a bug in the
      //   product rather than as a gap in the data.
      if (earns && iWhat >= 0 && norm(earns) === norm(r[iWhat] ?? "")) {
        invalid++; problems.push(`${file} ${symbol}: HOW_IT_EARNS is a copy of what_it_does`); continue;
      }
      if (earns && (earns.length < LEN_LO || earns.length > LEN_HI))
        warnings.push(`${file} ${symbol}: ${earns.length} chars (authored rows run 144–323) — loaded`);
      if (tags.length && (tags.length < TAGS_LO || tags.length > TAGS_HI))
        warnings.push(`${file} ${symbol}: ${tags.length} tag(s) (authored rows use 3–5) — loaded`);

      const held = target[0];
      const rmHeld = (held.rm ?? "").trim() !== "";
      const tagsHeld = (held.tags ?? []).length > 0;
      const setRm = earns && !rmHeld;                    // GUARANTEE 1 — never overwrite
      const setTags = tags.length > 0 && !tagsHeld;
      if (!setRm && !setTags) { unchanged++; continue; }

      if (APPLY) {
        const sets: string[] = [], args: unknown[] = [held.id];
        if (setRm) { args.push(earns); sets.push(`revenue_model = $${args.length}`); }
        if (setTags) { args.push(tags); sets.push(`business_tags = $${args.length}::text[]`); }
        await prisma.$executeRawUnsafe(
          `UPDATE stock_overviews SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, ...args);
      }
      wrote++; fWrote++;
    }
    console.log(`  ${file.padEnd(26)} ${APPLY ? "wrote" : "would write"} ${String(fWrote).padStart(4)} · blank ${String(fBlank).padStart(4)}`);
  }

  console.log(`\n  ── TOTAL ──`);
  console.log(`  rows read ${read} · blank(skipped) ${blank} · refused ${invalid} · ${APPLY ? "written" : "would write"} ${wrote} · already filled ${unchanged}`);
  if (warnings.length) {
    console.log(`\n  ${warnings.length} warning(s) — these LOAD, but look at them:`);
    for (const w of warnings.slice(0, 25)) console.log(`     ${w}`);
    if (warnings.length > 25) console.log(`     … and ${warnings.length - 25} more`);
  }
  if (problems.length) {
    console.log(`\n  ⚠ ${problems.length} refused — each row SKIPPED, not forced:`);
    for (const p of problems.slice(0, 30)) console.log(`     ${p}`);
    if (problems.length > 30) console.log(`     … and ${problems.length - 30} more`);
  } else console.log(`\n  no problems.`);

  if (APPLY) {
    const left = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int n FROM stocks s JOIN stock_overviews o ON o.stock_id = s.id
        WHERE s.is_active AND coalesce(trim(o.revenue_model), '') = ''`);
    console.log(`\n  active stocks still without a revenue model: ${left[0].n}\n`);
  } else console.log(`\n  validation pass — re-run with --apply to write.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
