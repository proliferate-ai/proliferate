import { useMobilityFooterContext } from "@/hooks/workspaces/mobility/use-mobility-footer-context";
import { useWorkspaceMobilityFooterFlow } from "@/hooks/workspaces/mobility/use-workspace-mobility-footer-flow";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import {
  ChevronDown,
  Spinner,
} from "@proliferate/ui/icons";
import { SidebarWorkspaceVariantIcon } from "@/components/workspace/shell/sidebar/SidebarWorkspaceVariantIcon";
import { ComposerControlButton } from "@proliferate/product-ui/chat/composer/ComposerControlButton";
import { WorkspaceMobilityLocationPopover } from "./WorkspaceMobilityLocationPopover";
import { WorkspaceOpenInWebFooterControl } from "./WorkspaceOpenInWebFooterControl";
import { WorkspaceRemoteAccessFooterControl } from "./WorkspaceRemoteAccessFooterControl";

export function WorkspaceMobilityFooterProgressStatus({
  statusLabel,
  title,
}: {
  statusLabel: string;
  title: string;
}) {
  return (
    <div className="flex h-7 min-w-0 max-w-[34rem] shrink items-center gap-1.5 rounded-full bg-[var(--color-composer-control-hover)] px-2 text-sm text-foreground">
      <Spinner className="size-3 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{title}</span>
      <span className="h-3 w-px shrink-0 bg-border/80" aria-hidden="true" />
      <span className="min-w-0 truncate text-muted-foreground">{statusLabel}</span>
    </div>
  );
}

export function WorkspaceMobilityFooterRow() {
  const footerContext = useMobilityFooterContext();
  const flow = useWorkspaceMobilityFooterFlow();

  if (!footerContext) {
    return null;
  }

  if (flow.progressStatus) {
    return (
      <div className="rounded-[var(--radius-composer)] px-2 pt-2">
        <WorkspaceMobilityFooterProgressStatus
          title={flow.progressStatus.title}
          statusLabel={flow.progressStatus.statusLabel}
        />
      </div>
    );
  }

  const prompt = flow.prompt;
  const hasDestinations = flow.destinationOptions.length > 0;
  const locationButton = (
    <ComposerControlButton
      icon={(
        <SidebarWorkspaceVariantIcon
          variant={footerContext.variant}
          targetAppearance={footerContext.targetAppearance}
          className="size-3.5 text-muted-foreground"
        />
      )}
      label="Migrate workspace"
      trailing={hasDestinations ? <ChevronDown className="size-3.5 text-muted-foreground/70" /> : undefined}
      active={flow.popoverOpen || footerContext.isActive}
      disabled={!hasDestinations || !footerContext.isInteractive}
      title="Move this workspace between available locations."
      className="shrink-0"
      data-telemetry-mask
    />
  );
  const locationTrigger = hasDestinations && footerContext.isInteractive ? (
    <PopoverButton
      externalOpen={flow.popoverOpen}
      onOpenChange={flow.handlePopoverOpenChange}
      trigger={locationButton}
      align="start"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <WorkspaceMobilityLocationPopover
          destinationOptions={flow.destinationOptions}
          selectedDestinationId={flow.selectedDestinationId}
          prompt={prompt}
          snapshot={flow.confirmSnapshot}
          isActionPending={flow.isPromptActionPending}
          onClose={() => {
            close();
            flow.closePopover();
          }}
          onSelectDestination={flow.handleDestinationSelect}
          onBackToDestinations={flow.handleDestinationBack}
          onPrimaryAction={flow.handlePrimaryAction}
        />
      )}
    </PopoverButton>
  ) : locationButton;

  return (
    <div className="rounded-[var(--radius-composer)] px-2 pt-2">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {locationTrigger}

        <WorkspaceRemoteAccessFooterControl />

        <WorkspaceOpenInWebFooterControl />
      </div>
    </div>
  );
}
