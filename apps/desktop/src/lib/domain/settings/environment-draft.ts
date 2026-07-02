export interface LocalEnvironmentDraft {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: string | null | undefined): string {
  return value ?? "";
}

export function normalizeLocalEnvironmentDraft(
  config: Partial<LocalEnvironmentDraft> | null | undefined,
): LocalEnvironmentDraft {
  return {
    defaultBranch: normalizeNullableText(config?.defaultBranch),
    setupScript: normalizeText(config?.setupScript),
    runCommand: normalizeText(config?.runCommand),
  };
}

export function isLocalEnvironmentDraftDirty(
  draft: LocalEnvironmentDraft,
  baseline: LocalEnvironmentDraft,
): boolean {
  const normalizedDraft = normalizeLocalEnvironmentDraft(draft);
  const normalizedBaseline = normalizeLocalEnvironmentDraft(baseline);
  return normalizedDraft.defaultBranch !== normalizedBaseline.defaultBranch
    || normalizedDraft.setupScript !== normalizedBaseline.setupScript
    || normalizedDraft.runCommand !== normalizedBaseline.runCommand;
}

export function buildLocalEnvironmentSavePatch(
  draft: LocalEnvironmentDraft,
): LocalEnvironmentDraft {
  return normalizeLocalEnvironmentDraft(draft);
}
