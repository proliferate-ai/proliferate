import { useQuery } from "@tanstack/react-query";
import {
  getCloudHarnessLaunchOptions,
  type CloudHarnessLaunchOptionsResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import { cloudHarnessLaunchOptionsKey } from "../lib/query-keys-harness-launch-options.js";

export function useCloudHarnessLaunchOptions({
  cloudSandboxId,
  harnessKind,
  enabled = true,
}: {
  cloudSandboxId: string | null | undefined;
  harnessKind: string | null | undefined;
  enabled?: boolean;
}) {
  const client = useCloudClient();
  const target = cloudSandboxId?.trim() ?? "";
  const harness = harnessKind?.trim() ?? "";
  return useQuery<CloudHarnessLaunchOptionsResponse>({
    queryKey: cloudHarnessLaunchOptionsKey(target, harness),
    enabled: enabled && target.length > 0 && harness.length > 0,
    queryFn: ({ signal }) => getCloudHarnessLaunchOptions(target, harness, client, signal),
  });
}
