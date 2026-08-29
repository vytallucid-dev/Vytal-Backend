// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7 — THE LINK REQUEST. What to paste, in the order worth pasting it.
//   npx tsx src/scripts/stage7-linkrequest.ts
//
// ⚠ ONE DOCUMENT CAN CLOSE TWO UNITS. A March disclosure carries BOTH the quarter
//   column and the year-to-date column, and the runner already reads them by role
//   (quarter_current vs ytd_current). So a March link asked for twice is one link
//   wasted; the count below is DOCUMENTS, not units, and says which serve both.
// ═══════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { fyq as fyqShared, fyLabel } from "./fy-label.js";

const OUT = "_LINKS_WANTED.md";
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
const fyq = (p: string): string => { const r = fyqShared(p); return `${r.fy} ${r.q}`; };
const MONTH: Record<string, string> = { "03": "March", "06": "June", "09": "September", "12": "December" };

/** Ordered by measured return-on-effort, best first. */
const GUIDE: Record<string, { rank: number; head: string; note: string }> = {
  NIACL: { rank: 1, head: "BEST RETURN — proven format, one link per period",
    note: "Your three samples all carried the full NL set (NL-1-B … NL-6) in a 46–56 page bundle. One link closes a period. Click **Archive**, then copy each PDF's address — the `/cms/<uuid>/…?guest=true` links are stable once copied. Link text reads like *Public Disclosures March 2020*." },
  LICI: { rank: 2, head: "PROVEN — but two links per period",
    note: "LICI publishes one form per file (1–2 pages). Each period needs **L-1-A (Revenue Account)** and **L-2 (Profit & Loss)**. Both of your samples fetched clean, so any link copied from the public-disclosure page will work." },
  SBILIFE: { rank: 3, head: "NEEDS THE PUBLIC DISCLOSURES, NOT THE ANNUAL REPORTS",
    note: "⚠ The two annual-report links you sent fetch fine (396pp / 340pp) but contain **no L-forms** — they are the corporate annual report. Please copy from the **public disclosure** dropdown instead (the one whose XHR you found). Those bundles carry L-1/L-2 and one link should close a period." },
  STARHEALTH: { rank: 4, head: "WRONG PAGE — use /investors/disclosures/",
    note: "⚠ Of the four links you sent, the annual reports carry no NL-forms, `FRQ_1_FY_27` fails the content test outright, and `BM_Outcome` has none. Those are exchange filings. The IRDAI public disclosures live at **starhealth.in/investors/disclosures/**." },
  ICICIPRULI: { rank: 5, head: "A DIFFERENT PROBLEM — unit declaration missing",
    note: "These documents are already reachable; they simply **declare no money unit** anywhere in the text, so the parser refuses rather than risk a 100× error. A link does not help unless the document states its unit — if the page offers a **consolidated** or bundled variant for these quarters, that one may declare it." },
  ICICIGI: { rank: 6, head: "site refuses robots — BSE documents exist but are YTD",
    note: "icicilombard.com publishes `Disallow: /`, refused at the transport. Its BSE filings exist but report cumulative YTD in the quarterly slot. A direct link from any other host would work." },
  GICRE: { rank: 7, head: "NO LINKS NEEDED — I can build these URLs myself",
    note: "The route is already solved: `gicre.in/periodicdisclosure/<fy>/<n>-qtr/NL-1-Rev-Acc.html`. Only the column reader blocks it. **Do not spend time copying these.**" },
};
const FALLBACK = { rank: 8, head: "", note: "Copy the period's public disclosure from the insurer's site." };

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

  interface Doc { period: string; needQ: boolean; needA: boolean }
  const per: Record<string, { fam: string; docs: Doc[]; units: number }> = {};
  for (const s of stocks) {
    const floor = s.firstpx && s.firstpx > TARGET ? quarterEnds(s.firstpx, HORIZON)[0] : TARGET;
    if (!floor) continue;
    const docs: Doc[] = [];
    let units = 0;
    for (const p of quarterEnds(floor, HORIZON)) {
      const needQ = !held.has(`${s.symbol}|quarterly|${p}`);
      const needA = p.endsWith("-03-31") && !held.has(`${s.symbol}|annual|${p}`);
      if (!needQ && !needA) continue;
      docs.push({ period: p, needQ, needA });
      units += (needQ ? 1 : 0) + (needA ? 1 : 0);
    }
    if (docs.length) per[s.symbol] = { fam: s.ind === "life_insurance" ? "life" : "general", docs, units };
  }

  const order = Object.keys(per).sort((a, b) =>
    ((GUIDE[a] ?? FALLBACK).rank - (GUIDE[b] ?? FALLBACK).rank) || per[b].units - per[a].units);

  const totalDocs = order.filter((s) => s !== "GICRE").reduce((n, s) => n + per[s].docs.length, 0);
  const totalUnits = order.filter((s) => s !== "GICRE").reduce((n, s) => n + per[s].units, 0);

  const L: string[] = [];
  L.push("# Links wanted");
  L.push("");
  L.push(`**${totalDocs} documents would close ${totalUnits} units.** Fewer documents than units because a`);
  L.push("**March disclosure closes two** — the runner takes the quarter column for Q4 and the year-to-date");
  L.push("column for the annual row out of the same file. Those are marked **Q4+annual** below.");
  L.push("");
  L.push("## How to send them");
  L.push("");
  L.push("One per line, any of these shapes — I only need the symbol, the period end, and the URL:");
  L.push("");
  L.push("```");
  L.push("NIACL  2020-09-30  https://www.newindia.co.in/cms/<uuid>/Public%20Disclosures%20September%202020.pdf?guest=true");
  L.push("LICI   2022-09-30  https://licindia.in/documents/.../L-1A-....pdf   https://licindia.in/documents/.../L-2-....pdf");
  L.push("```");
  L.push("");
  L.push("Several URLs on one line is fine (LICI needs two). If the filename already names the period you");
  L.push("can paste the bare URL and I will read the period off it — but the explicit date is safer, because");
  L.push("filing a number under the wrong quarter is the one error nothing downstream can catch.");
  L.push("");
  L.push("**Order matters more than completeness.** Send NIACL first and stop whenever you like — each");
  L.push("batch runs through the same fenced, ledgered pipeline that wrote the last 28 rows, so partial");
  L.push("batches are useful immediately and nothing has to be re-sent.");
  L.push("");
  L.push("| insurer | documents | units | worth your time? |");
  L.push("|---|---:|---:|---|");
  for (const s of order)
    L.push(`| ${s} | ${s === "GICRE" ? "—" : per[s].docs.length} | ${per[s].units} | ${(GUIDE[s] ?? FALLBACK).head || "—"} |`);
  L.push("");

  for (const s of order) {
    const g = GUIDE[s] ?? FALLBACK;
    const p = per[s];
    L.push("---");
    L.push("");
    L.push(`## ${s} — ${s === "GICRE" ? "no links needed" : `${p.docs.length} documents → ${p.units} units`} (${p.fam})`);
    L.push("");
    L.push(g.note);
    L.push("");
    if (s === "GICRE") continue;
    L.push(`**Forms:** ${p.fam === "life" ? "L-1 Revenue Account · L-2 Profit & Loss" : "NL-1 Revenue Account · NL-2 Profit & Loss"}`);
    L.push("");
    L.push("| # | period end | what to look for | closes |");
    L.push("|---:|---|---|---|");
    p.docs.forEach((d, i) => {
      const label = `${MONTH[d.period.slice(5, 7)]} ${d.period.slice(0, 4)}`;
      const closes = d.needQ && d.needA ? `**${fyq(d.period)} + annual ${fyLabel(fyqShared(d.period).fyYear)}**`
        : d.needA ? `annual ${fyLabel(fyqShared(d.period).fyYear)}` : fyq(d.period);
      L.push(`| ${i + 1} | ${d.period} | ${label} | ${closes} |`);
    });
    L.push("");
  }

  fs.writeFileSync(OUT, L.join("\n"));
  console.log(`  ${totalDocs} documents → ${totalUnits} units  ->  ${OUT}\n`);
  for (const s of order)
    console.log(`     ${s.padEnd(12)} ${s === "GICRE" ? "  -" : String(per[s].docs.length).padStart(3)} docs → ${String(per[s].units).padStart(2)} units`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
