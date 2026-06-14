# Bank Supplementary — JSON Upload Format (authoritative contract)

Manually-entered banking figures that are **not** in the Reg-33 XBRL and are
disclosed only in investor presentations / press releases:

| metric      | meaning                  | unit              | example |
| ----------- | ------------------------ | ----------------- | ------- |
| `casa_pct`  | CASA ratio               | **percent** (0–100) | `43.82` |
| `tier1_pct` | Tier-1 capital ratio     | **percent** (0–100) | `14.50` |

> Units are **percent, never a fraction**. `43.82` means 43.82%, not 0.4382.

These figures are hand-entered **with a source citation**. The discipline is
*"a verified figure or explicit MISSING — never a guess."* A value with no
source is rejected at ingest.

This document is the authoritative spec the frontend upload/export must conform
to. The backend route is `POST /api/v1/admin/bank-supplementary` and accepts a
single JSON body (one upload may contain many entries).

---

## Canonical JSON contract

```jsonc
{
  "enteredBy": "user:aman",          // required, non-empty — audit trail
  "entries": [
    {
      "symbol": "HDFCBANK",          // required — must be an existing BANK
      "metric": "casa_pct",          // required — "casa_pct" | "tier1_pct"
      "fiscalYear": "FY24",          // required — /^FY\d{2}$/
      "quarter": "Q3",               // optional — "Q1".."Q4"; OMIT or null = ANNUAL figure
      "value": 43.82,                // required — number, percent, 0..100
      "sourceCitation": "Q3FY24 Investor Presentation, slide 12", // required, non-empty
      "sourceDate": "2024-01-20"     // required — "YYYY-MM-DD"
    }
    // ... more entries
  ]
}
```

### Field rules

| field            | required | rule |
| ---------------- | -------- | ---- |
| `enteredBy`      | yes      | non-empty string (e.g. `"user:aman"`) |
| `symbol`         | yes      | resolves to an existing `Stock` whose `industryType === "banking"`. Non-bank symbols are rejected (CASA/Tier-1 are bank-only). Case-insensitive; stored upper-cased. |
| `metric`         | yes      | one of `casa_pct`, `tier1_pct` |
| `fiscalYear`     | yes      | `"FY"` + exactly 2 digits (e.g. `"FY24"`) |
| `quarter`        | no       | `"Q1".."Q4"`; **omit or `null` for an annual figure** |
| `value`          | yes      | number in **[0, 100]** (percent). `<0` or `>100` is rejected as absurd. |
| `sourceCitation` | yes      | non-empty after trim — the hard "no sourceless values" rule |
| `sourceDate`     | yes      | `"YYYY-MM-DD"` (the date the disclosure was published/dated) |

---

## Validation is ATOMIC (all-or-nothing)

The whole upload is validated **before** anything is written. If **any** entry
fails, **nothing** is written and the response lists a reason per rejected
entry. A partially-bad file never half-loads.

---

## Append-only + supersede (idempotency)

Rows are **never updated in place**. There is no `updatedAt`. A cell is the tuple
`(stockId, metric, fiscalYear, quarter)`. For each valid entry:

| existing state of the cell                              | action       | what happens |
| ------------------------------------------------------- | ------------ | ------------ |
| no row yet                                              | `inserted`   | insert `version = 1` |
| latest row has the **same** `value` **and** `sourceCitation` | `unchanged`  | no-op (skip) |
| latest row has a **different** `value` **or** `sourceCitation` | `superseded` | insert `version = N+1` with `supersedesId` → the prior row |

**Reads take the newest version** (`MAX(version)`) for the cell — see
`getBankSupplementary()`. The old versions are retained as history; nothing is
deleted or mutated.

> Note: "same / different" compares `value` and `sourceCitation` only. Re-entering
> the same value+citation with a different `sourceDate` is treated as `unchanged`.

---

## Period keying (annual vs quarterly)

`fiscalYear` is always present (matches how `BankingFundamental` keys periods).
`quarter` is **nullable**: `null` (omitted) denotes the **annual** figure; a
`Q1..Q4` value denotes that quarter. Annual and quarterly figures for the same
`fiscalYear` are distinct cells and coexist.

> **DB caveat:** the unique index `(stock_id, metric, fiscal_year, quarter,
> version)` does not enforce uniqueness for **annual** rows, because Postgres
> treats `NULL` as distinct in unique indexes. The ingest route's
> read-before-write supersede check (run inside a transaction) is the
> authoritative guard for annual rows. Quarterly rows are additionally
> DB-enforced.

---

## Response

### Success (`200`)

```jsonc
{
  "success": true,
  "data": {
    "ok": true,
    "summary": { "inserted": 1, "superseded": 1, "unchanged": 0, "rejected": 0, "total": 2 },
    "results": [
      { "index": 0, "symbol": "HDFCBANK", "metric": "casa_pct", "fiscalYear": "FY24",
        "quarter": "Q3", "action": "inserted",   "version": 1, "rowId": "…" },
      { "index": 1, "symbol": "ICICIBANK", "metric": "tier1_pct", "fiscalYear": "FY22",
        "quarter": null, "action": "superseded", "version": 2, "rowId": "…" }
    ],
    "rejected": []
  }
}
```

### Rejected (`400`) — nothing written

```jsonc
{
  "success": false,
  "error": "Upload rejected (all-or-nothing): 1 of 2 entries invalid. No rows written.",
  "data": {
    "summary": { "inserted": 0, "superseded": 0, "unchanged": 0, "rejected": 1, "total": 2 },
    "rejected": [
      { "index": 1, "symbol": "INFY",
        "reason": "symbol \"INFY\" is not a bank (industryType=non_financial); CASA/Tier-1 are bank-only" }
    ]
  }
}
```

A malformed envelope (missing `enteredBy`, `entries` not a non-empty array) also
returns `400` with `details` from schema validation.

---

## Worked example

**Upload A** (2 new cells):

```json
{
  "enteredBy": "user:aman",
  "entries": [
    { "symbol": "HDFCBANK", "metric": "casa_pct", "fiscalYear": "FY24", "quarter": "Q3",
      "value": 43.82, "sourceCitation": "Q3FY24 Investor Presentation, slide 12", "sourceDate": "2024-01-20" },
    { "symbol": "ICICIBANK", "metric": "tier1_pct", "fiscalYear": "FY22",
      "value": 17.60, "sourceCitation": "FY22 Annual Report, pg 84", "sourceDate": "2022-05-10" }
  ]
}
```
→ `inserted: 2` (HDFCBANK CASA Q3FY24 v1; ICICIBANK Tier-1 FY22 annual v1).

**Upload B** (one unchanged, one corrected):

```json
{
  "enteredBy": "user:aman",
  "entries": [
    { "symbol": "HDFCBANK", "metric": "casa_pct", "fiscalYear": "FY24", "quarter": "Q3",
      "value": 43.82, "sourceCitation": "Q3FY24 Investor Presentation, slide 12", "sourceDate": "2024-01-20" },
    { "symbol": "ICICIBANK", "metric": "tier1_pct", "fiscalYear": "FY22",
      "value": 17.60, "sourceCitation": "FY22 Annual Report, pg 86 (restated)", "sourceDate": "2022-05-10" }
  ]
}
```
→ `unchanged: 1` (HDFCBANK identical) + `superseded: 1` (ICICIBANK citation
changed → new `version 2` pointing `supersedesId` at v1). `getBankSupplementary`
for ICICIBANK Tier-1 FY22 now returns the v2 citation.
