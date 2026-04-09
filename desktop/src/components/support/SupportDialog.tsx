import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { sendSupportMessage, type SupportMessageContext } from "@/lib/integrations/cloud/support";
import { copyText, openGmailCompose } from "@/platform/tauri/shell";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface SupportDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  context: SupportMessageContext;
  defaultMessage?: string;
}

function contextLabel(context: SupportMessageContext): string {
  if (context.workspaceName && context.workspaceLocation) {
    return `${context.workspaceLocation} · ${context.workspaceName}`;
  }
  if (context.workspaceName) return context.workspaceName;
  if (context.pathname) return context.pathname;
  return "Current app context will be included.";
}

export function SupportDialog({
  open,
  onClose,
  title,
  description,
  context,
  defaultMessage = "",
}: SupportDialogProps) {
  const { supportEnabled } = useAppCapabilities();
  const authStatus = useAuthStore((s) => s.status);
  const showToast = useToastStore((s) => s.show);
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);
  const fallbackEmail = CAPABILITY_COPY.supportEmailAddress;
  const inAppSupportEnabled = supportEnabled && authStatus === "authenticated";
  const contextCopy = useMemo(() => contextLabel(context), [context]);
  const fallbackBody = useMemo(
    () => `Context: ${contextCopy}\nIntent: ${context.intent}\n\n${defaultMessage || "I’d like to talk about unlimited cloud / team features."}\n`,
    [context.intent, contextCopy, defaultMessage],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setMessage(defaultMessage);
  }, [defaultMessage, open]);

  async function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      await sendSupportMessage({
        message: trimmed,
        context,
      });
      showToast("Support note sent.", "info");
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to send support note.");
    } finally {
      setSending(false);
    }
  }

  async function handleCopyEmail() {
    try {
      await copyText(fallbackEmail);
      showToast("Support email copied.", "info");
    } catch {
      showToast("Failed to copy support email.");
    }
  }

  async function handleOpenGmail() {
    try {
      await openGmailCompose({
        to: fallbackEmail,
        subject: CAPABILITY_COPY.supportGmailSubject,
        body: fallbackBody,
      });
      onClose();
    } catch {
      showToast("Failed to open Gmail.");
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      sizeClassName="max-w-lg"
      footer={inAppSupportEnabled ? (
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => { void handleSend(); }}
            loading={sending}
            disabled={!message.trim()}
          >
            Send
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void handleCopyEmail(); }}
          >
            {CAPABILITY_COPY.supportCopyLabel}
          </Button>
          <Button
            size="sm"
            onClick={() => { void handleOpenGmail(); }}
          >
            {CAPABILITY_COPY.supportOpenLabel}
          </Button>
        </>
      )}
    >
      {inAppSupportEnabled ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {contextCopy}
          </div>
          <Textarea
            rows={6}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What do you need help with?"
            className="min-h-[132px] border-border bg-background text-[13px]"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs font-medium text-foreground">{fallbackEmail}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {contextCopy}
            </p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {CAPABILITY_COPY.supportFallbackDescription}
          </p>
        </div>
      )}
    </ModalShell>
  );
}
