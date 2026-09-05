-- The promoter group's TOTAL holding (XBRL `NumberOfShares` at the promoter aggregate context),
-- including depository receipts. This is the denominator the filing's own pledge percentage uses.
--
-- `promoter_shares` (NumberOfFullyPaidUpEquityShares) keeps its meaning: N6 promoter accumulation,
-- the ingestion guards and the company snapshot all read it, and the ruling was about the pledge
-- percentage alone. Measured: 2 of 353 live-pledge stocks have the two counts differ, and exactly one
-- (ASHOKLEY, 51.4% -> 40.1%) crosses R1's 50% bar because of it.
--
-- Additive and nullable: no backfill, no column altered, no data rewritten by this statement.
ALTER TABLE "shareholding_patterns" ADD COLUMN "promoter_total_shares" BIGINT;
