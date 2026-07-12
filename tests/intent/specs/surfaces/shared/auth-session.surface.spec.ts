import { prepareSurfacePrincipal, test, expect } from "../../../stack/surface-fixture.ts";
import { expectedClientId } from "../../../stack/surface-contract.ts";

// Harness readiness only: this proves each real host can establish its own
// session and reach a shared server-backed shell. Product parity scenarios
// (chat, settings, billing, and so on) remain separate host-neutral specs.
test("establishes the host-specific session and reaches the product shell", async ({ surface }) => {
  const principal = await prepareSurfacePrincipal();
  const observation = await surface.signIn(principal);

  expect(observation.clientId).toBe(expectedClientId(surface.lane));
  expect(observation.principalEmail).toBe(principal.email);
  expect(observation.organizationId).toBe(principal.organizationId);
});
