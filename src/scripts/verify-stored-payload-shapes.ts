// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A RENDERER MUST TOLERATE EVERY PAYLOAD SHAPE WE HAVE EVER PERSISTED.
//
// ── ⚠ THE CRASH THIS EXISTS FOR ────────────────────────────────────────────────────────────────────
// `ownership-split.tsx` read `payload.pledge.state` with no guard. 190 of 350 persisted
// ownership-split payloads carry no `pledge` at all — they carry the `pledgedPctOfPromoter` it
// replaced — so opening ANY conversation containing one threw "Cannot read properties of undefined
// (reading 'state')" and took the whole transcript down with it. Not a degraded section: a blank page.
//
// ── ★ WHY THIS IS A GATE AND NOT A VERSION BUMP ───────────────────────────────────────────────────
// `SECTIONS_VERSION`'s own rule is that adding an optional field is NOT a version change, "because an
// old row simply lacks it and the renderer's own absent handling covers that, WHICH IT MUST HAVE
// ANYWAY". The policy is right and it rests entirely on that obligation being met. Nothing checked it.
// Bumping the version instead would be worse: `readEnvelope` refuses any row below the current version
// until an upgrade path is written, so every one of the 758 stored messages would degrade to prose.
//
// ── ★ WHAT IT ASSERTS ─────────────────────────────────────────────────────────────────────────────
// For every renderer, the set of payload keys that appear in SOME stored rows and not others. That set
// is the exact list of fields a renderer must treat as optional. New drift fails; known drift is
// allowlisted with the guard that covers it named, so the list is a record of checked cases rather
// than of ignored ones.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };

/** Drift that has been LOOKED AT, with how the renderer survives it. Adding a line here is a promise
 *  that someone opened the component and checked. */
const CHECKED: Record<string, string> = {
  "DECOMPOSITION:ownership-split.pledge": "guarded — `payload.pledge ? … : null`, the line is omitted",
  "DECOMPOSITION:ownership-split.pledgedPctOfPromoter": "the replaced field; nothing reads it any more",
  "DECOMPOSITION:waterfall.basis": "`payload.basis === 'shortfall'` — a comparison, undefined is false",
  "DECOMPOSITION:waterfall.groups": "only read inside the shortfall branch; 0 stored shortfall rows lack it",
  "DECOMPOSITION:waterfall.ceiling": "`payload.ceiling ?? 100`",
  "DECOMPOSITION:waterfall.residual": "only read when `!reconciles`; 0 stored shortfall rows lack it",
  "DECOMPOSITION:waterfall.walkNote": "rendered through ProseNote, which takes undefined",
  "DECOMPOSITION:waterfall.reconciles": "`!payload.reconciles` — undefined is falsy",
  "DECOMPOSITION:waterfall.redistributionNote": "`payload.redistributionNote && …`",
  "DECOMPOSITION:waterfall.redistributionReason": "not read by the component",
  "CALLOUT:nothing-found.setNote": "optional by contract, `??`-guarded",
  "CALLOUT:nothing-found.totalAvailable": "optional by contract, `??`-guarded",
  // ⚠ THESE TWO APPEARED THE MOMENT `CALLOUT : divergence` GOT A PRODUCER, and that is the gate
  //   earning its place. It was drawn-but-never-emitted for two phases, so it had no stored rows and
  //   nothing to drift; wiring it into orientation last batch started persisting payloads, and the
  //   next full run flagged both fields. Checked: `callout-section.tsx` declares them OPTIONAL
  //   (`setNote?`, `totalAvailable?`) and guards both on truthiness (lines 61, 72) — the same
  //   component and the same fields already recorded below for `nothing-found` and `largest-movers`.
  "CALLOUT:divergence.setNote": "guarded — `payload.setNote && <ProseNote>`; orientation passes no extra",
  "CALLOUT:divergence.totalAvailable": "guarded — `payload.totalAvailable && … > items.length`",
  "CALLOUT:largest-movers.setNote": "optional by contract, `??`-guarded",
  "CALLOUT:largest-movers.totalAvailable": "optional by contract, `??`-guarded",
  "SERIES:stepped-filing-line.unit": "`payload.unit ?? 'cr'`",
  "SERIES:stepped-filing-line.title": "`payload.title ?? …`",
  "SERIES:stepped-filing-line.stepNote": "`payload.stepNote ?? …`",
  "ANCHOR:set-table.heading": "`payload.heading ?? 'What matched'`",
};

async function main(): Promise<void> {
  console.log("★ STORED PAYLOAD SHAPES vs WHAT RENDERERS ASSUME\n");
  const rows = await prisma.$queryRawUnsafe<{ sections: unknown }[]>(
    `SELECT sections FROM chat_messages WHERE sections IS NOT NULL`);

  const seen = new Map<string, { n: number; keys: Map<string, number> }>();
  for (const r of rows) {
    const raw = r.sections as { sections?: unknown[] } | unknown[];
    const secs = Array.isArray(raw) ? raw : (raw?.sections ?? []);
    if (!Array.isArray(secs)) continue;
    for (const s of secs as { kind?: string; renderer?: string; payload?: object }[]) {
      if (!s?.renderer) continue;
      const id = `${s.kind}:${s.renderer}`;
      const e = seen.get(id) ?? { n: 0, keys: new Map<string, number>() };
      e.n++;
      for (const k of Object.keys(s.payload ?? {})) e.keys.set(k, (e.keys.get(k) ?? 0) + 1);
      seen.set(id, e);
    }
  }

  // ⚠ AN EMPTY CORPUS MUST NOT READ AS A PASS — the gate would be green on a fresh database while
  //   guarding nothing, which is the class this whole build keeps finding.
  ok("there are stored sections to check", seen.size > 0 && rows.length > 0,
    `${rows.length} message(s), ${seen.size} distinct renderer(s)`);

  const drift: string[] = [];
  for (const [id, e] of seen) for (const [k, c] of e.keys) if (c < e.n) drift.push(`${id}.${k}`);
  const fresh = drift.filter((d) => !(d in CHECKED));
  ok("every payload key that drifts has been checked against its renderer", fresh.length === 0,
    fresh.length
      ? `${fresh.join(", ")} — a renderer dereferencing one of these unguarded crashes the transcript. Open the component, guard it, then record the guard here.`
      : `${drift.length} drifting key(s), all recorded with the guard that covers them`);

  const stale = Object.keys(CHECKED).filter((k) => !drift.includes(k));
  ok("the checked list names only keys that still drift", stale.length === 0,
    stale.length ? `no longer drifting — remove: ${stale.join(", ")}` : `${Object.keys(CHECKED).length} entries, all still real`);

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
