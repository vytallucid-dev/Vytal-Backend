// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// IN-APP LINKS — the ONE home for building a Vytal path, and the resolver that turns the model's
// `{{link:kind:param}}` placeholders into real, validated anchors.
//
// ★ THE RULE THIS EXISTS TO KEEP: THE MODEL NEVER COMPOSES A PATH.
// Inherited from getStockNews (where the live model invented `https://www.google.com/goto?url=CAESsw…`,
// a redirect that appeared in no tool result) and from openComparison (where it writes company names
// where tickers belong, and `/comparison/TCS-vs-INFOSYS` is a WELL-FORMED slug that sails past the
// route's malformed-slug branch and dies at the API — a dead end AFTER a click).
//
// The placeholder keeps that property while costing no round trip. The model writes a KIND and a
// SUBJECT — never a path, never a slash, never a query string. This module resolves the subject against
// the universe and builds the path from the row it got back, exactly as openComparison does with
// `view.a.symbol`. An unresolvable subject yields NO LINK, never a broken one: the failure mode is
// prose, which is the direction we want to fail in.
//
// ── WHY PLACEHOLDERS AND NOT A TOOL ──────────────────────────────────────────────────────────────
// A `getPageLink` tool would also be safe, and it was the first recommendation. It costs a tool round —
// a whole extra generation — on every turn that offers a link, and ~930 tokens of spec on every turn
// that does not. The placeholder costs ~250 tokens of vocabulary and zero round trips, and it keeps the
// same closed-world property because the VALUE still gets validated server-side before it becomes a
// path. See context-layer.ts §WHERE THINGS LIVE for the clause the model actually reads.
//
// ── ⚠ THE ENCODING, AND THE MEASUREMENT BEHIND IT ────────────────────────────────────────────────
// Five live NSE symbols contain "&": ARE&M, GVT&D, J&KBANK, M&M, M&MFIN. Two contain a hyphen inside a
// hyphen-delimited comparison slug: BAJAJ-AUTO, NAM-INDIA. `openComparison` built these UNENCODED.
//
// MEASURED, not assumed: every one of those symbols — and every comparison pair involving one, in both
// orders — survives the shipped remark pipeline unencoded. "&M" and "&KBANK" are not character
// references, so nothing is decoded, and the current links do work. The bug is LATENT, not live.
//
// It is still a bug, for a reason the same probe proved: remark DOES decode character references in a
// link destination — `/research/stock-screener/M&reg;X` parses out as `/research/stock-screener/M®X`.
// The universe is not fixed. A future listing whose "&" run happens to spell a valid entity would
// silently produce a link to a company that does not exist, and it would be found by a reader, not by
// us. Percent-encoding the SEGMENT closes that whole class for good, and it is what the frontend
// already does in six shipped places (portfolio/lib.ts, calendar/event-row.tsx, calendar/spotlight.tsx,
// navbar.tsx, stock-autocomplete.tsx, watchlist/quick-look-sheet.tsx all build
// `/research/stock-screener/${encodeURIComponent(symbol)}`), so `M%26M` is an exercised path shape and
// not a new one.
//
// ⚠ ONE KNOWN, DELIBERATE DIVERGENCE: the comparison PICKER
// (app/(main)/comparison/page.tsx) still builds `/comparison/${a.symbol}-vs-${b.symbol}` unencoded.
// Both forms resolve to the same route (Next decodes dynamic segments), so this is a cosmetic
// difference in the emitted string, not two behaviours — but it does mean openComparison's original
// "the SAME string the app's own picker builds" claim is no longer literally true. Left alone on
// purpose: this pass was scoped to the backend, and changing the picker is a frontend edit nobody
// asked for. Worth doing later so there is genuinely one shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { getPeerGroupForStock } from "../scoring/read/peer-group-lookup.js";

// ── THE PATH BUILDERS. Every in-app path in the chat layer is built HERE, from validated values. ────

/** One path SEGMENT, escaped. `encodeURIComponent` leaves A–Z, 0–9, `-`, `.`, `_`, `~` alone — so
 *  BAJAJ-AUTO and NAM-INDIA are untouched and keep round-tripping through the frontend's `split("-vs-")`
 *  — and turns the five "&" symbols into `M%26M`-style segments that no markdown parser can reinterpret. */
export const encodeSegment = (s: string): string => encodeURIComponent(s);

/** The stock page's seven tabs, exactly as [symbol]/page.tsx declares them.
 *  ⚠ The Disclosures tab's id is `news`, NOT `disclosures` — a model guessing the visible label would
 *  land on Overview, so the vocabulary teaches the label and this map owns the id. */
export const STOCK_TABS = {
  overview: "Overview",
  health: "Health Score",
  fundamentals: "Fundamentals",
  technical: "Technical",
  activity: "Activity",
  events: "Events",
  news: "Disclosures",
} as const;
export type StockTab = keyof typeof STOCK_TABS;

/** The portfolio hub's six tabs (components/portfolio/tabs.ts PORTFOLIO_TABS). */
export const PORTFOLIO_TABS = {
  overview: "Overview",
  holdings: "Holdings",
  performance: "Performance",
  health: "Health",
  transactions: "Transactions",
  accounts: "Accounts",
} as const;
export type PortfolioTab = keyof typeof PORTFOLIO_TABS;

export const stockPath = (symbol: string, tab?: StockTab | null): string =>
  `/research/stock-screener/${encodeSegment(symbol)}${tab ? `?tab=${tab}` : ""}`;

/** The comparison path. Symbols come from universe ROWS, never from the model's arguments — the
 *  caller's job — and each is escaped independently before the literal `-vs-` joins them, which is the
 *  separator the frontend's parseSlug splits on. */
export const comparisonPath = (symbolA: string, symbolB: string): string =>
  `/comparison/${encodeSegment(symbolA.toUpperCase())}-vs-${encodeSegment(symbolB.toUpperCase())}`;

export const portfolioPath = (tab?: PortfolioTab | null): string => `/portfolio${tab ? `?tab=${tab}` : ""}`;

export const watchlistPath = (): string => "/watchlist";

/** ★ The pond page takes a UUID — which is precisely why the model must not be asked for one. It names
 *  a TICKER; the server walks stock → membership → peerGroup.id and builds the path from that. */
export const peerGroupPath = (peerGroupId: string): string => `/research/peer-groups/${encodeSegment(peerGroupId)}`;

// ── THE PLACEHOLDER RESOLVER ────────────────────────────────────────────────────────────────────────

/**
 * `{{link:kind}}`, `{{link:kind:subject}}`, `{{link:kind:subject:tab}}`.
 *
 * Deliberately greedy-free and bounded: `[^}\n]{0,80}` cannot run across a line or swallow the rest of a
 * reply if the model forgets a brace. A malformed placeholder is simply not matched, and the sweep at
 * the end of `resolveAppLinks` strips any `{{link…` debris that survived — a raw placeholder reaching a
 * reader is the one outcome worse than a missing link.
 */
const PLACEHOLDER = /\{\{link:([^}\n]{0,80})\}\}/g;
/** Anything left that LOOKS like our placeholder but did not parse — unclosed, over-long, or spaced
 *  (`{{ link : stock : X }}`). Bounded by `{`, `}` and newline, so it cannot run away down the reply and
 *  has no nested quantifier to backtrack on. Consumes the closing braces when they are there. */
const DEBRIS = /\{\{\s*link\b[^{}\n]*\}{0,2}/g;

/** Link TEXT is not a safe place for brackets — they end the label early and break the anchor. */
const label = (s: string): string => s.replace(/[[\]]/g, "").trim();

/**
 * The inert fallback for a subject that did not resolve.
 *
 * ★ WHY IT IS SANITISED AND NOT ECHOED. When the placeholder sat in a destination slot —
 * `[the health read]({{link:stock:NOTREAL}})` — a raw echo would emit `[the health read](NOTREAL)`,
 * which safeHref rejects (no leading "/"), so it renders as plain text. Fine. But a model that wrote
 * `{{link:stock:/admin/retention}}` would then emit `[…](/admin/retention)` — a LIVE in-app link to a
 * page it invented, built from a string it chose. Stripping the path characters is what makes that
 * impossible: whatever comes back can never begin a path.
 */
const inert = (s: string): string => s.replace(/[/()[\]<>|\\]/g, "").trim();

export interface ResolvedLink {
  kind: string;
  path: string;
  label: string;
}

export interface ResolveResult {
  text: string;
  /** Every placeholder that became a real anchor — for logging and for the verification script. */
  resolved: ResolvedLink[];
  /** Every placeholder that did not, with the raw payload — the signal that the vocabulary needs work. */
  unresolved: string[];
}

/** Per-call memo: one reply mentioning a stock three times costs one read, not three. */
type Memo = Map<string, Promise<unknown>>;
const memo = <T>(m: Memo, key: string, fn: () => Promise<T>): Promise<T> => {
  const hit = m.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn();
  m.set(key, p);
  return p as Promise<T>;
};

/** The universe boundary, by canonical symbol. Returns the ROW — the path is built from `row.symbol`,
 *  never from the model's spelling, so casing and stray whitespace cannot reach the path. */
async function resolveStock(m: Memo, raw: string): Promise<{ symbol: string; name: string } | null> {
  const symbol = raw.trim().toUpperCase();
  if (!symbol || symbol.length > 32) return null;
  return memo(m, `stock:${symbol}`, () =>
    prisma.stock.findUnique({ where: { symbol }, select: { symbol: true, name: true } }),
  );
}

async function resolveOne(m: Memo, kind: string, subject: string, modifier: string): Promise<ResolvedLink | null> {
  switch (kind) {
    case "stock": {
      const row = await resolveStock(m, subject);
      if (!row) return null;
      const tab = (modifier.trim().toLowerCase() || null) as StockTab | null;
      const validTab = tab && tab in STOCK_TABS ? tab : null;
      return {
        kind,
        path: stockPath(row.symbol, validTab),
        // "the Health Score tab for M&M" / "M&M" — reads as prose wherever the model dropped it.
        label: validTab ? `the ${STOCK_TABS[validTab]} tab for ${row.symbol}` : row.symbol,
      };
    }
    case "portfolio": {
      const tab = (subject.trim().toLowerCase() || null) as PortfolioTab | null;
      const validTab = tab && tab in PORTFOLIO_TABS ? tab : null;
      return {
        kind,
        path: portfolioPath(validTab),
        label: validTab ? `the ${PORTFOLIO_TABS[validTab]} tab of your portfolio` : "your portfolio",
      };
    }
    case "watchlist":
      return { kind, path: watchlistPath(), label: "your watchlist" };
    case "peer-group": {
      const row = await resolveStock(m, subject);
      if (!row) return null;
      // stock → membership → pond. Two reads, memoised, and BOTH can honestly come back empty: a
      // display-only stock has no peer group at all, and that is a real state, not an error.
      const stock = await memo(m, `stockid:${row.symbol}`, () =>
        prisma.stock.findUnique({ where: { symbol: row.symbol }, select: { id: true } }),
      );
      if (!stock) return null;
      const pg = await memo(m, `pg:${stock.id}`, () => getPeerGroupForStock(stock.id));
      if (!pg) return null;
      return { kind, path: peerGroupPath(pg.id), label: `the ${pg.displayName} peer group` };
    }
    default:
      return null;
  }
}

/**
 * Replace every `{{link:…}}` in a delivered reply with a validated anchor.
 *
 * TWO SHAPES, BOTH FREE. The substitution is textual, so it handles both without a special case:
 *   · BARE  — `see {{link:stock:M&M:health}}`      → `see [the Health Score tab for M&M](/research/…)`
 *   · WRAPPED — `[the full read]({{link:stock:M&M:health}})` → `[the full read](/research/…)`
 * The wrapped form is detected by the two characters before the match, and only the destination is
 * swapped so the model keeps authoring its own prose. Link TEXT is not a path — there is no reason to
 * take it away.
 *
 * ⚠ RUN THIS UNCONDITIONALLY, including on a guardrail-blocked reply. Not because guardrail text
 * contains placeholders — it is server-authored and does not — but because the sweep is the only thing
 * standing between a malformed placeholder and a reader seeing `{{link:stock:INFY}}` in their chat.
 */
export async function resolveAppLinks(text: string): Promise<ResolveResult> {
  // ⚠ THE GUARD TESTS FOR "{{", NOT FOR "{{link". It used to test the literal marker, which meant a
  //   spaced `{{ link : stock : X }}` — well-formed enough for a model to write and NOT matched by
  //   PLACEHOLDER — took the early return and skipped the debris sweep, putting raw braces in front of
  //   a reader. Caught by verify-app-links.ts §8. The cheap test is the safe one.
  if (!text || !text.includes("{{")) return { text, resolved: [], unresolved: [] };

  const m: Memo = new Map();
  const resolved: ResolvedLink[] = [];
  const unresolved: string[] = [];

  // Collect first (the regex walk is sync), resolve concurrently, then splice — a single pass over the
  // text with an async replacer is not available to us, and two passes keeps the offsets honest.
  const hits: { start: number; end: number; kind: string; subject: string; modifier: string; raw: string }[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const raw = match[1] ?? "";
    const [kind = "", subject = "", modifier = ""] = raw.split(":");
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      kind: kind.trim().toLowerCase(),
      subject,
      modifier,
      raw,
    });
  }
  if (!hits.length) return { text: text.replace(DEBRIS, ""), resolved, unresolved };

  const outcomes = await Promise.all(hits.map((h) => resolveOne(m, h.kind, h.subject, h.modifier).catch(() => null)));

  let out = "";
  let cursor = 0;
  hits.forEach((h, i) => {
    const link = outcomes[i];
    out += text.slice(cursor, h.start);
    // Was the placeholder sitting in a markdown destination slot — `](…)`?
    const wrapped = text.slice(Math.max(0, h.start - 2), h.start) === "](";
    if (link) {
      resolved.push(link);
      out += wrapped ? link.path : `[${label(link.label)}](${link.path})`;
    } else {
      unresolved.push(h.raw);
      // No link, ever. Wrapped → an inert destination safeHref will refuse, so the label survives as
      // plain text. Bare → the sanitised subject, so the sentence still reads.
      // Bare → the sanitised subject alone. NOT the kind as a fallback: a reader seeing the bare word
      // "stock" mid-sentence is noise, and an empty marker is better left as nothing at all.
      out += wrapped ? inert(h.subject) || "unavailable" : inert(h.subject);
    }
    cursor = h.end;
  });
  out += text.slice(cursor);

  return { text: out.replace(DEBRIS, ""), resolved, unresolved };
}
