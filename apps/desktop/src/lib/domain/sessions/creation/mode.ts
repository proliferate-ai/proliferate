import { resolveUnattendedModeId } from "@/lib/domain/agents/unattended-mode";

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
    // Cowork owns the access policy: run unattended per the catalog's curated
    // per-family mode (undefined → send no mode, e.g. grok).
    return resolveUnattendedModeId(input.agentKind);
  }

  return input.preferredModeId?.trim() || undefined;
}
