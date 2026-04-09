import { useCallback, useMemo, useState } from "react";
import type { OpenTarget, OpenTargetIconId } from "@/platform/tauri/shell";
import { useShallow } from "zustand/react/shallow";
import { useAvailableEditors } from "@/hooks/settings/use-available-editors";
import { resolvePreferredOpenTarget } from "@/lib/domain/chat/preference-resolvers";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

export interface SetupOpenTargetOption {
  id: string;
  label: string;
  iconId?: OpenTargetIconId;
}

export interface SetupOpenTargetStepState {
  options: SetupOpenTargetOption[];
  selectedId: string;
  onSelect: (targetId: string | null) => void;
  onContinue: () => void;
}

const EMPTY_EDITOR_OPTIONS: SetupOpenTargetOption[] = [];

function buildOpenTargets(editorOptions: SetupOpenTargetOption[]): OpenTarget[] {
  return [
    ...editorOptions.map((editor) => ({
      id: editor.id,
      label: editor.label,
      kind: "editor" as const,
      iconId: editor.iconId,
    })),
    {
      id: "finder",
      label: "Finder",
      kind: "finder" as const,
      iconId: "finder" as const,
    },
    {
      id: "terminal",
      label: "Terminal",
      kind: "terminal" as const,
      iconId: "terminal" as const,
    },
  ];
}

export function useSetupOpenTargetStep(): SetupOpenTargetStepState {
  const { data: editorOptions = EMPTY_EDITOR_OPTIONS } = useAvailableEditors();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    set: state.set,
  })));
  const [openTargetDraft, setOpenTargetDraft] = useState<string | null>(null);

  const openTargets = useMemo(
    () => buildOpenTargets(editorOptions),
    [editorOptions],
  );

  const options = useMemo(
    () => openTargets.map(({ id, label, iconId }) => ({ id, label, iconId })),
    [openTargets],
  );

  const selectedId = openTargetDraft
    ?? resolvePreferredOpenTarget(openTargets, {
      defaultOpenInTargetId: preferences.defaultOpenInTargetId,
    })?.id
    ?? "";

  const onSelect = useCallback((targetId: string | null) => {
    setOpenTargetDraft(targetId);
  }, []);

  const onContinue = useCallback(() => {
    if (!selectedId) {
      return;
    }

    preferences.set("defaultOpenInTargetId", selectedId);
  }, [preferences, selectedId]);

  return useMemo(() => ({
    onContinue,
    onSelect,
    options,
    selectedId,
  }), [onContinue, onSelect, options, selectedId]);
}
