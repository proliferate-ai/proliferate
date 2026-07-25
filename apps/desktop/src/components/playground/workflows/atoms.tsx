import { useState } from "react";
import { Blocks, Check, ChevronDown, ChevronRight, GitBranch, X as XIcon } from "@proliferate/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import type { MockPlacement, MockRun } from "./fixtures";
import { runHeadline, type MockDotKind } from "./presentation";

/** Quiet Linear-style property picker: plain value + tiny caret, menu with checkmarks. */
export function PropertyMenu({
  value,
  display,
  options,
  onSelect,
  emphasize,
}: {
  value: string;
  display: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
  emphasize?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={twMerge(
            "group/pick flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.05]",
            emphasize ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {display}
          <ChevronDown className="size-2.5 text-faint opacity-0 transition-opacity group-hover/pick:opacity-100 data-[state=open]:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onSelect(option.value)}>
            <span className="flex w-4 items-center">
              {option.value === value ? <Check className="size-3" /> : null}
            </span>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Inline-edit skin for Input/Textarea/Select: invisible at rest, hairline on
 * hover, real field on focus — one always-editable view, no edit mode.
 */
export const GHOST_FIELD =
  "-mx-1 border-transparent bg-transparent px-1 shadow-none transition-colors hover:border-border focus:border-input focus:bg-surface-control";

/**
 * Monochrome status dot — shape and motion carry state, never color:
 * hollow = pending/interrupted, filled = settled, pulsing = live, ✕ = failed.
 */
export function MonoDot({ kind, className }: { kind: MockDotKind; className?: string }) {
  if (kind === "failed") {
    return (
      <span
        aria-hidden
        className={twMerge("inline-flex shrink-0 items-center text-muted-foreground", className)}
      >
        <XIcon className="size-3" />
      </span>
    );
  }
  if (kind === "interrupted") {
    return (
      <span
        aria-hidden
        className={twMerge("inline-flex shrink-0 items-center text-muted-foreground", className)}
      >
        <svg viewBox="0 0 8 8" className="size-2">
          <circle
            cx="4"
            cy="4"
            r="3.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeDasharray="2 1.6"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={twMerge("inline-flex shrink-0 items-center text-muted-foreground", className)}
    >
      <span
        className={twMerge(
          "size-2 rounded-full",
          kind === "hollow" ? "border border-current bg-transparent" : "bg-current",
          kind === "pulsing" ? "animate-pulse motion-reduce:animate-none" : "",
        )}
      />
    </span>
  );
}

/** Inline placement: quiet icon + text, no chip chrome. */
export function PlacementInline({
  placement,
  className,
}: {
  placement: MockPlacement;
  className?: string;
}) {
  const Icon = placement.kind === "repositoryWorktree" ? GitBranch : Blocks;
  return (
    <span
      className={twMerge(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3 text-faint" aria-hidden />
      {placement.kind === "repositoryWorktree" ? placement.repo : "Scratch workspace"}
    </span>
  );
}

/** Page section: hairline above, quiet uppercase title, optional right aside. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={twMerge("border-t border-border pt-5", className)}>
      <div className="flex items-baseline justify-between pb-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Compact label/value property row, Linear-style. */
export function PropertyRow({
  label,
  value,
  detail,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-4 py-1.5">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={twMerge("text-sm text-foreground", mono ? "truncate font-mono text-xs" : "")}>
          {value}
        </span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  );
}

/** Text-only disclosure — a quiet row with a caret, no card chrome. */
export function Disclosure({
  label,
  summary,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: (prev: boolean) => boolean) =>
    onOpenChange ? onOpenChange(next(open)) : setInternalOpen(next);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group flex items-center gap-1.5 py-1.5 text-left"
      >
        <ChevronRight
          className={twMerge(
            "size-3 shrink-0 text-faint transition-transform",
            open ? "rotate-90" : "",
          )}
        />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground">
          {label}
        </span>
        {!open ? <span className="min-w-0 truncate text-xs text-faint">{summary}</span> : null}
      </button>
      {open ? <div className="flex flex-col pb-2 pl-4.5">{children}</div> : null}
    </div>
  );
}

/**
 * Flat run list row: hairline-separated, hover tint, no card border.
 * `compact` drops the suffix and short id for narrow contexts.
 */
export function RunRow({
  run,
  onOpen,
  compact,
}: {
  run: MockRun;
  onOpen: () => void;
  compact?: boolean;
}) {
  const headline = runHeadline(run);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className="group flex h-9 cursor-pointer items-center gap-3 border-b border-border px-1 transition-colors last:border-b-0 hover:bg-foreground/[0.03]"
    >
      <MonoDot kind={headline.dot} />
      <span
        className={twMerge(
          "truncate text-sm text-foreground",
          compact ? "shrink-0" : "w-44 shrink-0",
        )}
      >
        {headline.label}
      </span>
      {!compact && headline.suffix ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">{headline.suffix}</span>
      ) : null}
      <span className="min-w-0 flex-1" />
      {run.placement.kind === "scratch" ? (
        <Blocks className="size-3 shrink-0 text-faint" aria-label="Scratch workspace" />
      ) : null}
      {!compact ? (
        <span className="shrink-0 font-mono text-xs text-faint">
          {run.invocationId.slice(0, 8)}
        </span>
      ) : null}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{run.createdAt}</span>
      <ChevronRight className="size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
