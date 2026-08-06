import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";

import {
  buildCloudEnvironmentDraftBaseline,
  cloudEnvironmentDraftsDiffer,
  createCloudEnvironmentDraftState,
  patchCloudEnvironmentDraft,
  rebaselineCloudEnvironmentDraft,
  resetCloudEnvironmentDraft,
  revertCloudEnvironmentDraft,
  shouldRebaselineCloudEnvironmentDraft,
  type CloudEnvironmentDraftSeed,
  type CloudEnvironmentDraftValues,
} from "#product/lib/domain/settings/cloud-environment-draft";

export interface CloudEnvironmentDraft {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
  dirty: boolean;
  canSave: boolean;
  setDefaultBranch: (value: string | null) => void;
  setSetupScript: (value: string) => void;
  setRunCommand: (value: string) => void;
  revert: () => void;
  reset: (next: RepoEnvironmentResponse) => void;
}

/** React state facade for a repository's cloud-environment draft. */
export function useCloudEnvironmentDraft({
  environment,
  sourceKey,
  seed = null,
}: {
  environment: RepoEnvironmentResponse | null;
  sourceKey: string;
  seed?: CloudEnvironmentDraftSeed | null;
}): CloudEnvironmentDraft {
  const baseline = useMemo(
    () => buildCloudEnvironmentDraftBaseline(environment, seed),
    [environment, seed],
  );
  const [state, setState] = useState(() =>
    createCloudEnvironmentDraftState(sourceKey, baseline)
  );

  const dirty = cloudEnvironmentDraftsDiffer(state.draft, state.revertDraft);

  useEffect(() => {
    if (!shouldRebaselineCloudEnvironmentDraft(state, sourceKey, baseline)) {
      return;
    }
    setState(rebaselineCloudEnvironmentDraft(sourceKey, baseline));
  }, [baseline, sourceKey, state]);

  const patch = useCallback((partial: Partial<CloudEnvironmentDraftValues>) => {
    setState((current) => patchCloudEnvironmentDraft(current, partial));
  }, []);
  const setDefaultBranch = useCallback(
    (defaultBranch: string | null) => patch({ defaultBranch }),
    [patch],
  );
  const setSetupScript = useCallback(
    (setupScript: string) => patch({ setupScript }),
    [patch],
  );
  const setRunCommand = useCallback(
    (runCommand: string) => patch({ runCommand }),
    [patch],
  );
  const revert = useCallback(() => {
    setState((current) => revertCloudEnvironmentDraft(current));
  }, []);
  const reset = useCallback((next: RepoEnvironmentResponse) => {
    setState((current) => resetCloudEnvironmentDraft(current, next));
  }, []);

  return useMemo(() => ({
    defaultBranch: state.draft.defaultBranch,
    setupScript: state.draft.setupScript,
    runCommand: state.draft.runCommand,
    dirty,
    canSave: dirty || environment === null,
    setDefaultBranch,
    setSetupScript,
    setRunCommand,
    revert,
    reset,
  }), [
    dirty,
    environment,
    reset,
    revert,
    setDefaultBranch,
    setRunCommand,
    setSetupScript,
    state.draft.defaultBranch,
    state.draft.runCommand,
    state.draft.setupScript,
  ]);
}
