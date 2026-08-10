// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE STEP-3 PARITY BASELINE GENERATOR.
//
// Steps 1 and 2 had a pre-change tree to fingerprint against. Step 3 does not: health-view.service.ts
// already carried uncommitted work before this session began, so HEAD is not a baseline for it.
//
// So the baseline is DERIVED. This reads the live service and applies the exact inverse of step 3's
// edits — the filing/read import, the third entry in the layer-1 Promise.all, and the new
// `filingFindings` key in each of the two return objects, each with the comment block that came with
// it — producing the file as it stood before the step. The parity script writes that beside the
// original, imports it, and deletes it again.
//
// ⚠ TRANSIENT ON PURPOSE. A stale duplicate of a live service left in src/scoring/read/ is a module
// someone can import by accident, and it rots the moment the real one changes. Deriving it per run
// also means the baseline cannot silently go out of date: every `cut` below must match EXACTLY ONCE,
// so if the live file moves on, this throws instead of comparing against something that is no longer
// the before. The final leftover scan is the backstop — if any mention of the filing channel survives
// the reverts, the "baseline" is not one, and it refuses rather than producing a soft comparison.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

export const LIVE_PATH = "src/scoring/read/health-view.service.ts";
export const BASELINE_PATH = "src/scoring/read/_baseline-health-view.service.ts";
/** The step-4 baseline lands under its own name so the two gates can run in one session without
 *  either one importing the other's copy. Both are transient and deleted on exit. */
export const STEP4_BASELINE_PATH = "src/scoring/read/_baseline-step4-health-view.service.ts";

const NL = "\n";

// ── EDIT 1 · the import, with its comment ──
const IMPORT_BLOCK =
  "// ★ THE FILING CHANNEL. Rooted at STOCK, not at ScoreSnapshot — see filing/read.ts. This is the" + NL +
  "//   one section of this view that a stock with no snapshot can still populate." + NL +
  'import { readFilingFindings, type FilingFindingsSection } from "../../filing/read.js";' + NL;

// ── EDIT 2 · the layer-1 read + the resolve line ──
const PROMISE_ALL = "const [spg, byPeriod, filingBy] = await Promise.all([";
const PROMISE_ALL_BEFORE = "const [spg, byPeriod] = await Promise.all([";
const READ_BLOCK =
  "    // ★ RESOLVED IN LAYER 1, BEFORE THE `!ref` GUARD. That position is the whole point: every read" + NL +
  "    //   below this line is snapshot-derived and unreachable for 409 of 504 stocks, so a filing" + NL +
  "    //   channel resolved after the guard would be a filing channel that never runs for the stocks" + NL +
  "    //   that have nothing else. One indexed query on (stock_id, period_end DESC)." + NL +
  "    readFilingFindings([stock.id])," + NL;
const RESOLVE_LINE =
  "  const filingFindings: FilingFindingsSection | null = filingBy.get(stock.id) ?? null;" + NL;

// ── EDIT 3 · the not-scored branch's new key, with both comment blocks ──
const NOT_SCORED_BLOCK =
  "    // ⚠ STILL NULL, AND STILL CORRECT. `findings` is the SCORE findings section — divergences," + NL +
  "    //   trajectories, composition. Every one of them is a statement about a reading this stock does" + NL +
  "    //   not have, so null is the honest answer and the boundary stays exactly where it was." + NL +
  "    findings: null," + NL +
  "    // ★ THE ONE SECTION THAT OPENS. A filing finding is about what the company FILED — promoter" + NL +
  "    //   pledging, an earnings-quality run, receivables outpacing revenue — and is true whether or not" + NL +
  "    //   anyone ever computed a Health Score. 409 stocks reach only this branch; before this line they" + NL +
  "    //   rendered as though we had nothing to say about any of them." + NL +
  "    filingFindings," + NL;
const NOT_SCORED_BLOCK_BEFORE = "    findings: null," + NL;

// ── EDIT 4 · the scored return, with its comment block ──
const SCORED_BLOCK =
  "  // ★ TWO CHANNELS, NEVER ONE ARRAY. `findings` is score-derived and exists on 95 stocks;" + NL +
  "  //   `filingFindings` is filing-derived and exists on all 504. They are separate fields because they" + NL +
  "  //   have different populations behind them — and step 5 gives them different base-rate denominators" + NL +
  "  //   for exactly that reason. Merging them here would force a re-split the moment base rates land." + NL;
const SCORED_RETURN = ", findings, filingFindings, peerStanding";
const SCORED_RETURN_BEFORE = ", findings, peerStanding";

// ── the entry point, renamed so both versions can live in one process ──
const ENTRY = "export function buildHealthSnapshotView(";
const ENTRY_BEFORE = "export function buildHealthSnapshotViewBASELINE(";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STEP 4 · THE CHANNEL FILTER'S OWN REVERTS — kept separate from the step-3 set above.
//
// Step 4 drops the 22 filing-owned keys from the SCORE channel at read, so a finding frozen on a head
// snapshot and also live in stock_findings renders once rather than twice. Its parity gate asks a
// narrower question than step 3's ("did anything OTHER than those duplicates move?"), so it needs a
// baseline that is step-3-final rather than pre-step-3 — hence two revert stages, composed for the
// step-3 gate and used alone for the step-4 one. Same discipline: every `cut` must match exactly once.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const S4_IMPORT =
  "// ★ CHANNEL SUPPRESSION — the filing pass owns these 22 keys now, and `filingFindings` below already" + NL +
  "//   serves them. Keyed on FILING_REGISTRY, never on a literal list; see filing/channel.ts." + NL +
  'import { dropFilingFlags, dropFilingPatterns } from "../../filing/channel.js";' + NL;

const S4_FLAGS_COMMENT =
  "  //" + NL +
  "  // ★ CHANNEL SUPPRESSION (filing/channel.ts) — SECOND predicate, different reason. A filing-rule row" + NL +
  "  //   frozen on this head is not obsolete: it is TRUE, and `filingFindings` above is already showing" + NL +
  "  //   it, from the filing's own period. Serving it here too renders the same finding as two cards with" + NL +
  "  //   two dates. The row stays in score_red_flags as history; only what this reader is shown changes." + NL +
  "  //" + NL +
  "  // ⚠ APPLIED HERE AND NOT AT `firedHeadlines` (≈:924), DELIBERATELY. That set drives the three-lens" + NL +
  "  //   anti-double-count: a lens read is suppressed when a headline finding already covers its ground." + NL +
  "  //   The finding still covers that ground — it is still on this page, in the other channel — so" + NL +
  "  //   filtering it there would resurrect lens cards the reader was correctly not being shown, which" + NL +
  "  //   is a scored surface MOVING rather than de-duplicating." + NL;

const S4_QUIET =
  "  //" + NL +
  "  // ★ AND NOW A THIRD CLAUSE: THE PAGE IS NOT QUIET IF THE OTHER CHANNEL IS SPEAKING. The channel" + NL +
  "  //   filter above can empty `patterns` on a stock that is still firing — BLUESTARCO's accruals," + NL +
  "  //   TATACONSUM's margin compression — because those findings moved to `filingFindings` and are" + NL +
  "  //   rendered from there. Without this clause the page would carry \"quiet means nothing tested" + NL +
  "  //   reliable here\" directly beside a fired filing card, which is the surface contradicting itself." + NL +
  "  //   The condition is strictly NARROWER than before, so it can only withdraw the line, never add it." + NL +
  "  const quietNote: string | null =" + NL +
  "    patterns.length === 0 && notCovered.length === 0 && (filingFindings?.fired.length ?? 0) === 0" + NL +
  "      ? NOT_COVERED_SILENT_LINE" + NL +
  "      : null;";
const S4_QUIET_BEFORE =
  "  const quietNote: string | null = patterns.length === 0 && notCovered.length === 0 ? NOT_COVERED_SILENT_LINE : null;";

const S4_FLAGS_CALL = "dropFilingFlags(dropRetiredFlags(snap.redFlags))";
const S4_FLAGS_CALL_BEFORE = "dropRetiredFlags(snap.redFlags)";
const S4_PATS_CALL = "dropFilingPatterns(dropNotCoveredPatterns(dropRetiredPatterns(snap.patterns)))";
const S4_PATS_CALL_BEFORE = "dropNotCoveredPatterns(dropRetiredPatterns(snap.patterns))";

// ── the two object literals, widened: HealthSnapshotView now REQUIRES the key the copy no longer has ──
const NOT_SCORED_OPEN = "const notScored = (): HealthSnapshotView => ({";
const NOT_SCORED_OPEN_WIDE = "const notScored = (): HealthSnapshotView => (({";
const NOT_SCORED_CLOSE = "    regime: null," + NL + "    omitted," + NL + "  });";
const NOT_SCORED_CLOSE_WIDE =
  "    regime: null," + NL + "    omitted," + NL + "  }) as unknown as HealthSnapshotView);";
const SCORED_RET_FULL =
  "return { scored: true, identity, verdict, pillars, trajectory, findings, peerStanding, regime, omitted };";
const SCORED_RET_WIDE =
  "return { scored: true, identity, verdict, pillars, trajectory, findings, peerStanding, regime, omitted } as unknown as HealthSnapshotView;";

/** A revert that must land exactly once, or the live file has moved on and the "baseline" is not one. */
function cutter(src: string) {
  let b = src;
  return {
    cut(needle: string, replacement: string) {
      const hits = b.split(needle).length - 1;
      if (hits !== 1) {
        throw new Error(`baseline generator: expected exactly 1 match, found ${hits}, for: ${needle.slice(0, 90)}`);
      }
      b = b.replace(needle, replacement);
    },
    get text() { return b; },
  };
}

/** Undo step 4's channel filter only — the import, the two comment blocks and the two wrapped calls. */
function revertStep4(src: string): string {
  const c = cutter(src);
  c.cut(S4_IMPORT, "");
  c.cut(S4_FLAGS_COMMENT, "");
  c.cut(S4_FLAGS_CALL, S4_FLAGS_CALL_BEFORE);
  c.cut(S4_PATS_CALL, S4_PATS_CALL_BEFORE);
  c.cut(S4_QUIET, S4_QUIET_BEFORE);
  return c.text;
}

/**
 * ★ THE STEP-4 BASELINE — health-view.service.ts as it stood at the END of step 3, i.e. with the
 * filing channel open and the score channel still serving its frozen filing-rule rows. The step-4
 * parity gate compares against this, so the ONLY difference it may find is the removed duplicates.
 */
export function generateStep4Baseline(): string {
  const c = cutter(revertStep4(fs.readFileSync(LIVE_PATH, "utf8")));
  c.cut(ENTRY, ENTRY_BEFORE);
  const leftovers = c.text.split(NL).filter((l) => /dropFiling/.test(l));
  if (leftovers.length) {
    throw new Error(`step-4 baseline: a channel-filter reference survived the revert: ${leftovers[0].trim()}`);
  }
  return c.text;
}

/** Produce the pre-step-3 source of health-view.service.ts, with its entry point renamed so both
 *  versions can be imported into one process. Throws if any revert does not match exactly once.
 *  ★ COMPOSED: step 4's reverts run FIRST, so what remains to undo is exactly step 3's edits — and
 *  the filing-leftover scan at the bottom stays a real check rather than a permanently-tripped one. */
export function generateHealthViewBaseline(): string {
  const c = cutter(revertStep4(fs.readFileSync(LIVE_PATH, "utf8")));
  const cut = (needle: string, replacement: string) => c.cut(needle, replacement);

  cut(IMPORT_BLOCK, "");
  cut(PROMISE_ALL, PROMISE_ALL_BEFORE);
  cut(READ_BLOCK, "");
  cut(RESOLVE_LINE, "");
  cut(NOT_SCORED_BLOCK, NOT_SCORED_BLOCK_BEFORE);
  cut(SCORED_BLOCK, "");
  cut(SCORED_RETURN, SCORED_RETURN_BEFORE);
  cut(ENTRY, ENTRY_BEFORE);
  cut(NOT_SCORED_OPEN, NOT_SCORED_OPEN_WIDE);
  cut(NOT_SCORED_CLOSE, NOT_SCORED_CLOSE_WIDE);
  cut(SCORED_RET_FULL, SCORED_RET_WIDE);

  const leftovers = c.text.split(NL).filter((l) => /filing/i.test(l));
  if (leftovers.length) {
    throw new Error(`baseline generator: filing references survived the revert: ${leftovers[0].trim()}`);
  }
  return c.text;
}
