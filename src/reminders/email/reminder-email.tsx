// ═══════════════════════════════════════════════════════════════════════
// REMINDER EMAIL — one React Email template for a fired event reminder ("RELIANCE reports
// earnings tomorrow"). The date-triggered SIBLING of the alert email (src/alerts/email/
// alert-email.tsx): it reuses the exact same Vytal design tokens and chrome (near-black bg,
// warm off-white ink, serif display for the name, mono for dates, brand-blue CTA) so the
// two read as one product. Only the COPY differs — a reminder describes an upcoming date,
// not a crossing.
//
// It is DESCRIPTIVE, never advice. describeReminder() is the pure copy engine (exported so
// the subject derives without rendering HTML). Decoupled from Prisma (plain props).
// ═══════════════════════════════════════════════════════════════════════
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

export interface ReminderEmailProps {
  stockSymbol: string;
  stockName: string;
  /** corporate-event type key (earnings | dividend | agm | board_meeting | …). */
  eventType: string;
  /** the resolved occurrence date, ISO yyyy-mm-dd. */
  eventDate: string;
  /** the user's configured lead time (>= 1). */
  daysBefore: number;
  /** Absolute URL to the stock's page in the app. */
  stockUrl: string;
  /** Absolute URL to the in-app surface where reminders are managed. */
  manageUrl: string;
}

// ── Vytal design tokens (mirror app/globals.css :root — same values as the alert email) ──
const C = {
  bg: "#090a0d",
  surface: "#111319",
  surface2: "#171a20",
  line: "rgba(255,255,255,0.06)",
  line2: "rgba(255,255,255,0.10)",
  ink: "#f1efe9",
  ink2: "#9b9c9c",
  ink3: "#62646c",
  primary: "#4ea1e6",
  primaryInk: "#06121c",
};
const FONT_SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ── event-type identity (label + accent). Accents are hex (email can't read CSS vars); they
//    echo the calendar's type hues where sensible. ────────────────────────────────────────
const EVENT_META: Record<string, { label: string; accent: string }> = {
  earnings:      { label: "Earnings",      accent: "#cda74f" },
  dividend:      { label: "Dividend",      accent: "#48ba7c" },
  agm:           { label: "AGM",           accent: "#4ea1e6" },
  board_meeting: { label: "Board meeting", accent: "#4ea1e6" },
  bonus:         { label: "Bonus issue",   accent: "#a085d8" },
  split:         { label: "Stock split",   accent: "#a085d8" },
  rights:        { label: "Rights issue",  accent: "#4ea1e6" },
  buyback:       { label: "Buyback",       accent: "#4ea1e6" },
  record_date:   { label: "Record date",   accent: "#4ea1e6" },
};
function eventMeta(t: string): { label: string; accent: string } {
  return (
    EVENT_META[t] ?? {
      label: t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      accent: C.primary,
    }
  );
}

function formatEventDate(iso: string): string {
  // ISO yyyy-mm-dd → "Mon, 5 Aug 2026" in IST (the events are Indian; date is tz-free).
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "in 1 day" → "tomorrow"; otherwise "in N days". */
function leadPhrase(daysBefore: number): string {
  return daysBefore <= 1 ? "tomorrow" : `in ${daysBefore} days`;
}

// ── the pure copy engine ────────────────────────────────────────────────────────────────
export interface ReminderNarrative {
  kicker: string;
  subject: string;
  headline: string;
  body: string;
  rows: { label: string; value: string; variant?: "mono" | "text" }[];
  accent: string;
}

export function describeReminder(p: ReminderEmailProps): ReminderNarrative {
  const { label, accent } = eventMeta(p.eventType);
  const lead = leadPhrase(p.daysBefore);
  const when = formatEventDate(p.eventDate);
  const dayWord = p.daysBefore === 1 ? "day" : "days";

  return {
    kicker: "Event reminder",
    subject: `Reminder: ${p.stockSymbol} — ${label.toLowerCase()} ${lead}`,
    headline: `${p.stockSymbol} — ${label.toLowerCase()} ${lead}`,
    body: `${p.stockName}'s ${label.toLowerCase()} is scheduled for ${when}. You asked to be reminded ${p.daysBefore} ${dayWord} before.`,
    rows: [
      { label: "Event", value: label, variant: "text" },
      { label: "Date", value: when, variant: "mono" },
      { label: "Reminder", value: `${p.daysBefore} ${dayWord} before`, variant: "text" },
    ],
    accent,
  };
}

// ── styles (mirror the alert email) ──────────────────────────────────────────────────────
const main = { backgroundColor: C.bg, margin: "0", padding: "0", fontFamily: FONT_SANS };
const outerPad = { padding: "32px 16px" };
const container = {
  backgroundColor: C.surface,
  margin: "0 auto",
  padding: "28px",
  maxWidth: "544px",
  width: "100%",
  borderRadius: "16px",
  border: `1px solid ${C.line2}`,
};
const brandWrap = { paddingBottom: "18px" };
const chip = {
  width: "34px",
  height: "34px",
  backgroundColor: "rgba(78,161,230,0.14)",
  border: "1px solid rgba(78,161,230,0.35)",
  borderRadius: "9px",
  textAlign: "center" as const,
  verticalAlign: "middle" as const,
};
const spark = { color: C.primary, fontSize: "16px", lineHeight: "32px", margin: "0" };
const wordmark = {
  fontFamily: FONT_DISPLAY,
  fontSize: "19px",
  fontWeight: 700 as const,
  color: C.ink,
  letterSpacing: "-0.01em",
  margin: "0",
  paddingLeft: "10px",
};
const rule = { borderColor: C.line, borderWidth: "1px 0 0", margin: "0 0 22px" };
const kickerStyle = {
  fontSize: "11px",
  fontWeight: 700 as const,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: C.ink3,
  margin: "0 0 10px",
};
const heading = {
  fontFamily: FONT_DISPLAY,
  fontSize: "25px",
  lineHeight: "1.22",
  fontWeight: 500 as const,
  color: C.ink,
  letterSpacing: "-0.01em",
  margin: "0 0 12px",
};
const bodyText = { fontSize: "15px", lineHeight: "1.6", color: C.ink2, margin: "0 0 22px" };
const card = {
  backgroundColor: C.surface2,
  border: `1px solid ${C.line}`,
  borderRadius: "12px",
  padding: "6px 18px",
  margin: "0 0 24px",
};
const rowWrap = { padding: "12px 0", borderBottom: `1px solid ${C.line}` };
const rowLabel = {
  fontSize: "11px",
  fontWeight: 600 as const,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: C.ink3,
  margin: "0",
};
const valueBase = { fontSize: "15px", color: C.ink, fontWeight: 600 as const, margin: "0" };
const button = {
  backgroundColor: C.primary,
  color: C.primaryInk,
  fontSize: "14px",
  fontWeight: 700 as const,
  padding: "12px 22px",
  borderRadius: "8px",
  textDecoration: "none",
  display: "inline-block",
};
const note = { fontSize: "12px", color: C.ink3, lineHeight: "1.5", margin: "18px 0 0" };
const footerText = { fontSize: "12px", lineHeight: "1.6", color: C.ink3, margin: "0" };
const footerLink = { color: C.ink2, textDecoration: "underline" };

function DetailRow({
  row,
  last,
}: {
  row: { label: string; value: string; variant?: "mono" | "text" };
  last: boolean;
}) {
  const wrap = last ? { ...rowWrap, borderBottom: "none" } : rowWrap;
  return (
    <Row style={wrap}>
      <Column>
        <Text style={rowLabel}>{row.label}</Text>
      </Column>
      <Column style={{ textAlign: "right" as const }}>
        <Text
          style={{
            ...valueBase,
            ...(row.variant === "mono" ? { fontFamily: FONT_MONO, letterSpacing: "-0.01em" } : {}),
          }}
        >
          {row.value}
        </Text>
      </Column>
    </Row>
  );
}

export function ReminderEmail(props: ReminderEmailProps) {
  const n = describeReminder(props);
  return (
    <Html>
      <Head />
      <Preview>{n.subject}</Preview>
      <Body style={main}>
        <Section style={outerPad}>
          <Container style={container}>
            {/* brand mark — spark chip + display wordmark */}
            <Row style={brandWrap}>
              <Column style={{ width: "34px" }}>
                <table cellPadding={0} cellSpacing={0} role="presentation">
                  <tbody>
                    <tr>
                      <td style={chip}>
                        <Text style={spark}>✦</Text>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Column>
              <Column>
                <Text style={wordmark}>Vytal</Text>
              </Column>
            </Row>

            <Hr style={rule} />

            <Text style={kickerStyle}>
              <span style={{ color: n.accent }}>●</span>&nbsp;&nbsp;{n.kicker}
            </Text>
            <Heading style={heading}>{n.headline}</Heading>
            <Text style={bodyText}>{n.body}</Text>

            <Section style={card}>
              {n.rows.map((r, i) => (
                <DetailRow key={r.label} row={r} last={i === n.rows.length - 1} />
              ))}
            </Section>

            <Button href={props.stockUrl} style={button}>
              View {props.stockSymbol} &nbsp;→
            </Button>

            <Text style={note}>
              Dates come from the disclosure feeds and can move — we always remind you against
              the latest scheduled date.
            </Text>

            <Hr style={{ borderColor: C.line, borderWidth: "1px 0 0", margin: "26px 0 16px" }} />
            <Text style={footerText}>
              You’re receiving this because you set this reminder in Vytal.{" "}
              <Link href={props.manageUrl} style={footerLink}>
                Manage or delete your reminders
              </Link>{" "}
              anytime in the app.
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

/** Render the reminder email to a subject + HTML pair (subject from the pure copy engine). */
export async function renderReminderEmail(
  props: ReminderEmailProps,
): Promise<{ subject: string; html: string }> {
  const { subject } = describeReminder(props);
  const html = await render(<ReminderEmail {...props} />);
  return { subject, html };
}
