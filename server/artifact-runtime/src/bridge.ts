import {
  isDesktopToRuntimeMessage,
  isRuntimeToDesktopMessage,
  type RuntimeErrorPayload,
  type RuntimeToDesktopMessage,
  type SetContentPayload,
} from "./types";

interface RuntimeBridgeOptions {
  onSetContent: (payload: SetContentPayload) => void | Promise<void>;
}

interface RuntimeBridge {
  start: () => void;
  clearChildFrames: () => void;
  registerChildFrame: (iframe: HTMLIFrameElement) => void;
  openLink: (url: string) => void;
  reportError: (payload: RuntimeErrorPayload) => void;
}

const FALLBACK_PARENT_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
]);

function resolveParentOrigin(): string | null {
  const parentOriginParam = new URLSearchParams(window.location.search).get("parentOrigin");
  if (parentOriginParam?.trim()) {
    return parentOriginParam.trim();
  }

  try {
    const origin = new URL(document.referrer).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function isAllowedParentOrigin(origin: string, expectedOrigin: string | null): boolean {
  if (expectedOrigin) {
    return origin === expectedOrigin;
  }

  return FALLBACK_PARENT_ORIGINS.has(origin);
}

function isForwardableChildMessage(
  value: RuntimeToDesktopMessage,
): value is Exclude<RuntimeToDesktopMessage, { method: "ReadyForContent" }> {
  return value.method === "OpenLink" || value.method === "ReportError";
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:"
      || parsed.protocol === "https:"
      || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function createRuntimeBridge({
  onSetContent,
}: RuntimeBridgeOptions): RuntimeBridge {
  const parentOrigin = resolveParentOrigin();
  const childFrames = new Set<Window>();

  const isRegisteredChildSource = (source: MessageEventSource | null): source is Window =>
    source !== null && childFrames.has(source as Window);

  const postToDesktop = (message: RuntimeToDesktopMessage) => {
    if (!parentOrigin) {
      return;
    }
    window.parent.postMessage(message, parentOrigin);
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    if (event.source === window.parent) {
      if (!isAllowedParentOrigin(event.origin, parentOrigin)) {
        return;
      }
      if (!isDesktopToRuntimeMessage(event.data)) {
        return;
      }
      void onSetContent(event.data.payload);
      return;
    }

    if (!isRegisteredChildSource(event.source)) {
      return;
    }
    if (
      event.origin !== ""
      && event.origin !== "null"
      && event.origin !== window.location.origin
    ) {
      return;
    }
    if (!isRuntimeToDesktopMessage(event.data) || !isForwardableChildMessage(event.data)) {
      return;
    }
    if (event.data.method === "OpenLink" && !isAllowedExternalUrl(event.data.payload.url)) {
      return;
    }
    postToDesktop(event.data);
  };

  return {
    start() {
      window.addEventListener("message", handleMessage);
      postToDesktop({ method: "ReadyForContent" });
    },
    clearChildFrames() {
      childFrames.clear();
    },
    registerChildFrame(iframe) {
      const register = () => {
        if (iframe.contentWindow) {
          childFrames.add(iframe.contentWindow);
        }
      };
      register();
      iframe.addEventListener("load", register, { once: true });
    },
    openLink(url) {
      if (!isAllowedExternalUrl(url)) {
        return;
      }
      postToDesktop({ method: "OpenLink", payload: { url } });
    },
    reportError(payload) {
      postToDesktop({ method: "ReportError", payload });
    },
  };
}
