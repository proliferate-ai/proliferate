import { useRef } from "react";
import { PopoverButton } from "@/components/ui/PopoverButton";
import type { ManualChatGroupEditorAnchorRect } from "@/components/workspace/shell/tabs/ManualChatGroupEditorPopover";
import { TabContextMenu } from "@/components/workspace/shell/tabs/TabContextMenu";
import { TabGroupPill } from "@/components/workspace/shell/tabs/TabGroupPill";
import { useWorkspaceTabNativeContextMenu } from "@/hooks/workspaces/tabs/use-workspace-tab-native-context-menu";
import {
  buildGroupPillContextMenuItems,
  type WorkspaceTabContextMenuCommand,
} from "@/lib/domain/workspaces/tabs/context-menu";

export function TabGroupPillWithMenu({
  groupKind,
  label,
  color,
  width,
  isCollapsed,
  onToggle,
  onRename,
  onChangeColor,
  onUngroup,
}: {
  groupKind: "manual" | "subagent";
  label: string;
  color: string;
  width: number;
  isCollapsed: boolean;
  onToggle: () => void;
  onRename?: (anchorRect: ManualChatGroupEditorAnchorRect) => void;
  onChangeColor?: (anchorRect: ManualChatGroupEditorAnchorRect) => void;
  onUngroup?: () => void;
}) {
  const anchorRectRef = useRef<ManualChatGroupEditorAnchorRect | null>(null);
  const menuItems = buildGroupPillContextMenuItems({ groupKind, isCollapsed });
  const { onContextMenuCapture } = useWorkspaceTabNativeContextMenu({
    items: menuItems,
    onSelect: handleContextMenuCommand,
  });

  function handleContextMenuCommand(command: WorkspaceTabContextMenuCommand) {
    switch (command) {
      case "collapse-group":
      case "expand-group":
        onToggle();
        return;
      case "rename-group":
        onRename?.(anchorRectRef.current ?? fallbackAnchorRect());
        return;
      case "change-group-color":
        onChangeColor?.(anchorRectRef.current ?? fallbackAnchorRect());
        return;
      case "ungroup":
        onUngroup?.();
        return;
      case "rename":
      case "create-group":
      case "close":
      case "close-others":
      case "close-right":
      case "dismiss":
        return;
    }
  }

  return (
    <PopoverButton
      triggerMode="contextMenu"
      stopPropagation
      className="w-48 rounded-lg border border-border bg-popover p-1 shadow-floating"
      trigger={(
        <span
          className="inline-flex min-w-0 shrink-0 app-region-no-drag"
          onContextMenuCapture={(event) => {
            anchorRectRef.current = rectToAnchor(event.currentTarget.getBoundingClientRect());
            onContextMenuCapture(event);
          }}
        >
          <TabGroupPill
            label={label}
            color={color}
            width={width}
            isCollapsed={isCollapsed}
            onToggle={onToggle}
          />
        </span>
      )}
    >
      {(close) => (
        <TabContextMenu
          items={menuItems}
          onSelect={(command) => {
            close();
            handleContextMenuCommand(command);
          }}
        />
      )}
    </PopoverButton>
  );
}

function rectToAnchor(rect: DOMRect): ManualChatGroupEditorAnchorRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function fallbackAnchorRect(): ManualChatGroupEditorAnchorRect {
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
