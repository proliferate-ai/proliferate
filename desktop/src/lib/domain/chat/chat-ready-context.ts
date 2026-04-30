export interface ChatReadyContextLineInput {
  workspaceName: string | null;
  branchLabel: string | null;
  agentDisplayName: string | null;
  modelDisplayName: string | null;
}

export function formatChatReadyContextLine(input: ChatReadyContextLineInput): string | null {
  const parts = [
    input.workspaceName,
    input.branchLabel,
    input.agentDisplayName,
    input.modelDisplayName,
  ].filter((part): part is string => !!part?.trim());

  return parts.length > 0 ? parts.join(" · ") : null;
}
