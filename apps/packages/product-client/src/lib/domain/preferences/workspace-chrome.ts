// Glass tints anchor to --color-background (the content surface), not card:
// card is a step lighter, which rendered the header as a visibly lighter haze
// band against the opaque chat surface on every theme.
//
// Both chrome modes use 46px (UX_SPEC §7's --height-toolbar) so the
// header always lines up with the right panel's --tab-system-height in
// apps/packages/design/src/css/product.css — the main header aligns down to
// the right pane, not the other way around (owner ruling 2026-07-10).
const WORKSPACE_GLASS_HEADER_BASE_CLASS =
  "flex h-[46px] shrink-0 items-center bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60";
const WORKSPACE_GLASS_HEADER_CLASS =
  `${WORKSPACE_GLASS_HEADER_BASE_CLASS} relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border after:content-['']`;
const WORKSPACE_SOLID_HEADER_BASE_CLASS =
  "flex h-[46px] shrink-0 items-center bg-background";
const WORKSPACE_SOLID_HEADER_CLASS =
  `${WORKSPACE_SOLID_HEADER_BASE_CLASS} relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border after:content-['']`;

const EDITOR_GLASS_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-foreground/10 bg-background/60 px-1 pt-1 backdrop-blur-md supports-[backdrop-filter]:bg-background/50";
const EDITOR_SOLID_TABLIST_CLASS =
  "flex h-9 shrink-0 items-end gap-1 overflow-x-auto px-1 pt-1";

const TERMINAL_GLASS_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden border-b border-foreground/10 bg-background/60 pr-1 backdrop-blur-md supports-[backdrop-filter]:bg-background/50";
const TERMINAL_SOLID_TABLIST_RAIL_CLASS =
  "relative flex shrink-0 items-center gap-1 overflow-hidden pr-1";

// The main sidebar is the one surface that goes translucent while docked
// under transparent chrome (WorkspaceShellSidebar, MainSidebarPageShell). No
// backdrop-blur here: unlike the header/tablist bands above, the sidebar
// relies on the macOS window's native vibrancy showing through, not a CSS
// blur over page content.
export const SIDEBAR_GLASS_CLASS = "bg-sidebar/60";

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

/**
 * Transparent Desktop chrome has no content-shell border to define the main
 * sidebar edge. Opaque chrome already owns that edge on the content shell,
 * and Web owns its responsive sidebar boundary separately.
 */
export function resolveMainSidebarEdgeClassName({
  desktop,
  transparent,
}: {
  desktop: boolean;
  transparent: boolean;
}): string {
  return desktop && transparent ? "border-r border-border" : "";
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
    // The content shell always paints opaque. The main sidebar is the
    // exception (see SIDEBAR_GLASS_CLASS) — it renders translucent glass
    // while docked under transparent chrome. Everywhere else (the chat
    // center) stays opaque regardless of chrome mode, so a transparent shell
    // otherwise only ever exposed window vibrancy through the
    // header/footer/right-panel bands — rendering them as off-shade stripes
    // on every theme.
    contentShell: transparent
      ? "bg-background"
      : [
          "bg-background border-l transition-[border-color,border-top-left-radius] duration-panel ease-out-cubic",
          showContentTopBorder ? "border-t" : "",
          sidebarOpen
            ? "rounded-tl-2xl border-border"
            : "rounded-tl-none border-transparent",
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
      "bg-background",
      sidebarOpen && !transparent ? "rounded-tl-2xl border-l border-t border-border" : "",
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
    inactive: "bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active",
  };
}
