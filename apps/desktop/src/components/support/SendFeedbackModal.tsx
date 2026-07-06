import { useRef } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { CloudUpload, FileText, X } from "@proliferate/ui/icons";
import { useSupportModalState, type StagedAttachment } from "@/hooks/support/facade/use-support-modal-state";
import { useSupportOutreachEmail } from "@/hooks/support/facade/use-support-outreach-email";
import { SupportCheckboxRow } from "./SupportCheckboxRow";
import { SupportCreditField } from "./SupportCreditField";
import { SupportModalFooter } from "./SupportModalFooter";

interface SendFeedbackModalProps {
  onClose: () => void;
}

export function SendFeedbackModal({ onClose }: SendFeedbackModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    attachments,
    canSend,
    creditConsent,
    creditName,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleAttachmentInputChange,
    handleAttachmentPaste,
    handleCancel,
    handleSend,
    includeLogs,
    isSubmitting,
    message,
    notifyMe,
    removeAttachment,
    setCreditConsent,
    setCreditName,
    setIncludeLogs,
    setMessage,
    setNotifyMe,
    setUrgent,
    stagingError,
    urgent,
  } = useSupportModalState({ kind: "bug", onClose });
  const outreach = useSupportOutreachEmail();

  return (
    <ModalShell
      open
      onClose={handleCancel}
      title="Send feedback"
      description="Tell us what happened and we'll look into it."
      sizeClassName="max-w-lg"
      bodyClassName="px-5 pb-5 pt-0"
      telemetryBlocked
    >
      <div
        className="space-y-4"
        onPaste={handleAttachmentPaste}
        onDragOver={handleAttachmentDragOver}
        onDrop={handleAttachmentDrop}
      >
        <section className="space-y-2">
          <Textarea
            id="support-feedback-message"
            variant="code"
            autoFocus
            data-telemetry-mask
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What happened?"
            className="min-h-[120px]"
          />
        </section>

        <AttachmentZone
          fileInputRef={fileInputRef}
          attachments={attachments}
          stagingError={stagingError}
          onBrowse={() => fileInputRef.current?.click()}
          onRemove={removeAttachment}
          onInputChange={handleAttachmentInputChange}
        />

        <div className="space-y-0.5">
          <SupportCheckboxRow
            checked={urgent}
            onCheckedChange={setUrgent}
            label="This is urgent"
            helper="We'll send you an email by tomorrow."
          />
          <SupportCheckboxRow
            checked={notifyMe}
            onCheckedChange={setNotifyMe}
            label="Let me know when you fix this"
            helper="We'll send you an update within a day."
          />
          <SupportCreditField
            label="Credit me"
            creditConsent={creditConsent}
            setCreditConsent={setCreditConsent}
            creditName={creditName}
            setCreditName={setCreditName}
          />
          <SupportCheckboxRow
            checked={includeLogs}
            onCheckedChange={setIncludeLogs}
            label="Include app logs"
          />
        </div>

        <SupportModalFooter outreach={outreach} />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSend}
            loading={isSubmitting}
            onClick={() => { void handleSend(); }}
          >
            Send
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

interface AttachmentZoneProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  attachments: StagedAttachment[];
  stagingError: string | null;
  onBrowse: () => void;
  onRemove: (attachment: StagedAttachment) => void;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function AttachmentZone({
  fileInputRef,
  attachments,
  stagingError,
  onBrowse,
  onRemove,
  onInputChange,
}: AttachmentZoneProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ui font-medium">Attachments</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBrowse}
        >
          <CloudUpload className="size-3.5" />
          Add files
        </Button>
      </div>
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        className="flex min-h-[72px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-surface-control/80 px-4 py-3 text-center text-ui-sm text-muted-foreground transition-colors hover:border-ring hover:bg-popover-accent hover:text-popover-foreground"
        onClick={onBrowse}
      >
        <CloudUpload className="mb-1.5 size-4" />
        <span>Drop screenshots or files here</span>
      </Button>
      <Input
        ref={fileInputRef}
        variant="unstyled"
        type="file"
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      {stagingError ? (
        <p className="text-ui-sm text-destructive">{stagingError}</p>
      ) : null}
      {attachments.length > 0 ? (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex min-h-10 items-center gap-3 rounded-lg border border-border/70 bg-surface-control/70 px-3 py-2 text-ui-sm"
            >
              {attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt=""
                  className="size-8 shrink-0 rounded object-cover"
                />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium leading-5">{attachment.fileName}</div>
                <div className="text-ui-sm text-muted-foreground">
                  {attachment.contentType || "file"} · {formatBytes(attachment.sizeBytes)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${attachment.fileName}`}
                onClick={() => onRemove(attachment)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}
