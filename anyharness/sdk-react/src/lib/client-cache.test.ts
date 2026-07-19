import { expect, it, vi } from "vitest";
import { getAnyHarnessClient } from "./client-cache.js";

it("uses a context-owned fetch without caching it into the process client map", async () => {
  const firstFetch = vi.fn(async () => new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof globalThis.fetch;
  const secondFetch = vi.fn(async () => new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as typeof globalThis.fetch;
  const runtimeUrl = "https://fixture-runtime.test";

  await getAnyHarnessClient({ runtimeUrl, fetch: firstFetch }).agents.list();
  await getAnyHarnessClient({ runtimeUrl, fetch: secondFetch }).agents.list();

  expect(firstFetch).toHaveBeenCalledOnce();
  expect(secondFetch).toHaveBeenCalledOnce();
});
