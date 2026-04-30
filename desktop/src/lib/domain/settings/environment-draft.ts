export interface LocalEnvironmentDraft {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

export interface CloudEnvironmentSavedConfig {
  configured?: boolean;
  defaultBranch?: string | null;
  envVars?: Record<string, string>;
  trackedFiles?: readonly { relativePath: string }[];
  setupScript?: string;
  runCommand?: string;
}

export interface CloudEnvironmentDraft {
  configured: boolean;
  defaultBranch: string | null;
  envVars: Record<string, string>;
  trackedFilePaths: string[];
  setupScript: string;
  runCommand: string;
}

export interface CloudEnvironmentDraftState {
  baseline: CloudEnvironmentDraft;
  draft: CloudEnvironmentDraft;
}

export interface CloudEnvironmentLocalSeed {
  setupScript: string;
  runCommand: string;
}

export interface CloudEnvironmentSavePayload {
  configured: boolean;
  defaultBranch: string | null;
  envVars: Record<string, string>;
  trackedFilePaths: string[];
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

function normalizeEnvVars(envVars: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envVars ?? {})
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeTrackedFilePaths(paths: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const path of paths ?? []) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function recordsEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(normalizeEnvVars(left));
  const rightEntries = Object.entries(normalizeEnvVars(right));
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value], index) => {
    const rightEntry = rightEntries[index];
    return rightEntry?.[0] === key && rightEntry[1] === value;
  });
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
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

export function normalizeCloudEnvironmentDraft(
  draft: Partial<CloudEnvironmentDraft> | null | undefined,
): CloudEnvironmentDraft {
  return {
    configured: draft?.configured ?? false,
    defaultBranch: normalizeNullableText(draft?.defaultBranch),
    envVars: normalizeEnvVars(draft?.envVars),
    trackedFilePaths: normalizeTrackedFilePaths(draft?.trackedFilePaths),
    setupScript: normalizeText(draft?.setupScript),
    runCommand: normalizeText(draft?.runCommand),
  };
}

export function buildCloudEnvironmentBaseline(
  savedConfig: CloudEnvironmentSavedConfig | null | undefined,
): CloudEnvironmentDraft {
  const configured = savedConfig?.configured ?? false;
  if (!configured) {
    return normalizeCloudEnvironmentDraft({ configured: false });
  }

  return normalizeCloudEnvironmentDraft({
    configured,
    defaultBranch: savedConfig?.defaultBranch ?? null,
    envVars: savedConfig?.envVars ?? {},
    trackedFilePaths: savedConfig?.trackedFiles?.map((file) => file.relativePath) ?? [],
    setupScript: savedConfig?.setupScript ?? "",
    runCommand: savedConfig?.runCommand ?? "",
  });
}

export function buildInitialCloudEnvironmentDraft(
  savedConfig: CloudEnvironmentSavedConfig | null | undefined,
  localSeed: CloudEnvironmentLocalSeed,
): CloudEnvironmentDraft {
  const baseline = buildCloudEnvironmentBaseline(savedConfig);
  if (baseline.configured) {
    return baseline;
  }

  return normalizeCloudEnvironmentDraft({
    configured: true,
    defaultBranch: null,
    envVars: {},
    trackedFilePaths: [],
    setupScript: localSeed.setupScript,
    runCommand: localSeed.runCommand,
  });
}

export function buildInitialCloudEnvironmentDraftState(
  savedConfig: CloudEnvironmentSavedConfig | null | undefined,
  localSeed: CloudEnvironmentLocalSeed,
): CloudEnvironmentDraftState {
  return {
    baseline: buildCloudEnvironmentBaseline(savedConfig),
    draft: buildInitialCloudEnvironmentDraft(savedConfig, localSeed),
  };
}

export function buildSavedCloudEnvironmentDraftState(
  savedConfig: CloudEnvironmentSavedConfig | null | undefined,
): CloudEnvironmentDraftState {
  const baseline = buildCloudEnvironmentBaseline(savedConfig);
  return {
    baseline,
    draft: baseline,
  };
}

export function isCloudEnvironmentDraftDirty(
  draft: CloudEnvironmentDraft,
  baseline: CloudEnvironmentDraft,
): boolean {
  const normalizedDraft = normalizeCloudEnvironmentDraft(draft);
  const normalizedBaseline = normalizeCloudEnvironmentDraft(baseline);
  return normalizedDraft.configured !== normalizedBaseline.configured
    || normalizedDraft.defaultBranch !== normalizedBaseline.defaultBranch
    || normalizedDraft.setupScript !== normalizedBaseline.setupScript
    || normalizedDraft.runCommand !== normalizedBaseline.runCommand
    || !recordsEqual(normalizedDraft.envVars, normalizedBaseline.envVars)
    || !arraysEqual(normalizedDraft.trackedFilePaths, normalizedBaseline.trackedFilePaths);
}

export function isCloudEnvironmentDraftConfigurable(
  draft: CloudEnvironmentDraft,
  baseline: CloudEnvironmentDraft,
): boolean {
  const normalizedDraft = normalizeCloudEnvironmentDraft(draft);
  const normalizedBaseline = normalizeCloudEnvironmentDraft(baseline);
  return !normalizedBaseline.configured && normalizedDraft.configured;
}

export function buildCloudEnvironmentSavePayload(
  draft: CloudEnvironmentDraft,
): CloudEnvironmentSavePayload {
  const normalizedDraft = normalizeCloudEnvironmentDraft(draft);
  if (!normalizedDraft.configured) {
    return buildCloudEnvironmentDisablePayload();
  }

  return {
    configured: true,
    defaultBranch: normalizedDraft.defaultBranch,
    envVars: normalizedDraft.envVars,
    trackedFilePaths: normalizedDraft.trackedFilePaths,
    setupScript: normalizedDraft.setupScript,
    runCommand: normalizedDraft.runCommand,
  };
}

export function buildDisabledCloudEnvironmentDraft(): CloudEnvironmentDraft {
  return normalizeCloudEnvironmentDraft({ configured: false });
}

export function buildCloudEnvironmentDisablePayload(): CloudEnvironmentSavePayload {
  return {
    configured: false,
    defaultBranch: null,
    envVars: {},
    trackedFilePaths: [],
    setupScript: "",
    runCommand: "",
  };
}
