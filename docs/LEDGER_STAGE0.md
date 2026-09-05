# LEDGER — Stage 0

Module-granularity deletion ledger for the AI composition build.
Authority: `docs/Vytal_AI_Composition_Architecture_v1.md` §8.1, §8.2, §8.3.

**Measured:** 2026-08-29, against the recorded snapshot in §1 below. No commit hash freeze exists;
the baseline is the recorded measurement, per the amended §8.3.

---

## 1. Recorded baseline

### 1.1 Repo snapshot

```
$ git -C Vytal-Backend  log -1 --format='%H %ci %s'
a3e51e64cb1a46fbc88a9fc314c976ec5355e1af 2026-08-29 13:59:08 +0530 Backfill done

$ git -C Vytal-Frontend log -1 --format='%H %ci %s'
d4d6d965d5f8b847026c1fe4fd7f112c8a29c9dc 2026-08-29 13:59:52 +0530 Backfill done

$ git -C Vytal-Backend  status --short | wc -l
3
$ git -C Vytal-Frontend status --short | wc -l
1

$ git -C Vytal-Backend status --short
 M package-lock.json
?? docs/Vytal_AI_Composition_Architecture_v1.md
?? tmp-q.mjs

$ git -C Vytal-Frontend status --short
 D cls

branch, both repos: main
```

| Item | Prior (§8.3) | Measured | Flag |
|---|---|---|---|
| Backend HEAD staleness | 11 days stale | same-day (2026-08-29 13:59) | **MOVED** |
| Backend uncommitted paths | 338 | **3** | **MOVED** |
| Frontend uncommitted | 11 modified + 1 untracked | **1** (a deletion, `cls`) | **MOVED** |

None of the four remaining entries is source: a lockfile, this spec (untracked), a stray
`tmp-q.mjs`, and a deleted stray named `cls`.

### 1.2 Deletable surface (§8.1)

| Item | Prior (§8.1) | Measured | Flag |
|---|---|---|---|
| `src/ai/` files | 14 | **15** | **MOVED** (+1) |
| `src/chat/` files | 50 | **48** | **MOVED** (−2) |
| `src/ai/` LOC | not stated | 4,650 | new baseline |
| `src/chat/` LOC | not stated | 11,270 | new baseline |
| `src/ai/` exports | not stated | 100 | new baseline |
| `src/chat/` exports | not stated | 257 | new baseline |
| The 5 surface files | 5 | **5**, all present | unchanged |

**Total in scope: 68 files · 16,816 LOC · 369 exports.**

### 1.3 Live registry counts — measured by import, not regex

```
catalogueSize() = {"stock_finding":49,"lens_face":14,"phs_finding":58,"guardrail_signature":11}
catalogueSize TOTAL = 132
REGISTRY_IDS.length = 4 ["stock_finding","lens_face","phs_finding","guardrail_signature"]
PATTERN_KEYS.length = 22
PATTERN_FACTS keys = 22
FINDING_FACTS keys = 49
EVIDENCE_FACTS total = 289
EVIDENCE_FACTS reader = 113
EVIDENCE_FACTS internal = 176
READER_EVIDENCE_FACTS keys = 113
CLASSIFIED_EVIDENCE_KEYS = 289
QUARTER_METRIC_GLOSSES = 66
ANNUAL_METRIC_GLOSSES = 43
GLOSS TOTAL = 109
```

| Measure | Prior (§7.1) | Measured | Flag |
|---|---|---|---|
| `catalogueSize()` total | 132 | **132** | unchanged |
| — `stock_finding` | 49 | **49** | unchanged |
| — `lens_face` | not in spec | 14 | new baseline |
| — `phs_finding` | not in spec | 58 | new baseline |
| — `guardrail_signature` | 11 | **11** | unchanged |
| `REGISTRY_IDS.length` | 4 | **4** | unchanged |
| `PATTERN_KEYS.length` | 22 | **22** | unchanged |
| `FINDING_FACTS` keys | 49 | **49** | unchanged |
| `EVIDENCE_FACTS` total | 289 | **289** | unchanged |
| `EVIDENCE_FACTS` reader-only | 113 | **113** | unchanged |
| `EVIDENCE_FACTS` internal | not in spec | 176 | new baseline |
| Quarter glosses | not in spec | 66 | new baseline |
| Annual glosses | not in spec | 43 | new baseline |
| Gloss total | 109 | **109** | unchanged |

Every registry figure asserted in §7.1 holds exactly. The three-week drift §8.3 warns about
(118→128→132, 35→45→49, 18→22) has stopped at the terminal value of each series. What moved is
the *file* surface of `src/ai` and `src/chat`, not the vocabularies.

---

## 2. Method

**Scope** = `src/ai/` (15) + `src/chat/` (48) + the five surface files (5) = **68 files**.
`src/catalogue/` and `src/scoring/guardrail/` are KEEP wholesale per §8.1 and are not classified here.

**Consumer detection.** For each in-scope file, the module-specifier fragment an out-of-scope
importer is forced to write was grepped across all of `src/**/*.ts`, then every hit whose containing
file is itself in scope was removed. For `src/ai/**` and `src/chat/**` the fragment is the path from
`src/` with `.ts`→`.js` (any importer outside those trees must traverse `ai/` or `chat/`); for the
five surface files, which sit inside otherwise-out-of-scope directories, the fragment is the
basename. This catches static imports, `await import()`, and string references alike.

**Consumer classes.** Each out-of-scope hit is classified:

- **prod** — a runtime source file. A real consumer.
- **CI** — a script whose path appears verbatim in a `package.json` script. A real consumer.
- **recon** — a file under `src/scripts/` that appears in **no** npm script. **Not a consumer.**

The 40 npm-wired script paths were extracted from `package.json` by
`grep -oE 'src/[A-Za-z0-9_/.-]+\.ts' package.json | sort -u`, not by eye. This is the distinction
GATE 0 got wrong on its first pass; getting it wrong inverts the counts, because the chat tree is
surrounded by ~30 unwired `verify-*-live-chat.ts` probes that look exactly like gates.

**Verdicts.** DELETE — no consumer outside scope. PORT — has one, adapt to `Resolved<T>`.
EXTRACT — serves production consumers outside scope but is misfiled (§8.2); moves at **stage 5**.
UNCLEAR — stated precisely per row.

A file's fate decides its exports. No symbol is classified individually.

---

## 3. The ledger

| file | LOC | exports | consumers OUTSIDE scope (file:line) | verdict |
|---|---|---|---|---|
| `src/ai/adapters/gemini.ts` | 249 | 6 | **prod:** src/insight/quarter-brief/generate.ts:23<br>*(+1 recon)* | **PORT** |
| `src/ai/adapters/mock.ts` | 108 | 3 | — (1 recon-script refs only) | **DELETE** |
| `src/ai/context-layer.ts` | 250 | 2 | **CI:** src/scripts/verify-evaluative-tier.ts:21<br>*(+5 recon)* | **PORT** |
| `src/ai/filing-facts.ts` | 262 | 4 | — (2 recon-script refs only) | **DELETE** |
| `src/ai/grounding.ts` | 771 | 15 | **prod:** src/insight/quarter-brief/prompt.ts:65<br>*(+4 recon)* | **PORT** |
| `src/ai/guardrail-hinglish.ts` | 328 | 3 | — (1 recon-script refs only) | **DELETE** |
| `src/ai/guardrail.ts` | 781 | 11 | **prod:** src/insight/quarter-brief/generate.ts:26<br>**CI:** src/scripts/verify-evaluative-tier.ts:20<br>src/scripts/verify-quarter-brief-anchors.ts:36<br>*(+19 recon)* | **PORT** |
| `src/ai/insight/relationship.ts` | 267 | 8 | **prod:** src/relational/reader-context.ts:21<br>src/relational/reader-exposure.ts:38<br>src/results-season/service.ts:54<br>*(+1 recon)* | **EXTRACT** |
| `src/ai/moderation.ts` | 225 | 6 | — (2 recon-script refs only) | **DELETE** |
| `src/ai/number-grounding.ts` | 227 | 4 | **prod:** src/insight/quarter-brief/generate.ts:25<br>**CI:** src/scripts/verify-number-grounding.ts:17<br>*(+2 recon)* | **PORT** |
| `src/ai/quota.ts` | 484 | 6 | **prod:** src/insight/quarter-brief/generate.ts:24<br>*(+10 recon)* | **PORT** |
| `src/ai/registry.ts` | 41 | 1 | — | **DELETE** |
| `src/ai/spend.ts` | 75 | 5 | — (1 recon-script refs only) | **DELETE** |
| `src/ai/tone.ts` | 374 | 11 | **prod:** src/relational/copy.ts:15<br>src/relational/reader-context.ts:35<br>src/relational/types.ts:15<br>**CI:** src/scripts/verify-evaluative-tier.ts:22<br>src/scripts/verify-number-grounding.ts:19<br>*(+3 recon)* | **EXTRACT** |
| `src/ai/types.ts` | 208 | 15 | — (21 recon-script refs only) | **DELETE** |
| `src/chat/compose.ts` | 288 | 6 | — (2 recon-script refs only) | **DELETE** |
| `src/chat/config.ts` | 123 | 11 | — (22 recon-script refs only) | **DELETE** |
| `src/chat/date-resolve.ts` | 455 | 10 | — (3 recon-script refs only) | **DELETE** |
| `src/chat/discuss-context.ts` | 35 | 6 | — (3 recon-script refs only) | **DELETE** |
| `src/chat/engine.ts` | 373 | 7 | — (7 recon-script refs only) | **DELETE** |
| `src/chat/links.ts` | 407 | 16 | — (2 recon-script refs only) | **DELETE** |
| `src/chat/memory.ts` | 679 | 19 | — (4 recon-script refs only) | **DELETE** |
| `src/chat/openings.ts` | 211 | 6 | — (2 recon-script refs only) | **DELETE** |
| `src/chat/profile.ts` | 448 | 13 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/proposals.ts` | 221 | 11 | — (8 recon-script refs only) | **DELETE** |
| `src/chat/screen-brief.ts` | 309 | 2 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/sessions.ts` | 757 | 26 | — (6 recon-script refs only) | **DELETE** |
| `src/chat/tools/alerts-write.ts` | 377 | 2 | — | **DELETE** |
| `src/chat/tools/boundary.ts` | 62 | 2 | — (2 recon-script refs only) | **DELETE** |
| `src/chat/tools/confirm.ts` | 232 | 2 | — | **DELETE** |
| `src/chat/tools/event-description.ts` | 203 | 5 | **CI:** src/scripts/verify-number-grounding.ts:16 | **PORT** |
| `src/chat/tools/get-corporate-events.ts` | 105 | 1 | **CI:** src/scripts/verify-number-grounding.ts:21 | **PORT** |
| `src/chat/tools/get-findings-for-symbols.ts` | 204 | 1 | **CI:** src/scripts/verify-evaluative-tier.ts:25<br>*(+1 recon)* | **PORT** |
| `src/chat/tools/get-fund-analytics.ts` | 99 | 1 | — | **DELETE** |
| `src/chat/tools/get-instrument-details.ts` | 175 | 1 | **CI:** src/scripts/verify-number-grounding.ts:22 | **PORT** |
| `src/chat/tools/get-peer-group.ts` | 115 | 2 | — | **DELETE** |
| `src/chat/tools/get-portfolio-facts.ts` | 43 | 1 | — | **DELETE** |
| `src/chat/tools/get-stock-facts.ts` | 169 | 1 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/tools/get-stock-fundamentals.ts` | 371 | 6 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/tools/get-stock-news.ts` | 230 | 2 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/tools/get-stock-ownership.ts` | 196 | 3 | — | **DELETE** |
| `src/chat/tools/get-stock-price.ts` | 83 | 1 | — | **DELETE** |
| `src/chat/tools/get-stock-quarterly-results.ts` | 105 | 1 | — | **DELETE** |
| `src/chat/tools/get-stock-relationship.ts` | 107 | 1 | — | **DELETE** |
| `src/chat/tools/get-universe-scan.ts` | 204 | 1 | — | **DELETE** |
| `src/chat/tools/get-watchlist.ts` | 83 | 1 | — | **DELETE** |
| `src/chat/tools/memory.ts` | 284 | 3 | — | **DELETE** |
| `src/chat/tools/open-comparison.ts` | 205 | 2 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/tools/record-transaction.ts` | 229 | 1 | — | **DELETE** |
| `src/chat/tools/registry.ts` | 223 | 7 | **CI:** src/scripts/verify-evaluative-tier.ts:24<br>src/scripts/verify-number-grounding.ts:20<br>*(+15 recon)* | **PORT** |
| `src/chat/tools/reminders-write.ts` | 121 | 1 | — | **DELETE** |
| `src/chat/tools/resolve-date.ts` | 106 | 1 | — | **DELETE** |
| `src/chat/tools/screen-stocks.ts` | 287 | 1 | — | **DELETE** |
| `src/chat/tools/search-stocks.ts` | 107 | 1 | — | **DELETE** |
| `src/chat/tools/shared.ts` | 71 | 10 | — | **DELETE** |
| `src/chat/tools/types.ts` | 166 | 8 | — (2 recon-script refs only) | **DELETE** |
| `src/chat/tools/watchlist-write.ts` | 137 | 2 | — | **DELETE** |
| `src/chat/tools/write-shared.ts` | 205 | 10 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/unavailable.ts` | 100 | 6 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/universe-brief.ts` | 370 | 1 | — (1 recon-script refs only) | **DELETE** |
| `src/chat/voice.ts` | 502 | 22 | **CI:** src/scripts/verify-evaluative-tier.ts:23<br>src/scripts/verify-number-grounding.ts:18<br>*(+20 recon)* | **PORT** |
| `src/chat/web/news-filter.ts` | 400 | 7 | **prod:** src/ingestions/news_and_announcements/relevance.ts:36<br>src/insight/quarter-brief/prompt.ts:68<br>*(+2 recon)* | **EXTRACT** |
| `src/chat/web/serper.ts` | 288 | 9 | — (2 recon-script refs only) | **DELETE** |
| `src/controllers/me/chat-controller.ts` | 641 | 8 | — | **DELETE** |
| `src/jobs/handlers/chat-profile-distill.handler.ts` | 77 | 1 | **prod:** src/jobs/dispatcher.ts:68 | **PORT** |
| `src/jobs/handlers/chat-title-generate.handler.ts` | 95 | 1 | **prod:** src/jobs/dispatcher.ts:67<br>*(+1 recon)* | **PORT** |
| `src/jobs/handlers/quarter-brief.handler.ts` | 43 | 1 | **prod:** src/jobs/dispatcher.ts:76 | **UNCLEAR** |
| `src/routes/me-chat-routes.ts` | 40 | 1 | **prod:** src/app.ts:63<br>*(+32 recon)* | **PORT** |

### 3.1 Tally

| verdict | files | LOC | exports |
|---|---|---|---|
| **DELETE** | 49 | 11,346 | 261 |
| **PORT** | 15 | 4,386 | 84 |
| **EXTRACT** | 3 | 1,041 | 26 |
| **UNCLEAR** | 1 | 43 | 1 |
| **total** | **68** | **16,816** | **372** |

*(export total 372 vs the 369 in section 1.2: three files carry a trailing re-export line in
addition to their inline export declarations — `chat/tools/open-comparison.ts:53`,
`chat/tools/shared.ts:17`, `chat/tools/write-shared.ts:80`. Counted once per line, not per symbol.)*

### 3.2 What happened to GATE 0's 270 UNCLEAR

**UNVERIFIED against the source document** — `docs/recon/GATE0_AI_ARCHITECTURE.md` does not exist in
either repo, so GATE 0's 815 rows / 270 UNCLEAR / 199 over-exports could not be re-read. The figures
below use section 8.1's quoted numbers as the prior.

Section 8.1 predicted that 199 of 255 UNCLEAR were over-exports whose fate follows their file,
leaving ~56 genuine. At file granularity the prediction is **borne out and then some**:

- 261 exports sit on DELETE files and 84 on PORT files — **345 of 372 exports (93%) are decided by
  their file, with no per-symbol judgement at all.**
- Genuine UNCLEAR collapses from ~56 to **1 file, 1 export** (section 3.4).
- The remaining per-symbol work is not UNCLEAR but *partial-extract* scoping, confined to the 26
  exports on the three EXTRACT files (section 3.3).

The symbol-level granularity was the wrong instrument. Nothing needed 270 decisions; it needed 68.

### 3.3 EXTRACT — confirmed, refuted, and one the spec does not name

Section 8.2 names two. Both are **CONFIRMED as EXTRACT**. One consumer count is **refuted**. A third
candidate, not in section 8.2, is **found**.

#### 3.3.1 `probeStockRelationship` — `src/ai/insight/relationship.ts` — CONFIRMED

Section 8.2: "3 consumers in `relational` / `results-season`." Exact.

```
src/relational/reader-context.ts:21:import { probeStockRelationship } from "../ai/insight/relationship.js";
src/relational/reader-exposure.ts:38:import { probeStockRelationship } from "../ai/insight/relationship.js";
src/results-season/service.ts:54:import { probeStockRelationship } from "../ai/insight/relationship.js";
```

Call sites, for the record:

```
src/relational/reader-context.ts:86:    probeStockRelationship(userId, stockId).catch(() => ({ held: false, watchlist: null })),
src/relational/reader-exposure.ts:59:        const probe = await probeStockRelationship(userId, stockId);
src/results-season/service.ts:155:    const probe = await probeStockRelationship(userId, stockId);
```

`src/relational/reader-context.ts:98` already records the constraint in a comment:

```
// `probeStockRelationship` (src/ai/insight/relationship.ts, not modifiable by this build) tests only
```

**Partial extract.** The file exports 8 symbols; only `probeStockRelationship` has out-of-scope
production consumers. `groundStockRelationship` (`relationship.ts:136`) is imported solely by
`chat/compose.ts:23` and `chat/tools/get-stock-relationship.ts:20` — both in scope, both die.

#### 3.3.2 `src/chat/web/news-filter.ts` — CONFIRMED as EXTRACT, consumer count **REFUTED**

Section 8.2 says "4, feeding news ingest." Measured: **2 out-of-scope importing files**, not 4.

```
src/ingestions/news_and_announcements/relevance.ts:36:} from "../../chat/web/news-filter.js";
src/insight/quarter-brief/prompt.ts:68:import { shortenCompanyName } from "../../chat/web/news-filter.js";
```

The full `relevance.ts` import block, since the line above is a continuation:

```
src/ingestions/news_and_announcements/relevance.ts:30-36
import {
  buildEntityGuard,
  screenNewsItems,
  shortenCompanyName,
  type DropReason,
  type EntityGuard,
} from "../../chat/web/news-filter.js";
```

The other three references in the tree are **not** out-of-scope production consumers:

```
src/chat/tools/get-stock-news.ts:26        — IN SCOPE (dies with the tree)
src/scripts/brief-name-opening-census.ts:21 — recon, unwired
src/scripts/verify-stock-news.ts:16        — recon, unwired (in no npm script)
```

**Best reading of the discrepancy:** section 8.2's "4" most likely counted importing sites including
the in-scope tool and a recon script, or counted symbols pulled by `relevance.ts`. Either way the
EXTRACT verdict stands and the number should not be relied on. The second consumer,
`quarter-brief/prompt.ts:68`, is documented in the source as deliberate reuse:

```
src/insight/quarter-brief/prompt.ts:66-67
// * REUSED, NOT REIMPLEMENTED — the shared corporate-suffix strip. See briefProseName below for what
// it does and does not cover, and why this file adds two steps on top rather than forking it.
```

#### 3.3.3 `src/ai/tone.ts` — **THIRD EXTRACT CANDIDATE, NOT IN SECTION 8.2**

Three out-of-scope production consumers, in `src/relational/` — the same tree that drove 3.3.1:

```
src/relational/copy.ts:15:import type { ToneLevel } from "../ai/tone.js";
src/relational/types.ts:15:import type { ToneLevel } from "../ai/tone.js";
src/relational/reader-context.ts:35:import { resolveToneForUser } from "../ai/tone.js";
```

Plus two CI-gate consumers (`verify-evaluative-tier.ts:22`, `verify-number-grounding.ts:19`).

**The file is genuinely split, and the split is clean.** Of its 11 exports:

- *Reader-preference resolution, consumed outside* — `ToneLevel` (`tone.ts:36`),
  `resolveToneForUser` (`tone.ts:363`). Not AI-layer: a tone register is a product preference the
  relational reader renders against, with no model in the path.
- *Prompt directives, AI-layer, die with the tree* — `NON_ADVISORY_SPINE` (`:50`),
  `CONVERSATIONAL_PRECISION` (`:72`), `LANGUAGE_MIRROR` (`:108`), `EXPLANATORY_DEPTH` (`:164`),
  `COMPANY_ANSWER_SHAPE` (`:240`). These are prompt text — exactly the surface section 7.6 says
  stops existing once all shipped copy is code-rendered.
- *Shared shape* — `ToneDepth`, `ToneJargon`, `ToneDirective`, `resolveTone` (`:345`).

Same shape of defect as 3.3.1: a product-level resolver misfiled under `src/ai/` because its first
caller happened to be the chat layer. **Reported, not fixed** — section 8.2 is the ruling document
and does not list it.

### 3.4 The single UNCLEAR

`src/jobs/handlers/quarter-brief.handler.ts` — 43 LOC, 1 export, consumed at
`src/jobs/dispatcher.ts:76`.

**What is ambiguous, precisely:** the file contains no AI-layer or chat-layer code. It is a 43-line
adapter mapping a `WriteOutcome` onto the `BackgroundJob` lifecycle, delegating entirely to
`writeQuarterBrief`:

```
src/jobs/handlers/quarter-brief.handler.ts:22:import { writeQuarterBrief } from "../../insight/quarter-brief/write.js";
```

`src/insight/quarter-brief/` — **24 files — is out of scope** and is where the quarter-brief AI
pipeline actually lives. The handler's fate depends on a question section 8.1 does not answer: is
the quarter-brief pipeline replaced by the new composition layer, or does it survive as a separate
AI surface? If it survives, the handler is KEEP and was wrongly swept into the deletable set; if it
is replaced, the handler is PORT. Nothing in the file itself decides this.

See section 4.1 — the sharper form of a scope problem that affects five other rows.

### 3.5 The 33 chat tools

**Still 33.** Counted by importing the registry, not by regex — `CHAT_TOOLS.length = 33`.

The registry array, verbatim from `src/chat/tools/registry.ts:30-63`:

```
export const CHAT_TOOLS: ChatTool[] = [
  searchStocksTool,
  getStockFactsTool,
  getStockPriceTool,
  getStockFundamentalsTool,
  getStockQuarterlyResultsTool,
  getStockShareholdingTool,
  getStockDealsTool,
  getStockInsiderTradesTool,
  getCorporateEventsTool,
  getUniverseScanTool,
  getFindingsForSymbolsTool,
  screenStocksTool,
  getPeerGroupTool,
  getPeerGroupMembersTool,
  getInstrumentDetailsTool,
  getFundAnalyticsTool,
  getStockNewsTool,
  openComparisonTool,
  getPortfolioFactsTool,
  getStockRelationshipTool,
  getWatchlistTool,
  resolveDateTool,
  addToWatchlistWriteTool,
  rememberThisTool,
  listMemoriesTool,
  forgetMemoryTool,
  removeFromWatchlistWriteTool,
  createAlertWriteTool,
  deleteAlertWriteTool,
  setEventReminderTool,
  recordTransactionTool,
  confirmPendingActionTool,
  cancelPendingActionTool,
];
```

Resolved at runtime, with `klass`:

```
 1. searchStocks [read]               18. openComparison [action]
 2. getStockFacts [read]              19. getPortfolioFacts [read]
 3. getStockPrice [read]              20. getStockRelationship [read]
 4. getStockFundamentals [read]       21. getWatchlist [read]
 5. getStockQuarterlyResults [read]   22. resolveDate [read]
 6. getStockShareholding [read]       23. addToWatchlist [write]
 7. getStockDeals [read]              24. rememberThis [write]
 8. getStockInsiderTrades [read]      25. listMemories [read]
 9. getCorporateEvents [read]         26. forgetMemory [action]
10. getUniverseScan [read]            27. removeFromWatchlist [write]
11. getFindingsForSymbols [read]      28. createAlert [write]
12. screenStocks [read]               29. deleteAlert [write]
13. getPeerGroup [read]               30. setEventReminder [write]
14. getPeerGroupMembers [read]        31. recordTransaction [write]
15. getInstrumentDetails [read]       32. confirmPendingAction [write]
16. getFundAnalytics [read]           33. cancelPendingAction [write]
17. getStockNews [web]
```

33 tools across 32 files: `get-stock-ownership.ts` and `memory.ts` export 3 each;
`get-peer-group.ts`, `watchlist-write.ts`, `alerts-write.ts` and `confirm.ts` export 2 each.

**Do any have consumers outside `src/chat/`? Four do, and every one is a CI gate — zero production
consumers:**

```
src/scripts/verify-number-grounding.ts:16:import { parseEventDescription, renderComponents, SUPPRESSED_TAIL_NOTE } from "../chat/tools/event-description.js";
src/scripts/verify-number-grounding.ts:21:import { getCorporateEventsTool } from "../chat/tools/get-corporate-events.js";
src/scripts/verify-number-grounding.ts:22:import { getInstrumentDetailsTool } from "../chat/tools/get-instrument-details.js";
src/scripts/verify-evaluative-tier.ts:25:import { getFindingsForSymbolsTool } from "../chat/tools/get-findings-for-symbols.js";
```

Both scripts are npm-wired (`verify:live` -> `verify:all`), so these are real consumers and the four
files are PORT. But the dependency is a gate reading tool output for its corpus, not product code,
and it disappears the moment the gates are re-pointed at the new section renderers.

`src/chat/tools/registry.ts` is likewise PORT on two CI hits only
(`verify-evaluative-tier.ts:24`, `verify-number-grounding.ts:20`).

**The other 28 tool files have no consumer of any class outside `src/chat/`.** They are DELETE.

---

## 4. Contradictions with the spec — reported, not fixed

### 4.1 Section 8.1's scope boundary leaks: `src/insight/quarter-brief/` is a live out-of-scope AI consumer

Section 8.1 defines the deletable surface as `src/ai/` + `src/chat/` + five surface files, one of
which is the quarter-brief job handler. But the quarter-brief **pipeline** — 24 files under
`src/insight/quarter-brief/` — is out of scope and imports six in-scope files directly:

```
src/insight/quarter-brief/generate.ts:23:import { createGeminiAdapter } from "../../ai/adapters/gemini.js";
src/insight/quarter-brief/generate.ts:24:import { checkAndConsumeAiCall, recordAiTokens, type Actor } from "../../ai/quota.js";
src/insight/quarter-brief/generate.ts:25:import { scanUngroundedNumbers } from "../../ai/number-grounding.js";
src/insight/quarter-brief/generate.ts:26:import { scanExplanationText } from "../../ai/guardrail.js";
src/insight/quarter-brief/prompt.ts:65:import { CLOSED_WORLD_HEADER } from "../../ai/grounding.js";
src/insight/quarter-brief/prompt.ts:68:import { shortenCompanyName } from "../../chat/web/news-filter.js";
```

That is a **second, independent AI surface** — its own provider adapter call, its own quota
accounting, its own grounding scan, its own guardrail scan — living entirely outside the tree
section 8.1 declares deletable. It is the sole reason five `src/ai/` files (`gemini.ts`, `quota.ts`,
`number-grounding.ts`, `guardrail.ts`, `grounding.ts`) are PORT rather than DELETE.

Section 9's stage table has no stage for it. Section 8.1's "replacement of the composition and
rendering layer" framing does not describe it. **Not resolved here** — sequencing is upstream.

### 4.2 Section 8.2's news-filter consumer count is wrong

"4" -> measured **2** out-of-scope importing files. See 3.3.2. Verdict unaffected.

### 4.3 A third EXTRACT candidate section 8.2 does not list

`src/ai/tone.ts`, 3 production consumers in `src/relational/`. See 3.3.3.

### 4.4 Section 8.1's file counts have both moved

`src/ai/` 14 -> **15**; `src/chat/` 50 -> **48**. See 1.2.

### 4.5 Document paths in the build brief do not exist

- The brief cites `docs/architecture/AI_Composition_Architecture_v1.md`. The spec is at
  `docs/Vytal_AI_Composition_Architecture_v1.md`; no `docs/architecture/` directory exists in
  either repo. This ledger is written flat to match.
- The brief cites prior recon at `docs/recon/GATE0_AI_ARCHITECTURE.md`. **It does not exist in
  either repo** (`find . -type d -iname recon` returns nothing). Every GATE 0 / 0b figure not quoted
  inside the spec is therefore `UNVERIFIED — prior document absent from tree`, and this ledger is a
  fresh file-level measurement rather than a re-run.

### 4.6 `me-chat-routes.ts` carries a 32-script unwired probe fleet

`src/routes/me-chat-routes.ts` has exactly **one** production consumer (`src/app.ts:63`) and **32**
recon-script consumers, none in any npm script — `verify-chat.ts`, `verify-chat-tools.ts`,
`verify-depth-corpus.ts`, `verify-pages-live-chat.ts`, and 28 more. Under a rule that counts every
`src/scripts/` importer these would read as 33 consumers and make the route look load-bearing. It
is not: it is one mount line plus a large unwired probe fleet that dies with the tree it exercises.

This is the concrete case the CI-gate / recon-script distinction was introduced to catch.

---

## 5. D-5 findings — recorded, not fixed

Three defects found while classifying the 25 orphaned evidence keys (D-5). None is fixable inside
that task's file scope. Evidence is from live data unless stated.

### 5a — `evidence-render.ts` documents an ordering guarantee the storage layer cannot provide

`src/scoring/findings/evidence-render.ts:85-86` states:

> *"Ordered by the bag's own key order, which is the order the rule stamped them in — stable per rule,
> and not a ranking this module is entitled to invent."*

**That is false in production.** `stock_findings.evidence` and `score_patterns.evidence` are **JSONB**,
and Postgres JSONB does not preserve insertion order — it stores keys sorted by *length, then bytewise*.
The stamp order is gone before the renderer ever sees the bag.

Measured on a live `ownership_N7_pledge_release` firing (EASEMYTRIP, FY27Q1). Rendered pip line:

```
Fall 19.9 · Period FY27Q1 · Promoter holding pledged now 5.97% · Compared with FY26Q4 · Promoter holding pledged before 25.91%
```

The rule stamps `period`, `priorPeriod`, `pledgeFromPct`, `pledgeToPct`, `fallPp` in that order
(`scoring/findings/rules/n7-pledge-release.ts:90-101`). The reader-facing keys emerge as
`fallPp`(6) · `period`(6) · `pledgeToPct`(11) · `priorPeriod`(11) · `pledgeFromPct`(13) — exactly
JSONB's (length, bytewise) sort, not the rule's order.

**Reader-visible consequence: the receipts read backwards.** "Promoter holding pledged **now**"
renders *before* "Promoter holding pledged **before**", and the period pair is split by a pledge value.
Every finding with more than two reader keys is affected; N7 is simply the clearest case.

**What fixing it would take.** The comment cannot be made true by editing the renderer — the
information it relies on does not survive the write. Three options, none small:

1. **Author an explicit order** per finding (or per key) in the catalogue, and have the renderer sort
   by it. Additive, keeps one source of truth, and is the only option that makes the guarantee real
   rather than incidental. Cost: an ordering decision for every reader key, and a gate to keep it total.
2. **Store the bag as an ordered structure** (a JSON array of pairs, or `json` rather than `jsonb`).
   Touches the write path, the schema, and every reader — a migration, so out of scope by a wide margin.
3. **Delete the claim** and document that pip order is storage-defined and not meaningful. Cheapest,
   honest, and leaves "pledged now" before "pledged before" on the card.

**Recommendation: option 1**, because the ordering is reader-facing copy in everything but name.
Not attempted here — it touches `evidence-render.ts` and the catalogue's shape, neither of which is in
D-5's scope. Of the two findings in this section it is the more serious: a module asserting a property
its storage cannot supply will mislead the next person who reads it as a licence to rely on order.

### 5b — `fallPp` is classified `pts`, but it is percentage points

`catalogue/evidence-facts.ts` carries `fallPp: R("Fall", "pts")`. `pts` prints **bare** by design
(`evidence-render.ts` `formatValue`: *"`pts` prints BARE because the label beside a pillar subtotal
already says which pillar"*). That is right for a pillar subtotal and wrong for N7, where `fallPp` is
a fall in a pledge **ratio**.

Same firing, the two surfaces disagree:

```
  VERDICT  …the promoter's pledge ratio fell 19.94pp into FY27Q1…
  PIPS     Fall 19.9 · …
```

The sentence says `19.94pp`; the pip says `19.9` with no unit at all. `EvidenceUnit`'s own header
warns that *"`pp` AND `%` ARE NOT INTERCHANGEABLE and the distinction is load-bearing"* — the same
argument applies to `pp` versus a bare number.

**Why it was not fixed here.** `fallPp` is a pre-existing classification, not one of D-5's 25 keys, and
it is shared: the key is emitted by several rules, at least one of which is a pillar-points context
where `pts` is correct. Changing the unit is therefore not a one-line edit — it needs the same
per-emitter check the 25 keys got, and it may need the key split. Sized as small but not trivial.

### 5c — the N-family sentence/pip precision mismatch is **blocked**, and the blocker is structural

Every authored sentence in `catalogue/n-family-copy.ts` interpolates its evidence values **raw**, so it
has no precision at all: `String(25.91)` is `"25.91"` but `String(0)` is `"0"`. The pips beside it go
through `formatValue`, which applies the key's declared precision. They disagree whenever a stored
value has fewer decimals than the declared precision:

```
FINKURVE   VERDICT  …fallen from 19.04% to 0% of their holding.
           PIPS     …Promoter holding pledged now 0.00%…

TIINDIA    VERDICT  Debt relative to equity has fallen for 3 straight years, from 0.14× to 0×.
           PIPS     Debt to equity now 0.00× · … · Debt to equity before 0.14×
```

Systemic across all five authored sentences, not specific to pledge.

**Why it cannot be closed in the catalogue.** The obvious fix — `.toFixed()` in the sentence — breaks
`npm run build`. `scripts/verify-verdicts.ts` is in the `verify:copy` chain and asserts exact rendered
substrings from `scripts/lib/verdict-fixtures.ts`. Those fixtures **encode the raw-interpolation output
as the expected result**. Measured, all five:

| finding | fixture `expectContains` | renders today | with `.toFixed()` |
|---|---|---|---|
| `foundation_N3_deleveraging` | `from 1.8× to 0.6×` | PASS | `from 1.80× to 0.60×` **FAIL** |
| `foundation_N4_coverage_strengthening` | `from a thin 1.2×` | PASS | `from a thin 1.20×` **FAIL** |
| `ownership_N5_dual_institutional_build` | `FII 1.4pp, DII 0.9pp` | PASS | `FII 1.40pp, DII 0.90pp` **FAIL** |
| `ownership_N6_promoter_accumulation` | `up 2.7pp` | PASS | `up 2.70pp` **FAIL** |
| `ownership_N7_pledge_release` | `from 41% to 12.5% of their holding` | PASS | `from 41.0% to 12.5%…` **FAIL** |

**5 of 5.** And `n-family-copy.ts` is a **mirrored module across both repos** — the frontend keeps its
own copy at `Vytal-Frontend/lib/n-family-copy.ts`, consumed by `lib/findings/verdicts.ts:22`, which
`gen-frontend-fallback.ts:26-28` deliberately does **not** generate ("they stay a mirrored module and
are proved character-identical against the backend"). Editing one side alone diverges them and ships
two different sentences for the same finding.

Closing this properly therefore requires **four** files across two repos:

1. `src/catalogue/n-family-copy.ts` — the five templates
2. `src/scripts/lib/verdict-fixtures.ts` — the five `expectContains` values
3. `Vytal-Frontend/lib/n-family-copy.ts` — the mirror
4. plus a decision on whether the frontend's own pip formatter (`lib/findings/evidence-pips.ts`) needs
   the matching change, since `evidence-render.ts` is explicitly a transcription of it

That is its own change with its own scope, not a rider on D-5.

**⚠ A standing hazard this exposes, worth more than the defect itself.** The fixtures assert what the
code currently produces rather than what the copy should say. `pledgeFromPct: 41.0` expecting `"41%"`
is a *rounding artefact* frozen into a gate. Any future correction to number formatting in these
sentences now has to defeat five assertions that were written to lock the artefact in. A gate that
encodes current behaviour as intent converts a copy fix into a gate fight — the same failure class as
§7.3's fixture-shaped Gate 1, arriving from the opposite direction.

### 5d — `npm run build` is red, from concurrent work, not from D-5

Run after the D-5 classification: **exit 1, 10 checks failed**, all in
`scripts/verify-ingester-write-semantics.ts` — the **third** of 26 scripts in the `verify:copy` chain:

```
  FAIL  ingest-indas-annual.ts         passes its directive to the writer
  FAIL  ingest-indas-quarterly.ts      passes its directive to the writer
  FAIL  ingest-banking-annual.ts       passes its directive to the writer
  FAIL  ingest-banking-quarterly.ts    passes its directive to the writer
  FAIL  ingest-nbfc-annual.ts          passes its directive to the writer
  FAIL  ingest-nbfc-quarterly.ts       passes its directive to the writer
  FAIL  ingest-li-annual.ts            passes its directive to the writer
  FAIL  ingest-li-quarterly.ts         passes its directive to the writer
  FAIL  ingest-gi-annual.ts            passes its directive to the writer
  FAIL  ingest-gi-quarterly.ts         passes its directive to the writer
  10 CHECK(S) FAILED
```

**Not attributable to D-5, on three independent grounds:**

1. **The failing gate cannot see the changed file.** `verify-ingester-write-semantics.ts` imports only
   `node:fs` and reads the ingestions tree by path. It touches nothing under `catalogue/`.
2. **The build died before reaching the catalogue gates.** `verify-catalogue.ts` is 4th in the chain
   and `verify-verdicts.ts` 5th; the `&&` chain aborted at the 3rd. The D-5 change was never exercised.
3. **All ten files were modified at 15:53:41** — 28 minutes after the D-5 edit (15:25:43) and *while
   the build was running*. They are part of the same in-flight `src/ingestions/` work recorded in
   §8.3's concurrency caveat.

**The D-5 change is green in isolation**, verified by running the affected gates directly:

```
npx tsc --noEmit                      EXIT 0
verify-catalogue.ts                   EXIT 0   ✅ one home, four registries, every key reconciled
verify-verdicts.ts                    EXIT 0   ✅ 71 fixtures, every branch, precedence preserved
verify-copy-register.ts               EXIT 0   ✅ no figures, no advisory
verify-evidence-register.ts           EXIT 0   ✅ rule-authored copy held to the same rules
verify-evidence-facts.ts              EXIT 0   ✅ §§1-4 all pass
```

⚠ **No clean "before" baseline exists for `npm run build`.** Stage 0 deliberately did not run it (gate
wiring never happened, so the authorisation was void), so it cannot be proven the build was green
before this work — only that D-5 is not what is breaking it now. Whoever owns the `src/ingestions/`
change should re-run the chain once that work settles.

### 5e — a second run of §4 moved, and it is worth one line

`verify-evidence-facts.ts` §4 reported `48126 rows compared · 0 not yet persisted` on the Stage-0 run
and `48121 compared · 5 not yet persisted` after. The total is identical (48,126); five rows moved from
*persisted* to *newly re-derived but not yet written*. The gate passes either way — it is designed to
tolerate exactly this — and the cause is the live ingestion work above, not the vocabulary. Recorded so
a future reader does not read the delta as drift caused by the classification.
