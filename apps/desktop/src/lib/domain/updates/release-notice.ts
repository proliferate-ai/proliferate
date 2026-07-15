export const RELEASE_NOTICE_TITLE_MAX_LENGTH = 80;

const RELEASE_VERSION_MAX_LENGTH = 128;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const LINE_SEPARATOR_PATTERN = /[\r\n\u2028\u2029]/u;
const SAFE_RELEASE_VERSION_PATTERN = /^[0-9A-Za-z.+-]+$/u;

export interface ReleaseTitle {
  version: string;
  title: string;
}

export interface DesktopReleaseManifest {
  version: string;
  title: string | null;
}

export type ReleaseNotice = ReleaseTitle;

export type InstalledReleaseManifestStatus = "pending" | "error" | "success";

export function normalizeReleaseVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (LINE_SEPARATOR_PATTERN.test(value)) {
    return null;
  }

  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > RELEASE_VERSION_MAX_LENGTH
    || !SAFE_RELEASE_VERSION_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function normalizeReleaseTitle(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (LINE_SEPARATOR_PATTERN.test(value)) {
    return null;
  }

  const normalized = value.trim();
  if (
    !normalized
    || CONTROL_CHARACTER_PATTERN.test(normalized)
    || [...normalized].length > RELEASE_NOTICE_TITLE_MAX_LENGTH
  ) {
    return null;
  }

  return normalized;
}

export function normalizeReleaseTitlePair(value: unknown): ReleaseTitle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as { version?: unknown; title?: unknown };
  const version = normalizeReleaseVersion(candidate.version);
  const title = normalizeReleaseTitle(candidate.title);
  return version && title ? { version, title } : null;
}

export function parseDesktopReleaseManifest(
  value: unknown,
  requestedVersion: string,
): DesktopReleaseManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const expectedVersion = normalizeReleaseVersion(requestedVersion);
  const candidate = value as { version?: unknown; notes?: unknown };
  const version = normalizeReleaseVersion(candidate.version);
  if (!expectedVersion || version !== expectedVersion) {
    return null;
  }

  return {
    version,
    title: normalizeReleaseTitle(candidate.notes),
  };
}

export function resolveInstalledReleaseTitle(input: {
  currentVersion: unknown;
  manifestStatus: InstalledReleaseManifestStatus;
  manifest: DesktopReleaseManifest | null | undefined;
  cachedRelease: unknown;
}): ReleaseTitle | null {
  const currentVersion = normalizeReleaseVersion(input.currentVersion);
  if (!currentVersion) {
    return null;
  }

  if (input.manifestStatus === "success") {
    if (
      input.manifest?.version !== currentVersion
      || !input.manifest.title
    ) {
      return null;
    }
    return {
      version: currentVersion,
      title: input.manifest.title,
    };
  }

  const cachedRelease = normalizeReleaseTitlePair(input.cachedRelease);
  return cachedRelease?.version === currentVersion ? cachedRelease : null;
}

export function selectReleaseNotice(input: {
  installedRelease: unknown;
  acknowledgedReleaseVersion: unknown;
}): ReleaseNotice | null {
  const installedRelease = normalizeReleaseTitlePair(input.installedRelease);
  const acknowledgedReleaseVersion = normalizeReleaseVersion(
    input.acknowledgedReleaseVersion,
  );

  if (
    installedRelease
    && installedRelease.version !== acknowledgedReleaseVersion
  ) {
    return installedRelease;
  }

  return null;
}
