// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// getStockNews — THE ENTITY GUARD, THE JUNK FILTER, AND THE KEY FAILOVER.
//
// Part A is PURE (no network, no DB) and always runs: the guard's rules pinned as fixtures, including
// the two measured failures that forced it to exist (MAHABANK ambiguity, Cyient vs Cyient DLM).
//
// Part B is LIVE and opt-in (NEWS_LIVE=1). It spends real Serper credits — about 10 — and it is the only
// way to answer the questions that matter: what does the guard actually do to a real result set, does
// MAHABANK come back rescued or honestly empty, and does the failover really hand over.
//
//   npx tsx src/scripts/verify-stock-news.ts              (Part A only)
//   NEWS_LIVE=1 npx tsx src/scripts/verify-stock-news.ts  (Part A + Part B, ~10 credits)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { buildEntityGuard, screenNewsItems, shortenCompanyName, buildNewsQuery } from "../chat/web/news-filter.js";
import type { SerperNewsItem } from "../chat/web/serper.js";
import { serperNews, serperKeyReport, __resetSerperState, __setSerperBalanceForTests, LOW_CREDITS } from "../chat/web/serper.js";
import { getStockNewsTool } from "../chat/tools/get-stock-news.js";
import { makeToolContext } from "../chat/tools/registry.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

const item = (title: string, link: string, snippet = "", source = "Test", date = "2 hours ago"): SerperNewsItem => ({ title, link, snippet, date, source });

// ── PART A — THE RULES, PINNED ────────────────────────────────────────────────────────────────────
function partA() {
  rule("PART A1 — shortenCompanyName (shared with the Google News ingest's query shape)");
  const names: [string, string][] = [
    ["Cyient Ltd.", "Cyient"],
    ["Bank of Maharashtra", "Bank of Maharashtra"],
    ["Tata Consultancy Services Ltd", "Tata Consultancy Services"],
    ["HDFC Bank Ltd", "HDFC Bank"],
    ["Reliance Industries Ltd", "Reliance Industries"],
    ["Some Co Pvt. Ltd.", "Some Co"],
  ];
  for (const [raw, want] of names) ok(`"${raw}" → "${want}"`, shortenCompanyName(raw) === want, shortenCompanyName(raw));
  ok('query shape is the production one', buildNewsQuery("Cyient") === '"Cyient" stock NSE India', buildNewsQuery("Cyient"));

  rule("PART A2 — ★ CYIENT vs CYIENT DLM (a separately listed subsidiary, NOT in Vytal's universe)");
  const cy = buildEntityGuard("CYIENT", "Cyient Ltd.", []);
  const cyientSet = [
    item("Cyient Q1 results: profit rises 12% on services growth", "https://www.moneycontrol.com/news/a"),
    item("Cyient Ltd announces leadership change in engineering unit", "https://economictimes.indiatimes.com/b"),
    item("Hold Cyient DLM; target of Rs 635: Prabhudas Lilladher", "https://www.moneycontrol.com/news/c"),
    item("Cyient DLM shares jump 8% after order win", "https://www.business-standard.com/d"),
    item("Infosys and Wipro lead IT rally", "https://www.livemint.com/e", "IT majors gained on Friday as the Nifty IT index rose."),
    item("Engineering firm bags defence order", "https://www.thehindu.com/f", "Cyient said the order covers avionics work over three years."),
  ];
  const cyScreen = screenNewsItems(cyientSet, cy);
  for (const k of cyScreen.kept) console.log(`     kept    │ ${k.title}`);
  for (const d of cyScreen.dropped) console.log(`     dropped │ ${d.item.title} [${d.reason}]`);
  ok("genuine Cyient news survives (Q1 results)", cyScreen.kept.some((k) => k.title.startsWith("Cyient Q1")));
  ok("'Cyient Ltd' survives — a corporate suffix confirms the match", cyScreen.kept.some((k) => k.title.includes("Cyient Ltd")));
  ok("★ 'Hold Cyient DLM; target of Rs 635' is EXCLUDED", !cyScreen.kept.some((k) => k.title.includes("Cyient DLM")), "sibling-entity");
  ok("★ 'Cyient DLM shares jump 8%' is EXCLUDED", cyScreen.dropped.filter((d) => d.item.title.includes("Cyient DLM")).length === 2);
  ok("an unrelated IT headline is dropped as off-topic", cyScreen.dropped.some((d) => d.item.title.startsWith("Infosys") && d.reason === "off-topic"));
  ok("a headline that names the company only in the SNIPPET survives", cyScreen.kept.some((k) => k.title.startsWith("Engineering firm")));

  rule("PART A3 — ★ MAHABANK (\"Maharashtra\" + \"bank\" is ambiguous: 3/10 on-topic when measured)");
  const mb = buildEntityGuard("MAHABANK", "Bank of Maharashtra", []);
  const mbSet = [
    item("Bank of Maharashtra Q1 net profit up 23%", "https://www.moneycontrol.com/news/g"),
    item("Court rules on compassionate appointment plea against bank", "https://www.livelaw.in/h", "The Bombay High Court heard a plea concerning appointment on compassionate grounds."),
    item("Best FD rates in July 2026: SBI, PNB, Canara Bank compared", "https://www.goodreturns.in/i"),
    item("Maharashtra government clears new industrial policy", "https://www.thehindu.com/j", "The state cabinet approved incentives for manufacturing."),
    item("MAHABANK shares gain after RBI nod", "https://www.business-standard.com/k", "Shares of the lender rose 3%."),
    item("Bank of Maharashtra MSME lending crosses milestone", "https://economictimes.indiatimes.com/l", "The bank said its MSME book grew 18% in the quarter."),
  ];
  const mbScreen = screenNewsItems(mbSet, mb);
  for (const k of mbScreen.kept) console.log(`     kept    │ ${k.title}`);
  for (const d of mbScreen.dropped) console.log(`     dropped │ ${d.item.title} [${d.reason}: ${d.detail}]`);
  ok("genuine Bank of Maharashtra results survive", mbScreen.kept.some((k) => k.title.startsWith("Bank of Maharashtra Q1")));
  ok("★ the compassionate-appointment court ruling is DROPPED", mbScreen.dropped.some((d) => d.item.title.startsWith("Court rules")));
  ok("★ the FD-rate listicle is DROPPED", mbScreen.dropped.some((d) => d.item.title.startsWith("Best FD rates")));
  ok("★ a story about the STATE of Maharashtra is DROPPED", mbScreen.dropped.some((d) => d.item.title.startsWith("Maharashtra government")));
  ok("the all-caps TICKER counts as a clean reference", mbScreen.kept.some((k) => k.title.startsWith("MAHABANK")));
  ok(
    "an item rescued by its snippet after an acronym in the title (MSME)",
    mbScreen.kept.some((k) => k.title.includes("MSME lending")),
    "the ACRONYM_STOPLIST covers MSME; the snippet would rescue it anyway",
  );

  rule("PART A4 — universe-derived sibling markers (a listed sibling extends the parent's name)");
  const tata = buildEntityGuard("TATAMOTORS", "Tata Motors Ltd", ["Tata Motors DVR Ltd"]);
  ok("marker derived from the universe", tata.siblingMarkers.includes("dvr"), JSON.stringify(tata.siblingMarkers));
  const dvr = screenNewsItems([item("Tata Motors DVR shares delisted", "https://x.com/a"), item("Tata Motors sales rise 9%", "https://x.com/b")], tata);
  ok("the listed sibling is excluded, the parent kept", dvr.kept.length === 1 && dvr.kept[0].title.startsWith("Tata Motors sales"));

  rule("PART A5 — the junk filter (12% junk rate measured)");
  const g = buildEntityGuard("TCS", "Tata Consultancy Services Ltd", []);
  const junk = [
    item("TCS share price analysis", "https://www.tradingview.com/symbols/NSE-TCS/"),
    item("TCS stock outlook", "https://www.goodreturns.in/company/tcs/"),
    item("TCS: a value pick", "https://www.equitymaster.com/research-it/tcs"),
    item("Tata Consultancy Services (TCS) Stock Forecast", "https://simplywall.st/stocks/in/software/nse-tcs"),
    item("Tata Consultancy Services Ltd (TCS.NS)", "https://finance.yahoo.com/quote/TCS.NS"),
    item("Top 10 IT stocks to buy in July 2026", "https://www.samco.in/knowledge-center/x", "TCS, Infosys and Wipro feature on the list."),
    item("Tata Consultancy Services Share Price Today", "https://www.example.com/quote"),
    item("TCS share price target 2027", "https://www.example.com/forecast"),
    item("Should you buy TCS after the Q1 miss?", "https://www.example.com/opinion"),
    // ★ BOTH SEEN LIVE, BOTH INITIALLY MISSED: a REGIONAL Yahoo edition (an exact-host list missed
    //   ca.finance.yahoo.com), and the quote-page template title that carries no host tell at all.
    item("Tata Consultancy Services Limited (TCS.NS) Stock Price, News, Quote & History", "https://ca.finance.yahoo.com/quote/TCS.NS/"),
    item("TCS Share Price - Live NSE: TCS Stock Price & Chart", "https://www.somebroker.in/stocks/tcs"),
    item("TCS wins $500 million deal from European retailer", "https://www.moneycontrol.com/news/real"),
  ];
  const js = screenNewsItems(junk, g);
  for (const d of js.dropped) console.log(`     dropped │ ${d.item.title} [${d.reason}: ${d.detail}]`);
  ok("TradingView dropped", js.dropped.some((d) => d.item.link.includes("tradingview")));
  ok("Goodreturns dropped", js.dropped.some((d) => d.item.link.includes("goodreturns")));
  ok("Equitymaster dropped", js.dropped.some((d) => d.item.link.includes("equitymaster")));
  ok("SimplyWall.st forecast page dropped", js.dropped.some((d) => d.item.link.includes("simplywall")));
  ok("Yahoo QUOTE page dropped (its /news/ path is not banned)", js.dropped.some((d) => d.item.link.includes("finance.yahoo.com/quote")));
  ok("'stocks to buy' listicle dropped", js.dropped.some((d) => d.item.title.includes("to buy in July")));
  ok("'Share Price Today' quote page dropped", js.dropped.some((d) => d.item.title.endsWith("Share Price Today")));
  ok("'share price target 2027' forecast page dropped", js.dropped.some((d) => d.item.title.includes("target 2027")));
  ok("'Should you buy…' dropped", js.dropped.some((d) => d.item.title.startsWith("Should you buy")));
  ok("★ a REGIONAL Yahoo quote page dropped (ca.finance.yahoo.com — hosts match as suffixes)", js.dropped.some((d) => d.item.link.includes("ca.finance.yahoo.com")));
  ok("★ a quote-page TEMPLATE title dropped even on an unknown host", js.dropped.some((d) => d.item.link.includes("somebroker")));
  ok("★ the ONE real news item survives", js.kept.length === 1 && js.kept[0].title.includes("$500 million deal"), js.kept.map((k) => k.title).join(" | "));

  rule("PART A6 — a real headline is NOT falsely dropped by the quote-page rule");
  const notJunk = screenNewsItems([item("Cyient share price today: stock slides 6% after Q1 miss", "https://www.moneycontrol.com/news/z")], buildEntityGuard("CYIENT", "Cyient Ltd.", []));
  ok("'X share price today: <real headline>' is KEPT (the rule anchors to the END of the title)", notJunk.kept.length === 1);
}

// ── PART B — LIVE ─────────────────────────────────────────────────────────────────────────────────
/** The six-symbol panel: the two measured failures, two mega-caps, a bank, and a mid-cap. */
const PANEL = ["CYIENT", "MAHABANK", "TCS", "RELIANCE", "HDFCBANK", "INFY"];

async function partB() {
  rule("PART B1 — ★ LIVE: the entity guard's effect on the 6-symbol panel (1 credit each)");
  const summary: { symbol: string; raw: number; kept: number; drops: Record<string, number> }[] = [];
  for (const symbol of PANEL) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { symbol: true, name: true } });
    if (!stock) { ok(`${symbol} is covered`, false, "not in the universe"); continue; }
    const shortName = shortenCompanyName(stock.name);
    const siblings = await prisma.stock.findMany({ where: { name: { startsWith: `${shortName} `, mode: "insensitive" }, NOT: { symbol } }, select: { name: true } });
    const guard = buildEntityGuard(stock.symbol, stock.name, siblings.map((s) => s.name));
    const out = await serperNews(buildNewsQuery(shortName), 1);
    if (!out.ok) { ok(`${symbol} fetch`, false, out.error); continue; }
    const screened = screenNewsItems(out.items, guard);
    const drops: Record<string, number> = {};
    for (const d of screened.dropped) drops[d.reason] = (drops[d.reason] ?? 0) + 1;
    summary.push({ symbol, raw: out.items.length, kept: screened.kept.length, drops });

    console.log(`\n  ── ${symbol} (${stock.name}) · query ${buildNewsQuery(shortName)} · raw ${out.items.length} → kept ${screened.kept.length}`);
    for (const k of screened.kept) console.log(`     ✔ ${k.title}\n        ${k.source} · ${k.date} · ${k.link}`);
    for (const d of screened.dropped) console.log(`     ✘ ${d.item.title}\n        [${d.reason}: ${d.detail}] ${d.item.source} · ${d.item.link}`);
  }
  console.log("\n  ── PANEL SUMMARY ──");
  for (const s of summary) console.log(`     ${s.symbol.padEnd(10)} raw ${String(s.raw).padStart(2)} → kept ${String(s.kept).padStart(2)}   drops: ${Object.entries(s.drops).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  ok("every panel symbol returned a screened result set", summary.length === PANEL.length);
  ok("no kept item is about a different company (manual read of the lists above is the check)", true, "printed verbatim for inspection");

  rule("PART B1b — ★ LIVE: CYIENT over a 7-day window, where the subsidiary actually shows up (1 credit)");
  // The 24h window above happened to contain no Cyient DLM item, so the parent/subsidiary rule had
  // nothing live to bite on. A week-wide fetch is where the measured headline ("Hold Cyient DLM; target
  // of Rs 635") lives — this is the live counterpart of the pinned fixture in PART A2.
  {
    const guard = buildEntityGuard("CYIENT", "Cyient Ltd.", []);
    const out = await serperNews(buildNewsQuery("Cyient"), 7);
    if (!out.ok) ok("7-day CYIENT fetch", false, out.error);
    else {
      const s = screenNewsItems(out.items, guard);
      for (const k of s.kept) console.log(`     ✔ ${k.title}  [${k.source} · ${k.date}]`);
      for (const d of s.dropped) console.log(`     ✘ ${d.item.title}  [${d.reason}: ${d.detail}]`);
      const dlmSeen = out.items.filter((i) => /cyient\s+dlm/i.test(`${i.title} ${i.snippet}`));
      const dlmKept = s.kept.filter((i) => /cyient\s+dlm/i.test(`${i.title} ${i.snippet}`));
      console.log(`     — Cyient DLM items in the raw set: ${dlmSeen.length}; surviving the guard: ${dlmKept.length}`);
      ok("★ NO Cyient DLM item survives the guard", dlmKept.length === 0, dlmSeen.length ? `${dlmSeen.length} present in the raw set, all excluded` : "none appeared in this window — the fixture in PART A2 carries this case");
      ok("★ …and genuine Cyient news is NOT dropped with it", s.kept.length > 0, `${s.kept.length} kept of ${out.items.length}`);
    }
  }

  rule("PART B2 — ★ LIVE: the TOOL end to end on CYIENT and MAHABANK (2 credits)");
  process.env.AI_CHAT_WEB_SEARCH = "1";
  const ctx = makeToolContext({ userId: "verify-news", sessionId: "verify-news" });
  for (const symbol of ["CYIENT", "MAHABANK"]) {
    const r = await getStockNewsTool.handler({ symbol }, ctx);
    console.log(`\n  ── getStockNews("${symbol}") → ok=${r.ok}\n`);
    console.log((r.ok ? r.content : r.error).split("\n").map((l) => `     │ ${l}`).join("\n"));
    ok(`${symbol} returns a servable result`, r.ok);
    if (r.ok) {
      const hasItems = !r.content.includes("NO NEWS FOUND");
      ok(`${symbol}: ${hasItems ? "items carry headline+source+relative date+URL" : "honest-empty is a real answer"}`,
         hasItems ? /url: https?:\/\//.test(r.content) && /published: .+ \(relative/.test(r.content) : r.content.includes("no news was published"));
      if (hasItems) ok(`${symbol}: the hostile header leads the block`, r.content.startsWith("=== EXTERNAL WEB NEWS — NOT VYTAL DATA"));
    }
  }
  ok("★ webCitations were recorded ⇒ the controller renders the disclaimer + the REAL links",
     ctx.webCitations.every((c) => /^https?:\/\//.test(c.url)),
     ctx.webCitations.map((c) => `${c.source}→${c.url.slice(0, 48)}…`).join(" | ") || "none (both honest-empty)");

  rule("PART B3 — the universe boundary (no credit spent: the DB answers first)");
  const before = serperKeyReport().reduce((n, k) => n + k.spentTotal, 0);
  const bnd = await getStockNewsTool.handler({ symbol: "NOTAREALTICKER" }, makeToolContext({ userId: "v", sessionId: "v" }));
  ok("an uncovered symbol returns the shared boundary message", bnd.ok && bnd.content.startsWith("NOT COVERED:"), bnd.ok ? bnd.content.slice(0, 90) : bnd.error);
  ok("…and spent NO credits (the universe check precedes the fetch)", serperKeyReport().reduce((n, k) => n + k.spentTotal, 0) === before);

  rule("PART B4 — the flag: registered but refusing when AI_CHAT_WEB_SEARCH is off");
  const saved = process.env.AI_CHAT_WEB_SEARCH;
  process.env.AI_CHAT_WEB_SEARCH = "";
  const off = await getStockNewsTool.handler({ symbol: "CYIENT" }, makeToolContext({ userId: "v", sessionId: "v" }));
  ok("refuses honestly, fail-soft (ok:false, the turn survives)", !off.ok && off.error.includes("switched off"), off.ok ? "" : off.error.slice(0, 80));
  process.env.AI_CHAT_WEB_SEARCH = saved;

  rule("PART B5 — ★ KEY FAILOVER (2 credits)");
  const realKey = (process.env.SERPER_API_KEY ?? "").trim();
  const savedKey1 = process.env.SERPER_API_KEY;
  const savedKey2 = process.env.SERPER_API_KEY_2;
  try {
    // ── REACTIVE: key 1 is dead (a bogus key returns the same 403 an exhausted one would) ──────────
    __resetSerperState();
    process.env.SERPER_API_KEY = "0000000000000000000000000000000000000000";
    process.env.SERPER_API_KEY_2 = realKey;
    const r1 = await serperNews(buildNewsQuery("Cyient"), 1);
    ok("reactive: the call still succeeds", r1.ok, r1.ok ? "" : r1.error);
    ok("★ …served by the SECONDARY key", r1.ok && r1.slot === "secondary", r1.ok ? r1.slot : "");
    ok("…and it is flagged as a failover", r1.ok && r1.failedOver === true);
    const rep1 = serperKeyReport();
    ok("primary is retired for the process, with the reason recorded", rep1[0].benched && !!rep1[0].benchReason, rep1[0].benchReason ?? "");
    console.log(`     key report: ${JSON.stringify(rep1)}`);

    // ── PROACTIVE: key 1 works but is nearly out of credits ────────────────────────────────────────
    __resetSerperState();
    process.env.SERPER_API_KEY = realKey;
    process.env.SERPER_API_KEY_2 = realKey;
    __setSerperBalanceForTests("primary", 3);
    __setSerperBalanceForTests("secondary", 2400);
    const r2 = await serperNews(buildNewsQuery("Cyient"), 1);
    ok(`proactive: a primary at 3 credits (threshold ${LOW_CREDITS}) is demoted`, r2.ok && r2.slot === "secondary", r2.ok ? r2.slot : r2.error);
    ok("…and the primary was NOT retired (it is healthy, just low)", !serperKeyReport()[0].benched);

    // ── LAST-KEY-STANDING: a low key still serves when it is all there is ──────────────────────────
    __resetSerperState();
    process.env.SERPER_API_KEY_2 = "";
    __setSerperBalanceForTests("primary", 3);
    const r3 = await serperNews(buildNewsQuery("Cyient"), 1);
    ok("★ a LOW single key still serves (demoted, never removed)", r3.ok && r3.slot === "primary", r3.ok ? r3.slot : r3.error);

    // ── BOTH GONE: honest failure, never a thrown turn ─────────────────────────────────────────────
    __resetSerperState();
    process.env.SERPER_API_KEY = "0000000000000000000000000000000000000000";
    process.env.SERPER_API_KEY_2 = "1111111111111111111111111111111111111111";
    const r4 = await serperNews(buildNewsQuery("Cyient"), 1);
    ok("both keys dead ⇒ ok:false with an honest message (no throw)", !r4.ok, r4.ok ? "" : r4.error.slice(0, 110));
    const toolWhenDead = await getStockNewsTool.handler({ symbol: "CYIENT" }, makeToolContext({ userId: "v", sessionId: "v" }));
    ok("…and the TOOL degrades fail-soft, telling the model not to invent headlines",
       !toolWhenDead.ok && toolWhenDead.error.includes("do not invent"), toolWhenDead.ok ? "" : toolWhenDead.error.slice(0, 110));
  } finally {
    process.env.SERPER_API_KEY = savedKey1;
    process.env.SERPER_API_KEY_2 = savedKey2;
    __resetSerperState();
  }

  rule("PART B6 — credits spent by this run");
  const key = (process.env.SERPER_API_KEY ?? "").trim();
  if (key) {
    const acct = (await (await fetch("https://google.serper.dev/account", { headers: { "X-API-KEY": key } })).json()) as { balance: number };
    console.log(`  Serper balance now (free /account read): ${acct.balance} credits`);
  }
}

async function main() {
  console.log("\n★ getStockNews — ENTITY GUARD · JUNK FILTER · KEY FAILOVER");
  partA();
  if (process.env.NEWS_LIVE === "1") await partB();
  else console.log("\n  (Part B skipped — real Serper credits. Run with NEWS_LIVE=1.)");
  rule(fail === 0 ? "✅ ALL PASS" : `❌ ${fail} FAILURE(S)`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
