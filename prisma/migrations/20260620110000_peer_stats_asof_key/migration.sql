-- DropIndex
DROP INDEX "score_peer_stats_peer_group_id_metric_key_run_id_key";

-- CreateIndex
CREATE INDEX "score_peer_stats_peer_group_id_as_of_date_idx" ON "score_peer_stats"("peer_group_id", "as_of_date");

-- CreateIndex
CREATE UNIQUE INDEX "score_peer_stats_peer_group_id_metric_key_run_id_as_of_date_key" ON "score_peer_stats"("peer_group_id", "metric_key", "run_id", "as_of_date");
