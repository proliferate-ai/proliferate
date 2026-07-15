import { cloudRootKey } from "@proliferate/cloud-sdk-react/lib/query-keys";

export function serverCapabilitiesKey(apiBaseUrl: string) {
  return [...cloudRootKey(), "server-capabilities", apiBaseUrl] as const;
}
