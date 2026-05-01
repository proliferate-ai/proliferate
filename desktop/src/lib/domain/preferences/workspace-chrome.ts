const WORKSPACE_GLASS_HEADER_CLASS =
  "flex h-10 shrink-0 items-center border-b border-foreground/10 bg-card/30 backdrop-blur-xl supports-[backdrop-filter]:bg-card/20";
const WORKSPACE_SOLID_HEADER_CLASS = "flex h-10 shrink-0 items-center";

const EDITOR_GLASS_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-foreground/10 bg-card/25 px-1 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-card/20";
const EDITOR_SOLID_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto px-1 pt-1";

const TERMINAL_GLASS_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden border-b border-foreground/10 bg-card/25 pr-1 backdrop-blur-md supports-[backdrop-filter]:bg-card/20";
const TERMINAL_SOLID_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden pr-1";

export interface StandardWorkspaceChromeClasses {
  root: string;
  contentShell: string;
  header: string;
}

export interface CoworkWorkspaceChromeClasses {
  root: string;
  contentShell: string;
  header: string;
}

export interface EditorTabChromeClasses {
  tablist: string;
  shape: string;
  active: string;
}

export interface TerminalTabChromeClasses {
  rail: string;
  active: string;
  inactive: string;
}

export function resolveStandardWorkspaceChromeClasses({
  transparent,
  sidebarOpen,
}: {
  transparent: boolean;
  sidebarOpen: boolean;
}): StandardWorkspaceChromeClasses {
  return {
    root: transparent ? "bg-transparent" : "bg-sidebar",
    contentShell: [
      transparent ? "bg-transparent" : "bg-background",
      sidebarOpen && !transparent ? "rounded-tl-[22px] border-l border-t border-sidebar-border" : "",
    ].filter(Boolean).join(" "),
    header: transparent ? WORKSPACE_GLASS_HEADER_CLASS : WORKSPACE_SOLID_HEADER_CLASS,
  };
}

export function resolveCoworkWorkspaceChromeClasses({
  transparent,
  sidebarOpen,
}: {
  transparent: boolean;
  sidebarOpen: boolean;
}): CoworkWorkspaceChromeClasses {
  return {
    root: transparent ? "bg-transparent" : "bg-sidebar",
    contentShell: [
      transparent ? "bg-transparent" : "bg-background",
      sidebarOpen ? "rounded-tl-lg" : "",
    ].filter(Boolean).join(" "),
    header: transparent ? WORKSPACE_GLASS_HEADER_CLASS : WORKSPACE_SOLID_HEADER_CLASS,
  };
}

export function resolveEditorTabChromeClasses(
  transparent: boolean,
): EditorTabChromeClasses {
  return {
    tablist: transparent ? EDITOR_GLASS_TABLIST_CLASS : EDITOR_SOLID_TABLIST_CLASS,
    shape: transparent ? "-mb-px rounded-t-md" : "rounded-md",
    active: transparent
      ? "border-foreground/10 border-b-background bg-background/85 text-foreground shadow-subtle backdrop-blur-xl"
      : "border-border bg-background text-foreground shadow-subtle",
  };
}

export function resolveTerminalTabChromeClasses(
  transparent: boolean,
): TerminalTabChromeClasses {
  return {
    rail: transparent ? TERMINAL_GLASS_TABLIST_RAIL_CLASS : TERMINAL_SOLID_TABLIST_RAIL_CLASS,
    active: transparent
      ? "bg-background/85 text-foreground backdrop-blur-xl"
      : "bg-background text-foreground",
    inactive: "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
  };
}
