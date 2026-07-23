// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// INSIGHT THIS STOCK'S HEALTH — the first STRUCTURED-JSON AI surface (POST /me/stocks/:symbol/insight).
//
// The structured sibling of explain/stock-health.ts, and deliberately PARALLEL to it, not merged with
// it. It reuses every proven piece unchanged — grounding (what is true), tone (how to say it), the quota
// seam + mock guard (`spendFor`/`servedByMock`), the guardrail (`scanExplanationText`) — and adds only
// what structure genuinely needs: a zod schema, the `generateStructured` call, and two validations the
// prose flow has no equivalent for (a shape check, and citation echo-and-assert).
//
// ── WHAT THE MODEL PRODUCES vs WHAT WE STAMP ────────────────────────────────────────────────────────
// The model authors CONTENT ONLY — `headline`, `drivers`, `tension`, each a sentence + the citations it
// rests on. It never authors the envelope: `surface`, `subject.symbol`, `status`, `generatedBy` are OURS
// to set, so the model cannot spoof "ok" over a not-scored stock, or claim to be about a symbol it was
// not given. The provider is handed the CORE schema as `responseSchema`; we wrap the validated core.
//
// ── VALIDATION, IN ORDER (any failure ⇒ ONE hardened retry ⇒ deterministic-JSON fallback) ───────────
//   1. zod       — the shape is authoritative here, not the provider's JSON mode (which is a hint).
//   2. guardrail — `scanExplanationText` on EVERY model-authored `text`. One HARD hit rejects the WHOLE
//                  payload, never just the field: the fields were written in one pass in one voice, so a
//                  sibling of an advising sentence is suspect, not innocent — and a hole where a field
//                  was dropped is a worse contract than a clean fallback.
//   3. citation  — every `Citation{label,value}` must be locatable verbatim in the fact block. This is
//                  the closed-world header made checkable: the model may arrange the block's numbers,
//                  never invent one.
//
// ★ NO WORD-LIST LINT ON TEXT FIELDS. The schema STRUCTURALLY prevents an aggregate verdict — there is
// no winner/summary field for one to live in — and the proven guardrail covers advice constructions. An
// extra deny-list would false-positive on legitimate description (the lesson the guardrail itself
// records). Drift, if it appears, shows up in the soft-hit logs and is tightened with evidence.
//
// ★ THE DETERMINISTIC FALLBACK IS THE FLOOR FOR EVERY NON-CLEAN PATH — blocked, provider error, quota
// denied. It is FREE (no model, no unit), guardrail-clean by construction, and emits the IDENTICAL shape,
// so the surface always renders a real reading and the frontend never handles a special case. It is
// never cached: cheap to reassemble, and it must never sit one `approved` flag from the read path — the
// same rule the prose fallback keeps.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { groundStockHealth, type GroundingSources } from "../grounding.js";
import { resolveToneForUser } from "../tone.js";
import { createAiProvider } from "../registry.js";
import { recordAiTokens } from "../quota.js";
import { scanExplanationText, type HardHit, type SoftHit } from "../guardrail.js";
import { factsKeyOf } from "../explain/stock-health.js";
import {
  asJson, spendFor, toneKeyOf, servedByMock, HARDENED_REINFORCEMENT,
  EXPLANATION_MODEL, MAX_TOKENS, TEMPERATURE,
} from "../explain/shared.js";
import type { AiProvider, TokenUsage } from "../types.js";
import type { HealthSnapshotView } from "../../scoring/read/health-view.types.js";
import { findUnlocatableCitations, type Citation } from "./citations.js";

// ── THE SCHEMA (zod is authoritative; the jsonSchema below is the provider's shape hint) ────────────
//
// Only the CORE (headline/drivers/tension) is the model's to author — see the header. Bounds are the
// locked ones: headline/tension ≤160 (one sentence), each driver ≤140, 2–3 drivers, 1–4 citations per
// sentence. Unknown keys are STRIPPED (zod's default), so a stray field the model adds cannot fail the
// parse — we own the envelope regardless.
const citationZ = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(48),
});
const pointZ = z.object({
  text: z.string().min(1).max(160),
  cites: z.array(citationZ).min(1).max(4),
});
const driverZ = z.object({
  text: z.string().min(1).max(140),
  cites: z.array(citationZ).min(1).max(4),
});

/** What the model returns (validated authoritatively). `tension` is nullish → coalesced to null on
 *  assembly, so the model omitting an explicitly-null field never forces a retry by itself. */
export const modelInsightCoreZ = z.object({
  headline: pointZ,
  drivers: z.array(driverZ).min(2).max(3),
  tension: pointZ.nullish(),
});
export type ModelInsightCore = z.infer<typeof modelInsightCoreZ>;

// ── The public payload types (the envelope is ours; the core is the model's or the fallback's) ──────
export type InsightCitation = Citation;
export interface InsightPoint {
  text: string;
  cites: InsightCitation[];
}
export type InsightStatus = "ok" | "empty";
export type InsightEmptyReason = "not_scored";
export type InsightProvenance = "model" | "fallback";

export interface StockInsight {
  surface: "stock_health";
  subject: { symbol: string };
  status: InsightStatus;
  emptyReason: InsightEmptyReason | null;
  /** "model" ⇒ a validated Gemini payload (cache-eligible) · "fallback" ⇒ deterministic, assembled from
   *  grounding with no model call (never cached). The frontend renders `ok` content either way. */
  generatedBy: InsightProvenance;
  headline: InsightPoint | null;
  drivers: InsightPoint[];
  tension: InsightPoint | null;
}

/** The response the seam returns to the controller — the payload plus the sources every explanation
 *  surface carries (so a caller can tell WHICH health state was described). Mirrors the prose result's
 *  `sources`; the rest of the prose result's fields (state/reason/cached) collapse into the payload's
 *  own `status`/`generatedBy` here. */
export interface StockInsightResult {
  insight: StockInsight;
  sources: GroundingSources;
}

// ── THE PROVIDER SHAPE HINT (Gemini responseSchema) — the CORE only. Uppercase OpenAPI-subset types,
//    the shape the @google/genai SDK accepts. Deliberately minimal: zod is what actually enforces the
//    bounds, this only steers the model onto the right shape. ──
const CITATION_JSON = {
  type: "OBJECT",
  properties: { label: { type: "STRING" }, value: { type: "STRING" } },
  required: ["label", "value"],
};
const POINT_JSON = {
  type: "OBJECT",
  properties: {
    text: { type: "STRING" },
    cites: { type: "ARRAY", items: CITATION_JSON, minItems: 1, maxItems: 4 },
  },
  required: ["text", "cites"],
};
export const STOCK_INSIGHT_JSON_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    headline: POINT_JSON,
    drivers: { type: "ARRAY", items: POINT_JSON, minItems: 2, maxItems: 3 },
    tension: { ...POINT_JSON, nullable: true },
  },
  required: ["headline", "drivers", "tension"],
};

// ── THE ASK — this surface's own, structured. The tone directive already carries the non-advisory spine
//    and the conversational-precision clause; the closed-world header already governs the facts. This
//    only says WHAT goes in each field and that citations are copied, never computed. ──
export const INSIGHT_ASK =
  "Using only the facts above, produce a structured reading of what is most telling about this stock's health — " +
  "the things a reader CANNOT already see from the score gauges, pillar bars, peer rank and trajectory chart rendered directly beneath this card. " +
  "Surface, in this order of preference:\n" +
  "(1) A THREE-LENS DISAGREEMENT or FIELD VERDICT, where the facts carry one: a metric or pillar that is below its own bar yet above the peer field " +
  "(fieldVerdict=PG_WEAK), or that clears its bar yet trails an elite field (fieldVerdict=PG_STRONG). This 'is it this stock, or the whole field?' " +
  "distinction is the single most informative thing in the facts and it appears nowhere else on the page — lead with it when present, and prefer the " +
  "fired pattern's own `verdict` sentence.\n" +
  "(2) WHAT HAS CHANGED — a trajectory movement (the composite or a pillar rising or falling across quarters, a band crossing, the improving/deteriorating " +
  "marker) — in preference to restating a current level.\n" +
  "(3) WHAT IS DISTINCTIVE in the peer cohort — where this stock sits unusually: a wide per-pillar rank spread, a pillar that ranks far from the composite " +
  "standing, an unusual gap to a neighbour.\n" +
  "Fill `headline` with one sentence giving the overall reading, led by the most telling of the above. " +
  "Fill `drivers` with the two or three facts that most account for it — one sentence each, chosen from the priorities above. " +
  "Set `tension` to one sentence naming a genuine divergence the facts flag — a pillar-versus-pillar split, or a lens disagreement between a metric's bar and " +
  "its field — or null when the facts flag none. " +
  "Do NOT spend a sentence merely restating a pillar subtotal or the composite score; those gauges sit directly beneath this card and the reader can already " +
  "see them. You may name a pillar or composite number ONLY where it is needed to support a disagreement, a change, or a distinctiveness point — never as the " +
  "point itself. " +
  "Write tight: the headline and each driver is a SINGLE short sentence — a driver at most 140 characters — not several clauses packed into one. " +
  "In every `cites` entry, copy the exact label and the exact value from a line in the facts above that the sentence rests on — the spoken figure as written " +
  "there, never a raw one shown in parentheses. A `value` is a SHORT token: a number, a percentage, a rank like '2 of 10', a band name, or a fieldVerdict code " +
  "(PG_WEAK / PG_STRONG) — never a whole sentence. When you draw on a `verdict` line, PARAPHRASE it in your own `text` and cite the short figure or code it rests on. " +
  "Every sentence is a statement of fact about this company's measured health — never a suggestion about what to do, and never a prediction about what will happen next.";

/** Retry reinforcement for a SHAPE or CITATION failure (advice failures use HARDENED_REINFORCEMENT). It
 *  names the failure, because repeating the instruction that already failed is not a retry. */
export const STRUCTURED_REINFORCEMENT =
  " CRITICAL — YOUR PREVIOUS ANSWER WAS REJECTED. Return ONLY the required JSON: `headline` (one object), " +
  "`drivers` (an array of 2 or 3 objects), `tension` (one object or null). Each object has `text` (ONE SHORT sentence — " +
  "a driver's text at most 140 characters, a headline's or tension's at most 160) and `cites` (an array of {label, value}). " +
  "A citation `value` is a SHORT token copied verbatim from a single line in the facts — a number, a percentage, a rank like " +
  "'2 of 10', a band name, or a fieldVerdict code (PG_WEAK / PG_STRONG); it must be at most 48 characters. NEVER put a whole " +
  "sentence or a verdict phrase in a `value` — paraphrase any verdict sentence in your `text` and cite the short figure it rests on. " +
  "Copy the `label` and `value` exactly; do not alter a value, and never cite a number that does not appear verbatim in the facts.";

// ── THE SHARED PROMPT COMPOSER, bound to the insight ask. Same header+facts+ask assembly as prose. ──
import { composePrompt } from "../explain/shared.js";
export const buildInsightPrompt = (factBlock: string): string => composePrompt(factBlock, INSIGHT_ASK);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE DETERMINISTIC-JSON FALLBACK — the structured twin of composeDeterministicFallback.
//
// Assembled entirely from `grounding.data`; no model, no recompute, no derived number. Scores are
// rounded with the SAME Math.round the fact block and the UI use, so the fallback and the page cannot
// disagree — and every citation points at a real block label whose value it carries, so it passes the
// same citation check the model's output must. Guardrail-clean by construction (fixed templates over
// enumerated facts), which is exactly why it is the safe floor when the model's output is not.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function composeDeterministicStockInsight(view: HealthSnapshotView): StockInsight {
  const id = view.identity;
  const base = { surface: "stock_health" as const, subject: { symbol: id.symbol } };

  // Not scored → the honest-empty payload. No headline, no drivers — the frontend renders nothing and
  // its existing "not scored" panel owns this state. (We never reach a model call for an unscored stock.)
  if (!view.scored || !view.verdict) {
    return { ...base, status: "empty", emptyReason: "not_scored", generatedBy: "fallback", headline: null, drivers: [], tension: null };
  }

  const vd = view.verdict;
  const composite = Math.round(vd.composite);
  const headline: InsightPoint = {
    text: `${id.name} (${id.symbol}) scores ${composite} — ${vd.label.label}.`,
    cites: [{ label: "Composite health score", value: String(composite) }],
  };

  // Drivers: the top pillars by subtotal, one fixed-template sentence each (2–3, satisfying the bound).
  const drivers: InsightPoint[] = [...view.pillars]
    .filter((p) => Number.isFinite(p.subtotal))
    .sort((a, b) => b.subtotal - a.subtotal)
    .slice(0, 3)
    .map((p) => {
      const n = Math.round(p.subtotal);
      return { text: `${cap(p.pillar)} scores ${n}.`, cites: [{ label: p.pillar.toUpperCase(), value: String(n) }] };
    });

  // Tension: the divergence line when the facts flag a high/low pair (mirrors the prose fallback's rule).
  let tension: InsightPoint | null = null;
  if (vd.divergence.high && vd.divergence.low) {
    const hi = vd.divergence.high;
    const lo = vd.divergence.low;
    const spread = vd.divergence.flag === "wide" ? ", a wide spread" : "";
    tension = {
      text: `Its strongest pillar is ${cap(hi.pillar)} at ${Math.round(hi.subtotal)} and its weakest is ${cap(lo.pillar)} at ${Math.round(lo.subtotal)}${spread}.`,
      cites: [
        { label: "Divergence highest pillar", value: String(Math.round(hi.subtotal)) },
        { label: "Divergence lowest pillar", value: String(Math.round(lo.subtotal)) },
      ],
    };
  }

  return { ...base, status: "ok", emptyReason: null, generatedBy: "fallback", headline, drivers, tension };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE GUARDED STRUCTURED LOOP — generate → (zod → guardrail → citation) → ONE hardened retry → else block.
//
// Parallel to `generateGuarded`, not shared with it: the prose loop returns text and scans one body; this
// returns a parsed core and runs three validations, with a failure-specific retry reinforcement. Exported
// with `provider`/`spend` injected SO THE FAILURE PATH IS TESTABLE without coaxing a live model to misbehave.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export type StructuredOutcome =
  | { kind: "clean"; core: ModelInsightCore; usage: TokenUsage; attempts: number; priorHardHits: HardHit[] | null; softHits: SoftHit[] }
  | { kind: "blocked"; attempts: number; reason: "schema" | "guardrail" | "citation"; hardHits: HardHit[] }
  | { kind: "quota_denied"; attempts: number; resetAt: string }
  | { kind: "provider_error"; attempts: number; message: string };

type Spend = () => Promise<{ allowed: boolean; resetAt: Date }>;

export async function generateStructuredGuarded(
  provider: AiProvider,
  systemDirective: string,
  prompt: string,
  factBlock: string,
  spend: Spend,
): Promise<StructuredOutcome> {
  let priorHardHits: HardHit[] | null = null;
  let lastReason: "schema" | "guardrail" | "citation" = "schema";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const decision = await spend();
    if (!decision.allowed) return { kind: "quota_denied", attempts: attempt - 1, resetAt: decision.resetAt.toISOString() };

    // The retry names the failure. Advice → the advice reinforcement; a shape/citation miss → the
    // structured one. Repeating the instruction that already failed is not a retry.
    const reinforcement = attempt === 1 ? "" : lastReason === "guardrail" ? HARDENED_REINFORCEMENT : STRUCTURED_REINFORCEMENT;
    const system = systemDirective + reinforcement;

    let data: unknown;
    let usage: TokenUsage;
    try {
      const res = await provider.generateStructured<unknown>({
        system,
        messages: [{ role: "user", content: prompt }],
        model: EXPLANATION_MODEL,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        jsonSchema: STOCK_INSIGHT_JSON_SCHEMA,
      });
      data = res.data;
      usage = res.usage;
    } catch (err) {
      // Provider failure OR non-JSON output — terminal, exactly as the prose loop treats a throw.
      return { kind: "provider_error", attempts: attempt, message: (err as Error).message };
    }

    // Best-effort accounting, never throws — a token-count failure must not break a working answer.
    await recordAiTokens(EXPLANATION_MODEL, usage.promptTokens + usage.outputTokens);

    // ── VALIDATION, IN ORDER ──
    // 1. zod (authoritative shape).
    const parsed = modelInsightCoreZ.safeParse(data);
    if (!parsed.success) {
      lastReason = "schema";
      console.warn(`[ai/insight] schema invalid (attempt ${attempt}): ` + parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join(" · "));
      if (attempt === 2) return { kind: "blocked", attempts: 2, reason: "schema", hardHits: [] };
      continue;
    }
    const core = parsed.data;

    // 2. guardrail on EVERY model-authored text — one HARD hit rejects the WHOLE payload.
    const texts = [core.headline.text, ...core.drivers.map((d) => d.text), ...(core.tension ? [core.tension.text] : [])];
    const verdicts = texts.map(scanExplanationText);
    const hardHits = verdicts.flatMap((v) => v.hardHits);
    const softHits = verdicts.flatMap((v) => v.softHits);
    if (hardHits.length) {
      lastReason = "guardrail";
      priorHardHits = hardHits;
      console.warn(`[ai/insight] guardrail HARD hit (attempt ${attempt}): ` + hardHits.map((h) => `${h.term}→"${h.match}"`).join(", "));
      if (attempt === 2) return { kind: "blocked", attempts: 2, reason: "guardrail", hardHits };
      continue;
    }

    // 3. citation echo-and-assert on EVERY cite.
    const allCites: Citation[] = [core.headline, ...core.drivers, ...(core.tension ? [core.tension] : [])].flatMap((p) => p.cites);
    const unlocated = findUnlocatableCitations(factBlock, allCites);
    if (unlocated.length) {
      lastReason = "citation";
      console.warn(`[ai/insight] unlocatable citation(s) (attempt ${attempt}): ` + unlocated.map((c) => `${c.label}=${c.value}`).join(", "));
      if (attempt === 2) return { kind: "blocked", attempts: 2, reason: "citation", hardHits: [] };
      continue;
    }

    return { kind: "clean", core, usage, attempts: attempt, priorHardHits, softHits };
  }
  /* c8 ignore next */
  return { kind: "blocked", attempts: 2, reason: lastReason, hardHits: priorHardHits ?? [] };
}

// ── Assemble the public payload from the model's validated core (we own the envelope). ──
function assembleFromCore(symbol: string, core: ModelInsightCore): StockInsight {
  return {
    surface: "stock_health",
    subject: { symbol },
    status: "ok",
    emptyReason: null,
    generatedBy: "model",
    headline: core.headline,
    drivers: core.drivers,
    tension: core.tension ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SERVICE — ground → tone → cache → quota → generate → validate → (retry) → fallback → cache.
//
// Returns null ⇔ the symbol is not in the universe (the controller maps that to 404, mirroring
// GET /api/stocks/:symbol/health). Never throws for quota/provider/guardrail reasons — those resolve to
// the deterministic fallback, which is why this surface always renders something real.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export async function insightStockHealth(userId: string, symbol: string): Promise<StockInsightResult | null> {
  // ── 1. GROUNDING (free) — the facts, and therefore the cache key. ──
  const grounding = await groundStockHealth(symbol);
  if (!grounding) return null; // not in the universe → 404
  const view = grounding.data;

  // ── Not scored → honest-empty, BEFORE tone/cache/quota. Nothing to explain, nothing to spend. ──
  if (!view.scored) {
    return { insight: composeDeterministicStockInsight(view), sources: grounding.sources };
  }

  // ── 2. TONE (free, fail-soft) ──
  const tone = await resolveToneForUser(userId);
  const toneKey = toneKeyOf(tone);
  const factsKey = factsKeyOf(grounding.factBlock);

  const stock = await prisma.stock.findUnique({ where: { symbol: view.identity.symbol }, select: { id: true } });
  if (!stock) return null;

  // ── 3. CACHE READ (free) — approved gates it (fails closed). A cached row is always a model payload. ──
  const hit = await prisma.aiStockInsight.findUnique({
    where: { stockId_factsKey_toneKey: { stockId: stock.id, factsKey, toneKey } },
    select: { payload: true, approved: true },
  });
  if (hit?.approved) {
    return { insight: hit.payload as unknown as StockInsight, sources: grounding.sources };
  }

  // The deterministic fallback is the floor for EVERY non-clean path below — free, clean, identical shape.
  const fallback = (): StockInsightResult => ({ insight: composeDeterministicStockInsight(view), sources: grounding.sources });

  // ── 4–6. QUOTA → GENERATE → VALIDATE (the only billable stretch) ──
  const spend = spendFor(EXPLANATION_MODEL, { kind: "user", userId });
  const outcome = await generateStructuredGuarded(
    createAiProvider(),
    tone.systemDirective,
    buildInsightPrompt(grounding.factBlock),
    grounding.factBlock,
    async () => {
      const d = await spend();
      return { allowed: d.allowed, resetAt: d.resetAt };
    },
  );

  if (outcome.kind === "quota_denied") return fallback();
  if (outcome.kind === "provider_error") {
    console.error(`[ai/insight] provider failed for ${view.identity.symbol}: ${outcome.message}`);
    return fallback();
  }
  if (outcome.kind === "blocked") {
    // Logged inside the loop. The rejected model payload is never cached; the fallback is served fresh.
    return fallback();
  }

  // ── clean ──
  const { core, usage, attempts, priorHardHits, softHits } = outcome;

  // ⚠ MOCK NEVER REACHES THE CACHE — and never reaches the user AS REAL. Under the stub the whole flow
  // ran end-to-end; we serve the deterministic fallback rather than the canned object, and write nothing.
  if (servedByMock(usage)) {
    console.warn(`[ai/insight] MOCK provider answered for ${view.identity.symbol} — serving deterministic fallback, not cached. Set AI_PROVIDER=gemini for real insights.`);
    return fallback();
  }

  const insight = assembleFromCore(view.identity.symbol, core);

  // ── 7. CACHE WRITE — clean model payload only, approved: true. ──
  try {
    await prisma.aiStockInsight.upsert({
      where: { stockId_factsKey_toneKey: { stockId: stock.id, factsKey, toneKey } },
      create: {
        stockId: stock.id, factsKey, toneKey,
        payload: insight as unknown as object, approved: true, attempts,
        hardHits: asJson(priorHardHits), softHits: asJson(softHits),
        model: EXPLANATION_MODEL, modelVersion: usage.modelVersion,
        promptTokens: usage.promptTokens, outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens, cacheHit: usage.cacheHit,
        asOfDate: grounding.sources.asOfDate, periodKey: grounding.sources.periodKey,
        snapshotType: grounding.sources.snapshotType,
      },
      update: { payload: insight as unknown as object, approved: true, attempts, generatedAt: new Date() },
    });
  } catch (err) {
    console.warn(`[ai/insight] cache write failed for ${view.identity.symbol}: ${(err as Error).message}`);
  }

  return { insight, sources: grounding.sources };
}
