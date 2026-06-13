-- CreateEnum
CREATE TYPE "ScoringRunType" AS ENUM ('quarterly', 'live');

-- CreateEnum
CREATE TYPE "ScoringTriggerType" AS ENUM ('scheduled', 'post_ingest', 'manual_api');

-- CreateEnum
CREATE TYPE "ScoringRunStatus" AS ENUM ('running', 'success', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "BarDirection" AS ENUM ('higher_better', 'lower_better');

-- CreateEnum
CREATE TYPE "DerivationLayer" AS ENUM ('layer_a', 'layer_b', 'layer_c');

-- CreateEnum
CREATE TYPE "MarketSubComponent" AS ENUM ('range_52w', 'vs_200dma', 'volatility_vs_sector', 'trend_4q');

-- CreateEnum
CREATE TYPE "AnchorLiftRule" AS ENUM ('rule_5_3_1', 'rule_5_4_1');

-- CreateEnum
CREATE TYPE "OwnershipFlowBandType" AS ENUM ('c_net_insider', 'd_net_block', 'trend_bonus');

-- CreateEnum
CREATE TYPE "CoverageState" AS ENUM ('scored', 'covered', 'off_platform');

-- CreateEnum
CREATE TYPE "SnapshotType" AS ENUM ('quarterly', 'live');

-- CreateEnum
CREATE TYPE "LabelBand" AS ENUM ('fragile', 'below_par', 'steady', 'healthy', 'pristine');

-- CreateEnum
CREATE TYPE "WeightRedistributionReason" AS ENUM ('none', 'market_unavailable', 'missing_pillar', 'guardrail_suppression');

-- CreateEnum
CREATE TYPE "Pillar" AS ENUM ('foundation', 'momentum', 'market', 'ownership');

-- CreateEnum
CREATE TYPE "PillarState" AS ENUM ('scored', 'unavailable_redistributed');

-- CreateEnum
CREATE TYPE "MetricBand" AS ENUM ('excellent', 'good', 'acceptable', 'concerning', 'distress');

-- CreateEnum
CREATE TYPE "MarketBand" AS ENUM ('p0_p15', 'p15_p35', 'p35_p65', 'p65_p85', 'p85_p100');

-- CreateEnum
CREATE TYPE "LensFallback" AS ENUM ('none', 'l2_to_l1', 'l3_insufficient_history');

-- CreateEnum
CREATE TYPE "MetricScoreState" AS ENUM ('scored', 'suppressed', 'missing_renorm', 'neutral_hold');

-- CreateEnum
CREATE TYPE "OwnershipBaselineReason" AS ENUM ('insufficient_history_60', 'established_75');

-- CreateEnum
CREATE TYPE "FlowCategory" AS ENUM ('A_promoter', 'B_institutional', 'C_insider', 'D_block');

-- CreateEnum
CREATE TYPE "FlowCategoryState" AS ENUM ('scored', 'dormant_no_feed', 'dormant_no_data');

-- CreateEnum
CREATE TYPE "FlowTrendState" AS ENUM ('accelerating', 'steady', 'reversing');

-- CreateEnum
CREATE TYPE "GuardrailOutcome" AS ENUM ('O1', 'O2', 'O3', 'O4', 'O5', 'O6');

-- CreateEnum
CREATE TYPE "GuardrailTier" AS ENUM ('auto', 'review');

-- CreateEnum
CREATE TYPE "GuardrailRuling" AS ENUM ('upheld', 'overridden', 'deferred');

-- CreateTable
CREATE TABLE "score_spec_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "notes" TEXT,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_spec_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_runs" (
    "id" TEXT NOT NULL,
    "run_type" "ScoringRunType" NOT NULL,
    "trigger_type" "ScoringTriggerType" NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "status" "ScoringRunStatus" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "stocks_scored" INTEGER NOT NULL DEFAULT 0,
    "stocks_suppressed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_metric_bar_sets" (
    "id" TEXT NOT NULL,
    "bar_path" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "direction" "BarDirection" NOT NULL,
    "excellent" DECIMAL(18,4) NOT NULL,
    "good" DECIMAL(18,4) NOT NULL,
    "acceptable" DECIMAL(18,4) NOT NULL,
    "concerning" DECIMAL(18,4) NOT NULL,
    "distress" DECIMAL(18,4) NOT NULL,
    "in_force_from" DATE NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "provenance_id" TEXT NOT NULL,
    "derivation_layer" "DerivationLayer" NOT NULL,
    "inherits_from_peer_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_metric_bar_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_bar_provenance" (
    "id" TEXT NOT NULL,
    "derivation_layer" "DerivationLayer" NOT NULL,
    "method" TEXT NOT NULL,
    "sample_window" TEXT,
    "evidence" JSONB,
    "derived_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_bar_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_market_band_sets" (
    "id" TEXT NOT NULL,
    "peer_group_id" TEXT NOT NULL,
    "sub_component" "MarketSubComponent" NOT NULL,
    "version" INTEGER NOT NULL,
    "p15" DECIMAL(18,4) NOT NULL,
    "p35" DECIMAL(18,4) NOT NULL,
    "p65" DECIMAL(18,4) NOT NULL,
    "p85" DECIMAL(18,4) NOT NULL,
    "in_force_from" DATE NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_market_band_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_ownership_flow_band_sets" (
    "id" TEXT NOT NULL,
    "band_type" "OwnershipFlowBandType" NOT NULL,
    "version" INTEGER NOT NULL,
    "cuts" JSONB NOT NULL,
    "in_force_from" DATE NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_ownership_flow_band_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_peer_stats" (
    "id" TEXT NOT NULL,
    "peer_group_id" TEXT NOT NULL,
    "bar_path" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "mean" DECIMAL(18,4) NOT NULL,
    "std_dev" DECIMAL(18,4) NOT NULL,
    "sample_n" INTEGER NOT NULL,
    "anchor_lift_fired" BOOLEAN NOT NULL DEFAULT false,
    "anchor_lift_rule" "AnchorLiftRule",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_peer_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_band_mappings" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_band_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_stock_states" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "coverage_state" "CoverageState" NOT NULL,
    "coverage_reason" TEXT,
    "last_scored_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_stock_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_snapshots" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "snapshot_type" "SnapshotType" NOT NULL,
    "period_key" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "run_id" TEXT NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" TEXT,
    "peer_group_id" TEXT NOT NULL,
    "bar_path" TEXT NOT NULL,
    "industry_path" TEXT NOT NULL,
    "composite" DECIMAL(8,4) NOT NULL,
    "label_band" "LabelBand" NOT NULL,
    "band_mapping_version_id" TEXT NOT NULL,
    "foundation_pillar_id" TEXT NOT NULL,
    "momentum_pillar_id" TEXT NOT NULL,
    "market_pillar_id" TEXT NOT NULL,
    "ownership_pillar_id" TEXT NOT NULL,
    "foundation_subtotal" DECIMAL(8,4) NOT NULL,
    "momentum_subtotal" DECIMAL(8,4) NOT NULL,
    "market_subtotal" DECIMAL(8,4) NOT NULL,
    "ownership_subtotal" DECIMAL(8,4) NOT NULL,
    "w_foundation" DECIMAL(8,4) NOT NULL,
    "w_momentum" DECIMAL(8,4) NOT NULL,
    "w_market" DECIMAL(8,4) NOT NULL,
    "w_ownership" DECIMAL(8,4) NOT NULL,
    "weight_redistribution_reason" "WeightRedistributionReason" NOT NULL DEFAULT 'none',
    "divergence" DECIMAL(8,4) NOT NULL,
    "inputs_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_pillars" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "pillar" "Pillar" NOT NULL,
    "subtotal" DECIMAL(8,4) NOT NULL,
    "pillar_state" "PillarState" NOT NULL DEFAULT 'scored',
    "source_period" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "run_id" TEXT NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "inputs_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_pillars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_metrics" (
    "id" TEXT NOT NULL,
    "pillar_score_id" TEXT NOT NULL,
    "pillar" "Pillar" NOT NULL,
    "metric_key" TEXT NOT NULL,
    "raw_value" DECIMAL(18,4) NOT NULL,
    "l1_score" DECIMAL(8,4),
    "l2_score" DECIMAL(8,4),
    "l3_score" DECIMAL(8,4),
    "metric_score" DECIMAL(8,4) NOT NULL,
    "l1_band" "MetricBand",
    "metric_bar_set_id" TEXT,
    "l2_anchor_fired" BOOLEAN NOT NULL DEFAULT false,
    "l2_anchor_applied" DECIMAL(8,4),
    "peer_stats_snapshot_id" TEXT,
    "l3_mean" DECIMAL(18,4),
    "l3_std_dev" DECIMAL(18,4),
    "l3_window_n" INTEGER,
    "l3_anchor_fired" BOOLEAN NOT NULL DEFAULT false,
    "l3_anchor_applied" DECIMAL(8,4),
    "l1_available" BOOLEAN NOT NULL DEFAULT true,
    "l2_available" BOOLEAN NOT NULL DEFAULT true,
    "l3_available" BOOLEAN NOT NULL DEFAULT true,
    "lens_fallback_applied" "LensFallback" NOT NULL DEFAULT 'none',
    "nominal_weight" DECIMAL(8,4) NOT NULL,
    "effective_weight" DECIMAL(8,4) NOT NULL,
    "contribution" DECIMAL(8,4) NOT NULL,
    "score_state" "MetricScoreState" NOT NULL,
    "included_in_peer_stats" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_market_subs" (
    "id" TEXT NOT NULL,
    "pillar_score_id" TEXT NOT NULL,
    "sub_component" "MarketSubComponent" NOT NULL,
    "raw_value" DECIMAL(18,4) NOT NULL,
    "band_score" DECIMAL(8,4) NOT NULL,
    "band_landed" "MarketBand" NOT NULL,
    "market_band_set_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_market_subs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_ownership" (
    "id" TEXT NOT NULL,
    "pillar_score_id" TEXT NOT NULL,
    "baseline" DECIMAL(8,4) NOT NULL,
    "baseline_reason" "OwnershipBaselineReason" NOT NULL,
    "pledging_adjustment" DECIMAL(8,4) NOT NULL,
    "penalty_r2" DECIMAL(8,4) NOT NULL,
    "penalty_r6" DECIMAL(8,4) NOT NULL,
    "penalty_prolonged_fii" DECIMAL(8,4) NOT NULL,
    "primary_subtotal" DECIMAL(8,4) NOT NULL,
    "flow_adjustment_raw" DECIMAL(8,4) NOT NULL,
    "flow_adjustment_clamped" DECIMAL(8,4) NOT NULL,
    "final_ownership" DECIMAL(8,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_ownership_flows" (
    "id" TEXT NOT NULL,
    "ownership_score_id" TEXT NOT NULL,
    "category" "FlowCategory" NOT NULL,
    "raw_sub_score" DECIMAL(8,4) NOT NULL,
    "cap_applied" DECIMAL(8,4) NOT NULL,
    "capped_sub_score" DECIMAL(8,4) NOT NULL,
    "category_state" "FlowCategoryState" NOT NULL,
    "band_landed" TEXT,
    "net_flow_value" DECIMAL(18,4),
    "trend_state" "FlowTrendState",
    "flow_band_set_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_ownership_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_patterns" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "pattern_key" TEXT NOT NULL,
    "direction" TEXT,
    "severity" TEXT,
    "evidence" JSONB,
    "metric_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_red_flags" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "flag_key" TEXT NOT NULL,
    "severity" TEXT,
    "tier" "GuardrailTier" NOT NULL,
    "triggering_values" JSONB,
    "guardrail_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_red_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_guardrail_events" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "signature_key" TEXT NOT NULL,
    "triggering_values" JSONB,
    "outcome" "GuardrailOutcome" NOT NULL,
    "tier" "GuardrailTier" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_guardrail_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_suppressions" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "source_guardrail_event_id" TEXT NOT NULL,
    "outcome" "GuardrailOutcome" NOT NULL,
    "exclude_from_own_score" BOOLEAN NOT NULL DEFAULT true,
    "exclude_from_peer_mean" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_guardrail_reviews" (
    "id" TEXT NOT NULL,
    "guardrail_event_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "ruling" "GuardrailRuling" NOT NULL,
    "reason" TEXT,
    "ruled_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_guardrail_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_sector_health" (
    "id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "mean_composite" DECIMAL(8,4) NOT NULL,
    "member_count" INTEGER NOT NULL,
    "spec_version_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_sector_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "score_spec_versions_version_key" ON "score_spec_versions"("version");

-- CreateIndex
CREATE INDEX "score_runs_run_type_as_of_date_idx" ON "score_runs"("run_type", "as_of_date");

-- CreateIndex
CREATE INDEX "score_metric_bar_sets_bar_path_metric_key_in_force_from_idx" ON "score_metric_bar_sets"("bar_path", "metric_key", "in_force_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "score_metric_bar_sets_bar_path_metric_key_version_key" ON "score_metric_bar_sets"("bar_path", "metric_key", "version");

-- CreateIndex
CREATE INDEX "score_market_band_sets_peer_group_id_sub_component_in_force_idx" ON "score_market_band_sets"("peer_group_id", "sub_component", "in_force_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "score_market_band_sets_peer_group_id_sub_component_version_key" ON "score_market_band_sets"("peer_group_id", "sub_component", "version");

-- CreateIndex
CREATE INDEX "score_ownership_flow_band_sets_band_type_in_force_from_idx" ON "score_ownership_flow_band_sets"("band_type", "in_force_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "score_ownership_flow_band_sets_band_type_version_key" ON "score_ownership_flow_band_sets"("band_type", "version");

-- CreateIndex
CREATE INDEX "score_peer_stats_run_id_metric_key_idx" ON "score_peer_stats"("run_id", "metric_key");

-- CreateIndex
CREATE UNIQUE INDEX "score_peer_stats_peer_group_id_metric_key_run_id_key" ON "score_peer_stats"("peer_group_id", "metric_key", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_band_mappings_version_key" ON "score_band_mappings"("version");

-- CreateIndex
CREATE INDEX "score_stock_states_stock_id_created_at_idx" ON "score_stock_states"("stock_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "score_stock_states_coverage_state_idx" ON "score_stock_states"("coverage_state");

-- CreateIndex
CREATE INDEX "score_snapshots_stock_id_snapshot_type_as_of_date_idx" ON "score_snapshots"("stock_id", "snapshot_type", "as_of_date" DESC);

-- CreateIndex
CREATE INDEX "score_snapshots_peer_group_id_period_key_idx" ON "score_snapshots"("peer_group_id", "period_key");

-- CreateIndex
CREATE INDEX "score_snapshots_period_key_composite_idx" ON "score_snapshots"("period_key", "composite");

-- CreateIndex
CREATE INDEX "score_snapshots_as_of_date_label_band_idx" ON "score_snapshots"("as_of_date", "label_band");

-- CreateIndex
CREATE UNIQUE INDEX "score_snapshots_stock_id_snapshot_type_period_key_version_key" ON "score_snapshots"("stock_id", "snapshot_type", "period_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "score_snapshots_supersedes_id_key" ON "score_snapshots"("supersedes_id");

-- CreateIndex
CREATE INDEX "score_pillars_stock_id_pillar_as_of_date_idx" ON "score_pillars"("stock_id", "pillar", "as_of_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "score_pillars_stock_id_pillar_inputs_fingerprint_key" ON "score_pillars"("stock_id", "pillar", "inputs_fingerprint");

-- CreateIndex
CREATE INDEX "score_metrics_pillar_score_id_idx" ON "score_metrics"("pillar_score_id");

-- CreateIndex
CREATE INDEX "score_metrics_metric_key_score_state_idx" ON "score_metrics"("metric_key", "score_state");

-- CreateIndex
CREATE UNIQUE INDEX "score_metrics_pillar_score_id_metric_key_key" ON "score_metrics"("pillar_score_id", "metric_key");

-- CreateIndex
CREATE INDEX "score_market_subs_pillar_score_id_idx" ON "score_market_subs"("pillar_score_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_market_subs_pillar_score_id_sub_component_key" ON "score_market_subs"("pillar_score_id", "sub_component");

-- CreateIndex
CREATE UNIQUE INDEX "score_ownership_pillar_score_id_key" ON "score_ownership"("pillar_score_id");

-- CreateIndex
CREATE INDEX "score_ownership_flows_ownership_score_id_idx" ON "score_ownership_flows"("ownership_score_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_ownership_flows_ownership_score_id_category_key" ON "score_ownership_flows"("ownership_score_id", "category");

-- CreateIndex
CREATE INDEX "score_patterns_as_of_date_pattern_key_idx" ON "score_patterns"("as_of_date", "pattern_key");

-- CreateIndex
CREATE INDEX "score_patterns_snapshot_id_idx" ON "score_patterns"("snapshot_id");

-- CreateIndex
CREATE INDEX "score_red_flags_as_of_date_flag_key_idx" ON "score_red_flags"("as_of_date", "flag_key");

-- CreateIndex
CREATE INDEX "score_red_flags_snapshot_id_idx" ON "score_red_flags"("snapshot_id");

-- CreateIndex
CREATE INDEX "score_red_flags_tier_idx" ON "score_red_flags"("tier");

-- CreateIndex
CREATE INDEX "score_guardrail_events_snapshot_id_idx" ON "score_guardrail_events"("snapshot_id");

-- CreateIndex
CREATE INDEX "score_guardrail_events_signature_key_outcome_idx" ON "score_guardrail_events"("signature_key", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "score_guardrail_events_snapshot_id_signature_key_key" ON "score_guardrail_events"("snapshot_id", "signature_key");

-- CreateIndex
CREATE INDEX "score_suppressions_snapshot_key_metric_key_idx" ON "score_suppressions"("snapshot_key", "metric_key");

-- CreateIndex
CREATE UNIQUE INDEX "score_suppressions_stock_id_snapshot_key_metric_key_key" ON "score_suppressions"("stock_id", "snapshot_key", "metric_key");

-- CreateIndex
CREATE INDEX "score_guardrail_reviews_guardrail_event_id_ruled_at_idx" ON "score_guardrail_reviews"("guardrail_event_id", "ruled_at" DESC);

-- CreateIndex
CREATE INDEX "score_sector_health_as_of_date_idx" ON "score_sector_health"("as_of_date");

-- CreateIndex
CREATE UNIQUE INDEX "score_sector_health_sector_id_run_id_key" ON "score_sector_health"("sector_id", "run_id");

-- AddForeignKey
ALTER TABLE "score_runs" ADD CONSTRAINT "score_runs_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_metric_bar_sets" ADD CONSTRAINT "score_metric_bar_sets_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_metric_bar_sets" ADD CONSTRAINT "score_metric_bar_sets_provenance_id_fkey" FOREIGN KEY ("provenance_id") REFERENCES "score_bar_provenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_market_band_sets" ADD CONSTRAINT "score_market_band_sets_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_ownership_flow_band_sets" ADD CONSTRAINT "score_ownership_flow_band_sets_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_peer_stats" ADD CONSTRAINT "score_peer_stats_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "score_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_stock_states" ADD CONSTRAINT "score_stock_states_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "score_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_band_mapping_version_id_fkey" FOREIGN KEY ("band_mapping_version_id") REFERENCES "score_band_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_foundation_pillar_id_fkey" FOREIGN KEY ("foundation_pillar_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_momentum_pillar_id_fkey" FOREIGN KEY ("momentum_pillar_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_market_pillar_id_fkey" FOREIGN KEY ("market_pillar_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_ownership_pillar_id_fkey" FOREIGN KEY ("ownership_pillar_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "score_snapshots"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_pillars" ADD CONSTRAINT "score_pillars_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_pillars" ADD CONSTRAINT "score_pillars_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "score_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_pillars" ADD CONSTRAINT "score_pillars_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_metrics" ADD CONSTRAINT "score_metrics_pillar_score_id_fkey" FOREIGN KEY ("pillar_score_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_metrics" ADD CONSTRAINT "score_metrics_metric_bar_set_id_fkey" FOREIGN KEY ("metric_bar_set_id") REFERENCES "score_metric_bar_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_metrics" ADD CONSTRAINT "score_metrics_peer_stats_snapshot_id_fkey" FOREIGN KEY ("peer_stats_snapshot_id") REFERENCES "score_peer_stats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_market_subs" ADD CONSTRAINT "score_market_subs_pillar_score_id_fkey" FOREIGN KEY ("pillar_score_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_market_subs" ADD CONSTRAINT "score_market_subs_market_band_set_id_fkey" FOREIGN KEY ("market_band_set_id") REFERENCES "score_market_band_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_ownership" ADD CONSTRAINT "score_ownership_pillar_score_id_fkey" FOREIGN KEY ("pillar_score_id") REFERENCES "score_pillars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_ownership_flows" ADD CONSTRAINT "score_ownership_flows_ownership_score_id_fkey" FOREIGN KEY ("ownership_score_id") REFERENCES "score_ownership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_ownership_flows" ADD CONSTRAINT "score_ownership_flows_flow_band_set_id_fkey" FOREIGN KEY ("flow_band_set_id") REFERENCES "score_ownership_flow_band_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_patterns" ADD CONSTRAINT "score_patterns_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "score_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_red_flags" ADD CONSTRAINT "score_red_flags_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "score_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_red_flags" ADD CONSTRAINT "score_red_flags_guardrail_event_id_fkey" FOREIGN KEY ("guardrail_event_id") REFERENCES "score_guardrail_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_guardrail_events" ADD CONSTRAINT "score_guardrail_events_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_guardrail_events" ADD CONSTRAINT "score_guardrail_events_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "score_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_suppressions" ADD CONSTRAINT "score_suppressions_source_guardrail_event_id_fkey" FOREIGN KEY ("source_guardrail_event_id") REFERENCES "score_guardrail_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_guardrail_reviews" ADD CONSTRAINT "score_guardrail_reviews_guardrail_event_id_fkey" FOREIGN KEY ("guardrail_event_id") REFERENCES "score_guardrail_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_sector_health" ADD CONSTRAINT "score_sector_health_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "score_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_sector_health" ADD CONSTRAINT "score_sector_health_spec_version_id_fkey" FOREIGN KEY ("spec_version_id") REFERENCES "score_spec_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
