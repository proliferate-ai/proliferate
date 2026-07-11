import { prepareSurfacePrincipal, test, expect } from "../../../stack/surface-fixture.ts";
import { expectedClientId } from "../../../stack/surface-contract.ts";

test("establishes the host-specific session and reaches the product shell", async ({ surface }) => {
  const principal = await prepareSurfacePrincipal();
  const observation = await surface.signIn(principal);

  expect(observation.clientId).toBe(expectedClientId(surface.lane));
  expect(observation.principalEmail).toBe(principal.email);
  expect(observation.organizationId).toBe(principal.organizationId);
});
