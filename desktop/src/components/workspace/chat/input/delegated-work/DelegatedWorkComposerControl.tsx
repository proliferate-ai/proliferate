import { PopoverButton } from "@/components/ui/PopoverButton";
import { MessageSquare } from "@/components/ui/icons";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ComposerPopoverSurface } from "@/components/workspace/chat/input/ComposerPopoverSurface";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/use-delegated-work-composer";
import { AgentsPopoverCoworkSection } from "./AgentsPopoverCoworkSection";
import { AgentsPopoverReviewSection } from "./AgentsPopoverReviewSection";
import { AgentsPopoverSubagentSection } from "./AgentsPopoverSubagentSection";

export function DelegatedWorkComposerControl({
  viewModel,
}: {
  viewModel: DelegatedWorkComposerViewModel;
}) {
  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          icon={<MessageSquare className="size-3.5" />}
          label="Agents"
          detail={viewModel.summary.label}
          active={viewModel.summary.active}
          aria-label={`Agents, ${viewModel.summary.label}`}
          className="max-w-[15rem]"
        />
      )}
      side="top"
      align="start"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <ComposerPopoverSurface
          className="w-[min(34rem,calc(100vw-2rem))] p-0"
          data-telemetry-mask
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <span className="text-sm font-medium text-foreground">Agents</span>
            <span className="text-xs text-muted-foreground">{viewModel.summary.label}</span>
          </div>
          <div className="max-h-[min(28rem,calc(100vh-10rem))] overflow-y-auto p-2">
            {viewModel.review && (
              <AgentsPopoverReviewSection review={viewModel.review} onClose={close} />
            )}
            {viewModel.cowork && (
              <AgentsPopoverCoworkSection cowork={viewModel.cowork} onClose={close} />
            )}
            {viewModel.subagents && (
              <AgentsPopoverSubagentSection subagents={viewModel.subagents} onClose={close} />
            )}
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}
