import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { Robot } from "@proliferate/ui/icons";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import type { DelegatedWorkComposerViewModel } from "@/hooks/chat/facade/use-delegated-work-composer";
import { AgentsPopoverSubagentSection } from "./AgentsPopoverSubagentSection";

export function DelegatedWorkComposerControl({
  viewModel,
}: {
  viewModel: DelegatedWorkComposerViewModel;
}) {
  const singleAgent = viewModel.singleAgent;

  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          icon={singleAgent ? (
            <Robot className={`size-3.5 ${singleAgent.textColorClassName}`} />
          ) : undefined}
          label={singleAgent ? singleAgent.displayName : "Agents"}
          detail={singleAgent ? null : viewModel.summary.label}
          active={viewModel.summary.active}
          aria-label={singleAgent
            ? `Agent, ${singleAgent.displayName}`
            : `Agents, ${viewModel.summary.label}`}
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
          className="w-[min(23rem,calc(100vw-1rem))] p-1.5"
          data-telemetry-mask
        >
          <div className="max-h-[min(22rem,calc(100vh-10rem))] space-y-1 overflow-y-auto">
            {viewModel.subagents && (
              <AgentsPopoverSubagentSection
                subagents={viewModel.subagents}
                detail={viewModel.summary.label}
                onClose={close}
              />
            )}
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}
