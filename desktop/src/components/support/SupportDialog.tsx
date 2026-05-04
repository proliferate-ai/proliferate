import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Archive,
  ChevronDown,
  Copy,
  FileText,
  FolderList,
  GmailBrandIcon,
  MailAppIcon,
  OutlookBrandIcon,
} from "@/components/ui/icons";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useSupportDialogState } from "@/hooks/support/use-support-dialog-state";
import { SUPPORT_MESSAGE_MAX_LENGTH } from "@/lib/domain/support/constants";
import { clampSupportMessage } from "@/lib/domain/support/formatting";
import type { SupportMessageContext } from "@/lib/integrations/cloud/support";

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
    contextLabel,
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
    handleSend,
    inAppSupportEnabled,
    isCopyingInvestigationJson,
    isExportingDebugBundle,
    isExportingReplayRecording,
    isExportingSessionDebugJson,
    isExportingWorkspaceDebugJson,
    isSendingSupportMessage,
    message,
    setMessage,
  } = useSupportDialogState({
    onClose,
    context,
  });

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Support"
      description={inAppSupportEnabled
        ? "Questions, bugs, or setup issues. Send a note and we'll follow up directly."
        : undefined}
      sizeClassName="max-w-lg"
      overlayClassName="bg-background/65 backdrop-blur-[3px]"
      panelClassName="border-border/70 bg-background/95 shadow-floating"
      bodyClassName="px-5 pb-5 pt-0"
      telemetryBlocked
      footer={inAppSupportEnabled ? (
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => { void handleSend(); }}
            loading={isSendingSupportMessage}
            disabled={!message.trim()}
          >
            Send
          </Button>
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        {inAppSupportEnabled ? (
          <div className="space-y-3">
            {contextLabel && (
              <div className="rounded-md border border-border bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                {contextLabel}
              </div>
            )}
            <div className="space-y-1.5">
              <Textarea
                autoFocus
                rows={6}
                maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
                value={message}
                onChange={(event) => setMessage(clampSupportMessage(event.target.value))}
                placeholder="What do you need help with?"
                className="min-h-[132px]"
              />
              <div className="flex justify-end">
                <span className="text-xs text-muted-foreground">
                  {message.length} / {SUPPORT_MESSAGE_MAX_LENGTH}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="max-w-md text-sm leading-6 text-foreground">
              Help is a message away. Send us a note at {fallbackEmail}, and
              we&apos;ll reply within a day.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                className="border border-foreground/20 bg-foreground/5 text-foreground shadow-none hover:bg-foreground/10"
                onClick={() => { void handleGmail(); }}
              >
                <GmailBrandIcon className="size-3.5 shrink-0" />
                {CAPABILITY_COPY.supportGmailLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleOutlook(); }}
              >
                <OutlookBrandIcon className="size-3.5 shrink-0" />
                {CAPABILITY_COPY.supportOutlookLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleEmail(); }}
              >
                <MailAppIcon className="size-4 shrink-0" />
                {CAPABILITY_COPY.supportMailAppLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleCopyEmail(); }}
              >
                <Copy className="size-3.5 shrink-0" />
                {CAPABILITY_COPY.supportCopyLabel}
              </Button>
            </div>
          </div>
        )}

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
        className="flex w-full whitespace-normal rounded-md border border-border bg-foreground/5 px-3 py-2 text-left transition-colors hover:bg-foreground/10"
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
        className="rounded-md border border-border bg-foreground/5 px-3 py-2"
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
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground/80">
          Event exports include prompts, raw notifications, tool output, file paths, and
          runtime metadata. Nothing is sent automatically.
        </p>
      </div>
    </div>
  );
}
