// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPENING COMPOSER — assembles the carried context for a session.
//
// ★ THE RULING: the subject fact block, the reader-orientation header, and (for a stock) the relationship
// block ALL ride in the OPENING USER MESSAGE (message[0]), so they are carried through the conversation
// via full-history resend — the SAME mechanism as the subject grounding, no re-grounding per turn. The
// system prompt (tone + context-layer + the personalization rule) is stable and re-resolved cheaply each
// turn (pure fn + two tiny indexed reads; NO portfolio view read on a follow-up).
//
// PLACEMENT INSIDE message[0]: [ fact block · orientation · relationship · ask ]. The fact block leads,
// carrying CLOSED_WORLD_HEADER at its top; everything after is BELOW that header, so the relationship's
// citable numbers (position weight, sector exposure, peers held, since-added delta) sit inside the
// closed-world scope exactly as intended. The `concept` surface has NO fact block and NO closed-world
// header — orientation + ask only — which is the branch that proves the rule.
//
// ⚠ composePrompt (ai/spend.ts) is deliberately NOT used here: it PREPENDS CLOSED_WORLD_HEADER, and the
// grounding fact block already embeds it — using it would double the header, and it is outright wrong for
// the header-less concept branch. We compose message[0] directly (the approved decision).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { resolveToneForUser } from "../ai/tone.js";
import { groundStockHealth, groundPortfolioHealth, CLOSED_WORLD_HEADER } from "../ai/grounding.js";
import { groundStockRelationship, probeStockRelationship } from "../ai/insight/relationship.js";
import { buildPortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";
import type { PortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";
import { buildSystemPrompt, buildOrientationHeader, buildCurrentTurnLanguageDirective, detectReaderRegister, CHAT_PAGE_OPENING_BOUNDARY } from "./voice.js";
import { resolveOpening, type GroundingKind } from "./openings.js";
import type { DiscussContext, DiscussSubject } from "./discuss-context.js";
import { resolveChatModel, CHAT_PROFILE_INJECT_ENABLED } from "./config.js";
import { statedMemoriesFor, statedNameFor } from "./memory.js";

/** Everything the caller needs to run + persist the opening turn and create the session row. */
export interface OpeningComposition {
  system: string;
  /** message[0] — the carried context (fact block + orientation + relationship + ask). Persisted isOpening. */
  openingUserContent: string;
  /** The DISPLAY twin of message[0] — the one line the reader sees themselves say. Persisted alongside it
   *  as `display_content`; NEVER sent to the model (loadHistoryForModel reads `content`). */
  openingDisplayContent: string;
  model: string;
  subjectKind: string | null;
  subjectSymbol: string | null;
  subjectName: string | null;
  asOfSnapshot: string | null;
  /** Human label for the Layer-3 redirect + the derived title. */
  subjectLabel: string;
  surfaceKey: string;
  grounding: GroundingKind;
  derivedTitle: string;
}

/** Canonical subject symbol for the session row AND the resume lookup (they MUST agree). A single stock →
 *  its uppercase ticker; a comparison → its tickers uppercased + sorted + joined; else null. */
export function canonicalSubjectSymbol(subject: DiscussSubject): string | null {
  if (subject.symbol) return subject.symbol.toUpperCase();
  if (subject.symbols && subject.symbols.length) return [...subject.symbols].map((s) => s.toUpperCase()).sort().join(",");
  return null;
}

/** Compact provenance string for honest replay ("as-of 2026-03-31 · FY26Q4 · quarterly"). */
function formatAsOf(sources: { asOfDate: string | null; periodKey?: string; snapshotType?: string; constantVersion?: string }): string | null {
  const parts: string[] = [];
  if (sources.asOfDate) parts.push(`as-of ${sources.asOfDate}`);
  if (sources.periodKey) parts.push(sources.periodKey);
  if (sources.snapshotType) parts.push(sources.snapshotType);
  if (sources.constantVersion) parts.push(sources.constantVersion);
  return parts.length ? parts.join(" · ") : null;
}

// ── ⚠ DEFERRED SEAM #2 — THE CHAT READER PROFILE (Stage 5, ONE FIELD WIRED, THE REST DEFERRED) ─────
//
// `chat_reader_profile` exists and the nightly CHAT_PROFILE_DISTILL job is populating it. The INFERRED
// fields are still unread, deliberately: extraction and injection are decoupled so the profiles that
// actually form can be read before deciding what deserves to reach an answer (chat/config.ts
// CHAT_PROFILE_INJECT_ENABLED, default OFF). This comment is the map for when that flips.
//
// ★ THE ONE EXCEPTION ALREADY SHIPPED: `statedName`. It is read unconditionally by `readOrientation`
// below, outside the flag, because it is not an inference — it is a form of address the reader typed and
// confirmed. See chat/memory.ts §statedNameFor for the full argument.
//
// ★ IT ATTACHES HERE — `readOrientation` — AND NOT IN THE SYSTEM PROMPT. The orientation block rides in
// the OPENING USER MESSAGE (message[0]) and is carried through the conversation by full-history resend, so
// it is paid for ONCE PER SESSION. `resolveTurnSystem` below re-resolves the system prompt on EVERY turn,
// so a profile placed there would be paid on every message of every conversation forever. That difference
// decides it. Budget when it lands: ≤60 rendered tokens, against this header's current ~40.
//
// TWO EXCEPTIONS to "it all goes in the orientation":
//   · `depthNudge` belongs in ai/tone.ts as a THIRD input to resolveTone, beside register and ledger, and
//     clamped by the same LEVEL_SPEC bounds. It is not a fact to read out; it is a phrasing axis, and
//     tone.ts is where the axes live AND where aiLevel's sovereignty is enforced — so routing it there
//     keeps "the reader's stated level wins" true for free.
//   · `statedName` is a form of address, not context to reason from — so it joins the NAME clause of the
//     orientation rather than a "what we know about you" clause, and it OUTRANKS the account name there.
//     (SHIPPED — see the exception above.)
//
// ⚠ CONSEQUENCE TO ACCEPT: message[0] is written at session creation and never updated, so a profile
// change mid-session does not apply until the NEXT session. That is correct — the profile is a
// between-sessions artifact — and it matches how asOfSnapshot freezes provenance.
//
// ⚠ AND THE TONE RULE SHIPS WITH THE INJECTION, NOT BEFORE IT. Nothing may be injected until the
// accompanying voice guidance exists in chat/voice.ts. A memory that reaches a reply without a rule for
// how to speak about it is the failure mode that makes memory features feel hostile.
//
// ── ⚠ DEFERRED SEAM #1 — behaviour rollup (Stage 5 / ruling addition #4) ────────────────────────────
// The reader's behavioural signal (dwell, attention, tab/section focus) lives in `behavior_rollup`
// (behaviour-tracking Phase 1). It is populating but has nothing meaningful yet, so it is DELIBERATELY
// NOT wired. When it does: read the (userId, stockId) rollup here and fold a COARSE, non-narratable hint
// into the orientation (e.g. "the reader has spent real time on this name" → lean less introductory) —
// NEVER a fact to voice back ("you viewed this six times" is banned, see CHAT_USE_DONT_NARRATE). Attach it
// to `readOrientation` below; the rest of the pipeline needs no change because orientation already rides
// in message[0] and is carried via history.

/** The orientation header — reads has-holdings + coverage once. Reuses a prebuilt portfolio view when the
 *  caller already has one (a portfolio session), else does one cheap read. Fail-soft: any error → a
 *  no-book orientation (honest: "no portfolio tracked"). */
async function readOrientation(userId: string, toneLevel: "plain" | "balanced" | "technical", prebuilt?: PortfolioHealthView): Promise<string> {
  // ── THE TWO NAMES, BOTH OUTSIDE THE FLAG. ────────────────────────────────────────────────────────
  // `displayName` is the account name (user_ledger.display_name); `statedName` is a form of address the
  // reader asked for in conversation and confirmed (chat/memory.ts §"THE SELF-NAMING CARVE-OUT").
  //
  // ★ NEITHER IS BEHIND `AI_PROFILE_INJECT`, and the reason is the same for both: that flag gates what was
  // INFERRED about the reader, and neither of these was inferred. One is what they typed into onboarding,
  // the other is what they typed into the chat. Gating an explicit instruction behind an inference switch
  // would mean "call me Ronaldo" being stored, confirmed, and then ignored.
  // Read together, fail-soft: a missing name simply omits the clause and must never block the opening.
  const [displayName, statedName] = await Promise.all([readDisplayName(userId), statedNameFor(userId)]);
  // ★ BEHIND AI_PROFILE_INJECT, exactly like the distilled profile. Off ⇒ not even read, so the flag is a
  // real switch and not a filter applied after the fact.
  const statedMemories = CHAT_PROFILE_INJECT_ENABLED ? await statedMemoriesFor(userId).catch(() => []) : [];
  try {
    const pv = prebuilt ?? (await buildPortfolioHealthView(userId));
    const coverage = pv.snapshot?.coverageState?.scoredWeight ?? null;
    return buildOrientationHeader({ hasHoldings: pv.hasHoldings, coverage, toneLevel, displayName, statedName, statedMemories });
  } catch (err) {
    console.warn(`[chat/compose] orientation read failed for ${userId} — degrading to no-book: ${(err as Error).message}`);
    return buildOrientationHeader({ hasHoldings: false, coverage: null, toneLevel, displayName, statedName, statedMemories });
  }
}

/** `user_ledger.display_name`, trimmed and length-clamped, or null. One indexed unique lookup; never throws.
 *  Clamped because it is reader-supplied text that ends up inside a prompt — a 400-char "name" is either a
 *  mistake or an injection attempt, and neither belongs in message[0]. */
async function readDisplayName(userId: string): Promise<string | null> {
  try {
    const row = await prisma.userLedger.findUnique({ where: { userId }, select: { displayName: true } });
    const n = row?.displayName?.trim();
    return n && n.length > 0 && n.length <= 40 ? n : null;
  } catch {
    return null;
  }
}

const joinBlocks = (blocks: (string | null | undefined)[]): string => blocks.filter((b) => b && b.trim()).join("\n\n");

/**
 * Compose the opening for a DISCUSS session (from a card's DiscussContext). Resolves tone, loads the
 * subject grounding by surface, attaches the reader's orientation + (for a stock) relationship, and builds
 * the surface's opening ask. Fail-soft throughout: a missing snapshot / degraded relationship never breaks
 * the compose — it renders honest-empty and the conversation still opens.
 */
export async function composeDiscussOpening(userId: string, ctx: DiscussContext): Promise<OpeningComposition> {
  const resolved = resolveOpening(ctx);
  const model = resolveChatModel();
  const tone = await resolveToneForUser(userId);
  const system = buildSystemPrompt(tone.systemDirective);

  const subjectSymbol = canonicalSubjectSymbol(ctx.subject);
  const ask = resolved.spec.buildAsk(ctx, resolved.subjectLabel);

  let factBlock = "";
  let relationshipBlock = "";
  let orientation = "";
  let asOfSnapshot: string | null = null;
  let subjectName: string | null = ctx.subject.name ?? null;

  if (resolved.spec.grounding === "stock") {
    const symbol = ctx.subject.symbol;
    if (!symbol) {
      // A stock surface with no symbol — malformed, but never crash: open with an honest note.
      factBlock = `=== FACTS ===\n${CLOSED_WORLD_HEADER}\nNo stock symbol was provided, so no health facts are available.`;
    } else {
      const grounding = await groundStockHealth(symbol);
      if (!grounding) {
        factBlock = `=== FACTS: ${symbol.toUpperCase()} ===\n${CLOSED_WORLD_HEADER}\n${symbol.toUpperCase()} is not in Vytal's covered universe, so it has no health snapshot, pillars, or findings.`;
      } else {
        factBlock = grounding.factBlock;
        asOfSnapshot = formatAsOf(grounding.sources);
        subjectName = grounding.data.identity.name ?? subjectName;
        // Relationship (held? weight? sector exposure? peers held? since-added?) — INCLUDING for orienting
        // users (no holding / no watchlist): "you don't hold this" is itself useful context. Fail-soft.
        const stock = await prisma.stock.findUnique({
          where: { symbol },
          select: { id: true, symbol: true, sector: { select: { name: true } } },
        });
        if (stock) {
          const probe = await probeStockRelationship(userId, stock.id);
          const rel = await groundStockRelationship(
            userId,
            { id: stock.id, symbol: stock.symbol, sectorName: stock.sector?.name ?? null },
            grounding.data,
            probe,
          );
          relationshipBlock = rel.block; // "" when degraded → caller carries no relationship, never a half-built one
        }
      }
    }
    orientation = await readOrientation(userId, tone.level);
  } else if (resolved.spec.grounding === "portfolio") {
    const grounding = await groundPortfolioHealth(userId, "explain"); // explain mode: drops PD reference findings + clock-derived fields
    factBlock = grounding.factBlock;
    asOfSnapshot = formatAsOf(grounding.sources);
    subjectName = subjectName ?? "Your portfolio";
    orientation = await readOrientation(userId, tone.level, grounding.data); // reuse the view — no second read
  } else {
    // concept — NO fact block, NO closed-world header. Orientation still rides along (the reader is still
    // a person with or without a book), but there is nothing to ground.
    subjectName = subjectName ?? resolved.subjectLabel;
    orientation = await readOrientation(userId, tone.level);
  }

  // message[0]: fact block leads (its CLOSED_WORLD_HEADER heads everything below), then orientation, then
  // the relationship block, then the ask. concept has no fact block, so it starts at orientation.
  const openingUserContent = joinBlocks([factBlock, orientation, relationshipBlock, ask]);

  return {
    system,
    openingUserContent,
    openingDisplayContent: resolved.spec.buildDisplay(ctx, resolved.subjectLabel),
    model,
    subjectKind: ctx.subject.kind,
    subjectSymbol,
    subjectName,
    asOfSnapshot,
    subjectLabel: resolved.subjectLabel,
    surfaceKey: resolved.surfaceKey,
    grounding: resolved.spec.grounding,
    derivedTitle: resolved.spec.deriveTitle(ctx, resolved.subjectLabel),
  };
}

/** The carried context for a CHAT-PAGE session — orientation only (no card, no subject, no grounding). It
 *  is persisted as the isOpening message[0], so the reader context is carried via history exactly like a
 *  discuss session's, with no per-turn portfolio read.
 *
 *  ⚠ NO DISPLAY TWIN, AND THERE MUST NEVER BE ONE. A discuss opening stands in for something the reader
 *  DID — they tapped a card asking about a subject — so it has an honest first-person line. This one is
 *  orientation the server wrote about the reader; nobody asked anything. Its message[0] keeps
 *  display_content NULL and stays hidden, and the transcript correctly begins with the reader's own
 *  first typed message. */
export async function composeChatPageOpening(userId: string): Promise<{ system: string; openingUserContent: string; model: string }> {
  const model = resolveChatModel();
  const tone = await resolveToneForUser(userId);
  const system = buildSystemPrompt(tone.systemDirective);
  const orientation = await readOrientation(userId, tone.level);
  // ★ THE TERMINATOR IS CHAT-PAGE ONLY, AND THAT SCOPING IS THE POINT. Every other opening ends in a real
  // ask answered by a persisted assistant turn, so its roles alternate and the reader's first message is an
  // ordinary follow-up. This one ends in server-written notes about the reader with nothing after them, so
  // without a boundary the reader's first message becomes a second consecutive `user` turn glued to a block
  // that says "never narrate this back". See voice.ts §CHAT_PAGE_OPENING_BOUNDARY for the measurement.
  return { system, openingUserContent: `${orientation}\n\n${CHAT_PAGE_OPENING_BOUNDARY}`, model };
}

/** The system prompt for a FOLLOW-UP turn — tone + context-layer + the personalization rule, re-resolved
 *  (cheap; tone can change mid-session). Grounding + orientation are already carried in message[0], so
 *  they are NOT rebuilt here. This is the "do not re-ground per message" guarantee in code. */
export async function resolveTurnSystem(userId: string): Promise<string> {
  const tone = await resolveToneForUser(userId);
  return buildSystemPrompt(tone.systemDirective);
}

/**
 * The MODEL-FACING copy of the reader's message: their words, plus the deterministic language directive.
 *
 * ★ WHY THE DIRECTIVE RIDES ON THE USER TURN AND NOT IN THE SYSTEM PROMPT. It was tried in the system
 * prompt first and MEASURED AS INSUFFICIENT: with a Hinglish history, "what is my name?" still came back
 * as "Aapka naam Arman hai!". A style instruction sitting far from the words it describes loses to the
 * bulk of recent context. Adjacency is the fix — the directive is now the next thing after the message
 * whose language it is describing.
 *
 * ⚠ THE PERSISTED TRANSCRIPT IS UNAFFECTED. The controller stores the reader's raw `message`; only the
 * copy handed to the provider carries this. Same split the opening already uses, where message[0]'s fact
 * block and orientation are model-facing scaffolding hidden from the client.
 */
export function modelFacingUserTurn(message: string): string {
  return `${message}

${buildCurrentTurnLanguageDirective(detectReaderRegister(message))}`;
}
