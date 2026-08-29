// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7 — THE INSURANCE MANUAL WORKBOOK, regenerated from the LIVE remaining gaps.
//   npx tsx src/scripts/stage7-workbook.ts
//
// Written AFTER every automated route was tried and measured, so what is listed here
// is what no lane can reach — not what had not been attempted yet. The routes and
// the evidence that closed each one are recorded, because "we did not fetch it" and
// "it cannot be fetched" send a person to very different work.
// ═══════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { fyq as fyqShared, fyLabel } from "./fy-label.js";

const OUT = "_MANUAL_ENTRY_QUEUE_insurance.md";
const TARGET = "2019-03-31";
const HORIZON = "2026-06-30";
const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

function quarterEnds(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++)
    for (const e of ["-03-31", "-06-30", "-09-30", "-12-31"]) {
      const d = `${y}${e}`;
      if (d >= from && d <= to) out.push(d);
    }
  return out.sort();
}
const fyq = fyqShared;

/** Per-site verdict. Every claim here was measured; the measurement is quoted. */
const SITE: Record<string, { verdict: string; why: string; route: string }> = {
  SBILIFE: {
    verdict: "site listing is session-gated; no exchange route exists",
    why: "The Liferay documents API answers **403** to every anonymous form tried — the 3-taxonomy filter verbatim, the filter reduced to the constant category, a minted guest session (`JSESSIONID`/`p_auth` from a real page visit) and full browser fetch-metadata. **The PDFs themselves are public** (`/documents/d/sbil/annual-report-fy-2019-2020` → 200, `%PDF-`, 31.8 MB); only the period→URL listing is gated, and the slugs are not derivable (`fy-2018-2019`, `fy-2020-2021`, `fy-2023-2024` all 404). BSE holds **no XBRL** for any of the 30. NSE v2 returns **0 filings** for SBILIFE where TCS returns 52.",
    route: "Open each year+quarter in the browser and save the PDF, or paste the API's JSON response — the listing is the only missing piece; fetching is already solved.",
  },
  LICI: {
    verdict: "PDFs public, titles not derivable; no exchange route",
    why: "Both sample URLs fetch clean (200, `%PDF-`), but LICI renames the same form across vintages and files them under different folder ids (1824921 vs 340752); ten constructed URLs across both conventions **all 404**. Its listing API is 403 like SBILIFE's. BSE holds no XBRL for the 10; NSE v2 returns 0 filings.",
    route: "Copy the real link per period from the public-disclosure page. One working URL per era may reveal that era's pattern — worth checking before doing all ten by hand.",
  },
  NIACL: {
    verdict: "Angular archive over opaque ids; BSE documents exist but carry YTD periods",
    why: "The page is a 4.1 MB Angular shell whose static links are all unrelated. Archive files sit at `/cms/<uuid>/…` with per-document random keys; the newer `/assets/docs/…` names carry arbitrary suffixes (`Public Disclosure June _2026 (3).pdf`). **9 of NIACL's units DO have a BSE document** — but its quarterly context spans 177/266/355 days (H1, 9M, full year), i.e. the filer reports cumulative YTD in the quarterly slot. The period guard refuses those, correctly: this lane never derives a quarter by subtraction.",
    route: "Click Archive and save each period. The uuid links are stable once copied.",
  },
  GICRE: {
    verdict: "route SOLVED — HTML forms, two parser gaps remain",
    why: "GICRE publishes **per-form HTML, not PDF**, at a constructible path: `https://www.gicre.in/periodicdisclosure/<fy>/<n>-qtr/NL-1-Rev-Acc.html`. Verified live: `FORM NL-1-B-RA … PERIOD ENDED 30.06.2019`, the unit `( \\` IN 000)` now resolves to THOUSAND, **9 of 10 NL-1 anchors hit**, and the segment cross-foots exactly (25,794,337 + 818,744 + 148,221 + 1,707,856 = 28,469,158 = TOTAL (A)) — which also proves the space in `25794 337` is a thousands separator, not a cell break. Blocked only in the column reader: GICRE writes **\"ending\"** where the grammar expects \"ended\", and its prior-year columns **carry no date at all**, so 2 of 4 labels resolve.",
    route: "Enter by hand from those URLs, or finish the column-label work — bounded, but it is the module that stops a number being filed under the wrong period, so it deserves its own careful pass.",
  },
  STARHEALTH: {
    verdict: "page readable, but it carries exchange filings rather than IRDAI forms",
    why: "The accordions are CSS-hidden, not JS-fetched — **112 CloudFront PDFs are in the markup**. But the quarterly files are Board Meeting Outcomes, `FRQ`/`NPEFRQ` intimations and newspaper publications: stock-exchange filings that contain no NL-1/NL-2. A content gap, not an access one (CloudFront serves no robots.txt; starhealth.in allows the path).",
    route: "Use `/investors/disclosures/` — the public-disclosure page, not financial-information.",
  },
  ICICIPRULI: {
    verdict: "documents found, but they declare no unit",
    why: "Its per-form PDFs for these quarters carry **no money-unit declaration anywhere in the text layer**. Magnitudes imply thousands, but the lane refuses rather than assume — guessing lakh where the truth is thousand is a 100× error. BSE holds no XBRL for these 17.",
    route: "Read the unit off the document (or a sibling quarter that does declare one) and enter the figures; a proven overlap between a declared and an undeclared period would also settle it by ratio.",
  },
  ICICIGI: {
    verdict: "own site refuses robots; BSE documents carry YTD periods",
    why: "icicilombard.com publishes a blanket `Disallow: /`, refused at the transport. Its BSE documents exist but 7 of them span 177/266/355/451 days — cumulative YTD in the quarterly slot, refused by the period guard.",
    route: "Fetch from the BSE filing itself and take the stated quarter, or enter by hand.",
  },
};
const DEFAULT_SITE = {
  verdict: "no automated route reached these",
  why: "Neither the insurer site, BSE XBRL nor NSE v2 served a usable document for these periods.",
  route: "Take the period's public disclosure from the insurer's website.",
};

async function main(): Promise<void> {
  const stocks = await raw<{ symbol: string; ind: string; firstpx: string | null }>(`
    SELECT s.symbol, s."industryType"::text ind,
           (SELECT min(date)::date::text FROM daily_prices p WHERE p.stock_id=s.id) firstpx
      FROM stocks s WHERE s."industryType"::text IN ('life_insurance','general_insurance') ORDER BY s.symbol`);
  const held = new Set<string>();
  for (const [tbl, grain] of [
    ["life_insurance_quarterly_results", "quarterly"], ["life_insurance_fundamentals", "annual"],
    ["general_insurance_quarterly_results", "quarterly"], ["general_insurance_fundamentals", "annual"],
  ] as const)
    for (const r of await raw<{ symbol: string; d: string }>(
      `SELECT s.symbol, t.report_date::date::text d FROM "${tbl}" t JOIN stocks s ON s.id=t.stock_id
        WHERE t.result_type::text='standalone'`))
      held.add(`${r.symbol}|${grain}|${r.d}`);

  const gaps: Record<string, { fam: string; q: string[]; a: string[] }> = {};
  let total = 0;
  for (const s of stocks) {
    const floor = s.firstpx && s.firstpx > TARGET ? quarterEnds(s.firstpx, HORIZON)[0] : TARGET;
    if (!floor) continue;
    const all = quarterEnds(floor, HORIZON);
    const q = all.filter((p) => !held.has(`${s.symbol}|quarterly|${p}`));
    const a = all.filter((p) => p.endsWith("-03-31") && !held.has(`${s.symbol}|annual|${p}`));
    if (!q.length && !a.length) continue;
    gaps[s.symbol] = { fam: s.ind === "life_insurance" ? "life" : "general", q, a };
    total += q.length + a.length;
  }

  const L: string[] = [];
  L.push("# Manual entry queue — insurance");
  L.push("");
  L.push(`Generated ${new Date().toISOString().slice(0, 10)} from the **live remaining gaps**, after every`);
  L.push("automated route was tried and measured. **${TOTAL} units** across ${N} insurers.".replace("${TOTAL}", String(total)).replace("${N}", String(Object.keys(gaps).length)));
  L.push("");
  L.push("## Routes tried, and what closed them");
  L.push("");
  L.push("| route | result |");
  L.push("|---|---|");
  L.push("| insurer websites | 4 of 5 gated (session-only APIs, Angular/uuid archives) — see per-site notes |");
  L.push("| **BSE XBRL** | ran over all 116 unserved units: **88 `listed_without_xbrl`**, 24 `period_assert_failed`, 3 `not_listed`, **1 written**. Fence clean on every chunk. |");
  L.push("| **NSE v2** (`corporates-financial-results`) | **does not carry insurers at all** — 0 filings for all 6 tested, against 52 for TCS in the same window. Matches its documented `ind_as`/`banking` granularity. |");
  L.push("| NSE v3 (integrated filing) | insurance-aware, but only from FY2025 — it is already the source of every recent row. |");
  L.push("");
  L.push("The 24 `period_assert_failed` are worth stating plainly: those documents **exist**, but the");
  L.push("insurer files **cumulative YTD in the quarterly context** — measured spans of 177 days (H1),");
  L.push("266 (9M) and 355 (full year). The guard refuses them because this lane never derives a quarter");
  L.push("by subtraction. They are recoverable only by reading the stated quarter off the filing.");
  L.push("");
  L.push("## Rules for entry");
  L.push("");
  L.push("Values in **₹ crore**. Rows key on `(stock, fiscal_year, quarter, result_type)`, `result_type =");
  L.push("standalone`. **Leave a period out rather than entering a partial guess** — an empty row reads as");
  L.push("a gap to every consumer while still consuming a retention slot, which is worse than absence.");
  L.push("");
  L.push("| life columns | general columns |");
  L.push("|---|---|");
  L.push("| gross_premium_income, reinsurance_ceded, total_commission, total_operating_expenses, profit_before_tax, net_profit | premium_earned, total_revenue, incurred_claims, net_commission, total_operating_expenses_related_to_insurance |");
  L.push("");
  L.push("| insurer | family | units | verdict |");
  L.push("|---|---|---:|---|");
  for (const [sym, g] of Object.entries(gaps).sort((a, b) => (b[1].q.length + b[1].a.length) - (a[1].q.length + a[1].a.length)))
    L.push(`| ${sym} | ${g.fam} | ${g.q.length + g.a.length} | ${(SITE[sym] ?? DEFAULT_SITE).verdict} |`);
  L.push("");

  for (const [sym, g] of Object.entries(gaps).sort((a, b) => (b[1].q.length + b[1].a.length) - (a[1].q.length + a[1].a.length))) {
    const s = SITE[sym] ?? DEFAULT_SITE;
    L.push("---");
    L.push("");
    L.push(`## ${sym} — ${g.q.length + g.a.length} units (${g.fam})`);
    L.push("");
    L.push(`**${s.verdict}**`);
    L.push("");
    L.push(s.why);
    L.push("");
    L.push(`**How to get them:** ${s.route}`);
    L.push("");
    L.push(`**Forms:** ${g.fam === "life" ? "L-1 Revenue Account · L-2 Profit & Loss" : "NL-1 Revenue Account · NL-2 Profit & Loss"}`);
    L.push("");
    if (g.q.length) {
      L.push(`### quarterly (${g.q.length})`);
      L.push("");
      L.push("| period end | fiscal year | quarter |");
      L.push("|---|---|---|");
      for (const p of g.q) { const f = fyq(p); L.push(`| ${p} | ${f.fy} | ${f.q} |`); }
      L.push("");
    }
    if (g.a.length) {
      L.push(`### annual (${g.a.length})`);
      L.push("");
      L.push("| period end | fiscal year |");
      L.push("|---|---|");
      for (const p of g.a) L.push(`| ${p} | ${fyLabel(fyqShared(p).fyYear)} |`);
      L.push("");
    }
  }

  fs.writeFileSync(OUT, L.join("\n"));
  console.log(`  ${total} units across ${Object.keys(gaps).length} insurers -> ${OUT}`);
  for (const [sym, g] of Object.entries(gaps).sort((a, b) => (b[1].q.length + b[1].a.length) - (a[1].q.length + a[1].a.length)))
    console.log(`     ${sym.padEnd(12)} ${String(g.q.length + g.a.length).padStart(3)}  (Q ${g.q.length} · A ${g.a.length})`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
