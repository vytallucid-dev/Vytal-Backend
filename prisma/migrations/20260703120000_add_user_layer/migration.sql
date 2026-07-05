-- ═══════════════════════════════════════════════════════════════
-- Phase 1 — User layer for Supabase Auth.
-- Five public tables keyed to auth.users + a signup trigger that
-- seeds the full row set on every auth.users INSERT.
-- ADDITIVE ONLY: no existing table is touched. The cross-schema FK
-- (public.users.auth_user_id → auth.users.id) and the trigger are
-- raw SQL that Prisma does not model.
--
-- PRIVILEGE: apply on the DIRECT (postgres-role) connection —
-- creating a trigger on auth.users + a SECURITY DEFINER function
-- requires ownership that Supabase grants to `postgres`.
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "AiLevel" AS ENUM ('plain', 'balanced', 'technical');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "auth_user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ledger" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "finance_depth" TEXT,
    "term_comfort" TEXT,
    "investing_experience" TEXT,
    "investing_style" TEXT,
    "self_taught" BOOLEAN,
    "aspirational_technical" BOOLEAN,
    "concise_pro" BOOLEAN,
    "explain_leaning" BOOLEAN,
    "trust_credential" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_ledger_finance_depth_check"
        CHECK ("finance_depth" IN ('casual', 'formal', 'professional')),
    CONSTRAINT "user_ledger_term_comfort_check"
        CHECK ("term_comfort" IN ('explain', 'follow', 'assume')),
    CONSTRAINT "user_ledger_investing_experience_check"
        CHECK ("investing_experience" IN ('starting', 'few_years', 'experienced')),
    CONSTRAINT "user_ledger_investing_style_check"
        CHECK ("investing_style" IN ('long_term', 'mix', 'active'))
);

-- CreateTable
CREATE TABLE "user_register" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "ai_level" "AiLevel" NOT NULL DEFAULT 'balanced',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_onboarding_meta" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "current_step" TEXT,
    "completed_steps" JSONB NOT NULL DEFAULT '[]',
    "disclaimer_accepted_at" TIMESTAMP(3),
    "disclaimer_text_version" TEXT,
    "onboarding_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_onboarding_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linked_accounts" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linked_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "linked_accounts_status_check"
        CHECK ("status" IN ('pending', 'active', 'error', 'revoked'))
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");
CREATE UNIQUE INDEX "user_ledger_user_id_key" ON "user_ledger"("user_id");
CREATE UNIQUE INDEX "user_register_user_id_key" ON "user_register"("user_id");
CREATE UNIQUE INDEX "user_onboarding_meta_user_id_key" ON "user_onboarding_meta"("user_id");
CREATE UNIQUE INDEX "linked_accounts_user_id_provider_key" ON "linked_accounts"("user_id", "provider");
CREATE INDEX "linked_accounts_user_id_idx" ON "linked_accounts"("user_id");

-- AddForeignKey — cross-schema: public.users → auth.users (NOT modelled in Prisma)
ALTER TABLE "users" ADD CONSTRAINT "users_auth_user_id_fkey"
    FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — children → public.users
ALTER TABLE "user_ledger" ADD CONSTRAINT "user_ledger_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_register" ADD CONSTRAINT "user_register_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_onboarding_meta" ADD CONSTRAINT "user_onboarding_meta_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Signup trigger: seed the user row set on auth.users INSERT.
-- SECURITY DEFINER + locked empty search_path (Supabase hardening);
-- every object is schema-qualified. Idempotent (ON CONFLICT DO
-- NOTHING) so a re-fire or manual backfill never errors — a throwing
-- trigger would roll back the signup itself.
-- NOTE: updated_at is set explicitly here because the column has no
-- DB default (house convention: Prisma @updatedAt supplies it) and
-- this insert bypasses Prisma. created_at fills from its DB default.
-- EDIT 1: COALESCE(NEW.email, '') keeps email NOT NULL safe if a
-- future phone-auth signup carries a null email.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id TEXT;
BEGIN
    INSERT INTO public.users (auth_user_id, email, updated_at)
    VALUES (NEW.id, COALESCE(NEW.email, ''), now())
    ON CONFLICT (auth_user_id) DO NOTHING
    RETURNING id INTO v_user_id;

    -- Row already existed (re-fire / backfill) → nothing to seed.
    IF v_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.user_ledger (user_id, updated_at)
    VALUES (v_user_id, now()) ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_register (user_id, updated_at)          -- ai_level defaults 'balanced'
    VALUES (v_user_id, now()) ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_onboarding_meta (user_id, updated_at)   -- onboarding_complete defaults false
    VALUES (v_user_id, now()) ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Deny-all RLS (EDIT 2 — kept). Enables RLS with NO policies so these
-- PII/legal tables are unreachable via the anon/authenticated
-- PostgREST API. The backend (postgres role: table owner + BYPASSRLS)
-- and the SECURITY DEFINER trigger are unaffected. DATABASE_URL is
-- confirmed the Supabase postgres/pooler bypass role.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_register" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_onboarding_meta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "linked_accounts" ENABLE ROW LEVEL SECURITY;
