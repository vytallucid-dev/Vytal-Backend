// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 30 — RE-DISCOVER THE BSE ANNUAL DOCUMENTS WHOSE STORED URL IS DEAD.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage30-bse-rediscover-dead-docs.ts            # dry — asks BSE, writes nothing
//   npx tsx src/scripts/stage30-bse-rediscover-dead-docs.ts --commit
//
// ── WHAT IS BROKEN, AND WHAT IS NOT ─────────────────────────────────────────────────────────────
// 48 rows in `fundamentals` carry an `xbrl_url` that BSE no longer serves. VERIFIED BY HAND: those
// NBFCUploadDocument paths return a real HTTP 404 under both URL casings, so BSE removed the file —
// this is not a URL we assemble wrongly.
//
// THE ROWS THEMSELVES ARE FINE. They hold correct P&L figures from when the document WAS readable.
// What they lack is the balance sheet and cash flow that stage 29 added, because stage 29 re-reads
// the stored URL and there is nothing there to read.
//
// ── THE ROUTE ROUND IT ───────────────────────────────────────────────────────────────────────────
// A stored URL is one filename BSE served once. The RESULTS LISTING is the live index of what BSE
// serves for a scrip TODAY, and it is what the lane already uses for normal discovery. So: ask the
// listing again, and take whatever filename it now gives for that period.
//
//   scrip code ← parsed straight out of the dead URL (every one of the 48 embeds it, verified)
//   quarter code ← quarterCodeFor(report_date, "annual")
//   listing ← fetchResultsListing(scrip)          ← cached per scrip, several rows share one
//   url ← findStandaloneDocument(listing, quarterCode)
//
// No new discovery logic: these are the lane's own functions, used the way the lane uses them.
//
// ⚠ THE NEW URL IS PROVEN BEFORE IT IS TRUSTED. It is fetched and parsed first; only a document that
//   actually yields cells causes `xbrl_url` to be rewritten. Replacing a dead URL with a different
//   dead URL would turn a known problem into a silent one.
//
// ⚠ NULL-ONLY WRITES, through the same audited `fillNullColumns` the lane uses. A rediscovered
//   document can add what is missing; it can never overwrite a figure already on the row.
//
// ⚠ SHARES BSE WITH THE stage-29 BACKFILL. Both run against the same host, so this one is
//   deliberately slow (4s default) and small — 48 rows, most sharing scrips. The combined rate is
//   meant to look like one polite client, not two.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { BsePacer, ThrottleStopError } from "../ingestions/quaterly-results/bse/bse-http.js";
import {
  fetchResultsListing, findStandaloneDocument, fetchInstance, quarterCodeFor, type BseListing,
} from "../ingestions/quaterly-results/bse/bse-discovery.js";
import { extractFundamentalCells } from "../ingestions/quaterly-results/bse/bse-extract.js";
import { cellsToColumns, fillNullColumns, type TxClient } from "../ingestions/quaterly-results/bse/bse-column-fill.js";
import { BSE_FILL_EDITOR } from "../ingestions/quaterly-results/bse/backfill-bse.js";
import { deriveAfterBseWrite } from "../ingestions/quaterly-results/bse/bse-derive-after-write.js";

const argv = process.argv;
const COMMIT = argv.includes("--commit");
const numArg = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const strArg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const SPACING = numArg("--spacing", 4000);
const LEDGER = strArg("--dead", "docs/stage29-dead-urls.txt");
const OUT = strArg("--out", "docs/stage30-rediscovery-report.csv");

interface Row { id: string; symbol: string; fy: string; rt: string; rd: string; url: string }

/** Every one of the 48 dead URLs embeds its 6-digit BSE scrip code. Verified against all 48. */
const scripFromUrl = (u: string): string | null => (u.match(/(\d{6})/) ?? [])[1] ?? null;

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 30 — re-discover dead BSE annual documents  ${COMMIT ? "*** COMMIT ***" : "(dry — asks BSE, writes nothing)"}`);
  console.log("=".repeat(100));

  if (!fs.existsSync(LEDGER)) { console.log(`\n  no ledger at ${LEDGER}\n`); await prisma.$disconnect(); return; }
  const ids = fs.readFileSync(LEDGER, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT f.id, s.symbol, f.fiscal_year fy, f.result_type rt, f.report_date::text rd, f.xbrl_url url
      FROM fundamentals f JOIN stocks s ON s.id = f.stock_id
     WHERE f.id = ANY($1::text[]) ORDER BY s.symbol, f.fiscal_year`, ids)) as Row[];
  console.log(`\n  ledger ids ${ids.length} · rows resolved ${rows.length}\n`);

  const pacer = new BsePacer({ minSpacingMs: SPACING });
  const listings = new Map<string, BseListing | null>();   // several rows share a scrip
  const listingErrors = new Map<string, string>();        // why a scrip has no listing, kept verbatim
  const report: string[] = ["symbol,fiscal_year,result_type,outcome,detail,new_url"];
  let relisted = 0, sameUrl = 0, notListed = 0, noXbrl = 0, unfetchable = 0, filled = 0, noScrip = 0, cellsEmpty = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tag = `${r.symbol} ${r.fy} ${r.rt}`;
    const push = (outcome: string, detail = "", url = ""): void => {
      report.push(`${r.symbol},${r.fy},${r.rt},${outcome},"${detail.replace(/"/g, "'")}",${url}`);
    };

    const scrip = scripFromUrl(r.url);
    if (!scrip) { noScrip++; push("no_scrip_code", "could not parse a scrip code from the dead URL"); continue; }

    let quarterCode: string;
    try {
      quarterCode = quarterCodeFor(new Date(`${r.rd.slice(0, 10)}T00:00:00.000Z`), "annual");
    } catch (e) {
      // Non-exchange-calendar year end. quarterCodeFor THROWS rather than guessing "MC", which is
      // correct — see its own note about December filers being starved by a hardcoded prefix.
      push("bad_period_end", String(e).slice(0, 90)); continue;
    }

    // ⚠ THE ERROR IS THE ANSWER — DO NOT SWALLOW IT. The first version wrote
    //   `fetchResultsListing(...).catch(() => null)`, which collapsed every possible failure into one
    //   indistinguishable "listing_unavailable". 27 of 48 rows landed in that bucket and the report
    //   could not say whether the scrip genuinely has no listing (permanent, nothing to do) or the
    //   request merely failed under load (transient, retry later). Those need opposite responses, and
    //   guessing which one it was is exactly the kind of assumption that gets recorded as fact.
    //
    //   ⚠ A ThrottleStopError inside the `.catch` was ALSO swallowed, so the outer catch never saw it
    //     and the run kept pushing into a throttle instead of stopping.
    if (!listings.has(scrip)) {
      try {
        listings.set(scrip, await fetchResultsListing(pacer, scrip));
      } catch (e) {
        if (e instanceof ThrottleStopError) {
          console.log(`\n  ⚠ BSE throttled at ${i}/${rows.length} — stopping. Re-run later to resume.`);
          break;
        }
        listings.set(scrip, null);
        listingErrors.set(scrip, String(e).slice(0, 120));
      }
    }
    const listing = listings.get(scrip) ?? null;
    if (!listing) {
      notListed++;
      push("listing_unavailable", `scrip ${scrip}: ${listingErrors.get(scrip) ?? "no listing returned"}`);
      console.log(`     ${tag.padEnd(34)} listing failed — ${(listingErrors.get(scrip) ?? "empty").slice(0, 60)}`);
      continue;
    }

    const found = findStandaloneDocument(listing, quarterCode);
    if (found.kind === "not_listed") { notListed++; push("not_listed", `${quarterCode} absent from the listing`); continue; }
    if (found.kind === "listed_without_xbrl") { noXbrl++; push("listed_without_xbrl", quarterCode); continue; }

    // ⚠ THE PRIMARY IS NOT THE ONLY CANDIDATE. findStandaloneDocument ranks the filenames a listing
    //   offers and returns the rest as `alternates`. A first pass skipped every row whose primary
    //   matched the known-dead URL — 29 of 48 — and never looked at the alternates behind it. BSE
    //   frequently lists the same period under more than one filename, so discarding them threw away
    //   the most likely recovery.
    //
    //   The known-dead URL is removed from the candidate list rather than retried: it has already
    //   been proven to 404, and re-asking costs a request to learn nothing.
    const candidates = [found.url, ...found.alternates].filter((u) => u !== r.url);
    if (!candidates.length) {
      sameUrl++; push("same_dead_url", "listing offers only the 404 filename", found.url);
      console.log(`     ${tag.padEnd(34)} listing offers only the dead filename`);
      continue;
    }
    relisted++;

    // ⚠ PROVE IT BEFORE TRUSTING IT.
    let xml: string;
    try {
      xml = await fetchInstance(pacer, candidates[0], candidates.slice(1));
    } catch (e) {
      if (e instanceof ThrottleStopError) { console.log(`\n  ⚠ BSE throttled at ${i}/${rows.length} — stopping.`); break; }
      unfetchable++; push("new_url_also_dead", String(e).slice(0, 90), candidates.join(" | "));
      console.log(`     ${tag.padEnd(34)} new URL also unfetchable`);
      continue;
    }

    const cells = extractFundamentalCells(xml).cells as unknown as Record<string, number | null | undefined>;
    const cols = cellsToColumns("fundamentals", cells);
    const present = Object.entries(cols).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k);
    if (!present.length) {
      cellsEmpty++; push("fetched_but_no_cells", "document parsed to nothing", candidates[0]);
      continue;
    }

    const workingUrl = candidates[0];
    console.log(`     ${tag.padEnd(34)} ✅ recovered · ${present.length} cell(s)`);
    if (!COMMIT) { push("would_fill", `${present.length} cells`, workingUrl); continue; }

    try {
      const fill = await prisma.$transaction(
        async (tx) => fillNullColumns(tx as unknown as TxClient, "fundamentals", r.id, cols, workingUrl,
          BSE_FILL_EDITOR, `${r.fy} ${r.rt} · stage 30 rediscovered document`),
        { timeout: 120_000, maxWait: 20_000 },
      );
      // The row's stored URL was dead; point it at the one that works, so the next re-read succeeds.
      await prisma.$executeRawUnsafe(
        `UPDATE fundamentals SET xbrl_url = $2, updated_at = now() WHERE id = $1`, r.id, workingUrl);
      if (fill.landed.length) { filled++; await deriveAfterBseWrite(prisma, "fundamentals", r.id); }
      push("filled", `${fill.landed.length} cells landed`, workingUrl);
    } catch (e) {
      push("write_failed", String(e).slice(0, 90), workingUrl);
      console.log(`     ${tag.padEnd(34)} ⚠ write failed: ${String(e).slice(0, 80)}`);
    }
  }

  fs.writeFileSync(OUT, report.join("\n") + "\n");
  console.log(`\n  ── RESULT ──`);
  console.log(`  re-listed under a NEW filename   ${relisted}`);
  console.log(`     of those, filled              ${filled}`);
  console.log(`     new URL also dead             ${unfetchable}`);
  console.log(`     fetched but parsed to nothing ${cellsEmpty}`);
  console.log(`  listing repeats the dead URL     ${sameUrl}`);
  console.log(`  period not listed at all         ${notListed}`);
  console.log(`  listed but carries no XBRL       ${noXbrl}`);
  console.log(`  no scrip code in the URL         ${noScrip}`);
  console.log(`\n  per-row report → ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
