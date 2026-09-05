// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ACTION · confirm-control | prefilled-form — the affordance that replaces propose→confirm→execute.
//
// ── ★ THE ONE RULE, AND EVERY FIELD BELOW EXISTS TO KEEP IT ───────────────────────────────────────
//                  **NO MODEL OUTPUT EVER REACHES A WRITE.**
//
// The model classifies an intent. Code resolves the subject, code picks the endpoint from a closed
// map, code renders the control. The reader's tap calls an ordinary authenticated endpoint that
// validates the body itself and derives the owner from the session — the same endpoint the app's own
// buttons call, with no privileged path and no knowledge that a model was involved.
//
// So a misclassification cannot write. Its worst case is a control the reader does not tap, sitting
// under an answer they did not ask for. That is the whole reason `ActionSlot` is allowed to exist:
// the blast radius of being wrong is a wasted rectangle.
//
// ── ★ WHY THE ENDPOINT IS IN THE PAYLOAD AND NOT A CLIENT-SIDE LOOKUP ─────────────────────────────
// A client that maps `action → URL` is a second home for the routing table, and the two drift. The
// server names the exact request it will accept. ⚠ AND THE CLIENT MUST STILL REFUSE ANYTHING OFF THE
// ALLOWLIST — `ACTION_ENDPOINTS` below is the closed set, and a payload naming anything else is a
// bug, not an instruction. The server never emits one; the client never trusts that it didn't.
//
// ── ★ WHY `prefilled-form` IS NOT AN OPTIMISATION ─────────────────────────────────────────────────
// "I bought 10 TCS at 3200 last Tuesday" carries a quantity, a price and a date. Every one is a
// model extraction, and a wrong one written on a single tap is a corrupted ledger the reader may not
// notice for months. Rendering them as FIELDS puts a human between the extraction and the database
// while keeping every keystroke the extraction saved. One tap is for actions where being wrong costs
// a second tap to undo.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { digest, line, withheld, type DigestLine, type Section } from "../contract.js";
import { NO_COVERAGE, type Coverage } from "../../resolve/contract.js";
import type { ActionSlot } from "../../router/contract.js";

/** One editable field of a `prefilled-form`. `value` is a SUGGESTION the reader may overwrite. */
export interface ActionField {
  readonly name: string;
  readonly label: string;
  /**
   * ★ `choice` ADDED AT T-1 (finding 5). The transaction form's TYPE was `text`, so the Operator
   *   typed `sdsds` into a field the endpoint validates as a closed enum. A field whose valid values
   *   are known must not be free text — the reader should not be able to compose a request the
   *   server is guaranteed to refuse.
   */
  readonly type: "text" | "number" | "date" | "choice";
  /** Extracted, and therefore possibly wrong. `null` renders an empty field rather than a guess. */
  readonly value: string | null;
  readonly required: boolean;
  /** Why this value is what it is — shown next to the field, so a wrong extraction is visible. */
  readonly note: string | null;
  /**
   * The closed option list, for `type: "choice"` only; `undefined` on every other type.
   *
   * ⚠ `value` IS THE WIRE VALUE AND MUST MATCH THE ENDPOINT'S OWN VOCABULARY EXACTLY. The 400 this
   *   field exists to prevent was partly a CASE mismatch: the control carried "BUY" and
   *   `transactions-service.ts#Base` declares `z.enum(["buy", …])`.
   */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

export interface ActionPayload {
  readonly action: ActionSlot;
  /** What the control says. From a constant below, never from the model. */
  readonly label: string;
  /** One line naming exactly what will change, so the tap is informed. */
  readonly summary: string;
  /** The subject this acts on, already resolved by code. */
  readonly subject: { readonly symbol: string; readonly name: string } | null;
  /** The request the tap makes. Path and method are constants; the body is code-built. */
  readonly endpoint: { readonly method: "POST" | "DELETE"; readonly path: string };
  readonly body: Readonly<Record<string, string | number>>;
  /** Present on `prefilled-form` only. Empty on `confirm-control` BY CONSTRUCTION. */
  readonly fields: readonly ActionField[];
  /** What the reader can undo, and how. Empty string when the action is not reversible in one step. */
  readonly reversal: string;
}

/**
 * ★ THE CLOSED ENDPOINT MAP. Every action a control can name, and nothing else can be named.
 *
 * All five already exist and are already used by the app's own UI — nothing here is a new write
 * surface, and none of them knows a model was involved. That is the point of using them: an endpoint
 * built for this path would be an endpoint whose only caller is this path, validated once, by us.
 */
export const ACTION_ENDPOINTS: Readonly<Record<ActionSlot, { method: "POST" | "DELETE"; path: string }>> = {
  watchlist_add: { method: "POST", path: "/api/v1/me/watchlist" },
  // `:stockId` is substituted by code from the RESOLVED subject — never from the question text.
  watchlist_remove: { method: "DELETE", path: "/api/v1/me/watchlist/:stockId" },
  transaction_record: { method: "POST", path: "/api/v1/me/transactions" },
  alert_create: { method: "POST", path: "/api/v1/me/alerts" },
  reminder_create: { method: "POST", path: "/api/v1/me/reminders" },
  memory_add: { method: "POST", path: "/api/v1/me/memories" },
  memory_forget: { method: "DELETE", path: "/api/v1/me/memories/:id" },
  alert_delete: { method: "DELETE", path: "/api/v1/me/alerts/:id" },
};

const LABEL: Record<ActionSlot, string> = {
  watchlist_add: "Add to watchlist",
  watchlist_remove: "Remove from watchlist",
  transaction_record: "Record this transaction",
  alert_create: "Create this alert",
  reminder_create: "Set this reminder",
  memory_add: "Remember this",
  memory_forget: "Forget this",
  alert_delete: "Delete this alert",
};

const REVERSAL: Record<ActionSlot, string> = {
  watchlist_add: "You can remove it again at any time.",
  watchlist_remove: "You can add it back at any time.",
  // ⚠ Deliberately not "you can delete it" — a deleted transaction re-runs the FIFO replay, so
  //   calling it a one-step undo would be a claim the ledger does not honour.
  transaction_record: "",
  alert_create: "You can delete it from your alerts at any time.",
  reminder_create: "You can delete it from your reminders at any time.",
  memory_add: "You can ask us to forget it at any time.",
  // ⚠ NOT REVERSIBLE. Once forgotten the text is gone from the row; saying "you can add it back"
  //   would promise a restore that does not exist.
  memory_forget: "",
  alert_delete: "",
};

export function actionSection(input: {
  readonly action: ActionSlot;
  /** The stock this acts on. `null` for the reader-scoped actions — a memory names no company. */
  readonly subject: { symbol: string; name: string; stockId?: string } | null;
  /** The row this acts on, for a DELETE. Resolved by code against the READER'S OWN list. */
  readonly targetId?: string | null;
  readonly summary: string;
  readonly body: Record<string, string | number>;
  readonly fields?: readonly ActionField[];
  readonly coverage?: Coverage;
}): Section<"ACTION", ActionPayload> {
  const fields = input.fields ?? [];
  const ep = ACTION_ENDPOINTS[input.action];
  // ★ EVERY PATH PARAMETER IS SUBSTITUTED FROM A CODE-RESOLVED ROW, NEVER FROM THE QUESTION TEXT.
  //   `:stockId` comes from the universe; `:id` from the reader's own memories or alerts. A model
  //   that emitted an id could name someone else's row; it never gets the chance to emit one.
  let path = ep.path;
  if (input.subject?.stockId) path = path.replace(":stockId", input.subject.stockId);
  if (input.targetId) path = path.replace(":id", input.targetId);

  const payload: ActionPayload = {
    action: input.action,
    label: LABEL[input.action],
    summary: input.summary,
    subject: input.subject ? { symbol: input.subject.symbol, name: input.subject.name } : null,
    endpoint: { method: ep.method, path },
    body: input.body,
    fields,
    reversal: REVERSAL[input.action],
  };

  // ★ THE DIGEST SAYS AN ACTION WAS OFFERED, AND NEVER THAT ONE HAPPENED. If this section is ever
  //   fed back to a model, the one thing it must not be able to conclude is that the change is done.
  const lines: DigestLine[] = [
    line("Offered", payload.label),
    input.subject ? line("On", `${input.subject.name} (${input.subject.symbol})`)
      : withheld("On", "no company was resolved for this request"),
    line("Status", "waiting for the reader to confirm — nothing has been changed"),
  ];
  for (const f of fields) {
    lines.push(f.value ? line(f.label, f.value) : withheld(f.label, "not stated — the reader fills this in"));
  }

  return {
    kind: "ACTION",
    renderer: fields.length ? "prefilled-form" : "confirm-control",
    payload,
    digest: digest("What you can do next", [{ label: "Action", lines }]),
    coverage: input.coverage ?? NO_COVERAGE,
    interactions: [],
  };
}
