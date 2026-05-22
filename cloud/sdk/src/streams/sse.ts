export interface CloudSseSubscription<TEvent> {
  close: () => void;
  readonly closed: boolean;
}

export class CloudSseErrorEvent extends Event {
  readonly message: string;
  readonly status: number | null;

  constructor(message: string, options: { status?: number; type?: string } = {}) {
    super(options.type ?? "error");
    this.message = message;
    this.status = options.status ?? null;
  }
}

export interface SubscribeCloudSseOptions<TEvent> {
  url: string;
  eventName?: string;
  signal?: AbortSignal;
  fetchResponse?: (input: {
    url: string;
    headers: HeadersInit;
    signal: AbortSignal;
  }) => Promise<Response>;
  onEvent: (event: TEvent) => void;
  onError?: (error: Event) => void;
}

export function subscribeCloudSse<TEvent>(
  options: SubscribeCloudSseOptions<TEvent>,
): CloudSseSubscription<TEvent> {
  const controller = new AbortController();
  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const close = () => {
    if (!closed) {
      closed = true;
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
  };

  options.signal?.addEventListener("abort", close, { once: true });
  void pumpCloudSse(options, controller.signal, (nextReader) => {
    reader = nextReader;
  })
    .then(() => {
      if (!closed && !controller.signal.aborted) {
        options.onError?.(new Event("eof"));
      }
    })
    .catch((error) => {
      if (!closed && !controller.signal.aborted) {
        options.onError?.(normalizeCloudSseError(error));
      }
    });

  return {
    close,
    get closed() {
      return closed;
    },
  };
}

async function pumpCloudSse<TEvent>(
  options: SubscribeCloudSseOptions<TEvent>,
  signal: AbortSignal,
  setReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
): Promise<void> {
  const response = await (options.fetchResponse ?? defaultFetchResponse)({
    url: options.url,
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!response.ok) {
    throw new CloudSseErrorEvent(`Cloud stream failed with HTTP ${response.status}`, {
      status: response.status,
      type: "http_error",
    });
  }
  if (!response.body) {
    throw new Error("Cloud stream response did not include a body.");
  }

  const reader = response.body.getReader();
  setReader(reader);
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      dispatchCloudSseFrame(frame, options);
    }
  }
}

async function defaultFetchResponse(input: {
  url: string;
  headers: HeadersInit;
  signal: AbortSignal;
}): Promise<Response> {
  return fetch(input.url, {
    headers: input.headers,
    signal: input.signal,
  });
}

function normalizeCloudSseError(error: unknown): Event {
  if (error instanceof Event) {
    return error;
  }
  if (error instanceof Error) {
    return new CloudSseErrorEvent(error.message);
  }
  return new CloudSseErrorEvent("Cloud stream failed.");
}

function dispatchCloudSseFrame<TEvent>(
  frame: string,
  options: SubscribeCloudSseOptions<TEvent>,
): void {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (options.eventName && options.eventName !== eventName) {
    return;
  }
  if (dataLines.length === 0) {
    return;
  }
  options.onEvent(JSON.parse(dataLines.join("\n")) as TEvent);
}
