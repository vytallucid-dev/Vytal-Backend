// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 5 · THE READER-PROFILE DISTILLER — Layer 2, and the only layer.
//
// ★ LAYER 1 WAS CUT, AND THAT IS THE PREMISE OF THIS FILE. The original two-layer design had a cheap
// real-time dump feeding a later distillation. It predated chat persisting anything. Now every message
// is already in `chat_messages`, in order, and survives (chat_page is born promoted; discuss promotes on
// the first follow-up; the retention prune spares promoted). So the RAW LAYER IS THE TRANSCRIPT, and the
// only thing worth keeping from Layer 1's intent is a SELECTION RULE (below) — a query, not a table.
//
// ⚠ WHAT THE DISTILLER READS, AND WHY IT IS NOT "THE TRANSCRIPT". Visible turns only: kind='text', minus
// the server-composed opening. Measured on the live corpus: one session is 17,499 chars STORED against
// 181 chars VISIBLE, because the stored bulk is Vytal's own fact block plus tool JSON. Feeding the row
// set literally would cost ~15× and consist almost entirely of numbers about a STOCK. Handed message[0],
// a model will happily distil ABB's cash-conversion ratio into "this reader is interested in earnings
// quality". The fact block is not the reader.
//
// ★ REPLACE, NEVER APPEND. The model receives the current profile plus the new visible turns and returns
// the WHOLE new profile. That is what makes it a distillation rather than an accumulation, and it is the
// only shape in which "the beginner is no longer a beginner" can ever happen.
//
// ── THE ASYMMETRY THAT SETS THE INSTRUCTION ────────────────────────────────────────────────────────
// REMOVAL MUST BE CHEAPER THAN ADDITION. A wrong "prefers plain" degrades every future answer for weeks;
// a missing one costs a default that was already fine. So the instruction says DROP ON DOUBT, ADD ON
// REPETITION — the same posture as the guardrail's default-to-refuted, for the same reason.
//
// ── BOUNDARIES ─────────────────────────────────────────────────────────────────────────────────────
// The scope is "how to explain to this reader", enforced twice: the SCHEMA cannot represent anything else
// (no free-text column exists — see the migration header), and the instruction below states the exclusions
// in words so the model is never invited to try. Never extracted, never offered as a category: personal
// financial circumstance (income, employment, family, health, goals), anything about a third party, and
// any number about the reader's book — holdings and weights are computed LIVE and injected per session,
// so a stored copy would be a stale copy of a live financial number.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { resolveChatProvider } from "./engine.js";
import { spendFor, servedByMock } from "../ai/spend.js";
import { recordAiTokens, type Actor } from "../ai/quota.js";
import { resolveProfileModel, PROFILE_QUIESCENCE_MS, PROFILE_MAX_SESSIONS_PER_RUN, PROFILE_GAP_DECAY_SESSIONS, PROFILE_DEPTH_WINDOW_SESSIONS, PROFILE_REGISTER_HYSTERESIS } from "./config.js";

// ── THE VOCABULARY ALLOWLIST — the whole legal domain of `glossaryGaps`. ───────────────────────────
// Bounded BECAUSE Vytal's vocabulary is closed: four pillars, five bands, the lens/field machinery, the
// portfolio reads. A gap outside this list is dropped, not stored — which is what stops the field from
// becoming a free-text field by another name.
export const VYTAL_VOCAB_KEYS = [
  "band", "pillar", "foundation", "momentum", "market", "ownership",
  "health_score", "coverage", "provisional", "lens", "field_verdict",
  "finding", "red_flag", "pattern", "trajectory", "divergence",
  "peer_group", "construction", "health_read", "pledging",
] as const;
export type VytalVocabKey = (typeof VYTAL_VOCAB_KEYS)[number];
const VOCAB_SET = new Set<string>(VYTAL_VOCAB_KEYS);

export const READER_REGISTERS = ["en", "hi-latin", "devanagari", "mixed"] as const;
export type ReaderRegisterValue = (typeof READER_REGISTERS)[number];

/** What the model is asked to return, and the ONLY shape accepted back. */
export interface DistilledProfile {
  preferredRegister: ReaderRegisterValue | null;
  depthNudge: -1 | 0 | 1;
  glossaryGaps: string[];
  statedName: string | null;
}

interface GapStamp { firstSeenAt: string; lastSeenAt: string; sessionCount: number }
type GapStamps = Record<string, GapStamp>;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE INSTRUCTION. Authored English that ships in a prompt — kept in ONE reviewable place, like
// chat/voice.ts. A diff to what the distiller extracts is a diff to this constant.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const PROFILE_DISTILL_SYSTEM =
  "You maintain a tiny, strictly-bounded profile of how to EXPLAIN THINGS to one reader of Vytal, a " +
  "stock-health analytics product. You are given the profile as it stands and the visible turns of one " +
  "conversation that reader just had. You return the COMPLETE UPDATED PROFILE as JSON — a replacement, " +
  "not an addition. Output ONLY the JSON object, with no prose, preamble, or code fence.\n" +
  "\n" +
  "THE SHAPE, AND NOTHING ELSE:\n" +
  '{ "preferredRegister": "en" | "hi-latin" | "devanagari" | "mixed" | null,\n' +
  '  "depthNudge": -1 | 0 | 1,\n' +
  '  "glossaryGaps": string[],\n' +
  '  "statedName": string | null }\n' +
  "\n" +
  "WHAT EACH FIELD MEANS.\n" +
  "· preferredRegister — the language and script the reader WRITES IN. \"en\" plain English; \"hi-latin\" " +
  "Hindi written in Latin letters (Hinglish: \"mujhe ye batao\", \"kya iska matlab hai\"); \"devanagari\" " +
  "Hindi in Devanagari script; \"mixed\" only when they genuinely alternate within and across messages. " +
  "Judge from the READER's messages, never from the assistant's replies. null when you cannot tell.\n" +
  "· depthNudge — whether explanations should run SIMPLER (-1) or DENSER (+1) than the default for this " +
  "reader, or need no adjustment (0). Evidence for -1: they ask what a common term means, ask for a " +
  "concept to be restated, or say they did not follow. Evidence for +1: they use finance vocabulary " +
  "correctly and unprompted, ask about mechanism or construction, or skip past the basics. Absent clear " +
  "evidence the answer is 0.\n" +
  "· glossaryGaps — Vytal's OWN vocabulary this reader has shown they do not know yet, so it can be " +
  "glossed unprompted next time. Use ONLY these exact keys: " + VYTAL_VOCAB_KEYS.join(", ") + ". " +
  "A key belongs here only if the reader ASKED what it means or visibly misused it. Never add a key " +
  "because the topic merely came up. At most 8, most recent first.\n" +
  "· statedName — ONLY a form of address the reader asked for IN CONVERSATION that DIFFERS from the name " +
  "the assistant already has. The assistant is already told their name from their account, so recording " +
  "that again here is pointless. This field is for a correction or a preference: \"don't call me Arman " +
  "Shaikh, just Arman\", \"call me AK\". If they never asked for anything different, it is null — which " +
  "will almost always be the case. NEVER infer it from an email address, a signature, a greeting, or " +
  "anything else. Guessing here is worse than leaving it null. " +
  "⚠ ASKED-FOR IS NOT INFERRED, AND THE PROFILE YOU ARE GIVEN MAY ALREADY CARRY ONE. The reader can ask " +
  "the assistant directly to be called something, and that lands in this same field. If the profile you " +
  "were handed has a statedName, CARRY IT FORWARD UNCHANGED unless this conversation asks for a different " +
  "one. Never null it out because this conversation happens not to mention it — the ban is on DERIVING a " +
  "name, never on keeping one the reader gave.\n" +
  "\n" +
  "★ REMOVAL IS CHEAPER THAN ADDITION — DROP ON DOUBT, ADD ON REPETITION. A wrong entry shapes every " +
  "future answer this reader gets; a missing one just falls back to a sensible default. So when the " +
  "evidence is thin, ambiguous, or one-off, LEAVE THE FIELD AS IT WAS or clear it. Add or change " +
  "something only when this conversation genuinely shows it. Carry forward what the existing profile " +
  "already establishes unless this conversation contradicts it.\n" +
  "\n" +
  "★ WHAT IS NOISE, NOT SIGNAL. A momentary mood, irritation, or enthusiasm. A single throwaway question. " +
  "Which companies or sectors they asked about — Vytal already knows what they hold and watch, and a " +
  "second stale copy of it here would be worse than none. Anything true only in the moment.\n" +
  "\n" +
  "★ NEVER RECORD, UNDER ANY CIRCUMSTANCES — not in any field, not paraphrased, not abbreviated:\n" +
  "· the reader's personal or financial circumstances: income, salary, job, employer, family, marriage, " +
  "children, age, health, debts, savings goals, or what they are investing FOR. This is a financial " +
  "product; that class of detail must not exist in this record even when the reader volunteers it.\n" +
  "· anything about another person.\n" +
  "· any number or fact about the reader's holdings, portfolio value, position sizes or watchlist. Those " +
  "are computed fresh every session; a copy here would only ever be a stale wrong number.\n" +
  "· free-form prose about the reader in any field. If something matters but does not fit the four " +
  "fields above, it is out of scope — drop it.\n" +
  "\n" +
  "The entire purpose of this profile is HOW TO EXPLAIN THINGS TO THIS PERSON. Nothing else belongs.";

/** The per-session ask. Deliberately compact: the visible transcript is small (measured: 181–3,844
 *  chars per session in the live corpus), and the instruction above carries all the rules. */
export function buildDistillPrompt(current: DistilledProfile, transcript: string): string {
  return (
    `PROFILE AS IT STANDS:\n${JSON.stringify(current)}\n\n` +
    `THE READER'S CONVERSATION (visible turns only):\n${transcript}\n\n` +
    `Return the complete updated profile as JSON.`
  );
}

// ── SELECTION: the visible transcript, which is what Layer 1 would have stored. ────────────────────
/**
 * The reader-visible turns of one session, newer than `since` (the watermark). Excludes the
 * server-composed opening USER message (scaffolding carrying the fact block) and every internal tool
 * turn — the same filter `serializeVisibleMessages` applies for the client, for the same reason.
 * The assistant's opening IS included: it is prose the reader actually read.
 */
export async function loadVisibleTranscript(sessionId: string, since: Date | null): Promise<{ text: string; newestAt: Date | null; turns: number }> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      sessionId,
      kind: "text",
      NOT: { role: "user", isOpening: true },
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });
  if (!rows.length) return { text: "", newestAt: null, turns: 0 };
  const text = rows.map((r) => `${r.role === "user" ? "READER" : "ASSISTANT"}: ${r.content}`).join("\n\n");
  return { text, newestAt: rows[rows.length - 1].createdAt, turns: rows.length };
}

// ── VALIDATION: the model's output is untrusted; the schema's guarantees are re-enforced here. ─────
/** Parse + clamp a model reply into a DistilledProfile, or null if it is unusable. Never throws. */
export function parseDistilled(raw: string, fallback: DistilledProfile): DistilledProfile | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try { obj = JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const register = typeof o.preferredRegister === "string" && (READER_REGISTERS as readonly string[]).includes(o.preferredRegister)
    ? (o.preferredRegister as ReaderRegisterValue)
    : null;
  const nudgeRaw = typeof o.depthNudge === "number" ? Math.round(o.depthNudge) : 0;
  const depthNudge = (nudgeRaw > 0 ? 1 : nudgeRaw < 0 ? -1 : 0) as -1 | 0 | 1;
  // ★ THE ALLOWLIST IS APPLIED HERE, NOT TRUSTED. Anything the model invents is dropped silently — that
  // is the difference between a bounded field and a free-text field with a bounded-sounding name.
  const gaps = Array.isArray(o.glossaryGaps)
    ? [...new Set(o.glossaryGaps.filter((g): g is string => typeof g === "string" && VOCAB_SET.has(g)))].slice(0, 8)
    : fallback.glossaryGaps;
  const name = typeof o.statedName === "string" && o.statedName.trim() && o.statedName.trim().length <= 40
    ? o.statedName.trim()
    : null;
  return { preferredRegister: register, depthNudge, glossaryGaps: gaps, statedName: name };
}

// ── DECAY — via the stamps, with no second job. ────────────────────────────────────────────────────
/**
 * Fold one distillation into the stored profile, applying the three decay rules:
 *
 *  · REGISTER — last-seen-wins WITH HYSTERESIS. A change must be observed in PROFILE_REGISTER_HYSTERESIS
 *    consecutive sessions before it flips, so one Hinglish sentence does not relabel an English reader
 *    (and one English sentence does not undo a Hinglish one). The pending-flip count rides on
 *    registerSessionCount: agreement increments it, disagreement resets it to 1 against the NEW value.
 *  · GLOSSARY GAPS — a gap is dropped once it has not recurred within PROFILE_GAP_DECAY_SESSIONS
 *    distillations. Asked once, learned, gone. This is the rule that makes the field self-cleaning.
 *  · DEPTH NUDGE — recomputed from a WINDOW of the most recent sessions only, so evidence from months
 *    ago stops voting automatically rather than being averaged in forever.
 */
export function foldProfile(
  stored: {
    preferredRegister: string | null; registerSessionCount: number; registerFirstSeenAt: Date | null;
    depthNudge: number; depthSessionCount: number; depthFirstSeenAt: Date | null;
    glossaryGaps: string[]; gapStamps: unknown; statedName: string | null; nameStatedAt: Date | null;
    sessionsDistilled: number;
  },
  fresh: DistilledProfile,
  now: Date,
): {
  preferredRegister: string | null; registerFirstSeenAt: Date | null; registerLastSeenAt: Date | null; registerSessionCount: number;
  depthNudge: number; depthFirstSeenAt: Date | null; depthLastSeenAt: Date | null; depthSessionCount: number;
  glossaryGaps: string[]; gapStamps: GapStamps; statedName: string | null; nameStatedAt: Date | null;
  sessionsDistilled: number;
} {
  const iso = now.toISOString();
  const sessionsDistilled = stored.sessionsDistilled + 1;

  // ── REGISTER, with hysteresis ──
  let register = stored.preferredRegister;
  let registerCount = stored.registerSessionCount;
  let registerFirst = stored.registerFirstSeenAt;
  let registerLast: Date | null = stored.registerSessionCount ? now : null;
  if (fresh.preferredRegister) {
    if (register === null) {
      register = fresh.preferredRegister; registerCount = 1; registerFirst = now; registerLast = now;
    } else if (fresh.preferredRegister === register) {
      registerCount += 1; registerLast = now;
    } else {
      // Disagreement: count toward a flip, and only flip once the hysteresis threshold is met.
      registerCount = registerCount > 0 ? registerCount - 1 : 0;
      if (registerCount === 0) {
        register = fresh.preferredRegister; registerCount = PROFILE_REGISTER_HYSTERESIS - 1; registerFirst = now; registerLast = now;
      }
    }
  }

  // ── GAPS, with recurrence decay ──
  const prevStamps: GapStamps = (stored.gapStamps && typeof stored.gapStamps === "object" ? stored.gapStamps as GapStamps : {});
  const stamps: GapStamps = {};
  for (const key of fresh.glossaryGaps) {
    const prior = prevStamps[key];
    stamps[key] = prior
      ? { firstSeenAt: prior.firstSeenAt, lastSeenAt: iso, sessionCount: prior.sessionCount + 1 }
      : { firstSeenAt: iso, lastSeenAt: iso, sessionCount: 1 };
  }
  // Carry forward a stored gap the model did NOT re-report, but only while it is still inside the decay
  // window. `sessionsDistilled` is the clock: a gap last seen more than N distillations ago is dropped.
  for (const [key, stamp] of Object.entries(prevStamps)) {
    if (stamps[key]) continue;
    if (!VOCAB_SET.has(key)) continue;
    const ageSessions = sessionsDistilled - (stamp.sessionCount > 0 ? stamp.sessionCount : 0);
    const lastSeenMs = Date.parse(stamp.lastSeenAt);
    const staleBySessions = ageSessions > PROFILE_GAP_DECAY_SESSIONS;
    if (!staleBySessions && Number.isFinite(lastSeenMs)) stamps[key] = stamp;
  }
  const gaps = Object.entries(stamps)
    .sort((a, b) => Date.parse(b[1].lastSeenAt) - Date.parse(a[1].lastSeenAt))
    .slice(0, 8)
    .map(([k]) => k);
  const boundedStamps: GapStamps = {};
  for (const k of gaps) boundedStamps[k] = stamps[k];

  // ── DEPTH, windowed ──
  // Once the profile has more history than the window, an unchanged nudge simply persists; a NEW signal
  // replaces it outright rather than being averaged against evidence that has aged out.
  let depthNudge = stored.depthNudge;
  let depthFirst = stored.depthFirstSeenAt;
  let depthCount = stored.depthSessionCount;
  let depthLast: Date | null = stored.depthSessionCount ? now : null;
  if (fresh.depthNudge !== 0) {
    depthNudge = fresh.depthNudge;
    depthCount = fresh.depthNudge === stored.depthNudge ? Math.min(depthCount + 1, PROFILE_DEPTH_WINDOW_SESSIONS) : 1;
    depthFirst = fresh.depthNudge === stored.depthNudge ? (depthFirst ?? now) : now;
    depthLast = now;
  } else if (depthCount > 0) {
    // No evidence this session: the window ages. When it empties, the nudge returns to neutral.
    depthCount -= 1;
    if (depthCount === 0) { depthNudge = 0; depthFirst = null; depthLast = null; }
  }

  // ── NAME — only ever set from an explicit statement; never overwritten by an absence. ──
  const statedName = fresh.statedName ?? stored.statedName;
  const nameStatedAt = fresh.statedName && fresh.statedName !== stored.statedName ? now : stored.nameStatedAt;

  return {
    preferredRegister: register, registerFirstSeenAt: registerFirst, registerLastSeenAt: registerLast, registerSessionCount: registerCount,
    depthNudge, depthFirstSeenAt: depthFirst, depthLastSeenAt: depthLast, depthSessionCount: depthCount,
    glossaryGaps: gaps, gapStamps: boundedStamps, statedName, nameStatedAt,
    sessionsDistilled,
  };
}

const EMPTY: DistilledProfile = { preferredRegister: null, depthNudge: 0, glossaryGaps: [], statedName: null };

export interface DistillOneResult {
  sessionId: string;
  status: "distilled" | "no_new_turns" | "quota_denied" | "unusable_reply";
  turns: number;
  profile?: DistilledProfile;
  reason?: string;
}

/**
 * Distil ONE session into its owner's profile. Advances the watermark on every non-quota outcome,
 * including `unusable_reply` — otherwise a session the model cannot parse would be retried forever,
 * every night, at one unit a time.
 */
export async function distilSession(sessionId: string, opts: { dryRun?: boolean } = {}): Promise<DistillOneResult> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, lastMessageAt: true, distilledUpToMessageAt: true },
  });
  if (!session) return { sessionId, status: "no_new_turns", turns: 0, reason: "session_gone" };

  // ★★★ THE WATERMARK IS THE SESSION'S OWN lastMessageAt, NOT THE NEWEST VISIBLE TURN. ★★★
  //
  // ⚠ MEASURED BUG, caught by the idempotence proof. Setting the watermark from the newest VISIBLE message
  // looks right and is wrong: `findDistillableSessions` qualifies a session on
  // `distilled_up_to_message_at < last_message_at`, and `last_message_at` moves with turns of EVERY kind —
  // including the hidden opening scaffolding and every tool_call/tool_result. So a session whose newest row
  // is hidden (a `discuss` opening, or any tool-using turn) could never advance its watermark to its own
  // lastMessageAt, and would be re-selected and re-distilled EVERY NIGHT, one unit at a time, forever.
  //
  // Claiming `lastMessageAt` as-of NOW fixes it and stays correct for the returning-reader case: anything
  // that arrives after this instant has a later lastMessageAt, so the session re-qualifies exactly once
  // more, for exactly the new turns.
  const claimedAt = session.lastMessageAt;
  const advance = async () => {
    if (!opts.dryRun) {
      await prisma.chatSession.update({ where: { id: sessionId }, data: { distilledUpToMessageAt: claimedAt } });
    }
  };

  const existing = await prisma.chatReaderProfile.findUnique({ where: { userId: session.userId } });

  // ★ A CLEARED PROFILE DOES NOT RE-FORM. Sessions that went quiet before the clear are invisible to the
  // distiller forever, which is what makes "clear my data" mean what it says.
  if (existing?.profileClearedAt && session.lastMessageAt <= existing.profileClearedAt) {
    // Permanently below the clear floor. Advance anyway, so it stops being re-selected every night.
    await advance();
    return { sessionId, status: "no_new_turns", turns: 0, reason: "before_profile_cleared" };
  }

  const since = existing?.profileClearedAt && (!session.distilledUpToMessageAt || session.distilledUpToMessageAt < existing.profileClearedAt)
    ? existing.profileClearedAt
    : session.distilledUpToMessageAt;

  const { text, turns } = await loadVisibleTranscript(sessionId, since);
  if (!text.trim()) {
    // Only hidden turns (tool traffic / scaffolding) are new. Nothing to distil — but the watermark must
    // still advance or this session qualifies again tomorrow, and every night after that.
    await advance();
    return { sessionId, status: "no_new_turns", turns: 0 };
  }

  const current: DistilledProfile = existing
    ? {
        preferredRegister: (existing.preferredRegister as ReaderRegisterValue | null) ?? null,
        depthNudge: (existing.depthNudge > 0 ? 1 : existing.depthNudge < 0 ? -1 : 0),
        glossaryGaps: existing.glossaryGaps,
        statedName: existing.statedName,
      }
    : EMPTY;

  const model = resolveProfileModel();
  const actor: Actor = { kind: "system", job: "chat_profile_distill" };
  const decision = await spendFor(model, actor)();
  if (!decision.allowed) return { sessionId, status: "quota_denied", turns, reason: decision.reason };

  const provider = resolveChatProvider();
  const r = await provider.generate({
    model,
    system: PROFILE_DISTILL_SYSTEM,
    messages: [{ role: "user", content: buildDistillPrompt(current, text) }],
    maxTokens: 400,
    temperature: 0.1,
  });
  if (!servedByMock(r.usage)) await recordAiTokens(model, r.usage.promptTokens + r.usage.outputTokens);

  const fresh = parseDistilled(r.text, current);
  if (!fresh) {
    // Advance regardless: a transcript this model cannot parse will not become parseable tomorrow, and
    // retrying it nightly would burn a unit every night for the same failure.
    await advance();
    return { sessionId, status: "unusable_reply", turns, reason: r.text.slice(0, 120) };
  }

  if (opts.dryRun) return { sessionId, status: "distilled", turns, profile: fresh };

  const folded = foldProfile(
    {
      preferredRegister: existing?.preferredRegister ?? null,
      registerSessionCount: existing?.registerSessionCount ?? 0,
      registerFirstSeenAt: existing?.registerFirstSeenAt ?? null,
      depthNudge: existing?.depthNudge ?? 0,
      depthSessionCount: existing?.depthSessionCount ?? 0,
      depthFirstSeenAt: existing?.depthFirstSeenAt ?? null,
      glossaryGaps: existing?.glossaryGaps ?? [],
      gapStamps: existing?.gapStamps ?? null,
      statedName: existing?.statedName ?? null,
      nameStatedAt: existing?.nameStatedAt ?? null,
      sessionsDistilled: existing?.sessionsDistilled ?? 0,
    },
    fresh,
    new Date(),
  );

  await prisma.$transaction([
    prisma.chatReaderProfile.upsert({
      where: { userId: session.userId },
      // gapStamps is a Record, which Prisma's InputJsonValue does not structurally accept without a cast.
      create: { userId: session.userId, ...folded, gapStamps: folded.gapStamps as unknown as Prisma.InputJsonValue },
      update: { ...folded, gapStamps: folded.gapStamps as unknown as Prisma.InputJsonValue },
    }),
    prisma.chatSession.update({ where: { id: sessionId }, data: { distilledUpToMessageAt: claimedAt } }),
  ]);

  return { sessionId, status: "distilled", turns, profile: fresh };
}

/**
 * The nightly sweep's session set: QUIET sessions with unseen turns, belonging to non-synthetic users.
 *
 * ⚠ QUIESCENCE IS 6h, NOT 24h, DELIBERATELY. 24h is the SIDEBAR RESUME WINDOW and already means
 * something specific (sessions.ts §"TWO CLOCKS"); reusing the number would load a third meaning onto one
 * clock. Six hours means "the reader has gone away" for a product used around market hours. A session
 * still in progress is simply not picked up tonight — it is picked up tomorrow, and the watermark means
 * that costs nothing extra.
 */
export async function findDistillableSessions(now: Date = new Date()): Promise<{ id: string }[]> {
  const cutoff = new Date(now.getTime() - PROFILE_QUIESCENCE_MS);
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT s.id
    FROM chat_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.last_message_at < ${cutoff}
      AND (s.distilled_up_to_message_at IS NULL OR s.distilled_up_to_message_at < s.last_message_at)
      AND u.email NOT LIKE '%@test.local'
    ORDER BY s.last_message_at ASC
    LIMIT ${PROFILE_MAX_SESSIONS_PER_RUN}
  `;
}
