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

/**
 * The Health Hub — the whole scored universe in one place. Route is `/health-score`
 * (app/(main)/health-score/page.tsx), NOT `/health-hub`: the folder predates the product name.
 * That mismatch is exactly why the model must never type this one itself.
 *
 * ★ NO TAB PARAMETER, AND THAT IS A FINDING, NOT AN OMISSION. The Hub's three tabs — Briefing,
 * Flags & Patterns, Screen — are `useState<TabId>` in components/health-hub/index.tsx. They are not
 * routes, not query params, and not anchors: there is NO url that opens the Hub on Flags, and none
 * that opens it on Screen. The scope switch (universe / holdings / watchlist) is the same — local
 * state. So a tab argument could only ever produce a path that lands on Briefing while claiming to
 * land somewhere else, which is the WRONG-PAGE failure this whole part exists to close, rebuilt on
 * purpose. §POINTING AT A PAGE's standing rule already covers it: a section is described in words
 * and the PAGE is linked.
 */
export const healthHubPath = (): string => "/health-score";

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

// ── ★ THE SINGLE-BRACE MARKER — MEASURED LIVE, AND IT REACHED A READER VERBATIM. ──────────────────
//
//     "Tata Consultancy Services ({link:stock:TCS}) distributes a large slice of its earnings…"
//
// ONE brace pair instead of two. Every guard in this module missed it and each for its own reason, so
// it is worth naming all three: PLACEHOLDER wants `{{`, DEBRIS wants `{{`, and `resolveAppLinks`
// early-returns on `!text.includes("{{")` — so a reply whose ONLY marker is single-braced skipped the
// sweep entirely. stripTypedPaths could not have helped either: it matches `[label](dest)`, and this
// had no markdown around it at all. Three guards, one blind spot, shared.
//
// ★ IT IS THE WORST OF THE THREE POSSIBLE OUTCOMES. A dropped link leaves a hole someone reports; a
// wrong link is worse; but syntax in the prose tells the reader, correctly, that something inside is
// leaking out. It is also the ONE outcome this module's header already promised could not happen
// ("a raw placeholder reaching a reader is the one outcome worse than a missing link").
//
// ⚠ STRIPPED, NOT RESOLVED — the deliberate choice. Accepting a second syntax would teach the model
// that sloppy braces work, and the vocabulary drifts from there; it also widens the surface for no
// gain, since 29 of 30 shipped markers are already well-formed. So this degrades to PROSE on exactly
// the terms an unresolvable well-formed marker already degrades: the sanitised SUBJECT, no link, and a
// log line. `Services ({link:stock:TCS})` becomes `Services (TCS)` — the sentence the model was
// reaching for — while the syntax, and the link, do not survive.
//
// ⚠ THE COLON IS REQUIRED, so this can only ever match our own vocabulary being written badly. A bare
// `{link}` or a JSON-ish `{ "link": … }` in ordinary prose is left completely alone.
// ⚠ THE LOOKAROUND IS WHAT KEEPS IT OFF THE WELL-FORMED CASE. In `{{link:stock:TCS}}` the only viable
// start is the inner brace, and `(?<!\{)` refuses it; the outer brace is followed by `{`, not `link`.
const MALFORMED_SINGLE = /(?<!\{)\{\s*link\s*:\s*([^{}\n]{0,80})\}(?!\})/g;

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

// ── ★ THE TYPED-PATH GUARD ─────────────────────────────────────────────────────────────────────────
//
// THE WORST SHAPE THIS MODULE HAS SEEN, AND THE ONE IT COULD NOT SEE. Measured across five live runs
// of the universe-scan build, three to four per run:
//
//     [the Health Hub's Flags & Patterns tab](/portfolio)      ← WORKING LINK, WRONG PAGE
//     [Screen tab of the Health Hub](helithub)                 ← garbage destination
//     [Market pillar](https://vytal.in)                        ← observed in an earlier build
//
// A dropped marker leaves a visible hole and someone reports it. A link that RESOLVES and lands on
// the wrong page reports nothing: the reader clicks, sees a page, and quietly concludes Vytal's chat
// does not know where things are. The vocabulary has forbidden typing a path since the clause was
// written ("★ YOU NEVER WRITE A PATH, A URL OR A '/'"), and the model does it anyway — which is the
// standing lesson of this whole file: the closed-world property has to be STRUCTURAL, not requested.
//
// So: any markdown destination the MODEL authored is removed before resolution, keeping the label as
// plain prose. Two shapes, one rule.
//   · root-relative `](/…)`   — the in-app case. Always wrong: the server builds every real in-app
//                               path, from a validated row, and appends its own footer AFTER this.
//   · absolute `](http…)`     — the external case. getStockNews forbids the model writing URLs
//                               precisely because it invented one; citations are server-rendered.
// A destination that is a placeholder — `[the read]({{link:stock:INFY}})` — is untouched: it is not a
// path yet, and the wrapped-form substitution below is the sanctioned way to author one.
//
// ⚠ IT RUNS ON THE MODEL'S TEXT, BEFORE SUBSTITUTION. Running it after would strip the very paths this
// module just built. And the two server footers (withAppLinks / withExternalSources) are appended by
// the controller AFTER resolveAppLinks returns, so they are never in scope here either.
const TYPED_DESTINATION = /\[([^\]\n]{0,120})\]\(\s*(?:\/[^)\s]*|https?:\/\/[^)\s]*|www\.[^)\s]*)\s*\)/g;

/**
 * Strip malformed single-brace markers, keeping the informative word. Returns the text and what it
 * removed, raw, so the caller can log the exact string the model wrote.
 *
 * The replacement is the same `inert()` the unresolvable-marker branch uses, so a malformed marker can
 * no more begin a path than a well-formed one whose ticker did not exist. A subject-less kind
 * (`{link:health-hub}`) leaves nothing, which is this module's standing policy for an empty marker.
 */
export function stripMalformedMarkers(text: string): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  const out = text.replace(MALFORMED_SINGLE, (whole, payload: string) => {
    stripped.push(whole);
    const [, subject = ""] = (payload ?? "").split(":");
    return inert(subject);
  });
  return { text: out, stripped };
}

/** Strip model-authored link destinations, keeping the words. Returns the text and what it removed. */
export function stripTypedPaths(text: string): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  const out = text.replace(TYPED_DESTINATION, (whole, lbl: string) => {
    stripped.push(whole);
    // The label alone. A label that was empty leaves nothing rather than an empty bracket pair.
    return (lbl ?? "").trim();
  });
  return { text: out, stripped };
}

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
  /** Every link destination the MODEL typed and this module removed. Non-empty means the vocabulary
   *  is being ignored, which is worth a log line even though the reader is now protected from it. */
  strippedPaths: string[];
  /** Every MALFORMED marker removed — single-braced, so it never became a link. Its own field rather
   *  than a second home in `unresolved`, for the same reason `strippedPaths` has one: "the ticker did
   *  not exist" and "the syntax was wrong" are different failures that want different fixes, and a log
   *  that merges them tells you a number instead of a cause. */
  malformed: string[];
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
    // The fifth kind. Parameterless like `watchlist`: nothing to validate, nothing to look up, and
    // no tab (see healthHubPath). A tab or scope the model passes is IGNORED rather than honoured —
    // silently landing on the Briefing is the correct behaviour when the alternative is a link that
    // promises Flags and does not deliver it.
    case "health-hub":
      return { kind, path: healthHubPath(), label: "the Health Hub" };
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
  // ★ THE TYPED-PATH GUARD RUNS FIRST AND ALWAYS — before the "{{" early return, because a reply that
  //   contains a hand-typed `](/portfolio)` and no placeholder at all is exactly the observed defect.
  const guard = stripTypedPaths(text ?? "");
  const strippedPaths = guard.stripped;
  text = guard.text;

  // ★ AND THE MALFORMED SWEEP RUNS BEFORE THE "{{" EARLY RETURN, for the same reason the typed-path
  //   guard does: the observed defect was a reply whose ONLY marker was single-braced, so it contains
  //   no "{{" at all and the early return was exactly what let it through. Running it here rather than
  //   after substitution is safe because MALFORMED_SINGLE cannot match a well-formed `{{link:…}}`.
  const mal = stripMalformedMarkers(text);
  const malformed = mal.stripped;
  text = mal.text;

  if (!text || !text.includes("{{")) return { text, resolved: [], unresolved: [], strippedPaths, malformed };

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
  if (!hits.length) return { text: text.replace(DEBRIS, ""), resolved, unresolved, strippedPaths, malformed };

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

  return { text: out.replace(DEBRIS, ""), resolved, unresolved, strippedPaths, malformed };
}
