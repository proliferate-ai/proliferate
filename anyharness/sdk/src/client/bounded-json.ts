import {
  addNativeAbortListener,
  isNativeAbortSignal,
  readNativeAbortSignalAborted,
  readNativeAbortSignalReason,
  removeNativeAbortListener,
} from "./abort-signal.js";

export type AnyHarnessBoundedJsonFailure =
  | "invalid_content_length"
  | "response_too_large"
  | "invalid_body_chunk";

export class AnyHarnessBoundedJsonError extends Error {
  readonly failure: AnyHarnessBoundedJsonFailure;
  readonly maxResponseBytes: number;

  constructor(
    failure: AnyHarnessBoundedJsonFailure,
    maxResponseBytes: number,
  ) {
    super(messageForFailure(failure));
    this.name = "AnyHarnessBoundedJsonError";
    this.failure = failure;
    this.maxResponseBytes = maxResponseBytes;
  }
}

export interface AnyHarnessBoundedJsonResponse {
  response: Response;
  body: unknown;
  bodyBytes: number;
}

export interface AnyHarnessBoundedJsonLimits {
  successBytes: number;
  errorBytes: number;
}

/**
 * Fetch and parse one JSON response while enforcing the status-specific byte
 * cap before body concatenation and JSON parsing. The request callback
 * receives the exact caller signal so the owning transport can retain its
 * authentication and timing behavior.
 *
 * Invalid JSON remains a hard error for successful responses. For non-success
 * responses it becomes `undefined`, preserving the transport's generic HTTP
 * error fallback without rereading an unbounded body.
 */
export async function requestBoundedJson(
  request: (signal: AbortSignal | undefined) => Promise<Response>,
  limits: AnyHarnessBoundedJsonLimits,
  signal?: AbortSignal,
): Promise<AnyHarnessBoundedJsonResponse> {
  assertResponseByteLimit(limits.successBytes, "successBytes");
  assertResponseByteLimit(limits.errorBytes, "errorBytes");
  if (signal !== undefined && !isNativeAbortSignal(signal)) {
    throw new TypeError("signal must be an unmodified native AbortSignal");
  }

  const response = await request(signal);
  const responseOk = response.ok;
  const maxResponseBytes = responseOk ? limits.successBytes : limits.errorBytes;
  const bytes = await readBoundedBody(response, maxResponseBytes, signal);
  return {
    response,
    body: parseResponseJson(bytes, responseOk),
    bodyBytes: bytes.byteLength,
  };
}

function assertResponseByteLimit(maxResponseBytes: number, name: string): void {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (signal && readNativeAbortSignalAborted(signal)) {
    const reason = abortReason(signal);
    cancelBody(response.body, reason);
    throw reason;
  }

  validateContentLength(
    response.headers.get("content-length"),
    maxResponseBytes,
    response.body,
  );

  if (!response.body) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Array<{ bytes: Uint8Array; byteLength: number }> = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await readWithAbort(reader, signal);
      if (result.done) {
        break;
      }

      const chunk = result.value;
      const chunkBytes = uint8ArrayByteLength(chunk);
      if (chunkBytes === null) {
        const error = new AnyHarnessBoundedJsonError(
          "invalid_body_chunk",
          maxResponseBytes,
        );
        cancelReader(reader, error);
        throw error;
      }

      if (chunkBytes > maxResponseBytes - totalBytes) {
        const error = new AnyHarnessBoundedJsonError(
          "response_too_large",
          maxResponseBytes,
        );
        cancelReader(reader, error);
        throw error;
      }

      chunks[chunks.length] = { bytes: chunk, byteLength: chunkBytes };
      totalBytes += chunkBytes;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cancellation can leave a read pending briefly; the reader is already
      // cancelled and must not replace the bounded-response result.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    Uint8Array.prototype.set.call(bytes, chunk.bytes, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;

function uint8ArrayByteLength(value: unknown): number | null {
  try {
    if (
      !ArrayBuffer.isView(value)
      || !typedArrayByteLength
      || !typedArrayTag
    ) {
      return null;
    }
    if (Reflect.apply(typedArrayTag, value, []) !== "Uint8Array") {
      return null;
    }
    const byteLength = Reflect.apply(
      typedArrayByteLength,
      value,
      [],
    ) as unknown;
    return typeof byteLength === "number" ? byteLength : null;
  } catch {
    return null;
  }
}

function validateContentLength(
  contentLength: string | null,
  maxResponseBytes: number,
  body: ReadableStream<Uint8Array> | null,
): void {
  if (contentLength === null) {
    return;
  }

  if (!/^[0-9]+$/.test(contentLength)) {
    const error = new AnyHarnessBoundedJsonError(
      "invalid_content_length",
      maxResponseBytes,
    );
    cancelBody(body, error);
    throw error;
  }

  const normalizedLength = contentLength.replace(/^0+/, "") || "0";
  const normalizedLimit = String(maxResponseBytes);
  if (
    normalizedLength.length > normalizedLimit.length
    || (
      normalizedLength.length === normalizedLimit.length
      && normalizedLength > normalizedLimit
    )
  ) {
    const error = new AnyHarnessBoundedJsonError(
      "response_too_large",
      maxResponseBytes,
    );
    cancelBody(body, error);
    throw error;
  }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) {
    return reader.read();
  }
  if (readNativeAbortSignalAborted(signal)) {
    const reason = abortReason(signal);
    cancelReader(reader, reason);
    return Promise.reject(reason);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      const reason = abortReason(signal);
      cancelReader(reader, reason);
      removeNativeAbortListener(signal, onAbort);
      reject(reason);
    };

    addNativeAbortListener(signal, onAbort);
    reader.read().then(
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        removeNativeAbortListener(signal, onAbort);
        resolve(result);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        removeNativeAbortListener(signal, onAbort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  const reason = readNativeAbortSignalReason(signal);
  return reason === undefined
    ? new DOMException("The operation was aborted", "AbortError")
    : reason;
}

function cancelBody(
  body: ReadableStream<Uint8Array> | null,
  reason: unknown,
): void {
  if (!body) {
    return;
  }
  try {
    void body.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort after the response has already failed.
  }
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort after the response has already failed.
  }
}

function parseResponseJson(bytes: Uint8Array, responseOk: boolean): unknown {
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (!responseOk) {
      return undefined;
    }
    throw error;
  }
}

function messageForFailure(failure: AnyHarnessBoundedJsonFailure): string {
  switch (failure) {
    case "invalid_content_length":
      return "AnyHarness response Content-Length is malformed";
    case "response_too_large":
      return "AnyHarness response exceeds the configured byte limit";
    case "invalid_body_chunk":
      return "AnyHarness response body contains a non-byte chunk";
  }
}
