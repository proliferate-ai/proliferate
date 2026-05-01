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

  if (parsed.hostname === "settings" && parsed.pathname === "/cloud") {
    const params = new URLSearchParams(parsed.search);
    params.set("section", "cloud");
    return `/settings?${params.toString()}`;
  }

  if (parsed.hostname === "settings" && parsed.pathname === "/organization") {
    const params = new URLSearchParams(parsed.search);
    params.set("section", "organization");
    return `/settings?${params.toString()}`;
  }

  if (
    (parsed.hostname === "plugins" || parsed.hostname === "powers")
    && (parsed.pathname === "" || parsed.pathname === "/")
  ) {
    return parsed.search ? `/plugins${parsed.search}` : "/plugins";
  }

  return null;
}
