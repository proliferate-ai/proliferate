import {
  useNativeContextMenu,
  useNativeMenu,
} from "#product/hooks/ui/native/use-native-context-menu";
import type { NativeMenuItem } from "@proliferate/product-client/host/desktop-bridge";

export interface FileViewerNativeMenuActions {
  canCopyContent: boolean;
  canRenderRichPreview: boolean;
  richPreviewEnabled: boolean;
  wordWrap: boolean;
  onCopyContent: () => void;
  onCopyPath: () => void;
  onToggleWordWrap: () => void;
  onToggleRichPreview: () => void;
}

/**
 * The file viewer's action menu as OS-native menu items. Native menus carry
 * no checkmark state through the bridge, so the toggles read as
 * "Enable/Disable …" verbs instead.
 */
export function buildFileViewerNativeMenuItems(
  actions: FileViewerNativeMenuActions,
): NativeMenuItem[] {
  const items: NativeMenuItem[] = [
    {
      id: "copy-content",
      label: "Copy content",
      enabled: actions.canCopyContent,
      onSelect: actions.onCopyContent,
    },
    {
      id: "copy-path",
      label: "Copy path",
      onSelect: actions.onCopyPath,
    },
    { kind: "separator" },
    {
      id: "toggle-word-wrap",
      label: actions.wordWrap ? "Disable word wrap" : "Enable word wrap",
      onSelect: actions.onToggleWordWrap,
    },
  ];

  if (actions.canRenderRichPreview) {
    items.push({
      id: "toggle-rich-preview",
      label: actions.richPreviewEnabled
        ? "Disable rich preview"
        : "Enable rich preview",
      onSelect: actions.onToggleRichPreview,
    });
  }

  return items;
}

/** Click-triggered variant (toolbar "…" button). */
export function useFileViewerNativeMenu(actions: FileViewerNativeMenuActions) {
  return useNativeMenu(() => buildFileViewerNativeMenuItems(actions));
}

/** Right-click variant for the viewer content area. */
export function useFileViewerNativeContextMenu(actions: FileViewerNativeMenuActions) {
  return useNativeContextMenu(() => buildFileViewerNativeMenuItems(actions));
}
