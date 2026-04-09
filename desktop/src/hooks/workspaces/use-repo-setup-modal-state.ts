import { useState } from "react";
import type { SetupHint } from "@anyharness/sdk";
import { useRepoPreferencesStore } from "@/stores/preferences/repo-preferences-store";

/**
 * Local draft state for the repo setup modal. Unlike useRepositorySettings,
 * this hook does NOT auto-save — changes are only persisted when save() is
 * called explicitly. This ensures Skip truly means "don't save."
 */
export function useRepoSetupModalState(sourceRoot: string) {
  const savedConfig = useRepoPreferencesStore((state) => state.repoConfigs[sourceRoot]);
  const [branchDraft, setBranchDraft] = useState<string | null>(
    savedConfig?.defaultBranch ?? null,
  );
  const [scriptDraftState, setScriptDraftState] = useState(savedConfig?.setupScript ?? "");
  const [scriptDirty, setScriptDirty] = useState(false);
  const setRepoConfig = useRepoPreferencesStore((s) => s.setRepoConfig);

  function setScriptDraft(value: string) {
    setScriptDirty(true);
    setScriptDraftState(value);
  }

  /**
   * Initialize the script draft from detection hints. Build tool hints
   * default ON, secret sync hints default OFF.
   */
  function initializeFromHints(hints: SetupHint[]) {
    if ((savedConfig?.setupScript ?? "").trim().length > 0 || scriptDirty) {
      return;
    }

    const defaultCommands = hints
      .filter((h) => h.category === "build_tool")
      .map((h) => h.suggestedCommand);
    setScriptDraftState(defaultCommands.join("\n"));
  }

  function save() {
    setRepoConfig(sourceRoot, {
      defaultBranch: branchDraft,
      setupScript: scriptDraftState,
    });
  }

  return {
    branchDraft,
    setBranchDraft,
    scriptDraft: scriptDraftState,
    setScriptDraft,
    initializeFromHints,
    save,
  };
}
