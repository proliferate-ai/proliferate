import { useEffect, useMemo, useState } from "react";
import type { RepoEnvironmentResponse } from "@proliferate/cloud-sdk";

export interface CloudEnvironmentDraftSeed {
  setupScript: string;
  runCommand: string;
}

interface CloudEnvironmentDraftValues {
  defaultBranch: string | null;
  setupScript: string;
  runCommand: string;
}

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

/**
 * Draft state for the per-repository cloud environment editor (default branch,
 * setup script, run command) over the PUT environment endpoint.
 *
 * Baseline comes from the saved environment when one exists; unconfigured
 * environments start from the optional `seed` (the desktop seeds from local
 * repo preferences; cloud-only callers pass none). The draft re-baselines when
 * `sourceKey` changes (switching repos discards a dirty draft) or when it is
 * clean and the incoming baseline changed (e.g. a refetch landed).
 */
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
    () => buildBaseline(environment, seed),
    [environment, seed],
  );
  const [state, setState] = useState(() => ({
    sourceKey,
    revertDraft: baseline,
    draft: baseline,
  }));

  const dirty = draftsDiffer(state.draft, state.revertDraft);

  useEffect(() => {
    const sourceChanged = state.sourceKey !== sourceKey;
    if (!sourceChanged && (dirty || !draftsDiffer(baseline, state.revertDraft))) {
      return;
    }
    setState({
      sourceKey,
      revertDraft: baseline,
      draft: baseline,
    });
  }, [baseline, dirty, sourceKey, state.revertDraft, state.sourceKey]);

  function patch(partial: Partial<CloudEnvironmentDraftValues>) {
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        ...partial,
      },
    }));
  }

  return {
    defaultBranch: state.draft.defaultBranch,
    setupScript: state.draft.setupScript,
    runCommand: state.draft.runCommand,
    dirty,
    canSave: dirty || environment === null,
    setDefaultBranch: (defaultBranch: string | null) => patch({ defaultBranch }),
    setSetupScript: (setupScript: string) => patch({ setupScript }),
    setRunCommand: (runCommand: string) => patch({ runCommand }),
    revert: () => {
      setState((current) => ({
        ...current,
        draft: current.revertDraft,
      }));
    },
    reset: (next: RepoEnvironmentResponse) => {
      const nextBaseline = buildBaseline(next, null);
      setState((current) => ({
        sourceKey: current.sourceKey,
        revertDraft: nextBaseline,
        draft: nextBaseline,
      }));
    },
  };
}

function buildBaseline(
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

function draftsDiffer(
  left: CloudEnvironmentDraftValues,
  right: CloudEnvironmentDraftValues,
): boolean {
  return left.defaultBranch !== right.defaultBranch
    || left.setupScript !== right.setupScript
    || left.runCommand !== right.runCommand;
}
