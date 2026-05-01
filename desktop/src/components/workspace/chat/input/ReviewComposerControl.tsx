import type { ReactNode } from "react";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { ChevronDown } from "@/components/ui/icons";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ComposerPopoverSurface } from "@/components/workspace/chat/input/ComposerPopoverSurface";
import { DelegatedWorkComposerPanel } from "@/components/workspace/chat/input/DelegatedWorkComposerPanel";

export interface ReviewComposerSummary {
  label: string;
  detail: string | null;
}

export function ReviewComposerStrip({
  summary,
  icon,
  active,
  children,
}: {
  summary: ReviewComposerSummary;
  icon?: ReactNode;
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <DelegatedWorkComposerPanel>
      <ReviewComposerControl
        summary={summary}
        icon={icon}
        active={active}
      >
        {children}
      </ReviewComposerControl>
    </DelegatedWorkComposerPanel>
  );
}

export function ReviewComposerControl({
  summary,
  icon,
  active,
  children,
}: {
  summary: ReviewComposerSummary;
  icon?: ReactNode;
  active: boolean;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <PopoverButton
      side="top"
      align="start"
      offset={6}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
      trigger={(
        <ComposerControlButton
          icon={icon}
          label={summary.label}
          detail={summary.detail}
          trailing={<ChevronDown className="size-3 text-[color:var(--color-composer-control-muted-foreground)]" />}
          active={active}
          className="max-w-full"
          aria-label="Review agents"
        />
      )}
    >
      {(close) => (
        <ComposerPopoverSurface className="w-[min(30rem,calc(100vw-2rem))] p-0" data-telemetry-mask>
          {children(close)}
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}
