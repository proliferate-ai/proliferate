import { ProposedPlanCard } from "./ProposedPlanCard";
import {
  renderTranscriptCodeBlock,
  renderTranscriptInlineCode,
  renderTranscriptLink,
} from "./transcript-markdown";

interface ClaudePlanCardProps {
  content: string;
  isStreaming: boolean;
}

export function ClaudePlanCard({ content, isStreaming }: ClaudePlanCardProps) {
  // The streaming precursor renders through the SAME component as the decided
  // plan card, with decisionState="streaming": identical chrome, no status chip
  // and no footer. When the proposed_plan item arrives, transcript-wide
  // suppression swaps in ConnectedProposedPlanItem — same shell — and only the
  // chip + footer appear. No unmount/remount-driven chrome change.
  return (
    <ProposedPlanCard
      content={content}
      isStreaming={isStreaming}
      decisionState="streaming"
      renderLink={renderTranscriptLink}
      renderInlineCode={renderTranscriptInlineCode}
      renderCodeBlock={renderTranscriptCodeBlock}
    />
  );
}
