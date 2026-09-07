// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: THE PARSED SCREEN — one execution path for every screen, however it was read.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE FALLBACK IS A TREE TOO, AND THAT IS WHY THERE IS ONLY ONE OF EVERYTHING BELOW.
//
// When the model's reading is refused, the AND-only extractor's conditions are assembled into an `and`
// tree and handed to the SAME evaluator, the SAME restatement and the SAME card. The alternative —
// two answer shapes, one for each reading — would mean the fallback path is the one nobody looks at,
// and it is the path that runs when something has already gone wrong.
//
// So the difference between a parsed screen and a fallen-back one is exactly one sentence in the
// restatement, which is what `fellBackBecause` carries.
//
// ── ★ WHAT THE CARD HAS TO SAY THAT IT DID NOT BEFORE ────────────────────────────────────────────
// "Companies meeting every condition" is FALSE the moment `or` exists. A row can now be present for
// any of several reasons, and a reader cannot reconstruct which — so every row carries the conditions
// it actually matched, as a column, whenever the tree is not a plain `and`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { setTableSection, type SetTableCell, type SetTableColumn, type SetTableRow, SET_TABLE_TRANSPORT } from "../../section/kinds/set-table.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { evaluateScreen, type Basis, type LeafResult } from "../../resolve/screen-evaluate.js";
import { restate, dropped } from "../screen-restate.js";
import { PRICE_METRICS, usesScope, type OrderClause, type PriceMetric, type ScreenNode } from "../screen-grammar.js";
import type { ScreenVocabulary } from "../screen-parse.js";
import type { AnySection, AnswerProse } from "../contract.js";
import type { Coverage, QueryCoverage } from "../../resolve/contract.js";

export interface ScreenTurnResult {
  readonly kind: "composed";
  readonly compositionId: string;
  readonly sections: readonly AnySection[];
  readonly prose: AnswerProse;
  readonly missLogged: boolean;
}

const n = (x: number): string => x.toLocaleString("en-IN");

// ── the vocabulary, loaded once ───────────────────────────────────────────────────────────────────
/**
 * ★ CACHED FOR THE PROCESS. Sectors and peer groups change when the universe is rebuilt, not per
 *   request, and the parser needs them on every screen turn — reading them each time would put two
 *   queries in front of a model call that is already the turn's cost.
 */
let vocabCache: { v: ScreenVocabulary; at: number } | null = null;
const VOCAB_TTL_MS = 10 * 60 * 1000;

export async function screenVocabulary(): Promise<ScreenVocabulary> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) return vocabCache.v;
  const [sectors, peerGroups] = await Promise.all([
    prisma.$queryRawUnsafe<{ display_name: string }[]>(`SELECT display_name FROM sectors ORDER BY display_name`),
    prisma.$queryRawUnsafe<{ display_name: string }[]>(`SELECT display_name FROM peer_groups ORDER BY display_name`),
  ]);
  const v: ScreenVocabulary = {
    sectors: sectors.map((s) => s.display_name),
    peerGroups: peerGroups.map((p) => p.display_name),
  };
  vocabCache = { v, at: Date.now() };
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANSWER
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export async function composeParsedScreenAnswer(
  tree: ScreenNode,
  shape: "list" | "count",
  /** ★ THE READER'S RANKING. `null` where they named none — never a default we chose (SC-12). */
  order: OrderClause | null,
  /** ★ "top 10" → 10. Refused at validation without an ordering, so it arrives only with one. */
  limit: number | null,
  basisRequested: Basis | null,
  /** Why the model's reading was refused, when it was. `null` on a clean parse. */
  fellBackBecause: string | null,
  fellBackKind: "unavailable" | "refused" | null,
  /** Conditions we recognised and could not run — stated, never silent. */
  droppedConditions: readonly string[] = [],
  /** ★ Whether the AND-only fallback could have produced a different set — see the call site. */
  fallbackCouldDiffer: boolean = false,
): Promise<ScreenTurnResult | null> {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ AN ORDERING NEEDS ITS FIELD READ, EVEN WHEN NOTHING FILTERED ON IT.
  //
  // ⚠ "Top 10 by revenue among banks" ranks on a field NO CONDITION MENTIONS. Ranking on whatever the
  //   first condition happened to be would answer a different question — the reader asked for the ten
  //   largest and would get ten arbitrary banks in NPA order, with the sentence claiming revenue.
  //
  // ★ SO THE ORDER FIELD IS EVALUATED AS A LEAF THAT MATCHES EVERYTHING. It contributes no filtering
  //   (its `matched` is ignored) and contributes its VALUES, which is exactly what a ranking is.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ THE PROBE MUST BE THE SAME LEAF KIND THE FIELD IS. "Top 10 by market cap" resolves its ordering
  //   through `FIELD_ALIASES` like any other field, but market cap is COMPUTED — a `cmp` probe on it
  //   would look for a filed column that does not exist and rank on nothing.
  const orderProbe: ScreenNode | null = !order ? null
    : order.field in PRICE_METRICS
      ? { op: "price", metric: order.field as PriceMetric, comparator: "gte", value: Number.NEGATIVE_INFINITY, magnitude: "none" }
      : { op: "cmp", field: order.field, comparator: "gte", value: Number.NEGATIVE_INFINITY, magnitude: "none" };
  // ⚠ A `cmp` PROBE ON A SCORED OR FILED FIELD IS SAFE because `readField` serves all three kinds —
  //   the probe matches everything and contributes only its values, which is what a ranking is.
  const ev = await evaluateScreen(
    orderProbe ? { op: "and", nodes: [tree, orderProbe] } : tree,
    basisRequested,
  );
  const scoped = usesScope(tree);

  // ⚠ THE PROBE IS NOT A CONDITION AND MUST NOT BE NARRATED AS ONE. It is dropped from the leaves the
  //   restatement and the "Matched on" column read, or the sentence would claim a bound nobody typed.
  const orderLeaf = order ? ev.leaves[ev.leaves.length - 1] ?? null : null;
  const filterLeaves = order ? ev.leaves.slice(0, -1) : ev.leaves;

  const symbols = [...ev.matched];

  // ── the basis split, over the SHOWN set ────────────────────────────────────────────────────────
  // ⚠ OVER THE MATCHED SET, NOT THE LEAF'S OWN. The last batch shipped this bug at the block layer —
  //   18 companies announcing "748 consolidated and 90 standalone" — because the split was taken
  //   before the intersection narrowed. It is computed here, from the rows that will be drawn.
  const filedLeaves = filterLeaves.filter((l) => l.universe === "filed");
  let standalone = 0, consolidated = 0;
  for (const s of symbols) {
    for (const l of filedLeaves) {
      const v = l.values?.get(s);
      if (!v) continue;
      if (v.basis === "standalone") standalone++; else consolidated++;
      break;
    }
  }

  // ── columns: one per condition that produced a figure, plus what each row matched ──────────────
  // ★ THE ORDER FIELD GETS A COLUMN TOO, first, because it is what the rows are sorted by and a
  //   ranking whose basis is not on the table is a ranking a reader cannot check.
  const valueLeaves = [
    ...(orderLeaf && orderLeaf.values && orderLeaf.values.size > 0 ? [orderLeaf] : []),
    ...filterLeaves.filter((l) => l.values && l.values.size > 0),
  ].slice(0, 3);
  // ⚠ "CAN THIS SCREEN CARRY FIGURES", NOT "DID IT". `values` is only populated for MATCHED rows, so
  //   keying the column on `valueLeaves.length` dropped every column from an EMPTY result — the
  //   honest-empty card lost the one thing it still had to say. A leaf that reads a figure defines
  //   `values` even when nothing matched; a band, sector or findings leaf never defines it at all.
  const carriesFigures = [orderLeaf, ...filterLeaves].some((l) => l?.values !== undefined);
  const mixedBasis = standalone > 0 && consolidated > 0;
  const columns: SetTableColumn[] = [
    // ⚠ THE LABEL IS A SENTENCE FRAGMENT ("with revenue above 100 Cr") because the restatement needs
    //   it to be. A COLUMN heading is a noun, so the connective and the bound come off — the first
    //   draft printed a column headed "with revenue".
    ...valueLeaves.map((l, i) => ({
      key: `v${i}`,
      label: l.columnLabel ?? l.label
        .replace(/^(with|in|showing|labelled) /, "")
        .replace(/ (at least|above|at most|below|exactly) .*$/, ""),
      align: "number" as const, primary: i === 0,
    })),
    // ★★ WHICH CONDITIONS THIS ROW ACTUALLY MATCHED. Drawn only where the tree is not a plain `and`,
    //    because under a plain `and` every row matched every condition and the column would repeat
    //    itself down the page.
    ...(scoped ? [{ key: "why", label: "Matched on", align: "text" as const }] : []),
    ...(mixedBasis ? [{ key: "basis", label: "Basis", align: "text" as const }] : []),
    // ⚠ "As of" IS DRAWN ONLY WHERE A FIGURE CARRIES A DATE. The period is read off a value leaf, so a
    //   findings-only screen ("companies with a pledging red flag") had a column of em-dashes down the
    //   whole page — an empty column reads as missing data rather than as a question with no figures
    //   in it.
    ...(carriesFigures ? [{ key: "period", label: "As of", align: "text" as const }] : []),
  ];

  const rows: SetTableRow[] = symbols
    .map((sym) => {
      const cells: Record<string, SetTableCell> = {};
      valueLeaves.forEach((l, i) => {
        const v = l.values?.get(sym);
        cells[`v${i}`] = { display: v?.display ?? "not held", sort: v?.sort ?? null };
      });
      if (scoped) {
        const hit = filterLeaves.filter((l) => l.matched.has(sym)).map((l) => l.label);
        cells.why = { display: hit.join(" · ") || "—", sort: hit.length };
      }
      const anyValue = valueLeaves.map((l) => l.values?.get(sym)).find(Boolean);
      if (mixedBasis) cells.basis = { display: anyValue?.basis ?? "—", sort: null };
      if (carriesFigures) {
        cells.period = { display: anyValue?.period ?? "—", sort: anyValue?.periodSort ?? null };
      }
      return {
        key: sym, title: ev.names.get(sym) ?? sym, symbol: sym, tag: null, cells,
        _sort: (orderLeaf ?? valueLeaves[0])?.values?.get(sym)?.sort ?? 0,
      };
    })
    // ★ THE READER'S DIRECTION WHERE THEY GAVE ONE. Without an ordering the rows fall in the first
    //   condition's own order, descending — which the restatement then does NOT claim as a ranking.
    // ★ THE READER'S DIRECTION WINS. Absent one, the sort key's OWN leaf decides which end is
    //   interesting — see `preferLowest`. Neither is announced as a ranking.
    .sort((a, b) => {
      const x = (a as { _sort: number })._sort, y = (b as { _sort: number })._sort;
      const asc = order ? order.direction === "asc" : ((orderLeaf ?? valueLeaves[0])?.preferLowest ?? false);
      return asc ? x - y : y - x;
    })
    // ⚠ THE LIMIT IS APPLIED BEFORE THE TRANSPORT CAP, never after. "Top 10" must be ten of the whole
    //   ranked set, not ten of the sixty that happened to travel.
    .slice(0, Math.min(limit ?? SET_TABLE_TRANSPORT, SET_TABLE_TRANSPORT))
    .map(({ _sort, ...r }) => r as SetTableRow);

  // ── coverage: the population searched, and what it could not judge ─────────────────────────────
  const unchecked = filterLeaves
    .filter((l) => l.universe === "findings")
    .reduce((a, l) => a + (l.notEvaluable ?? 0) + (l.neverEvaluated ?? 0), 0);
  const q: QueryCoverage = {
    universeSearched: ev.narrowest.size,
    // ⚠ NO DEPTH FLOOR. Every condition reads ONE period, so an 8-quarter company answers it as well
    //   as a 34-quarter one and a floor would exclude companies that can. It becomes mandatory the day
    //   a condition spans periods — batch 2's trends — and is stated rather than half-built.
    depthFloor: null,
    excludedForDepth: 0,
    dropped: unchecked > 0
      ? [{ filter: "could not be checked", dropped: unchecked, why: "companies a check could not be run on" }]
      : [],
  };
  const coverage: Coverage = { subject: null, query: q };

  // ── the restatement — the guard, built from the tree that ran ──────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ AN EMPTY SET FROM A BOUND, AND AN EMPTY SET FROM A COLUMN WE DO NOT HOLD, LOOK THE SAME.
  //
  // ⚠ MEASURED: "NBFCs with provision coverage ratio above 70%" returned nothing, over a searched
  //   population of 39 — which were the 39 BANKS that carry PCR, intersected with a sector filter no
  //   bank matches. Every number in that answer was correct and the only conclusion available to the
  //   reader was false.
  //
  // ★ THE TEST IS DISJOINTNESS, NOT NARROWNESS. This fires only when the field's population does not
  //   overlap what every other condition matched — so "banks with PCR above 99%" still reports an
  //   honest empty, because there the bank is in the field's population and simply missed the bound.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const INDUSTRY_WORDS: Record<string, string> = {
    non_financial: "non-financial companies", banking: "banks", nbfc: "NBFCs",
    life_insurance: "life insurers", general_insurance: "general insurers",
  };
  const structuralGap: string | null = ev.matched.size > 0 ? null : (() => {
    for (const l of filterLeaves) {
      const others = filterLeaves.filter((o) => o !== l);
      if (others.length === 0) continue;
      // ═════════════════════════════════════════════════════════════════════════════════════════
      // ⚠ THE OTHER CONDITIONS MUST HAVE SELECTED SOMETHING FIRST, and leaving this out inverted the
      //   whole test. "Banks with gross NPA below 0.1%" is an HONEST empty — banks exist, we hold
      //   their NPA, and none is that clean. But with the NPA leaf matching nothing, every other leaf
      //   trivially "fails to overlap" it, so the SECTOR leaf was reported as the gap and the card
      //   said «We do not hold banks for any of the companies this filter picked out.»
      //
      // ★ SO: only ask whether THIS leaf can read what the others PICKED. If the others picked
      //   nothing, they are the reason the answer is empty, and this leaf has nothing to answer for.
      // ═════════════════════════════════════════════════════════════════════════════════════════
      const picked = [...others[0]!.matched].filter((sym) => others.every((o) => o.matched.has(sym)));
      if (picked.length === 0) continue;
      if (picked.some((sym) => l.population.has(sym))) continue;
      const noun = (l.columnLabel ?? l.label.replace(/^(with|in|showing|labelled) /, "")
        .replace(/ (at least|above|at most|below|exactly) .*$/, "")).toLowerCase();

      // ⚠ WHERE WE KNOW WHICH INDUSTRIES A FILED FIELD EXISTS FOR, SAY THEM — it is the more useful
      //   sentence, and the reader can act on it.
      if (l.heldFor && l.heldFor.length < Object.keys(INDUSTRY_WORDS).length) {
        const words = l.heldFor.map((i) => INDUSTRY_WORDS[i] ?? i);
        const list = words.length === 1 ? words[0]
          : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
        return `We hold ${noun} for ${list}, so there is nothing here to compare against.`;
      }

      // ═════════════════════════════════════════════════════════════════════════════════════════
      // ⚠ AND THE SAME GAP EXISTS WITHOUT AN INDUSTRY TO NAME. MEASURED: "banks with return on
      //   equity above their peer group median" returned nothing over 83 companies — because ZERO of
      //   the 12 banks we score carry a return-on-equity value at all. The banking scoring model does
      //   not use that metric, so the honest answer is that we do not hold it for these companies,
      //   not that none of them cleared it. The first version of this block only spoke for FILED
      //   fields and would have let a scored one report a false negative.
      // ═════════════════════════════════════════════════════════════════════════════════════════
      return `We do not hold ${noun} for any of the companies this filter picked out.`;
    }
    return null;
  })();

  const opening = restate({
    tree, leaves: filterLeaves, narrowest: ev.narrowest, matched: ev.matched.size,
    fallbackCouldDiffer,
    order: order ? { label: orderLeaf?.label ?? order.field, direction: order.direction } : null,
    limit,
    basisRequested, basisSplit: filedLeaves.length ? { standalone, consolidated } : null,
    fellBackBecause, fellBackKind,
  });
  const drop = dropped(droppedConditions);
  if (drop) opening.push(drop);
  // ⚠ AND THE BOUND SENTENCE ONLY FIRES WHERE THE READER DID NOT SET THE LIMIT. If they asked for ten
  //   and got ten, "the table carries 10 of the 1,556" reads as a truncation of their own request.
  if (limit === null && ev.matched.size > rows.length) {
    opening.push(`The table carries ${n(rows.length)} of the ${n(ev.matched.size)}, a page at a time.`);
  }

  const section = setTableSection({
    heading: shape === "count" ? "The companies behind that number" : "What matched",
    columns,
    rows,
    totalAvailable: ev.matched.size,
    // ⚠ NOTHING ON THE CARD. The restatement above carries every figure a reader needs and a row of
    //   totals restating it is the noise the Operator asked to remove. The model still gets them.
    totals: [],
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ THE THREE STATES, PER FINDINGS LEAF, IN THE DIGEST — the model's half of the split.
    //
    // ⚠ THE READER'S SENTENCE ABOUT THEM IS GONE (Operator's call — a third qualifying paragraph
    //   above a correct list reads as hedging). The states themselves are NOT gone, and this is where
    //   they live now: the model composing over this section is told all three, and
    //   `I-STATES-SURVIVE` reads them here.
    //
    // ⚠ THREE ENTRIES RATHER THAN ONE STRING, so a gate can assert their PRESENCE structurally
    //   instead of parsing prose. "Could not be checked" folded into "ran and did not fire" is the
    //   defect; two labels that must both exist is what makes the fold visible.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    digestTotals: [
      { label: "Matched", value: String(ev.matched.size) },
      { label: "Searched", value: `${ev.narrowest.size} (${ev.narrowest.universe})` },
      // ═════════════════════════════════════════════════════════════════════════════════════════
      // ★★ EXCLUDED FOR DEPTH IS REPORTED HERE AND NOT IN THE PROSE, and the split is deliberate.
      //
      // ⚠ A STOCK EXCLUDED FOR DEPTH HAS NOT FAILED THE TEST — it has fewer quarters on file than the
      //   question needs, and adding it to "did not match" would report that companies are not
      //   growing when we never looked at them. So the number has to exist somewhere it cannot be
      //   summed with the failures.
      //
      // ★ THE READER ALREADY HAS IT, IN THE DENOMINATOR: "Searched 2,128 companies with 5 quarters on
      //   file" states the floor as the population's own description. A SECOND sentence saying "50
      //   could not be checked" is the shape the Operator struck out twice — it makes a correct
      //   answer read as an unreliable one. The count belongs where the model and the gates read it.
      // ═════════════════════════════════════════════════════════════════════════════════════════
      ...filterLeaves.flatMap((l) => l.excludedForDepth
        ? [{ label: `${l.label} · excluded for depth`, value: String(l.excludedForDepth) }]
        : []),
      ...filterLeaves.flatMap((l) => l.universe === "findings"
        ? [
            { label: `${l.label} · fired`, value: String(l.matched.size) },
            { label: `${l.label} · ran, did not fire`, value: String(l.population.size - l.matched.size) },
            { label: `${l.label} · could not be checked`, value: String((l.notEvaluable ?? 0) + (l.neverEvaluated ?? 0)) },
          ]
        : [{ label: l.label, value: `${l.matched.size} of ${l.population.size}` }]),
    ],
    emptyPhrase: structuralGap ?? `The filter ran over ${n(ev.narrowest.size)} companies and none of them clears every part of it.`,
  }, coverage) as AnySection;

  return {
    kind: "composed",
    compositionId: fellBackBecause ? "market.screen.tree.fallback" : "market.screen.tree",
    sections: [coverageSection(coverage, "A filter across what we hold") as AnySection, section],
    prose: {
      opening,
      leads: { [`ANCHOR:set-table`]: scoped
        ? `Each row, and which part of the question it matched.`
        : `Each company's latest figure.` },
      after: {},
      close: `Filed and scored figures, read as reported.`,
    },
    missLogged: false,
  };
}

/** For the report and the gate — how many leaves and which universes a tree touched. */
export function leafSummary(leaves: readonly LeafResult[]): string {
  return leaves.map((l) => `${l.universe}:${l.matched.size}/${l.population.size}`).join(" ");
}
