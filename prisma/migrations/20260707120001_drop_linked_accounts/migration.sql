-- Retire the dead linked_accounts placeholder (0 rows, 0 code refs) -- superseded by
-- broker_connections (Phase 1). SEPARATED from 20260707120000 so this DESTRUCTIVE drop is
-- reviewed + applied on its own. Apply via the drift-safe db-execute + migrate-resolve path.
DROP TABLE IF EXISTS "linked_accounts";
