import type { AgentSummary } from "@anyharness/sdk";
import { agentNeedsInstall } from "@/lib/domain/agents/status";

/**
 * First-run auth adoption (spec §9, PR 12).
 *
 * When the user has NO route selections yet, the desktop adopts what the
 * local AnyHarness credential scan already detected:
 * - each harness with detected native auth → (harness, local, native)
 * - nothing detected → preselect the managed gateway for installed
 *   harnesses (only when the gateway is enabled for the account)
 *
 * The plan is only produced when zero selections exist, which makes the
 * whole flow idempotent: after the first write (or any manual choice in
 * settings) later runs are a no-op.
 */

export interface AuthAdoptionAction {
  harnessKind: string;
  surface: "local";
  route: "native" | "gateway";
}

export interface FirstRunAuthAdoptionInput {
  agents: AgentSummary[];
  /** Existing route selections across all surfaces. */
  selectionCount: number;
  gatewayEnabled: boolean;
}

/** Native credentials detected by the local AnyHarness credential scan. */
export function hasDetectedNativeAuth(agent: AgentSummary): boolean {
  return agent.credentialState === "ready" && agent.installState === "installed";
}

/** Which authentication surface the settings pane shows for a harness. */
export type AgentAuthDisplay = "auth-controls" | "install-gate" | "loading";

/**
 * Decide what to render for a harness's auth section (spec §9).
 *
 * A missing or not-yet-loaded local agent record must NOT fall through to the
 * full auth controls — that would let a user pick a route for a harness that
 * isn't installed/known yet. Missing → install gate; still loading → loading;
 * only a present, installed record gets the auth controls.
 */
export function resolveAgentAuthDisplay(
  localAgent: AgentSummary | null,
  agentsLoading: boolean,
): AgentAuthDisplay {
  if (!localAgent) {
    return agentsLoading ? "loading" : "install-gate";
  }
  return agentNeedsInstall(localAgent) ? "install-gate" : "auth-controls";
}

export function planFirstRunAuthAdoption(
  input: FirstRunAuthAdoptionInput,
): AuthAdoptionAction[] {
  if (input.selectionCount > 0) {
    return [];
  }

  const detected = input.agents.filter(hasDetectedNativeAuth);
  if (detected.length > 0) {
    return detected.map((agent) => ({
      harnessKind: agent.kind,
      surface: "local",
      route: "native",
    }));
  }

  if (!input.gatewayEnabled) {
    return [];
  }

  return input.agents
    .filter((agent) => agent.installState === "installed")
    .map((agent) => ({
      harnessKind: agent.kind,
      surface: "local",
      route: "gateway",
    }));
}
