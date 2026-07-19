import { useEffect, useRef, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useQuery } from "@tanstack/react-query";
import { useFetchPromptAttachmentMutation } from "@anyharness/sdk-react";
import { getSessionClientAndWorkspace } from "#product/lib/access/anyharness/session-runtime";

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
  const [objectUrlState, setObjectUrlState] = useState<PromptAttachmentObjectUrl | null>(null);
  const activeObjectUrlRef = useRef<PromptAttachmentObjectUrl | null>(null);

  const objectUrl = objectUrlState
    && activeObjectUrlRef.current === objectUrlState
    && objectUrlState.sessionId === sessionId
    && objectUrlState.attachmentId === attachmentId
    && objectUrlState.blob === query.data
    ? objectUrlState.url
    : null;

  useEffect(() => {
    if (!sessionId || !attachmentId || !query.data) {
      setObjectUrlState(null);
      return;
    }

    const nextObjectUrl = URL.createObjectURL(query.data);
    const nextState: PromptAttachmentObjectUrl = {
      sessionId,
      attachmentId,
      blob: query.data,
      url: nextObjectUrl,
    };
    activeObjectUrlRef.current = nextState;
    setObjectUrlState(nextState);
    return () => {
      if (activeObjectUrlRef.current === nextState) {
        activeObjectUrlRef.current = null;
      }
      URL.revokeObjectURL(nextObjectUrl);
    };
  }, [attachmentId, query.data, sessionId]);

  return {
    ...query,
    data: objectUrl,
    blob: query.data ?? null,
    isLoading: query.isLoading || (query.isSuccess && !objectUrl),
  };
}

interface PromptAttachmentObjectUrl {
  sessionId: string;
  attachmentId: string;
  blob: Blob;
  url: string;
}
