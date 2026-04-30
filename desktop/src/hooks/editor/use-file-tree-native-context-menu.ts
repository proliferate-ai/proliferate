import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/platform/tauri/context-menu";
import type { OpenTarget } from "@/platform/tauri/shell";

export function useFileTreeNativeContextMenu({
  targets,
  onOpenInProliferate,
  onOpenTarget,
}: {
  targets: OpenTarget[];
  onOpenInProliferate: () => void;
  onOpenTarget: (targetId: string) => void;
}) {
  return useNativeContextMenu(() =>
    buildFileTreeNativeContextMenuItems({
      targets,
      onOpenInProliferate,
      onOpenTarget,
    })
  );
}

export function buildFileTreeNativeContextMenuItems({
  targets,
  onOpenInProliferate,
  onOpenTarget,
}: {
  targets: readonly Pick<OpenTarget, "id" | "label">[];
  onOpenInProliferate: () => void;
  onOpenTarget: (targetId: string) => void;
}): NativeContextMenuItem[] {
  return [
    {
      id: "open-in-proliferate",
      label: "Open in Proliferate",
      onSelect: onOpenInProliferate,
    },
    { kind: "separator" },
    ...targets.map((target) => ({
      id: `open-target:${target.id}`,
      label: target.label,
      onSelect: () => onOpenTarget(target.id),
    })),
  ];
}
