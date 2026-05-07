import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/lib/access/tauri/context-menu";
import type { OpenTarget } from "@/lib/access/tauri/shell";

export function useFileTreeNativeContextMenu({
  targets,
  onOpenInProliferate,
  onOpenTarget,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  targets: OpenTarget[];
  onOpenInProliferate: () => void;
  onOpenTarget: (targetId: string) => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return useNativeContextMenu(() =>
    buildFileTreeNativeContextMenuItems({
      targets,
      onOpenInProliferate,
      onOpenTarget,
      onNewFile,
      onNewFolder,
      onRename,
      onDelete,
    })
  );
}

export function buildFileTreeNativeContextMenuItems({
  targets,
  onOpenInProliferate,
  onOpenTarget,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  targets: readonly Pick<OpenTarget, "id" | "label">[];
  onOpenInProliferate: () => void;
  onOpenTarget: (targetId: string) => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}): NativeContextMenuItem[] {
  const items: NativeContextMenuItem[] = [
    {
      id: "open-in-proliferate",
      label: "Open in Proliferate",
      onSelect: onOpenInProliferate,
    },
  ];

  const createItems: NativeContextMenuItem[] = [];
  if (onNewFile) {
    createItems.push({
      id: "new-file",
      label: "New File",
      onSelect: onNewFile,
    });
  }
  if (onNewFolder) {
    createItems.push({
      id: "new-folder",
      label: "New Folder",
      onSelect: onNewFolder,
    });
  }

  const editItems: NativeContextMenuItem[] = [];
  if (onRename) {
    editItems.push({
      id: "rename",
      label: "Rename",
      onSelect: onRename,
    });
  }
  if (onDelete) {
    editItems.push({
      id: "delete",
      label: "Delete",
      onSelect: onDelete,
    });
  }

  if (createItems.length > 0 || editItems.length > 0) {
    items.push({ kind: "separator" }, ...createItems);
    if (createItems.length > 0 && editItems.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push(...editItems);
  }

  if (targets.length > 0) {
    items.push({ kind: "separator" });
    items.push(...targets.map((target): NativeContextMenuItem => ({
      id: `open-target:${target.id}`,
      label: target.label,
      onSelect: () => onOpenTarget(target.id),
    })));
  }

  return items;
}
