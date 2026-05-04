import { PopoverButton } from "@/components/ui/PopoverButton";
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
  const singleSection = sectionCount === 1;
  const singleSectionDetail = singleSection ? viewModel.summary.label : null;

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
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
          className="w-[min(20rem,calc(100vw-1rem))] p-1"
          data-telemetry-mask
        >
          <div className="max-h-[min(20rem,calc(100vh-10rem))] overflow-y-auto">
            {viewModel.review && (
              <AgentsPopoverReviewSection
                review={viewModel.review}
                detail={singleSectionDetail}
                onClose={close}
              />
            )}
            {viewModel.cowork && (
              <AgentsPopoverCoworkSection
                cowork={viewModel.cowork}
                detail={singleSectionDetail}
                onClose={close}
              />
            )}
            {viewModel.subagents && (
              <AgentsPopoverSubagentSection
                subagents={viewModel.subagents}
                detail={singleSectionDetail}
                onClose={close}
              />
            )}
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}
