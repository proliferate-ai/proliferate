import { OPEN_TARGET_NATIVE_ICON_RESOURCE_PATHS } from "@/config/open-target-icon-assets";
import { useNativeContextMenu } from "@/hooks/ui/native/use-native-context-menu";
import type {
  NativeMenuIcon,
  NativeMenuItem,
  OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";

interface FileReferenceNativeContextMenuActions {
  openTargets: OpenTarget[];
  defaultOpenTarget?: OpenTarget | null;
  canOpenExternal: boolean;
  copyPath: () => void;
  openDefault: () => void;
  openWithTarget: (targetId: string) => void;
  reveal: () => void;
}

export function useFileReferenceNativeContextMenu(
  actions: FileReferenceNativeContextMenuActions,
) {
  return useNativeContextMenu(() =>
    buildFileReferenceNativeContextMenuItems(actions)
  );
}

export function buildFileReferenceNativeContextMenuItems({
  openTargets,
  defaultOpenTarget,
  canOpenExternal,
  copyPath,
  openDefault,
  openWithTarget,
  reveal,
}: FileReferenceNativeContextMenuActions): NativeMenuItem[] {
  const targets = filterFileReferenceOpenTargets(openTargets);
  const items: NativeMenuItem[] = [
    {
      id: "open-default",
      label: defaultOpenTarget ? `Open in ${defaultOpenTarget.label}` : "Open",
      enabled: canOpenExternal,
      icon: nativeMenuIconForOpenTarget(defaultOpenTarget) ?? { kind: "native", name: "open" },
      onSelect: openDefault,
    },
  ];

  if (targets.length > 0) {
    items.push({
      kind: "submenu",
      submenuId: "open-with",
      label: "Open with",
      enabled: canOpenExternal,
      items: targets.map((target): NativeMenuItem => ({
        id: `open-with:${target.id}`,
        label: target.label,
        enabled: canOpenExternal,
        icon: nativeMenuIconForOpenTarget(target),
        onSelect: () => openWithTarget(target.id),
      })),
    });
  }

  items.push(
    { kind: "separator" },
    {
      id: "copy-path",
      label: "Copy path",
      onSelect: copyPath,
    },
    {
      id: "reveal-in-finder",
      label: "Reveal in Finder",
      enabled: canOpenExternal,
      onSelect: reveal,
    },
  );

  return items;
}

function filterFileReferenceOpenTargets(targets: readonly OpenTarget[]): OpenTarget[] {
  return targets.filter((target) => target.id !== "copy-path");
}

function nativeMenuIconForOpenTarget(
  target: Pick<OpenTarget, "kind" | "iconId"> | null | undefined,
): NativeMenuIcon | undefined {
  if (!target) {
    return undefined;
  }

  if (target.iconId) {
    const resourcePath = OPEN_TARGET_NATIVE_ICON_RESOURCE_PATHS[target.iconId];
    if (resourcePath) {
      return { kind: "resource", path: resourcePath };
    }
  }

  switch (target.kind) {
    case "finder":
      return { kind: "native", name: "finder" };
    case "terminal":
      return { kind: "native", name: "terminal" };
    default:
      return { kind: "native", name: "document" };
  }
}
