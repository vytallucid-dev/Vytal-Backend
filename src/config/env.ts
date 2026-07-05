import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  // Supabase project URL — used to derive the Auth issuer and the JWKS
  // discovery endpoint ({SUPABASE_URL}/auth/v1/.well-known/jwks.json) that the
  // auth middleware verifies ES256 access tokens against. No secret needed:
  // the JWKS public key is safe to hold and rotates without a redeploy.
  SUPABASE_URL: process.env.SUPABASE_URL!,
  // Event-driven scoring triggers (Stage 3). Default ON; set
  // SCORING_TRIGGERS_ENABLED=false to disable ALL auto-rescore enqueues (the kill
  // switch) without a code change. When off, ingestion still writes data normally —
  // only the post-write PG_RESCORE enqueue is skipped.
  SCORING_TRIGGERS_ENABLED: process.env.SCORING_TRIGGERS_ENABLED !== "false",
};
