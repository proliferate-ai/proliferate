export function desktopReleaseManifestKey(version: string | null) {
  return ["downloads", "desktop-release-manifest", version] as const;
}
