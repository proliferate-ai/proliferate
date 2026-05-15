import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import type { NativeContextMenuItem } from "@/lib/access/tauri/context-menu";
import type { OpenTarget } from "@/lib/access/tauri/shell";

export function useFilePathNativeContextMenu({
  canOpen,
  targets = [],
  onOpen,
  onOpenTarget,
  onCopy,
  onRevealInFinder,
}: {
  canOpen: boolean;
  targets?: readonly Pick<OpenTarget, "id" | "label">[];
  onOpen: () => void;
  onOpenTarget?: (targetId: string) => void;
  onCopy: () => void;
  onRevealInFinder?: () => void;
}) {
  // Product-specific native context menu wiring for file-path UI surfaces.
  return useNativeContextMenu(() =>
    buildFilePathNativeContextMenuItems({
      canOpen,
      targets,
      onOpen,
      onOpenTarget,
      onCopy,
      onRevealInFinder,
    })
  );
}

export function buildFilePathNativeContextMenuItems({
  canOpen,
  targets = [],
  onOpen,
  onOpenTarget,
  onCopy,
  onRevealInFinder,
}: {
  canOpen: boolean;
  targets?: readonly Pick<OpenTarget, "id" | "label">[];
  onOpen: () => void;
  onOpenTarget?: (targetId: string) => void;
  onCopy: () => void;
  onRevealInFinder?: () => void;
}): NativeContextMenuItem[] {
  const openTargets = targets.filter((target) =>
    target.id !== "finder" && target.id !== "copy-path"
  );
  const items: NativeContextMenuItem[] = [
    {
      id: "open-default",
      label: "Open in \"Your default\"",
      enabled: canOpen,
      onSelect: onOpen,
    },
  ];

  if (openTargets.length > 0 && onOpenTarget) {
    items.push({
      id: "open-in",
      label: "Open in >",
      enabled: false,
    });
    items.push(...openTargets.map((target): NativeContextMenuItem => ({
      id: `open-target:${target.id}`,
      label: target.label,
      enabled: canOpen,
      onSelect: () => onOpenTarget(target.id),
    })));
  }

  items.push(
    { kind: "separator" },
    {
      id: "copy-path",
      label: "Copy path",
      onSelect: onCopy,
    },
    {
      id: "reveal-in-finder",
      label: "Reveal in Finder",
      enabled: canOpen && Boolean(onRevealInFinder),
      onSelect: onRevealInFinder,
    },
  );

  return items;
}
