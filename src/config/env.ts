import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  // Event-driven scoring triggers (Stage 3). Default ON; set
  // SCORING_TRIGGERS_ENABLED=false to disable ALL auto-rescore enqueues (the kill
  // switch) without a code change. When off, ingestion still writes data normally —
  // only the post-write PG_RESCORE enqueue is skipped.
  SCORING_TRIGGERS_ENABLED: process.env.SCORING_TRIGGERS_ENABLED !== "false",
};
