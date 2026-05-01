import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLocalEnvironmentSavePatch,
  isLocalEnvironmentDraftDirty,
  normalizeLocalEnvironmentDraft,
  type LocalEnvironmentDraft,
} from "@/lib/domain/settings/environment-draft";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

type LocalEnvironmentDraftField = keyof LocalEnvironmentDraft;

type LocalEnvironmentDraftDirtyFields = Record<LocalEnvironmentDraftField, boolean>;

interface RepoSetupModalDraftState {
  sourceRoot: string;
  baseline: LocalEnvironmentDraft;
  draft: LocalEnvironmentDraft;
  dirtyFields: LocalEnvironmentDraftDirtyFields;
}

const CLEAN_DIRTY_FIELDS: LocalEnvironmentDraftDirtyFields = {
  defaultBranch: false,
  setupScript: false,
  runCommand: false,
};

function buildDirtyFields(
  draft: LocalEnvironmentDraft,
  baseline: LocalEnvironmentDraft,
): LocalEnvironmentDraftDirtyFields {
  const normalizedDraft = normalizeLocalEnvironmentDraft(draft);
  const normalizedBaseline = normalizeLocalEnvironmentDraft(baseline);
  return {
    defaultBranch: normalizedDraft.defaultBranch !== normalizedBaseline.defaultBranch,
    setupScript: normalizedDraft.setupScript !== normalizedBaseline.setupScript,
    runCommand: normalizedDraft.runCommand !== normalizedBaseline.runCommand,
  };
}

function mergePersistedDraft(
  current: RepoSetupModalDraftState,
  sourceRoot: string,
  persistedDraft: LocalEnvironmentDraft,
): RepoSetupModalDraftState {
  if (current.sourceRoot !== sourceRoot) {
    return {
      sourceRoot,
      baseline: persistedDraft,
      draft: persistedDraft,
      dirtyFields: CLEAN_DIRTY_FIELDS,
    };
  }

  const draft = normalizeLocalEnvironmentDraft({
    defaultBranch: current.dirtyFields.defaultBranch
      ? current.draft.defaultBranch
      : persistedDraft.defaultBranch,
    setupScript: current.dirtyFields.setupScript
      ? current.draft.setupScript
      : persistedDraft.setupScript,
    runCommand: current.dirtyFields.runCommand
      ? current.draft.runCommand
      : persistedDraft.runCommand,
  });

  return {
    sourceRoot,
    baseline: persistedDraft,
    draft,
    dirtyFields: buildDirtyFields(draft, persistedDraft),
  };
}

/**
 * Local draft state for the repo setup modal. Unlike useRepositorySettings,
 * this hook does NOT auto-save — changes are only persisted when save() is
 * called explicitly. This ensures Skip truly means "don't save."
 */
export function useRepoSetupModalState(sourceRoot: string) {
  const savedConfig = useRepoPreferencesStore((state) => state.repoConfigs[sourceRoot]);
  const setRepoConfig = useRepoPreferencesStore((s) => s.setRepoConfig);
  const persistedDraft = useMemo(
    () => normalizeLocalEnvironmentDraft(savedConfig),
    [savedConfig],
  );
  const [state, setState] = useState<RepoSetupModalDraftState>(() => ({
    sourceRoot,
    baseline: persistedDraft,
    draft: persistedDraft,
    dirtyFields: CLEAN_DIRTY_FIELDS,
  }));
  const dirty = isLocalEnvironmentDraftDirty(state.draft, state.baseline);

  useEffect(() => {
    setState((current) => mergePersistedDraft(current, sourceRoot, persistedDraft));
  }, [persistedDraft, sourceRoot]);

  const setDraft = useCallback((patch: Partial<LocalEnvironmentDraft>) => {
    setState((current) => {
      const draft = normalizeLocalEnvironmentDraft({
        ...current.draft,
        ...patch,
      });
      return {
        ...current,
        draft,
        dirtyFields: buildDirtyFields(draft, current.baseline),
      };
    });
  }, []);

  const save = useCallback(() => {
    const nextConfig = buildLocalEnvironmentSavePatch(state.draft);
    setRepoConfig(sourceRoot, {
      defaultBranch: nextConfig.defaultBranch,
      setupScript: nextConfig.setupScript,
      runCommand: nextConfig.runCommand,
    });
    setState((current) => ({
      ...current,
      baseline: nextConfig,
      draft: nextConfig,
      dirtyFields: CLEAN_DIRTY_FIELDS,
    }));
  }, [setRepoConfig, sourceRoot, state.draft]);

  const revert = useCallback(() => {
    setState((current) => ({
      ...current,
      draft: current.baseline,
      dirtyFields: CLEAN_DIRTY_FIELDS,
    }));
  }, []);

  const setDefaultBranch = useCallback((defaultBranch: string | null) => {
    setDraft({ defaultBranch });
  }, [setDraft]);

  const setSetupScript = useCallback((setupScript: string) => {
    setDraft({ setupScript });
  }, [setDraft]);

  const setRunCommand = useCallback((runCommand: string) => {
    setDraft({ runCommand });
  }, [setDraft]);

  return {
    defaultBranch: state.draft.defaultBranch,
    setDefaultBranch,
    setupScript: state.draft.setupScript,
    setSetupScript,
    runCommand: state.draft.runCommand,
    setRunCommand,
    dirty,
    canRevert: dirty,
    revert,
    save,
  };
}
