import { Button } from "@/components/ui/Button";
import { Copy, GmailBrandIcon, Mail, OutlookBrandIcon } from "@/components/ui/icons";
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
    contextLabel,
    fallbackEmail,
    handleCopyEmail,
    handleEmail,
    handleGmail,
    handleOutlook,
    handleSend,
    inAppSupportEnabled,
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
        </div>
      ) : (
        <div className="space-y-4">
          <p className="max-w-md text-sm leading-6 text-foreground">
            Help is a message away. Send us a note at {fallbackEmail}, and
            we&apos;ll reply within a day.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
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
        </div>
      )}
    </ModalShell>
  );
}
