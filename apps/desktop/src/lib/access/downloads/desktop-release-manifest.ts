const DESKTOP_RELEASE_MANIFEST_BASE_URL =
  "https://downloads.proliferate.com/desktop/stable";

export async function fetchDesktopReleaseManifest(
  version: string,
): Promise<unknown> {
  const encodedVersion = encodeURIComponent(version);
  const response = await fetch(
    `${DESKTOP_RELEASE_MANIFEST_BASE_URL}/${encodedVersion}/latest.json`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error(`Desktop release manifest request failed (${response.status})`);
  }

  return await response.json();
}
