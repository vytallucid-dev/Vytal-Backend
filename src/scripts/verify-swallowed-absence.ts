// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A SWALLOWED ERROR MUST NOT BECOME A COVERAGE CLAIM — F-3, and the class's THIRD shipping.
//
// ── ★ THE DEFECT, IN ONE SENTENCE ─────────────────────────────────────────────────────────────────
// `const x = await read().catch(() => []);  if (x.length === 0) return absent("insufficient_quarters")`
// — a failure on OUR side, rendered to the reader as a fact about the COMPANY's filings. Every reason
// token in `NotEvaluableReason` except `read_failed` completes the sentence "this needs …" with
// something the record lacks, so any of them reached from a catch is a confident, wrong statement
// that the reader has no way to detect.
//
// ── ⚠ WHY A GATE AND NOT THREE MORE FIXES ─────────────────────────────────────────────────────────
// It has now shipped three times and been fixed locally three times. `resolve/attribution.ts` carries
// a full header saying it "cannot happen again" — and the guard went on the metrics query while the
// HEAD query one line above kept its bare catch. Local fixes do not close a class; a check does.
// The sweep that found this found TWENTY-TWO sites, which is the real measure of the problem.
//
// ── ★ THE ALLOWLIST IS THE DEBT, AND IT IS SUPPOSED TO SHRINK ─────────────────────────────────────
// Failing outright on all nineteen remaining sites would break the build and get the gate deleted.
// Instead every known site is named here. A NEW one fails immediately; an allowlisted one that gets
// fixed must be REMOVED from the list, because a stale allowlist is a gate that stops guarding.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };

/** ⚠ KNOWN DEBT, NAMED. Each entry is a catch-then-absent site that still claims something about the
 *  record. Remove an entry when it is fixed; never add one to make a build pass. */
// ⚠ SHRUNK FROM SEVEN FILES TO FOUR, 19 SITES TO 9 (C-1). `blocks-stock.ts`, `peer-group.ts` and
//   `trajectory.ts` are OUT because they are now clean — and the staleness assertion below is what
//   forced the removal rather than letting three fixed files sit here looking guarded.
//
// ★ THE REMAINING FOUR ARE THE PLANNER'S BLOCK LAYER AND ONE MARKET-WIDE QUERY. They are left for a
//   pass that can verify them properly rather than hand-fixed at the end of a long batch: the whole
//   argument for this gate is that hand-fixing blind is how a regression ships.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE ALLOWLIST ONLY EVER SHRINKS, AND IT MUST REACH ZERO.
//
// ⚠ IT WAS FRAMED ONCE AS "nineteen remaining sites", AND THAT FRAMING WAS THE PROBLEM. A number is
//   easy to leave alone; a list of specific things nobody has justified is not. Every entry below
//   carries a REASON it is still open — genuinely ambiguous, needs a product decision, blocked on
//   something else. An entry with no reason is a bug in this file, not a deferral.
//
// ⚠ AND A REASON IS NOT A PERMANENT EXEMPTION. Each of these is a place a query failure can still be
//   rendered to a reader as a fact about coverage. They are open because fixing them blind is how a
//   regression ships, not because they are acceptable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EMPTY. 22 sites → 19 → 9 → ZERO. The allowlist did what it was for and is now a closed door.
//
// The last nine, and what each turned out to be once it was read rather than counted:
//
//   blocks-market.ts  ×5  Two were a REAL two-meaning split (`resolveFund`'s null scheme, and a
//                         comparison finding fewer than two covered symbols) and now carry both
//                         arms. Three were not ambiguous at all: `getUniverseHealthView`,
//                         `getUniverseMetricValues` and `screenUniverse` are all typed non-nullable,
//                         so the "record" arm was UNREACHABLE and the token was only ever describing
//                         a swallowed throw.
//   blocks-reader.ts  ×2  The book and the watchlist. Both needed a sentence about US, which did not
//                         exist — `read_failed` reassures about filings and a book has none. Closed
//                         by `reader_read_failed`, the union's third resolver-layer extension.
//   blocks-portfolio-series.ts ×1  `!nav || nav.series.length === 0` collapsed a failed valuation
//                         into "this book is new". Both arms are real; both are now written.
//   ownership.ts      ×1  Allowlisted as genuinely ambiguous, and it was — until the two queries were
//                         separated. The movers query's empty result IS a fact about the record; the
//                         bounds query is the census's denominator, and `?? 0` was turning its
//                         failure into a coverage claim of "searched 0, dropped 0" printed under real
//                         movers.
//
// ⚠ THE GATE DOES NOT RELAX NOW THAT IT IS ZERO. An empty allowlist makes every future site a
//   failure on the commit that introduces it, which is the state this was always heading for. Do not
//   add an entry to make a build pass; the reason field exists to make that awkward to do quietly.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const ALLOW = new Map<string, string>([]);

/** The only reasons whose phrase is about US rather than about the record. See §3.1's corollary. */
const HONEST = new Set(["read_failed", "reader_read_failed"]);

const CATCH = /\.catch\(\(\)\s*=>\s*(?:null|\[\]|\(\{\}\)|\[\]\s+as)/;
const ABSENT = /absent(?:<[^>]*>)?\(\s*"([a-z_]+)"/;

export function scan(text: string): { line: number; reason: string }[] {
  const src = text.replace(/\r\n/g, "\n").split("\n");
  const out: { line: number; reason: string }[] = [];
  for (let i = 0; i < src.length; i++) {
    if (!CATCH.test(src[i]!)) continue;
    // ★ THE WINDOW IS FIFTEEN LINES, RAISED FROM NINE — and the raise is the interesting part.
    //
    //   Nine was "the longest gap measured", and that measurement went stale without anyone noticing:
    //   `resolveUniverse`'s `absent()` sits ELEVEN lines below its catch, so this gate was green over
    //   a live defect while its allowlist stood at zero. It was found by BEHAVIOUR — the
    //   dead-database mode — not by shape, which is the whole argument for that mode existing.
    //
    //   Fifteen is measured, not guessed: sweeping 9 → 40 over the whole tree, the hit count rises at
    //   12 and again at 15 and is flat from 15 to 40. Wider buys nothing and only adds coincidental
    //   proximity matches — the 15-line pass already turns up one (`ownership.ts`'s pledge read,
    //   whose nearby `absent()` is gated on a different read entirely), which is why that site now
    //   states its intent explicitly instead of relying on this scan to stay narrow.
    //
    // ⚠ AND A WINDOW IS STILL A HEURISTIC. This gate cannot see a swallow that reaches a `resolved()`
    //   instead of an `absent()` — `resolveRelationship` fed `held: false` into an ok answer — so the
    //   number above is a floor on coverage, never a claim of completeness. See verify-dead-database.
    const m = ABSENT.exec(src.slice(i, i + 15).join("\n"));
    // ⚠ THE HONEST TOKENS, AND THE LIST IS EXACTLY TWO. A catch reaching either of these is the
    //   CORRECT shape — the failure is being reported as ours. Every other token in the union
    //   completes "this needs …" with something the RECORD lacks, which is the defect.
    //   `reader_read_failed` joined `read_failed` when the reader's own book got a sentence of its
    //   own; without it here the gate fires on its own prescribed fix.
    if (m && !HONEST.has(m[1]!)) out.push({ line: i + 1, reason: m[1]! });
  }
  return out;
}

function main(): void {
  console.log("★ SWALLOWED ERRORS THAT BECOME COVERAGE CLAIMS\n");
  const files = globSync("src/**/*.ts").filter((f) => !f.includes("generated") && !f.includes("scripts"));
  const offenders = new Map<string, { line: number; reason: string }[]>();
  for (const f of files) {
    const hits = scan(readFileSync(f, "utf8"));
    if (hits.length) offenders.set(f.split("\\").join("/"), hits);
  }

  const fresh = [...offenders].filter(([f]) => !ALLOW.has(f));
  ok("no NEW site turns a swallowed error into a claim about the record",
    fresh.length === 0,
    fresh.length ? fresh.map(([f, h]) => `${f}:${h[0]!.line} -> absent("${h[0]!.reason}")`).join(" · ")
                 : `${offenders.size} known site(s), all named in the allowlist`);

  // ⚠ AND THE ALLOWLIST MUST NOT GO STALE. An entry naming a file that is now clean is a gate that
  //   has stopped guarding that file without anyone noticing — the same silence the class itself has.
  const stale = [...ALLOW.keys()].filter((f) => !offenders.has(f));
  ok("the allowlist names only files that still have the defect", stale.length === 0,
    stale.length ? `FIXED but still allowlisted — remove: ${stale.join(", ")}` : `${ALLOW.size} entries, each with a named reason`);

  const total = [...offenders.values()].reduce((a, h) => a + h.length, 0);
  console.log(`\n     debt: ${total} site(s) across ${offenders.size} file(s) still reach a record-shaped reason from a catch`);

  // ── NEGATIVE CONTROLS ───────────────────────────────────────────────────────────────────────────
  const bad = `const v = await read().catch(() => null);\nif (!v) return absent<X>("not_ingested", cov);`;
  const good = `let read = true;\nconst v = await read().catch(() => { read = false; return null; });\nif (!read) return absent<X>("read_failed", cov);`;
  ok("NEGATIVE CONTROL · the defect shape is caught", scan(bad).length === 1, `reason "${scan(bad)[0]?.reason}"`);
  ok("NEGATIVE CONTROL · the corrected shape is silent", scan(good).length === 0, "read_failed is not flagged");
  ok("NEGATIVE CONTROL · a catch with no absent nearby is silent",
    scan(`const v = await read().catch(() => null);\nreturn v ?? [];`).length === 0, "a catch alone is not the defect");
  // ⚠ THE BOOK-SHAPED TOKEN IS CONTROLLED TOO, IN BOTH DIRECTIONS. An exemption that is never
  //   exercised is an exemption nobody has checked — and the guard-over-nothing costume in §3.1 is
  //   precisely the shape of a control that can only pass.
  const bookGood = `const rc = await readerCoverageFor(u).catch(() => null);\nif (!rc) return absent<P>("reader_read_failed", cov);`;
  ok("NEGATIVE CONTROL · the BOOK-shaped corrected shape is silent",
    scan(bookGood).length === 0, "reader_read_failed is not flagged");
  const bookBad = `const rc = await readerCoverageFor(u).catch(() => null);\nif (!rc) return absent<P>("not_ingested", cov);`;
  ok("NEGATIVE CONTROL · …and the same site with a RECORD-shaped reason still fires",
    scan(bookBad).length === 1, `reason "${scan(bookBad)[0]?.reason}" — the exemption is narrow, not a hole`);

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
