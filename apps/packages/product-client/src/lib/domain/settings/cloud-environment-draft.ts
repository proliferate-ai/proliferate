import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";

export interface CloudEnvironmentDraftSeed {
  setupScript: string;
  runCommand: string;
}

export interface CloudEnvironmentDraftValues {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

export interface CloudEnvironmentDraftState {
  sourceKey: string;
  revertDraft: CloudEnvironmentDraftValues;
  draft: CloudEnvironmentDraftValues;
}

export function buildCloudEnvironmentDraftBaseline(
  environment: RepoEnvironmentResponse | null,
  seed: CloudEnvironmentDraftSeed | null,
): CloudEnvironmentDraftValues {
  if (environment) {
    return {
      defaultBranch: environment.defaultBranch ?? null,
      setupScript: environment.setupScript ?? "",
      runCommand: environment.runCommand ?? "",
    };
  }
  return {
    defaultBranch: null,
    setupScript: seed?.setupScript ?? "",
    runCommand: seed?.runCommand ?? "",
  };
}

export function cloudEnvironmentDraftsDiffer(
  left: CloudEnvironmentDraftValues,
  right: CloudEnvironmentDraftValues,
): boolean {
  return left.defaultBranch !== right.defaultBranch
    || left.setupScript !== right.setupScript
    || left.runCommand !== right.runCommand;
}

export function createCloudEnvironmentDraftState(
  sourceKey: string,
  baseline: CloudEnvironmentDraftValues,
): CloudEnvironmentDraftState {
  return {
    sourceKey,
    revertDraft: baseline,
    draft: baseline,
  };
}

export function shouldRebaselineCloudEnvironmentDraft(
  state: CloudEnvironmentDraftState,
  sourceKey: string,
  baseline: CloudEnvironmentDraftValues,
): boolean {
  if (state.sourceKey !== sourceKey) {
    return true;
  }
  if (cloudEnvironmentDraftsDiffer(state.draft, state.revertDraft)) {
    return false;
  }
  return cloudEnvironmentDraftsDiffer(baseline, state.revertDraft);
}

export function rebaselineCloudEnvironmentDraft(
  sourceKey: string,
  baseline: CloudEnvironmentDraftValues,
): CloudEnvironmentDraftState {
  return createCloudEnvironmentDraftState(sourceKey, baseline);
}

export function patchCloudEnvironmentDraft(
  state: CloudEnvironmentDraftState,
  partial: Partial<CloudEnvironmentDraftValues>,
): CloudEnvironmentDraftState {
  return {
    ...state,
    draft: {
      ...state.draft,
      ...partial,
    },
  };
}

export function revertCloudEnvironmentDraft(
  state: CloudEnvironmentDraftState,
): CloudEnvironmentDraftState {
  return {
    ...state,
    draft: state.revertDraft,
  };
}

export function resetCloudEnvironmentDraft(
  state: CloudEnvironmentDraftState,
  next: RepoEnvironmentResponse,
): CloudEnvironmentDraftState {
  const nextBaseline = buildCloudEnvironmentDraftBaseline(next, null);
  return {
    sourceKey: state.sourceKey,
    revertDraft: nextBaseline,
    draft: nextBaseline,
  };
}
