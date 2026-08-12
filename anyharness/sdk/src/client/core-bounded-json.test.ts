import { describe, expect, it, vi } from "vitest";

import { AnyHarnessBoundedJsonError } from "./bounded-json.js";
import {
  AnyHarnessError,
  AnyHarnessTransport,
  setAnyHarnessTimingObserver,
} from "./core.js";

describe("AnyHarnessTransport.getBoundedJson", () => {
  it("preserves auth, custom headers, signal identity, timing, and lifecycle", async () => {
    const controller = new AbortController();
    const finishLifecycle = vi.fn();
    const onRequestStart = vi.fn(() => finishLifecycle);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer runtime-token");
      expect(headers.get("x-support-request")).toBe("support-1");
      return new Response(JSON.stringify({ ok: true }));
    });
    const timingEvents: unknown[] = [];
    const removeObserver = setAnyHarnessTimingObserver((event) => {
      timingEvents.push(event);
    });
    const transport = new AnyHarnessTransport({
      authToken: "runtime-token",
      baseUrl: "http://runtime.test/",
      fetch: fetch as typeof globalThis.fetch,
    });

    try {
      await expect(transport.getBoundedJson(
        "/v1/bounded",
        16_384,
        {
          headers: { "x-support-request": "support-1" },
          measurementOperationId: "mop_support",
          signal: controller.signal,
          timingCategory: "session.events.list",
          timingLifecycle: { onRequestStart },
          timingScope: { runtimeUrlHash: "scope_support" },
        },
      )).resolves.toEqual({
        body: { ok: true },
        bodyBytes: new TextEncoder().encode(JSON.stringify({ ok: true })).byteLength,
      });
    } finally {
      removeObserver();
    }

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe("http://runtime.test/v1/bounded");
    expect(onRequestStart).toHaveBeenCalledWith({
      type: "request_start",
      category: "session.events.list",
      method: "GET",
      measurementOperationId: "mop_support",
      runtimeUrlHash: "scope_support",
    });
    expect(finishLifecycle).toHaveBeenCalledOnce();
    expect(timingEvents).toEqual([
      expect.objectContaining({
        type: "request",
        category: "session.events.list",
        method: "GET",
        status: 200,
        measurementOperationId: "mop_support",
        runtimeUrlHash: "scope_support",
      }),
    ]);
  });

  it("rejects an excessive success Content-Length before parsing", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(stream, {
      headers: { "content-length": "16385" },
    });
    const responseJson = vi.spyOn(response, "json");
    const transport = transportReturning(response);

    await expect(
      transport.getBoundedJson("/v1/bounded", 16_384),
    ).rejects.toMatchObject({
      name: "AnyHarnessBoundedJsonError",
      failure: "response_too_large",
      maxResponseBytes: 16_384,
    });
    expect(responseJson).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps bounded pre-parsed problem JSON without rereading the body", async () => {
    const response = new Response(JSON.stringify({
      type: "about:blank",
      title: "Invalid support window",
      status: 400,
      code: "INVALID_SUPPORT_WINDOW_QUERY",
      detail: "limit is out of range",
    }), {
      status: 400,
      statusText: "Bad Request",
    });
    const responseJson = vi.spyOn(response, "json");
    const transport = transportReturning(response);

    const error = await captureError(
      transport.getBoundedJson("/v1/bounded", 16_384),
    );

    expect(error).toBeInstanceOf(AnyHarnessError);
    expect((error as AnyHarnessError).problem).toEqual({
      type: "about:blank",
      title: "Invalid support window",
      status: 400,
      code: "INVALID_SUPPORT_WINDOW_QUERY",
      detail: "limit is out of range",
    });
    expect(responseJson).not.toHaveBeenCalled();
  });

  it("enforces the independent 65536-byte HTTP error-body cap", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(stream, {
      status: 500,
      headers: { "content-length": "65537" },
    });
    const transport = transportReturning(response);

    await expect(
      transport.getBoundedJson("/v1/bounded", 4_194_304),
    ).rejects.toEqual(expect.objectContaining({
      name: "AnyHarnessBoundedJsonError",
      failure: "response_too_large",
      maxResponseBytes: 65_536,
    } satisfies Partial<AnyHarnessBoundedJsonError>));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses the caller AbortSignal for in-flight stream cancellation", async () => {
    const controller = new AbortController();
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
      return new Response(stream);
    });
    const transport = new AnyHarnessTransport({
      baseUrl: "http://runtime.test",
      fetch: fetch as typeof globalThis.fetch,
    });
    const reason = new DOMException("support deadline", "AbortError");

    const result = transport.getBoundedJson(
      "/v1/bounded",
      16_384,
      { signal: controller.signal },
    );
    await pulling;
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
  });
});

function transportReturning(response: Response): AnyHarnessTransport {
  return new AnyHarnessTransport({
    baseUrl: "http://runtime.test",
    fetch: vi.fn(async () => response) as typeof globalThis.fetch,
  });
}

async function captureError(result: Promise<unknown>): Promise<unknown> {
  try {
    await result;
  } catch (error) {
    return error;
  }
  throw new Error("Expected request to fail");
}
