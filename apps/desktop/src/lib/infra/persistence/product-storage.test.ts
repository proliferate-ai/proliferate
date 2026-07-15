import { describe, expect, it, vi } from "vitest";

import type { ProductStorage } from "@proliferate/product-client/host/product-host";

import {
  type ProductStorageContext,
  readPersistedJson,
  readPersistedJsonValue,
  readPersistedString,
  readPersistedStringValue,
  removePersistedKey,
  writePersistedJson,
  writePersistedString,
} from "./product-storage";

interface Shape {
  value: number;
}

const DEFAULT: Shape = { value: 0 };

function normalizeShape(raw: unknown): Shape {
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as { value?: unknown }).value === "number"
  ) {
    return { value: (raw as Shape).value };
  }
  return DEFAULT;
}

function makeContext(
  storage: Partial<ProductStorage>,
  captureException = vi.fn(),
): { context: ProductStorageContext; captureException: ReturnType<typeof vi.fn> } {
  const context: ProductStorageContext = {
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
      ...storage,
    },
    captureException,
  };
  return { context, captureException };
}

describe("readPersistedJson", () => {
  it("returns the caller default for a missing key without capturing", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => null),
    });

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: DEFAULT,
    });

    expect(result).toEqual({ status: "settled", value: DEFAULT });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("parses a valid stored JSON value", async () => {
    const { context } = makeContext({
      getItem: vi.fn(async () => JSON.stringify({ value: 7 })),
    });

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: DEFAULT,
    });

    expect(result).toEqual({ status: "settled", value: { value: 7 } });
  });

  it("routes a malformed string through parse(undefined) without capturing", async () => {
    const parse = vi.fn(normalizeShape);
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => "not json {"),
    });

    const result = await readPersistedJson(context, "k", {
      parse,
      fallback: { value: -1 },
    });

    expect(parse).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ status: "settled", value: DEFAULT });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("routes wrong-shaped JSON through the caller's normalization", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => JSON.stringify({ value: "oops" })),
    });

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: { value: -1 },
    });

    expect(result).toEqual({ status: "settled", value: DEFAULT });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures a read rejection, settles with the fallback", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => {
        throw new Error("read boom");
      }),
    });

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: { value: 42 },
    });

    expect(result).toEqual({ status: "settled", value: { value: 42 } });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, ctx] = captureException.mock.calls[0];
    expect((error as Error).message).toBe("read boom");
    expect(ctx.tags).toMatchObject({
      domain: "product_storage",
      action: "read",
      key: "k",
    });
  });

  it("ignores a stale result after a successful read (no commit)", async () => {
    const parse = vi.fn(normalizeShape);
    const { context } = makeContext({
      getItem: vi.fn(async () => JSON.stringify({ value: 9 })),
    });

    const result = await readPersistedJson(context, "k", {
      parse,
      fallback: DEFAULT,
      isStale: () => true,
    });

    expect(result).toEqual({ status: "ignored" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("ignores a stale result after a rejected read without capturing", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => {
        throw new Error("late read");
      }),
    });

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: DEFAULT,
      isStale: () => true,
    });

    expect(result).toEqual({ status: "ignored" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("settles even when captureException throws on a read rejection", async () => {
    const captureException = vi.fn(() => {
      throw new Error("telemetry down");
    });
    const { context } = makeContext(
      {
        getItem: vi.fn(async () => {
          throw new Error("read boom");
        }),
      },
      captureException,
    );

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: { value: 5 },
    });

    expect(result).toEqual({ status: "settled", value: { value: 5 } });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("settles even when captureException returns a rejecting promise", async () => {
    const captureException = vi.fn(() => Promise.reject(new Error("async telemetry down")));
    const { context } = makeContext(
      {
        getItem: vi.fn(async () => {
          throw new Error("read boom");
        }),
      },
      captureException,
    );

    const result = await readPersistedJson(context, "k", {
      parse: normalizeShape,
      fallback: { value: 3 },
    });

    expect(result).toEqual({ status: "settled", value: { value: 3 } });
  });

  it("captures and settles when parse itself throws", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => JSON.stringify({ value: 1 })),
    });

    const result = await readPersistedJson(context, "k", {
      parse: () => {
        throw new Error("parse boom");
      },
      fallback: { value: 8 },
    });

    expect(result).toEqual({ status: "settled", value: { value: 8 } });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe("writePersistedJson", () => {
  it("serializes and writes the value", async () => {
    const setItem = vi.fn(async () => {});
    const { context } = makeContext({ setItem });

    await writePersistedJson(context, "k", { value: 11 });

    expect(setItem).toHaveBeenCalledWith("k", JSON.stringify({ value: 11 }));
  });

  it("captures a write rejection once and still allows a later write", async () => {
    const setItem = vi
      .fn<ProductStorage["setItem"]>()
      .mockRejectedValueOnce(new Error("write boom"))
      .mockResolvedValue(undefined);
    const { context, captureException } = makeContext({ setItem });

    await writePersistedJson(context, "k", { value: 1 });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags).toMatchObject({
      domain: "product_storage",
      action: "write",
      key: "k",
    });

    await writePersistedJson(context, "k", { value: 2 });
    expect(setItem).toHaveBeenNthCalledWith(2, "k", JSON.stringify({ value: 2 }));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("resolves even when captureException throws on a write rejection", async () => {
    const captureException = vi.fn(() => {
      throw new Error("telemetry down");
    });
    const { context } = makeContext(
      {
        setItem: vi.fn(async () => {
          throw new Error("write boom");
        }),
      },
      captureException,
    );

    await expect(writePersistedJson(context, "k", { value: 1 })).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe("readPersistedString", () => {
  it("returns the raw stored string verbatim (no JSON decode)", async () => {
    const { context } = makeContext({
      getItem: vi.fn(async () => "logical-workspace-1"),
    });

    const result = await readPersistedString(context, "k");

    expect(result).toEqual({ status: "settled", value: "logical-workspace-1" });
  });

  it("settles null for a missing key without capturing", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => null),
    });

    const result = await readPersistedString(context, "k");

    expect(result).toEqual({ status: "settled", value: null });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures a read rejection and settles null", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => {
        throw new Error("read boom");
      }),
    });

    const result = await readPersistedString(context, "k");

    expect(result).toEqual({ status: "settled", value: null });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags).toMatchObject({
      domain: "product_storage",
      action: "read",
      key: "k",
    });
  });

  it("ignores a stale result without committing", async () => {
    const { context } = makeContext({
      getItem: vi.fn(async () => "value"),
    });

    const result = await readPersistedString(context, "k", { isStale: () => true });

    expect(result).toEqual({ status: "ignored" });
  });
});

describe("writePersistedString", () => {
  it("writes the raw string without JSON encoding", async () => {
    const setItem = vi.fn(async () => {});
    const { context } = makeContext({ setItem });

    await writePersistedString(context, "k", "desktop:abc");

    expect(setItem).toHaveBeenCalledWith("k", "desktop:abc");
  });

  it("captures a write rejection once and resolves", async () => {
    const { context, captureException } = makeContext({
      setItem: vi.fn(async () => {
        throw new Error("write boom");
      }),
    });

    await expect(writePersistedString(context, "k", "v")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags).toMatchObject({
      domain: "product_storage",
      action: "write",
      key: "k",
    });
  });
});

describe("value-reader convenience wrappers", () => {
  it("readPersistedJsonValue decodes a stored object", async () => {
    const { context } = makeContext({
      getItem: vi.fn(async () => JSON.stringify({ value: 4 })),
    });

    await expect(readPersistedJsonValue(context, "k")).resolves.toEqual({ value: 4 });
  });

  it("readPersistedJsonValue returns undefined for a missing key", async () => {
    const { context } = makeContext({ getItem: vi.fn(async () => null) });

    await expect(readPersistedJsonValue(context, "k")).resolves.toBeUndefined();
  });

  it("readPersistedJsonValue returns undefined and captures a read rejection", async () => {
    const { context, captureException } = makeContext({
      getItem: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await expect(readPersistedJsonValue(context, "k")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("readPersistedStringValue maps a missing key to undefined", async () => {
    const { context } = makeContext({ getItem: vi.fn(async () => null) });

    await expect(readPersistedStringValue(context, "k")).resolves.toBeUndefined();
  });

  it("readPersistedStringValue returns the stored string", async () => {
    const { context } = makeContext({ getItem: vi.fn(async () => "claude") });

    await expect(readPersistedStringValue(context, "k")).resolves.toBe("claude");
  });
});

describe("removePersistedKey", () => {
  it("delegates to removeItem", async () => {
    const removeItem = vi.fn(async () => {});
    const { context } = makeContext({ removeItem });

    await removePersistedKey(context, "k");

    expect(removeItem).toHaveBeenCalledWith("k");
  });

  it("captures a removal rejection once and resolves", async () => {
    const { context, captureException } = makeContext({
      removeItem: vi.fn(async () => {
        throw new Error("remove boom");
      }),
    });

    await expect(removePersistedKey(context, "k")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags).toMatchObject({
      domain: "product_storage",
      action: "remove",
      key: "k",
    });
  });
});
