import {
  createBearerTokenMiddleware,
  createProliferateClient,
} from "@proliferate/cloud-sdk";

export function createMobileCloudClient(apiBaseUrl: string, token: string | null) {
  return createProliferateClient({
    baseUrl: apiBaseUrl,
    middleware: token ? [createBearerTokenMiddleware(() => token)] : [],
  });
}
