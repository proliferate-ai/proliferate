import type { Image, MenuIcon } from "@tauri-apps/api/image";
import type { IconMenuItem } from "@tauri-apps/api/menu/iconMenuItem";
import type { MenuItem } from "@tauri-apps/api/menu/menuItem";
import type { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";
import type { Submenu } from "@tauri-apps/api/menu/submenu";

export type NativeContextMenuIcon =
  | { kind: "asset"; src: string }
  | { kind: "resource"; path: string }
  | { kind: "native"; name: NativeContextMenuNativeIcon };

export type NativeContextMenuNativeIcon =
  | "copy"
  | "document"
  | "finder"
  | "open"
  | "terminal";

export type NativeContextMenuItem =
  | { kind: "separator" }
  | {
      kind: "submenu";
      submenuId?: string;
      label: string;
      enabled?: boolean;
      items: NativeContextMenuItem[];
    }
  | {
      kind?: "action";
      id: string;
      label: string;
      accelerator?: string;
      enabled?: boolean;
      icon?: NativeContextMenuIcon;
      onSelect?: () => void;
    };

type BuiltNativeContextMenuItem =
  | IconMenuItem
  | MenuItem
  | PredefinedMenuItem
  | Submenu;

type NativeIconRegistry =
  typeof import("@tauri-apps/api/menu/iconMenuItem").NativeIcon;
type TauriImageClass = typeof import("@tauri-apps/api/image").Image;
type ResolveResource = typeof import("@tauri-apps/api/path").resolveResource;

const nativeMenuIconAssetCache = new Map<string, Promise<MenuIcon | undefined>>();

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
    const { Image } = await import("@tauri-apps/api/image");
    const { resolveResource } = await import("@tauri-apps/api/path");
    const { MenuItem } = await import("@tauri-apps/api/menu/menuItem");
    const { IconMenuItem, NativeIcon } = await import(
      "@tauri-apps/api/menu/iconMenuItem"
    );
    const { PredefinedMenuItem } = await import(
      "@tauri-apps/api/menu/predefinedMenuItem"
    );
    const { Submenu } = await import("@tauri-apps/api/menu/submenu");

    const built = await Promise.all(items.map((item) =>
      buildNativeContextMenuItem(item, {
        Image,
        IconMenuItem,
        MenuItem,
        NativeIcon,
        PredefinedMenuItem,
        resolveResource,
        Submenu,
      })
    ));

    const menu = await Menu.new({ items: built });
    await menu.popup();
    return true;
  } catch {
    return false;
  }
}

async function buildNativeContextMenuItem(
  item: NativeContextMenuItem,
  api: {
    Image: TauriImageClass;
    IconMenuItem: typeof import("@tauri-apps/api/menu/iconMenuItem").IconMenuItem;
    MenuItem: typeof import("@tauri-apps/api/menu/menuItem").MenuItem;
    NativeIcon: NativeIconRegistry;
    PredefinedMenuItem: typeof import("@tauri-apps/api/menu/predefinedMenuItem").PredefinedMenuItem;
    resolveResource: ResolveResource;
    Submenu: typeof import("@tauri-apps/api/menu/submenu").Submenu;
  },
): Promise<BuiltNativeContextMenuItem> {
  if ("kind" in item && item.kind === "separator") {
    return api.PredefinedMenuItem.new({ item: "Separator" });
  }

  if ("kind" in item && item.kind === "submenu") {
    const submenuItems = await Promise.all(
      item.items.map((child) => buildNativeContextMenuItem(child, api)),
    );
    return api.Submenu.new({
      ...(item.submenuId ? { id: item.submenuId } : {}),
      text: item.label,
      enabled: item.enabled ?? true,
      items: submenuItems,
    });
  }

  const action = item as Extract<NativeContextMenuItem, { id: string }>;
  const baseOptions = {
    id: action.id,
    text: action.label,
    enabled: action.enabled ?? true,
    ...(action.accelerator ? { accelerator: action.accelerator } : {}),
    action: () => {
      action.onSelect?.();
    },
  };

  const icon = await resolveNativeContextMenuIcon(action.icon, api);
  if (icon) {
    try {
      return await api.IconMenuItem.new({ ...baseOptions, icon });
    } catch {
      // Keep the menu native if icon materialization fails on a platform/build.
    }
  }

  return api.MenuItem.new(baseOptions);
}

async function resolveNativeContextMenuIcon(
  icon: NativeContextMenuIcon | undefined,
  api: {
    Image: TauriImageClass;
    NativeIcon: NativeIconRegistry;
    resolveResource: ResolveResource;
  },
): Promise<MenuIcon | undefined> {
  if (!icon) {
    return undefined;
  }

  if (icon.kind === "native") {
    return resolveNativeTemplateIcon(icon.name, api.NativeIcon);
  }

  if (icon.kind === "resource") {
    return loadNativeMenuIconResource(icon.path, api.Image, api.resolveResource);
  }

  return loadNativeMenuIconAsset(icon.src, api.Image);
}

function resolveNativeTemplateIcon(
  name: NativeContextMenuNativeIcon,
  nativeIcons: NativeIconRegistry,
): MenuIcon {
  switch (name) {
    case "copy":
      return nativeIcons.MultipleDocuments;
    case "document":
      return nativeIcons.Path;
    case "finder":
      return nativeIcons.Folder;
    case "open":
      return nativeIcons.FollowLinkFreestanding;
    case "terminal":
      return nativeIcons.Computer;
  }
}

function loadNativeMenuIconAsset(
  src: string,
  ImageClass: TauriImageClass,
): Promise<MenuIcon | undefined> {
  const cached = nativeMenuIconAssetCache.get(src);
  if (cached) {
    return cached;
  }

  const promise = fetchNativeMenuIconAsset(src, ImageClass);
  nativeMenuIconAssetCache.set(src, promise);
  return promise;
}

function loadNativeMenuIconResource(
  path: string,
  ImageClass: TauriImageClass,
  resolveResource: ResolveResource,
): Promise<MenuIcon | undefined> {
  const cacheKey = `resource:${path}`;
  const cached = nativeMenuIconAssetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = fetchNativeMenuIconResource(path, ImageClass, resolveResource);
  nativeMenuIconAssetCache.set(cacheKey, promise);
  return promise;
}

async function fetchNativeMenuIconResource(
  path: string,
  ImageClass: TauriImageClass,
  resolveResource: ResolveResource,
): Promise<Image | undefined> {
  try {
    const resourcePath = await resolveResource(path);
    return await ImageClass.fromPath(resourcePath);
  } catch {
    return undefined;
  }
}

async function fetchNativeMenuIconAsset(
  src: string,
  ImageClass: TauriImageClass,
): Promise<Image | undefined> {
  if (!src.toLowerCase().endsWith(".png")) {
    return undefined;
  }

  try {
    const response = await fetch(new URL(src, window.location.href).href);
    if (!response.ok) {
      return undefined;
    }
    return await ImageClass.fromBytes(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }
}
