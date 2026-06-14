# Vytal Health Score — Scoring-Persistence Schema Design

**Status:** DRAFT FOR REVIEW — design + rationale only. No Prisma, no SQL, no migration.
Lock §G and the overall shape before the migration is written.

---

## 0. Framing & conventions inherited from the input layer

This is a **new, separate SCORING layer**. It reads the input tables
(`Fundamental`, `QuarterlyResult`, `BankingFundamental`, `ShareholdingPattern`,
`DailyPrice`, `InsiderTrade`, `BlockDeal`, `CorporateEvent`, …) and writes scores.
It does **not** modify any input table, and it does **not** reuse
`PeerGroup.avg*` or `Sector` JSONB (valuation/placeholder, wrong shape, mutable).

Conventions carried over from the existing schema so this layer reads like the
rest of the codebase:

- **Append-only signal = `createdAt` only, no `updatedAt`.** `DailyPrice` and
  `ShareholdingPattern` (the two exemplars you pointed at) deliberately omit
  `updatedAt`. **Every scoring table follows this**: a row is written once and
  never updated in place. A correction or recompute is a *new row*. The presence
  of an `updatedAt` column would itself be a bug in this layer.
- `uuid` PKs (matching the append-only exemplars), `@map`/`@@map` snake_case,
  `Decimal(8,4)` for percentages / 0–100 scores, `onDelete: Cascade` from any
  per-stock row to `Stock`.
- Denormalised `symbol` / `pgId` on wide scan rows for join-free universe queries
  (the schema already does this on `ShareholdingPattern`, `InsiderTrade`,
  `CorporateEvent`).
- All scoring tables share a `score_` table-name prefix so they cluster in the DB.

**Four independent version axes** (decoupled on purpose — a re-band must not bump
the spec, a bar re-derivation must not bump the weight policy):

| Axis | Lives in | Bumped when |
|------|----------|-------------|
| Spec version | `ScoringSpecVersion` | the §-numbered methodology changes |
| Bar version | `MetricBarSet` / `MarketBandSet` | a threshold is re-derived |
| Peer-stats snapshot | `PeerStatsSnapshot` | each computation run restamps μ/σ |
| Band-mapping version | `BandMappingVersion` | band→label→colour remap |

---

## A. Table inventory

Grouped by role. "Grain" = what exactly one row represents.

### A.1 — Versioning / reproducibility spine (the anchors req 2 & 4 & 5 demand)

| # | Table (`@@map`) | Purpose | Grain | Serves |
|---|------|---------|-------|--------|
| 1 | `ScoringSpecVersion` (`score_spec_versions`) | Registry of the §-numbered methodology in force. | one spec version | req 2, 11 |
| 2 | `ScoringRun` (`score_runs`) | One computation run (the `computationRunId` every score FKs). Trigger, timing, spec, counts, status. | one run | req 2, 11 |
| 3 | `MetricBarSet` (`score_metric_bar_sets`) | Versioned 5-threshold bar set for L1, per (barPath, metric, version). **5 thresholds = hot relational columns** (locked). | one (barPath, metric, version) | req 4 |
| 4 | `BarProvenance` (`score_bar_provenance`) | **Cold** Layer A/B/C derivation evidence, referenced (not normalised per-observation) by a bar set. | one provenance record | req 4 (locked: cold) |
| 5 | `MarketBandSet` (`score_market_band_sets`) | Versioned band cuts for the 4 Market sub-components ("ALSO versioned bars"). | one (subComponent, version) | req 4 (Market) |
| 6 | `PeerStatsSnapshot` (`score_peer_stats`) | L2 peer μ/σ per (PG, metric, run), N, and **anchor-lift-fired** (§5.3.1/§5.4.1). | one (PG, metric, run) | req 5 |
| 7 | `BandMappingVersion` (`score_band_mappings`) | Single source for band→label→colour. | one mapping version | req 10 |

### A.2 — Per-stock scoring state (satellite of the off-limits `Stock`)

| # | Table | Purpose | Grain | Serves |
|---|------|---------|-------|--------|
| 8 | `StockScoringState` (`score_stock_states`) | Coverage state (`SCORED`/`COVERED`/`OFF_PLATFORM`), **independent of PG assignment**. Lives here because `Stock` is input-layer and we must not modify it. | one per stock (1:1) | req 13 |

### A.3 — The score spine (composite → pillar → leaf)

| # | Table | Purpose | Grain | Decomp. shape / serves |
|---|------|---------|-------|--------|
| 9 | `ScoreSnapshot` (`score_snapshots`) | **The composite row.** Carries composite, label + mapping version, the 4 pillar subtotals (denormalised), applied weight set (inline), divergence value, snapshot type/as-of/spec/run, and PG+barPath captured *at stamp time*. | one (stock, snapshot) | req 1,2,3,10,11; QP1,2,3,4,5 |
| 10 | `PillarScore` (`score_pillars`) | Composite→pillar level. Subtotal, applied intra-composite weight, contribution, pillar state, and the **source period** each pillar consumed (annual FY / quarter / price date). | one (snapshot, pillar) — 4 rows | req 3; QP1 |
| 11 | `MetricScore` (`score_metrics`) | **3-lens leaf** for Foundation + Momentum. **One row per (snapshot, metric), L1/L2/L3 as columns** (locked, CN-3). | one (snapshot, metric) | **Shape 1**; req 3,8; QP1,6 |
| 12 | `MarketSubScore` (`score_market_subs`) | The 4 rule-based Market sub-components, band-scored. | one (snapshot, subComponent) — 4 rows | **Shape 2**; QP1 |
| 13 | `OwnershipScore` (`score_ownership`) | Ownership **primary sublayer** (baseline + pledging adj + disturbance penalties → primary subtotal) + flow rollup (flow adj raw → clamped → final clamped). | one (snapshot) | **Shape 3**; req 3 |
| 14 | `OwnershipFlowCategory` (`score_ownership_flows`) | The 4 **flow categories** (A Promoter, B Institutional, C Insider, D Block), each capped, with explicit state. | one (snapshot, category) — 4 rows | **Shape 4**; req 9 |

### A.4 — Signals, guardrails, caches

| # | Table | Purpose | Grain | Serves |
|---|------|---------|-------|--------|
| 15 | `ScorePattern` (`score_patterns`) | First-class detected patterns (divergence, trajectory structure). | one (snapshot, pattern) | req 6; QP5 |
| 16 | `RedFlag` (`score_red_flags`) | First-class red flags, universe-queryable. | one (snapshot, flag) | req 6; QP5 |
| 17 | `GuardrailEvent` (`score_guardrail_events`) | Every signature that fired: triggering values + outcome (O1–O6) + tier. | one (stock, snapshot, signature) | req 7 |
| 18 | `SuppressionDirective` (`score_suppressions`) | **The single seam** (req 14) by which a Layer-1 suppression reaches the Layer-2 scoring core, PG-agnostic. | one (stock, snapshotKey, metric) | req 8a, 14 |
| 19 | `GuardrailReview` (`score_guardrail_reviews`) | Append-only operator ruling + reason + timestamp for review-tier flags. | one ruling | req 7 |
| 20 | `SectorHealthCache` (`score_sector_health`) | Arithmetic mean of member composites — regenerable cache w/ provenance. | one (sector, run) | req 12 |

---

## B. Per-table key fields, PKs, reproducibility FKs, indexes

> Only the *key* fields are listed — enough to fix grain, PK, the FKs that make a
> row reproducible (req 2), and the indexes that serve the §query patterns.
> All tables: `id` uuid PK, `createdAt` only (no `updatedAt`).

### 1. `ScoringSpecVersion`
- `version` (e.g. `"2026.1"`), `effectiveFrom` (Date), `notes`, `checksum` (of the spec doc).
- PK `id`; `@@unique([version])`.

### 2. `ScoringRun`
- `runType` (`quarterly` | `live`), `triggerType` (`scheduled`/`post_ingest`/`manual_api`), `specVersionId` → ScoringSpecVersion, `asOfDate`, `status`, `startedAt`/`finishedAt`/`durationMs`, `stocksScored`, `stocksSuppressed`, `error`.
- PK `id`; `@@index([runType, asOfDate])`.

### 3. `MetricBarSet`  *(L1 bars — 5 thresholds hot)*
- `barPath` (string: a `peerGroupId`, or `"banking_unified"` for PG5/PG6 — see §G6), `metricKey`, `version` (int), `direction` (`higher_better` | `lower_better`),
- **5 threshold columns** `excellent`, `good`, `acceptable`, `concerning`, `distress` (`Decimal`),
- `inForceFrom` (Date), `specVersionId` → ScoringSpecVersion, `provenanceId` → BarProvenance, `derivationLayer` (`A`|`B`|`C`).
- PK `id`; `@@unique([barPath, metricKey, version])`; `@@index([barPath, metricKey, inForceFrom(sort: Desc)])` → "bar version in force at snapshot date" lookup (req 4, QP6).

### 4. `BarProvenance`  *(cold)*
- `derivationLayer`, `method`, `sampleWindow`, `evidence` (Json — the cold blob), `derivedAt`.
- PK `id`. Referenced by `MetricBarSet.provenanceId`; not indexed for hot reads.

### 5. `MarketBandSet`
- `subComponent` (enum: `range_52w` | `vs_200dma` | `volatility_vs_sector` | `trend_4q`), `version`, ordered band cuts (see §G2 for representation), `inForceFrom`, `specVersionId`.
- PK `id`; `@@unique([subComponent, version])`; `@@index([subComponent, inForceFrom(sort: Desc)])`.

### 6. `PeerStatsSnapshot`  *(L2 μ/σ — PG grain)*
- `peerGroupId`, `barPath`, `metricKey`, `runId` → ScoringRun, `asOfDate`,
- `mean`, `stdDev`, `sampleN`, `anchorLiftFired` (bool), `anchorLiftRule` (`5.3.1`|`5.4.1`|null),
- `inheritsFromPeerGroupId` (nullable — PG6 inherits PG5's L2/L3; see §G6).
- PK `id`; `@@unique([peerGroupId, metricKey, runId])`; `@@index([runId, metricKey])`.
- **Note (grain split):** L2 is PG-grain and shared by all PG members → lives here.
  **L3 own-history** is *stock*-grain → stored inline on `MetricScore` (see below),
  not here. A `MetricScore` row references *both*: `peerStatsSnapshotId` (L2) +
  its own L3 columns. This is the one place I split the requirement's "peer-stats
  (L2 μ/σ **and** L3 window inputs)" bundle — see §G12.

### 7. `BandMappingVersion`
- `version`, `mapping` (Json: band→{label, colour, range}), `effectiveFrom`.
- PK `id`; `@@unique([version])`. Single source of truth for labels/colours (req 10).

### 8. `StockScoringState`
- `stockId` → Stock (`onDelete: Cascade`), `coverageState` (enum `SCORED`|`COVERED`|`OFF_PLATFORM`), `coverageReason`, `lastScoredRunId`.
- PK `id`; `@@unique([stockId])`; `@@index([coverageState])` → universe coverage scans.

### 9. `ScoreSnapshot`  *(the composite spine row)*
- **Identity:** `stockId` → Stock, `symbol` (denorm), `snapshotType` (`quarterly`|`live`), `periodKey` (quarterly → `"FY26Q1"`; live → run-derived, see §G4), `asOfDate`, `runId` → ScoringRun, `specVersionId` → ScoringSpecVersion.
- **Membership captured at stamp time:** `peerGroupId`, `barPath`, `industryPath` (`non_financial`|`banking`) — frozen so a later PG reshuffle doesn't rewrite history (req 1/2).
- **Composite + label:** `composite` (Decimal 0–100), `labelBand` (enum, see E), `bandMappingVersionId` → BandMappingVersion.
- **Pillar subtotals denormalised** (for QP2 cheap trajectory): `foundationSubtotal`, `momentumSubtotal`, `marketSubtotal`, `ownershipSubtotal`.
- **Applied weight set inline** (req 2 — §14.4 redistribution): `wFoundation`, `wMomentum`, `wMarket`, `wOwnership`, `weightRedistributionReason` (enum: `none`|`market_unavailable`|…).
- **Divergence value** (denorm scalar; "widening" computed on read): `divergence`.
- PK `id`.
- `@@unique([stockId, snapshotType, periodKey])` — quarterly immutability; live uniqueness via run-derived periodKey (req 11, §G4).
- `@@index([stockId, asOfDate(sort: Desc)])` → **QP2 (highest-value trajectory) = single range scan**, and QP1 (latest live).
- `@@index([peerGroupId, periodKey])` → QP3 (PG panel one snapshot).
- `@@index([periodKey, composite])` / `@@index([asOfDate, labelBand])` → QP5 (universe band scans).

### 10. `PillarScore`
- `snapshotId` → ScoreSnapshot (`onDelete: Cascade`), `pillar` (enum `foundation`|`momentum`|`market`|`ownership`), `subtotal`, `appliedWeight`, `contribution`, `pillarState` (enum: `scored`|`unavailable_redistributed`), `sourcePeriod` (e.g. `"FY25"` / `"FY26Q1"` / price date — req 2 provenance).
- PK `id`; `@@unique([snapshotId, pillar])`; `@@index([snapshotId])` → QP1.

### 11. `MetricScore`  *(Shape 1 — 3-lens leaf)*
- `snapshotId` → ScoreSnapshot (`onDelete: Cascade`), `pillar`, `metricKey`,
- **raw + 3 lenses as columns:** `rawValue`, `l1Score`, `l2Score`, `l3Score`, `metricScore` (=(L1+L2+L3)/3, stored),
- **L1 landing:** `l1Band` (enum: `excellent`…`distress`), `metricBarSetId` → MetricBarSet (the exact version used),
- **L2 link:** `peerStatsSnapshotId` → PeerStatsSnapshot,
- **L3 own-history inline** (stock-grain): `l3Mean`, `l3StdDev`, `l3WindowN`,
- **lens availability / fallback fact:** `l1Available`/`l2Available`/`l3Available` (bool) + `lensFallbackApplied` (enum: `none`|`l2_to_l1`|`l3_insufficient_history`|…),
- **intra-pillar weighting:** `nominalWeight`, `effectiveWeight`, `contribution`,
- **not-scored state (req 8):** `scoreState` (enum, see E), `includedInPeerStats` (bool).
- PK `id`; `@@unique([snapshotId, metricKey])` → **QP6 metric explanation** (one row joins to bars + peer-stats); `@@index([snapshotId, pillar])` → QP1; `@@index([metricKey, scoreState])` → universe metric scans.

### 12. `MarketSubScore`  *(Shape 2)*
- `snapshotId` → ScoreSnapshot, `subComponent` (enum, same 4), `rawValue`, `bandScore`, `bandLanded`, `marketBandSetId` → MarketBandSet.
- PK `id`; `@@unique([snapshotId, subComponent])`; `@@index([snapshotId])`.

### 13. `OwnershipScore`  *(Shape 3 — primary + rollup)* — see §C for the full field layout.
- `snapshotId` → ScoreSnapshot (1:1).
- PK `id`; `@@unique([snapshotId])`.

### 14. `OwnershipFlowCategory`  *(Shape 4)* — see §C.
- `snapshotId` → ScoreSnapshot, `category` (enum `A_promoter`|`B_institutional`|`C_insider`|`D_block`).
- PK `id`; `@@unique([snapshotId, category])`; `@@index([snapshotId])`.

### 15. `ScorePattern`
- `snapshotId` → ScoreSnapshot, `symbol` (denorm), `asOfDate` (denorm), `patternKey`, `direction`, `severity`, `evidence` (Json: the values), `metricRefs` (Json/array of metricKeys).
- PK `id`; `@@index([asOfDate, patternKey])` → QP5 ("every widening divergence"); `@@index([snapshotId])` → QP1.

### 16. `RedFlag`
- `snapshotId` → ScoreSnapshot, `symbol` (denorm), `asOfDate` (denorm), `flagKey`, `severity`, `tier` (`auto`|`review`), `triggeringValues` (Json), `guardrailEventId` (nullable → GuardrailEvent when flag came from a guardrail).
- PK `id`; `@@index([asOfDate, flagKey])` → QP5 ("every red flag this quarter"); `@@index([snapshotId])` → QP1; `@@index([tier])`.

### 17. `GuardrailEvent`
- `stockId` → Stock, `snapshotId` → ScoreSnapshot, `signatureKey`, `triggeringValues` (Json), `outcome` (enum `O1`…`O6`), `tier` (`auto`|`review`), `suppressedMetricKeys` (Json/array — convenience mirror of the SuppressionDirective rows it produced).
- PK `id`; `@@index([snapshotId])`; `@@index([signatureKey, outcome])` → universe guardrail scans.

### 18. `SuppressionDirective` — see §D for the contract.
- `stockId`, `snapshotKey` (the alignment key, see §D/§G4), `metricKey`, `sourceGuardrailEventId` → GuardrailEvent, `outcome`, `excludeFromOwnScore` (bool, true), `excludeFromPeerMean` (bool, true).
- PK `id`; `@@unique([stockId, snapshotKey, metricKey])`; `@@index([snapshotKey, metricKey])` → the peer-stats builder's "who do I exclude from this metric's μ/σ" query.

### 19. `GuardrailReview`
- `guardrailEventId` → GuardrailEvent, `operatorId`, `ruling` (enum: `upheld`|`overridden`|`deferred`), `reason`, `ruledAt`.
- PK `id`; `@@index([guardrailEventId, ruledAt(sort: Desc)])` → "latest ruling" on read (append-only; newest wins).

### 20. `SectorHealthCache`
- `sectorId` → Sector, `runId` → ScoringRun, `asOfDate`, `meanComposite`, `memberCount`, `specVersionId`.
- PK `id`; `@@unique([sectorId, runId])`; `@@index([asOfDate])`.

---

## C. Ownership storage shape (explicit)

The two-sublayer Ownership pillar persists across **two tables**, keeping the
primary sublayer (fixed shape) and the 4 flow categories (row-per-category)
each in their natural shape, both fully decomposable.

### `OwnershipScore` — primary sublayer + rollup (1 row / snapshot)

```
snapshotId            FK → ScoreSnapshot (1:1)

-- Primary sublayer --
baseline              Decimal   -- 60 or 75
baselineReason        enum      -- which rule set the baseline
pledgingAdjustment    Decimal   -- signed
penaltyR2             Decimal   -- disturbance penalty, signed (0 if not fired)
penaltyR6             Decimal   -- disturbance penalty, signed
penaltyProlongedFii   Decimal   -- disturbance penalty, signed
primarySubtotal       Decimal   -- baseline + pledgingAdj + Σ penalties

-- Flow rollup (categories live in OwnershipFlowCategory) --
flowAdjustmentRaw     Decimal   -- Σ capped category sub-scores
flowAdjustmentClamped Decimal   -- clamp(raw, -12, +12)

-- Final --
finalOwnership        Decimal   -- clamp(primarySubtotal + flowAdjustmentClamped, 40, 100)
```

Every term is a stored fact → primary subtotal and final value are both
re-derivable from their components, and each penalty is independently inspectable
(a `0` penalty is a real stored `0`, not an absence).

### `OwnershipFlowCategory` — the 4 flow categories (4 rows / snapshot)

```
snapshotId      FK → ScoreSnapshot
category        enum  -- A_promoter | B_institutional | C_insider | D_block
rawSubScore     Decimal      -- before the per-category cap
capApplied      Decimal      -- the cap value in force for this category
cappedSubScore  Decimal      -- min(|raw|, cap) with sign  → summed into flowAdjustmentRaw
flowState       enum         -- scored | dormant_no_feed | dormant_no_data   (req 9)
bandLanded      enum         -- which band the net flow fell in
netFlowValue    Decimal      -- the underlying signed net flow (₹Cr or %, per category)
trendState      enum         -- e.g. accelerating | steady | reversing
```

`finalOwnership` on the parent is reconstructable as
`clamp(primarySubtotal + clamp(Σ cappedSubScore, -12, +12), 40, 100)` — i.e. the
join of these two tables reproduces the entire pillar with no stored ranking and
no lost intermediate.

**Why `dormant ≠ 0`:** a category with `flowState = dormant_no_feed` and
`cappedSubScore = 0` is explicitly "no PIT feed wired", distinct from
`flowState = scored, cappedSubScore = 0` meaning "scored, found neutral flow".
Same principle as req 8, applied at the flow-category grain.

---

## D. The suppression data contract (req 14)

**The seam:** `SuppressionDirective` is the *single, canonical, PG-agnostic*
representation of "this metric is suppressed for this stock at this snapshot."
It is **written by Layer 1** (guardrail evaluation) and **read by Layer 2** (the
scoring core) *and* by the peer-stats builder. Nothing else represents
suppression; nothing is invented per-PG (that drift = the CN-1 violation we are
preventing).

Concrete shape:

```
SuppressionDirective {
  stockId               -- who
  snapshotKey           -- the alignment key shared by the score row + peer-stats run (§G4)
  metricKey             -- which metric is dropped
  sourceGuardrailEventId-- provenance: the signature that caused it
  outcome               -- O1..O6 (the guardrail outcome that mandated suppression)
  excludeFromOwnScore   -- = true  → MetricScore.scoreState becomes guardrail_suppressed,
                        --           the metric is dropped and its pillar renormalised
  excludeFromPeerMean   -- = true  → the peer-stats builder excludes this (stock, metric)
                        --           from μ/σ for every OTHER member of the PG
}
@@unique([stockId, snapshotKey, metricKey])
```

**The contract, stated:**
1. A metric is suppressed **iff** a `SuppressionDirective` row exists for
   `(stockId, snapshotKey, metricKey)`. Absence = not suppressed. There is no
   other channel.
2. The scoring core, when building a stock's `MetricScore`, consults this table
   **uniformly across all 13 PGs and both industry paths** — the lookup key
   never contains a PG-specific shape.
3. The peer-stats builder, when computing `PeerStatsSnapshot.mean/stdDev` for a
   `(PG, metric)`, **excludes every member** that has a directive with
   `excludeFromPeerMean = true` for that `(snapshotKey, metric)`. This is what
   makes req 8(a) "dropped from own-score AND peer mean, renormalised" real:
   the same row drives both exclusions.
4. The directive is **append-only** like everything else; a re-evaluation writes
   a new row under a new `snapshotKey`/run, never mutating the old one.

This single table is the only coupling point between the guardrail layer and the
scoring layer — which is exactly the property that prevents per-PG drift.

---

## E. Requirements 8, 9, 10 as concrete fields

### Req 8 — three distinct "not-scored-normally" states
On **`MetricScore`**:
```
scoreState enum:
  scored                       -- genuine score
  guardrail_suppressed         -- (a) dropped from own-score AND peer mean, pillar renormalised
  missing_data_renormalized    -- (b) §14.4/§5.8 missing input, weight renormalised
  operator_neutral_hold        -- (c) scored 60, FULL weight, NOT renormalised (CASA/Tier-1 absent)
includedInPeerStats  bool      -- false for (a); true for (c); (b) n/a (no raw to contribute)
nominalWeight        Decimal   -- the pillar weight this metric would carry
effectiveWeight      Decimal   -- after renormalisation: (a)=0, (b)=0, (c)=nominal
```
A reader distinguishes all four cases from `(scoreState, effectiveWeight, includedInPeerStats)`:
- genuine: `scored`, `effective = nominal`, `included = true`
- (a) suppressed: `guardrail_suppressed`, `effective = 0`, `included = false`
- (b) missing renorm: `missing_data_renormalized`, `effective = 0`, `included = false`
- (c) neutral hold: `operator_neutral_hold`, `effective = nominal` (**not** zeroed), score = 60

### Req 9 — dormant ≠ zero (Flow layer)
On **`OwnershipFlowCategory`**:
```
flowState enum:
  scored            -- evaluated; cappedSubScore is a real number (incl. a real 0)
  dormant_no_feed   -- the feed for this category isn't wired → 0 is structural, not neutral
  dormant_no_data   -- feed wired but no observations this window
```

### Req 10 — label band as cache-with-mapping-version
On **`ScoreSnapshot`**:
```
labelBand enum:  fragile | below_par | steady | healthy | pristine
bandMappingVersionId  FK → BandMappingVersion
```
`BandMappingVersion.mapping` (Json) is the **single source** for
band→label→colour and the numeric cut ranges. Because each snapshot pins the
*mapping version that produced its band*, a future re-band writes a new
`BandMappingVersion` and new snapshots use it — **old snapshots keep pointing at
the old mapping, so history never lies.**

---

## F. Computed ON READ — therefore NOT stored

These are cross-sectional or comparative cuts that must never be persisted (they
would freeze a ranking that is only meaningful relative to a live population):

1. **Ranks / rank-order** within a PG, sector, or the universe (the health-rank
   panel order) — `ORDER BY composite` at read (QP3).
2. **Superlatives** — "best in peer group", "top decile", "worst pledging" — read-time.
3. **Sector cross-sectional cuts beyond the cached mean** — median, dispersion,
   percentile bands. Only the **arithmetic mean** is cached (`SectorHealthCache`,
   req 12); everything else is read-time over the member `ScoreSnapshot` rows.
4. **PG peer-mean of composites** for a panel — read-time aggregate (we cache the
   *sector* mean, not per-PG composite means).
5. **Band-crossing events** ("every stock that crossed out of 55–72") — derived
   from consecutive `ScoreSnapshot` rows at read, *unless* a crossing is
   explicitly promoted to a `ScorePattern` row (§G3).
6. **Divergence trend** ("widening over N quarters") — the per-snapshot
   `divergence` scalar is stored (cheap for QP2); the *trend across snapshots* is
   computed on read.
7. **Two-stock comparison** (QP4) — read-time alignment of two stocks' snapshot
   series; nothing comparison-specific is stored.
8. **Anything requiring the full live population** to be meaningful — by
   definition read-time, because storing it would make it stale the moment any
   member re-scores.

---

## G. Open questions / judgment calls — confirm before migration

1. **Applied weight set: inline vs separate table.** I put the 4 applied weights +
   `weightRedistributionReason` *inline on `ScoreSnapshot`* (the snapshot is the
   natural, immutable carrier of its own applied weights — req 2 satisfied without
   a join). Alternative: a normalised `AppliedWeightSet` FK. **Confirm inline.**

2. **Market band-cut representation (`MarketBandSet`).** The 4 sub-components don't
   share the metric bars' 5-threshold shape, so I did **not** force them into
   `MetricBarSet`. Open: store their cuts as **explicit ordered columns**,
   **child cut-rows**, or a **small ordered-cuts JSON**. Leaning explicit columns
   for the "crossed a market band" scan (QP5). **Confirm representation.**

3. **Patterns vs Red Flags: two tables (chosen) vs one discriminated table.** They
   have different field shapes (patterns = trajectory/divergence; flags = risk +
   guardrail linkage + tier) and different scan predicates, so I split them.
   **Confirm two tables.** Also: should band-crossings be a `ScorePattern` row or
   purely read-time (§F5)? **Confirm.**

4. **`snapshotKey` / `periodKey` definition and live retention.** Quarterly:
   `periodKey = "FY26Q1"`, immutable, `@@unique([stockId, quarterly, periodKey])`.
   Live: each run re-stamps a **new** immutable row — I propose
   `periodKey = "LIVE:" + runId` so uniqueness holds and `snapshotKey` (the join
   key shared with `SuppressionDirective`/peer-stats) = `runId` for live,
   `periodKey` for quarterly. **Open: do we keep every live snapshot forever**
   (append-only says yes, but it grows ~daily × universe), or prune live rows
   older than N while keeping all quarterly? **Confirm retention.**

5. **`snapshotId` as the single join hub.** Eight child tables FK
   `ScoreSnapshot.id`. Composite→pillar→metric uses `snapshotId + pillar/metricKey`
   (flat) rather than chaining through `PillarScore.id` — cheaper for QP6 and
   universe scans. **Confirm the flat fan-out.**

6. **Banking unified bar path (PG5 derives, PG6 inherits).** I modelled this as
   `barPath = "banking_unified"` shared by PG5+PG6 on `MetricBarSet`, plus
   `PeerStatsSnapshot.inheritsFromPeerGroupId` so PG6's L2/L3 point at PG5's
   stats. **Confirm this is the intended inheritance mechanism** (vs. duplicating
   PG5 stats rows under PG6).

7. **Operator rulings immutable.** `GuardrailReview` is append-only (a changed
   ruling = new row, latest `ruledAt` wins on read), consistent with the
   no-update rule. **Confirm** (vs. an updatable ruling field).

8. **Denormalising pillar subtotals + composite + divergence onto `ScoreSnapshot`.**
   This is what makes QP2 (the highest-value trajectory view) a single index
   range scan. It does *not* violate single-source because the snapshot is
   immutable — the denormalised copy can never drift from its children. **Confirm
   the denormalisation** (the alternative makes the trajectory view join 4+ tables
   per point).

9. **Coverage state in a new `StockScoringState` satellite.** Because `Stock` is
   input-layer and off-limits, coverage (`SCORED`/`COVERED`/`OFF_PLATFORM`) lives
   in a 1:1 scoring-layer table. **Confirm** this placement (vs. lobbying to add a
   column to `Stock`).

10. **Four decoupled version axes** (spec / bar / peer-stats / band-mapping). A
    re-band must not bump the spec; a bar re-derivation must not bump the weight
    policy. **Confirm they stay independent** (and that applied weights are a 5th,
    per-snapshot, value — not globally versioned).

11. **`SectorHealthCache` grain.** Per `(sector, runId)`. Regenerated each run.
    **Confirm**; and confirm we do **not** also need a per-PG composite-mean cache
    (QP3 currently served by read-time aggregate + the `([peerGroupId, periodKey])`
    index).

12. **L2/L3 grain split (the one place I diverged from the literal wording).** The
    requirement bundles "peer-stats (L2 μ/σ **and** L3 window inputs)". But L2 is
    PG-grain (shared by all members) and L3 is *stock*-grain (own-history). I put
    **L2 in `PeerStatsSnapshot`** and **L3 inline on `MetricScore`** (`l3Mean`,
    `l3StdDev`, `l3WindowN`), with the metric row referencing both. Storing L3 at
    PG-grain would be wrong (it isn't shared); storing L2 per-stock would duplicate
    it N times. **This is the most important call to confirm.**

13. **Metric key namespace across industry paths.** `metricKey` is a flat string
    spanning non-financial and banking metric sets; the *applicable* list per path
    is spec-driven, not enforced by the schema. **Confirm** we don't want a
    per-path metric registry table (I judged it spec/code config, not persistence).
```
