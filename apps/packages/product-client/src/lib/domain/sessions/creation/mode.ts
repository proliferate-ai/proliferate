export function resolveSessionCreationModeId(input: {
  explicitModeId?: string | null;
  workspaceSurface: string | null | undefined;
  unattendedModeId?: string | null;
  preferredModeId?: string | null;
}): string | undefined {
  const explicitModeId = input.explicitModeId?.trim() || undefined;
  if (explicitModeId) {
    return explicitModeId;
  }

  if (input.workspaceSurface === "cowork") {
    return input.unattendedModeId?.trim() || undefined;
  }

  return input.preferredModeId?.trim() || undefined;
}
