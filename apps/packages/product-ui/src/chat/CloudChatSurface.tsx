import {
  CloudChatComposer,
  type CloudChatComposerView,
} from "./CloudChatComposer";
import {
  CloudChatHeader,
  type CloudChatHeaderView,
} from "./CloudChatHeader";
import { CloudChatTranscriptLoadingState } from "./CloudChatTranscriptLoadingState";
import {
  CloudChatTranscript,
  type CloudChatTranscriptPlanActions,
  type CloudChatTranscriptRowView,
} from "./CloudChatTranscript";
import {
  CloudChatTranscriptState,
  type CloudChatTranscriptStateView,
} from "./CloudChatTranscriptState";

export type {
  CloudChatHeaderActionView,
  CloudChatHeaderDiagnosticsView,
  CloudChatHeaderNoticeView,
  CloudChatHeaderTone,
  CloudChatHeaderView,
  CloudChatSessionOptionView,
  CloudChatSessionSwitcherView,
  CloudChatStatusView,
} from "./CloudChatHeader";

export interface CloudChatSurfaceProps {
  header: CloudChatHeaderView;
  transcriptRows: readonly CloudChatTranscriptRowView[];
  transcriptState?: CloudChatTranscriptStateView | null;
  transcriptStatus?: string | null;
  transcriptLoading?: boolean;
  transcriptPlanActions?: CloudChatTranscriptPlanActions;
  emptyTitle: string;
  emptyDescription?: string;
  composer: CloudChatComposerView;
  commandMessage?: string | null;
  telemetryBlocked?: boolean;
}

export function CloudChatSurface({
  header,
  transcriptRows,
  transcriptState = null,
  transcriptStatus = null,
  transcriptLoading = false,
  transcriptPlanActions,
  emptyTitle,
  emptyDescription,
  composer,
  commandMessage = null,
  telemetryBlocked = false,
}: CloudChatSurfaceProps) {
  return (
    <div className="flex h-full flex-col" data-telemetry-block={telemetryBlocked || undefined}>
      <CloudChatHeader header={header} />

      {transcriptLoading ? (
        <CloudChatTranscriptLoadingState />
      ) : transcriptState ? (
        <CloudChatTranscriptState
          view={transcriptState}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          pendingStatus={transcriptStatus}
          planActions={transcriptPlanActions}
        />
      ) : (
        <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
            <CloudChatTranscript
              rows={transcriptRows}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              planActions={transcriptPlanActions}
            />
          </div>
        </div>
      )}

      <footer className="relative z-20 shrink-0 border-t border-border/40 px-6 py-4">
        <CloudChatComposer composer={composer} />
        {commandMessage ? (
          <p className="mx-auto mt-2 w-full max-w-3xl text-xs text-muted-foreground">
            {commandMessage}
          </p>
        ) : null}
      </footer>
    </div>
  );
}
