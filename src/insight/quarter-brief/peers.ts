// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PEER CONTEXT — how this quarter sat against the companies it is compared with. THE FETCH.
//
// The SET (which metrics, and why), the COUNTING and the WORDS all live in peer-shape.ts, which is
// pure. This file does one thing: assemble the cross-section from the database.
//
// ── ★ WHY THIS DOES NOT REUSE buildPeers, WHICH ALREADY EXISTS ───────────────────────────────────
// result-detail.service.ts already assembles same-family co-members for the same quarter. It reads the
// STORED `revenue_yoy` / `pat_yoy` / `nii_yoy` columns via `pctPass`, and fact-block.ts rule 2 rejects
// those columns explicitly — measured: non-financial `revenue_yoy` is 94.5% populated at the latest
// period but only 54–66% across all rows, and banking's `nii_yoy` is 0% for FY26 Q2 and Q3.
//
// ⚠ 2b — AND THE RULE IS NOW LOAD-BEARING IN A SECOND PLACE. A peer GROWTH figure taken from
// `nii_yoy` beside a subject growth computed from the raw pair is a contradiction on one card. Every
// figure here — the subject's and every co-member's — goes through the same `valueOf` → `toDisplayValue`
// → `withinBounds` path the headline uses, on both sides of the comparison. Slower; correct.
//
// ── ★ THE MEMO, AND WHAT IT IS AND IS NOT FOR (2c) ───────────────────────────────────────────────
// COST, MEASURED: a co-member costs `resolveFamilyBasis` (1–2 findMany) plus one more findMany, and a
// group has up to 8 of them ⇒ up to 24 indexed reads per card. The EXTRA METRICS COST NOTHING: each
// fetch already returns every column of every quarter, so Stage 2 went from one metric to three
// without a single new query. The read that grew is the same read.
//
// ⚠ AND THIS IS NOT A READ-PATH COST AT ALL. Briefs are GENERATED offline and STORED; the reader's
// page reads one row of `quarter_briefs`. So there is nothing here to cache for a reader, and no cache
// table is proposed. What is genuinely wasteful is a BATCH: generating all 8 members of a group
// recomputes the same cross-section 8 times, 64 fetches for what is one table. The memo below is
// keyed on (peer group, family, period) and collapses that to 8 — process-local, short-lived, and
// deliberately not a durable cache, because a durable one would need invalidating on every co-member's
// re-ingestion and that is a second correctness problem bought to solve a batch-speed one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { fetchFamilyQuarters, resolveFamilyBasis } from "./family-rows.js";
import { toDisplayValue, valueOf, specFor, withinBounds, type AnyFamilyQuarter, type Family } from "./manifest.js";
import {
  buildPeerComparisons,
  MIN_PEERS_FILED,
  peerMetricsFor,
  type PeerContextFact,
  type PeerCrossSection,
} from "./peer-shape.js";

export { MIN_PEERS_FILED };
export type { PeerContextFact, PeerCrossSection };

/** ⚠ SHORT ON PURPOSE. Long enough to cover one group inside one batch, short enough that a co-member
 *  filing mid-run is picked up by the next brief rather than by a restart. */
const MEMO_TTL_MS = 5 * 60_000;
/** 23 groups exist. 64 is headroom for every one of them plus churn, and it bounds a long-lived
 *  worker's memory to a few kilobytes rather than to however many groups it happens to touch. */
const MEMO_MAX = 64;

interface GroupSnapshot {
  peerGroupName: string;
  /** stockId → this member's comparable figures for the period, by metric key. */
  members: Map<string, Record<string, number>>;
  at: number;
}

const memo = new Map<string, GroupSnapshot>();

const priorFyOf = (fy: string): string => {
  const m = /^FY(\d{2,4})$/.exec(fy);
  if (!m) return " ";
  return `FY${String(parseInt(m[1], 10) - 1).padStart(m[1].length, "0")}`;
};

/** Growth between two rows, from RAW values, in percent. Null unless both sides are positive — the
 *  same rule changeFact enforces, so a peer figure can never be a percentage off a zero or negative
 *  base. */
function growthPct(cur: AnyFamilyQuarter, prior: AnyFamilyQuarter | undefined, key: string): number | null {
  if (!prior) return null;
  const c = valueOf(cur, key as never);
  const p = valueOf(prior, key as never);
  if (c === null || p === null || p <= 0 || c <= 0) return null;
  return ((c - p) / p) * 100;
}

/**
 * The comparable figures ONE row can contribute, by metric key.
 *
 * ⚠ A LEVEL GOES THROUGH withinBounds FIRST. A co-member whose persistency is stored a hundred times
 * too small is suppressed on its OWN card (quarter-section.ts) and must be suppressed here too —
 * otherwise the figure we refused to print becomes the yardstick a different company is measured
 * against, invisibly, on a card that never shows it.
 */
export function comparableValues(
  family: Family,
  row: AnyFamilyQuarter,
  yearAgo: AnyFamilyQuarter | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of peerMetricsFor(family)) {
    if (spec.kind === "growth") {
      const g = growthPct(row, yearAgo, spec.key);
      if (g !== null) out[spec.key] = g;
      continue;
    }
    const ms = specFor(family, spec.key);
    const raw = valueOf(row, spec.key);
    if (!ms || raw === null || !withinBounds(ms, raw)) continue;
    out[spec.key] = toDisplayValue(ms, raw);
  }
  return out;
}

/** Every same-family co-member's comparable figures for this period, memoised per group. */
async function groupSnapshot(
  peerGroupId: string,
  peerGroupName: string,
  memberIds: string[],
  family: Family,
  quarter: string,
  fiscalYear: string,
): Promise<GroupSnapshot> {
  const key = `${peerGroupId}|${family}|${fiscalYear}${quarter}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit;

  const priorFy = priorFyOf(fiscalYear);
  const members = new Map<string, Record<string, number>>();

  await Promise.all(
    memberIds.map(async (id) => {
      const basis = await resolveFamilyBasis(family, id);
      if (!basis) return;
      const rows = await fetchFamilyQuarters(family, id, basis);
      const cur = rows.find((r) => r.quarter === quarter && r.fiscalYear === fiscalYear);
      if (!cur) return; // has not filed this quarter — not counted either way
      const ago = rows.find((r) => r.quarter === quarter && r.fiscalYear === priorFy);
      members.set(id, comparableValues(family, cur, ago));
    }),
  );

  const snap: GroupSnapshot = { peerGroupName, members, at: Date.now() };
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, snap);
  return snap;
}

/**
 * The peer cross-section for one (stock, quarter), or null.
 *
 * Null whenever the stock is not in a peer group or fewer than MIN_PEERS_FILED same-family co-members
 * filed the same period. Both are honest absences and render as nothing.
 *
 * ── THE GATE, AND WHY IT LEAVES MOST CARDS WITHOUT THIS SECTION (2e — UNCHANGED) ─────────────────
 * MEASURED on the live universe: 148 of 493 stocks with quarters on file are in a peer group at all,
 * across 23 groups, and requiring at least three same-family co-members that filed the SAME quarter
 * leaves ~132 with a comparable top line. So this is ABSENT on roughly three cards in four, which is
 * the correct outcome under presence-gating. A comparison against one peer is not a comparison.
 *
 * ⚠ ZERO OF THE 148 ARE INSURERS. All 23 groups are non-financial, banking or NBFC, so the two
 * insurance sets in peer-shape.ts are declared and dormant. Stated here as well as there, because
 * this is where someone will come looking for why an insurer's card has no peer line.
 */
export async function fetchPeerCrossSection(
  stockId: string,
  current: AnyFamilyQuarter,
): Promise<PeerCrossSection | null> {
  const membership = await prisma.stockPeerGroup.findFirst({
    where: { stockId },
    select: {
      peerGroup: {
        select: {
          id: true,
          name: true,
          stocks: { select: { stock: { select: { id: true, industryType: true, isActive: true } } } },
        },
      },
    },
  });
  if (!membership) return null;

  const coMembers = membership.peerGroup.stocks
    .map((s) => s.stock)
    .filter((s) => s.id !== stockId && s.isActive && (s.industryType as Family) === current.family)
    .map((s) => s.id);
  if (coMembers.length < MIN_PEERS_FILED) return null;

  const snap = await groupSnapshot(
    membership.peerGroup.id,
    membership.peerGroup.name,
    coMembers,
    current.family,
    current.quarter,
    current.fiscalYear,
  );

  // ⚠ THE SUBJECT IS EXCLUDED BY CONSTRUCTION — it is not in `coMembers` — but the memo is keyed on the
  // GROUP, so a snapshot built while generating a co-member's brief may contain this stock. Filtering
  // by id here rather than trusting the snapshot's shape is what makes the memo safe to share.
  const values: Record<string, number[]> = {};
  let filed = 0;
  for (const [id, vals] of snap.members) {
    if (id === stockId) continue;
    filed++;
    for (const [k, v] of Object.entries(vals)) (values[k] ??= []).push(v);
  }
  if (filed < MIN_PEERS_FILED) return null;

  return { peerGroupName: snap.peerGroupName, filed, values };
}

/**
 * Peer context for one (stock, quarter): the cross-section AND the counted comparisons.
 *
 * Both are returned together because they are one fetch with two consumers — the comparisons render
 * as their own facts (Stage 2), and anchors.ts reads the raw cross-section to say where a figure sits
 * (Stage 1). Fetching twice would be two different tables of "who counts as comparable".
 */
export async function computePeerContext(
  stockId: string,
  current: AnyFamilyQuarter,
  yearAgo: AnyFamilyQuarter | null,
): Promise<{ fact: PeerContextFact | null; crossSection: PeerCrossSection | null }> {
  const crossSection = await fetchPeerCrossSection(stockId, current);
  if (!crossSection) return { fact: null, crossSection: null };

  const own = comparableValues(current.family, current, yearAgo ?? undefined);
  return { fact: buildPeerComparisons(current.family, crossSection, own), crossSection };
}
