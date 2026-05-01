import { AnimatedSwapText } from "@/components/ui/AnimatedSwapText";
import { useMobilityFooterContext } from "@/hooks/workspaces/mobility/use-mobility-footer-context";
import { useWorkspaceMobilityFooterFlow } from "@/hooks/workspaces/mobility/use-workspace-mobility-footer-flow";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  ChevronDown,
  CloudIcon,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
  LoaderCircle,
} from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";
import { WorkspaceMobilityLocationPopover } from "./WorkspaceMobilityLocationPopover";

function FooterDetailLabel({ value }: { value: string }) {
  return (
    <span title={value} className="[direction:ltr] [unicode-bidi:plaintext]">
      {value}
    </span>
  );
}

function locationIcon(kind: "local_workspace" | "local_worktree" | "cloud_workspace") {
  switch (kind) {
    case "cloud_workspace":
      return <CloudIcon className="size-3.5" />;
    case "local_worktree":
      return <FolderOpen className="size-3.5" />;
    case "local_workspace":
    default:
      return <Folder className="size-3.5" />;
  }
}

export function WorkspaceMobilityFooterProgressStatus({
  statusLabel,
  title,
}: {
  statusLabel: string;
  title: string;
}) {
  return (
    <div className="flex h-7 min-w-0 max-w-[34rem] shrink items-center gap-1.5 rounded-full bg-[var(--color-composer-control-hover)] px-2 text-sm text-foreground">
      <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
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
  const locationButton = (
    <ComposerControlButton
      icon={locationIcon(footerContext.locationKind)}
      label={<AnimatedSwapText value={footerContext.locationLabel} />}
      trailing={prompt ? <ChevronDown className="size-3.5 text-muted-foreground/70" /> : undefined}
      active={flow.popoverOpen || footerContext.isActive}
      disabled={!prompt || !footerContext.isInteractive}
      data-telemetry-mask
    />
  );
  const locationTrigger = prompt && footerContext.isInteractive ? (
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
          prompt={prompt}
          snapshot={flow.confirmSnapshot}
          isActionPending={flow.isPromptActionPending}
          onClose={() => {
            close();
            flow.closePopover();
          }}
          onPrimaryAction={flow.handlePrimaryAction}
        />
      )}
    </PopoverButton>
  ) : locationButton;

  return (
    <div className="rounded-[var(--radius-composer)] px-2 pt-2">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {locationTrigger}

        {footerContext.detailValue && (
          <ComposerControlButton
            icon={footerContext.detailKind === "repository"
              ? <CloudIcon className="size-3.5" />
              : <Folder className="size-3.5" />}
            label={<FooterDetailLabel value={footerContext.detailValue} />}
            labelClassName={footerContext.detailKind === "path" ? "[direction:rtl]" : undefined}
            trailing={<Copy className="size-3 text-muted-foreground/70" />}
            onClick={() => {
              void flow.handleCopy(footerContext.detailValue, footerContext.detailCopyLabel);
            }}
            title={footerContext.detailValue ?? undefined}
            data-telemetry-mask
          />
        )}

        {footerContext.branchLabel && (
          <ComposerControlButton
            icon={<GitBranch className="size-3.5" />}
            label={footerContext.branchLabel}
            trailing={<Copy className="size-3 text-muted-foreground/70" />}
            onClick={() => {
              void flow.handleCopy(footerContext.branchValue, "Branch");
            }}
            title={footerContext.branchValue ?? undefined}
            data-telemetry-mask
          />
        )}
      </div>
    </div>
  );
}
