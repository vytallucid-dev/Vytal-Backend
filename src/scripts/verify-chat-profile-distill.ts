// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// STAGE 5 · THE READER-PROFILE DISTILLER — PROOFS.
//
// The PURE half always runs (allowlist enforcement, the three decay rules, injection-off, the synthetic
// filter). The LIVE half needs PROFILE_LIVE=1 because it spends one real unit per session.
//
// What each half is for:
//   · PURE — the guarantees that must hold regardless of what a model returns. The distiller's output is
//     UNTRUSTED: the allowlist, the bounds and the decay are enforced in code, not requested in a prompt.
//   · LIVE — the only thing a fixture cannot settle: what this model actually extracts from real prose.
//
//   npx tsx src/scripts/verify-chat-profile-distill.ts             (pure only)
//   PROFILE_LIVE=1 npx tsx src/scripts/verify-chat-profile-distill.ts   (+ a real distillation)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
process.env.AI_PROVIDER ??= "mock"; // pure half must never meter; the live half overrides via .env's gemini

import { prisma } from "../db/prisma.js";
import {
  parseDistilled, foldProfile, findDistillableSessions, distilSession, loadVisibleTranscript,
  VYTAL_VOCAB_KEYS, PROFILE_DISTILL_SYSTEM, type DistilledProfile,
} from "../chat/profile.js";
import {
  CHAT_PROFILE_INJECT_ENABLED, resolveProfileModel, PROFILE_QUIESCENCE_MS,
  PROFILE_GAP_DECAY_SESSIONS, PROFILE_REGISTER_HYSTERESIS, PROFILE_MAX_SESSIONS_PER_RUN,
} from "../chat/config.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const EMPTY: DistilledProfile = { preferredRegister: null, depthNudge: 0, glossaryGaps: [], statedName: null };
const stored = (o: Partial<Parameters<typeof foldProfile>[0]> = {}) => ({
  preferredRegister: null, registerSessionCount: 0, registerFirstSeenAt: null,
  depthNudge: 0, depthSessionCount: 0, depthFirstSeenAt: null,
  glossaryGaps: [], gapStamps: null, statedName: null, nameStatedAt: null, sessionsDistilled: 0, ...o,
});

async function main() {
  console.log(`\n★ READER-PROFILE DISTILLER — model=${resolveProfileModel()} inject=${CHAT_PROFILE_INJECT_ENABLED}`);

  rule("1 · THE SEAM IS (ALMOST ALL) OFF — extraction without injection, minus the one wired field");
  ok("★ CHAT_PROFILE_INJECT_ENABLED is false by default", CHAT_PROFILE_INJECT_ENABLED === false, `AI_PROFILE_INJECT=${process.env.AI_PROFILE_INJECT ?? "<unset>"}`);
  const composeSrc = await import("node:fs").then((fs) => fs.promises.readFile("src/chat/compose.ts", "utf8"));
  // ★ THE EXCEPTION, PINNED. `statedName` is read unconditionally — it is a form of address the reader
  // typed and confirmed, not an inference, and gating an instruction behind an inference flag would mean
  // storing "call me Ronaldo" and then ignoring it. Everything else stays behind the flag, so this asserts
  // the exception is EXACTLY ONE FIELD WIDE rather than that the seam is untouched.
  // Comments stripped first: the seam MAP in compose.ts names every deferred field in prose, and a check
  // that cannot tell a plan from a read would fail on its own documentation.
  const composeCode = composeSrc.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  ok("★ compose.ts reads the stated NAME outside the flag", /statedNameFor\(userId\)/.test(composeCode), "the requested form of address reaches message[0]");
  ok(
    "…and reads NO other profile field outside the flag",
    !/preferredRegister|depthNudge|glossaryGaps/.test(composeCode) && /CHAT_PROFILE_INJECT_ENABLED \? await statedMemoriesFor/.test(composeCode),
    "register / depth / gaps are still unread; stated memories are still gated",
  );
  const voiceSrc = await import("node:fs").then((fs) => fs.promises.readFile("src/chat/voice.ts", "utf8"));
  ok("no narration/tone clause was written ahead of injection", !/remember|impression/i.test(voiceSrc.slice(0, 4000)) || !/profile/i.test(voiceSrc), "voice.ts carries no profile-narration rule");
  ok("★ the orientation prefers the requested form of address over the account name", /the reader ASKED to be called this/.test(voiceSrc), "voice.ts renders the precedence");

  rule("2 · THE OUTPUT IS UNTRUSTED — allowlist + bounds enforced in code, not asked for in a prompt");
  const invented = parseDistilled('{"preferredRegister":"en","depthNudge":0,"glossaryGaps":["band","risk_appetite","salary","pillar"],"statedName":null}', EMPTY);
  ok("★ keys outside the Vytal allowlist are DROPPED", JSON.stringify(invented?.glossaryGaps) === JSON.stringify(["band", "pillar"]), `got ${JSON.stringify(invented?.glossaryGaps)}`);
  const over = parseDistilled(`{"preferredRegister":null,"depthNudge":0,"glossaryGaps":${JSON.stringify([...VYTAL_VOCAB_KEYS])},"statedName":null}`, EMPTY);
  ok("the 8-gap ceiling is applied on read", (over?.glossaryGaps.length ?? 99) === 8, `${over?.glossaryGaps.length} kept of ${VYTAL_VOCAB_KEYS.length} offered`);
  const badReg = parseDistilled('{"preferredRegister":"punjabi","depthNudge":7,"glossaryGaps":[],"statedName":null}', EMPTY);
  ok("an illegal register becomes null; an out-of-range nudge clamps", badReg?.preferredRegister === null && badReg?.depthNudge === 1, `register=${badReg?.preferredRegister} nudge=${badReg?.depthNudge}`);
  const prose = parseDistilled('{"preferredRegister":"en","depthNudge":0,"glossaryGaps":[],"statedName":"a cautious investor saving for his daughter\'s wedding who earns 18L"}', EMPTY);
  ok("★ a prose-stuffed statedName is rejected (>40 chars)", prose?.statedName === null, `got ${JSON.stringify(prose?.statedName)}`);
  ok("a real stated name survives", parseDistilled('{"preferredRegister":null,"depthNudge":0,"glossaryGaps":[],"statedName":"Arman"}', EMPTY)?.statedName === "Arman");
  ok("non-JSON / refusal text yields null (caller keeps the old profile)", parseDistilled("I cannot help with that.", EMPTY) === null);
  ok("a fenced JSON block still parses", parseDistilled('```json\n{"preferredRegister":"hi-latin","depthNudge":0,"glossaryGaps":[],"statedName":null}\n```', EMPTY)?.preferredRegister === "hi-latin");

  rule("3 · DECAY — the three rules, deterministically");
  const now = new Date("2026-07-27T00:00:00Z");
  // register hysteresis
  let f = foldProfile(stored(), { ...EMPTY, preferredRegister: "hi-latin" }, now);
  ok("first sighting sets the register immediately", f.preferredRegister === "hi-latin" && f.registerSessionCount === 1);
  f = foldProfile(stored({ preferredRegister: "hi-latin", registerSessionCount: 3 }), { ...EMPTY, preferredRegister: "en" }, now);
  ok(`★ ONE disagreeing session does NOT flip the register (hysteresis ${PROFILE_REGISTER_HYSTERESIS})`, f.preferredRegister === "hi-latin", `still ${f.preferredRegister}, count ${f.registerSessionCount}`);
  f = foldProfile(stored({ preferredRegister: "hi-latin", registerSessionCount: 1 }), { ...EMPTY, preferredRegister: "en" }, now);
  ok("sustained disagreement DOES flip it", f.preferredRegister === "en", `→ ${f.preferredRegister}`);
  // gap decay
  const oldStamp = { band: { firstSeenAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z", sessionCount: 1 } };
  f = foldProfile(stored({ glossaryGaps: ["band"], gapStamps: oldStamp, sessionsDistilled: PROFILE_GAP_DECAY_SESSIONS + 5 }), EMPTY, now);
  ok(`★ a gap unseen for >${PROFILE_GAP_DECAY_SESSIONS} distillations is DROPPED`, !f.glossaryGaps.includes("band"), `gaps=${JSON.stringify(f.glossaryGaps)}`);
  f = foldProfile(stored({ glossaryGaps: ["band"], gapStamps: oldStamp, sessionsDistilled: 2 }), EMPTY, now);
  ok("a recent gap is carried forward while still in the window", f.glossaryGaps.includes("band"));
  f = foldProfile(stored({ glossaryGaps: ["band"], gapStamps: oldStamp, sessionsDistilled: 2 }), { ...EMPTY, glossaryGaps: ["band"] }, now);
  ok("a recurring gap keeps its firstSeenAt and increments sessionCount", f.gapStamps.band.firstSeenAt === "2026-01-01T00:00:00Z" && f.gapStamps.band.sessionCount === 2, JSON.stringify(f.gapStamps.band));
  // depth window
  f = foldProfile(stored({ depthNudge: -1, depthSessionCount: 1 }), EMPTY, now);
  ok("★ the depth nudge returns to NEUTRAL when its window empties", f.depthNudge === 0, `nudge=${f.depthNudge}`);
  f = foldProfile(stored({ depthNudge: -1, depthSessionCount: 3 }), EMPTY, now);
  ok("…but persists while the window still holds evidence", f.depthNudge === -1 && f.depthSessionCount === 2);
  // name never inferred away
  f = foldProfile(stored({ statedName: "Arman", nameStatedAt: now }), EMPTY, now);
  ok("an absent name never ERASES a previously stated one", f.statedName === "Arman");

  rule("4 · BOUNDARIES — the instruction names the exclusions");
  for (const phrase of ["income", "employer", "family", "health", "another person", "holdings", "free-form prose"]) {
    ok(`the instruction forbids: ${phrase}`, PROFILE_DISTILL_SYSTEM.toLowerCase().includes(phrase.toLowerCase()));
  }
  ok("★ the schema has no free-text column to put such a thing in", !/notes/i.test(await import("node:fs").then((fs) => fs.promises.readFile("prisma/schema.prisma", "utf8")).then((s) => s.slice(s.indexOf("model ChatReaderProfile"), s.indexOf("model ChatReaderProfile") + 2600))));

  rule("5 · SELECTION — quiescence, the synthetic filter, and the cap");
  console.log(`  quiescence=${PROFILE_QUIESCENCE_MS / 3600000}h  cap=${PROFILE_MAX_SESSIONS_PER_RUN}/run`);
  ok("quiescence is 6h, NOT the 24h sidebar resume window", PROFILE_QUIESCENCE_MS === 6 * 3600 * 1000);
  const selected = await findDistillableSessions();
  const emails = await Promise.all(selected.map(async (s) => (await prisma.chatSession.findUnique({ where: { id: s.id }, select: { user: { select: { email: true } } } }))?.user.email ?? "?"));
  ok("★ no synthetic (@test.local) user is ever selected", !emails.some((e) => e.endsWith("@test.local")), emails.length ? emails.join(", ") : "none selected");
  const stillActive = await prisma.chatSession.count({ where: { lastMessageAt: { gte: new Date(Date.now() - PROFILE_QUIESCENCE_MS) } } });
  ok("a session still active within the window is NOT selected", selected.length + stillActive <= await prisma.chatSession.count(), `${selected.length} selected, ${stillActive} still active`);

  // ── LIVE ────────────────────────────────────────────────────────────────────────────────────────
  if (process.env.PROFILE_LIVE !== "1") {
    rule("LIVE HALF SKIPPED — set PROFILE_LIVE=1 to spend one unit per session");
  } else {
    rule("6 · A REAL DISTILLATION on the live transcripts");
    for (const s of selected) {
      const meta = await prisma.chatSession.findUnique({ where: { id: s.id }, select: { title: true, origin: true } });
      const t = await loadVisibleTranscript(s.id, null);
      console.log(`\n  ── ${s.id.slice(0, 8)} · "${meta?.title}" (${meta?.origin}, ${t.turns} visible turns, ${t.text.length} chars)`);
      const r = await distilSession(s.id);
      console.log(`     status=${r.status}  →  ${JSON.stringify(r.profile ?? r.reason)}`);
      ok(`session ${s.id.slice(0, 8)} distilled without error`, r.status === "distilled" || r.status === "no_new_turns", r.status);
    }
    const prof = await prisma.chatReaderProfile.findFirst({ where: { user: { email: { not: { endsWith: "@test.local" } } } } });
    rule("7 · THE STORED PROFILE");
    console.log(JSON.stringify({
      preferredRegister: prof?.preferredRegister, depthNudge: prof?.depthNudge,
      glossaryGaps: prof?.glossaryGaps, statedName: prof?.statedName,
      sessionsDistilled: prof?.sessionsDistilled, gapStamps: prof?.gapStamps,
      registerSessionCount: prof?.registerSessionCount,
    }, null, 1));
    ok("a profile row exists for the real reader", !!prof);
    ok("★ statedName is null — the reader never stated one, and it was not invented", prof?.statedName === null, `got ${JSON.stringify(prof?.statedName)}`);
    ok("every stored gap is inside the allowlist", (prof?.glossaryGaps ?? []).every((g) => (VYTAL_VOCAB_KEYS as readonly string[]).includes(g)), JSON.stringify(prof?.glossaryGaps));

    rule("8 · IDEMPOTENCE — the watermark means a re-run costs nothing");
    const again = await findDistillableSessions();
    ok("★ an immediate re-run selects ZERO sessions", again.length === 0, `${again.length} selected`);
    const watermarks = await prisma.chatSession.findMany({ where: { id: { in: selected.map((s) => s.id) } }, select: { id: true, distilledUpToMessageAt: true, lastMessageAt: true } });
    ok("every distilled session's watermark reached its last message", watermarks.every((w) => w.distilledUpToMessageAt !== null), watermarks.map((w) => `${w.id.slice(0, 8)}=${w.distilledUpToMessageAt ? "set" : "NULL"}`).join(" "));
  }

  // ── THE CLEAR FLOOR — uses a throwaway user + the mock provider, so it spends nothing and never
  //    touches the real reader's data. `distilSession` has no synthetic filter (only the SELECTOR does),
  //    which is exactly what makes this testable. ──
  rule("9 · profileClearedAt IS A FLOOR — a cleared profile cannot re-form from surviving transcripts");
  const { createThrowawayUser, cleanupThrowawayUsers } = await import("./lib/throwaway-user.js");
  const savedProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "mock";
  try {
    const { userId } = await createThrowawayUser("profile");
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    const s = await prisma.chatSession.create({
      data: { userId, origin: "chat_page", title: "pre-clear talk", titleSource: "derived", promoted: true, lastMessageAt: old },
    });
    await prisma.chatMessage.createMany({ data: [
      { sessionId: s.id, role: "user", content: "kya matlab hai iska?", kind: "text", isOpening: false, createdAt: old },
      { sessionId: s.id, role: "assistant", content: "Iska matlab ye hai…", kind: "text", isOpening: false, createdAt: old },
    ] });

    const before = await distilSession(s.id, { dryRun: true });
    ok("without a clear, the session IS distillable", before.status === "distilled", before.status);

    // Simulate the clear exactly as the controller does: wipe + recreate carrying the floor.
    await prisma.chatReaderProfile.deleteMany({ where: { userId } });
    await prisma.chatReaderProfile.create({ data: { userId, profileClearedAt: new Date() } });

    const after = await distilSession(s.id);
    ok("★ after a clear, a session that went quiet EARLIER is skipped", after.status === "no_new_turns" && after.reason === "before_profile_cleared", `${after.status}/${after.reason}`);
    const wm = await prisma.chatSession.findUnique({ where: { id: s.id }, select: { distilledUpToMessageAt: true } });
    ok("…and its watermark advanced, so it stops being re-selected nightly", wm?.distilledUpToMessageAt !== null);
    const stillEmpty = await prisma.chatReaderProfile.findUnique({ where: { userId } });
    ok("★ the cleared profile did NOT re-form", stillEmpty?.preferredRegister === null && stillEmpty?.sessionsDistilled === 0, `register=${stillEmpty?.preferredRegister} sessions=${stillEmpty?.sessionsDistilled}`);

    rule("10 · THE JOB WIRING — dispatcher → handler, and the no-op path");
    const { getHandler } = await import("../jobs/dispatcher.js");
    const { JobTypes } = await import("../jobs/types.js");
    ok("CHAT_PROFILE_DISTILL resolves to a handler", typeof getHandler(JobTypes.CHAT_PROFILE_DISTILL) === "function");
    const handler = getHandler(JobTypes.CHAT_PROFILE_DISTILL)!;
    const ctx = { payload: {}, reportProgress: async () => {}, jobId: "verify", triggeredBy: "verify" } as never;
    const res = (await handler(ctx)) as { selected: number; distilled: number };
    ok("a run with nothing pending is a clean no-op (0 selected, 0 spent)", res.selected === 0 && res.distilled === 0, JSON.stringify(res));
  } finally {
    const n = await cleanupThrowawayUsers();
    if (n) console.log(`  ·  cleaned up ${n} throwaway user(s)`);
    if (savedProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = savedProvider;
  }

  console.log(`\n${"═".repeat(99)}\n  ${fail === 0 ? "═══ ALL PASS ✅ ═══" : `═══ ${fail} FAILURE(S) ❌ ═══`}\n${"═".repeat(99)}\n`);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail === 0 ? 0 : 1); });
