export function resolveSessionCreationModeId(input: {
  explicitModeId?: string | null;
  preferredModeId?: string | null;
}): string | undefined {
  const explicitModeId = input.explicitModeId?.trim() || undefined;
  if (explicitModeId) {
    return explicitModeId;
  }

  return input.preferredModeId?.trim() || undefined;
}
