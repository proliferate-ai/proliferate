import type { ReactNode } from "react";
import {
  Copy,
  GitBranch,
  IconButton,
  ShortcutBadge,
  SquareTerminal,
  TooltipContent,
  TooltipPrimitive,
  TooltipProvider,
  TooltipTrigger,
} from "@proliferate/ui";

/**
 * `TooltipPrimitive` is the Radix tooltip Root re-exported by the DS. Unlike
 * the styled `Tooltip` wrapper it accepts `defaultOpen`, which is the only way
 * a still capture can photograph the bubble itself — every cell below renders
 * the real `TooltipContent` surface (popover fill, hairline ring, popover
 * shadow, `text-ui` medium ink), not just the trigger.
 */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex w-full items-center justify-center"
      style={{ height: 560 }}
    >
      {children}
    </div>
  );
}

export const OpenBubble = () => (
  <TooltipProvider>
    <Stage>
      <TooltipPrimitive defaultOpen>
        <TooltipTrigger asChild>
          <IconButton aria-label="Copy commit SHA">
            <Copy className="icon-paired" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          Copy commit SHA
        </TooltipContent>
      </TooltipPrimitive>
    </Stage>
  </TooltipProvider>
);

export const Sides = () => (
  <TooltipProvider>
    <div
      className="grid w-full grid-cols-3 items-center justify-items-center px-12"
      style={{ height: 560 }}
    >
      <TooltipPrimitive defaultOpen>
        <TooltipTrigger asChild>
          <IconButton aria-label="Open terminal">
            <SquareTerminal className="icon-paired" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          Open terminal
        </TooltipContent>
      </TooltipPrimitive>

      <TooltipPrimitive defaultOpen>
        <TooltipTrigger asChild>
          <IconButton aria-label="Switch branch">
            <GitBranch className="icon-paired" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          Switch branch
        </TooltipContent>
      </TooltipPrimitive>

      <TooltipPrimitive defaultOpen>
        <TooltipTrigger asChild>
          <IconButton aria-label="Copy worktree path">
            <Copy className="icon-paired" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Copy worktree path
        </TooltipContent>
      </TooltipPrimitive>
    </div>
  </TooltipProvider>
);

export const CompoundLabel = () => (
  <TooltipProvider>
    <Stage>
      <TooltipPrimitive defaultOpen>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-ui text-foreground"
          >
            proliferate/anyharness
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="max-w-xs">
          <span className="flex items-center gap-2">
            <span>Open workspace</span>
            <ShortcutBadge label="⌘O" />
          </span>
          <span className="mt-1 block font-normal text-muted-foreground">
            ~/src/anyharness · feature/session-activity
          </span>
        </TooltipContent>
      </TooltipPrimitive>
    </Stage>
  </TooltipProvider>
);

export const TriggerRow = () => (
  <TooltipProvider delayDuration={150}>
    <Stage>
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2 py-1.5">
          <TooltipPrimitive>
            <TooltipTrigger asChild>
              <IconButton aria-label="Open terminal">
                <SquareTerminal className="icon-paired" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>Open terminal</TooltipContent>
          </TooltipPrimitive>
          <TooltipPrimitive>
            <TooltipTrigger asChild>
              <IconButton aria-label="Switch branch">
                <GitBranch className="icon-paired" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>Switch branch</TooltipContent>
          </TooltipPrimitive>
          <TooltipPrimitive>
            <TooltipTrigger asChild>
              <IconButton aria-label="Copy commit SHA">
                <Copy className="icon-paired" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>Copy commit SHA</TooltipContent>
          </TooltipPrimitive>
        </div>
        <p className="text-ui-sm text-muted-foreground">
          Resting triggers — the bubble opens after the provider's 150 ms delay.
        </p>
      </div>
    </Stage>
  </TooltipProvider>
);
