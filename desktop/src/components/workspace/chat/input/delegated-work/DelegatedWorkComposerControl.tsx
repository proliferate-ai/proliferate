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
  const sectionCount = [
    viewModel.review,
    viewModel.cowork,
    viewModel.subagents,
  ].filter(Boolean).length;
  const singleSectionTitle = viewModel.review
    ? "Reviews"
    : viewModel.cowork
      ? "Cowork"
      : viewModel.subagents
        ? "Subagents"
        : "Agents";
  const headerTitle = sectionCount === 1 ? singleSectionTitle : "Agents";

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
          className="w-[min(22rem,calc(100vw-1rem))] p-1"
          data-telemetry-mask
        >
          <div className="flex h-7 items-center justify-between gap-2 px-2">
            <span className="text-xs font-medium text-foreground">{headerTitle}</span>
            <span className="text-xs text-muted-foreground">{viewModel.summary.label}</span>
          </div>
          <div className="max-h-[min(22rem,calc(100vh-10rem))] overflow-y-auto">
            {viewModel.review && (
              <AgentsPopoverReviewSection
                review={viewModel.review}
                showTitle={sectionCount > 1}
                onClose={close}
              />
            )}
            {viewModel.cowork && (
              <AgentsPopoverCoworkSection
                cowork={viewModel.cowork}
                showTitle={sectionCount > 1}
                onClose={close}
              />
            )}
            {viewModel.subagents && (
              <AgentsPopoverSubagentSection
                subagents={viewModel.subagents}
                showTitle={sectionCount > 1}
                onClose={close}
              />
            )}
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}
