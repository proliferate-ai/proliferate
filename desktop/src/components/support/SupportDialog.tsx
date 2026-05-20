import { useId, useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  Archive,
  ChevronDown,
  Copy,
  FileText,
  FolderList,
} from "@/components/ui/icons";
import { ModalShell } from "@/components/ui/ModalShell";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { useSupportDialogState } from "@/hooks/support/facade/use-support-dialog-state";
import type { SupportMessageContext } from "@/lib/domain/support/types";

interface SupportDialogProps {
  onClose: () => void;
  context: SupportMessageContext;
}

export function SupportDialog({
  onClose,
  context,
}: SupportDialogProps) {
  const [debugExpanded, setDebugExpanded] = useState(false);
  const debugSectionId = useId();
  const {
    canExportDebugBundle,
    canCopyInvestigationJson,
    canExportActiveSessionJson,
    canExportReplayRecording,
    canExportWorkspaceJson,
    fallbackEmail,
    handleCopyInvestigationJson,
    handleExportActiveSessionJson,
    handleExportReplayRecording,
    handleExportDebugBundle,
    handleExportWorkspaceJson,
    handleCopyEmail,
    handleEmail,
    handleGmail,
    handleOutlook,
    isCopyingInvestigationJson,
    isExportingDebugBundle,
    isExportingReplayRecording,
    isExportingSessionDebugJson,
    isExportingWorkspaceDebugJson,
  } = useSupportDialogState({
    onClose,
    context,
  });

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Support"
      description="Questions, bugs, or setup issues. Send a note and we'll follow up directly."
      sizeClassName="max-w-lg"
      bodyClassName="px-5 pb-5 pt-0"
      telemetryBlocked
    >
      <div className="space-y-4">
        <div className="space-y-4">
          <p className="max-w-md text-sm leading-6">
            Help is a message away. Send us a note at {fallbackEmail}, and
            we&apos;ll reply within a day.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              autoFocus
              onClick={() => { void handleGmail(); }}
            >
              {CAPABILITY_COPY.supportGmailLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleOutlook(); }}
            >
              {CAPABILITY_COPY.supportOutlookLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleEmail(); }}
            >
              {CAPABILITY_COPY.supportMailAppLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleCopyEmail(); }}
            >
              {CAPABILITY_COPY.supportCopyLabel}
            </Button>
          </div>
        </div>

        {canExportDebugBundle && (
          <SupportDebugSection
            expanded={debugExpanded}
            contentId={debugSectionId}
            onToggle={() => setDebugExpanded((expanded) => !expanded)}
            canCopyInvestigationJson={canCopyInvestigationJson}
            canExportActiveSessionJson={canExportActiveSessionJson}
            canExportReplayRecording={canExportReplayRecording}
            canExportWorkspaceJson={canExportWorkspaceJson}
            handleCopyInvestigationJson={handleCopyInvestigationJson}
            handleExportActiveSessionJson={handleExportActiveSessionJson}
            handleExportReplayRecording={handleExportReplayRecording}
            handleExportDebugBundle={handleExportDebugBundle}
            handleExportWorkspaceJson={handleExportWorkspaceJson}
            isCopyingInvestigationJson={isCopyingInvestigationJson}
            isExportingDebugBundle={isExportingDebugBundle}
            isExportingReplayRecording={isExportingReplayRecording}
            isExportingSessionDebugJson={isExportingSessionDebugJson}
            isExportingWorkspaceDebugJson={isExportingWorkspaceDebugJson}
          />
        )}
      </div>
    </ModalShell>
  );
}

interface SupportDebugSectionProps {
  expanded: boolean;
  contentId: string;
  onToggle: () => void;
  canCopyInvestigationJson: boolean;
  canExportActiveSessionJson: boolean;
  canExportReplayRecording: boolean;
  canExportWorkspaceJson: boolean;
  handleCopyInvestigationJson: () => Promise<void>;
  handleExportActiveSessionJson: () => Promise<void>;
  handleExportReplayRecording: () => Promise<void>;
  handleExportDebugBundle: () => Promise<void>;
  handleExportWorkspaceJson: () => Promise<void>;
  isCopyingInvestigationJson: boolean;
  isExportingDebugBundle: boolean;
  isExportingReplayRecording: boolean;
  isExportingSessionDebugJson: boolean;
  isExportingWorkspaceDebugJson: boolean;
}

function SupportDebugSection({
  expanded,
  contentId,
  onToggle,
  canCopyInvestigationJson,
  canExportActiveSessionJson,
  canExportReplayRecording,
  canExportWorkspaceJson,
  handleCopyInvestigationJson,
  handleExportActiveSessionJson,
  handleExportReplayRecording,
  handleExportDebugBundle,
  handleExportWorkspaceJson,
  isCopyingInvestigationJson,
  isExportingDebugBundle,
  isExportingReplayRecording,
  isExportingSessionDebugJson,
  isExportingWorkspaceDebugJson,
}: SupportDebugSectionProps) {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex w-full whitespace-normal rounded-md py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">
            Session debugging
          </span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Export diagnostic details only when support asks for them.
          </span>
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </Button>

      <div
        id={contentId}
        hidden={!expanded}
        className="border-t border-border pt-3"
      >
        <div className="space-y-2">
          <p className="text-xs leading-5 text-muted-foreground">
            Copy a compact investigation locator or export full raw and normalized event JSON.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={isCopyingInvestigationJson}
              disabled={!canCopyInvestigationJson}
              onClick={() => { void handleCopyInvestigationJson(); }}
            >
              <Copy className="size-3.5 shrink-0" />
              Copy investigation JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={isExportingSessionDebugJson}
              disabled={!canExportActiveSessionJson}
              onClick={() => { void handleExportActiveSessionJson(); }}
            >
              <FileText className="size-3.5 shrink-0" />
              Export active session JSON
            </Button>
            {canExportReplayRecording && (
              <Button
                variant="outline"
                size="sm"
                loading={isExportingReplayRecording}
                onClick={() => { void handleExportReplayRecording(); }}
              >
                <FileText className="size-3.5 shrink-0" />
                Export replay recording
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              loading={isExportingWorkspaceDebugJson}
              disabled={!canExportWorkspaceJson}
              onClick={() => { void handleExportWorkspaceJson(); }}
            >
              <FolderList className="size-3.5 shrink-0" />
              Export workspace JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={isExportingDebugBundle}
              onClick={() => { void handleExportDebugBundle(); }}
            >
              <Archive className="size-3.5 shrink-0" />
              Export debug bundle
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          Event exports include prompts, raw notifications, tool output, file paths, and
          runtime metadata. Nothing is sent automatically.
        </p>
      </div>
    </div>
  );
}
