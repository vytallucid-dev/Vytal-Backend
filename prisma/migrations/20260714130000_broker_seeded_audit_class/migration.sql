-- ═══════════════════════════════════════════════════════════════
-- THE BROKER-SEEDED AUDIT CLASS (Step 17, Part C) — an INFORMATIONAL row in a FAULT table.
--
-- WHAT THIS IS FOR. When a broker surfaces a holding whose ISIN we have never seen, Part B admits it
-- to the catalogue (a stock, or a bond, per its ISIN). That admission is a real change to shared,
-- canonical data and an operator must be able to SEE it — but it is NOT A FAULT. Nothing is broken,
-- nothing needs fixing, and nobody should be paged. It is a NOTIFICATION.
--
-- WHY IT SHARES `ingestion_errors` RATHER THAN GETTING ITS OWN TABLE. This table already carries a
-- SECOND, non-ingestion class: SCORING errors (source="scoring", guardType scoring_*, a synthetic
-- cron). That precedent established the pattern — a new class rides the shared triage table, its own
-- guardType keeps it from colliding on the dedup key, and it inherits the lifecycle/UI/occurrences
-- machinery for free. This is the same move a third time. A parallel table would duplicate all of it.
--
-- THE ONE THING THE ENUM CANNOT ENFORCE, so it is said here and enforced in code:
-- `info` IS NOT A SEVERITY. It is the ABSENCE of one. Every existing consumer that reasons about
-- severity (the triage list default, the fault count, the operator's queue) MUST exclude it, or a
-- healthy auto-admit will read as a problem and the fault-vs-honest-empty line this codebase is
-- built on quietly dissolves. The controller does exactly that (guard_type != 'broker_seeded' on the
-- default read), and Gate 3 proves the open-fault count does not move when an admission fires.
--
-- Both values are ADDITIVE. No existing row changes, no column is dropped, no default moves.
-- IF NOT EXISTS makes a re-apply a no-op.
--
-- ALONE IN ITS TRANSACTION, and this is not a style choice: Postgres permits `ALTER TYPE … ADD
-- VALUE` inside a tx block (PG12+), but the new label CANNOT BE USED until that tx COMMITS. Any
-- INSERT casting to 'broker_seeded'/'info' must therefore run in a LATER transaction — which it
-- does: the audit write is a runtime event, long after this has committed. Do NOT merge this file
-- with a data migration.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL, then `migrate resolve --applied`.
-- ═══════════════════════════════════════════════════════════════

-- The guard family. Not a guard at all, in truth — it is the audit class, and it is named for what
-- it records (an instrument the BROKER seeded) rather than for a rule that tripped.
ALTER TYPE "GuardType" ADD VALUE IF NOT EXISTS 'broker_seeded';

-- The non-severity. Sits BELOW `low` in sort order, which is the honest place for it: it is not a
-- quieter problem, it is not a problem.
ALTER TYPE "IngestionSeverity" ADD VALUE IF NOT EXISTS 'info';
