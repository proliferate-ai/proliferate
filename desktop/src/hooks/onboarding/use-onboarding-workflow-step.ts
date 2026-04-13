import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { OpenTargetIconId } from "@/platform/tauri/shell";
import { useAvailableEditors } from "@/hooks/settings/use-available-editors";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export interface OnboardingWorkflowOpenTargetOption {
  id: string;
  label: string;
  iconId?: OpenTargetIconId;
}

export interface OnboardingWorkflowStepState {
  openTargetOptions: OnboardingWorkflowOpenTargetOption[];
  selectedOpenTargetId: string;
  setOpenTargetId: (id: string) => void;
  persistOpenTarget: () => void;
  canContinue: boolean;
}

const EMPTY_EDITORS: Array<{ id: string; label: string; iconId?: OpenTargetIconId }> = [];

export function useOnboardingWorkflowStep(): OnboardingWorkflowStepState {
  const { data: editorOptions = EMPTY_EDITORS } = useAvailableEditors();
  const preferences = useUserPreferencesStore(
    useShallow((state) => ({
      defaultOpenInTargetId: state.defaultOpenInTargetId,
      set: state.set,
    })),
  );

  const openTargetOptions = useMemo<OnboardingWorkflowOpenTargetOption[]>(
    () => [
      ...editorOptions.map((editor) => ({
        id: editor.id,
        label: editor.label,
        iconId: editor.iconId,
      })),
      { id: "finder", label: "Finder", iconId: "finder" as const },
      { id: "terminal", label: "Terminal", iconId: "terminal" as const },
    ],
    [editorOptions],
  );

  const preferredTargetId = useMemo(() => {
    const preferred = resolvePreferredOpenTarget(
      openTargetOptions.map((option) => ({
        id: option.id,
        label: option.label,
        kind: option.id === "finder"
          ? ("finder" as const)
          : option.id === "terminal"
            ? ("terminal" as const)
            : ("editor" as const),
        iconId: option.iconId,
      })),
      { defaultOpenInTargetId: preferences.defaultOpenInTargetId },
    );
    return preferred?.id ?? openTargetOptions[0]?.id ?? "";
  }, [openTargetOptions, preferences.defaultOpenInTargetId]);

  const [openTargetDraft, setOpenTargetDraft] = useState<string | null>(null);

  const selectedOpenTargetId = openTargetDraft ?? preferredTargetId;

  const setOpenTargetId = useCallback((id: string) => {
    setOpenTargetDraft(id);
  }, []);

  const persistOpenTarget = useCallback(() => {
    if (!selectedOpenTargetId) return;
    if (preferences.defaultOpenInTargetId === selectedOpenTargetId) return;
    preferences.set("defaultOpenInTargetId", selectedOpenTargetId);
  }, [preferences, selectedOpenTargetId]);

  return useMemo<OnboardingWorkflowStepState>(
    () => ({
      openTargetOptions,
      selectedOpenTargetId,
      setOpenTargetId,
      persistOpenTarget,
      canContinue: !!selectedOpenTargetId,
    }),
    [openTargetOptions, persistOpenTarget, selectedOpenTargetId, setOpenTargetId],
  );
}
