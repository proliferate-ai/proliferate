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

  // Don't show a dot for ready state (green dot = clutter for normal state)
  // Only show amber/red dots that flag harnesses needing attention.
  //
  // This dot means "needs your attention", so route-upgraded readiness counts as
  // ready DELIBERATELY: a gateway-routed harness with no vendor-CLI login will
  // launch fine, and flagging it would ask the user to fix a non-problem —
  // exactly the lie agent-distribution.md's route-aware law forbids ("the UI
  // never shows CredentialsRequired for a harness that would launch fine"). Any
  // "authenticated how?" detail belongs in the harness's auth pane, which shows
  // the selected route, not in an attention dot.
  if (agent.credentialState === "ready" && agent.installState !== "failed") {
    return null;
  }

  let colorClass: string;
  if (agent.installState === "failed") {
    colorClass = "bg-destructive";
  } else if (agent.credentialState === "login_required" || agent.credentialState === "missing_env") {
    // The ink token, not `bg-warning`: that is a 15%-alpha FILL, so an 8px dot
    // filled with it is invisible beside its opaque `bg-destructive` sibling.
    colorClass = "bg-warning-foreground";
  } else {
    // unknown or other states → red
    colorClass = "bg-destructive";
  }

  return <span className={`size-2 rounded-full ${colorClass}`} />;
}
