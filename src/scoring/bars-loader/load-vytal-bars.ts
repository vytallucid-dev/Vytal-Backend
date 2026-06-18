// File: src/scoring/bars-loader/load-vytal-bars.ts
//
// THE PER-PG BAR LOADER (Phase 6, handoff Half 1) — PURE core.
//
// Reads a parsed vytal_pg_bars.json and produces (a) the explicit per-PG
// label→key mapping for review, (b) the per-PG validation summary (handoff §4),
// (c) the PG5=PG6 byte-identical check (§3), and (d) the would-WRITE
// score_metric_bar_sets rows with the metadata the JSON does not carry (§1):
// version, inForceFrom, specVersionFramework, provenance, derivationLayer.
//
// This function NEVER writes the DB and NEVER invents a bar (CN-4/CN-8): it
// applies the loaded VALUES and the fixed universal mapping only. The actual
// committed write is bars-loader/commit.ts, run as a separate deliberate step
// after the mapping + validation below are reviewed.
//
// VERSIONING (§1): append-only. `version` for each row is max(existing for
// (barPath, metricKey)) + 1; in validate-only mode there is no DB, so it is the
// supplied `baseVersion` (default 1) with a note that commit resolves the real
// next version. PG6 inherits PG5's bar-set (§3) — it produces ZERO own rows and
// instead carries an inheritsFromPeerGroupId pointer; it still computes its own
// peer-stats elsewhere (never inherited).

import {
  resolveMetricKey,
  toEngineUnit,
  isKnownJsonUnit,
  expectedUnit,
  expectedDirection,
  canonicalMetric,
  type IndustryType,
} from "./label-map.js";
import type {
  SourceDocument,
  SourcePeerGroup,
  SourceMetric,
  SourceFiveBars,
  WouldWriteRow,
  PerPgReport,
  MappingEntry,
  ValidationIssue,
  Pg5Pg6Check,
  LoadReport,
  SscuOverride,
} from "./types.js";

export interface LoadOptions {
  mode?: "validate_only" | "commit";
  baseVersion?: number; // dry-mode version stamp (commit resolves the real next version)
  inForceFrom?: string; // ISO date the bars take force; defaults to the file's extractionDate
  derivationLayer?: "layer_a" | "layer_b" | "layer_c";
  sourcePath?: string;
}

const BAR_ORDER: (keyof SourceFiveBars)[] = [
  "excellent", "good", "acceptable", "concerning", "distress",
];

/** Count collapsed (equal adjacent) pairs in the 5-bar ladder. */
function collapsedPairCount(bars: SourceFiveBars): number {
  let n = 0;
  for (let i = 0; i < BAR_ORDER.length - 1; i++) {
    if (bars[BAR_ORDER[i]] === bars[BAR_ORDER[i + 1]]) n++;
  }
  return n;
}

const allBarsEqual = (bars: SourceFiveBars): boolean =>
  BAR_ORDER.every((k) => bars[k] === bars.excellent);

/** Validate ONE metric. Pushes issues; returns the would-write row (or null if a
 *  hard failure makes the row meaningless, e.g. unmapped label). */
function validateMetric(
  industry: IndustryType,
  pillar: "foundation" | "momentum",
  m: SourceMetric,
  opts: Required<Pick<LoadOptions, "baseVersion" | "inForceFrom" | "derivationLayer">>,
  specVersionFramework: string,
  barPath: string,
  issues: ValidationIssue[],
  mapping: MappingEntry[],
): WouldWriteRow | null {
  // 1. LABEL → KEY (the transcription guard). Unmapped ⇒ hard fail, named.
  const res = resolveMetricKey(industry, pillar, m.metricLabel);
  mapping.push({
    pillar, rawLabel: m.metricLabel, normalized: res.normalized,
    key: res.key, unit: m.unit, direction: m.direction,
  });
  if (!res.ok || res.key === null) {
    issues.push({ metricKey: res.key, rawLabel: m.metricLabel, kind: "unmapped_label", detail: res.reason ?? "unmapped" });
    return null;
  }
  const key = res.key;
  const cm = canonicalMetric(key)!;

  // 2. DIRECTION valid enum (§4).
  if (m.direction !== "higher_better" && m.direction !== "lower_better") {
    issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "bad_direction", detail: `direction "${m.direction}" not in {higher_better, lower_better}` });
  }
  // 2b. direction vs registry (transcription cross-check — informational unless wrong).
  const expDir = expectedDirection(key);
  if (expDir && m.direction !== expDir) {
    issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "direction_mismatch_vs_registry", detail: `JSON direction "${m.direction}" ≠ engine "${expDir}" for ${key}` });
  }

  // 3. UNIT known (§4) + matches the engine registry (the §8 silent-corruption catch).
  if (!isKnownJsonUnit(m.unit)) {
    issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "unknown_unit", detail: `unit "${m.unit}" not a known JSON unit` });
  } else {
    const eng = toEngineUnit(m.unit)!;
    const exp = expectedUnit(key);
    if (eng !== exp) {
      issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "unit_mismatch_vs_registry", detail: `bars unit "${m.unit}"→"${eng}" ≠ engine unit "${exp}" for ${key} (would silently corrupt L1 — handoff §8)` });
    }
  }
  const engineUnit = toEngineUnit(m.unit) ?? cm.unit;

  // 4. ALL FIVE BARS present + numeric (§4; sscu's 3-anchor exception is separate).
  for (const k of BAR_ORDER) {
    const v = m.bars?.[k];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "missing_bar", detail: `bar "${k}" missing or non-numeric (${String(v)})` });
    }
  }

  // 5. MONOTONICITY respecting collapsed bands (§4). Strict inversion ⇒ FAIL, named.
  for (let i = 0; i < BAR_ORDER.length - 1; i++) {
    const a = m.bars[BAR_ORDER[i]];
    const b = m.bars[BAR_ORDER[i + 1]];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const strictViolation =
      m.direction === "higher_better" ? a < b : a > b; // equality allowed
    if (strictViolation) {
      issues.push({
        metricKey: key, rawLabel: m.metricLabel, kind: "monotonicity",
        detail: `${BAR_ORDER[i]}=${a} vs ${BAR_ORDER[i + 1]}=${b} out of order for ${m.direction} (${key})`,
      });
    }
  }

  // 6. WEIGHT null or a sane percent (§4).
  if (m.intraPillarWeight !== null && m.intraPillarWeight !== undefined) {
    const w = m.intraPillarWeight;
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || w > 100) {
      issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "bad_weight", detail: `intraPillarWeight ${w} not null and not a sane percent (0,100]` });
    }
  }

  // 7. SSCU 3-anchor override (optional; only distress/good/excellent populated).
  let sscu: SscuOverride | null = null;
  if (m.sscuBars) {
    const s = m.sscuBars;
    const okShape =
      typeof s.distress === "number" && typeof s.good === "number" && typeof s.excellent === "number" &&
      s.acceptable === null && s.concerning === null;
    if (!okShape) {
      issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "bad_sscu", detail: `sscuBars must be 3-anchor (distress/good/excellent numeric; acceptable/concerning null)` });
    } else {
      // 3-anchor monotonicity (respecting collapse): higher_better D≤G≤E; lower_better D≥G≥E.
      const ok3 = m.direction === "higher_better"
        ? s.distress <= s.good && s.good <= s.excellent
        : s.distress >= s.good && s.good >= s.excellent;
      if (!ok3) {
        issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "bad_sscu", detail: `sscu anchors D=${s.distress} G=${s.good} E=${s.excellent} out of order for ${m.direction}` });
      }
      if (!m.sscuScope || m.sscuScope.length === 0) {
        issues.push({ metricKey: key, rawLabel: m.metricLabel, kind: "bad_sscu", detail: `sscuBars present but sscuScope is empty` });
      }
      sscu = { bars: { distress: s.distress, good: s.good, excellent: s.excellent }, scope: m.sscuScope ?? [] };
    }
  }

  return {
    barPath, metricKey: key, rawLabel: m.metricLabel, specMetricKeySource: m.specMetricKey,
    direction: m.direction, unit: engineUnit, bars: { ...m.bars },
    intraPillarWeight: m.intraPillarWeight ?? null, sscu,
    collapsedPairs: collapsedPairCount(m.bars),
    version: opts.baseVersion, inForceFrom: opts.inForceFrom,
    specVersionFramework, derivationLayer: opts.derivationLayer,
    inheritsFromPeerGroupId: null,
  };
}

/** Byte-identical comparison of two metrics' 5 bars (handoff §3 sanity check). */
function barsByteIdentical(a: SourceMetric, b: SourceMetric): boolean {
  return BAR_ORDER.every((k) => a.bars[k] === b.bars[k]) && a.direction === b.direction;
}

/** PG5↔PG6 byte-identical check: every PG6 metric's bars must equal PG5's same
 *  metric (matched by resolved engine key), so inheriting (not copying) is safe. */
function checkInheritance(
  parent: SourcePeerGroup | undefined,
  child: SourcePeerGroup,
): Pg5Pg6Check {
  if (!parent) {
    return { applicable: true, parentPgId: child.inheritsBarsFrom, childPgId: child.pgId, byteIdentical: false, detail: `parent ${child.inheritsBarsFrom} not found` };
  }
  const keyOf = (pg: SourcePeerGroup, m: SourceMetric, pillar: "foundation" | "momentum") =>
    resolveMetricKey(pg.industryType, pillar, m.metricLabel).key;
  const index = new Map<string, SourceMetric>();
  for (const m of parent.foundationMetrics) { const k = keyOf(parent, m, "foundation"); if (k) index.set("F:" + k, m); }
  for (const m of parent.momentumMetrics) { const k = keyOf(parent, m, "momentum"); if (k) index.set("M:" + k, m); }

  const mismatches: string[] = [];
  let compared = 0;
  const cmp = (m: SourceMetric, pillar: "foundation" | "momentum", tag: string) => {
    const k = keyOf(child, m, pillar);
    const p = k ? index.get(tag + ":" + k) : undefined;
    if (!p) { mismatches.push(`${child.pgId} ${k ?? m.metricLabel}: no matching parent metric`); return; }
    compared++;
    if (!barsByteIdentical(m, p)) mismatches.push(`${k}: child≠parent bars`);
  };
  for (const m of child.foundationMetrics) cmp(m, "foundation", "F");
  for (const m of child.momentumMetrics) cmp(m, "momentum", "M");

  const byteIdentical = mismatches.length === 0 && compared > 0;
  return {
    applicable: true, parentPgId: parent.pgId, childPgId: child.pgId, byteIdentical,
    detail: byteIdentical
      ? `all ${compared} ${child.pgId} metrics byte-identical to ${parent.pgId} → inherit bar-set (no duplicate rows)`
      : `MISMATCH: ${mismatches.join("; ")}`,
  };
}

/** Load + validate a parsed source document. PURE — no DB, commits nothing. */
export function loadVytalBars(doc: SourceDocument, options: LoadOptions = {}): LoadReport {
  const opts = {
    baseVersion: options.baseVersion ?? 1,
    inForceFrom: options.inForceFrom ?? doc.extractionDate,
    derivationLayer: options.derivationLayer ?? ("layer_c" as const),
  };
  const mode = options.mode ?? "validate_only";

  // top-level shape
  const failureSummary: string[] = [];
  if (!doc || !Array.isArray(doc.peerGroups)) {
    return {
      sourcePath: options.sourcePath ?? "(in-memory)", specVersionFramework: doc?.specVersionFramework ?? "?",
      extractionDate: doc?.extractionDate ?? "?", mode, perPg: [], pg5pg6: { applicable: false, parentPgId: null, childPgId: null, byteIdentical: false, detail: "n/a" },
      wouldWrite: [], totalMetrics: 0, totalMapped: 0, totalWouldWriteRows: 0, pass: false,
      failureSummary: ["source document missing peerGroups[]"],
    };
  }

  const byId = new Map(doc.peerGroups.map((pg) => [pg.pgId, pg]));
  const perPg: PerPgReport[] = [];
  const wouldWrite: WouldWriteRow[] = [];
  let pg5pg6: Pg5Pg6Check = { applicable: false, parentPgId: null, childPgId: null, byteIdentical: false, detail: "no inheriting PG present" };

  let totalMetrics = 0, totalMapped = 0;

  for (const pg of doc.peerGroups) {
    const issues: ValidationIssue[] = [];
    const mapping: MappingEntry[] = [];
    const rows: WouldWriteRow[] = [];
    let collapses = 0, degenerate = 0, sscuCount = 0, mapped = 0, seen = 0;

    const handleMetric = (m: SourceMetric, pillar: "foundation" | "momentum") => {
      seen++;
      const row = validateMetric(pg.industryType, pillar, m, opts, doc.specVersionFramework, pg.pgId, issues, mapping);
      if (row) {
        mapped++;
        if (row.collapsedPairs > 0) collapses++;
        if (allBarsEqual(m.bars)) degenerate++;
        if (row.sscu) sscuCount++;
        rows.push(row);
      }
    };
    for (const m of pg.foundationMetrics) handleMetric(m, "foundation");
    for (const m of pg.momentumMetrics) handleMetric(m, "momentum");

    totalMetrics += seen;
    totalMapped += mapped;

    // INHERITANCE (§3): an inheriting PG (PG6) produces ZERO own rows; it points at the parent.
    const inherits = pg.inheritsBarsFrom;
    let wouldWriteCount: number;
    if (inherits) {
      const chk = checkInheritance(byId.get(inherits), pg);
      pg5pg6 = chk;
      if (!chk.byteIdentical) {
        issues.push({ metricKey: null, rawLabel: pg.pgId, kind: "monotonicity", detail: `inheritance refused: ${chk.detail}` });
      }
      // mark (don't emit) — the bar-set is referenced, not copied.
      for (const r of rows) r.inheritsFromPeerGroupId = inherits;
      wouldWriteCount = 0; // inherits → no own bar-set rows written
    } else {
      wouldWrite.push(...rows);
      wouldWriteCount = rows.length;
    }

    const pass = issues.length === 0;
    perPg.push({
      pgId: pg.pgId, pgName: pg.pgName, industry: pg.industryType, inheritsBarsFrom: inherits,
      metricsSeen: seen, metricsMapped: mapped, collapsesDetected: collapses, degenerateAllEqual: degenerate,
      sscuMetrics: sscuCount, mapping, issues, wouldWriteRowCount: wouldWriteCount, pass,
    });
    if (!pass) failureSummary.push(`${pg.pgId}: ${issues.length} issue(s) — ${issues.map((i) => i.kind).join(", ")}`);
  }

  const pass = perPg.every((p) => p.pass);
  return {
    sourcePath: options.sourcePath ?? "(in-memory)",
    specVersionFramework: doc.specVersionFramework, extractionDate: doc.extractionDate,
    mode, perPg, pg5pg6, wouldWrite,
    totalMetrics, totalMapped, totalWouldWriteRows: wouldWrite.length, pass, failureSummary,
  };
}
