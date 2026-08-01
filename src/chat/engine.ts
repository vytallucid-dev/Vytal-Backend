// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT GENERATION LOOP — one turn: spend gate → generate → guardrail scan → (one regeneration) →
// (fixed redirect). Composes the proven primitives; reimplements none of them.
//
//   spendFor(model, actor)      the per-request spend gate (denied → honest unavailable, persist nothing)
//   provider.generate(...)      the provider-agnostic call (Gemini / mock / injected)
//   scanExplanationText(reply)  Layer 1 — the deterministic advice guardrail
//   ANTI_ADVICE_REMINDER        Layer 2 — the sharpened system reminder on the ONE retry
//   buildLayer3Redirect(...)    Layer 3 — the fixed in-voice redirect when the retry ALSO trips the gate
//   recordAiTokens(...)         best-effort token accounting (real calls only; never for a mock stub)
//
// ★ ONE UNIT PER ATTEMPT. The retry is a genuine second call, so it spends a second unit (quota doctrine).
// If the retry can't be afforded, we serve the redirect rather than the advice reply — the gate never lets
// advice through.
//
// TESTABILITY: `provider` and `spend` are injectable (the same seam spend.ts documents for `Spend`), so the
// proof harness can script provider replies (to force the guardrail path) and force a denial, without a
// live counter or a real key. Both default to the real registry provider + the real spend gate.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createAiProvider } from "../ai/registry.js";
import type { AiGenerateResult, AiMessage, AiProvider, AiToolCall, AiToolResult, AiToolSpec, TokenUsage } from "../ai/types.js";
import { spendFor, servedByMock, type Spend } from "../ai/spend.js";
import { recordAiTokens, type Actor, type QuotaDecision } from "../ai/quota.js";
import { scanExplanationText } from "../ai/guardrail.js";
import { scanUngroundedNumbers, buildNumberHaystack } from "../ai/number-grounding.js";
import { scanUserInput, scanOutputText } from "../ai/moderation.js";
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_MAX_TOOL_ROUNDS } from "./config.js";
import {
  ANTI_ADVICE_REMINDER,
  buildLayer3Redirect,
  buildFairUseWarning,
  detectReaderRegister,
  lastReaderTextOf,
  EMPTY_REPLY_FALLBACK,
  TOOL_CAP_FALLBACK,
  isBlankReply,
} from "./voice.js";

export interface ChatTurnInput {
  model: string;
  system: string;
  /** Full history + the new user message (for an opening: just [message[0]]). */
  messages: AiMessage[];
  actor: Actor;
  /** Human subject label for the Layer-3 redirect. */
  subjectLabel: string;
  // ── Tool calling (Stage 0). Both must be present to enable the loop; absent ⇒ behaves EXACTLY as
  //    before (a single generation, no loop). The opening path passes neither. ──
  /** The tool declarations the model may call this turn. */
  tools?: AiToolSpec[];
  /** The fail-soft dispatcher (registry-bound, carries the ToolContext). Never throws. */
  executeTool?: (call: AiToolCall) => Promise<AiToolResult>;
  /** Override the tool round-trip cap (defaults to CHAT_MAX_TOOL_ROUNDS). */
  maxRounds?: number;
  /**
   * A LARGER round budget, granted the moment one of the named tools is actually called.
   *
   * ★ WHY IT IS CONDITIONAL RATHER THAN JUST A BIGGER CAP. Every round is another generation, so a
   * blanket raise costs a quota unit on turns that never needed it. A write chain legitimately needs
   * more rounds than a read — searchStocks → resolveDate → recordTransaction is three before any
   * recovery, and a refused date costs two more — so the budget follows the work: ordinary questions
   * keep the tight cap, and the turn only buys extra headroom once it has proven it is doing the
   * expensive kind of work. (A live write turn hit the old cap mid-recovery and died with an empty
   * reply; that is the bug this exists to prevent.)
   *
   * The engine stays provider- AND registry-agnostic: it matches on NAMES the caller supplies, and
   * never learns what a "write tool" is.
   */
  extendedRounds?: { tools: readonly string[]; maxRounds: number };
}

export interface ChatTurnDeps {
  provider?: AiProvider;
  /** The spend thunk (one unit per call). Defaults to spendFor(model, actor). */
  spend?: Spend;
}

/** An internal tool turn to persist — hidden from the client transcript, replayed into model history.
 *  A tool_call rides on role "assistant" (carries the AiToolCall[] the model requested + the usage of the
 *  generation that produced it); a tool_result on role "user" (carries the one AiToolResult, no usage). */
export interface PersistedToolTurn {
  role: "assistant" | "user";
  kind: "tool_call" | "tool_result";
  content: string;
  toolPayload: AiToolCall[] | AiToolResult;
  usage: TokenUsage | null;
}

export interface ChatTurnResult {
  /** "unavailable" ⇔ the spend gate denied an attempt with no servable answer yet: persist nothing,
   *  return an honest state (the FIRST attempt, or a mid-tool-loop generation). */
  status: "ok" | "unavailable";
  /** The assistant reply to persist + return (clean text, or the fixed redirect). null when unavailable. */
  text: string | null;
  /** The usage of the attempt whose text we are serving — for per-message metering. null when unavailable. */
  usage: TokenUsage | null;
  guardrailBlocked: boolean;
  regenerated: boolean;
  /** true ⇔ the CONTENT-MODERATION gate fired (either side) and the fair-use warning was served instead
   *  of a reply. Distinct from guardrailBlocked, which is specifically the ADVICE gate. */
  moderationBlocked?: boolean;
  /** The ordered internal tool turns that occurred this message (tool_call/tool_result), for the caller
   *  to persist between the user message and the final assistant message. Empty when no tools were used. */
  toolTurns: PersistedToolTurn[];
  /** Quota reason + which ceiling denied (only when unavailable). */
  reason?: string;
  scopeDenied?: "user" | "global" | null;
  /** ISO instant the denying window resets (next Pacific-midnight). Only set when unavailable. */
  resetAt?: string;
}

/**
 * Run one chat turn. Never throws on a quota denial (returns status:"unavailable"); a provider failure
 * propagates (the caller 500s and persists nothing).
 */
// ── TEST-ONLY default-provider override ─────────────────────────────────────────────────────────────
// The provider is injectable per call (deps.provider). This seam sets the DEFAULT used when a caller
// passes none — so the controllers (which pass no deps) can be driven over real HTTP with a scripted
// in-voice provider in the proof harness, making the "verbatim conversation over HTTP" read realistically
// and the guardrail path deterministic. Production NEVER calls the setter → createAiProvider() (the
// registry) is used, unchanged.
let testDefaultProvider: AiProvider | null = null;
export function __setDefaultChatProviderForTests(p: AiProvider | null): void {
  testDefaultProvider = p;
}
/** The provider a chat call uses when none is injected: the test override if set, else the registry. Shared
 *  by runChatTurn AND the title job, so both resolve the provider identically. */
export function resolveChatProvider(): AiProvider {
  return testDefaultProvider ?? createAiProvider();
}

export async function runChatTurn(input: ChatTurnInput, deps: ChatTurnDeps = {}): Promise<ChatTurnResult> {
  const provider = deps.provider ?? resolveChatProvider();
  const spend = deps.spend ?? spendFor(input.model, input.actor);
  const toolsEnabled = !!(input.tools && input.tools.length && input.executeTool);
  const baseRounds = input.maxRounds ?? CHAT_MAX_TOOL_ROUNDS;
  // The budget starts tight and is raised (once, in place) the first time an extended-round tool is
  // called. `maxRounds` is read at the TOP of each loop pass, so the raise applies retroactively to a
  // turn that has already spent rounds getting there.
  const extendTools = new Set(input.extendedRounds?.tools ?? []);
  let maxRounds = baseRounds;
  let roundsExtended = false;

  // The reader's own register, read off their last message — so the Layer-3 redirect is served in the
  // language they asked in rather than a wall of English (voice.ts §"THE REDIRECT IS SERVED IN THE
  // READER'S OWN LANGUAGE"). Computed ONCE per turn: it is pure, and the redirect is reachable from two
  // branches below, which must not disagree about what language this reader is speaking.
  const register = detectReaderRegister(lastReaderTextOf(input.messages));

  const unavailable = (d: QuotaDecision): ChatTurnResult => ({
    status: "unavailable", text: null, usage: null, guardrailBlocked: false, regenerated: false,
    toolTurns: [], reason: d.reason, scopeDenied: d.scopeDenied, resetAt: d.resetAt.toISOString(),
  });

  /**
   * ★ THE LAST GATE BEFORE ANYTHING REACHES THE READER. Every `status:"ok"` return goes through here,
   * so there is no path that can deliver a blank bubble — that is checkable by grepping for `status:
   * "ok"` rather than by trusting each branch to remember.
   *
   * An empty terminal generation is a REAL failure upstream (a provider hiccup, a tool loop that ate
   * the budget, a forced no-tools answer with nothing left to say), so it is logged distinctly and
   * loudly enough to measure a rate. Swallowing it silently is how a slow regression hides.
   */
  const deliver = (r: Omit<ChatTurnResult, "status">): ChatTurnResult => {
    if (!isBlankReply(r.text)) {
      // ══ THE UNGROUNDED-NUMBER SCAN — LOG-ONLY, NEVER BLOCKING (ai/number-grounding.ts). ══════════
      // It rides HERE for the same reason the blank-reply catch does: `deliver` is the one chokepoint
      // every servable answer passes through, so coverage is greppable rather than a promise each
      // branch has to keep. It never alters `r` — a hit changes nothing about what the reader sees.
      //
      // ⚠ THE HAYSTACK IS EVERYTHING THE MODEL WAS GIVEN, not just tool results. Measured: results-only
      // fired on "0 to 100 health score" and "52-week range" — the product's own vocabulary, which lives
      // in the system prompt and the tool declarations. See that file's header.
      //
      // ⚠ AND A CLEAN LINE IS NOT PROOF THE NUMBERS ARE RIGHT: integers ≤12 are not checked, so an
      // invented COUNT ("4 block deals" when there were 2) never appears here.
      try {
        const g = scanUngroundedNumbers(
          r.text!,
          buildNumberHaystack({
            system: input.system,
            toolSpecsJson: input.tools ? JSON.stringify(input.tools) : undefined,
            messages: working,
          }),
        );
        if (!g.clean) {
          console.warn(
            `[chat] UNGROUNDED_NUMBER — ${g.hits.length} figure(s) in the delivered reply appear in no tool ` +
              `result, no prompt and no tool declaration (checked=${g.checked} skipped=${g.skipped} ` +
              `model=${input.model} toolTurns=${toolTurns.length}): ` +
              g.hits.map((h) => `"${h.raw}" ${h.context}`).join(" · "),
          );
        }
      } catch (e) {
        // A detector must never be able to fail a turn that has already been generated and paid for.
        console.warn(`[chat] ungrounded-number scan failed (non-fatal): ${(e as Error).message}`);
      }

      // ══ THE EVALUATIVE TIER — LOG-ONLY (ai/guardrail.ts §EVALUATIVE). ═══════════════════════════
      // It CANNOT block: `scanEvaluative` has no hard channel and `clean` never reads it. This line is
      // the calibration evidence for the promote-to-blocking decision that ships with the depth
      // directive — so it is emitted with a distinct, greppable token and the `attributed` flag, which
      // is what lets a reported verdict ("the brokerage called it impressive") be excluded from the
      // count rather than inflating the case for blocking.
      try {
        const ev = scanExplanationText(r.text!).evaluativeHits;
        if (ev.length) {
          const own = ev.filter((h) => !h.attributed);
          console.warn(
            `[chat] EVALUATIVE_VERDICT — ${ev.length} hit(s), ${own.length} unattributed (model's own verdict) ` +
              `(model=${input.model} regenerated=${r.regenerated}): ` +
              ev.map((h) => `${h.term}${h.attributed ? "[attributed]" : ""}→"${h.match}" · ${h.context}`).join(" | "),
          );
        }
      } catch (e) {
        console.warn(`[chat] evaluative scan failed (non-fatal): ${(e as Error).message}`);
      }
      return { status: "ok", ...r };
    }
    console.warn(
      `[chat] EMPTY_GENERATION — the model delivered no text; serving the ${cappedOut ? "round-cap" : "empty-reply"} fallback ` +
        `(model=${input.model} toolRounds=${rounds}/${maxRounds} cappedOut=${cappedOut} toolTurns=${toolTurns.length} ` +
        `guardrailBlocked=${r.guardrailBlocked} regenerated=${r.regenerated})`,
    );
    return { status: "ok", ...r, text: cappedOut ? TOOL_CAP_FALLBACK : EMPTY_REPLY_FALLBACK };
  };

  // ══ CONTENT MODERATION · INPUT SIDE — BEFORE THE SPEND GATE, DELIBERATELY. ══════════════════════
  // A hit here means we never generate: no quota unit, no provider call, no tokens. That ordering is the
  // whole value of checking the input at all — it is both cheaper and stops the request earlier than
  // catching a compliant answer on the way out. The reader still gets a persisted turn (the warning), so
  // the transcript stays an honest record of the exchange.
  const modIn = scanUserInput(lastReaderTextOf(input.messages));
  if (!modIn.clean) {
    console.warn(
      `[chat] MODERATION_BLOCK input — category=${modIn.category} ` +
        `terms=${modIn.hits.map((h) => h.term).join(",")} (no generation, no spend)`,
    );
    return {
      status: "ok",
      text: buildFairUseWarning(register),
      usage: null,
      guardrailBlocked: true,
      regenerated: false,
      moderationBlocked: true,
      toolTurns: [],
    };
  }

  // ── SPEND GATE (attempt 1). Denied → honest unavailable, nothing generated, nothing persisted. ──
  const d1 = await spend();
  if (!d1.allowed) return unavailable(d1);

  // The working history the loop mutates — the input's messages array is never touched. Tool turns are
  // appended here (so the NEXT generation sees them) AND recorded in toolTurns (so the caller persists them).
  const working: AiMessage[] = [...input.messages];
  const toolTurns: PersistedToolTurn[] = [];

  const generate = async (system: string, withTools: boolean): Promise<AiGenerateResult> => {
    const r = await provider.generate({
      model: input.model,
      system,
      messages: working,
      maxTokens: CHAT_MAX_OUTPUT_TOKENS,
      ...(withTools && toolsEnabled ? { tools: input.tools } : {}),
    });
    // Best-effort token accounting — real calls only. A mock stub must never move the counter (spend.ts).
    if (!servedByMock(r.usage)) await recordAiTokens(input.model, r.usage.promptTokens + r.usage.outputTokens);
    return r;
  };

  // ── THE TOOL LOOP ──────────────────────────────────────────────────────────────────────────────
  // Generate; while the model calls tools, execute them and generate again — ONE spend per generation.
  // Guardrail is deliberately NOT run here: intermediate tool-call turns carry no user-facing prose, and
  // scanning an empty/internal turn would either waste a scan or read "clean" and mask that the real
  // answer was never gated. It runs once, below, on the delivered text.
  let r = await generate(input.system, true);
  let rounds = 0;
  let cappedOut = false;
  while (toolsEnabled && r.toolCalls && r.toolCalls.length) {
    // Does this round reach for a tool that earns the larger budget? Checked BEFORE the cap test, so a
    // turn that is one round short of finishing a write chain gets its headroom rather than dying here.
    if (!roundsExtended && input.extendedRounds && r.toolCalls.some((c) => extendTools.has(c.name))) {
      roundsExtended = true;
      maxRounds = Math.max(maxRounds, input.extendedRounds.maxRounds);
      console.info(`[chat] tool round budget raised ${baseRounds} → ${maxRounds} (a write-chain tool was called)`);
    }
    if (rounds >= maxRounds) {
      // Cap reached and the model STILL wants tools → force ONE final no-tools answer (it must answer
      // from what it has). Log the truncation; never silently stop, never loop unbounded.
      console.warn(`[chat] tool round cap (${maxRounds}) reached — forcing a final answer without tools`);
      cappedOut = true;
      const dCap = await spend();
      if (!dCap.allowed) return unavailable(dCap);
      r = await generate(input.system, false);
      break;
    }
    rounds++;

    // Record + append the tool_call turn (assistant), carrying THIS generation's usage. content is the
    // model's preamble text if any (usually "").
    toolTurns.push({ role: "assistant", kind: "tool_call", content: r.text, toolPayload: r.toolCalls, usage: r.usage });
    working.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls });

    // Execute every call this round in parallel (reads are independent). The executor is FAIL-SOFT — it
    // never throws; a failed tool comes back as a result whose response carries { error }.
    const results = await Promise.all(r.toolCalls.map((c) => input.executeTool!(c)));
    for (const res of results) {
      toolTurns.push({ role: "user", kind: "tool_result", content: "", toolPayload: res, usage: null });
      working.push({ role: "user", content: "", toolResult: res });
    }

    // Spend for the next generation. A mid-loop denial has NO servable answer yet → honest unavailable
    // (persist nothing) rather than a partial, ungrounded reply.
    const dN = await spend();
    if (!dN.allowed) return unavailable(dN);
    r = await generate(input.system, true);
  }

  // r is now the FINAL text generation (the model stopped calling tools, or we forced it).
  //
  // ⚠ EMPTINESS IS CHECKED BEFORE THE GUARDRAIL, NOT AFTER. `scanExplanationText("")` is perfectly
  // clean — there is no advice in nothing — so an empty generation would sail straight through the gate
  // and be delivered as a blank bubble. `deliver` catches it either way, but short-circuiting here also
  // avoids burning a second unit regenerating emptiness into more emptiness.
  if (isBlankReply(r.text)) {
    return deliver({ text: r.text, usage: r.usage, guardrailBlocked: false, regenerated: false, toolTurns });
  }

  // ══ CONTENT MODERATION · OUTPUT SIDE — the model COMPLIED with something the input side missed. ══
  // Checked BEFORE the advice guardrail because it is the more serious failure and needs no regeneration:
  // there is no "try again more descriptively" for this. Serve the warning and stop.
  const modOut = scanOutputText(r.text);
  if (!modOut.clean) {
    console.warn(
      `[chat] MODERATION_BLOCK output — category=${modOut.category} ` +
        `terms=${modOut.hits.map((h) => h.term).join(",")} (reply withheld)`,
    );
    return {
      status: "ok",
      text: buildFairUseWarning(register),
      usage: r.usage,
      guardrailBlocked: true,
      regenerated: false,
      moderationBlocked: true,
      toolTurns,
    };
  }

  // The guardrail runs on THIS delivered text only.
  if (scanExplanationText(r.text).clean) {
    return deliver({ text: r.text, usage: r.usage, guardrailBlocked: false, regenerated: false, toolTurns });
  }

  // ── HARD HIT → ONE regeneration with the sharpened anti-advice reminder, WITHOUT tools (re-synthesise
  //    the answer from the history we already have — do not re-explore). A second attempt = a second unit. ──
  const d2 = await spend();
  if (!d2.allowed) {
    // Out of budget for the retry — serve the fixed redirect, NEVER the advice reply. Marked blocked.
    return deliver({ text: buildLayer3Redirect(input.subjectLabel, register), usage: r.usage, guardrailBlocked: true, regenerated: false, toolTurns });
  }
  const r2 = await generate(`${input.system}\n\n${ANTI_ADVICE_REMINDER}`, false);
  // An empty RETRY is still empty — do not let it through as "clean".
  if (!isBlankReply(r2.text) && scanExplanationText(r2.text).clean) {
    return deliver({ text: r2.text, usage: r2.usage, guardrailBlocked: false, regenerated: true, toolTurns });
  }
  if (isBlankReply(r2.text)) {
    return deliver({ text: r2.text, usage: r2.usage, guardrailBlocked: false, regenerated: true, toolTurns });
  }

  // ── HIT AGAIN → persist the fixed redirect, mark guardrailBlocked. ──
  return deliver({ text: buildLayer3Redirect(input.subjectLabel, register), usage: r2.usage, guardrailBlocked: true, regenerated: true, toolTurns });
}
