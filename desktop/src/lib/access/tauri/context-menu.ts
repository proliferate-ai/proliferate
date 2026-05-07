export type NativeContextMenuItem =
  | { kind: "separator" }
  | {
      kind?: "action";
      id: string;
      label: string;
      accelerator?: string;
      enabled?: boolean;
      onSelect?: () => void;
    };

function isTauriWindowApiAvailable(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

export function canShowNativeContextMenu(): boolean {
  return isTauriWindowApiAvailable();
}

export async function showNativeContextMenu(
  items: NativeContextMenuItem[],
): Promise<boolean> {
  if (!isTauriWindowApiAvailable()) {
    return false;
  }
  if (items.length === 0) {
    return false;
  }

  try {
    const { Menu } = await import("@tauri-apps/api/menu/menu");
    const { MenuItem } = await import("@tauri-apps/api/menu/menuItem");
    const { PredefinedMenuItem } = await import(
      "@tauri-apps/api/menu/predefinedMenuItem"
    );

    const built = await Promise.all(items.map(async (item) => {
      if ("kind" in item && item.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      const action = item as Extract<NativeContextMenuItem, { id: string }>;
      return MenuItem.new({
        id: action.id,
        text: action.label,
        enabled: action.enabled ?? true,
        ...(action.accelerator ? { accelerator: action.accelerator } : {}),
        action: () => {
          action.onSelect?.();
        },
      });
    }));

    const menu = await Menu.new({ items: built });
    await menu.popup();
    return true;
  } catch {
    return false;
  }
}
