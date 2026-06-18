import type { TranscriptRowListBaseProps } from "./TranscriptRowListShared";
import { VirtualTranscriptRowList } from "./VirtualTranscriptRowList";

// Intentionally NOT keyed by session/workspace: remounting on switch threw away
// the virtualizer's measurement cache, so the new session re-pinned from the
// 360px estimate and briefly read as blank (virtualized->full flash). The list
// instead resets stickiness in place via resetForSession on the id change.
export function ChatTranscriptRows(props: TranscriptRowListBaseProps) {
  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
      <VirtualTranscriptRowList {...props} />
    </div>
  );
}
