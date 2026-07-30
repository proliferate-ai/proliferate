// Canonical popover chrome: 90%-alpha popover fill, 8px blur, 0.5px hairline
// ring, 12px radius, hairline-spread shadow. Lives in a dependency-free
// leaf so its primitives/ siblings can compose it without an import cycle (Popover.tsx, PopoverButton.tsx, and DropdownMenu.tsx all
// import from this module).
export const POPOVER_FRAME_CLASS =
  "m-px rounded-xl bg-popover/90 text-popover-foreground shadow-popover ring-[0.5px] ring-border backdrop-blur-sm";

/**
 * The same frame, every property marked important, for the one consumer that
 * has to outrank a library's own selectors (sonner — see `Sonner.tsx`).
 *
 * Spelled out as a literal rather than derived from `POPOVER_FRAME_CLASS` at
 * runtime, because Tailwind generates utilities by scanning source text: a
 * class name assembled by string manipulation at runtime is never in the
 * stylesheet, so every property silently does nothing. `popoverFrameImportantDrift`
 * in `popover-surface.test.ts` is what keeps the two lists from diverging.
 */
export const POPOVER_FRAME_IMPORTANT_CLASS =
  "!m-px !rounded-xl !bg-popover/90 !text-popover-foreground !shadow-popover !ring-[0.5px] !ring-border !backdrop-blur-sm";
export const POPOVER_SURFACE_CLASS = `${POPOVER_FRAME_CLASS} flex max-h-[calc(100vh-1rem)] min-w-[240px] max-w-[320px] select-none flex-col overflow-y-auto p-1`;
