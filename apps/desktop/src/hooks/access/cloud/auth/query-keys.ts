export function authRootKey() {
  return ["auth"] as const;
}

export function githubDesktopAuthAvailabilityKey(apiBaseUrl: string) {
  return [...authRootKey(), "github-desktop-availability", apiBaseUrl] as const;
}

export function ssoDiscoveryKey(apiBaseUrl: string, email: string | null = null) {
  return [...authRootKey(), "sso-discovery", apiBaseUrl, email] as const;
}
