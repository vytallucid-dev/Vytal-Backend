// GATE 1/2/3 READ — the seeded multi-asset book, read every which way. READ-ONLY (no seeding, no writes).
// Finds the test user by email and dumps: entity ledger · sleeves · sectors · the full fired set · the
// composed story (4 movements) · per-holding disclosures (PD) · PI findings · coverage. Run repeatedly
// (GATE 3 determinism = run twice, diff the story).   npx tsx src/scripts/read-multiasset-book.ts
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { firePortfolioFindings } from "../portfolio/phs/patterns.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";

const EMAIL = "__multiasset_book@test.invalid";
const H = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));
const j = (o: unknown) => JSON.stringify(o);
function mockRes() { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }
function mockReq(userId: string) { return { authUser: { userId }, body: {}, params: {}, query: {} } as any; }

async function main() {
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error(`test user not found (${EMAIL}) — run seed-multiasset-book.ts first`);
  const USER = user.id;

  const { holdings, prov, fieldWeakSymbols } = await assemblePortfolio(USER);
  const r = computePhs(holdings);
  const findings = firePortfolioFindings(holdings, r, { fieldWeakSymbols });

  // ── ENTITY LEDGER — name-risk holdings aggregated by 7-char stem ──
  H("ENTITY LEDGER (name-risk aggregated by issuer stem) — PC8's 'two positions, one company'");
  for (const e of r.entityLedger as any[])
    console.log(`  ${String(e.entityKey).padEnd(9)} ${String(e.displayName ?? "?").padEnd(20)} w=${(e.weight * 100).toFixed(2)}%  sector=${e.sector ?? "-"}  constituents=[${(e.constituentInstruments ?? []).map((c: any) => c.symbol ?? c.isin).join(", ")}]`);

  // ── BASKET LEDGER — funds/ETFs, unaggregated ──
  H("BASKET LEDGER (funds/ETFs, unaggregated) — C5/PC6/PC7 subject");
  for (const b of r.basketLedger as any[])
    console.log(`  ${String(b.isin).padEnd(14)} w=${(b.weight * 100).toFixed(2)}%  house=${b.fundHouse ?? b.house ?? "-"}  ${j(b).slice(0, 90)}`);

  // ── SLEEVES + SECTORS ──
  H("SLEEVES + SECTOR RESOLUTION");
  console.log("  sleeves:", j(r.sleeves));
  console.log("  sectors:", j(r.sectors));

  // ── NEFF: positions vs entities (GATE 2.1 — the calibration debt) ──
  H("NEFF — positions vs entities (the calibration debt: aggregation merges the NTPC pair)");
  {
    const nr = (holdings as any[]).filter((h) => h.nature === "name_risk" || h.natureKind === "name_risk");
    // fallback: derive name-risk positions from the entity ledger constituents' market values if nature absent
    const sleeveVal = (r.entityLedger as any[]).reduce((s, e) => s + e.weight, 0); // sleeve share
    const entW = (r.entityLedger as any[]).map((e) => e.weight / sleeveVal);
    const neffEnt = 1 / entW.reduce((s, w) => s + w * w, 0);
    console.log(`  entities: ${(r.entityLedger as any[]).length} · entity-Neff (engine C2) = ${(r as any).construction?.gross ? "" : ""}${neffEnt.toFixed(4)}`);
    // positions: split each entity into its constituents by their own market value
    const posWeights: number[] = [];
    for (const e of r.entityLedger as any[]) {
      const cons = e.constituentInstruments ?? [];
      const mv = cons.map((c: any) => Number(c.marketValue ?? c.weight ?? NaN));
      if (mv.some((x: number) => Number.isNaN(x))) { posWeights.push(e.weight); continue; }
      const tot = mv.reduce((s: number, x: number) => s + x, 0);
      for (const x of mv) posWeights.push(e.weight * (x / tot));
    }
    const pw = posWeights.map((w) => w / sleeveVal);
    const neffPos = 1 / pw.reduce((s, w) => s + w * w, 0);
    console.log(`  positions: ${posWeights.length} · position-Neff = ${neffPos.toFixed(4)}`);
    console.log(`  Δ (position-Neff − entity-Neff) = ${(neffPos - neffEnt).toFixed(4)}  ← THE DEBT (prior cohort measured ≤0.02)`);
    console.log(`  nr-holdings nature sample:`, nr.length ? j(nr.slice(0, 2)).slice(0, 200) : "(nature field not on PhsHolding — used ledger constituents)");
  }

  // ── FIRED SET (persisted, from firePortfolioFindings) ──
  H(`FIRED SET — persisted findings (${findings.length})`);
  for (const f of findings as any[])
    console.log(`  ${String(f.id).padEnd(5)} ${String(f.family).padEnd(3)} ${String(f.tone ?? f.nature ?? "").padEnd(13)} ${String(f.headline ?? f.title ?? f.copy?.title ?? "").slice(0, 74)}`);

  // ── CONTROLLER READ — story + read-time findings (PD/PI) + coverage ──
  const snapRes = mockRes(); await getPortfolioSnapshot(mockReq(USER), snapRes);
  const holdRes = mockRes(); await listHoldings(mockReq(USER), holdRes);
  const snap = snapRes.body?.data?.snapshot ?? snapRes.body?.data ?? snapRes.body;
  const story = snap?.story;

  H("THE COMPOSED STORY — all four movements (byte-for-byte determinism subject)");
  if (!story) console.log("  story = null");
  else {
    console.log("  ── FULL TEXT ──\n" + String(story.text).split("\n").map((l: string) => "  " + l).join("\n"));
    console.log("\n  ── MOVEMENTS ──");
    for (const m of story.movements ?? []) console.log(`  [${m.movement}] used=[${(m.used ?? []).join(",")}]\n     ${String(m.text).replace(/\n/g, " ")}`);
    console.log(`\n  reference (ranked, nothing suppressed): [${(story.reference ?? []).map((f: any) => f.id).join(", ")}]`);
  }

  // Learn the PfFinding shape from one full object, then dump the read-time families.
  const data = snapRes.body?.data ?? {};
  const txt = (f: any) => f?.copy?.headline ?? f?.copy?.title ?? f?.headline ?? f?.title ?? f?.copy?.body ?? j(f).slice(0, 120);
  H("PfFINDING SHAPE (one full object) + BIND");
  console.log(j((story?.reference ?? findings)[0]));

  H("PD FAMILY — book-level disclosure findings (data.referenceFindings)");
  for (const f of (data.referenceFindings ?? []) as any[])
    console.log(`  ${String(f.id).padEnd(5)} ${String(txt(f)).slice(0, 130)}\n        bind=${j(f.bind ?? f.subjects ?? "").slice(0,120)}`);

  H("PI FAMILY — instrument findings (from story.reference)");
  for (const f of (story?.reference ?? []).filter((f: any) => /^PI/.test(f.id)) as any[])
    console.log(`  ${String(f.id).padEnd(5)} ${String(txt(f)).slice(0, 130)}`);

  H("DISCLOSURE SUMMARY (data.disclosure — coverage / heldNotValued)");
  console.log(j(data.disclosure ?? {}).slice(0, 500));
  console.log("  healthRead:", j(snap?.healthRead ?? {}).slice(0, 400));

  H("HOLDINGS READ — per-holding disclosures");
  const hbody = holdRes.body?.data ?? holdRes.body;
  for (const h of (hbody?.holdings ?? []) as any[]) {
    const disc = (h.instrument?.disclosures ?? h.disclosures ?? []);
    console.log(`  ${String(h.instrument?.symbol ?? h.symbol ?? h.instrument?.isin ?? "?").padEnd(13)} ${String(h.instrument?.assetClass ?? h.assetClass ?? "").padEnd(12)} w=${((h.weight ?? 0) * 100).toFixed(1)}%  disclosures=[${(Array.isArray(disc) ? disc : []).join(", ")}]`);
  }

  console.log(`\nsnapshot HTTP ${snapRes.statusCode} · holdings HTTP ${holdRes.statusCode} · provisional=${(r as any).provisional} · coverage=${((r as any).coverage * 100).toFixed(2)}%`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
