// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 3 of 4 — PORTFOLIO HEALTH findings (the PHS library: PA/PE/PC/PB/PQ/PS/PV/PX + PD/PI).
//
// ── ★ REFERENCED IN PLACE, AND NOT MERGED. ────────────────────────────────────────────────────────
// portfolio/phs/copy.ts is already THE one home for this library, already enforces its own required
// fields at compile time, and already has a CI gate (scripts/verify-phs-copy.ts) that fails the build
// on a missing Doesn't-mean. Nothing about it needs to move. This module DERIVES the registry from it
// so the catalogue is complete — one place to ask "what copy does this product have?" — while the
// authority stays exactly where it is.
//
// ⚠ A PHS FINDING IS NOT A STOCK FINDING AND THE NAMESPACES NEVER MEET. `PC3` describes a BOOK
// ("40% of your capital sits in one sector"); `foundation_P8_receivables` describes a COMPANY. They
// answer different questions for different subjects and share no key space, no families, and no
// surfaces. Folding them together would produce a catalogue that could return a portfolio sentence
// for a stock lookup — which is the failure mode, not the goal.
//
// ── ⚠ WHY THESE ENTRIES CARRY NO `description` ────────────────────────────────────────────────────
// Because PHS copy has none to carry, and inventing ~40 would be authoring under cover of a move.
// A PHS finding's Read is COMPOSED in patterns.ts from live bindings (`read?` is optional there BY
// DESIGN — "the finding carries label + bind only and the UI composes, a deliberate choice per
// finding, never an oversight") and its label is a literal at each push site. What this library
// GUARANTEES is `doesntMean` + `job`, and that is exactly what the PhsFindingEntry variant requires.
//
// ── THE TWO LIFETIMES ARE PRESERVED, BECAUSE THE SEPARATION IS THE GUARD ──────────────────────────
//   persisted  FINDING_COPY   — fired inside persist(), frozen into fired_findings with the snapshot.
//   read_time  READ_TIME_COPY — PE6 (live input) and the whole PD family (subject is VYTAL, not the
//                               book) + PI. Never eligible for the snapshot; never in the sort.
// copy.ts's header is emphatic that "tidying" the two into one map is the move to stop. Collapsing
// them HERE would reintroduce the same error one layer up, so the registry keeps them apart.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { FINDING_COPY, READ_TIME_COPY, type FindingCopy } from "../portfolio/phs/copy.js";
import type { PhsFindingEntry } from "./types.js";

function toEntry(key: string, copy: FindingCopy, lifetime: "persisted" | "read_time"): PhsFindingEntry {
  return {
    registry: "phs_finding",
    key,
    doesntMean: copy.doesntMean,
    job: copy.job,
    lifetime,
  };
}

/**
 * THE REGISTRY. Derived — not transcribed — so it cannot drift: an id added to copy.ts appears here on
 * the next build, and an id removed disappears. Totality is therefore structural rather than declared:
 * there is no separate key list that could fall behind the source.
 */
export const PHS_FINDINGS: Readonly<Record<string, PhsFindingEntry>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(FINDING_COPY).map(([key, copy]) => [key, toEntry(key, copy, "persisted")]),
  ),
  ...Object.fromEntries(
    Object.entries(READ_TIME_COPY).map(([key, copy]) => [key, toEntry(key, copy, "read_time")]),
  ),
});

export const PHS_FINDING_IDS: readonly string[] = Object.keys(PHS_FINDINGS);

export function phsFinding(id: string): PhsFindingEntry | null {
  return PHS_FINDINGS[id] ?? null;
}
