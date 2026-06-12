# Legacy v2 XBRL Backfill Module

This directory contains the **isolated v2 quarterly-results pipeline**, preserved exclusively for:

1. **Historical data backfill** — filling in quarters from before the v3 Integrated Filing pipeline was available.
2. **Disaster recovery** — if the v3 `integrated-filing-results` endpoint becomes unavailable and you need to recover data via the legacy `corporates-financial-results` endpoint.

---

## Why this module exists

The NSE has two XBRL filing systems:

| | v2 (this module) | v3 (going-forward) |
|---|---|---|
| **Discovery endpoint** | `/api/corporates-financial-results` | `/api/integrated-filing-results` |
| **XBRL namespace** | `in-bse-fin` | `in-capmkt-ent` (SEBI Integrated Filing) |
| **Filing coverage** | Quarterly only | Quarterly + Annual |
| **Industry granularity** | `ind_as` / `banking` only | `indas` / `banking` / `nbfc` / `li` / `gi` |
| **Data richness** | P&L only (9 fields) | P&L + Balance Sheet + CFS + per-share |

The v2 endpoint is being phased out by NSE. The v3 pipeline (`src/ingestions/quaterly-results/scan.ts`) is the authoritative going-forward path.

---

## When to call it

**Manual trigger only** via the admin API:

```bash
# Backfill all active stocks for a date range
curl -X POST http://localhost:3000/api/v1/admin/legacy-backfill/universe \
  -H "Content-Type: application/json" \
  -d '{ "fromDate": "2020-01-01", "toDate": "2023-12-31" }'

# Backfill a single symbol
curl -X POST http://localhost:3000/api/v1/admin/legacy-backfill/symbol \
  -H "Content-Type: application/json" \
  -d '{ "symbol": "TCS", "fromDate": "2019-01-01", "toDate": "2022-12-31" }'

# Poll job status
curl http://localhost:3000/api/v1/admin/jobs/<jobId>
```

Both endpoints enqueue a `legacy_backfill` job (retry policy: `maxAttempts=3`). The job runs asynchronously — the response returns a `jobId` immediately.

---

## Why NOT on a cron

- The v2 endpoint (`corporates-financial-results`) is deprecated and may be removed by NSE at any time.
- The v2 parser only extracts P&L (no balance sheet, no CFS, no per-share data).
- The v3 scanner (`RESULTS_SCAN` job, runs every 4 hours during earnings season) is the correct recurring pipeline.
- Running v2 on a cron would silently overwrite richer v3 data with sparse v2 data.

---

## Source tags written

All rows ingested via this module carry source `"nse_xbrl_quarterly_legacy"` in the `result_fetch_log` table. This lets you audit what came from v2 vs v3.

| Pipeline | `source` value |
|---|---|
| v3 quarterly scan | `"nse_xbrl_quarterly"` |
| v2 legacy backfill (this module) | `"nse_xbrl_quarterly_legacy"` |

---

## Files in this directory

| File | Description |
|---|---|
| `adapter.ts` | Converts v2 `ParsedQuarterlyResult` → v3 `ParsedQuarterly` shape |
| `backfill-legacy.ts` | Main orchestrator: `backfillLegacyUniverse()` / `backfillLegacySymbol()` |
| `discovery-legacy.ts` | v2 `fetchFilingsList()` (hits `corporates-financial-results`) + `fetchXbrlFile()` |
| `parser-legacy-common.ts` | v2 XBRL parser using `in-bse-fin` namespace |
| `ingester-legacy.ts` | v2 ingester writing to the old `QuarterlyResult` table (used by scan-legacy / CLI scripts) |
| `scan-legacy.ts` | v2 universe scanner (used by old admin route) |
| `universe-backfill-legacy.ts` | v2 universe backfill (used by `QUARTERLY_BACKFILL_UNIVERSE` job) |
| `backfill-results-legacy.ts` | CLI script: `tsx ... --symbol TCS --quarters 12` |
| `fetch-single-result-legacy.ts` | CLI script: `tsx ... --symbol TCS --quarter Q3 --fy FY25` |
| `README.md` | This file |

---

## Data flow

```
POST /api/v1/admin/legacy-backfill/{universe|symbol}
  └── enqueueJob(LEGACY_BACKFILL)
        └── handleLegacyBackfill (src/jobs/handlers/legacy-backfill.ts)
              └── backfillLegacyUniverse / backfillLegacySymbol
                    ├── fetchFilingsList()         [v2 discovery]
                    ├── fetchXbrlFile()            [shared HTTP fetcher]
                    ├── parseQuarterlyResultXbrl() [v2 in-bse-fin parser]
                    ├── adaptV2ToDispatchableQuarterly() [adapter]
                    └── dispatchQuarterlyIngest()  [v3 ingester → DB]
```

---

## Notes

- The v2 endpoint returns **quarterly results only**. Annual data (balance sheet, CFS) is not available via this pipeline; those fields are written as `null`.
- NBFC / Life Insurance / General Insurance taxonomies were not supported in v2. Any such filing encountered will be treated as `ind_as` (non-financial) by the v2 parser. For accurate NBFC/LI/GI data, use the v3 pipeline.
- The adapter sets `auditPending = false` for all historical banking data (it is already finalized).
