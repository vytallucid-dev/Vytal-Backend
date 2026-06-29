// File: src/scoring/lens-patterns/index.ts
//
// Public surface of the Three-Lens Pattern Library engine layer. Every consuming
// surface (Stock Health, PG-Fundamentals, Comparison, Hub) imports from here and
// reads the SAME pure functions over the metric atom (§5.1 compute-once).

export * from "./types.js";
export * from "./catalog.js";
export * from "./lens-states.js";
export * from "./lens-pattern.js";
export * from "./no-forward-guard.js";
