import { resolveCoworkDefaultSessionModeId } from "@/lib/domain/cowork/session-mode-defaults";

export function resolveSessionCreationModeId(input: {
  explicitModeId?: string | null;
  workspaceSurface: string | null | undefined;
  agentKind: string;
  preferredModeId?: string | null;
}): string | undefined {
  const explicitModeId = input.explicitModeId?.trim() || undefined;
  if (explicitModeId) {
    return explicitModeId;
  }

  if (input.workspaceSurface === "cowork") {
    return resolveCoworkDefaultSessionModeId(input.agentKind);
  }

  return input.preferredModeId?.trim() || undefined;
}
