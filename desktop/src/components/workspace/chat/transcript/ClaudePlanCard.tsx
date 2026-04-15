import { ProposedPlanCard } from "./ProposedPlanCard";

interface ClaudePlanCardProps {
  content: string;
  isStreaming: boolean;
}

export function ClaudePlanCard({ content, isStreaming }: ClaudePlanCardProps) {
  return <ProposedPlanCard content={content} isStreaming={isStreaming} />;
}
