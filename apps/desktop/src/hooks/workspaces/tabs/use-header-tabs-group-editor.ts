import { useCallback, useEffect, useRef, useState } from "react";
import type { ManualChatGroupEditorAnchorRect } from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { useManualChatGroupActions } from "@/hooks/workspaces/tabs/use-manual-chat-group-actions";
import {
  createManualChatGroupId,
  getRandomManualChatGroupColorId,
  type DisplayManualChatGroup,
  type ManualChatGroupColorId,
  type ManualChatGroupId,
} from "@/lib/domain/workspaces/tabs/manual-groups";

export function useHeaderTabsGroupEditor({
  workspaceId,
  displayManualGroups,
  onCreateComplete,
}: {
  workspaceId: string | null;
  displayManualGroups: DisplayManualChatGroup[];
  onCreateComplete: () => void;
}) {
  const { upsertGroup, updateGroup } = useManualChatGroupActions();
  const [groupEditor, setGroupEditor] = useState<ManualGroupEditorState | null>(null);
  const lastGroupEditorAnchorRectRef = useRef<ManualChatGroupEditorAnchorRect | null>(null);

  useEffect(() => {
    // Close stale editor state because its stored anchor rect belongs to the old workspace strip.
    setGroupEditor(null);
    lastGroupEditorAnchorRectRef.current = null;
  }, [workspaceId]);

  const rememberAnchorRect = useCallback((anchorRect: ManualChatGroupEditorAnchorRect) => {
    lastGroupEditorAnchorRectRef.current = anchorRect;
  }, []);

  const openCreateGroupEditor = useCallback((
    sessionIds: string[],
    anchorRect?: ManualChatGroupEditorAnchorRect | null,
  ) => {
    if (sessionIds.length < 2) {
      return;
    }
    setGroupEditor({
      mode: "create",
      sessionIds,
      label: "Group",
      colorId: getRandomManualChatGroupColorId(),
      anchorRect: anchorRect ?? lastGroupEditorAnchorRectRef.current ?? fallbackEditorAnchorRect(),
    });
  }, []);

  const openEditGroupEditor = useCallback((
    groupId: ManualChatGroupId,
    mode: "rename" | "color",
    anchorRect?: ManualChatGroupEditorAnchorRect | null,
  ) => {
    const group = displayManualGroups.find((candidate) => candidate.id === groupId);
    if (!group) {
      return;
    }
    setGroupEditor({
      mode,
      groupId,
      label: group.label,
      colorId: group.colorId,
      anchorRect: anchorRect ?? lastGroupEditorAnchorRectRef.current ?? fallbackEditorAnchorRect(),
    });
  }, [displayManualGroups]);

  const closeGroupEditor = useCallback(() => {
    setGroupEditor(null);
  }, []);

  const confirmGroupEditor = useCallback((value: {
    label: string;
    colorId: ManualChatGroupColorId;
  }) => {
    if (!workspaceId || !groupEditor) {
      return;
    }
    if (groupEditor.mode === "create") {
      upsertGroup(workspaceId, {
        id: createManualChatGroupId(createRandomId()),
        label: value.label,
        colorId: value.colorId,
        sessionIds: groupEditor.sessionIds,
      });
      onCreateComplete();
    } else {
      updateGroup(
        workspaceId,
        groupEditor.groupId,
        value,
      );
    }
    setGroupEditor(null);
  }, [
    groupEditor,
    onCreateComplete,
    updateGroup,
    upsertGroup,
    workspaceId,
  ]);

  return {
    groupEditor,
    rememberAnchorRect,
    openCreateGroupEditor,
    openEditGroupEditor,
    closeGroupEditor,
    confirmGroupEditor,
  };
}

function createRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function fallbackEditorAnchorRect(): ManualChatGroupEditorAnchorRect {
  const left = window.innerWidth / 2;
  const top = window.innerHeight / 2;
  return {
    top,
    right: left,
    bottom: top,
    left,
    width: 0,
    height: 0,
  };
}

type ManualGroupEditorState =
  | {
      mode: "create";
      sessionIds: string[];
      label: string;
      colorId: ManualChatGroupColorId;
      anchorRect: ManualChatGroupEditorAnchorRect;
    }
  | {
      mode: "rename" | "color";
      groupId: ManualChatGroupId;
      label: string;
      colorId: ManualChatGroupColorId;
      anchorRect: ManualChatGroupEditorAnchorRect;
    };
