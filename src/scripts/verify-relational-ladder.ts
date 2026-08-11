// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL LADDER — THE PAYLOAD CONTRACT, over the live population.
//
// The card no longer renders every entry at one weight. It reads `leadEntryId`, `floorRank` and the
// published `claimHead`/`claimTail` seam, and it renders `overflow` as visibly as `slots`. Each of
// those is a promise this file holds the backend to, on REAL readers and REAL stocks — the fixture
// matrix (verify-relational-matrix.ts) proves the LOGIC against constructed inputs, and every falsehood
// found during this build was found on live data instead.
//
// ── WHAT IT ASSERTS, AND WHY EACH ONE IS A REAL FAILURE MODE ──────────────────────────────────────
//  1 · LEAD — `leadEntryId` names a slot, and names the FIRST slot at rung 1–4 or else slot 1. Getting
//      this wrong is not cosmetic: "highest rung leads" opens a watched stock on its watchlist date
//      and an uncovered stock on its coverage gap, both of which shipped in the prototype before the
//      rule was written down.
//  2 · FLOOR RANK — contiguous from 0, in slot order, on exactly the entries the mode ranked. The
//      render's weight rule reads it; a hole or a gap silently re-weights a card.
//  3 · LADDER ORDER — floor first in floor order, then non-decreasing rung, ACROSS slots ++ overflow.
//      This is arbitration's own ordering restated as an invariant of the served bytes, and it is what
//      proves the echo merge (which now rewrites both arrays) did not reorder or lose anything.
//  4 · NO CLAIM TWICE — no claim appears twice on a card, and no claim is a strict prefix of another.
//      The prefix case is the exact shape of the defect this pass fixed: the finding printed bare as
//      its ELEVATED host AND again as the echo entry with the counts appended.
//  5 · THE SEAM — where `claimHead`/`claimTail` are published, `claim` is byte-exactly
//      `head + " " + tail`. The card renders the two halves at different weights; if they do not
//      reassemble, the card is showing copy nobody wrote.
//  6 · THE ECHO IS ANNOTATION, NOT DUPLICATE — every entry carrying echo arithmetic either IS a UE
//      entry with no host on the card, or is a host that absorbed one. Never both copies.
//
// Also writes the render fixture the FRONTEND half of this gate consumes:
//   Vytal-Backend » npx tsx src/scripts/verify-relational-ladder.ts [fixture.json]
//   Vytal-Frontend» npx tsx --tsconfig scripts/tsconfig.render.json scripts/verify-relational-ladder.tsx fixture.json
// The frontend half mounts the REAL component over these payloads and asserts every claim and gloss
// survives to the DOM verbatim — a payload check cannot see a render that drops a sentence.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { resolveRelationalState } from "../relational/service.js";
import { URGENT_RUNG_CEILING } from "../relational/arbitration.js";
import { MODE_CONTRACTS, HONEST_NULL_SLOTS, type EntrySlot } from "../relational/mode-contract.js";
import type { RelationalState, ResolvedEntry } from "../relational/types.js";

let pass = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) pass++;
  else failures.push(`${name}${extra ? ` — ${extra}` : ""}`);
};

const all = (s: RelationalState): ResolvedEntry[] => [...s.slots, ...s.overflow];
const hasSeam = (e: ResolvedEntry) => typeof e.claimHead === "string" && typeof e.claimTail === "string";

/** The key an entry RENDERS, if it renders one — the same precedence `attachEchoAnnotations` uses. */
function hostKeyOf(e: ResolvedEntry): string | null {
  if (e.entryId.startsWith("UD1:")) return e.entryId.slice("UD1:".length);
  if (e.entryId === "UO6") {
    const k = e.arithmetic?.__hostKey;
    return typeof k === "string" ? k : null;
  }
  if (e.family === "ELEVATED") return e.entryId.slice("ELEVATED:".length);
  return null;
}
const echoKeyOf = (e: ResolvedEntry): string | null => {
  const k = e.arithmetic?.__echoKey;
  return e.family === "UE" && typeof k === "string" ? k : null;
};

function checkCard(label: string, s: RelationalState): void {
  const entries = all(s);
  const slotIds = new Set(s.slots.map((e) => e.entryId));

  // ── 1 · THE LEAD ────────────────────────────────────────────────────────────────────────────────
  ok(`${label} · leadEntryId is a slot`, s.leadEntryId !== null && slotIds.has(s.leadEntryId), String(s.leadEntryId));
  const expectedLead =
    s.slots.find((e) => e.weight.ladderRung <= URGENT_RUNG_CEILING)?.entryId ?? s.slots[0]?.entryId ?? null;
  ok(`${label} · lead is the first urgent slot, else slot 1`, s.leadEntryId === expectedLead,
    `got ${s.leadEntryId}, expected ${expectedLead}`);
  // The boundary contract the card already relied on — restated here because the card now renders both.
  ok(`${label} · boundaryEntryId is a slot`, s.boundaryEntryId !== null && slotIds.has(s.boundaryEntryId),
    String(s.boundaryEntryId));

  // ── 2 · FLOOR RANK ──────────────────────────────────────────────────────────────────────────────
  const ranked = s.slots.filter((e) => e.floorRank != null);
  ok(`${label} · floor entries lead the slots, contiguously from 0`,
    ranked.every((e, i) => e.floorRank === i && s.slots[i]?.entryId === e.entryId),
    ranked.map((e) => `${e.entryId}@${e.floorRank}`).join(" "));
  ok(`${label} · no overflow entry carries a floor rank`,
    s.overflow.every((e) => e.floorRank == null),
    s.overflow.filter((e) => e.floorRank != null).map((e) => e.entryId).join(" "));

  // ── 3 · LADDER ORDER ─────────────────────────────────────────────────────────────────────────────
  // ⚠ RE-DERIVED for fill-if-room (arbitration.ts). The invariant used to be ONE continuous sequence,
  // non-decreasing across slots++overflow. That is no longer what the mechanism promises: fill-if-room's
  // own rule is "real content always wins a contested SLOT over an honest-null, even at a worse rung" —
  // confirmed live (BANDHANBNK: UO1@14 correctly wins the last slot over UG5@13, a HONEST_NULL_SLOTS
  // member, putting a LOWER rung behind a HIGHER one across the seam). Asserting strict monotonicity
  // across the whole sequence would be asserting the mechanism away, the same class of error this file's
  // own header warns against (an assertion written against behaviour would have hidden this by hardening
  // itself around whatever the code did; the fix here is describing what's ACTUALLY guaranteed instead).
  //
  // What IS still guaranteed, and is what this now checks: `slots` alone is non-decreasing by rung
  // (excluding floor), and `overflow` alone is non-decreasing by rung — each array is internally honest
  // about its own order. Only the SEAM between them is no longer required to be monotonic, and only
  // because an honest-null legitimately lost a slot to real content there.
  const slotsTail = s.slots.filter((e) => e.floorRank == null);
  ok(`${label} · slots' non-floor run is non-decreasing in rung`,
    slotsTail.every((e, i) => i === 0 || slotsTail[i - 1].weight.ladderRung <= e.weight.ladderRung),
    slotsTail.map((e) => `${e.entryId}@${e.weight.ladderRung}`).join(" "));
  ok(`${label} · overflow is non-decreasing in rung`,
    s.overflow.every((e, i) => i === 0 || s.overflow[i - 1].weight.ladderRung <= e.weight.ladderRung),
    s.overflow.map((e) => `${e.entryId}@${e.weight.ladderRung}`).join(" "));
  // The seam CAN invert, but only in the one direction fill-if-room permits: an overflow entry that
  // sorts ahead of a slot's tail must be a HONEST_NULL_SLOTS member (real content is never displaced).
  const slotsTailWorst = slotsTail.at(-1)?.weight.ladderRung ?? -Infinity;
  const seamOffenders = s.overflow.filter((e) => e.weight.ladderRung < slotsTailWorst && !HONEST_NULL_SLOTS.has(e.entryId as EntrySlot));
  ok(`${label} · any seam inversion is an honest-null, never real content`, seamOffenders.length === 0,
    seamOffenders.map((e) => `${e.entryId}@${e.weight.ladderRung}`).join(" "));
  ok(`${label} · every floor entry precedes every non-floor entry`,
    entries.findIndex((e) => e.floorRank == null) === -1 ||
      entries.slice(entries.findIndex((e) => e.floorRank == null)).every((e) => e.floorRank == null));
  ok(`${label} · no entryId appears twice`, new Set(entries.map((e) => e.entryId)).size === entries.length);

  // ── 4 · NO CLAIM TWICE, AND NONE A PREFIX OF ANOTHER ────────────────────────────────────────────
  const claims = entries.map((e) => e.claim);
  ok(`${label} · no claim appears twice`, new Set(claims).size === claims.length,
    claims.filter((c, i) => claims.indexOf(c) !== i).join(" | ").slice(0, 120));
  const prefixed = entries.filter((a) =>
    entries.some((b) => b !== a && b.claim.length > a.claim.length && b.claim.startsWith(a.claim)));
  ok(`${label} · no claim is a strict prefix of another`, prefixed.length === 0,
    prefixed.map((e) => e.entryId).join(" "));

  // ── 5 · THE SEAM REASSEMBLES ────────────────────────────────────────────────────────────────────
  for (const e of entries) {
    if (!hasSeam(e)) continue;
    ok(`${label} · ${e.entryId} claim === head + " " + tail`,
      e.claim === `${e.claimHead} ${e.claimTail}`,
      `head=${JSON.stringify(e.claimHead?.slice(-40))} tail=${JSON.stringify(e.claimTail?.slice(0, 40))}`);
    ok(`${label} · ${e.entryId} both halves are non-empty`,
      (e.claimHead ?? "").trim().length > 0 && (e.claimTail ?? "").trim().length > 0);
  }

  // ── 6 · ECHO IS AN ANNOTATION, NEVER A SECOND COPY ──────────────────────────────────────────────
  const hostKeys = new Set(entries.map(hostKeyOf).filter((k): k is string => k !== null));
  for (const e of entries) {
    const k = echoKeyOf(e);
    if (k === null) continue;
    ok(`${label} · standing echo ${e.entryId} has no host on the card`, !hostKeys.has(k), `key ${k}`);
  }
  // A host that absorbed an echo must carry the seam — that is what the card renders the counts from.
  // ⚠ THE MARKER IS `__arithmeticOnlyClaim`, NOT `__echoKey`. Only the echo builder writes the former,
  // so it reaches a non-UE entry exactly by absorption. `__echoKey` is not diagnostic: buildUD1 stamps
  // it on every UD1 entry as that entry's OWN pattern key (entries.ts), a different role under the
  // same name — reading it here would flag two live UD1 entries that never touched an echo.
  for (const e of entries) {
    if (e.family === "UE" || e.arithmetic?.__arithmeticOnlyClaim === undefined) continue;
    ok(`${label} · host ${e.entryId} that absorbed an echo publishes the seam`, hasSeam(e));
  }

  // ── 7 · THE MODE CONTRACT (new) ─────────────────────────────────────────────────────────────────
  // A real-data trip-wire for contract/implementation drift — no new queries, reads only what already
  // resolved. Deliberately an ASSERTION here (not printed like the mode spread below): eligibility is a
  // closed set declared per mode, so "did today's data happen to need every slot" isn't at stake the way
  // "which modes occur" is — a resolved entry outside its mode's contract is unconditionally a bug.
  const baseSlotFor = (entryId: string): EntrySlot | string => {
    if (entryId.startsWith("ELEVATED:")) return "elevated";
    if (entryId.startsWith("UD")) return "UD";
    if (entryId.startsWith("UE")) return "UE";
    if (["UH1", "UH2", "UH3", "UH4", "UH10"].includes(entryId)) return "heldPositionFamily";
    return entryId;
  };
  const contract = MODE_CONTRACTS[s.mode];
  const offenders = entries
    .map((e) => e.entryId)
    .filter((id) => !contract.eligible.has(baseSlotFor(id) as EntrySlot));
  ok(`${label} · every resolved entry is eligible under its mode's contract (${s.mode})`, offenders.length === 0, offenders.join(", "));

  // Empty slots is legal only alongside a UD7 header (mode-contract.ts's ud7AwareFloor) — everywhere
  // else it is the guaranteed-resolve backstop firing, which service.ts already logs as a bug. Restated
  // here as a real-data assertion, not just a log line, since this file's whole purpose is catching on
  // live data what the synthetic fixtures cannot guarantee reaches production inputs.
  ok(`${label} · empty slots only alongside a UD7 header`, s.slots.length > 0 || s.header.entryId === "UD7", `mode=${s.mode} header=${s.header.entryId}`);
}

async function main() {
  const fixtureOut = process.argv[2] ?? null;

  const holdings = await prisma.$queryRaw<{ user_id: string; stock_id: string }[]>`
    SELECT DISTINCT user_id, stock_id FROM holdings WHERE quantity > 0 AND stock_id IS NOT NULL`;
  const watched = await prisma.$queryRaw<{ user_id: string; stock_id: string }[]>`
    SELECT DISTINCT user_id, stock_id FROM watchlist`;
  const symbols = await prisma.$queryRaw<{ id: string; symbol: string }[]>`SELECT id, symbol FROM stocks`;
  const symbolOf = new Map(symbols.map((r) => [r.id, r.symbol]));

  // ★ THE FIVE NAMED CASES are resolved for the reader with the deepest book — the same reader the
  //   design prototype drew. Named explicitly so the gate keeps covering them even if their holding
  //   or watchlist membership changes: a stock nobody holds is still a card somebody can open.
  const NAMED = ["CUMMINSIND", "360ONE", "YESBANK", "DIXON", "INFY"];
  const bookSize = new Map<string, number>();
  for (const h of holdings) bookSize.set(h.user_id, (bookSize.get(h.user_id) ?? 0) + 1);
  const primary = [...bookSize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const idOf = new Map(symbols.map((r) => [r.symbol, r.id]));

  const pairs: { userId: string | null; stockId: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (userId: string | null, stockId: string, tag: string) => {
    const k = `${userId ?? "anon"}::${stockId}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ userId, stockId, label: `${symbolOf.get(stockId) ?? stockId}/${tag}` });
  };
  if (primary) for (const sym of NAMED) { const id = idOf.get(sym); if (id) add(primary, id, "named"); }
  for (const h of holdings) add(h.user_id, h.stock_id, "held");
  for (const w of watched) add(w.user_id, w.stock_id, "watched");
  for (const stockId of new Set([...holdings, ...watched].map((h) => h.stock_id))) add(null, stockId, "anon");

  const fixture: { label: string; symbol: string; state: RelationalState }[] = [];
  for (const p of pairs) {
    const state = await resolveRelationalState(p.userId, p.stockId);
    if (!state) continue;
    checkCard(p.label, state);
    fixture.push({ label: p.label, symbol: symbolOf.get(p.stockId) ?? p.stockId, state });
  }

  // ── THE MODE SPREAD, printed rather than asserted: an assertion on which modes live data happens to
  //    reach would defend today's data, not the contract (the lesson of verify-relational-matrix). ──
  const modes = new Map<string, number>();
  for (const f of fixture) modes.set(f.state.mode, (modes.get(f.state.mode) ?? 0) + 1);

  if (fixtureOut) {
    writeFileSync(fixtureOut, JSON.stringify(fixture, null, 1));
    console.log(`fixture → ${fixtureOut}  (${fixture.length} cards)`);
  }
  console.log(`CARDS=${fixture.length}  ENTRIES=${fixture.reduce((n, f) => n + all(f.state).length, 0)}`);
  console.log(`MODES  ${[...modes].sort().map(([m, n]) => `${m}=${n}`).join(" ")}`);
  console.log(`ASSERTIONS  ${pass} passed, ${failures.length} failed`);
  for (const f of failures.slice(0, 40)) console.log(`  ✗ ${f}`);
  console.log(`\n${"═".repeat(72)}\nRELATIONAL LADDER — PAYLOAD CONTRACT ${failures.length === 0 ? "CLEAN" : "FAILED"}\n${"═".repeat(72)}`);
  await prisma.$disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
