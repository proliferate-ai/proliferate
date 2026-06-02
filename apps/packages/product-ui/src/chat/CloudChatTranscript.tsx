import {
  AssistantMessage,
  type AssistantMessageProps,
} from "./transcript/AssistantMessage";
import {
  CloudChatTranscriptRow as CloudChatTranscriptRowComponent,
  CloudChatTranscriptRows as CloudChatTranscriptRowsView,
} from "./transcript/CloudChatTranscriptRows";
import type {
  CloudChatTranscriptPlanActions,
  CloudChatTranscriptRowProps,
  CloudChatTranscriptRowsProps,
  CloudChatTranscriptRowView as CloudChatTranscriptRowViewModel,
} from "./transcript/CloudChatTranscriptTypes";

export type {
  CloudChatTranscriptPlanActions,
  CloudChatTranscriptRowKind,
  CloudChatTranscriptRowView,
} from "./transcript/CloudChatTranscriptTypes";

export interface CloudChatTranscriptProps {
  rows: readonly CloudChatTranscriptRowViewModel[];
  emptyTitle: string;
  emptyDescription?: string;
  planActions?: CloudChatTranscriptPlanActions;
}

export interface CloudChatAssistantMessageProps extends AssistantMessageProps {}

export function CloudChatTranscript({
  rows,
  emptyTitle,
  emptyDescription,
  planActions,
}: CloudChatTranscriptProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm">
        <div className="font-medium text-foreground">{emptyTitle}</div>
        {emptyDescription ? (
          <p className="mt-1 text-muted-foreground">{emptyDescription}</p>
        ) : null}
      </div>
    );
  }

  return (
    <CloudChatTranscriptRows rows={rows} planActions={planActions} />
  );
}

export function CloudChatTranscriptRows(props: CloudChatTranscriptRowsProps) {
  return <CloudChatTranscriptRowsView {...props} />;
}

export function CloudChatTranscriptRow(props: CloudChatTranscriptRowProps) {
  return <CloudChatTranscriptRowComponent {...props} />;
}

export function CloudChatAssistantMessage(props: CloudChatAssistantMessageProps) {
  return <AssistantMessage {...props} />;
}
