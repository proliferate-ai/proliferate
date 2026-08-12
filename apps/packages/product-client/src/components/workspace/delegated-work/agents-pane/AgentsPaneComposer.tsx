import { useCallback, useState, type KeyboardEvent } from "react";
import { ArrowUp } from "#product/primitives/icons/core";
import { Textarea } from "#product/primitives/Textarea";
import { ComposerActionButton } from "#product/primitives/patterns/ComposerActionButton";
import { ComposerTextareaFrame } from "#product/primitives/patterns/ComposerTextareaFrame";
import { ChatComposerSurface } from "#product/components/workspace/chat/composer/ChatComposerSurface";
import { useSessionIntentActions } from "#product/hooks/sessions/workflows/use-session-intent-actions";

interface AgentsPaneComposerProps {
  /** Mapped ProductClient client session ID: the exact child the prompt
   * queues to, independent of the main active session. */
  clientSessionId: string;
  workspaceId: string | null;
  agentDisplayName: string;
  disabled?: boolean;
}

/**
 * Prompt composer for a non-Closed Agents-pane child. Prompts go through the
 * existing session intent store (send-or-queue semantics come from the outbox
 * placement there); Closed children render no composer at all.
 */
export function AgentsPaneComposer({
  clientSessionId,
  workspaceId,
  agentDisplayName,
  disabled = false,
}: AgentsPaneComposerProps) {
  const { sendPrompt } = useSessionIntentActions();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;

  const submit = useCallback(() => {
    if (!canSend) {
      return;
    }
    setText("");
    void sendPrompt({
      sessionId: clientSessionId,
      workspaceId,
      text: trimmed,
    });
  }, [canSend, clientSessionId, sendPrompt, trimmed, workspaceId]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }, [submit]);

  return (
    <form
      className="shrink-0"
      aria-label={`Message ${agentDisplayName}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ChatComposerSurface overflowMode="clip">
        <ComposerTextareaFrame topInset="standard">
          <Textarea
            data-telemetry-mask
            className="text-composer"
            variant="ghost"
            rows={2}
            value={text}
            disabled={disabled}
            placeholder={`Message ${agentDisplayName}`}
            aria-label={`Message ${agentDisplayName}`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </ComposerTextareaFrame>
        <div className="flex items-center justify-end px-2 pb-2">
          <ComposerActionButton
            type="submit"
            disabled={!canSend}
            aria-label="Send prompt"
          >
            <ArrowUp className="icon-compact" />
          </ComposerActionButton>
        </div>
      </ChatComposerSurface>
    </form>
  );
}
