export function desktopNavigationTarget(url: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "proliferate:" && parsed.protocol !== "proliferate-local:") {
    return null;
  }

  if (parsed.hostname === "join") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      const organizationId = decodeRoutePart(segments[0]);
      const params = new URLSearchParams({ section: "organization-members" });
      params.set("joinOrganizationId", organizationId);
      return `/settings?${params.toString()}`;
    }
  }

  if (parsed.hostname === "settings" && parsed.pathname === "/cloud") {
    const params = new URLSearchParams(parsed.search);
    params.set("section", "billing");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "settings" && parsed.pathname === "/billing") {
    const params = new URLSearchParams(parsed.search);
    params.set("section", "billing");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "settings" && parsed.pathname === "/account") {
    const params = new URLSearchParams(parsed.search);
    params.set("section", "account");
    return `/settings?${params.toString()}`;
  }

  if (
    parsed.hostname === "billing"
    && (parsed.pathname === "/success" || parsed.pathname === "/cancel")
  ) {
    const params = new URLSearchParams(parsed.search);
    params.set("checkout", parsed.pathname === "/success" ? "success" : "cancel");
    params.set("section", "billing");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "settings" && parsed.pathname === "/organization") {
    const params = new URLSearchParams(parsed.search);
    params.set("section", "organization");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "settings" && parsed.pathname === "/slack-bot") {
    const params = new URLSearchParams(parsed.search);
    // SLACK BOT PARKED: legacy Slack settings links land on General while disabled.
    params.set("section", "general");
    return `/settings?${params.toString()}`;
  }

  if (
    (parsed.hostname === "integrations" || parsed.hostname === "plugins" || parsed.hostname === "powers")
    && (parsed.pathname === "" || parsed.pathname === "/")
  ) {
    // INTEGRATIONS PARKED: land on Settings (user scope default section) until a
    // later PR points these deep links at the rebuilt integrations pane.
    const params = new URLSearchParams(parsed.search);
    params.set("section", "general");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "workspaces") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 1) {
      return `/workspaces/${encodeURIComponent(decodeRoutePart(segments[0]))}${parsed.search}`;
    }
  }

  return null;
}

function decodeRoutePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
