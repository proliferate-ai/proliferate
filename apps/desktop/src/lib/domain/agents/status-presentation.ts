import type {
  AgentSummary,
  ReconcileAgentResult,
} from "@anyharness/sdk";
import { AGENT_SETUP_COPY } from "@/copy/agents/agents-copy";
import { AGENT_READINESS_LABELS } from "@/lib/domain/agents/readiness-presentation";

export type AgentStatusTone =
  | "muted"
  | "success"
  | "warning"
  | "destructive";

export type AgentReconcileState =
  | "idle"
  | "reconciling"
  | "done"
  | "error";

export interface AgentStatusDisplay {
  label: string;
  tone: AgentStatusTone;
}

export function formatAgentEnvVarLabel(name: string): string {
  return name
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bApi\b/g, "API")
    .replace(/\bUrl\b/g, "URL")
    .replace(/\bSdk\b/g, "SDK")
    .replace(/\bId\b/g, "ID");
}

export function getAgentStatusDisplay(
  agent: AgentSummary,
  options?: {
    reconcileResult?: ReconcileAgentResult;
    isReconciling?: boolean;
  },
): AgentStatusDisplay {
  if (options?.isReconciling) {
    return {
      label: AGENT_SETUP_COPY.installing,
      tone: "muted",
    };
  }

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

export function getAgentSetupSubtitle(
  agent: AgentSummary,
  reconcileResult?: ReconcileAgentResult,
): string {
  if (agent.readiness === "ready") {
    return AGENT_SETUP_COPY.subtitles.ready;
  }

  if (agent.readiness === "unsupported") {
    return AGENT_SETUP_COPY.subtitles.unsupported;
  }

  if (
    agent.readiness === "install_required"
    && (
      reconcileResult?.outcome === "failed"
      || reconcileResult?.outcome === "installed"
    )
  ) {
    return AGENT_SETUP_COPY.subtitles.retryInstall;
  }

  if (agent.readiness === "install_required") {
    return AGENT_SETUP_COPY.subtitles.install;
  }

  return AGENT_SETUP_COPY.subtitles.credentials;
}

export function getAgentDetailText(
  agent: AgentSummary,
  reconcileResult?: ReconcileAgentResult,
): string {
  if (
    reconcileResult?.outcome === "failed"
    && reconcileResult.message
    && reconcileResult.message.trim().length > 0
  ) {
    return reconcileResult.message;
  }

  if (agent.message && agent.readiness !== "ready") {
    return agent.message;
  }

  return agent.supportsLogin || agent.expectedEnvVars.length > 0
    ? "Credentials can be managed from the setup dialog."
    : "No additional credentials are required.";
}
