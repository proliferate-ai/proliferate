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
} from "@/components/ui/icons";
import { ComposerControlButton } from "./ComposerControlButton";
import { WorkspaceMobilityLocationPopover } from "./WorkspaceMobilityLocationPopover";
import { WorkspaceMobilityConfirmDialog } from "./WorkspaceMobilityConfirmDialog";

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

export function WorkspaceMobilityFooterRow() {
  const footerContext = useMobilityFooterContext();
  const flow = useWorkspaceMobilityFooterFlow();

  if (!footerContext) {
    return null;
  }

  const prompt = flow.prompt;
  const locationTrigger = prompt ? (
    <PopoverButton
      externalOpen={flow.popoverOpen}
      onOpenChange={flow.handlePopoverOpenChange}
      trigger={(
        <ComposerControlButton
          icon={locationIcon(footerContext.locationKind)}
          label={<AnimatedSwapText value={footerContext.locationLabel} />}
          trailing={<ChevronDown className="size-3.5 text-muted-foreground/70" />}
          active={flow.popoverOpen || footerContext.isActive}
          disabled={!footerContext.isInteractive}
          data-telemetry-mask
        />
      )}
      align="start"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <WorkspaceMobilityLocationPopover
          prompt={prompt}
          isActionPending={flow.isPromptActionPending}
          onClose={() => {
            close();
            flow.closePopover();
          }}
          onPrimaryAction={() => {
            const primaryActionKind = prompt.primaryActionKind;
            const result = flow.handlePrimaryAction();
            if (primaryActionKind === "confirm_move") {
              close();
            }
            return result;
          }}
        />
      )}
    </PopoverButton>
  ) : null;

  return (
    <>
      <div className="rounded-[var(--radius-composer)]  px-2 pt-2 ">
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

      <WorkspaceMobilityConfirmDialog
        snapshot={flow.confirmSnapshot}
        open={flow.confirmOpen && flow.confirmSnapshot !== null}
        isPending={flow.isPending}
        onClose={flow.handleConfirmClose}
        onConfirm={flow.handleConfirm}
      />
    </>
  );
}
