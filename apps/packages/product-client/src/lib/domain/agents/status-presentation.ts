import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import { AGENT_SETUP_COPY } from "#product/copy/agents/agents-copy";
import { AGENT_READINESS_LABELS } from "#product/lib/domain/agents/readiness-presentation";

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

