import { useNativeContextMenu } from "#product/hooks/ui/native/use-native-context-menu";

interface WebLinkMenuActions {
  openInBrowser: () => void;
  copyLink: () => void;
}

export function useWebLinkNativeContextMenu(actions: WebLinkMenuActions) {
  return useNativeContextMenu(() => buildWebLinkNativeContextMenuItems(actions));
}

export function buildWebLinkNativeContextMenuItems(actions: WebLinkMenuActions) {
  return [
    {
      id: "open-in-browser",
      label: "Open in Browser",
      icon: { kind: "native" as const, name: "open" as const },
      onSelect: actions.openInBrowser,
    },
    {
      id: "copy-link",
      label: "Copy link",
      icon: { kind: "native" as const, name: "copy" as const },
      onSelect: actions.copyLink,
    },
  ];
}
