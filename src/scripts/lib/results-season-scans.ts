// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESULTS-SEASON COPY SCANS — Part 2's mechanical constraints, in ONE place, for TWO gates.
//
// ★ WHY THIS FILE EXISTS. These three lists were authored inside verify-results-season.ts for the
// stock strip. The peer-group section is a SECOND CONSUMER of the same copy discipline, and the brief
// is explicit that the existing scans must EXTEND over the new copy. Two copies of a lint are two
// lints: one gets a pattern added, the other does not, and the day a banned phrase ships it will be
// in whichever surface was edited second. So the lists move here, byte-identical, and both gates
// import them. Neither gate loses a pattern and neither can drift.
//
// Pure data + pure functions. No DB, no filesystem, no network — this is reachable from `build`
// through verify:copy and must stay inside the rule verify-build-gate-hygiene.ts enforces.
//
// The R2/R3 forward-language scan is NOT duplicated here: it already lives in one place
// (scoring/findings/trajectory/regime-tier.ts) and both gates import `scanForwardLanguage` from it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * "Likely to move," never "will move." A quarter in line with the last one barely shifts the score.
 *
 * ⚠ `\bexpect\b` IS IN THIS LIST, and it is there because the authored watchlist sentence once read
 * "so expect the score here to shift" — a forecast, not an observation (verify-copy-register.ts
 * rule 1). It was a standing warning; it is an assertion now.
 */
export const MOVEMENT_PROMISE: readonly RegExp[] = [
  /\bwill move\b/i,
  /\bwill shift\b/i,
  /\bexpect\b/i,
  /\b(?:score|reading|health score)\b[^.;]{0,48}\bwill (?:move|shift|change|rise|fall|drop)\b/i,
  /\bis going to (?:move|shift|change)\b/i,
];

/** No lag number. "Once they are ingested" is honest; "within three days" is a promise we don't
 *  control — the pipeline's latency is ours to fix, not the reader's to plan around. */
export const LAG_NUMBER: readonly RegExp[] = [
  /\b\d+\s*(?:day|days|hour|hours|week|weeks)\b/i,
  /\b(?:one|two|three|four|five|six|seven)\s+(?:day|days|hour|hours|week|weeks)\b/i,
  /\bwithin\s+(?:a|an|\d+|one|two|three)\b/i,
  /\bnext (?:day|morning|session)\b/i,
];

/**
 * No instruction. No check, review, see, watch for, keep an eye on.
 *
 * ★ THE WATCHLIST PHRASINGS ARE NOT INSTRUCTIONS AND ARE NOT BANNED. "you're watching this", "on
 *   your watchlist" DESCRIBE a relationship the reader already created; they tell nobody to do
 *   anything. The shipped relational copy makes the same distinction in the same words
 *   ("these are names you asked us to watch", relational/entries.ts UN3).
 *
 * ★ THE IMPERATIVE PATTERN IS ANCHORED AT A CLAUSE START, AND THAT IS THE WHOLE DIFFICULTY. An
 *   imperative is the FIRST word of its clause — "See the results page". The same verbs appear
 *   innocently in third-person description mid-clause, and two shipped sentences are exactly that
 *   case: "Foundation and Momentum both READ THE quarterly accounts" (stock strip) and "Momentum
 *   READS THE quarter" (peer-group section) both have the pillar as their subject, not the reader.
 *   An unanchored \bread\s+the\b banned sentences that instruct nobody, which is how a copy lint
 *   starts getting switched off.
 */
export const INSTRUCTION: readonly RegExp[] = [
  /\bwatch for\b/i,
  /\bkeep an eye\b/i,
  /\bworth (?:watching|investigating|a look)\b/i,
  /\byou (?:should|may want to|might want to|can find|will find)\b/i,
  /(?:^|[.;:—]\s+)(?:see|check|review|revisit|monitor|read|visit|open|browse)\s+(?:this|the|your|it|them)\b/i,
  /\blook (?:at|through|over)\b/i,
  /\bhead (?:to|over)\b/i,
  /\bfind (?:them|it|these|those)\b/i,
  /\bbe aware\b/i,
];

/** The three scans, named for a gate's report line. */
export const COPY_SCANS: readonly { name: string; patterns: readonly RegExp[] }[] = [
  { name: "no promise of movement (incl. `expect`)", patterns: MOVEMENT_PROMISE },
  { name: "no lag number", patterns: LAG_NUMBER },
  { name: "no instruction", patterns: INSTRUCTION },
];

/** Every scan hit in one string, labelled. Empty ⇒ clean. */
export function scanCopyConstraints(text: string): { scan: string; matched: string }[] {
  const out: { scan: string; matched: string }[] = [];
  for (const { name, patterns } of COPY_SCANS) {
    for (const p of patterns) {
      const m = p.exec(text);
      if (m) out.push({ scan: name, matched: m[0] });
    }
  }
  return out;
}
