// ═══════════════════════════════════════════════════════════════════════
// AI PROVIDER REGISTRY — the SINGLE place an AiProviderId maps to a concrete
// adapter. This is the one and only provider-specific branch in the whole app;
// callers resolve a provider here and then touch ONLY the AiProvider interface, so
// no provider-specific logic ever leaks into the core.
//
// Selection order: explicit arg → AI_PROVIDER env → "mock". The default is "mock"
// ON PURPOSE — it needs no key and never hits a paid API, so a misconfigured or
// unconfigured deploy degrades to a safe stub rather than crashing or billing.
//
// Adding a provider = write its adapter, add ONE line here, add its id to
// AI_PROVIDER_IDS in types.ts. Done.
// ═══════════════════════════════════════════════════════════════════════
import { createGeminiAdapter } from "./adapters/gemini.js";
import { createMockAdapter } from "./adapters/mock.js";
import {
  AI_PROVIDER_IDS,
  isAiProviderId,
  type AiProvider,
  type AiProviderId,
} from "./types.js";

/** Adapter FACTORIES — the ONE and ONLY place a provider id binds to a concrete
 *  adapter. Exhaustive on AiProviderId by design: adding a provider id without a
 *  line here is a COMPILE error, not a runtime surprise. */
const REGISTRY: Record<AiProviderId, () => AiProvider> = {
  gemini: createGeminiAdapter,
  mock: createMockAdapter,
};

/** Resolve an AI provider. `name` wins; else AI_PROVIDER env; else "mock". Throws a
 *  contextual error if the resolved id is not a modelled provider. */
export function createAiProvider(name?: AiProviderId): AiProvider {
  const resolved = name ?? process.env.AI_PROVIDER ?? "mock";
  if (!isAiProviderId(resolved)) {
    throw new Error(
      `Unknown AI provider: "${resolved}". Valid options: ${AI_PROVIDER_IDS.join(", ")}`,
    );
  }
  return REGISTRY[resolved]();
}
