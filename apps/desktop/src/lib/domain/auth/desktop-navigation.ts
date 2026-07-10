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
      // Lands on Account (every signed-in user can reach it), not the
      // admin-gated Members pane — a non-admin invitee must be able to
      // follow this link and see/accept their invitation.
      const params = new URLSearchParams({ section: "account" });
      params.set("joinOrganizationId", organizationId);
      // The issuing server stamps its own origin so a self-hosted invite can
      // point the desktop at the right server (the org id is meaningless on
      // Cloud). Any web page can fire this deep link with an attacker-supplied
      // origin, so we validate hard and DROP anything untrusted — a dropped
      // origin degrades to today's behavior (resolve against the current
      // server), never a silent server switch.
      const joinServerOrigin = parseJoinServerOrigin(parsed.searchParams.get("origin"));
      if (joinServerOrigin) {
        params.set("joinServerOrigin", joinServerOrigin);
      }
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
    // Integration OAuth browser returns (and legacy plugins/powers links) land on
    // the user Integrations pane, carrying flowId/status/failureCode so the pane
    // can toast the flow outcome on arrival.
    const params = new URLSearchParams(parsed.search);
    params.set("section", "integrations");
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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Validate the `origin` embedded in a `proliferate://join/<id>` deep link.
 * This is the parser-side half of the trust boundary: the desktop must never
 * treat an unvalidated origin as a server address. Returns the normalized
 * origin (scheme + host, no trailing slash) only when it is:
 * - a well-formed absolute URL,
 * - https (http tolerated solely for loopback dev servers),
 * - free of embedded credentials (no `user:pass@` phishing vector).
 * Anything else returns null so the caller drops the param.
 */
function parseJoinServerOrigin(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  if (!parsed.hostname) {
    return null;
  }

  if (parsed.protocol === "https:") {
    return parsed.origin;
  }

  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return parsed.origin;
  }

  return null;
}
