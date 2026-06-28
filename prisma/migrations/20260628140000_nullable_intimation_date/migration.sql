-- Make intimation_date nullable.
-- Pre-gg-migration filings (exchange_ref="NA") can carry a bad-source future
-- broadcastDateTime from NSE's gg index. We null those rows rather than
-- fabricating a value; the forward guard in normaliseXbrlRow skips them at
-- parse time going forward. tradeDate (from the signed XBRL document) is the
-- reliable fallback for both display ordering and Ownership-C scoring.
ALTER TABLE "insider_trades" ALTER COLUMN "intimation_date" DROP NOT NULL;
