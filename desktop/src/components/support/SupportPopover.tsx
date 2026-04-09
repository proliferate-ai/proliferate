import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { CAPABILITY_COPY } from "@/config/capabilities";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { sendSupportMessage, type SupportMessageContext } from "@/lib/integrations/cloud/support";
import { copyText, openGmailCompose } from "@/platform/tauri/shell";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

interface SupportPopoverProps {
  context: SupportMessageContext;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  className?: string;
}

function contextLabel(context: SupportMessageContext): string {
  if (context.workspaceName && context.workspaceLocation) {
    return `${context.workspaceLocation} · ${context.workspaceName}`;
  }
  if (context.workspaceName) return context.workspaceName;
  if (context.pathname) return context.pathname;
  return "Current app context will be included.";
}

export function SupportPopover({
  context,
  onClose,
  triggerRef,
  className = "absolute left-3 bottom-full mb-2 z-30 w-[23rem] max-w-[calc(100vw-2rem)]",
}: SupportPopoverProps) {
  const { supportEnabled } = useAppCapabilities();
  const authStatus = useAuthStore((s) => s.status);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const showToast = useToastStore((s) => s.show);
  const contextCopy = useMemo(() => contextLabel(context), [context]);
  const fallbackEmail = CAPABILITY_COPY.supportEmailAddress;
  const inAppSupportEnabled = supportEnabled && authStatus === "authenticated";
  const fallbackBody = useMemo(
    () => `Context: ${contextCopy}\n\nHow can we help?\n`,
    [contextCopy],
  );

  useEffect(() => {
    if (inAppSupportEnabled) {
      textareaRef.current?.focus();
    }
  }, [inAppSupportEnabled]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, triggerRef]);

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
      const nextMessage = error instanceof Error
        ? error.message
        : "Failed to send support note.";
      showToast(nextMessage);
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
    <div className={className}>
      <div
        ref={panelRef}
        className="rounded-xl border border-border bg-popover p-3 shadow-floating-dark"
      >
        {inAppSupportEnabled ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-foreground">Support</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {CAPABILITY_COPY.supportInAppDescription}
                </p>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Slack
              </span>
            </div>

            <Textarea
              ref={textareaRef}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What do you need help with?"
              className="mt-3 min-h-[92px] border-border bg-background text-[13px]"
            />

            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="min-w-0 text-[11px] leading-5 text-muted-foreground">
                {contextCopy}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSend()}
                  loading={sending}
                  disabled={!message.trim()}
                >
                  Send
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Support</p>
              <p className="text-[11px] text-muted-foreground">
                {CAPABILITY_COPY.supportFallbackDescription}
              </p>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-xs font-medium text-foreground">{fallbackEmail}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {contextCopy}
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              <div className="flex items-center gap-2 shrink-0">
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
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
