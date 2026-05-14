export interface CloudSseSubscription<TEvent> {
  close: () => void;
  readonly closed: boolean;
  readonly source: EventSource;
}

export interface SubscribeCloudSseOptions<TEvent> {
  url: string;
  eventName?: string;
  signal?: AbortSignal;
  onEvent: (event: TEvent) => void;
  onError?: (error: Event) => void;
}

export function subscribeCloudSse<TEvent>(
  options: SubscribeCloudSseOptions<TEvent>,
): CloudSseSubscription<TEvent> {
  const source = new EventSource(options.url);
  let closed = false;

  const close = () => {
    if (!closed) {
      closed = true;
      source.close();
    }
  };

  const messageHandler = (event: MessageEvent<string>) => {
    options.onEvent(JSON.parse(event.data) as TEvent);
  };

  source.addEventListener(options.eventName ?? "message", messageHandler);
  source.addEventListener("error", (event) => {
    options.onError?.(event);
  });
  options.signal?.addEventListener("abort", close, { once: true });

  return {
    close,
    get closed() {
      return closed;
    },
    source,
  };
}

