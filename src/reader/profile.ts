// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER PROFILE — what we know about the person asking, for the composer. Stage 6.
//
// ── ★ WHY THIS FILE EXISTS, AND WHAT IT CORRECTS ──────────────────────────────────────────────────
// `ChatReaderProfile` carries the reader's stated name, their preferred register, a learned depth
// nudge, their glossary gaps and up to 30 things they explicitly asked to be remembered. Until now it
// had exactly ONE reader in the codebase — `src/chat/memory.ts`, which is DELETE — and the composer
// called `resolveTone(null, null)`, a hardcoded balanced default. So every stored preference reached
// nothing, and the table would have survived the stage-5 deletion with no code able to read it.
//
// ⚠ THE MISCATEGORISATION IS THE POINT. This looked like write capability because the tools that
// populate it are writes. The half the composer needs is a READ, and it is the half that makes an
// answer sound like it is addressed to someone. Filing it with the writes deferred it behind a
// safety question it never posed.
//
// ── ★ EXTRACTED, NOT COPIED (§8.2) ────────────────────────────────────────────────────────────────
// `statedMemoriesFor` and `statedNameFor` MOVED here from `chat/memory.ts`, which now imports them
// back. Nothing is duplicated, so N-3 holds: there is one implementation, and when the chat tree dies
// its import disappears rather than a second copy.
//
// ── ★ WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────────
// Writing. Adding, forgetting and distilling stay where they are until they have a home under the
// action path (§5.4). This file only reads.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { resolveTone, type ToneDirective } from "../ai/tone.js";

export interface ReaderProfile {
  readonly userId: string;
  /** ONLY if the reader explicitly said so ("call me Arman"). Never inferred — see the schema note. */
  readonly statedName: string | null;
  /** What the reader asked to be remembered, newest last. Bounded at 30 by a DB CHECK. */
  readonly statedMemories: readonly string[];
  /** Vytal vocabulary the reader has shown they do not know. Drives glossing, not wording. */
  readonly glossaryGaps: readonly string[];
  /** Resolved from the two ONBOARDING rows. `aiLevel` is sovereign — see tone.ts's header. */
  readonly tone: ToneDirective;
}

/** The tone every unauthenticated or unknown reader gets. Named so "no reader" is one object. */
export const DEFAULT_TONE: ToneDirective = resolveTone(null, null);

export const ANONYMOUS: ReaderProfile = {
  userId: "", statedName: null, statedMemories: [], glossaryGaps: [], tone: DEFAULT_TONE,
};

/**
 * Everything the composer may know about the reader, in one read.
 *
 * Fail-soft by construction: a missing profile row, a missing onboarding row or a DB error all
 * degrade to the balanced default rather than throwing. An answer with a plain voice is a small
 * loss; an answer that does not render is a total one.
 */
export async function loadReaderProfile(userId: string): Promise<ReaderProfile> {
  if (!userId) return ANONYMOUS;
  try {
    const [profile, register, ledger] = await Promise.all([
      prisma.chatReaderProfile.findUnique({
        where: { userId },
        select: { statedName: true, statedMemories: true, glossaryGaps: true },
      }),
      prisma.userRegister.findUnique({ where: { userId } }),
      prisma.userLedger.findUnique({ where: { userId } }),
    ]);
    return {
      userId,
      statedName: profile?.statedName ?? null,
      statedMemories: parseStatedMemories(profile?.statedMemories),
      glossaryGaps: profile?.glossaryGaps ?? [],
      tone: resolveTone(register, ledger),
    };
  } catch (err) {
    console.warn(`[reader/profile] load failed for ${userId}, using defaults: ${(err as Error).message}`);
    return { ...ANONYMOUS, userId };
  }
}

/**
 * The stored memories as plain sentences.
 *
 * ⚠ THE COLUMN IS JSON AND MAY HOLD ANYTHING A PAST WRITER PUT THERE. Every row is checked for the
 * one field this reader uses and anything else is dropped silently — a malformed entry must not take
 * the whole answer down, and it must not reach a reader as `[object Object]` either.
 */
function parseStatedMemories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const t = (r as { text?: unknown } | null)?.text;
    if (typeof t === "string" && t.trim()) out.push(t.trim());
  }
  return out;
}

/** MOVED FROM `chat/memory.ts` (§8.2 extraction) — the sentences, for prompt or copy assembly. */
export async function statedMemoriesFor(userId: string): Promise<string[]> {
  const p = await prisma.chatReaderProfile
    .findUnique({ where: { userId }, select: { statedMemories: true } })
    .catch(() => null);
  return parseStatedMemories(p?.statedMemories);
}

/** MOVED FROM `chat/memory.ts` (§8.2 extraction) — the form of address the reader typed. */
export async function statedNameFor(userId: string): Promise<string | null> {
  const p = await prisma.chatReaderProfile
    .findUnique({ where: { userId }, select: { statedName: true } })
    .catch(() => null);
  return p?.statedName ?? null;
}

/**
 * How to address the reader in an opening sentence, or `null` to open without a name.
 *
 * ⚠ `null` IS THE COMMON CASE AND MUST STAY COMFORTABLE. A name is used only when the reader typed
 * one; guessing one from an email or an account field would be the inference this column exists to
 * refuse. Copy that reads badly without a name is copy that has to change, not a reason to invent one.
 */
export const addressFor = (p: ReaderProfile): string | null => p.statedName?.trim() || null;
