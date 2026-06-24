const SELECTED_ORGANIZATION_COOKIE = "proliferate_org_id";
const SELECTED_ORGANIZATION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function isBrowserDocumentAvailable(): boolean {
  return typeof document !== "undefined";
}

export function readSelectedOrganizationCookie(): string | null {
  if (!isBrowserDocumentAvailable()) {
    return null;
  }
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value = ""] = cookie.trim().split("=");
    if (name !== SELECTED_ORGANIZATION_COOKIE) {
      continue;
    }
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function writeSelectedOrganizationCookie(organizationId: string): void {
  if (!isBrowserDocumentAvailable()) {
    return;
  }
  document.cookie = [
    `${SELECTED_ORGANIZATION_COOKIE}=${encodeURIComponent(organizationId)}`,
    "path=/",
    `max-age=${SELECTED_ORGANIZATION_COOKIE_MAX_AGE_SECONDS}`,
    "samesite=lax",
  ].join("; ");
}

export function clearSelectedOrganizationCookie(): void {
  if (!isBrowserDocumentAvailable()) {
    return;
  }
  document.cookie = `${SELECTED_ORGANIZATION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
