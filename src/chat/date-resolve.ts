// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DATE RESOLUTION — turning what a reader SAID into a calendar date, server-side, deterministically.
//
// ── ★ WHY THIS EXISTS (the live finding that forced it) ────────────────────────────────────────────
// A language model does not reliably know today's date. Asked to record a trade made "last week", the
// real model produced 2025-02-26 — seventeen months off — and then, on a rerun of the same sentence,
// 2025-02-25. Different guesses, both confidently formatted as an exact date, both about to be written
// into the FIFO lot register that every cost basis and P&L figure is derived from.
//
// No description fixes that. The instruction "do not turn a vague phrase into a date" was already in
// `recordTransaction`'s description when the model did it twice. The root cause is arithmetic the model
// cannot do, so the fix is to stop asking it to: the arithmetic happens HERE, against the real clock,
// and the model's only job is to hand over the phrase.
//
// ── TWO OUTCOMES, AND THE REFUSAL IS THE IMPORTANT ONE ─────────────────────────────────────────────
//   RESOLVED — the phrase names ONE day. "yesterday", "20 July", "last Tuesday", "3 days ago".
//   REFUSED  — the phrase names a RANGE, and picking a day inside it would be a guess with a plausible
//              shape. "last week", "a few days back", "earlier this month", "sometime in March".
//
// A refusal is not a failure; it is the correct answer to an unanswerable question. But it must be a
// USABLE one — so refusals carry the BOUNDS wherever the phrase implies them. "Which date?" is a
// question a reader has to go and work out. "Last week was Mon 13 – Sun 19 July; which day?" is one
// they can answer from memory, immediately. That difference decides whether the guard feels like a
// safety net or an obstacle.
//
// ── TIMEZONE ──────────────────────────────────────────────────────────────────────────────────────
// Everything resolves against the reader's LOCAL day in India (Asia/Kolkata, UTC+5:30, no DST) — the
// same rule istDateOnly() applies to the score-history series. Between 00:00 and 05:30 IST the UTC date
// is still yesterday, so "today" computed in UTC would be off by one for every reader in the country
// during those hours. All arithmetic below is on plain YYYY-MM-DD strings anchored at UTC midnight,
// which keeps it pure calendar arithmetic with no DST or offset drift anywhere in the middle.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** IST is a fixed +5:30 offset; India observes no DST. Same constant as portfolio/phs/score-history.ts. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Today's calendar date in India, as YYYY-MM-DD. THE anchor for every relative phrase. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// ── pure calendar arithmetic on YYYY-MM-DD ─────────────────────────────────────────────────────────
const toDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const toIso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => toIso(new Date(toDate(iso).getTime() + n * 86_400_000));
/** 0 = Sunday … 6 = Saturday. */
const dayOfWeek = (iso: string): number => toDate(iso).getUTCDay();
const parts = (iso: string) => {
  const d = toDate(iso);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const mkIso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Is this a real calendar date (rejects 31 February, month 13, …)? */
const isRealDate = (y: number, m: number, d: number): boolean =>
  m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_RE = "(sun|mon|tues?|wednes|thurs?|fri|satur)(day)?";
const weekdayIndex = (w: string): number => {
  const s = w.toLowerCase();
  const i = WEEKDAY_NAMES.findIndex((n) => n.startsWith(s.replace(/day$/, "").replace(/s$/, "")));
  if (i >= 0) return i;
  // "tues"/"thurs"/"wednes" abbreviations
  if (s.startsWith("tue")) return 2;
  if (s.startsWith("wed")) return 3;
  if (s.startsWith("thu")) return 4;
  return -1;
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";
const MONTH_LABEL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Human date for a bound message: "Mon 13 July 2026". */
export function pretty(iso: string): string {
  const { y, m, d } = parts(iso);
  return `${WEEKDAY_NAMES[dayOfWeek(iso)].slice(0, 3).replace(/^./, (c) => c.toUpperCase())} ${d} ${MONTH_LABEL[m]} ${y}`;
}

/** How long ago a date is, in words. Shared with the proposal's trade-date field. */
export function howLongAgo(iso: string, today: string = istToday()): string {
  const days = Math.round((toDate(today).getTime() - toDate(iso).getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} in the FUTURE`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months ago`;
  return `${(days / 365.25).toFixed(1)} years ago`;
}

// ── the result ─────────────────────────────────────────────────────────────────────────────────────
export interface DateResolved {
  ok: true;
  /** YYYY-MM-DD, guaranteed to be a real calendar date and never in the future. */
  date: string;
  /** "6 days ago" — carried at resolution time so the annotation exists everywhere, not just in a proposal. */
  ago: string;
  /** Set when something was INFERRED (a missing year, a most-recent-past reading). The caller must surface it. */
  assumption?: string;
}
export interface DateRefused {
  ok: false;
  /** A sentence the model can act on: what is wrong, and — where the phrase implies bounds — which days it spans. */
  reason: string;
  /** The span the phrase covers, when it has one. Present ⇒ the caller can ask a bounded question. */
  bounds?: { from: string; to: string };
}
export type DateResolution = DateResolved | DateRefused;

const resolved = (date: string, today: string, assumption?: string): DateResolved => ({
  ok: true,
  date,
  ago: howLongAgo(date, today),
  ...(assumption ? { assumption } : {}),
});
const refused = (reason: string, bounds?: { from: string; to: string }): DateRefused => ({ ok: false, reason, ...(bounds ? { bounds } : {}) });

/** "Mon 13 July 2026 to Sun 19 July 2026" — the bound, spoken. */
export function boundsPhrase(b: { from: string; to: string }): string {
  return `${pretty(b.from)} to ${pretty(b.to)}`;
}

// ── normalisation ──────────────────────────────────────────────────────────────────────────────────
/** Lowercase, strip filler and ordinal suffixes, collapse whitespace. "on the 20th of July," → "20 of july". */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.,!?;]+$/g, "")
    // Internal commas are separators, not meaning: "July 20, 2026" and "20 July, 2026" are the same date.
    // (Dots are NOT stripped — they are a legal date separator in 20.07.2026.)
    .replace(/,/g, " ")
    .replace(/^(on|at|it was|that was|i think|around about)\s+/i, "")
    .replace(/^the\s+/i, "")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RANGE VOCABULARY — phrases that name a SPAN. Checked FIRST, because several of them start with
// the same words as a resolvable phrase ("last month" is a range; "last month on the 12th" is a day)
// and the specific reading must not be shadowed by the general one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function refuseIfRange(s: string, today: string): DateRefused | null {
  const { y, m, d } = parts(today);

  // "last week" / "this week" / "past week" — the phrase that started all of this.
  if (/^(last|this|past|current)\s+week$/.test(s)) {
    // ISO weeks start Monday. This week's Monday, then step back for "last".
    const mondayOffset = (dayOfWeek(today) + 6) % 7;
    const thisMonday = addDays(today, -mondayOffset);
    if (/^(this|current)\s+week$/.test(s)) {
      return refused(`"${s}" covers more than one day — this week so far runs from Monday to today.`, { from: thisMonday, to: today });
    }
    const lastMonday = addDays(thisMonday, -7);
    return refused(`"${s}" covers seven days, so no single date follows from it.`, { from: lastMonday, to: addDays(lastMonday, 6) });
  }
  // Indian English: "last to last week" = the week before last.
  if (/^last\s+to\s+last\s+week$/.test(s)) {
    const mondayOffset = (dayOfWeek(today) + 6) % 7;
    const monday = addDays(addDays(today, -mondayOffset), -14);
    return refused(`"${s}" covers seven days, so no single date follows from it.`, { from: monday, to: addDays(monday, 6) });
  }
  // "a few days ago" / "couple of days back" / "some days back" — approximate by construction.
  if (/^(a\s+)?(few|couple\s+of|some|several)\s+days?\s+(ago|back|earlier)$/.test(s)) {
    return refused(`"${s}" is approximate — it does not name a day.`, { from: addDays(today, -6), to: addDays(today, -2) });
  }
  if (/^(a\s+)?(few|couple\s+of|some|several)\s+(weeks?|months?)\s+(ago|back|earlier)$/.test(s)) {
    return refused(`"${s}" is approximate — it does not name a day.`);
  }
  if (/^last\s+few\s+(days|weeks|months)$/.test(s)) return refused(`"${s}" is a span, not a day.`);
  // Bare vagueness.
  if (/^(recently|lately|just now|a while (ago|back)|some\s?time (ago|back)|other day|a few days? back|back then|ages ago)$/.test(s)) {
    return refused(`"${s}" does not name a date at all.`);
  }
  // "earlier this month" / "earlier this week" / "earlier this year"
  if (/^earlier\s+(this|last)\s+(week|month|year)$/.test(s)) {
    if (/month/.test(s)) {
      const from = /last/.test(s) ? mkIso(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1) : mkIso(y, m, 1);
      const to = /last/.test(s) ? addDays(mkIso(y, m, 1), -1) : today;
      return refused(`"${s}" covers many days.`, { from, to });
    }
    return refused(`"${s}" covers many days.`);
  }
  // "early / mid / late / end of / start of <anything>" — a part of a period, not a day.
  if (/^(early|mid|middle of|late|end of|beginning of|start of|first half of|second half of)\b/.test(s)) {
    return refused(`"${s}" names part of a period, not a specific day.`);
  }
  // "around 20 July" / "about 20 July" — deliberately approximate, even though a date follows.
  if (/^(around|about|approx(imately)?|roughly|circa|near)\b/.test(s)) {
    return refused(`"${s}" is deliberately approximate — ask for the exact day rather than treating it as one.`);
  }
  // "this month" / "last month" (bare) — a whole month.
  if (/^(this|last|past|current)\s+month$/.test(s)) {
    const isLast = /^(last|past)/.test(s);
    const my = isLast && m === 1 ? y - 1 : y;
    const mm = isLast ? (m === 1 ? 12 : m - 1) : m;
    return refused(`"${s}" covers a whole month.`, { from: mkIso(my, mm, 1), to: isLast ? mkIso(my, mm, daysInMonth(my, mm)) : today });
  }
  if (/^(this|last|past|current)\s+year$/.test(s)) {
    const yy = /^(last|past)/.test(s) ? y - 1 : y;
    return refused(`"${s}" covers a whole year.`, { from: mkIso(yy, 1, 1), to: yy === y ? today : mkIso(yy, 12, 31) });
  }
  // "in March" / "sometime in March" / bare "March" — a whole month, year inferred as the most recent past one.
  const mMatch = s.match(new RegExp(`^(some\\s?time\\s+)?(in\\s+|during\\s+)?${MONTH_RE}(\\s+(\\d{4}))?$`));
  if (mMatch) {
    const mn = MONTHS[mMatch[3]];
    const yy = mMatch[5] ? Number(mMatch[5]) : mn <= m ? y : y - 1;
    const to = yy === y && mn === m ? today : mkIso(yy, mn, daysInMonth(yy, mn));
    return refused(`"${s}" names a month, not a day.`, { from: mkIso(yy, mn, 1), to });
  }
  // A bare year.
  if (/^(in\s+)?(19|20)\d{2}$/.test(s)) {
    const yy = Number(s.replace(/\D/g, ""));
    return refused(`"${s}" names a year, not a day.`, { from: mkIso(yy, 1, 1), to: yy === y ? today : mkIso(yy, 12, 31) });
  }
  // "since <x>" / "between <x> and <y>" / "<x> to <y>" — explicit spans.
  if (/^(since|from)\b/.test(s) || /\b(between|through|till|until)\b/.test(s) || /\s+to\s+\d/.test(s)) {
    return refused(`"${s}" describes a span of days, not one day.`);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESOLVABLE VOCABULARY.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function tryResolve(s: string, today: string): DateResolution | null {
  const { y, m, d } = parts(today);

  // ── plain relatives ──
  if (/^(today|now|just today)$/.test(s)) return resolved(today, today);
  if (/^(yesterday|yday)$/.test(s)) return resolved(addDays(today, -1), today);
  // Indian English: "day before yesterday" is everyday speech; "day before" alone is the same thing.
  if (/^(day before yesterday|days? before yesterday|day before)$/.test(s)) return resolved(addDays(today, -2), today);
  if (/^(a|one)\s+day\s+(ago|back|earlier)$/.test(s)) return resolved(addDays(today, -1), today);

  // "N days ago" / "N days back"
  let mm = s.match(/^(\d{1,4})\s+days?\s+(ago|back|earlier|prior)$/);
  if (mm) return resolved(addDays(today, -Number(mm[1])), today);

  // "a week ago" = exactly 7 days. "N weeks ago" = exactly 7N. Stated as an assumption because a reader
  // saying "a week ago" may well mean "roughly" — the caller surfaces it and the reader can correct it.
  mm = s.match(/^(a|one|\d{1,3})\s+weeks?\s+(ago|back|earlier|prior)$/);
  if (mm) {
    const n = /^(a|one)$/.test(mm[1]) ? 1 : Number(mm[1]);
    return resolved(addDays(today, -7 * n), today, `"${s}" was read as exactly ${7 * n} days before today.`);
  }
  // Indian English: a fortnight is 14 days.
  if (/^(a|one)?\s*fortnight\s+(ago|back|earlier)$/.test(s.trim())) {
    return resolved(addDays(today, -14), today, `"a fortnight ago" was read as exactly 14 days before today.`);
  }

  // "N months ago" — the same day-of-month, N months back (clamped to a real day).
  mm = s.match(/^(a|one|\d{1,3})\s+months?\s+(ago|back|earlier)$/);
  if (mm) {
    const n = /^(a|one)$/.test(mm[1]) ? 1 : Number(mm[1]);
    const totalMonths = (y * 12 + (m - 1)) - n;
    const ty = Math.floor(totalMonths / 12);
    const tm = (totalMonths % 12) + 1;
    const td = Math.min(d, daysInMonth(ty, tm));
    return resolved(mkIso(ty, tm, td), today, `"${s}" was read as the same day of the month, ${n} month${n === 1 ? "" : "s"} back.`);
  }

  // ── weekdays ──
  // "last Tuesday" / "this Tuesday" / "last to last Tuesday" / bare "Tuesday"
  mm = s.match(new RegExp(`^(last to last|last|this|past|previous)?\\s*${WEEKDAY_RE}$`));
  if (mm) {
    const qualifier = (mm[1] ?? "").trim();
    const target = weekdayIndex(mm[2] + (mm[3] ?? ""));
    if (target >= 0) {
      const todayDow = dayOfWeek(today);
      // Days back to the most recent occurrence STRICTLY before today (7 when today is that weekday).
      const backToPrevious = ((todayDow - target + 7) % 7) || 7;
      if (qualifier === "this") {
        // The occurrence inside the current Monday-start week.
        const mondayOffset = (todayDow + 6) % 7;
        const thisMonday = addDays(today, -mondayOffset);
        const idx = (target + 6) % 7; // Monday=0 … Sunday=6
        const candidate = addDays(thisMonday, idx);
        if (candidate > today) {
          return refused(`"${s}" has not happened yet — ${pretty(candidate)} is still ahead. A transaction cannot be dated in the future; ask which past day they mean.`);
        }
        return resolved(candidate, today);
      }
      if (qualifier === "last to last") return resolved(addDays(today, -(backToPrevious + 7)), today, `"${s}" was read as the ${WEEKDAY_NAMES[target]} before last.`);
      // "last Tuesday", "past Tuesday", or a bare "Tuesday" → the most recent one that has already happened.
      const date = addDays(today, -backToPrevious);
      return resolved(date, today, qualifier ? undefined : `"${s}" was read as the most recent ${WEEKDAY_NAMES[target]} that has already passed.`);
    }
  }

  // ── "last month on the 12th" / "12 of last month" ──
  mm = s.match(/^last month (on |on the )?(\d{1,2})$/) ?? s.match(/^(\d{1,2}) of last month$/);
  if (mm) {
    const day = Number(mm[2] ?? mm[1]);
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    if (!isRealDate(ly, lm, day)) return refused(`There is no ${day} in ${MONTH_LABEL[lm]} ${ly}.`);
    return resolved(mkIso(ly, lm, day), today);
  }
  // "this month on the 12th" / "the 12th" (bare ordinal) → the most recent occurrence of that day number.
  mm = s.match(/^(this month (on |on the )?)?(\d{1,2})$/);
  if (mm && mm[3]) {
    const day = Number(mm[3]);
    if (day >= 1 && day <= 31) {
      if (day <= d && isRealDate(y, m, day)) return resolved(mkIso(y, m, day), today, `"${s}" was read as the ${day} of this month.`);
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      if (!isRealDate(ly, lm, day)) return refused(`There is no ${day} in ${MONTH_LABEL[lm]} ${ly}.`);
      return resolved(mkIso(ly, lm, day), today, `"${s}" was read as the ${day} of ${MONTH_LABEL[lm]} — the most recent one that has passed.`);
    }
  }

  // ── absolute forms ──
  // ISO: 2026-07-20
  mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) return finishAbsolute(Number(mm[1]), Number(mm[2]), Number(mm[3]), today, s);

  // DD/MM/YYYY and DD-MM-YYYY and DD.MM.YYYY — ★ DAY FIRST. India writes 07/08 as 7 August, not 8 July;
  // reading it American-style would silently move a trade by up to eleven months.
  mm = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (mm) {
    const yy = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
    return finishAbsolute(yy, Number(mm[2]), Number(mm[1]), today, s, "read day-first (Indian convention): DD/MM/YYYY.");
  }

  // "20 July 2026" / "20 jul 26" / "20 of July 2026"
  mm = s.match(new RegExp(`^(\\d{1,2})\\s+(of\\s+)?${MONTH_RE}\\s+(\\d{2}|\\d{4})$`));
  if (mm) {
    const yy = mm[4].length === 2 ? 2000 + Number(mm[4]) : Number(mm[4]);
    return finishAbsolute(yy, MONTHS[mm[3]], Number(mm[1]), today, s);
  }
  // "July 20 2026" / "July 20, 2026"
  mm = s.match(new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})\\s+(\\d{2}|\\d{4})$`));
  if (mm) {
    const yy = mm[3].length === 2 ? 2000 + Number(mm[3]) : Number(mm[3]);
    return finishAbsolute(yy, MONTHS[mm[1]], Number(mm[2]), today, s);
  }

  // ── bare day + month, NO YEAR — the case that produced "2025-07-20" for "20 July". ──
  // Resolved to the MOST RECENT PAST occurrence, and the inference is reported so the caller can say it
  // out loud. Never a future date: "20 December" in July means last December, not five months ahead.
  mm =
    s.match(new RegExp(`^(\\d{1,2})\\s+(of\\s+)?${MONTH_RE}$`)) ??
    s.match(new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})$`));
  if (mm) {
    const isDayFirst = /^\d/.test(s);
    const monthName = isDayFirst ? mm[3] : mm[1];
    const day = Number(isDayFirst ? mm[1] : mm[2]);
    const mn = MONTHS[monthName];
    if (mn && day >= 1 && day <= 31) {
      let yy = y;
      if (!isRealDate(yy, mn, day) && !isRealDate(yy - 1, mn, day)) return refused(`There is no ${day} ${MONTH_LABEL[mn]}.`);
      // Future in this year ⇒ it must have meant last year.
      if (mkIso(yy, mn, day) > today || !isRealDate(yy, mn, day)) yy -= 1;
      if (!isRealDate(yy, mn, day)) return refused(`There is no ${day} ${MONTH_LABEL[mn]} ${yy}.`);
      const date = mkIso(yy, mn, day);
      const thisYear = yy === y;
      return resolved(date, today, `no year was given, so this is the most recent ${day} ${MONTH_LABEL[mn]}, which is ${thisYear ? `THIS year (${yy})` : `LAST year (${yy})`}.`);
    }
  }

  return null;
}

/** Shared tail for the absolute forms: validate the calendar, and refuse the future. */
function finishAbsolute(y: number, m: number, d: number, today: string, s: string, note?: string): DateResolution {
  if (!isRealDate(y, m, d)) return refused(`"${s}" is not a real calendar date.`);
  const iso = mkIso(y, m, d);
  if (iso > today) {
    return refused(`${pretty(iso)} is in the future — today is ${pretty(today)}. A transaction cannot be dated before it happened; check the date with the reader.`);
  }
  return resolved(iso, today, note);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Resolve one phrase to one date, or refuse it with a reason (and bounds, where the phrase has them).
 * Deterministic and pure apart from `now`, which is injectable so the proof harness can pin a date.
 */
export function resolvePhrase(raw: string, now: Date = new Date()): DateResolution {
  const today = istToday(now);
  const s = normalize(raw ?? "");
  if (!s) return refused("No date phrase was given.");

  const range = refuseIfRange(s, today);
  if (range) return range;

  const hit = tryResolve(s, today);
  if (hit) return hit;

  return refused(
    `"${raw.trim()}" was not recognised as a date. Do not translate it yourself — ask the reader for the exact day, ` +
      `or pass a clearer phrase (an exact date like 2026-07-20, or "yesterday", "last Tuesday", "3 days ago").`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SCANNING A FREE-TEXT MESSAGE — what the reader ACTUALLY said, for the transaction guard.
//
// The guard's question is not "is this date plausible" but "did the reader say it". So the reader's own
// sentence is scanned for date-shaped fragments, each is resolved through the SAME resolver, and the
// set of dates that come out is the set the reader can be said to have named. A model-invented date is
// simply not in that set.
//
// Only the UNAMBIGUOUS phrasings are extracted. "last week" appears here nowhere — it resolves to
// nothing, which is exactly the point.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const EXTRACTORS: RegExp[] = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g, //                              2026-07-20
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.](?:\d{4}|\d{2})\b/g, //           20/07/2026
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:\\s+\\d{4}|\\s+\\d{2}\\b)?`, "gi"), // 20 July [2026]
  new RegExp(`\\b${MONTH_RE}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi"), //                        July 20[, 2026]
  /\b(?:the\s+)?day before yesterday\b/gi,
  /\byesterday\b/gi,
  /\btoday\b/gi,
  /\b\d{1,3}\s+days?\s+(?:ago|back|earlier)\b/gi,
  /\b(?:a|one|\d{1,3})\s+weeks?\s+(?:ago|back|earlier)\b/gi,
  /\b(?:a|one|\d{1,3})\s+months?\s+(?:ago|back|earlier)\b/gi,
  /\bfortnight\s+(?:ago|back)\b/gi,
  new RegExp(`\\b(?:last to last|last|this|past|previous)\\s+${WEEKDAY_RE}\\b`, "gi"),
  new RegExp(`\\bon\\s+${WEEKDAY_RE}\\b`, "gi"),
  /\blast month (?:on )?(?:the )?\d{1,2}(?:st|nd|rd|th)?\b/gi,
];

/**
 * Every date the reader's message can be said to NAME, resolved server-side. Used by the transaction
 * guard: a `tradeDate` that is not in this set (and did not come from a resolveDate call this turn) was
 * invented by the model, and is refused.
 */
export function datesMentionedIn(text: string, now: Date = new Date()): Set<string> {
  const found = new Set<string>();
  if (!text) return found;
  for (const re of EXTRACTORS) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      // "on Tuesday" → "Tuesday"; the resolver's normaliser handles the rest.
      const r = resolvePhrase(match[0].replace(/^on\s+/i, ""), now);
      if (r.ok) found.add(r.date);
    }
  }
  return found;
}
