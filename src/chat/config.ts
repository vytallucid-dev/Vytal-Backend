// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CHAT CONFIG — the one place the conversation engine's model + generation knobs are resolved.
//
// ★ THE MODEL IS RESOLVED ONCE PER TURN AND THREADED THROUGH BOTH THE SPEND SCOPE AND THE PROVIDER CALL.
// The quota counter is keyed by model id (quota.ts: "the model id IS the counter scope"), and the
// provider generates against a model id. If the two ever diverge — meter model A, call model B — the
// counter stops meaning what it claims and Google's own RPD is checked against the wrong budget. So
// callers resolve ONCE here and pass the same string to spendFor(model, …) AND provider.generate({model}).
//
// AI_CHAT_MODEL is DISTINCT from the dead card-era AI_MODEL (env.ts): chat picks its own model, and
// hardcodes nothing about Flash-Lite — swap the model with one env change. The default is the affordable,
// weaker instruction-follower the output guardrail (guardrail.ts) is explicitly tuned for.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The pinned default chat model. Overridable via AI_CHAT_MODEL. Flash-Lite: 480 free-tier RPD, the
 *  model the guardrail is calibrated against. NEVER referenced outside this file — read via resolveChatModel. */
const DEFAULT_CHAT_MODEL = "gemini-3.5-flash-lite";

/** Resolve the chat model: AI_CHAT_MODEL env → the pinned default. Lazy (per call), like the adapter's
 *  own resolveModel — so a config change needs no restart of anything holding a cached value. */
export function resolveChatModel(): string {
  const raw = process.env.AI_CHAT_MODEL;
  return raw && raw.trim() !== "" ? raw.trim() : DEFAULT_CHAT_MODEL;
}

/** Output ceiling for a conversational reply. Generous enough for a "deep" tone answer, bounded so a
 *  runaway generation cannot balloon a single call's cost. Not a quality lever — the tone directive sets
 *  length; this is a backstop. */
export const CHAT_MAX_OUTPUT_TOKENS = 1024;

// ── TOOL LOOP — the round-trip cap (Stage 0). ───────────────────────────────────────────────────────
// Each tool round is another generate() (another quota unit), so an uncapped loop is both a cost risk and
// a potential infinite loop. After this many tool-executing rounds the engine forces ONE final no-tools
// generation — the model must answer from what it has — and logs the truncation (never silently stops).
// Overridable via AI_CHAT_MAX_TOOL_ROUNDS; floored at 1.
export const CHAT_MAX_TOOL_ROUNDS = (() => {
  const raw = process.env.AI_CHAT_MAX_TOOL_ROUNDS;
  const n = raw && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
})();

/**
 * The LARGER cap, granted only once a turn actually reaches for a write-chain tool (engine.ts's
 * `extendedRounds`). Ordinary questions keep the tight cap above and cost nothing extra.
 *
 * ★ WHY 6, ARITHMETICALLY. A write turn's longest LEGITIMATE chain is:
 *     1 searchStocks      (fires on bare tickers too — see the searchStocks description)
 *     2 resolveDate       (the reader described the date in words)
 *     3 recordTransaction (refused: the date wasn't attested yet, or a field was missing)
 *     4 resolveDate       (the recovery the refusal explicitly asks for)
 *     5 recordTransaction (accepted → the proposal)
 *   …then the final no-tools answer. That is 5 rounds, and the old cap of 4 cut it off at exactly
 *   step 4 — observed live, where the turn died with an empty reply mid-recovery. 6 covers the full
 *   chain with one round of slack and still bounds a runaway loop hard.
 *
 * Overridable via AI_CHAT_MAX_TOOL_ROUNDS_WRITE; never lower than the base cap.
 */
export const CHAT_MAX_TOOL_ROUNDS_WRITE = (() => {
  const raw = process.env.AI_CHAT_MAX_TOOL_ROUNDS_WRITE;
  const n = raw && raw.trim() !== "" ? Number(raw) : NaN;
  const wanted = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 6;
  return Math.max(wanted, CHAT_MAX_TOOL_ROUNDS);
})();

// ── HISTORY POLICY — full history for now (per spec). ──────────────────────────────────────────────
// Every turn resends the entire transcript (the opening grounded prompt in message[0] carries the fact
// block, so grounding rides along without re-grounding). This is correct and simplest while sessions are
// short. ⚠ TRUNCATION / SUMMARIZATION SEAM: when transcripts grow long enough that the prompt cost or the
// context window bites, the place to intervene is loadHistoryForModel (sessions.ts) — keep message[0]
// (the grounding) ALWAYS, then summarize or drop the oldest middle turns. Do NOT drop message[0]: losing
// it silently un-grounds the conversation. There is deliberately no cap wired yet.

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 5 · THE READER-PROFILE DISTILLER — model, cadence, bounds, and the injection flag.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The model the nightly distillation runs on.
 *
 * ★ TODAY THIS RESOLVES TO THE SAME STRING AS THE CHAT MODEL, AND THAT IS THE HONEST ANSWER. The plan
 * called for "something cheaper for background work", but Flash-Lite already IS the cheap tier: the only
 * other model in quota.ts's budget table is gemini-3.5-flash at 18 RPD, which nothing routes to and which
 * would be unusable for a per-session job. So the SEAM exists (`AI_PROFILE_MODEL`) for the day a cheaper
 * tier does, and until then the distiller shares the chat model rather than pretending otherwise.
 * Same precedent as the title job, which also spends a full unit on the free tier.
 */
export function resolveProfileModel(): string {
  const raw = process.env.AI_PROFILE_MODEL;
  return raw && raw.trim() !== "" ? raw.trim() : resolveChatModel();
}

/**
 * ★★★ THE INJECTION FLAG — DEFAULT OFF, AND THAT IS THE POINT OF THIS STAGE. ★★★
 *
 * Extraction and injection are DECOUPLED on purpose. The profile accumulates for a few weeks, then the
 * profiles that actually formed are read and it is decided what deserves to reach an answer — rather than
 * shipping a guess about what matters and discovering it in production. The live corpus that motivated
 * this was 11 reader utterances from one person; that is enough to build against and nowhere near enough
 * to tune against.
 *
 * ⚠ WHILE THIS IS OFF, NOTHING THE DISTILLER WRITES REACHES A REPLY. The read side is deliberately not
 * built: see the seam note in chat/compose.ts §readOrientation for exactly where it will attach, and why
 * it belongs in message[0] (paid once per session) rather than the system prompt (paid every turn).
 * The narration/tone rule that must ship WITH injection is also deliberately not written yet.
 */
export const CHAT_PROFILE_INJECT_ENABLED = process.env.AI_PROFILE_INJECT === "1";

/** How long a session must be QUIET before it is distilled. 6h — NOT the 24h sidebar resume window,
 *  which already means something else (sessions.ts §"TWO CLOCKS"). */
export const PROFILE_QUIESCENCE_MS = 6 * 60 * 60 * 1000;

/** Per-run cap. Oldest-first; a truncated run is LOGGED, never silent. */
export const PROFILE_MAX_SESSIONS_PER_RUN = 200;

/** A glossary gap is dropped once it has not recurred within this many distillations. */
export const PROFILE_GAP_DECAY_SESSIONS = 10;

/** The depth nudge is computed from a window of this many recent sessions, so old evidence stops voting. */
export const PROFILE_DEPTH_WINDOW_SESSIONS = 5;

/** Consecutive disagreeing sessions needed to FLIP the register — so one Hinglish sentence does not
 *  relabel an English reader, and one English sentence does not undo a Hinglish one. */
export const PROFILE_REGISTER_HYSTERESIS = 2;
