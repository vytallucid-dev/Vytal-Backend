// ═══════════════════════════════════════════════════════════════════════
// BROKER REGISTRY — the SINGLE place a BrokerId maps to a concrete adapter. This is the
// one and only broker-specific branch in the whole integration; the lifecycle service
// resolves an adapter here by id and then touches ONLY the BrokerAdapter interface, so
// no broker-specific logic ever leaks into the core (grep-proof: `new MockAdapter`,
// `new ZerodhaAdapter`, etc. appear nowhere outside this file + the adapters dir).
//
// Adding a broker = write its adapter, add ONE line here, add the enum value. Done.
// ═══════════════════════════════════════════════════════════════════════
import type { BrokerAdapter, BrokerId, BrokerMeta } from "./types.js";
import { MockAdapter } from "./adapters/mock.js";
import { ZerodhaAdapter } from "./adapters/zerodha.js";

/** Adapter FACTORIES (fresh instance per resolve — adapters are stateless, but a factory
 *  keeps it that way and mirrors how a real adapter might close over per-call config). This
 *  map is the ONE and ONLY place a broker id binds to a concrete adapter class. */
/// The Record is EXHAUSTIVE on BrokerId by design: adding a catalog member without a line here
/// is a COMPILE error, not a runtime surprise. Adapter-less members resolve to notYet() — they
/// are taggable on an account (create-now-link-later) but not linkable, and IMPLEMENTED_BROKERS
/// below is the gate that says so. Only `mock` and `zerodha` have real adapters; nothing else
/// in this file changed with the Step-5.5 catalog widening.
const REGISTRY: Record<BrokerId, () => BrokerAdapter> = {
  mock: () => new MockAdapter(),
  zerodha: () => new ZerodhaAdapter(), // Phase 2a — thin adapter; the core is unchanged
  // Catalog-only until each adapter lands — same shape, one line each:
  //   upstox: () => new UpstoxAdapter(),
  upstox: () => notYet("upstox"),
  groww: () => notYet("groww"),
  angelone: () => notYet("angelone"),
  dhan: () => notYet("dhan"),
  fyers: () => notYet("fyers"),
  icicidirect: () => notYet("icicidirect"),
  hdfcsecurities: () => notYet("hdfcsecurities"),
  kotak: () => notYet("kotak"),
  sharekhan: () => notYet("sharekhan"),
  fivepaisa: () => notYet("fivepaisa"),
  motilaloswal: () => notYet("motilaloswal"),
  iifl: () => notYet("iifl"),
  sbisecurities: () => notYet("sbisecurities"),
  paytmmoney: () => notYet("paytmmoney"),
  axisdirect: () => notYet("axisdirect"),
  // `other` is the not-at-a-broker account: there is NO broker behind it to connect to, so it has
  // no adapter and never will. Taggable on an account, permanently unlinkable — resolving an
  // adapter for it is a hard error, exactly like a not-yet-implemented broker.
  other: () => notYet("other"),
};

/** Test-only adapter overrides. Lets a harness inject an adapter built with a MOCKED HTTP
 *  layer (Zerodha has no sandbox) WITHOUT any test seam leaking into the adapters or core —
 *  the override is generic (works for any broker), not Zerodha-specific. */
const testOverrides: Partial<Record<BrokerId, () => BrokerAdapter>> = {};
export function __setAdapterOverrideForTests(broker: BrokerId, factory: () => BrokerAdapter): void {
  testOverrides[broker] = factory;
}
export function __clearAdapterOverridesForTests(): void {
  for (const k of Object.keys(testOverrides)) delete testOverrides[k as BrokerId];
}

function notYet(broker: BrokerId): never {
  throw new UnsupportedBrokerError(broker);
}

export class UnsupportedBrokerError extends Error {
  readonly broker: string;
  constructor(broker: string) {
    super(`broker "${broker}" is not yet supported`);
    this.name = "UnsupportedBrokerError";
    this.broker = broker;
  }
}

/** True when `broker` is a modelled BrokerId (enum-safe narrowing for request input). */
export function isBrokerId(broker: string): broker is BrokerId {
  return broker in REGISTRY;
}

/** Resolve the adapter for a broker (test override wins, else the registry). Throws
 *  UnsupportedBrokerError for an unknown or not-yet-implemented broker. */
export function getAdapter(broker: BrokerId): BrokerAdapter {
  const make = testOverrides[broker] ?? REGISTRY[broker];
  if (!make) throw new UnsupportedBrokerError(broker);
  return make();
}

/** Brokers that are actually usable right now (have a working adapter) — for the status /
 *  picker surface. Phase 2a adds zerodha (real Kite adapter; fails closed to 503 if the Kite
 *  keys aren't configured). Each further real broker flips on as its adapter lands. */
export const IMPLEMENTED_BROKERS: BrokerId[] = ["mock", "zerodha"];

/** Static metadata for every implemented broker (the picker list). */
export function implementedBrokerMeta(): BrokerMeta[] {
  return IMPLEMENTED_BROKERS.map((id) => getAdapter(id).meta);
}
