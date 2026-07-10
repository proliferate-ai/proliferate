/**
 * Desktop <-> server version compatibility.
 *
 * The server advertises the lowest desktop version it accepts (`/meta`
 * `minDesktopVersion`). The desktop has historically parsed this but never
 * acted on it. This module owns the pure comparison so the connect surface can
 * warn a user whose desktop is older than the connected server requires.
 *
 * Scope note: this is a compatibility *check*, not server-rooted updater
 * convergence. The Tauri updater still uses the static vendor CDN feed; making
 * the updater endpoint server-controlled is deliberately out of this slice
 * (see reports/04-capabilities-desktop.md). Pure domain: no React, no I/O.
 */

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

/** Parse `major.minor.patch` from a version string, ignoring any pre-release
 * suffix (`-dev`, `-rc.1`, build metadata). Returns null if not parseable. */
function parseSemver(version: string): SemverParts | null {
  const core = version.trim().split(/[-+]/, 1)[0];
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(core);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** -1 if a < b, 0 if equal, 1 if a > b; null if either is unparseable. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] < pb[key]) return -1;
    if (pa[key] > pb[key]) return 1;
  }
  return 0;
}

/**
 * Is `desktopVersion` allowed to talk to a server requiring `minDesktopVersion`?
 *
 * Fail-open on anything unparseable (dev builds, empty pins): only a
 * confidently-older desktop is reported unsupported, so the check never blocks
 * a user on a version string it cannot understand.
 */
export function isDesktopVersionSupported(
  desktopVersion: string,
  minDesktopVersion: string,
): boolean {
  // Dev/unstamped builds report the `0.0.0(-dev)` sentinel; never warn those.
  if (compareSemver(desktopVersion, "0.0.0") === 0) return true;
  const cmp = compareSemver(desktopVersion, minDesktopVersion);
  if (cmp === null) return true;
  return cmp >= 0;
}
