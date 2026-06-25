import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";

export interface DevDesktopHandoffRecord {
  id: string;
  url: string;
  createdAt: string;
}

interface DevDesktopHandoffResponse {
  handoff: DevDesktopHandoffRecord | null;
}

export async function takeDevDesktopHandoff(
  signal?: AbortSignal,
): Promise<DevDesktopHandoffRecord | null> {
  const response = await fetch(buildProliferateApiUrl("/v1/dev/desktop-handoff"), {
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

