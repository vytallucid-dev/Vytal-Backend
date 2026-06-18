// File: src/scoring/bars-loader/source.ts
//
// Single source of truth for the CANONICAL Vytal bars file. The spec bars now
// live in docs/vytal_pg_bars_REDERIVE_FINAL.json (supersedes vytal_pg_bars_FINAL.json:
// 8 PGs carry re-derived bars aligned model-wide to the canonical metric formulas —
// Asset Turnover (Sales/Total Assets), ROCE/IC (EBIT post-dep), FCF/PAT (capex-proxy
// mean-of-ratios). Every loader/engine/harness path resolves through here so there
// is ONE place to repoint. Resolved relative to THIS module's URL, so it is correct
// regardless of which directory the importing script lives in.

import { fileURLToPath } from "node:url";

/** Absolute path to the canonical Vytal per-PG bars JSON (framework v5.5.1). */
export const VYTAL_BARS_PATH = fileURLToPath(
  new URL("../../../docs/vytal_pg_bars_REDERIVE_FINAL.json", import.meta.url),
);

/** Just the filename (for provenance/printouts). */
export const VYTAL_BARS_FILENAME = "vytal_pg_bars_REDERIVE_FINAL.json";
