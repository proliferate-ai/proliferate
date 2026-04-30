import { describe, expect, it } from "vitest";
import {
  resolveCoworkWorkspaceChromeClasses,
  resolveEditorTabChromeClasses,
  resolveStandardWorkspaceChromeClasses,
  resolveTerminalTabChromeClasses,
} from "./workspace-chrome";

describe("workspace chrome classes", () => {
  it("preserves standard shell classes", () => {
    expect(resolveStandardWorkspaceChromeClasses({
      transparent: true,
      sidebarOpen: true,
    })).toEqual({
      root: "bg-transparent",
      contentShell: "bg-transparent",
      header: "flex h-10 shrink-0 items-center border-b border-foreground/10 bg-card/30 backdrop-blur-xl supports-[backdrop-filter]:bg-card/20",
    });

    expect(resolveStandardWorkspaceChromeClasses({
      transparent: false,
      sidebarOpen: true,
    })).toEqual({
      root: "bg-sidebar",
      contentShell: "bg-background rounded-tl-[22px] border-l border-t border-sidebar-border",
      header: "flex h-10 shrink-0 items-center",
    });

    expect(resolveStandardWorkspaceChromeClasses({
      transparent: true,
      sidebarOpen: false,
    }).contentShell).toBe("bg-transparent");
    expect(resolveStandardWorkspaceChromeClasses({
      transparent: false,
      sidebarOpen: false,
    }).contentShell).toBe("bg-background");
  });

  it("preserves cowork-specific content rounding", () => {
    expect(resolveCoworkWorkspaceChromeClasses({
      transparent: true,
      sidebarOpen: true,
    }).contentShell).toBe("bg-transparent rounded-tl-lg");
    expect(resolveCoworkWorkspaceChromeClasses({
      transparent: false,
      sidebarOpen: false,
    }).contentShell).toBe("bg-background");
    expect(resolveCoworkWorkspaceChromeClasses({
      transparent: true,
      sidebarOpen: false,
    }).contentShell).toBe("bg-transparent");
    expect(resolveCoworkWorkspaceChromeClasses({
      transparent: false,
      sidebarOpen: true,
    }).contentShell).toBe("bg-background rounded-tl-lg");
  });

  it("preserves editor tab classes", () => {
    expect(resolveEditorTabChromeClasses(true)).toEqual({
      tablist: "flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-foreground/10 bg-card/25 px-1 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-card/20",
      shape: "-mb-px rounded-t-md",
      active: "border-foreground/10 border-b-background bg-background/85 text-foreground shadow-subtle backdrop-blur-xl",
    });
    expect(resolveEditorTabChromeClasses(false)).toEqual({
      tablist: "flex h-9 shrink-0 items-end gap-1 overflow-x-auto px-1 pt-1",
      shape: "rounded-md",
      active: "border-border bg-background text-foreground shadow-subtle",
    });
  });

  it("preserves terminal tab classes", () => {
    expect(resolveTerminalTabChromeClasses(true)).toEqual({
      rail: "relative flex shrink-0 items-center gap-1 overflow-hidden border-b border-foreground/10 bg-card/25 pr-1 backdrop-blur-md supports-[backdrop-filter]:bg-card/20",
      active: "bg-background/85 text-foreground backdrop-blur-xl",
      inactive: "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    });
    expect(resolveTerminalTabChromeClasses(false)).toEqual({
      rail: "relative flex shrink-0 items-center gap-1 overflow-hidden pr-1",
      active: "bg-background text-foreground",
      inactive: "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    });
  });
});
