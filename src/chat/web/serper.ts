// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERPER — the live web-news fetch, and the two-key failover in front of it.
//
// ONE JOB: turn a query into news items, or into an honest failure. It knows nothing about stocks, the
// universe, the entity guard, or the chat layer — getStockNews composes those on top. Nothing here
// touches `src/ai`: the provider never learns that a tool went to the web.
//
// ── WHY /news AND NOT /search ─────────────────────────────────────────────────────────────────────
// Serper's news endpoint consumes GOOGLE'S SEARCH INDEX, which is why it reaches Moneycontrol / ET /
// CNBC-TV18 (measured 88% on-topic) where an LLM-facing search API returned 38%. The parameters below
// are measured, not taste — see PARAMS.
//
// ── THE FAILOVER, AND THE ONE THING THE SPEC GOT WRONG ABOUT IT ───────────────────────────────────
// ⚠ THE `credits` FIELD IN A /news RESPONSE IS THE COST OF THAT CALL (measured: 1), NOT THE REMAINING
// BALANCE. Watching it for "credits running low" would watch a number that is 1 forever and never fail
// over until a hard error. The remaining balance lives somewhere else entirely:
//
//     GET https://google.serper.dev/account  →  {"balance":2481,"rateLimit":5}   ← and it is FREE
//
// Measured: two consecutive /account reads left the balance unchanged, and a /news call between them
// also left it unchanged (the balance is eventually consistent, so it LAGS). That gives the proactive
// half of the failover an honest basis, and the lag is why a LOCAL counter is subtracted from the last
// probe rather than trusting the probe alone:
//
//     remaining ≈ last probed balance − credits this process has spent on that key since the probe
//
// Both halves, as specified:
//   · PROACTIVE — a key whose estimated remaining sits at or below LOW_CREDITS is demoted BEHIND the
//     other key. Demoted, not removed: if it is the only key configured, it keeps serving until it
//     actually fails. Losing news because we predicted exhaustion would be a self-inflicted outage.
//   · REACTIVE — 401/402/403 retires the key for the life of the process; 429 benches it for 60s.
//     ⚠ WHICH STATUS AN EXHAUSTED KEY RETURNS IS NOT VERIFIED LIVE — draining 2,481 credits to find out
//     is not a test worth running. A bogus key returns 403 {"message":"Unauthorized."} (measured), so
//     the whole auth/quota family is treated as retiring, and whichever code exhaustion actually uses
//     is covered by construction.
//
// Both keys gone ⇒ `{ ok:false }` with an honest message. The tool turns that into a fail-soft tool
// result, so news being unavailable never takes the turn down with it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One news result, exactly as Serper returns it. `date` is RELATIVE ("2 days ago") and stays that way. */
export interface SerperNewsItem {
  title: string;
  link: string;
  snippet: string;
  /** ⚠ RELATIVE, ALWAYS ("9 hours ago", "2 days ago"). Never converted to a calendar date — see the tool. */
  date: string;
  source: string;
}

export type KeySlot = "primary" | "secondary";

export type SerperNewsOutcome =
  | { ok: true; items: SerperNewsItem[]; slot: KeySlot; creditsSpent: number; remaining: number | null; failedOver: boolean }
  | { ok: false; error: string };

// ── PARAMETERS — measured, not preference. ────────────────────────────────────────────────────────
// gl/hl pin the result set to India/English. num=10 is one credit's worth.
//
// ★ tbs=qdr:d IS THE LOAD-BEARING ONE. qdr:d returns items from the last 1–24h; qdr:w re-ranks by
// RELEVANCE over recency and buries fresh items under week-old ones, which is the same failure our own
// Google News RSS ingest had before it got a `when:` operator. Default d; w only on explicit request.
const ENDPOINT = "https://google.serper.dev/news";
const ACCOUNT_ENDPOINT = "https://google.serper.dev/account";
export const NEWS_NUM = 10;
const TIMEOUT_MS = 9_000;

/** Estimated-remaining at or below this demotes a key behind its sibling. Small: a handful of turns. */
export const LOW_CREDITS = 25;
/** How long a free /account probe is trusted before being refreshed. */
const BALANCE_TTL_MS = 10 * 60 * 1000;
/** How long a 429 benches a key. */
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;

interface KeyRuntime {
  slot: KeySlot;
  envName: string;
  balance: number | null;
  balanceAt: number | null;
  spentSinceProbe: number;
  spentTotal: number;
  callsServed: number;
  /** epoch ms until which this key is benched; Number.MAX_SAFE_INTEGER ⇒ retired for the process. */
  benchedUntil: number;
  benchReason: string | null;
}

const RUNTIME: Record<KeySlot, KeyRuntime> = {
  primary: { slot: "primary", envName: "SERPER_API_KEY", balance: null, balanceAt: null, spentSinceProbe: 0, spentTotal: 0, callsServed: 0, benchedUntil: 0, benchReason: null },
  secondary: { slot: "secondary", envName: "SERPER_API_KEY_2", balance: null, balanceAt: null, spentSinceProbe: 0, spentTotal: 0, callsServed: 0, benchedUntil: 0, benchReason: null },
};

/** ★ READ LAZILY, ALWAYS. Same doctrine as the AI adapter: an absent key fails closed when the feature is
 *  actually used, never at boot, and a config change needs no restart of anything holding a cached value. */
const readKey = (rt: KeyRuntime): string => (process.env[rt.envName] ?? "").trim();

const isBenched = (rt: KeyRuntime): boolean => Date.now() < rt.benchedUntil;

/** Estimated remaining credits, or null when we have never had a balance for this key. */
const estimateRemaining = (rt: KeyRuntime): number | null => (rt.balance === null ? null : rt.balance - rt.spentSinceProbe);

/** Probe the FREE /account endpoint if we have no balance or the last one has aged out. Never throws:
 *  a failed probe simply leaves us without a proactive signal, and the reactive half still works. */
async function refreshBalance(rt: KeyRuntime, key: string): Promise<void> {
  const fresh = rt.balanceAt !== null && Date.now() - rt.balanceAt < BALANCE_TTL_MS;
  if (fresh) return;
  try {
    const res = await fetch(ACCOUNT_ENDPOINT, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return;
    const body = (await res.json()) as { balance?: unknown };
    if (typeof body.balance === "number" && Number.isFinite(body.balance)) {
      rt.balance = body.balance;
      rt.balanceAt = Date.now();
      rt.spentSinceProbe = 0;
    }
  } catch {
    /* no proactive signal this time — the reactive path still covers us */
  }
}

type CallOutcome =
  | { kind: "ok"; items: SerperNewsItem[]; credits: number }
  | { kind: "retire"; detail: string }
  | { kind: "bench"; detail: string }
  | { kind: "transient"; detail: string }
  | { kind: "fatal"; detail: string };

function parseItems(body: unknown): SerperNewsItem[] {
  const news = (body as { news?: unknown })?.news;
  if (!Array.isArray(news)) return [];
  return news
    .map((n) => {
      const o = (n ?? {}) as Record<string, unknown>;
      return {
        title: typeof o.title === "string" ? o.title.trim() : "",
        link: typeof o.link === "string" ? o.link.trim() : "",
        snippet: typeof o.snippet === "string" ? o.snippet.trim() : "",
        date: typeof o.date === "string" ? o.date.trim() : "",
        source: typeof o.source === "string" ? o.source.trim() : "",
      };
    })
    .filter((i) => i.title && i.link);
}

async function callNews(key: string, query: string, tbs: string): Promise<CallOutcome> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", tbs, num: NEWS_NUM }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { kind: "transient", detail: `network/timeout: ${(e as Error).message}` };
  }

  if (res.ok) {
    try {
      const body = (await res.json()) as { credits?: unknown };
      const credits = typeof body.credits === "number" && Number.isFinite(body.credits) ? body.credits : 1;
      return { kind: "ok", items: parseItems(body), credits };
    } catch (e) {
      return { kind: "transient", detail: `unreadable body: ${(e as Error).message}` };
    }
  }

  const text = await res.text().catch(() => "");
  const detail = `HTTP ${res.status} ${text.slice(0, 160)}`.trim();
  if (res.status === 401 || res.status === 402 || res.status === 403) return { kind: "retire", detail };
  if (res.status === 429) return { kind: "bench", detail };
  if (res.status >= 500) return { kind: "transient", detail };
  // 400 and friends are OUR request being wrong — the sibling key would fail identically, so stop.
  return { kind: "fatal", detail };
}

/**
 * Fetch news for a query. Tries the healthiest configured key first, fails over on the way down, and
 * NEVER throws. `days` maps to the recency window: 1 ⇒ qdr:d (the default), anything larger ⇒ qdr:w.
 */
export async function serperNews(query: string, days = 1): Promise<SerperNewsOutcome> {
  const tbs = days > 1 ? "qdr:w" : "qdr:d";

  // Build the try-order: configured, not benched, healthy-first. A LOW key is demoted, never dropped —
  // if it is the only one we have, it serves until it actually fails.
  const configured = (["primary", "secondary"] as KeySlot[])
    .map((slot) => ({ rt: RUNTIME[slot], key: readKey(RUNTIME[slot]) }))
    .filter((c) => c.key !== "");
  if (!configured.length) {
    return { ok: false, error: "No Serper API key is configured (SERPER_API_KEY / SERPER_API_KEY_2), so live web news cannot be fetched." };
  }
  const live = configured.filter((c) => !isBenched(c.rt));
  if (!live.length) {
    const why = configured.map((c) => `${c.rt.slot}: ${c.rt.benchReason ?? "benched"}`).join(" · ");
    console.warn(`[chat/web] serper — ALL KEYS UNAVAILABLE (${why})`);
    return { ok: false, error: `Live web news is temporarily unavailable — every configured search key is out of service (${why}).` };
  }

  // Proactive demotion needs a balance; probe the free endpoint only when one is stale or missing.
  await Promise.all(live.map((c) => refreshBalance(c.rt, c.key)));
  const order = [...live].sort((a, b) => {
    const lowA = (estimateRemaining(a.rt) ?? Infinity) <= LOW_CREDITS ? 1 : 0;
    const lowB = (estimateRemaining(b.rt) ?? Infinity) <= LOW_CREDITS ? 1 : 0;
    return lowA - lowB;
  });
  if (order.length > 1 && order[0].rt.slot !== live[0].rt.slot) {
    console.warn(
      `[chat/web] serper PROACTIVE FAILOVER — ${live[0].rt.slot} is at ~${estimateRemaining(live[0].rt)} credits ` +
        `(threshold ${LOW_CREDITS}); trying ${order[0].rt.slot} first`,
    );
  }

  let failedOver = false;
  const notes: string[] = [];
  for (const { rt, key } of order) {
    const outcome = await callNews(key, query, tbs);
    if (outcome.kind === "ok") {
      rt.callsServed++;
      rt.spentTotal += outcome.credits;
      rt.spentSinceProbe += outcome.credits;
      const remaining = estimateRemaining(rt);
      console.info(
        `[chat/web] serper news served by ${rt.slot} — credits ${outcome.credits} (process total ${rt.spentTotal}), ` +
          `remaining ≈ ${remaining ?? "unknown"}, items ${outcome.items.length}, tbs ${tbs}${failedOver ? " [AFTER FAILOVER]" : ""}`,
      );
      return { ok: true, items: outcome.items, slot: rt.slot, creditsSpent: outcome.credits, remaining, failedOver };
    }
    if (outcome.kind === "fatal") {
      console.error(`[chat/web] serper request rejected on ${rt.slot} — ${outcome.detail} (not a key problem; not failing over)`);
      return { ok: false, error: `The web news search was rejected (${outcome.detail}).` };
    }
    if (outcome.kind === "retire") {
      rt.benchedUntil = Number.MAX_SAFE_INTEGER;
      rt.benchReason = `retired: ${outcome.detail}`;
      console.error(`[chat/web] serper REACTIVE FAILOVER — ${rt.slot} retired for this process (${outcome.detail})`);
    } else if (outcome.kind === "bench") {
      rt.benchedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      rt.benchReason = `rate-limited: ${outcome.detail}`;
      console.warn(`[chat/web] serper REACTIVE FAILOVER — ${rt.slot} benched ${RATE_LIMIT_COOLDOWN_MS / 1000}s (${outcome.detail})`);
    } else {
      console.warn(`[chat/web] serper transient failure on ${rt.slot} — ${outcome.detail}`);
    }
    notes.push(`${rt.slot}: ${outcome.detail}`);
    failedOver = true;
  }

  console.error(`[chat/web] serper — every key failed this call (${notes.join(" · ")})`);
  return {
    ok: false,
    error: `Live web news is temporarily unavailable — the search service did not answer on any configured key (${notes.join(" · ")}).`,
  };
}

// ── OBSERVABILITY / TEST SEAMS ────────────────────────────────────────────────────────────────────
/** A snapshot of every key's runtime state — for the verify harness and for operational logging. */
export function serperKeyReport(): {
  slot: KeySlot; configured: boolean; benched: boolean; benchReason: string | null;
  balance: number | null; remaining: number | null; spentTotal: number; callsServed: number;
}[] {
  return (["primary", "secondary"] as KeySlot[]).map((slot) => {
    const rt = RUNTIME[slot];
    return {
      slot,
      configured: readKey(rt) !== "",
      benched: isBenched(rt),
      benchReason: rt.benchReason,
      balance: rt.balance,
      remaining: estimateRemaining(rt),
      spentTotal: rt.spentTotal,
      callsServed: rt.callsServed,
    };
  });
}

/** Reset all key runtime state. TEST ONLY — production never calls this (the process is the lifetime). */
export function __resetSerperState(): void {
  for (const slot of ["primary", "secondary"] as KeySlot[]) {
    Object.assign(RUNTIME[slot], { balance: null, balanceAt: null, spentSinceProbe: 0, spentTotal: 0, callsServed: 0, benchedUntil: 0, benchReason: null });
  }
}

/** Force a key's estimated balance. TEST ONLY — lets the proof exercise the PROACTIVE branch without
 *  draining a real account, which is the only other way to reach it. */
export function __setSerperBalanceForTests(slot: KeySlot, balance: number | null): void {
  RUNTIME[slot].balance = balance;
  RUNTIME[slot].balanceAt = balance === null ? null : Date.now();
  RUNTIME[slot].spentSinceProbe = 0;
}
