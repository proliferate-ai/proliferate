import { useEffect, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useQuery } from "@tanstack/react-query";
import { useFetchPromptAttachmentMutation } from "@anyharness/sdk-react";
import { getSessionClientAndWorkspace } from "@/lib/access/anyharness/session-runtime";

export function usePromptAttachmentUrl(
  sessionId: string | null | undefined,
  attachmentId: string | null | undefined,
) {
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
  const fetchPromptAttachmentMutation = useFetchPromptAttachmentMutation();
  const query = useQuery({
    queryKey: ["prompt-attachment", sessionId, attachmentId],
    enabled: !!sessionId && !!attachmentId,
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: async () => {
      const { materializedSessionId, workspaceId } =
        await getSessionClientAndWorkspace(sessionId!, ssh, cloudClient);
      const blob = await fetchPromptAttachmentMutation.mutateAsync({
        workspaceId,
        sessionId: materializedSessionId,
        attachmentId: attachmentId!,
      });
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
