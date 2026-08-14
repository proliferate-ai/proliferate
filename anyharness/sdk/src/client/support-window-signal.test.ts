import { describe, expect, it, vi } from "vitest";

import { AnyHarnessTransport } from "./core.js";
import { SessionsClient } from "./sessions.js";

const timestampFrom = "2026-08-12T12:00:00Z";
const timestampTo = "2026-08-12T12:15:00Z";
const cancellationProperties = [
  "aborted",
  "reason",
  "addEventListener",
  "removeEventListener",
] as const;

describe("support-window AbortSignal safety", () => {
  it.each(["transparent", "forwarding", "lying", "revoked"] as const)(
    "rejects a %s signal proxy before traps, fetch, or body cancellation",
    async (kind) => {
      const controller = new AbortController();
      const trap = vi.fn();
      const signal = proxySignal(kind, controller.signal, trap);
      const bodyCancel = vi.fn();
      const fetch = vi.fn(async () => responseForEmptyEventWindow(bodyCancel));
      const client = clientUsing(fetch);

      await expect(client.listEventsSupportWindow(
        "session-1",
        eventOptions(signal),
      )).rejects.toThrow("signal must be a local native AbortSignal");

      expect(trap).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(bodyCancel).not.toHaveBeenCalled();
    },
  );

  it.each(cancellationProperties)(
    "rejects a branded signal with an own %s accessor without invoking it or fetch",
    async (property) => {
      const controller = new AbortController();
      const accessor = vi.fn(() => {
        throw new Error("must not invoke caller accessor");
      });
      Object.defineProperty(controller.signal, property, {
        configurable: true,
        get: accessor,
      });
      const fetch = vi.fn(async () => responseForEmptyEventWindow());
      const client = clientUsing(fetch);

      await expect(client.listEventsSupportWindow(
        "session-1",
        eventOptions(controller.signal),
      )).rejects.toThrow("Invalid support-window options");

      expect(accessor).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("pins signals to the exact local prototype without invoking inherited accessors", async () => {
    const controller = new AbortController();
    const inheritedAccessor = vi.fn(() => {
      throw new Error("must not invoke inherited accessor");
    });
    const customPrototype = Object.create(AbortSignal.prototype) as object;
    Object.defineProperty(customPrototype, "aborted", {
      configurable: true,
      get: inheritedAccessor,
    });
    Object.setPrototypeOf(controller.signal, customPrototype);
    const fetch = vi.fn(async () => responseForEmptyEventWindow());
    const client = clientUsing(fetch);

    await expect(client.listEventsSupportWindow(
      "session-1",
      eventOptions(controller.signal),
    )).rejects.toThrow("Invalid support-window options");

    expect(inheritedAccessor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards an ordinary native signal to fetch by identity", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return responseForEmptyEventWindow();
    });
    const client = clientUsing(fetch);

    await expect(client.listEventsSupportWindow(
      "session-1",
      eventOptions(controller.signal),
    )).resolves.toMatchObject({ items: [] });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses captured cancellation intrinsics after post-validation mutation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("support deadline", "AbortError");
    const shadowAccessor = vi.fn(() => {
      throw new Error("must not invoke post-validation shadow");
    });
    const cancel = vi.fn();
    let markPulling: (() => void) | undefined;
    const pulling = new Promise<void>((resolve) => {
      markPulling = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        markPulling?.();
      },
      cancel,
    });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      const customPrototype = Object.create(AbortSignal.prototype) as object;
      Object.defineProperty(customPrototype, "aborted", {
        configurable: true,
        get: shadowAccessor,
      });
      Object.setPrototypeOf(controller.signal, customPrototype);
      for (let index = 0; index < cancellationProperties.length; index += 1) {
        Object.defineProperty(controller.signal, cancellationProperties[index], {
          configurable: true,
          get: shadowAccessor,
        });
      }
      return new Response(stream);
    });
    const client = clientUsing(fetch);

    const result = client.listEventsSupportWindow(
      "session-1",
      eventOptions(controller.signal),
    );
    await pulling;
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(shadowAccessor).not.toHaveBeenCalled();
  });
});

function clientUsing(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
): SessionsClient {
  return new SessionsClient(new AnyHarnessTransport({
    baseUrl: "http://runtime.test",
    fetch: fetch as typeof globalThis.fetch,
  }));
}

function eventOptions(signal: AbortSignal) {
  return {
    timestampFrom,
    timestampTo,
    limit: 1,
    maxResponseBytes: 16_384,
    request: { signal },
  } as const;
}

function proxySignal(
  kind: "transparent" | "forwarding" | "lying" | "revoked",
  signal: AbortSignal,
  trap: ReturnType<typeof vi.fn>,
): AbortSignal {
  if (kind === "transparent") {
    return new Proxy(signal, {});
  }
  const handler: ProxyHandler<AbortSignal> = {
    get(target, property) {
      trap(`get:${String(property)}`);
      return Reflect.get(target, property, target) as unknown;
    },
    getOwnPropertyDescriptor() {
      trap("getOwnPropertyDescriptor");
      return undefined;
    },
    getPrototypeOf() {
      trap("getPrototypeOf");
      return AbortSignal.prototype;
    },
  };
  if (kind === "forwarding") {
    return new Proxy(signal, handler);
  }
  if (kind === "lying") {
    Object.setPrototypeOf(signal, Object.create(AbortSignal.prototype));
    Object.defineProperty(signal, "aborted", {
      configurable: true,
      get: trap,
    });
    return new Proxy(signal, handler);
  }
  const revocable = Proxy.revocable(signal, handler);
  revocable.revoke();
  return revocable.proxy;
}

function responseForEmptyEventWindow(cancel?: () => void): Response {
  const bytes = new TextEncoder().encode(JSON.stringify({
    window: {
      schemaVersion: 1,
      selection: "newest_matching",
      presentationOrder: "seq_asc",
      itemLimit: 1,
      responseByteLimit: 16_384,
      returnedItems: 0,
      omittedOversizedItems: 0,
      completeness: "complete",
    },
    items: [],
  }));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel,
  }));
}
