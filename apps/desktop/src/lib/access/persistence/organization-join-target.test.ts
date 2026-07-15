import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryProductStorage } from "@/test/product-storage-test-utils";
import {
  clearPendingOrganizationJoinTarget,
  readPendingOrganizationJoinTarget,
  writePendingOrganizationJoinTarget,
} from "./organization-join-target";

const KEY = "proliferate.organizationJoinTarget";

afterEach(() => {
  vi.useRealTimers();
});

describe("organization join target persistence", () => {
  it("round-trips a fresh target through ProductStorage", async () => {
    const memory = createMemoryProductStorage();

    await writePendingOrganizationJoinTarget(memory.context, "org-1");
    expect(await readPendingOrganizationJoinTarget(memory.context)).toBe("org-1");
    expect(memory.readJson<{ organizationId: string }>(KEY)?.organizationId).toBe("org-1");

    await clearPendingOrganizationJoinTarget(memory.context);
    expect(await readPendingOrganizationJoinTarget(memory.context)).toBeNull();
    expect(memory.values.has(KEY)).toBe(false);
  });

  it("self-clears a stale target older than one hour", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(KEY, {
      organizationId: "org-old",
      createdAt: Date.now() - 61 * 60 * 1000,
    });

    expect(await readPendingOrganizationJoinTarget(memory.context)).toBeNull();
    expect(memory.values.has(KEY)).toBe(false);
  });

  it("returns null for a malformed or empty stored target", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(KEY, { createdAt: Date.now() });

    expect(await readPendingOrganizationJoinTarget(memory.context)).toBeNull();
  });
});
