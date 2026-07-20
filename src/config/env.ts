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
  // Broker integration (Phase 1) — 32-byte AES-256-GCM key (base64) that encrypts broker
  // session/token blobs at rest. Generate: randomBytes(32).toString("base64"). Read lazily
  // by src/brokers/crypto.ts (fail-closed if absent); listed here for discoverability.
  BROKER_TOKEN_ENC_KEY: process.env.BROKER_TOKEN_ENC_KEY,
  // Zerodha Kite Connect (broker adapter, Phase 2a). Registered on the Kite developer
  // console → api_key + api_secret + the ONE redirect URL. ⚠️ KITE_API_SECRET is
  // SERVER-SIDE ONLY: used solely in the backend token-exchange checksum, NEVER sent to a
  // client, put in a response, or placed in a login URL. Read lazily by adapters/zerodha.ts
  // (fail-closed → 503 if absent; the platform still runs). Listed here for discoverability.
  KITE_API_KEY: process.env.KITE_API_KEY,
  KITE_API_SECRET: process.env.KITE_API_SECRET,
  KITE_REDIRECT_URI: process.env.KITE_REDIRECT_URI,
};
