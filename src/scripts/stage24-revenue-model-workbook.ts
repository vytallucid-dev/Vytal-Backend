// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 24 — GENERATE THE FILLABLE WORKBOOK FOR revenue_model + business_tags. Read-only.
//
//   npx tsx src/scripts/stage24-revenue-model-workbook.ts [--out RevenueModelWorkbook]
//
// MEASURED: 2,066 of 2,290 active stocks carry a profile with `revenue_model` blank and no
// `business_tags`. Those two fields are the only ones in stock_overviews that no feed can supply —
// "how it earns" is analysis (it names customers, judges margins, says which segment is growing) and
// the tags are curated segments, not a split of an industry label. So they are written by hand or
// not at all, and this is the sheet for writing them.
//
// ── SPLIT BY MARKET-CAP TIER, BIGGEST FIRST ──────────────────────────────────────────────────────
// Not alphabetically. 61 of the 2,066 are large or mid cap — the ones a reader is most likely to
// open — and they sit in their own small files so that work can be done and loaded without touching
// the 1,772-row small-cap tail. Within each file, ordered by market cap descending: value first,
// always.
//
// ── EVERY ROW CARRIES ITS OWN CONTEXT ────────────────────────────────────────────────────────────
// A revenue model cannot be written from a ticker. Each row ships the company name, sector, industry,
// listing year and the full "what it does" text already on file, so the sheet is self-sufficient —
// no tab-switching to look a company up, which is what makes a 2,000-row job survivable.
//
// ── EXAMPLES SHIP AS A SEPARATE, UNLOADABLE FILE ─────────────────────────────────────────────────
// `_EXAMPLES.csv` holds ten real authored rows. It is underscore-prefixed because the loader skips
// underscore files by convention — worked examples sitting in a data file WILL eventually be loaded
// as data by someone, and then Reliance's revenue model belongs to a small-cap textile mill.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "RevenueModelWorkbook";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const esc = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]): string =>
  [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";

interface Row {
  symbol: string; name: string; sector: string | null; industry: string | null;
  listed: number | null; tier: string | null; mcap: string | null; core: string | null;
}

const HEADER = [
  "symbol", "company", "sector", "industry", "listed", "market_cap_cr", "what_it_does",
  "★HOW_IT_EARNS", "★TAGS_pipe_separated",
];
const toRow = (r: Row): unknown[] => [
  r.symbol, r.name, r.sector ?? "", r.industry ?? "", r.listed ?? "",
  r.mcap == null ? "" : Math.round(Number(r.mcap) / 1e7),
  r.core ?? "", "", "",
];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 24 — revenue-model workbook  ->  ${OUT}/`);
  console.log("=".repeat(100));

  const need = await raw<Row>(`
    WITH px AS (SELECT DISTINCT ON (stock_id) stock_id, close FROM daily_prices ORDER BY stock_id, date DESC),
         sh AS (SELECT DISTINCT ON (stock_id) stock_id, total_shares FROM shareholding_patterns
                 WHERE total_shares IS NOT NULL AND total_shares > 0 ORDER BY stock_id, as_on_date DESC)
    SELECT s.symbol, s.name, sec.name AS sector, o.industry, o.listed_since AS listed,
           s.market_cap_category AS tier, (px.close * sh.total_shares)::text AS mcap,
           o.core_business AS core
      FROM stocks s
      JOIN stock_overviews o ON o.stock_id = s.id
      LEFT JOIN sectors sec ON sec.id = s.sector_id
      LEFT JOIN px ON px.stock_id = s.id
      LEFT JOIN sh ON sh.stock_id = s.id
     WHERE s.is_active AND coalesce(trim(o.revenue_model), '') = ''
     ORDER BY (px.close * sh.total_shares) DESC NULLS LAST, s.symbol`);

  const examples = await raw<Row & { revenue: string; tags: string[] }>(`
    SELECT s.symbol, s.name, sec.name AS sector, o.industry, o.listed_since AS listed,
           s.market_cap_category AS tier, NULL::text AS mcap, o.core_business AS core,
           o.revenue_model AS revenue, o.business_tags AS tags
      FROM stock_overviews o JOIN stocks s ON s.id = o.stock_id
      LEFT JOIN sectors sec ON sec.id = s.sector_id
     WHERE coalesce(trim(o.revenue_model), '') <> ''
     ORDER BY s.market_cap_category, s.symbol`);

  fs.mkdirSync(OUT, { recursive: true });

  // ── split: tiers first, then the small-cap tail in openable chunks ─────────────────────────
  const files: Array<{ file: string; rows: Row[]; note: string }> = [];
  const tier = (t: string | null): Row[] => need.filter((r) => (r.tier ?? "(unclassified)") === t);
  files.push({ file: "01_large_cap.csv", rows: tier("large_cap"), note: "Top-100 by market cap. Highest value per row — do these first." });
  files.push({ file: "02_mid_cap.csv", rows: tier("mid_cap"), note: "Ranks 101–250." });
  const small = tier("small_cap");
  const CHUNK = 450;
  for (let i = 0; i < small.length; i += CHUNK) {
    const n = Math.floor(i / CHUNK) + 1;
    files.push({
      file: `03_small_cap_${String(n).padStart(2, "0")}.csv`,
      rows: small.slice(i, i + CHUNK),
      note: `Small cap, part ${n} — still ordered by market cap, so the largest remain at the top.`,
    });
  }
  files.push({
    file: "04_unclassified.csv", rows: tier("(unclassified)"),
    note: "No market cap: no share count on file, mostly 2024+ listings that have not filed a shareholding pattern. Lowest priority.",
  });

  let total = 0;
  for (const f of files) {
    if (!f.rows.length) continue;
    fs.writeFileSync(path.join(OUT, f.file), csv(HEADER, f.rows.map(toRow)));
    total += f.rows.length;
    console.log(`  ${f.file.padEnd(26)} ${String(f.rows.length).padStart(5)} rows`);
  }

  // ── examples — ten authored rows, spread across tiers and sectors ──────────────────────────
  const pick: typeof examples = [];
  const seenSector = new Set<string>();
  for (const e of examples) {
    if (pick.length >= 10) break;
    const k = e.sector ?? e.industry ?? "?";
    if (seenSector.has(k)) continue;
    seenSector.add(k);
    pick.push(e);
  }
  fs.writeFileSync(
    path.join(OUT, "_EXAMPLES.csv"),
    csv(["symbol", "company", "sector", "industry", "what_it_does", "HOW_IT_EARNS (real)", "TAGS (real)"],
      pick.map((e) => [e.symbol, e.name, e.sector ?? "", e.industry ?? "", e.core ?? "", e.revenue, (e.tags ?? []).join(" | ")])));

  fs.writeFileSync(path.join(OUT, "_INDEX.csv"),
    csv(["file", "rows", "note"], files.filter((f) => f.rows.length).map((f) => [f.file, f.rows.length, f.note])));

  // ── README ────────────────────────────────────────────────────────────────────────────────
  const ex = (n: number): string => {
    const e = pick[n];
    if (!e) return "";
    return `**${e.symbol}** — ${e.name}\n\n> **How it earns:** ${e.revenue}\n>\n> **Tags:** \`${(e.tags ?? []).join("` `")}\`\n`;
  };
  const lenStats = await raw<{ lo: number; avg: number; hi: number }>(
    `SELECT min(length(revenue_model))::int lo, round(avg(length(revenue_model)))::int avg, max(length(revenue_model))::int hi
       FROM stock_overviews WHERE coalesce(trim(revenue_model),'') <> ''`);

  fs.writeFileSync(path.join(OUT, "README.md"), `# How-it-earns workbook

${total} stocks need **\`HOW_IT_EARNS\`** and **\`TAGS\`**. Every other field on their profile —
industry, listing year, "what it does" — is already filled and is shown here as context.

These two are the only fields in the whole profile that **no data source can supply**. "How it earns"
names customers, judges margins and says which segment is growing; the tags are curated business
segments, not a split of an industry label. They are written by a person or they stay empty — and an
empty one is handled honestly by the UI, which simply omits that half of the panel.

## Files

| file | rows | do these |
|---|---:|---|
${files.filter((f) => f.rows.length).map((f) => `| \`${f.file}\` | ${f.rows.length} | ${f.note} |`).join("\n")}

\`_EXAMPLES.csv\` holds ten real authored rows. It is underscore-prefixed so **the loader skips it** —
never rename it into the fill set.

## The two columns

**★ HOW_IT_EARNS** — one short paragraph. Measured against the ${examples.length} already written:
**${lenStats[0].lo}–${lenStats[0].hi} characters, averaging ${lenStats[0].avg}** — roughly two sentences.

Say where the money actually comes from, in this order where it applies:
1. what is sold, and to whom
2. which segment carries the revenue today
3. what moves it — the demand driver, a margin difference, a growing order book

**★ TAGS** — **3 to 5**, pipe-separated: \`Industrial Explosives | Defence (Ammunition) | Exports\`.
(Of the ${examples.length} authored rows: ${(await raw<{ n: number }>(`SELECT count(*)::int n FROM stock_overviews WHERE array_length(business_tags,1)=4`))[0].n} use four.)
Tags are **business segments**, not adjectives. \`Reliance Retail\` is a tag; \`Growing\` is not.

## Rules that matter

- **Leave a row blank rather than guess.** Blank is a supported state end to end: the UI omits the
  "How it earns" half and shows the rest. A plausible-but-invented sentence is indistinguishable
  from a researched one once it is on the page, and it will be read as fact.
- **Do not restate "what it does".** That column is already filled and already renders beside yours.
  If the two say the same thing, the panel says one thing twice.
- **No forecasts, no opinions on the stock.** "Earns from X, with Y growing faster" is a description.
  "Well placed to benefit from the capex cycle" is a view, and it does not belong here.
- Pipe \`|\` separates tags because company names and tags contain commas.
- **Identity columns are pre-filled — do not edit them.** \`symbol\` is how the loader finds the row.

## Worked examples

${ex(0)}
${ex(1)}
${ex(2)}

More in \`_EXAMPLES.csv\`.

## Loading it back

\`\`\`bash
npx tsx src/scripts/stage24b-revenue-model-load.ts            # validate, writes nothing
npx tsx src/scripts/stage24b-revenue-model-load.ts --apply
\`\`\`

The loader **never overwrites** a non-blank \`revenue_model\` — the ${examples.length} authored rows and
anything you have already loaded are safe — and it skips blank rows rather than writing empties. Load
a half-finished workbook as often as you like.
`);

  console.log(`\n  _EXAMPLES.csv               ${pick.length} authored rows (loader skips it)`);
  console.log(`  README.md, _INDEX.csv\n`);
  console.log(`  total rows to fill: ${total}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
