import type { ComponentType } from "react";
import {
  CursorIcon,
  FileIcon,
  FinderIcon,
  TerminalAppIcon,
  VSCodeIcon,
  WindsurfIcon,
  ZedIcon,
} from "@/components/ui/icons";
import type { OpenTargetIconId } from "@/platform/tauri/shell";

export interface OpenTargetIconDefinition {
  component: ComponentType<{ className?: string }>;
  wrapInMenu: boolean;
}

export const OPEN_TARGET_ICON_DEFINITIONS = {
  cursor: {
    component: CursorIcon,
    wrapInMenu: true,
  },
  vscode: {
    component: VSCodeIcon,
    wrapInMenu: true,
  },
  windsurf: {
    component: WindsurfIcon,
    wrapInMenu: true,
  },
  zed: {
    component: ZedIcon,
    wrapInMenu: true,
  },
  sublime: {
    component: FileIcon,
    wrapInMenu: false,
  },
  finder: {
    component: FinderIcon,
    wrapInMenu: true,
  },
  terminal: {
    component: TerminalAppIcon,
    wrapInMenu: true,
  },
} satisfies Record<OpenTargetIconId, OpenTargetIconDefinition>;

export const OPEN_TARGET_FALLBACK_ICON = FileIcon;
