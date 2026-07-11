import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowLeft, RefreshCw } from "@proliferate/ui/icons";
import { UserMessage } from "@/components/workspace/chat/transcript/UserMessage";
import {
  TURN_ITEM_GAP_CLASS,
  TurnAssistantActionRow,
  TurnShell,
  resolvePendingPromptTrailingStatus,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import { CHAT_COLUMN_CLASSNAME, CHAT_SURFACE_GUTTER_CLASSNAME } from "@/config/chat-layout";
import { useChatLaunchIntentActions } from "@/hooks/chat/workflows/use-chat-launch-intent-actions";
import { resolveChatLaunchIntentView } from "@/lib/domain/chat/launch/launch-intent";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { formatTranscriptActionTime } from "@proliferate/product-domain/chats/transcript/transcript-action-time";

interface ChatLaunchIntentPaneProps {
  bottomInsetPx: number;
  nonDisplacingBottomInsetPx: number;
}

export function ChatLaunchIntentPane({
  bottomInsetPx,
  nonDisplacingBottomInsetPx,
}: ChatLaunchIntentPaneProps) {
  const activeIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const {
    dismiss,
    isRetrying,
    retry,
    returnHome,
  } = useChatLaunchIntentActions();

  if (!activeIntent) {
    return null;
  }

  const view = resolveChatLaunchIntentView(activeIntent);
  const isPending = activeIntent.failure === null;
  const effectiveNonDisplacingBottomInsetPx = Math.min(
    Math.max(0, bottomInsetPx),
    Math.max(0, nonDisplacingBottomInsetPx),
  );
  const structuralBottomInsetPx = Math.max(
    0,
    bottomInsetPx - effectiveNonDisplacingBottomInsetPx,
  );
  const failureFooter = isPending
    ? null
    : (
      <div className="flex flex-col items-end gap-2 text-right">
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>{view.title}</span>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {view.detail}
        </p>
        {(view.canReturnHome || view.canRetry || view.canDismiss) && (
          <div className="flex flex-wrap justify-end gap-2">
            {view.canReturnHome && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={returnHome}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </Button>
            )}
            {view.canDismiss && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={dismiss}
              >
                {view.dismissLabel}
              </Button>
            )}
            {view.canRetry && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isRetrying}
                onClick={retry}
              >
                {!isRetrying && <RefreshCw className="size-3.5" />}
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    );

  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
      <AutoHideScrollArea
        className="h-full"
        contentClassName={`${CHAT_SURFACE_GUTTER_CLASSNAME} relative flex min-h-full flex-col`}
      >
        <div
          className="mt-auto pt-4"
          data-chat-launch-intent-anchor-frame
        >
          <div
            className={`${CHAT_COLUMN_CLASSNAME} [--text-chat:var(--text-message)] [--text-chat--line-height:var(--text-message--line-height)] [--text-chat-meta:calc(var(--text-chat)_-_2px)]`}
          >
            <TurnShell isFirst>
              <div
                className={`flex flex-col ${TURN_ITEM_GAP_CLASS}`}
                data-chat-launch-intent-turn
              >
                <UserMessage
                  sessionId={null}
                  content={activeIntent.text}
                  contentParts={activeIntent.contentParts}
                  showCopyButton
                  timestampLabel={formatTranscriptActionTime(
                    new Date(activeIntent.createdAt).toISOString(),
                  )}
                  footer={failureFooter}
                />
                {isPending && (
                  <>
                    <div data-chat-launch-intent-frontier>
                      {resolvePendingPromptTrailingStatus(
                        new Date(activeIntent.createdAt).toISOString(),
                        "working",
                        true,
                      )}
                    </div>
                    <TurnAssistantActionRow content={null} reserveSlot />
                  </>
                )}
              </div>
            </TurnShell>
          </div>
        </div>
        {structuralBottomInsetPx > 0 && (
          <div
            aria-hidden="true"
            className="shrink-0"
            data-chat-launch-intent-bottom-inset
            style={{ height: structuralBottomInsetPx }}
          />
        )}
        {effectiveNonDisplacingBottomInsetPx > 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-full"
            data-chat-launch-intent-overlay-inset
            style={{ height: effectiveNonDisplacingBottomInsetPx }}
          />
        )}
      </AutoHideScrollArea>
    </div>
  );
}
