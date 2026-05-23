const AUTH_TOKEN_KEY = "proliferate.web.authToken";

export function readStoredAuthToken(): string | null {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeStoredAuthToken(token: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Authentication still works in-memory when storage is unavailable.
  }
}

export function clearStoredAuthToken(): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}
