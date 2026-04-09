import { buildProliferateApiUrl } from "@/lib/infra/proliferate-api";

let lastKnownControlPlaneReachable: boolean | null = null;

export function getLastKnownControlPlaneReachable(): boolean | null {
  return lastKnownControlPlaneReachable;
}

export async function checkControlPlaneReachable(): Promise<boolean> {
  try {
    const response = await fetch(buildProliferateApiUrl("/health"), {
      headers: {
        Accept: "application/json",
      },
    });
    const reachable = response.ok;
    lastKnownControlPlaneReachable = reachable;
    return reachable;
  } catch {
    lastKnownControlPlaneReachable = false;
    return false;
  }
}
