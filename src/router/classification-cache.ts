// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLASSIFICATION CACHE — because temperature 0 was not enough, and the measurement says so.
//
// ── ★ WHAT WAS MEASURED, AND WHY THIS FILE EXISTS ─────────────────────────────────────────────────
// Stage 5a ran the same 41 questions twice at the provider's default sampling and got a DIFFERENT
// classification on 17 of them — 59% reproducible. Setting `temperature: 0` (route.ts) took that to
// 88%: a large win, and not a fix. Five questions still flip between runs, so roughly one repeat
// question in eight is classified differently the second time it is asked.
//
// **A router that is 88% reproducible is still a product defect, and a worse one than a router that
// is obviously wrong.** The same reader asking the same question twice gets a composed artifact once
// and a clarifying question the next time, with nothing on screen to explain the difference. §6's own
// header names this failure family: the failure mode gets prettier, and prettier means less
// detectable. Non-reproducibility is the version of it that cannot even be reproduced to debug.
//
// Greedy decoding is not bit-reproducible on a served model — batching and expert routing move the
// arg-max on near-ties, and near-ties are exactly what an ambiguous question produces. So the model
// cannot be made deterministic from here; the SYSTEM can.
//
// ── ★ THE CACHE IS THE DETERMINISM GUARANTEE, NOT A COST OPTIMISATION ─────────────────────────────
// That it also removes a model call per repeat question is a side effect worth having, but it is not
// the reason. The reason is that one question must have one answer. The roll of the dice happens
// once, and every later ask of the same question gets the same slots — the variance is bounded to
// first-ask, where a reader has nothing to compare against and therefore cannot see it.
//
// ── ★ TWO RULES THAT KEEP IT HONEST ───────────────────────────────────────────────────────────────
//   1. ONLY MODEL RESULTS ARE STORED. A lexical fallback is what we produce when we could not ask —
//      caching it would let one quota blip or one 429 pin a question to the under-confident answer
//      for the whole TTL, turning a transient denial into a persistent product regression. See
//      `putClassification`, which refuses them.
//   2. THE KEY IS THE QUESTION, NOT THE TURN. Normalised text only: no user, no session, no history.
//      Classification depends on none of those — it is a pure function of the sentence — so a key
//      carrying any of them would fragment the cache and leak turn state into a shared store.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import type { RouterOutput } from "./contract.js";

/**
 * Normalised question text. Case, surrounding whitespace, internal runs of whitespace and trailing
 * punctuation are all classification-irrelevant — "How is TCS doing?" and "how is tcs doing" are the
 * same question and must not be two rolls of the dice.
 *
 * ⚠ NOTHING ELSE IS STRIPPED. Word order, negation and the words themselves all change the answer;
 * an aggressive normaliser that collapsed "who owns TCS" and "TCS owns who" would be trading the
 * defect this file fixes for a worse one.
 */
export function classificationKey(text: string): string {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?!.,;:]+$/, "");
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

/** A day. Classification is a property of the SENTENCE, not of the data, so it does not go stale the
 *  way a plan does — the bound exists to cap memory and to let a prompt change take effect, not
 *  because yesterday's reading of the same words was wrong. */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 2_000;
const store = new Map<string, { at: number; value: RouterOutput }>();

export function getClassification(text: string): RouterOutput | null {
  const key = classificationKey(text);
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { store.delete(key); return null; }
  // Re-insert so the eviction order below is least-recently-USED rather than oldest-written.
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

/** Store a classification. ★ REFUSES ANYTHING THE MODEL DID NOT PRODUCE — see rule 1 in the header. */
export function putClassification(text: string, value: RouterOutput): void {
  if (value.source !== "model") return;
  const key = classificationKey(text);
  if (store.size >= MAX) store.delete(store.keys().next().value as string);
  store.set(key, { at: Date.now(), value });
}

export const classificationCacheStats = () => ({ entries: store.size });
export const clearClassificationCache = () => store.clear();
