import { describe, expect, it } from "vitest";
import {
  CursorIcon,
  FileIcon,
  FinderIcon,
  TerminalAppIcon,
  VSCodeIcon,
  WindsurfIcon,
  ZedIcon,
} from "@/components/ui/icons";
import {
  OPEN_TARGET_FALLBACK_ICON,
  OPEN_TARGET_ICON_DEFINITIONS,
} from "./open-targets";

describe("open target icon definitions", () => {
  it("uses dedicated components for locally sourced app icons", () => {
    expect(OPEN_TARGET_ICON_DEFINITIONS.cursor.component).toBe(CursorIcon);
    expect(OPEN_TARGET_ICON_DEFINITIONS.vscode.component).toBe(VSCodeIcon);
    expect(OPEN_TARGET_ICON_DEFINITIONS.windsurf.component).toBe(WindsurfIcon);
    expect(OPEN_TARGET_ICON_DEFINITIONS.finder.component).toBe(FinderIcon);
    expect(OPEN_TARGET_ICON_DEFINITIONS.terminal.component).toBe(TerminalAppIcon);
  });

  it("falls back to the generic file icon for editors without dedicated assets", () => {
    expect(OPEN_TARGET_ICON_DEFINITIONS.zed.component).toBe(ZedIcon);
    expect(OPEN_TARGET_ICON_DEFINITIONS.sublime.component).toBe(FileIcon);
    expect(OPEN_TARGET_FALLBACK_ICON).toBe(FileIcon);
  });
});
