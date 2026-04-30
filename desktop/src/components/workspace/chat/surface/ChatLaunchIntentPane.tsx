import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, LoaderCircle, RefreshCw } from "@/components/ui/icons";
import { UserMessage } from "@/components/workspace/chat/transcript/UserMessage";
import { CHAT_COLUMN_CLASSNAME, CHAT_SURFACE_GUTTER_CLASSNAME } from "@/config/chat-layout";
import { useChatLaunchIntentActions } from "@/hooks/chat/use-chat-launch-intent-actions";
import { resolveChatLaunchIntentView } from "@/lib/domain/chat/launch-intent";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";

interface ChatLaunchIntentPaneProps {
  bottomInsetPx: number;
}

export function ChatLaunchIntentPane({ bottomInsetPx }: ChatLaunchIntentPaneProps) {
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

  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
      <AutoHideScrollArea className="h-full">
        <div
          className={`${CHAT_SURFACE_GUTTER_CLASSNAME} pt-4`}
          style={{ paddingBottom: bottomInsetPx }}
        >
          <div className={CHAT_COLUMN_CLASSNAME}>
            <div className="w-full max-w-full pt-0 pb-2">
              <UserMessage
                sessionId={null}
                content={activeIntent.text}
                contentParts={activeIntent.contentParts}
                footer={(
                  <div className="flex flex-col items-end gap-2 text-right">
                    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                      {isPending && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}
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
                )}
              />
            </div>
          </div>
        </div>
      </AutoHideScrollArea>
    </div>
  );
}
