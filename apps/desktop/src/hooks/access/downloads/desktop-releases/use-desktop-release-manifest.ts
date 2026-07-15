import { useQuery } from "@tanstack/react-query";
import { fetchDesktopReleaseManifest } from "@/lib/access/downloads/desktop-release-manifest";
import {
  normalizeReleaseVersion,
  parseDesktopReleaseManifest,
  type DesktopReleaseManifest,
} from "@/lib/domain/updates/release-notice";
import { desktopReleaseManifestKey } from "./query-keys";

export function useDesktopReleaseManifest(version: string | null | undefined) {
  const requestedVersion = normalizeReleaseVersion(version);

  return useQuery<DesktopReleaseManifest>({
    queryKey: desktopReleaseManifestKey(requestedVersion),
    queryFn: async () => {
      if (!requestedVersion) {
        throw new Error("Desktop release manifest version is unavailable");
      }

      const value = await fetchDesktopReleaseManifest(requestedVersion);
      const manifest = parseDesktopReleaseManifest(value, requestedVersion);
      if (!manifest) {
        throw new Error("Desktop release manifest did not match the installed version");
      }
      return manifest;
    },
    enabled: requestedVersion !== null,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    meta: { telemetryHandled: true },
  });
}
