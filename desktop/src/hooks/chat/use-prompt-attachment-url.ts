import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { getSessionClientAndWorkspace } from "@/lib/integrations/anyharness/session-runtime";

export function usePromptAttachmentUrl(
  sessionId: string | null | undefined,
  attachmentId: string | null | undefined,
) {
  const query = useQuery({
    queryKey: ["prompt-attachment", sessionId, attachmentId],
    enabled: !!sessionId && !!attachmentId,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: async () => {
      const { connection } = await getSessionClientAndWorkspace(sessionId!);
      const blob = await getAnyHarnessClient(connection).sessions.fetchPromptAttachment(
        sessionId!,
        attachmentId!,
      );
      return URL.createObjectURL(blob);
    },
  });

  useEffect(() => () => {
    if (query.data) {
      URL.revokeObjectURL(query.data);
    }
  }, [query.data]);

  return query;
}
