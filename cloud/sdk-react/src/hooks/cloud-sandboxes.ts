import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  destroyCloudSandbox,
  ensureCloudSandbox,
  getCloudSandbox,
  wakeCloudSandbox,
  type CloudSandboxResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { cloudSandboxKey } from "../lib/query-keys.js";

export function useCloudSandbox(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudSandboxResponse | null>({
    queryKey: cloudSandboxKey(),
    queryFn: () => getCloudSandbox(client),
    enabled,
  });
}

export function useEnsureCloudSandbox() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSandboxResponse, Error>({
    mutationFn: () => ensureCloudSandbox(client),
    onSuccess: (response) => {
      queryClient.setQueryData(cloudSandboxKey(), response);
    },
  });
}

export function useWakeCloudSandbox() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSandboxResponse, Error>({
    mutationFn: () => wakeCloudSandbox(client),
    onSuccess: (response) => {
      queryClient.setQueryData(cloudSandboxKey(), response);
    },
  });
}

export function useDestroyCloudSandbox() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<CloudSandboxResponse | null, Error>({
    mutationFn: () => destroyCloudSandbox(client),
    onSuccess: (response) => {
      queryClient.setQueryData(cloudSandboxKey(), response);
    },
  });
}
