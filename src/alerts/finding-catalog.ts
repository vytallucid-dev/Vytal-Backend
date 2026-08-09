// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING-KEY VOCABULARY — which `findingKey` values can actually make an alert fire.
//
// ── ★ WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// A `finding` alert with a key nothing ever emits is written successfully, passes every CHECK, and is
// then evaluated — correctly — as "no match" every day for the rest of time. The reader believes they
// are armed. The UI cannot produce that state (it picks from a closed list); a chat tool taking a free
// string can, and a model asked for "the pledge one" will happily invent `pledge_rising`.
//
// ── THE VOCABULARY IS THE UNION OF TWO SOURCES, AND IT HAS TO BE ───────────────────────────────────
//   STATIC  — keys the rule engine emits as literals (src/scoring/findings/rules/**). Complete for the
//             rule families, and available with no DB read. Includes ownership_R1_pledge, which is NOT
//             a FireRule at all — it is written by the ownership persist path.
//   LIVE    — DISTINCT keys present in score_patterns / score_red_flags right now. This is what adds
//             the THREE-LENS family: those keys are COMPOSED at runtime (`lens_${lens}_${metricKey}`,
//             see lens-patterns/lens-findings.ts), so no static list can enumerate them — there are as
//             many as there are lens × metric combinations that have ever fired.
//
// Neither source alone is right. Static-only would reject every lens finding a reader can plainly see
// on the stock page. Live-only would reject a legitimate rule key that simply has not fired anywhere
// yet — which is exactly the alert most worth setting.
//
// ⚠ RETIRED KEYS ARE DELIBERATELY EXCLUDED. ruleP2/ruleP3 still have source files but are NOT in
// ALL_RULES ("RETIRED (consolidated into R6 / R1) — files kept, not registered", engine.ts). Their keys
// linger in old rows, so LIVE may surface them; STATIC must not add them, and the honest answer to
// "alert me on P2" is that it cannot fire any more.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { RETIRED_FINDING_KEYS as CATALOGUE_RETIRED_KEYS, isRetiredFinding } from "../catalogue/retired-findings.js";
import { STOCK_FINDINGS, STOCK_FINDING_KEYS, type StockFindingKey } from "../catalogue/index.js";
// ★ NOT-COVERED SUPPRESSION — a persisted `notcovered_*` row is a genuinely LIVE key in score_patterns
//   (unlike a retired one, it was never in STOCK_FINDING_KEYS to begin with, so it cannot be caught by
//   the retired-key deletion pass below). Without this, a chat tool could successfully write — and
//   eval-pass.ts could genuinely FIRE — an alert on a configuration explicitly excluded from ever
//   being a claim.
import { isNotCoveredKey } from "../catalogue/not-covered.js";

/**
 * ★ THE ENGINE’S EMITTABLE KEYS — PROJECTED FROM THE CATALOGUE, NOT TRANSCRIBED FROM IT.
 *
 * ⚠ THIS WAS A HAND-KEPT LIST OF ~40 STRINGS, and the failure mode was not a typo — a typo would
 * have been caught. It was OMISSION: the list is what an alert rule may be written against, so a key
 * missing here is a finding a user can never be alerted on, silently, with no error anywhere. It had
 * already drifted once (the whole live D-family had to be appended by hand when the rules shipped).
 *
 * Typing it `readonly StockFindingKey[]` collapses it: the catalogue’s own key union is the source,
 * so a new finding is alertable the moment it has copy, and a removed one stops being alertable in
 * the same edit. Retired keys are excluded HERE rather than filtered downstream — a retired rule
 * cannot fire again, so an alert on one is permanently dead.
 */
export const STATIC_FINDING_KEYS: readonly StockFindingKey[] = STOCK_FINDING_KEYS.filter(
  (k) => !isRetiredFinding(k) && STOCK_FINDINGS[k].status !== "never_emitted",
);

/**
 * Retired rules — recognised so the refusal can SAY they are retired rather than "unknown".
 *
 * ★ SINGLE-SOURCED from catalogue/retired-findings.ts. This file previously kept its own copy of the
 * list; two lists meant a key could be retired in one and live in the other, and the failure mode was
 * an alert accepted on a finding that can never fire again — permanently silent, and indistinguishable
 * from "it just hasn't triggered yet". The catalogue list is the one that also drives read-layer
 * suppression, so they cannot drift.
 *
 * ⚠ This is the one caller that must still SEE retired keys in live data (to refuse them by name),
 * which is why suppression is applied at each read boundary rather than globally on the Prisma client.
 */
// Widened to readonly string[] deliberately: callers test membership with an arbitrary user-supplied
// key (chat/tools/alerts-write.ts), which a literal-tuple type would reject at the call site.
export const RETIRED_FINDING_KEYS: readonly string[] = CATALOGUE_RETIRED_KEYS;

/** STATIC ∪ LIVE, resolved once per turn by the caller's memo (it is three cheap DISTINCT scans).
 *
 *  ★ LIVE IS NOW THREE TABLES, NOT TWO (step 4). The 22 filing rules write to stock_findings and no
 *  longer to score_patterns / score_red_flags. STATIC already covers them — they are catalogued keys,
 *  so `STOCK_FINDING_KEYS` carries every one — but LIVE must see them too, for the same reason it
 *  exists at all: it is the half that does not depend on a key having been remembered in a list. A
 *  filing key missing from the vocabulary means an alert on it is refused as unknown, which is the
 *  one failure this module was written to prevent. Asserted in scripts/verify-alert-vocabulary.ts. */
export async function loadFindingKeys(): Promise<Set<string>> {
  const keys = new Set<string>(STATIC_FINDING_KEYS);
  try {
    const [patterns, flags, filing] = await Promise.all([
      prisma.scorePattern.findMany({ distinct: ["patternKey"], select: { patternKey: true } }),
      prisma.redFlag.findMany({ distinct: ["flagKey"], select: { flagKey: true } }),
      prisma.stockFinding.findMany({ distinct: ["ruleKey"], select: { ruleKey: true } }),
    ]);
    for (const p of patterns) if (!isNotCoveredKey(p.patternKey)) keys.add(p.patternKey);
    for (const f of flags) keys.add(f.flagKey);
    // ⚠ stock_findings holds a row per rule per period INCLUDING not_fired and not_evaluable ones, and
    //   that is exactly right here: "you can set an alert on this" must not depend on whether the
    //   finding happens to be firing somewhere today. That is what makes the most-worth-setting alert
    //   — the one on a thing that has never fired yet — configurable at all.
    for (const r of filing) keys.add(r.ruleKey);
  } catch {
    // A failed live read degrades to the static list — narrower, never wider. Refusing a valid lens
    // key is a conversation; accepting an invented one is a permanently dead alert.
  }
  // Retired keys can appear in LIVE (old rows) — remove them, they cannot fire again.
  for (const k of RETIRED_FINDING_KEYS) keys.delete(k);
  return keys;
}

/** The closest known keys to what the model asked for — so a refusal can offer the real ones. */
export function suggestFindingKeys(query: string, known: Set<string>, limit = 8): string[] {
  const needle = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!needle) return [...known].slice(0, limit);
  const scored = [...known]
    .map((k) => {
      const flat = k.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (flat === needle) return { k, r: 0 };
      if (flat.includes(needle) || needle.includes(flat)) return { k, r: 1 };
      // any shared word ("pledge", "promoter", "margin")
      const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      return { k, r: words.some((w) => flat.includes(w)) ? 2 : 99 };
    })
    .filter((x) => x.r < 99)
    .sort((a, b) => a.r - b.r || a.k.localeCompare(b.k));
  return scored.slice(0, limit).map((x) => x.k);
}
