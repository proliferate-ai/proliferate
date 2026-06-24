import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  destroyManagedSandbox,
  ensureManagedSandbox,
  getManagedSandbox,
  wakeManagedSandbox,
  type ManagedSandboxResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { managedSandboxKey } from "../lib/query-keys.js";

export function useManagedSandbox(enabled = true) {
  const client = useCloudClient();
  return useQuery<ManagedSandboxResponse | null>({
    queryKey: managedSandboxKey(),
    queryFn: () => getManagedSandbox(client),
    enabled,
  });
}

export function useEnsureManagedSandbox() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<ManagedSandboxResponse, Error>({
    mutationFn: () => ensureManagedSandbox(client),
    onSuccess: (response) => {
      queryClient.setQueryData(managedSandboxKey(), response);
    },
  });
}

export function useWakeManagedSandbox() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<ManagedSandboxResponse, Error>({
    mutationFn: () => wakeManagedSandbox(client),
    onSuccess: (response) => {
      queryClient.setQueryData(managedSandboxKey(), response);
    },
  });
}

export function useDestroyManagedSandbox() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<ManagedSandboxResponse | null, Error>({
    mutationFn: () => destroyManagedSandbox(client),
    onSuccess: (response) => {
      queryClient.setQueryData(managedSandboxKey(), response);
    },
  });
}
