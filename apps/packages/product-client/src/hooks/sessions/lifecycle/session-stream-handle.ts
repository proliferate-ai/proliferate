import type { SessionStreamHandle } from "@anyharness/sdk";
import type { FlushAwareSessionStreamHandle } from "#product/lib/workflows/sessions/session-runtime";
import type { SessionStreamFlushController } from "#product/hooks/sessions/lifecycle/use-session-stream-flush";

export function createFlushAwareSessionStreamHandle(
  handle: SessionStreamHandle,
  streamFlushController: SessionStreamFlushController,
): FlushAwareSessionStreamHandle {
  let closed = false;

  return {
    close() {
      streamFlushController.flushNow();
      streamFlushController.dispose();
      if (closed) {
        return;
      }
      closed = true;
      handle.close();
    },
    flushPendingEvents() {
      streamFlushController.flushNow();
    },
  };
}
