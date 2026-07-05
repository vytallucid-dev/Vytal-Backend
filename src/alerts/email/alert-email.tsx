// ═══════════════════════════════════════════════════════════════════════
// ALERT EMAIL — one React Email template, parameterized by alert type, styled to match
// the Vytal platform (dark-only "editorial fintech": warm off-white ink on near-black,
// serif display for names, mono for every number, the health-band colour scale).
//
// Design tokens mirror Vytal-Frontend/app/globals.css (the single source of truth) and the
// alerts vocabulary mirrors Vytal-Frontend/lib/alerts.ts — band labels ("Below par"),
// past-tense crossing verbs ("fell below" / "crossed" / "rose above" / "dropped below"),
// and ₹ formatting (integers show no decimals). Colours are hard-coded hex here because
// email can't read CSS variables; fonts fall back to Georgia (serif) / system-sans / a mono
// stack because mail clients don't reliably load web fonts.
//
// It is DESCRIPTIVE, never advice. Price alerts are labelled "checked at end of day" so the
// honest daily cadence isn't mistaken for a live trigger. The template stays decoupled from
// Prisma (plain string-union props). describeAlert() is the pure copy engine — exported so
// the subject derives without rendering HTML.
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

export type AlertEmailType = "price" | "health_band" | "finding";
export type AlertEmailOperator = "above" | "below" | "fires";
export type BandKey = "fragile" | "below_par" | "steady" | "healthy" | "pristine";

export interface AlertEmailProps {
  stockSymbol: string;
  stockName: string;
  type: AlertEmailType;
  operator: AlertEmailOperator;
  /** The rendered value that fired: close price ("4012.50") / band key ("steady") /
   *  finding key(s) ("promoter_pledge_high" or "a,b" for an "any new finding" alert). */
  snapshot: string;
  /** The user's configured target, shown for context. Populated per type. */
  thresholdPrice?: string | null;
  thresholdBand?: BandKey | null;
  findingKey?: string | null;
  firedAt: Date;
  /** Absolute URL to the stock's page in the app. */
  stockUrl: string;
  /** Absolute URL to the in-app alerts surface (footer "manage your alerts"). */
  manageUrl: string;
}

// ── Vytal design tokens (mirror app/globals.css :root) ─────────────────────────────────
const C = {
  bg: "#090a0d",
  surface: "#111319",
  surface2: "#171a20",
  line: "rgba(255,255,255,0.06)",
  line2: "rgba(255,255,255,0.10)",
  ink: "#f1efe9",
  ink2: "#9b9c9c",
  ink3: "#62646c",
  primary: "#4ea1e6", // cool-blue Pristine — brand/CTA accent
  primaryInk: "#06121c",
};
const BAND_HEX: Record<BandKey, string> = {
  fragile: "#e2584d",
  below_par: "#e0913f",
  steady: "#cda74f",
  healthy: "#48ba7c",
  pristine: "#4ea1e6",
};
const FONT_SANS =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
const FONT_MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ── human labels (mirror lib/alerts.ts) ────────────────────────────────────────────────
const BAND_LABEL: Record<BandKey, string> = {
  fragile: "Fragile",
  below_par: "Below par",
  steady: "Steady",
  healthy: "Healthy",
  pristine: "Pristine",
};

/** ₹ — integers show no decimals; otherwise two (mirrors lib/alerts.ts fmtInr). */
function fmtInr(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const whole = Number.isInteger(n);
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function bandLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return BAND_LABEL[key as BandKey] ?? key;
}

/** "promoter_pledge_high" → "Promoter Pledge High" (backend fallback; the app maps keys to
 *  curated names, which we don't carry here). */
function prettyFinding(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatFiredAt(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── the pure copy engine: alert → subject + body + detail rows ─────────────────────────
export interface NarrativeRow {
  label: string;
  value: string;
  /** presentation hint for the renderer. */
  variant?: "mono" | "pill" | "text";
  /** mono rows: colour the value with the accent + bump size. */
  emphasize?: boolean;
  /** pill rows: which band's colour to use. */
  band?: BandKey;
}
export interface AlertNarrative {
  /** eyebrow above the headline, e.g. "PRICE ALERT". */
  kicker: string;
  subject: string;
  headline: string;
  body: string;
  rows: NarrativeRow[];
  /** accent colour for this event (eyebrow dot, emphasised value). */
  accent: string;
  /** price alerts get the honest "checked once a day, at close" note. */
  endOfDayNote: boolean;
}

export function describeAlert(p: AlertEmailProps): AlertNarrative {
  switch (p.type) {
    case "price": {
      const rose = p.operator === "above";
      const target = fmtInr(p.thresholdPrice);
      const now = fmtInr(p.snapshot);
      const headline = `${p.stockSymbol} ${rose ? "crossed" : "fell below"} ${target}`;
      return {
        kicker: "Price alert",
        subject: headline,
        headline,
        body: `The end-of-day price of ${p.stockName} was ${now}, ${
          rose ? "above" : "below"
        } your alert of ${target}.`,
        rows: [
          { label: "Latest close", value: now, variant: "mono", emphasize: true },
          { label: "Your alert", value: `${rose ? "Above" : "Below"} ${target}`, variant: "mono" },
        ],
        accent: rose ? BAND_HEX.healthy : BAND_HEX.below_par,
        endOfDayNote: true,
      };
    }
    case "health_band": {
      const climbed = p.operator === "above";
      const cur = (p.snapshot as BandKey) ?? null;
      const curLabel = bandLabel(p.snapshot);
      const thr = bandLabel(p.thresholdBand);
      const headline = `${p.stockSymbol} ${climbed ? "rose above" : "dropped below"} ${thr}`;
      return {
        kicker: "Health alert",
        subject: headline,
        headline,
        body: `The Health band for ${p.stockName} is now ${curLabel}, ${
          climbed ? "above" : "below"
        } your alert of ${thr}.`,
        rows: [
          { label: "Current band", value: curLabel, variant: "pill", band: cur ?? undefined },
          { label: "Your alert", value: `${climbed ? "Above" : "Below"} ${thr}`, variant: "text" },
        ],
        accent: (cur && BAND_HEX[cur]) || C.primary,
        endOfDayNote: false,
      };
    }
    case "finding": {
      const keys = p.snapshot
        ? p.snapshot.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const pretty = keys.map(prettyFinding);
      if (p.findingKey != null) {
        const label = prettyFinding(p.findingKey);
        return {
          kicker: "New finding",
          subject: `New finding on ${p.stockSymbol}: ${label}`,
          headline: `A finding you watch appeared on ${p.stockSymbol}`,
          body: `${p.stockName} now shows the finding you set an alert for.`,
          rows: [{ label: "Finding", value: label, variant: "text" }],
          accent: C.primary,
          endOfDayNote: false,
        };
      }
      const count = pretty.length;
      return {
        kicker: "New finding",
        subject:
          count === 1
            ? `New finding on ${p.stockSymbol}: ${pretty[0]}`
            : `${count} new findings on ${p.stockSymbol}`,
        headline: `New ${count === 1 ? "finding" : "findings"} on ${p.stockSymbol}`,
        body: `${p.stockName} has ${
          count === 1 ? "a new finding" : `${count} new findings`
        } since the last check.`,
        rows: [
          { label: count === 1 ? "Finding" : "Findings", value: pretty.join(", ") || "—", variant: "text" },
        ],
        accent: C.primary,
        endOfDayNote: false,
      };
    }
  }
}

// ── styles ─────────────────────────────────────────────────────────────────────────────
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
const triggeredLine = { fontSize: "12px", color: C.ink3, margin: "0", padding: "12px 0 2px" };
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

function DetailRow({ row, accent, last }: { row: NarrativeRow; accent: string; last: boolean }) {
  const wrap = last ? { ...rowWrap, borderBottom: "none" } : rowWrap;
  return (
    <Row style={wrap}>
      <Column>
        <Text style={rowLabel}>{row.label}</Text>
      </Column>
      <Column style={{ textAlign: "right" as const }}>
        {row.variant === "pill" && row.band ? (
          <span
            style={{
              display: "inline-block",
              fontSize: "13px",
              fontWeight: 600,
              color: BAND_HEX[row.band],
              backgroundColor: "rgba(255,255,255,0.04)",
              border: `1px solid ${BAND_HEX[row.band]}`,
              borderRadius: "999px",
              padding: "3px 12px",
            }}
          >
            {row.value}
          </span>
        ) : (
          <Text
            style={{
              ...valueBase,
              ...(row.variant === "mono" ? { fontFamily: FONT_MONO, letterSpacing: "-0.01em" } : {}),
              ...(row.emphasize ? { color: accent, fontSize: "17px" } : {}),
            }}
          >
            {row.value}
          </Text>
        )}
      </Column>
    </Row>
  );
}

export function AlertEmail(props: AlertEmailProps) {
  const n = describeAlert(props);
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

            {/* eyebrow with accent dot */}
            <Text style={kickerStyle}>
              <span style={{ color: n.accent }}>●</span>&nbsp;&nbsp;{n.kicker}
            </Text>
            <Heading style={heading}>{n.headline}</Heading>
            <Text style={bodyText}>{n.body}</Text>

            <Section style={card}>
              {n.rows.map((r, i) => (
                <DetailRow key={r.label} row={r} accent={n.accent} last={i === n.rows.length - 1} />
              ))}
              <Text style={triggeredLine}>Triggered {formatFiredAt(props.firedAt)}</Text>
            </Section>

            <Button href={props.stockUrl} style={button}>
              View {props.stockSymbol} &nbsp;→
            </Button>

            {n.endOfDayNote && (
              <Text style={note}>
                Prices are checked once a day, at market close — this is not a live intraday
                trigger.
              </Text>
            )}

            <Hr style={{ borderColor: C.line, borderWidth: "1px 0 0", margin: "26px 0 16px" }} />
            <Text style={footerText}>
              You’re receiving this because you set this alert in Vytal.{" "}
              <Link href={props.manageUrl} style={footerLink}>
                Manage or delete your alerts
              </Link>{" "}
              anytime in the app.
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

/**
 * Render the alert email to a subject + HTML pair. The subject comes from the pure copy
 * engine (no need to parse it back out of the HTML); the HTML is the full React Email doc.
 */
export async function renderAlertEmail(
  props: AlertEmailProps,
): Promise<{ subject: string; html: string }> {
  const { subject } = describeAlert(props);
  const html = await render(<AlertEmail {...props} />);
  return { subject, html };
}
