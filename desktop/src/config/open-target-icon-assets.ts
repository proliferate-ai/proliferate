import type { OpenTargetIconId } from "@/lib/domain/open-targets/model";

export const OPEN_TARGET_ICON_ASSET_PATHS: Partial<Record<OpenTargetIconId, string>> = {
  cursor: "/app-icons/cursor.png",
  vscode: "/app-icons/vscode.png",
  windsurf: "/app-icons/windsurf.png",
  zed: "/app-icons/zed.png",
  finder: "/app-icons/finder.png",
  terminal: "/app-icons/terminal.webp",
} satisfies Partial<Record<OpenTargetIconId, string>>;

export const OPEN_TARGET_NATIVE_ICON_RESOURCE_PATHS: Partial<Record<OpenTargetIconId, string>> = {
  cursor: "app-icons/cursor.png",
  vscode: "app-icons/vscode.png",
  windsurf: "app-icons/windsurf.png",
  zed: "app-icons/zed.png",
  finder: "app-icons/finder.png",
  terminal: "app-icons/terminal.png",
} satisfies Partial<Record<OpenTargetIconId, string>>;
