-- Migration: 20260614140000_fix_flow_trend_state_enum
-- Replace FlowTrendState {accelerating, steady, reversing} with the correct
-- direction-persistence states {three_up, three_down, mixed, neutral}.
--
-- The old values were a rate-of-change concept left over from early schema design;
-- the engine has always computed {three_up, three_down, mixed, neutral} and mapped
-- them lossily (mixed→steady, neutral→null). This migration corrects the enum so
-- the stored state is faithful, with no information loss.
--
-- Safety: score_ownership_flows has ZERO rows. Ownership is still DRY-RUN — the
-- first committed write is gated on a complete 4-pillar ScoreSnapshot. The USING
-- cast below is never evaluated; confirmed by the dry-run gate (zero rows in
-- score_ownership_flows since the table was created).

ALTER TYPE "FlowTrendState" RENAME TO "FlowTrendState_old";

CREATE TYPE "FlowTrendState" AS ENUM ('three_up', 'three_down', 'mixed', 'neutral');

ALTER TABLE "score_ownership_flows"
  ALTER COLUMN "trend_state" TYPE "FlowTrendState"
  USING "trend_state"::text::"FlowTrendState";

DROP TYPE "FlowTrendState_old";
