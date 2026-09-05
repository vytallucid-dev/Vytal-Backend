// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SECTION-TYPE GENERATOR — emits the frontend's view of Contract 2 (architecture §4.4).
//
// ── ★ WHY GENERATED AND NOT HAND-LISTED ─────────────────────────────────────────────────────────
// Zero cross-repo imports exist, so seven concepts are already hand-written on both sides and free to
// drift. `PayloadFor<K>` and `DigestFragment` ARE the interface between the repos — the one place a
// drift would be silent and total, because a renderer reading a payload shape the backend stopped
// producing fails at runtime with no type error on either side.
//
// Two repos cannot share a module without a package, and a package is a new dependency. So the
// frontend gets a BUILD ARTEFACT of the backend contract, exactly as gen-frontend-fallback.ts and
// gen-frontend-metric-catalogue.ts already do. One authoring home; `--check` fails CI if it drifts.
//
// ── ⚠ WHAT IS CARRIED, AND WHAT IS DELIBERATELY NOT ─────────────────────────────────────────────
// CARRIED     SectionKind · RENDERERS (the closed per-kind lists) · DigestLine/DigestGroup/
//             DigestFragment · InteractionSpec · the payload shapes for implemented renderers.
//
// NOT CARRIED the BUILDERS (`line`, `unchanged`, `withheld`, `digest`). They construct digests, and
//             the frontend must never construct one — it never sees a digest at all (N-2). Shipping
//             the builders would hand the browser the ability to synthesise the model's input, which
//             is the crossing this contract exists to prevent.
//
// NOT CARRIED `Coverage`. It is `Resolved<T>`'s, not `Section`'s, and it goes over the wire as data.
//             Generating it here would give it two homes in one repo.
//
//   npx tsx src/scripts/gen-frontend-section-types.ts            # write
//   npx tsx src/scripts/gen-frontend-section-types.ts --check    # exit 1 if the committed file differs
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RENDERERS, type SectionKind } from "../section/contract.js";

const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "..", "Vytal-Frontend");
const OUT = resolve(FRONTEND_DIR, "lib/sections/generated/section-types.generated.ts");

const kinds = Object.keys(RENDERERS) as SectionKind[];

const rendererUnion = (k: SectionKind) =>
  (RENDERERS[k] as readonly string[]).map((r) => `"${r}"`).join(" | ");

const body = `// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GENERATED — DO NOT EDIT. Source: Vytal-Backend/src/section/contract.ts
// Regenerate: npx tsx src/scripts/gen-frontend-section-types.ts   (in Vytal-Backend)
// CI: verify:copy-fresh fails the build if this file drifts from the backend contract.
//
// ⚠ THE DIGEST TYPE IS HERE FOR ONE REASON ONLY: so a renderer can be TYPE-CHECKED against the fact
// that it must not receive one. The browser never reads a digest (N-2). If you find yourself
// importing DigestFragment into a component, that component is on the wrong side of the contract.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The closed set of section kinds (§4.1). A ninth is an architecture amendment, not a build change. */
export type SectionKind =
${kinds.map((k) => `  | "${k}"`).join("\n")};

/** Renderers per kind. If a list grows past six, someone built a variant that should be a parameter. */
export interface RendererByKind {
${kinds.map((k) => `  ${k}: ${rendererUnion(k)};`).join("\n")}
}

export type RendererFor<K extends SectionKind> = RendererByKind[K];

/** Runtime mirror, for exhaustive UI switches over the closed set. */
export const RENDERERS: { readonly [K in SectionKind]: readonly RendererFor<K>[] } = {
${kinds.map((k) => `  ${k}: [${(RENDERERS[k] as readonly string[]).map((r) => `"${r}"`).join(", ")}],`).join("\n")}
} as const;

// ── The digest. Every leaf is a string, by construction — see the backend contract's header. ───────
export interface DigestLine {
  readonly label: string;
  readonly value: string;
  readonly state: "present" | "unchanged" | "absent";
}
export interface DigestGroup {
  readonly label: string;
  readonly lines: readonly DigestLine[];
}
export interface DigestFragment {
  readonly heading: string;
  readonly groups: readonly DigestGroup[];
  readonly withheld: readonly string[];
}

export interface InteractionSpec {
  readonly id: string;
  readonly kind: "sort" | "toggle" | "drill";
  readonly label: string;
}

// ── PAYLOADS for implemented renderers. One entry per built renderer; the rest arrive as they land. ─

/** DECOMPOSITION · waterfall. \`value: null\` is an UNMEASURED pillar and must render as an absent
 *  state, never a zero-height bar — the other bars carry its redistributed weight (N-4). */
export interface WaterfallBar {
  /** ★ A METRIC KEY OR A PILLAR KEY — widened from the pillar union at Phase 2 · Batch 1, because
   *  A · Attribution decomposes the same total at FIELD grain (\`Tier1\`, \`GNPA\`, \`NIM\`). Never
   *  rendered; \`label\` is what a reader sees. */
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly subtotal: number | null;
  readonly weightApplied: number;
  readonly state: "scored" | "unavailable_redistributed" | "not_scored";
  readonly note: string | null;
  /** Points BELOW a perfect reading. ⚠ \`null\`, never 0, for a measure that could not be scored —
   *  a 0 in the gap column reads as "this one is perfect", the inverse of the truth. */
  readonly gap?: number | null;
  /** Which pillar a field-grain bar sits under. Null on a pillar-grain bar. */
  readonly group?: string | null;
  readonly grain?: "field" | "pillar";
  /** Where the value landed against its bar. ⚠ CONTEXT, NOT A VERDICT — see the renderer's note. */
  readonly band?: string | null;
  /** The most this bar could ever have contributed, in composite points. */
  readonly ceilingShare?: number;
}
export interface WaterfallPayload {
  readonly symbol: string;
  readonly periodKey: string;
  readonly total: number;
  /** Persisted band token (fragile | below_par | steady | healthy | pristine) — READ from the
   *  snapshot, never re-derived from \`total\`. The renderer maps it to a design-system colour token;
   *  the backend's own \`colour\` field is deliberately not carried, so the band has one look. */
  readonly band: string;
  readonly bandLabel: string;
  readonly bars: readonly WaterfallBar[];
  /** Points the bars account for. Differs from \`total\` exactly when a pillar is unmeasured. */
  readonly accountedFor: number;
  /** ⚠ \`redistributionReason\` WAS HERE AND IS GONE at Phase 2 · Batch 1. It carried an engine enum
   *  (\`missing_pillar\`, \`market_unavailable\`) and the component rendered it straight into a paragraph,
   *  so readers on VEDL and LT were shown the literal token. Not rendering it left a payload field with
   *  no reader, which \`C3\` correctly failed — so the field left the boundary. The enum still lives on
   *  \`PillarDecomposition\` and in the store; what crosses is the SENTENCE. */
  /** The authored sentence for the reader. \`null\` when no weight moved. */
  readonly redistributionNote: string | null;
  /** \`contribution\` — bars stack UP to the total. \`shortfall\` — bars step DOWN from \`ceiling\`. */
  readonly basis: "contribution" | "shortfall";
  /** The perfect reading a shortfall walk starts from. \`null\` on a contribution walk. */
  readonly ceiling: number | null;
  /** ★ THE ARITHMETIC PROOF. \`false\` means the bars do not account for the score, which means the
   *  per-pillar join is wrong. The renderer MUST say so rather than draw a walk that does not close. */
  readonly reconciles: boolean;
  readonly residual: number;
  /** One sentence saying what the walk starts from and what it lands on. Always present. */
  readonly walkNote: string;
  /** The pillar frame for a field-grain walk. Empty on a contribution walk, where every bar IS a
   *  pillar and a group layer would be a list of one-member groups. */
  readonly groups: readonly {
    readonly label: string;
    readonly subtotal: number | null;
    readonly weightApplied: number;
    readonly state: "scored" | "unavailable_redistributed";
  }[];
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANCHOR · defined-term — M · Meta. Phase 2 · Batch 2.
//
// ⚠ CARRIED ACROSS THE REPOS BECAUSE \`doesntMean\` IS A CORRECTNESS FIELD, NOT A STYLE ONE. It is the ONE
//   universal requirement across all four catalogue registries — 132 of 132 entries carry it while
//   only 74 carry a description — and it is the half a reader most needs. A frontend copy of this type
//   that dropped it would compile, render, and quietly ship a claim with no limit on it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface DefinedTermPart {
  readonly label: string;
  /** A published proportion, pre-formatted (N-1). \`null\` where the parts are not weighted. */
  readonly share: string | null;
  readonly note: string | null;
}
export interface DefinedTermExample {
  readonly symbol: string;
  readonly lead: string;
  readonly rows: readonly { readonly label: string; readonly value: string; readonly note: string | null }[];
  readonly close: string | null;
}
export interface DefinedTermPayload {
  readonly name: string;
  readonly description: string;
  /** ★ THE BOUNDARY. Two registers live in this corpus — render through \`BoundaryLine\`, which picks
   *  the label from the shape. Labelling it "does not mean" inverts the stock register outright. */
  readonly doesntMean: string;
  readonly parts: readonly DefinedTermPart[];
  readonly partOf: string | null;
  /** Which vocabulary answered, as a sentence. ⚠ Never the token. */
  readonly sourceSentence: string;
  /** ★ INSIDE the component, never a card underneath it. */
  readonly example: DefinedTermExample | null;
  readonly seeAlso: readonly { readonly key: string; readonly name: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CALLOUT · findings — PT · Patterns and PB · Portfolio. Phase 2 · Batch 2.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface CalloutItem {
  readonly label: string;
  readonly detail: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  /** ★ THE BOUNDARY, per item. Absent on \`divergence\`/\`largest-movers\` — a magnitude claims nothing. */
  readonly doesntMean?: string;
  readonly subForms?: readonly string[];
}
export interface CalloutPayload {
  readonly items: readonly CalloutItem[];
  readonly lookedFor: string;
  /** ⚠ WHAT THE SET IS. An empty findings list is three different facts and the list cannot say which. */
  readonly setNote?: string | null;
  readonly totalAvailable?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DECOMPOSITION · bridge — the ruled rename of \`margin-walk\`. Phase 2 · Batch 2.
//
// ⚠ \`parts\` IS EMPTY ON A CROSSING, AND THAT IS LOAD-BEARING RATHER THAN AN OPTIMISATION. Where a
//   pillar goes from unmeasurable to measured (or back), both halves of the split are exact arithmetic
//   over a stored zero and neither is true about the business. A renderer that filled the gap with its
//   own split would reintroduce the defect the backend suppresses.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface BridgeStep {
  readonly key: string;
  readonly label: string;
  readonly delta: number;
  readonly parts: readonly { readonly label: string; readonly value: number }[];
  readonly note: string | null;
}
export interface BridgePayload {
  readonly symbol: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly fromValue: number;
  readonly toValue: number;
  readonly steps: readonly BridgeStep[];
  readonly accountedFor: number;
  readonly residual: number;
  /** ★ THE PROOF THE SPLIT CLOSES. \`false\` ⇒ render the ordering, never the totals. */
  readonly reconciles: boolean;
  readonly basisNote: string;
  readonly fromBandLabel: string | null;
  readonly toBandLabel: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · statement-table — a filed statement. Phase 1 · Batch 1.
//
// ⚠ CARRIED ACROSS THE REPOS BECAUSE THE BASIS IS A CROSS-REPO CORRECTNESS FIELD, NOT A STYLE ONE.
//   1,492 of 2,175 non-financial companies file BOTH standalone and consolidated results for the same
//   quarter, so a figure with no basis beside it is one of two real answers. A frontend that dropped
//   \`basis\` from its own copy of this type would compile, render, and be wrong — silently, on every
//   answer. That is the exact drift §4.4 generates these types to prevent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** How a statement row's figures are formatted. \`x\` is a multiple — 3.13×, never "313%". */
export type StatementUnit = "cr" | "pct" | "x" | "inr";

/** One cell. \`value\` rides beside \`display\` so the rendering can be audited against its source. */
export interface StatementCell {
  readonly display: string;
  readonly value: number | null;
  /** \`false\` ⇒ not reported in this period, and \`display\` carries the authored phrase (N-4). */
  readonly filed: boolean;
}

/** One line item. \`role\` is the filing's OWN structure — never an instruction to add rows up. */
export interface StatementLine {
  readonly key: string;
  readonly label: string;
  readonly unit: StatementUnit;
  readonly role: "line" | "subtotal" | "total";
  /** Parallel to \`periods\`, oldest → newest. */
  readonly cells: readonly StatementCell[];
}

export interface StatementGroup {
  readonly label: string;
  readonly lines: readonly StatementLine[];
  /** Why this statement is shorter than a reader might expect. \`null\` when nothing is missing. */
  readonly note: string | null;
}

/** ★ THE BASIS. Required, and \`sentence\` is authored once in the backend — never re-worded here. */
export interface StatementBasis {
  readonly read: "consolidated" | "standalone";
  readonly available: readonly ("consolidated" | "standalone")[];
  readonly sentence: string;
}

export interface StatementTablePayload {
  /** ⚠ CHRONOLOGICAL AND NOT SORTABLE. The column order is the information. */
  readonly periods: readonly string[];
  readonly cadence: "quarterly" | "annual";
  readonly groups: readonly StatementGroup[];
  readonly basis: StatementBasis;
  readonly familyLabel: string;
  readonly emptyPhrase: string;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DECOMPOSITION · ownership-split — Phase 1 · Batch 1 changed one field, and it is why this type is
// now carried at all.
//
// ⚠ THE FIELD WAS \`pledgedPctOfPromoter: number | null\` AND THE FRONTEND PRINTED IT: "None of the
//   promoter holding is pledged." on a zero. 87.2% of the 25,168 filings we hold carry
//   \`pledged_shares = 0\` with ZERO NULLs — a column where "not disclosed" was written as a zero —
//   and 1,555 of those rows report a positive pledge percentage against the same zero shares. Where a
//   pledge does exist the two figures disagree (of 3,205 rows, 2,007 are more than five points apart).
//
// ★ SO NO NUMBER CROSSES. The backend sends a state and the one authored sentence that goes with it,
//   and this type is generated so a future frontend cannot reintroduce a numeric field on its own.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface PledgeReading {
  readonly state: "disclosed_unquantified" | "not_established" | "no_promoter";
  /** The ONLY thing a surface may show for pledging. Never composed client-side. */
  readonly phrase: string;
  readonly worthFollowingUp: boolean;
}

export interface OwnershipSplitPayload {
  readonly periodKey: string;
  readonly parts: readonly { readonly key: string; readonly label: string; readonly pct: number }[];
  readonly promoterDeltaPp: number | null;
  readonly instDeltaPp: number | null;
  readonly pledge: PledgeReading;
  /** Classes the filing did not break out. NAMED, never zeroed. */
  readonly undisclosed: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · stepped-filing-line — three parameters added at Phase 1 · Batch 1.
//
// ⚠ ALL THREE WERE CONSTANTS WHERE FIELDS BELONGED, and each one produced a wrong rendering for a
//   non-crore, multi-series filing set: a crore-only axis labelled a holding percentage "₹71.77 Cr",
//   ONE plotted series silently dropped the other three classes of a register, and the hardcoded
//   title "The last N quarters" is false of a shareholding series (some companies file five a year).
//   Optional, so every caller written before the batch renders exactly as it did.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANCHOR · set-table — carried across the repos from Phase 1 · Batch 2, and \`highlight\` is why.
//
// ⚠ THE HARNESS CAUGHT THE FIELD ARRIVING UNREAD. \`C3 · every payload field is read by its renderer\`
//   fired the moment the backend started sending \`highlight\` — "the backend sends it and the renderer
//   never reads it — a fact the reader was meant to get". That gate scans the component SOURCE, so it
//   caught this one; what it cannot catch is the frontend's own hand-written copy of the TYPE drifting
//   from the backend's, which is the §4.4 failure this generator exists to prevent. The type is now
//   generated, so a future field cannot be added on one side alone and typecheck on the other.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface SetTableColumn {
  readonly key: string;
  readonly label: string;
  /** \`text\` left-aligns and sorts alphabetically; \`number\` right-aligns and sorts numerically. */
  readonly align: "text" | "number";
  /** Column the table sorts by on first render. Exactly one column should set it. */
  readonly primary?: boolean;
}
export interface SetTableCell {
  /** What the reader sees — already formatted (N-1). */
  readonly display: string;
  /** ⚠ NEVER 0 FOR AN UNHELD FIGURE. \`null\` sorts LAST in both directions; zero would rank "we do
   *  not know" above a real low value. */
  readonly sort: number | null;
}
export interface SetTableRow {
  readonly key: string;
  readonly title: string;
  /** The stock this row is about, so the row is a destination. A symbol, never a URL. */
  readonly symbol: string | null;
  readonly tag: string | null;
  /** ★ THE ROW THE READER ASKED ABOUT — the peer roster's own company. Optional; absent elsewhere. */
  readonly highlight?: boolean;
  readonly cells: Record<string, SetTableCell>;
}
export interface SetTablePayload {
  /** ★ WHAT THIS SET IS, in the card's own title. Was a constant in the renderer — see the backend. */
  readonly heading: string;
  readonly columns: readonly SetTableColumn[];
  readonly rows: readonly SetTableRow[];
  readonly totalAvailable: number | null;
  /** Aggregate lines about the whole. ⚠ A median here must be accompanied by the count it is over. */
  readonly totals: readonly { readonly label: string; readonly value: string | null }[];
  /** ⚠ AN EMPTY SET IS A SENTENCE WITH ITS OWN WORDS (N-4), supplied by the backend because only it
   *  knows which empty this is. */
  readonly emptyPhrase: string;
}

export interface SteppedFilingPayload {
  readonly columns: readonly string[];
  readonly rows: readonly {
    readonly period: string;
    readonly cells: readonly { readonly label: string; readonly value: string | null; readonly absentPhrase: string }[];
  }[];
  readonly plots: readonly { readonly label: string; readonly points: readonly { readonly at: string; readonly value: number }[] }[];
  readonly unit: "cr" | "pct";
  readonly title: string | null;
  readonly stepNote: string | null;
}
`;

function main() {
  const check = process.argv.includes("--check");
  const existing = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  if (check) {
    if (existing === body) { console.log(`✅ section types FRESH — ${OUT}`); return; }
    console.error(`❌ section types STALE — regenerate with:\n   npx tsx src/scripts/gen-frontend-section-types.ts`);
    process.exit(1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body, "utf8");
  console.log(`wrote ${OUT}`);
}
main();
