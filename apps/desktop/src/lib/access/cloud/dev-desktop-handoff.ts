import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";

export interface DevDesktopHandoffRecord {
  id: string;
  url: string;
  createdAt: string;
  openedAt?: string | null;
}

interface DevDesktopHandoffResponse {
  handoff: DevDesktopHandoffRecord | null;
}

export async function takeDevDesktopHandoff(
  apiBaseUrl: string,
  signal?: AbortSignal,
): Promise<DevDesktopHandoffRecord | null> {
  const response = await fetch(buildProliferateApiUrl("/v1/dev/desktop-handoff", apiBaseUrl), {
    method: "GET",
    headers: {
      "Cache-Control": "no-store",
    },
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Could not read the local Desktop handoff.");
  }
  const body = await response.json() as DevDesktopHandoffResponse;
  return body.handoff;
}

export async function markDevDesktopHandoffOpened(
  apiBaseUrl: string,
  id: string,
): Promise<void> {
  const response = await fetch(buildProliferateApiUrl(
    `/v1/dev/desktop-handoff/${id}/opened`,
    apiBaseUrl,
  ), {
    method: "POST",
    headers: {
      "Cache-Control": "no-store",
    },
  });
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error("Could not confirm the local Desktop handoff.");
  }
}
