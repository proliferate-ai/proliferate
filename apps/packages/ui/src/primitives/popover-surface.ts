// Canonical popover chrome (codex dropdown recipe): 90%-alpha popover fill,
// 8px blur, 0.5px hairline ring, 12px radius, hairline-spread shadow. Lives in
// a dependency-free leaf so kit/* can compose it without an import cycle
// (PopoverButton imports kit/Popover).
export const POPOVER_FRAME_CLASS =
  "m-px rounded-xl bg-popover/90 text-popover-foreground shadow-popover ring-[0.5px] ring-popover-ring backdrop-blur-sm";
export const POPOVER_SURFACE_CLASS = `${POPOVER_FRAME_CLASS} flex max-h-[calc(100vh-1rem)] min-w-[240px] max-w-[320px] select-none flex-col overflow-y-auto p-1`;
