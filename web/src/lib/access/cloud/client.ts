import {
  createBearerTokenMiddleware,
  createProliferateClient,
} from "@proliferate/cloud-sdk";

export function createWebCloudClient(apiBaseUrl: string, token: string | null) {
  return createProliferateClient({
    baseUrl: apiBaseUrl,
    middleware: token ? [createBearerTokenMiddleware(() => token)] : [],
    streamRequest(input) {
      const headers = new Headers(input.headers);
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      return fetch(input.url, {
        headers,
        signal: input.signal,
      });
    },
  });
}
