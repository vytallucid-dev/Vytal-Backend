// ═══════════════════════════════════════════════════════════════════════
// AI GROUNDING — the retrieval half of the AI stack. It reads the REAL computed health
// snapshot (stock or portfolio) via the EXISTING read services and renders a closed-world
// "fact block" for injection into a prompt. There is NO AI call here and NO direct model
// query — grounding wraps the read SERVICES only, so the AI reads byte-identically what the
// UI shows (same supersede-aware latest snapshot, same read-time lens patterns / trajectory /
// peer standing, never display-vs-internal mixing).
//
// HALLUCINATION IS PREVENTED BY CONSTRUCTION, not instruction: the fact block enumerates EVERY
// citable number, labeled and explicit, with a null rendered as "not available" (never omitted
// — an omission reads as license to guess). There is nothing left for the model to invent.
//
// This module supplies FACTS ONLY. It does not call the model, apply tone, or write prose. The
// caller combines tone.systemDirective (how to speak + the non-advisory spine) with this
// factBlock (what is true, closed-world) → provider.generate(...).
// ═══════════════════════════════════════════════════════════════════════
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";
import type { HealthSnapshotView } from "../scoring/read/health-view.types.js";
import { buildPortfolioHealthView, type PortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";

// ── The closed-world instruction — IDENTICAL in every fact block, never varies, never dropped ──
// One named constant (like tone.ts's NON_ADVISORY_SPINE) so the "only these facts" contract is
// structural: it heads every block a caller injects.
export const CLOSED_WORLD_HEADER =
  "The following are the ONLY facts available. Every number you state must appear verbatim below. " +
  "Do not compute, estimate, convert, infer, or introduce any number not present here. If a value " +
  'is marked "not available", say so plainly — never fill it in.';

export interface GroundingSources {
  asOfDate: string | null;
  periodKey?: string;
  snapshotType?: string;
  constantVersion?: string;
}

export interface StockGrounding {
  data: HealthSnapshotView; // the exact read-service view — structured, typed, honest-empty
  factBlock: string; // closed-world text for the prompt
  sources: GroundingSources;
}

export interface PortfolioGrounding {
  data: PortfolioHealthView;
  factBlock: string;
  sources: GroundingSources;
}

/**
 * ★ WHICH VIEW OF THE PORTFOLIO FACTS — ONE RENDERER, TWO SCOPES. Never two renderers.
 *
 *   "full"    — everything. What an audit or a debugging caller wants, and what GET /me/portfolio's
 *               data would justify. The default, so nothing that exists today changes.
 *   "explain" — the same block with [REFERENCE FINDINGS] omitted. Two reasons, and BOTH are needed
 *               to justify a second scope at all:
 *
 *     1. SUBJECT. The PD family describes VYTAL's data coverage, not the user's book — the portfolio
 *        read keeps it beside the snapshot rather than inside it for exactly this reason
 *        (`cv2-s10a-pd-read-time`). An explanation of someone's portfolio is not the place for our
 *        own gaps, and a model handed them will weave them in as though they were findings about the
 *        money.
 *     2. TIME. PD7 binds `oldestSyncAgeDays` and per-account `ageDays`, which are f(now) at whole-day
 *        granularity. They are the ONLY clock-derived values in the whole block (verified: every other
 *        numeric is a measurement — coverage, weights, drawdowns, rung horizons). Left in, they do two
 *        kinds of damage at once: the facts key rotates at midnight on a book that did not change, AND
 *        a cached explanation can re-serve "synced 3 days ago" a week later — PD7's own documented bug,
 *        promoted from one finding into generated prose.
 *
 * ⚠ IT IS A FILTER, NOT A FORK. The explain block is produced by THIS function, from the same view,
 * through the same helpers — so it cannot drift from what the UI and the audit path see. A separate
 * "explain renderer" would be a second truth about the same book, and the first divergence would be
 * invisible: the AI would cite a number no page shows, and every existing test would still pass.
 */
export type PortfolioFactMode = "full" | "explain";

// ── Render helpers ───────────────────────────────────────────────────────────────────────────
export const NA = "not available";
/** A value → its string, or the explicit "not available" for null/undefined. NEVER omit. */
const val = (x: unknown): string => (x == null ? NA : String(x));
/** A JSON-ish value (evidence / triggeringValues) → compact JSON, or "not available". */
const jsonOr = (x: unknown): string => (x == null ? NA : JSON.stringify(x));
/** `label: value` (or `label: not available`). */
export const kv = (label: string, value: unknown, unit = ""): string =>
  value == null ? `${label}: ${NA}` : `${label}: ${value}${unit}`;

/** A scalar renders as itself; an OBJECT renders as compact JSON. Never "[object Object]" — an
 *  opaque token in a closed-world block is worse than a missing one (it invites invention). */
const scalarOrJson = (x: unknown): string =>
  x == null ? NA : typeof x === "object" ? JSON.stringify(x) : String(x);

// ── PRECISION — one convention, and it is the APP'S OWN, not one invented here ────────────────
//
// ★ WHY A CLOSED-WORLD BLOCK MUST CARRY THE ROUNDED NUMBER. This block is the only place the model
// may take a figure from, and CLOSED_WORLD_HEADER forbids it to "compute, estimate, convert or
// infer" one. So a block carrying only `83.61741` leaves it two options: say "83.61741", which no
// human says aloud, or round it — and ROUNDING IS COMPUTING, the exact thing the header bans. The
// instruction is only obeyable if the number it should speak is already present verbatim. Handing
// it the integer is therefore not a formatting nicety; it is what closes the loophole.
//
// ⚠ AND THE ROUNDING IS NOT OURS TO CHOOSE. It mirrors what the page itself renders — the FE's
// `r0 = Math.round(v)` for scores and `pct0 = Math.round(w * 100)%` for shares — so the AI and the
// UI can never state two different numbers for one fact. If the UI's convention ever moves, this
// moves with it; the failure mode of inventing a third convention here is a user reading "84" on
// the page while the assistant says "83.6", with nothing to tell them which is Vytal.
//
// The RAW always rides along beside the rounded value. Rounding for speech must not destroy
// provenance: the approximate figure is what to say, the raw is what it came from.

/** Float-noise-free decimal string: 0.30000000000000004 → "0.3", 83.61741 → "83.61741". */
const trim = (x: number): string => String(Number(x.toFixed(6)));

export const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A SCORE (0–100 scale): the citable value is the INTEGER, exactly as the page shows it. The raw
 *  appears only when it genuinely differs — 84.0000001 is a float artifact, not a second fact. */
export const scoreStr = (x: number): string => {
  const r = Math.round(x);
  return Math.abs(x - r) < 0.005 ? String(r) : `${r} (raw ${trim(x)})`;
};
/** `label: <score>` — null-safe, honest-empty. */
const scoreKv = (label: string, x: unknown): string => `${label}: ${isNum(x) ? scoreStr(x) : NA}`;

/** A FRACTION (0–1): an approximate WHOLE percent to speak + the raw fraction for provenance.
 *  Whole-number percent is deliberate and uniform — "roughly 8%" is what a person says; a
 *  conversational figure with two decimals is a false claim of precision.
 *
 *  ⚠ A NONZERO SHARE THAT ROUNDS TO ZERO RENDERS "<1%", NEVER "~0%". Whole-number rounding is
 *  right for speech and wrong at exactly one place: the bottom. `INFY: weight=~0%` is a false
 *  statement about a real ₹10,735 position — and because the model is instructed to speak the
 *  rounded figure, it would faithfully repeat "0% of the book" about capital the user owns. The
 *  floor keeps the sentence sayable AND true. A genuine zero still says "0%": the distinction
 *  between "too small to round" and "absent" is exactly the one worth preserving. Raw is retained
 *  either way, so nothing is lost. */
export const pctStr = (f: number): string => {
  const pct = Math.round(f * 100);
  const shown = pct === 0 && f > 0 ? "<1%" : `~${pct}%`;
  return `${shown} (raw fraction ${trim(f)})`;
};
const pctKv = (label: string, f: unknown): string => `${label}: ${isNum(f) ? pctStr(f) : NA}`;

/** An ALREADY-0–100 scalar (e.g. a percentile) — same speech rule, no ×100.
 *  ★ EXPORTED so the chat tools speak an already-percent figure the SAME way this block does — one
 *  convention, so a tool result and the page can never state one number two ways. */
export const pctPointStr = (x: number): string => {
  const r = Math.round(x);
  return Math.abs(x - r) < 0.005 ? `~${r}%` : `~${r}% (raw ${trim(x)})`;
};

/** A ₹ AMOUNT: the SAYABLE Indian form to speak + the raw rupees for provenance. Same companion move
 *  as scoreStr / pctStr, applied to money — and for the identical reason. CLOSED_WORLD_HEADER forbids
 *  the model to "convert" a number, so a block carrying only `1501682.26` leaves it two options: say
 *  "1501682.26", which no Indian investor says aloud, or fold it to ₹/lakh/crore — and folding IS
 *  converting, the exact thing the header bans. The sayable form must already be present for the
 *  tone directive's "speak the rounded one" to be obeyable. Handing over "₹15.02 lakh" closes the loophole.
 *
 *  ⚠ THE CONVENTION IS THE APP'S OWN, NOT ONE INVENTED HERE. It mirrors lib/format.ts's `formatINR`
 *  compact rule — ≥1e7 → crore, ≥1e5 → lakh (both 2 decimals), ≥1e3 → K (1 decimal), below → the en-IN
 *  grouped ₹ (0 decimals) — so the AI and the page can NEVER state one amount two ways (the same argument
 *  the score rounding makes: a user must not read "₹15.02L" on the page while the assistant says
 *  "₹1.5 million" or "1501682"). The ONE deviation is deliberate and is the whole point: "L"/"Cr" are
 *  SPELLED "lakh"/"crore", because an abbreviation is not sayable and a sayable form is why this exists.
 *  Same scale bucket, same rounded number — spoken, not written. `K` is kept verbatim from formatINR:
 *  it is the app's own sub-lakh unit, has no crisp Indian word, and byte-matching the UI there is the
 *  strongest form of "cannot state it differently".
 *
 *  The RAW rides along in parens throughout (traceability unchanged) because the sayable form is lossy
 *  by construction — "₹15.02 lakh" drops the rupees `formatINR` also drops. Genuine zero → "₹0" (no raw
 *  to trace); null/absent → the honest "not available" upstream, unchanged. */
const inrSayable = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} crore`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} lakh`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
};
/** ★ EXPORTED for the same reason as pctPointStr: the chat tools must speak money in the app's own
 *  lakh/crore convention, never invent a second one. */
export const moneyStr = (v: number): string => (v === 0 ? "₹0" : `${inrSayable(v)} (raw ${trim(v)})`);
/** `label: <money>` — null-safe, honest-empty. */
const moneyKv = (label: string, v: unknown): string => `${label}: ${isNum(v) ? moneyStr(v) : NA}`;

/**
 * ⚠ THE ENTITY LEDGER IS PRUNED OUT OF EVERY FINDING BIND — because it now has a real home.
 *
 * PA3 binds the WHOLE entity ledger under `bind.entities`, and until `constructionRead.entities`
 * existed that bind was the only structured carrier of the held company names, so this block had to
 * scavenge it. That was never sound: PA3 is a DUPLICATE-ISSUER detector (it fires only when some
 * issuer is held through 2+ instruments), so the names appeared on some books and vanished on
 * others with no signal — a closed-world block that silently omits the companies reads as "this
 * person holds no companies", which is the precise class of lie this module exists to prevent.
 *
 * Now the ledger is served first-class and rendered once, in [HELD COMPANIES]. Leaving the copy
 * inside the bind would put ONE fact in TWO places in a block whose entire claim is that each fact
 * appears once, authoritatively — and would spend a large amount of the token budget restating it.
 * The COUNTS PA3 binds (entityCount / nameRiskInstrumentCount) are its actual subject and stay.
 */
const pruneBind = (bind: unknown): unknown => {
  if (!bind || typeof bind !== "object" || Array.isArray(bind)) return bind;
  const { entities: _dropped, ...rest } = bind as Record<string, unknown>;
  return "entities" in (bind as Record<string, unknown>) ? rest : bind;
};

/** One portfolio finding, rendered FACTUALLY (code + family + label + its bound evidence). Bare
 *  ids are not enough: four instruments can fire the same code (e.g. PI5 ×4) and the model must be
 *  able to tell them apart from the facts alone. No prose is invented here. */
const pfLine = (f: { id?: string; family?: string; label?: string; tone?: string; bind?: unknown }): string =>
  `    - ${val(f.id)} (${val(f.family)}) ${val(f.label)} — tone=${val(f.tone)}, bind=${scalarOrJson(pruneBind(f.bind))}`;

// ── De-leak maps: internal code → human name, so the fact block speaks names, not keys. ──────
// Metric names arrive on the read view (`MetricView.label`, from CANONICAL_METRICS). Market subs
// and ownership flow categories have NO backend name source, so these two small tables mirror the
// frontend's (lib/health/metric-labels.ts MARKET_SUB_MAP and the ownership FLOW_LABEL) VERBATIM,
// so the two surfaces can never disagree. In every case the raw code is kept as a bracketed
// provenance tail — the citation `label` mechanism matches on it, and traceability is preserved.
const MARKET_SUB_LABELS: Record<string, string> = {
  A1: "52-week Range Position",
  A2: "3-year Range Position",
  B1: "Position vs 200-Day MA",
  B2: "Quarter Trend (HH / HL)",
  B3: "Recent Move (vol-normalised)",
  C1: "Relative Strength vs Sector",
  D1: "Volatility vs Sector Baseline",
};
const FLOW_CATEGORY_LABELS: Record<string, string> = {
  A_promoter: "Promoter",
  B_institutional: "Institutional",
  C_insider: "Insider",
  D_block: "Block",
};
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ P1 · THE MODEL NOW READS THE CATALOGUE. THIS WAS THE ROOT CAUSE.
//
// This block used to read `evidence.name` — a name each RULE writes into its own evidence payload.
// That is a FOURTH vocabulary, and it disagreed with the canonical one on 16 of 34 keys:
//
//     composition_F1_atypical      evidence "Composition (atypical-for-band)"  canonical "Atypical Composition"
//     foundation_N3_deleveraging   evidence "Deleveraging"                     canonical "Sustained deleveraging"
//     ownership_R1_pledge          evidence (ABSENT) → the RAW KEY went to the model
//     + 13 title-case / sentence-case splits across the C, B, D, I and N families
//
// So the model was told one product vocabulary while the reader looked at another, and for R1 — the
// single loudest finding in the system — it was handed `ownership_R1_pledge` and left to invent a
// human name for it. A model asked to describe a product it is being shown inconsistent names for
// will fill the gap, which is exactly the behaviour this whole build exists to stop.
//
// `catalogueFindingName` is the SAME resolver the stock page, the census, the peer-group board and
// the alert picker use — a module import, no fetch. And the sentence is now the row's
// SERVER-RENDERED verdict (Stage 3 put it there), not a second assembly from raw evidence.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { findingName as catalogueFindingName } from "../catalogue/index.js";

/** The canonical display name for a finding key. Never null, never a raw key: the catalogue resolver
 *  falls back to its humanize form for a key it does not carry, and the Stage-6 CI gate makes that
 *  fallback unreachable for anything the engine actually emits. */
const findingName = (key: string): string => catalogueFindingName(key);

/** The row's server-rendered verdict — the SAME sentence the reader sees on the stock page. */
const rowVerdict = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

// ── Stock fact block ───────────────────────────────────────────────────────────────────────
function renderStockFactBlock(view: HealthSnapshotView): string {
  const id = view.identity;
  const L: string[] = [];
  L.push(`=== FACTS: ${id.symbol} (${id.name}) — stock health ===`);
  L.push(CLOSED_WORLD_HEADER);
  L.push("");

  L.push("[IDENTITY]");
  L.push(kv("Symbol", id.symbol));
  L.push(kv("Name", id.name));
  L.push(kv("Sector", id.sector ? `${id.sector.displayName} (${id.sector.key})` : null));
  L.push(kv("Sector archetype", id.sectorClass));
  L.push(kv("Industry path", id.industryPath));
  L.push(kv("Peer group", id.peerGroup ? `${id.peerGroup.displayName} — ${id.peerGroup.memberCount} members` : null));
  L.push(kv("Coverage state", id.coverageState));
  if (id.coverageReason) L.push(kv("Coverage reason", id.coverageReason));
  L.push(kv("As-of date", id.asOfDate));
  L.push(kv("Period", id.periodKey));
  L.push("");

  if (!view.scored) {
    L.push(
      `[HEALTH SNAPSHOT] ${NA} — this stock is not scored (coverageState=${val(id.coverageState)}). ` +
        `No composite, pillars, findings, trajectory, or peer standing exist for it.`,
    );
    return L.join("\n");
  }

  // VERDICT
  L.push("[VERDICT]");
  const vd = view.verdict;
  if (!vd) {
    L.push(NA);
  } else {
    L.push(scoreKv("Composite health score", vd.composite));
    L.push(kv("Band", `${vd.label.band} (${vd.label.label})`));
    // ★ THE NUMERIC BAND CUT RANGE IS WITHHELD FROM THE BLOCK (same lock as the pillar/metric weights and
    // the Ownership internals). The BAND NAME is a fact — it is what the user sees on screen — but the
    // numeric [lower, upper] cut is CONSTRUCTION: the band boundary table, identical for every stock and
    // harvestable across a few fact blocks (each stock's own range reveals one boundary, and enough of them
    // reconstruct the whole tier table). So the block states the band, never its cut. `vd.label.range`
    // remains on the read view / API — this is a render-layer withholding, not a data change.
    L.push(kv("Trajectory marker", vd.trajectoryMarker));
    L.push(scoreKv("Trajectory delta (score points)", vd.trajectoryDelta));
    L.push(kv("Divergence flag", vd.divergence.flag));
    L.push(scoreKv("Divergence gap (max−min pillar subtotal)", vd.divergence.gap));
    L.push(kv("Divergence highest pillar", vd.divergence.high ? `${vd.divergence.high.pillar}=${scoreStr(vd.divergence.high.subtotal)}` : null));
    L.push(kv("Divergence lowest pillar", vd.divergence.low ? `${vd.divergence.low.pillar}=${scoreStr(vd.divergence.low.subtotal)}` : null));
    // ★ THE STORED SCALAR IS WITHHELD FROM THE BLOCK — same lock as the pillar weights above it, and for
    // literally the same arithmetic reason as the `contribution` removal one level down.
    //
    // `score_snapshots.divergence` is NOT the gap printed one line up. It is the engine's own scalar,
    //   stored = market − Σ(w_p / Σw_nonMarket) · subtotal_p        (composite/composite.ts nonMarketBlend)
    // i.e. a linear function of the WITHHELD pillar weights over the four subtotals this block already
    // prints. Measured on the live universe: least-squares over the 91 stocks with no redistribution
    // recovers the non-market weight ratio to a worst residual of 0.0001 points. Printing it beside the
    // subtotals hands over the weight vector, exactly as printing `contribution` beside `metricScore`
    // re-derived the metric weights by division.
    //
    // It is ALSO a second number called "divergence" with a different definition, a different sign
    // convention and a different magnitude: 50 of 94 stocks carry a NEGATIVE stored scalar beside a
    // positive gap (TCS: gap 47.4, stored −37.6). Two contradictory "divergence" numbers three lines
    // apart is an invitation to state the wrong one — and the gap is the one every product surface shows.
    //
    // And it cannot be trusted as a fact anyway: composite/persist.ts writes `null → 0`, so a stock whose
    // Market pillar is unavailable stores 0, indistinguishable from a genuine zero (live: VEDL).
    //
    // `DivergenceView.storedScalar` stays on the read view / API — this is a render-layer withholding,
    // not a data change, exactly like the band cut range above.
    L.push(
      kv(
        "Pond mask",
        vd.pondMask ? `heat=${vd.pondMask.heat}, isHot=${vd.pondMask.isHot}, trailingMovePct=${val(vd.pondMask.trailingMovePct)}` : null,
      ),
    );
  }
  L.push("");

  // PILLARS
  // ★ THE PILLAR WEIGHTS ARE DELIBERATELY WITHHELD FROM THE BLOCK. Every other number here is THIS
  // stock's own on-screen value; the four pillar weights are the one exception — they are the fixed,
  // generalizable ARCHITECTURE of the score, identical for every stock, and the single most
  // reconstructable piece of the scoring recipe. So the block no longer states them in any form:
  //   · not the base set (this line used to render `nominalWeight=~35% (raw fraction 0.35)`), and
  //   · not `appliedWeight` — which EQUALS the base set whenever nothing redistributes, so on the vast
  //     majority of stocks it leaked the same four numbers with only a different label.
  // What the model still needs is preserved: `state` already discriminates a `scored` pillar from one
  // that is `unavailable_redistributed` this period, so the redistribution FACT (a pillar dropped out,
  // its influence moved to the others) is fully explainable. Only the MAGNITUDE of that shift is gone —
  // and that magnitude is derivable ONLY from the withheld weights, so withholding it is the same lock,
  // not a new loss. The weighting POSTURE (which pillar carries more) lives as a qualitative ordering in
  // the assistant context layer (src/ai/context-layer.ts), never as numbers here.
  L.push(
    "[PILLARS] (each pillar's own 0–100 subtotal. The four combine into the composite using Vytal's " +
      "fixed internal weights, which are NOT disclosed in these facts — do not state, guess, or reconstruct " +
      "them. state=unavailable_redistributed means the pillar could not be scored this period and its " +
      "weight was spread across the pillars that could; describe that qualitatively, never with a number.)",
  );
  for (const p of view.pillars) {
    // nativeZone MARKS WITHHELD — the numeric [lower,upper] are per-PG pillar-zone thresholds (constant per
    // peer group, harvestable across stocks). The model explains from the categorical POSITION ("above its
    // native zone"), never the marks, so only `position` is rendered.
    L.push(
      `- ${p.pillar.toUpperCase()}: subtotal=${isNum(p.subtotal) ? scoreStr(p.subtotal) : NA}, state=${val(p.state)}, ` +
        `nativeZonePosition=${val(p.nativeZone.position)}`,
    );
    if (p.metrics) {
      for (const m of p.metrics) {
        // Name-first: the canonical human label leads; the engine key stays as a bracketed
        // provenance tail (citation `label` matching and traceability preserved).
        const mHead = m.label && m.label !== m.metricKey ? `${m.label} [${m.metricKey}]` : m.metricKey;
        // ★ PER-METRIC WEIGHTS WITHHELD — the same lock as the pillar weights, one level down, and the
        // richer leak: per-PG metric weights ARE the scoring architecture. The block used to print
        // contribution + nominalWeight + effectiveWeight; all three are gone. contribution had to go too,
        // because `contribution = effectiveWeight/100 × score` (pillars/assemble.ts), so printing it beside
        // metricScore re-derived the weight by division. rawValue, metricScore, l1Band and the three lens
        // scores stay — this stock's own on-screen values, enough to explain the metric, never how it is weighted.
        L.push(
          `    · metric ${mHead}: rawValue=${val(m.rawValue)}, metricScore=${val(m.metricScore)}, l1Band=${val(m.l1Band)}, ` +
            `lensL1=${val(m.l1Score)}, lensL2=${val(m.l2Score)}, lensL3=${val(m.l3Score)}, metricState=${val(m.metricState)}` +
            (m.suppressionReason ? `, suppressionReason=${m.suppressionReason}` : ""),
        );
        if (m.lensPattern) {
          L.push(`        lens pattern ${m.lensPattern.id} (${m.lensPattern.label}): fieldVerdict=${val(m.lensPattern.fieldVerdict)}, role=${m.lensPattern.role}`);
          // ★ The composed, standing-reconciled verdict SENTENCE — the "is it this stock or the whole
          // field" reading that the code+label alone don't carry. Already CI-proven non-advisory
          // (verify-ai-portfolio-fallback §4). A labeled fact like any other: the model may cite or
          // paraphrase it, closed-world unchanged.
          if (m.lensPattern.verdict) L.push(`        lens pattern ${m.lensPattern.id} verdict: ${m.lensPattern.verdict}`);
        }
      }
    }
    if (p.marketSubs) {
      for (const s of p.marketSubs) {
        const subName = MARKET_SUB_LABELS[s.subComponent];
        const sHead = subName ? `${subName} [${s.subComponent}]` : s.subComponent;
        L.push(
          `    · market sub ${sHead} (category ${s.category}): available=${s.available}, rawValue=${val(s.rawValue)}, ` +
            `score=${val(s.score)}, band=${val(s.band)}, saturated=${s.saturated}, capped=${s.capped}` +
            (s.reason ? `, reason=${s.reason}` : ""),
        );
      }
    }
    if (p.ownership) {
      const o = p.ownership;
      // ★ OWNERSHIP FORMULA SHAPE WITHHELD. The block used to render the whole construction — baseline,
      // pledgingAdjustment, penalties, primarySubtotal, flowAdjustment raw/clamped, and per-flow
      // rawSubScore/cappedSubScore — i.e. the baseline+pledging+flows→clamp recipe, with the clamp floor
      // inferable across stocks. Every one is arithmetic on the way to finalOwnership, and the model explains
      // rather than recomputes, so they are gone. What stays: finalOwnership (the pillar score, on screen) and
      // the CATEGORICAL facts a reader needs. For pledging we surface the FLAG plus the real pledge ratio (the
      // figure the user sees) but NEVER the firing thresholds — r1TriggeringValues also carries thresholdPct=50
      // / thresholdQoqRisePp=10 and breach strings that embed them, so we read ONLY pledgeRatioQ off it. Per
      // flow we surface state / trend / band-landed label / whether an unusually large move was capped (the
      // FACT, from capApplied≠0, not the numeric cap). netFlowValue is dropped: paired with the band it would
      // bracket the UNIVERSAL flow-band cuts, and state+trend+band already carry the meaning ("institutions
      // accumulating — three quarters up — a strong inflow").
      const tv =
        o.r1Fired && o.r1TriggeringValues && typeof o.r1TriggeringValues === "object"
          ? (o.r1TriggeringValues as { pledgeRatioQ?: unknown })
          : null;
      const pledge = tv && isNum(tv.pledgeRatioQ) ? ` (pledge ratio ${pctPointStr(tv.pledgeRatioQ)} of promoter holding)` : "";
      L.push(
        `    · ownership: finalOwnership=${isNum(o.finalOwnership) ? scoreStr(o.finalOwnership) : NA}, ` +
          `promoterPledgeFlag=${o.r1Fired ? "fired" : "not fired"}${pledge}`,
      );
      for (const fc of o.flowCategories) {
        const flowName = FLOW_CATEGORY_LABELS[fc.category] ?? fc.category;
        const moveCapped = isNum(fc.capApplied) && Math.abs(fc.capApplied) > 0.005;
        L.push(
          `        - flow ${flowName} [${fc.category}]: state=${val(fc.categoryState)}, trend=${val(fc.trendState)}, ` +
            `band=${val(fc.bandLanded)}, moveCapped=${moveCapped ? "yes (an unusually large move was limited)" : "no"}`,
        );
      }
    }
    if (p.lensPillarPatterns && p.lensPillarPatterns.length) {
      for (const lp of p.lensPillarPatterns) {
        L.push(`    · pillar lens pattern ${lp.id} (${lp.label}): fieldVerdict=${val(lp.fieldVerdict)}, role=${lp.role}`);
        // ★ The pillar-level composed verdict SENTENCE — same reasoning as the metric one above.
        if (lp.verdict) L.push(`        pillar lens pattern ${lp.id} verdict: ${lp.verdict}`);
      }
    }
  }
  L.push("");

  // FINDINGS — coded keys + evidence values, rendered factually (NO invented prose)
  L.push("[FINDINGS] (coded; the human sentence is composed downstream from these facts)");
  const f = view.findings;
  if (!f || (!f.redFlags.length && !f.patterns.length)) {
    L.push("No red flags or patterns fired.");
  } else {
    for (const rf of f.redFlags) {
      // Name-first: the CANONICAL finding name leads; the raw flagKey stays bracketed for citation
      // and provenance. The name comes from the catalogue — never from evidence, never humanized here.
      const rfHead = `"${findingName(rf.flagKey)}" [${rf.flagKey}]`;
      const v = rowVerdict(rf.verdict);
      L.push(
        `- RedFlag ${rfHead}: severity=${val(rf.severity)}, tier=${val(rf.tier)}` +
          (v ? `, verdict="${v}"` : "") +
          `, triggeringValues=${jsonOr(rf.triggeringValues)}`,
      );
    }
    for (const pt of f.patterns) {
      const ptHead = `"${findingName(pt.patternKey)}" [${pt.patternKey}]`;
      const v = rowVerdict(pt.verdict);
      L.push(
        `- Pattern ${ptHead}: direction=${val(pt.direction)}, severity=${val(pt.severity)}, ` +
          `magnitude=${val(pt.magnitude)}` +
          (v ? `, verdict="${v}"` : "") +
          `, evidence=${jsonOr(pt.evidence)}, metricRefs=${jsonOr(pt.metricRefs)}`,
      );
    }
  }
  L.push("");

  // PEER STANDING
  L.push("[PEER STANDING]");
  const ps = view.peerStanding;
  if (!ps) {
    L.push(NA);
  } else {
    L.push(kv("Peer group scored members", ps.memberCount));
    L.push(kv("Rank (1 = highest composite)", `${ps.rank} of ${ps.memberCount}`));
    L.push(kv("Percentile", isNum(ps.percentile) ? pctPointStr(ps.percentile) : null));
    L.push(kv("Neighbour above", ps.neighbours.above ? `${ps.neighbours.above.symbol}=${scoreStr(ps.neighbours.above.composite)}` : null));
    L.push(kv("Neighbour below", ps.neighbours.below ? `${ps.neighbours.below.symbol}=${scoreStr(ps.neighbours.below.composite)}` : null));
    for (const pk of Object.keys(ps.perPillarRank)) {
      const r = ps.perPillarRank[pk as keyof typeof ps.perPillarRank];
      L.push(`    per-pillar rank ${pk}: ${r.rank} of ${r.outOf}`);
    }
  }
  L.push("");

  // DISTINCTIVE IN COHORT — the ONE derived signal for "what is unusual about where this stock sits".
  // ★ NO NEW DATA and NO NEW QUERY: every number here is derived from `peerStanding` (already read
  // above). The derived figures (spread, lead/drag gaps) are STATED verbatim as labeled facts so the
  // model may cite them — the closed-world header forbids the model to compute, so we compute here.
  L.push("[DISTINCTIVE IN COHORT] (derived from the per-pillar ranks above — where this stock sits UNUSUALLY within its peer group)");
  if (!ps) {
    L.push(`${NA} — no peer standing, so cohort distinctiveness is not defined.`);
  } else {
    const entries = (Object.entries(ps.perPillarRank) as [string, { rank: number; outOf: number }][]).filter(
      ([, r]) => isNum(r.rank),
    );
    if (entries.length < 2) {
      L.push(`${NA} — fewer than two ranked pillars, so no rank spread exists.`);
    } else {
      const best = entries.reduce((a, b) => (b[1].rank < a[1].rank ? b : a));
      const worst = entries.reduce((a, b) => (b[1].rank > a[1].rank ? b : a));
      const spread = worst[1].rank - best[1].rank;
      L.push(`Best-ranked pillar: ${best[0]} at ${best[1].rank} of ${best[1].outOf}`);
      L.push(`Worst-ranked pillar: ${worst[0]} at ${worst[1].rank} of ${worst[1].outOf}`);
      L.push(
        `Per-pillar rank spread: ${spread} (best rank ${best[1].rank}, worst rank ${worst[1].rank})` +
          (spread === 0 ? " — uniform standing across pillars" : spread >= 3 ? " — a lopsided profile across pillars" : ""),
      );
      // Rank-vs-composite mismatch: which pillar most LEADS / DRAGS the overall composite standing.
      // gap = compositeRank − pillarRank; gap>0 ⇒ the pillar ranks BETTER than the composite standing.
      if (isNum(ps.rank)) {
        const withGap = entries.map(([k, r]) => ({ k, rank: r.rank, gap: ps.rank - r.rank }));
        const leads = withGap.reduce((a, b) => (b.gap > a.gap ? b : a));
        const drags = withGap.reduce((a, b) => (b.gap < a.gap ? b : a));
        if (leads.gap > 0) L.push(`Pillar leading its composite standing: ${leads.k} ranks ${leads.rank} vs composite rank ${ps.rank} (ahead by ${leads.gap})`);
        if (drags.gap < 0) L.push(`Pillar dragging its composite standing: ${drags.k} ranks ${drags.rank} vs composite rank ${ps.rank} (behind by ${-drags.gap})`);
        if (leads.gap <= 0 && drags.gap >= 0) L.push(`Every pillar ranks in line with the composite rank of ${ps.rank} — a uniform profile across pillars.`);
      }
    }
  }
  L.push("");

  // TRAJECTORY (quarterly series — the numbers behind the chart)
  L.push("[TRAJECTORY] (quarterly, oldest → newest)");
  const tj = view.trajectory;
  if (!tj || !tj.series.length) {
    L.push(NA);
  } else {
    for (const tp of tj.series) {
      L.push(
        `    ${tp.periodKey} (${tp.asOfDate}): composite=${isNum(tp.composite) ? scoreStr(tp.composite) : NA}, band=${val(tp.labelBand)}, ` +
          `F/M/Mkt/Own=${[tp.foundation, tp.momentum, tp.market, tp.ownership].map((v) => (isNum(v) ? scoreStr(v) : NA)).join("/")}`,
      );
    }
  }

  return L.join("\n");
}

// ── Portfolio fact block ─────────────────────────────────────────────────────────────────────
function renderPortfolioFactBlock(view: PortfolioHealthView, mode: PortfolioFactMode = "full"): string {
  const L: string[] = [];
  L.push("=== FACTS: portfolio health (the user's book) ===");
  L.push(CLOSED_WORLD_HEADER);
  L.push("");
  L.push(kv("Has holdings", view.hasHoldings));

  const snap = view.snapshot;
  if (!snap) {
    L.push(`[PORTFOLIO SNAPSHOT] ${NA} — no computed snapshot exists yet for this book.`);
  } else {
    L.push(kv("Headline slot", snap.headlineSlot));
    L.push("");

    const cs = snap.coverageState;
    L.push("[COVERAGE]");
    L.push(pctKv("Scored value share (coverage)", cs.scoredWeight));
    L.push(kv("Scored holdings count", cs.scoredCount == null ? null : `${cs.scoredCount} of ${val(cs.totalCount)}`));
    L.push(moneyKv("Total book value (₹)", cs.totalValue));
    L.push(pctKv("Recognized-unscored share", cs.recognizedUnscoredWeight));
    L.push(pctKv("Small-unscored share", cs.smallUnscoredWeight));
    L.push(kv("Unlock trigger (unscored capital exists → scoring it lifts coverage)", cs.unlockTrigger));
    L.push("");

    const cr = snap.constructionRead;
    L.push("[CONSTRUCTION READ] (always present — the book's shape; needs no scored holdings)");
    L.push(scoreKv("Construction Net (0–100)", cr.value));
    L.push(kv("Construction band", cr.band));
    L.push(kv("Archetype", cr.archetype));
    L.push(
      kv(
        "Exposures (composition shares)",
        cr.exposures
          ? (["nameRisk", "basket", "debt", "commodity"] as const)
              .map((k) => `${k}=${isNum(cr.exposures![k]) ? pctStr(cr.exposures![k]) : NA}`)
              .join(", ")
          : null,
      ),
    );
    L.push(scoreKv("Gross (C1+C2)", cr.gross));
    L.push(kv("Capital tier", cr.capitalTier));
    if (cr.rules) {
      for (const r of cr.rules) {
        L.push(
          `    rule ${val(r.rule)}: evaluable=${val(r.evaluable)}, points=${val(r.points)}, subjectShare=${val(r.subjectShare)}, ` +
            `firedSubject=${scalarOrJson(r.firedSubject)}`,
        );
      }
    } else {
      L.push(kv("Construction rules [C1…C6]", null));
    }
    L.push(`    construction findings (${cr.findings.length}):${cr.findings.length ? "" : " none"}`);
    for (const cf of cr.findings) L.push(pfLine(cf));
    L.push("");

    // ── THE ENTITY LEDGER, read FIRST-CLASS off constructionRead.entities ──────────────────────
    // ★ NOT off PA3's bind (see pruneBind). This section is present for EVERY book that has a
    // construction ledger — including the ordinary one-instrument-per-company book PA3 stays silent
    // on. Its presence no longer depends on a finding happening to fire.
    //
    // Weight is the entity's share of the WHOLE book (not of the name-risk sleeve) — stated in the
    // header, because an unlabelled share is a number the model will label for us.
    L.push("[HELD COMPANIES] (the entity ledger — one row per ISSUER, aggregated across every instrument of that issuer; weight = share of the whole book)");
    if (cr.entities == null) {
      L.push(`${NA} — this snapshot carries no construction ledger, so the held companies are not known here.`);
    } else if (cr.entities.length === 0) {
      L.push("none — this book holds no single-company (name-risk) positions; its equity exposure is held through funds/baskets.");
    } else {
      L.push(`    count: ${cr.entities.length}`);
      for (const e of cr.entities) {
        const parts = e.constituentInstruments
          .map((c) => `${val(c.symbol)} (${val(c.assetClass)}, ${isNum(c.marketValue) ? moneyStr(c.marketValue) : NA})`)
          .join(" + ");
        L.push(
          `    - ${val(e.displayName)}: weight=${isNum(e.weight) ? pctStr(e.weight) : NA}, sector=${val(e.sector)}, ` +
            `held via ${e.constituentInstruments.length} instrument(s): ${parts || NA}`,
        );
      }
    }
    L.push("");

    L.push("[HEALTH READ] (present only when scored holdings exist)");
    const hr = snap.healthRead;
    if (!hr) {
      L.push(`${NA} — no scored holdings (coverage = 0). The book has a Construction read only.`);
    } else {
      L.push(scoreKv("Health score (uncapped)", hr.value));
      L.push(kv("Health band", hr.band));
      L.push(scoreKv("Quality (the anchor)", hr.quality));
      L.push(scoreKv("Signals (penalty-only)", hr.signals));
      L.push(kv("Provisional (coverage < 40%)", hr.provisional));
      L.push(`    health findings (${hr.findings.length}):${hr.findings.length ? "" : " none"}`);
      for (const hf of hr.findings) L.push(pfLine(hf));
    }
    L.push("");
  }

  // Held-but-unscored / unvalued names (from the live disclosure — the names NOT behind the score).
  // The names that ARE in the book are above, in [HELD COMPANIES], off `constructionRead.entities`.
  // What still does NOT live in this view is any PER-NAME SCORE: the entity ledger gives the issuer,
  // its weight and its instruments, never that name's own health number. Those are per-stock facts —
  // ground each with groundStockHealth(symbol). Do not let a weight here be mistaken for a score.
  const d = view.disclosure as {
    heldNotScored?: Array<{ symbol?: string; isin?: string }>;
    heldNotValued?: Array<{ symbol?: string; isin?: string; note?: { code?: string; sentence?: string } | null }>;
  };
  L.push("[HELD BUT NOT SCORED / NOT VALUED] (names outside the health number)");
  const hns = d.heldNotScored ?? [];
  const hnv = d.heldNotValued ?? [];
  L.push(kv("Held, priced, but not scored (funds/bonds/etc.)", hns.length ? hns.map((h) => h.symbol ?? h.isin ?? "?").join(", ") : "none"));
  L.push(
    kv(
      "Held but could not be valued (unpriceable)",
      hnv.length ? hnv.map((h) => `${h.symbol ?? h.isin ?? "?"}${h.note?.code ? ` (${h.note.code})` : ""}`).join(", ") : "none",
    ),
  );
  L.push("");

  // ★ THE ONE FILTERED SECTION. Everything above is a fact about the BOOK and is identical in both
  // modes — asserted by verify-ai-portfolio-explanation.ts, which requires the explain block to be a
  // strict PREFIX of the full block, so "filtered" can never quietly become "different".
  if (mode === "explain") return L.join("\n");

  L.push("[REFERENCE FINDINGS] (coded; about Vytal's data coverage, NOT a judgment about the book)");
  const rfs = view.referenceFindings ?? [];
  L.push(`    count: ${rfs.length}${rfs.length ? "" : " (none)"}`);
  for (const rf of rfs) L.push(pfLine(rf));

  return L.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────────────────────────
/**
 * Ground a single stock's health. Wraps buildHealthSnapshotView (the canonical, supersede-aware
 * latest-snapshot read). Returns null when the stock is not in the universe (mirrors the read
 * service returning null). A stock that is IN the universe but unscored returns a grounding whose
 * factBlock says so honestly (data.scored = false).
 */
export async function groundStockHealth(symbol: string): Promise<StockGrounding | null> {
  const data = await buildHealthSnapshotView(symbol);
  if (!data) return null;
  return {
    data,
    factBlock: renderStockFactBlock(data),
    sources: { asOfDate: data.identity.asOfDate, periodKey: data.identity.periodKey, snapshotType: "quarterly" },
  };
}

/**
 * Ground the authenticated user's portfolio health. Wraps buildPortfolioHealthView (the same pure
 * read GET /api/v1/me/portfolio serves). Always returns a grounding — an empty book yields a valid
 * "no snapshot / no scored holdings" fact block rather than null.
 */
export async function groundPortfolioHealth(
  userId: string,
  mode: PortfolioFactMode = "full",
): Promise<PortfolioGrounding> {
  const data = await buildPortfolioHealthView(userId);
  return {
    data,
    factBlock: renderPortfolioFactBlock(data, mode),
    sources: { asOfDate: data.snapshot?.asOf ?? null, constantVersion: data.snapshot?.constantVersion },
  };
}

/** Render a fact block from an ALREADY-BUILT view. Exists for the proof harness (which needs to
 *  compare the two modes over one view) and for the synthetic construction-only fixture, which has a
 *  view but no user to read it back from. Same renderer, no second path. */
export function renderPortfolioFacts(view: PortfolioHealthView, mode: PortfolioFactMode = "full"): string {
  return renderPortfolioFactBlock(view, mode);
}
