import { useQuery } from "@tanstack/react-query";
import {
  getAuthViewer,
  type AuthViewerResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { authViewerKey } from "../lib/query-keys.js";

export function useAuthViewer(enabled = true) {
  const client = useCloudClient();
  return useQuery<AuthViewerResponse>({
    queryKey: authViewerKey(client.baseUrl),
    queryFn: () => getAuthViewer(client),
    enabled,
  });
}
