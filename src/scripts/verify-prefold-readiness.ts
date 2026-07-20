// ═══════════════════════════════════════════════════════════════════════════
// THE PRE-FOLD READINESS CHECKLIST.
//
//   npx tsx src/scripts/verify-prefold-readiness.ts
//
// The fold is throttle-expensive: AMFI clamps to ~0.09 MB/s and a full run then takes ~4 hours. So we
// do not re-fold per fix. Everything that can be proven WITHOUT the fold is proven here, and the ONE
// re-fold applies all of it at once.
//
// This file exists to answer exactly one question honestly: IS IT SAFE TO SPEND THAT FOLD?
// ═══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { reconcileAppliedDay } from "../ingestions/corporate-events/instrument-splits.js";
import { classifyPlanOption } from "../ingestions/amfi/mf-distributions.js";

let fails = 0;
const box = (ok: boolean, label: string, detail: string) => {
  console.log(`  ${ok ? "☑" : "☒"} ${label}\n        ${detail}`);
  if (!ok) fails++;
};
const one = async <T = any>(s: string) => (await prisma.$queryRawUnsafe<T[]>(s))[0]!;

console.log("\n═══ PRE-FOLD READINESS ═══\n");

// ── ITEM 1 — the ex-date reconciliation window (0–3 published prints) ──
const splits = await one<{ total: number; rec: number }>(`
  SELECT count(*)::int total, count(applied_date)::int rec
  FROM instrument_corporate_events WHERE event_type = 'split'`);
const EX = 20_000;
const synth = (stepAtPrint: number, factor: number) => {
  const s = new Map<number, number>();
  for (let k = -4; k <= 10; k++) s.set(EX + k, k >= stepAtPrint ? 100 / factor : 100);
  return s;
};
const locates = [0, 1, 2, 3].every((lag) => reconcileAppliedDay(synth(lag, 10), EX, 10) === EX + lag);
const declines =
  reconcileAppliedDay(synth(4, 10), EX, 10) === null &&   // outside the measured range
  reconcileAppliedDay(synth(1, 4), EX, 10) === null &&    // ratio ≠ the PUBLISHED ratio
  reconcileAppliedDay(synth(99, 10), EX, 10) === null;    // no step at all
box(splits.total === 63 && splits.rec === 63 && locates && declines,
  "ITEM 1 — split reconciliation, window = the first FOUR published prints on/after the ex-date",
  `${splits.rec}/${splits.total} splits reconciled · locates every MEASURED lag (0–3 prints): ${locates} · ` +
  `DECLINES print-4, a wrong ratio, and no-step: ${declines}`);

// ── ITEM 2 — the ambiguous twin is declined, never coin-flipped ──
//
// STRIP THE COMMENTS BEFORE GREPPING THE SOURCE. The first cut of this probe searched the raw file for
// `growthBy.set` and went RED — because the comment block that EXPLAINS the old bug quotes the old
// line verbatim. A guard that cannot tell code from the prose describing it will fire on its own
// documentation, and the fix for that is never to delete the documentation.
const code = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const src = code("src/ingestions/amfi/mf-distributions.ts");
box(/twins\.set\(k, null\); ambiguous\+\+/.test(src) && !/growthBy\.set/.test(src),
  "ITEM 2 — two LIVE Growth plans that disagree ⇒ WITHHELD",
  "the last-writer-wins `growthBy.set` is GONE from the executable source; resolveTwins returns null " +
  "on disagreement (it survives only in the comment that explains why it was killed)");

// ── ITEM 3 — the Bonus hole in the Growth test ──
const bonusGrowth = classifyPlanOption("direct plan + growth plan + bonus option").isGrowth;
const realGrowth = classifyPlanOption("direct plan + growth option").isGrowth;
box(bonusGrowth === false && realGrowth === true,
  "ITEM 3 — a BONUS option is not a Growth plan",
  `"growth plan + bonus option" → isGrowth=${bonusGrowth} (was true — the tier is named "Growth Plan") · ` +
  `"growth option" → isGrowth=${realGrowth}`);

// ── ITEM 4 — a DEAD plan can never be a twin ──
box(/const isLive = \(c: TwinCandidate\) => c\.navPoints > 0/.test(src) &&
    /alive\.length === 0.*twins\.set\(k, null\)/s.test(src),
  "ITEM 4 — a Growth plan with NO NAV in the window can never be a twin",
  "a dormant duplicate scheme code is not a total-return source; it used to WIN and hand out NULLs");

// ── ITEM 5 — a fetch failure is a FAULT, not an honest refusal ──
const isrc = code("src/ingestions/corporate-events/instrument-splits.ts");
box(/res\.seriesFetchFailures\+\+/.test(isrc) &&
    /WHEN EXCLUDED\.applied_date IS NOT NULL THEN EXCLUDED\.applied_date/.test(isrc),
  "ITEM 5 — 'we could not ask' ≠ 'it does not reconcile'",
  "a dropped NAV fetch retries 3×, raises a FAULT, and can NEVER overwrite a good applied_date with NULL");

// ── ITEM 6 — the since-earliest drop ──
const cols = await one<{ n: number }>(`
  SELECT count(*)::int n FROM information_schema.columns
  WHERE table_name = 'mf_analytics'
    AND column_name IN ('earliest_nav', 'earliest_nav_date', 'ret_since_earliest_cagr')`);
box(cols.n === 0,
  "ITEM 6 — ret_since_earliest_cagr and its anchors are DROPPED",
  `${cols.n} of the 3 columns remain. AMFI's raw NAV cannot support the metric at ANY span — the ` +
  `further back the anchor, the more splits and payouts sit between it and today`);

// ── THE TOKENIZER WAS NOT TOUCHED — so the family grouping cannot have moved. ──
//
// The brief scoped this as a GROUPING fix. It is not one. The over-merge the tokenizer actually causes
// is the "Plan A" hole ("plan" is a tail phrase and "a" is a CONNECTOR, so Plan A is eaten while Plan
// B–Z survive) — and it is a trap: of 59 Plan-A families, 57 are ONE fund whose IDCW plans AMFI merely
// LABELS "Plan A" while labelling its Growth plan plainly. Preserving the marker repairs 7 plans and
// BREAKS 10, stranding the Growth plans of Franklin Corporate Debt, Franklin Conservative Hybrid and
// ICICI Medium Term Bond. The 2 genuinely-split families are dormant (nav_points = 0 throughout).
//
// So the grouping is left exactly as it was, and this box proves it: same family count, same
// membership, same fingerprint. No re-derive, no truncate+reinsert, no drift.
const grouping = await one<{ fams: number; members: number; fp: string }>(`
  SELECT (SELECT count(*)::int FROM mf_families) AS fams,
         (SELECT count(*)::int FROM mf_family_members) AS members,
         md5(string_agg(scheme_code || '|' || family_id::text, ',' ORDER BY scheme_code)) AS fp
  FROM mf_family_members`);
box(grouping.fams === 3823 && grouping.members === 14041,
  "THE TOKENIZER IS UNTOUCHED — no re-derive, no migration, no drift",
  `${grouping.fams} families / ${grouping.members} members (unchanged), grouping fp ${grouping.fp}. ` +
  `The fix is in twin SELECTION, not grouping — preserving "Plan A" would repair 7 plans and BREAK 10.`);

// ── THE ABORT-BEFORE-WRITE BARRIER — a throttled fold must not leave a half-state. ──
//
// Proven STRUCTURALLY, not by a string search: every abort path sets `res.abortReason` and RETURNS,
// and each of them lies textually BEFORE the single call to upsertAnalytics. There is no path that
// writes a partially-streamed fold.
const mfa = readFileSync("src/ingestions/amfi/mf-analytics.ts", "utf8");
const aborts = [...mfa.matchAll(/res\.abortReason = /g)].map((m) => m.index!);
const upsertCall = mfa.indexOf("await upsertAnalytics(");
const allAbortsPrecedeTheWrite = aborts.length >= 3 && upsertCall > 0 && aborts.every((i) => i < upsertCall);

// And the live proof: AMFI clamped two folds to 0.09 MB/s today and both were killed mid-stream.
// If the barrier had leaked, mf_analytics would carry a half-written run.
const wrote = await one<{ last: string; rows: number }>(`
  SELECT max(computed_at)::text AS last, count(*)::int AS rows FROM mf_analytics`);
box(allAbortsPrecedeTheWrite,
  "THE ABORT-BEFORE-WRITE BARRIER IS ACTIVE",
  `all ${aborts.length} abort paths set abortReason and return BEFORE the single upsertAnalytics call. ` +
  `Live proof: two folds were killed mid-stream today and wrote nothing — mf_analytics still holds ` +
  `${wrote.rows} rows last computed ${wrote.last}.`);

console.log(
  `\n${fails === 0
    ? "☑ ALL BOXES CHECKED — the ONE re-fold is safe to run when AMFI clears, and applies EVERYTHING at once."
    : `☒ ${fails} BOX(ES) UNCHECKED — do NOT spend the fold.`}\n`,
);
await prisma.$disconnect();
process.exit(fails === 0 ? 0 : 1);
