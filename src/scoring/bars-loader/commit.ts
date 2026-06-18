// File: src/scoring/bars-loader/commit.ts
//
// THE COMMITTED WRITE PATH (handoff §1 — "the actual committed load is the next
// deliberate step after we verify the mapping"). This is NOT run in the dry
// build. It is provided so the write discipline is reviewable now:
//
//   • APPEND-ONLY / VERSIONED: for each (barPath, metricKey) the new row's
//     version = max(existing) + 1 (a reload writes a NEW version, never an
//     overwrite — same discipline as the rest of the scoring layer).
//   • PROVENANCE: ONE BarProvenance row per load, referencing the source JSON
//     file + extractionDate. The unit / sscu / intra-pillar weight / untrusted
//     source key ride in provenance.evidence.perMetric (the hot 5-threshold
//     MetricBarSet table is locked to 5 columns — schema-design §3 — so these
//     additive facts are carried cold and surfaced by loadBarSet).
//   • INHERITANCE (§3): an inheriting PG (PG6) gets NO rows; it references the
//     parent's bar-set. (We assert byte-identical bars before allowing it.)
//   • SPEC VERSION: the v5.5.1 framework string is resolved to (or created as) a
//     ScoringSpecVersion row → specVersionId.
//
// Guarded: throws unless the report PASSED validation and `confirm:true` is
// passed, so it can never run by accident.

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { LoadReport, WouldWriteRow } from "./types.js";

export interface CommitOptions {
  confirm: boolean; // must be explicitly true
  sourceFile: string; // path recorded in provenance
}

/** Resolve (or create) the ScoringSpecVersion row for the framework string. */
async function resolveSpecVersionId(framework: string): Promise<string> {
  const existing = await prisma.scoringSpecVersion.findFirst({ where: { version: framework } });
  if (existing) return existing.id;
  const created = await prisma.scoringSpecVersion.create({
    data: { version: framework, effectiveFrom: new Date(), notes: `auto-created by bars-loader for ${framework}` },
  });
  return created.id;
}

/** Next append-only version for (barPath, metricKey). */
async function nextVersion(barPath: string, metricKey: string): Promise<number> {
  const top = await prisma.metricBarSet.findFirst({
    where: { barPath, metricKey }, orderBy: { version: "desc" }, select: { version: true },
  });
  return (top?.version ?? 0) + 1;
}

/**
 * Commit a PASSED load report. Append-only. Returns the count of bar-set rows and
 * the provenance id. Refuses to run unless the report passed and confirm:true.
 */
export async function commitLoad(report: LoadReport, opts: CommitOptions): Promise<{ rowsWritten: number; provenanceId: string }> {
  if (!opts.confirm) throw new Error("commitLoad: refusing to write without confirm:true");
  if (!report.pass) throw new Error("commitLoad: report did NOT pass validation — fix the named issues first");

  const specVersionId = await resolveSpecVersionId(report.specVersionFramework);

  // Build the cold evidence blob (unit / sscu / weight / untrusted source key).
  const perMetric: Record<string, unknown> = {};
  for (const r of report.wouldWrite) {
    perMetric[`${r.barPath}|${r.metricKey}`] = {
      unit: r.unit, intraPillarWeight: r.intraPillarWeight, sscu: r.sscu,
      sourceSpecKey: r.specMetricKeySource, rawLabel: r.rawLabel,
    };
  }
  const provenance = await prisma.barProvenance.create({
    data: {
      derivationLayer: (report.wouldWrite[0]?.derivationLayer ?? "layer_c"),
      method: `vytal_pg_bars.json ingest (framework ${report.specVersionFramework})`,
      sampleWindow: report.extractionDate,
      // perMetric values are JSON-serialisable (string/number/null/sscu-object) and are
      // written straight to the JSONB `evidence` column; the cast asserts that to Prisma's
      // InputJson type (the stale client previously left these models untyped, masking it).
      evidence: { sourceFile: opts.sourceFile, extractionDate: report.extractionDate, specVersionFramework: report.specVersionFramework, perMetric } as Prisma.InputJsonObject,
      derivedAt: new Date(report.extractionDate),
    },
  });

  // Write rows (inheriting PGs already excluded from report.wouldWrite).
  let rowsWritten = 0;
  for (const r of report.wouldWrite as WouldWriteRow[]) {
    const version = await nextVersion(r.barPath, r.metricKey);
    await prisma.metricBarSet.create({
      data: {
        barPath: r.barPath, metricKey: r.metricKey, version, direction: r.direction,
        excellent: r.bars.excellent, good: r.bars.good, acceptable: r.bars.acceptable,
        concerning: r.bars.concerning, distress: r.bars.distress,
        inForceFrom: new Date(r.inForceFrom), specVersionId, provenanceId: provenance.id,
        derivationLayer: r.derivationLayer, inheritsFromPeerGroupId: r.inheritsFromPeerGroupId,
      },
    });
    rowsWritten++;
  }
  return { rowsWritten, provenanceId: provenance.id };
}
