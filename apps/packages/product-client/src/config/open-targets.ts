import type { ComponentType } from "react";
import { FileIcon } from "@proliferate/ui/icons";
import {
  CursorIcon,
  FinderIcon,
  TerminalAppIcon,
  VSCodeIcon,
  WindsurfIcon,
  ZedIcon,
} from "#product/components/workspace/open-target/app-icons";
import type { OpenTargetIconId } from "@proliferate/product-client/host/desktop-bridge";

export interface OpenTargetIconDefinition {
  component: ComponentType<{ className?: string }>;
}

export const OPEN_TARGET_ICON_DEFINITIONS = {
  cursor: {
    component: CursorIcon,
  },
  vscode: {
    component: VSCodeIcon,
  },
  windsurf: {
    component: WindsurfIcon,
  },
  zed: {
    component: ZedIcon,
  },
  sublime: {
    component: FileIcon,
  },
  finder: {
    component: FinderIcon,
  },
  terminal: {
    component: TerminalAppIcon,
  },
} satisfies Record<OpenTargetIconId, OpenTargetIconDefinition>;

export const OPEN_TARGET_FALLBACK_ICON = FileIcon;
