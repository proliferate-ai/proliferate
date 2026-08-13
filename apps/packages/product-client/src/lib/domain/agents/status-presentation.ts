import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import { AGENT_SETUP_COPY } from "#product/copy/agents/agents-copy";
import { AGENT_READINESS_LABELS } from "#product/lib/domain/agents/readiness-presentation";
import type { StatusDotTone } from "#product/primitives/StatusDot";

export type AgentStatusTone =
  | "muted"
  | "success"
  | "warning"
  | "destructive";

export interface AgentStatusDisplay {
  label: string;
  tone: AgentStatusTone;
}

export function getAgentStatusDisplay(
  agent: AgentSummary,
  options?: {
    reconcileResult?: ReconcileAgentResult;
    isReconciling?: boolean;
  },
): AgentStatusDisplay {
  if (options?.reconcileResult?.outcome === "failed") {
    return {
      label: AGENT_SETUP_COPY.installFailed,
      tone: "destructive",
    };
  }

  if (options?.reconcileResult?.outcome === "installed") {
    return {
      label: AGENT_SETUP_COPY.justInstalled,
      tone: "success",
    };
  }

  if (agent.installState === "installing") {
    return {
      label: AGENT_SETUP_COPY.installing,
      tone: "muted",
    };
  }

  if (agent.readiness === "ready") {
    return {
      label: AGENT_READINESS_LABELS.ready,
      tone: "success",
    };
  }

  if (
    agent.readiness === "install_required"
    || agent.readiness === "credentials_required"
    || agent.readiness === "login_required"
  ) {
    return {
      label: AGENT_READINESS_LABELS[agent.readiness],
      tone: "warning",
    };
  }

  if (agent.readiness === "error") {
    return {
      label: AGENT_READINESS_LABELS.error,
      tone: "destructive",
    };
  }

  return {
    label: AGENT_READINESS_LABELS[agent.readiness],
    tone: "muted",
  };
}

/**
 * The settings sidebar's per-harness attention dot: `null` when the harness
 * needs nothing from the user, a `StatusDot` tone when it does.
 *
 * Deliberately narrower than `getAgentStatusDisplay`: a ready harness shows
 * no dot at all (a green dot for the normal case is clutter), and a
 * route-upgraded harness with no vendor-CLI login counts as ready — a
 * gateway-routed harness launches fine, so flagging it would ask the user to
 * fix a non-problem (the "never show CredentialsRequired for a harness that
 * would launch fine" rule in agent-distribution.md). Any "authenticated
 * how?" detail belongs in the harness's own auth pane, which shows the
 * selected route, not in an attention dot.
 */
export function getHarnessAttentionDotTone(
  agent: AgentSummary | undefined,
): StatusDotTone | null {
  if (!agent) {
    return null;
  }
  if (agent.installState === "install_required") {
    return null;
  }
  if (agent.credentialState === "ready" && agent.installState !== "failed") {
    return null;
  }
  if (agent.installState === "failed") {
    return "danger";
  }
  if (agent.credentialState === "login_required" || agent.credentialState === "missing_env") {
    return "warning";
  }
  return "danger";
}

