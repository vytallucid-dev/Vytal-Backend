// ─────────────────────────────────────────────────────────────────────────────
// TARGET-ENTITY → HUMAN LABEL resolver for the ingestion-errors list.
//
// `target_entity` is heterogeneous and often an opaque id: a stockId uuid (financial
// rows: "<stockId>@Q4-FY25@standalone"), an ISIN (broker_seeded / AMFI uniqueness), an
// AMFI scheme code (AMFI validity), a bare symbol (scoring / events / corp-actions), a PG
// id ("PG10"), or a userId uuid (scoring_phs_failed). This resolves each into something
// legible — a stock SYMBOL, a fund's scheme name, or a user's name/email — so an operator
// can tell WHICH entity a row concerns without decoding an id.
//
// BATCHED: at most four lookups total (stocks-by-id, instruments-by-isin,
// instruments-by-scheme-code, users-by-id), regardless of page size. BEST-EFFORT: an
// unresolvable base falls back to the raw value (shortened if it is a long uuid) — the
// label is NEVER blank, and this NEVER changes a fault, only how it reads.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";

/** Financial tables whose entity is "<stockId>@period@basis" (see error-resolution.ts). */
const FUND_TABLES = new Set([
  "Fundamental", "BankingFundamental", "NbfcFundamental", "LifeInsuranceFundamental", "GeneralInsuranceFundamental",
  "QuarterlyResult", "BankingQuarterlyResult", "NbfcQuarterlyResult", "LifeInsuranceQuarterlyResult", "GeneralInsuranceQuarterlyResult",
]);
/** Indian ISIN: "IN" + 10 alphanumerics (12 total) — e.g. INE002A01018, INF204KB1XN0. A bare
 *  ticker (INFY, 4 chars) never matches; a 12-char symbol starting IN is not a real NSE symbol. */
const ISIN_RE = /^IN[A-Z0-9]{10}$/;
const DIGITS_RE = /^\d+$/;

export interface Labelable {
  guardType: string;
  targetTable: string;
  targetEntity: string | null;
  observed?: string | null;
}

type Kind = "user" | "stockId" | "isin" | "schemeCode" | "broker" | "plain";

/** The entity's leading token (before the first "@") + the remainder as a "·"-joined suffix. */
function parse(entity: string): { base: string; suffix: string } {
  const [base, ...rest] = entity.split("@");
  return { base, suffix: rest.join(" · ") };
}

/** What the leading token IS, given the row's context. */
function kindOf(row: Labelable, base: string): Kind {
  if (row.guardType === "scoring_phs_failed" || row.targetTable === "portfolio_health") return "user";
  // broker_seeded's ISIN is often NOT in the catalogue (rolled-back / historical admits), but its
  // name is embedded in `observed` (ISIN — "Name" — surfaced by…) — read it from there.
  if (row.guardType === "broker_seeded") return "broker";
  if (FUND_TABLES.has(row.targetTable)) return "stockId";
  if (ISIN_RE.test(base)) return "isin";
  if (DIGITS_RE.test(base)) return "schemeCode";
  return "plain"; // already a symbol / PG id / date
}

/** The instrument NAME reportBrokerSeeded writes into `observed`: `ISIN — "Name" — surfaced…`. */
function brokerName(observed: string | null | undefined): string | undefined {
  const m = observed?.match(/"([^"]+)"/);
  return m?.[1];
}

const short = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…` : id);

/**
 * Build a per-row label resolver over the given rows. Returns a function `(row) => label`
 * (null for a batch-level row with no entity). Call it inside the list `.map`.
 */
export async function buildTargetLabeler(rows: Labelable[]): Promise<(row: Labelable) => string | null> {
  const userIds = new Set<string>();
  const stockIds = new Set<string>();
  const isins = new Set<string>();
  const schemeCodes = new Set<string>();

  for (const r of rows) {
    if (!r.targetEntity) continue;
    const { base } = parse(r.targetEntity);
    switch (kindOf(r, base)) {
      case "user": userIds.add(base); break;
      case "stockId": stockIds.add(base); break;
      case "isin": isins.add(base); break;
      case "schemeCode": schemeCodes.add(base); break;
      case "broker": case "plain": break; // resolved inline (observed / as-is) — no lookup
    }
  }

  const [users, stocks, byIsin, byCode] = await Promise.all([
    userIds.size ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, email: true, ledger: { select: { displayName: true } } } }) : Promise.resolve([]),
    stockIds.size ? prisma.stock.findMany({ where: { id: { in: [...stockIds] } }, select: { id: true, symbol: true } }) : Promise.resolve([]),
    isins.size ? prisma.instrument.findMany({ where: { isin: { in: [...isins] } }, select: { isin: true, symbol: true, name: true, schemeName: true } }) : Promise.resolve([]),
    schemeCodes.size ? prisma.instrument.findMany({ where: { amfiSchemeCode: { in: [...schemeCodes] } }, select: { amfiSchemeCode: true, symbol: true, name: true, schemeName: true } }) : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, (u.ledger?.displayName?.trim() || u.email)]));
  const stockMap = new Map(stocks.map((s) => [s.id, s.symbol]));
  const isinMap = new Map(byIsin.map((i) => [i.isin, i.symbol || i.schemeName || i.name]));
  const codeMap = new Map(byCode.filter((i) => i.amfiSchemeCode).map((i) => [i.amfiSchemeCode as string, i.schemeName || i.name || i.symbol || ""]));

  return (row: Labelable): string | null => {
    if (!row.targetEntity) return null; // batch-level (no entity)
    const { base, suffix } = parse(row.targetEntity);
    let resolved: string | undefined;
    switch (kindOf(row, base)) {
      case "user": resolved = userMap.get(base) ?? short(base); break;
      case "stockId": resolved = stockMap.get(base) ?? short(base); break;
      case "isin": resolved = isinMap.get(base); break; // undefined ⇒ fall back to the raw ISIN
      case "schemeCode": resolved = codeMap.get(base); break; // undefined ⇒ fall back to the raw code
      case "broker": resolved = brokerName(row.observed); break; // undefined ⇒ fall back to the raw ISIN
      case "plain": resolved = base; break;
    }
    const head = (resolved && resolved.length ? resolved : base); // never blank
    return suffix ? `${head} · ${suffix}` : head;
  };
}
