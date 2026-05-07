import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { getSessionClientAndWorkspace } from "@/lib/workflows/sessions/session-runtime";

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
      const { connection, materializedSessionId } =
        await getSessionClientAndWorkspace(sessionId!);
      const blob = await getAnyHarnessClient(connection).sessions.fetchPromptAttachment(
        materializedSessionId,
        attachmentId!,
      );
      return blob;
    },
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) {
      setObjectUrl(null);
      return;
    }

    const nextObjectUrl = URL.createObjectURL(query.data);
    setObjectUrl(nextObjectUrl);
    return () => {
      URL.revokeObjectURL(nextObjectUrl);
    };
  }, [query.data]);

  return {
    ...query,
    data: objectUrl,
    isLoading: query.isLoading || (query.isSuccess && !objectUrl),
  };
}
