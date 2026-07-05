// File: src/controllers/me/onboarding-controller.ts
// ═══════════════════════════════════════════════════════════════════════
// Onboarding endpoints for the AUTHENTICATED user (req.authUser). Five
// focused handlers, each touching EXACTLY ONE of the three onboarding stores:
//
//   GET    /api/v1/me/onboarding           status + resume read (all 3 stores, read-only)
//   PATCH  /api/v1/me/ledger               partial write → user_ledger ONLY
//   PATCH  /api/v1/me/register             ai_level      → user_register ONLY
//   PATCH  /api/v1/me/onboarding/progress  step/progress → user_onboarding_meta ONLY
//   POST   /api/v1/me/onboarding/complete  completion    → user_onboarding_meta ONLY
//
// SECURITY: every handler derives the row owner from req.authUser.userId
// (public.users.id) — NEVER from the payload. There is no userId input to
// tamper with, so cross-user access (IDOR) is structurally impossible. The
// requireAuth mount guarantees req.authUser is present.
//
// VALIDATION: categorical ledger values + ai_level are validated against the
// live CHECK/enum allow-sets BEFORE the write, returning 400 with the offending
// field — a CHECK violation never reaches the DB as a raw 500.
//
// PROVISIONING: the signup trigger seeds all three rows atomically, so these are
// UPDATEs. A missing row is an anomaly → clear 409, never a silent create
// (mirrors the auth middleware's not_provisioned stance).
//
// Envelope: { success: true, data } on success; { success: false, error, ... }
// on failure — matching the other read controllers.
// ═══════════════════════════════════════════════════════════════════════

import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import type {
  UserLedger,
  UserRegister,
  UserOnboardingMeta,
} from "../../generated/prisma/client.js";

// ── Allow-sets — mirror the live DB CHECK constraints / enum exactly ──
const FINANCE_DEPTH = ["casual", "formal", "professional"] as const;
const TERM_COMFORT = ["explain", "follow", "assume"] as const;
const INVESTING_EXPERIENCE = ["starting", "few_years", "experienced"] as const;
const INVESTING_STYLE = ["long_term", "mix", "active"] as const;
const AI_LEVEL = ["plain", "balanced", "technical"] as const;

/** The five adaptive ledger flags (camelCase == Prisma field names). */
const LEDGER_FLAGS = [
  "selfTaught",
  "aspirationalTechnical",
  "concisePro",
  "explainLeaning",
  "trustCredential",
] as const;
type LedgerFlagKey = (typeof LEDGER_FLAGS)[number];

// ── Small response helpers (shared error shapes) ──
function badRequest(res: Response, field: string, message: string): Response {
  return res.status(400).json({ success: false, error: "validation_error", field, message });
}
function notProvisioned(res: Response, store: string): Response {
  return res.status(409).json({
    success: false,
    error: "not_provisioned",
    message: `Onboarding ${store} row is not provisioned for this user`,
  });
}
function serverError(res: Response, message: string): Response {
  return res.status(500).json({ success: false, error: "server_error", message });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when `key` is an OWN property present in the body (so we honor an
 *  explicit null, but treat an absent key as "don't touch"). */
function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

// ── Serializers → the frontend's OnboardingState shape (drop-in swap) ──
function serializeLedger(l: UserLedger) {
  return {
    displayName: l.displayName,
    financeDepth: l.financeDepth,
    termComfort: l.termComfort,
    investingExperience: l.investingExperience,
    investingStyle: l.investingStyle,
    // Frontend LedgerFlags are non-null booleans; an unset flag reads as false
    // (the flow only ever SETS a flag true, so null == false semantically).
    flags: {
      selfTaught: l.selfTaught ?? false,
      aspirationalTechnical: l.aspirationalTechnical ?? false,
      concisePro: l.concisePro ?? false,
      explainLeaning: l.explainLeaning ?? false,
      trustCredential: l.trustCredential ?? false,
    },
  };
}

function serializeRegister(r: UserRegister) {
  return { aiLevel: r.aiLevel };
}

function serializeMeta(m: UserOnboardingMeta) {
  return {
    onboardingComplete: m.onboardingComplete,
    currentStep: m.currentStep,
    completedSteps: Array.isArray(m.completedSteps) ? (m.completedSteps as string[]) : [],
    disclaimerAcceptedAt: m.disclaimerAcceptedAt ? m.disclaimerAcceptedAt.toISOString() : null,
    disclaimerTextVersion: m.disclaimerTextVersion,
    onboardingVersion: m.onboardingVersion,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// GET /api/v1/me/onboarding — status + resume read (all three stores).
// Drives the frontend's useOnboardingStatus() (meta.onboardingComplete) and
// rehydrates a partially-filled flow (ledger + register + meta).
// ═══════════════════════════════════════════════════════════════════════
export const getMyOnboarding = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.userId;

    const [ledger, register, meta] = await Promise.all([
      prisma.userLedger.findUnique({ where: { userId } }),
      prisma.userRegister.findUnique({ where: { userId } }),
      prisma.userOnboardingMeta.findUnique({ where: { userId } }),
    ]);

    if (!ledger || !register || !meta) return notProvisioned(res, "state");

    return res.json({
      success: true,
      data: {
        ledger: serializeLedger(ledger),
        register: serializeRegister(register),
        meta: serializeMeta(meta),
      },
    });
  } catch (err) {
    console.error("[me/onboarding] read error:", err);
    return serverError(res, "Failed to read onboarding state");
  }
};

// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/v1/me/ledger — partial write of durable facts + flags.
// Accepts any SUBSET of the fields; validates each against the live allow-set;
// writes only what's provided (never nulls-out unspecified fields). ONLY ledger.
// ═══════════════════════════════════════════════════════════════════════
export const patchMyLedger = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.userId;
    const body: unknown = req.body;
    if (!isPlainObject(body)) return badRequest(res, "body", "Expected a JSON object");

    const data: {
      displayName?: string | null;
      financeDepth?: string;
      termComfort?: string;
      investingExperience?: string;
      investingStyle?: string;
    } & Partial<Record<LedgerFlagKey, boolean>> = {};

    // displayName — free text (nullable). Trim; reject non-string / non-null.
    if (has(body, "displayName")) {
      const v = body.displayName;
      if (v === null) {
        data.displayName = null;
      } else if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed.length === 0)
          return badRequest(res, "displayName", "Display name cannot be empty");
        if (trimmed.length > 120)
          return badRequest(res, "displayName", "Display name is too long (max 120)");
        data.displayName = trimmed;
      } else {
        return badRequest(res, "displayName", "Display name must be a string");
      }
    }

    // Categoricals — validated against the CHECK allow-sets.
    const categoricals: [string, readonly string[]][] = [
      ["financeDepth", FINANCE_DEPTH],
      ["termComfort", TERM_COMFORT],
      ["investingExperience", INVESTING_EXPERIENCE],
      ["investingStyle", INVESTING_STYLE],
    ];
    for (const [field, allowed] of categoricals) {
      if (!has(body, field)) continue;
      const v = body[field];
      if (typeof v !== "string" || !allowed.includes(v))
        return badRequest(res, field, `Must be one of: ${allowed.join(", ")}`);
      (data as Record<string, string>)[field] = v;
    }

    // Adaptive flags — booleans.
    for (const flag of LEDGER_FLAGS) {
      if (!has(body, flag)) continue;
      const v = body[flag];
      if (typeof v !== "boolean")
        return badRequest(res, flag, "Must be a boolean");
      data[flag] = v;
    }

    if (Object.keys(data).length === 0)
      return badRequest(res, "body", "No writable ledger fields provided");

    // updateMany avoids a throw when the row is missing (anomaly → 409).
    const result = await prisma.userLedger.updateMany({ where: { userId }, data });
    if (result.count === 0) return notProvisioned(res, "ledger");

    const ledger = await prisma.userLedger.findUnique({ where: { userId } });
    return res.json({ success: true, data: serializeLedger(ledger!) });
  } catch (err) {
    console.error("[me/ledger] write error:", err);
    return serverError(res, "Failed to update ledger");
  }
};

// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/v1/me/register — update ai_level only. ONLY register.
// (Structurally cannot write the ledger — that is the separation guarantee.)
// ═══════════════════════════════════════════════════════════════════════
export const patchMyRegister = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.userId;
    const body: unknown = req.body;
    if (!isPlainObject(body)) return badRequest(res, "body", "Expected a JSON object");

    if (!has(body, "aiLevel"))
      return badRequest(res, "aiLevel", "aiLevel is required");
    const aiLevel = body.aiLevel;
    if (typeof aiLevel !== "string" || !(AI_LEVEL as readonly string[]).includes(aiLevel))
      return badRequest(res, "aiLevel", `Must be one of: ${AI_LEVEL.join(", ")}`);

    const result = await prisma.userRegister.updateMany({
      where: { userId },
      data: { aiLevel: aiLevel as UserRegister["aiLevel"] },
    });
    if (result.count === 0) return notProvisioned(res, "register");

    const register = await prisma.userRegister.findUnique({ where: { userId } });
    return res.json({ success: true, data: serializeRegister(register!) });
  } catch (err) {
    console.error("[me/register] write error:", err);
    return serverError(res, "Failed to update register");
  }
};

// ═══════════════════════════════════════════════════════════════════════
// PATCH /api/v1/me/onboarding/progress — resumability.
// Sets current_step and/or appends to completed_steps (string keys, de-duped).
// Does NOT set onboarding_complete (that's the dedicated complete call). ONLY meta.
// ═══════════════════════════════════════════════════════════════════════
export const patchMyOnboardingProgress = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.userId;
    const body: unknown = req.body;
    if (!isPlainObject(body)) return badRequest(res, "body", "Expected a JSON object");

    const hasStep = has(body, "currentStep");
    const hasCompleted = has(body, "completedSteps");
    if (!hasStep && !hasCompleted)
      return badRequest(res, "body", "Provide currentStep and/or completedSteps");

    // Validate currentStep (string or null).
    let currentStep: string | null | undefined;
    if (hasStep) {
      const v = body.currentStep;
      if (v !== null && typeof v !== "string")
        return badRequest(res, "currentStep", "Must be a string or null");
      currentStep = v as string | null;
    }

    // Validate completedSteps (array of non-empty strings, to be appended).
    let incoming: string[] | undefined;
    if (hasCompleted) {
      const v = body.completedSteps;
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string" && s.length > 0))
        return badRequest(res, "completedSteps", "Must be an array of non-empty strings");
      incoming = v as string[];
    }

    const meta = await prisma.userOnboardingMeta.findUnique({ where: { userId } });
    if (!meta) return notProvisioned(res, "meta");

    const data: { currentStep?: string | null; completedSteps?: string[] } = {};
    if (hasStep) data.currentStep = currentStep ?? null;
    if (incoming) {
      // De-dupe: existing first (order preserved), then any new keys.
      const existing = Array.isArray(meta.completedSteps)
        ? (meta.completedSteps as string[])
        : [];
      const merged = [...existing];
      for (const s of incoming) if (!merged.includes(s)) merged.push(s);
      data.completedSteps = merged;
    }

    const updated = await prisma.userOnboardingMeta.update({ where: { userId }, data });
    return res.json({ success: true, data: serializeMeta(updated) });
  } catch (err) {
    console.error("[me/onboarding/progress] write error:", err);
    return serverError(res, "Failed to update onboarding progress");
  }
};

// ═══════════════════════════════════════════════════════════════════════
// POST /api/v1/me/onboarding/complete — the final, legal write.
// Sets onboarding_complete=true, disclaimer_accepted_at=now(), and records
// WHICH disclaimer wording + onboarding version were accepted. ONLY meta.
//
// WRITE-ONCE in spirit: if already complete, this is idempotent — it returns
// the existing state and does NOT overwrite disclaimer_accepted_at (the
// acceptance timestamp is a legal fact, not a re-settable field).
// ═══════════════════════════════════════════════════════════════════════
export const completeMyOnboarding = async (req: Request, res: Response) => {
  try {
    const userId = req.authUser!.userId;
    const body: unknown = req.body;
    if (!isPlainObject(body)) return badRequest(res, "body", "Expected a JSON object");

    const meta = await prisma.userOnboardingMeta.findUnique({ where: { userId } });
    if (!meta) return notProvisioned(res, "meta");

    // Idempotent short-circuit BEFORE validation: a re-complete never rewrites
    // the legal acceptance record.
    if (meta.onboardingComplete) {
      return res.json({ success: true, data: serializeMeta(meta), alreadyComplete: true });
    }

    // First completion → the disclaimer record must be present (the liability
    // shield: we must know WHICH wording was accepted).
    const disclaimerTextVersion = body.disclaimerTextVersion;
    if (typeof disclaimerTextVersion !== "string" || disclaimerTextVersion.trim().length === 0)
      return badRequest(res, "disclaimerTextVersion", "disclaimerTextVersion is required");

    const onboardingVersion = body.onboardingVersion;
    if (typeof onboardingVersion !== "string" || onboardingVersion.trim().length === 0)
      return badRequest(res, "onboardingVersion", "onboardingVersion is required");

    const updated = await prisma.userOnboardingMeta.update({
      where: { userId },
      data: {
        onboardingComplete: true,
        disclaimerAcceptedAt: new Date(),
        disclaimerTextVersion: disclaimerTextVersion.trim(),
        onboardingVersion: onboardingVersion.trim(),
      },
    });
    return res.json({ success: true, data: serializeMeta(updated) });
  } catch (err) {
    console.error("[me/onboarding/complete] write error:", err);
    return serverError(res, "Failed to complete onboarding");
  }
};
