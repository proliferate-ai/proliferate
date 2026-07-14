import { useCallback } from "react";
import { setPasswordCredential } from "@proliferate/cloud-sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { PasswordSetRequest } from "@proliferate/cloud-sdk/types";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";

export function useSetPasswordCredential() {
  const cloudClient = useProductHost().cloud.client;
  return useCallback(
    (input: PasswordSetRequest) =>
      setPasswordCredential(input, requireHostCloudClient(cloudClient)),
    [cloudClient],
  );
}
