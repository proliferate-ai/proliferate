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
  return (
    <ProposedPlanCard
      content={content}
      isStreaming={isStreaming}
      renderLink={renderTranscriptLink}
      renderInlineCode={renderTranscriptInlineCode}
      renderCodeBlock={renderTranscriptCodeBlock}
    />
  );
}
