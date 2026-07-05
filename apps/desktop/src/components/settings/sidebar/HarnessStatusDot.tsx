import type { AgentSummary } from "@anyharness/sdk";

interface HarnessStatusDotProps {
  agent: AgentSummary | undefined;
}

export function HarnessStatusDot({ agent }: HarnessStatusDotProps) {
  if (!agent) {
    return null;
  }

  // Don't show a dot if not yet installed
  if (agent.installState === "install_required") {
    return null;
  }

  let colorClass: string;
  if (agent.installState === "failed") {
    colorClass = "bg-destructive";
  } else if (agent.credentialState === "ready") {
    colorClass = "bg-success";
  } else if (agent.credentialState === "login_required" || agent.credentialState === "missing_env") {
    colorClass = "bg-warning";
  } else {
    // unknown or other states → red
    colorClass = "bg-destructive";
  }

  return <span className={`size-2 rounded-full ${colorClass}`} />;
}
