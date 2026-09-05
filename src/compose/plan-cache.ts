// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PLAN CACHE — most planning questions are the same question.
//
// ★ WHAT GENERALISES AND WHAT DOES NOT. A plan is a STRUCTURE plus PROSE. "How is X doing" against
//   two tier-2 companies with the same data profile wants the same blocks in the same order — the
//   structure generalises completely. The prose does not: it names the company, and reusing it would
//   put one company's name on another's answer, which is the worst class of error this build exists
//   to prevent.
//
//   So the cache stores the STRUCTURE ONLY. A hit reuses the blocks and the follow-up shape and takes
//   its opening and close from the deterministic writer, which composes them from THIS company's
//   manifest. No model call, right shape, right name.
//
// ★ THE KEY IS THE QUESTION SHAPE AND WHAT WE HOLD, NOT THE QUESTION TEXT. "how is TCS doing" and
//   "how is INFY doing" are one cache entry when both are tier 2 with the same fields available; the
//   same words against a tier-0 company are a different entry, because the honest plan is different.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import type { RouterOutput } from "../router/contract.js";
import type { CapabilityManifest } from "./manifest.js";
import type { BlockSpec, Plan } from "./plan.js";

export interface CachedStructure {
  readonly blocks: readonly BlockSpec[];
  readonly followUps: Plan["followUps"];
  readonly rationale: string;
}

/** Availability profile — the facts a planner's structural decision actually turns on. */
export function planKey(m: CapabilityManifest, router: RouterOutput): string {
  const has = Object.entries(m.has).filter(([, v]) => v).map(([k]) => k).sort().join(",");
  // ⚠ THE TIMEFRAME IS PART OF THE QUESTION SHAPE, AND LEAVING IT OUT MADE TWO DIFFERENT QUESTIONS
  //   ONE CACHE ENTRY. "what is TCS's revenue trend?" and "show me ten years of TCS history" route to
  //   the same operation and lens and differ ONLY in the window — so the first one to arrive stored
  //   its structure under a key the second one hit, and the second was answered with the first's
  //   plan for six hours. The Operator saw it as "these two rendered the exact same answer", which
  //   is precisely what it was: one plan, served twice, with the window thrown away.
  //
  //   Bucketed rather than exact: a 10-year and a 12-year window want the same SHAPE, and keying on
  //   the raw n would give every integer its own entry and defeat the cache for no gain.
  const tf = router.timeframe;
  const window = tf === null ? "tf-none"
    : tf.kind === "latest" ? "tf-latest"
    : `tf-${tf.kind}-${tf.n === null ? "?" : tf.n <= 4 ? "short" : tf.n <= 12 ? "medium" : "long"}`;
  const raw = [
    router.operation, router.lens ?? "-", window, `tier${m.tier}`,
    m.pillarsScored.slice().sort().join("|"),
    m.findingNames.length > 0 ? "findings" : "clean",
    has,
  ].join("::");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

const TTL_MS = 6 * 60 * 60 * 1000; // structure is stable within a scoring day; six hours is cautious
const MAX = 500;
const store = new Map<string, { at: number; value: CachedStructure }>();

export function getStructure(key: string): CachedStructure | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { store.delete(key); return null; }
  return hit.value;
}

export function putStructure(key: string, value: CachedStructure): void {
  if (store.size >= MAX) store.delete(store.keys().next().value as string);
  store.set(key, { at: Date.now(), value });
}

export const cacheStats = () => ({ entries: store.size });
export const clearPlanCache = () => store.clear();
