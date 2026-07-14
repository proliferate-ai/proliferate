import type { TerminalStreamIdentity } from "./terminal-stream-registry";

export function createTerminalRuntimeIdentity(input: {
  runtimeUrl: string;
  anyharnessWorkspaceId: string;
  runtimeGeneration?: number;
}): string {
  return [
    input.runtimeUrl.replace(/\/+$/, ""),
    input.anyharnessWorkspaceId,
    input.runtimeGeneration?.toString() ?? "",
  ].join("\u0000");
}

export function terminalStreamKey(identity: TerminalStreamIdentity): string {
  return [
    identity.workspaceId,
    identity.terminalId,
    identity.runtimeIdentity,
    identity.cloudAuthorityScopeKey ?? "",
  ].join("\u0000");
}
