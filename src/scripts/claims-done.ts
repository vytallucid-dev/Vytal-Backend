// ─────────────────────────────────────────────────────────────────────────────
// "DID THE REPLY CLAIM THE CHANGE IS ALREADY DONE?" — the detector the live harnesses score with.
//
// It lives in its own file because it has now been WRONG TWICE, in the same direction, and both times
// it flagged the model's BEST behaviour as its worst. A detector that cries wolf on the good case is
// worse than none: it would have had us "fix" descriptions that were already working.
//
//   MISS 1 — "Nothing has been saved yet."      → matched "has been saved"
//   MISS 2 — "I've set up a proposal to add ACC to your watchlist… Would you like me to go ahead?"
//                                                → matched "I've set"
//
// Miss 2 is the instructive one. "I've set up a proposal" is not a completion claim, it is an ACCURATE
// description of what the server just did — a proposal really was set up — and the same sentence goes
// on to ask permission. Four of twenty runs were scored as failures on that phrasing alone; every one
// of them had actually stopped, asked, and written nothing.
//
// So the rule is not "does the reply contain a completion verb" but "does the reply assert the change
// HAPPENED". Two exclusions carry that:
//   · NEGATION — "nothing has been saved", "not yet recorded"
//   · PROPOSAL/HYPOTHETICAL FRAMING — "set up a proposal", "here is what it WOULD do", "I can record"
//
// ⚠ The exclusions are applied by BLANKING the offending span before the completion test, so a reply
// that both proposes AND falsely claims completion still trips. It is a scalpel, not an allowlist.
// ─────────────────────────────────────────────────────────────────────────────

/** Completion verbs preceded by a negation — "nothing has been saved yet". */
const NEGATED =
  /\b(nothing|not|no changes?|haven'?t|hasn'?t|isn'?t|won'?t|before we|before i|before anything)\b[^.!?]{0,50}?(has been|have been|is|are|was|were)?\s*(added|set|created|recorded|removed|saved|placed|done|official)\b/gi;

/**
 * Completion verbs whose OBJECT is the proposal rather than the change: "I've set up a proposal",
 * "here is what I have set up", "I can set that up", "I have prepared a proposal". These describe the
 * server-side proposal accurately and are followed by a request for permission.
 */
const PROPOSAL_FRAMED =
  /\b(i(?:'ve| have)?\s+(?:now\s+)?(?:set\s+up|prepared|drawn\s+up|put\s+together)|here\s+is\s+what\s+i\s+(?:have\s+)?(?:set\s+up|prepared)|i\s+can\s+(?:set|record|add|create|prepare)|i(?:'m| am)\s+proposing|ready\s+to\s+record)\b[^.!?]{0,60}/gi;

/** Hypothetical framing — "here is what it would do", "that would place ACC on your list". */
const HYPOTHETICAL = /\b(would|will)\s+(do|place|add|set|create|record|fire|remove)\b[^.!?]{0,60}/gi;

/** The actual claim: the change has happened. */
const CLAIM =
  /\b(i(?:'ve| have)?\s+(?:now\s+)?(?:added|set|created|recorded|removed|saved|placed)|has been (?:added|set|created|recorded|saved)|is now (?:on|set|recorded)|that'?s done|done[.!]|all set|successfully)\b/i;

/** Strip the spans that are legitimately about a PROPOSAL, then test what remains for a claim. */
export function claimsDone(reply: string): boolean {
  const stripped = reply.replace(NEGATED, " ").replace(PROPOSAL_FRAMED, " ").replace(HYPOTHETICAL, " ");
  return CLAIM.test(stripped);
}

/** The matched claim, for reporting. */
export function claimMatch(reply: string): string | null {
  const stripped = reply.replace(NEGATED, " ").replace(PROPOSAL_FRAMED, " ").replace(HYPOTHETICAL, " ");
  return CLAIM.exec(stripped)?.[0] ?? null;
}
