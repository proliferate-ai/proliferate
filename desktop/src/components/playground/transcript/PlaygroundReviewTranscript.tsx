import type { ReactNode } from "react";
import { AssistantMessage } from "@/components/workspace/chat/transcript/AssistantMessage";
import { ReviewFeedbackSummaryView } from "@/components/workspace/reviews/ReviewFeedbackSummary";
import type { ScenarioKey } from "@/config/playground";
import {
  PLAYGROUND_REVIEW_COMPLETE_ASSIGNMENTS,
  PLAYGROUND_REVIEW_FEEDBACK_ASSIGNMENTS,
} from "@/lib/domain/chat/__fixtures__/playground";
import { noop } from "@/components/playground/PlaygroundComposerActions";
import { TranscriptPreviewShell } from "@/components/playground/transcript/PlaygroundTranscriptShell";

export function renderPlaygroundReviewTranscript(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "review-feedback-message":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="I’ve sent the current implementation through review." />
          <ReviewFeedbackSummaryView
            assignments={PLAYGROUND_REVIEW_FEEDBACK_ASSIGNMENTS}
            reviewRunId="playground-review-feedback"
            target="PR"
            onOpenCritique={noop}
          />
        </TranscriptPreviewShell>
      );
    case "review-complete-message":
      return (
        <TranscriptPreviewShell>
          <AssistantMessage content="The revised plan is ready." />
          <ReviewFeedbackSummaryView
            assignments={PLAYGROUND_REVIEW_COMPLETE_ASSIGNMENTS}
            reviewRunId="playground-review-complete"
            target="plan"
            onOpenCritique={noop}
          />
        </TranscriptPreviewShell>
      );
    default:
      return null;
  }
}
