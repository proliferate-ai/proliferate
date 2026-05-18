import {
  createBearerTokenMiddleware,
  createProliferateClient,
} from "@proliferate/cloud-sdk";

export function createWebCloudClient(apiBaseUrl: string, token: string | null) {
  return createProliferateClient({
    baseUrl: apiBaseUrl,
    middleware: token ? [createBearerTokenMiddleware(() => token)] : [],
  });
}

export async function startBrowserOAuth(apiBaseUrl: string, provider: "github" | "google") {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/auth/${provider}/authorize`);
  if (!response.ok) {
    throw new Error(`Could not start ${provider} sign in.`);
  }
  const body = await response.json() as { authorization_url?: string; authorizationUrl?: string };
  const authorizationUrl = body.authorization_url ?? body.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error(`Server did not return a ${provider} authorization URL.`);
  }
  window.location.assign(authorizationUrl);
}
