import type { ReactNode } from "react";
import { GitFork, RotateCw, SquareTerminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import type {
  ActivityChipDescriptor,
  ActivityChipKind,
} from "@proliferate/product-domain/activity/chips";
import { ComposerPopoverSurface } from "../chat/composer/ComposerPopoverSurface";

const CHIP_ICON: Record<ActivityChipKind, LucideIcon> = {
  loops: RotateCw,
  terminals: SquareTerminal,
  agents: GitFork,
};

export interface ActivityChipsProps {
  chips: ActivityChipDescriptor[];
  /**
   * Popover panel content per chip kind. A chip with no entry here still
   * renders (the row is a live-state summary) but is not a click-in — used
   * for degraded/loading states where the panel data isn't ready yet.
   */
  panels?: Partial<Record<ActivityChipKind, ReactNode>>;
}

/**
 * The compact `⟳ 2 loops · ▸ 2 terminals · ⑂ 1 agent` row that stacks on the
 * goal bar's row (session-activity-architecture §Locked decisions #5). Each
 * chip is the click-in to its own panel — this component owns that popover
 * mechanics so callers only supply chip descriptors + panel content.
 */
export function ActivityChips({ chips, panels }: ActivityChipsProps) {
  if (chips.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-session-activity-chips>
      {chips.map((chip, index) => (
        <span key={chip.kind} className="flex items-center gap-1.5">
          {index > 0 && (
            <span aria-hidden className="text-faint">·</span>
          )}
          <ActivityChip chip={chip} panel={panels?.[chip.kind]} />
        </span>
      ))}
    </span>
  );
}

function ActivityChip({
  chip,
  panel,
}: {
  chip: ActivityChipDescriptor;
  panel?: ReactNode;
}) {
  const Icon = CHIP_ICON[chip.kind];
  const label = (
    <>
      <Icon
        className={twMerge("size-3.5 shrink-0", chip.liveCount > 0 && "text-foreground")}
        aria-hidden
      />
      <span>{chip.label}</span>
    </>
  );

  if (!panel) {
    return (
      <span
        className="flex items-center gap-1 text-ui text-muted-foreground"
        aria-label={chip.label}
      >
        {label}
      </span>
    );
  }

  return (
    <PopoverButton
      trigger={(
        <button
          type="button"
          aria-label={chip.label}
          className="flex items-center gap-1 rounded-md text-ui text-muted-foreground transition-colors hover:text-foreground"
        >
          {label}
        </button>
      )}
      side="top"
      align="end"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {() => (
        <ComposerPopoverSurface
          className="w-[min(22rem,calc(100vw-1rem))] p-1.5"
          data-telemetry-mask
        >
          {panel}
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}
