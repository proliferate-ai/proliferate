import { GITHUB_LINK_GATE_WORKAROUND_ACTIVE, isGithubLinkRequiredError } from "./identity.js";
import { ScenarioBlockedError } from "../scenarios/types.js";

/**
 * Wraps a scenario body that talks to a Python-server-mediated cloud route
 * (`current_product_user`-gated: cloud sandboxes, workspaces, secrets, repo
 * environments, the agent-gateway proxy). While
 * `GITHUB_LINK_GATE_WORKAROUND_ACTIVE` is true, a `github_link_required` 403
 * is caught and re-thrown as `ScenarioBlockedError` instead of a real
 * failure — this is the "detect the 403 and mark themselves blocked-with-
 * reason rather than red" behavior named in the tier-3 runner build task.
 * Once the upstream fix (`fix/product-user-single-org-bypass`) merges, flip
 * the flag in `identity.ts` and every call site here resumes asserting the
 * real outcome with no other change.
 */
export async function withProductGate<T>(scenarioId: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (GITHUB_LINK_GATE_WORKAROUND_ACTIVE && isGithubLinkRequiredError(error)) {
      throw new ScenarioBlockedError(
        `${scenarioId}: current_product_user rejected the test account with github_link_required. ` +
          "Password-only local-dev accounts (this runner's fresh/durable identities) have no way to " +
          "link a real GitHub identity without borrowing another profile's session wholesale " +
          "(pseedauth), which is incompatible with a dedicated, persistent e2e-tests durable identity. " +
          "Tracked upstream: fix/product-user-single-org-bypass. Flip " +
          "GITHUB_LINK_GATE_WORKAROUND_ACTIVE in src/fixtures/identity.ts to false once it merges.",
      );
    }
    throw error;
  }
}
