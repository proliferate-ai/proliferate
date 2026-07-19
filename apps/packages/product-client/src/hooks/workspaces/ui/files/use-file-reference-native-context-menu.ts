import { OPEN_TARGET_NATIVE_ICON_RESOURCE_PATHS } from "#product/config/open-target-icon-assets";
import { useNativeContextMenu } from "#product/hooks/ui/native/use-native-context-menu";
import type {
  NativeMenuIcon,
  NativeMenuItem,
  OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import type { FileReferencePathKind } from "#product/lib/domain/files/path-references";

interface FileReferenceNativeContextMenuActions {
  openTargets: OpenTarget[];
  defaultOpenTarget?: OpenTarget | null;
  pathKind: FileReferencePathKind | null;
  canOpenInSidebar: boolean;
  canOpenExternal: boolean;
  canReveal: boolean;
  copyPath: () => void;
  openInSidebar: () => void;
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
  pathKind,
  canOpenInSidebar,
  canOpenExternal,
  canReveal,
  copyPath,
  openInSidebar,
  openDefault,
  openWithTarget,
  reveal,
}: FileReferenceNativeContextMenuActions): NativeMenuItem[] {
  const targets = filterFileReferenceOpenTargets(openTargets);
  const items: NativeMenuItem[] = [];

  if (pathKind !== "directory") {
    items.push({
      id: "open-viewer",
      label: "Open in viewer",
      enabled: canOpenInSidebar,
      icon: { kind: "native", name: "document" },
      onSelect: openInSidebar,
    });
  }

  items.push({
    id: "open-default",
    label: defaultOpenTarget ? `Open in ${defaultOpenTarget.label}` : "Open externally",
    enabled: canOpenExternal,
    icon: nativeMenuIconForOpenTarget(defaultOpenTarget) ?? { kind: "native", name: "open" },
    onSelect: openDefault,
  });

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
      label: pathKind === "directory" ? "Reveal folder in Finder" : "Reveal in Finder",
      enabled: canReveal,
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
