import type { Middleware } from "./core";

export function createBearerTokenMiddleware(getToken: () => string | Promise<string>): Middleware {
  return {
    async onRequest({ request }) {
      request.headers.set("accept", "application/json");
      request.headers.set("authorization", `Bearer ${await getToken()}`);
      if (request.body && !request.headers.has("content-type")) {
        request.headers.set("content-type", "application/json");
      }
      return request;
    },
  };
}

