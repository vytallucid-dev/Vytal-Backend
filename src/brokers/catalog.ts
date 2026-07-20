// ═══════════════════════════════════════════════════════════════════════
// THE BROKER CATALOG (Step 5.5) — the ACCOUNT picker's source of truth.
//
// WHY THIS FILE EXISTS AT ALL: display metadata for a broker lives on its adapter
// (BrokerMeta), and `implementedBrokerMeta()` reads it via `getAdapter(id).meta`. That works
// only for brokers that HAVE an adapter — for every other catalog member getAdapter() THROWS
// (UnsupportedBrokerError). So the account picker, which must offer brokers we cannot yet
// connect to, cannot be built on adapters. It is built on this table instead.
//
// TWO LISTS, ONE ENUM — the distinction the whole account model rests on:
//   CATALOG  (this table)          what an ACCOUNT can be TAGGED as. All 17.
//   LINKABLE (IMPLEMENTED_BROKERS)  what a CONNECTION can be made to. `zerodha` today.
//
// CREATE-NOW-LINK-LATER is the point: a user creates an Angel One account and hand-tracks it
// today. The day the Angel adapter ships, `linkable` flips to true and that account becomes
// connectable — NO DATA MOVES, because the account's identity was right from creation. That is
// the whole reason broker is set at creation rather than at link.
//
// The Record is EXHAUSTIVE on BrokerId: a new enum member without an entry here is a COMPILE
// error. That is deliberate — catalog completeness is LOAD-BEARING: a real broker missing from
// this table is a user with no home. `other` (Stage 1) does NOT relax that — it is the
// not-at-a-broker account, a deliberate user choice, never a catch-all a missing broker falls into.
//
// TWO SURFACES, NO DRIFT: adapter `meta` remains the source for the CONNECT surface
// (brokers-controller / implementedBrokerMeta — untouched); this table is the source for the
// ACCOUNT-CREATION surface. They overlap only on the two brokers that have adapters, and the
// names below match those adapters' meta.
// ═══════════════════════════════════════════════════════════════════════
import type { BrokerId } from "./types.js";
import { IMPLEMENTED_BROKERS } from "./registry.js";

interface CatalogLabel {
  displayName: string;
  /** Asset key the frontend resolves to a logo — a ref, not bytes (same contract as BrokerMeta). */
  logoRef: string;
  /** Offered in the account-creation picker. `mock` is false: it is creatable via the API
   *  (harnesses need it) but must never be shown to a user. */
  pickable: boolean;
}

const LABELS: Record<BrokerId, CatalogLabel> = {
  mock: { displayName: "Mock Broker", logoRef: "brokers/mock.svg", pickable: false }, // test-only — API-creatable, never offered
  zerodha: { displayName: "Zerodha", logoRef: "brokers/zerodha.svg", pickable: true },
  upstox: { displayName: "Upstox", logoRef: "brokers/upstox.svg", pickable: true },
  groww: { displayName: "Groww", logoRef: "brokers/groww.svg", pickable: true },
  angelone: { displayName: "Angel One", logoRef: "brokers/angelone.svg", pickable: true },
  dhan: { displayName: "Dhan", logoRef: "brokers/dhan.svg", pickable: true },
  fyers: { displayName: "Fyers", logoRef: "brokers/fyers.svg", pickable: true },
  icicidirect: { displayName: "ICICI Direct", logoRef: "brokers/icicidirect.svg", pickable: true },
  hdfcsecurities: { displayName: "HDFC Securities", logoRef: "brokers/hdfcsecurities.svg", pickable: true },
  kotak: { displayName: "Kotak Securities", logoRef: "brokers/kotak.svg", pickable: true },
  sharekhan: { displayName: "Sharekhan", logoRef: "brokers/sharekhan.svg", pickable: true },
  fivepaisa: { displayName: "5paisa", logoRef: "brokers/fivepaisa.svg", pickable: true },
  motilaloswal: { displayName: "Motilal Oswal", logoRef: "brokers/motilaloswal.svg", pickable: true },
  iifl: { displayName: "IIFL Securities", logoRef: "brokers/iifl.svg", pickable: true },
  sbisecurities: { displayName: "SBI Securities", logoRef: "brokers/sbisecurities.svg", pickable: true },
  paytmmoney: { displayName: "Paytm Money", logoRef: "brokers/paytmmoney.svg", pickable: true },
  axisdirect: { displayName: "Axis Direct", logoRef: "brokers/axisdirect.svg", pickable: true },
  // Stage 1 — the NOT-AT-A-BROKER account (SGB from a bank, direct NSDL bond, physical holding). A
  // real place capital lives, so it IS offered in the account-creation picker (pickable: true). It
  // is never LINKABLE: it has no adapter, so `linkable` derives false from IMPLEMENTED_BROKERS on
  // its own — the /link path refuses it explicitly (see linkAccount's `other` guard).
  other: { displayName: "Not at a broker", logoRef: "brokers/other.svg", pickable: true },
};

export interface BrokerCatalogEntry {
  id: BrokerId;
  displayName: string;
  logoRef: string;
  /** Has a working adapter ⇒ an account tagged with it can be CONNECTED to the real feed.
   *  false ⇒ catalog-only: create + hand-track now, link when the adapter ships. */
  linkable: boolean;
}

/** Every catalog broker (incl. `mock`) — the validation surface. */
export function brokerCatalog(): BrokerCatalogEntry[] {
  return (Object.keys(LABELS) as BrokerId[]).map((id) => ({
    id,
    displayName: LABELS[id].displayName,
    logoRef: LABELS[id].logoRef,
    // DERIVED, never duplicated — `linkable` cannot drift from the registry's own gate.
    linkable: IMPLEMENTED_BROKERS.includes(id),
  }));
}

/** The account-creation PICKER list — the catalog minus the test broker. What a user sees. */
export function pickableBrokers(): BrokerCatalogEntry[] {
  return brokerCatalog().filter((b) => LABELS[b.id].pickable);
}

/** Is this string a catalog broker? The account-creation / retag validation gate. Accepts
 *  `mock` (API-creatable) — pickability is a DISPLAY concern, not a validity one. */
export function isCatalogBroker(broker: string): broker is BrokerId {
  return Object.prototype.hasOwnProperty.call(LABELS, broker);
}

/** Display name for a broker id — for error messages that must name the broker honestly. */
export function brokerDisplayName(broker: BrokerId): string {
  return LABELS[broker].displayName;
}
