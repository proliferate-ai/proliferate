export function authRootKey() {
  return ["auth"] as const;
}

export function githubDesktopAuthAvailabilityKey(apiBaseUrl: string) {
  return [...authRootKey(), "github-desktop-availability", apiBaseUrl] as const;
}

export function desktopAuthMethodsKey(apiBaseUrl: string) {
  return [...authRootKey(), "desktop-auth-methods", apiBaseUrl] as const;
}
