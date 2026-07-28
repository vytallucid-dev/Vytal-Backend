// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE DISCUSS CONTEXT — the server's copy of the frontend contract (components/discuss/discuss-context.ts).
//
// A card hands the server structured context, NEVER prompt text: `surface` + `subject` are the server's
// to compose the opening from; `label` is the card's own affordance text (not prompt material); `detail`
// is loose seed material. The zod schema is the trust boundary — this is POSTed by a client, so it is
// validated here before anything reaches the opening composer. There is deliberately no `prompt` field.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { z } from "zod";

export const DISCUSS_SUBJECT_KINDS = ["stock", "portfolio", "comparison", "finding"] as const;
export type DiscussSubjectKind = (typeof DISCUSS_SUBJECT_KINDS)[number];

export const DiscussSubjectSchema = z.object({
  kind: z.enum(DISCUSS_SUBJECT_KINDS),
  /** Ticker when the subject is a single stock (or the stock a finding hangs off). */
  symbol: z.string().trim().min(1).max(40).optional(),
  /** A human name for the header + grounding — a company name, "Your portfolio", a finding's title. */
  name: z.string().trim().min(1).max(200).optional(),
  /** For a comparison: the tickers in play. */
  symbols: z.array(z.string().trim().min(1).max(40)).min(1).max(8).optional(),
});

export const DiscussContextSchema = z.object({
  /** WHICH card/section raised this — stable, snake_case, server-owned (e.g. "stock_health"). */
  surface: z.string().trim().min(1).max(80),
  subject: DiscussSubjectSchema,
  /** The button's own text — travels with the context but the server needn't use it to phrase the opening. */
  label: z.string().trim().min(1).max(200),
  /** Section-specific seed material (the numbers/text the user was looking at). Loose by design. */
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type DiscussSubject = z.infer<typeof DiscussSubjectSchema>;
export type DiscussContext = z.infer<typeof DiscussContextSchema>;
