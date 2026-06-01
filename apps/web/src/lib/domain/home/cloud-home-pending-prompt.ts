import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";

export interface HomePendingPrompt {
  id: string;
  text: string;
  status: "creating" | "failed";
  detail?: string | null;
}

export function buildPendingPromptRows(
  pendingPrompt: HomePendingPrompt | null,
): CloudChatTranscriptRowView[] {
  if (!pendingPrompt) {
    return [];
  }
  const isCreating = pendingPrompt.status === "creating";
  return [
    {
      id: `${pendingPrompt.id}:user`,
      kind: "user",
      body: pendingPrompt.text,
      status: isCreating ? "Loading" : "Failed",
    },
    isCreating
      ? {
        id: `${pendingPrompt.id}:assistant`,
        kind: "assistant",
        title: "Workspace setup",
        body: null,
        detail: "Preparing workspace.",
        streaming: true,
      }
      : {
        id: `${pendingPrompt.id}:error`,
        kind: "error",
        title: "Workspace creation failed",
        body: pendingPrompt.detail ?? "The prompt was not sent.",
        status: "Failed",
      },
  ];
}
