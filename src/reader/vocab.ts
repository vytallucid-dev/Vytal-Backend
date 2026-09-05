// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VYTAL'S OWN VOCABULARY — the closed list of terms a reader can be shown to not know. Stage 8.
//
// ★ EXTRACTED FROM `chat/profile.ts` (§8.2). It is reference data about OUR words, not about a chat
//   turn: the reader-profile read (`glossaryGaps`) is bounded by it, and that read outlives the chat
//   layer. The allowlist is the reason `glossaryGaps` can be a JSON column and still not hold prose.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const VYTAL_VOCAB_KEYS = [
  "band", "pillar", "foundation", "momentum", "market", "ownership",
  "health_score", "coverage", "provisional", "lens", "field_verdict",
  "finding", "red_flag", "pattern", "trajectory", "divergence",
  "peer_group", "construction", "health_read", "pledging",
] as const;
export type VytalVocabKey = (typeof VYTAL_VOCAB_KEYS)[number];
