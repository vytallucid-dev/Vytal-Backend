# GATE 0 — AI LAYER ARCHITECTURE RECON

**Scan window:** 2026-08-10 → 2026-08-11 · **Scope:** read-only reconnaissance · **Deliverable:** this file only
**Repos:** `Vytal-Backend` (all `src/…` paths below), `Vytal-Frontend`

Facts only. No recommendations, no build plan, no proposed refactors.

Every claim carries `file:line` + the verbatim line, the exact command + raw output, or an explicit
`UNVERIFIED` marker.

> ### ⚠ SNAPSHOT DRIFT — READ BEFORE USING ANY COUNT
>
> **The tree changed while this recon was running.** Three files were added to the five trees after the
> first pass, and several existing files were edited (line numbers moved — e.g. `ai/grounding.ts`
> `renderPortfolioFacts` 728 → 769; `catalogue/pattern-facts.ts`
> `MATERIAL_GAP_FLOOR_EVIDENCED_ON` 286 → 307).
>
> ```
> $ find src/ai src/chat src/catalogue src/insight/quarter-brief src/scoring/guardrail \
>        -name '*.ts' -printf '%TY-%Tm-%Td %TH:%TM  %p\n' | sort -r | head -6
> 2026-08-10 22:53  src/catalogue/evidence-facts.ts     ← NEW
> 2026-08-10 22:43  src/catalogue/retired-findings.ts
> 2026-08-10 22:18  src/insight/quarter-brief/fact-block.ts
> 2026-08-10 21:20  src/ai/grounding.ts
> 2026-08-10 18:58  src/catalogue/pattern-facts.ts
> 2026-08-10 16:49  src/ai/filing-facts.ts              ← NEW
> ```
>
> New files: `src/catalogue/evidence-facts.ts`, `src/catalogue/finding-facts.ts`, `src/ai/filing-facts.ts`.
>
> **Every static count in §0, §1 and §5 has been re-run on a single final snapshot and states current
> values.** The Batch A working figures (124 files / 795 exports / 17 DELETE) were a stale snapshot
> *and* contained manual per-tree miscounts; they are superseded by §0 and §1 below. §2–§4 and §6 were
> not affected in substance — the resolver set, absent-state contract, renderer inventory and DB counts
> are unchanged — but any `file:line` in this document may be off by a few lines if editing continued
> after 2026-08-10 22:53.

---

## 0. SCOPE CORRECTIONS MADE BEFORE ANY SCAN

Two of the prompt's stated paths do not exist as written. Both are reported, not silently fixed.

| Prompt path | Status | Actual |
|---|---|---|
| `src/ai/` | ✅ exists | — |
| `src/chat/` | ✅ exists | — |
| `src/quarter-brief/` | ❌ **does not exist** | `src/insight/quarter-brief/` (27 files) |
| `src/catalogue/` | ✅ exists | — |
| `src/scoring/guardrail/` | ✅ exists | — |

```
$ ls -d src/quarter-brief
ls: cannot access 'src/quarter-brief': No such file or directory

$ find . -type d -iname '*brief*'
./src/insight/quarter-brief
```

Also: the working directory is a **two-repo root** (`Vytal-Backend/`, `Vytal-Frontend/`), not a single
`src/`. `Vytal-Backend` is its own git repository.

### Surface totals (final snapshot)

| Tree | Files | Export lines | Unique exports |
|---|---|---|---|
| `src/ai` | 15 | 100 | 100 |
| `src/chat` | 48 | 260 | 265 |
| `src/catalogue` | 18 | 161 | 161 |
| `src/insight/quarter-brief` | 25 | 195 | 197 |
| `src/scoring/guardrail` | 21 | 92 | 92 |
| **Total** | **127** | **808** | **815** |

Whole-repo context: **1,274** `.ts` files under `src/` (excluding `src/generated`).

Aggregate export properties across the 815:

| Property | Count |
|---|---|
| ≤3 importers | **684** |
| 0 import-mentions | **226** |
| no reference outside own file (over-exported) | **193** |
| 0 importers **and** a string-literal match | **5** (all prose — see §1.4) |

**Reconciliation of 815** — every export line is accounted for, none dropped:

```
export lines matching /^export\s/ : 808
  single declarations           : 789
  export * lines (no symbol)    : 4
  export { } lines              : 15  -> symbols: 26
  UNMATCHED lines               : 0
RECONCILE: 789 + 26 = 815 (pre-dedupe)
UNIQUE (file#symbol): 815      duplicate pairs: 0
```

`rg -n '^\s*export\s'` reports 804 — 4 fewer than the trimmed-line count of 808. The delta is not
material to any verdict (the parser operates on trimmed lines and reconciles to 815 exactly) but is
recorded rather than smoothed over.

Two independently-written parsers were run against each other and returned **identical symbol sets**
(815 each, zero diff in both directions).

**0 files in the five trees have zero importers.** There are no orphan modules.

---

## 1. DELETION LEDGER

### 1.1 Verdict rule (stated so the ledger is reproducible)

The **AI layer** = the five trees **plus** five surface files that are unambiguously AI-layer but sit
outside them:

```
src/controllers/me/chat-controller.ts
src/routes/me-chat-routes.ts
src/jobs/handlers/chat-profile-distill.handler.ts
src/jobs/handlers/chat-title-generate.handler.ts
src/jobs/handlers/quarter-brief.handler.ts
```

| Verdict | Rule |
|---|---|
| **DELETE** | zero references anywhere, **including its own file** |
| **KEEP** | ≥1 importer that is production code outside the AI layer, **or** a CI-gate script |
| **PORT** | importers exist, all inside the AI layer |
| **UNCLEAR** | zero importers but used in its own file (over-export), **or** imported only by one-off recon scripts |

### 1.2 Counts

| Verdict | ≤3-importer set (684) | All exports (815) |
|---|---|---|
| DELETE | **20** | 20 |
| PORT | **296** | 363 |
| KEEP | **105** | 162 |
| UNCLEAR | **263** | 270 |

In the ≤3 set: KEEP splits into **50** with a production consumer + **55** with a CI-gate script
consumer only. UNCLEAR splits into **206** over-exports + **57** held alive only by one-off recon
scripts.

### 1.3 Reachability

Computed over the real module graph (1,274 files; `.js`→`.ts` ESM specifiers resolved), from three
root sets:

| Root class | Roots | Files reachable |
|---|---|---|
| HTTP | `src/app.ts`, `src/server.ts` | 670 |
| Cron/job | `jobs/worker.ts`, `dispatcher.ts`, `scoring-triggers.ts`, `enqueue.ts`, all `jobs/handlers/**` | 433 |
| CI gate | 28 entry points parsed from `package.json` scripts | — |

Of the 127 AI-layer files: **126 HTTP-reachable · 81 job-reachable · 127 CI-reachable · 0 reachable
from none of the three.**

The one exception is **not dead**:

- `src/catalogue/metric-view-fields.ts` — sole importer `src/scripts/gen-frontend-metric-catalogue.ts`,
  which is wired into CI:
  `"verify:copy-fresh": "tsx src/scripts/gen-frontend-fallback.ts --check && tsx src/scripts/gen-frontend-metric-catalogue.ts --check"`
  **Verdict: KEEP.** A runtime-only reachability analysis marks this file DELETE.

> ⚠ **Reachability in this ledger is file-granular, not symbol-granular.** A DELETE row whose file is
> HTTP-reachable means *the file* is reachable and *the symbol* is not. Reading `http:true` on a DELETE
> row as "this symbol is live" inverts the finding.

### 1.4 String-literal dispatch — checked, validated, and re-checked after the drift

**0 of 815 symbols have a string-literal reference that constitutes dispatch.**

That result was not accepted blind. The scanner was validated against known literals first and returned
**59 probe hits** (`gemini` → `src/ai/types.ts`; `stock_finding` → 4 files; `consolidated` → 8 files).

On the final snapshot the raw scanner reports **5** zero-importer symbols with a quoted match. All five
are **backtick-quoted symbol names inside comments**, not dispatch — verified individually:

| Symbol | Match site | Actual line |
|---|---|---|
| `dropRetired` | `catalogue/not-covered.ts:256` | `* retired-findings.ts's \`dropRetired\` for why (a per-stock finding, …` |
| `dropRetired` | `filing/channel.ts:72` | `* shared shape — the same design as \`dropRetired\`, and for the same reason.` |
| `bridgeResidual` | `quarter-brief/contrasts.ts:181` | `// … (driver.ts's \`bridgeResidual\`) and used` |
| `DriverRole` | `quarter-brief/annual-manifest.ts:45` | `// … So \`DriverRole\` is absent from this spec type` |
| `BriefLine` | `scripts/gen-frontend-metric-catalogue.ts:182` | `" * … that is all \`BriefLine\` carries: the payload has no metric"` |

The scanner treats backtick spans as string literals, which is why prose matches surface. Counted as
**0 genuine dispatch references** — but the 5 are listed rather than filtered silently.

The reason the count is genuinely 0: dispatch keys off a `name` **field**, not a symbol.

- `registry.ts:127` — `const BY_NAME: Map<string, ChatTool> = new Map(CHAT_TOOLS.map((t) => [t.name, t]));`
- `registry.ts:209` — `const tool = findTool(call.name);`

All 33 tool objects are real imports at `registry.ts:36-60`. The `stock_news.summary` / `AiSummarySlot`
failure class does not recur here. **The live untracked key-space is the tool `name` strings, not the
symbol names.**

### 1.5 The 20 DELETE rows

Zero references anywhere — no importer, no textual reference in any other file, and no reference in
their own file outside the declaration line.

| file:line | symbol | kind |
|---|---|---|
| `src/ai/context-layer.ts:144` | `VYTAL_CONTEXT_LAYER_VERSION` | const |
| `src/ai/grounding.ts:769` | `renderPortfolioFacts` | function |
| `src/ai/insight/relationship.ts:77` | `PERSONAL_FACT_LABELS` | const |
| `src/catalogue/evidence-facts.ts:385` | `isReaderEvidence` | const |
| `src/catalogue/evidence-facts.ts:391` | `CLASSIFIED_EVIDENCE_KEYS` | const |
| `src/catalogue/finding-facts.ts:213` | `isMeasuredPattern` | const |
| `src/catalogue/index.ts:84` | `REGISTRY_IDS` | const |
| `src/catalogue/index.ts:96` | `catalogueEntry` | function |
| `src/catalogue/index.ts:114` | `stockSideEntry` | function |
| `src/catalogue/pattern-facts.ts:307` | `MATERIAL_GAP_FLOOR_EVIDENCED_ON` | const |
| `src/catalogue/tool-families.ts:58` | `toolForKey` | function |
| `src/chat/discuss-context.ts:12` | `DiscussSubjectKind` | type |
| `src/chat/profile.ts:51` | `VytalVocabKey` | type |
| `src/insight/quarter-brief/anchors.ts:356` | `anchorLabel` | const |
| `src/insight/quarter-brief/annual-manifest.ts:544` | `isAnnualSteady` | function |
| `src/insight/quarter-brief/driver.ts:452` | `hasBridge` | const |
| `src/insight/quarter-brief/manifest.ts:522` | `isSteady` | function |
| `src/insight/quarter-brief/story.ts:397` | `storyMetricCount` | const |
| `src/insight/quarter-brief/story.ts:401` | `topLineLabelOf` | const |
| `src/insight/quarter-brief/verdict.ts:167` | `MARGIN_MATERIAL_PP` | const |

⚠ **Three of the 20 are in files added during the scan window** (`evidence-facts.ts` ×2,
`finding-facts.ts` ×1). Newly-authored exports with no consumer yet are the most likely of any row here
to be work-in-progress rather than dead. Treat those three as time-sensitive.

### 1.6 "0 importers" ≠ dead — the distinction that governs 206 rows

226 exports have zero import-statement mentions; **193 have no reference outside their defining file**.
Only **20** are dead. The other **173** are **over-exports** — used inside their own file. Removing the
`export` keyword is safe; removing the symbol is not.

Spot-checked, raw:

```
=== GuardrailVerdict (guardrail.ts:695) ===
695:export interface GuardrailVerdict {
750:export function scanExplanationText(text: string): GuardrailVerdict {

=== webSearchEnabled (get-stock-news.ts:38) ===
38:export const webSearchEnabled = (): boolean => ...
139:    if (!webSearchEnabled()) {
```

### 1.7 The 50 KEEP rows with a production consumer

These are the load-bearing edges out of the AI layer. (Grouped below by source; two rows were added by
the new `finding-facts.ts` / `evidence-facts.ts` files and are not itemised.)

| Source | Symbols | Consumers |
|---|---|---|
| `catalogue/not-covered.ts` | `NotCoveredId`, `NotCoveredReason`, `NotCoveredRecord`, `NOT_COVERED`, `NOT_COVERED_RECORDS`, `NOT_COVERED_SILENT_LINE`, `notCoveredPatternKey`, `isNotCoveredKey` | `findings/not-covered-eval.ts`, `findings/persist.ts`, `read/not-covered.service.ts`, `composite/score-pass.ts`, `read/health-view.service.ts`, `alerts/finding-catalog.ts` |
| `scoring/guardrail/scoring-gate.ts` + `persist.ts` | `runScoringGate`, `gateNotRun`, `GateMemberSource`, `ScoringGateResult`, `behaviourContractLine`, `writeGuardrailEval` | `scoring/composite/score-pass.ts` |
| `catalogue/pattern-facts.ts` | `PatternBasis`, `PatternState`, `ServedPatternFacts`, `MATERIAL_GAP_FLOOR`, `ALIGNED_GAP_CEILING`, `MARKET_ELEVATED_FLOOR` | `read/finding-lifecycle.service.ts`, `findings/divergence/pattern-state.ts`, `findings/divergence/bands.ts`, `read/health-view.types.ts`, rules `d1`/`d2` |
| `catalogue/divergence.ts` | `CONSOLIDATED_DIVERGENCE_KEY`, `isDivergenceSubType`, `consolidateDivergence` | `read/symbol-findings.service.ts`, `read/universe-projection.service.ts` |
| `catalogue/serialise.ts` | `SERVED_REGISTRIES`, `isServedRegistry`, `registrySegment`, `stockFindingNames`, `servedFacts` | `controllers/catalogue-controller.ts`, `read/health-view.service.ts` |
| `catalogue/tool-families.ts` | `ToolId`, `forTool` | `read/tool-scan.service.ts`, `read/health-view.service.ts` |
| `catalogue/retired-findings.ts` | `RetiredFindingKey`, `retiredKeysSqlPredicate` | `findings/types.ts`, `relational/base-rates.ts`, `relational/reader-context.ts` |
| `catalogue/n-family-copy.ts` | `N_FAMILY_COPY` | `scoring/findings/verdicts.ts` |
| `insight/quarter-brief` | `AnnualLine`, `PersonalSection`, `buildPersonalSection`, `readVerdict`, `times`, `invalidateBriefsForEdit` | `read/result-detail.service.ts`, `read/health-view.service.ts`, `fill/raw-field-edit.ts` |
| `chat/web/news-filter.ts` | `EntityGuard`, `buildEntityGuard`, `DropReason`, `screenNewsItems` | `ingestions/news_and_announcements/relevance.ts` |
| `ai/tone.ts` | `ToneLevel`, `resolveToneForUser` | `relational/copy.ts`, `relational/types.ts`, `relational/reader-context.ts` |
| **cross-layer oddities** | `scoring/guardrail/review.ts:33 Ruling` | `portfolio/phs/constants.ts` |
| | `chat/tools/shared.ts:17 pctStr` | `relational/entries.ts` |

`probeStockRelationship` (`src/ai/insight/relationship.ts:92`) has **three** production consumers —
`results-season/service.ts:155`, `relational/reader-context.ts:83`, `relational/reader-exposure.ts:59`.
It is no longer orphaned; it is a shared reader-exposure primitive that happens to live in `src/ai`.

### 1.8 Cross-repo name collisions — duplicated concepts, not consumers

7 backend symbols share a name with a frontend symbol. **There are zero cross-repo imports** — the
frontend re-implements them locally.

| Symbol | Backend | Frontend re-implementation |
|---|---|---|
| `isWideTier` | `catalogue/divergence.ts:78` | `lib/findings/classify.ts:165` (`function isWideTier`) |
| `subjectLabelFor` | `chat/openings.ts:60` | `components/sidekick/sidekick-opening.ts:22` (`export function`) |
| `TOOL_FAMILIES` | `catalogue/tool-families.ts:35` | `lib/findings/tool-findings.ts` |
| `CatalogueDocument` | `catalogue/serialise.ts:120` | `lib/api/hooks/use-catalogue.ts`, `lib/findings/catalogue-store.ts` |
| `addDays` | `chat/date-resolve.ts:45` | `components/calendar/lib.ts`, `range-picker.tsx` |
| `DiscussSubjectKind` | `chat/discuss-context.ts:12` | `components/discuss/discuss-context.ts` |
| `PortfolioTab` | `chat/links.ts:83` | 6 files under `components/portfolio/health/` |

### 1.9 Full per-symbol ledger

Every export in the five trees (n=815), grouped by verdict then file.
Columns: `file:line` · symbol · kind · importer-count · evidence.
String-literal references: **0 for every row** (see §1.4).

#### DELETE — 20 exports

| file:line | symbol | kind | imp | evidence |
|---|---|---|---|---|
| `src/ai/context-layer.ts:144` | `VYTAL_CONTEXT_LAYER_VERSION` | const | 0 | no reference anywhere incl. own file |
| `src/ai/grounding.ts:769` | `renderPortfolioFacts` | fn | 0 | no reference anywhere incl. own file |
| `src/ai/insight/relationship.ts:77` | `PERSONAL_FACT_LABELS` | const | 0 | no reference anywhere incl. own file |
| `src/catalogue/evidence-facts.ts:385` | `isReaderEvidence` | const | 0 | no reference anywhere incl. own file |
| `src/catalogue/evidence-facts.ts:391` | `CLASSIFIED_EVIDENCE_KEYS` | const | 0 | no reference anywhere incl. own file |
| `src/catalogue/finding-facts.ts:213` | `isMeasuredPattern` | const | 0 | no reference anywhere incl. own file |
| `src/catalogue/index.ts:84` | `REGISTRY_IDS` | const | 0 | no reference anywhere incl. own file |
| `src/catalogue/index.ts:96` | `catalogueEntry` | fn | 0 | no reference anywhere incl. own file |
| `src/catalogue/index.ts:114` | `stockSideEntry` | fn | 0 | no reference anywhere incl. own file |
| `src/catalogue/pattern-facts.ts:307` | `MATERIAL_GAP_FLOOR_EVIDENCED_ON` | const | 0 | no reference anywhere incl. own file |
| `src/catalogue/tool-families.ts:58` | `toolForKey` | fn | 0 | no reference anywhere incl. own file |
| `src/chat/discuss-context.ts:12` | `DiscussSubjectKind` | type | 0 | no reference anywhere incl. own file |
| `src/chat/profile.ts:51` | `VytalVocabKey` | type | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/anchors.ts:356` | `anchorLabel` | const | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/annual-manifest.ts:544` | `isAnnualSteady` | fn | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/driver.ts:452` | `hasBridge` | const | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/manifest.ts:522` | `isSteady` | fn | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/story.ts:397` | `storyMetricCount` | const | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/story.ts:401` | `topLineLabelOf` | const | 0 | no reference anywhere incl. own file |
| `src/insight/quarter-brief/verdict.ts:167` | `MARGIN_MATERIAL_PP` | const | 0 | no reference anywhere incl. own file |

#### PORT — 363 exports

| file:line | symbol | kind | imp | evidence |
|---|---|---|---|---|
| `src/ai/adapters/gemini.ts:154` | `createGeminiAdapter` | fn | 3 | AI-internal: src/ai/registry.ts, src/insight/quarter-brief/generate.ts |
| `src/ai/adapters/mock.ts:69` | `createMockAdapter` | fn | 2 | AI-internal: src/ai/registry.ts |
| `src/ai/context-layer.ts:147` | `VYTAL_CONTEXT_LAYER` | const | 6 | AI-internal: src/chat/voice.ts |
| `src/ai/filing-facts.ts:65` | `FILING_CHANNEL_NOTE` | const | 2 | AI-internal: src/chat/tools/get-findings-for-symbols.ts |
| `src/ai/filing-facts.ts:138` | `renderFilingFacts` | fn | 4 | AI-internal: src/ai/grounding.ts, src/chat/tools/get-findings-for-symbols.ts, src/chat/tools/get-stock-facts.ts |
| `src/ai/filing-facts.ts:259` | `filingFactsText` | const | 1 | AI-internal: src/chat/tools/boundary.ts |
| `src/ai/grounding.ts:27` | `CLOSED_WORLD_HEADER` | const | 3 | AI-internal: src/ai/spend.ts, src/chat/compose.ts, src/insight/quarter-brief/prompt.ts |
| `src/ai/grounding.ts:79` | `NA` | const | 15 | AI-internal: src/ai/insight/relationship.ts, src/chat/screen-brief.ts, src/chat/tools/get-corporate-events.ts (+12) |
| `src/ai/grounding.ts:114` | `isNum` | const | 9 | AI-internal: src/ai/insight/relationship.ts, src/chat/tools/get-corporate-events.ts, src/chat/tools/get-stock-facts.ts (+6) |
| `src/ai/grounding.ts:146` | `pctPointStr` | const | 1 | AI-internal: src/chat/tools/shared.ts |
| `src/ai/grounding.ts:180` | `moneyStr` | const | 1 | AI-internal: src/chat/tools/shared.ts |
| `src/ai/grounding.ts:739` | `groundStockHealth` | fn | 7 | AI-internal: src/chat/compose.ts, src/chat/tools/get-stock-facts.ts, src/chat/tools/get-stock-relationship.ts |
| `src/ai/grounding.ts:754` | `groundPortfolioHealth` | fn | 2 | AI-internal: src/chat/compose.ts, src/chat/tools/get-portfolio-facts.ts |
| `src/ai/guardrail-hinglish.ts:142` | `AI_HARD_LIST_HI` | const | 2 | AI-internal: src/ai/guardrail.ts |
| `src/ai/guardrail-hinglish.ts:248` | `AI_SOFT_EXTRA_HI` | const | 2 | AI-internal: src/ai/guardrail.ts |
| `src/ai/insight/relationship.ts:136` | `groundStockRelationship` | fn | 2 | AI-internal: src/chat/compose.ts, src/chat/tools/get-stock-relationship.ts |
| `src/ai/moderation.ts:196` | `scanUserInput` | fn | 3 | AI-internal: src/chat/engine.ts |
| `src/ai/moderation.ts:204` | `scanOutputText` | fn | 2 | AI-internal: src/chat/engine.ts |
| `src/ai/number-grounding.ts:185` | `scanUngroundedNumbers` | fn | 5 | AI-internal: src/chat/engine.ts, src/insight/quarter-brief/generate.ts |
| `src/ai/number-grounding.ts:215` | `buildNumberHaystack` | fn | 3 | AI-internal: src/chat/engine.ts |
| `src/ai/quota.ts:152` | `Actor` | type | 7 | AI-internal: src/ai/spend.ts, src/chat/engine.ts, src/chat/profile.ts (+3) |
| `src/ai/quota.ts:237` | `QuotaDecision` | iface | 3 | AI-internal: src/ai/spend.ts, src/chat/engine.ts |
| `src/ai/quota.ts:283` | `checkAndConsumeAiCall` | fn | 5 | AI-internal: src/ai/spend.ts, src/insight/quarter-brief/generate.ts |
| `src/ai/quota.ts:415` | `peekAiCallQuota` | fn | 9 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/ai/quota.ts:466` | `recordAiTokens` | fn | 4 | AI-internal: src/chat/engine.ts, src/chat/profile.ts, src/insight/quarter-brief/generate.ts (+1) |
| `src/ai/registry.ts:33` | `createAiProvider` | fn | 1 | AI-internal: src/chat/engine.ts |
| `src/ai/spend.ts:51` | `servedByMock` | fn | 3 | AI-internal: src/chat/engine.ts, src/chat/profile.ts, src/jobs/handlers/chat-title-generate.handler.ts |
| `src/ai/spend.ts:56` | `Spend` | type | 1 | AI-internal: src/chat/engine.ts |
| `src/ai/spend.ts:70` | `spendFor` | fn | 4 | AI-internal: src/chat/engine.ts, src/chat/profile.ts, src/jobs/handlers/chat-title-generate.handler.ts |
| `src/ai/types.ts:17` | `AI_PROVIDER_IDS` | const | 1 | AI-internal: src/ai/registry.ts |
| `src/ai/types.ts:18` | `AiProviderId` | type | 1 | AI-internal: src/ai/registry.ts |
| `src/ai/types.ts:21` | `isAiProviderId` | fn | 1 | AI-internal: src/ai/registry.ts |
| `src/ai/types.ts:36` | `TokenUsage` | iface | 10 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts, src/ai/spend.ts (+2) |
| `src/ai/types.ts:53` | `AiMessage` | iface | 4 | AI-internal: src/ai/adapters/gemini.ts, src/chat/engine.ts, src/chat/sessions.ts |
| `src/ai/types.ts:78` | `AiToolSpec` | iface | 5 | AI-internal: src/ai/adapters/gemini.ts, src/chat/engine.ts, src/chat/tools/registry.ts (+1) |
| `src/ai/types.ts:88` | `AiToolCall` | iface | 24 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts, src/chat/engine.ts (+2) |
| `src/ai/types.ts:112` | `AiToolResult` | iface | 3 | AI-internal: src/chat/engine.ts, src/chat/sessions.ts, src/chat/tools/registry.ts |
| `src/ai/types.ts:138` | `AiGenerateRequest` | iface | 7 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts |
| `src/ai/types.ts:154` | `AiGenerateResult` | iface | 8 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts, src/chat/engine.ts |
| `src/ai/types.ts:168` | `AiGenerateStructuredRequest` | iface | 2 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts |
| `src/ai/types.ts:186` | `AiStructuredResult` | type | 2 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts |
| `src/ai/types.ts:191` | `AiProvider` | iface | 10 | AI-internal: src/ai/adapters/gemini.ts, src/ai/adapters/mock.ts, src/ai/registry.ts (+1) |
| `src/catalogue/finding-facts.ts:71` | `FactsFor` | type | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/guardrail-signatures.ts:282` | `guardrailSignature` | fn | 2 | AI-internal: src/catalogue/index.ts, src/insight/quarter-brief/fact-block.ts |
| `src/catalogue/index.ts:72` | `guardrailSignature` | reexp | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/catalogue/index.ts:73` | `N_FAMILY_DOESNT_MEAN` | reexp | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/lens-faces.ts:48` | `LensFaceId` | type | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/lens-faces.ts:107` | `isLensKey` | const | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/lens-faces.ts:110` | `lensFace` | fn | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/lens-faces.ts:115` | `lensFaceForKey` | fn | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/n-family-copy.ts:54` | `N_FAMILY_DOESNT_MEAN` | const | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/n-family-copy.ts:69` | `NFamilyKey` | type | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/pattern-facts.ts:198` | `PatternFacts` | iface | 1 | AI-internal: src/catalogue/types.ts |
| `src/catalogue/phs-findings.ts:61` | `phsFinding` | fn | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/quarter-metrics.ts:47` | `MetricGloss` | iface | 1 | AI-internal: src/catalogue/annual-metrics.ts |
| `src/catalogue/stock-findings.ts:772` | `findingConcern` | fn | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/stock-findings.ts:776` | `findingFamily` | fn | 1 | AI-internal: src/catalogue/index.ts |
| `src/catalogue/types.ts:46` | `RegistryId` | type | 2 | AI-internal: src/catalogue/index.ts, src/catalogue/serialise.ts |
| `src/catalogue/types.ts:72` | `KeyStatus` | type | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/types.ts:77` | `FindingFamily` | type | 2 | AI-internal: src/catalogue/stock-findings.ts, src/catalogue/tool-families.ts |
| `src/catalogue/types.ts:81` | `FindingConcern` | type | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/types.ts:92` | `StockFindingEntry` | iface | 1 | AI-internal: src/catalogue/stock-findings.ts |
| `src/catalogue/types.ts:143` | `UnmeasuredFacts` | iface | 1 | AI-internal: src/catalogue/finding-facts.ts |
| `src/catalogue/types.ts:161` | `LensFaceEntry` | iface | 1 | AI-internal: src/catalogue/lens-faces.ts |
| `src/catalogue/types.ts:187` | `GuardrailStatus` | type | 1 | AI-internal: src/catalogue/guardrail-signatures.ts |
| `src/catalogue/types.ts:189` | `GuardrailSignatureEntry` | iface | 1 | AI-internal: src/catalogue/guardrail-signatures.ts |
| `src/catalogue/types.ts:224` | `PhsFindingEntry` | iface | 1 | AI-internal: src/catalogue/phs-findings.ts |
| `src/catalogue/types.ts:242` | `Registry` | type | 2 | AI-internal: src/catalogue/guardrail-signatures.ts, src/catalogue/lens-faces.ts |
| `src/chat/compose.ts:54` | `canonicalSubjectSymbol` | fn | 1 | AI-internal: src/chat/sessions.ts |
| `src/chat/compose.ts:161` | `composeDiscussOpening` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/compose.ts:250` | `composeChatPageOpening` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/compose.ts:266` | `resolveTurnSystem` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/compose.ts:284` | `modelFacingUserTurn` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/config.ts:21` | `resolveChatModel` | fn | 20 | AI-internal: src/chat/compose.ts, src/controllers/me/chat-controller.ts, src/jobs/handlers/chat-title-generate.handler.ts |
| `src/chat/config.ts:29` | `CHAT_MAX_OUTPUT_TOKENS` | const | 1 | AI-internal: src/chat/engine.ts |
| `src/chat/config.ts:36` | `CHAT_MAX_TOOL_ROUNDS` | const | 2 | AI-internal: src/chat/engine.ts |
| `src/chat/config.ts:58` | `CHAT_MAX_TOOL_ROUNDS_WRITE` | const | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/config.ts:87` | `resolveProfileModel` | fn | 2 | AI-internal: src/chat/profile.ts |
| `src/chat/config.ts:106` | `CHAT_PROFILE_INJECT_ENABLED` | const | 2 | AI-internal: src/chat/compose.ts |
| `src/chat/config.ts:110` | `PROFILE_QUIESCENCE_MS` | const | 2 | AI-internal: src/chat/profile.ts |
| `src/chat/config.ts:113` | `PROFILE_MAX_SESSIONS_PER_RUN` | const | 3 | AI-internal: src/chat/profile.ts, src/jobs/handlers/chat-profile-distill.handler.ts |
| `src/chat/config.ts:116` | `PROFILE_GAP_DECAY_SESSIONS` | const | 2 | AI-internal: src/chat/profile.ts |
| `src/chat/config.ts:119` | `PROFILE_DEPTH_WINDOW_SESSIONS` | const | 1 | AI-internal: src/chat/profile.ts |
| `src/chat/config.ts:123` | `PROFILE_REGISTER_HYSTERESIS` | const | 2 | AI-internal: src/chat/profile.ts |
| `src/chat/date-resolve.ts:38` | `istToday` | fn | 4 | AI-internal: src/chat/tools/resolve-date.ts, src/chat/tools/write-shared.ts |
| `src/chat/date-resolve.ts:81` | `pretty` | fn | 2 | AI-internal: src/chat/tools/resolve-date.ts |
| `src/chat/date-resolve.ts:87` | `howLongAgo` | fn | 3 | AI-internal: src/chat/tools/record-transaction.ts, src/chat/tools/write-shared.ts |
| `src/chat/date-resolve.ts:128` | `boundsPhrase` | fn | 2 | AI-internal: src/chat/tools/resolve-date.ts |
| `src/chat/date-resolve.ts:393` | `resolvePhrase` | fn | 4 | AI-internal: src/chat/tools/resolve-date.ts |
| `src/chat/date-resolve.ts:443` | `datesMentionedIn` | fn | 2 | AI-internal: src/chat/tools/write-shared.ts |
| `src/chat/discuss-context.ts:24` | `DiscussContextSchema` | const | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/discuss-context.ts:34` | `DiscussSubject` | type | 1 | AI-internal: src/chat/compose.ts |
| `src/chat/discuss-context.ts:35` | `DiscussContext` | type | 6 | AI-internal: src/chat/compose.ts, src/chat/openings.ts, src/chat/sessions.ts |
| `src/chat/engine.ts:81` | `PersistedToolTurn` | iface | 2 | AI-internal: src/chat/sessions.ts |
| `src/chat/engine.ts:128` | `resolveChatProvider` | fn | 2 | AI-internal: src/chat/profile.ts, src/jobs/handlers/chat-title-generate.handler.ts |
| `src/chat/engine.ts:132` | `runChatTurn` | fn | 4 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/links.ts:91` | `comparisonPath` | const | 3 | AI-internal: src/chat/tools/open-comparison.ts |
| `src/chat/links.ts:340` | `resolveAppLinks` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/memory.ts:32` | `MEMORY_TEXT_MAX` | const | 1 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:48` | `MEMORY_MAX` | const | 3 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:223` | `classifyMemoryText` | fn | 1 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:330` | `detectNameRequest` | fn | 1 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:440` | `listMemories` | fn | 4 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:491` | `addStatedMemory` | fn | 1 | AI-internal: src/chat/tools/confirm.ts |
| `src/chat/memory.ts:595` | `resolveMemoryReference` | fn | 1 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:628` | `forgetMemoryById` | fn | 1 | AI-internal: src/chat/tools/memory.ts |
| `src/chat/memory.ts:653` | `statedMemoriesFor` | fn | 1 | AI-internal: src/chat/compose.ts |
| `src/chat/memory.ts:671` | `statedNameFor` | fn | 1 | AI-internal: src/chat/compose.ts |
| `src/chat/openings.ts:28` | `GroundingKind` | type | 1 | AI-internal: src/chat/compose.ts |
| `src/chat/openings.ts:198` | `resolveOpening` | fn | 3 | AI-internal: src/chat/compose.ts |
| `src/chat/profile.ts:45` | `VYTAL_VOCAB_KEYS` | const | 2 | AI-internal: src/chat/memory.ts |
| `src/chat/profile.ts:314` | `distilSession` | fn | 2 | AI-internal: src/jobs/handlers/chat-profile-distill.handler.ts |
| `src/chat/profile.ts:436` | `findDistillableSessions` | fn | 2 | AI-internal: src/jobs/handlers/chat-profile-distill.handler.ts |
| `src/chat/proposals.ts:36` | `ProposalKind` | type | 1 | AI-internal: src/chat/tools/confirm.ts |
| `src/chat/proposals.ts:58` | `ChangeDomain` | type | 2 | AI-internal: src/chat/tools/registry.ts, src/chat/tools/types.ts |
| `src/chat/proposals.ts:62` | `CHANGE_DOMAIN_BY_KIND` | const | 2 | AI-internal: src/chat/tools/confirm.ts |
| `src/chat/proposals.ts:73` | `ProposalField` | iface | 5 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/record-transaction.ts, src/chat/tools/reminders-write.ts (+2) |
| `src/chat/proposals.ts:78` | `PendingProposal` | iface | 1 | AI-internal: src/chat/tools/confirm.ts |
| `src/chat/proposals.ts:93` | `NewProposal` | iface | 1 | AI-internal: src/chat/tools/write-shared.ts |
| `src/chat/proposals.ts:101` | `storeProposal` | fn | 2 | AI-internal: src/chat/tools/write-shared.ts |
| `src/chat/proposals.ts:122` | `peekProposal` | fn | 9 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/proposals.ts:148` | `consumeProposal` | fn | 1 | AI-internal: src/chat/tools/confirm.ts |
| `src/chat/proposals.ts:181` | `sweepProposal` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/proposals.ts:203` | `renderProposal` | fn | 1 | AI-internal: src/chat/tools/write-shared.ts |
| `src/chat/screen-brief.ts:301` | `renderScreen` | fn | 2 | AI-internal: src/chat/tools/screen-stocks.ts |
| `src/chat/sessions.ts:40` | `serializeSession` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:104` | `serializeVisibleMessages` | fn | 4 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:143` | `loadHistoryForModel` | fn | 6 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:175` | `findResumableDiscussSession` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:190` | `getSessionWithMessages` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:232` | `createDiscussSessionWithOpening` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:277` | `createChatPageSession` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:368` | `appendUndeliveredUserMessage` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:400` | `appendFollowup` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:483` | `listVisibleSessions` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:492` | `renameSession` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts, src/routes/me-chat-routes.ts |
| `src/chat/sessions.ts:503` | `deleteSession` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts, src/routes/me-chat-routes.ts |
| `src/chat/sessions.ts:519` | `countVisibleUserMessages` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:579` | `planMessageEdit` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:624` | `applyMessageEdit` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:656` | `appendReplyAfterEdit` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:700` | `markMessageUndelivered` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/sessions.ts:738` | `sweepEmptyChatPageSessions` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/tools/alerts-write.ts:118` | `createAlertWriteTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/alerts-write.ts:308` | `deleteAlertWriteTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/boundary.ts:22` | `notInUniverse` | fn | 12 | AI-internal: src/chat/tools/get-corporate-events.ts, src/chat/tools/get-peer-group.ts, src/chat/tools/get-stock-facts.ts (+8) |
| `src/chat/tools/boundary.ts:46` | `inUniverseButUnscored` | fn | 2 | AI-internal: src/chat/tools/get-stock-facts.ts |
| `src/chat/tools/confirm.ts:135` | `confirmPendingActionTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/confirm.ts:214` | `cancelPendingActionTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/event-description.ts:132` | `parseEventDescription` | fn | 2 | AI-internal: src/chat/tools/get-corporate-events.ts |
| `src/chat/tools/event-description.ts:183` | `renderComponents` | fn | 2 | AI-internal: src/chat/tools/get-corporate-events.ts |
| `src/chat/tools/event-description.ts:196` | `SUPPRESSED_TAIL_NOTE` | const | 2 | AI-internal: src/chat/tools/get-corporate-events.ts |
| `src/chat/tools/get-corporate-events.ts:87` | `getCorporateEventsTool` | const | 2 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-findings-for-symbols.ts:140` | `getFindingsForSymbolsTool` | const | 3 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-fund-analytics.ts:73` | `getFundAnalyticsTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-instrument-details.ts:146` | `getInstrumentDetailsTool` | const | 2 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-peer-group.ts:45` | `getPeerGroupTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-peer-group.ts:84` | `getPeerGroupMembersTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-portfolio-facts.ts:28` | `getPortfolioFactsTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-facts.ts:134` | `getStockFactsTool` | const | 2 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-fundamentals.ts:288` | `familyPayload` | fn | 2 | AI-internal: src/chat/tools/get-stock-quarterly-results.ts |
| `src/chat/tools/get-stock-fundamentals.ts:299` | `readFundamentals` | fn | 1 | AI-internal: src/chat/tools/get-stock-quarterly-results.ts |
| `src/chat/tools/get-stock-fundamentals.ts:354` | `getStockFundamentalsTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-news.ts:133` | `getStockNewsTool` | const | 2 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-ownership.ts:89` | `getStockShareholdingTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-ownership.ts:131` | `getStockDealsTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-ownership.ts:180` | `getStockInsiderTradesTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-price.ts:67` | `getStockPriceTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-quarterly-results.ts:87` | `getStockQuarterlyResultsTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-stock-relationship.ts:44` | `getStockRelationshipTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-universe-scan.ts:164` | `getUniverseScanTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/get-watchlist.ts:28` | `getWatchlistTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/memory.ts:108` | `rememberThisTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/memory.ts:187` | `listMemoriesTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/memory.ts:231` | `forgetMemoryTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/open-comparison.ts:147` | `openComparisonTool` | const | 2 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/record-transaction.ts:124` | `recordTransactionTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/registry.ts:131` | `toolSpecs` | fn | 12 | AI-internal: src/chat/tools/types.ts, src/controllers/me/chat-controller.ts |
| `src/chat/tools/registry.ts:149` | `EXTENDED_ROUND_TOOLS` | const | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/tools/registry.ts:171` | `makeToolContext` | fn | 15 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/tools/registry.ts:206` | `makeToolExecutorFor` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/tools/reminders-write.ts:58` | `setEventReminderTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/resolve-date.ts:62` | `resolveDateTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/screen-stocks.ts:229` | `screenStocksTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/search-stocks.ts:63` | `searchStocksTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/shared.ts:17` | `NA` | reexp | 14 | AI-internal: src/ai/insight/relationship.ts, src/chat/screen-brief.ts, src/chat/tools/get-corporate-events.ts (+11) |
| `src/chat/tools/shared.ts:17` | `isNum` | reexp | 8 | AI-internal: src/ai/insight/relationship.ts, src/chat/tools/get-corporate-events.ts, src/chat/tools/get-stock-facts.ts (+5) |
| `src/chat/tools/shared.ts:21` | `kvLine` | const | 10 | AI-internal: src/chat/tools/get-corporate-events.ts, src/chat/tools/get-fund-analytics.ts, src/chat/tools/get-instrument-details.ts (+7) |
| `src/chat/tools/shared.ts:26` | `numStr` | const | 5 | AI-internal: src/chat/tools/get-corporate-events.ts, src/chat/tools/get-fund-analytics.ts, src/chat/tools/get-stock-fundamentals.ts (+2) |
| `src/chat/tools/shared.ts:30` | `croreStr` | const | 4 | AI-internal: src/chat/tools/get-stock-fundamentals.ts, src/chat/tools/get-stock-ownership.ts, src/chat/tools/get-stock-price.ts (+1) |
| `src/chat/tools/shared.ts:33` | `pctPoint` | const | 3 | AI-internal: src/chat/tools/get-stock-fundamentals.ts, src/chat/tools/get-stock-ownership.ts, src/chat/tools/get-stock-quarterly-results.ts |
| `src/chat/tools/shared.ts:36` | `signedPct` | const | 4 | AI-internal: src/chat/tools/get-fund-analytics.ts, src/chat/tools/get-stock-fundamentals.ts, src/chat/tools/get-stock-price.ts (+1) |
| `src/chat/tools/shared.ts:44` | `lastN` | const | 2 | AI-internal: src/chat/tools/get-stock-ownership.ts, src/chat/tools/get-stock-quarterly-results.ts |
| `src/chat/tools/shared.ts:48` | `boundedNote` | const | 2 | AI-internal: src/chat/tools/get-stock-ownership.ts, src/chat/tools/get-stock-quarterly-results.ts |
| `src/chat/tools/shared.ts:68` | `BARE_TICKER_DIRECT` | const | 8 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/get-findings-for-symbols.ts, src/chat/tools/get-stock-fundamentals.ts (+5) |
| `src/chat/tools/types.ts:20` | `ToolContextInput` | iface | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/types.ts:47` | `ToolMemo` | type | 2 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/types.ts:51` | `WebCitation` | iface | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/types.ts:61` | `AppLink` | iface | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/types.ts:67` | `ToolContext` | iface | 11 | AI-internal: src/chat/tools/get-stock-fundamentals.ts, src/chat/tools/get-stock-news.ts, src/chat/tools/get-stock-ownership.ts (+7) |
| `src/chat/tools/types.ts:140` | `ToolResult` | type | 27 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/confirm.ts, src/chat/tools/get-corporate-events.ts (+23) |
| `src/chat/tools/types.ts:160` | `ChatTool` | iface | 26 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/confirm.ts, src/chat/tools/get-corporate-events.ts (+23) |
| `src/chat/tools/watchlist-write.ts:41` | `addToWatchlistWriteTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/watchlist-write.ts:99` | `removeFromWatchlistWriteTool` | const | 1 | AI-internal: src/chat/tools/registry.ts |
| `src/chat/tools/write-shared.ts:26` | `ProposalField` | reexp | 4 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/record-transaction.ts, src/chat/tools/reminders-write.ts (+1) |
| `src/chat/tools/write-shared.ts:36` | `str` | const | 5 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/memory.ts, src/chat/tools/record-transaction.ts (+2) |
| `src/chat/tools/write-shared.ts:42` | `resolveStock` | fn | 3 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/reminders-write.ts, src/chat/tools/watchlist-write.ts |
| `src/chat/tools/write-shared.ts:51` | `requireIsoDate` | fn | 1 | AI-internal: src/chat/tools/record-transaction.ts |
| `src/chat/tools/write-shared.ts:80` | `howLongAgo` | reexp | 2 | AI-internal: src/chat/tools/record-transaction.ts |
| `src/chat/tools/write-shared.ts:156` | `attestTradeDate` | fn | 2 | AI-internal: src/chat/tools/record-transaction.ts |
| `src/chat/tools/write-shared.ts:182` | `rupees` | const | 3 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/confirm.ts, src/chat/tools/record-transaction.ts |
| `src/chat/tools/write-shared.ts:190` | `propose` | fn | 5 | AI-internal: src/chat/tools/alerts-write.ts, src/chat/tools/memory.ts, src/chat/tools/record-transaction.ts (+2) |
| `src/chat/tools/write-shared.ts:204` | `serviceMessage` | const | 2 | AI-internal: src/chat/tools/memory.ts, src/chat/tools/watchlist-write.ts |
| `src/chat/unavailable.ts:18` | `DeniedScope` | type | 1 | AI-internal: src/chat/sessions.ts |
| `src/chat/unavailable.ts:43` | `unavailableState` | fn | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/unavailable.ts:67` | `ChatQuotaState` | iface | 1 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/unavailable.ts:78` | `quotaStateFrom` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/unavailable.ts:90` | `denialFor` | fn | 1 | AI-internal: src/chat/sessions.ts |
| `src/chat/universe-brief.ts:351` | `renderUniverseSlice` | fn | 2 | AI-internal: src/chat/tools/get-universe-scan.ts |
| `src/chat/voice.ts:56` | `ANTI_ADVICE_REMINDER` | const | 3 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:115` | `detectReaderRegister` | fn | 5 | AI-internal: src/chat/compose.ts, src/chat/engine.ts |
| `src/chat/voice.ts:127` | `lastReaderTextOf` | fn | 2 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:164` | `buildCurrentTurnLanguageDirective` | fn | 1 | AI-internal: src/chat/compose.ts |
| `src/chat/voice.ts:175` | `buildLayer3Redirect` | fn | 2 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:237` | `buildFairUseWarning` | fn | 3 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:252` | `EMPTY_REPLY_FALLBACK` | const | 2 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:256` | `TOOL_CAP_FALLBACK` | const | 2 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:262` | `isBlankReply` | const | 11 | AI-internal: src/chat/engine.ts |
| `src/chat/voice.ts:308` | `buildOrientationHeader` | fn | 2 | AI-internal: src/chat/compose.ts |
| `src/chat/voice.ts:384` | `CHAT_PAGE_OPENING_BOUNDARY` | const | 2 | AI-internal: src/chat/compose.ts |
| `src/chat/voice.ts:467` | `withExternalSources` | fn | 2 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/voice.ts:489` | `withAppLinks` | fn | 3 | AI-internal: src/controllers/me/chat-controller.ts |
| `src/chat/voice.ts:500` | `buildSystemPrompt` | fn | 4 | AI-internal: src/chat/compose.ts |
| `src/chat/web/news-filter.ts:341` | `ScreenedNews` | iface | 1 | AI-internal: src/chat/tools/get-stock-news.ts |
| `src/chat/web/news-filter.ts:400` | `buildNewsQuery` | const | 2 | AI-internal: src/chat/tools/get-stock-news.ts |
| `src/chat/web/serper.ts:42` | `SerperNewsItem` | iface | 3 | AI-internal: src/chat/tools/get-stock-news.ts, src/chat/web/news-filter.ts |
| `src/chat/web/serper.ts:181` | `serperNews` | fn | 2 | AI-internal: src/chat/tools/get-stock-news.ts |
| `src/insight/quarter-brief/anchors.ts:95` | `Anchor` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/annual-contrasts.ts:71` | `AnnualContrastFact` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/annual-manifest.ts:166` | `ANNUAL_REF` | const | 1 | AI-internal: src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/annual-manifest.ts:495` | `FamilyAnnual` | iface | 1 | AI-internal: src/insight/quarter-brief/annual-rows.ts |
| `src/insight/quarter-brief/annual-manifest.ts:518` | `annualValueOf` | const | 2 | AI-internal: src/insight/quarter-brief/annual-contrasts.ts, src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/annual-manifest.ts:527` | `toAnnualDisplayValue` | fn | 2 | AI-internal: src/insight/quarter-brief/annual-contrasts.ts, src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/annual-manifest.ts:533` | `withinAnnualBounds` | fn | 2 | AI-internal: src/insight/quarter-brief/annual-contrasts.ts, src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/annual-rows.ts:198` | `fetchFamilyAnnual` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/annual-section.ts:108` | `AnnualSection` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/annual-section.ts:401` | `buildAnnualSection` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/annual-section.ts:446` | `priorFiscalYear` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/change.ts:39` | `QOQ_REF` | const | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/quarter-section.ts |
| `src/insight/quarter-brief/change.ts:40` | `YOY_REF` | const | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/quarter-section.ts |
| `src/insight/quarter-brief/change.ts:57` | `changeFact` | fn | 3 | AI-internal: src/insight/quarter-brief/annual-section.ts, src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/quarter-section.ts |
| `src/insight/quarter-brief/contrasts.ts:56` | `ContrastFact` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/driver.ts:205` | `UNEXPLAINED_BRIDGES` | const | 2 | AI-internal: src/insight/quarter-brief/contrasts.ts |
| `src/insight/quarter-brief/driver.ts:219` | `unexplainedAmount` | fn | 2 | AI-internal: src/insight/quarter-brief/contrasts.ts |
| `src/insight/quarter-brief/driver.ts:234` | `DriverFact` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/driver.ts:469` | `driverAbsence` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/fact-block.ts:763` | `buildQuarterBriefFactBlock` | fn | 20 | AI-internal: src/insight/quarter-brief/write.ts |
| `src/insight/quarter-brief/family-rows.ts:250` | `fetchFamilyQuarters` | fn | 5 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/peers.ts |
| `src/insight/quarter-brief/family-rows.ts:272` | `resolveFamilyBasis` | fn | 5 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/peers.ts |
| `src/insight/quarter-brief/format.ts:68` | `moneyLoss` | const | 4 | AI-internal: src/insight/quarter-brief/change.ts, src/insight/quarter-brief/contrasts.ts, src/insight/quarter-brief/fact-block.ts (+1) |
| `src/insight/quarter-brief/format.ts:71` | `marginPct` | const | 5 | AI-internal: src/insight/quarter-brief/annual-contrasts.ts, src/insight/quarter-brief/annual-section.ts, src/insight/quarter-brief/contrasts.ts (+2) |
| `src/insight/quarter-brief/format.ts:84` | `pointMove` | const | 3 | AI-internal: src/insight/quarter-brief/annual-contrasts.ts, src/insight/quarter-brief/annual-section.ts, src/insight/quarter-brief/quarter-section.ts |
| `src/insight/quarter-brief/format.ts:96` | `perShare` | const | 1 | AI-internal: src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/format.ts:101` | `dayCount` | const | 1 | AI-internal: src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/format.ts:125` | `MoneySense` | type | 1 | AI-internal: src/insight/quarter-brief/annual-manifest.ts |
| `src/insight/quarter-brief/format.ts:150` | `moneyAgainst` | fn | 1 | AI-internal: src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/format.ts:163` | `interestCoveragePlain` | fn | 1 | AI-internal: src/insight/quarter-brief/annual-section.ts |
| `src/insight/quarter-brief/format.ts:175` | `fractionToPct` | const | 3 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/margins.ts |
| `src/insight/quarter-brief/format.ts:180` | `combinedRatioPlain` | fn | 2 | AI-internal: src/insight/quarter-brief/margins.ts, src/insight/quarter-brief/quarter-section.ts |
| `src/insight/quarter-brief/format.ts:226` | `prettyDate` | fn | 1 | AI-internal: src/insight/quarter-brief/prompt.ts |
| `src/insight/quarter-brief/generate.ts:97` | `RefusalReason` | type | 1 | AI-internal: src/insight/quarter-brief/write.ts |
| `src/insight/quarter-brief/generate.ts:353` | `generateQuarterBrief` | fn | 5 | AI-internal: src/insight/quarter-brief/write.ts |
| `src/insight/quarter-brief/manifest.ts:93` | `MONEY_STEADY_PCT` | const | 2 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/annual-manifest.ts |
| `src/insight/quarter-brief/manifest.ts:123` | `PROFIT_EXCEEDS_REVENUE_REASON` | const | 3 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/margins.ts |
| `src/insight/quarter-brief/manifest.ts:130` | `MARGIN_NOT_A_SHARE_REASON` | const | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/manifest.ts:440` | `FamilyQuarter` | iface | 1 | AI-internal: src/insight/quarter-brief/family-rows.ts |
| `src/insight/quarter-brief/manifest.ts:473` | `valueOf` | const | 9 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/annual-contrasts.ts, src/insight/quarter-brief/contrasts.ts (+4) |
| `src/insight/quarter-brief/manifest.ts:495` | `specFor` | const | 3 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/contrasts.ts, src/insight/quarter-brief/peers.ts |
| `src/insight/quarter-brief/manifest.ts:499` | `driverEligible` | const | 1 | AI-internal: src/insight/quarter-brief/driver.ts |
| `src/insight/quarter-brief/manifest.ts:505` | `toDisplayValue` | fn | 4 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/contrasts.ts, src/insight/quarter-brief/peers.ts (+1) |
| `src/insight/quarter-brief/manifest.ts:511` | `withinBounds` | fn | 3 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/peers.ts, src/insight/quarter-brief/quarter-section.ts |
| `src/insight/quarter-brief/margins.ts:31` | `MARGIN_WINDOW` | const | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/peer-shape.ts:48` | `MIN_PEERS_FILED` | const | 2 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/peers.ts |
| `src/insight/quarter-brief/peer-shape.ts:129` | `PeerContextFact` | iface | 3 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/peers.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/peers.ts:44` | `MIN_PEERS_FILED` | reexp | 1 | AI-internal: src/insight/quarter-brief/anchors.ts |
| `src/insight/quarter-brief/peers.ts:45` | `PeerContextFact` | reexp | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/peers.ts:213` | `computePeerContext` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/prompt.ts:74` | `QUARTER_BRIEF_SYSTEM` | const | 3 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/prompt.ts:380` | `renderFactText` | fn | 13 | AI-internal: src/insight/quarter-brief/generate.ts, src/insight/quarter-brief/write.ts |
| `src/insight/quarter-brief/quarter-section.ts:43` | `MetricLine` | iface | 2 | AI-internal: src/insight/quarter-brief/anchors.ts, src/insight/quarter-brief/story.ts |
| `src/insight/quarter-brief/quarter-section.ts:84` | `QuarterSection` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/schema.ts:79` | `MAX_TAKEAWAY_BULLETS` | const | 1 | AI-internal: src/insight/quarter-brief/prompt.ts |
| `src/insight/quarter-brief/schema.ts:170` | `TAKEAWAY_RESPONSE_SCHEMA` | const | 1 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/schema.ts:191` | `RawTakeaway` | iface | 1 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/schema.ts:230` | `takeawayShapeError` | fn | 1 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/schema.ts:255` | `checkEchoes` | fn | 1 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/schema.ts:286` | `assembleBriefPayload` | fn | 1 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/schema.ts:357` | `emptySections` | fn | 5 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/schema.ts:403` | `stringLeaves` | fn | 1 | AI-internal: src/insight/quarter-brief/generate.ts |
| `src/insight/quarter-brief/story.ts:123` | `STOOD` | const | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/story.ts:189` | `buildStory` | fn | 4 | AI-internal: src/insight/quarter-brief/prompt.ts |
| `src/insight/quarter-brief/types.ts:26` | `Fact` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:44` | `ChangeFact` | iface | 2 | AI-internal: src/insight/quarter-brief/change.ts, src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:55` | `LineComparison` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/story.ts |
| `src/insight/quarter-brief/types.ts:67` | `DisagreementFact` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:73` | `HeadlineSection` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:86` | `ProfitSourceSection` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:94` | `MarginSeries` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/margins.ts |
| `src/insight/quarter-brief/types.ts:114` | `MarginsSection` | iface | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/margins.ts |
| `src/insight/quarter-brief/types.ts:121` | `PillarDelta` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:130` | `FindingChange` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:138` | `ScoreChange` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:148` | `HealthMovementSection` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:175` | `HeadlineHealthDivergence` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:180` | `BriefIdentity` | iface | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/types.ts:199` | `PeerContextFact` | reexp | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/peers.ts |
| `src/insight/quarter-brief/types.ts:202` | `QuarterBriefFactBlock` | iface | 8 | AI-internal: src/insight/quarter-brief/fact-block.ts, src/insight/quarter-brief/generate.ts, src/insight/quarter-brief/prompt.ts (+2) |
| `src/insight/quarter-brief/verdict.ts:41` | `LineDirection` | type | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/verdict.ts:150` | `VERDICT_NONE` | const | 1 | AI-internal: src/insight/quarter-brief/write.ts |
| `src/insight/quarter-brief/verdict.ts:171` | `GNPA_MATERIAL_PP` | const | 2 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/verdict.ts:249` | `Verdict` | iface | 1 | AI-internal: src/insight/quarter-brief/types.ts |
| `src/insight/quarter-brief/verdict.ts:263` | `computeVerdict` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/verdict.ts:311` | `directionOf` | fn | 1 | AI-internal: src/insight/quarter-brief/fact-block.ts |
| `src/insight/quarter-brief/write.ts:56` | `writeQuarterBrief` | fn | 7 | AI-internal: src/jobs/handlers/quarter-brief.handler.ts |
| `src/insight/quarter-brief/write.ts:151` | `markBriefsStale` | fn | 1 | AI-internal: src/insight/quarter-brief/invalidate.ts |
| `src/scoring/guardrail/behaviour.ts:36` | `BehaviourAudit` | iface | 1 | AI-internal: src/scoring/guardrail/scoring-gate.ts |
| `src/scoring/guardrail/behaviour.ts:84` | `applyBehaviourForPG` | fn | 1 | AI-internal: src/scoring/guardrail/scoring-gate.ts |
| `src/scoring/guardrail/gate.ts:126` | `runGuardrailGateForPG` | fn | 1 | AI-internal: src/scoring/guardrail/scoring-gate.ts |
| `src/scoring/guardrail/outcomes.ts:36` | `ResolvedOutcome` | iface | 1 | AI-internal: src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/outcomes.ts:48` | `localEventId` | fn | 1 | AI-internal: src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/outcomes.ts:58` | `resolveOutcome` | fn | 5 | AI-internal: src/scoring/guardrail/gate.ts, src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/review.ts:38` | `GuardrailReviewRow` | iface | 1 | AI-internal: src/scoring/guardrail/persist.ts |
| `src/scoring/guardrail/review.ts:49` | `proposeReview` | fn | 2 | AI-internal: src/scoring/guardrail/gate.ts |
| `src/scoring/guardrail/review.ts:82` | `RulingApplication` | iface | 1 | AI-internal: src/scoring/guardrail/persist.ts |
| `src/scoring/guardrail/signatures/a1-stale-results.ts:30` | `a1StaleResults` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/a2-missing-fields.ts:49` | `a2MissingFields` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/a3-insufficient-history.ts:36` | `a3InsufficientHistory` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/a4-inactive.ts:28` | `a4Inactive` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/b1-exceptional-gain.ts:39` | `b1ExceptionalGain` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/b2-exceptional-loss.ts:35` | `b2ExceptionalLoss` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/b3-tax-distortion.ts:36` | `b3TaxDistortion` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/b4-other-income.ts:36` | `b4OtherIncome` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/b5-holdco-extraction.ts:35` | `b5HoldcoExtraction` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/below-line-core.ts:69` | `analyzeBelowLine` | fn | 4 | AI-internal: src/scoring/guardrail/signatures/b1-exceptional-gain.ts, src/scoring/guardrail/signatures/b2-exceptional-loss.ts, src/scoring/guardrail/signatures/b3-tax-distortion.ts (+1) |
| `src/scoring/guardrail/signatures/c1-structural-step.ts:46` | `c1StructuralStep` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/c2-share-count.ts:34` | `c2ShareCount` | const | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/signatures/registry.ts:65` | `applicableBuiltSignatures` | fn | 1 | AI-internal: src/scoring/guardrail/gate.ts |
| `src/scoring/guardrail/signatures/registry.ts:150` | `canSuppress` | const | 2 | AI-internal: src/scoring/guardrail/behaviour.ts |
| `src/scoring/guardrail/signatures/registry.ts:156` | `behaviourGroups` | fn | 2 | AI-internal: src/scoring/guardrail/scoring-gate.ts |
| `src/scoring/guardrail/suppression-adapter.ts:60` | `toSuppressionPredicates` | fn | 3 | AI-internal: src/scoring/guardrail/scoring-gate.ts |
| `src/scoring/guardrail/types.ts:29` | `Outcome` | type | 3 | AI-internal: src/scoring/guardrail/persist.ts, src/scoring/guardrail/review.ts, src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/types.ts:34` | `Tier` | type | 2 | AI-internal: src/scoring/guardrail/persist.ts, src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/types.ts:56` | `SignatureCategory` | type | 1 | AI-internal: src/scoring/guardrail/signatures/registry.ts |
| `src/scoring/guardrail/types.ts:61` | `IndustryPath` | type | 1 | AI-internal: src/scoring/guardrail/scoring-gate.ts |
| `src/scoring/guardrail/types.ts:136` | `AffectedMetric` | iface | 8 | AI-internal: src/scoring/guardrail/outcomes.ts, src/scoring/guardrail/signatures/a2-missing-fields.ts, src/scoring/guardrail/signatures/b1-exceptional-gain.ts (+5) |
| `src/scoring/guardrail/types.ts:146` | `SignatureResult` | iface | 17 | AI-internal: src/scoring/guardrail/outcomes.ts, src/scoring/guardrail/review.ts, src/scoring/guardrail/signatures/a1-stale-results.ts (+10) |
| `src/scoring/guardrail/types.ts:164` | `Signature` | iface | 12 | AI-internal: src/scoring/guardrail/signatures/a1-stale-results.ts, src/scoring/guardrail/signatures/a2-missing-fields.ts, src/scoring/guardrail/signatures/a3-insufficient-history.ts (+9) |
| `src/scoring/guardrail/types.ts:181` | `GuardrailEventRow` | iface | 3 | AI-internal: src/scoring/guardrail/gate.ts, src/scoring/guardrail/outcomes.ts, src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/types.ts:195` | `SuppressionDirectiveRow` | iface | 5 | AI-internal: src/scoring/guardrail/behaviour.ts, src/scoring/guardrail/gate.ts, src/scoring/guardrail/outcomes.ts (+2) |
| `src/scoring/guardrail/types.ts:209` | `StockLevelAction` | iface | 3 | AI-internal: src/scoring/guardrail/gate.ts, src/scoring/guardrail/outcomes.ts, src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/types.ts:223` | `Annotation` | iface | 3 | AI-internal: src/scoring/guardrail/gate.ts, src/scoring/guardrail/outcomes.ts, src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/types.ts:238` | `PendingReview` | iface | 2 | AI-internal: src/scoring/guardrail/gate.ts, src/scoring/guardrail/review.ts |
| `src/scoring/guardrail/types.ts:247` | `GuardrailEvalResult` | iface | 5 | AI-internal: src/scoring/guardrail/behaviour.ts, src/scoring/guardrail/gate.ts, src/scoring/guardrail/persist.ts (+1) |

#### KEEP — 162 exports

| file:line | symbol | kind | imp | evidence |
|---|---|---|---|---|
| `src/ai/grounding.ts:118` | `scoreStr` | const | 9 | prod: src/relational/entries.ts |
| `src/ai/grounding.ts:136` | `pctStr` | const | 4 | prod: src/relational/entries.ts |
| `src/ai/guardrail.ts:750` | `scanExplanationText` | fn | 23 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/ai/insight/relationship.ts:92` | `probeStockRelationship` | fn | 6 | prod: src/relational/reader-context.ts, src/relational/reader-exposure.ts, src/results-season/service.ts |
| `src/ai/tone.ts:36` | `ToneLevel` | type | 3 | prod: src/relational/copy.ts, src/relational/types.ts |
| `src/ai/tone.ts:363` | `resolveToneForUser` | fn | 2 | prod: src/relational/reader-context.ts |
| `src/catalogue/annual-metrics.ts:50` | `ANNUAL_METRIC_GLOSSES` | const | 1 | CI-gate script: src/scripts/verify-annual-metrics.ts |
| `src/catalogue/annual-metrics.ts:365` | `AnnualMetricKey` | type | 7 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-annual-metrics.ts (+1) |
| `src/catalogue/annual-metrics.ts:367` | `ANNUAL_METRIC_KEYS` | const | 1 | CI-gate script: src/scripts/verify-annual-metrics.ts |
| `src/catalogue/annual-metrics.ts:370` | `annualMetricGloss` | const | 4 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts |
| `src/catalogue/divergence.ts:53` | `DIVERGENCE_SUB_TYPE_KEYS` | const | 3 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/divergence.ts:62` | `CONSOLIDATED_DIVERGENCE_KEY` | const | 2 | prod: src/scoring/read/symbol-findings.service.ts, src/scoring/read/universe-projection.service.ts |
| `src/catalogue/divergence.ts:66` | `isDivergenceSubType` | const | 2 | prod: src/scoring/read/symbol-findings.service.ts, src/scoring/read/universe-projection.service.ts |
| `src/catalogue/divergence.ts:73` | `severityWeight` | fn | 7 | prod: src/scoring/read/divergence-headline.ts, src/scoring/read/health-view.service.ts, src/scoring/read/peer-group-view.service.ts (+4) |
| `src/catalogue/divergence.ts:121` | `consolidateDivergence` | fn | 3 | prod: src/scoring/read/symbol-findings.service.ts, src/scoring/read/universe-projection.service.ts |
| `src/catalogue/divergence.ts:149` | `consolidatedKeyCount` | fn | 1 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/evidence-facts.ts:359` | `EVIDENCE_FACTS` | const | 3 | CI-gate script: src/scripts/gen-frontend-fallback.ts, src/scripts/verify-evidence-facts.ts |
| `src/catalogue/evidence-facts.ts:382` | `evidenceFact` | const | 1 | prod: src/scoring/findings/evidence-render.ts |
| `src/catalogue/evidence-facts.ts:388` | `READER_EVIDENCE_FACTS` | const | 2 | CI-gate script: src/scripts/gen-frontend-fallback.ts, src/scripts/verify-evidence-facts.ts |
| `src/catalogue/finding-facts.ts:207` | `FINDING_FACTS` | const | 4 | CI-gate script: src/scripts/gen-frontend-fallback.ts, src/scripts/verify-evidence-facts.ts (+1) |
| `src/catalogue/finding-facts.ts:223` | `findingPrecision` | const | 1 | prod: src/scoring/findings/evidence-render.ts |
| `src/catalogue/guardrail-signatures.ts:113` | `consequenceForBehaviour` | const | 1 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/guardrail-signatures.ts:253` | `GUARDRAIL_SIGNATURE_KEYS` | const | 4 | CI-gate script: src/scripts/verify-catalogue-endpoint.ts, src/scripts/verify-catalogue.ts |
| `src/catalogue/guardrail-signatures.ts:264` | `GUARDRAIL_SIGNATURES` | const | 3 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/index.ts:71` | `PHS_FINDINGS` | reexp | 2 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/index.ts:71` | `PHS_FINDING_IDS` | reexp | 3 | CI-gate script: src/scripts/verify-catalogue-endpoint.ts, src/scripts/verify-catalogue.ts |
| `src/catalogue/index.ts:72` | `GUARDRAIL_SIGNATURES` | reexp | 2 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/index.ts:72` | `GUARDRAIL_SIGNATURE_KEYS` | reexp | 3 | CI-gate script: src/scripts/verify-catalogue-endpoint.ts, src/scripts/verify-catalogue.ts |
| `src/catalogue/index.ts:73` | `N_FAMILY_COPY` | reexp | 2 | prod: src/scoring/findings/verdicts.ts |
| `src/catalogue/index.ts:76` | `CATALOGUE` | const | 1 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/lens-faces.ts:43` | `LENS_FACE_IDS` | const | 5 | CI-gate script: src/scripts/gen-frontend-fallback.ts, src/scripts/verify-catalogue-endpoint.ts (+1) |
| `src/catalogue/lens-faces.ts:74` | `LENS_FACES` | const | 5 | CI-gate script: src/scripts/gen-frontend-fallback.ts, src/scripts/verify-catalogue.ts |
| `src/catalogue/lens-faces.ts:99` | `faceIdOfLensKey` | fn | 4 | prod: src/scoring/read/peer-group-view.service.ts |
| `src/catalogue/metric-view-fields.ts:58` | `DisplayUnit` | type | 1 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts |
| `src/catalogue/metric-view-fields.ts:60` | `displayUnitFor` | fn | 1 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts |
| `src/catalogue/metric-view-fields.ts:78` | `QUARTER_VIEW_FIELD` | const | 1 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts |
| `src/catalogue/metric-view-fields.ts:127` | `ANNUAL_VIEW_FIELD` | const | 1 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts |
| `src/catalogue/n-family-copy.ts:78` | `N_FAMILY_COPY` | const | 2 | prod: src/scoring/findings/verdicts.ts |
| `src/catalogue/not-covered.ts:74` | `NOT_COVERED_IDS` | const | 1 | CI-gate script: src/scripts/verify-not-covered.ts |
| `src/catalogue/not-covered.ts:77` | `NotCoveredId` | type | 3 | prod: src/scoring/findings/not-covered-eval.ts, src/scoring/findings/persist.ts, src/scoring/read/not-covered.service.ts |
| `src/catalogue/not-covered.ts:89` | `NotCoveredReason` | type | 2 | prod: src/scoring/findings/not-covered-eval.ts, src/scoring/read/not-covered.service.ts |
| `src/catalogue/not-covered.ts:122` | `NotCoveredRecord` | iface | 1 | prod: src/scoring/findings/not-covered-eval.ts |
| `src/catalogue/not-covered.ts:153` | `NOT_COVERED_SILENT_LINE` | const | 3 | prod: src/scoring/read/health-view.service.ts |
| `src/catalogue/not-covered.ts:175` | `NOT_COVERED_AUTHORITATIVE_TABLE` | const | 1 | CI-gate script: src/scripts/verify-not-covered.ts |
| `src/catalogue/not-covered.ts:193` | `NOT_COVERED` | const | 2 | prod: src/scoring/read/not-covered.service.ts |
| `src/catalogue/not-covered.ts:234` | `NOT_COVERED_RECORDS` | const | 3 | prod: src/scoring/findings/not-covered-eval.ts |
| `src/catalogue/not-covered.ts:245` | `NOT_COVERED_KEY_PREFIX` | const | 1 | CI-gate script: src/scripts/verify-sql-predicates.ts |
| `src/catalogue/not-covered.ts:248` | `notCoveredPatternKey` | const | 3 | prod: src/scoring/composite/score-pass.ts, src/scoring/read/health-view.service.ts |
| `src/catalogue/not-covered.ts:252` | `isNotCoveredKey` | const | 3 | prod: src/alerts/finding-catalog.ts |
| `src/catalogue/not-covered.ts:264` | `dropNotCoveredPatterns` | const | 10 | prod: src/alerts/eval-pass.ts, src/controllers/me/watchlist-enrich.ts, src/relational/object-state.ts (+6) |
| `src/catalogue/not-covered.ts:277` | `notCoveredKeysSqlPredicate` | fn | 4 | prod: src/relational/base-rates.ts, src/relational/reader-context.ts |
| `src/catalogue/pattern-facts.ts:48` | `PatternSubject` | type | 4 | prod: src/scoring/findings/not-covered-eval.ts, src/scoring/read/finding-lifecycle.service.ts, src/scoring/read/not-covered.service.ts |
| `src/catalogue/pattern-facts.ts:62` | `PatternBasis` | type | 1 | prod: src/scoring/read/finding-lifecycle.service.ts |
| `src/catalogue/pattern-facts.ts:125` | `PatternState` | type | 1 | prod: src/scoring/findings/divergence/pattern-state.ts |
| `src/catalogue/pattern-facts.ts:282` | `ServedPatternFacts` | type | 2 | prod: src/scoring/read/health-view.types.ts |
| `src/catalogue/pattern-facts.ts:304` | `MATERIAL_GAP_FLOOR` | const | 1 | prod: src/scoring/findings/divergence/bands.ts |
| `src/catalogue/pattern-facts.ts:310` | `ALIGNED_GAP_CEILING` | const | 1 | prod: src/scoring/findings/divergence/bands.ts |
| `src/catalogue/pattern-facts.ts:335` | `MARKET_ELEVATED_FLOOR` | const | 2 | prod: src/scoring/findings/rules/d1-price-ahead-quality.ts, src/scoring/findings/rules/d2-price-ahead-trajectory.ts |
| `src/catalogue/pattern-facts.ts:351` | `PATTERN_KEYS` | const | 5 | CI-gate script: src/scripts/verify-copy-register.ts, src/scripts/verify-not-covered.ts (+1) |
| `src/catalogue/pattern-facts.ts:374` | `PatternKey` | type | 5 | prod: src/scoring/findings/verdicts.ts, src/scoring/read/finding-lifecycle.service.ts |
| `src/catalogue/pattern-facts.ts:387` | `PATTERN_FACTS` | const | 9 | prod: src/scoring/findings/verdicts.ts, src/scoring/read/divergence-headline.ts, src/scoring/read/finding-lifecycle.service.ts (+2) |
| `src/catalogue/pattern-facts.ts:913` | `isPatternKey` | const | 6 | prod: src/scoring/findings/verdicts.ts, src/scoring/read/divergence-headline.ts, src/scoring/read/finding-lifecycle.service.ts (+2) |
| `src/catalogue/phs-findings.ts:50` | `PHS_FINDINGS` | const | 3 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/catalogue/phs-findings.ts:59` | `PHS_FINDING_IDS` | const | 4 | CI-gate script: src/scripts/verify-catalogue-endpoint.ts, src/scripts/verify-catalogue.ts |
| `src/catalogue/quarter-metrics.ts:56` | `QUARTER_METRIC_GLOSSES` | const | 2 | CI-gate script: src/scripts/verify-annual-metrics.ts, src/scripts/verify-quarter-metrics.ts |
| `src/catalogue/quarter-metrics.ts:513` | `MetricKey` | type | 12 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-quarter-brief-anchors.ts (+1) |
| `src/catalogue/quarter-metrics.ts:515` | `METRIC_KEYS` | const | 1 | CI-gate script: src/scripts/verify-quarter-metrics.ts |
| `src/catalogue/quarter-metrics.ts:518` | `metricGloss` | const | 13 | prod: src/scoring/read/result-detail.service.ts, src/scoring/read/results-feed.cache.ts |
| `src/catalogue/retired-findings.ts:58` | `RETIRED_FINDING_KEYS` | const | 6 | prod: src/alerts/finding-catalog.ts |
| `src/catalogue/retired-findings.ts:107` | `RetiredFindingKey` | type | 1 | prod: src/scoring/findings/types.ts |
| `src/catalogue/retired-findings.ts:112` | `isRetiredFinding` | const | 5 | prod: src/alerts/finding-catalog.ts, src/scoring/read/divergence-headline.ts, src/scoring/read/finding-lifecycle.service.ts (+1) |
| `src/catalogue/retired-findings.ts:127` | `dropRetiredPatterns` | const | 9 | prod: src/alerts/eval-pass.ts, src/controllers/me/watchlist-enrich.ts, src/relational/object-state.ts (+6) |
| `src/catalogue/retired-findings.ts:154` | `retiredKeysSqlPredicate` | fn | 3 | prod: src/relational/base-rates.ts, src/relational/reader-context.ts |
| `src/catalogue/serialise.ts:38` | `SERVED_REGISTRIES` | const | 3 | prod: src/controllers/catalogue-controller.ts |
| `src/catalogue/serialise.ts:39` | `ServedRegistry` | type | 2 | CI-gate script: src/scripts/verify-catalogue-endpoint.ts |
| `src/catalogue/serialise.ts:41` | `isServedRegistry` | const | 1 | prod: src/controllers/catalogue-controller.ts |
| `src/catalogue/serialise.ts:91` | `servedFacts` | const | 1 | prod: src/scoring/read/health-view.service.ts |
| `src/catalogue/serialise.ts:149` | `CATALOGUE_DOCUMENT` | const | 4 | prod: src/controllers/catalogue-controller.ts |
| `src/catalogue/serialise.ts:166` | `registrySegment` | const | 1 | prod: src/controllers/catalogue-controller.ts |
| `src/catalogue/serialise.ts:185` | `stockFindingNames` | const | 1 | prod: src/controllers/catalogue-controller.ts |
| `src/catalogue/serialise.ts:193` | `byteSize` | const | 1 | CI-gate script: src/scripts/verify-catalogue-endpoint.ts |
| `src/catalogue/stock-findings.ts:64` | `STOCK_FINDING_KEYS` | const | 14 | prod: src/alerts/finding-catalog.ts, src/scoring/read/universe-projection.service.ts |
| `src/catalogue/stock-findings.ts:129` | `StockFindingKey` | type | 6 | prod: src/alerts/finding-catalog.ts, src/filing/registry.ts, src/scoring/findings/types.ts |
| `src/catalogue/stock-findings.ts:178` | `FAMILY_DOESNT_MEAN` | const | 8 | prod: src/scoring/read/universe-projection.service.ts |
| `src/catalogue/stock-findings.ts:198` | `LENS_DOESNT_MEAN` | const | 7 | CI-gate script: src/scripts/cross-repo/verify-boundary-render.ts, src/scripts/gen-frontend-fallback.ts (+2) |
| `src/catalogue/stock-findings.ts:211` | `familyOf` | fn | 4 | prod: src/scoring/findings/verdicts.ts, src/scoring/read/universe-projection.service.ts |
| `src/catalogue/stock-findings.ts:724` | `STOCK_FINDINGS` | const | 56 | prod: src/alerts/finding-catalog.ts, src/scoring/findings/divergence/aligned.ts, src/scoring/findings/divergence/resolution.ts (+42) |
| `src/catalogue/stock-findings.ts:756` | `findingName` | fn | 15 | prod: src/filing/read.ts, src/portfolio/phs/assemble.ts, src/scoring/findings/verdicts.ts (+4) |
| `src/catalogue/stock-findings.ts:767` | `findingDescription` | fn | 7 | prod: src/filing/read.ts, src/scoring/findings/verdicts.ts, src/scoring/read/symbol-findings.service.ts (+2) |
| `src/catalogue/stock-findings.ts:788` | `doesntMean` | fn | 8 | prod: src/filing/read.ts, src/scoring/findings/verdicts.ts, src/scoring/read/symbol-findings.service.ts (+2) |
| `src/catalogue/tool-families.ts:32` | `ToolId` | type | 1 | prod: src/scoring/read/tool-scan.service.ts |
| `src/catalogue/tool-families.ts:53` | `forTool` | fn | 2 | prod: src/scoring/read/health-view.service.ts, src/scoring/read/tool-scan.service.ts |
| `src/catalogue/types.ts:233` | `CatalogueEntry` | type | 2 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/chat/tools/shared.ts:17` | `scoreStr` | reexp | 8 | prod: src/relational/entries.ts |
| `src/chat/tools/shared.ts:17` | `pctStr` | reexp | 3 | prod: src/relational/entries.ts |
| `src/chat/web/news-filter.ts:39` | `shortenCompanyName` | fn | 5 | prod: src/ingestions/news_and_announcements/relevance.ts |
| `src/chat/web/news-filter.ts:87` | `EntityGuard` | iface | 2 | prod: src/ingestions/news_and_announcements/relevance.ts |
| `src/chat/web/news-filter.ts:188` | `buildEntityGuard` | fn | 3 | prod: src/ingestions/news_and_announcements/relevance.ts |
| `src/chat/web/news-filter.ts:339` | `DropReason` | type | 1 | prod: src/ingestions/news_and_announcements/relevance.ts |
| `src/chat/web/news-filter.ts:359` | `screenNewsItems` | fn | 3 | prod: src/ingestions/news_and_announcements/relevance.ts |
| `src/insight/quarter-brief/anchors.ts:55` | `HISTORY_MIN_LEVELS` | const | 1 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:60` | `HISTORY_MIN_MOVES` | const | 1 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:64` | `DEEP_HISTORY` | const | 1 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:70` | `MAX_ANCHORS_PER_CARD` | const | 1 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:85` | `ANCHOR_ALWAYS` | const | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:302` | `computeAnchors` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:378` | `withAnchors` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/anchors.ts:390` | `movementWithAnchor` | fn | 3 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/annual-contrasts.ts:126` | `computeAnnualContrasts` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/annual-manifest.ts:95` | `Family` | reexp | 18 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-annual-metrics.ts (+2) |
| `src/insight/quarter-brief/annual-manifest.ts:127` | `AnnualMetricSpec` | iface | 2 | CI-gate script: src/scripts/verify-annual-metrics.ts |
| `src/insight/quarter-brief/annual-manifest.ts:230` | `ANNUAL_MANIFEST` | const | 1 | CI-gate script: src/scripts/verify-annual-metrics.ts |
| `src/insight/quarter-brief/annual-manifest.ts:480` | `SCALE_SEAMS` | const | 1 | CI-gate script: src/scripts/verify-annual-metrics.ts |
| `src/insight/quarter-brief/annual-manifest.ts:510` | `AnyFamilyAnnual` | type | 5 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/annual-manifest.ts:522` | `annualManifestFor` | const | 5 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/annual-section.ts:77` | `AnnualLine` | iface | 1 | prod: src/scoring/read/result-detail.service.ts |
| `src/insight/quarter-brief/contrasts.ts:166` | `computeContrasts` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/driver.ts:294` | `computeDriver` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/format.ts:29` | `money` | fn | 9 | CI-gate script: src/scripts/cross-repo/verify-quarter-brief-money.ts |
| `src/insight/quarter-brief/format.ts:40` | `MONEY_RULE` | const | 1 | CI-gate script: src/scripts/cross-repo/verify-quarter-brief-money.ts |
| `src/insight/quarter-brief/format.ts:80` | `times` | const | 3 | prod: src/scoring/read/health-view.service.ts |
| `src/insight/quarter-brief/format.ts:129` | `moneyIn` | fn | 2 | CI-gate script: src/scripts/cross-repo/verify-quarter-brief-money.ts |
| `src/insight/quarter-brief/invalidate.ts:117` | `invalidateBriefsForEdit` | fn | 1 | prod: src/fill/raw-field-edit.ts |
| `src/insight/quarter-brief/manifest.ts:44` | `Family` | type | 19 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-annual-metrics.ts (+2) |
| `src/insight/quarter-brief/manifest.ts:45` | `Basis` | type | 6 | prod: src/controllers/stocks-list-controller.ts, src/scoring/read/fundamentals-view.service.ts |
| `src/insight/quarter-brief/manifest.ts:66` | `MetricSpec` | iface | 3 | CI-gate script: src/scripts/verify-quarter-metrics.ts |
| `src/insight/quarter-brief/manifest.ts:135` | `FAMILY_MANIFEST` | const | 1 | CI-gate script: src/scripts/verify-quarter-metrics.ts |
| `src/insight/quarter-brief/manifest.ts:463` | `AnyFamilyQuarter` | type | 9 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/manifest.ts:482` | `TOP_LINE_KEY` | const | 6 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-quarter-metrics.ts |
| `src/insight/quarter-brief/manifest.ts:491` | `manifestFor` | const | 5 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/margins.ts:23` | `MarginRow` | iface | 2 | CI-gate script: src/scripts/verify-quarter-brief-vocabulary.ts |
| `src/insight/quarter-brief/margins.ts:181` | `buildMargins` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-vocabulary.ts |
| `src/insight/quarter-brief/peer-shape.ts:97` | `peerMetricsFor` | const | 3 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/peer-shape.ts:108` | `PeerCrossSection` | iface | 3 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/peer-shape.ts:154` | `buildPeerComparisons` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/peers.ts:45` | `PeerCrossSection` | reexp | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/personal.ts:131` | `PersonalSection` | iface | 1 | prod: src/scoring/read/result-detail.types.ts |
| `src/insight/quarter-brief/personal.ts:197` | `buildPersonalSection` | fn | 2 | prod: src/scoring/read/result-detail.service.ts |
| `src/insight/quarter-brief/quarter-section.ts:230` | `buildQuarterSection` | fn | 2 | CI-gate script: src/scripts/verify-quarter-brief-anchors.ts |
| `src/insight/quarter-brief/schema.ts:155` | `BriefPayload` | iface | 12 | prod: src/scoring/read/result-detail.service.ts, src/scoring/read/result-detail.types.ts |
| `src/insight/quarter-brief/types.ts:22` | `Family` | type | 19 | CI-gate script: src/scripts/gen-frontend-metric-catalogue.ts, src/scripts/verify-annual-metrics.ts (+2) |
| `src/insight/quarter-brief/types.ts:23` | `Basis` | type | 6 | prod: src/controllers/stocks-list-controller.ts, src/scoring/read/fundamentals-view.service.ts |
| `src/insight/quarter-brief/verdict.ts:48` | `VERDICT_KEYS` | const | 3 | CI-gate script: src/scripts/cross-repo/verify-quarter-brief-badge.ts, src/scripts/verify-quarter-brief-vocabulary.ts |
| `src/insight/quarter-brief/verdict.ts:72` | `VERDICTS` | const | 5 | CI-gate script: src/scripts/cross-repo/verify-quarter-brief-badge.ts, src/scripts/verify-catalogue-endpoint.ts (+3) |
| `src/insight/quarter-brief/verdict.ts:136` | `VERDICT_DOESNT_MEAN` | const | 2 | CI-gate script: src/scripts/cross-repo/verify-quarter-brief-badge.ts, src/scripts/verify-quarter-brief-vocabulary.ts |
| `src/insight/quarter-brief/verdict.ts:152` | `readVerdict` | fn | 2 | prod: src/scoring/read/result-detail.service.ts |
| `src/insight/quarter-brief/verdict.ts:327` | `BADGE_TREATMENT` | const | 1 | CI-gate script: src/scripts/verify-quarter-brief-vocabulary.ts |
| `src/insight/quarter-brief/write.ts:35` | `fingerprintOf` | const | 7 | prod: src/portfolio/phs/constants.ts |
| `src/scoring/guardrail/gate.ts:55` | `runGuardrailGate` | fn | 5 | prod: src/scoring/findings/guards/annual-exceptional.ts |
| `src/scoring/guardrail/persist.ts:89` | `writeGuardrailEval` | fn | 2 | prod: src/scoring/composite/score-pass.ts |
| `src/scoring/guardrail/review.ts:33` | `Ruling` | type | 1 | prod: src/portfolio/phs/constants.ts |
| `src/scoring/guardrail/scoring-gate.ts:43` | `GateMemberSource` | iface | 1 | prod: src/scoring/composite/score-pass.ts |
| `src/scoring/guardrail/scoring-gate.ts:103` | `ScoringGateResult` | iface | 1 | prod: src/scoring/composite/score-pass.ts |
| `src/scoring/guardrail/scoring-gate.ts:125` | `gateNotRun` | fn | 1 | prod: src/scoring/composite/score-pass.ts |
| `src/scoring/guardrail/scoring-gate.ts:142` | `runScoringGate` | fn | 1 | prod: src/scoring/composite/score-pass.ts |
| `src/scoring/guardrail/scoring-gate.ts:171` | `behaviourContractLine` | fn | 1 | prod: src/scoring/composite/score-pass.ts |
| `src/scoring/guardrail/signatures/registry.ts:104` | `GuardrailBehaviour` | type | 3 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/scoring/guardrail/signatures/registry.ts:106` | `GUARDRAIL_BEHAVIOUR` | const | 4 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/scoring/guardrail/signatures/registry.ts:153` | `isEvaluable` | const | 4 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/scoring/guardrail/types.ts:40` | `SignatureKey` | type | 6 | CI-gate script: src/scripts/verify-catalogue.ts |
| `src/scoring/guardrail/types.ts:68` | `LatestFundamentalInput` | iface | 6 | prod: src/scoring/findings/guards/annual-exceptional.ts |
| `src/scoring/guardrail/types.ts:89` | `GuardrailStockInput` | iface | 18 | prod: src/scoring/findings/guards/annual-exceptional.ts |

#### UNCLEAR — 270 exports

| file:line | symbol | kind | imp | evidence |
|---|---|---|---|---|
| `src/ai/adapters/gemini.ts:53` | `toGeminiContents` | fn | 1 | one-off script only: src/scripts/verify-tool-provider.ts |
| `src/ai/adapters/gemini.ts:81` | `toGeminiTools` | fn | 1 | one-off script only: src/scripts/verify-tool-provider.ts |
| `src/ai/adapters/gemini.ts:95` | `textFromGeminiResponse` | fn | 0 | over-export: 0 importers, used in own file |
| `src/ai/adapters/gemini.ts:112` | `parseGeminiToolCallsFromParts` | fn | 0 | over-export: 0 importers, used in own file |
| `src/ai/adapters/gemini.ts:129` | `parseGeminiToolCalls` | fn | 1 | one-off script only: src/scripts/verify-tool-provider.ts |
| `src/ai/adapters/mock.ts:28` | `MockStep` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/adapters/mock.ts:38` | `__setMockScript` | fn | 1 | one-off script only: src/scripts/verify-tool-provider.ts |
| `src/ai/filing-facts.ts:78` | `FILING_CHANNEL_NOTE_SHORT` | const | 0 | over-export: 0 importers, used in own file |
| `src/ai/grounding.ts:32` | `GroundingSources` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/grounding.ts:39` | `StockGrounding` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/grounding.ts:45` | `PortfolioGrounding` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/grounding.ts:76` | `PortfolioFactMode` | type | 0 | over-export: 0 importers, used in own file |
| `src/ai/grounding.ts:85` | `kv` | const | 0 | over-export: 0 importers, used in own file |
| `src/ai/guardrail-hinglish.ts:70` | `HiTerm` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/guardrail.ts:69` | `Term` | iface | 1 | one-off script only: src/scripts/probe-evaluative-gap.ts |
| `src/ai/guardrail.ts:83` | `AI_HARD_LIST` | const | 4 | one-off script only: src/scripts/verify-ai-guardrail.ts, src/scripts/verify-evaluative-tier.ts (+2) |
| `src/ai/guardrail.ts:265` | `AI_TARGET_LIST` | const | 2 | one-off script only: src/scripts/verify-evaluative-tier.ts, src/scripts/verify-price-target-guardrail.ts |
| `src/ai/guardrail.ts:339` | `isAttributed` | fn | 1 | one-off script only: src/scripts/verify-price-target-guardrail.ts |
| `src/ai/guardrail.ts:447` | `AI_EVAL_LIST` | const | 1 | one-off script only: src/scripts/verify-evaluative-tier.ts |
| `src/ai/guardrail.ts:503` | `EvaluativeHit` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/guardrail.ts:583` | `scanEvaluativeWith` | fn | 1 | one-off script only: src/scripts/probe-evaluative-gap.ts |
| `src/ai/guardrail.ts:685` | `HardHit` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/guardrail.ts:690` | `SoftHit` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/guardrail.ts:695` | `GuardrailVerdict` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/insight/relationship.ts:34` | `StockPosture` | type | 0 | over-export: 0 importers, used in own file |
| `src/ai/insight/relationship.ts:38` | `StockRef` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/insight/relationship.ts:44` | `StockRelationshipFacts` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/insight/relationship.ts:67` | `StockRelationshipGrounding` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/insight/relationship.ts:87` | `RelationshipProbe` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/moderation.ts:40` | `ModTerm` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/moderation.ts:58` | `MODERATION_LIST` | const | 1 | one-off script only: src/scripts/verify-moderation-and-scope.ts |
| `src/ai/moderation.ts:167` | `ModerationHit` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/moderation.ts:168` | `ModerationVerdict` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/number-grounding.ts:40` | `UngroundedNumber` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/number-grounding.ts:47` | `NumberGroundingVerdict` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/quota.ts:140` | `userScopeOf` | const | 3 | one-off script only: src/scripts/verify-ai-quota-subcap.ts, src/scripts/verify-chat-quota-peek.ts (+1) |
| `src/ai/spend.ts:26` | `composePrompt` | const | 0 | over-export: 0 importers, used in own file |
| `src/ai/spend.ts:48` | `mockByConfig` | const | 0 | over-export: 0 importers, used in own file |
| `src/ai/tone.ts:37` | `ToneDepth` | type | 0 | over-export: 0 importers, used in own file |
| `src/ai/tone.ts:38` | `ToneJargon` | type | 0 | over-export: 0 importers, used in own file |
| `src/ai/tone.ts:40` | `ToneDirective` | iface | 0 | over-export: 0 importers, used in own file |
| `src/ai/tone.ts:50` | `NON_ADVISORY_SPINE` | const | 3 | one-off script only: src/scripts/measure-depth-placement.ts, src/scripts/probe-evaluative-gap.ts (+1) |
| `src/ai/tone.ts:72` | `CONVERSATIONAL_PRECISION` | const | 2 | one-off script only: src/scripts/probe-evaluative-gap.ts, src/scripts/verify-evaluative-tier.ts |
| `src/ai/tone.ts:108` | `LANGUAGE_MIRROR` | const | 2 | one-off script only: src/scripts/probe-evaluative-gap.ts, src/scripts/verify-evaluative-tier.ts |
| `src/ai/tone.ts:164` | `EXPLANATORY_DEPTH` | const | 3 | one-off script only: src/scripts/measure-depth-placement.ts, src/scripts/probe-evaluative-gap.ts (+1) |
| `src/ai/tone.ts:240` | `COMPANY_ANSWER_SHAPE` | const | 3 | one-off script only: src/scripts/measure-depth-placement.ts, src/scripts/probe-evaluative-gap.ts (+1) |
| `src/ai/tone.ts:345` | `resolveTone` | fn | 5 | one-off script only: src/scripts/measure-depth-placement.ts, src/scripts/probe-evaluative-gap.ts (+3) |
| `src/ai/types.ts:30` | `AiModelId` | type | 0 | over-export: 0 importers, used in own file |
| `src/ai/types.ts:51` | `AiRole` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:58` | `DivergenceSubTypeKey` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:78` | `isWideTier` | fn | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:84` | `DIVERGENCE_ORDER_RANK_WIDE` | const | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:85` | `DIVERGENCE_ORDER_RANK_NOTABLE` | const | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:88` | `MAX_SHOWN_SUB_TYPES` | const | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:91` | `DivergenceInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/divergence.ts:96` | `DivergenceConsolidation` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/evidence-facts.ts:73` | `EvidenceUnit` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/evidence-facts.ts:76` | `InternalReason` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/evidence-facts.ts:79` | `ReaderEvidenceFact` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/evidence-facts.ts:104` | `InternalEvidenceFact` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/evidence-facts.ts:109` | `EvidenceFact` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/finding-facts.ts:68` | `UnmeasuredFacts` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/guardrail-signatures.ts:116` | `consequenceOf` | const | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/guardrail-signatures.ts:120` | `statusOf` | const | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/index.ts:71` | `phsFinding` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/index.ts:73` | `NFamilyStaticCopy` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/index.ts:122` | `catalogueSize` | fn | 1 | one-off script only: src/scripts/_content-review-doc.ts |
| `src/catalogue/n-family-copy.ts:58` | `NFamilyStaticCopy` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/not-covered.ts:99` | `NotCoveredTrigger` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/not-covered.ts:259` | `dropNotCovered` | fn | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:78` | `RegimeRead` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:81` | `RegimeMap` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:88` | `RelaxedTier` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:151` | `EvidenceBasis` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:153` | `EvidenceStats` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:162` | `PatternLegOp` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:172` | `PatternLeg` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:182` | `FloorBasis` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:195` | `GateType` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/pattern-facts.ts:276` | `PatternConfidence` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/retired-findings.ts:122` | `dropRetired` | fn | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/serialise.ts:52` | `BoundaryMaps` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/serialise.ts:112` | `RegistryDocument` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/serialise.ts:120` | `CatalogueDocument` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/serialise.ts:162` | `RegistrySegment` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/serialise.ts:179` | `NamesDocument` | iface | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/stock-findings.ts:167` | `StockFindingRegistry` | type | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/tool-families.ts:35` | `TOOL_FAMILIES` | const | 0 | over-export: 0 importers, used in own file |
| `src/catalogue/tool-families.ts:47` | `belongsToTool` | fn | 1 | one-off script only: src/scripts/verify-filing-read-surfaces.ts |
| `src/chat/compose.ts:33` | `OpeningComposition` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/date-resolve.ts:45` | `addDays` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/date-resolve.ts:101` | `DateResolved` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/date-resolve.ts:110` | `DateRefused` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/date-resolve.ts:117` | `DateResolution` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/discuss-context.ts:11` | `DISCUSS_SUBJECT_KINDS` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/discuss-context.ts:14` | `DiscussSubjectSchema` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/engine.ts:39` | `ChatTurnInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/engine.ts:72` | `ChatTurnDeps` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/engine.ts:89` | `ChatTurnResult` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/engine.ts:123` | `__setDefaultChatProviderForTests` | fn | 6 | one-off script only: src/scripts/verify-chat-tool-fleet.ts, src/scripts/verify-chat-tools.ts (+4) |
| `src/chat/links.ts:58` | `encodeSegment` | const | 1 | one-off script only: src/scripts/verify-app-links.ts |
| `src/chat/links.ts:63` | `STOCK_TABS` | const | 2 | one-off script only: src/scripts/verify-app-links.ts, src/scripts/verify-link-placement.ts |
| `src/chat/links.ts:72` | `StockTab` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/links.ts:75` | `PORTFOLIO_TABS` | const | 2 | one-off script only: src/scripts/verify-app-links.ts, src/scripts/verify-link-placement.ts |
| `src/chat/links.ts:83` | `PortfolioTab` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/links.ts:85` | `stockPath` | const | 1 | one-off script only: src/scripts/verify-app-links.ts |
| `src/chat/links.ts:94` | `portfolioPath` | const | 1 | one-off script only: src/scripts/verify-app-links.ts |
| `src/chat/links.ts:96` | `watchlistPath` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/links.ts:112` | `healthHubPath` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/links.ts:116` | `peerGroupPath` | const | 1 | one-off script only: src/scripts/verify-app-links.ts |
| `src/chat/links.ts:214` | `stripMalformedMarkers` | fn | 1 | one-off script only: src/scripts/verify-link-placement.ts |
| `src/chat/links.ts:225` | `stripTypedPaths` | fn | 0 | over-export: 0 importers, used in own file |
| `src/chat/links.ts:235` | `ResolvedLink` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/links.ts:241` | `ResolveResult` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:52` | `STATED_MEMORIES_CHECK` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:66` | `verifyMemoryCapMatchesDatabase` | fn | 1 | one-off script only: src/scripts/verify-chat-write-tools.ts |
| `src/chat/memory.ts:98` | `StatedMemory` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:99` | `MemorySource` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:100` | `MemoryEntry` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:201` | `DeclineVerdict` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:481` | `AddMemoryResult` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:588` | `ForgetResolution` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/memory.ts:625` | `ForgetResult` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/openings.ts:30` | `OpeningSpec` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/openings.ts:60` | `subjectLabelFor` | fn | 0 | over-export: 0 importers, used in own file |
| `src/chat/openings.ts:184` | `ResolvedOpening` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/openings.ts:211` | `KNOWN_SURFACES` | const | 1 | one-off script only: src/scripts/verify-chat-display-content.ts |
| `src/chat/profile.ts:54` | `READER_REGISTERS` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/profile.ts:55` | `ReaderRegisterValue` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/profile.ts:58` | `DistilledProfile` | iface | 1 | one-off script only: src/scripts/verify-chat-profile-distill.ts |
| `src/chat/profile.ts:72` | `PROFILE_DISTILL_SYSTEM` | const | 1 | one-off script only: src/scripts/verify-chat-profile-distill.ts |
| `src/chat/profile.ts:134` | `buildDistillPrompt` | fn | 0 | over-export: 0 importers, used in own file |
| `src/chat/profile.ts:149` | `loadVisibleTranscript` | fn | 1 | one-off script only: src/scripts/verify-chat-profile-distill.ts |
| `src/chat/profile.ts:167` | `parseDistilled` | fn | 1 | one-off script only: src/scripts/verify-chat-profile-distill.ts |
| `src/chat/profile.ts:206` | `foldProfile` | fn | 1 | one-off script only: src/scripts/verify-chat-profile-distill.ts |
| `src/chat/profile.ts:301` | `DistillOneResult` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/screen-brief.ts:295` | `assertNoMetricCodes` | fn | 1 | one-off script only: src/scripts/verify-screen-brief.ts |
| `src/chat/sessions.ts:34` | `RESUME_WINDOW_MS` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/sessions.ts:216` | `DiscussCreateInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/sessions.ts:306` | `FollowupInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/sessions.ts:345` | `DeniedInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/sessions.ts:559` | `EditRefusal` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/sessions.ts:561` | `EditPlan` | iface | 1 | one-off script only: src/scripts/verify-chat-message-edit.ts |
| `src/chat/sessions.ts:647` | `EditedReplyInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/sessions.ts:736` | `EMPTY_SESSION_GRACE_MS` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/event-description.ts:42` | `EventAmountComponent` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/event-description.ts:49` | `EventDescriptionVerdict` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/get-stock-fundamentals.ts:165` | `ANNUAL_FIELDS` | const | 1 | one-off script only: src/scripts/verify-fundamentals-fields.ts |
| `src/chat/tools/get-stock-fundamentals.ts:251` | `QUARTER_FIELDS` | const | 1 | one-off script only: src/scripts/verify-fundamentals-fields.ts |
| `src/chat/tools/get-stock-fundamentals.ts:304` | `renderFundamentals` | fn | 1 | one-off script only: src/scripts/verify-fundamentals-fields.ts |
| `src/chat/tools/get-stock-news.ts:38` | `webSearchEnabled` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/open-comparison.ts:53` | `comparisonPath` | reexp | 2 | one-off script only: src/scripts/verify-app-links.ts, src/scripts/verify-open-comparison.ts |
| `src/chat/tools/registry.ts:63` | `CHAT_TOOLS` | const | 4 | one-off script only: src/scripts/audit-universe-boundary.ts, src/scripts/verify-chat-tool-fleet.ts (+2) |
| `src/chat/tools/registry.ts:136` | `findTool` | fn | 6 | one-off script only: src/scripts/audit-universe-boundary.ts, src/scripts/verify-alert-tool-coverage.ts (+4) |
| `src/chat/tools/registry.ts:194` | `makeToolExecutor` | fn | 2 | one-off script only: src/scripts/verify-chat-tools.ts, src/scripts/verify-empty-reply-and-rounds.ts |
| `src/chat/tools/shared.ts:17` | `pctPointStr` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/shared.ts:17` | `moneyStr` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/shared.ts:39` | `joinBlocks` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/types.ts:15` | `ToolClass` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/tools/write-shared.ts:29` | `ResolvedStock` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/unavailable.ts:21` | `UnavailableState` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/voice.ts:24` | `ReaderRegister` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/voice.ts:26` | `CHAT_USE_DONT_NARRATE` | const | 2 | one-off script only: src/scripts/probe-evaluative-gap.ts, src/scripts/verify-evaluative-tier.ts |
| `src/chat/voice.ts:77` | `LAYER3_REDIRECT_LEAD` | const | 1 | one-off script only: src/scripts/verify-chat-tools.ts |
| `src/chat/voice.ts:266` | `OrientationInput` | iface | 0 | over-export: 0 importers, used in own file |
| `src/chat/voice.ts:399` | `CHAT_WRITE_DISCIPLINE` | const | 2 | one-off script only: src/scripts/probe-evaluative-gap.ts, src/scripts/verify-evaluative-tier.ts |
| `src/chat/voice.ts:448` | `EXTERNAL_SOURCE_DISCLAIMER` | const | 2 | one-off script only: src/scripts/verify-open-comparison.ts, src/scripts/verify-stock-news-live-chat.ts |
| `src/chat/voice.ts:456` | `buildExternalSourcesBlock` | fn | 0 | over-export: 0 importers, used in own file |
| `src/chat/voice.ts:484` | `buildAppLinksBlock` | fn | 1 | one-off script only: src/scripts/verify-open-comparison.ts |
| `src/chat/web/serper.ts:51` | `KeySlot` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/web/serper.ts:53` | `SerperNewsOutcome` | type | 0 | over-export: 0 importers, used in own file |
| `src/chat/web/serper.ts:65` | `NEWS_NUM` | const | 0 | over-export: 0 importers, used in own file |
| `src/chat/web/serper.ts:69` | `LOW_CREDITS` | const | 1 | one-off script only: src/scripts/verify-stock-news.ts |
| `src/chat/web/serper.ts:256` | `serperKeyReport` | fn | 1 | one-off script only: src/scripts/verify-stock-news.ts |
| `src/chat/web/serper.ts:276` | `__resetSerperState` | fn | 1 | one-off script only: src/scripts/verify-stock-news.ts |
| `src/chat/web/serper.ts:284` | `__setSerperBalanceForTests` | fn | 1 | one-off script only: src/scripts/verify-stock-news.ts |
| `src/insight/quarter-brief/anchors.ts:274` | `AnchorInputs` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/anchors.ts:352` | `anchorsByKey` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/annual-manifest.ts:96` | `MoneySense` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/annual-manifest.ts:105` | `AnnualScale` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/annual-manifest.ts:108` | `AnnualBounds` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/annual-manifest.ts:120` | `CrossFieldGuard` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/annual-manifest.ts:488` | `AnnualMetricKeyOf` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/annual-section.ts:101` | `SuppressedAnnualMetric` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/change.ts:22` | `MOVEMENT_FLOOR_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/change.ts:37` | `LARGE_MOVE_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/driver.ts:50` | `BRIDGE_TOLERANCE` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/driver.ts:59` | `DRIVER_SHARE_MIN` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/driver.ts:67` | `BridgeSpec` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/driver.ts:162` | `bridgeResidual` | fn | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/driver.ts:467` | `DriverAbsence` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/family-rows.ts:68` | `PREFERRED_BASIS` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/generate.ts:41` | `QUARTER_BRIEF_MODEL` | const | 7 | one-off script only: src/scripts/brief-annual-set.ts, src/scripts/brief-backfill-gate1.ts (+5) |
| `src/insight/quarter-brief/generate.ts:176` | `GenerateOk` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/generate.ts:186` | `GenerateRefused` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/generate.ts:196` | `GenerateResult` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/invalidate.ts:83` | `BriefInvalidation` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/manifest.ts:52` | `Scale` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/manifest.ts:58` | `DriverRole` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/manifest.ts:61` | `MetricBounds` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/manifest.ts:430` | `MetricKeyOf` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/margins.ts:34` | `MARGIN_FLOOR_PP` | const | 1 | one-off script only: src/scripts/brief-comparison-base-census.ts |
| `src/insight/quarter-brief/margins.ts:61` | `MEANINGFUL_MARGIN_MAX_ABS` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/peer-shape.ts:53` | `PeerMetricSpec` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/peer-shape.ts:62` | `PEER_METRICS` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/peer-shape.ts:117` | `PeerComparison` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/peers.ts:88` | `comparableValues` | fn | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/peers.ts:158` | `fetchPeerCrossSection` | fn | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/personal.ts:103` | `PersonalFact` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/personal.ts:121` | `PersonalFinding` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/personal.ts:620` | `filingRedFlagTransitions` | fn | 1 | one-off script only: src/scripts/verify-personal-section.ts |
| `src/insight/quarter-brief/prompt.ts:373` | `briefProseName` | fn | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/quarter-section.ts:77` | `SuppressedMetric` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:86` | `BriefLine` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:103` | `BriefTakeaway` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:110` | `BriefQuarterSection` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:116` | `BriefAnnualSection` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:125` | `BriefHealthSection` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:201` | `ShapeError` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/schema.ts:377` | `StringLeaf` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/story.ts:75` | `StoryFact` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/story.ts:80` | `StoryGroup` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/story.ts:177` | `definingMetrics` | fn | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/types.ts:199` | `PeerComparison` | reexp | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/verdict.ts:60` | `VerdictKey` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/verdict.ts:62` | `VerdictDef` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/verdict.ts:164` | `LINE_MATERIAL_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/verdict.ts:228` | `VerdictInputs` | iface | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/write.ts:38` | `WriteOutcome` | type | 0 | over-export: 0 importers, used in own file |
| `src/insight/quarter-brief/write.ts:45` | `WriteOpts` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/behaviour.ts:56` | `applyBehaviour` | fn | 1 | one-off script only: src/scripts/guardrail-behaviour-check.ts |
| `src/scoring/guardrail/gate.ts:42` | `GateRunOpts` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/persist.ts:33` | `GuardrailEventCreate` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/persist.ts:49` | `SuppressionCreate` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/persist.ts:59` | `GuardrailWriteContext` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/persist.ts:77` | `GuardrailWritePlan` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/persist.ts:218` | `GuardrailReviewWritePlan` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/persist.ts:237` | `writeGuardrailReview` | fn | 2 | one-off script only: src/scripts/guardrail-c-check.ts, src/scripts/guardrail-signatures-check.ts |
| `src/scoring/guardrail/persist.ts:272` | `loadSuppressionRows` | fn | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/review.ts:64` | `recordRuling` | fn | 2 | one-off script only: src/scripts/guardrail-c-check.ts, src/scripts/guardrail-signatures-check.ts |
| `src/scoring/guardrail/review.ts:92` | `applyRuling` | fn | 2 | one-off script only: src/scripts/guardrail-c-check.ts, src/scripts/guardrail-signatures-check.ts |
| `src/scoring/guardrail/scoring-gate.ts:81` | `buildGateInput` | fn | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/a1-stale-results.ts:26` | `STALE_DAYS_THRESHOLD` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/a1-stale-results.ts:28` | `REMOVE_ESCALATION_QUARTERS` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/a3-insufficient-history.ts:32` | `LENS3_MIN_HISTORY` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/a3-insufficient-history.ts:34` | `OWNERSHIP_MIN_QUARTERS` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/a4-inactive.ts:26` | `PRICE_GAP_TRADING_DAYS` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b1-exceptional-gain.ts:28` | `B1_PROFIT_JUMP_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b1-exceptional-gain.ts:29` | `B1_OPM_FLAT_PP` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b1-exceptional-gain.ts:30` | `B1_BELOW_LINE_SHARE` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b2-exceptional-loss.ts:25` | `B2_PROFIT_DROP_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b2-exceptional-loss.ts:26` | `B2_OPM_FLAT_PP` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b2-exceptional-loss.ts:27` | `B2_BELOW_LINE_SHARE` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b3-tax-distortion.ts:25` | `B3_EFF_TAX_MAX` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b3-tax-distortion.ts:26` | `B3_NORMAL_TAX_MIN` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b3-tax-distortion.ts:27` | `B3_NP_SWING_MIN` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b3-tax-distortion.ts:28` | `B3_PBT_SWING_MAX` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b4-other-income.ts:26` | `B4_OTHER_INCOME_SHARE_MAX` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b4-other-income.ts:27` | `B4_NORMAL_OTHER_INCOME_MAX` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b5-holdco-extraction.ts:27` | `B5_NETWORTH_DROP_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/b5-holdco-extraction.ts:28` | `B5_PROMOTER_MIN_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/below-line-core.ts:18` | `BelowLineAnalysis` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/c1-structural-step.ts:35` | `C1_STEP_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/c2-share-count.ts:32` | `C2_SHARE_CHANGE_PCT` | const | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/registry.ts:28` | `SignatureDescriptor` | iface | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/signatures/registry.ts:45` | `SIGNATURE_REGISTRY` | const | 2 | one-off script only: src/scripts/guardrail-behaviour-check.ts, src/scripts/guardrail-c-check.ts |
| `src/scoring/guardrail/signatures/registry.ts:70` | `registryCoverage` | fn | 3 | one-off script only: src/scripts/guardrail-c-check.ts, src/scripts/guardrail-check.ts (+1) |
| `src/scoring/guardrail/suppression-adapter.ts:28` | `toSuppressionPredicate` | fn | 2 | one-off script only: src/scripts/guardrail-check.ts, src/scripts/guardrail-signatures-check.ts |
| `src/scoring/guardrail/suppression-adapter.ts:43` | `toPeerMeanExclusionPredicate` | fn | 0 | over-export: 0 importers, used in own file |
| `src/scoring/guardrail/suppression-adapter.ts:72` | `suppressedPairs` | fn | 4 | one-off script only: src/scripts/guardrail-c-check.ts, src/scripts/guardrail-check.ts (+2) |


---

## 2. RESOLVER INVENTORY

Absent-data legend: **N** = returns `null` · **E** = typed empty · **A** = typed absent state ·
**T** = throws · **Z** = zero-for-unknown

| # | Resolver | Verdict | file:line | Absent | PIT |
|---|---|---|---|---|---|
| 1 | symbol resolution + coverage tier | **PARTIAL** | `metrics/load.ts:21`, `chat/tools/write-shared.ts:42`, `read/stocks-list.service.ts:116` | N / boundary-object | latest |
| 2 | latest score snapshot | **EXISTS** | `read/scoring-read.service.ts:230` | N | ✅ in-force |
| 3 | snapshot series | **EXISTS** | `read/scoring-read.service.ts:348` | E `[]` | ✅ in-force |
| 4 | daily snapshot series | **EXISTS** | `read/scoring-read.service.ts:420` | E `[]` | ✅ MAX(ver)/day |
| 5 | field-level scoring detail | **EXISTS** | `read/health-view.types.ts:482,488,888` | **Z** | ✅ |
| 6 | field coverage by sector | **MISSING** | — | — | — |
| 7 | findings for symbols (batch) | **EXISTS** | `read/symbol-findings.service.ts:178` | E typed | ✅ `freshestAsOf` |
| 8 | findings lifecycle | **EXISTS** | `read/finding-lifecycle.service.ts:289` | E typed | ✅ caller period |
| 9 | pattern catalogue record | **EXISTS (shape ≠)** | `catalogue/pattern-facts.ts:198,366,887` | static | n/a |
| 10 | fundamentals view (quarterly) | **EXISTS** | `read/fundamentals-view.service.ts:57` | N (unknown symbol only) | latest |
| 11 | fundamentals view (annual) | **EXISTS** | same fn; `quarter-brief/annual-rows.ts:198` | N | latest |
| 12 | derived ratio set | **EXISTS** | `read/fundamentals-view.types.ts:49-76,127,163` | N per field | latest |
| 13 | valuation multiples | **MISSING** | only `PeerGroup.avgPeRatio/avgPbRatio`, schema:1262-63 | — | — |
| 14 | ownership view | **EXISTS** | `read/ownership-series.service.ts:153` | N | ✅ filing-dated |
| 15 | insider disclosures | **EXISTS (in 14)** | `read/ownership-series.service.ts:203 → 528` | E | ✅ window |
| 16 | block/bulk deals | **EXISTS (in 14)** | `read/ownership-series.service.ts:219 → 528` | E | ✅ window |
| 17 | corporate events | **EXISTS** | `read/corporate-events.service.ts:46` | N | ⚠ now-bound |
| 18 | pledge series | **EXISTS** | `read/ownership-series.service.ts:45` | N, 0≠unknown | ✅ |
| 19 | price view | **EXISTS** | `read/price-view.service.ts:107,63` | N | ✅ window |
| 20 | news items | **PARTIAL** | `read/result-detail.service.ts:326` (embedded) | E | ✅ filing±window |
| 21 | peer group membership | **EXISTS** | `read/peer-group-lookup.ts:24,41`; `read/peer-group-view.service.ts:207` | N | latest |
| 22 | peer group health view | **EXISTS** | `read/peer-group-view.service.ts:425` | — | ✅ one period |
| 23 | peer range for metric | **EXISTS** | `read/scoring-read.service.ts:516`; `read/scope-aggregate.ts:78` | E `Map` | ✅ **periodKey-bound** |
| 24 | comparable metrics across groups | **PARTIAL** | `read/compare-view.service.ts:512` | N | latest |
| 25 | screen engine + per-predicate | **PARTIAL** | `read/screen.service.ts:208`; `read/screen.types.ts:166,199` | A discriminated | ✅ `periodContract` |
| 26 | universe scan slices | **EXISTS** | `read/universe-projection.service.ts:500`; `.types.ts:40` | `Capped<T>` | ✅ |
| 27 | portfolio holdings (ISIN stem) | **EXISTS** | `portfolio/phs/portfolio-health-view.ts:416`; `phs/entity.ts:130` | **T** | latest |
| 28 | watchlist | **PARTIAL** | `controllers/me/watchlist-controller.ts:97` | E | latest |
| 29 | quarter brief record | **EXISTS (embedded)** | `read/result-detail.service.ts:381` | **A** `ABSENT_AI` | ✅ pinned |
| 30 | concept / gloss lookup | **EXISTS (shape ≠)** | `catalogue/quarter-metrics.ts:518`, `annual-metrics.ts:370`, `stock-findings.ts:770` | static | n/a |
| 31 | **`buildSectorRotationView`** | **MISSING** ✅ | — | — | — |

### 2.1 Negative control

```
$ rg -n --no-heading "buildSectorRotationView" . -g '!node_modules' -g '!dist'
[exit=1]  (no output)

$ rg -n --no-heading "buildQuarterBriefFactBlock" . -g '!node_modules' -g '!dist'
./Vytal-Backend/src/scripts/annual-section-render.ts:10:import { buildQuarterBriefFactBlock } from ...
./Vytal-Backend/src/insight/quarter-brief/fact-block.ts:746:export async function buildQuarterBriefFactBlock(
```

**`buildSectorRotationView` → MISSING.** The identical command form finds a real symbol. Method sound;
the scan was not rewritten and the control did not misfire.

### 2.2 Absent-data behaviour — the porting-cost column

**The read layer barely throws.** `rg "throw new " src/scoring/read` → **3 hits**, none absent-data:
`screen.service.ts:77`, `universe-projection.service.ts:750` (leak-guard),
`result-detail.service.ts:400` (payload shape).

**One resolver throws on absence** — #27, `portfolio-health-view.ts:414`:

```
 * it from req.authUser.userId — IDOR-proof). Throws on failure; the controller maps that to a 500.
```

**Zero-for-unknown at #5** — `health-view.types.ts:482`:

```
/** null when scoreState ≠ scored (not_scored metrics carry weights/contribution as 0). */
```

**#29 is the model for the new contract** — `result-detail.service.ts:387`:
`if (!row || row.status !== "live") return ABSENT_AI;`

### 2.3 Shape mismatches on "EXISTS" rows

- **#9** — `PatternFacts` has **14** fields (`pattern-facts.ts:198-254`), not 7. Served subset is 3:
  `ServedPatternFacts = Pick<PatternFacts, "pillarPair" | "basis" | "displayPrecision">` (:261).
- **#30** — gloss record is `{label, meaning, doesntMean}` (`quarter-metrics.ts:48-55`). **No `fields` member.**
- **#1** — no coverage *tier* exists. Nearest is two-state `scored: boolean` (`stocks-list.types.ts:63`).
  There is no server-side search at all — `search-stocks.ts:5`: *"There is no server-side equity search —
  the app's own picker fetches the whole universe once and filters CLIENT-side"*.
- **#25** — retains per-predicate **counts** (`AppliedCondition.evaluable`, `screen.types.ts:206`) and
  aggregate `Evaluable{considered, evaluable, notEvaluable, reasons[]}` (:166-174), but **not**
  per-company per-predicate pass/fail. `ScreenRow` (:192) carries values, not verdicts.
- **#24** — stock-vs-stock, not groupA-vs-groupB. Comparability is `same_family | cross_family`
  (`compare-view.service.ts:527-530`).
- **#28** — no service seam. The same `prisma.watchlist.findMany` appears **5 times**:
  `watchlist-controller.ts:97`, `relational/reader-context.ts:426`, `chat/tools/screen-stocks.ts:165`,
  `chat/tools/get-watchlist.ts:36`, `chat/tools/get-universe-scan.ts:140`.

### 2.4 The three computations — all absent

| Computation | Verdict | Evidence |
|---|---|---|
| change-point detection w/ min phase length | **MISSING** | `rg -i "changepoint\|change.point\|breakpoint\|regime.shift\|phase.length\|minPhase"` → 1 hit, `results-season/types.ts:17`, a CSS-breakpoint comment |
| own-move vs peer-shift decomposition | **MISSING** | `rg -i "peerMedianDelta\|ownMove\|peerShift\|medianDelta\|relativeMove"` → **zero hits** |
| event merge service | **MISSING** | `rg -i "mergedEvents\|eventStream\|unifiedTimeline\|materiality"` → 15 hits, all per-rule materiality floors |

The ingredients for the third are all separately resolvable (#7, #8, #15, #16, #17, and `src/filing`);
nothing merges, sorts or materiality-ranks them into one stream.

---

## 3. RENDERER INVENTORY (FRONTEND)

### 3.1 Libraries — from `package.json`, not inferred

`recharts@2.15.4` · `lightweight-charts@5.2.0` · `@number-flow/react` · `framer-motion`/`motion` ·
`gsap` · `embla-carousel-react`

**`@tanstack/react-table` is NOT installed.** `rg "@tanstack/react-table"` → zero hits repo-wide. Only
`@tanstack/react-query` is present. Every table is hand-written `<table>`.

| Library | Files | Paths |
|---|---|---|
| Recharts | 19 | `components/charts/value-area-chart.tsx`, `ui/chart.tsx`, `comparison/view/{ownership-bars,pillar-radar,price-overlay,trajectory-overlay}.tsx`, `results/{PnlTrendsTab,SnapshotTab}.tsx`, `sector-analysis/{Activity,Financial,Health,Summary}Tab.tsx`, `stock-detail/{activity,events,fundamentals}.tsx`, `stock-detail/health/trajectory-section.tsx`, `stock-detail/overview/{section-ownership,section-price}.tsx`, `app/(main)/research/sector-analysis/[sector]/page.tsx` |
| lightweight-charts | 5 | `fund-detail/nav-chart.tsx`, `stock-detail/price-chart.tsx`, `watchlist/quick-look-sheet.tsx`, `lib/api/hooks/use-stock-ohlcv.ts`, `lib/indicators/core.ts` |
| Custom inline SVG | 32 | incl. `ui/{sparkline,gauge,health-ring,chart-tooltip}.tsx`, `peer-group/**` (7), `research/tools/**` (5), `portfolio/**` (6), `stock-detail/health/**` (3) |
| Hand-written `<table>` | 28 | incl. `ui/table.tsx`, `peer-group/standings-table.tsx`, `portfolio/{holdings,transactions,account-detail}/**`, `stock-detail/financial-statements.tsx`, `chat/markdown.tsx` |

### 3.2 Typed payload vs loose props

**Primitives take loose scalars.** `Sparkline` is `{ data: number[]; width?; height?; color?; fill?;
strokeWidth? }` (`ui/sparkline.tsx:6-16`) — a bare `number[]`, no units, no absent state, and
`if (!data || data.length < 2) return null;` (:29). `Gauge` is `{ value: number; max?; size?; … }`
(`ui/gauge.tsx:13-24`). These carry no provenance and cannot express `not_disclosed` — they render or
vanish.

**Section components take typed payloads.** **183 of 367** component files import from `@/types/*` —
the backend-mirrored contract directory (23 files: `health.ts`, `peer-group.ts`, `result-detail.ts`,
`portfolio.ts`, …).

### 3.3 Type-string → component dispatch: **NONE EXISTS**

Six distinct searches:

```
A  rg "Record<[^>]*,\s*(React\.)?(ComponentType|FC|ElementType)"          → 0 hits
B  rg "ComponentType|ElementType"                                         → 13 hits, ALL `icon: React.ElementType`
C  rg "switch \((\w+\.)?(type|kind|variant|component)\)"                  → 6 hits
D  rg -i "const (REGISTRY|RENDERERS|COMPONENTS|BLOCKS|SECTION_MAP|WIDGETS|CARD_MAP)\b"  → 0 hits
E  rg "=> <[A-Z]"                                                         → all `.map(x => <Row …>)`
F  rg -i "registry" (frontend)                                            → 14 files, findings-catalogue / job-pipeline only
```

Five of the six `switch` hits are local state machines (`live.kind`, `action.type`, badge colors). The
one genuine type-string → element dispatch is `components/chat/markdown.tsx:66, :261, :349` — and it
dispatches on **mdast node type**, not on a backend payload type. Its input is a markdown *string*
parsed in the browser (header: *"the backend returns the WHOLE message — there is no streaming
transport"*). It is the closest architectural precedent (fixed React-element whitelist, no
`dangerouslySetInnerHTML`, scheme-allowlisted links) but is **not** a payload→component registry.

### 3.4 Reusable / rework split

**Rework required — assembles its own data client-side:**

| Module | What it computes | Consumers |
|---|---|---|
| `lib/indicators/` | full TA stack in-browser: `core.ts` (`emaArray`, `smaArray`, `stdevArray`), `bollinger.ts`, `ema.ts`, `macd.ts`, `rsi.ts`, `volatility.ts`, `metrics.ts` | `stock-detail/technical.tsx`, `stock-detail/price-chart.tsx` |
| `lib/findings/` | re-derives finding classification: `classify.ts`, `verdicts.ts`, `evidence-shape.ts`, `boundary.ts` | findings surfaces |
| `lib/health/`, `lib/peer-group/`, `lib/news/` | derived view state | various |
| `components/peer-group/fundamentals/lib.tsx:144-149` | column defs with inline cell renderers | peer-group tables |
| `stock-autocomplete.tsx` | whole-universe client-side filtering (no server search — see §2.3) | global |

Nothing on the server computes the `lib/indicators` values, so no digest can describe them.

**Reusable — consumes backend-shaped payloads:** the 183 `@/types/*` importers, plus
`lib/metrics/generated/` and `lib/findings/generated/` (code-generated from the backend catalogue —
see §5).

### 3.5 Browser-receives vs model-receives separation: **EXISTS**

Three working precedents, all in the backend, none on a rendering surface.

| Seam | Browser gets | Model gets |
|---|---|---|
| `sessions.ts:104` `serializeVisibleMessages` vs `sessions.ts:143` `loadHistoryForModel` | drops `tool_call` rows (:124 *"tool_call — internal"*), drops hidden scaffolding (:125 `if (m.role === "user" && m.isOpening && m.displayContent == null) continue; // hidden scaffolding`), folds `effects` onto the assistant row | *"ALL messages in order (incl. the grounded scaffolding AND the tool turns). ★ EXCEPT THE UNDELIVERED ONES."* |
| `registry.ts:131-133` `toolSpecs()` | — | name/description/parameters only; *"The klass and the handler are intentionally dropped."* |
| `registry.ts:213-215` `AiToolResult.effects` | persisted + served | *"must never become prompt content"* |

---

## 4. ABSENT-STATE GAP

### 4.1 Which of the five exist

| State | Verdict | Evidence |
|---|---|---|
| `not_evaluable` | ✅ **first-class** | closed union + constructor + guard + persisted column |
| `insufficient_history` | ✅ **first-class, 3 tokens** | `insufficient_annual_history` / `insufficient_quarters` / `insufficient_shareholding_history` |
| `not_disclosed` | ⚠ **sub-reason only** | `class_not_disclosed`, `pledging_not_disclosed` — arms *inside* not_evaluable |
| `not_covered` | ⚠ **different meaning** | `catalogue/not-covered.ts` is a registry of 10 *tested-and-not-shipped patterns* (NC1–NC10), not a per-field coverage state |
| `not_ingested` | ❌ **absent** | `rg "not_ingested\|notIngested"` → **zero hits repo-wide** |

Canonical type, `scoring/findings/types.ts:293-330`:

```ts
export type NotEvaluableReason =
  | "insufficient_annual_history" | "insufficient_quarters"
  | "insufficient_shareholding_history" | "negative_equity" | "no_debt"
  | "class_not_disclosed" | "share_count_unavailable" | "pledging_not_disclosed"
  | "no_prior_snapshots" | "opm_unavailable" | "pillar_unavailable"
  | "band_typical_unavailable" | "feed_not_wired" | "missing_line_item"
  | "industry_not_applicable";
export interface NotEvaluable { status: "not_evaluable"; reason: NotEvaluableReason }
export type RuleResult = FiredFinding | NotEvaluable | null;
```

**There are TWO independent unavailability vocabularies.** Beside the findings union sits
`scoring/metrics/types.ts:25-32` `MetricUnavailableReason` — `standalone_absent | missing_line_item |
insufficient_history | divide_by_zero | non_positive_base` — with its own `unavailable(...)`
constructor used ~20× in `foundation.ts`/`momentum.ts`. `missing_line_item` and `insufficient_history`
appear in **both** unions under different constructors. Reader phrases for both live in one map,
`relational/coverage.ts:96-114`.

### 4.2 not-evaluable vs not-fired

The distinction exists at every level:

- **Type** — `RuleResult` above, with `notEvaluable()` constructor (`types.ts:334`) and
  `isNotEvaluable()` guard (:338).
- **Persistence** — `StockFinding.evaluationState` enum incl. `not_evaluable` (schema:2984),
  `notEvaluableReason String?` (:3034), `ScoreSnapshot.notEvaluable Json?` (:2582).
  schema:2980: `/// FiredFinding → fired · null → not_fired · NotEvaluable → not_evaluable.`
- **Read** — `FilingCoverage` (`filing/read.types.ts:56-63`) carries **four** states:
  `fired / notFired / notEvaluable / notRun`, with `notRun` deliberately separate
  (*"A rule that never ran is a gap in coverage exactly as much as one that declined."*).
- **Copy** — 15 reader phrases + `reasonPhrase()` with a safe fallback (`coverage.ts:117`).

**Adoption is partial: 19 of 53 rule files call `notEvaluable(`.** The 34 that do not are the whole
T-series (`t1`–`t9`), D-series (`d1`–`d7`), P-series (`p1`–`p6`, `p10`), plus `c-over-time`, `c1`–`c3`,
`f2`, `g`, `h`, `i`, `r2`, `r6`, `s2`. Those still return bare `null`, read as *not_fired*.

Two declared tokens are wired to nothing in the findings layer: **`feed_not_wired`** (0 rule files) and
**`missing_line_item`** (0 rule files — used only via the *other* constructor). Both already have
authored reader phrases.

### 4.3 Zero-coalescing hit list

`rg "\?\?\s*0|\|\|\s*0" src/ --type ts` → **510 hits / 257 files**.

| Bucket | Count |
|---|---|
| `src/scripts/` + `src/seed/` (one-off recon/verify, not product paths) | 338 |
| Product code — counter/accumulator (`map.get(k) ?? 0) + 1`, token counts, HTTP `statusCode ?? 0`) | ~90 |
| Product code — **unknown silently coalesced to zero** | **~48** |

The third bucket:

| Class | Sites |
|---|---|
| **Pledge (canonical)** | `ingestions/shareholdings/xbrl-parser.ts:351-353` |
| **Ownership classes** | `read/ownership-series.service.ts:502,510,511`; `read/stocks-list.service.ts:212,300,301` |
| **Scoring inputs** | `metrics/foundation.ts:75,81,123,191`; `metrics/banking.ts:99,100`; rules `n2:32`, `n3:31`, `p8:24`, `r4:24` |
| **Reader-facing sentences** | `quarter-brief/contrasts.ts:252,267,269,278,362,394`; `controllers/me/holdings-controller.ts:210`; `read/price-view.service.ts:97,135` |
| **Sorts** | `read/stocks-list.service.ts:332,333`; `read/results-list.service.ts:186` |
| **Other** | `pillars/assemble.ts:97`; `read/universe-projection.service.ts:561`; `relational/entries.ts:389`; `fill/re-derive.ts:284`; `ingestions/quaterly-results/**` (tax/borrowings/otherIncome derivations) |

**The pledge case, at ingest** — `xbrl-parser.ts:349-353`:

```
// Default to 0 when elements are absent — absence means no pledging declared
// This is the correct interpretation per SEBI LODR filing norms.
promoterPledgedPct = promoterPledgedPct ?? 0;
promoterPledgedSharesPct = promoterPledgedSharesPct ?? 0;
pledgedShares = pledgedShares ?? 0;
```

The read layer directly below is written to distinguish the two — `ownership-series.service.ts:50-56`
branches `pl == null ? null : pl === 0 ? 0 : …`, header: *"A genuine zero-pledge (pledged = 0) reads as
0, not null."* And `r1-pledging.ts:49`: `if (cur.pledgedShares === null) return notEvaluable("pledging_not_disclosed");`

**Live count settles it (see §6):** `pledgedShares IS NULL` = **0 of 6,178 rows**. The read-layer null
branch is dead code and the `pledging_not_disclosed` arm is unreachable for R1 and N7. The ingest
comment is a deliberate documented ruling, not an oversight — but as written it makes `not_disclosed`
unrecoverable from stored data.

**The codebase already has this rule written down — in one layer only.**
`portfolio/phs/story.ts:153-163`:

> *"⚠ TRAP ②: `?? 0` IS NOT A NEUTRAL DEFAULT — IT IS A FALSE STATEMENT … Defaulting its weight to 0
> asserts THE FINDING IS ABOUT 0% OF THE BOOK, when it is about ALL of it … we do not fabricate a number
> to make the sort typecheck."*

`portfolio/phs/patterns.ts:399-401`:

> *"Ungated, `?? 0` would read '0 effective positions' and fire a Caution off a fact we never measured:
> not-evaluable fabricated into a finding."*

The rule is enforced in `src/portfolio/phs`. It has not been applied to `src/scoring/read`,
`src/scoring/metrics`, or `src/ingestions`.

---

## 5. CATALOGUE RECONCILIATION

### 5.1 Registry key counts — counted by live import of `catalogueSize()`

| Registry | Documented | **Actual** | |
|---|---|---|---|
| stock_finding | 35 | **45** | ❌ **+10** |
| lens_face | 14 | **14** | ✅ |
| phs_finding | 58 | **58** | ✅ |
| guardrail_signature | 11 | **11** | ✅ |
| **Total** | **118** | **128** | ❌ **+10** |

Family breakdown of the 45 (via `familyOf()`):

```
A   6   R1,R2,R3,R4,R5,R6
B   4   T2,T3,T6,T9                       (deterioration)
C  10   divergence_consolidated, S1, D1–D7, S2
D   5   T1,T4,T5,T7,T8                    (recovery)
E  10   P1,P4,P5,P6,P7,P8,P10,P11,P12,P13
F   2   F1,F2
H   1   H_block_events
N   7   N1–N7                             (Family N constructive twins)
```

Family N (7) accounts for most of the delta. The remaining 3 cannot be attributed without the source
doc — recorded as a doc-vs-code contradiction, not resolved.

Adjacent registries **not** in `CATALOGUE`: `NOT_COVERED_IDS` = 10 · `RETIRED_FINDING_KEYS` = 10 ·
`PATTERN_KEYS` = 18.

**Two further facts registries appeared during the scan window** — both outside `CATALOGUE` and
outside `REGISTRY_IDS` (re-verified: `catalogueSize()` is still 128 and `REGISTRY_IDS` still lists
exactly four):

| File | Export | Keys | Self-description |
|---|---|---|---|
| `src/catalogue/finding-facts.ts` | `FINDING_FACTS` | **45** | *"every finding's declared facts… The other half of pattern-facts.ts, and under the same authority"* — extends `PATTERN_FACTS`' 18 studied keys to the full stock-finding set |
| `src/catalogue/evidence-facts.ts` | `EVIDENCE_FACTS` | **289** | *"REGISTRY 5 of 5 — EVIDENCE FACTS. What every key inside a fired finding's evidence bag MEANS, and whether a reader may see it at all"* |
| " | `READER_EVIDENCE_FACTS` | **113** | the reader-visible subset of the 289 |
| " | `CLASSIFIED_EVIDENCE_KEYS` | 289 | array form |

`finding-facts.ts` covers exactly the 45 `stock_finding` keys, so it is a **second sidecar on the same
key space** — the same relationship `PATTERN_FACTS` has (§5.3), not a new vocabulary.
`evidence-facts.ts` calls itself "registry 5 of 5" but is **not** wired into `CATALOGUE` or
`REGISTRY_IDS` as of this snapshot, and its `isReaderEvidence` / `CLASSIFIED_EVIDENCE_KEYS` exports
have no consumer yet (§1.5).

### 5.2 Where the Quarter Brief glosses live

**Not in `src/insight/quarter-brief/`** — already in the catalogue directory:

| File | Keys |
|---|---|
| `src/catalogue/quarter-metrics.ts` — `QUARTER_METRIC_GLOSSES` | **66** |
| `src/catalogue/annual-metrics.ts` — `ANNUAL_METRIC_GLOSSES` | **43** |
| **Total** | **109** |

Verified two ways (`Object.keys(...).length` and the exported `*_KEYS` arrays) — both 66 and 43.

⚠ `quarter-metrics.ts:34` states the wrong number about itself: *"96 manifest slots across five
families reduce to the 67 entries below."* Actual is **66**.

### 5.3 Key-space overlap — the hypothesis is HALF right

| Intersection | Result |
|---|---|
| quarter gloss ∩ annual gloss | **0** |
| gloss (109) ∩ catalogue (128) | **0** |
| catalogue ∩ `PATTERN_KEYS` (18) | **18 — total containment** |
| catalogue ∩ `RETIRED_FINDING_KEYS` (10) | **0** |

**Verdict: not one object under three names — two disjoint objects plus one sidecar.**

- The **findings catalogue** (128 keys) and the **metric glosses** (109 keys) share **zero** keys. They
  are two vocabularies in the same directory. Both carry a `doesntMean`-shaped third field, which is
  what makes them look alike — but `MetricGloss` is `{label, meaning, doesntMean}` while
  `CatalogueEntry` is a four-variant union with `family`, `concern`, `status`, `facts`.
- `PATTERN_FACTS` **is** the same object as the catalogue: all 18 pattern keys are catalogue keys — a
  facts sidecar on the same key space, consistent with its header (*"It is NOT copy (stock-findings.ts)"*).
- No collisions or duplicated definitions **within the backend**. The duplication is **cross-repo** (§1.8).

### 5.4 What enforces copy presence

**Compile error** — `quarter-metrics.ts:39-43`:

> *"`MetricKey` is `keyof typeof QUARTER_METRIC_GLOSSES`, and the manifest types its `key` field as
> MetricKey. A manifest metric with no gloss is therefore a COMPILE ERROR, not a bare label at runtime."*

Reinforced by `MetricGloss` (:47): *"Every field required — a half-written entry does not typecheck."*

**CI gate** — `"build": "prisma generate && npm run verify:copy && tsc"`, where `verify:copy` chains
**19** verifiers (incl. `verify-catalogue.ts`, `verify-copy-register.ts`, `verify-quarter-metrics.ts`,
`verify-annual-metrics.ts`, `verify-catalogue-endpoint.ts`, `verify-quarter-brief-vocabulary.ts`).
`verify:cross-repo` adds 5 cross-repo checks + `verify:copy-fresh`.

Compile error covers *presence*; the CI gate covers *content rules* and the reverse direction (a gloss
no manifest uses).

### 5.5 Frontend generated fallbacks — two artefacts, both currently FRESH

| Artefact | Size | Generator | `--check` |
|---|---|---|---|
| `Vytal-Frontend/lib/findings/generated/copy.generated.ts` | 38,170 B | `gen-frontend-fallback.ts` | ✅ FRESH |
| `Vytal-Frontend/lib/metrics/generated/metric-catalogue.generated.ts` | 30,183 B | `gen-frontend-metric-catalogue.ts` | ✅ FRESH |

Raw output (exit 0 both):

```
✅ frontend fallback is FRESH — ...\Vytal-Frontend\lib\findings\generated\copy.generated.ts
   catalogue version 32af7faa0c143eae
✅ frontend metric catalogue is FRESH — 38 measures across 5 families
```

- The copy fallback is a **failover, not a convenience**: *"When GET /api/v1/catalogue is cold, slow or
  down, the four resolvers … read these constants instead. The catalogue endpoint is therefore not a
  single point of failure for the product's vocabulary."* It carries
  `GENERATED_FROM_VERSION = "32af7faa0c143eae"`, compared against the served version at runtime.
- The metric catalogue ships a **subset**: 38 measures against 109 authored glosses. It is a projection
  of the two manifests, not of the gloss catalogues, and deliberately omits `scale` (*"shipping the
  fraction→percent factor to a surface that has already had it applied is how 1.83% becomes 183%"*).

---

## 6. GROUND TRUTH

All queries `SELECT` / `COUNT` / `groupBy` only. `pg_stat_user_tables` estimates were checked first —
largest relevant table is `stock_findings` at 10,856 rows — so nothing required a large scan. **No query
was skipped.**

| # | Fact | **Actual** | Docs say | Flag |
|---|---|---|---|---|
| 1 | Scored stocks (distinct, quarterly `ScoreSnapshot`) | **95** | 93 / 94 / 95 | ✅ 95 |
| 2 | Ingested universe (≥1 quarterly row, 5 families) | **493** | ~500 / 493 / 505 | ✅ 493 |
| — | `stocks` table total | **504** | 505 | ❌ contradicts |
| — | stocks with ≥1 annual fundamental | **414** | — | new |
| 5 | `quarter_briefs` total | **20** | ~893 thin rows | ❌ **refuted** |
| 6 | `BRIEF_ENQUEUE_ON_INGEST` | **`false`** | — | source constant, not env |
| 7 | Guardrail events | **132** | — | new |

**⚠ Item 1 framing.** Runs are **incremental**, not full-universe:

```
run e5880651  quarterly  success  asOf=2026-08-07  scored=7  suppressed=0
run c5c9df96  quarterly  success  asOf=2026-08-07  scored=7  suppressed=0
run 82d74b48  quarterly  success  asOf=2026-08-07  scored=8  suppressed=0
```

Literal reading of "under the current ScoringRun" = **7**. The number the docs mean, and the one the
read layer serves (`getLatestSnapshot` resolves in-force per stock across runs), is **95**.

### 6.1 Snapshot depth — the binding constraint

```
stocks with >=1 quarterly snapshot: 95
DISTINCT PERIODS per stock  min=1  median=6  max=13
stocks with <8 distinct periods: 91 of 95  (96%)
histogram (periods:stocks): 1:1  2:1  5:6  6:82  7:1  12:2  13:2
RAW ROWS per stock (incl. superseded)  min=7  median=47  max=61
```

86 of 95 stocks sit at exactly 5–6 distinct periods; only 4 have ≥8. Change-point detection with any
minimum phase length is **not viable on today's data**.

The raw-row median of 47 is **version churn, not history** — the same ~6 periods rescored repeatedly. A
depth check counting rows instead of distinct in-force periods reads 47 and concludes the opposite.

### 6.2 Quarterly fundamentals depth

```
non-financial   stocks=419  min=2  median=6   max=25
banking         stocks= 26  min=5  median=20  max=21
nbfc            stocks= 40  min=3  median=9   max=25
life ins        stocks=  4  min=6  median=6   max=6
gen ins         stocks=  4  min=3  median=5.5 max=6
ALL FAMILIES    stocks=493  min=2  median=6   max=25
stocks with <8 quarters: 283 of 493 (57%)
stocks with <4 quarters: 8
```

Viable for banking (median 20), usable for NBFC (9). The non-financial bulk — 419 of 493 — sits at
median 6.

### 6.3 `quarter_briefs` — the ~893 claim is REFUTED

```
total rows: 20
  status=live  20
earliest generatedAt: 2026-08-09T19:28:50Z
latest   generatedAt: 2026-08-09T20:36:29Z
rows generated BEFORE 2026-08-09 (purge date): 0
content parses as v2 BriefPayload: 20  | prose/old shape: 0
by model: gemini-3.5-flash-lite=20
```

There are **no thin pre-redesign briefs** — not ~893, not any. The real count was **908**, deleted
2026-08-09. `insight/quarter-brief/schema.ts:146-149`:

> *"`content` HELD PROSE UNTIL THIS STAGE, AND THE TABLE WAS PURGED RATHER THAN CONVERTED. The 908 rows
> written before it were prose and did not parse. They were DELETED on 2026-08-09, not marked stale…
> The table is empty, so no reader meets an old shape."*

All 20 surviving rows are v2, `live`, generated within a 68-minute window on 2026-08-09.

### 6.4 `BRIEF_ENQUEUE_ON_INGEST`

`ingestions/quaterly-results/scan.ts:513` — `export const BRIEF_ENQUEUE_ON_INGEST = false;`

**A source constant, not an environment variable.** Absent from `.env` and `.env.example`. Generation is
off at source; the 20 rows came from a manual backfill, not the ingest hook.

### 6.5 Guardrail signature events

```
total rows: 132
  A-3   114      C-1    12      B-4     3
  B-5     1      B-1     1      A-2     1
by outcome: O3=118, O2=2, O4=12
by tier:    auto=119, review=13
```

**Only 6 of 11 declared signature keys have ever fired.** A-1, A-4, B-2, B-3, C-2 have zero rows. A-3
(insufficient history) is 86% of all events — consistent with §6.1.

### 6.6 Pledge null-rate (closes the §4.3 open question)

```
shareholding_patterns total: 6178
pledgedShares IS NULL:  0     (0.0%)
pledgedShares = 0:      5519  (89.3%)
```

Zero of 6,178 rows carry NULL. Consequences:

- `pledgeRatios`' `pl == null ? null : …` branch (`read/ownership-series.service.ts:53`) is dead code.
- `r1-pledging.ts:49` and `n7-pledge-release.ts:52` `notEvaluable("pledging_not_disclosed")` are
  **unreachable**.
- The reader phrase *"pledging figures this company did not disclose"* (`coverage.ts:110`) can never be
  emitted for R1/N7.

89.3% of rows assert "zero pledge" where some unknown fraction is really "not disclosed". Currently
unrecoverable from stored data.

---

## 7. BLOCKERS

Nothing in Batches A–G was blocked. Every batch completed read-only. The items below are **limits of
what static + read-only evidence can establish**, not access failures.

| # | Item | Why unresolved | What would resolve it |
|---|---|---|---|
| B1 | `stock_finding` documented as 35, actual 45 | The source doc stating 35/14/58/11 was not located in `docs/`; Family N (7) explains most of the +10, 3 unattributed | The doc that carries the 118 figure |
| B2 | What fraction of the 89.3% zero-pledge rows are genuinely "not disclosed" | The distinction was destroyed at ingest before persistence (§4.3) | Re-parse of source XBRL, or a new ingest run retaining null |
| B3 | 255 UNCLEAR verdicts | 199 are over-exports whose fate follows their file; 56 are held alive only by one-off recon scripts that may themselves be disposable | One decision per file: is the file kept, and are the recon scripts kept |
| B4 | Whether the 34 non-migrated rules *should* return `not_evaluable` | Requires per-rule semantic judgement, not reachability | Rule-by-rule review |
| B5 | Runtime behaviour of the chat tool fleet | Not exercised — no live model call was made (would incur spend and is not read-only in the provider sense) | A live turn under `TOOL_PROVER_LIVE=1` |
| B6 | Frontend render behaviour | No app was launched; all frontend claims are static-analysis only | Running the app |
| B7 | **Whether the tree is still moving** | Active editing was observed during the scan window (§8.0); 3 of the 20 DELETE rows are in files created inside it | Re-run §0/§1 against a frozen commit before acting on any DELETE |
| B8 | Intent of `evidence-facts.ts` "REGISTRY 5 of 5" | It declares itself the fifth registry but is not in `CATALOGUE`/`REGISTRY_IDS`, and 2 of its exports have no consumer | The author's in-flight plan |

Explicitly **not** blockers: DB access worked (`.env` present, read-only queries succeeded); `tsx` was
already installed locally so no fetch was needed; both staleness gates ran.

---

## 8. METHOD FAILURES

Recorded because the project's most persistent failure class is scans that report clean while blind.

### 8.0 The largest failure: a stale snapshot, caught only at write-up

Batch A's inventory (**124 files / 795 exports / 17 DELETE**) was taken early. By the time the ledger
was generated the tree had moved: 3 files added, several edited, line numbers shifted. Two independent
parsers then disagreed with the recorded total (815 vs 795), which is what exposed it.

Two distinct defects were folded into that one number:

1. **Snapshot drift** — real code changes between Batch A and Batch H (see the banner at the top).
2. **Manual miscounts in Batch A's per-tree table** — `src/insight/quarter-brief` was recorded as 27
   files and has 25; `src/chat` as 50 and has 48; `src/ai` as 14 and has 15. Those per-tree numbers were
   hand-attributed rather than machine-counted, and their sum (128) did not even match the reported
   total (124) — an internal inconsistency that should have been caught at the time.

**Resolution:** every static count in §0, §1 and §5 was re-run on one final snapshot; §0 now carries a
line-by-line reconciliation (808 export lines → 815 symbols, 0 unmatched, 0 duplicates) and a
two-parser cross-check with a zero-symbol diff. The stale figures are not preserved anywhere in this
document except here.

**What this does not affect:** §2 (resolvers), §3 (renderers), §4 (absent states) and §6 (DB counts)
were re-checked for substance — resolver verdicts, the absent-state contract, the renderer inventory and
every live DB number are unchanged. Only file/export/verdict *counts* moved.

### 8.1 Negative control — did NOT misfire

`buildSectorRotationView` reported **MISSING** on the first run, with a positive control on the same
command form confirming the method finds real symbols. No rerun was required.

### 8.2 Scanner rewritten mid-Batch-A (backslash transport)

The first symbol-graph scanner crashed: the heredoc transport **halves `\\` escapes**, so
`/[.*+?^${}()|[\]\\]/g` arrived as `/[.*+?^${}()|[\]\]/g` → `SyntaxError: Invalid regular expression`.
Rewritten escape-free (identifier tokenization instead of constructed regexes) and re-run. **No result
from the broken version was used.** The same hazard recurred twice more (path-separator literals) and
was handled the same way.

### 8.3 Verdict rule was wrong on first pass — corrected, counts restated

Batch E first returned **KEEP: 256** (on the then-current 795-export snapshot). Two defects:

1. **AI-layer boundary too narrow.** The five directories exclude `controllers/me/chat-controller.ts`,
   `routes/me-chat-routes.ts` and three job handlers — all unambiguously AI-layer surface. This made
   `runChatTurn` score KEEP ("untouched by this build") when its only consumer is the chat controller
   the build replaces. Caught by spot-checking a symbol whose answer was predictable.
2. **`src/scripts` counted as production consumers.** Scripts are **703 of the 837** external
   import-edges out of the AI layer. Counting them as consumers marks nearly everything KEEP.

Corrected boundary = 5 trees + 5 surface files; script importers split into CI-gate (real consumer)
vs one-off recon (→ UNCLEAR). **KEEP fell 256 → ~101; PORT rose 193 → ~292** on that snapshot. §1.2
reports the final figures (105 / 296) re-run on the current snapshot.

### 8.4 Runtime-only reachability would have produced a false DELETE

The first reachability pass used two root classes (HTTP, cron) and marked
`src/catalogue/metric-view-fields.ts` unreachable. It is live in the CI gate `verify:copy-fresh`. A
third root class (28 `package.json` entry points) was added before any verdict was assigned. **No false
DELETE reached the ledger.**

### 8.5 Two counting traps avoided, recorded so they are not re-entered

- **Snapshot depth:** counting *rows* gives median 47; counting *distinct in-force periods* gives median
  6. The first number would have declared change-point detection viable. (§6.1)
- **"0 importers" as death:** 216 zero-import symbols, but only 17 dead — the rest are over-exports used
  in their own file. Treating the 216 as a deletion list would have removed 199 live symbols. (§1.6)

### 8.6 Shell-quoting defect in a Batch G query (caught, not shipped)

The first `pg_stat_user_tables` query was wrapped in a single-quoted shell string, so the SQL string
literals `'score_snapshots'` were terminated early and Postgres read them as identifiers
(`42703: column "score_snapshots" does not exist`). Rewritten to filter in JS with no SQL literals. The
failure was loud, not silent — no wrong number was produced.

---

*End of GATE 0 recon. Facts only; sequencing is decided upstream.*
