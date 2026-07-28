import type { ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  GitBranch,
  IconButton,
  Pencil,
  SquareTerminal,
  TooltipContent,
  TooltipPrimitive,
  TooltipProvider,
  TooltipTrigger,
  Trash,
} from "@proliferate/ui";

/**
 * `TooltipProvider` renders no markup of its own — it is the Radix context that
 * every `TooltipPrimitive` in a subtree shares (open delay, skip delay and the
 * one-bubble-at-a-time rule). These cells therefore photograph the provider
 * AROUND a real toolbar, with one member opened via `defaultOpen` so the bubble
 * the provider governs is actually in frame.
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

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2 py-1.5">
      {children}
    </div>
  );
}

export const WrappedToolbar = () => (
  <TooltipProvider delayDuration={0}>
    <Stage>
      <div className="flex flex-col items-center gap-16">
        <p className="text-ui-sm text-muted-foreground">
          One provider, three tooltips — only one bubble may be open at a time.
        </p>
        <Toolbar>
          <TooltipPrimitive defaultOpen>
            <TooltipTrigger asChild>
              <IconButton aria-label="Open terminal">
                <SquareTerminal className="icon-paired" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              Open terminal
            </TooltipContent>
          </TooltipPrimitive>
          <TooltipPrimitive>
            <TooltipTrigger asChild>
              <IconButton aria-label="Switch branch">
                <GitBranch className="icon-paired" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">Switch branch</TooltipContent>
          </TooltipPrimitive>
          <TooltipPrimitive>
            <TooltipTrigger asChild>
              <IconButton aria-label="Copy worktree path">
                <Copy className="icon-paired" />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">Copy worktree path</TooltipContent>
          </TooltipPrimitive>
        </Toolbar>
      </div>
    </Stage>
  </TooltipProvider>
);

export const DelayDuration = () => (
  <Stage>
    <div className="flex flex-col gap-16">
      <div className="flex items-center gap-4">
        <span className="w-64 shrink-0 text-ui-sm text-muted-foreground">
          delayDuration=&#123;0&#125; — bubble already open
        </span>
        <TooltipProvider delayDuration={0}>
          <Toolbar>
            <TooltipPrimitive defaultOpen>
              <TooltipTrigger asChild>
                <IconButton aria-label="Rename workspace">
                  <Pencil className="icon-paired" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                Rename workspace
              </TooltipContent>
            </TooltipPrimitive>
            <TooltipPrimitive>
              <TooltipTrigger asChild>
                <IconButton aria-label="Delete workspace">
                  <Trash className="icon-paired" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="top">Delete workspace</TooltipContent>
            </TooltipPrimitive>
          </Toolbar>
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-4">
        <span className="w-64 shrink-0 text-ui-sm text-muted-foreground">
          delayDuration=&#123;600&#125; — triggers at rest
        </span>
        <TooltipProvider delayDuration={600}>
          <Toolbar>
            <TooltipPrimitive>
              <TooltipTrigger asChild>
                <IconButton aria-label="Open on GitHub">
                  <ExternalLink className="icon-paired" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="right">Open on GitHub</TooltipContent>
            </TooltipPrimitive>
            <TooltipPrimitive>
              <TooltipTrigger asChild>
                <IconButton aria-label="Copy commit SHA">
                  <Copy className="icon-paired" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="right">Copy commit SHA</TooltipContent>
            </TooltipPrimitive>
          </Toolbar>
        </TooltipProvider>
      </div>
    </div>
  </Stage>
);

export const StatusChipTooltip = () => (
  <TooltipProvider delayDuration={150}>
    <Stage>
      <div className="flex w-96 flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <span className="text-ui text-foreground">anyharness · session-activity</span>
        <p className="text-ui-sm text-muted-foreground">
          Worktree at ~/src/anyharness · last synced 4m ago
        </p>
        <div className="flex items-center gap-2">
          <TooltipPrimitive defaultOpen>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full border border-border bg-surface-control px-2 py-0.5 text-ui-sm text-muted-foreground"
              >
                3 ahead · 1 behind
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={20}>
              3 commits to push, 1 to pull from origin/main
            </TooltipContent>
          </TooltipPrimitive>
        </div>
      </div>
    </Stage>
  </TooltipProvider>
);
