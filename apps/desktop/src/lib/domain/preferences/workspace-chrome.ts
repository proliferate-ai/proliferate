// Glass tints anchor to --color-background (the content surface), not card:
// card is a step lighter, which rendered the header as a visibly lighter haze
// band against the opaque chat surface on every theme.
const WORKSPACE_GLASS_HEADER_BASE_CLASS =
  "flex h-16 shrink-0 items-center bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60";
const WORKSPACE_GLASS_HEADER_CLASS =
  `${WORKSPACE_GLASS_HEADER_BASE_CLASS} border-b border-foreground/10`;
const WORKSPACE_SOLID_HEADER_BASE_CLASS =
  "flex h-12 shrink-0 items-center bg-background";
const WORKSPACE_SOLID_HEADER_CLASS =
  `${WORKSPACE_SOLID_HEADER_BASE_CLASS} border-b border-border/70`;

const EDITOR_GLASS_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-foreground/10 bg-background/60 px-1 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-background/50";
const EDITOR_SOLID_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto px-1 pt-1";

const TERMINAL_GLASS_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden border-b border-foreground/10 bg-background/60 pr-1 backdrop-blur-md supports-[backdrop-filter]:bg-background/50";
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
  showHeaderDivider = true,
  showContentTopBorder = true,
}: {
  transparent: boolean;
  sidebarOpen: boolean;
  showHeaderDivider?: boolean;
  showContentTopBorder?: boolean;
}): StandardWorkspaceChromeClasses {
  const header = transparent
    ? (showHeaderDivider ? WORKSPACE_GLASS_HEADER_CLASS : WORKSPACE_GLASS_HEADER_BASE_CLASS)
    : (showHeaderDivider ? WORKSPACE_SOLID_HEADER_CLASS : WORKSPACE_SOLID_HEADER_BASE_CLASS);

  return {
    root: transparent ? "bg-transparent" : "bg-sidebar",
    contentShell: [
      transparent ? "bg-transparent" : "bg-background",
      sidebarOpen && !transparent ? "rounded-tl-[22px] border-l border-sidebar-border" : "",
      sidebarOpen && !transparent && showContentTopBorder ? "border-t" : "",
    ].filter(Boolean).join(" "),
    header,
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
      sidebarOpen && !transparent ? "rounded-tl-[22px] border-l border-t border-sidebar-border" : "",
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
