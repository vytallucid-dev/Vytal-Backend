// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTITY GUARD + JUNK FILTER — what stands between a web search and the model's context.
//
// ★ WHY THIS IS REQUIRED AND NOT POLISH. Serper returns NO relevance score. There is no field to
// threshold on, so a result set that is entirely about other companies is indistinguishable, in code,
// from a perfect one. Two failures were measured on the very first evaluation run:
//
//   · MAHABANK — 3 of 10 results on topic. A compassionate-appointment court ruling, generic FD-rate
//     listicles, and other banks entirely. "Maharashtra" + "bank" is an ambiguous string.
//   · CYIENT vs CYIENT DLM — a separately listed subsidiary with its own financials. A naive substring
//     match on "Cyient" conflates the two, and the model then attributes the subsidiary's news to the
//     parent the reader actually asked about.
//
// Nothing downstream can recover from either: the model cannot know a headline is about the wrong
// company, and the fact block it would otherwise contradict is silent on the matter. So the filter is
// the last honest checkpoint, and it errs toward DROPPING.
//
// ── THE COST ASYMMETRY THAT SETS THE TUNING (opposite to guardrail.ts's, deliberately) ────────────
// guardrail.ts passes when in doubt, because a false block replaces the truth with nothing. HERE the
// costs invert: a false drop loses one headline and, at worst, produces an honest "no news found in the
// last day" — a real answer. A false KEEP hands the model another company's news, which it will
// faithfully report as this company's. So this filter drops when in doubt, and says so.
//
// PURE — no network, no DB, no clock. Every input arrives as an argument.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { SerperNewsItem } from "./serper.js";

// ── COMPANY NAME → SEARCHABLE SHORT NAME ──────────────────────────────────────────────────────────
// The SAME derivation the Google News ingest uses (ingestions/news_and_announcements/google-news.ts),
// because the production query shape is shared: `"${shortName}" stock NSE India`. Kept in step by
// intent, not by import — the ingest's copy is inline in its fetcher and predates this file.
// ⚠ BARE "Co" IS DELIBERATELY NOT STRIPPED, though it IS accepted as a confirming suffix below. Stripping
// is repeated (a name can carry two: "Foo Pvt. Ltd."), and a repeated strip that eats "Co" turns
// "Some Co Pvt. Ltd." into "Some" — a shorter, more ambiguous query than the one we meant to send.
const CORP_SUFFIX_RE = /[,\s]+(limited|ltd\.?|private|pvt\.?|plc|inc\.?|corp\.?|corporation)$/i;

/** "Cyient Ltd." → "Cyient" · "Bank of Maharashtra" → "Bank of Maharashtra". Strips repeated suffixes
 *  ("Foo Pvt. Ltd." → "Foo") and trailing punctuation. */
export function shortenCompanyName(name: string): string {
  let s = (name ?? "").trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(CORP_SUFFIX_RE, "").trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/[.,;:\s]+$/, "").trim();
}

/** The words a real corporate suffix uses — seeing one AFTER the company name confirms the match. */
const CORP_SUFFIX_WORDS = new Set(["ltd", "ltd.", "limited", "pvt", "pvt.", "private", "plc", "inc", "inc.", "corp", "corp.", "corporation", "co", "co."]);

/**
 * ★ THE SIBLING VOCABULARY — the words Indian group companies are distinguished by. A capitalised one
 * of these sitting directly after the company name means the headline is naming a DIFFERENT entity
 * ("Cyient DLM", "Bajaj Finance" vs "Bajaj Auto", "Tata Motors" vs "Tata Steel").
 */
const AFFILIATE_WORDS = new Set(
  ("technologies technology motors finance financial capital holdings industries infra infrastructure power energy " +
    "retail ventures enterprises services solutions digital global international realty properties estates housing " +
    "life general insurance bank chemicals steel cement foods labs laboratories pharma pharmaceuticals auto mobility " +
    "telecom communications media broadcasting textiles trust investments investment systems engineering logistics " +
    "healthcare hospitals hotels resorts mining petroleum gas fertilisers fertilizers sugar paper plastics polymers " +
    "electronics semiconductors defence aerospace agro dairy breweries distilleries apparel fashion jewellery gems " +
    "exports shipping ports airways aviation construction projects developers resources minerals metals alloys tubes " +
    "pipes wires cables batteries tyres bearings forgings castings machinery equipment instruments automation " +
    "analytics consulting consultancy software infotech").split(" "),
);

/**
 * Acronyms that are ordinary NEWS vocabulary, not company names. Without this list, "Bank of Maharashtra
 * MSME lending" would read as a sibling entity and be dropped. ⚠ It is NOT exhaustive and cannot be —
 * see LIMITS on `screenNewsItems`.
 */
const ACRONYM_STOPLIST = new Set(
  ("IT AI EV ESG IPO QIP FPO GST SEBI RBI NSE BSE NCLT NCLAT CCI CBI ED ROC CEO CFO COO CTO CIO MD CMD AGM EGM EPS " +
    "PAT PBT EBIT ROE ROCE ROA NPA GNPA NNPA CASA NIM MSME SME MSMEs USA US UK UAE EU UN JV MOU CSR FII DII FPI NBFC " +
    "AMC ETF NAV SIP PSU PLI GDP CPI WPI UPI KYC ATM NRI FD RD EMI MCLR CRR SLR LTV AUM PE PB PAT YOY QOQ HNI IPOs " +
    "ESOP OFS FMCG EBITDA NDTV PTI ANI IANS BFSI CAGR IRR TDS ITR AGMs").split(" "),
);

export interface EntityGuard {
  symbol: string;
  /** The universe's own name for the company — the ONLY authority on who was asked about. */
  name: string;
  shortName: string;
  /** Case-insensitive name aliases (multi-word tolerated). */
  aliases: string[];
  /** Extra sibling markers derived from the COVERED UNIVERSE (a listed sibling whose name extends ours). */
  siblingMarkers: string[];
}

/**
 * Build the guard for one covered stock.
 *
 * `siblingNames` are OTHER covered companies whose names start with our short name — a free, exact
 * source of sibling markers. It does NOT cover the case that forced this file (Cyient DLM is separately
 * listed but NOT in Vytal's universe), which is why the heuristic below exists as well.
 */
export function buildEntityGuard(symbol: string, name: string, siblingNames: string[] = []): EntityGuard {
  const shortName = shortenCompanyName(name) || name.trim();
  const aliases = [shortName];
  const markers = new Set<string>();
  for (const sib of siblingNames) {
    const s = shortenCompanyName(sib);
    if (!s || s.toLowerCase() === shortName.toLowerCase()) continue;
    if (s.toLowerCase().startsWith(`${shortName.toLowerCase()} `)) {
      const nextWord = s.slice(shortName.length).trim().split(/\s+/)[0];
      if (nextWord) markers.add(nextWord.toLowerCase());
    }
  }
  return { symbol: symbol.toUpperCase(), name, shortName, aliases, siblingMarkers: [...markers] };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whitespace-tolerant, word-bounded matcher for a (possibly multi-word) alias. */
const aliasRe = (alias: string, caseSensitive: boolean): RegExp =>
  new RegExp(`\\b${alias.trim().split(/\s+/).map(escapeRe).join("\\s+")}\\b`, caseSensitive ? "g" : "gi");

type Mention = "clean" | "sibling" | "none";

/**
 * ★ THE RULE, IN ONE FUNCTION. For every occurrence of the company's name, look at the word that
 * follows it:
 *   · a corporate suffix (Ltd / Limited / Pvt)                → OUR company  → clean
 *   · a universe-derived sibling marker                        → someone else → sibling
 *   · an unlisted ALL-CAPS acronym of 2–5 letters ("DLM")      → someone else → sibling
 *   · a capitalised group word ("Finance", "Technologies")     → someone else → sibling
 *   · anything else (a verb, "Q1", "shares", punctuation, end) → OUR company  → clean
 * One clean occurrence anywhere in title or snippet keeps the item.
 */
function mentionKind(text: string, guard: EntityGuard): Mention {
  if (!text) return "none";
  let sawSibling = false;

  const probe = (re: RegExp): Mention | null => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const after = text.slice(m.index + m[0].length);
      const nx = /^(?:['’]s)?[\s]+([A-Za-z][A-Za-z&.'’-]*)/.exec(after);
      if (!nx) return "clean"; // end of string, or punctuation follows — nothing to disambiguate
      const raw = nx[1].replace(/[.,;:]+$/, "");
      const low = raw.toLowerCase();
      if (CORP_SUFFIX_WORDS.has(low) || CORP_SUFFIX_WORDS.has(`${low}.`)) return "clean";
      if (guard.siblingMarkers.includes(low)) { sawSibling = true; continue; }
      if (/^[A-Z]{2,5}$/.test(raw) && !ACRONYM_STOPLIST.has(raw)) { sawSibling = true; continue; }
      if (/^[A-Z]/.test(raw) && AFFILIATE_WORDS.has(low)) { sawSibling = true; continue; }
      return "clean";
    }
    return null;
  };

  for (const alias of guard.aliases) {
    const r = probe(aliasRe(alias, false));
    if (r === "clean") return "clean";
  }
  // The TICKER itself, matched case-SENSITIVELY: "NSE: CYIENT" is an unambiguous reference, while a
  // lowercase coincidence ("idea", "trent") is not. Symbols under 3 characters are too collision-prone.
  if (guard.symbol.length >= 3) {
    const r = probe(aliasRe(guard.symbol, true));
    if (r === "clean") return "clean";
  }
  return sawSibling ? "sibling" : "none";
}

// ── THE JUNK FILTER — measured 12% junk rate on the evaluation run. ───────────────────────────────
// Hosts are banned only on evidence (the three the evaluation named) plus the two shapes the spec
// names: a quote page and a forecast page are not news, whatever their host's reputation.
const JUNK_HOSTS = ["tradingview.com", "goodreturns.in", "equitymaster.com", "simplywall.st"];
/**
 * Host + path-prefix bans, for hosts that publish BOTH real news and quote pages.
 * ⚠ HOSTS ARE MATCHED AS SUFFIXES, and that is not pedantry: a live run surfaced
 * `ca.finance.yahoo.com/quote/HDB/` — the CANADIAN edition, quoting the US ADR — against a question about
 * HDFCBANK. An exact-host list had `finance.yahoo.com` and `in.finance.yahoo.com` and sailed straight past it.
 */
const JUNK_PATHS: { host: RegExp; path: RegExp; why: string }[] = [
  { host: /(^|\.)finance\.yahoo\.com$/, path: /^\/quote\//, why: "Yahoo quote page" },
  { host: /(^|\.)google\.com$/, path: /^\/finance\//, why: "Google Finance quote page" },
];
/** Title shapes that mark a page as a recommendation listicle, a quote page, or a price-prediction page. */
const JUNK_TITLES: { re: RegExp; why: string }[] = [
  { re: /\bstocks?\s+to\s+buy\b/i, why: "recommendation listicle" },
  { re: /\bbest\s+(stocks|shares)\b/i, why: "recommendation listicle" },
  { re: /^top\s+\d+\b[^:]*\b(stocks|shares)\b/i, why: "recommendation listicle" },
  { re: /\bshould\s+you\s+(buy|sell|invest)\b/i, why: "recommendation piece" },
  { re: /\b(multibagger|penny\s+stocks?)\b/i, why: "recommendation genre" },
  { re: /\bshare\s+price\s*(today|live)?\s*$/i, why: "quote page, not an article" },
  { re: /\b(share\s+)?price\s+(prediction|forecast|target)\s+(for\s+)?20\d\d\b/i, why: "price-prediction page" },
  // Quote-page TEMPLATE titles — the same page shape by a different route than the host rules above.
  // Both were seen live: Yahoo's "…Stock Price, News, Quote & History" and the "…Share Price - Live NSE:"
  // family. A real headline does not read like a page title.
  { re: /\bstock\s+price,\s*(news|quote|chart|history)\b/i, why: "quote page (template title)" },
  { re: /\bshare\s+price\s*[-–—|:]\s*live\b/i, why: "quote page (template title)" },
  { re: /\blive\s+nse\s*:/i, why: "quote page (template title)" },
];

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
const pathOf = (url: string): string => {
  try { return new URL(url).pathname; } catch { return "/"; }
};

export type DropReason = "junk-host" | "junk-title" | "duplicate" | "sibling-entity" | "off-topic";

export interface ScreenedNews {
  kept: SerperNewsItem[];
  dropped: { item: SerperNewsItem; reason: DropReason; detail: string }[];
}

/**
 * Screen a raw Serper result set down to items that are (a) news and (b) about THIS company.
 *
 * ── LIMITS, STATED ────────────────────────────────────────────────────────────────────────────────
 *  · A genuine headline that places an unlisted 2–5 letter acronym directly after the company name
 *    ("Bank of Maharashtra XYZ scheme") is dropped as a suspected sibling. ACRONYM_STOPLIST covers the
 *    common finance/news acronyms; it cannot cover all of them. The item survives if the company is
 *    named cleanly anywhere else in the title or snippet, which is the usual case.
 *  · A subsidiary whose name does NOT extend the parent's ("Vodafone Idea" under "Vodafone") is not
 *    detectable by this rule at all, and neither is a headline that names only the subsidiary's brand.
 *  · An article about the parent that mentions the subsidiary FIRST and the parent only in the body
 *    (which Serper does not return) is dropped. That is the intended direction of the error.
 */
export function screenNewsItems(items: SerperNewsItem[], guard: EntityGuard): ScreenedNews {
  const kept: SerperNewsItem[] = [];
  const dropped: ScreenedNews["dropped"] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const host = hostOf(item.link);
    const key = `${host}|${item.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) { dropped.push({ item, reason: "duplicate", detail: "same headline and host already kept" }); continue; }

    if (JUNK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      dropped.push({ item, reason: "junk-host", detail: host });
      continue;
    }
    const pathBan = JUNK_PATHS.find((p) => p.host.test(host) && p.path.test(pathOf(item.link)));
    if (pathBan) { dropped.push({ item, reason: "junk-host", detail: `${host}${pathOf(item.link)} — ${pathBan.why}` }); continue; }

    const junkTitle = JUNK_TITLES.find((t) => t.re.test(item.title));
    if (junkTitle) { dropped.push({ item, reason: "junk-title", detail: junkTitle.why }); continue; }

    // ★ THE ENTITY GUARD. Title first, then snippet — either one naming the company cleanly is enough.
    const titleKind = mentionKind(item.title, guard);
    const snippetKind = titleKind === "clean" ? "clean" : mentionKind(item.snippet, guard);
    if (titleKind === "clean" || snippetKind === "clean") {
      seen.add(key);
      kept.push(item);
      continue;
    }
    if (titleKind === "sibling" || snippetKind === "sibling") {
      dropped.push({ item, reason: "sibling-entity", detail: `names a different entity built on "${guard.shortName}"` });
    } else {
      dropped.push({ item, reason: "off-topic", detail: `neither title nor snippet names ${guard.shortName}` });
    }
  }

  return { kept, dropped };
}

/** The production query shape — SHARED WITH THE INGEST by intent (google-news.ts builds the same string).
 *  ⚠ The evaluation's MAHABANK failure used a BARE company name; the quoted form plus the market words is
 *  measurably tighter, and the entity guard is calibrated against this shape, not a bare one. */
export const buildNewsQuery = (shortName: string): string => `"${shortName}" stock NSE India`;
