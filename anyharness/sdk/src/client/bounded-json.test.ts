import { describe, expect, it, vi } from "vitest";

import {
  AnyHarnessBoundedJsonError,
  requestBoundedJson,
} from "./bounded-json.js";

const encoder = new TextEncoder();
const limits = (successBytes: number, errorBytes = successBytes) => ({
  successBytes,
  errorBytes,
});

describe("requestBoundedJson", () => {
  it("parses a successful response at the exact declared byte cap", async () => {
    const text = JSON.stringify({ ok: true });
    const response = new Response(text, {
      headers: { "content-length": String(encoder.encode(text).byteLength) },
    });

    const result = await requestBoundedJson(
      async () => response,
      limits(encoder.encode(text).byteLength),
    );

    expect(result.response).toBe(response);
    expect(result.body).toEqual({ ok: true });
    expect(result.bodyBytes).toBe(encoder.encode(text).byteLength);
  });

  it("applies the success cap independently from the smaller error cap", async () => {
    const text = JSON.stringify({ success: true });
    const response = new Response(text);

    await expect(
      requestBoundedJson(
        async () => response,
        limits(encoder.encode(text).byteLength, 2),
      ),
    ).resolves.toMatchObject({ body: { success: true } });
  });

  it("streams a response with no Content-Length before parsing JSON", async () => {
    const response = responseFromChunks(["{\"items\":", "[1,2,3]}"]);

    await expect(
      requestBoundedJson(async () => response, limits(64)),
    ).resolves.toMatchObject({ body: { items: [1, 2, 3] } });
  });

  it.each(["-1", "+1", "1.5", "1, 1", "0x10", "1 1"])(
    "rejects malformed Content-Length %s and cancels the body",
    async (contentLength) => {
      const cancellation = cancellationResponse({
        contentLength,
        body: "{}",
      });

      await expect(
        requestBoundedJson(async () => cancellation.response, limits(64)),
      ).rejects.toMatchObject({
        name: "AnyHarnessBoundedJsonError",
        failure: "invalid_content_length",
        maxResponseBytes: 64,
      });
      expect(cancellation.cancel).toHaveBeenCalledOnce();
    },
  );

  it("accepts a leading-zero Content-Length without losing the byte bound", async () => {
    const response = new Response("{}", {
      headers: { "content-length": "0002" },
    });

    await expect(
      requestBoundedJson(async () => response, limits(2)),
    ).resolves.toMatchObject({ body: {} });
  });

  it("rejects oversized Content-Length before reading and cancels the body", async () => {
    const cancellation = cancellationResponse({
      contentLength: "100000000000000000000000000000000000000",
      body: "{}",
    });

    await expect(
      requestBoundedJson(async () => cancellation.response, limits(1_048_576)),
    ).rejects.toMatchObject({
      failure: "response_too_large",
      maxResponseBytes: 1_048_576,
    });
    expect(cancellation.cancel).toHaveBeenCalledOnce();
  });

  it("rejects incremental stream overflow and cancels the reader", async () => {
    const cancellation = cancellationResponse({
      chunks: ["{\"value\":", "\"too large\"}"],
    });

    await expect(
      requestBoundedJson(async () => cancellation.response, limits(10)),
    ).rejects.toMatchObject({
      failure: "response_too_large",
      maxResponseBytes: 10,
    });
    expect(cancellation.cancel).toHaveBeenCalledOnce();
  });

  it("enforces incremental overflow on non-success response bodies", async () => {
    const cancellation = cancellationResponse({
      chunks: ["{\"detail\":", "\"too large\"}"],
      status: 500,
    });

    await expect(
      requestBoundedJson(async () => cancellation.response, limits(64, 12)),
    ).rejects.toMatchObject({ failure: "response_too_large" });
    expect(cancellation.cancel).toHaveBeenCalledOnce();
  });

  it("parses a non-success response at the exact error-body cap", async () => {
    const text = JSON.stringify({ x: 1 });
    const response = new Response(text, { status: 400 });

    await expect(
      requestBoundedJson(
        async () => response,
        limits(1_024, encoder.encode(text).byteLength),
      ),
    ).resolves.toMatchObject({
      response: { status: 400 },
      body: { x: 1 },
    });
  });

  it("rejects oversized Content-Length on non-success response bodies", async () => {
    const cancellation = cancellationResponse({
      body: "{}",
      contentLength: "65",
      status: 400,
    });

    await expect(
      requestBoundedJson(async () => cancellation.response, limits(1_024, 64)),
    ).rejects.toMatchObject({ failure: "response_too_large" });
    expect(cancellation.cancel).toHaveBeenCalledOnce();
  });

  it("rejects a non-byte stream chunk and cancels the reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue("not bytes");
      },
      cancel,
    });
    const response = new Response(
      stream as unknown as ReadableStream<Uint8Array>,
    );

    await expect(
      requestBoundedJson(async () => response, limits(64)),
    ).rejects.toMatchObject({ failure: "invalid_body_chunk" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects another typed-array kind even if it spoofs a Uint8Array tag", async () => {
    const cancel = vi.fn();
    const chunk = new Uint16Array([123, 125]);
    Object.defineProperty(chunk, Symbol.toStringTag, { value: "Uint8Array" });
    const stream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue(chunk);
      },
      cancel,
    });

    await expect(
      requestBoundedJson(
        async () => new Response(stream as ReadableStream<Uint8Array>),
        limits(64),
      ),
    ).rejects.toMatchObject({ failure: "invalid_body_chunk" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts a branded Uint8Array without the local prototype", async () => {
    const chunk = encoder.encode("{}");
    Object.setPrototypeOf(chunk, {
      [Symbol.toStringTag]: "Uint8Array",
    });
    expect(chunk).not.toBeInstanceOf(Uint8Array);
    expect(ArrayBuffer.isView(chunk)).toBe(true);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    await expect(
      requestBoundedJson(
        async () => new Response(stream),
        limits(2),
      ),
    ).resolves.toMatchObject({ body: {} });
  });

  it("returns parsed bounded JSON for a non-success response", async () => {
    const response = new Response(JSON.stringify({ detail: "rejected" }), {
      status: 400,
    });

    const result = await requestBoundedJson(async () => response, limits(64));

    expect(result.response.status).toBe(400);
    expect(result.body).toEqual({ detail: "rejected" });
  });

  it("uses an undefined body for invalid bounded error JSON", async () => {
    const response = new Response("not json", { status: 502 });

    const result = await requestBoundedJson(async () => response, limits(64));

    expect(result.response.status).toBe(502);
    expect(result.body).toBeUndefined();
  });

  it("keeps invalid successful JSON as a parse failure", async () => {
    const response = new Response("not json");

    await expect(
      requestBoundedJson(async () => response, limits(64)),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it("forwards the exact AbortSignal to the request callback", async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => new Response("{}"));

    await requestBoundedJson(request, limits(64), controller.signal);

    expect(request).toHaveBeenCalledWith(controller.signal);
  });

  it("cancels a returned body for an already-aborted request", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);
    const cancellation = cancellationResponse({ body: "{}" });
    const request = vi.fn(async () => cancellation.response);

    await expect(
      requestBoundedJson(request, limits(64), controller.signal),
    ).rejects.toBe(reason);
    expect(request).toHaveBeenCalledWith(controller.signal);
    expect(cancellation.cancel).toHaveBeenCalledWith(reason);
  });

  it("cancels an in-flight reader when the request is aborted", async () => {
    const controller = new AbortController();
    const reason = new DOMException("deadline", "AbortError");
    const cancel = vi.fn();
    let markWaitingForNextChunk: (() => void) | undefined;
    const waitingForNextChunk = new Promise<void>((resolve) => {
      markWaitingForNextChunk = resolve;
    });
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(streamController) {
        pullCount += 1;
        if (pullCount === 1) {
          streamController.enqueue(encoder.encode("{"));
          return;
        }
        markWaitingForNextChunk?.();
      },
      cancel,
    });
    const response = new Response(stream);

    const result = requestBoundedJson(
      async () => response,
      limits(64),
      controller.signal,
    );
    await waitingForNextChunk;
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid success byte cap %s before making a request",
    async (maxResponseBytes) => {
      const request = vi.fn(async () => new Response("{}"));

      await expect(
        requestBoundedJson(request, limits(maxResponseBytes)),
      ).rejects.toBeInstanceOf(RangeError);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid error byte cap %s before making a request",
    async (errorBytes) => {
      const request = vi.fn(async () => new Response("{}"));

      await expect(
        requestBoundedJson(request, limits(64, errorBytes)),
      ).rejects.toBeInstanceOf(RangeError);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("uses a stable error without including server body bytes", () => {
    const error = new AnyHarnessBoundedJsonError("response_too_large", 128);

    expect(error.message).toBe(
      "AnyHarness response exceeds the configured byte limit",
    );
    expect(error.message).not.toContain("detail");
  });
});

function responseFromChunks(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < chunks.length; index += 1) {
        controller.enqueue(encoder.encode(chunks[index]));
      }
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function cancellationResponse(input: {
  body?: string;
  chunks?: string[];
  contentLength?: string;
  status?: number;
}): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  const chunks = input.chunks ?? [input.body ?? ""];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < chunks.length; index += 1) {
        controller.enqueue(encoder.encode(chunks[index]));
      }
    },
    cancel,
  });
  const headers = input.contentLength === undefined
    ? undefined
    : { "content-length": input.contentLength };
  return {
    response: new Response(stream, {
      status: input.status ?? 200,
      headers,
    }),
    cancel,
  };
}
