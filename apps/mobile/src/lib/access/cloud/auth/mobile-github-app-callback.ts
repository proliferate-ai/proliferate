/**
 * Pure detector for the GitHub App authorization / installation callback deep
 * link. Distinct from the OAuth sign-in callback and from workspace deep links.
 *
 * The App-auth flow returns to `proliferate://settings/environments?source=
 * github_app_callback` (or the staging scheme). On a warm return the in-memory
 * modal intent is still alive, so the resolver just re-runs after invalidation;
 * on a cold start the app lands in repository/access settings with the relevant
 * state. No arbitrary continuation command is ever persisted.
 *
 * No React, no platform APIs — unit-tested directly.
 */

const GITHUB_APP_CALLBACK_SOURCE = "github_app_callback";

export function isMobileGitHubAppCallbackUrl(url: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("source") === GITHUB_APP_CALLBACK_SOURCE) {
      return true;
    }
    // Custom-scheme URLs (proliferate://settings/environments?...) put the
    // first path segment in the hostname; also accept the raw query match.
    return parsed.hash.includes(GITHUB_APP_CALLBACK_SOURCE);
  } catch {
    return url.includes(`source=${GITHUB_APP_CALLBACK_SOURCE}`);
  }
}
