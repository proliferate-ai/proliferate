import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@proliferate/product-ui/chat/ChatColumn";

function AssistantMessageSkeleton() {
  return (
    <div className="flex max-w-[88%] flex-col gap-2">
      <div className="h-3 w-24 rounded-md bg-muted/60" />
      <div className="h-3 w-full rounded-md bg-muted/45" />
      <div className="h-3 w-[92%] rounded-md bg-muted/45" />
      <div className="h-3 w-[68%] rounded-md bg-muted/45" />
    </div>
  );
}

function UserMessageSkeleton() {
  return (
    <div className="flex justify-end">
      <div className="flex w-[min(22rem,72%)] flex-col items-end gap-2">
        <div className="h-3 w-20 rounded-md bg-muted/60" />
        <div className="h-10 w-full rounded-md bg-muted/45" />
      </div>
    </div>
  );
}

export function TranscriptSwitchingPlaceholder({
  label = "Loading chat",
}: {
  label?: string;
}) {
  return (
    <DebugProfiler id="session-transcript-pane">
      <div
        className={`flex h-full min-h-0 overflow-hidden py-4 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
        role="status"
        aria-label={label}
        data-chat-switching-placeholder
      >
        <div
          className={`${CHAT_COLUMN_CLASSNAME} flex flex-1 flex-col gap-6 motion-safe:animate-pulse`}
          aria-hidden="true"
        >
          <UserMessageSkeleton />
          <AssistantMessageSkeleton />
          <UserMessageSkeleton />
          <AssistantMessageSkeleton />
        </div>
      </div>
    </DebugProfiler>
  );
}
