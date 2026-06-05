import type { TranscriptRowListBaseProps } from "./TranscriptRowListShared";
import { VirtualTranscriptRowList } from "./VirtualTranscriptRowList";

interface ChatTranscriptRowsProps extends TranscriptRowListBaseProps {
  rowListKey: string;
}

export function ChatTranscriptRows({
  rowListKey,
  ...props
}: ChatTranscriptRowsProps) {
  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
      <VirtualTranscriptRowList
        key={rowListKey}
        {...props}
      />
    </div>
  );
}
