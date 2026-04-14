import { Button } from "@/components/ui/Button";
import {
  Archive,
  Copy,
  FileText,
  FolderList,
  GmailBrandIcon,
  Mail,
  OutlookBrandIcon,
} from "@/components/ui/icons";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useSupportDialogState } from "@/hooks/support/use-support-dialog-state";
import type { SupportMessageContext } from "@/lib/integrations/cloud/support";

interface SupportDialogProps {
  open: boolean;
  onClose: () => void;
  context: SupportMessageContext;
}

export function SupportDialog({
  open,
  onClose,
  context,
}: SupportDialogProps) {
  const {
    canExportDebugBundle,
    canCopyInvestigationJson,
    canExportActiveSessionJson,
    canExportWorkspaceJson,
    contextLabel,
    fallbackEmail,
    handleCopyInvestigationJson,
    handleExportActiveSessionJson,
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
    isExportingSessionDebugJson,
    isExportingWorkspaceDebugJson,
    isSendingSupportMessage,
    message,
    setMessage,
    textareaRef,
  } = useSupportDialogState({
    open,
    onClose,
    context,
  });

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Support"
      description={inAppSupportEnabled
        ? "Questions, bugs, or setup issues. Send a note and we'll follow up directly."
        : undefined}
      sizeClassName="max-w-lg"
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
      {inAppSupportEnabled ? (
        <div className="space-y-3">
          {contextLabel && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {contextLabel}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            rows={6}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What do you need help with?"
            className="min-h-[132px] border-border bg-background text-[13px]"
          />
          {canExportDebugBundle && (
            <SupportDebugSection
              canCopyInvestigationJson={canCopyInvestigationJson}
              canExportActiveSessionJson={canExportActiveSessionJson}
              canExportWorkspaceJson={canExportWorkspaceJson}
              handleCopyInvestigationJson={handleCopyInvestigationJson}
              handleExportActiveSessionJson={handleExportActiveSessionJson}
              handleExportDebugBundle={handleExportDebugBundle}
              handleExportWorkspaceJson={handleExportWorkspaceJson}
              isCopyingInvestigationJson={isCopyingInvestigationJson}
              isExportingDebugBundle={isExportingDebugBundle}
              isExportingSessionDebugJson={isExportingSessionDebugJson}
              isExportingWorkspaceDebugJson={isExportingWorkspaceDebugJson}
            />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="max-w-md text-sm leading-6 text-foreground">
            Help is a message away. Send us a note at {fallbackEmail}, and
            we&apos;ll reply within a day.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
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
              <Mail className="size-3.5 shrink-0" />
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
          {canExportDebugBundle && (
            <SupportDebugSection
              canCopyInvestigationJson={canCopyInvestigationJson}
              canExportActiveSessionJson={canExportActiveSessionJson}
              canExportWorkspaceJson={canExportWorkspaceJson}
              handleCopyInvestigationJson={handleCopyInvestigationJson}
              handleExportActiveSessionJson={handleExportActiveSessionJson}
              handleExportDebugBundle={handleExportDebugBundle}
              handleExportWorkspaceJson={handleExportWorkspaceJson}
              isCopyingInvestigationJson={isCopyingInvestigationJson}
              isExportingDebugBundle={isExportingDebugBundle}
              isExportingSessionDebugJson={isExportingSessionDebugJson}
              isExportingWorkspaceDebugJson={isExportingWorkspaceDebugJson}
            />
          )}
        </div>
      )}
    </ModalShell>
  );
}

interface SupportDebugSectionProps {
  canCopyInvestigationJson: boolean;
  canExportActiveSessionJson: boolean;
  canExportWorkspaceJson: boolean;
  handleCopyInvestigationJson: () => Promise<void>;
  handleExportActiveSessionJson: () => Promise<void>;
  handleExportDebugBundle: () => Promise<void>;
  handleExportWorkspaceJson: () => Promise<void>;
  isCopyingInvestigationJson: boolean;
  isExportingDebugBundle: boolean;
  isExportingSessionDebugJson: boolean;
  isExportingWorkspaceDebugJson: boolean;
}

function SupportDebugSection({
  canCopyInvestigationJson,
  canExportActiveSessionJson,
  canExportWorkspaceJson,
  handleCopyInvestigationJson,
  handleExportActiveSessionJson,
  handleExportDebugBundle,
  handleExportWorkspaceJson,
  isCopyingInvestigationJson,
  isExportingDebugBundle,
  isExportingSessionDebugJson,
  isExportingWorkspaceDebugJson,
}: SupportDebugSectionProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="space-y-2">
        <div>
          <p className="text-xs font-medium text-foreground">Session debugging</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Copy a compact investigation locator or export full raw and normalized event JSON.
          </p>
        </div>
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
  );
}
