// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// COUNTS AS WORDS — one home, for every surface that composes a sentence about members of a pond.
//
// ★ WHY THIS MOVED. These two functions were authored inside results-season/group-copy.ts, where the
// peer-group results-season sentence needed them ("Seven of the eight have posted results"). The
// three-lens separation section composes sentences of exactly the same shape over exactly the same
// subject — members of one peer group — and a second `WORDS` array is how "seven" and "7" end up on
// the same page. The results-season module still exports them, so nothing that imported them from
// there had to change; it imports them from here now, which is the whole point.
//
// Ponds are ≤10 members, so a word always exists. Above ten this falls back to a NUMERAL rather than
// inventing English for a size that cannot occur today — a copy table that grows dead branches is a
// copy table nobody trusts.
//
// PURE. No DB, no I/O — reachable from `build` through verify:copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "seven". A numeral above ten — see the note above. */
export function countWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

/** "Seven" — sentence-initial. */
export function CountWord(n: number): string {
  const w = countWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
