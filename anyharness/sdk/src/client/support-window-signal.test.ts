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

  it("rejects a branded signal with a custom prototype without invoking it or fetch", async () => {
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

function responseForEmptyEventWindow(): Response {
  return new Response(JSON.stringify({
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
}
