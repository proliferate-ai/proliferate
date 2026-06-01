import type {
  CloudChatTranscriptPlanActions,
  CloudChatTranscriptRowProps,
  CloudChatTranscriptRowsProps,
  CloudChatTranscriptRowView,
} from "./CloudChatTranscriptTypes";
import { AssistantMessage } from "./AssistantMessage";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { CloudChatUserMessage } from "./CloudChatUserMessage";
import {
  CloudChatAssistantLoadingRow,
  CloudChatErrorRow,
  CloudChatSystemRow,
  CloudChatThoughtRow,
  CloudChatToolGroupRow,
  CloudChatToolRow,
  CloudChatWorkHistoryRow,
} from "./CloudChatTranscriptRowItems";
import { isAssistantLoadingRow } from "./CloudChatTranscriptPresentation";

export function CloudChatTranscriptRows({
  rows,
  planActions,
}: CloudChatTranscriptRowsProps) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <CloudChatTranscriptRow key={row.id} row={row} planActions={planActions} />
      ))}
    </div>
  );
}

export function CloudChatTranscriptRow({
  row,
  planActions,
}: CloudChatTranscriptRowProps) {
  if (row.kind === "user") {
    return (
      <CloudChatUserMessage
        content={row.body ?? ""}
        status={row.status}
      />
    );
  }

  if (row.kind === "assistant") {
    if (isAssistantLoadingRow(row)) {
      return <CloudChatAssistantLoadingRow row={row} />;
    }

    return (
      <article className="flex justify-start">
        <div className="flex min-w-0 max-w-full flex-col break-words" data-telemetry-mask>
          {row.title ? (
            <div className="mb-1 text-xs font-medium text-muted-foreground">{row.title}</div>
          ) : null}
          <AssistantMessage
            content={row.body ?? ""}
            isStreaming={row.streaming}
          />
        </div>
      </article>
    );
  }

  if (row.kind === "proposed_plan") {
    return <CloudChatProposedPlanRow row={row} planActions={planActions} />;
  }

  if (row.kind === "thought") {
    return <CloudChatThoughtRow row={row} />;
  }

  if (row.kind === "tool") {
    return <CloudChatToolRow row={row} />;
  }

  if (row.kind === "tool_group") {
    return (
      <CloudChatToolGroupRow
        row={row}
        renderChildRow={(child) => (
          <CloudChatTranscriptRow row={child} />
        )}
      />
    );
  }

  if (row.kind === "system") {
    if ((row.title ?? "").toLowerCase() === "work history") {
      return (
        <CloudChatWorkHistoryRow
          row={row}
          renderChildRow={(child) => (
            <CloudChatTranscriptRow row={child} />
          )}
        />
      );
    }
    return (
      <CloudChatSystemRow
        row={row}
        renderChildRow={(child) => (
          <CloudChatTranscriptRow row={child} />
        )}
      />
    );
  }

  if (row.kind === "error") {
    return <CloudChatErrorRow row={row} />;
  }

  return <CloudChatToolRow row={row} />;
}

function CloudChatProposedPlanRow({
  row,
  planActions,
}: {
  row: CloudChatTranscriptRowView;
  planActions?: CloudChatTranscriptPlanActions;
}) {
  const planId = row.planId ?? null;
  const decisionVersion = row.planDecisionVersion ?? null;
  const canDecide = !!planId && decisionVersion !== null;
  return (
    <article className="flex justify-start">
      <div className="flex w-full max-w-full flex-col break-words" data-telemetry-mask>
        <ProposedPlanCard
          title={row.planTitle ?? row.title ?? "Plan"}
          content={row.planBodyMarkdown ?? row.body ?? ""}
          isStreaming={Boolean(row.streaming)}
          decisionState={row.planDecisionState ?? null}
          nativeResolutionState={row.planNativeResolutionState ?? null}
          decisionVersion={decisionVersion}
          errorMessage={row.planErrorMessage ?? null}
          nativeContinuation={Boolean(row.planNativeContinuation)}
          onApprove={
            canDecide && planActions?.approvePlan
              ? () => planActions.approvePlan!(planId, decisionVersion)
              : undefined
          }
          onReject={
            canDecide && planActions?.rejectPlan
              ? () => planActions.rejectPlan!(planId, decisionVersion)
              : undefined
          }
          isApproving={planDecisionActionActive(
            planActions?.isApprovingPlan,
            planId,
            decisionVersion,
          )}
          isRejecting={planDecisionActionActive(
            planActions?.isRejectingPlan,
            planId,
            decisionVersion,
          )}
        />
      </div>
    </article>
  );
}

function planDecisionActionActive(
  value: CloudChatTranscriptPlanActions["isApprovingPlan"],
  planId: string | null,
  expectedDecisionVersion: number | null,
): boolean {
  if (typeof value === "function") {
    return !!planId && expectedDecisionVersion !== null
      ? value(planId, expectedDecisionVersion)
      : false;
  }
  return Boolean(value);
}
