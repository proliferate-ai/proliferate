interface BrowserWebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EnsureBrowserWebviewInput {
  label: string;
  url: string;
  bounds: BrowserWebviewBounds;
  visible: boolean;
  reloadKey: number;
}

interface BrowserWebviewHandle {
  close(): Promise<void>;
  hide(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  setPosition(position: unknown): Promise<void>;
  setSize(size: unknown): Promise<void>;
  once<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
}

interface BrowserWebviewRecord {
  webview: BrowserWebviewHandle | null;
  url: string;
  reloadKey: number;
  ready: Promise<BrowserWebviewHandle>;
  closing?: Promise<void>;
}

const browserWebviews = new Map<string, BrowserWebviewRecord>();

export function isBrowserWebviewAvailable(): boolean {
  const available = typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
  logBrowserWebviewDiagnostic("availability", {
    available,
    currentWebviewLabel: currentTauriWebviewLabel(),
  });
  return available;
}

export function browserWebviewLabel(
  workspaceId: string | null,
  browserId: string,
): string {
  const workspaceSegment = sanitizeWebviewLabelSegment(workspaceId ?? "workspace");
  const browserSegment = sanitizeWebviewLabelSegment(browserId);
  return `workspace-browser-${workspaceSegment}-${browserSegment}`;
}

export async function ensureBrowserWebview(input: EnsureBrowserWebviewInput): Promise<void> {
  if (!isBrowserWebviewAvailable()) {
    return;
  }

  let existing = browserWebviews.get(input.label);
  if (existing?.closing) {
    logBrowserWebviewDiagnostic("await-close", { label: input.label });
    await existing.closing;
    existing = browserWebviews.get(input.label);
  }
  if (existing && (existing.url !== input.url || existing.reloadKey !== input.reloadKey)) {
    logBrowserWebviewDiagnostic("recreate", { label: input.label });
    await closeBrowserWebview(input.label);
    existing = browserWebviews.get(input.label);
    if (existing?.closing) {
      logBrowserWebviewDiagnostic("await-close", { label: input.label });
      await existing.closing;
    }
  }

  let record = browserWebviews.get(input.label);
  if (!record) {
    const newRecord: BrowserWebviewRecord = {
      webview: null,
      url: input.url,
      reloadKey: input.reloadKey,
      ready: createBrowserWebview(input),
    };
    browserWebviews.set(input.label, newRecord);
    newRecord.ready
      .then((webview) => {
        newRecord.webview = webview;
      })
      .catch(() => {
        if (browserWebviews.get(input.label) === newRecord) {
          browserWebviews.delete(input.label);
        }
      });
    record = newRecord;
  }

  let webview: BrowserWebviewHandle;
  try {
    webview = await record.ready;
  } catch (error) {
    logBrowserWebviewDiagnostic("create:failed", {
      label: input.label,
      error: sanitizeBrowserWebviewDiagnostic(error),
    });
    throw error;
  }
  await positionBrowserWebview(webview, input.bounds);
  if (input.visible) {
    await webview.show();
  } else {
    await webview.hide();
  }
}

export async function hideBrowserWebview(label: string): Promise<void> {
  const record = browserWebviews.get(label);
  if (!record) {
    return;
  }
  logBrowserWebviewDiagnostic("hide", { label });
  const webview = await record.ready.catch(() => null);
  await webview?.hide();
}

export async function closeBrowserWebview(label: string): Promise<void> {
  const record = browserWebviews.get(label);
  if (!record) {
    return;
  }
  if (record.closing) {
    await record.closing;
    return;
  }
  logBrowserWebviewDiagnostic("close", { label });
  record.closing = (async () => {
    const webview = await record.ready.catch(() => null);
    await webview?.close().catch((error) => {
      logBrowserWebviewDiagnostic("close:failed", {
        label,
        error: sanitizeBrowserWebviewDiagnostic(error),
      });
    });
  })().finally(() => {
    if (browserWebviews.get(label) === record) {
      browserWebviews.delete(label);
    }
  });
  await record.closing;
}

async function createBrowserWebview(
  input: EnsureBrowserWebviewInput,
): Promise<BrowserWebviewHandle> {
  logBrowserWebviewDiagnostic("create:start", {
    label: input.label,
    width: input.bounds.width,
    height: input.bounds.height,
  });
  const { Webview } = await import("@tauri-apps/api/webview");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const existingWebview = await Webview.getByLabel(input.label) as BrowserWebviewHandle | null;
  if (existingWebview) {
    logBrowserWebviewDiagnostic("create:adopt", { label: input.label });
    return existingWebview;
  }
  const webview = new Webview(getCurrentWindow(), input.label, {
    url: input.url,
    x: input.bounds.x,
    y: input.bounds.y,
    width: input.bounds.width,
    height: input.bounds.height,
    focus: false,
    dragDropEnabled: false,
  }) as BrowserWebviewHandle;
  await browserWebviewReady(webview);
  return webview;
}

async function positionBrowserWebview(
  webview: BrowserWebviewHandle,
  bounds: BrowserWebviewBounds,
): Promise<void> {
  const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
  await webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
  await webview.setSize(new LogicalSize(bounds.width, bounds.height));
}

function sanitizeWebviewLabelSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return sanitized || "unknown";
}

function browserWebviewReady(webview: BrowserWebviewHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    void webview.once("tauri://created", () => {
      logBrowserWebviewDiagnostic("create:ready");
      settle(resolve);
    }).catch(() => {
      settle(() => reject(new Error("Browser webview listener failed.")));
    });
    void webview.once("tauri://error", (event) => {
      logBrowserWebviewDiagnostic("create:error-event", {
        error: sanitizeBrowserWebviewDiagnostic(event.payload),
      });
      settle(() => reject(new Error("Browser webview failed to open.")));
    }).catch(() => {
      settle(() => reject(new Error("Browser webview listener failed.")));
    });
  });
}

function logBrowserWebviewDiagnostic(
  event: string,
  details?: Record<string, unknown>,
): void {
  if (!isBrowserWebviewDiagnosticLoggingEnabled()) {
    return;
  }
  console.debug("[browser-webview]", event, details ?? {});
}

function isBrowserWebviewDiagnosticLoggingEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== "test";
}

function currentTauriWebviewLabel(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: unknown } } };
  }).__TAURI_INTERNALS__;
  const label = internals?.metadata?.currentWebview?.label;
  return typeof label === "string" ? label : null;
}

function sanitizeBrowserWebviewDiagnostic(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/file:\/\/[^\s"'<>]+/gi, "[file-url]")
    .slice(0, 500);
}
