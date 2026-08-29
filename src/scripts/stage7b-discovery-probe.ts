// ═══════════════════════════════════════════════════════════════
// STAGE 7b — DISCOVERY PROBE against the REAL disclosure pages.
//
//   npx tsx src/scripts/stage7b-discovery-probe.ts [SYMBOL,...]
//
// Read-only. Goes through the IRDAI transport, so the 5.2s per-host courtesy
// spacing and the robots refusal (ICICIGI) apply automatically.
//
// ── WHY IT SCANS THE WHOLE DOCUMENT, NOT JUST <a href> ──────────────────────
// Every one of these pages hides its list behind a dropdown, tab, accordion or
// modal. That is TWO different situations and they need telling apart:
//
//   (a) the links are all IN the HTML already and merely hidden by CSS/JS
//       -> a static fetch sees everything; the widget is irrelevant to us
//   (b) the list is fetched by JavaScript after the click
//       -> a static fetch sees nothing; we need the XHR endpoint or a browser
//
// Looking only at anchor tags cannot tell those apart, because case (a) often
// stores paths in data- attributes or an inline JSON blob rather than <a> tags.
// So this counts `.pdf` occurrences ANYWHERE in the response and reports where
// they were found. That is the difference between "this site is easy" and "this
// site needs a headless browser", and guessing it wrong wastes days.
//
// It also refuses to call a 404 page a result: my earlier guessed URLs returned
// 404 pages whose site NAVIGATION still contained brochure PDFs, which would have
// read as success.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { fetchRaw } from "../ingestions/quaterly-results/irdai/irdai-http.js";

const OUT = "_s7b-discovery.json";

/** The real pages, as supplied. Tracking params stripped — they are not part of the resource. */
const ENTRY: { symbol: string; family: string; url: string; note: string }[] = [
  { symbol: "HDFCLIFE", family: "life", url: "https://www.hdfclife.com/about-us/public-disclosure", note: "plain page" },
  { symbol: "SBILIFE", family: "life", url: "https://www.sbilife.co.in/about-us/investor-relations", note: "dropdown (quarterly) + accordion (annual)" },
  { symbol: "ICICIPRULI", family: "life", url: "https://www.iciciprulife.com/about-us/investor-relations/yearly-public-disclosures.html", note: "year + quarter dropdowns" },
  { symbol: "LICI", family: "life", url: "https://licindia.in/public-disclosure", note: "nested links" },
  { symbol: "CANHLIFE", family: "life", url: "https://www.canarahsbclife.com/public-disclosures", note: "dropdown" },
  { symbol: "NIACL", family: "general", url: "https://www.newindia.co.in/public-disclosure", note: "Archive tab holds history" },
  { symbol: "GICRE", family: "general", url: "https://www.gicre.in/en/31-public-disclosures", note: "plain page" },
  { symbol: "STARHEALTH", family: "general", url: "https://www.starhealth.in/investors/disclosures/", note: "multiple tabs, unknown which" },
  { symbol: "GODIGIT", family: "general", url: "https://www.godigit.com/financials", note: "modal opens with links" },
];

/** A disclosure PDF names a period; a brochure does not. */
const PERIOD = /(20\d{2}\s*[-–_/]\s*(?:20)?\d{2})|(\bfy\s?-?\s?\d{2,4}\b)|(\bq[1-4]\b)|(\b(?:march|june|sept?(?:ember)?|dec(?:ember)?|mar|jun|sep|dec)\b)/i;
/** IRDAI form codes and disclosure wording. */
const FORMISH = /\b(l-?\d{1,2}|nl-?\d{1,2}|public[\s_-]*disclosur|revenue\s*account|balance\s*sheet|profit\s*(?:and|&)\s*loss|financial\s*statement)\b/i;

interface Hit { url: string; where: string; context: string }

/** Every .pdf path in the document, however it is embedded. */
function findPdfs(html: string, base: string): Hit[] {
  const seen = new Map<string, Hit>();
  const push = (raw: string, where: string, context: string): void => {
    let u = raw.replace(/&amp;/g, "&").trim();
    if (!u || u.startsWith("data:")) return;
    try { u = new URL(u, base).toString(); } catch { return; }
    if (!seen.has(u)) seen.set(u, { url: u, where, context: context.replace(/\s+/g, " ").slice(0, 110) });
  };
  // 1. anchors — carry link text, the best period evidence
  const a = /<a\b[^>]*href\s*=\s*["']([^"']*\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = a.exec(html)) !== null) push(m[1], "anchor", m[2].replace(/<[^>]+>/g, " "));
  // 2. any attribute (data-file, data-href, src, …) — the dropdown/modal case
  const attr = /(?:href|src|data-[a-z-]*)\s*=\s*["']([^"']*\.pdf[^"']*)["']/gi;
  while ((m = attr.exec(html)) !== null) push(m[1], "attribute", "");
  // 3. inside inline JSON / JS strings — the XHR-payload-baked-into-page case
  const js = /["']([^"'\s]{4,300}?\.pdf(?:\?[^"'\s]*)?)["']/gi;
  while ((m = js.exec(html)) !== null) push(m[1], "inline-json", "");
  return [...seen.values()];
}

async function main(): Promise<void> {
  const only = process.argv[2]?.split(",").map((s) => s.trim().toUpperCase());
  const targets = only ? ENTRY.filter((e) => only.includes(e.symbol)) : ENTRY;
  console.log(`\n=== STAGE 7b — discovery probe, real pages (${targets.length}) ===\n`);
  const report: Record<string, unknown>[] = [];

  for (const t of targets) {
    const r = await fetchRaw(t.url, { timeoutMs: 60_000 });
    const html = r.text ?? "";
    const pdfs = r.status && r.status < 400 ? findPdfs(html, r.finalUrl ?? t.url) : [];
    const disclosure = pdfs.filter((p) => PERIOD.test(p.url) || PERIOD.test(p.context));
    const formish = pdfs.filter((p) => FORMISH.test(p.url) || FORMISH.test(p.context));
    const byWhere = pdfs.reduce<Record<string, number>>((acc, p) => { acc[p.where] = (acc[p.where] ?? 0) + 1; return acc; }, {});

    const verdict =
      r.status === null ? `FETCH ERROR: ${r.error}`
      : r.status >= 400 ? `HTTP ${r.status} — wrong URL, not probing further`
      : pdfs.length === 0 ? "0 PDFs in the HTML -> list is loaded by JS (needs XHR endpoint or headless)"
      : disclosure.length === 0 ? `${pdfs.length} PDFs but NONE name a period -> probably not the disclosure list`
      : `USABLE: ${pdfs.length} PDFs, ${disclosure.length} with a period, ${formish.length} form-ish`;

    console.log(`  ${t.symbol.padEnd(12)} HTTP ${String(r.status).padStart(3)} ${String(r.buf.length).padStart(8)}b  ${verdict}`);
    console.log(`     note: ${t.note}`);
    if (pdfs.length) console.log(`     found in: ${JSON.stringify(byWhere)}`);
    for (const p of disclosure.slice(0, 5)) {
      const label = p.context || p.url.split("/").pop()!.slice(0, 70);
      console.log(`        "${label.slice(0, 64)}"`);
      console.log(`           ${p.url.slice(0, 104)}`);
    }
    console.log("");
    report.push({ ...t, status: r.status, bytes: r.buf.length, finalUrl: r.finalUrl,
      pdfCount: pdfs.length, disclosureCount: disclosure.length, formishCount: formish.length,
      foundIn: byWhere, verdict, samples: disclosure.slice(0, 25) });
  }

  const usable = report.filter((x) => String(x.verdict).startsWith("USABLE"));
  const jsOnly = report.filter((x) => String(x.verdict).includes("loaded by JS"));
  const wrong = report.filter((x) => String(x.verdict).startsWith("HTTP") || String(x.verdict).startsWith("FETCH"));
  console.log(`  -- SUMMARY --`);
  console.log(`  static fetch is enough : ${usable.length}  ${usable.map((x) => `${x.symbol}(${x.disclosureCount})`).join(" ")}`);
  console.log(`  needs JS/XHR route     : ${jsOnly.length}  ${jsOnly.map((x) => x.symbol).join(" ")}`);
  if (wrong.length) console.log(`  bad URL / error        : ${wrong.length}  ${wrong.map((x) => x.symbol).join(" ")}`);
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
  console.log(`\n  detail -> ${OUT}\n`);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
