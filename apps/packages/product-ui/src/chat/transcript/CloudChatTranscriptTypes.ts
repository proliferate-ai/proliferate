import type {
  CloudChatTranscriptRowKind,
  CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";

export type {
  CloudChatTranscriptRowKind,
  CloudChatTranscriptRowView,
};

export interface CloudChatTranscriptPlanActions {
  approvePlan?: (planId: string, expectedDecisionVersion: number) => void;
  rejectPlan?: (planId: string, expectedDecisionVersion: number) => void;
  isApprovingPlan?: boolean | ((planId: string, expectedDecisionVersion: number) => boolean);
  isRejectingPlan?: boolean | ((planId: string, expectedDecisionVersion: number) => boolean);
}

export interface CloudChatTranscriptRowsProps {
  rows: readonly CloudChatTranscriptRowView[];
  planActions?: CloudChatTranscriptPlanActions;
}

export interface CloudChatTranscriptRowProps {
  row: CloudChatTranscriptRowView;
  planActions?: CloudChatTranscriptPlanActions;
}

export type CloudTranscriptActionStatus = "completed" | "failed" | "running";
