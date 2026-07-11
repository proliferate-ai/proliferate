import { useQuery } from "@tanstack/react-query";
import { getProliferateApiBaseUrl } from "@/lib/infra/proliferate-api";
import {
  fetchServerFeatures,
  getLastKnownServerFeatures,
  type ServerFeatures,
} from "@/lib/access/cloud/server-features";

// The server's advertised feature posture (D-003 workflows launch flag).
// Enforcement lives on the server (the workflows API 404s while dark); this
// hook only decides which entry points render, defaulting dark until the
// first read lands so a held surface never flashes on.
export function useServerFeatures() {
  const apiBaseUrl = getProliferateApiBaseUrl();
  const initial = getLastKnownServerFeatures();

  return useQuery<ServerFeatures>({
    queryKey: ["server-features", apiBaseUrl],
    queryFn: fetchServerFeatures,
    initialData: initial ?? undefined,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useWorkflowsEnabled(): boolean {
  const { data } = useServerFeatures();
  return data?.workflowsEnabled === true;
}
