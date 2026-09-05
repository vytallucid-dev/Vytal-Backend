// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RETIRED SYMBOLS — the identities a reader still uses that NSE no longer serves.
//
// ── ★ THE DEFECT THIS EXISTS FOR, MEASURED (T-2, 2026-08-31) ──────────────────────────────────────
// `stocks` holds LTIMindtree as symbol `LTM`, name "LTM Ltd." — seeded straight from NSE's own
// EQUITY_L.csv (stage15-seed-nse-equity.ts reads SYMBOL and NAME OF COMPANY unaltered), so our row
// carries the CURRENT identity and is correct. The world's memory does not: the bank, older docs and
// readers all still say `LTIM`.
//
// ⚠ AND THE FAILURE IS NOT AN EMPTY RESULT, WHICH IS WHAT MADE IT WORTH FIXING PROPERLY. Measured
//   before this file existed:
//       resolveSymbol("LTIM")        → verdict "weak", top candidate **LT — Larsen & Toubro**, 0.26
//       resolveSymbol("Mindtree")    → verdict "weak", top candidate **MINDTECK**, 0.30
//   Larsen & Toubro is LTIMindtree's former PARENT. A reader asking about LTIM was being offered a
//   different, plausible, related company — §6.2's confident-wrong-artifact family, one layer below
//   the router. An empty answer would have been safer than what was actually happening.
//
// ⚠ FUZZY MATCHING CANNOT FIX THIS, AND THE NUMBERS SAY SO RATHER THAN AN OPINION.
//       similarity('ltim','ltm') = 0.286     the right answer
//       similarity('ltim','lt')  = 0.333     the wrong answer, and it scores HIGHER
//   The retired symbol is trigram-closer to the wrong company than to the right one. Any threshold
//   that admits LTM admits LT first. The mapping has to be stated, not inferred.
//
// ── ★ WHY A CURATED REGISTRY AND NOT A TABLE ─────────────────────────────────────────────────────
// A table implies a feed. There is none: `corporate_events` carries nine event types (dividend, agm,
// earnings, split, record_date, bonus, buyback, rights, board_meeting) and NOT ONE is a name or
// symbol change, so nothing we ingest would ever populate it. A `stock_aliases` table would be this
// same hand-written list behind a migration, plus the false promise that something maintains it.
//
// This is the `retention/policy.ts` EXEMPTIONS idiom: a small curated registry, each entry carrying
// the evidence for its own existence, reviewed in code review because that is the only review it will
// ever get.
//
// ── ★ KEYED ON ISIN, NEVER ON stock_id ───────────────────────────────────────────────────────────
// The `Stock.isin` schema comment states the rule this file relies on: "Symbols drift (LTIM→LTM);
// ISIN does not." Verified live at T-2: 2,291 stocks, 2,291 distinct ISINs, zero blank, and
// `daily_prices.isin` disagrees with `stocks.isin` on zero rows. `stocks.id` is a uuid that a reseed
// can change; the ISIN is the security.
//
// ── ⚠ WHAT THIS LIST IS NOT ──────────────────────────────────────────────────────────────────────
// It is not a census of drift, and one cannot be taken from our data. The universe was seeded fresh
// on 2026-07-04 with NSE's then-current identities, so no superseded symbol survives anywhere —
// the T-2 census over every denormalised `symbol` column (score_snapshots, stock_findings,
// shareholding_patterns, bank_supplementary, score_pillars, score_patterns) found ZERO disagreements
// with `stocks.symbol`. That is not evidence that nothing has drifted; it is evidence that we never
// recorded the drift. Entries are added when a miss is observed, and the miss-log (§6.4,
// `composition_misses`) is now the place those observations land.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface SymbolAlias {
  /**
   * A RETIRED IDENTITY, as a reader still types it — a former NSE symbol, or a former company name
   * short enough to be typed as one. Compared case-insensitively after trimming.
   *
   * ⚠ NOT a general name dictionary. Only identities NSE itself has retired belong here; near-misses
   *   of a CURRENT name are the fuzzy path's job, and duplicating that here would put two rankers in
   *   competition with no rule for which wins.
   */
  readonly former: string;
  /** The security it names. The stable spine — see the header. */
  readonly isin: string;
  /** Why this entry is here and how it was established. Every entry carries one. */
  readonly why: string;
}

export const SYMBOL_ALIASES: readonly SymbolAlias[] = [
  {
    former: "LTIM",
    isin: "INE214T01019",
    why:
      "LTIMindtree. NSE now serves this security as symbol LTM, name 'LTM Ltd.' — seeded verbatim " +
      "from NSE EQUITY_L.csv on 2026-07-04. Identity confirmed independently of the name: peer group " +
      "'Large-Cap IT Services' beside TCS/INFY/HCLTECH/WIPRO/TECHM, market cap ₹134,666 Cr, FY27Q1 " +
      "consolidated revenue ₹11,608 Cr. Before this entry, resolveSymbol('LTIM') returned LT " +
      "(Larsen & Toubro, its former parent) at 0.26 as a 'weak' match.",
  },
  {
    former: "MINDTREE",
    isin: "INE214T01019",
    why:
      "Mindtree Ltd merged into Larsen & Toubro Infotech in 2022 to form LTIMindtree, which NSE now " +
      "serves as LTM. Same security as the LTIM entry above. Before this entry, " +
      "resolveSymbol('Mindtree') returned MINDTECK — an unrelated listed company — at 0.30. " +
      "⚠ Pre-FY22 history under this ISIN is PRO-FORMA (back-stamped LTI+Mindtree figures, see " +
      "docs/Vytal_Guardrail_Layer_Phase1_Design.md:195). A composition reading a long series here is " +
      "reading constructed data; that is a scoring-seat concern, recorded in the coverage plan.",
  },
  {
    former: "LTIMINDTREE",
    isin: "INE214T01019",
    why:
      "The company name NSE served before the rename to 'LTM Ltd.'. A reader typing it in full got " +
      "`not_in_universe` — honest, but wrong: we hold the security under LTM. Same ISIN as above.",
  },
  {
    former: "LTI",
    isin: "INE214T01019",
    why:
      "Larsen & Toubro Infotech, the pre-merger name of the same security (ISIN unchanged through " +
      "the merger and the rename). Same pro-forma caveat as MINDTREE above.",
  },
];

/**
 * ★ SELF-CHECK AT MODULE LOAD — cheap, no database, and it runs everywhere the resolver does.
 *
 * A registry whose entries can silently conflict is worse than no registry: the failure would be a
 * wrong company returned with score 0.995 and `matchedOn: "alias"`, which reads as authoritative.
 * Shape is checkable here; existence of the ISIN is not (that needs a query), and the resolver
 * handles a dangling ISIN by simply not matching — an honest miss rather than a wrong hit.
 */
const seen = new Set<string>();
for (const a of SYMBOL_ALIASES) {
  const key = a.former.trim().toUpperCase();
  if (key !== a.former) throw new Error(`symbol alias must be upper-case and trimmed: ${JSON.stringify(a.former)}`);
  if (key.length === 0) throw new Error("symbol alias 'former' is empty");
  if (seen.has(key)) throw new Error(`duplicate symbol alias: ${key} — one retired symbol, one security`);
  if (!/^IN[EF][0-9A-Z]{9}$/.test(a.isin)) throw new Error(`symbol alias ${key} has a malformed ISIN: ${a.isin}`);
  if (!a.why.trim()) throw new Error(`symbol alias ${key} carries no citation`);
  seen.add(key);
}

const BY_FORMER = new Map(SYMBOL_ALIASES.map((a) => [a.former.toUpperCase(), a]));

/** The ISIN a retired symbol names, or null. Case- and whitespace-insensitive. */
export function aliasIsinFor(query: string): string | null {
  return BY_FORMER.get((query ?? "").trim().toUpperCase())?.isin ?? null;
}

/** The full entry, for a caller that wants to explain the match rather than assert it. */
export function aliasFor(query: string): SymbolAlias | null {
  return BY_FORMER.get((query ?? "").trim().toUpperCase()) ?? null;
}
